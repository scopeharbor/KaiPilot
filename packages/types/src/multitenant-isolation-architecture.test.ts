// v3-multitenant-isolation-architecture — 共享契约单测。
// 覆盖：确定性 hash、invalid 枚举拒绝、dependency-light 导入、低敏脱敏。
import { describe, it, expect } from 'vitest'
import {
  mtFnv1aHash,
  mtStableSerialize,
  mtComputeOrganizationScopeHash,
  mtComputeProjectScopeHash,
  mtComputeScopeHash,
  mtComputeResourceScopeHash,
  mtComputePermissionSnapshotHash,
  mtComputeSnapshotSignature,
  mtBuildScopeSigningEnvelope,
  buildTenantScopeSnapshot,
  buildMultitenantAuditMetadata,
  buildMultitenantWarning,
  buildLowSensitiveScopeLabels,
  detectMultitenantForbiddenKeysDeep,
  redactMultitenantForbiddenKeys,
  hasMultitenantForbiddenKeys,
  isBatchSameTenant,
  MULTITENANT_SCOPE_MODES,
  MULTITENANT_RESOURCE_TYPES,
  MULTITENANT_OPERATION_TYPES,
  MULTITENANT_REASON_CODES,
  MULTITENANT_WARNING_CODES,
  MULTITENANT_DECISIONS,
  MULTITENANT_REGISTRY_STATUSES,
  isMultitenantScopeMode,
  isMultitenantResourceType,
  isMultitenantOperationType,
  isMultitenantReasonCode,
  isMultitenantWarningCode,
  isMultitenantDecision,
  isMultitenantRegistryStatus,
} from './multitenant-isolation-architecture.js'
import {
  MT_ORG_A_ID,
  MT_ORG_B_ID,
  MT_ORG_A_PROJECT_ID,
  buildOrgAContext,
  buildOrgBContext,
  buildOrgAScopeSnapshot,
  buildOrgBScopeSnapshot,
  buildOrgAMirrorRefs,
  buildOrgBMirrorRefs,
  buildTenantResourceDeclarations,
} from './multitenant-isolation-architecture-fixtures.js'

describe('多租户隔离共享契约：确定性 scope hash', () => {
  it('相同输入、不同对象键顺序产生相同稳定序列化与 scope hash', () => {
    const a = { organizationId: MT_ORG_A_ID, projectId: 1 }
    const b = { projectId: 1, organizationId: MT_ORG_A_ID }
    expect(mtStableSerialize(a)).toBe(mtStableSerialize(b))
    expect(mtComputeScopeHash(a)).toBe(mtComputeScopeHash(b))
  })

  it('组织 A 与组织 B 的 scope hash 不同（隔离）', () => {
    expect(mtComputeOrganizationScopeHash(MT_ORG_A_ID)).not.toBe(
      mtComputeOrganizationScopeHash(MT_ORG_B_ID),
    )
    expect(mtComputeScopeHash({ organizationId: MT_ORG_A_ID })).not.toBe(
      mtComputeScopeHash({ organizationId: MT_ORG_B_ID }),
    )
  })

  it('project scope hash 只在 projectId 非空时返回', () => {
    expect(mtComputeProjectScopeHash(null)).toBeNull()
    expect(mtComputeProjectScopeHash(undefined)).toBeNull()
    expect(mtComputeProjectScopeHash(5)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('确定性：多次调用返回相同值', () => {
    const h1 = mtFnv1aHash('aiproj:multitenant:scope:101')
    const h2 = mtFnv1aHash('aiproj:multitenant:scope:101')
    expect(h1).toBe(h2)
  })

  it('resource scope hash 区分资源类型与组织', () => {
    expect(mtComputeResourceScopeHash(MT_ORG_A_ID, 'project', 'p1')).not.toBe(
      mtComputeResourceScopeHash(MT_ORG_A_ID, 'task', 'p1'),
    )
    expect(mtComputeResourceScopeHash(MT_ORG_A_ID, 'project', 'p1')).not.toBe(
      mtComputeResourceScopeHash(MT_ORG_B_ID, 'project', 'p1'),
    )
  })

  it('permission snapshot hash 随 roleVersion / org / scope mode 变化', () => {
    const base = {
      roleVersion: 1,
      organizationId: MT_ORG_A_ID,
      scopeMode: 'organization_scoped' as const,
    }
    expect(mtComputePermissionSnapshotHash(base)).not.toBe(
      mtComputePermissionSnapshotHash({ ...base, roleVersion: 2 }),
    )
    expect(mtComputePermissionSnapshotHash(base)).not.toBe(
      mtComputePermissionSnapshotHash({ ...base, organizationId: MT_ORG_B_ID }),
    )
  })

  it('scope signing envelope 绑定 scope hash 与 nonce', () => {
    const e1 = mtBuildScopeSigningEnvelope({
      organizationId: MT_ORG_A_ID,
      projectId: 1,
      nonce: 'n1',
    })
    const e2 = mtBuildScopeSigningEnvelope({
      organizationId: MT_ORG_A_ID,
      projectId: 1,
      nonce: 'n1',
    })
    const e3 = mtBuildScopeSigningEnvelope({
      organizationId: MT_ORG_B_ID,
      projectId: 1,
      nonce: 'n1',
    })
    expect(e1).toBe(e2)
    expect(e1).not.toBe(e3)
  })
})

describe('多租户隔离共享契约：snapshot signature 防回放', () => {
  it('不同组织的 snapshot signature 不同（跨 org 回放失败）', () => {
    const aSig = mtComputeSnapshotSignature(buildOrgAScopeSnapshot())
    const bSig = mtComputeSnapshotSignature(buildOrgBScopeSnapshot())
    expect(aSig).not.toBe(bSig)
  })

  it('同一 snapshot 签名确定性', () => {
    const aSnap = buildOrgAScopeSnapshot()
    expect(mtComputeSnapshotSignature(aSnap)).toBe(mtComputeSnapshotSignature(aSnap))
  })

  it('permission snapshot 变化导致签名变化（stale 检测）', () => {
    const base = buildOrgAScopeSnapshot()
    const stale = buildTenantScopeSnapshot({
      ...base,
      permissionSnapshotHash: 'perm-123',
    } as never)
    // 用 mtComputeSnapshotSignature 直接验证 stale permission 会改签名
    expect(
      mtComputeSnapshotSignature({
        ...stale,
        permissionSnapshotHash: 'perm-aaa',
      }),
    ).not.toBe(
      mtComputeSnapshotSignature({
        ...stale,
        permissionSnapshotHash: 'perm-999',
      }),
    )
  })
})

describe('多租户隔离共享契约：invalid 枚举拒绝', () => {
  it('非法 scope mode / resource type / operation / reason / warning 被拒绝', () => {
    expect(isMultitenantScopeMode('bogus')).toBe(false)
    expect(isMultitenantResourceType('not-a-resource')).toBe(false)
    expect(isMultitenantOperationType('hack')).toBe(false)
    expect(isMultitenantReasonCode('HACK')).toBe(false)
    expect(isMultitenantWarningCode('HACK')).toBe(false)
    expect(isMultitenantDecision('maybe')).toBe(false)
    expect(isMultitenantRegistryStatus('wild')).toBe(false)
  })

  it('合法值通过守卫', () => {
    expect(isMultitenantScopeMode('organization_scoped')).toBe(true)
    expect(isMultitenantResourceType('project')).toBe(true)
    expect(isMultitenantOperationType('write')).toBe(true)
    expect(isMultitenantReasonCode('OK')).toBe(true)
    expect(isMultitenantWarningCode('CROSS_ORGANIZATION_BLOCKED')).toBe(true)
    expect(isMultitenantDecision('deny')).toBe(true)
    expect(isMultitenantRegistryStatus('degraded')).toBe(true)
  })

  it('枚举常量完整且唯一', () => {
    expect(new Set(MULTITENANT_SCOPE_MODES).size).toBe(MULTITENANT_SCOPE_MODES.length)
    expect(new Set(MULTITENANT_RESOURCE_TYPES).size).toBe(MULTITENANT_RESOURCE_TYPES.length)
    expect(new Set(MULTITENANT_OPERATION_TYPES).size).toBe(MULTITENANT_OPERATION_TYPES.length)
    expect(new Set(MULTITENANT_REASON_CODES).size).toBe(MULTITENANT_REASON_CODES.length)
    expect(new Set(MULTITENANT_WARNING_CODES).size).toBe(MULTITENANT_WARNING_CODES.length)
    expect(new Set(MULTITENANT_DECISIONS).size).toBe(MULTITENANT_DECISIONS.length)
    expect(new Set(MULTITENANT_REGISTRY_STATUSES).size).toBe(MULTITENANT_REGISTRY_STATUSES.length)
  })
})

describe('多租户隔离共享契约：dependency-light 导入与契约形状', () => {
  it('导出核心类型构建器均为函数', () => {
    expect(typeof buildTenantScopeSnapshot).toBe('function')
    expect(typeof buildMultitenantAuditMetadata).toBe('function')
    expect(typeof buildMultitenantWarning).toBe('function')
    expect(typeof buildLowSensitiveScopeLabels).toBe('function')
  })

  it('TenantScopeSnapshot 只含低敏字段', () => {
    const snap = buildOrgAScopeSnapshot()
    expect(snap.organizationId).toBe(MT_ORG_A_ID)
    expect(snap.organizationScopeHash).toMatch(/^[0-9a-f]{16}$/)
    expect(snap.projectScopeHash).toMatch(/^[0-9a-f]{16}$/)
    expect(snap.permissionSnapshotHash.length).toBeGreaterThan(0)
    expect(/token|secret|prompt|password|dek/i.test(JSON.stringify(snap))).toBe(false)
  })

  it('mirror fixtures 组织 A/B 反射镜像结构但不共享 ref', () => {
    const aRefs = buildOrgAMirrorRefs()
    const bRefs = buildOrgBMirrorRefs()
    const aKeys = Object.keys(aRefs).sort()
    const bKeys = Object.keys(bRefs).sort()
    expect(aKeys).toEqual(bKeys)
    expect(aRefs.project).not.toBe(bRefs.project)
  })

  it('org A/B tenant context 隔离', () => {
    const a = buildOrgAContext()
    const b = buildOrgBContext()
    expect(a.organizationId).not.toBe(b.organizationId)
    expect(a.actorRef).not.toBe(b.actorRef)
  })
})

describe('多租户隔离共享契约：低敏脱敏', () => {
  const payload = {
    organizationId: 101,
    scopeHash: 'abc',
    secret: 's3cret',
    token: 'tkn',
    prompt: '请生成计划',
    modelOutput: 'output',
    fileContent: 'file data',
    providerPayload: { x: 1 },
    absolutePath: '/var/data/secret',
    safeField: 'low-sensitivity',
    nested: { apiKey: 'k', safe: 1 },
  }

  it('detect 捕获所有禁止键路径', () => {
    const found = detectMultitenantForbiddenKeysDeep(payload)
    for (const key of [
      'secret',
      'token',
      'prompt',
      'modelOutput',
      'fileContent',
      'providerPayload',
      'absolutePath',
      'nested.apiKey',
    ]) {
      expect(found).toContain(key)
    }
  })

  it('redact 删除禁止键且保留安全字段', () => {
    const redacted = redactMultitenantForbiddenKeys(payload)
    expect(redacted.organizationId).toBe(101)
    expect(redacted.safeField).toBe('low-sensitivity')
    expect('secret' in redacted).toBe(false)
    expect('token' in redacted).toBe(false)
    expect('prompt' in redacted).toBe(false)
    expect('absolutePath' in redacted).toBe(false)
    expect('nested' in redacted && 'apiKey' in (redacted.nested as Record<string, unknown>)).toBe(
      false,
    )
    expect(hasMultitenantForbiddenKeys(redacted)).toBe(false)
  })

  it('低敏上下文渲染不暴露隐藏租户详情', () => {
    const labels = buildLowSensitiveScopeLabels({
      organizationId: MT_ORG_A_ID,
      projectId: MT_ORG_A_PROJECT_ID,
      projectName: '项目A',
    })
    expect(labels.organizationScopeHash).toMatch(/^[0-9a-f]{16}$/)
    expect(labels.projectScopeHash).toMatch(/^[0-9a-f]{16}$/)
    expect(labels.projectLabel).toBe('项目A')
    expect(hasMultitenantForbiddenKeys(labels)).toBe(false)
  })
})

describe('多租户隔离共享契约：审计元数据低敏构建', () => {
  it('audit metadata 只含低敏字段', () => {
    const meta = buildMultitenantAuditMetadata({
      actorRef: 'user:1001',
      organizationId: MT_ORG_A_ID,
      operationType: 'read',
      reasonCode: 'CROSS_ORGANIZATION_BLOCKED',
      decision: 'deny',
      requestId: 'req-1',
    })
    expect(meta.scopeHash).toMatch(/^[0-9a-f]{16}$/)
    expect(meta.operationType).toBe('read')
    expect(meta.reasonCode).toBe('CROSS_ORGANIZATION_BLOCKED')
    expect(meta.decision).toBe('deny')
    expect(meta.requestId).toBe('req-1')
    expect(hasMultitenantForbiddenKeys(meta)).toBe(false)
  })
})

describe('多租户隔离共享契约：批量混租判定', () => {
  it('同一组织批量通过', () => {
    const result = isBatchSameTenant({
      currentOrganizationId: MT_ORG_A_ID,
      resolvedOwners: [MT_ORG_A_ID, MT_ORG_A_ID, MT_ORG_A_ID],
    })
    expect(result.decision).toBe('allow')
    expect(result.reasonCode).toBe('OK')
  })

  it('混租批量被拒且不泄露具体 ID', () => {
    const result = isBatchSameTenant({
      currentOrganizationId: MT_ORG_A_ID,
      resolvedOwners: [MT_ORG_A_ID, MT_ORG_B_ID, MT_ORG_A_ID],
    })
    expect(result.decision).toBe('deny')
    expect(result.reasonCode).toBe('MIXED_TENANT_BATCH')
    expect(JSON.stringify(result)).not.toContain(String(MT_ORG_B_ID))
  })
})

describe('多租户隔离共享契约：registry 声明完整性', () => {
  it('registry 每项都带归属字段、解析器与 error semantics（派生资源可无组织列）', () => {
    const decls = buildTenantResourceDeclarations()
    expect(decls.length).toBeGreaterThan(10)
    for (const d of decls) {
      if (d.organizationField) {
        expect(d.organizationField.length).toBeGreaterThan(0)
      } else {
        // 无直接组织列的资源必须是项目父级派生，且带 project 过滤字段
        expect(d.parentResolver).toBe('project')
        expect(d.projectField).toBeTruthy()
      }
      expect(['project', 'organization', 'none']).toContain(d.parentResolver)
      expect(['RESOURCE_NOT_FOUND', 'PERMISSION_DENIED']).toContain(d.errorSemantics)
      expect(['registered', 'degraded', 'unsupported']).toContain(d.registryStatus)
      expect(d.auditResourceType.length).toBeGreaterThan(0)
    }
  })

  it('默认 scoped-only：global 必须显式声明', () => {
    const decls = buildTenantResourceDeclarations()
    const globalAllowed = decls.filter((d) => d.allowSuperAdminGlobal)
    for (const d of globalAllowed) {
      // 只有显式声明 resourceType 且 test fixture 允许的全局读
      expect(d.resourceType).toBe('project')
    }
  })
})
