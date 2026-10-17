/**
 * v3-pmo-decision-intelligence-workbench —— PmoDecisionPosition Model（tasks 3.2）。
 *
 * 参与者立场：一人一 case 一条；note 有界（≤500 字符），审计只引用 noteHash；
 * case 终态后服务层拒绝修改。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class PmoDecisionPosition extends BaseModel {
  public static table = 'pmo_decision_positions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare caseId: number

  @column()
  declare participantId: number

  @column()
  declare stance: 'support' | 'oppose' | 'abstain'

  @column()
  declare note: string | null

  @column()
  declare noteHash: string | null

  @column()
  declare revision: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 组织隔离 scope。 */
  static forOrganization(query: ReturnType<typeof PmoDecisionPosition.query>, orgId: number) {
    return query.where('organizationId', orgId)
  }
}
