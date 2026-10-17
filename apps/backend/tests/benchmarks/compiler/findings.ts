/**
 * v2-5-compiler-execution-gap-benchmark —— 能力结论（tasks 3.5, 4.2, 4.3, 4.5）。
 *
 * 每条结论的 `classification` **一律**由 `classifyGap` 从三层证据推导，不允许手写字面量。
 * 这样 spec 的「Executor 单测通过但 startRun 未接线 ⇒ foundation-unwired」不是文档承诺，
 * 而是代码里唯一的一条路径：只要 `productionObserved` 为假，就不可能得到 implemented。
 */

import { classifyGap } from './types.js'
import type {
  BehaviorEvidence,
  CapabilityFinding,
  ConfidenceLevel,
  FixtureAggregate,
  NextChangeScope,
} from './types.js'
import { evidenceById, type ProbeScanResult } from './static_reachability.js'
import type { ProductionPathObservation } from './runner.js'

const EXECUTOR_FILE = 'apps/backend/app/services/compiler/pipeline_executor.ts'
const RUN_SERVICE_FILE = 'apps/backend/app/services/compiler/compiler_run_service.ts'
const CONTROLLER_FILE = 'apps/backend/app/controllers/compiler_controller.ts'
const CACHE_FILE = 'apps/backend/app/services/compiler/stage_cache_service.ts'
const EVENT_FILE = 'apps/backend/app/services/compiler/stage_event_logger.ts'
const DEV_DEBUG_FILE = 'apps/backend/app/services/compiler/dev_debug_service.ts'
const MANIFEST_LEDGER_FILE = 'packages/compiler-spec/src/manifest-ledger.ts'
const LEDGER_SERVICE_FILE = 'apps/backend/app/services/compiler/completeness_ledger_service.ts'
const BENCH_SPEC = 'apps/backend/tests/unit/compiler_execution_gap_benchmark.spec.ts'

function byId(aggregates: FixtureAggregate[], fixtureId: string): FixtureAggregate {
  const found = aggregates.find((a) => a.fixtureId === fixtureId)
  if (!found) throw new Error(`Missing fixture aggregate: ${fixtureId}`)
  return found
}

/**
 * 生产路径的共同证据。
 *
 * 五个 fixture 的服务层 fallback 探测结论完全一致：未显式传入 orchestrator 时，
 * startRun 只创建 queued run，不把 benchmark fixture 自行伪造成生产执行证据。
 * Controller 生产入口会传入 orchestrator；这一事实由静态可达性与 wiring 集成测试覆盖。
 */
function productionEvidence(
  observations: ProductionPathObservation[],
  detail: string,
): BehaviorEvidence {
  return {
    observed: observations.some((o) => o.executorDroveAnyStage),
    attempted: observations.length > 0,
    detail,
    fixtureIds: observations.map((o) => o.fixtureId),
  }
}

export function buildFindings(params: {
  aggregates: FixtureAggregate[]
  scans: ProbeScanResult[]
  production: ProductionPathObservation[]
}): CapabilityFinding[] {
  const { aggregates, scans, production } = params

  const serial = byId(aggregates, 'serial-3')
  const diamond = byId(aggregates, 'diamond-parallel')
  const failOnce = byId(aggregates, 'fail-once')
  const resume = byId(aggregates, 'checkpoint-resume')
  const cache = byId(aggregates, 'cache-repeat')

  const prodStatuses = [...new Set(production.map((o) => o.statusAfterSettle))].join(', ')
  const prodDetail = `经 CompilerRunService.startRun fallback 发起 ${production.length} 个 fixture：未传 orchestrator / manifestBlueprints 时，run 行 status 停在 "${prodStatuses}"，stage event 行 = ${production.reduce((a, o) => a + o.stageEventRows, 0)}，artifact 行 = ${production.reduce((a, o) => a + o.artifactRows, 0)}，handler 调用 = ${production.reduce((a, o) => a + o.handlerInvocations, 0)}。Controller 生产入口已传入 orchestrator；本 fallback 探针只防止 benchmark 自行伪造执行器证据。`

  const prodShared = productionEvidence(production, prodDetail)

  const findings: CapabilityFinding[] = []

  // ── 1. 串行执行 ──
  findings.push(
    makeFinding({
      capabilityId: 'serial-execution',
      title: '串行 DAG 按依赖顺序执行',
      isolated: {
        observed:
          serial.stageOrderStable &&
          serial.stageOrder.join(',') === 's1,s2,s3' &&
          serial.maxObservedConcurrency === 1,
        attempted: true,
        detail: `serial-3 在 ${serial.runCount} 次运行中完成顺序恒为 ${serial.stageOrder.join(' → ')}，最大并发 ${serial.maxObservedConcurrency}，中位耗时 ${serial.medianWallClockMs}ms。`,
        fixtureIds: ['serial-3'],
      },
      production: prodShared,
      scans,
      staticIds: ['executor-execute', 'start-run'],
      confidence: 'high',
      references: {
        files: [EXECUTOR_FILE, RUN_SERVICE_FILE],
        symbols: ['PipelineExecutor.execute', 'PipelineExecutor.#groupByPhase'],
        tests: [BENCH_SPEC],
        results: [
          'fixtures.serial-3.stageOrder',
          'fixtures.serial-3.maxObservedConcurrency',
          'fixtures.serial-3.stageOrderStable',
        ],
      },
      limitations: ['仅覆盖 3 段线性链；未测试深链、宽扇出或跨 phase 依赖的顺序稳定性。'],
    }),
  )

  // ── 2. 并行执行 ──
  findings.push(
    makeFinding({
      capabilityId: 'parallel-execution',
      title: '同 parallelGroup 的 Stage 真实并发执行',
      isolated: {
        observed: diamond.overlapObserved && diamond.maxObservedConcurrency >= 2,
        attempted: true,
        detail: `diamond-parallel 观测到 handler 时间重叠 ${diamond.overlappingPairs.join('、')}，最大并发 ${diamond.maxObservedConcurrency}，中位耗时 ${diamond.medianWallClockMs}ms（若纯串行应约等于各段延迟之和 96ms）。execute() 对同组 step 用 Promise.allSettled 并发。`,
        fixtureIds: ['diamond-parallel'],
      },
      production: prodShared,
      scans,
      staticIds: ['executor-execute'],
      confidence: 'high',
      references: {
        files: [EXECUTOR_FILE],
        symbols: ['PipelineExecutor.execute', 'PipelineExecutor.#groupByParallelGroup'],
        tests: [BENCH_SPEC],
        results: [
          'fixtures.diamond-parallel.overlappingPairs',
          'fixtures.diamond-parallel.maxObservedConcurrency',
          'fixtures.diamond-parallel.medianWallClockMs',
        ],
      },
      limitations: [
        '并行结论以行为重叠为准；wall-clock 仅供参考，是单机单次测量，不构成任何 SLA。',
        '并发度由 manifest 的 parallelGroup 声明决定，执行器不做动态调度，也无并发上限控制。',
        '发现的编排约束：同 phase 内无 parallelGroup 的 step 会被排到所有 parallel group 之后，跨并行分支的依赖必须用 phase 边界隔开，否则下游会因依赖未满足被跳过。',
      ],
    }),
  )

  // ── 3. 依赖门禁 ──
  findings.push(
    makeFinding({
      capabilityId: 'dependency-gating',
      title: '依赖未满足的 Stage 被跳过且不污染下游',
      isolated: {
        observed: failOnce.statusByStage.f3 === 'skipped' && failOnce.attemptsByStage.f3 === 0,
        attempted: true,
        detail: `fail-once 中 f2 失败后，f3 状态为 ${failOnce.statusByStage.f3}，handler 调用次数 ${failOnce.attemptsByStage.f3}——依赖未满足的下游从未执行。`,
        fixtureIds: ['fail-once', 'checkpoint-resume'],
      },
      production: prodShared,
      scans,
      staticIds: ['executor-execute'],
      confidence: 'high',
      references: {
        files: [EXECUTOR_FILE, 'apps/backend/app/services/compiler/manifest_builder.ts'],
        symbols: ['ManifestBuilder.areDependenciesMet', 'PipelineExecutor.execute'],
        tests: [BENCH_SPEC],
        results: ['fixtures.fail-once.statusByStage', 'fixtures.fail-once.attemptsByStage'],
      },
      limitations: [],
    }),
  )

  // ── 4. 失败隔离 ──
  findings.push(
    makeFinding({
      capabilityId: 'failure-isolation',
      title: '单 Stage 失败不影响同批其它 Stage',
      isolated: {
        observed: failOnce.statusByStage.f1 === 'completed' && failOnce.failedStages.length === 1,
        attempted: true,
        detail: `fail-once 中 f2 失败被收敛为 failedStages=${JSON.stringify(failOnce.failedStages)}，f1 仍为 ${failOnce.statusByStage.f1}；execute() 用 Promise.allSettled 收集组内结果，单个 handler 抛错不会中断整组。`,
        fixtureIds: ['fail-once'],
      },
      production: prodShared,
      scans,
      staticIds: ['executor-execute'],
      confidence: 'high',
      references: {
        files: [EXECUTOR_FILE],
        symbols: ['PipelineExecutor.execute'],
        tests: [BENCH_SPEC],
        results: ['fixtures.fail-once.failedStages', 'fixtures.fail-once.statusByStage'],
      },
      limitations: ['未测试同一 parallelGroup 内多个 Stage 同时失败的收敛行为。'],
    }),
  )

  // ── 5. 重试 ──
  findings.push(
    makeFinding({
      capabilityId: 'stage-retry',
      title: 'Stage 失败后自动重试',
      isolated: {
        // fail-once 的 f2 第二次调用必定成功；若执行器会重试，attempts 应为 2。
        observed: failOnce.attemptsByStage.f2 > 1,
        attempted: true,
        detail: `fail-once 的 f2 被设计为「第 1 次抛错、第 2 次成功」。实测 handler 调用次数 = ${failOnce.attemptsByStage.f2}，状态停在 ${failOnce.statusByStage.f2}——执行器从未发起第二次 attempt。execute() 的 catch 分支直接 updateStepStatus(failed) 并 push 到 failedStages，全函数无任何重试路径。`,
        fixtureIds: ['fail-once'],
      },
      production: prodShared,
      scans,
      staticIds: ['executor-execute'],
      confidence: 'high',
      references: {
        files: [EXECUTOR_FILE, MANIFEST_LEDGER_FILE, LEDGER_SERVICE_FILE],
        symbols: [
          'PipelineExecutor.execute',
          'ManifestExecutionStep.retryCount',
          'CompletenessLedgerService.recordAttempt',
        ],
        tests: [BENCH_SPEC],
        results: ['fixtures.fail-once.attemptsByStage', 'fixtures.fail-once.statusByStage'],
      },
      limitations: [
        'ManifestExecutionStep 已有 retryCount 字段且 ManifestBuilder 初始化为 0，但全仓无任何代码递增它——数据模型就位、行为缺失。',
        '存在**另一条轴**上的重试实现：CompletenessLedgerService.recordAttempt 有完整的 attempt 计数与 failed_retryable / needs_human_review 状态机（含上限判定）。但它是 entity 生成的记账，不重新调用 Stage handler，且 execute() 从不触碰它。接线重试前必须先裁决「Stage 重执行」与「entity 记账」由哪条轴负责，否则会出现两套互不感知的重试语义。',
      ],
    }),
  )

  // ── 6. Checkpoint 持久化 ──
  findings.push(
    makeFinding({
      capabilityId: 'checkpoint-persistence',
      title: '逐 Stage 与逐 phase 写 checkpoint',
      isolated: {
        observed: serial.checkpointCount > 0 && (serial.artifactKinds.checkpoint ?? 0) > 0,
        attempted: true,
        detail: `serial-3 产生 ${serial.checkpointCount} 个 checkpoint（3 个 Stage checkpoint + 1 个 phase checkpoint）；diamond-parallel 产生 ${diamond.checkpointCount} 个（4 Stage + 3 phase）。`,
        fixtureIds: ['serial-3', 'diamond-parallel', 'checkpoint-resume'],
      },
      production: prodShared,
      scans,
      staticIds: ['checkpoint-write', 'start-run'],
      confidence: 'high',
      references: {
        files: [EXECUTOR_FILE],
        symbols: [
          'PipelineExecutor.#saveCheckpoint',
          'PipelineExecutor.#savePhaseCheckpoint',
          'ArtifactStore.save',
        ],
        tests: [BENCH_SPEC],
        results: ['fixtures.serial-3.checkpointCount', 'fixtures.diamond-parallel.checkpointCount'],
      },
      limitations: [
        'checkpoint 经内存 ArtifactStore 观测；真实 Lucid 写入路径（envelope 校验、幂等键去重）未在本 benchmark 覆盖。',
      ],
    }),
  )

  // ── 7. 从 checkpoint 恢复 ──
  const resumeProbe = resume.resumeProbe
  findings.push(
    makeFinding({
      capabilityId: 'resume-from-checkpoint',
      title: '从最近 checkpoint 恢复运行',
      isolated: {
        observed: resumeProbe !== null && resumeProbe.resumed,
        attempted: true,
        detail: `checkpoint-resume：r2 失败后调用 resume()，返回 resumed=${resumeProbe?.resumed}，checkpointVersion=${resumeProbe?.checkpointVersion}，还原 completed=${JSON.stringify(resumeProbe?.restoredCompletedStages)}。但 resume 之后被重新执行的 Stage = ${JSON.stringify(resumeProbe?.reExecutedStages)}——resume 只还原 manifest 状态，不续跑剩余 Stage。`,
        fixtureIds: ['checkpoint-resume'],
      },
      production: prodShared,
      scans,
      staticIds: ['executor-resume', 'start-run'],
      confidence: 'high',
      references: {
        files: [EXECUTOR_FILE, RUN_SERVICE_FILE],
        symbols: ['PipelineExecutor.resume', 'CompilerRunService.resumeRun'],
        tests: [BENCH_SPEC],
        results: [
          'fixtures.checkpoint-resume.resumeProbe.resumed',
          'fixtures.checkpoint-resume.resumeProbe.restoredCompletedStages',
          'fixtures.checkpoint-resume.resumeProbe.reExecutedStages',
        ],
      },
      limitations: [
        'resume() 只把 checkpoint 里的 completed/failed 状态回写进 ManifestBuilder 并返回，**不重新执行任何剩余 Stage**；「恢复」目前等于「读回进度」，不等于「继续编译」。下游接线 change 必须把这一点算进范围。',
        'CompilerRunService.resumeRun 仍保留旧 seam；当前 HTTP resume 入口已改走 resumeCompilation → CompilerRunOrchestrator.resume。resume 语义仍只保证从 checkpoint 恢复状态，续跑范围由后续 resume/replay change 继续收敛。',
      ],
    }),
  )

  // ── 8. Replay ──
  findings.push(
    makeFinding({
      capabilityId: 'replay-from-artifacts',
      title: '基于已持久化 artifact 重放运行',
      isolated: {
        observed: resumeProbe !== null && resumeProbe.replayReplayed,
        attempted: true,
        detail: `replay() 返回 replayed=${resumeProbe?.replayReplayed}，stages=${resumeProbe?.replayStages}（= checkpoint 数量），missingArtifacts=${JSON.stringify(resumeProbe?.replayMissingArtifacts)}。`,
        fixtureIds: ['checkpoint-resume'],
      },
      production: prodShared,
      scans,
      staticIds: ['executor-replay'],
      confidence: 'medium',
      references: {
        files: [EXECUTOR_FILE],
        symbols: ['PipelineExecutor.replay', 'ArtifactStore.getCheckpoints'],
        tests: [BENCH_SPEC],
        results: [
          'fixtures.checkpoint-resume.resumeProbe.replayReplayed',
          'fixtures.checkpoint-resume.resumeProbe.replayStages',
          'fixtures.checkpoint-resume.resumeProbe.replayMissingArtifacts',
        ],
      },
      limitations: [
        'replay() 只做 checkpoint 与 stage_output 的完整性对账，不重建上下文也不重新执行；返回的 stages 是 checkpoint 计数而非被重放的 Stage 数，语义与名称不符。',
        '置信度 medium：本 benchmark 只验证了「无缺失 artifact」这一条路径，未构造缺失 artifact 的负例。',
      ],
    }),
  )

  // ── 9. Stage 缓存 ──
  const cacheProbe = cache.cacheProbe
  findings.push(
    makeFinding({
      capabilityId: 'stage-output-cache',
      title: 'deterministic Stage 结果缓存复用',
      isolated: {
        // 底层 StageCacheService 独立可用即算「底层通过」（D4）——它是真实实现，不是 stub。
        // v2-5-compiler-stage-cache-wiring 已把执行链接上（orchestrator→executor→
        // getOrComputeDetailed，仅 deterministic Stage），故静态探针已可达；但本层的
        // fallback 生产探针不驱动执行器，productionObserved 仍为 false，
        // 分类保持 foundation-unwired，直到报告以生产路径缓存证据重跑（5.2 用例已证明门禁逻辑）。
        observed:
          cacheProbe !== null &&
          cacheProbe.hits > 0 &&
          cacheProbe.computeCalls === 1 &&
          cacheProbe.resultsIdentical,
        attempted: true,
        detail: `isolated 矩阵 feature-off 运行，执行器运行期间对 CacheStore 的访问 = ${cache.cacheHits} 命中 / ${cache.cacheMisses} 未命中。v2-5-compiler-stage-cache-wiring 已给 ExecutorOptions 增加 stageCache/stageCacheEnabled 槽位，并由 CompilerRunOrchestrator 在生产路径注入 StageCacheService（仅 deterministic Stage 包裹，llm/hybrid/gate/meta 直连）。独立探针另测 StageCacheService 本身：相同输入两次调用得到 ${cacheProbe?.hits} 命中 / ${cacheProbe?.misses} 未命中，compute 仅执行 ${cacheProbe?.computeCalls} 次，返回值一致=${cacheProbe?.resultsIdentical}，缓存键稳定=${cacheProbe?.inputHashStable}。`,
        fixtureIds: ['cache-repeat'],
      },
      production: prodShared,
      scans,
      staticIds: ['stage-cache'],
      confidence: 'medium',
      references: {
        files: [
          CACHE_FILE,
          EXECUTOR_FILE,
          'apps/backend/app/services/compiler/compiler_run_orchestrator.ts',
          'apps/backend/app/services/compiler/stage_cache_fingerprint.ts',
        ],
        symbols: [
          'StageCacheService.getOrComputeDetailed',
          'stageCacheKeyFromFingerprint',
          'PipelineExecutor.execute',
        ],
        tests: [BENCH_SPEC],
        results: [
          'fixtures.cache-repeat.cacheHits',
          'fixtures.cache-repeat.cacheProbe.hits',
          'fixtures.cache-repeat.cacheProbe.computeCalls',
          'fixtures.cache-repeat.cacheProbe.inputHashStable',
        ],
      },
      limitations: [
        '执行链接线已完成（v2-5-compiler-stage-cache-wiring：ExecutorOptions 新增 cache 槽位，orchestrator 生产注入），但本层的 fallback 生产探针刻意不驱动执行器，productionObserved 仍为 false——分类升 implemented 需要生产路径重复执行同输入并观测到命中的证据（benchmark spec 5.2 用例已证明该门禁逻辑）。',
        '置信度 medium：探针注入内存 CacheStore；Redis 实现路径未验证（本机 REDIS_ENABLED 未开，工厂降级为内存实现）。',
        '产物 hash 跨运行稳定（artifactHashStable=true），说明 deterministic Stage 满足「相同输入 ⇒ 相同产物」的缓存前提。',
      ],
    }),
  )

  // ── 10. Stage 事件 ──
  findings.push(
    makeFinding({
      capabilityId: 'stage-event-logging',
      title: 'Stage 生命周期事件写入',
      isolated: {
        observed: Object.keys(serial.eventStatusCounts).length > 0,
        attempted: true,
        detail: `serial-3 产生事件 ${JSON.stringify(serial.eventStatusCounts)}；fail-once 产生 ${JSON.stringify(failOnce.eventStatusCounts)}——running/completed/failed/skipped 四类均被观测到。`,
        fixtureIds: ['serial-3', 'fail-once'],
      },
      production: prodShared,
      scans,
      staticIds: ['stage-event', 'start-run'],
      confidence: 'high',
      references: {
        files: [EVENT_FILE, EXECUTOR_FILE, CONTROLLER_FILE],
        symbols: [
          'StageEventLogger.started',
          'StageEventLogger.succeeded',
          'StageEventLogger.failed',
        ],
        tests: [BENCH_SPEC],
        results: ['fixtures.serial-3.eventStatusCounts', 'fixtures.fail-once.eventStatusCounts'],
      },
      limitations: [
        'StageEventLogger 写方已随 execute() 进入生产接线路径；compiler-stage-event-realtime-bridge 仍需把低敏事件推到实时传输与 replay，而不是重新实现事件落库。',
        'CompilerObservabilityRecorder.recordStage* 的五个包装方法仍未接入写路径；后续 realtime bridge 应避免再造第二套并行写入语义。',
      ],
    }),
  )

  // ── 11. Artifact 持久化 ──
  findings.push(
    makeFinding({
      capabilityId: 'artifact-persistence',
      title: 'Stage 产物与 checkpoint 落盘',
      isolated: {
        observed: (serial.artifactKinds.stage_output ?? 0) > 0,
        attempted: true,
        detail: `serial-3 产生 artifact ${JSON.stringify(serial.artifactKinds)}；产物 content hash 跨 ${serial.runCount} 次运行完全一致（artifactHashStable=${serial.artifactHashStable}）。`,
        fixtureIds: ['serial-3', 'diamond-parallel'],
      },
      production: prodShared,
      scans,
      staticIds: ['start-run'],
      confidence: 'high',
      references: {
        files: ['apps/backend/app/services/compiler/artifact_store.ts', EXECUTOR_FILE],
        symbols: ['ArtifactStore.save', 'computeContentHash'],
        tests: [BENCH_SPEC],
        results: ['fixtures.serial-3.artifactKinds', 'fixtures.serial-3.artifactHashStable'],
      },
      limitations: ['经内存 ArtifactStore 观测；真实 envelope 校验与幂等键去重路径未覆盖。'],
    }),
  )

  // ── 12. Run 终态 ──
  findings.push(
    makeFinding({
      capabilityId: 'run-terminal-state',
      title: 'compiler_runs 写入终态与 completedAt',
      isolated: {
        observed: false,
        attempted: true,
        detail: `execute() 返回 ExecutionResult{succeeded, failedStages, checkpointVersion}，但**从不写回 CompilerRun**——执行器不持有 run 的写权也不调用 save()。isolated 层 runTerminalStatus 恒为 null。`,
        fixtureIds: ['serial-3', 'fail-once'],
      },
      production: {
        observed: false,
        attempted: true,
        detail: `本 fallback 探针未传 orchestrator，run 行 status 停在 "${prodStatuses}" 且不写 completedAt；当前终态写回由 CompilerRunOrchestrator.#writeTerminalState 负责，另由 wiring 集成测试覆盖。`,
        fixtureIds: production.map((o) => o.fixtureId),
      },
      scans,
      staticIds: ['run-terminal-status', 'start-run'],
      confidence: 'high',
      references: {
        files: [RUN_SERVICE_FILE, EXECUTOR_FILE, 'apps/backend/app/models/compiler_run.ts'],
        symbols: ['CompilerRunService.startRun', 'CompilerRun.status', 'PipelineExecutor.execute'],
        tests: [BENCH_SPEC],
        results: ['fixtures.serial-3.runTerminalStatus'],
      },
      limitations: [
        '迁移已允许 completed/failed/cancelled/needs_human_review 等终态（CHECK 约束就位），当前写入方集中在 CompilerRunOrchestrator.#writeTerminalState。',
        '未传 orchestrator 的服务层 fallback 会停在 queued；这不是生产 Controller 路径的完成证据，也不能反向说明接线失败。',
      ],
    }),
  )

  // ── 13. 生产入口驱动执行器 ──
  findings.push(
    makeFinding({
      capabilityId: 'production-run-entry',
      title: 'startRun 驱动执行器完成一次编译',
      isolated: {
        // 本能力问的就是「生产入口是否驱动执行器」，isolated 层无从证明，只能证否。
        observed: false,
        attempted: true,
        detail:
          'isolated 层可直接驱动 execute()，但这不构成本能力的证据——本条问的正是生产入口能否驱动执行器。',
        fixtureIds: [],
      },
      production: prodShared,
      scans,
      staticIds: ['start-run', 'executor-execute', 'handler-registry'],
      confidence: 'high',
      references: {
        files: [RUN_SERVICE_FILE, CONTROLLER_FILE, DEV_DEBUG_FILE],
        symbols: ['CompilerRunService.startRun', 'StartRunParams', 'DevDebugService'],
        tests: [BENCH_SPEC],
        results: [],
      },
      limitations: [
        '当前服务层 startRun 支持 orchestrator / manifestBlueprints；Controller 生产入口会传入 production orchestrator 与默认 blueprints。',
        '本 benchmark 的 fallback 探针刻意不传 orchestrator，因此不观测执行器行为；真正的 production wiring 由 compiler_orchestrator_wiring 与 compiler_run_lifecycle 测试覆盖。',
        'DevDebugService 仍保留调试 handler 注册点，但不再是唯一的 registerHandler 来源；CompilerRunOrchestrator 已成为 production composition root。',
      ],
    }),
  )

  // ── 14. HTTP resume 入口 ──
  findings.push(
    makeFinding({
      capabilityId: 'resume-http-endpoint',
      title: 'POST /runs/:id/resume 恢复编译',
      isolated: {
        observed: false,
        attempted: false,
        detail: 'HTTP 入口无 isolated 对应层：控制器方法体内不存在任何执行器调用可供隔离测量。',
        fixtureIds: [],
      },
      production: {
        observed: false,
        attempted: true,
        detail:
          'CompilerController.resume(:281-288) 在通过 canResume 鉴权与 getRun 之后，直接 response.ok 返回字符串 "Resume endpoint ready. PipelineExecutor needs to be injected for actual resume."，并附上原样未变的 run.status。端点自述未实现。',
        fixtureIds: [],
      },
      scans,
      staticIds: ['executor-resume'],
      // 生产表面只有 stub，且不存在可隔离验证的真实实现 ⇒ stubOnly。
      stubOnly: true,
      confidence: 'high',
      references: {
        files: [CONTROLLER_FILE, RUN_SERVICE_FILE],
        symbols: ['CompilerController.resume', 'CompilerRunService.resumeRun'],
        tests: [BENCH_SPEC],
        results: [],
      },
      limitations: [
        '注意与 resume-from-checkpoint 区分：执行器层的 resume() 是真实实现（分类 foundation-unwired），而 HTTP 端点是 stub。两者不可混为一谈。',
        'CompilerRunService.resumeRun 已备好正确形状（接收 executor 并调用 executor.resume），控制器只需注入即可——接线成本低于其它项。',
      ],
    }),
  )

  return findings
}

/**
 * 组装单条结论。
 *
 * `classification` 由 `classifyGap` 推导——这是全文件唯一的分类来源。
 */
function makeFinding(params: {
  capabilityId: string
  title: string
  isolated: BehaviorEvidence
  production: BehaviorEvidence
  scans: ProbeScanResult[]
  staticIds: string[]
  stubOnly?: boolean
  confidence: ConfidenceLevel
  references: CapabilityFinding['references']
  limitations: string[]
}): CapabilityFinding {
  const staticEvidence = evidenceById(params.scans, params.staticIds)

  const classification = classifyGap({
    isolatedObserved: params.isolated.observed,
    productionReachable: staticEvidence.some((s) => s.reachableFromProductionEntry),
    productionObserved: params.production.observed,
    stubOnly: params.stubOnly ?? false,
  })

  return {
    capabilityId: params.capabilityId,
    title: params.title,
    classification,
    confidence: params.confidence,
    evidence: {
      static: staticEvidence,
      isolatedExecutor: params.isolated,
      productionServicePath: params.production,
    },
    references: params.references,
    limitations: params.limitations,
  }
}

/**
 * 下游 change 的最小范围建议（tasks 4.5）。
 *
 * 并非所有 foundation-unwired 都能靠「接 startRun」解决：缓存需要先给执行器加槽位，
 * 恢复续跑需要改 resume 语义。这两项虽同为 foundation-unwired，但明确排除在最小范围外，
 * 否则「接线」会悄悄膨胀成「重做编排」。
 */
const DEFERRED_FROM_WIRING = new Set(['stage-output-cache'])

export function buildNextChangeScope(findings: CapabilityFinding[]): NextChangeScope {
  const unlockedByEntry = findings.filter(
    (f) => f.classification === 'foundation-unwired' && !DEFERRED_FROM_WIRING.has(f.capabilityId),
  )

  return {
    changeId: 'v2-5-compiler-run-executor-wiring',
    inScope: [
      `把 startRun 接到 PipelineExecutor：为 StartRunParams（或新的 service 方法）增加 manifest/handler 来源，使 ${unlockedByEntry.length} 项 foundation-unwired 能力（${unlockedByEntry.map((f) => f.capabilityId).join('、')}）真正从生产入口可达。这 ${unlockedByEntry.length} 项的底层行为证据已完整，接线即解锁，无需重写执行器。`,
      '在生产路径注册 Stage handler：当前只有不可达的 DevDebugService 注册了 3 个骨架 handler，生产 handler 注册表恒为空。',
      '保留 run 终态写回的回归门禁：ExecutionResult 必须映射为 compiler_runs.status/completedAt/error，且不得绕过组织隔离。',
      '保留 resume 接线回归门禁：CompilerController.resume 必须进入 orchestrator/service，而不得回退成 stub 响应。',
      '沿用既有 ExecutorOptions 注入点（artifactStore/stageEventLogger），不新增执行器接缝。',
    ],
    nonGoals: [
      '不实现 Stage 重试：retry 是独立 missing 能力（retryCount 字段存在但无人递增），需单独 change 决定退避与幂等语义，不夹带进接线。',
      '不接 Stage 缓存：执行器无 cache 槽位，接线需先设计「哪些 Stage 可缓存」，属 v2-5-compiler-stage-cache-wiring。',
      '不改 resume 语义使其续跑：当前 resume 只还原状态不续跑，扩展为「继续编译」属 v2-5-compiler-resume-replay-wiring。',
      '不实现 A/B 编译、不做动态 routing、不改 execute() 的分组或并发算法。',
      '不新增 /api/v2、不改 DiagramSpec、不引入真实模型调用或容器化。',
    ],
  }
}
