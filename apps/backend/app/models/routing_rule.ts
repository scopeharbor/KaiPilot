/**
 * v2-5-compiler-dynamic-routing-management-ui（切片 B, task 5.1）—— RoutingRuleModel。
 *
 * 经治理落库的用户编排路由规则。与代码 DEFAULT_RULES 经同一 #validateAndRegister 闸门。
 * 组织隔离：所有查询经 organization_id 过滤。规则变更不改已开始 run 的绑定 decision。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class RoutingRuleModel extends BaseModel {
  public static table = 'routing_rules'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare ruleId: string

  @column()
  declare versionMajor: number

  @column()
  declare versionMinor: number

  @column()
  declare compatibleMin: string

  @column()
  declare compatibleMax: string

  @column(jsonColumn)
  declare scenarioKinds: string[]

  @column(jsonColumn)
  declare allowedStageIds: string[]

  @column(jsonColumn)
  declare allowedSkippedStageIds: string[]

  @column()
  declare reasonCode: string

  @column()
  declare isDefault: boolean

  @column()
  declare enabled: boolean

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
