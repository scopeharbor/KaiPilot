import Project from '#models/project'
import User from '#models/user'
import Organization from '#models/organization'
import Task from '#models/task'
import CommentMention from '#models/comment_mention'
import { beforeFetch, beforeFind, belongsTo, column, computed, hasMany } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import { BaseModel } from '@adonisjs/lucid/orm'

/**
 * 评论模型（v2-collaboration-comments-mentions）。
 *
 * V2 统一实体评论，覆盖 project/task/milestone/risk/file/change_request。
 * 支持一级回复线程（parent_id）、状态（open/resolved）、结构化 @提及。
 *
 * V2 扩展（与 V1 兼容）：
 * - entity_type + entity_id 取代 task_id 多态（task_id 保留可空兼容）
 * - parent_id 正式启用为一级回复
 * - status/open/resolved 线程状态
 * - resolved_by/resolved_at 解决记录
 * - body/body_format/edited_at/deleted_at 保持 V1 语义
 */
export default class Comment extends BaseModel {
  static table = 'comments'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  /** V1 兼容：任务级评论绑定；V2 优先使用 entity_type='task' */
  @column()
  declare taskId: number | null

  /** 多态实体类型（V2 启用）：project/task/milestone/risk/file/change_request */
  @column()
  declare entityType: string | null

  /** 多态实体 ID（V2 启用） */
  @column()
  declare entityId: number | null

  @column()
  declare authorId: number

  /** V3：作者类型（user | agent），区分真人与 Copilot */
  @column()
  declare authorType: string

  /** 评论正文（软删除后不暴露） */
  @column()
  declare body: string | null

  /** 正文格式：plain | markdown */
  @column()
  declare bodyFormat: string

  /** 回复父评论 ID（一级回复） */
  @column()
  declare parentId: number | null

  /** 线程状态：open / resolved */
  @column()
  declare status: string

  /** 解决操作者 */
  @column()
  declare resolvedBy: number | null

  /** 解决时间 */
  @column.dateTime()
  declare resolvedAt: DateTime | null

  /** 编辑时间（NULL 表示从未编辑） */
  @column.dateTime()
  declare editedAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  /** 删除操作者 */
  @column()
  declare deletedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ---------------------------------------------------------------------------
  // 关系
  // ---------------------------------------------------------------------------

  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => Task, { foreignKey: 'taskId' })
  declare task: BelongsTo<typeof Task> | null

  @belongsTo(() => User, { foreignKey: 'authorId' })
  declare author: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'deletedBy' })
  declare deleter: BelongsTo<typeof User> | null

  /** V2：提及记录 */
  @hasMany(() => CommentMention, { foreignKey: 'commentId' })
  declare mentions: HasMany<typeof CommentMention>

  /** V2：回复（子评论） */
  @hasMany(() => Comment, { foreignKey: 'parentId' })
  declare replies: HasMany<typeof Comment>

  /** V2：父评论 */
  @belongsTo(() => Comment, { foreignKey: 'parentId' })
  declare parent: BelongsTo<typeof Comment> | null

  /** V2：解决操作者 */
  @belongsTo(() => User, { foreignKey: 'resolvedBy' })
  declare resolver: BelongsTo<typeof User> | null

  // ---------------------------------------------------------------------------
  // 计算属性
  // ---------------------------------------------------------------------------

  /** 是否已软删除 */
  @computed()
  get isDeleted(): boolean {
    return !!this.deletedAt
  }

  /** 是否已编辑过 */
  @computed()
  get isEdited(): boolean {
    return !!this.editedAt
  }

  /** 目标类型：基于 entity_type，回退 task_id */
  @computed()
  get targetType(): string {
    if (this.entityType) return this.entityType
    return this.taskId === null ? 'project' : 'task'
  }

  /** 是否已解决 */
  @computed()
  get isResolved(): boolean {
    return this.status === 'resolved'
  }

  // ---------------------------------------------------------------------------
  // 序列化：软删除评论不暴露正文
  // ---------------------------------------------------------------------------

  serialize() {
    const data = super.serialize()
    if (this.deletedAt) {
      data.body = null
    }
    return data
  }

  // ---------------------------------------------------------------------------
  // 默认作用域：排除软删除
  // ---------------------------------------------------------------------------

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Comment>) {
    query.whereNull('comments.deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Comment>) {
    // @ts-ignore - __withTrashed 标志用于 queryWithTrashed 跳过软删除过滤
    if (!(query as unknown as { __withTrashed?: boolean }).__withTrashed) {
      query.whereNull('comments.deleted_at')
    }
  }

  /**
   * 包含软删除评论的查询（用于管理场景）。
   */
  static queryWithTrashed() {
    const qb = this.query() as unknown as { __withTrashed: boolean } & ModelQueryBuilderContract<
      typeof Comment
    >
    qb.__withTrashed = true
    return qb as unknown as ModelQueryBuilderContract<typeof Comment>
  }

  /**
   * 仅查询软删除评论。
   */
  static queryOnlyTrashed() {
    const qb = this.queryWithTrashed()
    qb.whereNotNull('comments.deleted_at')
    return qb
  }
}
