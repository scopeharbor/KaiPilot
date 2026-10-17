/**
 * v3-chart-gallery-data-foundation —— Department Model（W1.4）。
 *
 * OBS 组织分解结构部门树：
 * - 自引用 parent / children 树形关系；组织维度物理隔离（organization_id）
 * - path 为物化路径（如 `/1/4/12/`），depth 为层级深度（根为 0），服务层负责维护；
 *   本模型提供静态辅助 childPathOf / childDepthOf 保证两者一致
 * - leader 为部门负责人（users 可选）；creator 为建部门操作人
 */
import { BaseModel, beforeFetch, beforeFind, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'
import User from './user.js'

export default class Department extends BaseModel {
  public static table = 'departments'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare parentId: number | null

  @column()
  declare name: string

  @column()
  declare code: string

  @column()
  declare description: string | null

  @column()
  declare leaderId: number | null

  @column()
  declare sortOrder: number

  /** 物化路径，如 `/1/4/12/`。 */
  @column()
  declare path: string

  /** 层级深度：根部门为 0。 */
  @column()
  declare depth: number

  @column()
  declare createdBy: number

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /**
   * 计算子节点物化路径：父路径 + 子 id + '/'。
   * 根部门（无父节点）传 parentPath=null，得到 `/<rootId>/`。
   */
  public static childPathOf(parentPath: string | null | undefined, childId: number): string {
    const base = parentPath && parentPath.endsWith('/') ? parentPath : '/'
    return `${base}${childId}/`
  }

  /** 计算子节点深度：父深度 + 1（根部门父深度传 null，结果为 0）。 */
  public static childDepthOf(parentDepth: number | null | undefined): number {
    return (parentDepth ?? -1) + 1
  }

  // ── 关联 ──
  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>

  /** 父部门（自引用）。 */
  @belongsTo(() => Department, { foreignKey: 'parentId' })
  declare parent: BelongsTo<typeof Department>

  /** 直接子部门（自引用）。 */
  @hasMany(() => Department, { foreignKey: 'parentId' })
  declare children: HasMany<typeof Department>

  /** 部门负责人（可选）。 */
  @belongsTo(() => User, { foreignKey: 'leaderId' })
  declare leader: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Department>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Department>) {
    query.whereNull('deleted_at')
  }
}
