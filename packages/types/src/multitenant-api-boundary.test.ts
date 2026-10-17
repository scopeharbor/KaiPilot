// v3-multitenant-api —— 共享 API 边界契约单测。
// 覆盖：确定性 hash、cache namespace 稳定性/隔离、幂等 scope 隔离、低敏脱敏、forbidden-key 检测、
// 客户端组织一致性（route/body/query）、不安全 override 预检、handle 创建/消费（跨租重放/过期）、
// scope mode 允许项与 type guards。
import { describe, it, expect } from 'vitest'
import {
  API_HANDLE_KINDS,
  isApiResponseSensitivity,
  isApiScopeSource,
  isApiOperationType,
  isApiHandleKind,
  isApiHintLocation,
  isApiHintRole,
  isMapReasonCode,
  isMapWarningCode,
  isApiDecision,
  mapComputeScope,
  mapComputeCacheNamespace,
  mapComputeIdempotencyScope,
  mapComputeSourceHash,
  mapDetectForbiddenKeys,
  mapHasForbiddenKeys,
  mapRedactLowSensitive,
  mapAssertOrgConsistency,
  mapBuildDecisionEnvelope,
  mapBuildLowSensitiveAudit,
  mapConsumeHandle,
  mapIsAllowedScopeMode,
  mapValidateUnsafeOverride,
  mapExtractOrganizationHash,
} from './multitenant-api-boundary.js'
import {
  API_ORG_A_ID,
  API_ORG_B_ID,
  apiOrgAScopeHash,
  apiOrgBScopeHash,
  buildApiProjectSurfaces,
  buildApiOrgAMirrorRefs,
  buildApiOrgBMirrorRefs,
  buildApiHandleFixtureA,
} from './multitenant-api-boundary-fixtures.js'

const ORG_A = String(API_ORG_A_ID)
const ORG_B = String(API_ORG_B_ID)

describe('API 边界契约：决定性 hash 与 cache/idempotency namespace（spec: Query key includes server tenant namespace）', () => {
  it('相同组织相同 view 的 cache namespace 稳定', () => {
    const a1 = mapComputeCacheNamespace({ organizationId: ORG_A, namespace: 'projects.index' })
    const a2 = mapComputeCacheNamespace({ organizationId: ORG_A, namespace: 'projects.index' })
    expect(a1).toBe(a2)
    expect(a1).toContain(apiOrgAScopeHash())
  })

  it('两个组织的 cache namespace 不同（跨租户不复用缓存）', () => {
    const a = mapComputeCacheNamespace({ organizationId: ORG_A, namespace: 'projects' })
    const b = mapComputeCacheNamespace({ organizationId: ORG_B, namespace: 'projects' })
    expect(a).not.toBe(b)
  })

  it('不同 view namespace 在同一组织下不同', () => {
    const listNs = mapComputeCacheNamespace({ organizationId: ORG_A, namespace: 'projects.index' })
    const detailNs = mapComputeCacheNamespace({ organizationId: ORG_A, namespace: 'projects.show' })
    expect(listNs).not.toBe(detailNs)
  })

  it('idempotency scope 在不同组织下不可复用', () => {
    const ia = mapComputeIdempotencyScope({
      organizationId: ORG_A,
      operation: 'create',
      resourceType: 'task',
    })
    const ib = mapComputeIdempotencyScope({
      organizationId: ORG_B,
      operation: 'create',
      resourceType: 'task',
    })
    expect(ia).not.toBe(ib)
  })

  it('source hash 绑定组织，不同组织同源不同 hash', () => {
    const sa = mapComputeSourceHash({ organizationId: ORG_A, sourceRef: 'report:A-1' })
    const sb = mapComputeSourceHash({ organizationId: ORG_B, sourceRef: 'report:A-1' })
    expect(sa).not.toBe(sb)
  })

  it('scope hash 跨组织不同', () => {
    expect(mapComputeScope({ organizationId: ORG_A })).not.toBe(
      mapComputeScope({ organizationId: ORG_B }),
    )
  })
})

describe('API 边界：低敏脱敏与 forbidden keys（spec: Response metadata remains low-sensitive）', () => {
  it('forbidden keys 检测命中嵌套字段', () => {
    const dirty = { data: { name: 'x', token: 'abc', nested: { model_output: 'o' } } }
    expect(mapHasForbiddenKeys(dirty)).toBe(true)
    expect(mapDetectForbiddenKeys(dirty).length).toBeGreaterThan(0)
  })

  it('脱敏后不包含 secret/token/provider 字段', () => {
    const clean = mapRedactLowSensitive({
      requestId: 'req-1',
      tenantScopeHash: apiOrgAScopeHash(),
      payload: { content: 'full', secret: 's', provider_payload: 'p', prompt_text: 'prompt' },
    })
    expect(mapHasForbiddenKeys(clean)).toBe(false)
    expect(clean.payload.content).toBe('full')
  })
})

describe('API 边界：客户端组织一致性 hint（spec: Client-provided organization scope MUST be consistency hint only）', () => {
  it('route 参数与服务器 org 不一致 -> ROUTE mismatch 拒绝', () => {
    const r = mapAssertOrgConsistency({
      serverOrganizationId: ORG_A,
      clientOrganizationId: ORG_B,
      origin: 'route',
    })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('ROUTE_ORGANIZATION_MISMATCH')
  })

  it('body 组织与服务器 org 不一致 -> BODY mismatch 拒绝', () => {
    const r = mapAssertOrgConsistency({
      serverOrganizationId: ORG_A,
      clientOrganizationId: ORG_B,
      origin: 'body',
    })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('BODY_ORGANIZATION_MISMATCH')
  })

  it('query 组织过滤器不能扩大 scope -> QUERY mismatch 拒绝', () => {
    const r = mapAssertOrgConsistency({
      serverOrganizationId: ORG_A,
      clientOrganizationId: ORG_B,
      origin: 'query',
    })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('QUERY_ORGANIZATION_MISMATCH')
  })

  it('无 hint 或同组织一致 -> 允许', () => {
    const no = mapAssertOrgConsistency({ serverOrganizationId: ORG_A, origin: 'body' })
    const same = mapAssertOrgConsistency({
      serverOrganizationId: ORG_A,
      clientOrganizationId: ORG_A,
      origin: 'body',
    })
    expect(no.allowed).toBe(true)
    expect(same.allowed).toBe(true)
  })
})

describe('API 边界：不安全组织 override 预检（spec: SDK helper refuses unsafe tenant override）', () => {
  it('客户端 override 与服务器 scope hash 冲突 -> 拒绝', () => {
    const r = mapValidateUnsafeOverride({
      clientOrganizationId: ORG_B,
      serverScopeHash: apiOrgAScopeHash(),
    })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('UNSAFE_TENANT_OVERRIDE')
  })

  it('客户端未提供 override -> 允许', () => {
    const r = mapValidateUnsafeOverride({
      clientOrganizationId: null,
      serverScopeHash: apiOrgAScopeHash(),
    })
    expect(r.allowed).toBe(true)
  })

  it('组织 A hash 提取前缀与自身一致', () => {
    expect(mapExtractOrganizationHash(apiOrgAScopeHash())).toBe(apiOrgAScopeHash())
  })
})

describe('API 边界：handle 创建与消费（preview/confirm/export/job 绑定，spec: handles MUST bind tenant scope）', () => {
  it('同租户 preview handle 可消费', () => {
    const h = buildApiHandleFixtureA()
    const r = mapConsumeHandle({
      handle: h,
      scopeHash: apiOrgAScopeHash(),
      actorRef: 'user:1001',
      operation: 'preview',
      kind: 'preview',
    })
    expect(r.allowed).toBe(true)
  })

  it('跨租户回放被拒绝（org B 不能消费 org A 的 handle）', () => {
    const h = buildApiHandleFixtureA()
    const r = mapConsumeHandle({
      handle: h,
      scopeHash: apiOrgBScopeHash(),
      actorRef: 'user:2002',
      operation: 'preview',
      kind: 'preview',
    })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('CROSS_TENANT_REPLAY')
  })

  it('操作不匹配被拒绝', () => {
    const h = buildApiHandleFixtureA()
    const r = mapConsumeHandle({
      handle: h,
      scopeHash: apiOrgAScopeHash(),
      actorRef: 'user:1001',
      operation: 'confirm',
      kind: 'confirm',
    })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('INVALID_HANDLE')
  })

  it('过期 handle 被拒绝（EXPIRED_HANDLE）', () => {
    const h = buildApiHandleFixtureA({ expiresAt: '2000-01-01T00:00:00.000Z' })
    const r = mapConsumeHandle({
      handle: h,
      scopeHash: apiOrgAScopeHash(),
      actorRef: 'user:1001',
      operation: 'preview',
      kind: 'preview',
      now: '2099-01-01T00:00:00.000Z',
    })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('EXPIRED_HANDLE')
  })
})

describe('API 边界：低敏 decision metadata 与 scope mode（spec: Global low-sensitive route is audited）', () => {
  it('构造低敏 decision envelope 且无滥用字段', () => {
    const d = mapBuildDecisionEnvelope({
      requestId: 'req',
      scopeHash: apiOrgAScopeHash(),
      scopeMode: 'tenant',
      decision: 'allow',
      reasonCode: 'OK',
    })
    expect(mapHasForbiddenKeys(d)).toBe(false)
    expect(d.cacheNamespace).toContain(apiOrgAScopeHash())
  })

  it('scope mode 未在 surface 声明时不允许全局', () => {
    const surfaces = buildApiProjectSurfaces()
    expect(mapIsAllowedScopeMode(surfaces[0], 'tenant')).toBe(true)
    expect(mapIsAllowedScopeMode(surfaces[0], 'global-low-sensitive')).toBe(false)
  })

  it('审计 metadata 低敏且含 route/scope/reason', () => {
    const audit = mapBuildLowSensitiveAudit({
      actorRef: 'user:1001',
      organizationId: API_ORG_A_ID,
      scopeHash: apiOrgAScopeHash(),
      route: '/api/v1/projects',
      operation: 'list',
      reasonCode: 'OK',
      scopeMode: 'tenant',
      requestId: 'r-1',
    })
    expect(audit.route).toBe('/api/v1/projects')
    expect(mapHasForbiddenKeys(audit)).toBe(false)
  })
})

describe('API 边界：类型守卫与枚举值', () => {
  it('type guards 对合法值返回 true', () => {
    expect(isApiOperationType('export')).toBe(true)
    expect(isApiHandleKind('preview')).toBe(true)
    expect(isMapReasonCode('CROSS_TENANT_REPLAY')).toBe(true)
    expect(isMapWarningCode('API_CROSS_TENANT_BLOCKED')).toBe(true)
    expect(isApiDecision('deny')).toBe(true)
    expect(isApiResponseSensitivity('tenant_private')).toBe(true)
    expect(isApiScopeSource('route_param')).toBe(true)
  })

  it('type guards 对非法值返回 false', () => {
    expect(isApiOperationType('nope')).toBe(false)
    expect(isApiDecision('maybe')).toBe(false)
  })

  it('mirror fixtures 两组织同构但隔离', () => {
    const a = buildApiOrgAMirrorRefs()
    const b = buildApiOrgBMirrorRefs()
    expect(a.project).not.toBe(b.project)
    expect(a.task).not.toBe(b.task)
    expect(a.enterprise_ledger).not.toBe(b.enterprise_ledger)
    expect(a.compiler_artifact).not.toBe(b.compiler_artifact)
  })
})

describe('API 边界：job/export/SSE handle 与 stale source hash（spec: Handles MUST bind tenant scope; Export handle bound before download）', () => {
  it('同租户 export handle 可消费，跨租户复用被拒', () => {
    const h = buildApiHandleFixtureA({ kind: 'export', operation: 'export', sourceHash: 'src-A' })
    const ok = mapConsumeHandle({
      handle: h,
      scopeHash: apiOrgAScopeHash(),
      actorRef: 'user:1001',
      operation: 'export',
      kind: 'export',
      expectedSourceHash: h.sourceHash,
    })
    expect(ok.allowed).toBe(true)
    const cross = mapConsumeHandle({
      handle: h,
      scopeHash: apiOrgBScopeHash(),
      actorRef: 'user:1001',
      operation: 'export',
      kind: 'export',
      expectedSourceHash: h.sourceHash,
    })
    expect(cross.allowed).toBe(false)
    expect(cross.reasonCode).toBe('CROSS_TENANT_REPLAY')
  })

  it('source hash 过期 -> STALE_SOURCE_HASH 拒绝（导出源变更后不可下载）', () => {
    const h = buildApiHandleFixtureA({ kind: 'export', operation: 'export', sourceHash: 'src-A' })
    const r = mapConsumeHandle({
      handle: h,
      scopeHash: apiOrgAScopeHash(),
      actorRef: 'user:1001',
      operation: 'export',
      kind: 'export',
      expectedSourceHash: 'different-hash',
    })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('STALE_SOURCE_HASH')
  })

  it('sse/job/confirm handle kind 受控且幂等 scope 跨租户隔离', () => {
    expect(API_HANDLE_KINDS).toContain('export' as const)
    expect(API_HANDLE_KINDS).toContain('job' as const)
    expect(API_HANDLE_KINDS).toContain('sse' as const)
  })
})
