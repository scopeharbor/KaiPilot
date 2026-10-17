/**
 * bi-report-template-library 契约测试 —— tasks §1.3
 *
 * 覆盖：
 *  - 跨端导入零运行时依赖
 *  - 模板标识与 warning code 稳定性
 *  - 5 个内置模板定义完整性
 *  - 纯函数确定性
 */
import { describe, it, expect } from 'vitest'
import {
  BI_TEMPLATE_IDS,
  BI_TEMPLATE_ID_VALUES,
  isBiTemplateId,
  BI_TEMPLATE_VERSIONS,
  BI_TEMPLATE_CATEGORIES,
  BI_TEMPLATE_SCENARIOS,
  BI_TEMPLATE_SOURCES,
  BI_DATASOURCE_KEYS,
  BI_DATASOURCE_KEY_VALUES,
  BI_TEMPLATE_METRIC_KEYS,
  BI_TEMPLATE_METRIC_KEY_VALUES,
  BI_TEMPLATE_DIMENSION_KEYS,
  BI_CHART_TYPES,
  BI_FRESHNESS_STATES,
  BI_TEMPLATE_WARNING_CODES,
  BI_REDACTION_STATES,
  BI_COPY_STATUSES,
  BI_TEMPLATE_AUDIT_EVENTS,
  isBuiltinTemplate,
  isPluginBiTemplateId,
  resolveBiTemplateSource,
  hasNewerBuiltinVersion,
  aggregateBiTemplateFreshness,
  getBlockingWarnings,
  hasBlockingWarnings,
  buildBiTemplateWarning,
  buildBiSourceFreshness,
  buildBiRedaction,
  type BiTemplateEntry,
} from './bi-report-template-library'

// ─── 零运行时依赖 ───────────────────────────────────────────────────────────

describe('BI 报表模板库共享契约 —— 零运行时依赖', () => {
  it('导入不依赖 AdonisJS、React、数据库或浏览器运行时', () => {
    // 能成功 import 即通过；若有任何运行时依赖会在 import 阶段失败
    expect(typeof BI_TEMPLATE_IDS).toBe('object')
  })

  it('所有枚举值在运行时可用', () => {
    expect(BI_TEMPLATE_ID_VALUES.length).toBe(5)
    expect(BI_DATASOURCE_KEY_VALUES.length).toBeGreaterThan(0)
    expect(BI_TEMPLATE_METRIC_KEY_VALUES.length).toBeGreaterThan(0)
  })
})

// ─── 模板标识稳定性 ─────────────────────────────────────────────────────────

describe('BI 模板标识与 warning code 稳定性', () => {
  it('5 个内置模板 ID 稳定不变', () => {
    expect(BI_TEMPLATE_IDS.PROJECT_EXECUTION_OVERVIEW).toBe('project_execution_overview')
    expect(BI_TEMPLATE_IDS.RESOURCE_UTILIZATION).toBe('resource_utilization')
    expect(BI_TEMPLATE_IDS.RISK_ANALYSIS).toBe('risk_analysis')
    expect(BI_TEMPLATE_IDS.MILESTONE_TRACKING).toBe('milestone_tracking')
    expect(BI_TEMPLATE_IDS.TEAM_PERFORMANCE).toBe('team_performance')
  })

  it('isBiTemplateId 守卫正确识别', () => {
    expect(isBiTemplateId('project_execution_overview')).toBe(true)
    expect(isBiTemplateId('resource_utilization')).toBe(true)
    expect(isBiTemplateId('invalid_template')).toBe(false)
    expect(isBiTemplateId('')).toBe(false)
  })

  it('模板版本初始化为 1', () => {
    for (const id of BI_TEMPLATE_ID_VALUES) {
      expect(BI_TEMPLATE_VERSIONS[id]).toBe(1)
    }
  })

  it('分类枚举值稳定', () => {
    expect(BI_TEMPLATE_CATEGORIES.EXECUTION).toBe('execution')
    expect(BI_TEMPLATE_CATEGORIES.RESOURCE).toBe('resource')
    expect(BI_TEMPLATE_CATEGORIES.RISK).toBe('risk')
    expect(BI_TEMPLATE_CATEGORIES.MILESTONE).toBe('milestone')
    expect(BI_TEMPLATE_CATEGORIES.PEOPLE).toBe('people')
  })

  it('场景枚举值稳定', () => {
    expect(BI_TEMPLATE_SCENARIOS.WEEKLY_REVIEW).toBe('weekly_review')
    expect(BI_TEMPLATE_SCENARIOS.RESOURCE_PLANNING).toBe('resource_planning')
    expect(BI_TEMPLATE_SCENARIOS.RISK_REVIEW).toBe('risk_review')
    expect(BI_TEMPLATE_SCENARIOS.PROGRESS_REVIEW).toBe('progress_review')
    expect(BI_TEMPLATE_SCENARIOS.PERFORMANCE_REVIEW).toBe('performance_review')
  })

  it('数据源键稳定', () => {
    expect(BI_DATASOURCE_KEYS.ORGANIZATION_DASHBOARD).toBe('organization_dashboard')
    expect(BI_DATASOURCE_KEYS.PMO_PORTFOLIO_DASHBOARD).toBe('pmo_portfolio_dashboard')
    expect(BI_DATASOURCE_KEYS.ORGANIZATION_RESOURCE_POOL).toBe('organization_resource_pool')
    expect(BI_DATASOURCE_KEYS.REPORT_V2_AGGREGATION).toBe('report_v2_aggregation')
  })

  it('指标键稳定', () => {
    expect(BI_TEMPLATE_METRIC_KEYS.PROJECT_PROGRESS).toBe('project_progress')
    expect(BI_TEMPLATE_METRIC_KEYS.RESOURCE_UTILIZATION_RATE).toBe('resource_utilization_rate')
    expect(BI_TEMPLATE_METRIC_KEYS.MILESTONE_COMPLETION_RATE).toBe('milestone_completion_rate')
    expect(BI_TEMPLATE_METRIC_KEYS.TEAM_TASK_COMPLETION_RATE).toBe('team_task_completion_rate')
  })

  it('维度键稳定', () => {
    expect(BI_TEMPLATE_DIMENSION_KEYS.PROJECT).toBe('project')
    expect(BI_TEMPLATE_DIMENSION_KEYS.TEAM).toBe('team')
    expect(BI_TEMPLATE_DIMENSION_KEYS.PERSON).toBe('person')
    expect(BI_TEMPLATE_DIMENSION_KEYS.RISK_LEVEL).toBe('risk_level')
  })

  it('图表类型稳定', () => {
    expect(BI_CHART_TYPES.BAR).toBe('bar')
    expect(BI_CHART_TYPES.LINE).toBe('line')
    expect(BI_CHART_TYPES.TABLE).toBe('table')
    expect(BI_CHART_TYPES.HEATMAP).toBe('heatmap')
  })

  it('warning code 稳定', () => {
    expect(BI_TEMPLATE_WARNING_CODES.DATASOURCE_UNAVAILABLE).toBe(
      'BI_TEMPLATE_DATASOURCE_UNAVAILABLE',
    )
    expect(BI_TEMPLATE_WARNING_CODES.PARTIAL_RESULT).toBe('BI_TEMPLATE_PARTIAL_RESULT')
    expect(BI_TEMPLATE_WARNING_CODES.DIMENSION_REDACTED).toBe('BI_TEMPLATE_DIMENSION_REDACTED')
    expect(BI_TEMPLATE_WARNING_CODES.COPY_OUTDATED).toBe('BI_TEMPLATE_COPY_OUTDATED')
  })

  it('脱敏状态稳定', () => {
    expect(BI_REDACTION_STATES.NONE).toBe('none')
    expect(BI_REDACTION_STATES.REDACTED).toBe('redacted')
    expect(BI_REDACTION_STATES.FORBIDDEN).toBe('forbidden')
  })

  it('副本状态稳定', () => {
    expect(BI_COPY_STATUSES.ACTIVE).toBe('active')
    expect(BI_COPY_STATUSES.ARCHIVED).toBe('archived')
  })

  it('审计事件类型稳定', () => {
    expect(BI_TEMPLATE_AUDIT_EVENTS.COPY_SAVED).toBe('bi_template.copy_saved')
    expect(BI_TEMPLATE_AUDIT_EVENTS.COPY_UPDATED).toBe('bi_template.copy_updated')
    expect(BI_TEMPLATE_AUDIT_EVENTS.COPY_ARCHIVED).toBe('bi_template.copy_archived')
    expect(BI_TEMPLATE_AUDIT_EVENTS.COPY_RESTORED).toBe('bi_template.copy_restored')
    expect(BI_TEMPLATE_AUDIT_EVENTS.INSTANTIATED).toBe('bi_template.instantiated')
  })
})

// ─── 纯函数测试 ─────────────────────────────────────────────────────────────

describe('BI 报表模板库纯函数', () => {
  describe('isBuiltinTemplate', () => {
    it('内置模板返回 true', () => {
      const entry = {
        templateId: 'project_execution_overview',
        version: 1,
        name: 'test',
        description: '',
        category: 'execution' as const,
        scenario: 'weekly_review' as const,
        builtin: true,
        isCopy: false,
      }
      expect(isBuiltinTemplate(entry)).toBe(true)
    })

    it('自定义副本返回 false', () => {
      const entry = {
        templateId: 'custom_1',
        version: 1,
        name: 'test',
        description: '',
        category: 'execution' as const,
        scenario: 'weekly_review' as const,
        builtin: false,
        isCopy: true,
        sourceTemplateId: 'project_execution_overview' as const,
        sourceVersion: 1,
      }
      expect(isBuiltinTemplate(entry)).toBe(false)
    })
  })

  describe('hasNewerBuiltinVersion', () => {
    it('sourceVersion < currentVersion 返回 true', () => {
      expect(hasNewerBuiltinVersion({ sourceVersion: 1 } as any, 2)).toBe(true)
    })

    it('sourceVersion >= currentVersion 返回 false', () => {
      expect(hasNewerBuiltinVersion({ sourceVersion: 2 } as any, 2)).toBe(false)
      expect(hasNewerBuiltinVersion({ sourceVersion: 3 } as any, 2)).toBe(false)
    })
  })

  describe('aggregateBiTemplateFreshness', () => {
    it('空数组返回 unavailable', () => {
      expect(aggregateBiTemplateFreshness([])).toBe(BI_FRESHNESS_STATES.UNAVAILABLE)
    })

    it('含 unavailable 时返回 unavailable', () => {
      const sources = [
        {
          dataSourceKey: 'organization_dashboard' as const,
          state: 'fresh' as const,
          lastUpdatedAt: null,
        },
        {
          dataSourceKey: 'bi_trend_analysis' as const,
          state: 'unavailable' as const,
          lastUpdatedAt: null,
        },
      ]
      expect(aggregateBiTemplateFreshness(sources)).toBe(BI_FRESHNESS_STATES.UNAVAILABLE)
    })

    it('含 stale 但不含 unavailable 时返回 stale', () => {
      const sources = [
        {
          dataSourceKey: 'organization_dashboard' as const,
          state: 'fresh' as const,
          lastUpdatedAt: null,
        },
        {
          dataSourceKey: 'bi_trend_analysis' as const,
          state: 'stale' as const,
          lastUpdatedAt: null,
        },
      ]
      expect(aggregateBiTemplateFreshness(sources)).toBe(BI_FRESHNESS_STATES.STALE)
    })

    it('全部 fresh 返回 fresh', () => {
      const sources = [
        {
          dataSourceKey: 'organization_dashboard' as const,
          state: 'fresh' as const,
          lastUpdatedAt: null,
        },
        {
          dataSourceKey: 'bi_trend_analysis' as const,
          state: 'fresh' as const,
          lastUpdatedAt: null,
        },
      ]
      expect(aggregateBiTemplateFreshness(sources)).toBe(BI_FRESHNESS_STATES.FRESH)
    })
  })

  describe('getBlockingWarnings', () => {
    it('只返回 critical 级别 warning', () => {
      const warnings = [
        buildBiTemplateWarning('BI_TEMPLATE_DATASOURCE_UNAVAILABLE', 'info', '信息'),
        buildBiTemplateWarning('BI_TEMPLATE_DATASOURCE_TIMEOUT', 'warning', '警告'),
        buildBiTemplateWarning('BI_TEMPLATE_PARTIAL_RESULT', 'critical', '阻塞'),
      ]
      const blocking = getBlockingWarnings(warnings)
      expect(blocking).toHaveLength(1)
      expect(blocking[0].code).toBe('BI_TEMPLATE_PARTIAL_RESULT')
    })

    it('无 critical warning 返回空数组', () => {
      const warnings = [
        buildBiTemplateWarning('BI_TEMPLATE_DATASOURCE_UNAVAILABLE', 'info', '信息'),
      ]
      expect(getBlockingWarnings(warnings)).toHaveLength(0)
    })
  })

  describe('hasBlockingWarnings', () => {
    it('存在 critical 返回 true', () => {
      const warnings = [buildBiTemplateWarning('BI_TEMPLATE_PARTIAL_RESULT', 'critical', '阻塞')]
      expect(hasBlockingWarnings(warnings)).toBe(true)
    })

    it('无 critical 返回 false', () => {
      expect(hasBlockingWarnings([])).toBe(false)
      expect(
        hasBlockingWarnings([
          buildBiTemplateWarning('BI_TEMPLATE_DATASOURCE_UNAVAILABLE', 'info', '信息'),
        ]),
      ).toBe(false)
    })
  })

  describe('buildBiTemplateWarning', () => {
    it('构建带 dataSourceKey 的 warning', () => {
      const w = buildBiTemplateWarning(
        'BI_TEMPLATE_DATASOURCE_UNAVAILABLE',
        'warning',
        '数据源不可用',
        'organization_dashboard',
      )
      expect(w.code).toBe('BI_TEMPLATE_DATASOURCE_UNAVAILABLE')
      expect(w.level).toBe('warning')
      expect(w.message).toBe('数据源不可用')
      expect(w.dataSourceKey).toBe('organization_dashboard')
    })

    it('构建不带 dataSourceKey 的 warning', () => {
      const w = buildBiTemplateWarning('BI_TEMPLATE_PARTIAL_RESULT', 'critical', '部分失败')
      expect(w.dataSourceKey).toBeUndefined()
    })
  })

  describe('buildBiSourceFreshness', () => {
    it('构建 freshness 对象', () => {
      const f = buildBiSourceFreshness('organization_dashboard', 'fresh', '2026-07-30T00:00:00Z')
      expect(f.dataSourceKey).toBe('organization_dashboard')
      expect(f.state).toBe('fresh')
      expect(f.lastUpdatedAt).toBe('2026-07-30T00:00:00Z')
    })
  })

  describe('buildBiRedaction', () => {
    it('构建脱敏信息', () => {
      const r = buildBiRedaction('person', 'redacted', '需个人级权限')
      expect(r.dimensionKey).toBe('person')
      expect(r.state).toBe('redacted')
      expect(r.reason).toBe('需个人级权限')
    })
  })
})

// ─── 5 个内置模板定义完整性（结构校验） ──────────────────────────────────────

describe('5 个内置 BI 模板定义完整性', () => {
  // 这些模板的实际定义在服务端注册表（tasks 2.1），此处只做契约结构校验
  const requiredTemplateIds = [
    'project_execution_overview',
    'resource_utilization',
    'risk_analysis',
    'milestone_tracking',
    'team_performance',
  ]

  it('BI_TEMPLATE_IDS 包含全部 5 个模板', () => {
    const ids = Object.values(BI_TEMPLATE_IDS)
    for (const id of requiredTemplateIds) {
      expect(ids).toContain(id)
    }
    expect(ids).toHaveLength(5)
  })

  it('每个内置模板有对应的分类映射', () => {
    // 验证分类和场景常量已被定义（实际映射在注册表中）
    expect(Object.keys(BI_TEMPLATE_CATEGORIES)).toHaveLength(5)
    expect(Object.keys(BI_TEMPLATE_SCENARIOS)).toHaveLength(5)
  })
})

// ─── V3 模板来源与插件包扩展测试 ─────────────────────────────────────────────

describe('V3 模板来源与插件包扩展', () => {
  it('BI_TEMPLATE_SOURCES 包含 3 种来源枚举', () => {
    expect(BI_TEMPLATE_SOURCES).toEqual(['builtin', 'organization-copy', 'plugin'])
  })

  it('isPluginBiTemplateId 正确判定命名空间', () => {
    expect(isPluginBiTemplateId('ptpl_pilot_weekly')).toBe(true)
    expect(isPluginBiTemplateId('project_execution_overview')).toBe(false)
    expect(isPluginBiTemplateId('copy_123')).toBe(false)
  })

  it('resolveBiTemplateSource 正确路由三分支', () => {
    expect(resolveBiTemplateSource('project_execution_overview')).toBe('builtin')
    expect(resolveBiTemplateSource('copy_42')).toBe('organization-copy')
    expect(resolveBiTemplateSource('ptpl_pilot_delivery')).toBe('plugin')
  })

  it('BiTemplateEntry 兼容缺省 source 字段的旧数据', () => {
    const legacyEntry: BiTemplateEntry = {
      templateId: 'project_execution_overview',
      version: 1,
      name: '项目执行概览',
      description: '周会汇报',
      category: 'execution',
      scenario: 'weekly_review',
      builtin: true,
      isCopy: false,
    }
    expect(legacyEntry.source).toBeUndefined()
    expect(legacyEntry.pluginRef).toBeUndefined()
    expect(isBuiltinTemplate(legacyEntry)).toBe(true)
  })

  it('BiTemplateEntry 支持插件贡献模板元数据', () => {
    const pluginEntry: BiTemplateEntry = {
      templateId: 'ptpl_pilot_delivery',
      version: 1,
      name: '交付治理全景报告',
      description: '插件贡献',
      category: 'execution',
      scenario: 'weekly_review',
      builtin: false,
      isCopy: false,
      source: 'plugin',
      pluginRef: {
        pluginId: 'com.aiproj.pilot-template-pack',
        pluginVersion: '1.0.0',
        displayName: 'Pilot 模板包',
      },
    }
    expect(pluginEntry.source).toBe('plugin')
    expect(pluginEntry.pluginRef?.pluginId).toBe('com.aiproj.pilot-template-pack')
    expect(resolveBiTemplateSource(pluginEntry.templateId)).toBe('plugin')
  })
})
