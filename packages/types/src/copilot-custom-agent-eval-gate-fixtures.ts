/**
 * v3-copilot-custom-agent-eval-gate — 五态 fixtures
 *
 * 覆盖：通过、未达阈值、依赖变更失效、授权门未开、评分器不可用。
 * 所有 fixture 使用固定值，确定性可复现。
 */

import type {
  EvalGateVerdictRecord,
  EvalGateItemScore,
  EvalGateThresholdConfig,
  EvalGateDependencyFingerprintInput,
  EvalGateScorerConfig,
  EvalGateFixtureState,
  EvalGateSkillRef,
  EvalGateKnowledgeRef,
} from './copilot-custom-agent-eval-gate.js'

// ---------------------------------------------------------------------------
// 常用引用
// ---------------------------------------------------------------------------

export const EVAL_GATE_FIXTURE_AGENT_ID = 'agent-fixture-001'
export const EVAL_GATE_FIXTURE_DEFINITION_VERSION = '1.0.0'
export const EVAL_GATE_FIXTURE_ORG_ID = 42
export const EVAL_GATE_FIXTURE_USER_ID = 7
export const EVAL_GATE_FIXTURE_DATASET_VERSION = 'ds-v1'
export const EVAL_GATE_FIXTURE_SCORER_VERSION = 'scorer-v1'

export const EVAL_GATE_FIXTURE_SKILLS: EvalGateSkillRef[] = [
  { skillId: 101, version: '1.0.0' },
  { skillId: 102, version: '2.1.0' },
]

export const EVAL_GATE_FIXTURE_KNOWLEDGE_PACKAGES: EvalGateKnowledgeRef[] = [
  { packageId: 'kp-001', version: '1.0.0' },
]

export const EVAL_GATE_FIXTURE_DEPENDENCY_INPUT: EvalGateDependencyFingerprintInput = {
  skills: EVAL_GATE_FIXTURE_SKILLS,
  knowledgePackages: EVAL_GATE_FIXTURE_KNOWLEDGE_PACKAGES,
}

export const EVAL_GATE_FIXTURE_SCORER_CONFIG: EvalGateScorerConfig = {
  kind: 'deterministic',
  version: EVAL_GATE_FIXTURE_SCORER_VERSION,
  paramsFingerprint: 'fp-deterministic-v1',
}

// ---------------------------------------------------------------------------
// 评测项得分 fixtures
// ---------------------------------------------------------------------------

function makePassingItemScores(): EvalGateItemScore[] {
  return [
    { itemId: 'dim-structure', itemName: '结构合规', score: 0.92, failed: false },
    { itemId: 'dim-coverage', itemName: '覆盖率', score: 0.88, failed: false },
    { itemId: 'dim-provenance', itemName: '来源可追溯', score: 0.95, failed: false },
    { itemId: 'dim-regulation', itemName: '合规性', score: 0.85, failed: false },
  ]
}

function makeFailingItemScores(): EvalGateItemScore[] {
  return [
    { itemId: 'dim-structure', itemName: '结构合规', score: 0.72, failed: false },
    {
      itemId: 'dim-coverage',
      itemName: '覆盖率',
      score: 0.45,
      failed: true,
      actionableHint: '增加至少 3 个知识节以提升覆盖率',
    },
    { itemId: 'dim-provenance', itemName: '来源可追溯', score: 0.9, failed: false },
    {
      itemId: 'dim-regulation',
      itemName: '合规性',
      score: 0.38,
      failed: true,
      actionableHint: '补充法规引用来源',
    },
  ]
}

// ---------------------------------------------------------------------------
// 五态 verdict fixtures
// ---------------------------------------------------------------------------

function baseVerdict(overrides: Partial<EvalGateVerdictRecord>): EvalGateVerdictRecord {
  return {
    id: 'verdict-fixture-001',
    organizationId: EVAL_GATE_FIXTURE_ORG_ID,
    agentId: EVAL_GATE_FIXTURE_AGENT_ID,
    definitionVersion: EVAL_GATE_FIXTURE_DEFINITION_VERSION,
    dependencyFingerprint: 'fp-deps-fixture',
    datasetVersion: EVAL_GATE_FIXTURE_DATASET_VERSION,
    scorerConfigFingerprint: 'fp-scorer-fixture',
    verdict: 'pass',
    itemScores: makePassingItemScores(),
    failingItemIds: [],
    benchmarkSource: 'fixture',
    scorerVersion: EVAL_GATE_FIXTURE_SCORER_VERSION,
    createdBy: EVAL_GATE_FIXTURE_USER_ID,
    createdAt: '2026-08-19T10:00:00Z',
    ...overrides,
  }
}

/** 通过态：所有评测项达标。 */
export function buildPassingVerdict(): EvalGateVerdictRecord {
  return baseVerdict({ verdict: 'pass', itemScores: makePassingItemScores(), failingItemIds: [] })
}

/** 未达阈值态：部分评测项不达标。 */
export function buildBelowThresholdVerdict(): EvalGateVerdictRecord {
  const items = makeFailingItemScores()
  return baseVerdict({
    verdict: 'fail',
    itemScores: items,
    failingItemIds: items.filter((i) => i.failed).map((i) => i.itemId),
  })
}

/** 依赖变更失效态：Skill 版本变更导致结论失效。 */
export function buildDependencyInvalidatedVerdict(): EvalGateVerdictRecord {
  return baseVerdict({
    verdict: 'invalidated',
    invalidationReason: 'skill_version_changed',
    itemScores: makePassingItemScores(),
    failingItemIds: [],
  })
}

/** 授权门未开态：真实模型评测未获授权。 */
export function buildAuthGatedVerdict(): EvalGateVerdictRecord {
  return baseVerdict({
    verdict: 'unavailable',
    itemScores: [],
    failingItemIds: [],
    benchmarkSource: 'fixture',
  })
}

/** 评分器不可用态：评分器不可达时门禁不通过。 */
export function buildScorerUnavailableVerdict(): EvalGateVerdictRecord {
  return baseVerdict({
    verdict: 'fail',
    itemScores: [],
    failingItemIds: [],
  })
}

// ---------------------------------------------------------------------------
// 门禁阈值配置 fixtures
// ---------------------------------------------------------------------------

/** 已配置阈值（通过阈值 0.7）。 */
export function buildConfiguredThreshold(): EvalGateThresholdConfig {
  return {
    organizationId: EVAL_GATE_FIXTURE_ORG_ID,
    passThreshold: 0.7,
    enabled: true,
    realModelEvalAuthorized: false,
    configuredBy: EVAL_GATE_FIXTURE_USER_ID,
    configuredAt: '2026-08-19T09:00:00Z',
  }
}

/** 未配置阈值（enabled=false）。 */
export function buildUnconfiguredThreshold(): EvalGateThresholdConfig {
  return {
    organizationId: EVAL_GATE_FIXTURE_ORG_ID,
    passThreshold: 0,
    enabled: false,
    realModelEvalAuthorized: false,
    configuredBy: EVAL_GATE_FIXTURE_USER_ID,
    configuredAt: '2026-08-19T09:00:00Z',
  }
}

/** 门禁已禁用（回退约束场景）。 */
export function buildDisabledGateThreshold(): EvalGateThresholdConfig {
  return {
    organizationId: EVAL_GATE_FIXTURE_ORG_ID,
    passThreshold: 0,
    enabled: false,
    realModelEvalAuthorized: false,
    configuredBy: EVAL_GATE_FIXTURE_USER_ID,
    configuredAt: '2026-08-19T09:00:00Z',
  }
}

/** 真实模型评测已授权。 */
export function buildRealModelAuthorizedThreshold(): EvalGateThresholdConfig {
  return {
    organizationId: EVAL_GATE_FIXTURE_ORG_ID,
    passThreshold: 0.7,
    enabled: true,
    realModelEvalAuthorized: true,
    configuredBy: EVAL_GATE_FIXTURE_USER_ID,
    configuredAt: '2026-08-19T09:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// 按状态名获取 fixture
// ---------------------------------------------------------------------------

/** 根据 fixture state 获取对应的 verdict。 */
export function buildVerdictForState(state: EvalGateFixtureState): EvalGateVerdictRecord {
  switch (state) {
    case 'passing':
      return buildPassingVerdict()
    case 'below_threshold':
      return buildBelowThresholdVerdict()
    case 'dependency_invalidated':
      return buildDependencyInvalidatedVerdict()
    case 'auth_gated':
      return buildAuthGatedVerdict()
    case 'scorer_unavailable':
      return buildScorerUnavailableVerdict()
  }
}

// ---------------------------------------------------------------------------
// L3 边界 fixtures
// ---------------------------------------------------------------------------

/** 含 L3 内容的评测报告（出口负例用）。 */
export function buildReportWithL3Content(): Record<string, unknown> {
  return {
    verdict: 'pass',
    itemScores: [{ itemId: 'dim-1', itemName: '测试项', score: 0.9, failed: false }],
    benchmarkSource: 'L3',
    evaluationNote: '本报告基于 L3 Synthetic 数据集评估',
    scoringRationale: '根据 L3 合成知识库中的示例进行评分',
  }
}

/** 含敏感样本的报告（禁存约束负例用）。 */
export function buildReportWithSensitiveContent(): Record<string, unknown> {
  return {
    verdict: 'pass',
    prompt: '完整的 prompt 文本内容',
    fullOutput: '完整的模型输出内容',
    token: 'sk-test-api-key-1234567890abcdef',
    secret: 'secret=abc123def456',
    itemScores: [],
  }
}

// ---------------------------------------------------------------------------
// 确定性测试 fixtures
// ---------------------------------------------------------------------------

/** 两个相同输入但不同键序的评分器配置（确定性测试用）。 */
export function buildDeterministicScorerConfigs(): EvalGateScorerConfig[] {
  return [
    {
      kind: 'deterministic',
      version: 'v1',
      paramsFingerprint: 'fp-1',
    },
    {
      paramsFingerprint: 'fp-1',
      kind: 'deterministic',
      version: 'v1',
    },
  ]
}
