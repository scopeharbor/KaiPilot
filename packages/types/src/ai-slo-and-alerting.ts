/**
 * v3-ai-slo-and-alerting —— AI 层 SLO 指标、双档阈值、runbook 关联、
 * 去重抑制与「不自动处置」的共享契约。
 *
 * 核心设计：
 * - 五指标：TTFT / 失败率 / 降级率 / budget burn / 延迟违约率
 * - 双档阈值（warning + critical），不设第三档（D3）
 * - 无 runbook 的指标不得成为告警项（D2 硬约束）
 * - 告警只提示不自动处置（D4：不切模型/不降级/不限流/不回滚）
 * - 去重按 (组织, 指标, 档位) 抑制，档位升级产生新通知（D5）
 * - 恢复时发一条恢复通知（D5）
 * - budget burn 表达为「按当前速率预计耗尽时间」（D7）
 * - 无样本标注为「无数据」而非达标（D8）
 * - 评估确定性：同一数据快照产出同一评估结果（D6）
 * - 组织可下调阈值使其更敏感，不得上调超过声明上限（D6）
 * - 告警记录不含 prompt、模型输出、token 与 secret
 *
 * 命名纪律：AI_SLO / AiSlo / SLO_ 前缀，不与既有导出冲突。
 */

// ---------------------------------------------------------------------------
// §2.1-2.3 SLO 定义与告警记录的共享契约类型
// ---------------------------------------------------------------------------

/** 五个 AI SLO 指标。 */
export const AI_SLO_INDICATORS = [
  'ttft', // 首 token 延迟（Time to First Token）
  'failure_rate', // 失败率
  'degradation_rate', // 降级率
  'budget_burn', // 预算燃烧率
  'latency_violation', // 延迟违约率
] as const
export type AiSloIndicator = (typeof AI_SLO_INDICATORS)[number]

/** 判断是否为合法指标。 */
export function isAiSloIndicator(v: unknown): v is AiSloIndicator {
  return AI_SLO_INDICATORS.includes(v as AiSloIndicator)
}

/** 双档阈值级别（不设第三档）。 */
export const AI_SLO_SEVERITY_TIERS = ['warning', 'critical'] as const
export type AiSloSeverityTier = (typeof AI_SLO_SEVERITY_TIERS)[number]

/** 判断是否为合法档位。 */
export function isAiSloSeverityTier(v: unknown): v is AiSloSeverityTier {
  return AI_SLO_SEVERITY_TIERS.includes(v as AiSloSeverityTier)
}

/** 阈值比较运算符。 */
export const AI_SLO_OPERATORS = ['gt', 'gte', 'lt', 'lte'] as const
export type AiSloOperator = (typeof AI_SLO_OPERATORS)[number]

/** SLO 定义：一个指标 + 两档阈值 + runbook 引用。 */
export interface AiSloDefinition {
  /** 定义唯一标识。 */
  id: string
  /** 所属组织。 */
  organizationId: number
  /** 指标类型。 */
  indicator: AiSloIndicator
  /** warning 阈值。 */
  warning: AiSloThreshold
  /** critical 阈值。 */
  critical: AiSloThreshold
  /** 评估窗口（毫秒）。 */
  windowMs: number
  /** 关联的 runbook 引用。D2 硬约束：缺失时必须被拒。 */
  runbookRef: string
  /** 声明时的 UTC 时间戳。 */
  createdAt: string
  /** 最后更新的 UTC 时间戳。 */
  updatedAt: string
}

/** 单档阈值。 */
export interface AiSloThreshold {
  /** 比较运算符。 */
  operator: AiSloOperator
  /** 阈值数值。 */
  value: number
  /** 单位说明。 */
  unit: string
  /** 来源说明/基线引用。 */
  source: string
}

// ---------------------------------------------------------------------------
// §2.4 无 runbook 硬约束
// ---------------------------------------------------------------------------

/** 无 runbook 的 SLO 定义被拒时的错误信息。 */
export const AI_SLO_RUNBOOK_REQUIRED =
  'SLO 定义缺少 runbook 引用：无 runbook 的指标不得成为告警项（D2）' as const

/** 校验 SLO 定义的 runbook 硬约束。返回 null 表示通过，否则返回错误信息。 */
export function validateSloRunbook(def: Pick<AiSloDefinition, 'runbookRef'>): string | null {
  if (!def.runbookRef || def.runbookRef.trim().length === 0) {
    return AI_SLO_RUNBOOK_REQUIRED
  }
  return null
}

// ---------------------------------------------------------------------------
// §2.6 禁存约束
// ---------------------------------------------------------------------------

/** 告警记录被禁止存储的敏感字段标签（用于检测）。 */
export const AI_SLO_SENSITIVE_FIELD_TAGS = [
  'prompt',
  'model_output',
  'modelOutput',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'password',
] as const

/** 敏感样本标签。 */
export type AiSloSensitiveFieldTag = (typeof AI_SLO_SENSITIVE_FIELD_TAGS)[number]

/** 告警记录：只含指标名、档位、数值、时间与 runbook 引用。 */
export interface AiAlertRecord {
  /** 告警记录唯一标识。 */
  id: string
  /** 所属组织。 */
  organizationId: number
  /** 指标类型。 */
  indicator: AiSloIndicator
  /** 告警档位。 */
  tier: AiSloSeverityTier
  /** 实际指标值。 */
  actualValue: number
  /** 阈值数值。 */
  thresholdValue: number
  /** 告警触发时间（UTC）。 */
  triggeredAt: string
  /** 关联的 runbook 引用。 */
  runbookRef: string
  /** 是否为恢复通知。 */
  isRecovery: boolean
}

/** 校验告警记录是否不含敏感样本。返回 true 表示不含（通过）。 */
export function validateAlertRecordNoSensitiveContent(record: Record<string, unknown>): boolean {
  const json = JSON.stringify(record).toLowerCase()
  for (const tag of AI_SLO_SENSITIVE_FIELD_TAGS) {
    if (json.includes(tag.toLowerCase())) {
      // 检查是否为字段值而非字段名引用
      const tagLower = tag.toLowerCase()
      const idx = json.indexOf(tagLower)
      if (idx !== -1) {
        // 检查前后是否有冒号+引号（表示是值）
        const before = json.substring(Math.max(0, idx - 5), idx)
        const after = json.substring(idx + tagLower.length, idx + tagLower.length + 5)
        if (before.includes(':') || after.includes(':')) {
          return false
        }
      }
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// §3.1-3.7 指标评估
// ---------------------------------------------------------------------------

/** 指标评估结果状态。 */
export const AI_SLO_EVALUATION_OUTCOMES = [
  'healthy', // 达标
  'warning', // warning 档越界
  'critical', // critical 档越界
  'no_data', // 无样本（D8：不等于达标）
] as const
export type AiSloEvaluationOutcome = (typeof AI_SLO_EVALUATION_OUTCOMES)[number]

/** 判断是否为合法评估结果。 */
export function isAiSloEvaluationOutcome(v: unknown): v is AiSloEvaluationOutcome {
  return AI_SLO_EVALUATION_OUTCOMES.includes(v as AiSloEvaluationOutcome)
}

/** 单个指标的评估结果。 */
export interface AiSloEvaluationResult {
  /** 指标类型。 */
  indicator: AiSloIndicator
  /** 评估结果。 */
  outcome: AiSloEvaluationOutcome
  /** 实际指标值（无数据时为 null）。 */
  actualValue: number | null
  /** 越界的阈值（健康或无数据时为 null）。 */
  triggeredThreshold: AiSloThreshold | null
  /** 越界的档位（健康或无数据时为 null）。 */
  triggeredTier: AiSloSeverityTier | null
  /** 关联的 runbook 引用。 */
  runbookRef: string
  /** 评估时间（UTC）。 */
  evaluatedAt: string
}

/** Budget burn 结果：按当前速率预计耗尽时间。 */
export interface AiSloBudgetBurnResult {
  /** 预计耗尽时间（UTC），null 表示无法计算（如零消耗）。 */
  projectedExhaustionAt: string | null
  /** 当前消耗速率（每秒 cost）。 */
  currentBurnRate: number
  /** 窗口内剩余预算比例（0-1）。 */
  remainingRatio: number
  /** 剩余时间（毫秒），null 表示无法计算。 */
  remainingMs: number | null
}

/** 完整的 SLO 评估快照。 */
export interface AiSloEvaluationSnapshot {
  /** 组织 ID。 */
  organizationId: number
  /** 各指标的评估结果。 */
  results: AiSloEvaluationResult[]
  /** budget burn 详情。 */
  budgetBurn: AiSloBudgetBurnResult | null
  /** 评估时间（UTC）。 */
  evaluatedAt: string
  /** 评估窗口开始（UTC）。 */
  windowStart: string
  /** 评估窗口结束（UTC）。 */
  windowEnd: string
}

// ---------------------------------------------------------------------------
// §3.1 窗口聚合与阈值比较
// ---------------------------------------------------------------------------

/**
 * 对一个数值进行阈值比较。
 * 返回 true 表示「通过」（未越界），false 表示「越界」。
 *
 * 运算符语义：阈值是「上限」，越界 = 实际值超过阈值。
 */
export function compareAiSloThreshold(
  actual: number,
  operator: AiSloOperator,
  threshold: number,
): boolean {
  switch (operator) {
    case 'gt':
      return actual <= threshold
    case 'gte':
      return actual < threshold
    case 'lt':
      return actual >= threshold
    case 'lte':
      return actual > threshold
    default:
      return true
  }
}

/**
 * 判定一个指标的评估结果。
 * 无样本时返回 'no_data'（D8），不返回 'healthy'。
 */
export function evaluateAiSloIndicator(
  samples: number[],
  indicator: AiSloIndicator,
  def: AiSloDefinition,
): AiSloEvaluationResult {
  const now = new Date().toISOString()

  // D8：无样本 → no_data
  if (samples.length === 0) {
    return {
      indicator,
      outcome: 'no_data',
      actualValue: null,
      triggeredThreshold: null,
      triggeredTier: null,
      runbookRef: def.runbookRef,
      evaluatedAt: now,
    }
  }

  // 聚合：按指标类型计算统计量
  const aggregated = aggregateSamples(samples, indicator)

  // 先检查 critical，再检查 warning（critical 优先级更高）
  const criticalPass = compareAiSloThreshold(aggregated, def.critical.operator, def.critical.value)
  if (!criticalPass) {
    return {
      indicator,
      outcome: 'critical',
      actualValue: aggregated,
      triggeredThreshold: def.critical,
      triggeredTier: 'critical',
      runbookRef: def.runbookRef,
      evaluatedAt: now,
    }
  }

  const warningPass = compareAiSloThreshold(aggregated, def.warning.operator, def.warning.value)
  if (!warningPass) {
    return {
      indicator,
      outcome: 'warning',
      actualValue: aggregated,
      triggeredThreshold: def.warning,
      triggeredTier: 'warning',
      runbookRef: def.runbookRef,
      evaluatedAt: now,
    }
  }

  return {
    indicator,
    outcome: 'healthy',
    actualValue: aggregated,
    triggeredThreshold: null,
    triggeredTier: null,
    runbookRef: def.runbookRef,
    evaluatedAt: now,
  }
}

/**
 * 聚合样本值。
 * - TTFT / 延迟违约率：取 p95
 * - 失败率 / 降级率：取平均
 * - budget burn：由外部计算（此处不聚合）
 */
function aggregateSamples(samples: number[], indicator: AiSloIndicator): number {
  if (indicator === 'ttft' || indicator === 'latency_violation') {
    return percentile95(samples)
  }
  // failure_rate / degradation_rate：取平均
  return samples.reduce((sum, v) => sum + v, 0) / samples.length
}

/** 计算 p95 分位数。 */
function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil(sorted.length * 0.95) - 1
  return sorted[Math.max(0, idx)] as number
}

// ---------------------------------------------------------------------------
// §3.2 budget burn 预计耗尽时间
// ---------------------------------------------------------------------------

/**
 * 计算 budget burn：按当前速率预计耗尽时间。
 * D7：表达为「预计耗尽时间」而非「已用百分比」。
 *
 * @param consumedCost 窗口内已消耗成本
 * @param totalBudget 窗口总预算
 * @param windowStart 窗口开始时间（UTC）
 * @param windowEnd 窗口结束时间（UTC）
 * @param now 当前时间（UTC）
 */
export function computeBudgetBurn(
  consumedCost: number,
  totalBudget: number,
  windowStart: Date,
  windowEnd: Date,
  now: Date,
): AiSloBudgetBurnResult {
  const elapsedMs = now.getTime() - windowStart.getTime()
  const remainingMs = windowEnd.getTime() - now.getTime()

  if (totalBudget <= 0 || consumedCost <= 0) {
    return {
      projectedExhaustionAt: null,
      currentBurnRate: 0,
      remainingRatio: 1,
      remainingMs,
    }
  }

  const remainingBudget = Math.max(0, totalBudget - consumedCost)
  const remainingRatio = remainingBudget / totalBudget

  // 按当前速率：已消耗 / 已耗时间 = 每毫秒消耗
  const elapsedMsPositive = Math.max(1, elapsedMs)
  const burnRatePerMs = consumedCost / elapsedMsPositive
  const burnRatePerSecond = burnRatePerMs * 1000

  if (burnRatePerMs <= 0) {
    return {
      projectedExhaustionAt: null,
      currentBurnRate: burnRatePerSecond,
      remainingRatio,
      remainingMs,
    }
  }

  // 按当前速率，剩余预算耗尽需要多少毫秒
  const msToExhaust = remainingBudget / burnRatePerMs
  const projectedExhaustionAt = new Date(now.getTime() + msToExhaust).toISOString()

  return {
    projectedExhaustionAt,
    currentBurnRate: burnRatePerSecond,
    remainingRatio,
    remainingMs,
  }
}

// ---------------------------------------------------------------------------
// §3.6 评估确定性
// ---------------------------------------------------------------------------

/**
 * 确定性评估：同一数据快照产出同一评估结果。
 * 不依赖 Date.now()，使用传入的 evaluatedAt。
 */
export function evaluateAiSloIndicatorDeterministic(
  samples: number[],
  indicator: AiSloIndicator,
  def: AiSloDefinition,
  evaluatedAt: string,
): AiSloEvaluationResult {
  // D8：无样本 → no_data
  if (samples.length === 0) {
    return {
      indicator,
      outcome: 'no_data',
      actualValue: null,
      triggeredThreshold: null,
      triggeredTier: null,
      runbookRef: def.runbookRef,
      evaluatedAt,
    }
  }

  const aggregated = aggregateSamples(samples, indicator)

  const criticalPass = compareAiSloThreshold(aggregated, def.critical.operator, def.critical.value)
  if (!criticalPass) {
    return {
      indicator,
      outcome: 'critical',
      actualValue: aggregated,
      triggeredThreshold: def.critical,
      triggeredTier: 'critical',
      runbookRef: def.runbookRef,
      evaluatedAt,
    }
  }

  const warningPass = compareAiSloThreshold(aggregated, def.warning.operator, def.warning.value)
  if (!warningPass) {
    return {
      indicator,
      outcome: 'warning',
      actualValue: aggregated,
      triggeredThreshold: def.warning,
      triggeredTier: 'warning',
      runbookRef: def.runbookRef,
      evaluatedAt,
    }
  }

  return {
    indicator,
    outcome: 'healthy',
    actualValue: aggregated,
    triggeredThreshold: null,
    triggeredTier: null,
    runbookRef: def.runbookRef,
    evaluatedAt,
  }
}

// ---------------------------------------------------------------------------
// §4.1-4.8 告警去重与抑制
// ---------------------------------------------------------------------------

/** 告警去重键：按 (组织, 指标, 档位) 去重。 */
export interface AiAlertDeduplicationKey {
  organizationId: number
  indicator: AiSloIndicator
  tier: AiSloSeverityTier
}

/** 生成去重键的字符串形式。 */
export function buildAlertDeduplicationKey(key: AiAlertDeduplicationKey): string {
  return `${key.organizationId}:${key.indicator}:${key.tier}`
}

/** 告警通知类型。 */
export const AI_ALERT_NOTIFICATION_TYPES = [
  'alert', // 告警触发/持续
  'escalation', // 档位升级
  'recovery', // 恢复
] as const
export type AiAlertNotificationType = (typeof AI_ALERT_NOTIFICATION_TYPES)[number]

/** 告警通知记录。 */
export interface AiAlertNotification {
  /** 通知唯一标识。 */
  id: string
  /** 通知类型。 */
  notificationType: AiAlertNotificationType
  /** 去重键。 */
  deduplicationKey: string
  /** 指标类型。 */
  indicator: AiSloIndicator
  /** 档位。 */
  tier: AiSloSeverityTier
  /** 实际值。 */
  actualValue: number
  /** 阈值。 */
  thresholdValue: number
  /** runbook 引用。 */
  runbookRef: string
  /** 组织 ID。 */
  organizationId: number
  /** 发送时间（UTC）。 */
  sentAt: string
}

// ---------------------------------------------------------------------------
// §5.1-5.5 不自动处置
// ---------------------------------------------------------------------------

/** 告警路径被禁止的依赖类型（用于测试证明）。 */
export const AI_SLO_FORBIDDEN_REMEDIATION_DEPS = [
  'model_selection', // 模型选型/切换
  'degradation', // 降级
  'rate_limiting', // 限流
  'rollback', // 回滚
] as const
export type AiSloForbiddenRemediationDep = (typeof AI_SLO_FORBIDDEN_REMEDIATION_DEPS)[number]

/** 告警路径域写操作白名单：只允许写告警记录本身。 */
export const AI_SLO_ALLOWED_WRITES = ['alert_record'] as const

// ---------------------------------------------------------------------------
// §6.1-6.5 阈值配置
// ---------------------------------------------------------------------------

/** 阈值变更请求。 */
export interface AiSloThresholdChangeRequest {
  /** SLO 定义 ID。 */
  sloDefinitionId: string
  /** 组织 ID。 */
  organizationId: number
  /** 要变更的档位。 */
  tier: AiSloSeverityTier
  /** 新的阈值。 */
  newValue: AiSloThreshold
  /** 变更者 ID。 */
  actorId: number
}

/** 阈值变更结果。 */
export interface AiSloThresholdChangeResult {
  /** 是否成功。 */
  success: boolean
  /** 失败原因。 */
  reason?: string
  /** 原始阈值。 */
  previousThreshold?: AiSloThreshold
  /** 新阈值。 */
  newThreshold?: AiSloThreshold
}

/**
 * 校验阈值变更是否合法。
 * D6：组织可下调阈值使其更敏感，不得上调超过声明上限。
 *
 * 下调 = 更严格（阈值变小，更容易触发）。
 * 上调 = 更宽松（阈值变大，更不容易触发）。
 */
export function validateThresholdChange(
  currentDef: AiSloDefinition,
  request: AiSloThresholdChangeRequest,
): AiSloThresholdChangeResult {
  const currentThreshold = request.tier === 'warning' ? currentDef.warning : currentDef.critical

  // 比较新旧阈值：下调（更敏感）= 更严格的比较
  // 对于 gt/gte 类指标：阈值变小 = 更容易触发 = 更严格
  // 对于 lt/lte 类指标：阈值变大 = 更容易触发 = 更严格
  const isTightening = isTighterThreshold(
    currentThreshold.operator,
    currentThreshold.value,
    request.newValue.operator,
    request.newValue.value,
  )

  if (!isTightening) {
    return {
      success: false,
      reason: '阈值上调超过声明上限：D6 只允许下调使其更敏感',
      previousThreshold: currentThreshold,
    }
  }

  return {
    success: true,
    previousThreshold: currentThreshold,
    newThreshold: request.newValue,
  }
}

/**
 * 判断新阈值是否比旧阈值更严格（更敏感）。
 */
function isTighterThreshold(
  oldOp: AiSloOperator,
  oldVal: number,
  newOp: AiSloOperator,
  newVal: number,
): boolean {
  // 运算符必须一致（简化：不允许改变运算符）
  if (oldOp !== newOp) {
    // 运算符变更视为需要人工审查，不自动允许
    return false
  }

  switch (oldOp) {
    case 'gt':
    case 'gte':
      // 阈值变小 = 更容易触发 = 更严格
      return newVal < oldVal
    case 'lt':
    case 'lte':
      // 阈值变大 = 更容易触发 = 更严格
      return newVal > oldVal
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// §7.1-7.6 组织隔离与 RBAC
// ---------------------------------------------------------------------------

/** SLO 查询权限。 */
export const AI_SLO_PERMISSIONS = [
  'slo:read', // 读取 SLO 定义与告警记录
  'slo:manage', // 管理 SLO 定义（创建/修改/删除）
  'slo:configure', // 配置阈值变更
] as const
export type AiSloPermission = (typeof AI_SLO_PERMISSIONS)[number]

/** 判断是否为合法权限。 */
export function isAiSloPermission(v: unknown): v is AiSloPermission {
  return AI_SLO_PERMISSIONS.includes(v as AiSloPermission)
}

/** SLO 查询输入（含组织隔离）。 */
export interface AiSloQueryInput {
  /** 组织 ID（必填，用于隔离）。 */
  organizationId: number
  /** 指标类型筛选。 */
  indicator?: AiSloIndicator
  /** 档位筛选。 */
  tier?: AiSloSeverityTier
  /** 时间范围开始。 */
  from?: string
  /** 时间范围结束。 */
  to?: string
  /** 操作者权限列表。 */
  permissions: AiSloPermission[]
}

/** 权限校验结果。 */
export interface AiSloPermissionCheckResult {
  /** 是否允许。 */
  allowed: boolean
  /** 拒绝原因。 */
  reason?: string
}

/**
 * 校验 SLO 查询权限。
 * §7.3：查询需要相应权限。
 */
export function checkSloQueryPermission(
  input: AiSloQueryInput,
  requiredPermission: AiSloPermission,
): AiSloPermissionCheckResult {
  if (!input.permissions.includes(requiredPermission)) {
    return {
      allowed: false,
      reason: `缺少权限 ${requiredPermission}`,
    }
  }
  return { allowed: true }
}

/**
 * 校验 SLO 阈值变更权限。
 * §6.4：阈值变更需要相应权限。
 */
export function checkSloThresholdChangePermission(
  permissions: AiSloPermission[],
): AiSloPermissionCheckResult {
  if (!permissions.includes('slo:configure')) {
    return {
      allowed: false,
      reason: '缺少权限 slo:configure',
    }
  }
  return { allowed: true }
}

/**
 * 校验 SLO 管理权限。
 */
export function checkSloManagePermission(
  permissions: AiSloPermission[],
): AiSloPermissionCheckResult {
  if (!permissions.includes('slo:manage')) {
    return {
      allowed: false,
      reason: '缺少权限 slo:manage',
    }
  }
  return { allowed: true }
}

// ---------------------------------------------------------------------------
// §7.5 告警记录保留期声明
// ---------------------------------------------------------------------------

/**
 * 告警记录保留期声明。
 * 实际保留策略归 v3-observability-data-retention 统一处理。
 */
export const AI_SLO_ALERT_RETENTION_POLICY = {
  /** 保留期声明（天数），实际执行由数据保留 change 负责。 */
  retentionDays: 90,
  /** 说明。 */
  note: '告警记录保留期由 v3-observability-data-retention 统一管理，本模块仅声明需求',
} as const
