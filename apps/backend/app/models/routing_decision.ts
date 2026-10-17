/**
 * v2-5-compiler-dynamic-routing-management-ui（切片 A, task 3.1）—— RoutingDecisionModel。
 *
 * 把 per-run routing decision 证据持久化为低敏 evidence。写入前经
 * routingDecisionContainsSensitiveFields() 守卫，只存 refs/enums/counts/hash + 稳定 stage id 枚举。
 *
 * 组织隔离：所有查询经 organization_id 过滤。decision 绑定 compiler_run_id。
 */
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import CompilerRun from './compiler_run.js'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class RoutingDecisionModel extends BaseModel {
  public static table = 'routing_decisions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare compilerRunId: number

  @column()
  declare inputHash: string

  @column()
  declare ruleId: string | null

  @column()
  declare ruleVersion: string | null

  @column()
  declare scenarioKind: string

  @column()
  declare reasonCode: string

  @column()
  declare selectedStageCount: number

  @column()
  declare originalStageCount: number

  @column()
  declare isFallback: boolean

  @column(jsonColumn)
  declare selectedStageIds: string[]

  @column(jsonColumn)
  declare skippedStageIds: string[]

  @column()
  declare actorUserId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => CompilerRun, { foreignKey: 'compilerRunId' })
  declare run: BelongsTo<typeof CompilerRun>

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
