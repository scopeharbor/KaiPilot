/**
 * AI 连接测试共享夹具（ai-gateway-abstraction-test-debt）。
 * 复用 auth/_helpers 的用户/组织创建，追加 AiConnection 工厂与审计辅助。
 */
import AiConnection from '#models/ai_connection'
import AiConnectionModel from '#models/ai_connection_model'
import type { AiConnectionProtocol } from '@aiproj/types'
import { createOrganization, createUser } from '../../functional/auth/_helpers.js'
import type User from '#models/user'
import type Organization from '#models/organization'
import type { Group } from '@japa/runner/core'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import CryptoService from '#services/crypto_service'
import AuditService from '#services/audit_service'
import AiConnectionService from '#services/ai_connection_service'

export {
  createUser,
  createOrganization,
  addOrgMember,
  STRONG_PASSWORD,
} from '../../functional/auth/_helpers.js'

/** AI 连接测试 DB 生命周期：每组迁移、每用例清空 + 清限流器。 */
export function useAiDatabase(group: Group) {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(async () => {
    await testUtils.db().truncate()
    await limiter.clear()
  })
}

/** 带加解密/审计的 AiConnectionService 工厂 */
export function buildConnectionService(): AiConnectionService {
  const crypto = new CryptoService()
  const audit = new AuditService()
  return new AiConnectionService(crypto, audit)
}

/** 创建一根完整的 AI 连接（含组织/用户兜底创建，返回关联实体与连接）。 */
export async function createAiConnection(
  overrides: Partial<{
    organizationId: number
    displayName: string
    protocol: AiConnectionProtocol
    baseUrl: string | null
    apiKeyEncrypted: string | null
    model: string
    capabilities: Record<string, boolean> | null
    isActive: boolean
  }> = {},
): Promise<{ conn: AiConnection; org: Organization; user: User }> {
  const user = await createUser()
  const org = await createOrganization(user)
  // 使用真正的 CryptoService 生成可逆加密的默认 key，使 testConnection 能通过 decrypt。
  const crypto = new CryptoService()
  const defaultKeyEnc = crypto.encrypt('test-api-key-for-ping-test')
  const conn = await AiConnection.create({
    organizationId: overrides.organizationId ?? org.id,
    displayName: overrides.displayName ?? '测试连接',
    protocol: overrides.protocol ?? 'openai_compatible',
    baseUrl: overrides.baseUrl ?? 'https://api.openai.com/v1',
    apiKeyEncrypted: 'apiKeyEncrypted' in overrides ? overrides.apiKeyEncrypted : defaultKeyEnc,
    model: overrides.model ?? 'gpt-5.4-mini',
    capabilities: (overrides.capabilities ?? null) as any,
    isActive: overrides.isActive ?? true,
  })
  await AiConnectionModel.create({
    connectionId: Number(conn.id),
    organizationId: overrides.organizationId ?? org.id,
    modelName: overrides.model ?? 'gpt-5.4-mini',
    capabilities: ['chat', 'project_draft', 'structured_output', 'tool_calling'],
    rpmLimit: null,
    tpmLimit: null,
    isActive: overrides.isActive ?? true,
  })
  return { conn, org, user }
}

/** 创建禁用的 AI 连接 */
export async function createDisabledConnection(): Promise<{
  conn: AiConnection
  org: Organization
  user: User
}> {
  return createAiConnection({
    displayName: '停用连接',
    isActive: false,
  })
}

/** 创建无 key 的 AI 连接 */
export async function createKeylessConnection(): Promise<{
  conn: AiConnection
  org: Organization
  user: User
}> {
  return createAiConnection({
    displayName: '无 Key 连接',
    apiKeyEncrypted: null,
  })
}

/** 对加密密钥做 AES-GCM 可逆加密的 CryptoService 桩——测试用确定密钥，避开真实 env。 */
export function createTestCrypto(): CryptoService {
  return new CryptoService()
}
