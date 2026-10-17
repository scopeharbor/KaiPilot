/**
 * v3-pmo-decision-intelligence-workbench —— PmoDecisionHandoffReceipt Model（tasks 3.2）。
 *
 * 受控 handoff 回执：幂等键唯一（组织+case+target+key）；pending_target_ref 只保存
 * 下游 draft/preview 引用，不持有 apply/confirm 句柄。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { PmoDecisionHandoffStatus, PmoDecisionHandoffTarget } from '@aiproj/types'

export default class PmoDecisionHandoffReceipt extends BaseModel {
  public static table = 'pmo_decision_handoff_receipts'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare caseId: number

  @column()
  declare target: PmoDecisionHandoffTarget

  @column()
  declare idempotencyKey: string

  @column()
  declare requestHash: string

  @column()
  declare resultHash: string | null

  @column()
  declare status: PmoDecisionHandoffStatus

  @column()
  declare pendingTargetRef: string | null

  @column()
  declare failReasonCode: string | null

  @column()
  declare actorId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 组织隔离 scope。 */
  static forOrganization(query: ReturnType<typeof PmoDecisionHandoffReceipt.query>, orgId: number) {
    return query.where('organizationId', orgId)
  }
}
