/**
 * 重复循环遥测：账本记录 reasoning_tokens / output_tokens / loop（error_kind + finish_reasons）
 * / 重试序号（attempt_number）与 prompt 类别，便于按模型、推理强度、prompt 统计循环率与浪费 token。
 * 纯 vitest：adapter/recorder 注入，零数据库、零网络。
 */
import { describe, expect, it } from 'vitest'
import type { UnifiedAiInvocationAttempt } from '@aiproj/types'
import { AIGateway, type Adapter, type StreamChunk } from '../../app/services/ai_m0/gateway.js'

function adapterEmitting(chunks: StreamChunk[]): Adapter {
  return {
    providerName: 'openai-compatible',
    modelName: 'gpt-5.6-luna',
    isReal: true,
    async *stream() {
      for (const chunk of chunks) yield chunk
    },
  } as unknown as Adapter
}

async function drain(gateway: AIGateway, options: Record<string, unknown>) {
  for await (const chunk of gateway.stream({ sentence: '测试', strategy: 'prompt', ...options })) {
    // 消费完整个流才会落账。
    void chunk
  }
}

describe('AIGateway 循环遥测落账', () => {
  it('循环中止：error_kind=repetition_loop、finish_reasons=[repetition_loop]、估算输出 token、重试序号与 prompt 类别', async () => {
    const records: UnifiedAiInvocationAttempt[] = []
    const gateway = new AIGateway(
      adapterEmitting([
        { kind: 'text', text: 'abc' },
        {
          kind: 'error',
          errorKind: 'repetition_loop',
          errorMessage: 'repetition_loop:content:period=60:repeats=30',
          usage: { outputTokens: 720, finishReasons: ['repetition_loop'] },
        },
      ]),
      { recorder: { record: async (attempt) => (records.push(attempt), 'ok') } },
    )
    await drain(gateway, { attemptNumber: 2, promptName: 'draft.wbs_tasks.branch' })
    expect(records).toHaveLength(1)
    expect(records[0].error_kind).toBe('repetition_loop')
    expect(records[0].finish_reasons).toEqual(['repetition_loop'])
    expect(records[0].usage_output_tokens).toBe(720)
    expect(records[0].aiproj_attempt_number).toBe(2)
    expect(records[0].prompt_name).toBe('draft.wbs_tasks.branch')
  })

  it('正常完成：落账 reasoning_tokens', async () => {
    const records: UnifiedAiInvocationAttempt[] = []
    const gateway = new AIGateway(
      adapterEmitting([
        { kind: 'text', text: '{}' },
        { kind: 'done', usage: { inputTokens: 10, outputTokens: 50, reasoningTokens: 42 } },
      ]),
      { recorder: { record: async (attempt) => (records.push(attempt), 'ok') } },
    )
    await drain(gateway, { promptName: 'draft.schedule_dependencies' })
    expect(records[0].usage_reasoning_output_tokens).toBe(42)
    expect(records[0].usage_output_tokens).toBe(50)
    expect(records[0].error_kind).toBe('none')
    expect(records[0].aiproj_attempt_number).toBe(1)
  })
})
