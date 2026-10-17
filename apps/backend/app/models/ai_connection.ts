import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import type { AiConnectionCapability, AiConnectionProtocol, AiToolCallingMode } from '@aiproj/types'
import AiConnectionModel from './ai_connection_model.js'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
  serialize: (v: unknown) => v ?? null,
}

/**
 * AiConnection —— 用户配置的 AI 模型连接(ai-gateway-abstraction / T034)。
 *
 * 字段内联(纯 BaseModel + @column),不依赖 codegen 的 *Schema 基类。
 * 组织级隔离:查询经 TenantScope.forOrganization(query, orgId) 附加 organization_id。
 *
 * **红线**:`apiKeyEncrypted` 是 AES-256-GCM 密文,`serialize` 强制返回 null,
 * 任何 `toJSON()` / 默认序列化都不会泄漏密文;明文只在 Service 解密后注入 Adapter。
 */
export default class AiConnection extends BaseModel {
  public static table = 'ai_connections'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare displayName: string

  @column()
  declare protocol: AiConnectionProtocol

  /** 空 = 该协议默认官方端点(OpenAI / Anthropic 官方)。 */
  @column()
  declare baseUrl: string | null

  @column()
  declare catalogProviderId: string | null

  @column()
  declare catalogProviderName: string | null

  @column()
  declare catalogProviderLogoUrl: string | null

  @column()
  declare catalogProviderDocUrl: string | null

  @column(jsonColumn)
  declare catalogProviderEnvKeys: string[] | null

  @column(jsonColumn)
  declare catalogSourcePayload: Record<string, unknown> | null

  @column.dateTime()
  declare catalogSyncedAt: DateTime | null

  /** AES-256-GCM 密文(格式 v1.iv.tag.enc,见 CryptoService)。serialize 强制 null 防泄漏。 */
  @column({
    columnName: 'api_key_encrypted',
    serialize: () => null,
  })
  declare apiKeyEncrypted: string | null

  @column()
  declare model: string

  /** 端点能力探测结果(JSON 列,json prepare/consume 双向)。 */
  @column(jsonColumn)
  declare capabilities: AiConnectionCapability | null

  /** 工具调用方式（缺省 prompt_json；原生方式失败时自动回退 prompt_json）。 */
  @column()
  declare toolCallingMode: AiToolCallingMode

  @column()
  declare isActive: boolean

  @column.dateTime()
  declare lastTestedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => AiConnectionModel, { foreignKey: 'connectionId' })
  declare models: HasMany<typeof AiConnectionModel>
}
