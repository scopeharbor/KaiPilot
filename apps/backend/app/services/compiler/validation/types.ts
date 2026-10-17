/**
 * @aiproj/backend —— Validation Module 核心类型。
 *
 * 定义 ValidationInputContext、V-Gate profile 类型等纯数据接口。
 * 遵循 AdonisJS Service 层规范，不依赖 Controller/HTTP/request 对象。
 */

// ── ValidationInputContext ──

/**
 * 验证输入上下文——封装 PDM snapshot、stage context、deterministic outputs、policy profile。
 */
export interface ValidationInputContext {
  /** PDM snapshot ID。 */
  pdmSnapshotId?: string
  /** PDM snapshot（原始对象）。 */
  pdmSnapshot?: unknown
  /** Stage ID。 */
  stageId: string
  /** Stage 名称。 */
  stageName?: string
  /** Deterministic 引擎输出（按需传递）。 */
  deterministicOutputs?: {
    graphValidation?: unknown
    schedule?: unknown
    criticalPath?: unknown
    resourceLoad?: unknown
    diff?: unknown
  }
  /** Policy profile ID。 */
  profileId?: string
  /** 组织 ID。 */
  organizationId?: string
  /** Run ID。 */
  runId?: string
  /** 是否为增量校验。 */
  isIncremental?: boolean
  /** 增量校验时的变更路径。 */
  changedPaths?: string[]
  /** 增量校验时的变更实体 ID。 */
  changedEntityIds?: string[]
}

// ── V-Gate Profile ──

/**
 * V-Gate 关卡 profile（运行时配置）。
 */
export interface VGateProfile {
  /** Profile ID。 */
  profileId: string
  /** Profile 名称。 */
  name: string
  /** 包含的 Soft Evaluator 维度 ID 列表。 */
  softDimensionIds: string[]
  /** 各维度权重覆盖。 */
  weightOverrides?: Record<string, number>
  /** 各维度阈值覆盖。 */
  thresholdOverrides?: Record<string, number>
  /** 软评估预算（token 数）。 */
  softBudgetTokens?: number
  /** 软评估预算（调用次数）。 */
  softBudgetCalls?: number
  /** 单维度最大重试次数。 */
  maxRetriesPerDimension?: number
  /** Hard warning 阈值（超过此数需人工确认）。 */
  hardWarningThreshold?: number
  /** 是否默认启用软评估。 */
  softEnabledByDefault?: boolean
}
