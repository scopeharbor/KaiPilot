// v3-multitenant-api §4.1/§6.5 —— TenantBoundaryEnvelopeHelper 单元测试。
// 覆盖：list/detail envelope 携带低敏 tenant 块、无 boundary 时原样透传、
// 禁止字段/权限 allowlist 不进入响应（低敏响应语义）。
import { test } from '@japa/runner'
import {
  lowSensitiveTenantBlock,
  withTenantBoundaryDetailMeta,
  withTenantBoundaryListMeta,
  type TenantBoundaryEnvelope,
} from '#services/tenant_boundary_envelope_helper'
import type { ApiDecisionMetadata } from '@aiproj/types/multitenant-api-boundary'

const META: ApiDecisionMetadata = {
  requestId: 'req-1',
  tenantScopeHash: 'a'.repeat(16),
  cacheNamespace: 'map:cache:' + 'a'.repeat(16),
  scopeMode: 'tenant',
  decision: 'allow',
  reasonCode: 'OK',
  warnings: [],
  idempotencyScope: null,
  degradedReason: null,
}

test.group('TenantBoundaryEnvelopeHelper：低敏 list/detail envelope', () => {
  test('list envelope 附带 low-sensitive tenant 块', ({ assert }) => {
    const env = withTenantBoundaryListMeta(META, {
      data: [{ id: 1 }],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    assert.equal(env.data.length, 1)
    assert.equal(env.meta.tenant?.requestId, 'req-1')
    assert.equal(env.meta.tenant?.tenantScopeHash, 'a'.repeat(16))
    assert.isTrue(env.meta.tenant?.cacheNamespace.startsWith('map:cache:'))
  })

  test('detail envelope 附加 low-sensitive tenant 块', ({ assert }) => {
    const env = withTenantBoundaryDetailMeta(META, { data: { id: 1 } })
    assert.equal(env.tenantApiBoundary?.requestId, 'req-1')
    assert.equal(env.data.id, 1)
  })

  test('无 boundary -> 原样返回，不附加', ({ assert }) => {
    const env = withTenantBoundaryListMeta(undefined, {
      data: [{ id: 1 }],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    assert.isUndefined(env.meta.tenant)
  })
})

test.group('TenantBoundaryEnvelopeHelper：低敏语义', () => {
  test('lowSensitiveTenantBlock 不泄露权限 allowlist / 隐藏字段', ({ assert }) => {
    const block: TenantBoundaryEnvelope | null = lowSensitiveTenantBlock(META)
    assert.isNotNull(block)
    const keys = Object.keys(block!)
    assert.isFalse(keys.includes('permissions'))
    assert.isFalse(keys.includes('organizationId'))
    assert.isFalse(keys.includes('sourceHash'))
    assert.isFalse(keys.includes('prompt'))
    assert.isFalse(keys.includes('output'))
  })

  test('block 不含隐藏资源计数/来源', ({ assert }) => {
    const block = lowSensitiveTenantBlock(META)
    assert.equal(block?.warnings.length, 0)
    assert.isFalse(Object.values(block!).some((v) => v === 'secret'))
  })
})
