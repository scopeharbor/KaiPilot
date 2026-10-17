// @aiproj/types —— 项目健康风险指挥中心共享契约（前后端共享）。
// v3-project-health-risk-command-center §2：固定 contract version、来源词表、
// evidence class、可用性/新鲜度状态、注意力队列、warning codes、safe target
// 闭集与确定性纯函数（query 规范化 / canonicalization / 投影签名 /
// headline precedence / attention 排序去重截断 / safe-target allowlist /
// forbidden-field 扫描）。
//
// 红线：
//   - 只读投影：不调用 AIGateway、不启动 Compiler、不生成/刷新/确认健康诊断、
//     不运行风险评估或采纳候选、不写任何项目/任务/资源/风险/预测/变更/审计事实。
//   - 不重算健康诊断、风险等级、预测压力、资源负载、关键路径、里程碑或变更影响；
//     不把多来源折叠成单一"万能总分"；缺失/受限来源不得以零值冒充。
//   - 受限来源在聚合前排除：无权限时不得返回该领域的数量、标题、实体引用、
//     hash、更新时间或存在性线索，只能返回不携带事实的通用受限状态。
//   - projectionSignature 只对规范化低敏键、版本/摘要、状态、reason code、
//     实体引用与权限指纹计算；不含标题正文、用户姓名、prompt 或模型输出。
//   - safe target 是宿主闭集，永不携带 mutation method / confirmation handle /
//     preview token / 外部 URL；目标页面二次授权。

// ─── Contract Version ──────────────────────────────────────────────────────────
export const COMMAND_CENTER_CONTRACT_VERSION = 'project-health-risk-command-center/v1' as const

/** 注意力排序规则版本（规则变化必须显式升版）。 */
export const COMMAND_CENTER_ATTENTION_RULE_VERSION = 'command-center-attention-rules.v1' as const

// ─── Source Keys ───────────────────────────────────────────────────────────────
export const COMMAND_CENTER_SOURCES = {
  /** mandatory：项目身份 + 基础 Dashboard（含任务/里程碑压力与派生健康）。 */
  PROJECT_DASHBOARD: 'project-dashboard',
  /** optional：最新可见且已确认的健康诊断。 */
  HEALTH_DIAGNOSIS: 'health-diagnosis',
  /** optional：风险工作台摘要与复查队列（risk:view）。 */
  RISK_WORKBENCH: 'risk-workbench',
  /** optional：最新可见预测快照摘要。 */
  PREDICTION: 'prediction',
  /** optional（从 Dashboard 派生的独立投影键）。 */
  TASK_MILESTONE: 'task-milestone',
  /** optional（P1）：资源负载摘要（resource:view）。 */
  RESOURCE_LOAD: 'resource-load',
  /** optional（P1）：变更影响摘要。首期无安全 facade → unsupported。 */
  CHANGE_IMPACT: 'change-impact',
} as const

export type CommandCenterSourceKey =
  (typeof COMMAND_CENTER_SOURCES)[keyof typeof COMMAND_CENTER_SOURCES]

export const COMMAND_CENTER_SOURCE_KEYS = Object.values(
  COMMAND_CENTER_SOURCES,
) as readonly CommandCenterSourceKey[]

/** mandatory 来源：任一失败整次读取 fail-closed。 */
export const COMMAND_CENTER_MANDATORY_SOURCES: readonly CommandCenterSourceKey[] = [
  COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD,
]

// ─── Evidence Class ────────────────────────────────────────────────────────────
export const COMMAND_CENTER_EVIDENCE_CLASSES = {
  FACT: 'fact',
  CONFIRMED_DIAGNOSIS: 'confirmed-diagnosis',
  PREDICTION: 'prediction',
  REVIEW_CANDIDATE: 'review-candidate',
  AVAILABILITY_WARNING: 'availability-warning',
} as const

export type CommandCenterEvidenceClass =
  (typeof COMMAND_CENTER_EVIDENCE_CLASSES)[keyof typeof COMMAND_CENTER_EVIDENCE_CLASSES]

export const COMMAND_CENTER_EVIDENCE_CLASS_VALUES = Object.values(
  COMMAND_CENTER_EVIDENCE_CLASSES,
) as readonly CommandCenterEvidenceClass[]

// ─── Source Availability ───────────────────────────────────────────────────────
export const COMMAND_CENTER_AVAILABILITIES = {
  AVAILABLE: 'available',
  EMPTY: 'empty',
  STALE: 'stale',
  FORBIDDEN: 'forbidden',
  UNAVAILABLE: 'unavailable',
  UNSUPPORTED: 'unsupported',
} as const

export type CommandCenterAvailability =
  (typeof COMMAND_CENTER_AVAILABILITIES)[keyof typeof COMMAND_CENTER_AVAILABILITIES]

export const COMMAND_CENTER_AVAILABILITY_VALUES = Object.values(
  COMMAND_CENTER_AVAILABILITIES,
) as readonly CommandCenterAvailability[]

// ─── Freshness State ───────────────────────────────────────────────────────────
export const COMMAND_CENTER_FRESHNESS_STATES = {
  CURRENT: 'current',
  STALE: 'stale',
  UNKNOWN: 'unknown',
} as const

export type CommandCenterFreshnessState =
  (typeof COMMAND_CENTER_FRESHNESS_STATES)[keyof typeof COMMAND_CENTER_FRESHNESS_STATES]

export const COMMAND_CENTER_FRESHNESS_STATE_VALUES = Object.values(
  COMMAND_CENTER_FRESHNESS_STATES,
) as readonly CommandCenterFreshnessState[]

// ─── Severity ──────────────────────────────────────────────────────────────────
export const COMMAND_CENTER_SEVERITIES = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
} as const

export type CommandCenterSeverity =
  (typeof COMMAND_CENTER_SEVERITIES)[keyof typeof COMMAND_CENTER_SEVERITIES]

export const COMMAND_CENTER_SEVERITY_VALUES = Object.values(
  COMMAND_CENTER_SEVERITIES,
) as readonly CommandCenterSeverity[]

/** severityRank DESC 用：数值越大越靠前。 */
export const COMMAND_CENTER_SEVERITY_RANK: Record<CommandCenterSeverity, number> = {
  critical: 50,
  high: 40,
  medium: 30,
  low: 20,
  info: 10,
}

// ─── Attention Kinds ───────────────────────────────────────────────────────────
export const COMMAND_CENTER_ATTENTION_KINDS = {
  HEALTH_DIMENSION: 'health-dimension',
  HIGH_RISK_OPEN: 'high-risk-open',
  RISK_REVIEW_OVERDUE: 'risk-review-overdue',
  PREDICTION_SIGNAL: 'prediction-signal',
  TASK_OVERDUE: 'task-overdue',
  MILESTONE_PRESSURE: 'milestone-pressure',
  RESOURCE_PRESSURE: 'resource-pressure',
  SOURCE_STALE_REVIEW: 'source-stale-review',
  SOURCE_UNAVAILABLE: 'source-unavailable',
} as const

export type CommandCenterAttentionKind =
  (typeof COMMAND_CENTER_ATTENTION_KINDS)[keyof typeof COMMAND_CENTER_ATTENTION_KINDS]

export const COMMAND_CENTER_ATTENTION_KIND_VALUES = Object.values(
  COMMAND_CENTER_ATTENTION_KINDS,
) as readonly CommandCenterAttentionKind[]

// ─── Reason Codes ──────────────────────────────────────────────────────────────
export const COMMAND_CENTER_REASON_CODES = {
  HEALTH_DIAGNOSIS_MISSING: 'HEALTH_DIAGNOSIS_MISSING',
  HEALTH_DIAGNOSIS_STALE: 'HEALTH_DIAGNOSIS_STALE',
  HEALTH_DIMENSION_ATTENTION: 'HEALTH_DIMENSION_ATTENTION',
  SOURCE_POSTURE_CONFLICT: 'SOURCE_POSTURE_CONFLICT',
  HIGH_SEVERITY_RISK_OPEN: 'HIGH_SEVERITY_RISK_OPEN',
  RISK_REVIEW_OVERDUE: 'RISK_REVIEW_OVERDUE',
  PREDICTION_SIGNAL_ACTIVE: 'PREDICTION_SIGNAL_ACTIVE',
  PREDICTION_STALE: 'PREDICTION_STALE',
  TASK_OVERDUE: 'TASK_OVERDUE',
  MILESTONE_OVERDUE: 'MILESTONE_OVERDUE',
  RESOURCE_OVERALLOCATION: 'RESOURCE_OVERALLOCATION',
  SOURCE_STALE_REVIEW_REQUIRED: 'SOURCE_STALE_REVIEW_REQUIRED',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  TARGET_SURFACE_UNAVAILABLE: 'TARGET_SURFACE_UNAVAILABLE',
} as const

export type CommandCenterReasonCode =
  (typeof COMMAND_CENTER_REASON_CODES)[keyof typeof COMMAND_CENTER_REASON_CODES]

export const COMMAND_CENTER_REASON_CODE_VALUES = Object.values(
  COMMAND_CENTER_REASON_CODES,
) as readonly CommandCenterReasonCode[]

// ─── Warning Codes ─────────────────────────────────────────────────────────────
export const COMMAND_CENTER_WARNING_CODES = {
  HEALTH_DIAGNOSIS_MISSING: 'HEALTH_DIAGNOSIS_MISSING',
  HEALTH_DIAGNOSIS_STALE: 'HEALTH_DIAGNOSIS_STALE',
  SOURCE_POSTURE_CONFLICT: 'SOURCE_POSTURE_CONFLICT',
  SOURCE_STALE: 'SOURCE_STALE',
  SOURCE_EMPTY: 'SOURCE_EMPTY',
  SOURCE_FORBIDDEN: 'SOURCE_FORBIDDEN',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SOURCE_UNSUPPORTED: 'SOURCE_UNSUPPORTED',
  ATTENTION_TRUNCATED: 'ATTENTION_TRUNCATED',
  EVIDENCE_TRUNCATED: 'EVIDENCE_TRUNCATED',
  TARGET_SURFACE_UNAVAILABLE: 'TARGET_SURFACE_UNAVAILABLE',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  DASHBOARD_RECONCILIATION: 'DASHBOARD_RECONCILIATION',
  FORGED_TARGET_DISCARDED: 'FORGED_TARGET_DISCARDED',
} as const

export type CommandCenterWarningCode =
  (typeof COMMAND_CENTER_WARNING_CODES)[keyof typeof COMMAND_CENTER_WARNING_CODES]

export const COMMAND_CENTER_WARNING_CODE_VALUES = Object.values(
  COMMAND_CENTER_WARNING_CODES,
) as readonly CommandCenterWarningCode[]

// ─── Safe Target Kinds（宿主闭集，D7）───────────────────────────────────────────
export const COMMAND_CENTER_TARGET_KINDS = {
  PROJECT_DASHBOARD: 'project-dashboard',
  RISK_WORKBENCH: 'risk-workbench',
  RISK_DETAIL: 'risk-detail',
  PREDICTION_WORKBENCH: 'prediction-workbench',
  TASK_DETAIL: 'task-detail',
  MILESTONE_VIEW: 'milestone-view',
  RESOURCE_WORKBENCH: 'resource-workbench',
  CHANGE_IMPACT: 'change-impact',
  HEALTH_EVIDENCE: 'health-evidence',
} as const

export type CommandCenterTargetKind =
  (typeof COMMAND_CENTER_TARGET_KINDS)[keyof typeof COMMAND_CENTER_TARGET_KINDS]

export const COMMAND_CENTER_TARGET_KIND_VALUES = Object.values(
  COMMAND_CENTER_TARGET_KINDS,
) as readonly CommandCenterTargetKind[]

/**
 * 每个 target kind 允许的 params 键闭集。
 * `projectId` 由后端注入当前项目 id；前端 resolver 拒绝任何其它项目 id。
 * 无条目的 kind 表示零参数目标。
 */
export const COMMAND_CENTER_TARGET_PARAM_ALLOWLIST: Record<
  CommandCenterTargetKind,
  readonly string[]
> = {
  [COMMAND_CENTER_TARGET_KINDS.PROJECT_DASHBOARD]: ['projectId'],
  [COMMAND_CENTER_TARGET_KINDS.RISK_WORKBENCH]: ['projectId'],
  [COMMAND_CENTER_TARGET_KINDS.RISK_DETAIL]: ['projectId', 'riskId'],
  [COMMAND_CENTER_TARGET_KINDS.PREDICTION_WORKBENCH]: ['projectId'],
  [COMMAND_CENTER_TARGET_KINDS.TASK_DETAIL]: ['projectId', 'taskId'],
  [COMMAND_CENTER_TARGET_KINDS.MILESTONE_VIEW]: ['projectId'],
  [COMMAND_CENTER_TARGET_KINDS.RESOURCE_WORKBENCH]: ['projectId'],
  [COMMAND_CENTER_TARGET_KINDS.CHANGE_IMPACT]: ['projectId'],
  [COMMAND_CENTER_TARGET_KINDS.HEALTH_EVIDENCE]: ['projectId', 'diagnosisId'],
}

// ─── Query Bounds ──────────────────────────────────────────────────────────────
export const COMMAND_CENTER_DEFAULT_ATTENTION_LIMIT = 20
export const COMMAND_CENTER_MAX_ATTENTION_LIMIT = 100
export const COMMAND_CENTER_MIN_FRESHNESS_WINDOW_DAYS = 1
export const COMMAND_CENTER_MAX_FRESHNESS_WINDOW_DAYS = 90
export const COMMAND_CENTER_DEFAULT_FRESHNESS_WINDOW_DAYS = 30
export const COMMAND_CENTER_MAX_INCLUDE_CARDINALITY = COMMAND_CENTER_SOURCE_KEYS.length
/** 每来源证据/警告/目标上限（响应有界性，D4/D6）。 */
export const COMMAND_CENTER_MAX_EVIDENCE_PER_SOURCE = 10
export const COMMAND_CENTER_MAX_WARNINGS_PER_SOURCE = 10
export const COMMAND_CENTER_MAX_TARGETS_PER_ITEM = 3

// ─── DTOs ──────────────────────────────────────────────────────────────────────

/** 原始查询（HTTP query string 反序列化后的形态）。 */
export interface CommandCenterQuery {
  attentionLimit?: number | string
  include?: readonly string[] | string
  freshnessWindowDays?: number | string
}

/** 规范化后的合法查询（纯函数输出）。 */
export interface NormalizedCommandCenterQuery {
  attentionLimit: number
  include: CommandCenterSourceKey[]
  freshnessWindowDays: number
}

export interface CommandCenterValidationIssue {
  field: 'attentionLimit' | 'include' | 'freshnessWindowDays'
  code:
    | 'required-number'
    | 'out-of-bounds'
    | 'unknown-value'
    | 'duplicate-value'
    | 'cardinality-exceeded'
    | 'malformed'
  message: string
}

export type NormalizedCommandCenterQueryResult =
  | { ok: true; query: NormalizedCommandCenterQuery }
  | { ok: false; issues: CommandCenterValidationIssue[] }

/** 实体引用：只允许 kind + 数字 id 的规范化形态。 */
export interface CommandCenterEntityRef {
  kind:
    | 'project'
    | 'diagnosis'
    | 'risk'
    | 'prediction-snapshot'
    | 'task'
    | 'milestone'
    | 'resource'
    | 'change-request'
  id: number
}

/** 安全下钻目标：闭集 kind + 白名单 params，永不携带写/确认句柄。 */
export interface CommandCenterSafeTarget {
  kind: CommandCenterTargetKind
  params: Partial<Record<'projectId' | 'riskId' | 'taskId' | 'diagnosisId', number>>
}

/** 目标不可用时的占位：只保留 kind 与低敏原因。 */
export interface CommandCenterUnavailableTarget {
  kind: CommandCenterTargetKind | null
  unavailableReason: typeof COMMAND_CENTER_REASON_CODES.TARGET_SURFACE_UNAVAILABLE
}

/** 来源元数据（每个来源一份，spec「source-preserving projection」）。 */
export interface CommandCenterSourceMeta {
  sourceKey: CommandCenterSourceKey
  evidenceClass: CommandCenterEvidenceClass
  availability: CommandCenterAvailability
  freshness: CommandCenterFreshnessState
  /** 权威引用：领域内稳定标识（如 dashboard metricVersion / diagnosisId / snapshotId）。 */
  authorityRef: { kind: string; id: number | null } | null
  /** 来源版本或输入签名摘要（低敏短 hash，非全文）。 */
  sourceVersionDigest: string | null
  calculatedAt: string | null
  /** 低敏 reason code（availability 非 available 时必有）。 */
  reasonCode: CommandCenterReasonCode | null
}

/** 来源摘要 payload：各来源的有界、低敏结构化摘要。 */
export interface CommandCenterSourceSummary {
  sourceKey: CommandCenterSourceKey
  meta: CommandCenterSourceMeta
  warnings: CommandCenterWarning[]
  targets: CommandCenterSafeTarget[]
  /**
   * 领域摘要有界字段（按 sourceKey 判别联合消费方自行收窄）：
   * 全部为计数/等级/分数/时间戳级别低敏字段，禁止自由文本正文。
   */
  facts: CommandCenterSourceFacts | null
}

/** 各来源 facts 的封闭判别联合。 */
export type CommandCenterSourceFacts =
  | ProjectDashboardCommandCenterFacts
  | HealthDiagnosisCommandCenterFacts
  | RiskWorkbenchCommandCenterFacts
  | PredictionCommandCenterFacts
  | TaskMilestoneCommandCenterFacts
  | ResourceLoadCommandCenterFacts
  | ChangeImpactCommandCenterFacts

export interface ProjectDashboardCommandCenterFacts {
  sourceKey: typeof COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD
  healthStatus: 'green' | 'yellow' | 'red' | 'unknown'
  progressPercent: number
  memberCount: number
  remainingDays: number | null
  metricVersion: string
}

export interface HealthDiagnosisCommandCenterFacts {
  sourceKey: typeof COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS
  diagnosisId: number
  overallScore: number | null
  overallLabel: string | null
  status: 'confirmed'
  stale: boolean
  confirmedAt: string | null
  dimensionScores: Array<{
    dimension: string
    score: number
    severity: CommandCenterSeverity
  }>
}

export interface RiskWorkbenchCommandCenterFacts {
  sourceKey: typeof COMMAND_CENTER_SOURCES.RISK_WORKBENCH
  totalRisks: number
  openRisks: number
  highRiskCount: number
  criticalRiskCount: number
  overdueReviewCount: number
  incompleteResponsePlans: number
  healthScore: number | null
  trend30d: { created: number; closed: number }
}

export interface PredictionCommandCenterFacts {
  sourceKey: typeof COMMAND_CENTER_SOURCES.PREDICTION
  snapshotId: number
  window: unknown
  signalCount: number
  criticalCount: number
  highCount: number
  maxSeverity: CommandCenterSeverity | null
  confirmedAt: string | null
  hasAiExplanation: boolean
}

export interface TaskMilestoneCommandCenterFacts {
  sourceKey: typeof COMMAND_CENTER_SOURCES.TASK_MILESTONE
  taskTotal: number
  overdueTaskCount: number
  blockedTaskCount: number
  milestoneTotal: number
  overdueMilestoneCount: number
}

export interface ResourceLoadCommandCenterFacts {
  sourceKey: typeof COMMAND_CENTER_SOURCES.RESOURCE_LOAD
  overAllocatedMemberCount: number
  peakUtilizationPercent: number | null
}

export interface ChangeImpactCommandCenterFacts {
  sourceKey: typeof COMMAND_CENTER_SOURCES.CHANGE_IMPACT
  openChangeRequestCount: number | null
}

/** 注意力项（有界、确定性排序）。 */
export interface CommandCenterAttentionItem {
  attentionId: string
  sourceKey: CommandCenterSourceKey
  kind: CommandCenterAttentionKind
  severity: CommandCenterSeverity
  reasonCode: CommandCenterReasonCode
  entityRef: CommandCenterEntityRef | null
  /** 低敏短标题（来自既有领域摘要的既有字段，禁止自由长文本）。 */
  label: string
  occurredAt: string | null
  dueAt: string | null
  stale: boolean
  targets: CommandCenterSafeTarget[]
}

export interface CommandCenterAttentionTruncation {
  requestedLimit: number
  returned: number
  omitted: number
  truncated: boolean
}

export interface CommandCenterWarning {
  code: CommandCenterWarningCode
  sourceKey: CommandCenterSourceKey | null
  message: string
}

/** 头部态势（headline precedence 输出，D3）。 */
export interface CommandCenterHeadline {
  sourceKey:
    typeof COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS | typeof COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD
  evidenceClass: CommandCenterEvidenceClass
  healthStatus: 'green' | 'yellow' | 'red' | 'unknown'
  overallScore: number | null
  degraded: boolean
  degradationWarning: CommandCenterWarning | null
}

export interface CommandCenterMeta {
  contractVersion: typeof COMMAND_CENTER_CONTRACT_VERSION
  attentionRuleVersion: typeof COMMAND_CENTER_ATTENTION_RULE_VERSION
  calculatedAt: string
  projectionSignature: string
  overallAvailability: CommandCenterAvailability
  sourceCounts: Record<CommandCenterAvailability, number>
  attentionTruncation: CommandCenterAttentionTruncation
  perSourceTimingMs: Partial<Record<CommandCenterSourceKey, number>>
}

export interface CommandCenterResponseData {
  project: { id: number; organizationId: number }
  headline: CommandCenterHeadline
  sources: CommandCenterSourceSummary[]
  attention: CommandCenterAttentionItem[]
}

export interface CommandCenterResponse {
  data: CommandCenterResponseData
  meta: CommandCenterMeta
}

// ─── 内部 reader 形态（backend SourceResult 的共享投影面）───────────────────────

/** 注意力候选项：reader 从领域结果中提取的原始候选（投影前的中间形态）。 */
export interface CommandCenterAttentionCandidate {
  sourceKey: CommandCenterSourceKey
  kind: CommandCenterAttentionKind
  severity: CommandCenterSeverity
  reasonCode: CommandCenterReasonCode
  entityRef: CommandCenterEntityRef | null
  label: string
  occurredAt: string | null
  dueAt: string | null
  stale: boolean
  targets: CommandCenterSafeTarget[]
}

// ─── 稳定序列化与哈希 ───────────────────────────────────────────────────────────

/** 键排序的稳定 JSON 序列化（同输入恒同输出）。 */
export function commandCenterStableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map((v) => commandCenterStableSerialize(v)).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${commandCenterStableSerialize(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** FNV-1a 32 位哈希（十六进制，8 字符）。 */
export function commandCenterFnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ─── Query 规范化（任务 2.3）────────────────────────────────────────────────────

function parseBoundedInt(
  raw: number | string | undefined,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false } {
  if (raw === undefined) return { ok: false }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n)) return { ok: false }
  if (n < min || n > max) return { ok: false }
  return { ok: true, value: n }
}

/**
 * 规范化指挥中心查询：严格校验并拒绝未知筛选、非法枚举、越界 limit/window。
 * include 缺省 = 全部来源；重复 include 拒绝；未知 include 拒绝。
 */
export function normalizeCommandCenterQuery(
  query: CommandCenterQuery = {},
): NormalizedCommandCenterQueryResult {
  const issues: CommandCenterValidationIssue[] = []

  let attentionLimit = COMMAND_CENTER_DEFAULT_ATTENTION_LIMIT
  if (query.attentionLimit !== undefined) {
    const parsed = parseBoundedInt(query.attentionLimit, 1, COMMAND_CENTER_MAX_ATTENTION_LIMIT)
    if (!parsed.ok) {
      issues.push({
        field: 'attentionLimit',
        code:
          query.attentionLimit === '' || Number.isNaN(Number(query.attentionLimit))
            ? 'malformed'
            : 'out-of-bounds',
        message: `attentionLimit 必须是 1-${COMMAND_CENTER_MAX_ATTENTION_LIMIT} 的整数`,
      })
    } else {
      attentionLimit = parsed.value
    }
  }

  let freshnessWindowDays = COMMAND_CENTER_DEFAULT_FRESHNESS_WINDOW_DAYS
  if (query.freshnessWindowDays !== undefined) {
    const parsed = parseBoundedInt(
      query.freshnessWindowDays,
      COMMAND_CENTER_MIN_FRESHNESS_WINDOW_DAYS,
      COMMAND_CENTER_MAX_FRESHNESS_WINDOW_DAYS,
    )
    if (!parsed.ok) {
      issues.push({
        field: 'freshnessWindowDays',
        code:
          query.freshnessWindowDays === '' || Number.isNaN(Number(query.freshnessWindowDays))
            ? 'malformed'
            : 'out-of-bounds',
        message: `freshnessWindowDays 必须是 ${COMMAND_CENTER_MIN_FRESHNESS_WINDOW_DAYS}-${COMMAND_CENTER_MAX_FRESHNESS_WINDOW_DAYS} 的整数`,
      })
    } else {
      freshnessWindowDays = parsed.value
    }
  }

  let include: CommandCenterSourceKey[] = [...COMMAND_CENTER_SOURCE_KEYS].sort()
  if (query.include !== undefined) {
    const rawList = Array.isArray(query.include)
      ? query.include
      : String(query.include)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
    const seen = new Set<string>()
    const resolved: CommandCenterSourceKey[] = []
    for (const raw of rawList) {
      if (!(COMMAND_CENTER_SOURCE_KEYS as readonly string[]).includes(raw)) {
        issues.push({ field: 'include', code: 'unknown-value', message: `未知来源筛选：${raw}` })
        continue
      }
      if (seen.has(raw)) {
        issues.push({ field: 'include', code: 'duplicate-value', message: `重复来源筛选：${raw}` })
        continue
      }
      seen.add(raw)
      resolved.push(raw as CommandCenterSourceKey)
    }
    if (resolved.length > COMMAND_CENTER_MAX_INCLUDE_CARDINALITY) {
      issues.push({
        field: 'include',
        code: 'cardinality-exceeded',
        message: `include 数量超过上限 ${COMMAND_CENTER_MAX_INCLUDE_CARDINALITY}`,
      })
    } else if (issues.every((i) => i.field !== 'include')) {
      // 保持请求顺序但做稳定排序，避免乱序 include 影响签名。
      include = [...resolved].sort()
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, query: { attentionLimit, include, freshnessWindowDays } }
}

/** 查询 canonical key：同语义查询（乱序输入归一后）恒同字符串。 */
export function canonicalizeCommandCenterQuery(query: NormalizedCommandCenterQuery): string {
  return commandCenterStableSerialize({
    v: COMMAND_CENTER_CONTRACT_VERSION,
    al: query.attentionLimit,
    inc: [...query.include].sort(),
    fw: query.freshnessWindowDays,
  })
}

// ─── 投影签名（任务 2.3）───────────────────────────────────────────────────────

/** 签名输入：只允许低敏字段。隐藏来源必须在调用前排除。 */
export interface ProjectionSignatureInput {
  permissionFingerprint: string
  query: NormalizedCommandCenterQuery
  sources: Array<
    Pick<
      CommandCenterSourceMeta,
      | 'sourceKey'
      | 'evidenceClass'
      | 'availability'
      | 'freshness'
      | 'reasonCode'
      | 'sourceVersionDigest'
    > & { entityRefs?: CommandCenterEntityRef[] }
  >
}

/**
 * 计算投影签名：相同来源版本 + 权限指纹 + 统计边界 → 相同签名。
 * 不包含标题正文、用户身份明文、prompt、模型输出或隐藏来源信息。
 */
export function computeProjectionSignature(input: ProjectionSignatureInput): string {
  const normalizedSources = [...input.sources]
    .sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0))
    .map((s) => ({
      k: s.sourceKey,
      ec: s.evidenceClass,
      av: s.availability,
      fr: s.freshness,
      rc: s.reasonCode,
      sv: s.sourceVersionDigest,
      refs: (s.entityRefs ?? []).map((r) => `${r.kind}:${r.id}`).sort(),
    }))
  return commandCenterFnv1a(
    commandCenterStableSerialize({
      v: COMMAND_CENTER_CONTRACT_VERSION,
      rules: COMMAND_CENTER_ATTENTION_RULE_VERSION,
      pf: input.permissionFingerprint,
      q: canonicalizeCommandCenterQuery(input.query),
      s: normalizedSources,
    }),
  )
}

/** 权限指纹：由调用方传入已裁剪权限位集合（如 ['project:view','risk:view']），此处固化摘要。 */
export function computeCommandCenterPermissionFingerprint(
  allowedPermissions: readonly string[],
): string {
  return commandCenterFnv1a(commandCenterStableSerialize([...allowedPermissions].sort()))
}

// ─── Headline precedence 与来源矩阵（任务 2.5）─────────────────────────────────

export interface HeadlineInputSources {
  dashboard?: Pick<CommandCenterSourceSummary, 'meta'> & {
    facts: ProjectDashboardCommandCenterFacts | null
  }
  diagnosis?: {
    meta: CommandCenterSourceMeta
    facts: HealthDiagnosisCommandCenterFacts | null
  } | null
}

/**
 * 头部健康来源优先级（固定矩阵，D3）：
 * 1. 最新已确认且未过期（current）的健康诊断 → headline=health-diagnosis；
 * 2. 否则回退基础 Dashboard 派生健康，附 MISSING/STALE 降级 warning；
 * 3. 永不合成新总分。
 */
export function resolveHeadline(input: HeadlineInputSources): CommandCenterHeadline {
  const diagnosis = input.diagnosis
  const diagnosisUsable =
    diagnosis &&
    diagnosis.meta.availability === COMMAND_CENTER_AVAILABILITIES.AVAILABLE &&
    diagnosis.meta.evidenceClass === COMMAND_CENTER_EVIDENCE_CLASSES.CONFIRMED_DIAGNOSIS &&
    diagnosis.meta.freshness === COMMAND_CENTER_FRESHNESS_STATES.CURRENT &&
    diagnosis.facts !== null

  if (diagnosisUsable && diagnosis && diagnosis.facts) {
    return {
      sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
      evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.CONFIRMED_DIAGNOSIS,
      healthStatus: scoreToHealthStatus(diagnosis.facts.overallScore),
      overallScore: diagnosis.facts.overallScore,
      degraded: false,
      degradationWarning: null,
    }
  }

  const missingOrStale =
    diagnosis == null || diagnosis.meta.availability === COMMAND_CENTER_AVAILABILITIES.EMPTY
      ? COMMAND_CENTER_WARNING_CODES.HEALTH_DIAGNOSIS_MISSING
      : COMMAND_CENTER_WARNING_CODES.HEALTH_DIAGNOSIS_STALE

  const dashboardStatus = input.dashboard?.facts?.healthStatus ?? 'unknown'
  return {
    sourceKey: COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD,
    evidenceClass: COMMAND_CENTER_EVIDENCE_CLASSES.FACT,
    healthStatus: dashboardStatus,
    overallScore: null,
    degraded: true,
    degradationWarning: {
      code: missingOrStale,
      sourceKey: COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
      message:
        missingOrStale === COMMAND_CENTER_WARNING_CODES.HEALTH_DIAGNOSIS_MISSING
          ? '暂无已确认的健康诊断，头部使用基础项目健康状态'
          : '最新已确认健康诊断已过期，头部使用基础项目健康状态',
    },
  }
}

function scoreToHealthStatus(score: number | null): 'green' | 'yellow' | 'red' | 'unknown' {
  if (score === null) return 'unknown'
  if (score >= 80) return 'green'
  if (score >= 60) return 'yellow'
  return 'red'
}

/** 来源冲突检测：headline 正常（green/yellow）但风险工作台存在高/严重开放风险。 */
export function detectSourcePostureConflict(
  headline: CommandCenterHeadline,
  riskFacts: RiskWorkbenchCommandCenterFacts | null,
): CommandCenterWarning | null {
  if (!riskFacts) return null
  const riskPressure = riskFacts.highRiskCount + riskFacts.criticalRiskCount > 0
  const headlineHealthy = headline.healthStatus === 'green'
  if (headlineHealthy && riskPressure) {
    return {
      code: COMMAND_CENTER_WARNING_CODES.SOURCE_POSTURE_CONFLICT,
      sourceKey: null,
      message: '头部健康状态正常，但风险工作台存在高/严重风险；两个来源并列展示，未合成总分',
    }
  }
  return null
}

// ─── 注意力队列投影（任务 2.7）─────────────────────────────────────────────────

const DUE_STATE_RANK = { overdue: 1, none: 0 } as const

/**
 * 固定排序 tuple（design D4）：
 * severityRank DESC → dueStateRank DESC → freshnessAttentionRank DESC →
 * occurredAt/calculatedAt DESC → sourceKey ASC → reasonCode ASC → canonicalRef ASC。
 */
export function compareCommandCenterAttention(
  a: CommandCenterAttentionCandidate,
  b: CommandCenterAttentionCandidate,
): number {
  const severityDiff =
    COMMAND_CENTER_SEVERITY_RANK[b.severity] - COMMAND_CENTER_SEVERITY_RANK[a.severity]
  if (severityDiff !== 0) return severityDiff

  const aDue = a.dueAt ? new Date(a.dueAt).getTime() : null
  const bDue = b.dueAt ? new Date(b.dueAt).getTime() : null
  const now = NOW_SENTINEL_MS
  const aOverdue = aDue !== null && aDue < now ? DUE_STATE_RANK.overdue : DUE_STATE_RANK.none
  const bOverdue = bDue !== null && bDue < now ? DUE_STATE_RANK.overdue : DUE_STATE_RANK.none
  if (aOverdue !== bOverdue) return bOverdue - aOverdue

  const aStale = a.stale ? 1 : 0
  const bStale = b.stale ? 1 : 0
  if (aStale !== bStale) return bStale - aStale

  const aTs = a.occurredAt ? new Date(a.occurredAt).getTime() : 0
  const bTs = b.occurredAt ? new Date(b.occurredAt).getTime() : 0
  if (aTs !== bTs) return bTs - aTs

  if (a.sourceKey !== b.sourceKey) return a.sourceKey < b.sourceKey ? -1 : 1
  if (a.reasonCode !== b.reasonCode) return a.reasonCode < b.reasonCode ? -1 : 1
  const aRef = a.entityRef ? `${a.entityRef.kind}:${a.entityRef.id}` : ''
  const bRef = b.entityRef ? `${b.entityRef.kind}:${b.entityRef.id}` : ''
  if (aRef !== bRef) return aRef < bRef ? -1 : 1
  return 0
}

/**
 * 时间比较基准。纯函数不允许直接读时钟——由调用方在进程级注入一次
 * （`setCommandCenterNow(ms)`），默认 0 时所有 due 均视为未逾期。
 */
let NOW_SENTINEL_MS = 0

export function setCommandCenterNow(ms: number): void {
  NOW_SENTINEL_MS = ms
}

export function getCommandCenterNow(): number {
  return NOW_SENTINEL_MS
}

/** 去重键：仅当 sourceKey + reasonCode + canonicalRef 均相同时才可去重。 */
export function commandCenterAttentionDedupeKey(item: CommandCenterAttentionCandidate): string {
  return [
    item.sourceKey,
    item.reasonCode,
    item.entityRef ? `${item.entityRef.kind}:${item.entityRef.id}` : '-',
  ].join('|')
}

export interface ProjectedAttentionQueue {
  items: CommandCenterAttentionItem[]
  truncation: CommandCenterAttentionTruncation
}

/**
 * 有界注意力投影：去重 → 固定排序 → 截断到 limit。
 * 同输入恒同顺序；不同域引用同一实体不去重（dedupe key 含 sourceKey+reasonCode）。
 */
export function projectAttentionQueue(
  candidates: readonly CommandCenterAttentionCandidate[],
  limit: number,
): ProjectedAttentionQueue {
  const deduped = new Map<string, CommandCenterAttentionCandidate>()
  for (const c of candidates) {
    const key = commandCenterAttentionDedupeKey(c)
    if (!deduped.has(key)) deduped.set(key, c)
  }
  const sorted = [...deduped.values()].sort(compareCommandCenterAttention)
  const bounded = sorted.slice(0, Math.max(0, limit))
  const items: CommandCenterAttentionItem[] = bounded.map((c, index) => ({
    attentionId: `att-${commandCenterFnv1a(commandCenterAttentionDedupeKey(c))}-${index}`,
    sourceKey: c.sourceKey,
    kind: c.kind,
    severity: c.severity,
    reasonCode: c.reasonCode,
    entityRef: c.entityRef,
    label: c.label,
    occurredAt: c.occurredAt,
    dueAt: c.dueAt,
    stale: c.stale,
    targets: c.targets.slice(0, COMMAND_CENTER_MAX_TARGETS_PER_ITEM),
  }))
  return {
    items,
    truncation: {
      requestedLimit: limit,
      returned: items.length,
      omitted: Math.max(0, sorted.length - items.length),
      truncated: sorted.length > items.length,
    },
  }
}

// ─── Safe target 校验与低敏扫描（任务 2.9）─────────────────────────────────────

export type SafeTargetValidationResult =
  | { ok: true; target: CommandCenterSafeTarget }
  | { ok: false; code: 'unknown-kind' | 'forbidden-param' | 'cross-project' | 'malformed-param' }

/**
 * 校验安全下钻目标：kind 必须在宿主闭集内；params 键必须在白名单内；
 * projectId（若出现）必须等于当前项目；值必须是正整数。
 * 自由 URL / method / token 等字段不在 DTO 形态中，天然被拒绝。
 */
export function validateSafeTarget(
  candidate: unknown,
  context: { projectId: number },
): SafeTargetValidationResult {
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, code: 'unknown-kind' }
  }
  const { kind, params } = candidate as { kind?: unknown; params?: unknown }
  if (
    typeof kind !== 'string' ||
    !(COMMAND_CENTER_TARGET_KIND_VALUES as readonly string[]).includes(kind)
  ) {
    return { ok: false, code: 'unknown-kind' }
  }
  if (typeof params !== 'object' || params === null) {
    return { ok: false, code: 'malformed-param' }
  }
  const allowlist = COMMAND_CENTER_TARGET_PARAM_ALLOWLIST[kind as CommandCenterTargetKind]
  const checked: CommandCenterSafeTarget['params'] = {}
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (!allowlist.includes(key)) return { ok: false, code: 'forbidden-param' }
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return { ok: false, code: 'malformed-param' }
    }
    if (key === 'projectId' && value !== context.projectId) {
      return { ok: false, code: 'cross-project' }
    }
    ;(checked as Record<string, number>)[key] = value
  }
  return { ok: true, target: { kind: kind as CommandCenterTargetKind, params: checked } }
}

/** response 对象遍历中的禁用键（精确匹配，小写化比较）。 */
export const COMMAND_CENTER_FORBIDDEN_KEYS: readonly string[] = [
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'authorization',
  'apikey',
  'api_key',
  'cookie',
  'href',
  'url',
  'uri',
  'method',
  'previewtoken',
  'confirmhandle',
  'confirmationhandle',
  'prompt',
  'modeloutput',
  'aioutput',
  'stacktrace',
  'sql',
  'email',
  'username',
  'fullname',
  'phonenumber',
]

export interface ForbiddenFieldFinding {
  path: string
  key: string
}

/** 结构化低敏输出扫描：递归查找禁用键与自由 metadata 对象。 */
export function detectForbiddenFields(value: unknown, maxFindings = 50): ForbiddenFieldFinding[] {
  const findings: ForbiddenFieldFinding[] = []
  const visit = (node: unknown, path: string) => {
    if (findings.length >= maxFindings) return
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, `${path}[${i}]`))
      return
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (COMMAND_CENTER_FORBIDDEN_KEYS.includes(key.toLowerCase())) {
          findings.push({ path: `${path}.${key}`, key })
          continue
        }
        visit(child, `${path}.${key}`)
      }
    }
  }
  visit(value, '$')
  return findings
}

/**
 * lens 贡献隔离校验（首期 unsupported 姿态的守卫面）：
 * lens 贡献若携带任何动作/写句柄/URL 即拒绝；核心投影不变。
 */
export interface LensContributionCheckInput {
  contributionPresent: boolean
  declaredActions: readonly string[]
}

export type LensContributionCheckResult =
  | {
      accepted: false
      reason: 'lens-unsupported' | 'write-action-declared'
      rejectedAction?: string
    }
  | { accepted: true }

export function checkLensContribution(
  input: LensContributionCheckInput,
): LensContributionCheckResult {
  if (!input.contributionPresent) return { accepted: false, reason: 'lens-unsupported' }
  for (const action of input.declaredActions) {
    const normalized = action.toLowerCase()
    if (
      normalized.includes('confirm') ||
      normalized.includes('apply') ||
      normalized.includes('accept') ||
      normalized.includes('execute') ||
      normalized.includes('write') ||
      normalized.includes('update') ||
      normalized.includes('delete')
    ) {
      return { accepted: false, reason: 'write-action-declared', rejectedAction: action }
    }
  }
  return { accepted: true }
}
