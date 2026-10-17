/**
 * bi_report_templates/registry —— BI 报表模板注册表（tasks §2.1）。
 *
 * 定义 5 个内置 BI 报表模板的项目执行概览、资源利用率报告、风险分析报告、
 * 里程碑追踪报告、团队绩效报告。每个模板为纯声明式定义，只引用已注册数据源键，
 * 禁止 SQL、脚本、公式、外部 URL、prompt 或模型输出。
 *
 * 注册表为代码内版本化常量（design.md D1），不落 DB。
 */
import type {
  BiTemplateId,
  BiTemplateDef,
  BiTemplateCategory,
  BiTemplateScenario,
} from '@aiproj/types'
import {
  BI_TEMPLATE_IDS,
  BI_TEMPLATE_VERSIONS,
  BI_TEMPLATE_CATEGORIES,
  BI_TEMPLATE_SCENARIOS,
  BI_DATASOURCE_KEYS,
  BI_TEMPLATE_METRIC_KEYS,
  BI_TEMPLATE_DIMENSION_KEYS,
  BI_CHART_TYPES,
} from '@aiproj/types'

// ─── 5 个内置 BI 模板定义 ──────────────────────────────────────────────────

/**
 * 项目执行概览 —— 周会汇报场景。
 *
 * 消费组织 Dashboard + PMO 组合 Dashboard + BI 趋势分析，提供组织级项目执行
 * 全景视图：进度分布、延期压力、风险信号、资源利用。
 */
const PROJECT_EXECUTION_OVERVIEW: BiTemplateDef = {
  templateId: BI_TEMPLATE_IDS.PROJECT_EXECUTION_OVERVIEW,
  version: BI_TEMPLATE_VERSIONS[BI_TEMPLATE_IDS.PROJECT_EXECUTION_OVERVIEW],
  name: '项目执行概览',
  description:
    '组织级项目执行全景视图，包含项目进度分布、延期压力、风险信号与资源利用概况，适用于周会汇报和 PMO 定期巡检。',
  category: BI_TEMPLATE_CATEGORIES.EXECUTION,
  scenario: BI_TEMPLATE_SCENARIOS.WEEKLY_REVIEW,
  composition: {
    dataSourceKeys: [
      BI_DATASOURCE_KEYS.ORGANIZATION_DASHBOARD,
      BI_DATASOURCE_KEYS.PMO_PORTFOLIO_DASHBOARD,
      BI_DATASOURCE_KEYS.BI_TREND_ANALYSIS,
    ],
    metricKeys: [
      BI_TEMPLATE_METRIC_KEYS.PROJECT_PROGRESS,
      BI_TEMPLATE_METRIC_KEYS.SCHEDULE_DELAY_PRESSURE,
      BI_TEMPLATE_METRIC_KEYS.RISK_PRESSURE,
      BI_TEMPLATE_METRIC_KEYS.RESOURCE_UTILIZATION_RATE,
      BI_TEMPLATE_METRIC_KEYS.OKR_PROGRESS,
    ],
    dimensionKeys: [BI_TEMPLATE_DIMENSION_KEYS.PROJECT, BI_TEMPLATE_DIMENSION_KEYS.TIME],
    defaultFilters: {},
    charts: [
      {
        chartType: BI_CHART_TYPES.STAT_CARD,
        title: '总体项目进度',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.PROJECT_PROGRESS],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.PROJECT,
      },
      {
        chartType: BI_CHART_TYPES.BAR,
        title: '项目进度分布',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.PROJECT_PROGRESS],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.PROJECT,
      },
      {
        chartType: BI_CHART_TYPES.LINE,
        title: '延期压力趋势',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.SCHEDULE_DELAY_PRESSURE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.TIME,
      },
      {
        chartType: BI_CHART_TYPES.STAT_CARD,
        title: '风险与 OKR 概览',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.RISK_PRESSURE, BI_TEMPLATE_METRIC_KEYS.OKR_PROGRESS],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.PROJECT,
      },
    ],
  },
  personDimensionRequiresExtraPermission: false,
}

/**
 * 资源利用率报告 —— 资源规划场景。
 *
 * 消费组织资源池 + 技能矩阵 + 资源需求预测 + 缺口分析 + 争用检测，
 * 提供全组织资源利用全景。
 */
const RESOURCE_UTILIZATION: BiTemplateDef = {
  templateId: BI_TEMPLATE_IDS.RESOURCE_UTILIZATION,
  version: BI_TEMPLATE_VERSIONS[BI_TEMPLATE_IDS.RESOURCE_UTILIZATION],
  name: '资源利用率报告',
  description:
    '全组织资源利用全景视图，包含资源分配率、技能覆盖度、需求预测、缺口与争用检测，适用于资源规划与人力调配决策。',
  category: BI_TEMPLATE_CATEGORIES.RESOURCE,
  scenario: BI_TEMPLATE_SCENARIOS.RESOURCE_PLANNING,
  composition: {
    dataSourceKeys: [
      BI_DATASOURCE_KEYS.ORGANIZATION_RESOURCE_POOL,
      BI_DATASOURCE_KEYS.RESOURCE_SKILL_MATRIX,
      BI_DATASOURCE_KEYS.RESOURCE_DEMAND_FORECASTING,
      BI_DATASOURCE_KEYS.RESOURCE_GAP_ANALYSIS,
      BI_DATASOURCE_KEYS.RESOURCE_CONTENTION_DETECTION,
    ],
    metricKeys: [
      BI_TEMPLATE_METRIC_KEYS.RESOURCE_UTILIZATION_RATE,
      BI_TEMPLATE_METRIC_KEYS.RESOURCE_GAP_HOURS,
      BI_TEMPLATE_METRIC_KEYS.RESOURCE_CONTENTION_COUNT,
    ],
    dimensionKeys: [
      BI_TEMPLATE_DIMENSION_KEYS.PROJECT,
      BI_TEMPLATE_DIMENSION_KEYS.TEAM,
      BI_TEMPLATE_DIMENSION_KEYS.TIME,
    ],
    defaultFilters: {},
    charts: [
      {
        chartType: BI_CHART_TYPES.STAT_CARD,
        title: '资源利用率概览',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.RESOURCE_UTILIZATION_RATE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.ORGANIZATION,
      },
      {
        chartType: BI_CHART_TYPES.BAR,
        title: '按团队资源分配',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.RESOURCE_UTILIZATION_RATE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.TEAM,
      },
      {
        chartType: BI_CHART_TYPES.BAR,
        title: '资源缺口',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.RESOURCE_GAP_HOURS],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.PROJECT,
      },
      {
        chartType: BI_CHART_TYPES.TABLE,
        title: '资源争用明细',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.RESOURCE_CONTENTION_COUNT],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.PROJECT,
      },
    ],
  },
  personDimensionRequiresExtraPermission: false,
}

/**
 * 风险分析报告 —— 风险评审会场景。
 *
 * 消费 PMO 组合 Dashboard + BI 趋势（风险压力）+ 风险热力图，
 * 提供组织级风险全景分析。
 */
const RISK_ANALYSIS: BiTemplateDef = {
  templateId: BI_TEMPLATE_IDS.RISK_ANALYSIS,
  version: BI_TEMPLATE_VERSIONS[BI_TEMPLATE_IDS.RISK_ANALYSIS],
  name: '风险分析报告',
  description:
    '组织级风险全景分析视图，包含风险等级分布、趋势变化、热力集中区域，适用于风险评审会和预先风险干预。',
  category: BI_TEMPLATE_CATEGORIES.RISK,
  scenario: BI_TEMPLATE_SCENARIOS.RISK_REVIEW,
  composition: {
    dataSourceKeys: [
      BI_DATASOURCE_KEYS.PMO_PORTFOLIO_DASHBOARD,
      BI_DATASOURCE_KEYS.BI_TREND_ANALYSIS,
      BI_DATASOURCE_KEYS.BI_RISK_HEATMAP,
    ],
    metricKeys: [BI_TEMPLATE_METRIC_KEYS.RISK_PRESSURE, BI_TEMPLATE_METRIC_KEYS.PROJECT_PROGRESS],
    dimensionKeys: [
      BI_TEMPLATE_DIMENSION_KEYS.PROJECT,
      BI_TEMPLATE_DIMENSION_KEYS.RISK_LEVEL,
      BI_TEMPLATE_DIMENSION_KEYS.TIME,
    ],
    defaultFilters: {},
    charts: [
      {
        chartType: BI_CHART_TYPES.STAT_CARD,
        title: '风险压力总览',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.RISK_PRESSURE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.ORGANIZATION,
      },
      {
        chartType: BI_CHART_TYPES.PIE,
        title: '风险等级分布',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.RISK_PRESSURE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.RISK_LEVEL,
      },
      {
        chartType: BI_CHART_TYPES.HEATMAP,
        title: '风险热力图',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.RISK_PRESSURE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.PROJECT,
      },
      {
        chartType: BI_CHART_TYPES.LINE,
        title: '风险压力趋势',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.RISK_PRESSURE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.TIME,
      },
    ],
  },
  personDimensionRequiresExtraPermission: false,
}

/**
 * 里程碑追踪报告 —— 进度评审场景。
 *
 * 消费组织 Dashboard + PMO 组合 Dashboard + BI 趋势分析，
 * 提供跨项目里程碑全景视图。
 */
const MILESTONE_TRACKING: BiTemplateDef = {
  templateId: BI_TEMPLATE_IDS.MILESTONE_TRACKING,
  version: BI_TEMPLATE_VERSIONS[BI_TEMPLATE_IDS.MILESTONE_TRACKING],
  name: '里程碑追踪报告',
  description:
    '跨项目里程碑全景视图，包含里程碑完成率、逾期里程碑列表、关联项目进度对比，适用于进度评审与里程碑门禁检查。',
  category: BI_TEMPLATE_CATEGORIES.MILESTONE,
  scenario: BI_TEMPLATE_SCENARIOS.PROGRESS_REVIEW,
  composition: {
    dataSourceKeys: [
      BI_DATASOURCE_KEYS.ORGANIZATION_DASHBOARD,
      BI_DATASOURCE_KEYS.PMO_PORTFOLIO_DASHBOARD,
      BI_DATASOURCE_KEYS.BI_TREND_ANALYSIS,
    ],
    metricKeys: [
      BI_TEMPLATE_METRIC_KEYS.MILESTONE_COMPLETION_RATE,
      BI_TEMPLATE_METRIC_KEYS.MILESTONE_OVERDUE_COUNT,
      BI_TEMPLATE_METRIC_KEYS.PROJECT_PROGRESS,
    ],
    dimensionKeys: [
      BI_TEMPLATE_DIMENSION_KEYS.PROJECT,
      BI_TEMPLATE_DIMENSION_KEYS.MILESTONE,
      BI_TEMPLATE_DIMENSION_KEYS.TIME,
    ],
    defaultFilters: {},
    charts: [
      {
        chartType: BI_CHART_TYPES.STAT_CARD,
        title: '里程碑完成率',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.MILESTONE_COMPLETION_RATE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.ORGANIZATION,
      },
      {
        chartType: BI_CHART_TYPES.PROGRESS_BAR,
        title: '按项目里程碑进度',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.MILESTONE_COMPLETION_RATE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.PROJECT,
      },
      {
        chartType: BI_CHART_TYPES.TABLE,
        title: '逾期里程碑明细',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.MILESTONE_OVERDUE_COUNT],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.MILESTONE,
      },
      {
        chartType: BI_CHART_TYPES.LINE,
        title: '里程碑完成趋势',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.MILESTONE_COMPLETION_RATE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.TIME,
      },
    ],
  },
  personDimensionRequiresExtraPermission: false,
}

/**
 * 团队绩效报告 —— 绩效评估场景。
 *
 * 消费 OKR 层级 + 资源池 + 组织 Dashboard，提供按团队粒度的绩效全貌。
 * 人员维度默认聚合到团队粒度；个人级数据仅在调用者具备相应权限位时返回。
 */
const TEAM_PERFORMANCE: BiTemplateDef = {
  templateId: BI_TEMPLATE_IDS.TEAM_PERFORMANCE,
  version: BI_TEMPLATE_VERSIONS[BI_TEMPLATE_IDS.TEAM_PERFORMANCE],
  name: '团队绩效报告',
  description:
    '按团队粒度的绩效全貌视图，包含任务完成率、负载分布、OKR 达成度，适用于绩效评估与团队效能分析。人员维度默认聚合至团队级。',
  category: BI_TEMPLATE_CATEGORIES.PEOPLE,
  scenario: BI_TEMPLATE_SCENARIOS.PERFORMANCE_REVIEW,
  composition: {
    dataSourceKeys: [
      BI_DATASOURCE_KEYS.OKR_HIERARCHY,
      BI_DATASOURCE_KEYS.ORGANIZATION_RESOURCE_POOL,
      BI_DATASOURCE_KEYS.ORGANIZATION_DASHBOARD,
    ],
    metricKeys: [
      BI_TEMPLATE_METRIC_KEYS.OKR_PROGRESS,
      BI_TEMPLATE_METRIC_KEYS.TEAM_TASK_COMPLETION_RATE,
      BI_TEMPLATE_METRIC_KEYS.TEAM_WORKLOAD_DISTRIBUTION,
    ],
    dimensionKeys: [
      BI_TEMPLATE_DIMENSION_KEYS.TEAM,
      BI_TEMPLATE_DIMENSION_KEYS.TIME,
      BI_TEMPLATE_DIMENSION_KEYS.PERSON,
    ],
    defaultFilters: {},
    charts: [
      {
        chartType: BI_CHART_TYPES.STAT_CARD,
        title: '组织 OKR 达成度',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.OKR_PROGRESS],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.ORGANIZATION,
      },
      {
        chartType: BI_CHART_TYPES.BAR,
        title: '按团队任务完成率',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.TEAM_TASK_COMPLETION_RATE],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.TEAM,
      },
      {
        chartType: BI_CHART_TYPES.BAR,
        title: '按团队负载分布',
        metricKeys: [BI_TEMPLATE_METRIC_KEYS.TEAM_WORKLOAD_DISTRIBUTION],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.TEAM,
      },
      {
        chartType: BI_CHART_TYPES.LINE,
        title: '团队绩效趋势',
        metricKeys: [
          BI_TEMPLATE_METRIC_KEYS.TEAM_TASK_COMPLETION_RATE,
          BI_TEMPLATE_METRIC_KEYS.OKR_PROGRESS,
        ],
        dimensionKey: BI_TEMPLATE_DIMENSION_KEYS.TIME,
      },
    ],
  },
  personDimensionRequiresExtraPermission: true,
}

// ─── 内置模板注册表 ─────────────────────────────────────────────────────────

/** 内置 BI 报表模板数组 */
export const BI_BUILTIN_TEMPLATES: BiTemplateDef[] = [
  PROJECT_EXECUTION_OVERVIEW,
  RESOURCE_UTILIZATION,
  RISK_ANALYSIS,
  MILESTONE_TRACKING,
  TEAM_PERFORMANCE,
]

/** 模板 ID → 定义查找 */
export const BI_TEMPLATE_MAP = new Map<string, BiTemplateDef>(
  BI_BUILTIN_TEMPLATES.map((t) => [t.templateId, t]),
)

/** 白名单校验：判定是否为内置 BI 模板 */
export function isBuiltinBiTemplate(id: string): id is BiTemplateId {
  return BI_TEMPLATE_MAP.has(id)
}

/** 获取所有内置 BI 模板 */
export function getBuiltinBiTemplates(): BiTemplateDef[] {
  return BI_BUILTIN_TEMPLATES
}

/** 按分类获取内置 BI 模板 */
export function getBuiltinBiTemplatesByCategory(category: BiTemplateCategory): BiTemplateDef[] {
  return BI_BUILTIN_TEMPLATES.filter((t) => t.category === category)
}

/** 按场景获取内置 BI 模板 */
export function getBuiltinBiTemplatesByScenario(scenario: BiTemplateScenario): BiTemplateDef[] {
  return BI_BUILTIN_TEMPLATES.filter((t) => t.scenario === scenario)
}

/** 获取单个内置 BI 模板 */
export function getBuiltinBiTemplate(templateId: string): BiTemplateDef | undefined {
  return BI_TEMPLATE_MAP.get(templateId)
}

/** 获取内置模板当前版本 */
export function getBuiltinBiTemplateVersion(templateId: string): number {
  return (
    (BI_TEMPLATE_VERSIONS as Record<string, number>)[templateId] ??
    BI_TEMPLATE_MAP.get(templateId)?.version ??
    0
  )
}
