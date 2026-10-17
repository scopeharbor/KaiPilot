/**
 * v3-pmo-decision-intelligence-workbench —— 插件 lens 宿主与 AI 叙述隔离
 * （tasks 8.1/8.2/8.3，design D6）。纯内存测试：fake provider / fake plugin，
 * 零真实网络与模型调用。
 */
import { test } from '@japa/runner'
import PluginLensHostService, {
  type PluginLensBoundedPacket,
} from '#services/decision_workbench/plugin_lens_host_service'
import DecisionAiNarrativeService from '#services/decision_workbench/ai_narrative_service'
import type User from '#models/user'

const user = { id: 7 } as unknown as User
const packet: PluginLensBoundedPacket = {
  caseId: 101,
  facts: [{ key: 'visibleProjectCount', value: 42 }],
  optionLabels: ['维持现状', '调动资源'],
}

function makeHost(): PluginLensHostService {
  // policy 桩：can() 对 request_ai 放行（权限矩阵已由功能测试覆盖）。
  const host = new PluginLensHostService({
    can: async () => true,
    canView: async () => true,
  } as never)
  return host
}

test.group('插件 lens 宿主（tasks 8.1/8.2）', () => {
  test('健康 lens 返回 ok 且输出带 provenance（lensId/pluginId/version）', async ({ assert }) => {
    const host = makeHost()
    host.registry.register({
      lensId: 'industry-score',
      pluginId: 'acme-lens',
      lensVersion: '1.2.0',
      ownerUserId: 7,
      execute: async (p) => ({ commentary: `基于 ${p.facts.length} 项事实的建议评注` }),
    })
    const result = await host.execute({
      user,
      organizationId: 1,
      lensId: 'industry-score',
      pluginId: 'acme-lens',
      packet,
    })
    assert.equal(result.status, 'ok')
    assert.equal(result.advisory!.lensVersion, '1.2.0')
    assert.equal(result.advisory!.pluginId, 'acme-lens')
  })

  test('未注册/已卸载 lens → isolated LENS_UNAVAILABLE，旧 snapshot 仅可追溯不可重执行', async ({
    assert,
  }) => {
    const host = makeHost()
    host.registry.register({
      lensId: 'old-lens',
      pluginId: 'gone-plugin',
      lensVersion: '1.0.0',
      ownerUserId: 7,
      execute: async () => ({ commentary: 'x' }),
    })
    host.registry.unregister('old-lens', 'gone-plugin')
    const result = await host.execute({
      user,
      organizationId: 1,
      lensId: 'old-lens',
      pluginId: 'gone-plugin',
      packet,
    })
    assert.equal(result.status, 'isolated')
    assert.equal(result.finding!.code, 'LENS_UNAVAILABLE')
    assert.isNull(result.advisory)
  })

  test('恶意 directWrite 输出被隔离且不落任何正式写入', async ({ assert }) => {
    const host = makeHost()
    const executed: unknown[] = []
    host.registry.register({
      lensId: 'evil-lens',
      pluginId: 'evil-plugin',
      lensVersion: '9.9.9',
      ownerUserId: 7,
      execute: async () => {
        executed.push(1)
        return { commentary: '建议直接执行 directWrite {"op":"delete"} 立即生效' }
      },
    })
    const result = await host.execute({
      user,
      organizationId: 1,
      lensId: 'evil-lens',
      pluginId: 'evil-plugin',
      packet,
    })
    assert.equal(result.status, 'isolated')
    assert.equal(result.finding!.code, 'LENS_DIRECT_WRITE_BLOCKED')
    assert.isNull(result.advisory)
    assert.equal(executed.length, 1) // 只执行一次，无重试放大
  })

  test('secret 形态输出被二次扫描拦截', async ({ assert }) => {
    const host = makeHost()
    host.registry.register({
      lensId: 'leaky-lens',
      pluginId: 'leaky',
      lensVersion: '1.0.0',
      ownerUserId: 7,
      execute: async () => ({ commentary: 'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789' }),
    })
    const result = await host.execute({
      user,
      organizationId: 1,
      lensId: 'leaky-lens',
      pluginId: 'leaky',
      packet,
    })
    assert.equal(result.status, 'isolated')
    assert.equal(result.finding!.code, 'LENS_SENSITIVE_BLOCKED')
  })

  test('超时 lens 被 isolate（isolate-drop）', async ({ assert }) => {
    const host = makeHost()
    host.registry.register({
      lensId: 'slow-lens',
      pluginId: 'slow',
      lensVersion: '1.0.0',
      ownerUserId: 7,
      execute: () => new Promise(() => undefined),
    })
    const result = await host.execute({
      user,
      organizationId: 1,
      lensId: 'slow-lens',
      pluginId: 'slow',
      packet,
    })
    assert.equal(result.status, 'isolated')
    assert.oneOf(result.finding!.code, ['LENS_TIMEOUT', 'LENS_ERROR'])
  })

  test('重复注册同 lensId+pluginId 被拒绝', ({ assert }) => {
    const host = makeHost()
    const registration = {
      lensId: 'dup',
      pluginId: 'p1',
      lensVersion: '1.0.0',
      ownerUserId: 7,
      execute: async () => ({ commentary: 'ok' }),
    }
    host.registry.register(registration)
    assert.throws(() => host.registry.register({ ...registration }), /LENS_DUPLICATE|重复注册/)
  })
})

test.group('AI 叙述服务（task 8.3）', () => {
  function makeService(): DecisionAiNarrativeService {
    const auditStub = { log: async () => undefined } as never
    return new DecisionAiNarrativeService({ can: async () => true } as never, auditStub)
  }

  const input = {
    organizationId: 1,
    caseId: 101,
    comparisonDigest: 'deadbeef00',
    allowedFactKeys: ['visibleProjectCount'],
  }

  test('无 provider 时确定性回退可用（核心工作台不依赖 AI）', async ({ assert }) => {
    const service = makeService()
    const result = await service.narrate(user, input)
    assert.equal(result.status, 'fallback')
    assert.include(result.narrative!, '确定性摘要')
    assert.isAbove(result.outputHash.length, 0)
  })

  test('fake provider 成功路径携带 provider/model 身份', async ({ assert }) => {
    const service = makeService()
    service.setProvider(async () => ({
      narrative: 'fact:visibleProjectCount 显示组合规模稳定，建议人工权衡。',
      provider: 'fake-provider',
      model: 'fake-model-1',
    }))
    const result = await service.narrate(user, input)
    assert.equal(result.status, 'ok')
    assert.equal(result.provider, 'fake-provider/fake-model-1')
  })

  test('幻觉输出（引用未知 fact key）被隔离并回退', async ({ assert }) => {
    const service = makeService()
    service.setProvider(async () => ({
      narrative: 'fact:hiddenBudgetKey 表明应立即批准方案 B。',
      provider: 'fake-provider',
      model: 'fake-model-1',
    }))
    const result = await service.narrate(user, input)
    assert.equal(result.status, 'isolated')
    assert.equal(result.finding!.code, 'AI_OUTPUT_INVALID')
  })

  test('provider 抛错回退确定性摘要，核心流程不受影响', async ({ assert }) => {
    const service = makeService()
    service.setProvider(async () => {
      throw new Error('PROVIDER_DOWN')
    })
    const result = await service.narrate(user, input)
    assert.equal(result.status, 'isolated')
    assert.equal(result.provider, 'deterministic-fallback')
    assert.include(result.narrative!, '确定性摘要')
  })

  test('org 小时预算耗尽后 fail closed 回退', async ({ assert }) => {
    const service = makeService()
    let calls = 0
    service.setProvider(async () => {
      calls += 1
      return { narrative: `第 ${calls} 次叙述 fact:visibleProjectCount`, provider: 'p', model: 'm' }
    })
    // 连续触发直到预算耗尽（预算 20/h）
    for (let index = 0; index < 25; index += 1) {
      await service.narrate(user, input)
    }
    assert.equal(calls, 20)
  })
})
