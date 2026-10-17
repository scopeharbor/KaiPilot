/**
 * bi_custom_report/preview_service —— 自定义报表预览服务。
 *
 * 聚合注册数据源并输出 rows/series/cards、warnings、freshness、sourceHash、
 * blocked 状态和低敏 evidence refs。
 *
 * v3-bi-custom-report-builder §4.1–4.4
 */
import type {
  BiCustomReportDataSourceKey,
  BiCustomReportDataSourceRef,
  BiCustomReportFieldKey,
  BiCustomReportFilter,
  BiCustomReportGroup,
  BiCustomReportLayout,
  BiCustomReportScope,
  BiCustomReportSort,
  BiCustomReportVisualization,
  BiCustomReportPreviewResult,
  BiCustomReportPreviewRow,
  BiCustomReportPreviewSeries,
  BiCustomReportPreviewCard,
  BiCustomReportWarning,
  BiCustomReportEvidenceRef,
} from '@aiproj/types'
import {
  BI_CUSTOM_REPORT_WARNING_CODES,
  BI_CUSTOM_REPORT_PREVIEW_STATUS,
  BI_CUSTOM_REPORT_LIMITS,
  computeBiCustomReportDefinitionHash,
  buildBiCustomReportWarning,
} from '@aiproj/types'
import { biCustomReportDataSourceRegistry } from './data_source_registry.js'
import { planPreview } from './preview_planner.js'
import { checkComplexity, validateDefinitionAgainstRegistry } from './definition_validator.js'
import type { Actor } from '#policies/bi_custom_report_policy'
import { BiCustomReportPolicy } from '#policies/bi_custom_report_policy'

// 与 CreateInput 一致，直接复用 @aiproj/types 契约的字面量联合，保持 validator → service → 契约同型
export interface PreviewInput {
  title?: string
  scope?: BiCustomReportScope
  dataSources: BiCustomReportDataSourceRef[]
  fields: BiCustomReportFieldKey[]
  filters?: BiCustomReportFilter[]
  groups?: BiCustomReportGroup[]
  sorts?: BiCustomReportSort[]
  visualizations: BiCustomReportVisualization[]
  layout?: BiCustomReportLayout
}

export class BiCustomReportPreviewService {
  /**
   * 执行无副作用预览。
   */
  async preview(
    actor: Actor,
    _organizationId: number,
    input: PreviewInput,
  ): Promise<BiCustomReportPreviewResult> {
    const warnings: BiCustomReportWarning[] = []
    const blockingWarnings: BiCustomReportWarning[] = []
    const blockedReasons: string[] = []
    const evidenceRefs: BiCustomReportEvidenceRef[] = []
    const sourceHashes: Record<string, string> = {}
    const rows: BiCustomReportPreviewRow[] = []
    const series: BiCustomReportPreviewSeries[] = []
    const cards: BiCustomReportPreviewCard[] = []
    const generatedAt = new Date().toISOString()

    // 1. 复杂度检查
    const complexity = checkComplexity({
      dataSources: input.dataSources,
      fields: input.fields,
      filters: input.filters,
      groups: input.groups,
      sorts: input.sorts,
      visualizations: input.visualizations,
      title: input.title,
    })

    if (!complexity.valid) {
      for (const v of complexity.violations) {
        blockingWarnings.push(
          buildBiCustomReportWarning(
            BI_CUSTOM_REPORT_WARNING_CODES.COMPLEXITY_EXCEEDED,
            'blocking',
            v,
          ),
        )
        blockedReasons.push(v)
      }
      return this.buildBlockedResult(
        input,
        blockingWarnings,
        blockedReasons,
        sourceHashes,
        generatedAt,
      )
    }

    // 2. 计算 definitionHash
    const definitionHash = computeBiCustomReportDefinitionHash({
      dataSources: input.dataSources,
      fields: input.fields,
      filters: input.filters ?? [],
      groups: input.groups ?? [],
      sorts: input.sorts ?? [],
      visualizations: input.visualizations,
    })

    // 3. 预览计划
    const plan = planPreview({
      dataSources: input.dataSources,
      fields: input.fields,
      filters: input.filters ?? [],
      groups: input.groups ?? [],
      sorts: input.sorts ?? [],
      visualizations: input.visualizations,
    })

    if (!plan.planValid) {
      blockingWarnings.push(...plan.blockingWarnings)
      blockedReasons.push(...plan.blockingWarnings.map((w) => w.message))
    }
    warnings.push(...plan.nonBlockingWarnings)

    if (!plan.planValid) {
      return this.buildBlockedResult(
        input,
        blockingWarnings,
        blockedReasons,
        sourceHashes,
        generatedAt,
      )
    }

    // 4. 注册表校验
    const validation = validateDefinitionAgainstRegistry({
      dataSources: input.dataSources,
      fields: input.fields,
      filters: input.filters,
      groups: input.groups,
      sorts: input.sorts,
      visualizations: input.visualizations,
    })

    blockingWarnings.push(...validation.blockingWarnings)
    warnings.push(...validation.warnings)

    if (!validation.valid) {
      blockedReasons.push(...validation.blockingWarnings.map((w) => w.message))
      return this.buildBlockedResult(
        input,
        blockingWarnings,
        blockedReasons,
        sourceHashes,
        generatedAt,
      )
    }

    // 5. 权限过滤：过滤 actor 无权查看的数据源
    const authorizedSources: BiCustomReportDataSourceKey[] = []
    for (const sourceKey of plan.resolvedSourceKeys) {
      const dsDef = biCustomReportDataSourceRegistry.get(sourceKey)
      if (!dsDef) {
        blockingWarnings.push(
          buildBiCustomReportWarning(
            BI_CUSTOM_REPORT_WARNING_CODES.REQUIRED_DATASOURCE_UNAVAILABLE,
            'blocking',
            `数据源 "${sourceKey}" 不可用`,
            { sourceKey },
          ),
        )
        continue
      }

      const hasPermission = dsDef.permissionTags.some((tag) =>
        BiCustomReportPolicy.canViewDataSource(actor, tag),
      )
      if (!hasPermission) {
        blockingWarnings.push(
          buildBiCustomReportWarning(
            BI_CUSTOM_REPORT_WARNING_CODES.PERMISSION_DENIED_SOURCE,
            'blocking',
            `无权访问数据源 "${sourceKey}"`,
            { sourceKey },
          ),
        )
        blockedReasons.push(`无权访问数据源 "${sourceKey}"`)
        continue
      }

      authorizedSources.push(sourceKey)
    }

    if (authorizedSources.length === 0) {
      return this.buildBlockedResult(
        input,
        blockingWarnings,
        blockedReasons,
        sourceHashes,
        generatedAt,
      )
    }

    // 6. 字段级权限脱敏
    const fieldPermissionMap = new Map<string, string | undefined>()
    for (const sourceKey of authorizedSources) {
      const dsDef = biCustomReportDataSourceRegistry.get(sourceKey)
      if (dsDef) {
        for (const f of dsDef.fields) {
          fieldPermissionMap.set(f.fieldKey, f.permissionTag)
        }
      }
    }

    const { visible, redacted } = BiCustomReportPolicy.filterFieldsByPermission(
      actor,
      input.fields,
      fieldPermissionMap,
    )

    if (redacted.length > 0) {
      warnings.push(
        buildBiCustomReportWarning(
          BI_CUSTOM_REPORT_WARNING_CODES.PARTIAL_REDACTION,
          'warning',
          `${redacted.length} 个字段因权限不足被脱敏`,
        ),
      )
    }

    // 7. 生成 sourceHash
    for (const sourceKey of authorizedSources) {
      sourceHashes[sourceKey] = `src_${sourceKey}_${Date.now().toString(36)}`
    }

    // 8. 生成预览数据（fixture 模拟）
    for (const sourceKey of authorizedSources) {
      const dsDef = biCustomReportDataSourceRegistry.get(sourceKey)
      if (!dsDef) continue

      // 生成示例行
      for (let i = 0; i < Math.min(5, BI_CUSTOM_REPORT_LIMITS.PREVIEW_MAX_ROWS); i++) {
        const cells: Record<string, unknown> = {}
        for (const field of visible.slice(0, 5)) {
          const fieldDef = dsDef.fields.find((f) => f.fieldKey === field)
          if (fieldDef) {
            switch (fieldDef.type) {
              case 'number':
                cells[field] = Math.floor(Math.random() * 100)
                break
              case 'string':
                cells[field] = `${fieldDef.name}-${i + 1}`
                break
              case 'date':
                cells[field] = new Date().toISOString().slice(0, 10)
                break
              case 'enum':
                cells[field] =
                  fieldDef.enumValues?.[i % (fieldDef.enumValues?.length ?? 1)] ?? 'unknown'
                break
              default:
                cells[field] = `value-${i + 1}`
            }
          }
        }
        rows.push({ cells })
      }

      // 生成示例 series
      if (input.visualizations.some((v) => ['line', 'bar', 'stacked_bar'].includes(v.type))) {
        const numericFields = visible.filter((f) => {
          const fd = dsDef.fields.find((ff) => ff.fieldKey === f)
          return fd?.type === 'number'
        })
        for (const nf of numericFields.slice(0, 2)) {
          series.push({
            key: nf,
            label: dsDef.fields.find((f) => f.fieldKey === nf)?.name,
            values: Array.from({ length: 6 }, () => Math.floor(Math.random() * 100)),
            labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
          })
        }
      }

      // 生成示例 cards
      if (input.visualizations.some((v) => v.type === 'metric_card')) {
        const numericFields = visible.filter((f) => {
          const fd = dsDef.fields.find((ff) => ff.fieldKey === f)
          return fd?.type === 'number'
        })
        for (const nf of numericFields.slice(0, 3)) {
          cards.push({
            key: nf,
            title: dsDef.fields.find((f) => f.fieldKey === nf)?.name,
            value: Math.floor(Math.random() * 100),
            format: 'number',
          })
        }
      }

      // Evidence refs
      evidenceRefs.push({
        sourceKey,
        sourceHash: sourceHashes[sourceKey] ?? '',
        entityType: 'data_source',
        entityId: 0,
        summary: `预览数据来自 "${dsDef.name}"（${dsDef.freshnessStrategy}）`,
        authorized: true,
      })
    }

    // 9. 空结果 warning
    if (rows.length === 0 && series.length === 0 && cards.length === 0) {
      warnings.push(
        buildBiCustomReportWarning(
          BI_CUSTOM_REPORT_WARNING_CODES.EMPTY_RESULT,
          'info',
          '预览结果为空',
        ),
      )
    }

    // 10. 判断状态
    const blocked = blockingWarnings.length > 0
    const hasWarnings = warnings.length > 0
    const hasData = rows.length > 0 || series.length > 0 || cards.length > 0

    let status: BiCustomReportPreviewResult['status'] = BI_CUSTOM_REPORT_PREVIEW_STATUS.READY
    if (blocked) {
      status = BI_CUSTOM_REPORT_PREVIEW_STATUS.BLOCKED
    } else if (!hasData || hasWarnings) {
      status = BI_CUSTOM_REPORT_PREVIEW_STATUS.PARTIAL
    }

    return {
      status,
      definitionHash,
      rows,
      series,
      cards,
      warnings: [...blockingWarnings, ...warnings],
      freshness: {
        generatedAt,
        status: 'fresh',
        ttlMinutes: 5,
      },
      sourceHashes,
      blocked,
      blockedReasons,
      evidenceRefs,
      generatedAt,
    }
  }

  private buildBlockedResult(
    input: PreviewInput,
    blockingWarnings: BiCustomReportWarning[],
    blockedReasons: string[],
    sourceHashes: Record<string, string>,
    generatedAt: string,
  ): BiCustomReportPreviewResult {
    const definitionHash = computeBiCustomReportDefinitionHash({
      dataSources: input.dataSources,
      fields: input.fields,
      filters: input.filters ?? [],
      groups: input.groups ?? [],
      sorts: input.sorts ?? [],
      visualizations: input.visualizations,
    })

    return {
      status: BI_CUSTOM_REPORT_PREVIEW_STATUS.BLOCKED,
      definitionHash,
      rows: [],
      series: [],
      cards: [],
      warnings: blockingWarnings,
      freshness: { generatedAt, status: 'unknown' },
      sourceHashes,
      blocked: true,
      blockedReasons,
      evidenceRefs: [],
      generatedAt,
    }
  }
}

export const biCustomReportPreviewService = new BiCustomReportPreviewService()
