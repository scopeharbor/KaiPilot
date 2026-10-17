/**
 * v3-pmo-decision-intelligence-workbench —— PmoDecisionOutcome Model（tasks 3.2）。
 *
 * 人工结论：终态结论不可改（服务层保证）；outcome_digest 唯一约束提供幂等；
 * rationale 只存本业务表且长度有界，审计不复制。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { PmoDecisionOutcomeAction } from '@aiproj/types'

export default class PmoDecisionOutcome extends BaseModel {
  public static table = 'pmo_decision_outcomes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare caseId: number

  @column()
  declare action: PmoDecisionOutcomeAction

  @column()
  declare selectedOptionId: number | null

  @column()
  declare supersededByCaseId: number | null

  @column()
  declare snapshotHash: string

  @column()
  declare reviewFingerprint: string

  @column()
  declare outcomeDigest: string

  @column()
  declare rationale: string | null

  @column({
    prepare: (value: string[] | null | undefined): string => JSON.stringify(value ?? []),
    consume: (value: unknown): string[] => {
      if (Array.isArray(value)) return value as string[]
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
      return []
    },
  })
  declare acknowledgedWarnings: string[]

  @column()
  declare actorId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 组织隔离 scope。 */
  static forOrganization(query: ReturnType<typeof PmoDecisionOutcome.query>, orgId: number) {
    return query.where('organizationId', orgId)
  }
}
