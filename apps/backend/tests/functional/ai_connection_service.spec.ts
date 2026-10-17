/**
 * ai-gateway-abstraction-test-debt —— 覆盖 2.1/2.2/2.4/2.5：
 *   AiConnectionService CRUD + 组织隔离 + testConnection 成功/失败路径。
 * 依赖共享夹具 ai/_helpers。
 */
import { test } from '@japa/runner'
import AiConnection from '#models/ai_connection'
import AiConnectionModel from '#models/ai_connection_model'
import AiModelCatalogSnapshot from '#models/ai_model_catalog_snapshot'
import AiModelPricingSnapshot from '#models/ai_model_pricing_snapshot'
import AuditLog from '#models/audit_log'
import {
  buildConnectionService,
  createAiConnection,
  createDisabledConnection,
  createKeylessConnection,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import type { AdapterLike } from '#services/ai_connection_service'
import { DateTime } from 'luxon'

async function seedModelCatalogSnapshot() {
  await AiModelCatalogSnapshot.create({
    source: 'models.dev',
    sourceUrl: 'https://models.dev/catalog.json',
    sourceHash: 'connection-service-catalog-hash',
    payload: {
      openai: {
        name: 'OpenAI',
        api: 'https://api.openai.com/v1',
        doc: 'https://platform.openai.com/docs',
        env: ['OPENAI_API_KEY'],
        npm: '@ai-sdk/openai',
        models: {
          'gpt-4o-mini': {
            id: 'gpt-4o-mini',
            name: 'GPT-4o mini',
            modalities: { input: ['text', 'image'], output: ['text'] },
            limit: { context: 128000, input: 120000, output: 16384 },
            cost: { input: 0.15, output: 0.6, cache_read: 0.075, cache_write: 0.2 },
            knowledge: '2024-10',
            release_date: '2024-07-18',
            last_updated: '2026-07-30',
            status: 'stable',
            structured_output: true,
            tool_call: true,
          },
          'gpt-4o-audio-preview': {
            id: 'gpt-4o-audio-preview',
            name: 'GPT-4o audio preview',
            modalities: { input: ['text', 'audio'], output: ['text', 'audio'] },
            limit: { context: 128000, input: 100000, output: 4096 },
            cost: { input: 2.5, output: 10, input_audio: 40, output_audio: 80 },
            knowledge: '2024-10',
            status: 'preview',
          },
        },
      },
    },
    providerCount: 1,
    modelCount: 2,
    fetchedAt: DateTime.fromISO('2026-07-30T00:00:00.000Z'),
    expiresAt: DateTime.fromISO('2099-07-30T06:00:00.000Z'),
    stale: false,
  })
}

test.group('AiConnectionService CRUD', (group) => {
  useAiDatabase(group)

  test('创建连接：加密 API key、写审计日志', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)

    const conn = await svc.create(
      {
        displayName: '我的 OpenAI',
        protocol: 'openai_compatible',
        apiKey: 'sk-real-key',
        model: 'gpt-4o',
      },
      user.id,
      org.id,
    )

    assert.exists(conn.id)
    assert.equal(conn.displayName, '我的 OpenAI')
    assert.equal(conn.protocol, 'openai_compatible')
    assert.notEqual(conn.apiKeyEncrypted, 'sk-real-key') // 加密 ≠ 明文
    assert.match(conn.apiKeyEncrypted!, /^v1\./) // 格式 v1.iv.tag.enc
    assert.isTrue(conn.isActive)

    // 审计日志
    const logs = await AuditLog.query()
      .where('entity_type', 'ai_connection')
      .where('entity_id', Number(conn.id))
    assert.lengthOf(logs, 1)
    assert.equal(logs[0].action, 'create')
  })

  test('创建时 isActive 默认 true', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)

    const conn = await svc.create(
      { displayName: '默认激活', protocol: 'openai_compatible', apiKey: 'k', model: 'gpt-4o' },
      user.id,
      org.id,
    )

    assert.isTrue(conn.isActive)
  })

  test('创建时不传 apiKey，密文为 null', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)

    const conn = await svc.create(
      { displayName: '无 Key', protocol: 'openai_compatible', model: 'gpt-4o' },
      user.id,
      org.id,
    )

    assert.isNull(conn.apiKeyEncrypted)
  })

  test('创建连接时支持多个模型、能力与 RPM/TPM', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)

    const conn = await svc.create(
      {
        displayName: '多模型供应商',
        protocol: 'openai_compatible',
        apiKey: 'sk-real-key',
        models: [
          {
            modelName: 'chat-model',
            capabilities: ['chat', 'project_draft'],
            rpmLimit: 60,
            tpmLimit: 30_000,
          },
          {
            modelName: 'ocr-model',
            capabilities: ['ocr', 'vision'],
            rpmLimit: null,
            tpmLimit: null,
          },
        ],
      },
      user.id,
      org.id,
    )

    const dto = svc.toDto(conn)
    assert.equal(dto.model, 'chat-model')
    assert.lengthOf(dto.models, 2)
    assert.equal(dto.models[0].rpmLimit, 60)
    assert.equal(dto.models[0].tpmLimit, 30_000)
    assert.deepEqual(dto.models[1].capabilities, ['ocr', 'vision'])
  })

  test('创建目录模型连接：生成价格快照并支持 token 限制预填与手动覆写', async ({ assert }) => {
    await seedModelCatalogSnapshot()
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)

    const conn = await svc.create(
      {
        displayName: '目录 OpenAI',
        protocol: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-real-key',
        models: [
          {
            modelName: 'gpt-4o-mini',
            capabilities: ['chat', 'project_draft'],
            catalogProviderId: 'openai',
            catalogModelId: 'gpt-4o-mini',
            contextWindowTokens: 64000,
            maxInputTokens: 60000,
            maxOutputTokens: 2048,
            tokenLimitSource: 'manual',
          },
          {
            modelName: 'gpt-4o-audio-preview',
            capabilities: ['chat', 'audio_input', 'speech_output'],
            catalogProviderId: 'openai',
            catalogModelId: 'gpt-4o-audio-preview',
          },
        ],
      },
      user.id,
      org.id,
    )

    const dto = svc.toDto(conn)
    assert.equal(dto.catalogProviderId, 'openai')
    assert.equal(dto.catalogProviderName, 'OpenAI')
    assert.equal(dto.catalogProviderDocUrl, 'https://platform.openai.com/docs')
    assert.deepEqual(dto.catalogProviderEnvKeys, ['OPENAI_API_KEY'])
    assert.lengthOf(dto.models, 2)

    assert.equal(dto.models[0].pricingSnapshotId !== null, true)
    assert.equal(dto.models[0].tokenLimitSource, 'manual')
    assert.equal(dto.models[0].contextWindowTokens, 64000)
    assert.equal(dto.models[0].maxInputTokens, 60000)
    assert.equal(dto.models[0].maxOutputTokens, 2048)
    assert.equal(dto.models[0].catalogMetadata?.limit?.output, 16384)
    assert.equal(dto.models[0].catalogMetadata?.cost?.cacheRead, 0.075)

    assert.equal(dto.models[1].tokenLimitSource, 'catalog')
    assert.equal(dto.models[1].contextWindowTokens, 128000)
    assert.equal(dto.models[1].maxInputTokens, 100000)
    assert.equal(dto.models[1].maxOutputTokens, 4096)
    assert.equal(dto.models[1].catalogMetadata?.cost?.inputAudio, 40)

    const snapshots = await AiModelPricingSnapshot.query().orderBy('model_id', 'asc')
    assert.lengthOf(snapshots, 2)
    assert.equal(snapshots[0].sourceHash, 'connection-service-catalog-hash')
    assert.equal(snapshots[0].cost?.input, 2.5)
    assert.equal(snapshots[1].cost?.input, 0.15)
  })

  test('toDto：不回显明文 key', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)

    const conn = await svc.create(
      {
        displayName: '隐藏 Key',
        protocol: 'openai_compatible',
        apiKey: 'sk-visible',
        model: 'gpt-4o',
      },
      user.id,
      org.id,
    )

    const dto = svc.toDto(conn)
    assert.equal(dto.hasKey, true)
    assert.isNull(dto.keyHint)
    assert.notProperty(dto, 'apiKeyEncrypted')
    assert.notProperty(dto, 'apiKey')
  })

  test('get：按 ID 和组织返回连接', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn, org } = await createAiConnection()

    const found = await svc.get(Number(conn.id), Number(org.id))
    assert.equal(found.id, conn.id)
    assert.equal(found.displayName, conn.displayName)
  })

  test('get：跨组织返回 404', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn } = await createAiConnection()
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)

    await assert.rejects(
      () => svc.get(Number(conn.id), Number(otherOrg.id)),
      ResourceNotFoundException,
    )
  })

  test('get：不存在返回 404', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)

    await assert.rejects(() => svc.get(99999, Number(org.id)), ResourceNotFoundException)
  })

  test('list：按组织列出，不含其他组织', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn, org } = await createAiConnection()
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)
    await AiConnection.create({
      organizationId: Number(otherOrg.id),
      displayName: '其他组织连接',
      protocol: 'openai_compatible',
      apiKeyEncrypted: 'v1.xxx',
      model: 'gpt-4o',
      isActive: true,
    })

    const rows = await svc.list(Number(org.id))
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].id, conn.id)

    const otherRows = await svc.list(Number(otherOrg.id))
    assert.lengthOf(otherRows, 1)
    assert.equal(otherRows[0].displayName, '其他组织连接')
  })

  test('activeOnly：只返回激活的连接', async ({ assert }) => {
    const svc = buildConnectionService()
    const { org } = await createAiConnection()
    await AiConnection.create({
      organizationId: Number(org.id),
      displayName: '停用的',
      protocol: 'openai_compatible',
      apiKeyEncrypted: 'v1.xxx',
      model: 'gpt-4o',
      isActive: false,
    })

    const rows = await svc.list(Number(org.id), true)
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].displayName, '测试连接')
  })

  test('update：部分更新', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn, org, user } = await createAiConnection()

    const updated = await svc.update(
      Number(conn.id),
      { displayName: '已改名', model: 'gpt-5' },
      user.id,
      Number(org.id),
    )

    assert.equal(updated.displayName, '已改名')
    assert.equal(updated.model, 'gpt-5')
  })

  test('update：models 覆盖供应商下的模型清单', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn, org, user } = await createAiConnection()

    const updated = await svc.update(
      Number(conn.id),
      {
        models: [
          {
            modelName: 'new-chat',
            capabilities: ['chat', 'project_draft', 'structured_output'],
            rpmLimit: 10,
            tpmLimit: null,
            isActive: true,
          },
          {
            modelName: 'new-ocr',
            capabilities: ['ocr', 'vision', 'document_understanding'],
            rpmLimit: null,
            tpmLimit: 20_000,
            isActive: false,
          },
        ],
      },
      user.id,
      Number(org.id),
    )

    const dto = svc.toDto(updated)
    assert.equal(dto.model, 'new-chat')
    assert.lengthOf(dto.models, 2)
    assert.equal(dto.models[1].modelName, 'new-ocr')
    assert.equal(dto.models[1].tpmLimit, 20_000)
    assert.isFalse(dto.models[1].isActive)
  })

  test('update：空 apiKey 不覆盖原密文', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn, org, user } = await createAiConnection()

    // apiKey 不传（undefined）→ 密文不变
    const updated = await svc.update(
      Number(conn.id),
      { displayName: '不改 Key' },
      user.id,
      Number(org.id),
    )
    assert.equal(updated.apiKeyEncrypted, conn.apiKeyEncrypted)

    // apiKey 传空字符串 → 覆盖（加密后的空内容与原来不同）
    const updated2 = await svc.update(
      Number(conn.id),
      { displayName: '置空 Key', apiKey: '' },
      user.id,
      Number(org.id),
    )
    assert.notEqual(updated2.apiKeyEncrypted, conn.apiKeyEncrypted)
    assert.isNotNull(updated2.apiKeyEncrypted)
  })

  test('update：跨组织抛出 404', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn } = await createAiConnection()
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)

    await assert.rejects(
      () =>
        svc.update(Number(conn.id), { displayName: '跨组织' }, otherUser.id, Number(otherOrg.id)),
      ResourceNotFoundException,
    )
  })

  test('update：写审计日志', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn, org, user } = await createAiConnection()

    await svc.update(Number(conn.id), { displayName: '审计改名' }, user.id, Number(org.id))

    const logs = await AuditLog.query()
      .where('entity_type', 'ai_connection')
      .where('entity_id', Number(conn.id))
      .where('action', 'update')
    assert.lengthOf(logs, 1)
  })

  test('delete：删除连接并写审计日志', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn, org, user } = await createAiConnection()

    await svc.delete(Number(conn.id), user.id, Number(org.id))

    const deleted = await AiConnection.find(conn.id)
    assert.isNull(deleted)

    const logs = await AuditLog.query()
      .where('entity_type', 'ai_connection')
      .where('entity_id', Number(conn.id))
      .where('action', 'delete')
    assert.lengthOf(logs, 1)
  })

  test('delete：跨组织抛出 404', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn } = await createAiConnection()
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)

    await assert.rejects(
      () => svc.delete(Number(conn.id), otherUser.id, Number(otherOrg.id)),
      ResourceNotFoundException,
    )
  })
})

test.group('AiConnectionService testConnection', (group) => {
  useAiDatabase(group)

  test('停用连接返回 VALIDATION_ERROR', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn, org, user } = await createDisabledConnection()

    const result = await svc.testConnection(Number(conn.id), Number(org.id), user.id)

    assert.isFalse(result.ok)
    assert.equal(result.errorKind, 'VALIDATION_ERROR')
    assert.equal(result.errorMessage, '请你先启用之后才可以测试')
  })

  test('无 key 连接返回 AUTH_REQUIRED', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn, org, user } = await createKeylessConnection()

    const result = await svc.testConnection(Number(conn.id), Number(org.id), user.id)

    assert.isFalse(result.ok)
    assert.equal(result.errorKind, 'AUTH_REQUIRED')
    assert.equal(result.errorMessage, '未设置 API key')
  })

  test('跨组织连接返回 404', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn } = await createAiConnection()
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)

    await assert.rejects(
      () => svc.testConnection(Number(conn.id), Number(otherOrg.id), otherUser.id),
      ResourceNotFoundException,
    )
  })

  test('testConnection 成功路径写审计日志', async ({ assert }) => {
    const svc = buildConnectionService()
    const { conn, org, user } = await createAiConnection()

    // 这里会走到 buildAdapter → 创建真实 OpenAiAdapter → 尝试 ping
    // 由于 .env.test 没有 OPENAI_API_KEY，Adapter 的 getClient 会尝试动态 import openai
    // 但 .env.test 可能没有安装 openai（SDK 是运行时依赖），所以我们预期 SDK 加载失败（不是连接问题）
    await svc.testConnection(Number(conn.id), Number(org.id), user.id)

    // 关键断言：审计日志无论如何都会被写入
    const logs = await AuditLog.query()
      .where('entity_type', 'ai_connection')
      .where('entity_id', Number(conn.id))
      .where('action', 'read')
    assert.lengthOf(logs, 1)
    assert.exists(logs[0].metadata)
  })

  test('多模型连接：一次测试覆盖全部启用模型并逐模型更新 lastTestedAt', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)
    const conn = await svc.create(
      {
        displayName: '多模型测试连接',
        protocol: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-multi',
        models: [
          { modelName: 'model-a', capabilities: ['chat'] },
          { modelName: 'model-b', capabilities: ['chat'] },
        ],
      },
      user.id,
      org.id,
    )

    const pinged: string[] = []
    svc.setTestAdapterOverride(
      (_protocol, opts) =>
        ({
          async ping() {
            pinged.push(opts.model)
            return { ok: true, usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } }
          },
        }) as unknown as AdapterLike,
    )

    const result = await svc.testConnection(Number(conn.id), Number(org.id), user.id)

    assert.isTrue(result.ok)
    assert.lengthOf(result.results ?? [], 2)
    assert.deepEqual((result.results ?? []).map((item) => item.modelName).sort(), [
      'model-a',
      'model-b',
    ])
    assert.deepEqual(pinged.sort(), ['model-a', 'model-b'])
    // 顶层 usage 为各模型合计
    assert.equal(result.usage?.totalTokens, 16)

    // 逐模型 lastTestedAt 更新 + 连接级成功更新
    const rows = await AiConnectionModel.query().where('connection_id', Number(conn.id))
    for (const row of rows) {
      assert.isNotNull(row.lastTestedAt)
    }
    const reloaded = await AiConnection.find(Number(conn.id))
    assert.isNotNull(reloaded?.lastTestedAt)

    // 整次测试只写一条审计
    const logs = await AuditLog.query()
      .where('entity_type', 'ai_connection')
      .where('entity_id', Number(conn.id))
      .where('action', 'read')
    assert.lengthOf(logs, 1)
    assert.equal(logs[0].metadata?.total, 2)
    assert.equal(logs[0].metadata?.failed, 0)
    svc.setTestAdapterOverride(null)
  })

  test('多模型连接：单个模型失败 → 顶层失败且连接 lastTestedAt 不更新', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)
    const conn = await svc.create(
      {
        displayName: '部分失败连接',
        protocol: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-multi',
        models: [
          { modelName: 'model-a', capabilities: ['chat'] },
          { modelName: 'model-b', capabilities: ['chat'] },
        ],
      },
      user.id,
      org.id,
    )

    svc.setTestAdapterOverride(
      (_protocol, opts) =>
        ({
          async ping() {
            if (opts.model === 'model-b') {
              return { ok: false, errorKind: 'AI_SERVICE_ERROR', errorMessage: '模拟供应商失败' }
            }
            return { ok: true, usage: { totalTokens: 8 } }
          },
        }) as unknown as AdapterLike,
    )

    const result = await svc.testConnection(Number(conn.id), Number(org.id), user.id)

    assert.isFalse(result.ok)
    assert.equal(result.model, 'model-b')
    const failed = result.results?.find((item) => item.modelName === 'model-b')
    assert.equal(failed?.errorMessage, '模拟供应商失败')
    const passed = result.results?.find((item) => item.modelName === 'model-a')
    assert.isTrue(passed?.ok)

    // 成功的模型仍记录测试时间；连接级「全部通过」不成立 → lastTestedAt 不更新
    const rows = await AiConnectionModel.query().where('connection_id', Number(conn.id))
    const rowA = rows.find((row) => row.modelName === 'model-a')
    const rowB = rows.find((row) => row.modelName === 'model-b')
    assert.isNotNull(rowA?.lastTestedAt)
    assert.isNull(rowB?.lastTestedAt)
    const reloaded = await AiConnection.find(Number(conn.id))
    assert.isNull(reloaded?.lastTestedAt)
    svc.setTestAdapterOverride(null)
  })

  test('options.modelName 指定模型：只测该模型', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)
    const conn = await svc.create(
      {
        displayName: '单测连接',
        protocol: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-single',
        models: [
          { modelName: 'model-a', capabilities: ['chat'] },
          { modelName: 'model-b', capabilities: ['chat'] },
        ],
      },
      user.id,
      org.id,
    )

    const pinged: string[] = []
    svc.setTestAdapterOverride(
      (_protocol, opts) =>
        ({
          async ping() {
            pinged.push(opts.model)
            return { ok: true }
          },
        }) as unknown as AdapterLike,
    )

    const result = await svc.testConnection(
      Number(conn.id),
      Number(org.id),
      user.id,
      {},
      {
        modelName: 'model-b',
      },
    )

    assert.isTrue(result.ok)
    assert.lengthOf(result.results ?? [], 1)
    assert.equal(result.results?.[0]?.modelName, 'model-b')
    assert.deepEqual(pinged, ['model-b'])
    svc.setTestAdapterOverride(null)
  })

  test('options.modelName 不属于该连接 → 422', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)
    const conn = await svc.create(
      {
        displayName: '单测连接',
        protocol: 'openai_compatible',
        apiKey: 'sk-single',
        models: [{ modelName: 'model-a', capabilities: ['chat'] }],
      },
      user.id,
      org.id,
    )

    await assert.rejects(
      () =>
        svc.testConnection(Number(conn.id), Number(org.id), user.id, {}, { modelName: 'other' }),
      ValidationException,
    )
  })
})

test.group('AiConnectionService 工具调用方式', (group) => {
  useAiDatabase(group)

  test('缺省 prompt_json；可按协议选择原生方式并回显到 DTO', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)
    const conn = await svc.create(
      { displayName: 'OpenAI', protocol: 'openai_compatible', apiKey: 'sk-1', model: 'gpt-4o' },
      user.id,
      org.id,
    )
    assert.equal(svc.toDto(conn).toolCallingMode, 'prompt_json')

    const updated = await svc.update(
      Number(conn.id),
      { toolCallingMode: 'openai_responses_tools' },
      user.id,
      org.id,
    )
    assert.equal(svc.toDto(updated).toolCallingMode, 'openai_responses_tools')

    const claude = await svc.create(
      {
        displayName: 'Claude',
        protocol: 'anthropic_compatible',
        apiKey: 'sk-2',
        model: 'claude-opus-5-5',
        toolCallingMode: 'anthropic_tool_use',
      },
      user.id,
      org.id,
    )
    assert.equal(claude.toolCallingMode, 'anthropic_tool_use')
  })

  test('方式与协议不符 → 422；改协议后不适用的方式回到 prompt_json', async ({ assert }) => {
    const svc = buildConnectionService()
    const user = await createUser()
    const org = await createOrganization(user)
    await assert.rejects(() =>
      svc.create(
        {
          displayName: 'OpenAI',
          protocol: 'openai_compatible',
          apiKey: 'sk-1',
          model: 'gpt-4o',
          toolCallingMode: 'anthropic_tool_use',
        },
        user.id,
        org.id,
      ),
    )
    const conn = await svc.create(
      {
        displayName: 'OpenAI',
        protocol: 'openai_compatible',
        apiKey: 'sk-1',
        model: 'gpt-4o',
        toolCallingMode: 'openai_chat_tools',
      },
      user.id,
      org.id,
    )
    const switched = await svc.update(
      Number(conn.id),
      { protocol: 'anthropic_compatible' },
      user.id,
      org.id,
    )
    assert.equal(switched.toolCallingMode, 'prompt_json')
  })
})
