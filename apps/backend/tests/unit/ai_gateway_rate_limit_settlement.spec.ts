/**
 * v3-copilot-live-submission-channel -- TPM 预估与实际偏差结算测试（任务 8.7）。
 *
 * 证明三件事：
 * 1. 回合落账后，gateway 用**既有 postflight** 结算偏差（decisionId + 真实 token），
 *    偏差写回既有 `rate_limit_decisions`，不新建偏差表（由 RateLimitTokenSettler
 *    窄接口委托给 RateLimitGuard.postflight）。
 * 2. 结算是 instrumentation：settler 抛错不改变业务终态（generate 仍成功）。
 * 3. 真实 token 未知（adapter 未报 usage）或无 decisionId 时不结算--
 *    否则会把窗口计数改写成 0，比不结算更糟。
 *
 * 纯 vitest：adapter/recorder/settler 全部注入，零 AdonisJS 运行时、零数据库、零网络。
 */

import { describe, it, expect, vi } from 'vitest'
import { AIGateway, type Adapter, type StreamChunk } from '../../app/services/ai_m0/gateway.js'

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

/** 可配置 token 用量的假 Adapter（不触网）。 */
function makeAdapter(usage?: StreamChunk['usage']): Adapter {
  return {
    providerName: 'test-provider',
    modelName: 'test-model',
    isReal: false,
    ping: async () => ({ ok: true }),
    stream: async function* (): AsyncGenerator<StreamChunk> {
      yield { kind: 'text', text: '{"title":"甲"}' }
      yield { kind: 'done', usage: usage ?? undefined }
    },
  } as never as Adapter
}

function makeRecorder() {
  return { record: vi.fn(async () => 'attempt-1') }
}

function makeSettler() {
  return { postflight: vi.fn(async () => ({ settled: true, deviation: 0 })) }
}

const OPTIONS = {
  sentence: '做一个甘特图工具',
  strategy: 'prompt',
} as const

// ---------------------------------------------------------------------------
// 偏差结算（8.7）
// ---------------------------------------------------------------------------

describe('TPM 偏差结算交由既有 postflight（8.7）', () => {
  it('落账后按真实 token 调 postflight（decisionId 与总量一致）', async () => {
    const settler = makeSettler()
    const gateway = new AIGateway(makeAdapter({ inputTokens: 120, outputTokens: 30 }), {
      recorder: makeRecorder(),
      recordContext: { rateLimitDecisionId: 'dec-tpm-0001' } as never,
      rateLimitSettler: settler,
    })
    await gateway.generate({ ...OPTIONS })
    expect(settler.postflight).toHaveBeenCalledTimes(1)
    expect(settler.postflight).toHaveBeenCalledWith({
      decisionId: 'dec-tpm-0001',
      actualTokens: 150,
    })
  })

  it('settler 抛错不改变业务终态（generate 仍成功）', async () => {
    const settler = {
      postflight: vi.fn(async () => {
        throw new Error('guard down')
      }),
    }
    const gateway = new AIGateway(makeAdapter({ inputTokens: 10, outputTokens: 5 }), {
      recorder: makeRecorder(),
      recordContext: { rateLimitDecisionId: 'dec-tpm-0002' } as never,
      rateLimitSettler: settler,
    })
    const result = await gateway.generate({ ...OPTIONS })
    expect(result.rawText).toContain('甲')
    expect(settler.postflight).toHaveBeenCalledTimes(1)
  })

  it('adapter 未报 usage（真实 token 未知）时不结算', async () => {
    const settler = makeSettler()
    const gateway = new AIGateway(makeAdapter(undefined), {
      recorder: makeRecorder(),
      recordContext: { rateLimitDecisionId: 'dec-tpm-0003' } as never,
      rateLimitSettler: settler,
    })
    await gateway.generate({ ...OPTIONS })
    expect(settler.postflight).not.toHaveBeenCalled()
  })

  it('无 decisionId（未设 TPM 限额或 RPM 维度）时不结算', async () => {
    const settler = makeSettler()
    const gateway = new AIGateway(makeAdapter({ inputTokens: 10, outputTokens: 5 }), {
      recorder: makeRecorder(),
      recordContext: {} as never,
      rateLimitSettler: settler,
    })
    await gateway.generate({ ...OPTIONS })
    expect(settler.postflight).not.toHaveBeenCalled()
  })

  it('未注入 settler 时零调用（缺省不结算，不抛错）', async () => {
    const gateway = new AIGateway(makeAdapter({ inputTokens: 10, outputTokens: 5 }), {
      recorder: makeRecorder(),
      recordContext: { rateLimitDecisionId: 'dec-tpm-0004' } as never,
    })
    const result = await gateway.generate({ ...OPTIONS })
    expect(result.triggeredErrors).toEqual([])
  })
})
