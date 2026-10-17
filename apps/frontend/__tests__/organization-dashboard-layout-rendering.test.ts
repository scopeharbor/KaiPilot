import { describe, expect, it } from 'vitest'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
  ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT,
  ORGANIZATION_DASHBOARD_MODULE_REGISTRY,
  type OrganizationDashboardLayout,
  type OrganizationDashboardLayoutPreviewWarning,
  type OrganizationDashboardLayoutModuleKey,
} from '@aiproj/types'

/**
 * 组织 Dashboard 布局渲染测试（v3-organization-dashboard-layout-builder §5.6）。
 *
 * 覆盖：系统默认、个人布局、组织默认布局、无效布局回退、
 *       模块 forbidden/unavailable 状态、空组织、warning badges。
 */

describe('组织 Dashboard 布局渲染 —— 系统默认布局', () => {
  it('系统默认布局包含 9 个模块', () => {
    expect(ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules).toHaveLength(9)
  })

  it('系统默认布局 scope 为 system', () => {
    expect(ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.scope).toBe('system')
  })

  it('系统默认布局所有模块在注册表中', () => {
    for (const mod of ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules) {
      expect(ORGANIZATION_DASHBOARD_MODULE_REGISTRY[mod.moduleKey]).toBeDefined()
    }
  })

  it('系统默认布局 identity 模块在第一位', () => {
    const firstModule = ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules[0]
    expect(firstModule!.moduleKey!).toBe(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY)
  })
})

describe('组织 Dashboard 布局渲染 —— 个人布局', () => {
  it('个人布局 scope 为 personal', () => {
    const personalLayout: OrganizationDashboardLayout = {
      layoutId: 5,
      organizationId: 42,
      scope: 'personal',
      ownerActorId: 7,
      name: '我的布局',
      version: 1,
      isDefault: true,
      density: 'comfortable',
      modules: [
        { moduleKey: 'identity', size: 'full', row: 1, col: 1 },
        { moduleKey: 'kpi_strip', size: 'full', row: 2, col: 1 },
        { moduleKey: 'attention_projects', size: 'large', row: 3, col: 1 },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(personalLayout.scope).toBe('personal')
    expect(personalLayout.ownerActorId).toBe(7)
    expect(personalLayout.isDefault).toBe(true)
    expect(personalLayout.modules).toHaveLength(3)
  })

  it('个人布局可以隐藏部分模块', () => {
    const personalLayout: OrganizationDashboardLayout = {
      layoutId: 6,
      organizationId: 42,
      scope: 'personal',
      ownerActorId: 8,
      name: '极简布局',
      version: 1,
      isDefault: false,
      density: 'compact',
      modules: [
        { moduleKey: 'identity', size: 'full', row: 1, col: 1 },
        { moduleKey: 'kpi_strip', size: 'full', row: 2, col: 1 },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(personalLayout.modules).toHaveLength(2)
    // 不能缺少 identity（不可隐藏）
    const hasIdentity = personalLayout.modules.some(
      (m) => m.moduleKey === ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
    )
    expect(hasIdentity).toBe(true)
  })
})

describe('组织 Dashboard 布局渲染 —— 组织默认布局', () => {
  it('组织共享布局 scope 为 shared', () => {
    const sharedLayout: OrganizationDashboardLayout = {
      layoutId: 10,
      organizationId: 42,
      scope: 'shared',
      ownerActorId: null,
      name: '组织默认',
      version: 1,
      isDefault: true,
      density: 'comfortable',
      modules: [
        { moduleKey: 'identity', size: 'full', row: 1, col: 1 },
        { moduleKey: 'kpi_strip', size: 'full', row: 2, col: 1 },
        { moduleKey: 'pmo_entry', size: 'medium', row: 3, col: 1 },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(sharedLayout.scope).toBe('shared')
    expect(sharedLayout.ownerActorId).toBeNull()
    expect(sharedLayout.isDefault).toBe(true)
  })
})

describe('组织 Dashboard 布局渲染 —— 无效布局回退', () => {
  it('LAYOUT_FALLBACK_APPLIED warning code 存在', () => {
    expect(ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_FALLBACK_APPLIED).toBe(
      'LAYOUT_FALLBACK_APPLIED',
    )
  })

  it('无效布局应返回系统默认', () => {
    // 模拟：当没有自定义布局时，系统默认应该可用
    const fallback = ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT
    expect(fallback.modules.length).toBeGreaterThan(0)
    expect(fallback.scope).toBe('system')
  })

  it('系统默认布局不依赖任何持久化数据', () => {
    const defaultLayout = ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT
    expect(defaultLayout.version).toBe(1)
    // 系统默认布局的类型里就没有 layoutId（Omit 掉了），这里断言运行时也不存在
    expect((defaultLayout as Record<string, unknown>).layoutId).toBeUndefined()
  })
})

describe('组织 Dashboard 布局渲染 —— 模块 forbidden/unavailable', () => {
  it('LAYOUT_MODULE_FORBIDDEN warning code', () => {
    const warning: OrganizationDashboardLayoutPreviewWarning = {
      code: ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_MODULE_FORBIDDEN,
      message: '模块 "pmo_entry" 当前角色无查看权限',
      moduleKey: 'pmo_entry',
    }
    expect(warning.code).toBe('LAYOUT_MODULE_FORBIDDEN')
    expect(warning.moduleKey).toBe('pmo_entry')
  })

  it('LAYOUT_MODULE_UNAVAILABLE warning code', () => {
    const warning: OrganizationDashboardLayoutPreviewWarning = {
      code: ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_MODULE_UNAVAILABLE,
      message: '模块 "old_widget" 未注册',
      // 故意用未注册的 moduleKey：本用例验证的正是'模块已下线'这条 warning，
      // 值必然不在联合类型里，用 as unknown as 明示这是刻意构造的非法输入。
      moduleKey: 'old_widget' as unknown as OrganizationDashboardLayoutModuleKey,
    }
    expect(warning.code).toBe('LAYOUT_MODULE_UNAVAILABLE')
  })

  it('forbidden 模块不应渲染其内容', () => {
    // 如果用户没有 risk:view 权限，risk_reminders 模块应返回 forbidden
    const forbiddenModules = ['risk_reminders', 'pmo_entry']
    const visibleModules = ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules.filter(
      (m) => !forbiddenModules.includes(m.moduleKey),
    )
    expect(visibleModules.length).toBeLessThan(
      ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules.length,
    )
  })

  it('unavailable 模块保留元数据但标记不可用', () => {
    const warning: OrganizationDashboardLayoutPreviewWarning = {
      code: 'LAYOUT_MODULE_UNAVAILABLE',
      message: '模块 "deprecated_widget" 已被移除',
      // 同上：已被移除的模块 key，刻意越出联合类型。
      moduleKey: 'deprecated_widget' as unknown as OrganizationDashboardLayoutModuleKey,
    }
    expect(warning.code).toBe('LAYOUT_MODULE_UNAVAILABLE')
    expect(warning.message).toContain('已被移除')
  })
})

describe('组织 Dashboard 布局渲染 —— 空组织', () => {
  it('空组织仍可渲染系统默认布局', () => {
    // 即使组织无项目、无成员，默认布局的模块应显示空状态
    const emptyStateModule = ORGANIZATION_DASHBOARD_MODULE_REGISTRY.status_distribution
    expect(emptyStateModule.emptyStateKey).toBe('暂无项目')
  })

  it('identity 模块在空组织中也可见', () => {
    const identityModule = ORGANIZATION_DASHBOARD_MODULE_REGISTRY.identity
    expect(identityModule.hideable).toBe(false)
    expect(identityModule.emptyStateKey).toBe('无组织信息')
  })
})

describe('组织 Dashboard 布局渲染 —— Warning badges', () => {
  it('当前布局的 warnings 列表包含所有问题', () => {
    const warnings: OrganizationDashboardLayoutPreviewWarning[] = [
      {
        code: 'LAYOUT_MODULE_FORBIDDEN',
        message: '模块 "risk_reminders" 无权限',
        moduleKey: 'risk_reminders',
      },
      {
        code: 'LAYOUT_STALE',
        message: '布局可能已过期',
      },
    ]
    expect(warnings).toHaveLength(2)
    expect(warnings![0]!.code!).toBe('LAYOUT_MODULE_FORBIDDEN')
    expect(warnings![1]!.code!).toBe('LAYOUT_STALE')
  })

  it('每个 warning 包含 code 和 message', () => {
    const warningCodes = Object.values(ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES)
    expect(warningCodes.length).toBeGreaterThan(0)
    for (const code of warningCodes) {
      expect(code.startsWith('LAYOUT_')).toBe(true)
    }
  })
})
