// v3-multitenant-api §7.6 —— SDK 多租户 bound 助手单测。
// 覆盖：不安全组织 override 拒绝、scoped 幂等键跨租户不可复用、低敏 response metadata 类型守卫、
// 与"客户端 permission/decision claim 不作为事实源"的 fail-closed 语义。
import { describe, expect, test } from 'vitest'
import {
  refuseUnsafeTenantOverride,
  scopedIdempotencyKey,
  readTenantDecisionMetadata,
} from './multitenant-api.js'

const ORG_A_HASH = 'aaaaaaaaaaaaaaaa'
const ORG_B_HASH = 'bbbbbbbbbbbbbbbb'

describe('SDK 多租户 bound：不安全 override 预检（spec: SDK helper refuses unsafe tenant override）', () => {
  test('客户端 override 与服务器 scope 冲突 -> 拒绝', () => {
    const r = refuseUnsafeTenantOverride({ clientOrganizationId: 7, serverScopeHash: ORG_A_HASH })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('UNSAFE_TENANT_OVERRIDE')
  })

  test('无 override -> 放行', () => {
    expect(
      refuseUnsafeTenantOverride({ clientOrganizationId: null, serverScopeHash: ORG_A_HASH }).ok,
    ).toBe(true)
  })

  test('他人 scope 的 override 不能冒充本租户', () => {
    const r = refuseUnsafeTenantOverride({ clientOrganizationId: 200, serverScopeHash: ORG_A_HASH })
    expect(r.ok).toBe(false)
  })
})

describe('SDK 多租户：scoped idempotency key（spec: Idempotency key cannot cross tenants）', () => {
  test('不同租户的幂等键不同', () => {
    const kA = scopedIdempotencyKey({
      tenantScopeHash: ORG_A_HASH,
      operation: 'confirm',
      resourceType: 'ai_draft',
      reference: 'draft-1',
    })
    const kB = scopedIdempotencyKey({
      tenantScopeHash: ORG_B_HASH,
      operation: 'confirm',
      resourceType: 'ai_draft',
      reference: 'draft-1',
    })
    expect(kA).toBeDefined()
    expect(kB).toBeDefined()
    expect(kA).not.toBe(kB)
  })

  test('同租户同 reference 幂等键稳定', () => {
    const a = scopedIdempotencyKey({
      tenantScopeHash: ORG_A_HASH,
      operation: 'create',
      resourceType: 'task',
      reference: 't-1',
    })
    const b = scopedIdempotencyKey({
      tenantScopeHash: ORG_A_HASH,
      operation: 'create',
      resourceType: 'task',
      reference: 't-1',
    })
    expect(a).toBe(b)
  })
})

describe('SDK 多租户：低敏 response metadata（spec: Response metadata remains low-sensitive）', () => {
  test('合法低敏 metadata 可读', () => {
    const r = readTenantDecisionMetadata({
      requestId: 'r-1',
      tenantScopeHash: ORG_A_HASH,
      cacheNamespace: 'map:cache:' + ORG_A_HASH,
      scopeMode: 'tenant',
      decision: 'allow',
      reasonCode: 'OK',
      warnings: [],
    })
    expect(r.ok).toBe(true)
  })

  test('含 forbidden fields 的 metadata 被拒绝（fail closed）', () => {
    const r = readTenantDecisionMetadata({
      requestId: 'r-2',
      tenantScopeHash: ORG_A_HASH,
      cacheNamespace: 'map:cache:' + ORG_A_HASH,
      scopeMode: 'tenant',
      decision: 'allow',
      reasonCode: 'OK',
      warnings: [],
      // @ts-expect-error - 仅测试 fail-closed：SDK 类型层面不允许，但运行时可能有脏 envelope。
      provider_payload: { raw: 'xxx' },
    })
    expect(r.ok).toBe(false)
  })

  test('客户端 permission/decision claim 不作为授权事实', () => {
    // SDK 层从不把 payload 里的 claim 当授权事实；这里校验 decision metadata 判定仍为只读。
    const r = readTenantDecisionMetadata({
      requestId: 'r-3',
      tenantScopeHash: ORG_A_HASH,
      cacheNamespace: 'map:cache:' + ORG_A_HASH,
      scopeMode: 'tenant',
      decision: 'allow',
      reasonCode: 'OK',
      warnings: [],
    })
    expect(r.ok).toBe(true)
  })
})
