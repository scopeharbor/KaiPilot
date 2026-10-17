// v3-multitenant-api §6.3 —— TenantLowSensitiveGateService 单测。
// 覆盖：显式 global opt-in + 允许 scope mode 才放行；只返回 approved 低敏聚合；含 forbidden
// field / 越界 key / 未 opt-in / 错误 mode 均拒绝；每次产出低敏自审计。
import { test } from '@japa/runner'
import TenantLowSensitiveGateService, {
  type TenantLowSensitiveGateInput,
} from '#services/tenant_low_sensitive_gate_service'

const GLOBAL_MODE = 'global-low-sensitive' as const
const SURFACE = {
  allowedScopeModes: [GLOBAL_MODE],
  isGlobalOptIn: true,
}

function input(overrides = {}): TenantLowSensitiveGateInput {
  return {
    scopeMode: 'global-low-sensitive',
    actorRef: 'user:1',
    organizationId: null,
    scopeHash: 'a'.repeat(16),
    route: '/api/v1/console/governance/summary',
    surface: SURFACE,
    operation: 'admin',
    requestId: 'req-1',
    allowedAggregateKeys: ['orgCount'],
    response: { requestId: 'req-1', orgCount: 3 },
    ...overrides,
  }
}

test.group('TenantLowSensitiveGateService：global-low-sensitive response gate', () => {
  test('未被 opt-in 的 surface -> 拒绝', ({ assert }) => {
    const r = TenantLowSensitiveGateService.gate(input({ surface: null }))
    assert.isFalse(r.allowed)
    assert.isNotEmpty(r.violations)
  })

  test('scope mode 不属于允许集 -> 拒绝', ({ assert }) => {
    const g = TenantLowSensitiveGateService.gate({ ...input(), scopeMode: 'tenant' })
    assert.isFalse(g.allowed)
  })

  test('approved 聚合 + envelope 放行，且含自审计元数据', ({ assert }) => {
    const g = TenantLowSensitiveGateService.gate(input())
    assert.isTrue(g.allowed)
    assert.isEmpty(g.violations)
    assert.equal(g.audit.route, '/api/v1/console/governance/summary')
    assert.equal(g.audit.operation, 'admin')
    assert.isString(g.audit.timestamp)
    assert.isString(g.audit.scopeHash)
  })

  test('越界业务 key 拒绝', ({ assert }) => {
    const g = TenantLowSensitiveGateService.gate(input({ response: { hiddenCount: 99 } }))
    assert.isFalse(g.allowed)
    assert.isTrue(g.violations.some((v) => v.indexOf('hiddenCount') >= 0))
  })

  test('响应含 forbidden field 拒绝', ({ assert }) => {
    const g = TenantLowSensitiveGateService.gate(
      input({
        response: { requestId: 'r-1', orgCount: 1, promptText: 'x' },
      }),
    )
    assert.isFalse(g.allowed)
    assert.isNotEmpty(g.violations)
  })
})
