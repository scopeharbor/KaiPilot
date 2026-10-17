import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Organization from './organization.js'
import User from './user.js'
import CrossProjectAllocationItem from './cross_project_allocation_item.js'
import CrossProjectAllocationCommit from './cross_project_allocation_commit.js'

export default class CrossProjectAllocationDraft extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare name: string

  @column()
  declare status: string

  @column({
    prepare: (value: Record<string, unknown>) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : null),
  })
  declare queryShape: Record<string, unknown>

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare sourceSignatures: Record<string, string> | null

  @column()
  declare previewHash: string | null

  @column.dateTime()
  declare previewExpiresAt: DateTime | null

  @column()
  declare idempotencyKeyHash: string | null

  @column({
    prepare: (value: unknown[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare warnings: unknown[] | null

  @column()
  declare actorId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>

  // 值导入 + 惰性回调是仓库处理模型循环引用的既有范式（见 project_member.ts）；
  // 原先的 `import(...).then(m => m.default) as any` 返回 Promise，Lucid 关系 boot 期
  // 拿到的是 Promise 而非模型类（relatedModel.boot is not a function），preload 必炸。
  @hasMany(() => CrossProjectAllocationItem, {
    foreignKey: 'draftId',
  })
  declare items: HasMany<typeof CrossProjectAllocationItem>

  @hasMany(() => CrossProjectAllocationCommit, {
    foreignKey: 'draftId',
  })
  declare commits: HasMany<typeof CrossProjectAllocationCommit>
}
