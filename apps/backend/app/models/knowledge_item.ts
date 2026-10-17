/**
 * v3-four-layer-knowledge-system —— KnowledgeItem Lucid Model（D1）。
 *
 * 四层知识底座的核心数据实体。JSON 列以 text 存，应用层 prepare/consume 解析。
 * 所有查询强制附加 organization_id 过滤（组织隔离红线）。
 *
 * 注意：L3 合成隔离由 KnowledgeService 层 enforce，模型不额外限制。
 */
import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'
import User from './user.js'
import type {
  KnowledgeLayer,
  LayerMetadata,
  KnowledgeLifecycleStatus,
  Provenance,
  ReviewRecord,
} from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

const jsonStringColumn = {
  ...jsonColumn,
  prepare: (v: unknown) => {
    if (v === null || v === undefined) return '[]'
    return typeof v === 'string' ? v : JSON.stringify(v)
  },
}

export default class KnowledgeItem extends BaseModel {
  public static table = 'knowledge_items'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare layer: KnowledgeLayer

  @column(jsonColumn)
  declare layerMeta: LayerMetadata

  @column()
  declare title: string

  @column(jsonColumn)
  declare content: Record<string, unknown> | string

  @column()
  declare status: KnowledgeLifecycleStatus

  @column()
  declare domain: string

  @column()
  declare purpose: string

  @column()
  declare complexity: string | null

  @column(jsonColumn)
  declare provenance: Provenance

  @column(jsonStringColumn)
  declare reviewHistory: ReviewRecord[]

  @column()
  declare isSynthetic: boolean

  @column()
  declare syntheticMethod: string | null

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number | null

  @column.dateTime()
  declare lastReferencedAt: DateTime | null

  @column()
  declare retentionDays: number | null

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
   * 组织作用域查询——所有查询强制附加 organization_id 过滤。
   */
  static forOrganization(organizationId: number) {
    return this.query().where('organization_id', organizationId)
  }
}
