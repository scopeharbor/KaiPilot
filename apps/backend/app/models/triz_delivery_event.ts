/**
 * v3-triz-to-delivery-closed-loop —— TrizDeliveryEvent Model（task 3.5）。
 *
 * append-only 事件流（verification/reopen/link supersede）。历史事件不可更新或
 * 删除——本 Model 不暴露任何常规更新路径；更正只能以 supersedes_event_id 追加新行
 * （guard 断言见 app/services/triz_delivery_loop/guards.ts，task 3.6）。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { TrizDlEventKind, TrizDlVerificationConclusion } from '@aiproj/types'

export interface TrizDeliveryObservationWindow {
  from: string
  to: string
}

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class TrizDeliveryEvent extends BaseModel {
  public static table = 'triz_delivery_events'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare linkId: number

  @column()
  declare eventKind: TrizDlEventKind

  @column()
  declare conclusion: TrizDlVerificationConclusion | null

  @column.dateTime()
  declare observationWindowFrom: DateTime | null

  @column.dateTime()
  declare observationWindowTo: DateTime | null

  @column()
  declare baselineSummary: string | null

  @column()
  declare targetSummary: string | null

  @column()
  declare actualResult: string | null

  @column()
  declare reason: string | null

  @column(jsonColumn)
  declare evidenceRefs: string[] | null

  @column()
  declare fingerprint: string

  @column()
  declare eventDigest: string

  @column()
  declare supersedesEventId: number | null

  @column()
  declare actorUserId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
