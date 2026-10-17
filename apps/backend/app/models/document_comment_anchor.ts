import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'
import Project from './project.js'
import Document from './document.js'
import Comment from './comment.js'
import User from './user.js'

/**
 * 文档内联批注锚点模型。
 * 关联 organization/project/document/root comment，存储版本感知的锚点元数据。
 */
export default class DocumentCommentAnchor extends BaseModel {
  static table = 'document_comment_anchors'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare documentId: number

  @column()
  declare rootCommentId: number

  @column()
  declare documentVersion: string

  @column()
  declare contentHash: string

  @column()
  declare rangeStart: number

  @column()
  declare rangeEnd: number

  @column()
  declare selectedQuote: string

  @column()
  declare prefixHash: string

  @column()
  declare suffixHash: string

  @column()
  declare headingPath: string | null

  @column()
  declare staleStatus: string

  @column()
  declare staleReason: string | null

  @column()
  declare isHidden: boolean

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => Document, { foreignKey: 'documentId' })
  declare document: BelongsTo<typeof Document>

  @belongsTo(() => Comment, { foreignKey: 'rootCommentId' })
  declare rootComment: BelongsTo<typeof Comment>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>
}
