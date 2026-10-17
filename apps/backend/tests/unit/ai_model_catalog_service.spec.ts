import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import AiModelCatalogSnapshot from '#models/ai_model_catalog_snapshot'
import AiModelPricingSnapshot from '#models/ai_model_pricing_snapshot'
import AiModelCatalogService from '#services/ai_model_catalog_service'
import { estimateAiModelCatalogCost } from '@aiproj/types'

const dbTestUtils = testUtils as unknown as {
  db: () => { migrate: () => Promise<void>; truncate: () => Promise<void> }
}

const fixtureCatalog = {
  openai: {
    name: 'OpenAI',
    api: '',
    doc: 'https://platform.openai.com/docs',
    env: ['OPENAI_API_KEY'],
    npm: '@ai-sdk/openai',
    models: {
      'gpt-4o': {
        id: 'gpt-4o',
        name: 'GPT-4o',
        family: 'gpt-4o',
        description: 'Fast multimodal model',
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 128000, input: 127000, output: 16384 },
        cost: {
          input: 2.5,
          output: 10,
          cache_read: 1.25,
          cache_write: 3.75,
          input_audio: 40,
          output_audio: 80,
          reasoning: 5,
          context_over_200k: { input: 5 },
          tiers: [{ threshold: 1000000, input: 2 }],
        },
        knowledge: '2024-10',
        release_date: '2024-05-13',
        last_updated: '2026-07-01',
        status: 'stable',
        attachment: true,
        reasoning: true,
        structured_output: true,
        tool_call: true,
        temperature: true,
        open_weights: false,
        benchmarks: { mmlu: 88 },
        license: 'proprietary',
        links: { docs: 'https://platform.openai.com/docs/models/gpt-4o' },
      },
    },
  },
  siliconflow: {
    name: 'SiliconFlow',
    api: 'https://api.siliconflow.cn/v1',
    doc: 'https://docs.siliconflow.cn',
    env: ['SILICONFLOW_API_KEY'],
    npm: '@ai-sdk/openai-compatible',
    models: {
      'Qwen/Qwen3-32B': {
        id: 'Qwen/Qwen3-32B',
        name: 'Qwen3 32B',
        family: 'qwen3',
        modalities: { input: ['text', 'pdf'], output: ['text'] },
        limit: { context: 32768, input: 30000, output: 8192 },
        cost: { input: 0.4, output: 1.6 },
        knowledge: '2025-04',
        release_date: '2025-04-29',
        last_updated: '2026-06-30',
        structured_output: true,
        tool_call: true,
      },
    },
  },
  azure: {
    name: 'Azure OpenAI',
    api: 'https://${resource}.openai.azure.com/openai/deployments/${deployment}',
    doc: 'https://learn.microsoft.com/azure/ai-services/openai',
    env: ['AZURE_OPENAI_API_KEY'],
    npm: '@ai-sdk/openai-compatible',
    models: {
      deployment: {
        id: 'deployment',
        name: 'Azure deployment',
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 64000, output: 4096 },
        cost: { input: 1, output: 3 },
      },
    },
  },
  bedrock: {
    name: 'Amazon Bedrock',
    api: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    doc: 'https://docs.aws.amazon.com/bedrock',
    env: ['AWS_ACCESS_KEY_ID'],
    npm: '@ai-sdk/amazon-bedrock',
    models: {
      'anthropic.claude': {
        id: 'anthropic.claude',
        name: 'Claude on Bedrock',
        modalities: { input: ['text'], output: ['text'] },
        cost: { input: 3, output: 15 },
      },
    },
  },
}

test.group('AiModelCatalogService', (group) => {
  group.setup(() => dbTestUtils.db().migrate())
  group.each.setup(async () => {
    await dbTestUtils.db().truncate()
  })

  function service(options: Partial<{ now: Date; fail: boolean }> = {}) {
    return new AiModelCatalogService({
      ttlMs: 1000,
      now: () => options.now ?? new Date('2026-07-30T00:00:00.000Z'),
      fetchCatalog: async () => {
        if (options.fail) throw new Error('network down')
        return fixtureCatalog
      },
    })
  }

  test('parses provider/model fields, prices, modalities, and context limits', async ({
    assert,
  }) => {
    const result = await service().search({ query: 'gpt-4o' })
    assert.equal(result.data[0]!.providerId, 'openai')
    assert.equal(result.data[0]!.protocol, 'openai_compatible')
    assert.equal(result.data[0]!.supportLevel, 'one_click')
    assert.equal(result.data[0]!.limit.context, 128000)
    assert.equal(result.data[0]!.limit.output, 16384)
    assert.equal(result.data[0]!.cost.cacheRead, 1.25)
    assert.equal(result.data[0]!.cost.cacheWrite, 3.75)
    assert.equal(result.data[0]!.cost.inputAudio, 40)
    assert.equal(result.data[0]!.cost.outputAudio, 80)
    assert.equal(result.data[0]!.cost.reasoning, 5)
    assert.equal(result.data[0]!.knowledgeCutoff, '2024-10')
    assert.include(result.data[0]!.capabilities, 'vision')
    assert.include(result.data[0]!.capabilities, 'ocr')
  })

  test('supports Chinese provider aliases', async ({ assert }) => {
    const result = await service().search({ query: '硅基流动' })
    assert.equal(result.data[0]!.providerId, 'siliconflow')
    assert.equal(result.data[0]!.baseUrl, 'https://api.siliconflow.cn/v1')
  })

  test('searches by the tail of relay-prefixed model names', async ({ assert }) => {
    const result = await service().search({ query: 'relay/openai/gpt-4o' })
    assert.equal(result.data[0]!.providerId, 'openai')
    assert.equal(result.data[0]!.id, 'gpt-4o')
  })

  test('matches catalog provider and model from Base URL plus model name', async ({ assert }) => {
    const result = await service().match({
      baseUrl: 'https://api.siliconflow.cn/v1/',
      modelName: 'Qwen/Qwen3-32B',
    })
    assert.equal(result.provider!.id, 'siliconflow')
    assert.equal(result.model!.id, 'Qwen/Qwen3-32B')
  })

  test('returns candidates without auto-applying when only the model name matches', async ({
    assert,
  }) => {
    const result = await service().match({
      baseUrl: 'https://third-party-proxy.example/v1',
      modelName: 'gpt-4o',
    })
    assert.isNull(result.model)
    assert.equal(result.candidates[0]!.id, 'gpt-4o')
  })

  test('marks templated and unsupported providers as not one-click', async ({ assert }) => {
    const azure = await service().search({ query: 'Azure deployment' })
    assert.equal(azure.data[0]!.supportLevel, 'manual')
    assert.isTrue(azure.data[0]!.baseUrlNeedsManualEdit)

    const unsupported = await service().search({ query: 'Bedrock' })
    assert.equal(unsupported.data[0]!.supportLevel, 'unsupported')
    assert.isNull(unsupported.data[0]!.protocol)
  })

  test('creates immutable pricing snapshots and keeps raw model payload', async ({ assert }) => {
    const snapshot = await service().createPricingSnapshot('openai', 'gpt-4o')
    assert.exists(snapshot.id)
    assert.equal(snapshot.providerId, 'openai')
    assert.equal(snapshot.modelId, 'gpt-4o')
    assert.equal(snapshot.cost!.input, 2.5)
    assert.equal(snapshot.limits!.context, 128000)
    assert.equal((snapshot.rawModel as Record<string, unknown>).knowledge, '2024-10')

    const same = await service().createPricingSnapshot('openai', 'gpt-4o')
    assert.equal(same.id, snapshot.id)
    assert.equal(
      await AiModelPricingSnapshot.query()
        .count('* as total')
        .first()
        .then((row) => Number(row?.$extras.total)),
      1,
    )
  })

  test('refresh falls back to stale snapshot when source fetch fails', async ({ assert }) => {
    await service().refresh(true)
    const staleResult = await service({
      fail: true,
      now: new Date('2026-07-30T01:00:00.000Z'),
    }).refresh(true)

    assert.isTrue(staleResult.stale)
    const latest = await AiModelCatalogSnapshot.query().firstOrFail()
    assert.isTrue(latest.stale)
  })

  test('optional audio pricing falls back to the base token price', ({ assert }) => {
    const estimate = estimateAiModelCatalogCost({
      usage: { inputTokens: 1000, outputTokens: 500, inputAudioTokens: 10 },
      cost: {
        input: 1,
        output: 2,
        cacheRead: null,
        cacheWrite: null,
        inputAudio: null,
        outputAudio: null,
        reasoning: null,
        contextOver200k: null,
        tiers: null,
      },
    })

    assert.closeTo(estimate.estimatedCost ?? -1, 0.002, 0.000001)
    assert.isFalse(estimate.hasUnknownComponent)
    assert.equal(
      estimate.components.find((component) => component.kind === 'input_audio')?.state,
      'included',
    )
  })
})
