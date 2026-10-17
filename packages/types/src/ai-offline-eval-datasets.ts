/**
 * v3-ai-offline-eval-datasets —— 离线回归评测数据集与报告共享契约。
 *
 * 设计决策：
 * - D1: 在线和离线共用同一套评分器（不新建第二套）
 * - D2: 数据集版本化，同一版本 = 同一样本集合与顺序（确定性）
 * - D3: 报告提供逐样本结果与基线差异
 * - D4: L3 Synthetic 允许出现在数据集中，评测产物不进生产路径
 * - D5: 基线为一次具体的历史运行，不是滚动平均
 * - D6: 样本正文存储在数据集定义中，运行记录只存 sampleId + scoreValue + scoreLabel
 * - D7: 真实模型评测默认关闭，fixture provider 为默认
 *
 * 零运行时依赖原则：不导入 zod / adonisjs / Date.now() / Math.random()。
 * import type 仅用于类型导入。
 * 使用 Node.js crypto（createHash）做确定性哈希——沿用 skill-eval.ts 先例。
 *
 * @aiproj/types 零依赖约束
 */

import { createHash } from 'node:crypto'
import type { BenchmarkInput } from './skill-eval.js'
import type { DeterministicEvaluatorInput } from './ai-automated-evaluation.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §1 评测目标组（Evaluation Target Groups）
// ═══════════════════════════════════════════════════════════════════════════════

/** 离线评测覆盖的四类目标组。 */
export const EVAL_TARGET_GROUPS = [
  /** 意图路由准确率——Skill 激活决策质量。 */
  'intent_routing_accuracy',
  /** 草案质量——草案结构合规性。 */
  'draft_quality',
  /** 上下文组装完备度——Copilot 上下文采集质量。 */
  'context_assembly_completeness',
  /** 结构化输出符合度——结构化产出块合规性。 */
  'structured_output_conformance',
] as const

Object.freeze(EVAL_TARGET_GROUPS)

export type EvalTargetGroup = (typeof EVAL_TARGET_GROUPS)[number]

/** 类型守卫。 */
export function isEvalTargetGroup(v: string): v is EvalTargetGroup {
  return (EVAL_TARGET_GROUPS as readonly string[]).includes(v)
}

// ── 评测来源标注 ────────────────────────────────────────────────────────

/** 评测集来源（沿用既有 benchmarkSource 语义）。 */
export const OFFLINE_EVAL_BENCHMARK_SOURCES = ['L3', 'fixture'] as const

export type OfflineEvalBenchmarkSource = (typeof OFFLINE_EVAL_BENCHMARK_SOURCES)[number]

/** 类型守卫：判定字符串是否为已知评测来源。 */
export function isOfflineEvalBenchmarkSource(v: string): v is OfflineEvalBenchmarkSource {
  return (OFFLINE_EVAL_BENCHMARK_SOURCES as readonly string[]).includes(v)
}

// ── 评分标签 ────────────────────────────────────────────────────────────

/** 评分标签（与 ai-automated-evaluation.ts SCORE_LABELS 对齐）。 */
export const OFFLINE_EVAL_SCORE_LABELS = ['pass', 'fail', 'not-evaluated'] as const

export type OfflineEvalScoreLabel = (typeof OFFLINE_EVAL_SCORE_LABELS)[number]

/** 类型守卫：判定字符串是否为已知离线评分标签。 */
export function isOfflineEvalScoreLabel(v: string): v is OfflineEvalScoreLabel {
  return (OFFLINE_EVAL_SCORE_LABELS as readonly string[]).includes(v)
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2 数据集版本与样本
// ═══════════════════════════════════════════════════════════════════════════════

/** 数据集版本号（semver-ish，用于确定性校验）。 */
export interface DatasetVersion {
  /** 主版本（不兼容变更时递增）。 */
  readonly major: number
  /** 次版本（新增样本时递增）。 */
  readonly minor: number
  /** 补丁（内容修正时递增）。 */
  readonly patch: number
}

/** 格式化为字符串（如 "1.2.3"）。 */
export function formatDatasetVersion(v: DatasetVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`
}

/** 解析字符串为 DatasetVersion。 */
export function parseDatasetVersion(s: string): DatasetVersion | null {
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

// ── 通用样本形状（§2.3）───────────────────────────────────────────────

/**
 * 离线评测样本——数据集的原子单元（通用形状）。
 *
 * 约束（D6）：样本正文存储在数据集定义中，运行记录只存 sampleId。
 */
export interface OfflineEvalSample {
  /** 样本标识（唯一，用于排序与确定性哈希）。 */
  readonly sampleId: string
  /** 输入（结构化 JSON，可含 skill context、activation context 等）。 */
  readonly input: Record<string, unknown>
  /** 期望输出（可选，用于确定性评测器的正例匹配）。 */
  readonly expectedOutput?: Record<string, unknown>
  /** 期望性质（可选，用于非确定性的属性级断言）。 */
  readonly expectedProperties?: Record<string, unknown>
  /** 评测集来源标注（L3 或 fixture）。 */
  readonly benchmarkSource: OfflineEvalBenchmarkSource
}

// ── 意图路由准确率样本 ──────────────────────────────────────────────

/** 意图路由准确率样本：复用 BenchmarkInput（skill-eval）。 */
export interface IntentRoutingSample {
  /** 样本 ID（数据集内唯一）。 */
  readonly sampleId: string
  /** 人类可读标签。 */
  readonly label: string
  /** 复用 BenchmarkInput（在线/离线共用同一输入形状）。 */
  readonly benchmarkInput: BenchmarkInput
  /** 期望激活的 Skill key 集合（从 benchmarkInput 提取，方便校验）。 */
  readonly expectedActivatedKeys: string[]
}

// ── 草案质量样本 ────────────────────────────────────────────────────

/** 草案质量样本：复用 DeterministicEvaluatorInput（deterministic_evaluators）。 */
export interface DraftQualitySample {
  /** 样本 ID（数据集内唯一）。 */
  readonly sampleId: string
  /** 人类可读标签。 */
  readonly label: string
  /** 复用 DeterministicEvaluatorInput（draft_structural_compliance 维度）。 */
  readonly evaluatorInput: DeterministicEvaluatorInput
  /** 期望的分值（0 或 1）。 */
  readonly expectedScoreValue: number
}

// ── 上下文组装完备度样本 ────────────────────────────────────────────

/** 上下文组装完备度样本：Copilot 上下文组装结果的结构化摘要。 */
export interface ContextAssemblySample {
  /** 样本 ID（数据集内唯一）。 */
  readonly sampleId: string
  /** 人类可读标签。 */
  readonly label: string
  /** 组装结果的状态名（complete/truncated/stale/permission-missing/zero-result/methodology-injected/general-scope）。 */
  readonly assemblyState: string
  /** 来源数量。 */
  readonly sourceCount: number
  /** 是否有截断。 */
  readonly truncated: boolean
  /** 是否有 warning。 */
  readonly hasWarnings: boolean
  /** 期望的完备度判定（pass/fail）。 */
  readonly expectedCompleteness: 'pass' | 'fail'
}

// ── 结构化输出符合度样本 ────────────────────────────────────────────

/** 结构化输出符合度样本：Copilot 结构化输出块的合规性。 */
export interface StructuredOutputSample {
  /** 样本 ID（数据集内唯一）。 */
  readonly sampleId: string
  /** 人类可读标签。 */
  readonly label: string
  /** 输出块类型（table/diagram/list/absent）。 */
  readonly blockKind: string
  /** 守卫是否通过。 */
  readonly guardPassed: boolean
  /** 每行/节点是否有 sourceRef。 */
  readonly hasSourceRefs: boolean
  /** 期望的符合度判定（pass/fail）。 */
  readonly expectedConformance: 'pass' | 'fail'
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2.5 内容确定性——sorted JSON + SHA-256
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 对通用样本数组按 sampleId 排序后序列化为 JSON。
 * 纯函数：相同输入 → 相同输出。
 */
export function serializeSortedSamples(samples: readonly OfflineEvalSample[]): string {
  const sorted = [...samples].sort((a, b) => {
    if (a.sampleId < b.sampleId) return -1
    if (a.sampleId > b.sampleId) return 1
    return 0
  })
  return JSON.stringify(sorted)
}

/**
 * 计算通用样本集合的确定性内容哈希（SHA-256）。
 * 纯函数：相同样本集合 → 相同哈希，与样本原始顺序无关。
 */
export function computeDatasetContentHash(samples: readonly OfflineEvalSample[]): string {
  const serialized = serializeSortedSamples(samples)
  return createHash('sha256').update(serialized, 'utf-8').digest('hex')
}

/**
 * 对任意可序列化样本数组按 sampleId 排序后序列化（用于类型化样本集）。
 */
export function serializeSortedTypedSamples(samples: { sampleId: string }[]): string {
  const sorted = [...samples].sort((a, b) => {
    if (a.sampleId < b.sampleId) return -1
    if (a.sampleId > b.sampleId) return 1
    return 0
  })
  return JSON.stringify(sorted)
}

/**
 * 计算类型化样本集合的确定性内容哈希（SHA-256）。
 */
export function computeTypedDatasetContentHash(samples: { sampleId: string }[]): string {
  const serialized = serializeSortedTypedSamples(samples)
  return createHash('sha256').update(serialized, 'utf-8').digest('hex')
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3 数据集定义
// ═══════════════════════════════════════════════════════════════════════════════

/** 离线评测数据集：按目标组分组的样本集合。 */
export interface OfflineEvalDataset {
  /** 数据集唯一标识。 */
  readonly datasetId: string
  /** 数据集版本。 */
  readonly version: DatasetVersion
  /** 数据集描述。 */
  readonly description: string
  /** 各目标组的样本列表。 */
  readonly samples: {
    readonly intentRouting: readonly IntentRoutingSample[]
    readonly draftQuality: readonly DraftQualitySample[]
    readonly contextAssembly: readonly ContextAssemblySample[]
    readonly structuredOutput: readonly StructuredOutputSample[]
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4 评分配置版本
// ═══════════════════════════════════════════════════════════════════════════════

/** 评分配置版本：记录当前使用的 scorer 版本信息。 */
export interface ScoringConfigVersion {
  /** 评分配置版本号（随 scorer 逻辑变更递增）。 */
  readonly version: string
  /** 使用的 scoreSkillQuality 来源模块版本。 */
  readonly skillEvalVersion: string
  /** 使用的 deterministic evaluator 来源模块版本。 */
  readonly deterministicEvalVersion: string
  /** 权重覆盖（如有）。 */
  readonly weightsOverride?: Readonly<Record<string, number>>
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5 Per-Sample 结果与 Baseline 差异
// ═══════════════════════════════════════════════════════════════════════════════

/** Per-sample 结果中的差异方向。 */
export const DIFFERENCE_DIRECTIONS = ['improved', 'regressed', 'unchanged'] as const
export type DifferenceDirection = (typeof DIFFERENCE_DIRECTIONS)[number]

/** Per-sample 差异结果。 */
export interface SampleDifference {
  /** 样本 ID。 */
  readonly sampleId: string
  /** 当前得分。 */
  readonly currentScore: number
  /** baseline 得分。 */
  readonly baselineScore: number
  /** 差异方向（improved/regressed/unchanged）。不做自动判定，只提供数据。 */
  readonly direction: DifferenceDirection
  /** 差异绝对值。 */
  readonly delta: number
}

/** Per-sample 结果。 */
export interface SampleResult {
  /** 样本 ID。 */
  readonly sampleId: string
  /** 目标组。 */
  readonly targetGroup: EvalTargetGroup
  /** 样本标签。 */
  readonly label: string
  /** 得分（0-1 范围，确定性评测为 0 或 1）。 */
  readonly score: number
  /** 评测标签（pass/fail/not-evaluated）。 */
  readonly scoreLabel: OfflineEvalScoreLabel
  /** 评测解释。 */
  readonly explanation: string
  /** 与 baseline 的差异（仅在提供 baseline 时填充）。 */
  readonly difference?: SampleDifference
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6 离线回归报告
// ═══════════════════════════════════════════════════════════════════════════════

/** 离线回归运行 ID（具体历史 run 的引用，不是滚动平均）。 */
export type BaselineRunId = string

/** 离线回归报告。 */
export interface OfflineEvalReport {
  /** 报告唯一 ID。 */
  readonly reportId: string
  /** 数据集 ID。 */
  readonly datasetId: string
  /** 数据集版本。 */
  readonly datasetVersion: DatasetVersion
  /** 评分配置版本。 */
  readonly scoringConfigVersion: ScoringConfigVersion
  /** 运行时间戳（ISO 8601）。 */
  readonly ranAt: string
  /** 被评测的 subject 版本（如 Skill 版本、草案 schema 版本）。 */
  readonly subjectVersion: string
  /** Baseline run ID（D5：具体历史运行，不是滚动平均）。 */
  readonly baselineRunId?: BaselineRunId
  /** Per-sample 结果列表（只含 sampleId，不含样本正文）。 */
  readonly sampleResults: readonly SampleResult[]
  /** 汇总统计（仅做信息呈现，不做自动 regressed 判定）。 */
  readonly summary: OfflineEvalSummary
  /** 报告内容哈希（SHA-256 of sorted sampleResults by sampleId）。 */
  readonly contentHash: string
}

/** 汇总统计。 */
export interface OfflineEvalSummary {
  /** 总样本数。 */
  readonly totalSamples: number
  /** 通过数。 */
  readonly passCount: number
  /** 失败数。 */
  readonly failCount: number
  /** 未评数。 */
  readonly notEvaluatedCount: number
  /** 改进数（与 baseline 比较）。 */
  readonly improvedCount: number
  /** 回退数（与 baseline 比较，仅数据，不做自动判定）。 */
  readonly regressedCount: number
  /** 未变数。 */
  readonly unchangedCount: number
  /** 无 baseline 时该组计数为 0。 */
  readonly hasBaseline: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2.7 禁存约束——运行记录不得包含的字段
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 运行记录中**禁止存储**的字段类别（D6）。
 * 这些字段属于样本正文或敏感信息，只应存在于数据集定义中。
 */
export const OFFLINE_EVAL_FORBIDDEN_STORE_FIELDS = [
  'sample_input_body',
  'sample_expected_output_body',
  'prompt_full_text',
  'model_output_full_text',
  'tokens',
  'secrets',
  'authorization_header',
  'api_key',
  'password',
] as const

export type OfflineEvalForbiddenStoreField = (typeof OFFLINE_EVAL_FORBIDDEN_STORE_FIELDS)[number]

/** 类型守卫：判定字符串是否为禁止存储字段类别。 */
export function isOfflineEvalForbiddenStoreField(v: string): v is OfflineEvalForbiddenStoreField {
  return (OFFLINE_EVAL_FORBIDDEN_STORE_FIELDS as readonly string[]).includes(v)
}

/**
 * 校验运行记录是否违反禁存约束（纯函数）。
 * 扫描对象的键名和值，检测是否包含禁止存储的字段名或敏感值模式。
 */
export function detectRunRecordForbiddenFields(record: Record<string, unknown>): string[] {
  const violations: string[] = []
  const forbiddenPatterns = [
    /sample[-_\s]?input[-_\s]?body/i,
    /sample[-_\s]?expected[-_\s]?output[-_\s]?body/i,
    /prompt[-_\s]?full[-_\s]?text/i,
    /model[-_\s]?output[-_\s]?full[-_\s]?text/i,
    /\btokens?\b/i,
    /\bsecrets?\b/i,
    /\bauthorization[-_\s]?header\b/i,
    /\bapi[-_\s]?key\b/i,
    /\bpassword\b/i,
  ]

  for (const [key, value] of Object.entries(record)) {
    // 检查键名
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(key)) {
        violations.push(key)
        break
      }
    }

    // 检查字符串值（检测 token/secret/apiKey 泄露模式）
    if (typeof value === 'string') {
      if (/^sk-/.test(value) || /^Bearer\s/.test(value)) {
        violations.push(`${key} (contains secret-like value)`)
      }
    }
  }

  return violations
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7 授权门与 provider
// ═══════════════════════════════════════════════════════════════════════════════

/** 评测 provider 类型。 */
export const OFFLINE_EVAL_PROVIDER_KINDS = ['fixture', 'real_model'] as const

export type OfflineEvalProviderKind = (typeof OFFLINE_EVAL_PROVIDER_KINDS)[number]

/** 类型守卫：判定字符串是否为已知 provider 类型。 */
export function isOfflineEvalProviderKind(v: string): v is OfflineEvalProviderKind {
  return (OFFLINE_EVAL_PROVIDER_KINDS as readonly string[]).includes(v)
}

/** 评测授权状态。 */
export const OFFLINE_EVAL_AUTH_STATUSES = ['not_authorized', 'authorized'] as const

export type OfflineEvalAuthStatus = (typeof OFFLINE_EVAL_AUTH_STATUSES)[number]

/** 类型守卫：判定字符串是否为已知授权状态。 */
export function isOfflineEvalAuthStatus(v: string): v is OfflineEvalAuthStatus {
  return (OFFLINE_EVAL_AUTH_STATUSES as readonly string[]).includes(v)
}

/**
 * 评测授权守卫（D7）：默认 fixture provider，未授权时零真实模型调用。
 * 返回当前应使用的 provider 类型。
 */
export function resolveEvalProvider(authStatus: OfflineEvalAuthStatus): OfflineEvalProviderKind {
  if (authStatus === 'authorized') return 'real_model'
  return 'fixture'
}

// ═══════════════════════════════════════════════════════════════════════════════
// §8 纯函数：差异计算
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 计算单个样本的差异方向（纯函数）。
 * 只提供数据，不做「regressed = 坏」的自动判定。
 */
export function computeSampleDifference(
  currentScore: number,
  baselineScore: number,
): { direction: DifferenceDirection; delta: number } {
  const delta = Math.round((currentScore - baselineScore) * 10000) / 10000
  if (delta > 0) return { direction: 'improved', delta }
  if (delta < 0) return { direction: 'regressed', delta: -delta }
  return { direction: 'unchanged', delta: 0 }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §9 纯函数：确定性序列化与报告哈希
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 对报告做确定性序列化（键排序），用于回归比对。
 * 相同 datasetVersion + subjectVersion + scoringConfigVersion → 相同序列化。
 */
export function serializeReportForDeterminism(report: OfflineEvalReport): string {
  const ordered = {
    datasetId: report.datasetId,
    datasetVersion: formatDatasetVersion(report.datasetVersion),
    scoringConfigVersion: report.scoringConfigVersion.version,
    subjectVersion: report.subjectVersion,
    sampleResults: report.sampleResults
      .map((r) => ({
        sampleId: r.sampleId,
        targetGroup: r.targetGroup,
        score: r.score,
        scoreLabel: r.scoreLabel,
      }))
      .sort((a, b) => a.sampleId.localeCompare(b.sampleId)),
  }
  return JSON.stringify(ordered, Object.keys(ordered).sort())
}

/**
 * 对报告结果按 sampleId 排序后序列化为 JSON（用于报告哈希）。
 */
export function serializeSortedSampleResults(results: readonly SampleResult[]): string {
  const sorted = [...results].sort((a, b) => {
    if (a.sampleId < b.sampleId) return -1
    if (a.sampleId > b.sampleId) return 1
    return 0
  })
  return JSON.stringify(sorted)
}

/**
 * 计算报告的确定性内容哈希（SHA-256）。
 */
export function computeReportContentHash(results: readonly SampleResult[]): string {
  const serialized = serializeSortedSampleResults(results)
  return createHash('sha256').update(serialized, 'utf-8').digest('hex')
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10 纯函数：汇总统计计算
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 从逐样本结果计算汇总统计（纯函数）。
 */
export function computeReportSummary(sampleResults: readonly SampleResult[]): OfflineEvalSummary {
  let passCount = 0
  let failCount = 0
  let notEvaluatedCount = 0
  let improvedCount = 0
  let regressedCount = 0
  let unchangedCount = 0
  let hasBaseline = false

  for (const result of sampleResults) {
    if (result.scoreLabel === 'pass') passCount++
    else if (result.scoreLabel === 'fail') failCount++
    else notEvaluatedCount++

    if (result.difference) {
      hasBaseline = true
      if (result.difference.direction === 'improved') improvedCount++
      else if (result.difference.direction === 'regressed') regressedCount++
      else unchangedCount++
    }
  }

  return {
    totalSamples: sampleResults.length,
    passCount,
    failCount,
    notEvaluatedCount,
    improvedCount,
    regressedCount,
    unchangedCount,
    hasBaseline,
  }
}
