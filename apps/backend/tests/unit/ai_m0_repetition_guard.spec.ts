import { test } from '@japa/runner'
import { detectRepetition, RepetitionGuard } from '#services/ai_m0/repetition_guard'
import { OpenAiAdapter } from '#services/ai_m0/openai_adapter'
import type { StreamChunk } from '#services/ai_m0/gateway'

const marker =
  '{"confidence":0.7,"source":"inferred","reason":"按阶段推断","needsConfirmation":true}'

/** 正常输出：结构（marker）大量重复，但被不同内容隔开。 */
function normalDraftJson(count: number): string {
  const tasks = Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      id: `task-${index + 1}`,
      name: { value: `完成第 ${index + 1} 项接口联调`, marker: JSON.parse(marker) },
      durationDays: { value: 3 + (index % 5), marker: JSON.parse(marker) },
    }),
  )
  return `{"tasks":[${tasks.join(',')}]}`
}

function streamOf(parts: Array<Record<string, unknown>>) {
  let aborted = false
  const response = {
    controller: { abort: () => (aborted = true) },
    async *[Symbol.asyncIterator]() {
      for (const part of parts) {
        if (aborted) return
        yield part
      }
    },
  }
  return { response, wasAborted: () => aborted }
}

function adapterWith(response: unknown) {
  const adapter = new OpenAiAdapter({
    apiKey: 'test-key',
    baseURL: 'https://provider.example/v1',
    model: 'gpt-5.6-luna',
  })
  // 注入假 SDK 客户端（私有字段，测试专用）。
  ;(adapter as unknown as { clientPromise: Promise<unknown> }).clientPromise = Promise.resolve({
    chat: { completions: { create: async () => response } },
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

test.group('重复循环检测', () => {
  test('正常草案 JSON（marker 结构大量重复但内容不同）不误判', ({ assert }) => {
    const guard = new RepetitionGuard()
    const text = normalDraftJson(300)
    for (let index = 0; index < text.length; index += 97) guard.push(text.slice(index, index + 97))
    assert.isNull(guard.verdict)
  })

  test('同一段任务对象原样重复 4 次以上判为循环', ({ assert }) => {
    const block = `,${JSON.stringify({ id: 'task-9', name: { value: '完成支付路由灰度切流演练', marker: JSON.parse(marker) } })}`
    const text = normalDraftJson(20).slice(0, -2) + block.repeat(Math.ceil(1600 / block.length) + 1)
    const verdict = detectRepetition(text)
    assert.exists(verdict)
    assert.equal(verdict!.period, block.length)
  })

  test('短语刷屏判为循环；少量重复（如「……」）不判', ({ assert }) => {
    assert.exists(detectRepetition(`开始${'好的，'.repeat(120)}`))
    assert.isNull(detectRepetition(`说明……${'。'.repeat(5)}`))
  })

  test('适配器：正文循环时中止上游请求，并以 repetition_loop 错误结束、带估算 usage', async ({
    assert,
  }) => {
    const unit = '{"id":"dep-1","predecessorId":"task-1","successorId":"task-2"},'
    const parts = Array.from({ length: 200 }, () => ({ choices: [{ delta: { content: unit } }] }))
    const { response, wasAborted } = streamOf(parts)
    const chunks = await collect(adapterWith(response))
    const last = chunks.at(-1)!
    assert.equal(last.kind, 'error')
    assert.equal(last.errorKind, 'repetition_loop')
    assert.isAbove(last.usage?.outputTokens ?? 0, 0)
    assert.deepEqual(last.usage?.finishReasons, ['repetition_loop'])
    assert.isTrue(wasAborted())
    assert.isBelow(chunks.filter((chunk) => chunk.kind === 'text').length, 200)
  })

  test('适配器：推理流循环同样中止（推理内容不对外输出）', async ({ assert }) => {
    const parts = Array.from({ length: 200 }, () => ({
      choices: [{ delta: { reasoning_content: '我需要再检查一遍依赖关系是否正确。' } }],
    }))
    const { response } = streamOf(parts)
    const chunks = await collect(adapterWith(response))
    assert.equal(chunks.at(-1)?.errorKind, 'repetition_loop')
    assert.include(chunks.at(-1)?.errorMessage ?? '', 'reasoning')
    assert.isFalse(chunks.some((chunk) => chunk.kind === 'text'))
  })

  test('适配器：正常完成时上报 reasoning_tokens', async ({ assert }) => {
    const { response } = streamOf([
      { choices: [{ delta: { content: '{"ok":true}' } }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 50,
          total_tokens: 60,
          completion_tokens_details: { reasoning_tokens: 42 },
        },
      },
    ])
    const chunks = await collect(adapterWith(response))
    const done = chunks.find((chunk) => chunk.kind === 'done')
    assert.equal(done?.usage?.reasoningTokens, 42)
    assert.equal(done?.usage?.outputTokens, 50)
  })

  test('适配器：usage 放在带空 delta 的末帧（部分兼容端点）也能取到', async ({ assert }) => {
    const { response } = streamOf([
      { choices: [{ delta: { content: '好的' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 313, completion_tokens: 115, total_tokens: 428 },
      },
    ])
    const chunks = await collect(adapterWith(response))
    const done = chunks.find((chunk) => chunk.kind === 'done')
    assert.equal(done?.usage?.inputTokens, 313)
    assert.equal(done?.usage?.outputTokens, 115)
    assert.equal(done?.usage?.totalTokens, 428)
  })
})
