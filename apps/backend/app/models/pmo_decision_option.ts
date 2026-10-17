/**
 * v3-pmo-decision-intelligence-workbench —— PmoDecisionOption Model（tasks 3.2）。
 *
 * 候选方案：2–5 active 边界由 DecisionOptionService 保证；revision 参与
 * review fingerprint 绑定；JSON 列只承载有界 refs/文本。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/** JSON 数组列的序列化边界（SQLite/PG 兼容）。 */
function jsonArrayColumn() {
  return {
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
  }
}

export default class PmoDecisionOption extends BaseModel {
  public static table = 'pmo_decision_options'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare caseId: number

  @column()
  declare label: string

  @column(jsonArrayColumn())
  declare assumptions: string[]

  @column(jsonArrayColumn())
  declare constraints: string[]

  @column(jsonArrayColumn())
  declare affectedProjectRefs: string[]

  @column()
  declare proposedOutcomeCategory: string

  @column(jsonArrayColumn())
  declare evidenceRefs: string[]

  @column()
  declare revision: number

  @column()
  declare active: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 组织隔离 scope。 */
  static forOrganization(query: ReturnType<typeof PmoDecisionOption.query>, orgId: number) {
    return query.where('organizationId', orgId)
  }
}
