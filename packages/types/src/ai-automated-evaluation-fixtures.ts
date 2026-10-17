/**
 * v3-ai-automated-evaluation §2.11 — AI 产出自动化评测 fixtures。
 *
 * 覆盖八态：确定性通过、确定性失败、judge 补评、judge 与确定性冲突、
 * judge 失败未评、被采样跳过、低置信必评、阈值越界。
 *
 * @aiproj/types 零依赖约束
 */

import type {
  EvaluationScoreRecord,
  SamplingDeclaration,
  SamplingDecisionRecord,
  ThresholdDeclaration,
  ThresholdEvaluationResult,
  DeterministicEvaluatorOutput,
  JudgeAdapterOutput,
  JudgeCallResult,
} from './ai-automated-evaluation.js'
import { computeEvaluationIdempotencyKey } from './ai-automated-evaluation.js'

// ── 共享基础 ──────────────────────────────────────────────────────────────

const FIXED_ORG_ID = 1
const FIXED_CAPTURED_AT = '2026-08-17T00:00:00.000Z'
const FIXED_EVALUATOR_VERSION = '1.0.0'
const FIXED_ARTIFACT_HASH = 'fnv1a:abc123def456'

/** 默认采样声明：全量。 */
export const defaultSamplingDeclaration: SamplingDeclaration = {
  strategy: 'all',
  ratio: 1,
  lowConfidenceAlwaysEvaluate: true,
}

/** 全量采样决策记录。 */
const evaluatedSamplingDecision: SamplingDecisionRecord = {
  declaration: defaultSamplingDeclaration,
  decision: 'evaluated',
}

/** 跳过采样决策记录。 */
const skippedSamplingDecision: SamplingDecisionRecord = {
  declaration: { strategy: 'ratio', ratio: 0.1, lowConfidenceAlwaysEvaluate: true },
  decision: 'skipped',
  skipReason: 'ratio sampling: 0.7500 >= 0.1',
}

// ── Fixture 1: 确定性通过 ────────────────────────────────────────────────

/** 确定性评测器通过输出。 */
export const deterministicPassOutput: DeterministicEvaluatorOutput = {
  scoreValue: 1,
  scoreLabel: 'pass',
  explanation: 'Draft structure complies with all required fields',
}

/** 确定性通过评分记录。 */
export const deterministicPassScore: EvaluationScoreRecord = {
  organizationId: FIXED_ORG_ID,
  dimension: 'draft_structural_compliance',
  scoreValue: 1,
  scoreLabel: 'pass',
  explanation: 'Draft structure complies with all required fields',
  evaluatedArtifact: {
    artifactKind: 'draft_version',
    artifactRef: 'draft:42:v3',
    contentHash: FIXED_ARTIFACT_HASH,
  },
  evaluator: {
    kind: 'deterministic',
    name: 'draft_structural_compliance',
    version: FIXED_EVALUATOR_VERSION,
  },
  samplingDecision: evaluatedSamplingDecision,
  idempotencyKey: computeEvaluationIdempotencyKey({
    dimension: 'draft_structural_compliance',
    artifactRef: 'draft:42:v3',
    evaluatorVersion: FIXED_EVALUATOR_VERSION,
    capturedAt: FIXED_CAPTURED_AT,
  }),
  createdAt: FIXED_CAPTURED_AT,
}

// ── Fixture 2: 确定性失败 ────────────────────────────────────────────────

/** 确定性评测器失败输出。 */
export const deterministicFailOutput: DeterministicEvaluatorOutput = {
  scoreValue: 0,
  scoreLabel: 'fail',
  explanation: 'Draft missing required WBS nodes for 3 tasks',
}

/** 确定性失败评分记录。 */
export const deterministicFailScore: EvaluationScoreRecord = {
  organizationId: FIXED_ORG_ID,
  dimension: 'draft_structural_compliance',
  scoreValue: 0,
  scoreLabel: 'fail',
  explanation: 'Draft missing required WBS nodes for 3 tasks',
  evaluatedArtifact: {
    artifactKind: 'draft_version',
    artifactRef: 'draft:43:v1',
    contentHash: 'fnv1a:xyz789',
  },
  evaluator: {
    kind: 'deterministic',
    name: 'draft_structural_compliance',
    version: FIXED_EVALUATOR_VERSION,
  },
  samplingDecision: evaluatedSamplingDecision,
  idempotencyKey: computeEvaluationIdempotencyKey({
    dimension: 'draft_structural_compliance',
    artifactRef: 'draft:43:v1',
    evaluatorVersion: FIXED_EVALUATOR_VERSION,
    capturedAt: FIXED_CAPTURED_AT,
  }),
  createdAt: FIXED_CAPTURED_AT,
}

// ── Fixture 3: judge 补评 ────────────────────────────────────────────────

/** judge 适配器输出：用于确定性无法覆盖的维度。 */
export const judgeSupplementOutput: JudgeAdapterOutput = {
  scoreValue: 0.8,
  scoreLabel: 'pass',
  explanation: 'Narration maintains factual consistency with context',
}

/** judge 适配器调用成功结果。 */
export const judgeCallSuccessResult: JudgeCallResult = {
  success: true,
  output: judgeSupplementOutput,
  ledgerAttemptId: 'attempt:judge:001',
}

/** judge 补评评分记录。 */
export const judgeSupplementScore: EvaluationScoreRecord = {
  organizationId: FIXED_ORG_ID,
  dimension: 'narration_cites_out_of_context_fact',
  scoreValue: 0.8,
  scoreLabel: 'pass',
  explanation: 'Narration maintains factual consistency with context',
  evaluatedArtifact: {
    artifactKind: 'copilot_message',
    artifactRef: 'copilot_msg:99',
    contentHash: 'fnv1a:supplement001',
  },
  evaluator: {
    kind: 'judge',
    name: 'gpt-4-judge',
    version: FIXED_EVALUATOR_VERSION,
    judgeModel: 'openai/gpt-4',
    judgePromptVersion: 'v2.1',
  },
  samplingDecision: evaluatedSamplingDecision,
  idempotencyKey: computeEvaluationIdempotencyKey({
    dimension: 'narration_cites_out_of_context_fact',
    artifactRef: 'copilot_msg:99',
    evaluatorVersion: FIXED_EVALUATOR_VERSION,
    capturedAt: FIXED_CAPTURED_AT,
  }),
  ledgerAttemptRef: 'attempt:judge:001',
  createdAt: FIXED_CAPTURED_AT,
}

// ── Fixture 4: judge 与确定性冲突 ────────────────────────────────────────

/** 确定性判定失败。 */
export const deterministicConflictOutput: DeterministicEvaluatorOutput = {
  scoreValue: 0,
  scoreLabel: 'fail',
  explanation: 'Routing destination differs from router recommendation',
}

/** judge 判定通过（与确定性冲突）。 */
export const judgeConflictOutput: JudgeAdapterOutput = {
  scoreValue: 1,
  scoreLabel: 'pass',
  explanation: 'Route appears reasonable given context',
}

/** 冲突合并结果：确定性胜出。 */
export const conflictMergedScore: EvaluationScoreRecord = {
  organizationId: FIXED_ORG_ID,
  dimension: 'routing_destination_changed',
  scoreValue: 0,
  scoreLabel: 'fail',
  explanation: 'Routing destination differs from router recommendation',
  evaluatedArtifact: {
    artifactKind: 'routing_decision',
    artifactRef: 'route:55',
    contentHash: 'fnv1a:conflict001',
  },
  evaluator: {
    kind: 'deterministic',
    name: 'routing_destination_changed',
    version: FIXED_EVALUATOR_VERSION,
  },
  samplingDecision: evaluatedSamplingDecision,
  idempotencyKey: computeEvaluationIdempotencyKey({
    dimension: 'routing_destination_changed',
    artifactRef: 'route:55',
    evaluatorVersion: FIXED_EVALUATOR_VERSION,
    capturedAt: FIXED_CAPTURED_AT,
  }),
  createdAt: FIXED_CAPTURED_AT,
}

// ── Fixture 5: judge 失败未评 ────────────────────────────────────────────

/** judge 适配器调用失败结果。 */
export const judgeCallFailureResult: JudgeCallResult = {
  success: false,
  error: 'Provider timeout',
  deniedByBudgetOrRateLimit: false,
}

/** judge 失败评分记录：必须是 not-evaluated。 */
export const judgeFailScore: EvaluationScoreRecord = {
  organizationId: FIXED_ORG_ID,
  dimension: 'narration_cites_out_of_context_fact',
  scoreValue: 0,
  scoreLabel: 'not-evaluated',
  explanation: 'Judge unavailable: Provider timeout',
  evaluatedArtifact: {
    artifactKind: 'copilot_message',
    artifactRef: 'copilot_msg:100',
    contentHash: 'fnv1a:judgefail001',
  },
  evaluator: {
    kind: 'judge',
    name: 'gpt-4-judge',
    version: FIXED_EVALUATOR_VERSION,
    judgeModel: 'openai/gpt-4',
    judgePromptVersion: 'v2.1',
  },
  samplingDecision: evaluatedSamplingDecision,
  idempotencyKey: computeEvaluationIdempotencyKey({
    dimension: 'narration_cites_out_of_context_fact',
    artifactRef: 'copilot_msg:100',
    evaluatorVersion: FIXED_EVALUATOR_VERSION,
    capturedAt: FIXED_CAPTURED_AT,
  }),
  createdAt: FIXED_CAPTURED_AT,
}

// ── Fixture 6: 被采样跳过 ────────────────────────────────────────────────

/** 被采样跳过的评分记录。 */
export const skippedScore: EvaluationScoreRecord = {
  organizationId: FIXED_ORG_ID,
  dimension: 'suggestion_adoption',
  scoreValue: 0,
  scoreLabel: 'not-evaluated',
  explanation: 'Skipped by ratio sampling (not in 10% sample)',
  evaluatedArtifact: {
    artifactKind: 'copilot_message',
    artifactRef: 'copilot_msg:101',
    contentHash: 'fnv1a:skipped001',
  },
  evaluator: {
    kind: 'deterministic',
    name: 'suggestion_adoption',
    version: FIXED_EVALUATOR_VERSION,
  },
  samplingDecision: skippedSamplingDecision,
  idempotencyKey: computeEvaluationIdempotencyKey({
    dimension: 'suggestion_adoption',
    artifactRef: 'copilot_msg:101',
    evaluatorVersion: FIXED_EVALUATOR_VERSION,
    capturedAt: FIXED_CAPTURED_AT,
  }),
  createdAt: FIXED_CAPTURED_AT,
}

// ── Fixture 7: 低置信必评 ────────────────────────────────────────────────

/** 低置信必评评分记录。 */
export const lowConfidenceScore: EvaluationScoreRecord = {
  organizationId: FIXED_ORG_ID,
  dimension: 'anti_hallucination_hit',
  scoreValue: 0,
  scoreLabel: 'fail',
  explanation: 'Low confidence output contained unverifiable claim',
  evaluatedArtifact: {
    artifactKind: 'draft_version',
    artifactRef: 'draft:44:v1',
    contentHash: 'fnv1a:lowconf001',
  },
  evaluator: {
    kind: 'deterministic',
    name: 'anti_hallucination_hit',
    version: FIXED_EVALUATOR_VERSION,
  },
  samplingDecision: {
    declaration: {
      strategy: 'ratio',
      ratio: 0.1,
      lowConfidenceAlwaysEvaluate: true,
    },
    decision: 'evaluated',
    lowConfidenceOverride: true,
  },
  idempotencyKey: computeEvaluationIdempotencyKey({
    dimension: 'anti_hallucination_hit',
    artifactRef: 'draft:44:v1',
    evaluatorVersion: FIXED_EVALUATOR_VERSION,
    capturedAt: FIXED_CAPTURED_AT,
  }),
  createdAt: FIXED_CAPTURED_AT,
}

// ── Fixture 8: 阈值越界 ────────────────────────────────────────────────

/** 阈值声明：草案结构合规维度。 */
export const draftStructuralThreshold: ThresholdDeclaration = {
  dimension: 'draft_structural_compliance',
  warningThreshold: 0.7,
  criticalThreshold: 0.4,
  source: 'fixture-baseline',
  sourceRef: 'fixture:v1:001',
}

/** 阈值越界评估结果。 */
export const thresholdBreachedResult: ThresholdEvaluationResult = {
  healthState: 'critical',
  reasonCode: 'eval_draft_structural_compliance_critical',
  runbookRef: '/runbooks/ai-evaluation/threshold-breach/draft_structural_compliance',
  breached: true,
  breachedThreshold: draftStructuralThreshold,
}

/** 阈值正常的评估结果。 */
export const thresholdHealthyResult: ThresholdEvaluationResult = {
  healthState: 'healthy',
  reasonCode: '',
  runbookRef: '',
  breached: false,
}

// ── 禁存正文负例 ────────────────────────────────────────────────────────

/** 违规 explanation：包含被评 prompt 文本。 */
export const violatingExplanationWithPrompt =
  'The output failed because prompt: "Write a project plan" was not followed correctly'

/** 违规 explanation：包含被评模型输出文本。 */
export const violatingExplanationWithOutput =
  'The draft contains model output: The project will be completed by 2027-13-45'

/** 违规 explanation：包含工具参数结果。 */
export const violatingExplanationWithToolResult =
  'Evaluation found tool result: {"wbs_nodes": [...]} is incomplete'

/** 违规 explanation：包含检索正文。 */
export const violatingExplanationWithRetrieval =
  'The response cites retrieved body: "According to the specification document..."'

/** 合法 explanation：不包含任何被评正文。 */
export const validExplanation =
  'Draft structure check found 3 missing required fields: WBS nodes, task dependencies, acceptance criteria'

// ── Fixture 汇总 ────────────────────────────────────────────────────────

/** 八态 fixtures 汇总。 */
export const evaluationFixtures = {
  deterministicPassScore,
  deterministicFailScore,
  judgeSupplementScore,
  conflictMergedScore,
  judgeFailScore,
  skippedScore,
  lowConfidenceScore,
  thresholdBreachedResult,
  thresholdHealthyResult,
  judgeCallSuccessResult,
  judgeCallFailureResult,
  deterministicPassOutput,
  deterministicFailOutput,
  judgeSupplementOutput,
  judgeConflictOutput,
  deterministicConflictOutput,
  draftStructuralThreshold,
  defaultSamplingDeclaration,
  evaluatedSamplingDecision,
  skippedSamplingDecision,
  violatingExplanationWithPrompt,
  violatingExplanationWithOutput,
  violatingExplanationWithToolResult,
  violatingExplanationWithRetrieval,
  validExplanation,
} as const
