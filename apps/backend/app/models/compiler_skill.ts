/**
 * v3-skill-registry-and-lifecycle —— CompilerSkill Lucid Model（D1/D5）。
 *
 * 组织级 Skill 实体，JSON 列以 text 存，应用层 prepare/consume 解析。
 * 所有查询强制附加 organization_id 过滤（组织隔离红线）。
 */
import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'
import User from './user.js'
import type {
  SkillLifecycleStatus,
  SkillCategory,
  ActivationRule,
  KnowledgeBundle,
  SkillProvenance,
} from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class CompilerSkill extends BaseModel {
  public static table = 'compiler_skills'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare skillKey: string

  @column()
  declare name: string

  @column()
  declare version: string

  @column()
  declare description: string

  @column()
  declare status: SkillLifecycleStatus

  /**
   * 官方内置标记（D1）：true = 内置预置，组织用户不可硬删/不可编辑/不可运行时转移。
   * 不进共享 Skill 契约（toSkill 不投影），由 controller toDto 局部扩展。
   * SQLite 以 1/0 存储 boolean，consume 时显式转回布尔（与 User.isActive 同一范式）。
   */
  @column({
    prepare: (value: boolean) => value,
    consume: (value: boolean | number) => Boolean(value),
  })
  declare isBuiltin: boolean

  @column(jsonColumn)
  declare category: SkillCategory

  @column(jsonColumn)
  declare tags: string[]

  @column(jsonColumn)
  declare dependencies: string[]

  @column(jsonColumn)
  declare activation: ActivationRule

  @column(jsonColumn)
  declare knowledge: KnowledgeBundle

  @column(jsonColumn)
  declare provenance: SkillProvenance | null

  @column()
  declare basePriority: number

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // ── 关联 ──

  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  // ── 组织隔离查询 ──

  /**
   * 组织作用域查询。
   */
  static forOrganization(organizationId: number) {
    return this.query().where('organization_id', organizationId)
  }

  /**
   * 按 skillKey 查找（已作用域至组织）。
   */
  static forOrganizationByKey(organizationId: number, skillKey: string) {
    return this.query()
      .where('organization_id', organizationId)
      .where('skill_key', skillKey)
      .first()
  }
}
