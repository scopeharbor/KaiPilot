/**
 * bi_custom_report/data_source_registry —— 自定义报表数据源注册表（服务端）。
 *
 * 服务端定义可用数据源、字段、维度、筛选器、聚合器、图表兼容性、
 * 权限标签、freshness 策略和 fallback 行为。
 * 客户端定义只能引用注册表 key 和受控参数。
 *
 * v3-bi-custom-report-builder §2.1
 */
import type {
  BiCustomReportDataSourceKey,
  BiCustomReportDataSourceDef,
  BiCustomReportFieldDef,
  BiCustomReportFilterOperator,
  BiCustomReportAggregator,
  BiCustomReportVisualizationType,
} from '@aiproj/types'
import {
  BI_CUSTOM_REPORT_DATA_SOURCE_KEYS,
  BI_CUSTOM_REPORT_FIELD_KEYS,
  BI_CUSTOM_REPORT_FILTER_OPERATORS,
  BI_CUSTOM_REPORT_AGGREGATORS,
  BI_CUSTOM_REPORT_VISUALIZATION_TYPES,
} from '@aiproj/types'

// ─── 内置数据源定义 ────────────────────────────────────────────────────────

const COMMON_FILTERS: BiCustomReportFilterOperator[] = [
  BI_CUSTOM_REPORT_FILTER_OPERATORS.EQ,
  BI_CUSTOM_REPORT_FILTER_OPERATORS.NEQ,
  BI_CUSTOM_REPORT_FILTER_OPERATORS.IN,
  BI_CUSTOM_REPORT_FILTER_OPERATORS.NOT_IN,
]

const COMMON_AGGREGATORS: BiCustomReportAggregator[] = [
  BI_CUSTOM_REPORT_AGGREGATORS.COUNT,
  BI_CUSTOM_REPORT_AGGREGATORS.COUNT_DISTINCT,
]

const NUMERIC_AGGREGATORS: BiCustomReportAggregator[] = [
  ...COMMON_AGGREGATORS,
  BI_CUSTOM_REPORT_AGGREGATORS.SUM,
  BI_CUSTOM_REPORT_AGGREGATORS.AVG,
  BI_CUSTOM_REPORT_AGGREGATORS.MIN,
  BI_CUSTOM_REPORT_AGGREGATORS.MAX,
  BI_CUSTOM_REPORT_AGGREGATORS.MEDIAN,
]

const ALL_VISUALIZATIONS: BiCustomReportVisualizationType[] = [
  BI_CUSTOM_REPORT_VISUALIZATION_TYPES.TABLE,
  BI_CUSTOM_REPORT_VISUALIZATION_TYPES.METRIC_CARD,
  BI_CUSTOM_REPORT_VISUALIZATION_TYPES.LINE,
  BI_CUSTOM_REPORT_VISUALIZATION_TYPES.BAR,
  BI_CUSTOM_REPORT_VISUALIZATION_TYPES.STACKED_BAR,
]

export const BUILTIN_BI_CUSTOM_REPORT_DATA_SOURCES: BiCustomReportDataSourceDef[] = [
  // ── 任务数据源 ──
  {
    sourceKey: BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.TASK_SUMMARY,
    name: '任务概要',
    description: '项目任务总数、完成、逾期、临近截止等统计',
    fields: [
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME,
        name: '项目名称',
        type: 'string',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.TASK_COUNT,
        name: '任务总数',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.TASK_COMPLETED,
        name: '已完成任务数',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.TASK_OVERDUE,
        name: '逾期任务数',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.TASK_NEAR_DUE,
        name: '临近截止任务数',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_PROGRESS,
        name: '项目进度',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.DATE,
        name: '日期',
        type: 'date',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
    ],
    dimensions: [BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME, BI_CUSTOM_REPORT_FIELD_KEYS.DATE],
    supportedFilters: [...COMMON_FILTERS, BI_CUSTOM_REPORT_FILTER_OPERATORS.BETWEEN],
    supportedAggregators: NUMERIC_AGGREGATORS,
    compatibleVisualizations: ALL_VISUALIZATIONS,
    permissionTags: ['report:view'],
    freshnessStrategy: 'live',
    fallbackBehavior: 'blocking',
  },

  // ── 风险数据源 ──
  {
    sourceKey: BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.RISK_SUMMARY,
    name: '风险概要',
    description: '风险等级分布、状态与缓解情况',
    fields: [
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME,
        name: '项目名称',
        type: 'string',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'risk:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.RISK_COUNT,
        name: '风险总数',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'risk:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.RISK_LEVEL,
        name: '风险等级',
        type: 'enum',
        enumValues: ['低', '中', '高', '紧急'],
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'risk:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.RISK_STATUS,
        name: '风险状态',
        type: 'enum',
        enumValues: ['开放', '缓解中', '已关闭', '已接受'],
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'risk:view',
      },
    ],
    dimensions: [
      BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME,
      BI_CUSTOM_REPORT_FIELD_KEYS.RISK_LEVEL,
      BI_CUSTOM_REPORT_FIELD_KEYS.RISK_STATUS,
    ],
    supportedFilters: [...COMMON_FILTERS],
    supportedAggregators: COMMON_AGGREGATORS,
    compatibleVisualizations: [...ALL_VISUALIZATIONS, BI_CUSTOM_REPORT_VISUALIZATION_TYPES.HEATMAP],
    permissionTags: ['risk:view'],
    freshnessStrategy: 'live',
    fallbackBehavior: 'empty',
  },

  // ── 资源数据源 ──
  {
    sourceKey: BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.RESOURCE_SUMMARY,
    name: '资源概要',
    description: '资源分配、负载和利用率概览',
    fields: [
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.RESOURCE_NAME,
        name: '资源名称',
        type: 'string',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'resource:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.RESOURCE_LOAD,
        name: '资源负载',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'resource:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.RESOURCE_UTILIZATION,
        name: '资源利用率',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'resource:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME,
        name: '项目名称',
        type: 'string',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'resource:view',
      },
    ],
    dimensions: [
      BI_CUSTOM_REPORT_FIELD_KEYS.RESOURCE_NAME,
      BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME,
    ],
    supportedFilters: [...COMMON_FILTERS, BI_CUSTOM_REPORT_FILTER_OPERATORS.BETWEEN],
    supportedAggregators: NUMERIC_AGGREGATORS,
    compatibleVisualizations: ALL_VISUALIZATIONS,
    permissionTags: ['resource:view'],
    freshnessStrategy: 'live',
    fallbackBehavior: 'stale_warning',
  },

  // ── Dashboard 指标数据源 ──
  {
    sourceKey: BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.DASHBOARD_METRICS,
    name: 'Dashboard 指标',
    description: '项目健康状态、进度、里程碑与风险综合指标',
    fields: [
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME,
        name: '项目名称',
        type: 'string',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_PROGRESS,
        name: '项目进度',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_STATUS,
        name: '项目状态',
        type: 'enum',
        enumValues: ['规划中', '进行中', '延期', '已完成', '已归档'],
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
    ],
    dimensions: [
      BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME,
      BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_STATUS,
    ],
    supportedFilters: [...COMMON_FILTERS],
    supportedAggregators: NUMERIC_AGGREGATORS,
    compatibleVisualizations: ALL_VISUALIZATIONS,
    permissionTags: ['report:view'],
    freshnessStrategy: 'cached',
    freshnessTtlMinutes: 15,
    fallbackBehavior: 'stale_warning',
  },

  // ── BI 趋势数据源 ──
  {
    sourceKey: BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.BI_TREND_SERIES,
    name: 'BI 趋势系列',
    description: '多指标时间序列趋势',
    fields: [
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.TREND_DIRECTION,
        name: '趋势方向',
        type: 'enum',
        enumValues: ['up', 'down', 'flat'],
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.TREND_VALUE,
        name: '趋势值',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.DATE,
        name: '日期',
        type: 'date',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'report:view',
      },
    ],
    dimensions: [BI_CUSTOM_REPORT_FIELD_KEYS.DATE, BI_CUSTOM_REPORT_FIELD_KEYS.TREND_DIRECTION],
    supportedFilters: [...COMMON_FILTERS, BI_CUSTOM_REPORT_FILTER_OPERATORS.BETWEEN],
    supportedAggregators: NUMERIC_AGGREGATORS,
    compatibleVisualizations: [
      BI_CUSTOM_REPORT_VISUALIZATION_TYPES.LINE,
      BI_CUSTOM_REPORT_VISUALIZATION_TYPES.BAR,
    ],
    permissionTags: ['report:view'],
    freshnessStrategy: 'snapshot',
    freshnessTtlMinutes: 60,
    fallbackBehavior: 'stale_warning',
  },

  // ── 资源预测数据源 ──
  {
    sourceKey: BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.RESOURCE_FORECAST,
    name: '资源需求预测',
    description: '资源需求预测与趋势',
    fields: [
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.RESOURCE_DEMAND_HOURS,
        name: '需求工时',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'resource:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME,
        name: '项目名称',
        type: 'string',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'resource:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.MONTH,
        name: '月份',
        type: 'date',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'resource:view',
      },
    ],
    dimensions: [BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME, BI_CUSTOM_REPORT_FIELD_KEYS.MONTH],
    supportedFilters: [...COMMON_FILTERS, BI_CUSTOM_REPORT_FILTER_OPERATORS.BETWEEN],
    supportedAggregators: NUMERIC_AGGREGATORS,
    compatibleVisualizations: [
      BI_CUSTOM_REPORT_VISUALIZATION_TYPES.LINE,
      BI_CUSTOM_REPORT_VISUALIZATION_TYPES.BAR,
      BI_CUSTOM_REPORT_VISUALIZATION_TYPES.STACKED_BAR,
    ],
    permissionTags: ['resource:view'],
    freshnessStrategy: 'snapshot',
    freshnessTtlMinutes: 120,
    fallbackBehavior: 'stale_warning',
  },

  // ── OKR 进度数据源 ──
  {
    sourceKey: BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.OKR_PROGRESS,
    name: 'OKR 进展',
    description: 'OKR 目标与 KR 完成度',
    fields: [
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.OKR_OBJECTIVE_TITLE,
        name: '目标标题',
        type: 'string',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'okr:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.OKR_PROGRESS_PCT,
        name: 'KR 进度',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'okr:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.OKR_KR_COUNT,
        name: 'KR 数量',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'okr:view',
      },
    ],
    dimensions: [BI_CUSTOM_REPORT_FIELD_KEYS.OKR_OBJECTIVE_TITLE],
    supportedFilters: [...COMMON_FILTERS, BI_CUSTOM_REPORT_FILTER_OPERATORS.BETWEEN],
    supportedAggregators: NUMERIC_AGGREGATORS,
    compatibleVisualizations: ALL_VISUALIZATIONS,
    permissionTags: ['okr:view'],
    freshnessStrategy: 'live',
    fallbackBehavior: 'blocking',
  },

  // ── PMO 组合数据源 ──
  {
    sourceKey: BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.PMO_PORTFOLIO,
    name: 'PMO 组合概览',
    description: '组合级别项目评分、交通灯与分组',
    fields: [
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PORTFOLIO_NAME,
        name: '组合名称',
        type: 'string',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'pmo:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PMO_SCORE,
        name: '优先级评分',
        type: 'number',
        aggregatable: true,
        filterable: true,
        sortable: true,
        permissionTag: 'pmo:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PMO_TRAFFIC_LIGHT,
        name: '交通灯',
        type: 'enum',
        enumValues: ['green', 'yellow', 'red'],
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'pmo:view',
      },
      {
        fieldKey: BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME,
        name: '项目名称',
        type: 'string',
        aggregatable: false,
        filterable: true,
        sortable: true,
        permissionTag: 'pmo:view',
      },
    ],
    dimensions: [
      BI_CUSTOM_REPORT_FIELD_KEYS.PORTFOLIO_NAME,
      BI_CUSTOM_REPORT_FIELD_KEYS.PMO_TRAFFIC_LIGHT,
      BI_CUSTOM_REPORT_FIELD_KEYS.PROJECT_NAME,
    ],
    supportedFilters: [...COMMON_FILTERS],
    supportedAggregators: NUMERIC_AGGREGATORS,
    compatibleVisualizations: [...ALL_VISUALIZATIONS, BI_CUSTOM_REPORT_VISUALIZATION_TYPES.HEATMAP],
    permissionTags: ['pmo:view'],
    freshnessStrategy: 'snapshot',
    freshnessTtlMinutes: 30,
    fallbackBehavior: 'stale_warning',
  },
]

// ─── 注册表 ────────────────────────────────────────────────────────────────

const DATA_SOURCE_MAP = new Map<BiCustomReportDataSourceKey, BiCustomReportDataSourceDef>(
  BUILTIN_BI_CUSTOM_REPORT_DATA_SOURCES.map((ds) => [ds.sourceKey, ds]),
)

/**
 * BiCustomReportDataSourceRegistry —— 自定义报表数据源注册表。
 */
export class BiCustomReportDataSourceRegistry {
  /** 列出所有内置数据源定义（未做权限过滤） */
  listAll(): BiCustomReportDataSourceDef[] {
    return [...BUILTIN_BI_CUSTOM_REPORT_DATA_SOURCES]
  }

  /** 按用户权限过滤数据源 */
  listForPermissions(permissions: Set<string>): BiCustomReportDataSourceDef[] {
    return BUILTIN_BI_CUSTOM_REPORT_DATA_SOURCES.filter((ds) =>
      ds.permissionTags.some((tag) => permissions.has(tag)),
    )
  }

  /** 按 key 获取数据源 */
  get(sourceKey: BiCustomReportDataSourceKey): BiCustomReportDataSourceDef | undefined {
    return DATA_SOURCE_MAP.get(sourceKey)
  }

  /** 获取数据源中包含的字段 */
  getFields(sourceKey: BiCustomReportDataSourceKey): BiCustomReportFieldDef[] {
    return DATA_SOURCE_MAP.get(sourceKey)?.fields ?? []
  }

  /** 校验 sourceKey 是否在白名单中 */
  isValidSourceKey(key: string): key is BiCustomReportDataSourceKey {
    return DATA_SOURCE_MAP.has(key as BiCustomReportDataSourceKey)
  }

  /** 校验 fieldKey 是否属于指定数据源 */
  isFieldInSource(fieldKey: string, sourceKey: BiCustomReportDataSourceKey): boolean {
    const ds = this.get(sourceKey)
    if (!ds) return false
    return ds.fields.some((f) => f.fieldKey === fieldKey)
  }

  /** 校验可视化类型是否与数据源兼容 */
  isVisualizationCompatible(
    visType: BiCustomReportVisualizationType,
    sourceKey: BiCustomReportDataSourceKey,
  ): boolean {
    const ds = this.get(sourceKey)
    if (!ds) return false
    return ds.compatibleVisualizations.includes(visType)
  }

  /** 获取 fresh 数据源 freshness 策略 */
  getFreshnessTtl(sourceKey: BiCustomReportDataSourceKey): number | undefined {
    return this.get(sourceKey)?.freshnessTtlMinutes
  }

  /** 判断 fallbackBehavior */
  isBlocking(sourceKey: BiCustomReportDataSourceKey): boolean {
    return this.get(sourceKey)?.fallbackBehavior === 'blocking'
  }
}

/** 默认单例注册表实例 */
export const biCustomReportDataSourceRegistry = new BiCustomReportDataSourceRegistry()
