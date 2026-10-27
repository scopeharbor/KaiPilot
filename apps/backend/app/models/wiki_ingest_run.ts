import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { WikiIngestRunStatus, WikiRunKind } from '@aiproj/types'

/**
 * wiki_ingest_runs（v3-llm-wiki-ingest-pipeline）。组织隔离：所有查询必须附加 organization_id。
 * 只存计数与低敏标识，不存提示词、模型输出或原料正文。
 */
export default class WikiIngestRun extends BaseModel {
  static table = 'wiki_ingest_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare spaceId: number

  /** ingest（项目编入）/ process_interpret（流程页 AI 解读）。 */
  @column()
  declare runKind: WikiRunKind

  @column()
  declare triggerKind: 'manual' | 'command'

  @column()
  declare status: WikiIngestRunStatus

  @column()
  declare cursorFromAuditId: number

  @column()
  declare cursorToAuditId: number | null

  @column()
  declare eventsCount: number

  @column()
  declare pagesTouched: number

  @column()
  declare proposalsCreated: number

  @column()
  declare opsAccepted: number

  @column()
  declare opsRejected: number

  @column()
  declare pagesFailed: number

  @column({ consume: (v: unknown) => v === true || v === 1 || v === '1' })
  declare hasMore: boolean

  @column()
  declare tokensUsed: number

  @column()
  declare modelProvider: string | null

  @column()
  declare modelName: string | null

  @column()
  declare errorCode: string | null

  @column()
  declare idempotencyKey: string | null

  @column()
  declare triggeredBy: number | null

  @column.dateTime()
  declare startedAt: DateTime | null

  @column.dateTime()
  declare finishedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
