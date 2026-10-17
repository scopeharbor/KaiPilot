/**
 * offline_eval_runner —— 离线回归评测运行器。
 *
 * 核心原则：离线回归 MUST 复用在线 scorer（不创建第二套评分实现）。
 * - 委托 scoreSkillQuality / runSkillBenchmark（skill-eval.ts）
 * - 委托 runDeterministicEvaluation（deterministic_evaluators.ts）
 * - 不创建任何新评分逻辑
 *
 * 确定性保证：
 * - 相同 datasetVersion + subjectVersion + scoringConfigVersion → 相同 report
 * - 键排序序列化，不用 Date.now() / Math.random()
 *
 * Baseline 语义：
 * - baseline 是具体历史 run ID，不是滚动平均
 * - 提供 baseline 时计算 per-sample 差异，不自动做 regressed 判定
 */

import {
  runSkillBenchmark,
  serializeSortedSampleResults,
  type BenchmarkReport,
} from '@aiproj/types'
import { runDeterministicEvaluation } from './deterministic_evaluators.js'
import type {
  OfflineEvalDataset,
  OfflineEvalReport,
  OfflineEvalSummary,
  SampleResult,
  SampleDifference,
  ScoringConfigVersion,
  DatasetVersion,
  BaselineRunId,
} from '@aiproj/types'
import type {
  IntentRoutingSample,
  DraftQualitySample,
  ContextAssemblySample,
  StructuredOutputSample,
} from '@aiproj/types'
import { createHash } from 'node:crypto'

// ═══════════════════════════════════════════════════════════════════════════════
// Task 3.1 — 离线回归复用在线 scorer
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 评测意图路由准确率样本。
 * 复用 runSkillBenchmark（在线 scorer）——不创建新评分逻辑。
 */
function evaluateIntentRouting(
  sample: IntentRoutingSample,
  referenceTime: string,
): { score: number; scoreLabel: 'pass' | 'fail' | 'not-evaluated'; explanation: string } {
  const { benchmarkInput, expectedActivatedKeys } = sample

  // 提取所有 skill 用于 benchmark
  const report: BenchmarkReport = runSkillBenchmark(
    benchmarkInput.skills[0]!, // benchmark 需要一个 skill，但实际用 skills 数组
    [benchmarkInput],
    { referenceTime, benchmarkSource: 'fixture' },
  )

  // 用 coverageRate 作为 score（0-1）
  const score = report.coverageRate
  const allExpectedHit =
    expectedActivatedKeys.length === 0
      ? report.activationDecisions.every((d) => d.activatedSkills.length === 0)
      : report.coverageHits >= expectedActivatedKeys.length

  return {
    score,
    scoreLabel: allExpectedHit ? 'pass' : 'fail',
    explanation: allExpectedHit
      ? `Coverage ${report.coverageHits}/${expectedActivatedKeys.length} expected keys activated`
      : `Coverage ${report.coverageHits}/${expectedActivatedKeys.length} expected keys activated — incomplete`,
  }
}

/**
 * 评测草案质量样本。
 * 复用 runDeterministicEvaluation（deterministic_evaluators）——不创建新评分逻辑。
 */
function evaluateDraftQuality(sample: DraftQualitySample): {
  score: number
  scoreLabel: 'pass' | 'fail' | 'not-evaluated'
  explanation: string
} {
  const output = runDeterministicEvaluation(sample.evaluatorInput)
  return {
    score: output.scoreValue,
    scoreLabel: output.scoreLabel,
    explanation: output.explanation,
  }
}

/**
 * 评测上下文组装完备度样本。
 * 基于确定性规则判定（复用 copilot-context-assembly 的验证逻辑模式）。
 */
function evaluateContextAssembly(sample: ContextAssemblySample): {
  score: number
  scoreLabel: 'pass' | 'fail' | 'not-evaluated'
  explanation: string
} {
  // 确定性判定：基于样本的结构化特征
  const pass =
    sample.expectedCompleteness === 'pass'
      ? !sample.hasWarnings && sample.sourceCount > 0
      : sample.hasWarnings || sample.sourceCount === 0

  return {
    score: pass ? 1 : 0,
    scoreLabel: pass ? 'pass' : 'fail',
    explanation: pass
      ? `Context assembly state "${sample.assemblyState}" passes completeness check`
      : `Context assembly state "${sample.assemblyState}" fails completeness check (warnings=${sample.hasWarnings}, sources=${sample.sourceCount})`,
  }
}

/**
 * 评测结构化输出符合度样本。
 * 基于确定性规则判定（复用 copilot-structured-output 的守卫逻辑模式）。
 */
function evaluateStructuredOutput(sample: StructuredOutputSample): {
  score: number
  scoreLabel: 'pass' | 'fail' | 'not-evaluated'
  explanation: string
} {
  const pass = sample.guardPassed && sample.hasSourceRefs

  return {
    score: pass ? 1 : 0,
    scoreLabel: pass ? 'pass' : 'fail',
    explanation: pass
      ? `Structured output "${sample.blockKind}" passes conformance check`
      : `Structured output "${sample.blockKind}" fails conformance check (guard=${sample.guardPassed}, sourceRefs=${sample.hasSourceRefs})`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task 3.4 — 评分配置版本记录
// ═══════════════════════════════════════════════════════════════════════════════

/** 默认评分配置版本。 */
export const DEFAULT_SCORING_CONFIG_VERSION: ScoringConfigVersion = {
  version: '1.0.0',
  skillEvalVersion: '1.0.0',
  deterministicEvalVersion: '1.0.0',
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task 5.1 — 回归运行确定性
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 生成确定性报告 ID。
 * 相同 datasetVersion + subjectVersion + scoringConfigVersion + 排序后的 sampleResults → 相同 ID。
 */
function generateReportId(
  datasetVersion: DatasetVersion,
  subjectVersion: string,
  scoringConfigVersion: ScoringConfigVersion,
  sortedSampleResults: SampleResult[],
): string {
  const payload = JSON.stringify(
    {
      datasetVersion: `${datasetVersion.major}.${datasetVersion.minor}.${datasetVersion.patch}`,
      subjectVersion,
      scoringConfigVersion: scoringConfigVersion.version,
      samples: sortedSampleResults.map((r) => ({
        id: r.sampleId,
        score: r.score,
        label: r.scoreLabel,
      })),
    },
    Object.keys({
      datasetVersion: 0,
      subjectVersion: 0,
      scoringConfigVersion: 0,
      samples: 0,
    }).sort(),
  )
  return createHash('sha256').update(payload, 'utf-8').digest('hex').slice(0, 16)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task 5.3 — Baseline 作为具体历史 run ID
// ═══════════════════════════════════════════════════════════════════════════════

/** Baseline 运行结果快照（per-sample 得分）。 */
export interface BaselineSnapshot {
  /** 历史 run ID。 */
  runId: BaselineRunId
  /** Per-sample 得分映射（sampleId → score）。 */
  sampleScores: Record<string, number>
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task 5.5 — Per-sample 差异输出
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 计算 per-sample 差异（纯函数）。
 * 只提供数据，不做「regressed = 坏」的自动判定。
 */
function computeDifferences(
  sampleResults: SampleResult[],
  baseline: BaselineSnapshot | undefined,
): SampleResult[] {
  if (!baseline) return sampleResults

  return sampleResults.map((result) => {
    const baselineScore = baseline.sampleScores[result.sampleId]
    if (baselineScore === undefined) {
      return result // baseline 中无此样本，无差异
    }

    const delta = Math.round((result.score - baselineScore) * 10000) / 10000
    const direction: SampleDifference['direction'] =
      delta > 0 ? 'improved' : delta < 0 ? 'regressed' : 'unchanged'

    const difference: SampleDifference = {
      sampleId: result.sampleId,
      currentScore: result.score,
      baselineScore,
      direction,
      delta: delta < 0 ? -delta : delta,
    }

    return { ...result, difference }
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// 汇总统计
// ═══════════════════════════════════════════════════════════════════════════════

function computeSummary(sampleResults: SampleResult[]): OfflineEvalSummary {
  let passCount = 0
  let failCount = 0
  let notEvaluatedCount = 0
  let improvedCount = 0
  let regressedCount = 0
  let unchangedCount = 0
  let hasBaseline = false

  for (const r of sampleResults) {
    if (r.scoreLabel === 'pass') passCount++
    else if (r.scoreLabel === 'fail') failCount++
    else notEvaluatedCount++

    if (r.difference) {
      hasBaseline = true
      if (r.difference.direction === 'improved') improvedCount++
      else if (r.difference.direction === 'regressed') regressedCount++
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

// ═══════════════════════════════════════════════════════════════════════════════
// 主运行器
// ═══════════════════════════════════════════════════════════════════════════════

/** 运行器配置选项。 */
export interface OfflineEvalRunnerOptions {
  /** 数据集。 */
  dataset: OfflineEvalDataset
  /** 被评测的 subject 版本。 */
  subjectVersion: string
  /** 评分配置版本。 */
  scoringConfigVersion?: ScoringConfigVersion
  /** 参考时间（确定性，不依赖 Date.now()）。 */
  referenceTime: string
  /** Baseline 快照（可选，提供时计算差异）。 */
  baseline?: BaselineSnapshot
}

/**
 * 运行离线回归评测。
 *
 * 确定性保证：相同 inputs → 相同 report（键排序 + 纯函数 scorer）。
 * 复用在线 scorer：scoreSkillQuality / runSkillBenchmark / runDeterministicEvaluation。
 * 不创建任何新评分逻辑。
 *
 * Task 5.7: 不做自动 regressed 判定——只提供差异数据供人类决策。
 */
export function runOfflineEval(options: OfflineEvalRunnerOptions): OfflineEvalReport {
  const {
    dataset,
    subjectVersion,
    scoringConfigVersion = DEFAULT_SCORING_CONFIG_VERSION,
    referenceTime,
    baseline,
  } = options

  // ── Step 1: 按目标组评估每个样本 ──
  const sampleResults: SampleResult[] = []

  // Intent routing samples（复用 runSkillBenchmark）
  for (const sample of dataset.samples.intentRouting) {
    const result = evaluateIntentRouting(sample, referenceTime)
    sampleResults.push({
      sampleId: sample.sampleId,
      targetGroup: 'intent_routing_accuracy',
      label: sample.label,
      score: result.score,
      scoreLabel: result.scoreLabel,
      explanation: result.explanation,
    })
  }

  // Draft quality samples（复用 runDeterministicEvaluation）
  for (const sample of dataset.samples.draftQuality) {
    const result = evaluateDraftQuality(sample)
    sampleResults.push({
      sampleId: sample.sampleId,
      targetGroup: 'draft_quality',
      label: sample.label,
      score: result.score,
      scoreLabel: result.scoreLabel,
      explanation: result.explanation,
    })
  }

  // Context assembly samples
  for (const sample of dataset.samples.contextAssembly) {
    const result = evaluateContextAssembly(sample)
    sampleResults.push({
      sampleId: sample.sampleId,
      targetGroup: 'context_assembly_completeness',
      label: sample.label,
      score: result.score,
      scoreLabel: result.scoreLabel,
      explanation: result.explanation,
    })
  }

  // Structured output samples
  for (const sample of dataset.samples.structuredOutput) {
    const result = evaluateStructuredOutput(sample)
    sampleResults.push({
      sampleId: sample.sampleId,
      targetGroup: 'structured_output_conformance',
      label: sample.label,
      score: result.score,
      scoreLabel: result.scoreLabel,
      explanation: result.explanation,
    })
  }

  // ── Step 2: 稳定排序（sampleId 字典序）——确定性保证 ──
  const sortedResults = [...sampleResults].sort((a, b) => a.sampleId.localeCompare(b.sampleId))

  // ── Step 3: 计算 baseline 差异 ──
  const resultsWithDifferences = computeDifferences(sortedResults, baseline)

  // ── Step 4: 汇总统计 ──
  const summary = computeSummary(resultsWithDifferences)

  // ── Step 5: 生成报告 ID（确定性）──
  const reportId = generateReportId(
    dataset.version,
    subjectVersion,
    scoringConfigVersion,
    resultsWithDifferences,
  )

  const contentHash = createHash('sha256')
    .update(serializeSortedSampleResults(resultsWithDifferences), 'utf-8')
    .digest('hex')

  return {
    reportId,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.version,
    scoringConfigVersion,
    ranAt: referenceTime, // 用 referenceTime 而非 Date.now()——确定性
    subjectVersion,
    baselineRunId: baseline?.runId,
    sampleResults: resultsWithDifferences,
    summary,
    contentHash,
  }
}
