import { TaskSchema } from '#database/schema'
import Issue from './issue.js'
import Project from './project.js'
import RequirementTask from './requirement_task.js'
import User from './user.js'
import WbsNode from './wbs_node.js'
import TaskDependency from './task_dependency.js'
import TaskResourceRequirement from './task_resource_requirement.js'
import { beforeFetch, beforeFind, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

/** JSON 列序列化：数组/对象 ↔ TEXT（SQLite）或 json（PG）。 */
const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

/**
 * 任务模型（基于自动生成的 TaskSchema 基类）。
 *
 * 扩展：项目/负责人/审核人/父子树关系，软删除默认作用域（whereNull deleted_at）。
 * 金额字段 cost_*_cents 经 schema 基类以 bigint 存储（DEBT-01，以「分」整数）。
 *
 * V3 扩展：
 * - assignee_type: 区分真人（user）与 AI Agent（agent）负责人
 * - 当 assigneeType = 'agent' 时，assignee_id 仍指向 users 表（Agent 也注册为用户）
 *
 * 注：wbsNode / milestone 关系待对应模型建立后补（T014 WBS / T023 里程碑），
 * 此处 wbs_node_id / milestone_id 仅作外键 ID 透传。
 */
export default class Task extends TaskSchema {
  declare id: number // 与 schema 基类一致；显式声明便于阅读（见 database/schema_rules.ts）

  /**
   * V3：负责人类型（user | agent），区分真人与 AI Copilot。
   * 默认 'user'，向后兼容。
   */
  @column()
  declare assigneeType: string

  /**
   * V3 图表馆 RACI（W1.5）：咨询方（Consulted）用户 ID 数组（JSON，默认 '[]'）。
   */
  /**
   * 自定义字段（JSON）：含阻塞原因 blockedReason / blockedAt / blockedBy。
   * 基类未声明序列化，SQLite 上写对象会直接报错（PG 驱动自动转换才一直没暴露）。
   */
  @column(jsonColumn)
  declare customFields: Record<string, unknown> | null

  @column(jsonColumn)
  declare consultedUserIds: number[]

  /**
   * V3 图表馆 RACI（W1.5）：知会方（Informed）用户 ID 数组（JSON，默认 '[]'）。
   */
  @column(jsonColumn)
  declare informedUserIds: number[]

  /**
   * V3 图表馆 LOB（W1.5）：物理空间单元 / 施工区段 / 批次标识（如 "Floor-1"）。
   */
  @column()
  declare locationUnit: string | null

  /**
   * V3 图表馆 LOB（W1.5）：流水工序阶段（如 "结构施工"）。
   */
  @column()
  declare cycleStage: string | null

  /**
   * 显式绕过默认软删除作用域的唯一入口。调用方仍必须附加 project/tenant 范围。
   */
  static queryWithTrashed(client?: TransactionClientContract) {
    return (client ?? db).from('tasks')
  }

  static queryOnlyTrashed(client?: TransactionClientContract) {
    return this.queryWithTrashed(client).whereNotNull('deleted_at')
  }

  /** 所属项目。 */
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  /**
   * 负责人（仅 user 类型；agent 类型的分配记录存储在 agent_assignments 表）。
   * 当 assigneeType = 'agent' 时，assignee_id 仍可指向注册为用户的 Agent 账号。
   */
  @belongsTo(() => User, { foreignKey: 'assigneeId' })
  declare assignee: BelongsTo<typeof User>

  /** 审核人。 */
  @belongsTo(() => User, { foreignKey: 'reviewerId' })
  declare reviewer: BelongsTo<typeof User>

  /** 父任务（自引用，构建子任务树，最多 3 级）。 */
  @belongsTo(() => Task, { foreignKey: 'parentTaskId' })
  declare parent: BelongsTo<typeof Task>

  /** 直接子任务。 */
  @hasMany(() => Task, { foreignKey: 'parentTaskId' })
  declare subtasks: HasMany<typeof Task>

  /** 可选关联的项目 WBS 节点。 */
  @belongsTo(() => WbsNode, { foreignKey: 'wbsNodeId' })
  declare wbsNode: BelongsTo<typeof WbsNode>

  /** 本任务作为前置任务的依赖。 */
  @hasMany(() => TaskDependency, { foreignKey: 'predecessorId' })
  declare successorDependencies: HasMany<typeof TaskDependency>

  /** 本任务作为后续任务的依赖。 */
  @hasMany(() => TaskDependency, { foreignKey: 'successorId' })
  declare predecessorDependencies: HasMany<typeof TaskDependency>

  /** V2 资源需求，不改变任务负责人或正式分配。 */
  @hasMany(() => TaskResourceRequirement, { foreignKey: 'taskId' })
  declare resourceRequirements: HasMany<typeof TaskResourceRequirement>

  /**
   * V3 图表馆领域关系（W1.5）。
   */
  /** 需求-任务关联记录（RTM 矩阵任务侧）。 */
  @hasMany(() => RequirementTask, { foreignKey: 'taskId' })
  declare requirementTasks: HasMany<typeof RequirementTask>

  /** 关联到本任务的议题与缺陷（issues.related_task_id）。 */
  @hasMany(() => Issue, { foreignKey: 'relatedTaskId' })
  declare issues: HasMany<typeof Issue>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Task>) {
    // 带表名：与 projects 等同样有 deleted_at 的表 join 时，PG 报「column reference is ambiguous」（SQLite 容忍）。
    query.whereNull('tasks.deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Task>) {
    query.whereNull('tasks.deleted_at')
  }
}
