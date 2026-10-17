/**
 * V3 Observability Data Retention — 共享契约与确定性纯函数引擎
 *
 * 定义所有 AI 观察数据的统一保留治理：
 * - 数据类别分档（安全事件档期长于一般观察数据）
 * - 保留策略解析（系统默认 → 组织覆盖 → 项目覆盖）
 * - 过期前聚合固化（明细删除前先固化聚合）
 * - 硬删除（不做软标记）
 * - 清理作业状态与可见性
 * - 组织注销级联清理
 * - 导出（组织隔离 + 审计）
 *
 * 设计决策：
 * D1 — 分档保留，安全事件档期长于一般观察数据
 * D2 — 过期前先落聚合再删明细
 * D3 — 组织可缩短不可延长超上限
 * D4 — 到期为硬删除
 * D5 — 清理作业失败必须可见
 * D6 — 组织注销时级联清理
 * D7 — 不做「按内容判断是否保留」
 * D8 — 导出只导出该组织自己的数据，且导出本身要审计
 *
 * 此文件为 Section 2（Shared Contracts）的主产出物。
 */

// ─── 枚举 ────────────────────────────────────────────────────────────────

/**
 * 观察数据类别 — 所有 AI 观察记录的统一分类。
 * 安全事件档期长于一般观察数据。
 */
export const OBSERVABILITY_DATA_CLASSES = [
  // 一般观察数据（较短保留期）
  'trace_spans', // 请求追踪跨度
  'invocation_ledger', // 统一调用账本
  'feedback_events', // 反馈事件
  'quality_ledger', // 输出质量账本
  'budget_decisions', // 预算决策
  'rate_limit_decisions', // 限流决策
  'routing_ledger', // 路由决策账本
  'context_retrieval', // 上下文与检索观测
  'drift_signals', // 模型漂移信号
  'frontend_telemetry', // 前端埋点
  'evaluation_runs', // 评测运行记录
  'compilation_observability', // 编译器观察
  'prompt_registry', // Prompt 版本注册
  'usage_aggregation', // 用量聚合
  // 较高敏感度（较长保留期）
  'ocr_provider_observability', // OCR 供应商观察
  'sso_oidc_observability', // SSO OIDC 观察
  'scim_observability', // SCIM 观察
  'copilot_citation', // Copilot 引用
  // 安全事件（最长保留期）
  'security_events', // 安全事件（探测/越权/异常模式）
] as const
export type ObservabilityDataClass = (typeof OBSERVABILITY_DATA_CLASSES)[number]

/** 安全事件类别集合（用于档期判定） */
export const SECURITY_DATA_CLASSES: readonly ObservabilityDataClass[] = ['security_events']

/** 保留档期 — 三档：一般 / 敏感 / 安全事件 */
export const RETENTION_TIERS = ['general', 'sensitive', 'security'] as const
export type RetentionTier = (typeof RETENTION_TIERS)[number]

/** 策略来源层级 */
export const OBSERVABILITY_RETENTION_POLICY_SOURCES = ['system', 'organization'] as const
export type ObservabilityRetentionPolicySource =
  (typeof OBSERVABILITY_RETENTION_POLICY_SOURCES)[number]

/** 清理作业状态 */
export const OBSERVABILITY_CLEANUP_JOB_STATUSES = [
  'idle',
  'running',
  'completed',
  'failed',
] as const
export type ObservabilityCleanupJobStatus = (typeof OBSERVABILITY_CLEANUP_JOB_STATUSES)[number]

/** 清理执行记录状态 */
export const OBSERVABILITY_CLEANUP_RUN_STATUSES = [
  'previewed',
  'completed',
  'failed',
  'partial',
] as const
export type ObservabilityCleanupRunStatus = (typeof OBSERVABILITY_CLEANUP_RUN_STATUSES)[number]

/** 导出动作审计动作 */
export const OBSERVABILITY_EXPORT_AUDIT_ACTIONS = [
  'OBSERVABILITY_EXPORT_PRODUCED',
  'OBSERVABILITY_EXPORT_FAILED',
  'OBSERVABILITY_EXPORT_PERMISSION_DENIED',
] as const
export type ObservabilityExportAuditAction = (typeof OBSERVABILITY_EXPORT_AUDIT_ACTIONS)[number]

// ─── 数据类别 → 档期映射 ──────────────────────────────────────────────────

/** 系统声明的每个数据类别的档期 */
export const DATA_CLASS_TIER_MAP: Record<ObservabilityDataClass, RetentionTier> = {
  // 一般观察数据
  trace_spans: 'general',
  invocation_ledger: 'general',
  feedback_events: 'general',
  quality_ledger: 'general',
  budget_decisions: 'general',
  rate_limit_decisions: 'general',
  routing_ledger: 'general',
  context_retrieval: 'general',
  drift_signals: 'general',
  frontend_telemetry: 'general',
  evaluation_runs: 'general',
  compilation_observability: 'general',
  prompt_registry: 'general',
  usage_aggregation: 'general',
  // 较高敏感度
  ocr_provider_observability: 'sensitive',
  sso_oidc_observability: 'sensitive',
  scim_observability: 'sensitive',
  copilot_citation: 'sensitive',
  // 安全事件
  security_events: 'security',
}

// ─── 系统默认保留天数（按档期） ────────────────────────────────────────────

/**
 * 系统不可变边界（天数）。
 * 一般观察数据：最长 90 天
 * 敏感数据：最长 365 天
 * 安全事件：最长 730 天
 */
export const OBSERVABILITY_RETENTION_TIER_BOUNDS: Record<
  RetentionTier,
  { minDays: number; maxDays: number }
> = {
  general: { minDays: 1, maxDays: 90 },
  sensitive: { minDays: 1, maxDays: 365 },
  security: { minDays: 1, maxDays: 730 },
}

/** 系统默认保留天数（按档期） */
export const OBSERVABILITY_RETENTION_DEFAULT_DAYS: Record<RetentionTier, number> = {
  general: 30,
  sensitive: 90,
  security: 365,
}

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 保留策略分类配置 */
export interface ObservabilityRetentionCategoryPolicy {
  dataClass: ObservabilityDataClass
  tier: RetentionTier
  retentionDays: number
}

/** 解析后的保留策略（确定性） */
export interface ObservabilityRetentionPolicy {
  source: ObservabilityRetentionPolicySource
  organizationId: number
  categories: ObservabilityRetentionCategoryPolicy[]
  bounds: typeof OBSERVABILITY_RETENTION_TIER_BOUNDS
  policyHash: string
}

/** 策略持久化行（组织覆盖） */
export interface ObservabilityRetentionPolicyRow {
  id: number
  organizationId: number
  categories: ObservabilityRetentionCategoryPolicy[]
  policyHash: string
  updatedBy: number | null
  updatedAt: string | null
  createdAt: string | null
}

/** 策略更新请求（只允许缩短，不允许延长超上限） */
export interface ObservabilityRetentionPolicyUpdateRequest {
  categories: Array<{
    dataClass: ObservabilityDataClass
    retentionDays: number
  }>
}

/** 聚合固化记录 */
export interface ObservabilityAggregateRecord {
  id: number
  organizationId: number
  dataClass: ObservabilityDataClass
  tier: RetentionTier
  periodStart: string // ISO 月份起始
  periodEnd: string // ISO 月份结束
  recordCount: number
  aggregateHash: string // 确定性哈希
  prohibitedFields: string[] // 已排除的禁存字段列表
  materializedAt: string
  createdAt: string
}

/** 清理作业状态记录 */
export interface ObservabilityCleanupJobRecord {
  jobId: number
  organizationId: number
  dataClass: ObservabilityDataClass
  status: ObservabilityCleanupJobStatus
  lastRunAt: string | null
  lastRunDurationMs: number | null
  recordsProcessedTotal: number
  recordsFailedTotal: number
  consecutiveFailures: number
  lastFailureReason: string | null
  createdAt: string
  updatedAt: string
}

/** 清理执行记录 */
export interface ObservabilityCleanupRunRecord {
  runId: number
  organizationId: number
  jobId: number
  dataClass: ObservabilityDataClass
  runKey: string
  status: ObservabilityCleanupRunStatus
  recordsEligible: number
  recordsDeleted: number
  recordsFailed: number
  aggregatesCreated: number
  aggregateFailed: boolean
  failureReason: string | null
  startedAt: string
  completedAt: string | null
  createdAt: string
}

/** 导出记录 */
export interface ObservabilityExportRecord {
  exportId: number
  organizationId: number
  requestedBy: number
  dataClasses: ObservabilityDataClass[]
  recordCount: number
  exportFormat: 'json' | 'csv'
  exportHash: string
  exportedAt: string
  createdAt: string
}

// ─── 类型守卫 ──────────────────────────────────────────────────────────────

export function isObservabilityDataClass(value: unknown): value is ObservabilityDataClass {
  return (
    typeof value === 'string' && (OBSERVABILITY_DATA_CLASSES as readonly string[]).includes(value)
  )
}

export function isRetentionTier(value: unknown): value is RetentionTier {
  return typeof value === 'string' && (RETENTION_TIERS as readonly string[]).includes(value)
}

export function isObservabilityCleanupJobStatus(
  value: unknown,
): value is ObservabilityCleanupJobStatus {
  return (
    typeof value === 'string' &&
    (OBSERVABILITY_CLEANUP_JOB_STATUSES as readonly string[]).includes(value)
  )
}

export function isObservabilityCleanupRunStatus(
  value: unknown,
): value is ObservabilityCleanupRunStatus {
  return (
    typeof value === 'string' &&
    (OBSERVABILITY_CLEANUP_RUN_STATUSES as readonly string[]).includes(value)
  )
}

// ─── 纯函数：FNV-1a 哈希（与 ocr-result-retention 同一约定） ──────────────

function fnv1aHash(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    hash >>>= 0
  }
  return hash
}

function toHex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}

// ─── 纯函数：哈希 ──────────────────────────────────────────────────────────

/** 策略哈希：只取决于组织与分类配置，不含时间戳与操作人 */
export function computeObservabilityRetentionPolicyHash(params: {
  organizationId: number
  categories: ObservabilityRetentionCategoryPolicy[]
}): string {
  const sorted = [...params.categories].sort((a, b) => a.dataClass.localeCompare(b.dataClass))
  const body = sorted.map((c) => `${c.dataClass}:${c.retentionDays}`).join('|')
  return toHex8(fnv1aHash(`${params.organizationId}|${body}`))
}

/** 聚合哈希：确定性，同一输入产出同一输出 */
export function computeAggregateHash(params: {
  organizationId: number
  dataClass: ObservabilityDataClass
  periodStart: string
  periodEnd: string
  recordCount: number
}): string {
  return toHex8(
    fnv1aHash(
      `${params.organizationId}|${params.dataClass}|${params.periodStart}|${params.periodEnd}|${params.recordCount}`,
    ),
  )
}

/** 清理运行幂等键 */
export function computeCleanupRunKey(params: {
  organizationId: number
  dataClass: ObservabilityDataClass
  nowIso: string
}): string {
  // 按天粒度的幂等键：同一天对同一组织同一类别只执行一次
  const date = params.nowIso.slice(0, 10)
  return `obs-retention:${params.organizationId}:${params.dataClass}:${date}`
}

// ─── 纯函数：策略解析 ──────────────────────────────────────────────────────

/** 获取数据类别的系统默认保留天数 */
export function getDefaultRetentionDays(dataClass: ObservabilityDataClass): number {
  const tier = DATA_CLASS_TIER_MAP[dataClass]
  return OBSERVABILITY_RETENTION_DEFAULT_DAYS[tier]
}

/** 获取数据类别的档期 */
export function getTierForDataClass(dataClass: ObservabilityDataClass): RetentionTier {
  return DATA_CLASS_TIER_MAP[dataClass]
}

/** 获取档期的声明上限天数 */
export function getMaxRetentionDays(tier: RetentionTier): number {
  return OBSERVABILITY_RETENTION_TIER_BOUNDS[tier].maxDays
}

/** 获取档期的最小保留天数 */
export function getMinRetentionDays(tier: RetentionTier): number {
  return OBSERVABILITY_RETENTION_TIER_BOUNDS[tier].minDays
}

/** 判断是否为安全事件类别 */
export function isSecurityDataClass(dataClass: ObservabilityDataClass): boolean {
  return (SECURITY_DATA_CLASSES as readonly ObservabilityDataClass[]).includes(dataClass)
}

/**
 * 生成系统默认策略（确定性顺序 = 枚举顺序）
 */
export function buildObservabilityDefaultCategoryPolicies(): ObservabilityRetentionCategoryPolicy[] {
  return OBSERVABILITY_DATA_CLASSES.map((dataClass) => ({
    dataClass,
    tier: DATA_CLASS_TIER_MAP[dataClass],
    retentionDays: OBSERVABILITY_RETENTION_DEFAULT_DAYS[DATA_CLASS_TIER_MAP[dataClass]],
  }))
}

/**
 * 解析系统默认策略
 */
export function resolveObservabilityDefaultRetentionPolicy(params: {
  organizationId: number
}): ObservabilityRetentionPolicy {
  const categories = buildObservabilityDefaultCategoryPolicies()
  return {
    source: 'system',
    organizationId: params.organizationId,
    categories,
    bounds: OBSERVABILITY_RETENTION_TIER_BOUNDS,
    policyHash: computeObservabilityRetentionPolicyHash({
      organizationId: params.organizationId,
      categories,
    }),
  }
}

/**
 * 合并组织覆盖到基础策略：
 * - override 只覆盖其显式给出的分类
 * - 其余分类沿用基础策略
 * - 系统边界不可变（不允许延长超上限）
 * - 只允许缩短，不允许延长超上限
 */
export function mergeObservabilityRetentionPolicy(
  base: ObservabilityRetentionCategoryPolicy[],
  override: Array<{
    dataClass: ObservabilityDataClass
    retentionDays: number
  }>,
): {
  categories: ObservabilityRetentionCategoryPolicy[]
  rejected: Array<{ dataClass: ObservabilityDataClass; reason: 'exceeds_maximum' }>
} {
  const overrideMap = new Map(override.map((o) => [o.dataClass, o]))
  const rejected: Array<{ dataClass: ObservabilityDataClass; reason: 'exceeds_maximum' }> = []
  const categories: ObservabilityRetentionCategoryPolicy[] = []

  for (const dataClass of OBSERVABILITY_DATA_CLASSES) {
    const o = overrideMap.get(dataClass)
    const tier = DATA_CLASS_TIER_MAP[dataClass]
    const maxDays = OBSERVABILITY_RETENTION_TIER_BOUNDS[tier].maxDays

    if (o) {
      // D3：只允许缩短，不允许延长超上限
      if (o.retentionDays > maxDays) {
        rejected.push({ dataClass, reason: 'exceeds_maximum' })
        // 保留原值
        const b = base.find((x) => x.dataClass === dataClass)
        categories.push(
          b ?? {
            dataClass,
            tier,
            retentionDays: OBSERVABILITY_RETENTION_DEFAULT_DAYS[tier],
          },
        )
      } else {
        categories.push({
          dataClass,
          tier,
          retentionDays: o.retentionDays,
        })
      }
    } else {
      const b = base.find((x) => x.dataClass === dataClass)
      categories.push(
        b ?? {
          dataClass,
          tier,
          retentionDays: OBSERVABILITY_RETENTION_DEFAULT_DAYS[tier],
        },
      )
    }
  }

  return { categories, rejected }
}

/**
 * 校验策略更新请求：确保不超出系统边界
 */
export function validatePolicyUpdateRequest(
  request: ObservabilityRetentionPolicyUpdateRequest,
): Array<{ dataClass: string; reason: 'out_of_bounds' | 'unknown_class' | 'exceeds_maximum' }> {
  const errors: Array<{
    dataClass: string
    reason: 'out_of_bounds' | 'unknown_class' | 'exceeds_maximum'
  }> = []
  const seen = new Set<string>()

  for (const cat of request.categories) {
    if (!isObservabilityDataClass(cat.dataClass)) {
      errors.push({ dataClass: String(cat.dataClass), reason: 'unknown_class' })
      continue
    }
    if (seen.has(cat.dataClass)) {
      errors.push({ dataClass: cat.dataClass, reason: 'out_of_bounds' })
      continue
    }
    seen.add(cat.dataClass)

    const tier = DATA_CLASS_TIER_MAP[cat.dataClass]
    const bounds = OBSERVABILITY_RETENTION_TIER_BOUNDS[tier]

    if (!Number.isInteger(cat.retentionDays) || cat.retentionDays < bounds.minDays) {
      errors.push({ dataClass: cat.dataClass, reason: 'out_of_bounds' })
    }
    if (cat.retentionDays > bounds.maxDays) {
      errors.push({ dataClass: cat.dataClass, reason: 'exceeds_maximum' })
    }
  }

  return errors
}

/**
 * 按数据类别取保留天数
 */
export function retentionDaysForDataClass(
  policy: ObservabilityRetentionPolicy,
  dataClass: ObservabilityDataClass,
): number {
  const found = policy.categories.find((c) => c.dataClass === dataClass)
  return found?.retentionDays ?? getDefaultRetentionDays(dataClass)
}

/** 计算保留截止时间（ISO 字符串） */
export function computeObservabilityRetentionDeadlineIso(
  baseIso: string,
  retentionDays: number,
): string {
  const base = new Date(baseIso)
  const ms = base.getTime() + retentionDays * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString()
}

/** 记录是否已到保留截止时间 */
export function isObservabilityRetentionDeadlineReached(params: {
  baseIso: string
  retentionDays: number
  nowIso: string
}): boolean {
  return (
    new Date(params.nowIso).getTime() >=
    new Date(
      computeObservabilityRetentionDeadlineIso(params.baseIso, params.retentionDays),
    ).getTime()
  )
}

// ─── 纯函数：聚合固化判定 ──────────────────────────────────────────────────

/**
 * 判断明细记录是否应在聚合后删除。
 * D2：过期前先落聚合再删明细。
 */
export function isEligibleForCleanup(params: {
  recordCreatedAt: string
  retentionDays: number
  nowIso: string
  aggregateMaterialized: boolean
}): boolean {
  if (!params.aggregateMaterialized) return false
  return isObservabilityRetentionDeadlineReached({
    baseIso: params.recordCreatedAt,
    retentionDays: params.retentionDays,
    nowIso: params.nowIso,
  })
}

/**
 * 确定性聚合：同一明细快照产出同一聚合。
 * 禁存字段排除（D7）。
 */
export function computeAggregateSummary(params: {
  organizationId: number
  dataClass: ObservabilityDataClass
  periodStart: string
  periodEnd: string
  records: Array<{ id: number; createdAt: string }>
}): {
  recordCount: number
  aggregateHash: string
  prohibitedFields: string[]
} {
  const sortedRecords = [...params.records].sort((a, b) => a.id - b.id)
  const recordCount = sortedRecords.length
  const aggregateHash = computeAggregateHash({
    organizationId: params.organizationId,
    dataClass: params.dataClass,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    recordCount,
  })

  // D7：聚合不含任何禁存字段
  const prohibitedFields = [
    'prompt',
    'modelOutput',
    'token',
    'secret',
    'password',
    'apiKey',
    'rawBody',
    'extractedText',
    'fileContent',
  ]

  return { recordCount, aggregateHash, prohibitedFields }
}

// ─── 纯函数：保留天数变更合法性 ────────────────────────────────────────────

/**
 * 判断保留期变更是否合法。
 * - 缩短：合法
 * - 延长但不超过档期上限：合法
 * - 延长超过档期上限：非法
 */
export function isRetentionChangeValid(params: {
  dataClass: ObservabilityDataClass
  currentDays: number
  newDays: number
}): { valid: boolean; reason?: 'exceeds_maximum' | 'out_of_bounds' } {
  const tier = DATA_CLASS_TIER_MAP[params.dataClass]
  const bounds = OBSERVABILITY_RETENTION_TIER_BOUNDS[tier]

  if (params.newDays < bounds.minDays) {
    return { valid: false, reason: 'out_of_bounds' }
  }
  if (params.newDays > bounds.maxDays) {
    return { valid: false, reason: 'exceeds_maximum' }
  }
  return { valid: true }
}
