// @aiproj/types —— BI 自定义报表构建器共享契约测试。
// v3-bi-custom-report-builder §1.5：schema 稳定性、非法 payload、warning code、
// scope/visibility、version、sourceHash 和 preview status 测试。

import { describe, it, expect } from 'vitest'
import {
  BI_CUSTOM_REPORT_CONTRACT_VERSION,
  BI_CUSTOM_REPORT_DATA_SOURCE_KEYS,
  BI_CUSTOM_REPORT_DATA_SOURCE_KEY_VALUES,
  BI_CUSTOM_REPORT_FIELD_KEYS,
  BI_CUSTOM_REPORT_FIELD_KEY_VALUES,
  BI_CUSTOM_REPORT_FILTER_OPERATORS,
  BI_CUSTOM_REPORT_FILTER_OPERATOR_VALUES,
  BI_CUSTOM_REPORT_AGGREGATORS,
  BI_CUSTOM_REPORT_AGGREGATOR_VALUES,
  BI_CUSTOM_REPORT_SORT_DIRECTIONS,
  BI_CUSTOM_REPORT_VISUALIZATION_TYPES,
  BI_CUSTOM_REPORT_VISUALIZATION_TYPE_VALUES,
  BI_CUSTOM_REPORT_SCOPES,
  BI_CUSTOM_REPORT_SCOPE_VALUES,
  BI_CUSTOM_REPORT_VISIBILITY,
  BI_CUSTOM_REPORT_VISIBILITY_VALUES,
  BI_CUSTOM_REPORT_WARNING_CODES,
  BI_CUSTOM_REPORT_WARNING_CODE_VALUES,
  BI_CUSTOM_REPORT_WARNING_LEVELS,
  BI_CUSTOM_REPORT_PREVIEW_STATUS,
  BI_CUSTOM_REPORT_AUDIT_ACTIONS,
  BI_CUSTOM_REPORT_LIMITS,
  computeBiCustomReportDefinitionHash,
  isBlockingWarningCode,
  isBiCustomReportPreviewSaveable,
  redactBiCustomReportEvidence,
  buildBiCustomReportWarning,
} from './bi-custom-report-builder'
import type {
  BiCustomReportDataSourceKey,
  BiCustomReportFieldKey,
  BiCustomReportFilterOperator,
  BiCustomReportAggregator,
  BiCustomReportVisualizationType,
  BiCustomReportScope,
  BiCustomReportVisibility,
  BiCustomReportWarningCode,
  BiCustomReportWarningLevel,
  BiCustomReportPreviewStatus,
  BiCustomReportFilter,
  BiCustomReportGroup,
  BiCustomReportSort,
  BiCustomReportVisualization,
  BiCustomReportLayout,
  BiCustomReportDataSourceRef,
  BiCustomReportDefinition,
  BiCustomReportPreviewResult,
  BiCustomReportWarning,
  BiCustomReportFreshness,
  BiCustomReportEvidenceRef,
  BiCustomReportAuditPayload,
} from './bi-custom-report-builder'

// ─── Schema 稳定性 ─────────────────────────────────────────────────────────

describe('BI Custom Report Builder — 共享契约 schema 稳定性', () => {
  it('BI_CUSTOM_REPORT_CONTRACT_VERSION 不变', () => {
    expect(BI_CUSTOM_REPORT_CONTRACT_VERSION).toBe('bi-custom-report-v1')
  })

  it('DATA_SOURCE_KEYS 包含预期键', () => {
    expect(BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.TASK_SUMMARY).toBe('task_summary')
    expect(BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.RISK_SUMMARY).toBe('risk_summary')
    expect(BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.BI_TREND_SERIES).toBe('bi_trend_series')
    expect(BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.PMO_PORTFOLIO).toBe('pmo_portfolio')
  })

  it('DATA_SOURCE_KEY_VALUES 是只读数组', () => {
    expect(Array.isArray(BI_CUSTOM_REPORT_DATA_SOURCE_KEY_VALUES)).toBe(true)
    expect(BI_CUSTOM_REPORT_DATA_SOURCE_KEY_VALUES.length).toBeGreaterThan(10)
  })

  it('FIELD_KEYS 包含预期键', () => {
    expect(BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME).toBe('project_name')
    expect(BI_CUSTOM_REPORT_FIELD_KEYS.TASK_COUNT).toBe('task_count')
    expect(BI_CUSTOM_REPORT_FIELD_KEYS.RISK_LEVEL).toBe('risk_level')
    expect(BI_CUSTOM_REPORT_FIELD_KEYS.RESOURCE_LOAD).toBe('resource_load')
    expect(BI_CUSTOM_REPORT_FIELD_KEYS.OKR_PROGRESS_PCT).toBe('okr_progress_pct')
    expect(BI_CUSTOM_REPORT_FIELD_KEYS.PMO_SCORE).toBe('pmo_score')
    expect(BI_CUSTOM_REPORT_FIELD_KEYS.TREND_DIRECTION).toBe('trend_direction')
    expect(BI_CUSTOM_REPORT_FIELD_KEYS.HEATMAP_CELL_VALUE).toBe('heatmap_cell_value')
  })

  it('FILTER_OPERATORS 包含标准操作符', () => {
    expect(BI_CUSTOM_REPORT_FILTER_OPERATORS.EQ).toBe('eq')
    expect(BI_CUSTOM_REPORT_FILTER_OPERATORS.IN).toBe('in')
    expect(BI_CUSTOM_REPORT_FILTER_OPERATORS.BETWEEN).toBe('between')
  })

  it('AGGREGATORS 包含标准聚合器', () => {
    expect(BI_CUSTOM_REPORT_AGGREGATORS.COUNT).toBe('count')
    expect(BI_CUSTOM_REPORT_AGGREGATORS.SUM).toBe('sum')
    expect(BI_CUSTOM_REPORT_AGGREGATORS.MEDIAN).toBe('median')
  })

  it('VISUALIZATION_TYPES 包含六类图表', () => {
    expect(BI_CUSTOM_REPORT_VISUALIZATION_TYPES.TABLE).toBe('table')
    expect(BI_CUSTOM_REPORT_VISUALIZATION_TYPES.METRIC_CARD).toBe('metric_card')
    expect(BI_CUSTOM_REPORT_VISUALIZATION_TYPES.LINE).toBe('line')
    expect(BI_CUSTOM_REPORT_VISUALIZATION_TYPES.BAR).toBe('bar')
    expect(BI_CUSTOM_REPORT_VISUALIZATION_TYPES.STACKED_BAR).toBe('stacked_bar')
    expect(BI_CUSTOM_REPORT_VISUALIZATION_TYPES.HEATMAP).toBe('heatmap')
    expect(BI_CUSTOM_REPORT_VISUALIZATION_TYPE_VALUES.length).toBe(6)
  })

  it('SCOPES 包含三个级别', () => {
    expect(BI_CUSTOM_REPORT_SCOPES.ORGANIZATION).toBe('organization')
    expect(BI_CUSTOM_REPORT_SCOPES.PORTFOLIO).toBe('portfolio')
    expect(BI_CUSTOM_REPORT_SCOPES.PROJECT).toBe('project')
    expect(BI_CUSTOM_REPORT_SCOPE_VALUES.length).toBe(3)
  })

  it('VISIBILITY 包含两个值', () => {
    expect(BI_CUSTOM_REPORT_VISIBILITY.PERSONAL).toBe('personal')
    expect(BI_CUSTOM_REPORT_VISIBILITY.SHARED).toBe('shared')
    expect(BI_CUSTOM_REPORT_VISIBILITY_VALUES.length).toBe(2)
  })

  it('WARNING_CODES 包含 blocking 和非 blocking', () => {
    expect(BI_CUSTOM_REPORT_WARNING_CODES.REQUIRED_DATASOURCE_UNAVAILABLE).toBeDefined()
    expect(BI_CUSTOM_REPORT_WARNING_CODES.STALE_DATA).toBeDefined()
    expect(BI_CUSTOM_REPORT_WARNING_CODES.AI_UNAVAILABLE).toBeDefined()
    expect(BI_CUSTOM_REPORT_WARNING_CODE_VALUES.length).toBeGreaterThan(10)
  })

  it('WARNING_LEVELS 包含三个级别', () => {
    expect(BI_CUSTOM_REPORT_WARNING_LEVELS.INFO).toBe('info')
    expect(BI_CUSTOM_REPORT_WARNING_LEVELS.WARNING).toBe('warning')
    expect(BI_CUSTOM_REPORT_WARNING_LEVELS.BLOCKING).toBe('blocking')
  })

  it('PREVIEW_STATUS 包含三个值', () => {
    expect(BI_CUSTOM_REPORT_PREVIEW_STATUS.READY).toBe('ready')
    expect(BI_CUSTOM_REPORT_PREVIEW_STATUS.BLOCKED).toBe('blocked')
    expect(BI_CUSTOM_REPORT_PREVIEW_STATUS.PARTIAL).toBe('partial')
  })

  it('AUDIT_ACTIONS 包含预期动作', () => {
    expect(BI_CUSTOM_REPORT_AUDIT_ACTIONS.CREATE).toBe('bi_custom_report.create')
    expect(BI_CUSTOM_REPORT_AUDIT_ACTIONS.UPDATE).toBe('bi_custom_report.update')
    expect(BI_CUSTOM_REPORT_AUDIT_ACTIONS.COPY).toBe('bi_custom_report.copy')
    expect(BI_CUSTOM_REPORT_AUDIT_ACTIONS.ARCHIVE).toBe('bi_custom_report.archive')
    expect(BI_CUSTOM_REPORT_AUDIT_ACTIONS.RESTORE).toBe('bi_custom_report.restore')
  })

  it('LIMITS 包含合理边界值', () => {
    expect(BI_CUSTOM_REPORT_LIMITS.MAX_DATA_SOURCES).toBe(5)
    expect(BI_CUSTOM_REPORT_LIMITS.MAX_FIELDS).toBe(30)
    expect(BI_CUSTOM_REPORT_LIMITS.MAX_FILTERS).toBe(15)
    expect(BI_CUSTOM_REPORT_LIMITS.MAX_VISUALIZATIONS).toBe(6)
    expect(BI_CUSTOM_REPORT_LIMITS.MAX_PAYLOAD_BYTES).toBe(65536)
    expect(BI_CUSTOM_REPORT_LIMITS.PREVIEW_TIMEOUT_MS).toBe(15000)
    expect(BI_CUSTOM_REPORT_LIMITS.PREVIEW_MAX_ROWS).toBe(1000)
  })
})

// ─── 纯函数 ────────────────────────────────────────────────────────────────

describe('BI Custom Report Builder — 纯函数', () => {
  describe('computeBiCustomReportDefinitionHash', () => {
    it('相同定义产生相同 hash', () => {
      const def = {
        dataSources: [{ sourceKey: 'task_summary' }, { sourceKey: 'risk_summary' }],
        fields: ['task_count', 'risk_level'],
        filters: [{ fieldKey: 'task_count', operator: 'gt' as const, value: 5 }],
        groups: [{ fieldKey: 'project_name' }],
        sorts: [{ fieldKey: 'task_count', direction: 'desc' as const }],
        visualizations: [{ type: 'table' as const }],
      }
      const h1 = computeBiCustomReportDefinitionHash(def)
      const h2 = computeBiCustomReportDefinitionHash(def)
      expect(h1).toBe(h2)
      expect(h1).toMatch(/^bh_/)
    })

    it('不同定义产生不同 hash', () => {
      const def1 = {
        dataSources: [{ sourceKey: 'task_summary' }],
        fields: ['task_count'],
        filters: [],
        groups: [],
        sorts: [],
        visualizations: [{ type: 'table' as const }],
      }
      const def2 = {
        dataSources: [{ sourceKey: 'risk_summary' }],
        fields: ['risk_level'],
        filters: [],
        groups: [],
        sorts: [],
        visualizations: [{ type: 'line' as const }],
      }
      expect(computeBiCustomReportDefinitionHash(def1)).not.toBe(
        computeBiCustomReportDefinitionHash(def2),
      )
    })

    it('字段顺序不影响 hash', () => {
      const def1 = {
        dataSources: [{ sourceKey: 'task_summary' }, { sourceKey: 'risk_summary' }],
        fields: ['task_count', 'risk_level'],
        filters: [],
        groups: [],
        sorts: [],
        visualizations: [{ type: 'table' as const }],
      }
      const def2 = {
        dataSources: [{ sourceKey: 'risk_summary' }, { sourceKey: 'task_summary' }],
        fields: ['risk_level', 'task_count'],
        filters: [],
        groups: [],
        sorts: [],
        visualizations: [{ type: 'table' as const }],
      }
      expect(computeBiCustomReportDefinitionHash(def1)).toBe(
        computeBiCustomReportDefinitionHash(def2),
      )
    })
  })

  describe('isBlockingWarningCode', () => {
    it('必需数据源不可用是 blocking', () => {
      expect(
        isBlockingWarningCode(BI_CUSTOM_REPORT_WARNING_CODES.REQUIRED_DATASOURCE_UNAVAILABLE),
      ).toBe(true)
    })

    it('必需字段被禁止是 blocking', () => {
      expect(isBlockingWarningCode(BI_CUSTOM_REPORT_WARNING_CODES.REQUIRED_FIELD_FORBIDDEN)).toBe(
        true,
      )
    })

    it('复杂度超限是 blocking', () => {
      expect(isBlockingWarningCode(BI_CUSTOM_REPORT_WARNING_CODES.COMPLEXITY_EXCEEDED)).toBe(true)
    })

    it('超时是 blocking', () => {
      expect(isBlockingWarningCode(BI_CUSTOM_REPORT_WARNING_CODES.TIMEOUT)).toBe(true)
    })

    it('权限拒绝是 blocking', () => {
      expect(isBlockingWarningCode(BI_CUSTOM_REPORT_WARNING_CODES.PERMISSION_DENIED_SOURCE)).toBe(
        true,
      )
    })

    it('可选数据源不可用不是 blocking', () => {
      expect(
        isBlockingWarningCode(BI_CUSTOM_REPORT_WARNING_CODES.OPTIONAL_DATASOURCE_UNAVAILABLE),
      ).toBe(false)
    })

    it('stale data 不是 blocking', () => {
      expect(isBlockingWarningCode(BI_CUSTOM_REPORT_WARNING_CODES.STALE_DATA)).toBe(false)
    })
  })

  describe('isBiCustomReportPreviewSaveable', () => {
    it('未阻止且状态 ready 时可保存', () => {
      expect(
        isBiCustomReportPreviewSaveable({
          status: 'ready',
          definitionHash: 'bh_abc',
          rows: [],
          series: [],
          cards: [],
          warnings: [],
          freshness: { generatedAt: new Date().toISOString(), status: 'fresh' },
          sourceHashes: {},
          blocked: false,
          blockedReasons: [],
          evidenceRefs: [],
          generatedAt: new Date().toISOString(),
        }),
      ).toBe(true)
    })

    it('blocked 时不可保存', () => {
      expect(
        isBiCustomReportPreviewSaveable({
          status: 'blocked',
          definitionHash: 'bh_abc',
          rows: [],
          series: [],
          cards: [],
          warnings: [],
          freshness: { generatedAt: new Date().toISOString(), status: 'fresh' },
          sourceHashes: {},
          blocked: true,
          blockedReasons: ['必需数据源不可用'],
          evidenceRefs: [],
          generatedAt: new Date().toISOString(),
        }),
      ).toBe(false)
    })
  })

  describe('redactBiCustomReportEvidence', () => {
    it('已授权的 evidence 不变', () => {
      const ref: BiCustomReportEvidenceRef = {
        sourceKey: 'task_summary',
        sourceHash: 'abc123',
        entityType: 'project',
        entityId: 1,
        summary: '项目A进度90%',
        authorized: true,
      }
      const result = redactBiCustomReportEvidence(ref)
      expect(result).toEqual(ref)
    })

    it('未授权的 evidence 被脱敏', () => {
      const ref: BiCustomReportEvidenceRef = {
        sourceKey: 'risk_summary',
        sourceHash: 'xyz789',
        entityType: 'risk',
        entityId: 42,
        summary: '高风险项目',
        authorized: false,
      }
      const result = redactBiCustomReportEvidence(ref)
      expect(result.sourceHash).toBe('<redacted>')
      expect(result.entityId).toBe(0)
      expect(result.summary).toBe('[无权访问]')
      expect(result.authorized).toBe(false)
    })
  })

  describe('buildBiCustomReportWarning', () => {
    it('构建完整 warning', () => {
      const w = buildBiCustomReportWarning(
        BI_CUSTOM_REPORT_WARNING_CODES.STALE_DATA,
        'warning',
        '数据已过期',
        { sourceKey: 'task_summary', fieldKey: 'task_count' },
      )
      expect(w.code).toBe(BI_CUSTOM_REPORT_WARNING_CODES.STALE_DATA)
      expect(w.level).toBe('warning')
      expect(w.message).toBe('数据已过期')
      expect(w.sourceKey).toBe('task_summary')
      expect(w.fieldKey).toBe('task_count')
    })

    it('构建最简 warning', () => {
      const w = buildBiCustomReportWarning(
        BI_CUSTOM_REPORT_WARNING_CODES.EMPTY_RESULT,
        'info',
        '空结果',
      )
      expect(w.code).toBe(BI_CUSTOM_REPORT_WARNING_CODES.EMPTY_RESULT)
      expect(w.level).toBe('info')
      expect(w.sourceKey).toBeUndefined()
      expect(w.fieldKey).toBeUndefined()
    })
  })
})

// ─── 类型接口结构测试 ──────────────────────────────────────────────────────

describe('BI Custom Report Builder — 类型接口结构', () => {
  it('BiCustomReportFilter 结构', () => {
    const f: BiCustomReportFilter = {
      fieldKey: 'task_count',
      operator: 'gt',
      value: 5,
      label: '任务数大于5',
    }
    expect(f.fieldKey).toBe('task_count')
    expect(f.operator).toBe('gt')
  })

  it('BiCustomReportVisualization 结构', () => {
    const v: BiCustomReportVisualization = {
      type: 'line',
      title: '趋势图',
      xField: 'date',
      yField: 'task_count',
      height: 300,
    }
    expect(v.type).toBe('line')
    expect(v.xField).toBe('date')
  })

  it('BiCustomReportLayout 结构', () => {
    const l: BiCustomReportLayout = {
      gridColumns: 12,
      sections: [
        {
          key: 'main',
          title: '主区域',
          visualizationIndexes: [0, 1],
          col: 0,
          row: 0,
          colSpan: 8,
        },
      ],
    }
    expect(l.gridColumns).toBe(12)
    expect(l.sections?.length).toBe(1)
  })

  it('BiCustomReportDefinition 结构', () => {
    const d: BiCustomReportDefinition = {
      definitionId: 'def-001',
      organizationId: 1,
      scope: 'organization',
      visibility: 'personal',
      ownerActorId: 100,
      version: 1,
      definitionHash: 'bh_abc',
      title: '我的报表',
      dataSources: [{ sourceKey: 'task_summary' }],
      fields: ['task_count'],
      filters: [],
      groups: [],
      sorts: [],
      visualizations: [{ type: 'table' }],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 100,
      updatedBy: 100,
    }
    expect(d.definitionId).toBe('def-001')
    expect(d.visibility).toBe('personal')
    expect(d.isDefault).toBe(false)
  })

  it('BiCustomReportPreviewResult 结构', () => {
    const p: BiCustomReportPreviewResult = {
      status: 'ready',
      definitionHash: 'bh_abc',
      rows: [{ cells: { task_count: 10 } }],
      series: [{ key: 's1', values: [1, 2, 3] }],
      cards: [{ key: 'c1', value: 42, format: 'number' }],
      warnings: [],
      freshness: {
        generatedAt: new Date().toISOString(),
        status: 'fresh',
        ttlMinutes: 15,
      },
      sourceHashes: { task_summary: 'hash123' },
      blocked: false,
      blockedReasons: [],
      evidenceRefs: [],
      generatedAt: new Date().toISOString(),
    }
    expect(p.status).toBe('ready')
    expect(p.rows.length).toBe(1)
    expect(p.series.length).toBe(1)
  })

  it('BiCustomReportAuditPayload 结构', () => {
    const a: BiCustomReportAuditPayload = {
      actor: 100,
      organizationId: 1,
      definitionId: 'def-001',
      action: 'bi_custom_report.create',
      versionTransition: { from: 0, to: 1 },
      scope: 'organization',
      visibility: 'personal',
      changedDataSourceKeys: ['task_summary'],
      changedVisualizationKeys: ['table'],
      resultStatus: 'success',
      timestamp: new Date().toISOString(),
    }
    expect(a.action).toBe('bi_custom_report.create')
    expect(a.versionTransition?.from).toBe(0)
    expect(a.versionTransition?.to).toBe(1)
  })
})

// ─── 非法 payload 检测 ─────────────────────────────────────────────────────

describe('BI Custom Report Builder — 非法 payload 检测', () => {
  it('禁止 SQL 注入检测（概念级）', () => {
    // definition 不包含 SQL 相关字段
    const def: BiCustomReportDefinition = {
      definitionId: 'def-001',
      organizationId: 1,
      scope: 'organization',
      visibility: 'personal',
      ownerActorId: 100,
      version: 1,
      definitionHash: 'bh_abc',
      title: '安全报表',
      dataSources: [{ sourceKey: 'task_summary' }],
      fields: ['task_count'],
      filters: [],
      groups: [],
      sorts: [],
      visualizations: [{ type: 'table' }],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 100,
      updatedBy: 100,
    }
    // TypeScript 编译时确保没有 sql/script/formula/externalUrl/prompt/modelOutput/secret 字段
    const keys = Object.keys(def)
    const forbidden = ['sql', 'script', 'formula', 'externalUrl', 'prompt', 'modelOutput', 'secret']
    for (const k of forbidden) {
      expect(keys).not.toContain(k)
    }
  })

  it('scope 值必须在白名单内', () => {
    const validScopes = BI_CUSTOM_REPORT_SCOPE_VALUES as readonly string[]
    expect(validScopes).toContain('organization')
    expect(validScopes).toContain('portfolio')
    expect(validScopes).toContain('project')
    expect(validScopes).not.toContain('global')
    expect(validScopes).not.toContain('cross_org')
  })

  it('visibility 值必须在白名单内', () => {
    const validVis = BI_CUSTOM_REPORT_VISIBILITY_VALUES as readonly string[]
    expect(validVis).toContain('personal')
    expect(validVis).toContain('shared')
    expect(validVis).not.toContain('public')
    expect(validVis).not.toContain('admin')
  })
})
