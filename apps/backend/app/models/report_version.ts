import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type {
  V2ReportTemplateId,
  ReportWarningV2,
  ReportAiReviewStatus,
  AiReviewAction,
} from '@aiproj/types'

/**
 * ReportVersion —— V2 报表版本快照（report_versions 表）。
 *
 * 每次生成报表创建一条新版本记录，保存参数、数据源 hash、snapshotHash、warnings、
 * AI 草稿与审核状态。版本记录作为事实资产长期保留。
 *
 * V2 AI 周期报表扩展：periodType、prevDateRange、aiDraftRef、inputSourceHashes、
 * modelSummary、costSummary、attempt、idempotencyKey、reviewNotes、reviewAction、
 * returnedAt、returnedBy。
 */
export default class ReportVersion extends BaseModel {
  static table = 'report_versions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare reportId: number | null

  @column()
  declare templateId: V2ReportTemplateId

  @column()
  declare templateVersion: string

  @column()
  declare title: string

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | Record<string, unknown> | null) => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare dateRange: Record<string, unknown> | null

  // 周期报表字段
  @column()
  declare periodType: string | null

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | Record<string, unknown> | null) => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare prevDateRange: Record<string, unknown> | null

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | Record<string, unknown> | null) => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare filters: Record<string, unknown> | null

  @column({
    prepare: (value: Record<string, string> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | Record<string, string> | null) => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare dataSourceHashes: Record<string, string> | null

  @column()
  declare snapshotHash: string

  @column({
    prepare: (value: ReportWarningV2[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | ReportWarningV2[] | null) => {
      if (!value) return []
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare warnings: ReportWarningV2[]

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | Record<string, unknown> | null) => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare documentRef: Record<string, unknown> | null

  @column()
  declare aiDraft: string | null

  @column()
  declare aiReviewStatus: ReportAiReviewStatus | null

  @column()
  declare aiDraftRef: string | null

  @column({
    prepare: (value: string[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | string[] | null) => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare inputSourceHashes: string[] | null

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | Record<string, unknown> | null) => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare modelSummary: Record<string, unknown> | null

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | Record<string, unknown> | null) => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare costSummary: Record<string, unknown> | null

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | Record<string, unknown> | null) => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare aiCostRef: Record<string, unknown> | null

  @column()
  declare attempt: number | null

  @column()
  declare idempotencyKey: string | null

  @column()
  declare reviewNotes: string | null

  @column()
  declare reviewAction: AiReviewAction | null

  @column()
  declare generatedBy: number | null

  @column.dateTime()
  declare generatedAt: DateTime

  @column.dateTime()
  declare confirmedAt: DateTime | null

  @column()
  declare confirmedBy: number | null

  @column.dateTime()
  declare returnedAt: DateTime | null

  @column()
  declare returnedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @beforeFind()
  static filterOrganization(_query: ModelQueryBuilderContract<typeof ReportVersion>) {
    // 调用方必须显式添加 organization_id 过滤
  }

  @beforeFetch()
  static filterOrganizationFetch(_query: ModelQueryBuilderContract<typeof ReportVersion>) {
    // 调用方必须显式添加 organization_id 过滤
  }
}
