import { OrganizationSchema } from '#database/schema'
import User from '#models/user'
import OrganizationMember from '#models/organization_member'
import {
  beforeFetch,
  beforeFind,
  belongsTo,
  column,
  hasMany,
  manyToMany,
} from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'

/**
 * 组织模型（基于自动生成的 OrganizationSchema 基类）。
 */
export default class Organization extends OrganizationSchema {
  declare id: number // 与 schema 基类一致；显式声明便于阅读（见 database/schema_rules.ts）

  @belongsTo(() => User, { foreignKey: 'ownerId' })
  declare owner: BelongsTo<typeof User>

  @hasMany(() => OrganizationMember, { foreignKey: 'organizationId' })
  declare organizationMembers: HasMany<typeof OrganizationMember>

  @manyToMany(() => User, {
    pivotTable: 'organization_members',
    localKey: 'id',
    pivotForeignKey: 'organization_id',
    relatedKey: 'id',
    pivotRelatedForeignKey: 'user_id',
    pivotColumns: ['role', 'permissions', 'invited_by'],
  })
  declare members: ManyToMany<typeof User>

  @column({
    prepare: (value) => (value === null || value === undefined ? null : JSON.stringify(value)),
    consume: (value) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? JSON.parse(value)
          : value,
    serialize: (value) => value,
  })
  declare settings: Record<string, unknown> | null

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Organization>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Organization>) {
    query.whereNull('deleted_at')
  }
}
