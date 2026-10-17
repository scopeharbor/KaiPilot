/**
 * compiler-ab-compilation —— Compiler A/B compilation framework 共享契约（V2.5 W3）。
 *
 * 定义 A/B experiment 配置、variant、sample set、metric、winner policy、go/no-go summary
 * 和 evidence eligibility 类型。
 *
 * 零运行时依赖，纯 TypeScript 类型。
 * 遵循 design D1 离线 evidence framework、D2 typed descriptor、D3 fixture 默认 runner、
 * D4 五类 metric、D5 review-only summary、D6 保守持久化。
 *
 * @aiproj/types 零依赖约束：不导入 zod / adonisjs / compiler-spec。
 */

// ── 契约版本 ───────────────────────────────────────────────────

export const COMPILER_AB_CONTRACT_VERSION = '1.0' as const

// ── 授权模式 ──────────────────────────────────────────────────

export const COMPILER_AB_AUTHORIZATION_MODES = ['fixture', 'authorized', 'unauthorized'] as const
export type CompilerAbAuthorizationMode = (typeof COMPILER_AB_AUTHORIZATION_MODES)[number]

// ── Variant ────────────────────────────────────────────────────

/**
 * A/B variant descriptor —— 只描述可审计输入，不包含敏感 payload。
 * 遵循 design D2。
 */
export interface CompilerAbVariant {
  /** Variant 唯一 ID（在 experiment 内唯一）。 */
  variantId: string
  /** 人类可读名称。 */
  label: string
  /** 34-stage catalog version ref（如 '1.0'）。 */
  catalogVersion?: string
  /** Dynamic routing decision ref（routing input hash 或 fixture route id）。 */
  routingDecisionRef?: string
  /** Tool hardening profile ref。 */
  toolHardeningProfile?: string
  /** Model profile ref（provider + model 标识）。 */
  modelProfileRef?: string
  /** Feature flags（enum set，如 ['streaming_ws', 'deterministic_tools']）。 */
  featureFlags?: string[]
  /** Fixture provider id（fixture 模式下使用的确定性 provider）。 */
  fixtureProviderId?: string
}

// ── Sample Set ─────────────────────────────────────────────────

export const COMPILER_AB_SAMPLE_KINDS = ['fixture', 'archived', 'synthetic'] as const
export type CompilerAbSampleKind = (typeof COMPILER_AB_SAMPLE_KINDS)[number]

export interface CompilerAbSampleEntry {
  /** Sample 唯一 ID。 */
  sampleId: string
  /** Sample 类型。 */
  kind: CompilerAbSampleKind
  /** 输入描述或 ref（低敏）。 */
  inputRef: string
  /** 输入哈希（确定性校验）。 */
  inputHash: string
  /** 预期行为标签，用于 fixture 断言。 */
  expectedBehaviorLabel?: string
}

export interface CompilerAbSampleSet {
  /** Sample set 唯一 ID。 */
  sampleSetId: string
  /** Sample set 版本。 */
  version: string
  /** 样本条目列表。 */
  samples: CompilerAbSampleEntry[]
  /** Sample set 哈希（整体确定性校验）。 */
  sampleSetHash: string
}

// ── Metric Profile ─────────────────────────────────────────────

export const COMPILER_AB_METRIC_GROUPS = [
  'quality',
  'safety',
  'cost',
  'latency',
  'stability',
] as const
export type CompilerAbMetricGroup = (typeof COMPILER_AB_METRIC_GROUPS)[number]

export interface CompilerAbMetricProfile {
  /** Profile 名称。 */
  profileId: string
  /** 启用的 metric group。 */
  enabledGroups: CompilerAbMetricGroup[]
  /** Quality group 配置。 */
  quality?: {
    checkSchemaValidity: boolean
    checkCandidateBundleSafety: boolean
    checkHallucinationViolations: boolean
  }
  /** Safety group 配置。 */
  safety?: {
    checkRuleViolations: boolean
    checkNoReviewWriteback: boolean
    checkSecretExposure: boolean
  }
  /** Cost group 配置。 */
  cost?: {
    trackEstimatedTokens: boolean
    trackEstimatedCost: boolean
  }
  /** Latency group 配置。 */
  latency?: {
    trackLatencyBuckets: boolean
    bucketMs: number[]
  }
  /** Stability group 配置。 */
  stability?: {
    trackStageFailures: boolean
    trackRetryCount: boolean
    trackDeterministicDiff: boolean
  }
}

// ── Metric Snapshot（五类） ───────────────────────────────────

export interface CompilerAbQualityMetrics {
  schemaValidRate: number
  candidateBundleSafetyPassRate: number
  hallucinationViolationCount: number
  ruleViolationCount: number
}

export interface CompilerAbSafetyMetrics {
  ruleViolationCount: number
  noReviewWritebackRisk: boolean
  secretExposureDetected: boolean
}

export interface CompilerAbCostMetrics {
  estimatedTokenCount: number
  estimatedCostUsd: number
  realModelCallCount: number
  currency: string
}

export interface CompilerAbLatencyMetrics {
  totalDurationMs: number
  perStageDurationMs: Record<string, number>
  latencyBuckets: Record<string, number>
}

export interface CompilerAbStabilityMetrics {
  stageFailureCount: number
  totalRetryCount: number
  deterministicDiffSummary?: string
}

export interface CompilerAbMetricSnapshot {
  /** 所属 variant ID。 */
  variantId: string
  quality: CompilerAbQualityMetrics
  safety: CompilerAbSafetyMetrics
  cost: CompilerAbCostMetrics
  latency: CompilerAbLatencyMetrics
  stability: CompilerAbStabilityMetrics
  /** 汇总总分（仅供参考，不能替代五维单独评估）。 */
  compositeScore: number
}

// ── Winner Policy ──────────────────────────────────────────────

export const COMPILER_AB_WINNER_RESULTS = [
  'variant_a_preferred',
  'variant_b_preferred',
  'no_winner',
  'inconclusive',
] as const
export type CompilerAbWinnerResult = (typeof COMPILER_AB_WINNER_RESULTS)[number]

export interface CompilerAbWinnerPolicy {
  /** Policy 名称。 */
  policyId: string
  /** 使用的 metric 权重。 */
  weights: Partial<Record<CompilerAbMetricGroup, number>>
  /** 安全回归时是否强制 no_winner。 */
  safetyRegressionForcesNoWinner: boolean
}

export interface CompilerAbWinnerDecision {
  /** Policy 引用。 */
  policyId: string
  /** 决策结果。 */
  result: CompilerAbWinnerResult
  /** 原因 code。 */
  reasonCode: string
  /** 原因简述（低敏）。 */
  reasonSummary: string
  /** 各 metric group 得分对照。 */
  groupScores: Record<string, Record<string, number>>
  /** 推荐 variant ID（当 result 为 variant_a_preferred 或 variant_b_preferred 时）。 */
  preferredVariantId?: string
}

// ── Go/No-Go ──────────────────────────────────────────────────

export const COMPILER_AB_GO_NOGO_RESULTS = ['GO', 'FIX_THEN_GO', 'NO_GO'] as const
export type CompilerAbGoNoGoResult = (typeof COMPILER_AB_GO_NOGO_RESULTS)[number]

export interface CompilerAbGoNoGoDecision {
  /** 决策结果。 */
  result: CompilerAbGoNoGoResult
  /** 原因 code。 */
  reasonCode: string
  /** 原因简述（低敏）。 */
  reasonSummary: string
  /** evidenceEligible 标记（fixture 时为 false）。 */
  evidenceEligible: boolean
  /** Follow-up 操作建议。 */
  followUpActions: string[]
  /** 阻止项列表（NO_GO 时）。 */
  blockers: string[]
  /** 修复项列表（FIX_THEN_GO 时）。 */
  fixItems: string[]
}

// ── Authorization Gate ─────────────────────────────────────────

export interface CompilerAbAuthorizationGate {
  /** 授权模式。 */
  mode: CompilerAbAuthorizationMode
  /** 授权 provider/model 列表。 */
  authorizedProviders?: string[]
  /** 授权样本范围（sampleSetId 或样本数量上限）。 */
  authorizedSampleRange?: string
  /** 最大运行次数。 */
  maxRunCount?: number
  /** Token 上限。 */
  tokenCeiling?: number
  /** 成本上限（USD）。 */
  costCeilingUsd?: number
  /** 证据保存位置。 */
  evidenceRetention?: string
  /** 授权执行日期。 */
  authorizedDate?: string
  /** 授权引用（用户确认号或 ticket）。 */
  authorizationRef?: string
}

// ── Experiment Config ─────────────────────────────────────────

export interface CompilerAbExperimentConfig {
  /** 契约版本。 */
  contractVersion: typeof COMPILER_AB_CONTRACT_VERSION
  /** Experiment 唯一 ID。 */
  experimentId: string
  /** 组织 ID。 */
  organizationId: number
  /** Actor 用户 ID。 */
  actorId: number
  /** 实验目标（低敏）。 */
  objective: string
  /** Sample set 引用。 */
  sampleSetRef: string
  /** Sample set 哈希。 */
  sampleSetHash: string
  /** Variant 数组（至少 2 个）。 */
  variants: CompilerAbVariant[]
  /** Metric profile。 */
  metricProfile: CompilerAbMetricProfile
  /** Winner policy。 */
  winnerPolicy: CompilerAbWinnerPolicy
  /** 授权模式与门控。 */
  authorization: CompilerAbAuthorizationGate
  /** Budget policy ref（引用 compiler-observability-cost-controls 的预算条目）。 */
  budgetPolicyRef?: string
  /** 创建时间。 */
  createdAt: string
  /** 低敏 evidence refs。 */
  evidenceRefs?: string[]
}

// ── Report ─────────────────────────────────────────────────────

export interface CompilerAbReport {
  /** 契约版本。 */
  contractVersion: typeof COMPILER_AB_CONTRACT_VERSION
  /** 关联 experiment ID。 */
  experimentId: string
  /** 组织 ID。 */
  organizationId: number
  /** 报告创建时间。 */
  createdAt: string
  /** Variant metric snapshots。 */
  variantMetrics: CompilerAbMetricSnapshot[]
  /** Winner decision。 */
  winnerDecision: CompilerAbWinnerDecision
  /** Go/no-go decision。 */
  goNoGoDecision: CompilerAbGoNoGoDecision
  /** 是否 fixture/mock 模式。 */
  isFixture: boolean
  /** Evidence eligibility。 */
  evidenceEligible: boolean
  /** Summary（低敏）。 */
  summary: string
  /** 低敏 evidence refs。 */
  evidenceRefs: string[]
}

// ── Sensitive Field Constants ─────────────────────────────────

export const COMPILER_AB_FORBIDDEN_FIELDS = [
  'prompt',
  'rawOutput',
  'raw_output',
  'modelOutput',
  'model_output',
  'artifactBody',
  'artifact_body',
  'contextPacket',
  'context_packet',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'password',
  'privateKey',
  'private_key',
] as const

export type CompilerAbForbiddenField = (typeof COMPILER_AB_FORBIDDEN_FIELDS)[number]

// ── Validators ─────────────────────────────────────────────────

/**
 * 验证 experiment config 是否合法。
 * 检查：variant 数量 ≥ 2、无重复 variant ID、sample set hash 有效、
 * 授权模式合法、无敏感字段。
 */
export function validateCompilerAbConfig(
  config: CompilerAbExperimentConfig,
): { valid: true } | { valid: false; reasonCode: string; violations: string[] } {
  const violations: string[] = []

  // variant 数量
  if (config.variants.length < 2) {
    violations.push('experiment must have at least 2 variants')
  }

  // 重复 variant ID
  const variantIds = config.variants.map((v) => v.variantId)
  const uniqueIds = new Set(variantIds)
  if (uniqueIds.size !== variantIds.length) {
    violations.push('duplicate variant ids detected')
  }

  // 重复 variant label（同一 experiment 内）
  const labels = config.variants.map((v) => v.label)
  const uniqueLabels = new Set(labels)
  if (uniqueLabels.size !== labels.length) {
    violations.push('duplicate variant labels detected')
  }

  // sample set hash 非空
  if (!config.sampleSetHash || config.sampleSetHash.trim().length === 0) {
    violations.push('sample set hash must not be empty')
  }

  // 授权模式
  if (!isCompilerAbAuthorizationMode(config.authorization.mode)) {
    violations.push(`unsupported authorization mode: ${config.authorization.mode}`)
  }

  // metric groups
  if (!config.metricProfile.enabledGroups || config.metricProfile.enabledGroups.length === 0) {
    violations.push('at least one metric group must be enabled')
  }

  // 敏感字段检查
  const variantSensitive = config.variants.some((v) => variantContainsSensitiveFields(v))
  if (variantSensitive) {
    violations.push('variant contains sensitive fields')
  }

  if (violations.length > 0) {
    return { valid: false, reasonCode: 'AB_CONFIG_INVALID', violations }
  }

  return { valid: true }
}

/**
 * 检查 variant 是否含有敏感字段。
 */
export function variantContainsSensitiveFields(variant: CompilerAbVariant): boolean {
  const json = JSON.stringify(variant)
  const lower = json.toLowerCase()
  return COMPILER_AB_FORBIDDEN_FIELDS.some((field) => lower.includes(field.toLowerCase()))
}

/**
 * 判断字符串是否为合法授权模式。
 */
export function isCompilerAbAuthorizationMode(value: string): value is CompilerAbAuthorizationMode {
  return (COMPILER_AB_AUTHORIZATION_MODES as readonly string[]).includes(value)
}

/**
 * 判断字符串是否为合法 metric group。
 */
export function isCompilerAbMetricGroup(value: string): value is CompilerAbMetricGroup {
  return (COMPILER_AB_METRIC_GROUPS as readonly string[]).includes(value)
}

/**
 * 判断字符串是否为合法 winner result。
 */
export function isCompilerAbWinnerResult(value: string): value is CompilerAbWinnerResult {
  return (COMPILER_AB_WINNER_RESULTS as readonly string[]).includes(value)
}

/**
 * 判断字符串是否为合法 go/no-go result。
 */
export function isCompilerAbGoNoGoResult(value: string): value is CompilerAbGoNoGoResult {
  return (COMPILER_AB_GO_NOGO_RESULTS as readonly string[]).includes(value)
}

// ── Helper: 创建默认 fixture config ───────────────────────────

export function createDefaultFixtureAbConfig(
  experimentId: string,
  organizationId: number,
  actorId: number,
): CompilerAbExperimentConfig {
  return {
    contractVersion: COMPILER_AB_CONTRACT_VERSION,
    experimentId,
    organizationId,
    actorId,
    objective: 'Default fixture A/B experiment',
    sampleSetRef: 'fixture-sample-set-v1',
    sampleSetHash: 'fixture-hash-default',
    variants: [
      {
        variantId: 'variant_a',
        label: 'Baseline (default)',
        catalogVersion: '1.0',
        fixtureProviderId: 'fixture-provider-a',
      },
      {
        variantId: 'variant_b',
        label: 'Experimental (routed)',
        catalogVersion: '1.0',
        routingDecisionRef: 'fixture-route-b',
        fixtureProviderId: 'fixture-provider-b',
      },
    ],
    metricProfile: {
      profileId: 'default-fixture-profile',
      enabledGroups: ['quality', 'safety', 'cost', 'latency', 'stability'],
    },
    winnerPolicy: {
      policyId: 'default-fixture-policy',
      weights: { quality: 0.4, safety: 0.3, cost: 0.1, latency: 0.1, stability: 0.1 },
      safetyRegressionForcesNoWinner: true,
    },
    authorization: {
      mode: 'fixture',
    },
    createdAt: new Date().toISOString(),
  }
}

// ── Report 序列化 ─────────────────────────────────────────────

/**
 * 构建 report 的 JSON summary（红acted，不含敏感字段）。
 */
export function buildCompilerAbReportSummary(report: CompilerAbReport): Record<string, unknown> {
  return {
    contractVersion: report.contractVersion,
    experimentId: report.experimentId,
    createdAt: report.createdAt,
    isFixture: report.isFixture,
    evidenceEligible: report.evidenceEligible,
    winnerResult: report.winnerDecision.result,
    winnerReasonCode: report.winnerDecision.reasonCode,
    goNoGoResult: report.goNoGoDecision.result,
    goNoGoReasonCode: report.goNoGoDecision.reasonCode,
    variantCount: report.variantMetrics.length,
    compositeScores: report.variantMetrics.map((m) => ({
      variantId: m.variantId,
      compositeScore: m.compositeScore,
    })),
    followUpActions: report.goNoGoDecision.followUpActions,
  }
}
