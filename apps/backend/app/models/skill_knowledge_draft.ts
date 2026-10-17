/**
 * v3-skill-knowledge-authoring —— SkillKnowledgeDraft Lucid Model（D2）。
 *
 * 组织级知识创作草稿实体，JSON 列以 text 存，应用层 prepare/consume 解析。
 * 所有查询强制附加 organization_id 过滤（组织隔离红线）。
 */
import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'
import User from './user.js'
import CompilerSkill from './compiler_skill.js'
import type { KnowledgeSection, AuthoringDraftStatus } from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class SkillKnowledgeDraft extends BaseModel {
  public static table = 'skill_knowledge_drafts'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare skillId: number

  @column(jsonColumn)
  declare sections: KnowledgeSection[]

  @column()
  declare baseVersion: string

  @column()
  declare status: AuthoringDraftStatus

  @column()
  declare aiAssisted: boolean

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

  @belongsTo(() => CompilerSkill, { foreignKey: 'skillId' })
  declare skill: BelongsTo<typeof CompilerSkill>

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
   * 按 Skill ID 查找（已作用域至组织）。
   */
  static forOrganizationBySkill(organizationId: number, skillId: number) {
    return this.query().where('organization_id', organizationId).where('skill_id', skillId)
  }

  /**
   * 查找当前 pending 草稿（已作用域至组织）。
   */
  static pendingForSkill(organizationId: number, skillId: number) {
    return this.query()
      .where('organization_id', organizationId)
      .where('skill_id', skillId)
      .where('status', 'pending')
      .first()
  }
}
