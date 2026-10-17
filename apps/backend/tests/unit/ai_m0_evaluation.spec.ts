import { test } from '@japa/runner'
import { buildEvaluationPlan } from '#services/ai_m0/evaluation_plan'
import AiM0EvaluationService from '#services/ai_m0/evaluation_service'
import { AiM0StreamSessionService } from '#services/ai_m0/stream_session_service'
import {
  AIGateway,
  type Adapter,
  type GenerateOptions,
  type StreamChunk,
} from '#services/ai_m0/gateway'
import { MockAdapter } from '#services/ai_m0/mock_adapter'
import { hashInputCases } from '#services/ai_m0/inputs'

class FakeRealAdapter implements Adapter {
  readonly providerName = 'fake-provider'
  readonly modelName = 'fake-model-v1'
  readonly isReal = true
  async ping() {
    return { ok: true }
  }
  async *stream(_: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { kind: 'text', text: '{"ok":true}' }
    yield { kind: 'done' }
  }
}

test.group('AI M0 self-service evaluation', () => {
  test('真实计划稳定生成 12×20×3=720 步', ({ assert }) => {
    const first = buildEvaluationPlan({ mode: 'real' })
    const second = buildEvaluationPlan({ mode: 'real', repetitions: 1 })
    assert.lengthOf(first, 720)
    assert.deepEqual(first, second)
    assert.equal(first[0].id, 'prompt:sw-01:01')
    assert.equal(first.at(-1)?.id, 'tool:pd-03:20')
  })

  test('演练可用 1 次重复且永远不可作为证据', async ({ assert }) => {
    const service = new AiM0EvaluationService(null as never)
    const outcome = await service.execute(1, {
      stepId: 'prompt:sw-02:01',
      inputId: 'sw-02',
      requestedStrategy: 'prompt',
      repetition: 1,
      mode: 'dry_run',
    })
    assert.equal(outcome.mode, 'dry_run')
    assert.isFalse(outcome.usingRealAdapter)
    assert.isFalse(outcome.evidenceEligible)
    assert.equal(outcome.inputId, 'sw-02')
    assert.equal(outcome.markerCoverage, 1)
    assert.isNotEmpty(outcome.inputSetHash)
  })

  test('真实评测缺少显式连接时在调用 Adapter 前拒绝', async ({ assert }) => {
    const service = new AiM0EvaluationService(null as never)
    await assert.rejects(
      () =>
        service.execute(1, {
          stepId: 'prompt:sw-01:01',
          inputId: 'sw-01',
          requestedStrategy: 'prompt',
          repetition: 1,
          mode: 'real',
        }),
      '真实评测必须选择 AI 连接',
    )
  })
})

test.group('AI M0 stream session', () => {
  test('重读同一 streamId 只回放未读事件且 Adapter 仅调用一次', async ({ assert }) => {
    let calls = 0
    const adapter: Adapter = {
      providerName: 'fake',
      modelName: 'fake-v1',
      isReal: false,
      async ping() {
        return { ok: true }
      },
      async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        calls += 1
        yield { kind: 'text', text: '{"x":' }
        yield { kind: 'text', text: '1}' }
        yield { kind: 'done' }
      },
    }
    const sessions = new AiM0StreamSessionService()
    const streamId = sessions.start({
      gateway: new AIGateway(adapter),
      generate: { sentence: '测试项目', strategy: 'prompt' },
      finish: ({ rawText }) => ({ rawText }),
    })
    await sessions.waitForChange(streamId)
    while (!sessions.isComplete(streamId)) await sessions.waitForChange(streamId)

    const all = sessions.read(streamId, 0)
    const afterFirst = sessions.read(streamId, 1)
    assert.equal(calls, 1)
    assert.lengthOf(all, 3)
    assert.deepEqual(afterFirst, all.slice(1))
    assert.equal(all.at(-1)?.event, 'done')
    assert.equal(all.at(-1)?.data.rawText, '{"x":1}')
  })

  test('未知或过期 streamId 返回 STREAM_EXPIRED', ({ assert }) => {
    const sessions = new AiM0StreamSessionService()
    try {
      sessions.read('missing', 0)
      assert.fail('应抛出 STREAM_EXPIRED')
    } catch (error) {
      assert.equal((error as any).code, 'STREAM_EXPIRED')
      assert.equal((error as any).status, 410)
    }
  })
})

test.group('AI M0 evidence eligibility & adapter metadata', () => {
  test('MockAdapter 元数据：providerName/modelName/isReal=false', ({ assert }) => {
    const m = new MockAdapter()
    assert.equal(m.providerName, 'mock')
    assert.equal(m.modelName, 'mock-deterministic-v1')
    assert.isFalse(m.isReal)
  })

  test('FakeRealAdapter 元数据：providerName/modelName/isReal=true', ({ assert }) => {
    const a = new FakeRealAdapter()
    assert.equal(a.providerName, 'fake-provider')
    assert.equal(a.modelName, 'fake-model-v1')
    assert.isTrue(a.isReal)
  })

  test('MockAdapter AIGateway 透传 provider/model/usingRealAdapter=false', async ({ assert }) => {
    const gw = new AIGateway(new MockAdapter())
    const r = await gw.generate({ sentence: 'test', strategy: 'prompt' })
    assert.equal(gw.provider, 'mock')
    assert.equal(gw.model, 'mock-deterministic-v1')
    assert.isFalse(gw.usingRealAdapter)
    assert.isFalse(r.usingRealAdapter)
  })

  test('FakeRealAdapter AIGateway 透传 provider/model/usingRealAdapter=true', async ({
    assert,
  }) => {
    const gw = new AIGateway(new FakeRealAdapter())
    const r = await gw.generate({ sentence: 'test', strategy: 'prompt' })
    assert.equal(gw.provider, 'fake-provider')
    assert.equal(gw.model, 'fake-model-v1')
    assert.isTrue(gw.usingRealAdapter)
    assert.isTrue(r.usingRealAdapter)
  })

  test('evidenceEligible 合成：dry_run → false', async ({ assert }) => {
    const service = new AiM0EvaluationService(null as never)
    const outcome = await service.execute(1, {
      stepId: 'prompt:sw-02:01',
      inputId: 'sw-02',
      requestedStrategy: 'prompt',
      repetition: 1,
      mode: 'dry_run',
    })
    assert.isFalse(outcome.evidenceEligible)
    assert.isFalse(outcome.usingRealAdapter)
    assert.equal(outcome.mode, 'dry_run')
  })

  test('evidenceEligible 合成：real+无连接 → 拒绝', async ({ assert }) => {
    const service = new AiM0EvaluationService(null as never)
    await assert.rejects(
      () =>
        service.execute(1, {
          stepId: 'prompt:sw-01:01',
          inputId: 'sw-01',
          requestedStrategy: 'prompt',
          repetition: 1,
          mode: 'real',
        }),
      '真实评测必须选择 AI 连接',
    )
  })

  test('inputSetHash 稳定且非空', ({ assert }) => {
    const h = hashInputCases()
    assert.isNotEmpty(h)
    assert.isTrue(/^[0-9a-f]{8}$/.test(h), 'hash 应为 8 位十六进制')
  })
})
