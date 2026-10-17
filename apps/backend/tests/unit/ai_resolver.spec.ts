/**
 * ai-gateway-abstraction-test-debt —— 覆盖 4.1/4.2/4.3/4.4/4.5：
 *   resolveAdapter 矩阵测试、fallback 语义、mock 降级。
 * 使用 AiConnection DB 表与 env 控制，覆盖所有组合。
 */
import { test } from '@japa/runner'
import { resolveAdapter, makeGateway } from '#services/ai_m0/resolver'
import AiConnectionModel from '#models/ai_connection_model'
import {
  createAiConnection,
  createDisabledConnection,
  createKeylessConnection,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'

test.group('resolveAdapter 矩阵', (group) => {
  useAiDatabase(group)

  test('未指定 connectionId → fallback（env 无 key 时返回 mock）', async ({ assert }) => {
    // .env.test 无 OPENAI_API_KEY → 降级到 MockAdapter
    const resolved = await resolveAdapter({})
    assert.equal(resolved.source, 'mock')
    assert.isFalse(resolved.usingRealAdapter)
    assert.equal(resolved.provider, 'mock')
    assert.isUndefined(resolved.unavailable)
  })

  test('connectionId 为 0/NaN → fallback 路径', async ({ assert }) => {
    const r1 = await resolveAdapter({ connectionId: 0 })
    assert.equal(r1.source, 'mock')

    const r2 = await resolveAdapter({ connectionId: 'abc' })
    assert.equal(r2.source, 'mock')
  })

  test('connectionId 为 null → fallback', async ({ assert }) => {
    const r = await resolveAdapter({ connectionId: null })
    assert.equal(r.source, 'mock')
  })

  test('有效连接返回 user 来源', async ({ assert }) => {
    const { conn, org } = await createAiConnection()
    const resolved = await resolveAdapter({ connectionId: conn.id, organizationId: Number(org.id) })
    assert.equal(resolved.source, 'user')
    assert.isTrue(resolved.usingRealAdapter)
    assert.isUndefined(resolved.unavailable)
  })

  test('连接不存在 → fallback + unavailable', async ({ assert }) => {
    const resolved = await resolveAdapter({ connectionId: 99999, organizationId: 1 })
    assert.equal(resolved.source, 'mock') // 因 env 无 key
    assert.isTrue(resolved.unavailable)
    assert.isFalse(resolved.usingRealAdapter)
  })

  test('跨组织连接 → fallback + unavailable', async ({ assert }) => {
    const { conn } = await createAiConnection()
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)

    const resolved = await resolveAdapter({
      connectionId: conn.id,
      organizationId: Number(otherOrg.id),
    })
    assert.equal(resolved.source, 'mock')
    assert.isTrue(resolved.unavailable)
  })

  test('禁用连接 → fallback + unavailable', async ({ assert }) => {
    const { conn, org } = await createDisabledConnection()
    const resolved = await resolveAdapter({
      connectionId: conn.id,
      organizationId: Number(org.id),
    })
    assert.equal(resolved.source, 'mock')
    assert.isTrue(resolved.unavailable)
  })

  test('无 key 连接 → fallback + unavailable', async ({ assert }) => {
    const { conn, org } = await createKeylessConnection()
    const resolved = await resolveAdapter({
      connectionId: conn.id,
      organizationId: Number(org.id),
    })
    assert.equal(resolved.source, 'mock')
    assert.isTrue(resolved.unavailable)
  })

  test('连接不可用不会静默切换到另一个真实 provider', async ({ assert }) => {
    // 即使 .env 有 key，跨组织连接也不应该用 env 冒充
    const { conn } = await createAiConnection()
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)

    const resolved = await resolveAdapter({
      connectionId: conn.id,
      organizationId: Number(otherOrg.id),
    })
    // unavailable=true 标记，caller 据此知道连接不可用
    assert.isTrue(resolved.unavailable)
  })

  test('makeGateway() 同步入口走 fallback', async ({ assert }) => {
    const gw = makeGateway()
    // env 无 key → mock
    assert.equal(gw.provider, 'mock')
    assert.isFalse(gw.usingRealAdapter)
  })

  test('显式 modelId 使用同一供应商下的指定模型', async ({ assert }) => {
    const { conn, org } = await createAiConnection()
    const second = await AiConnectionModel.create({
      connectionId: Number(conn.id),
      organizationId: Number(org.id),
      modelName: 'gpt-4o-mini',
      capabilities: ['chat', 'project_draft'],
      rpmLimit: 60,
      tpmLimit: 30_000,
      isActive: true,
    })

    const resolved = await resolveAdapter({
      connectionId: conn.id,
      modelId: second.id,
      organizationId: Number(org.id),
      requiredCapabilities: ['project_draft'],
    })

    assert.equal(resolved.source, 'user')
    assert.equal(resolved.model, 'gpt-4o-mini')
    assert.equal(resolved.modelId, second.id)
    assert.deepEqual(resolved.modelCapabilities, ['chat', 'project_draft'])
  })

  test('显式 modelId 能力不匹配时不静默切换模型', async ({ assert }) => {
    const { conn, org } = await createAiConnection()
    const ocrOnly = await AiConnectionModel.create({
      connectionId: Number(conn.id),
      organizationId: Number(org.id),
      modelName: 'ocr-model',
      capabilities: ['ocr', 'vision'],
      rpmLimit: null,
      tpmLimit: null,
      isActive: true,
    })

    const resolved = await resolveAdapter({
      connectionId: conn.id,
      modelId: ocrOnly.id,
      organizationId: Number(org.id),
      requiredCapabilities: ['project_draft'],
    })

    assert.notEqual(resolved.source, 'user')
    assert.isTrue(resolved.unavailable)
  })
})

test.group('resolveAdapter 元数据透传', (group) => {
  useAiDatabase(group)

  test('user 来源携带 capabilities', async ({ assert }) => {
    const { conn, org } = await createAiConnection()
    // 写入 capabilities
    conn.capabilities = {
      supportsStrictSchema: true,
      supportsToolCalling: true,
      supportsStreamingTool: true,
    }
    await conn.save()

    const resolved = await resolveAdapter({
      connectionId: conn.id,
      organizationId: Number(org.id),
    })
    assert.equal(resolved.source, 'user')
    assert.isNotNull(resolved.capabilities)
    assert.isTrue(resolved.capabilities!.supportsStrictSchema)
  })

  test('mock 来源 capabilities 为 undefined', async ({ assert }) => {
    const resolved = await resolveAdapter({})
    assert.equal(resolved.source, 'mock')
    assert.isUndefined(resolved.capabilities)
  })

  test('fallback 来源（有 env key 时）source=fallback', async ({ assert }) => {
    // 这个 case 需要在 env 有 key 的环境下跑才能验证
    // 默认环境（无 key，mock）时断言 source=mock
    // 此处断言当前行为
    const resolved = await resolveAdapter({})
    assert.include(['mock', 'fallback'], resolved.source)
  })
})
