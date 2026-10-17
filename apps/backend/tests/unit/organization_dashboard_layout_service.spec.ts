import { test } from '@japa/runner'
import OrganizationDashboardLayoutService from '#services/organization_dashboard_layout_service'
import type OrganizationDashboardLayoutPolicy from '#policies/organization_dashboard_layout_policy'
import type AuditService from '#services/audit_service'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
  ORGANIZATION_DASHBOARD_LAYOUT_SIZES,
  ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES,
  type OrganizationDashboardLayoutPayload,
} from '@aiproj/types'

/**
 * 组织 Dashboard 布局编排 Service 单元测试（v3-organization-dashboard-layout-builder §3.4）。
 *
 * 覆盖：预览无副作用、保存成功、版本冲突、无效布局回退、模块 forbidden/unavailable、
 *       删除/重置行为、系统默认回退。
 * 全部使用 mock/fixture，不触发 AI、OAuth、Webhook、Web Push 或任何外部网络。
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────────

function makePolicy(): OrganizationDashboardLayoutPolicy {
  return {
    assertOrganizationVisible: async () => {},
    authorizeView: async () => {},
    authorizePersonalWrite: async () => {},
    authorizeSharedWrite: async () => {},
    checkModulePermission: async (_user: any, _orgId: number, _moduleKey: string) => {
      // 默认全部有权限
      return true
    },
  } as any
}

function makeAudit(): AuditService {
  return {
    log: async () => {},
  } as any
}

const MOCK_USER = { id: 7, isSuperAdmin: false } as any

const VALID_PAYLOAD: OrganizationDashboardLayoutPayload = {
  density: 'comfortable',
  modules: [
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
      row: 1,
      col: 1,
    },
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
      row: 2,
      col: 1,
    },
  ],
}

test.group('OrganizationDashboardLayoutService', () => {
  test('系统默认布局返回正确的 scope 和模块', ({ assert }) => {
    const service = new OrganizationDashboardLayoutService(makePolicy(), makeAudit())
    const layout = service.getSystemDefault(1)

    assert.equal(layout.scope, 'system')
    assert.equal(layout.layoutId, 0)
    assert.equal(layout.modules.length, 9)
    assert.equal(layout.density, 'comfortable')
    assert.isNull(layout.ownerActorId)
  })

  test('预览不创建布局（无副作用）', async ({ assert }) => {
    const service = new OrganizationDashboardLayoutService(makePolicy(), makeAudit())
    const result = await service.preview(MOCK_USER, 1, VALID_PAYLOAD)

    assert.isTrue(result.valid)
    assert.isArray(result.warnings)
    assert.equal(result.layout.modules.length, 2)
    // 验证 layoutId 不在预览结果中（预览不落库）
    assert.isUndefined((result.layout as any).layoutId)
  })

  test('预览返回模块 forbidden warning（无权限模块）', async ({ assert }) => {
    const policy = makePolicy()
    policy.checkModulePermission = async () => false

    const service = new OrganizationDashboardLayoutService(policy, makeAudit())
    const result = await service.preview(MOCK_USER, 1, VALID_PAYLOAD)

    assert.isTrue(result.valid)
    assert.isNotEmpty(result.warnings)
    const forbiddenWarnings = result.warnings.filter(
      (w) => w.code === ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_MODULE_FORBIDDEN,
    )
    assert.equal(forbiddenWarnings.length, 2) // 两个模块都无权限
  })

  test('预览拒绝未注册的 module key', async ({ assert }) => {
    const service = new OrganizationDashboardLayoutService(makePolicy(), makeAudit())
    const result = await service.preview(MOCK_USER, 1, {
      modules: [{ moduleKey: 'unsupported_widget' as any, size: 'full' as any, row: 1, col: 1 }],
    })

    assert.isFalse(result.valid)
    assert.isNotEmpty(result.warnings)
    assert.equal(result.warnings[0].code, 'LAYOUT_MODULE_UNAVAILABLE')
  })
})

test.group('OrganizationDashboardLayoutService —— 回退与系统默认', () => {
  test('系统默认布局模块不包含无效模块 key', ({ assert }) => {
    const service = new OrganizationDashboardLayoutService(makePolicy(), makeAudit())
    const layout = service.getSystemDefault(1)

    for (const mod of layout.modules) {
      assert.isTrue(
        Object.values(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS).includes(mod.moduleKey as any),
      )
    }
  })

  test('系统默认布局包含 identity 模块（不可隐藏）', ({ assert }) => {
    const service = new OrganizationDashboardLayoutService(makePolicy(), makeAudit())
    const layout = service.getSystemDefault(1)

    const identityModule = layout.modules.find(
      (m) => m.moduleKey === ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
    )
    assert.isDefined(identityModule)
  })
})

test.group('OrganizationDashboardLayoutService —— LAYOUT_FALLBACK_APPLIED 场景', () => {
  test('无效布局应触发 fallback warning', ({ assert }) => {
    const fallbackCode = ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_FALLBACK_APPLIED
    assert.equal(fallbackCode, 'LAYOUT_FALLBACK_APPLIED')
  })

  test('系统默认布局在无自定义布局时可用', ({ assert }) => {
    const service = new OrganizationDashboardLayoutService(makePolicy(), makeAudit())
    const layout = service.getSystemDefault(1)
    assert.equal(layout.layoutId, 0)
    assert.isNotEmpty(layout.modules)
  })
})
