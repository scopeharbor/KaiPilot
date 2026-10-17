/**
 * v2-5-compiler-execution-gap-benchmark —— 第二/三层证据采集（tasks 3.2-3.4, 4.1）。
 *
 * 第二层：isolated `PipelineExecutor`——注入内存 store，跑全部 fixture，采集行为证据。
 * 第三层：生产 service path——经 `CompilerRunService.startRun` 发起，观察未显式传入
 * orchestrator 的服务层默认行为。Controller 生产入口会传入 orchestrator；本层保留为
 * fallback/no-op 边界，防止 benchmark 自己伪造执行器证据。
 *
 * design「benchmark 反向改变生产代码」风险的对策：这里只使用**既有公开 seam**
 * （`ExecutorOptions` 的 artifactStore/stageEventLogger 注入、`registerHandler`）。
 * 没有为 benchmark 新增任何生产 seam；发现缺 seam 时按 gap 记录，不动生产代码。
 */

import CompilerRun from '#models/compiler_run'
import CompilerStageEvent from '#models/compiler_stage_event'
import CompilerArtifact from '#models/compiler_artifact'
import { StageRegistry } from '#services/compiler/stage_registry'
import { ManifestBuilder } from '#services/compiler/manifest_builder'
import { PipelineExecutor } from '#services/compiler/pipeline_executor'
import type { StageHandler } from '#services/compiler/pipeline_executor'
import { ArtifactStore, computeContentHash } from '#services/compiler/artifact_store'
import { StageCacheService, stageCacheKey } from '#services/compiler/stage_cache_service'
import { CompilerRunService } from '#services/compiler/compiler_run_service'
import {
  CountingMemoryCacheStore,
  InMemoryArtifactStore,
  InMemoryStageEventLogger,
} from './in_memory_stores.js'
import {
  fixtureBlueprints,
  fixtureContext,
  fixtureDefinitions,
  fixtureHandler,
  StageRecorder,
  type CompilerFixture,
} from './fixtures.js'
import type {
  CacheProbeResult,
  FixtureAggregate,
  FixtureRunObservation,
  ObservedStageStatus,
  ResumeProbeResult,
  StageObservation,
} from './types.js'

/** benchmark 使用的组织 id；isolated 层不落库，仅作为组织隔离参数传递。 */
export const BENCHMARK_ORG_ID = 999_001

function assertTerminalStatus(stageId: string, status: string): ObservedStageStatus {
  if (status === 'completed' || status === 'failed' || status === 'skipped') {
    return status
  }
  // 非终态意味着 fixture 假设已失效——大声失败，好过悄悄归一成某个分类。
  throw new Error(`Fixture stage ${stageId} 停在非终态 "${status}"，fixture 预期已过时`)
}

// ── 第二层：isolated PipelineExecutor（tasks 3.2, 3.4）──

export async function runIsolatedFixture(
  fixture: CompilerFixture,
  runIndex: number,
): Promise<FixtureRunObservation> {
  const runId = 900_000 + runIndex
  const recorder = new StageRecorder()

  const registry = new StageRegistry()
  const definitions = fixtureDefinitions(fixture)
  for (const def of definitions) registry.register(def)

  const manifestBuilder = new ManifestBuilder(runId, fixtureBlueprints(fixture))
  const artifactStore = new InMemoryArtifactStore()
  const stageEventLogger = new InMemoryStageEventLogger()

  // v2-5-compiler-stage-cache-wiring 起 ExecutorOptions 已有 stageCache/stageCacheEnabled 槽位；
  // 本矩阵刻意不传（stageCacheEnabled 默认 false = feature-off），保持各 fixture 行为证据
  // 与接线前可比；缓存行为由 compiler_stage_cache_wiring.spec 与本 spec 的 5.2 用例专门覆盖。
  const executor = new PipelineExecutor(registry, { artifactStore, stageEventLogger })

  for (const spec of fixture.specs) {
    const def = definitions.find((d) => d.stageId === spec.stageId)!
    executor.registerHandler(def, fixtureHandler(spec, recorder) as StageHandler<unknown, unknown>)
  }

  // isolated 层不落库：用最小 run 替身，只提供执行器读取的 `id`。
  const compilerRun = { id: runId } as unknown as CompilerRun
  const initialContext = fixtureContext(fixture.fixtureId)

  recorder.reset()
  const result = await executor.execute({
    compilerRun,
    manifestBuilder,
    initialContext,
    organizationId: BENCHMARK_ORG_ID,
  })
  const wallClockMs = recorder.elapsedMs

  const manifest = manifestBuilder.get()
  const stages: StageObservation[] = manifest.executionPlan.map((step) => {
    const span = recorder.spans.find((s) => s.stageId === step.stageId)
    return {
      stageId: step.stageId,
      phase: step.phase,
      parallelGroup: step.parallelGroup ?? null,
      status: assertTerminalStatus(step.stageId, step.status),
      attempts: recorder.attemptsOf(step.stageId),
      startOffsetMs: span?.startOffsetMs ?? 0,
      endOffsetMs: span?.endOffsetMs ?? 0,
    }
  })

  const artifactHashByStage: Record<string, string> = {}
  for (const rec of artifactStore.records) {
    if ((rec.kind === 'stage_output' || rec.kind === 'model_output') && rec.stageId) {
      artifactHashByStage[rec.stageId] = rec.contentHash ?? ''
    }
  }

  const cacheProbe =
    fixture.fixtureId === 'cache-repeat' ? await probeStageCache(fixture.fixtureId) : null

  const resumeProbe =
    fixture.fixtureId === 'checkpoint-resume'
      ? await probeResumeReplay({ executor, compilerRun, fixture, recorder, initialContext })
      : null

  return {
    fixtureId: fixture.fixtureId,
    runIndex,
    wallClockMs,
    stages,
    maxObservedConcurrency: recorder.maxConcurrency,
    overlappingPairs: recorder.overlappingPairs(),
    checkpointCount: artifactStore.records.filter((r) => r.kind === 'checkpoint').length,
    artifactKinds: artifactStore.countByKind(),
    artifactHashByStage,
    // 本矩阵 feature-off 运行（未注入 stageCache），执行器不接触 CacheStore，故恒为 0；
    // 缓存命中证据见 compiler_stage_cache_wiring.spec 与 benchmark spec 的 5.2 用例。
    cacheHits: 0,
    cacheMisses: 0,
    eventStatusCounts: stageEventLogger.countByStatus(),
    runTerminalStatus: null,
    succeeded: result.succeeded,
    failedStages: result.failedStages,
    checkpointVersion: result.checkpointVersion,
    cacheProbe,
    resumeProbe,
  }
}

/**
 * 缓存探针：独立验证 `StageCacheService` 自身是否可用。
 *
 * 这**不是**执行链证据——执行器从不调用它。分开测是为了区分
 * 「缓存服务坏了」（missing）与「缓存服务好但没接」（foundation-unwired）。
 */
async function probeStageCache(fixtureId: string): Promise<CacheProbeResult> {
  const store = new CountingMemoryCacheStore()
  const service = new StageCacheService(store, 3600)
  const input = { fixture: fixtureId, stageId: 'k1', payload: { value: 40 } }

  let computeCalls = 0
  const compute = async () => {
    computeCalls++
    return { stageId: 'k1', ok: true as const, value: 40 }
  }

  const first = await service.getOrCompute(BENCHMARK_ORG_ID, 'k1', input, compute)
  const second = await service.getOrCompute(BENCHMARK_ORG_ID, 'k1', input, compute)

  // 结构相同但引用不同的输入必须得到同一缓存键，否则缓存无法跨请求命中。
  const equivalentInput = { fixture: fixtureId, stageId: 'k1', payload: { value: 40 } }
  const inputHashStable = stageCacheKey('k1', input) === stageCacheKey('k1', equivalentInput)

  return {
    hits: store.hits,
    misses: store.misses,
    resultsIdentical: JSON.stringify(first) === JSON.stringify(second),
    inputHashStable,
    computeCalls,
  }
}

/**
 * 恢复/重放探针。
 *
 * 关键测量：resume 之后 handler 是否被再次调用（`reExecutedStages`）。
 * 若 resume 只还原 manifest 状态而不续跑，这里会是空数组——那是必须写进报告的限制。
 */
async function probeResumeReplay(params: {
  executor: PipelineExecutor
  compilerRun: CompilerRun
  fixture: CompilerFixture
  recorder: StageRecorder
  initialContext: ReturnType<typeof fixtureContext>
}): Promise<ResumeProbeResult> {
  const { executor, compilerRun, fixture, recorder, initialContext } = params

  const attemptsBefore = new Map(recorder.attempts)

  // 用全新 ManifestBuilder 模拟「进程重启后从 checkpoint 恢复」。
  const resumeManifestBuilder = new ManifestBuilder(compilerRun.id, fixtureBlueprints(fixture))
  const resumeResult = await executor.resume({
    compilerRun,
    manifestBuilder: resumeManifestBuilder,
    initialContext,
    organizationId: BENCHMARK_ORG_ID,
  })

  const restoredCompletedStages = (resumeResult.manifest?.executionPlan ?? [])
    .filter((s) => s.status === 'completed')
    .map((s) => s.stageId)

  const reExecutedStages: string[] = []
  for (const [stageId, count] of recorder.attempts) {
    if (count > (attemptsBefore.get(stageId) ?? 0)) reExecutedStages.push(stageId)
  }

  const replayResult = await executor.replay(compilerRun.id, 1)

  return {
    resumed: resumeResult.resumed,
    checkpointVersion: resumeResult.checkpointVersion,
    restoredCompletedStages: restoredCompletedStages.sort(),
    reExecutedStages: reExecutedStages.sort(),
    replayReplayed: replayResult.replayed,
    replayStages: replayResult.stages,
    replayMissingArtifacts: replayResult.missingArtifacts.sort(),
  }
}

// ── 第三层：生产 service path（tasks 3.3）──

export interface ProductionPathObservation {
  fixtureId: string
  runId: number
  /** startRun 返回后的 run.status。 */
  statusAfterStartRun: string
  /** 稍后重读 DB 得到的 run.status——用于检测是否有异步执行改写终态。 */
  statusAfterSettle: string
  stageEventRows: number
  artifactRows: number
  /** 生产路径上 handler 被调用的次数。 */
  handlerInvocations: number
  /** 生产路径是否真的驱动了任何 stage。 */
  executorDroveAnyStage: boolean
  note: string
}

/**
 * 通过生产 service path 发起可支持的 fixture。
 *
 * ⚠️ HEAD 69b2a2ab9 起，`StartRunParams` 已有 orchestrator / manifestBlueprints 槽位；
 * Controller 生产入口会传入它们并触发异步执行。本探针刻意不传 orchestrator，用于验证
 * 服务层 fallback 只创建 queued run，不用 benchmark fixture 自行伪造生产执行证据。
 *
 * 调用方必须在隔离测试组织内运行并负责清理（见 tasks 1.4 的清理测试）。
 */
export async function runProductionServicePath(params: {
  fixture: CompilerFixture
  organizationId: number
  userId: number
}): Promise<ProductionPathObservation> {
  const { fixture, organizationId, userId } = params
  const recorder = new StageRecorder()
  recorder.reset()

  const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())

  const run = await service.startRun({
    organizationId,
    userId,
    input: { fixture: fixture.fixtureId, benchmark: true },
  })
  const statusAfterStartRun = run.status

  // 给潜在的异步执行留出观测窗口：若 startRun 触发了后台编排，
  // 这段时间足以产生至少一条 stage event。
  await new Promise((resolve) => setTimeout(resolve, 25))

  const reloaded = await CompilerRun.query().where('id', run.id).firstOrFail()

  const stageEventRows = await CompilerStageEvent.query()
    .where('compiler_run_id', run.id)
    .then((rows) => rows.length)
  const artifactRows = await CompilerArtifact.query()
    .where('compiler_run_id', run.id)
    .then((rows) => rows.length)

  const handlerInvocations = [...recorder.attempts.values()].reduce((a, b) => a + b, 0)

  return {
    fixtureId: fixture.fixtureId,
    runId: run.id,
    statusAfterStartRun,
    statusAfterSettle: reloaded.status,
    stageEventRows,
    artifactRows,
    handlerInvocations,
    executorDroveAnyStage: stageEventRows > 0 || artifactRows > 0 || handlerInvocations > 0,
    note: '未传 orchestrator / manifestBlueprints 时，CompilerRunService.startRun 只创建 queued run；Controller 生产入口负责提供 orchestrator 并驱动执行器。',
  }
}

/** 删除本次生产路径探测产生的全部行（tasks 1.4）。 */
export async function cleanupProductionRun(runId: number): Promise<void> {
  await CompilerArtifact.query().where('compiler_run_id', runId).delete()
  await CompilerStageEvent.query().where('compiler_run_id', runId).delete()
  await CompilerRun.query().where('id', runId).delete()
}

// ── 聚合（tasks 4.1）──

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

/**
 * 把多次运行聚合成一条结论。
 *
 * design D3：wall-clock 取中位数且只用于「明显并行/回归」判断；并行的**主证据**是
 * 行为重叠（`overlapObserved` / `maxObservedConcurrency`），它不依赖任何计时阈值。
 */
export function aggregateRuns(
  fixture: CompilerFixture,
  runs: FixtureRunObservation[],
): FixtureAggregate {
  if (runs.length === 0) throw new Error(`No runs to aggregate for ${fixture.fixtureId}`)

  const first = runs[0]!
  const orderOf = (r: FixtureRunObservation): string[] =>
    [...r.stages]
      .filter((s) => s.status === 'completed')
      .sort((a, b) => a.endOffsetMs - b.endOffsetMs)
      .map((s) => s.stageId)

  const firstOrder = orderOf(first)
  const stageOrderStable = runs.every(
    (r) => JSON.stringify(orderOf(r)) === JSON.stringify(firstOrder),
  )

  const artifactHashStable = runs.every(
    (r) => JSON.stringify(r.artifactHashByStage) === JSON.stringify(first.artifactHashByStage),
  )

  const attemptsByStage: Record<string, number> = {}
  const statusByStage: Record<string, ObservedStageStatus> = {}
  for (const stage of first.stages) {
    attemptsByStage[stage.stageId] = stage.attempts
    statusByStage[stage.stageId] = stage.status
  }

  return {
    fixtureId: fixture.fixtureId,
    description: fixture.description,
    runCount: runs.length,
    medianWallClockMs: Number(median(runs.map((r) => r.wallClockMs)).toFixed(2)),
    wallClockSamplesMs: runs.map((r) => Number(r.wallClockMs.toFixed(2))),
    stageOrderStable,
    stageOrder: firstOrder,
    // 取各次运行的最大值：并发是「是否发生过」的存在性证据，一次观测到即成立。
    maxObservedConcurrency: Math.max(...runs.map((r) => r.maxObservedConcurrency)),
    overlapObserved: runs.some((r) => r.overlappingPairs.length > 0),
    overlappingPairs: first.overlappingPairs,
    attemptsByStage,
    statusByStage,
    checkpointCount: first.checkpointCount,
    artifactKinds: first.artifactKinds,
    artifactHashStable,
    artifactHashByStage: first.artifactHashByStage,
    cacheHits: first.cacheHits,
    cacheMisses: first.cacheMisses,
    eventStatusCounts: first.eventStatusCounts,
    runTerminalStatus: first.runTerminalStatus,
    succeeded: first.succeeded,
    failedStages: first.failedStages,
    cacheProbe: first.cacheProbe,
    resumeProbe: first.resumeProbe,
  }
}

/** 跑完整矩阵：每个 fixture 重复 runCount 次并聚合。 */
export async function runFixtureMatrix(runCount: number): Promise<FixtureAggregate[]> {
  const { ALL_FIXTURES } = await import('./fixtures.js')
  const aggregates: FixtureAggregate[] = []

  for (const fixture of ALL_FIXTURES) {
    const runs: FixtureRunObservation[] = []
    for (let i = 0; i < runCount; i++) {
      runs.push(await runIsolatedFixture(fixture, i))
    }
    aggregates.push(aggregateRuns(fixture, runs))
  }

  return aggregates
}

export { computeContentHash }
