import { test } from '@japa/runner'
import { PermissionGuard } from '#services/copilot_notification/permission_guard'
import type { DeliveryInput } from '#services/copilot_notification/delivery_orchestrator'
import type { DeliveryPreference } from '@aiproj/types'

const baseInput: DeliveryInput = {
  entryId: 'entry-1',
  organizationId: 1001,
  recipientId: 2001,
  projectId: 100,
  problemKind: 'resource_overload',
  severity: 'high',
  unreadCount: 3,
}

const orgPref: DeliveryPreference = {
  level: 'organization',
  ownerId: 1001,
  preferences: {},
  createdAt: '2026-08-18T10:00:00.000Z',
  updatedAt: '2026-08-18T10:00:00.000Z',
}

test.group('PermissionGuard - 权限检查（7.1）', () => {
  test('7.1: 条目属于正确组织时允许投递', ({ assert }) => {
    const guard = new PermissionGuard({ enabled: true })

    const result = guard.checkEntryVisibility(baseInput, orgPref)

    assert.isTrue(result.allowed)
  })

  test('7.1: 条目不属于正确组织时拒绝投递', ({ assert }) => {
    const guard = new PermissionGuard({ enabled: true })

    const inputFromOtherOrg: DeliveryInput = {
      ...baseInput,
      organizationId: 9999,
    }

    const result = guard.checkEntryVisibility(inputFromOtherOrg, orgPref)

    assert.isFalse(result.allowed)
    assert.include(result.reason!, '组织 ID')
  })
})

test.group('PermissionGuard - 组织隔离（7.3）', () => {
  test('7.3: 所有投递路径附加 organization_id', ({ assert }) => {
    const guard = new PermissionGuard({ enabled: true })

    const result = guard.checkEntryVisibility(baseInput, orgPref)

    assert.isTrue(result.allowed)
    assert.equal(baseInput.organizationId, orgPref.ownerId)
  })

  test('7.3: 跨组织条目恒不投递', ({ assert }) => {
    const guard = new PermissionGuard({ enabled: true })

    const inputFromOtherOrg: DeliveryInput = {
      ...baseInput,
      organizationId: 9999,
    }

    const result = guard.checkEntryVisibility(inputFromOtherOrg, orgPref)

    assert.isFalse(result.allowed)
  })
})

test.group('PermissionGuard - 非泄露测试（7.2）', () => {
  test('7.2: 仅相差一项权限的两个 actor，投递与计数无可推断差异', ({ assert }) => {
    const guard = new PermissionGuard({ enabled: true })

    const actor1Results = [
      {
        entryId: 'entry-1',
        results: [
          { channel: 'badge', success: true },
          { channel: 'in_app_notification', success: true },
          { channel: 'push', success: false, reason: 'authorization_gated' },
        ],
      },
    ]

    const actor2Results = [
      {
        entryId: 'entry-1',
        results: [
          { channel: 'badge', success: true },
          { channel: 'in_app_notification', success: true },
          { channel: 'push', success: false, reason: 'authorization_gated' },
        ],
      },
    ]

    const { safe } = guard.checkNonLeakage(2001, 2002, actor1Results, actor2Results)

    assert.isTrue(safe)
  })

  test('7.2: 投递条目数量不同时检测到差异', ({ assert }) => {
    const guard = new PermissionGuard({ enabled: true })

    const actor1Results = [
      {
        entryId: 'entry-1',
        results: [{ channel: 'badge', success: true }],
      },
    ]

    const actor2Results = [
      {
        entryId: 'entry-1',
        results: [{ channel: 'badge', success: true }],
      },
      {
        entryId: 'entry-2',
        results: [{ channel: 'badge', success: true }],
      },
    ]

    const { safe, reason } = guard.checkNonLeakage(2001, 2002, actor1Results, actor2Results)

    assert.isFalse(safe)
    assert.include(reason!, '投递条目数量不同')
  })
})

test.group('PermissionGuard - 零域写依赖（7.5）', () => {
  test('7.5: 投递层无域仓储或模型写依赖', ({ assert }) => {
    const guard = new PermissionGuard({ enabled: true })

    const result = guard.verifyZeroDomainWriteDependency()

    assert.isTrue(result)
  })
})

test.group('PermissionGuard - 权限检查禁用时', () => {
  test('权限检查禁用时允许所有投递', ({ assert }) => {
    const guard = new PermissionGuard({ enabled: false })

    const inputFromOtherOrg: DeliveryInput = {
      ...baseInput,
      organizationId: 9999,
    }

    const result = guard.checkEntryVisibility(inputFromOtherOrg, orgPref)

    assert.isTrue(result.allowed)
  })
})
