import { test } from '@japa/runner'
import {
  OpenAiAdapter,
  selectMaxTokenField,
  buildTokenParamRetryPayload,
} from '#services/ai_m0/openai_adapter'
import type { StreamChunk } from '#services/ai_m0/gateway'

/**
 * OpenAI 兼容 adapter 的 token 上限字段选择：
 * - GPT-5.x / o 系推理模型只认 max_completion_tokens；
 * - 其余端点沿用 max_tokens；
 * - 首轮因 token 参数被拒时按错误类型降级重试一次（换字段名 / 降到 4096）。
 */

test.group('selectMaxTokenField：按模型名选字段', () => {
  test('GPT-5.x 与 codex 系发 max_completion_tokens', ({ assert }) => {
    assert.deepEqual(selectMaxTokenField('gpt-5.6-luna', 8192), { max_completion_tokens: 8192 })
    assert.deepEqual(selectMaxTokenField('GPT-5-Codex', 1024), { max_completion_tokens: 1024 })
    assert.deepEqual(selectMaxTokenField('codex-mini-latest', 512), {
      max_completion_tokens: 512,
    })
  })

  test('o 系推理模型发 max_completion_tokens', ({ assert }) => {
    assert.deepEqual(selectMaxTokenField('o4-mini', 2048), { max_completion_tokens: 2048 })
    assert.deepEqual(selectMaxTokenField('o3', 2048), { max_completion_tokens: 2048 })
    assert.deepEqual(selectMaxTokenField('o1-preview', 2048), { max_completion_tokens: 2048 })
  })

  test('其余模型沿用 max_tokens（gpt-4o / deepseek / qwen 不误判）', ({ assert }) => {
    assert.deepEqual(selectMaxTokenField('gpt-4o', 4096), { max_tokens: 4096 })
    assert.deepEqual(selectMaxTokenField('gpt-4o-mini', 4096), { max_tokens: 4096 })
    assert.deepEqual(selectMaxTokenField('deepseek-chat', 4096), { max_tokens: 4096 })
    assert.deepEqual(selectMaxTokenField('qwen2.5-72b-instruct', 4096), { max_tokens: 4096 })
    assert.deepEqual(selectMaxTokenField('moonshot-v1-8k', 4096), { max_tokens: 4096 })
  })
})

test.group('buildTokenParamRetryPayload：token 参数被拒时的降级重试体', () => {
  test('字段名不被接受：max_tokens 换名为 max_completion_tokens（值不变）', ({ assert }) => {
    const payload = { model: 'm', max_tokens: 64000, stream: true }
    const retry = buildTokenParamRetryPayload(
      payload,
      "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    )
    assert.deepEqual(retry, { model: 'm', stream: true, max_completion_tokens: 64000 })
  })

  test('字段名不被接受：max_completion_tokens 换名为 max_tokens（旧端点反向场景）', ({
    assert,
  }) => {
    const payload = { model: 'm', max_completion_tokens: 2048 }
    const retry = buildTokenParamRetryPayload(
      payload,
      'Unrecognized request argument supplied: max_completion_tokens',
    )
    assert.deepEqual(retry, { model: 'm', max_tokens: 2048 })
  })

  test('上限过大：降到 4096 重试', ({ assert }) => {
    const payload = { model: 'm', max_tokens: 64000 }
    const retry = buildTokenParamRetryPayload(
      payload,
      'max_tokens is too large for this model, maximum is 8192',
    )
    assert.deepEqual(retry, { model: 'm', max_tokens: 4096 })
  })

  test('上限过大但原值已不高于 4096：不再重试', ({ assert }) => {
    const payload = { model: 'm', max_tokens: 4096 }
    assert.isNull(buildTokenParamRetryPayload(payload, 'max_tokens is too large, maximum is 2048'))
  })

  test('与 token 参数无关的错误不重试', ({ assert }) => {
    const payload = { model: 'm', max_tokens: 64000 }
    assert.isNull(buildTokenParamRetryPayload(payload, 'rate limit exceeded'))
    assert.isNull(buildTokenParamRetryPayload(payload, 'invalid api key'))
  })
})

function adapterWithCreate(model: string, create: (payload: any) => Promise<unknown>) {
  const adapter = new OpenAiAdapter({
    apiKey: 'test-key',
    baseURL: 'https://provider.example/v1',
    model,
  })
  // 注入假 SDK 客户端（私有字段，测试专用）。
  ;(adapter as unknown as { clientPromise: Promise<unknown> }).clientPromise = Promise.resolve({
    chat: { completions: { create } },
  })
  return adapter
}

async function collect(adapter: OpenAiAdapter): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream({ sentence: '测试', strategy: 'prompt' })) {
    chunks.push(chunk)
  }
  return chunks
}

async function collectWithMaxTokens(adapter: OpenAiAdapter): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream({
    sentence: '测试',
    strategy: 'prompt',
    maxOutputTokens: 64000,
  })) {
    chunks.push(chunk)
  }
  return chunks
}

test.group('OpenAiAdapter：token 字段接入与降级重试', () => {
  test('推理模型（gpt-5.x）stream 首轮即发 max_completion_tokens，不发 max_tokens', async ({
    assert,
  }) => {
    const seen: any[] = []
    const adapter = adapterWithCreate('gpt-5.6-luna', async (payload) => {
      seen.push(payload)
      return (async function* () {
        yield { choices: [{ delta: { content: '{}' }, finish_reason: 'stop' }] }
      })()
    })
    const chunks = await collect(adapter)
    assert.lengthOf(seen, 1)
    assert.property(seen[0], 'max_completion_tokens')
    assert.notProperty(seen[0], 'max_tokens')
    assert.equal(chunks[chunks.length - 1].kind, 'done')
  })

  test('普通模型首轮发 max_tokens；被拒为 unsupported 时换名重试一次并成功', async ({ assert }) => {
    const seen: any[] = []
    const adapter = adapterWithCreate('my-reasoning-clone', async (payload) => {
      seen.push(payload)
      if (seen.length === 1) {
        const err = new Error(
          "Unsupported parameter: 'max_tokens' is not supported with this model.",
        )
        throw err
      }
      return (async function* () {
        yield { choices: [{ delta: { content: '{}' }, finish_reason: 'stop' }] }
      })()
    })
    const chunks = await collect(adapter)
    assert.lengthOf(seen, 2)
    assert.property(seen[0], 'max_tokens')
    assert.property(seen[1], 'max_completion_tokens')
    assert.notProperty(seen[1], 'max_tokens')
    assert.equal(seen[1].max_completion_tokens, seen[0].max_tokens)
    assert.equal(chunks[chunks.length - 1].kind, 'done')
  })

  test('「上限过大」错误降到 4096 重试一次并成功', async ({ assert }) => {
    const seen: any[] = []
    const adapter = adapterWithCreate('gpt-4o', async (payload) => {
      seen.push(payload)
      if (seen.length === 1) {
        throw new Error('max_tokens is too large: 64000. Maximum value is 8192.')
      }
      return (async function* () {
        yield { choices: [{ delta: { content: '{}' }, finish_reason: 'stop' }] }
      })()
    })
    const chunks = await collectWithMaxTokens(adapter)
    assert.lengthOf(seen, 2)
    assert.equal(seen[0].max_tokens, 64000)
    assert.equal(seen[1].max_tokens, 4096)
    assert.equal(chunks[chunks.length - 1].kind, 'done')
  })

  test('与 token 无关的错误不重试，直接报错事件', async ({ assert }) => {
    const seen: any[] = []
    const adapter = adapterWithCreate('gpt-4o', async (payload) => {
      seen.push(payload)
      throw new Error('invalid api key')
    })
    const chunks = await collect(adapter)
    assert.lengthOf(seen, 1)
    assert.equal(chunks[chunks.length - 1].kind, 'error')
  })

  test('ping 对推理模型同样发 max_completion_tokens', async ({ assert }) => {
    const seen: any[] = []
    const adapter = adapterWithCreate('o4-mini', async (payload) => {
      seen.push(payload)
      return {
        choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }
    })
    const result = await adapter.ping()
    assert.isTrue(result.ok)
    assert.property(seen[0], 'max_completion_tokens')
    assert.notProperty(seen[0], 'max_tokens')
  })
})
