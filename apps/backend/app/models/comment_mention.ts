import User from '#models/user'
import Comment from '#models/comment'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import { BaseModel } from '@adonisjs/lucid/orm'

/**
 * 评论提及读模型（v2-collaboration-comments-mentions）。
 *
 * 每条提及记录一个 @用户 的引用。
 * 冗余 organization_id/project_id 便于强制租户过滤和与我有关查询。
 */
export default class CommentMention extends BaseModel {
  static table = 'comment_mentions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare commentId: number

  @column()
  declare mentionedUserId: number

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // ---------------------------------------------------------------------------
  // 关系
  // ---------------------------------------------------------------------------

  @belongsTo(() => Comment, { foreignKey: 'commentId' })
  declare comment: BelongsTo<typeof Comment>

  @belongsTo(() => User, { foreignKey: 'mentionedUserId' })
  declare mentionedUser: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>
}
