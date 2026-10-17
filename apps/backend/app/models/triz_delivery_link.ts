/**
 * v3-triz-to-delivery-closed-loop —— TrizDeliveryLink Model（task 3.5）。
 *
 * 宿主拥有的闭环关联记录：TRIZ decision ↔ 正式交付实体的低敏可追溯关联。
 * 只存 refs/hash/枚举/短摘要；组织隔离走 forOrganization；
 * 更正只允许通过 supersession 追加新行（task 3.6 的 guard 在 Service 层 + 此处约束）。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { TrizDlEntityRef, TrizDlLinkMode } from '@aiproj/types'

export interface TrizDeliveryLinkSourceHashes {
  schemeHash?: string
  contradictionSignatures?: string[]
  analysisContentHashes?: string[]
}

const jsonArrayColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class TrizDeliveryLink extends BaseModel {
  public static table = 'triz_delivery_links'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare decisionLogId: number

  @column()
  declare draftSessionId: number | null

  @column()
  declare applyResultId: number | null

  @column()
  declare schemeId: string | null

  @column(jsonArrayColumn)
  declare optionIds: string[] | null

  @column(jsonArrayColumn)
  declare sourceHashes: TrizDeliveryLinkSourceHashes | null

  @column(jsonArrayColumn)
  declare deliveryRefs: TrizDlEntityRef[]

  @column(jsonArrayColumn)
  declare contextRefs: TrizDlEntityRef[]

  @column()
  declare linkMode: TrizDlLinkMode

  @column()
  declare previewFingerprint: string | null

  @column()
  declare linkDigest: string

  @column()
  declare supersedesLinkId: number | null

  @column()
  declare supersededByLinkId: number | null

  @column()
  declare actorUserId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
