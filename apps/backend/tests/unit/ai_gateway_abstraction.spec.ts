/**
 * ai-gateway-abstraction —— 协议分发与策略降级单元测试。
 * 覆盖:buildAdapter 按 protocol 分发;resolveStrategy 据能力降级。
 * 不依赖真实模型/DB;纯函数与构造。
 */
import { test } from '@japa/runner'
import { buildAdapter } from '#services/ai_m0/adapter_factory'
import AiConnectionService, { resolveStrategy } from '#services/ai_connection_service'
import { OpenAiAdapter } from '#services/ai_m0/openai_adapter'
import { AnthropicCompatibleAdapter } from '#services/ai_m0/anthropic_compatible_adapter'
import AiConnection from '#models/ai_connection'
import Organization from '#models/organization'
import User from '#models/user'
import type AuditService from '#services/audit_service'
import type CryptoService from '#services/crypto_service'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('buildAdapter 协议分发', () => {
  test('openai_compatible → OpenAiAdapter(复用泛化后的 Adapter)', ({ assert }) => {
    const a = buildAdapter('openai_compatible', { apiKey: 'k', model: 'm' })
    assert.instanceOf(a, OpenAiAdapter)
    assert.equal(a.isReal, true)
  })

  test('anthropic_compatible → AnthropicCompatibleAdapter', ({ assert }) => {
    const a = buildAdapter('anthropic_compatible', { apiKey: 'k', model: 'm' })
    assert.instanceOf(a, AnthropicCompatibleAdapter)
    assert.equal(a.isReal, true)
  })

  test('providerName 可配(任意 OpenAI-compat 端点复用同 Adapter)', ({ assert }) => {
    const a = buildAdapter('openai_compatible', {
      apiKey: 'k',
      model: 'm',
      providerName: 'deepseek',
    })
    assert.equal(a.providerName, 'deepseek')
  })

  test('切换协议只换 Adapter 实现,共享 AIGateway 契约(provider/model/isReal)', ({ assert }) => {
    const oai = buildAdapter('openai_compatible', { apiKey: 'k', model: 'gpt-4o' })
    const ant = buildAdapter('anthropic_compatible', { apiKey: 'k', model: 'claude-x' })
    assert.equal(oai.modelName, 'gpt-4o')
    assert.equal(ant.modelName, 'claude-x')
    // 同一 stream 契约(AsyncIterable<StreamChunk>),由 AIGateway 消费
    assert.equal(typeof oai.stream, 'function')
    assert.equal(typeof ant.stream, 'function')
    assert.equal(typeof oai.ping, 'function')
    assert.equal(typeof ant.ping, 'function')
  })
})

test.group('resolveStrategy 能力降级', () => {
  test('caps 为 null(未探测)不降级,让 recovery 层兜底', ({ assert }) => {
    assert.equal(resolveStrategy('native', null), 'native')
    assert.equal(resolveStrategy('tool', null), 'tool')
  })

  test('strict schema 不可用 → native 降到 prompt', ({ assert }) => {
    assert.equal(resolveStrategy('native', { supportsStrictSchema: false }), 'prompt')
  })

  test('tool calling 不可用 → tool 降到 prompt', ({ assert }) => {
    assert.equal(resolveStrategy('tool', { supportsToolCalling: false }), 'prompt')
  })

  test('strict 可用 → native 保持', ({ assert }) => {
    assert.equal(resolveStrategy('native', { supportsStrictSchema: true }), 'native')
  })

  test('prompt 策略永不降级', ({ assert }) => {
    assert.equal(
      resolveStrategy('prompt', { supportsStrictSchema: false, supportsToolCalling: false }),
      'prompt',
    )
  })
})

test.group('AiConnectionService testConnection', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  test('停用连接必须先启用才可以测试', async ({ assert }) => {
    const user = await User.create({
      fullName: '测试管理员',
      email: 'inactive-ai@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
      isActive: true,
      roleVersion: 0,
    })
    const org = await Organization.create({
      ownerId: user.id,
      name: '测试组织',
      slug: 'inactive-ai-org',
      planTier: 'free',
    })
    const conn = await AiConnection.create({
      organizationId: org.id,
      displayName: '停用测试连接',
      protocol: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEncrypted: 'not-used',
      model: 'gpt-5.4-mini',
      capabilities: null,
      isActive: false,
    })
    const crypto = {
      decrypt() {
        throw new Error('停用连接不应解密 API key')
      },
    } as unknown as CryptoService
    const audit = { log: async () => undefined } as unknown as AuditService
    const service = new AiConnectionService(crypto, audit)

    const result = await service.testConnection(conn.id, org.id, user.id)

    assert.isFalse(result.ok)
    assert.equal(result.errorKind, 'VALIDATION_ERROR')
    assert.equal(result.errorMessage, '请你先启用之后才可以测试')
  })
})
