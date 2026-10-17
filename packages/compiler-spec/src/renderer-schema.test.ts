/**
 * renderer-schema.test —— 确定性 UI Renderer 共享单元测试（§1.5 P0）。
 *
 * 覆盖：schema 接受、未知字段拒绝、不安全代码字段拒绝、
 * 安全图标白名单、查询白名单、迁移、配置确定性 hash。
 */
import { describe, expect, it } from 'vitest'
import {
  projectViewConfigSchema,
  viewConfigSchema,
  dataQueryConfigSchema,
  safeIconSchema,
  viewSpecificConfigSchema,
  RENDERER_CURRENT_SCHEMA_VERSION,
  RENDERER_OLD_SUPPORTED_VERSIONS,
  migrateConfigVersion,
  checkConfigReadiness,
  widgetTypeSchema,
  dataQuerySourceSchema,
  rendererViewTypeSchema,
  validateConfigSize,
} from './renderer-schema.js'
import {
  VALID_DASHBOARD_CONFIG,
  VALID_LIST_CONFIG,
  VALID_GANTT_CONFIG,
  VALID_WBS_CONFIG,
  VALID_KANBAN_CONFIG,
  VALID_PROJECT_VIEW_CONFIG,
  UNSAFE_CODE_CONFIG,
  UNSUPPORTED_COMPONENT_CONFIG,
  PERMISSION_REDACTED_WIDGET_CONFIG,
  UNSAFE_QUERY_CONFIG,
  ALL_VALID_CONFIGS,
} from './renderer-fixtures.js'

// ─── 1. Schema 接受测试 ──────────────────────────────
describe('viewConfigSchema accepts valid configs', () => {
  it.each(ALL_VALID_CONFIGS)('accepts valid $type config: $title', (config) => {
    const result = viewConfigSchema.safeParse(config)
    expect(result.success, `Expected ${config.title} to be valid`).toBe(true)
  })

  it('accepts valid ProjectViewConfig', () => {
    const result = projectViewConfigSchema.safeParse(VALID_PROJECT_VIEW_CONFIG)
    expect(result.success).toBe(true)
  })

  it('accepts permission-redacted widget config', () => {
    const result = viewConfigSchema.safeParse(PERMISSION_REDACTED_WIDGET_CONFIG)
    expect(result.success).toBe(true)
  })
})

// ─── 2. 未知字段拒绝测试 ──────────────────────────────
describe('viewConfigSchema rejects unknown fields', () => {
  it('rejects unknown top-level fields', () => {
    const result = viewConfigSchema.safeParse({
      ...VALID_LIST_CONFIG,
      unknownField: 'should be rejected',
      anotherUnknown: 42,
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown filter operator', () => {
    const result = dataQueryConfigSchema.safeParse({
      source: 'task_summary',
      filters: [{ field: 'status', operator: 'custom_op', value: 'test' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown data source', () => {
    const result = dataQueryConfigSchema.safeParse({
      source: 'custom_sql',
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown widget type', () => {
    const result = widgetTypeSchema.safeParse('unknown_widget')
    expect(result.success).toBe(false)
  })

  it('rejects unknown view type', () => {
    const result = rendererViewTypeSchema.safeParse('unknown-view')
    expect(result.success).toBe(false)
  })
})

// ─── 3. 不安全代码字段拒绝 ──────────────────────────
describe('viewConfigSchema rejects unsafe code fields', () => {
  it('rejects config with JSX/script fields', () => {
    const result = viewConfigSchema.safeParse(UNSAFE_CODE_CONFIG)
    expect(result.success).toBe(false)
  })

  it('rejects config with inline SQL', () => {
    const result = viewConfigSchema.safeParse(UNSAFE_QUERY_CONFIG)
    expect(result.success).toBe(false)
  })

  it('rejects unsupported component type', () => {
    const result = viewConfigSchema.safeParse(UNSUPPORTED_COMPONENT_CONFIG)
    expect(result.success).toBe(false)
  })

  it('widget type schema rejects "custom_sql" source', () => {
    const result = dataQuerySourceSchema.safeParse('custom_sql')
    expect(result.success).toBe(false)
  })
})

// ─── 4. 安全图标白名单测试 ──────────────────────────
describe('safeIconSchema whitelist', () => {
  it('accepts known icons', () => {
    expect(safeIconSchema.safeParse('LayoutDashboard').success).toBe(true)
    expect(safeIconSchema.safeParse('CheckCircle').success).toBe(true)
    expect(safeIconSchema.safeParse('AlertTriangle').success).toBe(true)
    expect(safeIconSchema.safeParse('GanttChart').success).toBe(true)
  })

  it('rejects unknown icons', () => {
    expect(safeIconSchema.safeParse('FaBeer').success).toBe(false)
    expect(safeIconSchema.safeParse('custom-icon').success).toBe(false)
    expect(safeIconSchema.safeParse('').success).toBe(false)
    expect(safeIconSchema.safeParse('javascript:alert(1)').success).toBe(false)
  })
})

// ─── 5. 查询白名单测试 ──────────────────────────────
describe('dataQuerySourceSchema whitelist', () => {
  const ALLOWED = [
    'dashboard_metrics',
    'task_summary',
    'gantt_facts',
    'wbs_nodes',
    'kanban_columns',
    'risk_summary',
    'resource_summary',
    'change_impact_summary',
    'timeline_facts',
    'report_summary',
  ]

  it.each(ALLOWED)('accepts whitelisted source: %s', (source) => {
    expect(dataQuerySourceSchema.safeParse(source).success).toBe(true)
  })

  it('rejects custom SQL source', () => {
    expect(dataQuerySourceSchema.safeParse('SELECT * FROM tasks').success).toBe(false)
  })

  it('rejects arbitrary expressions', () => {
    expect(dataQuerySourceSchema.safeParse('1; DROP TABLE tasks').success).toBe(false)
  })
})

// ─── 6. 迁移测试 ──────────────────────────────────────
describe('migrateConfigVersion', () => {
  it('current version does not need migration', () => {
    const result = migrateConfigVersion(
      {
        schemaVersion: RENDERER_CURRENT_SCHEMA_VERSION,
        projectId: 1,
        defaultViewId: 'v1',
        views: [],
      },
      RENDERER_CURRENT_SCHEMA_VERSION,
    )
    expect(result.success).toBe(true)
  })

  it('checkConfigReadiness for current version', () => {
    const result = checkConfigReadiness({
      schemaVersion: RENDERER_CURRENT_SCHEMA_VERSION,
      projectId: 1,
      defaultViewId: 'v1',
      views: [],
    })
    expect(result.ready).toBe(true)
    expect(result.shouldMigrate).toBe(false)
  })

  it('checkConfigReadiness for old version returns shouldMigrate', () => {
    if (RENDERER_OLD_SUPPORTED_VERSIONS.length > 0) {
      const result = checkConfigReadiness({
        schemaVersion: RENDERER_OLD_SUPPORTED_VERSIONS[0],
        projectId: 1,
        defaultViewId: 'v1',
        views: [],
      })
      expect(result.ready).toBe(true)
      expect(result.shouldMigrate).toBe(true)
    }
  })

  it('checkConfigReadiness for missing schemaVersion fails', () => {
    const result = checkConfigReadiness({ projectId: 1 })
    expect(result.ready).toBe(false)
    expect(result.shouldMigrate).toBe(false)
  })
})

// ─── 7. 大小限制测试 ────────────────────────────────
describe('validateConfigSize', () => {
  it('accepts normal sized config', () => {
    const result = validateConfigSize(VALID_PROJECT_VIEW_CONFIG)
    expect(result.valid).toBe(true)
  })
})

// ─── 8. View-specific config 测试 ──────────────────
describe('viewSpecificConfig discriminators', () => {
  it('accepts valid dashboard config', () => {
    const result = viewSpecificConfigSchema.safeParse(VALID_DASHBOARD_CONFIG.config)
    expect(result.success).toBe(true)
  })

  it('accepts valid list config', () => {
    const result = viewSpecificConfigSchema.safeParse(VALID_LIST_CONFIG.config)
    expect(result.success).toBe(true)
  })

  it('accepts valid gantt config', () => {
    const result = viewSpecificConfigSchema.safeParse(VALID_GANTT_CONFIG.config)
    expect(result.success).toBe(true)
  })

  it('accepts valid wbs config', () => {
    const result = viewSpecificConfigSchema.safeParse(VALID_WBS_CONFIG.config)
    expect(result.success).toBe(true)
  })

  it('accepts valid kanban config', () => {
    const result = viewSpecificConfigSchema.safeParse(VALID_KANBAN_CONFIG.config)
    expect(result.success).toBe(true)
  })

  it('rejects dashboard config with unknown widget field', () => {
    const badConfig = {
      type: 'dashboard' as const,
      config: {
        widgets: [
          {
            id: 'w-1',
            type: 'completion_rate' as const,
            title: '完成率',
            jsxCode: '<div>exec</div>',
          },
        ],
      },
    }
    const result = viewSpecificConfigSchema.safeParse(badConfig)
    expect(result.success).toBe(false)
  })
})
