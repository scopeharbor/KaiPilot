import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  TenantScopeMode,
  TenantSelectionSource,
} from '@aiproj/types/multitenant-tenant-identification'

/**
 * TenantSelectionState 模型：服务端 active organization selection 快照
 *（v3-multitenant-tenant-identification §4.2）。
 *
 * 每个 actor 一行（`userId` 唯一）。只承载低敏字段：组织 ID、成员新鲜度 hash、
 * scope hash、来源枚举与 selection epoch。**不含**原始 token、权限全集或组织名称。
 *
 * `selectionEpoch` 是 §4.3 失效旧派生制品的判据：切换成功即 +1，带旧 epoch 的
 * preview / export / job / AI 句柄一律判 stale（即使切回原组织）。
 *
 * 组织隔离说明：本表按 actor 而非组织归属（一个 actor 的 selection 跨组织唯一），
 * 因此不进 `TenantScopeRegistry` 的 tenant-owned 资源清单；读写一律以
 * `userId` 为键，绝不按 `organizationId` 反查他人 selection。
 */
export default class TenantSelectionState extends BaseModel {
  static table = 'tenant_selection_states'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare organizationId: number | null

  @column()
  declare membershipVersionHash: string | null

  @column()
  declare scopeHash: string | null

  @column()
  declare selectionSource: TenantSelectionSource

  @column()
  declare scopeMode: TenantScopeMode

  @column()
  declare selectionEpoch: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
