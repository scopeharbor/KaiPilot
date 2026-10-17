/**
 * ai-online-shadow-and-ab —— 影子与 A/B 实验共享契约（V3）。
 *
 * 泛化 compiler/ab-compilation 对比框架：
 * - 影子模式：同一次真实请求额外跑一次候选配置，候选结果只落账不返回用户。
 * - A/B 模式：按确定性分流把流量分给两条配置，两条结果都是真的。
 * - 对比维度复用既有账本与评分：质量评分、成本、延迟、失败率、降级率。
 *
 * 零运行时依赖，纯 TypeScript 类型。
 * @aiproj/types 零依赖约束：不导入 zod / adonisjs。
 */

// ── 契约版本 ───────────────────────────────────────────────────

export const SHADOW_AB_CONTRACT_VERSION = '1.0' as const

// ── 实验模式 ──────────────────────────────────────────────────

export const SHADOW_AB_MODES = ['shadow', 'ab'] as const
export type ShadowAbMode = (typeof SHADOW_AB_MODES)[number]

/**
 * 判断字符串是否为合法实验模式。
 */
export function isShadowAbMode(value: string): value is ShadowAbMode {
  return (SHADOW_AB_MODES as readonly string[]).includes(value)
}

// ── 结束条件 ──────────────────────────────────────────────────

export interface ShadowAbTimeEndCondition {
  kind: 'time'
  /** ISO 8601 结束时间。 */
  endsAt: string
}

export interface ShadowAbSampleEndCondition {
  kind: 'sample_count'
  /** 达到此样本量后结束。 */
  targetCount: number
}

export type ShadowAbEndCondition = ShadowAbTimeEndCondition | ShadowAbSampleEndCondition

/**
 * 判断结束条件是否合法（非空且值合理）。
 */
export function isValidEndCondition(condition: ShadowAbEndCondition): boolean {
  if (condition.kind === 'time') {
    return !!condition.endsAt && new Date(condition.endsAt).getTime() > Date.now()
  }
  if (condition.kind === 'sample_count') {
    return condition.targetCount > 0
  }
  return false
}

// ── 实验配置 ──────────────────────────────────────────────────

export interface ShadowAbVariant {
  /** Variant 唯一 ID（在 experiment 内唯一）。 */
  variantId: string
  /** 人类可读名称。 */
  label: string
  /** 模型 profile ref（provider + model 标识）。 */
  modelProfileRef?: string
  /** Prompt 版本 ref。 */
  promptVersionRef?: string
  /** Feature flags。 */
  featureFlags?: string[]
}

export interface ShadowAbExperimentConfig {
  /** 契约版本。 */
  contractVersion: typeof SHADOW_AB_CONTRACT_VERSION
  /** 实验唯一 ID。 */
  experimentId: string
  /** 组织 ID。 */
  organizationId: number
  /** 创建者用户 ID。 */
  actorId: number
  /** 实验目标（低敏描述）。 */
  objective: string
  /** 实验模式：shadow 或 ab。创建时固定，不可中途切换。 */
  mode: ShadowAbMode
  /** 结束条件：时间或样本量。必须声明。 */
  endCondition: ShadowAbEndCondition
  /** Variant 数组（至少 2 个，最多 2 个）。 */
  variants: ShadowAbVariant[]
  /** 影子采样率（仅 shadow 模式），0~1，默认 0.1。 */
  shadowSamplingRate?: number
  /** 影子成本配额上限（USD），超出时停止影子而非停止生产。 */
  shadowBudgetCapUsd?: number
  /** 创建时间。 */
  createdAt: string
  /** 实验是否已结束。 */
  concluded: boolean
}

// ── 分流记录 ──────────────────────────────────────────────────

export interface ShadowAbAssignment {
  /** 实验 ID。 */
  experimentId: string
  /** 用户 ID（用于确定性哈希）。 */
  userId: number
  /** 分配到的 variant ID。 */
  assignedVariantId: string
  /** 分流哈希值（可审计）。 */
  assignmentHash: string
  /** 创建时间。 */
  createdAt: string
}

// ── 对比记录 ──────────────────────────────────────────────────

export interface ShadowAbComparisonDimension {
  /** 维度名称（quality / cost / latency / failure_rate / degradation_rate）。 */
  dimension: string
  /** 控制组（baseline）均值。 */
  controlMean: number
  /** 实验组均值。 */
  treatmentMean: number
  /** 差异（treatment - control）。 */
  diff: number
  /** 差异百分比。 */
  diffPercent: number
  /** 置信区间下界。 */
  ciLower: number
  /** 置信区间上界。 */
  ciUpper: number
  /** 样本量。 */
  sampleCount: number
  /** 是否样本不足。 */
  insufficientSamples: boolean
}

export interface ShadowAbComparisonRecord {
  /** 对比记录唯一 ID。 */
  recordId: string
  /** 实验 ID。 */
  experimentId: string
  /** 组织 ID。 */
  organizationId: number
  /** 控制组 variant ID。 */
  controlVariantId: string
  /** 实验组 variant ID。 */
  treatmentVariantId: string
  /** 五维对比结果。 */
  dimensions: ShadowAbComparisonDimension[]
  /** 整体结论（GO / NO_GO / INCONCLUSIVE / INSUFFICIENT）。 */
  conclusion: ShadowAbConclusion
  /** 结论原因。 */
  reasonSummary: string
  /** 创建时间。 */
  createdAt: string
  /** 对比数据快照哈希（确定性校验）。 */
  snapshotHash: string
}

export const SHADOW_AB_CONCLUSIONS = ['GO', 'NO_GO', 'INCONCLUSIVE', 'INSUFFICIENT'] as const
export type ShadowAbConclusion = (typeof SHADOW_AB_CONCLUSIONS)[number]

/**
 * 判断字符串是否为合法结论。
 */
export function isShadowAbConclusion(value: string): value is ShadowAbConclusion {
  return (SHADOW_AB_CONCLUSIONS as readonly string[]).includes(value)
}

// ── 实验状态 ──────────────────────────────────────────────────

export const SHADOW_AB_EXPERIMENT_STATUSES = ['running', 'concluded', 'cancelled'] as const
export type ShadowAbExperimentStatus = (typeof SHADOW_AB_EXPERIMENT_STATUSES)[number]

export interface ShadowAbExperimentRecord {
  /** 实验配置（快照）。 */
  config: ShadowAbExperimentConfig
  /** 当前状态。 */
  status: ShadowAbExperimentStatus
  /** 已收集样本数。 */
  collectedSamples: number
  /** 结束时间（ISO 8601）。 */
  concludedAt?: string
  /** 影子累计成本（USD）。 */
  shadowCostUsd: number
  /** 影子累计调用次数。 */
  shadowInvocationCount: number
}

// ── 禁存约束 ──────────────────────────────────────────────────

/**
 * 对比记录中禁止出现的字段（只含配置标识、评分、成本、延迟与计数）。
 * 复用 Compiler A/B 的 forbidden fields 并扩展。
 */
export const SHADOW_AB_FORBIDDEN_FIELDS = [
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

/**
 * 检查对象是否包含禁存字段。
 */
export function shadowAbContainsForbiddenFields(obj: Record<string, unknown>): boolean {
  const json = JSON.stringify(obj).toLowerCase()
  return (SHADOW_AB_FORBIDDEN_FIELDS as readonly string[]).some((field) =>
    json.includes(field.toLowerCase()),
  )
}

// ── Fixtures ──────────────────────────────────────────────────

/**
 * 创建默认影子实验 fixture。
 */
export function createShadowExperimentFixture(
  experimentId: string,
  organizationId: number,
  actorId: number,
): ShadowAbExperimentConfig {
  return {
    contractVersion: SHADOW_AB_CONTRACT_VERSION,
    experimentId,
    organizationId,
    actorId,
    objective: 'Fixture shadow experiment for testing',
    mode: 'shadow',
    endCondition: { kind: 'sample_count', targetCount: 100 },
    variants: [
      {
        variantId: 'control',
        label: 'Production baseline',
        modelProfileRef: 'fixture-model-a',
      },
      {
        variantId: 'treatment',
        label: 'Candidate model',
        modelProfileRef: 'fixture-model-b',
      },
    ],
    shadowSamplingRate: 0.1,
    shadowBudgetCapUsd: 10,
    createdAt: new Date().toISOString(),
    concluded: false,
  }
}

/**
 * 创建默认 A/B 实验 fixture。
 */
export function createAbExperimentFixture(
  experimentId: string,
  organizationId: number,
  actorId: number,
): ShadowAbExperimentConfig {
  return {
    contractVersion: SHADOW_AB_CONTRACT_VERSION,
    experimentId,
    organizationId,
    actorId,
    objective: 'Fixture A/B experiment for testing',
    mode: 'ab',
    endCondition: { kind: 'sample_count', targetCount: 200 },
    variants: [
      {
        variantId: 'control',
        label: 'Production baseline',
        modelProfileRef: 'fixture-model-a',
      },
      {
        variantId: 'treatment',
        label: 'Candidate model',
        modelProfileRef: 'fixture-model-b',
      },
    ],
    createdAt: new Date().toISOString(),
    concluded: false,
  }
}

/**
 * 创建影子失败状态 fixture。
 */
export function createShadowFailureFixture(
  experimentId: string,
  organizationId: number,
  actorId: number,
): ShadowAbExperimentRecord {
  return {
    config: createShadowExperimentFixture(experimentId, organizationId, actorId),
    status: 'running',
    collectedSamples: 50,
    shadowCostUsd: 2.5,
    shadowInvocationCount: 50,
  }
}

/**
 * 创建样本不足 fixture。
 */
export function createInsufficientSamplesFixture(
  experimentId: string,
  organizationId: number,
): ShadowAbComparisonRecord {
  return {
    recordId: `cmp-${experimentId}-insufficient`,
    experimentId,
    organizationId,
    controlVariantId: 'control',
    treatmentVariantId: 'treatment',
    dimensions: [
      {
        dimension: 'quality',
        controlMean: 0.85,
        treatmentMean: 0.9,
        diff: 0.05,
        diffPercent: 5.88,
        ciLower: -0.1,
        ciUpper: 0.2,
        sampleCount: 5,
        insufficientSamples: true,
      },
    ],
    conclusion: 'INSUFFICIENT',
    reasonSummary: 'Sample size too small for reliable comparison',
    createdAt: new Date().toISOString(),
    snapshotHash: 'fixture-hash-insufficient',
  }
}

/**
 * 创建实验已结束 fixture。
 */
export function createConcludedExperimentFixture(
  experimentId: string,
  organizationId: number,
  actorId: number,
): ShadowAbExperimentRecord {
  return {
    config: {
      ...createShadowExperimentFixture(experimentId, organizationId, actorId),
      concluded: true,
    },
    status: 'concluded',
    collectedSamples: 100,
    concludedAt: new Date().toISOString(),
    shadowCostUsd: 5.0,
    shadowInvocationCount: 100,
  }
}

// ── 验证函数 ──────────────────────────────────────────────────

/**
 * 验证实验配置是否合法。
 */
export function validateShadowAbConfig(
  config: ShadowAbExperimentConfig,
): { valid: true } | { valid: false; reasonCode: string; violations: string[] } {
  const violations: string[] = []

  // 模式合法
  if (!isShadowAbMode(config.mode)) {
    violations.push(`unsupported mode: ${config.mode}`)
  }

  // 必须有结束条件
  if (!config.endCondition) {
    violations.push('end condition is required')
  } else if (!isValidEndCondition(config.endCondition)) {
    violations.push('end condition is invalid')
  }

  // variant 数量 = 2
  if (config.variants.length < 2) {
    violations.push('experiment must have at least 2 variants')
  }
  if (config.variants.length > 2) {
    violations.push('experiment must not exceed 2 variants (multi-arm not supported)')
  }

  // 重复 variant ID
  const ids = config.variants.map((v) => v.variantId)
  if (new Set(ids).size !== ids.length) {
    violations.push('duplicate variant ids detected')
  }

  // 影子采样率范围
  if (
    config.shadowSamplingRate !== undefined &&
    (config.shadowSamplingRate < 0 || config.shadowSamplingRate > 1)
  ) {
    violations.push('shadow sampling rate must be between 0 and 1')
  }

  if (violations.length > 0) {
    return { valid: false, reasonCode: 'SHADOW_AB_CONFIG_INVALID', violations }
  }

  return { valid: true }
}
