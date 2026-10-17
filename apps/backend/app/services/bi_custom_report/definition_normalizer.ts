/**
 * bi_custom_report/definition_normalizer —— 自定义报表定义标准化与 hash 纯函数。
 *
 * v3-bi-custom-report-builder §2.2
 *
 * 红线：零副作用，纯函数；相同定义 payload 始终得到相同的 definitionHash。
 */
import type {
  BiCustomReportDataSourceRef,
  BiCustomReportFieldKey,
  BiCustomReportFilter,
  BiCustomReportGroup,
  BiCustomReportSort,
  BiCustomReportVisualization,
} from '@aiproj/types'
import { computeBiCustomReportDefinitionHash } from '@aiproj/types'

// 入参侧的宽松形状：键值来自未经收窄的 payload，可能带空白或不在白名单内
type LooseFilter = { fieldKey: string; operator: string; value: unknown; label?: string }
type LooseGroup = { fieldKey: string; label?: string }
type LooseSort = { fieldKey: string; direction: string; label?: string }
type LooseVisualization = {
  type: string
  title?: string
  xField?: string
  yField?: string
  seriesField?: string
  colorPalette?: string
  height?: number
  width?: number
}

/**
 * 标准化的入参刻意用宽 string：这里是未经收窄的 payload 边界，
 * 去空白/去重正是把它收敛成白名单键的过程。收敛后的产物才用契约类型。
 */
export interface NormalizableDefinition {
  dataSources: ReadonlyArray<{ sourceKey: string; alias?: string; label?: string }>
  fields: readonly string[]
  filters: LooseFilter[]
  groups: LooseGroup[]
  sorts: LooseSort[]
  visualizations: LooseVisualization[]
}

/** 标准化后的定义：键均已收窄到 @aiproj/types 白名单联合。 */
export interface NormalizedDefinition {
  dataSources: BiCustomReportDataSourceRef[]
  fields: BiCustomReportFieldKey[]
  filters: BiCustomReportFilter[]
  groups: BiCustomReportGroup[]
  sorts: BiCustomReportSort[]
  visualizations: BiCustomReportVisualization[]
}

/**
 * 标准化字段数组：去重、排序、去空白。
 */
export function normalizeFields(fields: readonly string[]): BiCustomReportFieldKey[] {
  return [
    ...new Set(fields.map((f) => f.trim()).filter(Boolean)),
  ].sort() as BiCustomReportFieldKey[]
}

/**
 * 标准化数据源引用：去重、排序。
 */
export function normalizeDataSources(
  sources: ReadonlyArray<{ sourceKey: string; alias?: string; label?: string }>,
): BiCustomReportDataSourceRef[] {
  const seen = new Set<string>()
  const result: BiCustomReportDataSourceRef[] = []
  for (const s of sources) {
    if (!seen.has(s.sourceKey)) {
      seen.add(s.sourceKey)
      result.push({ ...s, sourceKey: s.sourceKey as BiCustomReportDataSourceRef['sourceKey'] })
    }
  }
  result.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
  return result
}

/**
 * 标准化筛选器：去重 (fieldKey+operator)。
 */
export function normalizeFilters(filters: readonly LooseFilter[]): BiCustomReportFilter[] {
  const seen = new Set<string>()
  return (filters as BiCustomReportFilter[]).filter((f) => {
    const key = `${f.fieldKey}:${f.operator}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 标准化分组：去重 fieldKey。
 */
export function normalizeGroups(groups: readonly LooseGroup[]): BiCustomReportGroup[] {
  const seen = new Set<string>()
  return (groups as BiCustomReportGroup[]).filter((g) => {
    if (seen.has(g.fieldKey)) return false
    seen.add(g.fieldKey)
    return true
  })
}

/**
 * 标准化排序：去重 fieldKey。
 */
export function normalizeSorts(sorts: readonly LooseSort[]): BiCustomReportSort[] {
  const seen = new Set<string>()
  return (sorts as BiCustomReportSort[]).filter((s) => {
    if (seen.has(s.fieldKey)) return false
    seen.add(s.fieldKey)
    return true
  })
}

/**
 * 标准化可视化：去重 type。
 */
export function normalizeVisualizations(
  visualizations: readonly LooseVisualization[],
): BiCustomReportVisualization[] {
  const seen = new Set<string>()
  return (visualizations as BiCustomReportVisualization[]).filter((v) => {
    if (seen.has(v.type)) return false
    seen.add(v.type)
    return true
  })
}

/**
 * 完全标准化一个候选定义并返回标准化后的定义 + stable definitionHash。
 */
export function normalizeDefinition(def: NormalizableDefinition): {
  normalized: NormalizedDefinition
  definitionHash: string
} {
  const normalized: NormalizedDefinition = {
    dataSources: normalizeDataSources(def.dataSources),
    fields: normalizeFields(def.fields),
    filters: normalizeFilters(def.filters),
    groups: normalizeGroups(def.groups),
    sorts: normalizeSorts(def.sorts),
    visualizations: normalizeVisualizations(def.visualizations),
  }

  const definitionHash = computeBiCustomReportDefinitionHash(normalized)

  return { normalized, definitionHash }
}
