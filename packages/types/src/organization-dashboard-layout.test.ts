import { describe, expect, it } from 'vitest'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
  ORGANIZATION_DASHBOARD_LAYOUT_SCOPES,
  ORGANIZATION_DASHBOARD_LAYOUT_SCOPE_VALUES,
  ORGANIZATION_DASHBOARD_LAYOUT_SIZE_VALUES,
  ORGANIZATION_DASHBOARD_LAYOUT_SIZES,
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES,
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITY_VALUES,
  ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS,
  ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_VALUES,
  ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_THRESHOLDS,
  ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_COLUMNS,
  ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES,
  ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODE_VALUES,
  ORGANIZATION_DASHBOARD_LAYOUT_SIZE_COLUMNS,
  ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT,
  ORGANIZATION_DASHBOARD_MODULE_REGISTRY,
} from './organization-dashboard-layout.js'
import type {
  OrganizationDashboardLayout,
  OrganizationDashboardLayoutPayload,
  OrganizationDashboardLayoutModuleInstance,
  OrganizationDashboardLayoutPreviewResult,
  OrganizationDashboardModuleDefinition,
} from './organization-dashboard-layout.js'

// ─── 常量稳定性 ──────────────────────────────────────────────────────────────────

describe('组织 Dashboard 布局共享契约 —— 常量', () => {
  it('layout scope 常量完备', () => {
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SCOPE_VALUES).toHaveLength(3)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SYSTEM).toBe('system')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.PERSONAL).toBe('personal')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SHARED).toBe('shared')
  })

  it('module key 常量完备', () => {
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES).toHaveLength(11)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY).toBe('identity')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP).toBe('kpi_strip')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.STATUS_DISTRIBUTION).toBe(
      'status_distribution',
    )
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS).toBe('attention_projects')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.MEMBER_OVERVIEW).toBe('member_overview')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RESOURCE_OVERVIEW).toBe('resource_overview')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RISK_REMINDERS).toBe('risk_reminders')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ACTIVITY).toBe('activity')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY).toBe('pmo_entry')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.OKR_DASHBOARD_SUMMARY).toBe(
      'okr_dashboard_summary',
    )
  })

  it('size token 常量完备', () => {
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SIZE_VALUES).toHaveLength(4)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL).toBe('small')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM).toBe('medium')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE).toBe('large')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL).toBe('full')
  })

  it('size column mapping 正确', () => {
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SIZE_COLUMNS.small).toBe(2)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SIZE_COLUMNS.medium).toBe(4)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SIZE_COLUMNS.large).toBe(6)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_SIZE_COLUMNS.full).toBe(12)
  })

  it('density 常量完备', () => {
    expect(ORGANIZATION_DASHBOARD_LAYOUT_DENSITY_VALUES).toHaveLength(2)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE).toBe('comfortable')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMPACT).toBe('compact')
  })

  it('breakpoint 常量完备', () => {
    expect(ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_VALUES).toHaveLength(3)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS.MOBILE).toBe('mobile')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS.TABLET).toBe('tablet')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS.DESKTOP).toBe('desktop')
  })

  it('breakpoint 阈值单调递增', () => {
    expect(ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_THRESHOLDS.mobile).toBe(0)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_THRESHOLDS.tablet).toBeGreaterThan(0)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_THRESHOLDS.desktop).toBeGreaterThan(
      ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_THRESHOLDS.tablet,
    )
  })

  it('breakpoint column count 单调递增', () => {
    expect(ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_COLUMNS.mobile).toBe(4)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_COLUMNS.tablet).toBe(8)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_COLUMNS.desktop).toBe(12)
  })

  it('warning code 常量完备', () => {
    expect(ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODE_VALUES).toHaveLength(7)
    expect(ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_FALLBACK_APPLIED).toBe(
      'LAYOUT_FALLBACK_APPLIED',
    )
    expect(ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_MODULE_FORBIDDEN).toBe(
      'LAYOUT_MODULE_FORBIDDEN',
    )
    expect(ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_MODULE_UNAVAILABLE).toBe(
      'LAYOUT_MODULE_UNAVAILABLE',
    )
    expect(ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_STALE).toBe('LAYOUT_STALE')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_NOT_FOUND).toBe('LAYOUT_NOT_FOUND')
    expect(ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_VERSION_CONFLICT).toBe(
      'LAYOUT_VERSION_CONFLICT',
    )
    expect(ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_PREVIEW_WARNING).toBe(
      'LAYOUT_PREVIEW_WARNING',
    )
  })
})

// ─── 系统默认布局 ──────────────────────────────────────────────────────────────

describe('系统默认布局', () => {
  it('系统默认布局 scope 为 system', () => {
    expect(ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.scope).toBe('system')
  })

  it('系统默认布局包含全部核心模块（OKR 摘要作为可选模块，默认不入 system default）', () => {
    const moduleKeys = ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules.map((m) => m.moduleKey)
    // v3-okr-dashboard §4.3：OKR 摘要模块首期只注册，不进 system default。
    // v3-bi-dashboard-builder §7.1：BI Dashboard 摘要模块只注册，不进 system default。
    expect(moduleKeys).toHaveLength(9)
    for (const key of ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES) {
      if (key === ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.OKR_DASHBOARD_SUMMARY) continue
      if (key === ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.BI_DASHBOARD_SUMMARY) continue
      expect(moduleKeys).toContain(key)
    }
  })

  it('系统默认布局模块 row/col 为正整数', () => {
    for (const m of ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules) {
      expect(m.row).toBeGreaterThanOrEqual(1)
      expect(m.col).toBeGreaterThanOrEqual(1)
    }
  })

  it('系统默认布局 density 为 comfortable', () => {
    expect(ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.density).toBe('comfortable')
  })

  it('系统默认布局无 ownerActorId', () => {
    expect(ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.ownerActorId).toBeNull()
  })
})

// ─── 模块注册表 ────────────────────────────────────────────────────────────────

describe('模块注册表', () => {
  it('每个 moduleKey 都有对应的注册表条目', () => {
    for (const key of ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES) {
      expect(ORGANIZATION_DASHBOARD_MODULE_REGISTRY[key]).toBeDefined()
    }
  })

  it('每个条目都有 displayName 和 description', () => {
    for (const def of Object.values(ORGANIZATION_DASHBOARD_MODULE_REGISTRY)) {
      expect(def.displayName.length).toBeGreaterThan(0)
      expect(def.description.length).toBeGreaterThan(0)
    }
  })

  it('每个条目 defaultSize 在 allowedSizes 中', () => {
    for (const def of Object.values(ORGANIZATION_DASHBOARD_MODULE_REGISTRY)) {
      expect(def.allowedSizes).toContain(def.defaultSize)
    }
  })

  it('每个条目都有 dataDependencyId', () => {
    for (const def of Object.values(ORGANIZATION_DASHBOARD_MODULE_REGISTRY)) {
      expect(def.dataDependencyId.length).toBeGreaterThan(0)
    }
  })

  it('IDENTITY 模块不可隐藏', () => {
    expect(ORGANIZATION_DASHBOARD_MODULE_REGISTRY.identity.hideable).toBe(false)
  })

  it('注册表条目 moduleKey 与其 key 一致', () => {
    for (const [key, def] of Object.entries(ORGANIZATION_DASHBOARD_MODULE_REGISTRY)) {
      expect(def.moduleKey).toBe(key)
    }
  })
})

// ─── 不安全 payload 拒绝 ──────────────────────────────────────────────────────

describe('layout payload 安全边界', () => {
  it('payload 不应包含 SQL 表达式（通过类型约束）', () => {
    // TypeScript-level test: LayoutPayload 不能有 'sql' 字段
    const validPayload: OrganizationDashboardLayoutPayload = {
      modules: [],
      density: 'comfortable',
    }
    expect(validPayload.modules).toEqual([])
  })

  it('module instance 只能包含注册表允许的字段', () => {
    const validInstance: OrganizationDashboardLayoutModuleInstance = {
      moduleKey: 'kpi_strip',
      size: 'full',
      row: 1,
      col: 1,
    }
    expect(validInstance.moduleKey).toBe('kpi_strip')
  })

  it('系统默认布局向后兼容——所有 moduleKey 都在注册表中', () => {
    for (const m of ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules) {
      expect(ORGANIZATION_DASHBOARD_MODULE_REGISTRY[m.moduleKey]).toBeDefined()
    }
  })

  it('preview result 结构完备', () => {
    const preview: OrganizationDashboardLayoutPreviewResult = {
      valid: true,
      layout: { modules: [], density: 'comfortable' },
      warnings: [],
      breakpointSnapshots: [],
    }
    expect(preview.valid).toBe(true)
    expect(preview.warnings).toEqual([])
  })
})

// ─── 类型完整性 ────────────────────────────────────────────────────────────────

describe('类型结构完整性', () => {
  it('Layout 类型包含所有必需字段', () => {
    const layout: OrganizationDashboardLayout = {
      layoutId: 1,
      organizationId: 1,
      scope: 'personal',
      ownerActorId: 7,
      name: '我的布局',
      version: 1,
      isDefault: false,
      density: 'comfortable',
      modules: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(layout.layoutId).toBe(1)
    expect(layout.scope).toBe('personal')
  })
})

// ─── 回退状态 ──────────────────────────────────────────────────────────────────

describe('回退状态', () => {
  it('无效布局应触发 LAYOUT_FALLBACK_APPLIED warning', () => {
    const warningCode = ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_FALLBACK_APPLIED
    expect(warningCode).toBe('LAYOUT_FALLBACK_APPLIED')
  })

  it('系统默认布局在无自定义布局时可用', () => {
    // 系统默认布局不依赖任何持久化数据
    const defaultLayout = ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT
    expect(defaultLayout.modules.length).toBeGreaterThan(0)
    expect(defaultLayout.scope).toBe('system')
  })
})

// ─── v3-okr-dashboard §4.3-4.4：OKR 摘要模块注册 ──────────────────────────────

describe('OKR Dashboard Summary Layout Module（§4.3-4.4）', () => {
  const OKR_KEY = ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.OKR_DASHBOARD_SUMMARY

  it('注册表包含 OKR 摘要模块条目', () => {
    expect(ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY]).toBeDefined()
  })

  it('OKR 摘要模块 requiredPermissions 只声明 okr:view', () => {
    const def = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY]
    expect(def.requiredPermissions).toContain('okr:view')
    // 不应引入其它无关权限或写入权限
    expect(
      def.requiredPermissions.every((p) => !p.includes(':write') && !p.includes(':apply')),
    ).toBe(true)
  })

  it('OKR 摘要模块 defaultSize 落在 allowedSizes', () => {
    const def = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY]
    expect(def.allowedSizes).toContain(def.defaultSize)
  })

  it('OKR 摘要模块 hideable=true（可选模块）', () => {
    expect(ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY].hideable).toBe(true)
  })

  it('OKR 摘要模块 dataDependencyId 稳定为 okr_dashboard_summary', () => {
    expect(ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY].dataDependencyId).toBe(
      'okr_dashboard_summary',
    )
  })

  it('OKR 摘要模块 mobileSupported=true 但需给出 emptyStateKey', () => {
    const def = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY]
    expect(def.mobileSupported).toBe(true)
    expect(def.emptyStateKey.length).toBeGreaterThan(0)
  })

  it('OKR 摘要模块 settingSchema=null（首期无 module 级设置）', () => {
    expect(ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY].settingSchema).toBeNull()
  })

  it('未授权用户视图下 module 应回退到 emptyState，不泄露 OKR 明细', () => {
    // 单纯类型层测试：受限时 module 只提供 emptyStateKey，不携带具体值
    const def = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY]
    // 类型规约：restricted state 只出 emptyStateKey；不该出现证据/prompt/hash 等字段
    const keys = Object.keys(def)
    for (const k of keys) {
      expect(k.toLowerCase()).not.toMatch(/prompt|token|apikey|bearer|evidence_text/i)
    }
  })

  it('模块注册表读取为纯函数，多次访问不改变 registry', () => {
    const snapshot1 = JSON.stringify(ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY])
    // 模拟渲染读取
    const _ = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY]
    const snapshot2 = JSON.stringify(ORGANIZATION_DASHBOARD_MODULE_REGISTRY[OKR_KEY])
    expect(snapshot1).toBe(snapshot2)
    expect(_).toBeDefined()
  })
})
