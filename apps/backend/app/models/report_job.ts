import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { V2ReportTemplateId, ReportJobStatus } from '@aiproj/types'

/**
 * ReportJob —— V2 报表生成任务（report_jobs 表）。
 *
 * 任务状态机：queued → running → succeeded/failed/cancelled
 * 幂等 key：同一组织同一 key 禁止重复创建
 * attempt：可恢复失败形成新 attempt，非覆盖
 */
export default class ReportJob extends BaseModel {
  static table = 'report_jobs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare reportId: number | null

  @column()
  declare versionId: number | null

  @column()
  declare templateId: V2ReportTemplateId

  @column()
  declare requestedBy: number

  @column()
  declare status: ReportJobStatus

  @column()
  declare attempt: number

  @column()
  declare idempotencyKey: string | null

  @column()
  declare progress: string | null

  @column()
  declare errorCategory: string | null

  @column()
  declare errorDetail: string | null

  @column.dateTime()
  declare startedAt: DateTime | null

  @column.dateTime()
  declare finishedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @beforeFind()
  static filterOrganization(_query: ModelQueryBuilderContract<typeof ReportJob>) {
    // 调用方必须显式添加 organization_id 过滤
  }

  @beforeFetch()
  static filterOrganizationFetch(_query: ModelQueryBuilderContract<typeof ReportJob>) {
    // 调用方必须显式添加 organization_id 过滤
  }
}
