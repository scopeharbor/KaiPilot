/**
 * v3-pmo-decision-intelligence-workbench —— PmoDecisionCase Model（tasks 3.2）。
 *
 * 决策议题：组织隔离；row revision 乐观锁由服务层 CAS 使用；
 * supersession 双向 refs 由事务写入。终态行不可变（服务层保证，模型不提供删除入口）。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { PmoDecisionCaseStatus } from '@aiproj/types'

export default class PmoDecisionCase extends BaseModel {
  public static table = 'pmo_decision_cases'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare title: string

  @column()
  declare decisionQuestion: string

  @column()
  declare scopeSummary: string

  @column()
  declare ownerId: number

  @column.dateTime()
  declare dueDate: DateTime | null

  @column()
  declare status: PmoDecisionCaseStatus

  @column()
  declare revision: number

  @column()
  declare supersedesCaseId: number | null

  @column()
  declare supersededByCaseId: number | null

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 组织隔离 scope：所有查询必须经过它。 */
  static forOrganization(query: ReturnType<typeof PmoDecisionCase.query>, orgId: number) {
    return query.where('organizationId', orgId)
  }
}
