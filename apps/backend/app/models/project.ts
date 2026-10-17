import { ProjectSchema } from '#database/schema'
import CommunicationPlan from './communication_plan.js'
import Department from './department.js'
import Issue from './issue.js'
import Organization from './organization.js'
import ProjectCharter from './project_charter.js'
import ProjectMember from './project_member.js'
import ProjectRole from './project_role.js'
import ProjectStakeholder from './project_stakeholder.js'
import Requirement from './requirement.js'
import User from './user.js'
import WbsNode from './wbs_node.js'
import { beforeFetch, beforeFind, belongsTo, column, hasMany, hasOne } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany, HasOne } from '@adonisjs/lucid/types/relations'

/**
 * 项目模型（基于自动生成的 ProjectSchema 基类）。
 *
 * 扩展关系与 JSON 序列化：organization/creator 归属、members/roles/milestones
 * 一对多，settings 为项目级配置（工作日历等）。
 */
export default class Project extends ProjectSchema {
  declare id: number // 与 schema 基类一致；显式声明便于阅读（见 database/schema_rules.ts）

  /**
   * 项目所属组织。
   */
  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>

  /**
   * V3 图表馆：项目挂载的 OBS 部门（W1.5，department_id 列）。
   */
  @column()
  declare departmentId: number | null

  /** 项目所属 OBS 部门。 */
  @belongsTo(() => Department, { foreignKey: 'departmentId' })
  declare department: BelongsTo<typeof Department>

  /**
   * 项目创建者。
   */
  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  /**
   * 项目最后更新者。
   */
  @belongsTo(() => User, { foreignKey: 'updatedBy' })
  declare updater: BelongsTo<typeof User>

  /**
   * 项目成员列表。
   */
  @hasMany(() => ProjectMember, { foreignKey: 'projectId' })
  declare members: HasMany<typeof ProjectMember>

  /**
   * 项目角色列表。
   */
  @hasMany(() => ProjectRole, { foreignKey: 'projectId' })
  declare roles: HasMany<typeof ProjectRole>

  /** 项目内全部 WBS 节点。 */
  @hasMany(() => WbsNode, { foreignKey: 'projectId' })
  declare wbsNodes: HasMany<typeof WbsNode>

  /** 懒初始化的项目 WBS 根节点。 */
  @belongsTo(() => WbsNode, { foreignKey: 'wbsRootId' })
  declare wbsRoot: BelongsTo<typeof WbsNode>

  /**
   * V3 图表馆领域关系（W1.5）：
   * charter / requirements / issues / stakeholders / communicationPlans。
   */
  /** 项目章程（一对一，每项目至多一份现行章程）。 */
  @hasOne(() => ProjectCharter, { foreignKey: 'projectId' })
  declare charter: HasOne<typeof ProjectCharter>

  /** 项目需求列表（RTM 需求侧）。 */
  @hasMany(() => Requirement, { foreignKey: 'projectId' })
  declare requirements: HasMany<typeof Requirement>

  /** 项目议题与缺陷列表。 */
  @hasMany(() => Issue, { foreignKey: 'projectId' })
  declare issues: HasMany<typeof Issue>

  /** 项目利害关系人登记列表。 */
  @hasMany(() => ProjectStakeholder, { foreignKey: 'projectId' })
  declare stakeholders: HasMany<typeof ProjectStakeholder>

  /** 项目沟通管理计划列表。 */
  @hasMany(() => CommunicationPlan, { foreignKey: 'projectId' })
  declare communicationPlans: HasMany<typeof CommunicationPlan>

  /**
   * 项目级配置（工作日历 / 节假日 / 时区等）。应用层以对象读写，存储层序列化为 JSON。
   * TODO-DEBT: DEBT-01 — V2 迁 PG 后可用 jsonb + GIN 索引。
   */
  @column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? JSON.parse(value)
          : value,
    serialize: (value: unknown) => value,
  })
  declare settings: Record<string, unknown> | null

  /**
   * V3 组合事实自定义字段（v3-database-schema-expansion §3.4）。
   * 有界 JSON 元数据，契约层 `validateBoundedProjectCustomFields` 在写库前二次强制
   * （拒 root array / 超限 / 可执行键 / raw SQL / HTML/script / prompt/model dump / secret-like）。
   * TODO-DEBT: DEBT-01 — V2 迁 PG 后可用 jsonb + GIN 索引。
   */
  @column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? JSON.parse(value)
          : value,
    serialize: (value: unknown) => value,
  })
  declare customFields: Record<string, unknown> | null

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Project>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Project>) {
    query.whereNull('deleted_at')
  }
}
