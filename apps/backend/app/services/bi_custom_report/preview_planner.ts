/**
 * bi_custom_report/preview_planner —— 预览计划纯函数。
 *
 * 校验字段/筛选/分组/排序/图表兼容、时间窗口和数据源预算。
 *
 * v3-bi-custom-report-builder §2.4
 */
import type {
  BiCustomReportWarning,
  BiCustomReportWarningCode,
  BiCustomReportWarningLevel,
} from '@aiproj/types'
import { BI_CUSTOM_REPORT_LIMITS, BI_CUSTOM_REPORT_WARNING_CODES } from '@aiproj/types'
import { biCustomReportDataSourceRegistry } from './data_source_registry.js'
import type { BiCustomReportDataSourceKey } from '@aiproj/types'

export interface PreviewPlanInput {
  dataSources: Array<{ sourceKey: string }>
  fields: string[]
  filters: Array<{ fieldKey: string; operator: string; value: unknown }>
  groups: Array<{ fieldKey: string }>
  sorts: Array<{ fieldKey: string; direction: string }>
  visualizations: Array<{ type: string }>
}

export interface PreviewPlan {
  planValid: boolean
  blockingWarnings: BiCustomReportWarning[]
  nonBlockingWarnings: BiCustomReportWarning[]
  resolvedSourceKeys: BiCustomReportDataSourceKey[]
  estimatedRowLimit: number
  timeWindowDays?: number
  dataSourceBudget: { total: number; required: number; optional: number }
}

/**
 * 生成预览计划，校验字段兼容、图表兼容、时间窗口和数据源预算。
 */
export function planPreview(input: PreviewPlanInput): PreviewPlan {
  const blockingWarnings: BiCustomReportWarning[] = []
  const nonBlockingWarnings: BiCustomReportWarning[] = []

  const addWarning = (
    code: BiCustomReportWarningCode,
    level: BiCustomReportWarningLevel,
    message: string,
    sourceKey?: string,
    fieldKey?: string,
  ) => {
    const w: BiCustomReportWarning = { code, level, message, sourceKey, fieldKey }
    if (level === 'blocking') {
      blockingWarnings.push(w)
    } else {
      nonBlockingWarnings.push(w)
    }
  }

  // 解析数据源
  const resolvedSourceKeys: BiCustomReportDataSourceKey[] = []
  for (const ds of input.dataSources) {
    if (biCustomReportDataSourceRegistry.isValidSourceKey(ds.sourceKey)) {
      resolvedSourceKeys.push(ds.sourceKey)
    }
  }

  // 检查必需数据源
  if (resolvedSourceKeys.length === 0 && input.dataSources.length > 0) {
    addWarning(
      BI_CUSTOM_REPORT_WARNING_CODES.REQUIRED_DATASOURCE_UNAVAILABLE,
      'blocking',
      '无有效数据源可用',
    )
  }

  // 数据源预算
  const dataSourceBudget = {
    total: input.dataSources.length,
    required: resolvedSourceKeys.length,
    optional: Math.max(0, input.dataSources.length - resolvedSourceKeys.length),
  }

  if (input.dataSources.length > BI_CUSTOM_REPORT_LIMITS.MAX_DATA_SOURCES) {
    addWarning(
      BI_CUSTOM_REPORT_WARNING_CODES.COMPLEXITY_EXCEEDED,
      'blocking',
      `数据源数量 ${input.dataSources.length} 超过上限 ${BI_CUSTOM_REPORT_LIMITS.MAX_DATA_SOURCES}`,
    )
  }

  // 字段校验
  if (input.fields.length === 0) {
    addWarning(BI_CUSTOM_REPORT_WARNING_CODES.FIELD_FORBIDDEN, 'blocking', '未选择任何字段')
  }

  // 检查字段与数据源的兼容性
  for (const field of input.fields) {
    const foundInAny = resolvedSourceKeys.some((sk) =>
      biCustomReportDataSourceRegistry.isFieldInSource(field, sk),
    )
    if (!foundInAny) {
      addWarning(
        BI_CUSTOM_REPORT_WARNING_CODES.FIELD_INCOMPATIBLE,
        'warning',
        `字段 "${field}" 不在任何已解析数据源的注册字段中`,
        undefined,
        field,
      )
    }
  }

  // 筛选器字段校验
  for (const f of input.filters) {
    if (!input.fields.includes(f.fieldKey)) {
      addWarning(
        BI_CUSTOM_REPORT_WARNING_CODES.FIELD_INCOMPATIBLE,
        'warning',
        `筛选器字段 "${f.fieldKey}" 不在选中字段列表中`,
        undefined,
        f.fieldKey,
      )
    }
  }

  // 分组字段校验
  for (const g of input.groups) {
    if (!input.fields.includes(g.fieldKey)) {
      addWarning(
        BI_CUSTOM_REPORT_WARNING_CODES.FIELD_INCOMPATIBLE,
        'warning',
        `分组字段 "${g.fieldKey}" 不在选中字段列表中`,
        undefined,
        g.fieldKey,
      )
    }
  }

  // 排序字段校验
  for (const s of input.sorts) {
    if (!input.fields.includes(s.fieldKey)) {
      addWarning(
        BI_CUSTOM_REPORT_WARNING_CODES.FIELD_INCOMPATIBLE,
        'warning',
        `排序字段 "${s.fieldKey}" 不在选中字段列表中`,
        undefined,
        s.fieldKey,
      )
    }
  }

  // 图表兼容性校验
  for (const vis of input.visualizations) {
    const compatible = resolvedSourceKeys.some((sk) =>
      biCustomReportDataSourceRegistry.isVisualizationCompatible(vis.type as any, sk),
    )
    if (!compatible) {
      addWarning(
        BI_CUSTOM_REPORT_WARNING_CODES.VISUALIZATION_INCOMPATIBLE,
        'warning',
        `图表类型 "${vis.type}" 不与任何已解析数据源兼容`,
      )
    }
  }

  // 估算行限制
  const estimatedRowLimit = BI_CUSTOM_REPORT_LIMITS.PREVIEW_MAX_ROWS

  // 时间窗口（从筛选器中的日期范围推导）
  let timeWindowDays: number | undefined
  for (const f of input.filters) {
    if (f.operator === 'between' && Array.isArray(f.value) && f.value.length === 2) {
      const from = new Date(f.value[0] as string)
      const to = new Date(f.value[1] as string)
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        timeWindowDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
      }
    }
  }

  const planValid = blockingWarnings.length === 0

  return {
    planValid,
    blockingWarnings,
    nonBlockingWarnings,
    resolvedSourceKeys,
    estimatedRowLimit,
    timeWindowDays,
    dataSourceBudget,
  }
}
