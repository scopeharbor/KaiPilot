/**
 * bi_custom_report/definition_validator —— 自定义报表定义验证纯函数。
 *
 * 拒绝 SQL、脚本、公式、外部 URL、prompt、模型输出、secret、
 * 跨组织引用和复杂度超限。
 *
 * v3-bi-custom-report-builder §2.3
 */
import type {
  BiCustomReportVisualization,
  BiCustomReportWarning,
  BiCustomReportWarningCode,
  BiCustomReportWarningLevel,
} from '@aiproj/types'
import { BI_CUSTOM_REPORT_LIMITS, BI_CUSTOM_REPORT_WARNING_CODES } from '@aiproj/types'
import { biCustomReportDataSourceRegistry } from './data_source_registry.js'

// ─── 禁止字段 ─────────────────────────────────────────────────────────────

const FORBIDDEN_DEFINITION_FIELDS = [
  'sql',
  'script',
  'formula',
  'externalUrl',
  'prompt',
  'modelOutput',
  'modelOutputText',
  'secret',
  'token',
  'authorization',
  'crossOrgReference',
]

/**
 * 检查 payload 是否包含非法字段。
 */
export function checkForbiddenPayloadFields(
  payload: Record<string, unknown> & { fields?: unknown },
): string[] {
  const violations: string[] = []

  // 顶层检查
  for (const key of FORBIDDEN_DEFINITION_FIELDS) {
    if (key in payload) {
      violations.push(`定义不得包含禁止字段: "${key}"`)
    }
  }

  // fields 数组仅允许白名单 fieldKey
  if (Array.isArray(payload.fields)) {
    for (const f of payload.fields) {
      if (typeof f === 'string' && !f.match(/^[a-z_][a-z0-9_]*$/)) {
        violations.push(`非法 fieldKey 格式: "${f}"，仅允许 snake_case 标识符`)
      }
    }
  }

  return violations
}

// ─── 复杂度校验 ────────────────────────────────────────────────────────────

export interface ComplexityCheckResult {
  valid: boolean
  violations: string[]
}

/**
 * 校验定义复杂度限制。
 */
export function checkComplexity(payload: {
  dataSources?: unknown[]
  fields?: unknown[]
  filters?: unknown[]
  groups?: unknown[]
  sorts?: unknown[]
  visualizations?: unknown[]
  title?: string
  description?: string
}): ComplexityCheckResult {
  const violations: string[] = []

  if (
    Array.isArray(payload.dataSources) &&
    payload.dataSources.length > BI_CUSTOM_REPORT_LIMITS.MAX_DATA_SOURCES
  ) {
    violations.push(
      `数据源数量 ${payload.dataSources.length} 超过上限 ${BI_CUSTOM_REPORT_LIMITS.MAX_DATA_SOURCES}`,
    )
  }
  if (Array.isArray(payload.fields) && payload.fields.length > BI_CUSTOM_REPORT_LIMITS.MAX_FIELDS) {
    violations.push(
      `字段数量 ${payload.fields.length} 超过上限 ${BI_CUSTOM_REPORT_LIMITS.MAX_FIELDS}`,
    )
  }
  if (
    Array.isArray(payload.filters) &&
    payload.filters.length > BI_CUSTOM_REPORT_LIMITS.MAX_FILTERS
  ) {
    violations.push(
      `筛选器数量 ${payload.filters.length} 超过上限 ${BI_CUSTOM_REPORT_LIMITS.MAX_FILTERS}`,
    )
  }
  if (Array.isArray(payload.groups) && payload.groups.length > BI_CUSTOM_REPORT_LIMITS.MAX_GROUPS) {
    violations.push(
      `分组数量 ${payload.groups.length} 超过上限 ${BI_CUSTOM_REPORT_LIMITS.MAX_GROUPS}`,
    )
  }
  if (Array.isArray(payload.sorts) && payload.sorts.length > BI_CUSTOM_REPORT_LIMITS.MAX_SORTS) {
    violations.push(
      `排序数量 ${payload.sorts.length} 超过上限 ${BI_CUSTOM_REPORT_LIMITS.MAX_SORTS}`,
    )
  }
  if (
    Array.isArray(payload.visualizations) &&
    payload.visualizations.length > BI_CUSTOM_REPORT_LIMITS.MAX_VISUALIZATIONS
  ) {
    violations.push(
      `可视化数量 ${payload.visualizations.length} 超过上限 ${BI_CUSTOM_REPORT_LIMITS.MAX_VISUALIZATIONS}`,
    )
  }
  if (
    payload.title &&
    typeof payload.title === 'string' &&
    payload.title.length > BI_CUSTOM_REPORT_LIMITS.MAX_TITLE_LENGTH
  ) {
    violations.push(
      `标题长度 ${payload.title.length} 超过上限 ${BI_CUSTOM_REPORT_LIMITS.MAX_TITLE_LENGTH}`,
    )
  }
  if (
    payload.description &&
    typeof payload.description === 'string' &&
    payload.description.length > BI_CUSTOM_REPORT_LIMITS.MAX_DESCRIPTION_LENGTH
  ) {
    violations.push(
      `描述长度 ${payload.description.length} 超过上限 ${BI_CUSTOM_REPORT_LIMITS.MAX_DESCRIPTION_LENGTH}`,
    )
  }
  const jsonSize = JSON.stringify(payload).length
  if (jsonSize > BI_CUSTOM_REPORT_LIMITS.MAX_PAYLOAD_BYTES) {
    violations.push(
      `payload 大小 ${jsonSize} 字节超过上限 ${BI_CUSTOM_REPORT_LIMITS.MAX_PAYLOAD_BYTES}`,
    )
  }

  return { valid: violations.length === 0, violations }
}

// ─── 数据源/字段/视图白名单校验 ────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  warnings: BiCustomReportWarning[]
  blockingWarnings: BiCustomReportWarning[]
}

/**
 * 校验定义中引用的数据源、字段、筛选、分组、排序、图表是否在注册表中。
 */
export function validateDefinitionAgainstRegistry(payload: {
  // 入参刻意保持宽 string：本函数的职责就是校验未收窄的 payload 是否落在注册表白名单内
  dataSources?: ReadonlyArray<{ sourceKey: string }>
  fields?: readonly string[]
  filters?: ReadonlyArray<{ fieldKey: string; operator?: string; value?: unknown; label?: string }>
  groups?: ReadonlyArray<{ fieldKey: string; label?: string }>
  sorts?: ReadonlyArray<{ fieldKey: string; direction?: string; label?: string }>
  visualizations?: ReadonlyArray<Partial<BiCustomReportVisualization> & { type: string }>
}): ValidationResult {
  const warnings: BiCustomReportWarning[] = []
  const blockingWarnings: BiCustomReportWarning[] = []

  const addWarning = (
    code: BiCustomReportWarningCode,
    level: BiCustomReportWarningLevel,
    message: string,
    opts?: { sourceKey?: string; fieldKey?: string },
  ) => {
    const w: BiCustomReportWarning = {
      code,
      level,
      message,
      sourceKey: opts?.sourceKey,
      fieldKey: opts?.fieldKey,
    }
    if (level === 'blocking') {
      blockingWarnings.push(w)
    } else {
      warnings.push(w)
    }
  }

  // 校验数据源
  if (Array.isArray(payload.dataSources)) {
    for (const ds of payload.dataSources) {
      if (!ds.sourceKey || !biCustomReportDataSourceRegistry.isValidSourceKey(ds.sourceKey)) {
        addWarning(
          BI_CUSTOM_REPORT_WARNING_CODES.REQUIRED_DATASOURCE_UNAVAILABLE,
          'blocking',
          `数据源 "${ds.sourceKey}" 未注册`,
          { sourceKey: ds.sourceKey },
        )
      }
    }
  }

  // 校验字段
  if (Array.isArray(payload.fields) && Array.isArray(payload.dataSources)) {
    for (const field of payload.fields) {
      const foundInAny = payload.dataSources.some(
        (ds) =>
          ds.sourceKey &&
          biCustomReportDataSourceRegistry.isFieldInSource(field, ds.sourceKey as any),
      )
      if (!foundInAny) {
        addWarning(
          BI_CUSTOM_REPORT_WARNING_CODES.FIELD_FORBIDDEN,
          'warning',
          `字段 "${field}" 不在任何选定数据源的注册字段中`,
          { fieldKey: field },
        )
      }
    }
  }

  // 校验筛选器
  if (Array.isArray(payload.filters)) {
    for (const f of payload.filters) {
      if (f.fieldKey && Array.isArray(payload.fields) && !payload.fields.includes(f.fieldKey)) {
        addWarning(
          BI_CUSTOM_REPORT_WARNING_CODES.FIELD_INCOMPATIBLE,
          'warning',
          `筛选器字段 "${f.fieldKey}" 不在选中字段列表中`,
          { fieldKey: f.fieldKey },
        )
      }
    }
  }

  // 校验分组
  if (Array.isArray(payload.groups)) {
    for (const g of payload.groups) {
      if (g.fieldKey && Array.isArray(payload.fields) && !payload.fields.includes(g.fieldKey)) {
        addWarning(
          BI_CUSTOM_REPORT_WARNING_CODES.FIELD_INCOMPATIBLE,
          'warning',
          `分组字段 "${g.fieldKey}" 不在选中字段列表中`,
          { fieldKey: g.fieldKey },
        )
      }
    }
  }

  // 校验排序
  if (Array.isArray(payload.sorts)) {
    for (const s of payload.sorts) {
      if (s.fieldKey && Array.isArray(payload.fields) && !payload.fields.includes(s.fieldKey)) {
        addWarning(
          BI_CUSTOM_REPORT_WARNING_CODES.FIELD_INCOMPATIBLE,
          'warning',
          `排序字段 "${s.fieldKey}" 不在选中字段列表中`,
          { fieldKey: s.fieldKey },
        )
      }
    }
  }

  // 校验可视化兼容性
  if (Array.isArray(payload.visualizations) && Array.isArray(payload.dataSources)) {
    for (const vis of payload.visualizations) {
      const compatible = payload.dataSources.some(
        (ds) =>
          ds.sourceKey &&
          biCustomReportDataSourceRegistry.isVisualizationCompatible(vis.type, ds.sourceKey as any),
      )
      if (!compatible) {
        addWarning(
          BI_CUSTOM_REPORT_WARNING_CODES.VISUALIZATION_INCOMPATIBLE,
          'warning',
          `图表类型 "${vis.type}" 不与任何选定数据源兼容`,
        )
      }
    }
  }

  return {
    valid: blockingWarnings.length === 0,
    warnings,
    blockingWarnings,
  }
}
