/**
 * v2-5-compiler-execution-gap-benchmark —— 结果模型（tasks 1.1）。
 *
 * 本文件定义 M0 benchmark 的**唯一**结果模型：JSON 与 Markdown 报告都必须从
 * 这里的 `BenchmarkResult` 派生（design D 4.4 / 4.6），禁止任一侧自行拼装结论。
 *
 * 分类集合按 design D4 封闭为四项，不得扩展；`classifyGap` 是唯一裁决入口。
 */

// ── 分类与置信度 ──

/**
 * 差距分类（design D4，封闭集合）。
 *
 * - `implemented`：生产路径可达且行为证据通过。
 * - `foundation-unwired`：底层存在/通过，但生产入口未接线。
 * - `stub-mock-only`：仅 stub 或测试替身成立（报告展示为 `stub/mock-only`）。
 * - `missing`：无实现或缺必需证据。
 */
export const GAP_CLASSIFICATIONS = [
  'implemented',
  'foundation-unwired',
  'stub-mock-only',
  'missing',
] as const

export type GapClassification = (typeof GAP_CLASSIFICATIONS)[number]

/** 报告展示名（spec 用 `stub/mock-only`，JSON 用 kebab 以保持机器可读）。 */
export const GAP_DISPLAY_NAMES: Record<GapClassification, string> = {
  implemented: 'implemented',
  'foundation-unwired': 'foundation-unwired',
  'stub-mock-only': 'stub/mock-only',
  missing: 'missing',
}

/**
 * 置信度。
 *
 * - `high`：静态 + 行为证据一致，且结论不依赖计时。
 * - `medium`：证据一致但受限于测试替身或单机计时。
 * - `low`：证据不足或存在未消解的歧义，必须在 limitations 说明。
 */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

// ── 环境（tasks 1.2）──

export interface BenchmarkEnvironment {
  /** 生成报告时的 git commit SHA。 */
  gitSha: string
  gitBranch: string
  /** 工作树是否有未提交改动——脏树意味着报告不能只靠 SHA 复现。 */
  gitDirty: boolean
  nodeVersion: string
  platform: string
  arch: string
  cpuModel: string
  cpuCount: number
  /** fixture 集合版本；fixture 语义变化时必须提升。 */
  fixtureVersion: string
  /** 每个 fixture 的重复执行次数。 */
  runCount: number
  /** 计时来源；必须是单调时钟，不受系统时间调整影响。 */
  timeSource: string
  generatedAt: string
}

// ── 三层证据（design D1）──

/** 第一层：代码图谱 / 静态清单可达性。 */
export interface StaticEvidence {
  symbol: string
  file: string
  /** 符号是否存在。 */
  exists: boolean
  /** 是否能从生产入口（HTTP 路由 → controller → service）到达。 */
  reachableFromProductionEntry: boolean
  /** 生产代码中的调用点数量（不含测试）。 */
  productionCallSites: number
  note: string
}

/** 第二、三层：行为证据（isolated executor / production service path）。 */
export interface BehaviorEvidence {
  /** 该层是否**实际观测到**能力发生。 */
  observed: boolean
  /** 该层是否被执行过；false 表示未采集（与 observed=false 语义不同）。 */
  attempted: boolean
  detail: string
  /** 支撑本结论的 fixture id。 */
  fixtureIds: string[]
}

export interface CapabilityEvidence {
  static: StaticEvidence[]
  isolatedExecutor: BehaviorEvidence
  productionServicePath: BehaviorEvidence
}

/** 每条结论的直接引用（tasks 4.3）。 */
export interface EvidenceReferences {
  files: string[]
  symbols: string[]
  tests: string[]
  /** 指向 fixture 聚合结果的 key，使 Markdown 每个指标都能回溯 JSON。 */
  results: string[]
}

export interface CapabilityFinding {
  capabilityId: string
  title: string
  classification: GapClassification
  confidence: ConfidenceLevel
  evidence: CapabilityEvidence
  references: EvidenceReferences
  /** 本结论的已知限制；`low`/`medium` 置信度必须非空。 */
  limitations: string[]
}

// ── 行为观测 ──

export type ObservedStageStatus = 'completed' | 'failed' | 'skipped'

export interface StageObservation {
  stageId: string
  phase: string
  parallelGroup: string | null
  status: ObservedStageStatus
  /** handler 实际被调用的次数——用于区分「重试」与「一次即弃」。 */
  attempts: number
  /** 相对本次 run 起点的单调偏移，毫秒。 */
  startOffsetMs: number
  endOffsetMs: number
}

/**
 * 缓存探针（cache-repeat fixture 专用）。
 *
 * 与 `FixtureRunObservation.cacheHits/cacheMisses` 语义不同：后者统计**执行器运行期间**
 * 对 CacheStore 的访问（用于证明执行器是否接了缓存），本探针则独立调用
 * `StageCacheService.getOrCompute` 验证该服务自身是否可用。两者必须分开，
 * 否则「服务能用」会被误读成「执行链用上了」。
 */
export interface CacheProbeResult {
  hits: number
  misses: number
  /** 命中与未命中返回值是否一致（StageCacheService 的确定性契约）。 */
  resultsIdentical: boolean
  /** 相同输入的缓存键是否稳定。 */
  inputHashStable: boolean
  /** compute 实际被调用的次数；缓存生效时第二次应为 0 增量。 */
  computeCalls: number
}

/**
 * 恢复/重放探针（checkpoint-resume fixture 专用）。
 *
 * `reExecutedStages` 是关键证据：resume 之后 handler 是否真的被再次调用。
 * 若为空，说明 resume 只还原了 manifest 状态而没有续跑。
 */
export interface ResumeProbeResult {
  resumed: boolean
  checkpointVersion: number
  /** resume 从 checkpoint 还原为 completed 的 stage。 */
  restoredCompletedStages: string[]
  /** resume 之后新增的 handler 调用（按 stageId）。 */
  reExecutedStages: string[]
  replayReplayed: boolean
  replayStages: number
  replayMissingArtifacts: string[]
}

export interface FixtureRunObservation {
  fixtureId: string
  runIndex: number
  wallClockMs: number
  stages: StageObservation[]
  /** 行为证据：同一时刻实际重叠的 handler 数量峰值。 */
  maxObservedConcurrency: number
  /** 实际发生时间重叠的 stage 对（并行主证据，不依赖 wall-clock 阈值）。 */
  overlappingPairs: string[]
  checkpointCount: number
  artifactKinds: Record<string, number>
  /** 每个 stage 输出 artifact 的 content hash，用于跨运行判定确定性。 */
  artifactHashByStage: Record<string, string>
  /** 执行器运行期间对 CacheStore 的访问计数（非独立探针）。 */
  cacheHits: number
  cacheMisses: number
  eventStatusCounts: Record<string, number>
  /** 执行结束后 run 行的 status；null 表示本层不落库。 */
  runTerminalStatus: string | null
  succeeded: boolean
  failedStages: string[]
  checkpointVersion: number
  cacheProbe: CacheProbeResult | null
  resumeProbe: ResumeProbeResult | null
}

/** 多次运行的聚合（tasks 4.1）。 */
export interface FixtureAggregate {
  fixtureId: string
  description: string
  runCount: number
  /** 中位数——单机抖动下比均值稳健。 */
  medianWallClockMs: number
  wallClockSamplesMs: number[]
  /** 各次运行的 stage 完成顺序是否一致。 */
  stageOrderStable: boolean
  stageOrder: string[]
  /** 行为证据：并行判定的主依据，与 wall-clock 无关。 */
  maxObservedConcurrency: number
  overlapObserved: boolean
  overlappingPairs: string[]
  attemptsByStage: Record<string, number>
  statusByStage: Record<string, ObservedStageStatus>
  checkpointCount: number
  artifactKinds: Record<string, number>
  /** 各次运行的 stage 产物 content hash 是否完全一致（确定性证据）。 */
  artifactHashStable: boolean
  artifactHashByStage: Record<string, string>
  cacheHits: number
  cacheMisses: number
  eventStatusCounts: Record<string, number>
  runTerminalStatus: string | null
  succeeded: boolean
  failedStages: string[]
  cacheProbe: CacheProbeResult | null
  resumeProbe: ResumeProbeResult | null
}

// ── 下游范围建议（tasks 4.5）──

export interface NextChangeScope {
  changeId: string
  /** 最小 In Scope 项。 */
  inScope: string[]
  /** 明确非目标。 */
  nonGoals: string[]
}

// ── 顶层结果 ──

export interface BenchmarkResult {
  schemaVersion: string
  benchmarkId: string
  environment: BenchmarkEnvironment
  fixtures: FixtureAggregate[]
  findings: CapabilityFinding[]
  nextChangeScope: NextChangeScope
}

// ── 分类裁决（design D1/D4，tasks 3.5）──

export interface ClassifyGapInput {
  /** isolated `PipelineExecutor` 层是否观测到能力。 */
  isolatedObserved: boolean
  /** 生产 service path 是否可达（静态）。 */
  productionReachable: boolean
  /** 生产 service path 是否观测到能力（行为）。 */
  productionObserved: boolean
  /** 是否只有 stub / 测试替身成立。 */
  stubOnly: boolean
}

/**
 * 差距分类的唯一裁决入口。
 *
 * 规则顺序即优先级，且**禁止越级**（design D1）：单测/isolated 通过但生产路径
 * 不可达或未观测到，必须是 `foundation-unwired`，不得升为 `implemented`。
 */
export function classifyGap(input: ClassifyGapInput): GapClassification {
  if (input.productionReachable && input.productionObserved) {
    return 'implemented'
  }
  if (input.isolatedObserved) {
    return 'foundation-unwired'
  }
  if (input.stubOnly) {
    return 'stub-mock-only'
  }
  return 'missing'
}
