/**
 * v2-5-compiler-stage-cache-wiring —— Stage 缓存接线单元测试。
 *
 * 覆盖（tasks.md 对应编号）：
 * - 1.2 指纹稳定键与版本变化失效
 * - 1.4 缓存键与持久化值低敏（不含 raw input/prompt/output/token/secret/artifact payload）
 * - 2.4 Executor deterministic miss / hit（不重调 handler）/ feature-off 直连
 * - 2.5 llm/hybrid/gate/meta bypass，绝不读/写缓存、绝不报 hit
 * - 3.2 读失败 / 写失败 / Redis 不可用（全抛错 store）时 Stage 仍成功
 * - 3.3 腐坏缓存 → corrupt-recompute → 正常校验
 * - 3.4 跨组织相同输入互不命中（CacheStore org 命名空间）
 * - 3.5 并发 miss 允许重复计算但输出一致（P1）
 * - 4.3 hit 与 write-failed 的 cacheSummary 经 stage event 可查且低敏（真实 DB 写读）
 * - 4.4 cacheSummary 不经过 compiler_realtime_mapper 投影的说明性断言
 *
 * 全部为确定性 fixture，无真实模型调用。
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { z } from 'zod'
import type { StageDefinition, StageType } from '@aiproj/compiler-spec'
import { StageRegistry } from '#services/compiler/stage_registry'
import { ManifestBuilder, type StageBlueprint } from '#services/compiler/manifest_builder'
import { PipelineExecutor } from '#services/compiler/pipeline_executor'
import { StageCacheService } from '#services/compiler/stage_cache_service'
import {
  buildStageCacheFingerprint,
  stageCacheKeyFromFingerprint,
  STAGE_CACHE_POLICY_VERSION,
  type StageCacheFingerprint,
} from '#services/compiler/stage_cache_fingerprint'
import { computeContentHash } from '#services/compiler/artifact_store'
import { CompilerRunOrchestrator } from '#services/compiler/compiler_run_orchestrator'
import { CompilerRunService } from '#services/compiler/compiler_run_service'
import { ArtifactStore } from '#services/compiler/artifact_store'
import { StageEventLogger } from '#services/compiler/stage_event_logger'
import CompilerStageEvent from '#models/compiler_stage_event'
import Organization from '#models/organization'
import User from '#models/user'
import { MemoryCacheStore } from '#services/cache/cache_store'
import type { CompilerContext } from '#services/compiler/context_scope_resolver'
import {
  mapStageEventToEnvelope,
  validateEnvelopeSafety,
} from '#services/compiler/compiler_realtime_mapper'

// ── Fixtures ──

const outputSchema = z.object({
  stageId: z.string().min(1),
  ok: z.literal(true),
  value: z.number().int(),
})

function makeDefinition(
  stageId: string,
  type: StageType = 'deterministic',
  dependsOn: string[] = [],
): StageDefinition {
  return {
    stageId,
    type,
    phase: 'intake',
    name: `cache-wiring-${stageId}`,
    description: `stage-cache-wiring fixture ${stageId}`,
    inputSchema: z.any(),
    outputSchema,
    contextScope: ['run_metadata'],
    allowedTools: [],
    sideEffects: {
      writesArtifact: true,
      updatesManifest: true,
      updatesLedger: false,
      callsLlm: type === 'llm' || type === 'hybrid',
    },
    dependsOn,
    timeoutMs: 0,
  }
}

/** 确定性上下文：不含 run 相关 id，保证同输入指纹稳定。 */
function makeContext(): CompilerContext {
  return {
    userInput: { text: 'cache wiring fixture' },
    runMetadata: { benchmark: 'stage-cache-wiring' },
    stageOutputs: new Map<string, unknown>(),
    blueprints: {},
    fullDraft: {},
  }
}

/** 低敏测试用金丝雀：只能进入哈希，绝不允许出现在键、持久化值或事件摘要里。 */
const CANARY_PROMPT = 'PROMPT-CANARY-不要落盘'
const CANARY_SECRET = 'sk-SECRET-CANARY-123456'
const CANARY_OUTPUT = 'RAW-OUTPUT-CANARY-XYZ'

function makeCanaryContext(): CompilerContext {
  return {
    userInput: { prompt: CANARY_PROMPT, apiKey: CANARY_SECRET },
    runMetadata: { benchmark: 'stage-cache-wiring', canary: CANARY_OUTPUT },
    stageOutputs: new Map<string, unknown>(),
    blueprints: {},
    fullDraft: {},
  }
}

function makeBlueprints(stageIds: string[]): StageBlueprint[] {
  return stageIds.map((stageId) => ({
    stageId,
    phase: 'intake',
    dependsOn: [],
    entities: [{ entityId: `E_${stageId}`, kind: 'work_package' }],
  }))
}

/** 可控故障的内存 CacheStore：继承 MemoryCacheStore（真实 org 命名空间语义），加计数与故障注入。 */
class FakeCacheStore extends MemoryCacheStore {
  getCalls = 0
  setCalls = 0
  failGet = false
  failSet = false
  readonly #writes: Array<{ organizationId: number; key: string; value: string }> = []

  override async get(organizationId: number, key: string): Promise<string | null> {
    this.getCalls++
    if (this.failGet) throw new Error('fake store read failure')
    return super.get(organizationId, key)
  }

  override async set(
    organizationId: number,
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    this.setCalls++
    if (this.failSet) throw new Error('fake store write failure')
    this.#writes.push({ organizationId, key, value })
    return super.set(organizationId, key, value, ttlSeconds)
  }

  /** 测试辅助：把已写条目全部腐坏为非法 JSON。 */
  async corruptAll(): Promise<void> {
    for (const w of this.#writes) {
      await super.set(w.organizationId, w.key, '{{{corrupt-json', 3600)
    }
  }

  /** 已写入的逻辑键（不含 org 前缀）。 */
  storedKeys(): string[] {
    return this.#writes.map((w) => w.key)
  }

  /** 已写入的原始值（供低敏断言）。 */
  storedValues(): string[] {
    return this.#writes.map((w) => w.value)
  }
}

/** 内存 ArtifactStore 测试桩（只实现执行器用到的方法）。 */
class TestArtifactStore {
  records: any[] = []

  async save(record: any) {
    const entry = { ...record, id: this.records.length + 1 }
    this.records.push(entry)
    return entry
  }

  async getCheckpoints(runId: number) {
    return this.records
      .filter((r) => r.compilerRunId === runId && r.kind === 'checkpoint')
      .sort((a, b) => b.version - a.version)
  }

  async getStageOutputs(runId: number) {
    return this.records.filter(
      (r) => r.compilerRunId === runId && (r.kind === 'stage_output' || r.kind === 'model_output'),
    )
  }
}

/** 内存 StageEventLogger 测试桩：整条 entry 展开记录（含 cacheSummary）。 */
class TestEventLogger {
  events: any[] = []

  async started(entry: any) {
    this.events.push({ ...entry, status: 'running' })
  }

  async succeeded(entry: any) {
    this.events.push({ ...entry, status: 'completed' })
  }

  async failed(entry: any) {
    this.events.push({ ...entry, status: 'failed' })
  }

  async skipped(entry: any) {
    this.events.push({ ...entry, status: 'skipped' })
  }

  async needsHumanReview(entry: any) {
    this.events.push({ ...entry, status: 'needs_human_review' })
  }

  completedFor(stageId: string): any[] {
    return this.events.filter((e) => e.status === 'completed' && e.stageId === stageId)
  }
}

interface ExecutorHarness {
  executor: PipelineExecutor
  artifactStore: TestArtifactStore
  eventLogger: TestEventLogger
  cacheStore: FakeCacheStore
  handlerCalls: Map<string, number>
}

/** 构造启用缓存的 executor harness；options 可覆盖开关与 stage 类型。 */
function makeExecutorHarness(options?: {
  stageId?: string
  stageType?: StageType
  cacheEnabled?: boolean
  injectCache?: boolean
}): ExecutorHarness {
  const stageId = options?.stageId ?? 'det-stage'
  const registry = new StageRegistry()
  const artifactStore = new TestArtifactStore()
  const eventLogger = new TestEventLogger()
  const cacheStore = new FakeCacheStore()
  const handlerCalls = new Map<string, number>()

  const executor = new PipelineExecutor(registry, {
    artifactStore: artifactStore as any,
    stageEventLogger: eventLogger as any,
    ...(options?.injectCache === false
      ? {}
      : {
          stageCache: new StageCacheService(cacheStore),
          stageCacheEnabled: options?.cacheEnabled ?? true,
        }),
  })

  const definition = makeDefinition(stageId, options?.stageType ?? 'deterministic')
  executor.registerHandler(definition, async () => {
    handlerCalls.set(stageId, (handlerCalls.get(stageId) ?? 0) + 1)
    return { stageId, ok: true as const, value: 42 }
  })

  return { executor, artifactStore, eventLogger, cacheStore, handlerCalls }
}

async function executeOnce(
  harness: ExecutorHarness,
  runId: number,
  organizationId: number,
  context: CompilerContext = makeContext(),
) {
  const stageId = 'det-stage'
  const manifestBuilder = new ManifestBuilder(runId, makeBlueprints([stageId]))
  return harness.executor.execute({
    compilerRun: { id: runId } as any,
    manifestBuilder,
    initialContext: context,
    organizationId,
  })
}

// ── 1.1/1.2 指纹契约 ──

test.group('StageCacheFingerprint — 稳定键与版本失效（tasks 1.1-1.2）', () => {
  const definition = makeDefinition('fp-stage')

  test('相同定义与输入产生稳定键（含 Map 型 stageOutputs）', ({ assert }) => {
    const ctx = makeContext()
    ctx.stageOutputs.set('upstream', { ok: true, value: 1 })
    const inputOf = () => ({
      input: ctx,
      resolvedContext: { runMetadata: ctx.runMetadata },
      toolIds: [] as string[],
    })

    const fp1 = buildStageCacheFingerprint({ definition, contractVersion: '2.0', input: inputOf() })
    // 重新构造一个结构相同但引用全新的上下文（含同样的 Map 内容）
    const ctx2 = makeContext()
    ctx2.stageOutputs.set('upstream', { ok: true, value: 1 })
    const fp2 = buildStageCacheFingerprint({
      definition,
      contractVersion: '2.0',
      input: { input: ctx2, resolvedContext: { runMetadata: ctx2.runMetadata }, toolIds: [] },
    })

    assert.equal(fp1.inputHash, fp2.inputHash)
    assert.equal(stageCacheKeyFromFingerprint(fp1), stageCacheKeyFromFingerprint(fp2))
    assert.equal(fp1.cachePolicyVersion, STAGE_CACHE_POLICY_VERSION)
    assert.match(stageCacheKeyFromFingerprint(fp1), /^stage:fp-stage:[0-9a-f]{64}$/)
  })

  test('输入变化产生新键', ({ assert }) => {
    const fp1 = buildStageCacheFingerprint({
      definition,
      contractVersion: '2.0',
      input: { seed: 1 },
    })
    const fp2 = buildStageCacheFingerprint({
      definition,
      contractVersion: '2.0',
      input: { seed: 2 },
    })
    assert.notEqual(stageCacheKeyFromFingerprint(fp1), stageCacheKeyFromFingerprint(fp2))
  })

  test('contractVersion / handlerVersion / cachePolicyVersion / artifactRefs 变化分别产生新键', ({
    assert,
  }) => {
    const base = buildStageCacheFingerprint({
      definition,
      contractVersion: '2.0',
      input: { seed: 1 },
      artifactRefs: ['artifact:stage_output:a:v1@full'],
    })
    const baseKey = stageCacheKeyFromFingerprint(base)

    const contractChanged = buildStageCacheFingerprint({
      definition,
      contractVersion: '2.1',
      input: { seed: 1 },
      artifactRefs: ['artifact:stage_output:a:v1@full'],
    })
    assert.notEqual(stageCacheKeyFromFingerprint(contractChanged), baseKey)

    const handlerChanged = buildStageCacheFingerprint({
      definition,
      contractVersion: '2.0',
      handlerVersion: '2',
      input: { seed: 1 },
      artifactRefs: ['artifact:stage_output:a:v1@full'],
    })
    assert.notEqual(stageCacheKeyFromFingerprint(handlerChanged), baseKey)

    // cache policy 版本变化（手工构造不同 policyVersion 的指纹）
    const policyChanged: StageCacheFingerprint = { ...base, cachePolicyVersion: '2' }
    assert.notEqual(stageCacheKeyFromFingerprint(policyChanged), baseKey)

    const refsChanged = buildStageCacheFingerprint({
      definition,
      contractVersion: '2.0',
      input: { seed: 1 },
      artifactRefs: ['artifact:stage_output:b:v1@full'],
    })
    assert.notEqual(stageCacheKeyFromFingerprint(refsChanged), baseKey)
  })

  test('stage 类型差异产生新键', ({ assert }) => {
    const det = buildStageCacheFingerprint({
      definition: makeDefinition('same-id', 'deterministic'),
      contractVersion: '2.0',
      input: { seed: 1 },
    })
    const gate = buildStageCacheFingerprint({
      definition: makeDefinition('same-id', 'gate'),
      contractVersion: '2.0',
      input: { seed: 1 },
    })
    assert.notEqual(stageCacheKeyFromFingerprint(det), stageCacheKeyFromFingerprint(gate))
  })
})

// ── 1.4 低敏 ──

test.group('StageCache — 键与持久化值低敏（task 1.4）', () => {
  test('指纹、缓存键、持久化值与摘要不含 canary 与完整缓存键', async ({ assert }) => {
    const definition = makeDefinition('low-sens')
    const context = makeCanaryContext()
    const input = {
      input: context,
      resolvedContext: { runMetadata: context.runMetadata },
      toolIds: [] as string[],
    }
    const fingerprint = buildStageCacheFingerprint({ definition, contractVersion: '2.0', input })
    const key = stageCacheKeyFromFingerprint(fingerprint)

    // 键只含 stageId + 哈希
    for (const canary of [CANARY_PROMPT, CANARY_SECRET, CANARY_OUTPUT]) {
      assert.notInclude(key, canary)
      assert.notInclude(JSON.stringify(fingerprint), canary)
    }

    // 经服务持久化：值 = handler 输出，不含输入 canary
    const store = new FakeCacheStore()
    const service = new StageCacheService(store)
    const { summary } = await service.getOrComputeDetailed(1, fingerprint, async () => ({
      stageId: 'low-sens',
      ok: true as const,
      value: 7,
    }))

    const persisted = store.storedValues().join('\n')
    for (const canary of [CANARY_PROMPT, CANARY_SECRET, CANARY_OUTPUT]) {
      assert.notInclude(persisted, canary)
    }

    // 摘要不含完整键与 canary；cacheKeyHash 是键的哈希而不是键本身
    const summaryJson = JSON.stringify(summary)
    assert.notInclude(summaryJson, key)
    assert.notInclude(summaryJson, CANARY_PROMPT)
    assert.equal(summary.cacheKeyHash, computeContentHash(key))
    assert.match(summary.cacheKeyHash, /^[0-9a-f]{64}$/)
  })
})

// ── 1.3 / 3.x 服务级行为 ──

test.group('StageCacheService.getOrComputeDetailed — 状态与失败语义（tasks 1.3, 3.2-3.5）', () => {
  const definition = makeDefinition('svc-stage')
  const fingerprintOf = () =>
    buildStageCacheFingerprint({ definition, contractVersion: '2.0', input: { seed: 1 } })

  test('miss → hit；summary 字段齐备且 storeKind=memory', async ({ assert }) => {
    const store = new FakeCacheStore()
    const service = new StageCacheService(store)
    let computeCalls = 0
    const compute = async () => {
      computeCalls++
      return { stageId: 'svc-stage', ok: true as const, value: 1 }
    }

    const first = await service.getOrComputeDetailed(1, fingerprintOf(), compute)
    assert.equal(first.summary.status, 'miss')
    assert.equal(first.summary.cachePolicyVersion, STAGE_CACHE_POLICY_VERSION)
    assert.equal(first.summary.storeKind, 'memory')
    assert.isNumber(first.summary.durationMs)
    assert.isTrue(first.summary.durationMs >= 0)

    const second = await service.getOrComputeDetailed(1, fingerprintOf(), compute)
    assert.equal(second.summary.status, 'hit')
    assert.equal(computeCalls, 1)
    assert.deepEqual(second.value, first.value)
  })

  test('读异常按 miss 重算，Stage 结果不受影响', async ({ assert }) => {
    const store = new FakeCacheStore()
    store.failGet = true
    const service = new StageCacheService(store)

    const result = await service.getOrComputeDetailed(1, fingerprintOf(), async () => ({
      stageId: 'svc-stage',
      ok: true as const,
      value: 2,
    }))
    assert.equal(result.summary.status, 'miss')
    assert.equal(result.value.value, 2)
  })

  test('写异常记 write-failed 但仍返回计算结果', async ({ assert }) => {
    const store = new FakeCacheStore()
    store.failSet = true
    const service = new StageCacheService(store)

    const result = await service.getOrComputeDetailed(1, fingerprintOf(), async () => ({
      stageId: 'svc-stage',
      ok: true as const,
      value: 3,
    }))
    assert.equal(result.summary.status, 'write-failed')
    assert.equal(result.value.value, 3)
  })

  test('腐坏缓存 → corrupt-recompute 并覆盖为合法 JSON', async ({ assert }) => {
    const store = new FakeCacheStore()
    const service = new StageCacheService(store)
    let computeCalls = 0
    const compute = async () => {
      computeCalls++
      return { stageId: 'svc-stage', ok: true as const, value: 4 }
    }

    await service.getOrComputeDetailed(1, fingerprintOf(), compute)
    await store.corruptAll()

    const result = await service.getOrComputeDetailed(1, fingerprintOf(), compute)
    assert.equal(result.summary.status, 'corrupt-recompute')
    assert.equal(computeCalls, 2)

    // 覆盖后再次调用应正常命中
    const third = await service.getOrComputeDetailed(1, fingerprintOf(), compute)
    assert.equal(third.summary.status, 'hit')
    assert.equal(computeCalls, 2)
  })

  test('跨组织同指纹互不命中', async ({ assert }) => {
    const store = new FakeCacheStore()
    const service = new StageCacheService(store)
    let computeCalls = 0
    const compute = async () => {
      computeCalls++
      return { stageId: 'svc-stage', ok: true as const, value: 5 }
    }

    const org1 = await service.getOrComputeDetailed(1, fingerprintOf(), compute)
    const org2 = await service.getOrComputeDetailed(2, fingerprintOf(), compute)

    assert.equal(org1.summary.status, 'miss')
    // 第二个组织必须重新计算，绝不允许读到 org1 的值
    assert.equal(org2.summary.status, 'miss')
    assert.equal(computeCalls, 2)
  })

  test('并发 miss 允许重复计算但输出一致（task 3.5, P1）', async ({ assert }) => {
    const store = new FakeCacheStore()
    const service = new StageCacheService(store)
    let computeCalls = 0
    const compute = async () => {
      computeCalls++
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { stageId: 'svc-stage', ok: true as const, value: 6 }
    }

    // 无锁 best-effort（design Risks）：两个并发 miss 都允许重算
    const [a, b] = await Promise.all([
      service.getOrComputeDetailed(1, fingerprintOf(), compute),
      service.getOrComputeDetailed(1, fingerprintOf(), compute),
    ])
    assert.equal(computeCalls, 2)
    assert.deepEqual(a.value, b.value)

    // 并发结束后缓存已稳定：后续调用命中且值一致
    const after = await service.getOrComputeDetailed(1, fingerprintOf(), compute)
    assert.equal(after.summary.status, 'hit')
    assert.deepEqual(after.value, a.value)
    assert.equal(computeCalls, 2)
  })
})

// ── 2.x Executor 接线 ──

test.group('PipelineExecutor — deterministic 缓存接线（tasks 2.1-2.4）', () => {
  test('miss：handler 调用一次，事件带 miss 摘要，artifact 与 checkpoint 照常写入', async ({
    assert,
  }) => {
    const harness = makeExecutorHarness()
    const result = await executeOnce(harness, 1, 1)

    assert.isTrue(result.succeeded)
    assert.equal(harness.handlerCalls.get('det-stage'), 1)

    const completed = harness.eventLogger.completedFor('det-stage')
    assert.lengthOf(completed, 1)
    const summary = completed[0].cacheSummary
    assert.isDefined(summary)
    assert.equal(summary.status, 'miss')
    assert.equal(summary.cachePolicyVersion, STAGE_CACHE_POLICY_VERSION)
    assert.equal(summary.storeKind, 'memory')
    assert.match(summary.cacheKeyHash, /^[0-9a-f]{64}$/)

    // 命中与未命中都必须继续走完 artifact 与 checkpoint（tasks 2.3）
    const kinds = harness.artifactStore.records.map((r) => r.kind)
    assert.include(kinds, 'stage_output')
    assert.include(kinds, 'checkpoint')
  })

  test('hit：第二次运行不再调用 handler，输出与 artifact hash 一致，事件带 hit 摘要', async ({
    assert,
  }) => {
    const harness = makeExecutorHarness()
    const first = await executeOnce(harness, 1, 1)
    const second = await executeOnce(harness, 2, 1)

    assert.isTrue(first.succeeded)
    assert.isTrue(second.succeeded)
    // 缓存命中：handler 全程只被调用一次
    assert.equal(harness.handlerCalls.get('det-stage'), 1)

    const completed = harness.eventLogger.completedFor('det-stage')
    assert.lengthOf(completed, 2)
    assert.equal(completed[0].cacheSummary.status, 'miss')
    assert.equal(completed[1].cacheSummary.status, 'hit')
    assert.equal(completed[0].cacheSummary.cacheKeyHash, completed[1].cacheSummary.cacheKeyHash)

    // 两次运行的 stage_output artifact content hash 一致（确定性输出）
    const outputs = harness.artifactStore.records.filter((r) => r.kind === 'stage_output')
    assert.lengthOf(outputs, 2)
    assert.equal(outputs[0].contentHash, outputs[1].contentHash)
  })

  test('feature-off：注入服务但关闭开关时 handler 直连，不写任何 cache summary', async ({
    assert,
  }) => {
    const harness = makeExecutorHarness({ cacheEnabled: false })
    await executeOnce(harness, 1, 1)
    await executeOnce(harness, 2, 1)

    assert.equal(harness.handlerCalls.get('det-stage'), 2)
    assert.equal(harness.cacheStore.getCalls, 0)
    assert.equal(harness.cacheStore.setCalls, 0)
    for (const e of harness.eventLogger.events) {
      assert.isUndefined(e.cacheSummary)
    }
  })

  test('feature-off（默认 options 不传缓存槽位）：行为与接线前一致', async ({ assert }) => {
    const harness = makeExecutorHarness({ injectCache: false })
    const result = await executeOnce(harness, 1, 1)

    assert.isTrue(result.succeeded)
    assert.equal(harness.handlerCalls.get('det-stage'), 1)
    for (const e of harness.eventLogger.events) {
      assert.isUndefined(e.cacheSummary)
    }
  })
})

test.group('PipelineExecutor — 非 deterministic Stage bypass（task 2.5）', () => {
  for (const type of ['llm', 'hybrid', 'gate', 'meta'] as const) {
    test(`${type} Stage 重复执行不读/写缓存且不报 hit`, async ({ assert }) => {
      const harness = makeExecutorHarness({ stageId: `${type}-stage`, stageType: type })
      const manifestFor = (runId: number) =>
        new ManifestBuilder(runId, makeBlueprints([`${type}-stage`]))

      const first = await harness.executor.execute({
        compilerRun: { id: 1 } as any,
        manifestBuilder: manifestFor(1),
        initialContext: makeContext(),
        organizationId: 1,
      })
      const second = await harness.executor.execute({
        compilerRun: { id: 2 } as any,
        manifestBuilder: manifestFor(2),
        initialContext: makeContext(),
        organizationId: 1,
      })

      assert.isTrue(first.succeeded)
      assert.isTrue(second.succeeded)
      // handler 两次都被调用：非 deterministic Stage 绝不走缓存
      assert.equal(harness.handlerCalls.get(`${type}-stage`), 2)
      assert.equal(harness.cacheStore.getCalls, 0)
      assert.equal(harness.cacheStore.setCalls, 0)
      for (const e of harness.eventLogger.completedFor(`${type}-stage`)) {
        assert.isUndefined(e.cacheSummary)
      }
    })
  }
})

test.group('PipelineExecutor — 缓存失败降级与组织隔离（tasks 3.2-3.4）', () => {
  test('读失败：Stage 照常完成，记 miss 摘要', async ({ assert }) => {
    const harness = makeExecutorHarness()
    harness.cacheStore.failGet = true
    const result = await executeOnce(harness, 1, 1)

    assert.isTrue(result.succeeded)
    assert.equal(harness.handlerCalls.get('det-stage'), 1)
    assert.equal(harness.eventLogger.completedFor('det-stage')[0].cacheSummary.status, 'miss')
  })

  test('写失败：Stage 照常完成，记 write-failed 摘要', async ({ assert }) => {
    const harness = makeExecutorHarness()
    harness.cacheStore.failSet = true
    const result = await executeOnce(harness, 1, 1)

    assert.isTrue(result.succeeded)
    assert.equal(harness.handlerCalls.get('det-stage'), 1)
    const summary = harness.eventLogger.completedFor('det-stage')[0].cacheSummary
    assert.equal(summary.status, 'write-failed')
    assert.equal(summary.storeKind, 'memory')
  })

  test('Redis 不可用（读写全抛错）：Stage 仍成功完成（design D5）', async ({ assert }) => {
    const harness = makeExecutorHarness()
    harness.cacheStore.failGet = true
    harness.cacheStore.failSet = true
    const result = await executeOnce(harness, 1, 1)

    assert.isTrue(result.succeeded)
    assert.lengthOf(harness.eventLogger.completedFor('det-stage'), 1)
  })

  test('腐坏缓存：按 miss 重算、覆盖并继续正常校验（task 3.3）', async ({ assert }) => {
    const harness = makeExecutorHarness()
    await executeOnce(harness, 1, 1)
    await harness.cacheStore.corruptAll()

    const second = await executeOnce(harness, 2, 1)
    assert.isTrue(second.succeeded)
    // 腐坏 ⇒ 重算：handler 共调用两次
    assert.equal(harness.handlerCalls.get('det-stage'), 2)

    const completed = harness.eventLogger.completedFor('det-stage')
    assert.equal(completed[1].cacheSummary.status, 'corrupt-recompute')
    // 重算输出仍通过 output validation + Level 0/1（否则 Stage 不会 completed）
    const outputs = harness.artifactStore.records.filter((r) => r.kind === 'stage_output')
    assert.lengthOf(outputs, 2)
    assert.equal(outputs[0].contentHash, outputs[1].contentHash)
  })

  test('跨组织相同输入互不命中（task 3.4）', async ({ assert }) => {
    const harness = makeExecutorHarness()
    const context = makeContext()

    await executeOnce(harness, 1, 1, context)
    const second = await executeOnce(harness, 2, 2, context)

    assert.isTrue(second.succeeded)
    // org2 与 org1 输入完全一致，但命名空间隔离 ⇒ 必须重算
    assert.equal(harness.handlerCalls.get('det-stage'), 2)
    const completed = harness.eventLogger.completedFor('det-stage')
    assert.equal(completed[0].cacheSummary.status, 'miss')
    assert.equal(completed[1].cacheSummary.status, 'miss')
  })
})

// ── 3.1 生产接线（Orchestrator）──

test.group('CompilerRunOrchestrator — 生产缓存接线（tasks 3.1, design D6）', () => {
  function makeOrchestratorHarness(stageCache?: {
    service?: StageCacheService
    enabled?: boolean
  }) {
    const registry = new StageRegistry()
    const artifactStore = new TestArtifactStore()
    const eventLogger = new TestEventLogger()
    const orchestrator = new CompilerRunOrchestrator(
      registry,
      artifactStore as any,
      eventLogger as any,
      stageCache,
    )
    const handlerCalls = new Map<string, number>()
    const stageId = 'orch-det'
    orchestrator.registerHandler(makeDefinition(stageId), async () => {
      handlerCalls.set(stageId, (handlerCalls.get(stageId) ?? 0) + 1)
      return { stageId, ok: true as const, value: 42 }
    })
    const execute = (runId: number, organizationId = 1) =>
      orchestrator.execute({
        organizationId,
        userId: 1,
        runId,
        manifestBuilder: new ManifestBuilder(runId, makeBlueprints([stageId])),
        initialContext: makeContext(),
      })
    return { orchestrator, eventLogger, handlerCalls, execute, stageId }
  }

  test('默认构造即接线并启用（env 未设 COMPILER_STAGE_CACHE_ENABLED=false）', async ({
    assert,
  }) => {
    const { eventLogger, execute, stageId } = makeOrchestratorHarness()
    const result = await execute(900_101)

    assert.isTrue(result.success)
    const completed = eventLogger.completedFor(stageId)
    assert.lengthOf(completed, 1)
    assert.isDefined(completed[0].cacheSummary)
    assert.equal(completed[0].cacheSummary.status, 'miss')
  })

  test('注入缓存服务后第二次运行命中，handler 不重算', async ({ assert }) => {
    const { eventLogger, handlerCalls, execute, stageId } = makeOrchestratorHarness({
      service: new StageCacheService(new FakeCacheStore()),
      enabled: true,
    })

    await execute(900_201)
    const second = await execute(900_202)

    assert.isTrue(second.success)
    assert.equal(handlerCalls.get(stageId), 1)
    const completed = eventLogger.completedFor(stageId)
    assert.equal(completed[0].cacheSummary.status, 'miss')
    assert.equal(completed[1].cacheSummary.status, 'hit')
  })

  test('enabled=false 时 feature-off：handler 直连且无 cache summary', async ({ assert }) => {
    const { eventLogger, handlerCalls, execute, stageId } = makeOrchestratorHarness({
      service: new StageCacheService(new FakeCacheStore()),
      enabled: false,
    })

    await execute(900_301)
    await execute(900_302)

    assert.equal(handlerCalls.get(stageId), 2)
    for (const e of eventLogger.events) {
      assert.isUndefined(e.cacheSummary)
    }
  })
})

// ── 4.3 观测面（真实 DB 写读）──

test.group('StageCache — cacheSummary 经 stage event 可查且低敏（task 4.3）', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await testUtils.db().truncate()
  })

  async function createOrgUserAndRun(suffix: string) {
    const user = await User.create({
      email: `cache-wiring-${suffix}-${Date.now()}@test.local`,
      password: 'Password123!',
      fullName: 'Cache Wiring Test',
      authProvider: 'local',
      isActive: true,
    })
    const org = await Organization.create({
      ownerId: user.id,
      name: `Cache Wiring Org ${suffix}`,
      slug: `cache-wiring-${suffix}-${Date.now()}`,
    })
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())
    const startRun = () =>
      service.startRun({
        organizationId: org.id,
        userId: user.id,
        input: { text: 'cache wiring observability' },
      })
    return { org, startRun }
  }

  async function executeWithRealLogger(params: {
    runId: number
    organizationId: number
    cacheStore: FakeCacheStore
    context: CompilerContext
  }) {
    const registry = new StageRegistry()
    const artifactStore = new TestArtifactStore()
    const executor = new PipelineExecutor(registry, {
      artifactStore: artifactStore as any,
      stageEventLogger: new StageEventLogger(),
      stageCache: new StageCacheService(params.cacheStore),
      stageCacheEnabled: true,
    })
    const stageId = 'obs-stage'
    executor.registerHandler(makeDefinition(stageId), async () => ({
      stageId,
      ok: true as const,
      value: 42,
    }))
    const result = await executor.execute({
      compilerRun: { id: params.runId } as any,
      manifestBuilder: new ManifestBuilder(params.runId, makeBlueprints([stageId])),
      initialContext: params.context,
      organizationId: params.organizationId,
    })
    return { result, stageId }
  }

  function completedSummary(runId: number, stageId: string) {
    return CompilerStageEvent.query()
      .where('compiler_run_id', runId)
      .where('stage_id', stageId)
      .where('status', 'completed')
      .firstOrFail()
  }

  test('hit 与 miss 摘要可经 stage event 查询且不含敏感内容', async ({ assert }) => {
    const { org, startRun } = await createOrgUserAndRun('hit')
    const run = await startRun()
    const cacheStore = new FakeCacheStore()
    const context = makeCanaryContext()

    const first = await executeWithRealLogger({
      runId: run.id,
      organizationId: org.id,
      cacheStore,
      context,
    })
    assert.isTrue(first.result.succeeded)

    const missRow = await completedSummary(run.id, first.stageId)
    const missSummary = JSON.parse(missRow.validationSummary!)
    assert.equal(missSummary.cacheSummary.status, 'miss')
    assert.equal(missSummary.cacheSummary.cachePolicyVersion, STAGE_CACHE_POLICY_VERSION)
    assert.equal(missSummary.cacheSummary.storeKind, 'memory')
    assert.match(missSummary.cacheSummary.cacheKeyHash, /^[0-9a-f]{64}$/)
    assert.isNumber(missSummary.cacheSummary.durationMs)

    // 第二次运行（同组织、同输入、不同 run）→ 必须命中
    const run2 = await startRun()
    const second = await executeWithRealLogger({
      runId: run2.id,
      organizationId: org.id,
      cacheStore,
      context,
    })
    assert.isTrue(second.result.succeeded)

    const hitRow = await completedSummary(run2.id, second.stageId)
    const hitParsed = JSON.parse(hitRow.validationSummary!)
    assert.equal(hitParsed.cacheSummary.status, 'hit')
    assert.equal(hitParsed.cacheSummary.cacheKeyHash, missSummary.cacheSummary.cacheKeyHash)

    // 低敏：序列化后的事件摘要不含 canary、不含完整缓存键
    const raw = hitRow.validationSummary!
    const fullKey = cacheStore.storedKeys()[0]!
    assert.notInclude(raw, fullKey)
    assert.notInclude(raw, CANARY_PROMPT)
    assert.notInclude(raw, CANARY_SECRET)
    assert.notInclude(raw, CANARY_OUTPUT)
    assert.notInclude(raw.toLowerCase(), 'token')
  })

  test('write-failed 摘要可查且 Stage 保持成功', async ({ assert }) => {
    const { org, startRun } = await createOrgUserAndRun('wf')
    const run = await startRun()
    const cacheStore = new FakeCacheStore()
    cacheStore.failSet = true

    const { result, stageId } = await executeWithRealLogger({
      runId: run.id,
      organizationId: org.id,
      cacheStore,
      context: makeContext(),
    })
    assert.isTrue(result.succeeded)

    const row = await completedSummary(run.id, stageId)
    const parsed = JSON.parse(row.validationSummary!)
    assert.equal(parsed.cacheSummary.status, 'write-failed')
    assert.match(parsed.cacheSummary.cacheKeyHash, /^[0-9a-f]{64}$/)
    // write-failed 摘要同样不含完整键
    assert.notInclude(row.validationSummary!, 'org:')
  })
})

// ── 4.4 realtime mapper 不透传 cacheSummary ──

test.group('StageCache — realtime mapper 不投影 cacheSummary（task 4.4）', () => {
  test('mapper 的显式字段白名单不透传 cacheSummary，envelope 安全检查通过', ({ assert }) => {
    // 结论：cacheSummary 只写入 stage event 的 validationSummary JSON（DB 查询面），
    // compiler_realtime_mapper 经 extractAllowedFields 显式白名单取字段，
    // 新增的可选 cacheSummary 不会进入 StreamingProgressEnvelope —— 无需修改 mapper。
    const envelope = mapStageEventToEnvelope(
      {
        compilerRunId: 1,
        organizationId: 1,
        stageId: 'det-stage',
        phase: 'intake',
        llmCalls: 0,
        llmCost: 0,
        cacheSummary: {
          status: 'hit',
          cacheKeyHash: computeContentHash('key'),
          cachePolicyVersion: STAGE_CACHE_POLICY_VERSION,
          storeKind: 'memory',
          durationMs: 1,
        },
      },
      'completed',
    )

    const serialized = JSON.stringify(envelope)
    assert.notInclude(serialized, 'cacheSummary')
    assert.notInclude(serialized, 'cacheKeyHash')
    assert.isTrue(validateEnvelopeSafety(envelope))
  })
})
