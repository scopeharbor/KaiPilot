// @aiproj/types — PMO 组合交通灯共享契约（前后端共享）。
// v3-pmo-portfolio-traffic-light §2: traffic light status, severity, rule evidence,
// warning codes, source freshness, review state, scoring helpers.

// ─── Traffic Light Status ────────────────────────────────────────────────────────

/** 交通灯灯色。 */
export const TRAFFIC_LIGHT_STATUSES = ['red', 'yellow', 'green', 'gray'] as const
export type TrafficLightStatus = (typeof TRAFFIC_LIGHT_STATUSES)[number]

/** 灯色中文标签。 */
export const TRAFFIC_LIGHT_STATUS_LABELS: Record<TrafficLightStatus, string> = {
  red: '红灯',
  yellow: '黄灯',
  green: '绿灯',
  gray: '灰灯',
}

/** 灯色排序优先级（红灯最高、绿灯最低、灰灯为数据不足态）。 */
export const TRAFFIC_LIGHT_STATUS_ORDER: TrafficLightStatus[] = ['red', 'yellow', 'green', 'gray']

/** 灯色严重度评分。 */
export function trafficLightSeverityScore(status: TrafficLightStatus): number {
  const idx = TRAFFIC_LIGHT_STATUS_ORDER.indexOf(status)
  return idx >= 0 ? TRAFFIC_LIGHT_STATUS_ORDER.length - idx : 0
}

// ─── Severity Levels ─────────────────────────────────────────────────────────────

export const TRAFFIC_LIGHT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type TrafficLightSeverity = (typeof TRAFFIC_LIGHT_SEVERITIES)[number]

// ─── Rule Engine ─────────────────────────────────────────────────────────────────

/** 交通灯规则 ID 白名单（V3 首版固定规则集）。 */
export const TRAFFIC_LIGHT_RULE_IDS = [
  'TL-R01', // 关键路径严重延期
  'TL-R02', // 高风险集中暴露
  'TL-R03', // 资源严重超载
  'TL-R04', // 里程碑重大偏差
  'TL-R05', // 逾期任务占比过高
  'TL-R06', // 中等延期或风险上升
  'TL-R07', // 资源轻度超载
  'TL-R08', // 预测严重度升高
  'TL-R09', // 数据质量显著下降
  'TL-R10', // 健康诊断结果恶化
  'TL-R11', // 变更冲击未消化
  'TL-R12', // 数据不足或未生成
  'TL-R13', // 权限不足
  'TL-R14', // 来源数据过期
] as const
export type TrafficLightRuleId = (typeof TRAFFIC_LIGHT_RULE_IDS)[number]

/** 交通灯规则版本（V3 首版固定）。 */
export const TRAFFIC_LIGHT_RULE_VERSION = 'pmo-traffic-light-v1' as const

/** 单条规则证据。 */
export interface TrafficLightRuleEvidence {
  ruleId: TrafficLightRuleId
  ruleVersion: string
  severity: TrafficLightSeverity
  status: TrafficLightStatus
  message: string
  evidenceRefs: TrafficLightEvidenceRef[]
  sourceFreshness: TrafficLightSourceFreshness
  contributing: boolean
}

// ─── Evidence ────────────────────────────────────────────────────────────────────

/** 证据引用（低敏，不泄露受限维度的具体数据）。 */
export interface TrafficLightEvidenceRef {
  source: TrafficLightSourceType
  metric: string
  valueSummary: string // 低敏摘要，如 "3 项逾期"、"资源利用率 >120%"
  lastUpdatedAt: string | null
  available: boolean
  forbidden: boolean
}

/** 信号来源类型。 */
export const TRAFFIC_LIGHT_SOURCE_TYPES = {
  PROJECT_DASHBOARD: 'project_dashboard',
  HEALTH_DIAGNOSIS: 'health_diagnosis',
  PREDICTION: 'prediction',
  RISK: 'risk',
  RESOURCE: 'resource',
  GANTT: 'gantt',
  TASK: 'task',
  MILESTONE: 'milestone',
  CHANGE_IMPACT: 'change_impact',
} as const

export type TrafficLightSourceType =
  (typeof TRAFFIC_LIGHT_SOURCE_TYPES)[keyof typeof TRAFFIC_LIGHT_SOURCE_TYPES]

/** 来源新鲜度信息。 */
export interface TrafficLightSourceFreshness {
  source: TrafficLightSourceType
  lastUpdatedAt: string | null
  isStale: boolean
  staleReason: string | null
}

// ─── Warnings ────────────────────────────────────────────────────────────────────

export const TRAFFIC_LIGHT_WARNING_CODES = {
  DATA_STALE: 'DATA_STALE',
  DATA_MISSING: 'DATA_MISSING',
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
  DATA_FORBIDDEN: 'DATA_FORBIDDEN',
  METRIC_UNAVAILABLE: 'METRIC_UNAVAILABLE',
  SOURCE_STALE: 'SOURCE_STALE',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
} as const

export type TrafficLightWarningCode =
  (typeof TRAFFIC_LIGHT_WARNING_CODES)[keyof typeof TRAFFIC_LIGHT_WARNING_CODES]

export interface TrafficLightWarning {
  code: TrafficLightWarningCode
  message: string
  source?: TrafficLightSourceType
}

// ─── Portfolio Traffic Light Summary ──────────────────────────────────────────────

/** 单项目交通灯摘要（API 返回的 DTO）。 */
export interface PortfolioTrafficLightItem {
  projectId: number
  projectName: string
  projectStatus: string
  trafficLight: TrafficLightStatus
  severityCounts: TrafficLightSeverityCounts
  sourceFreshness: TrafficLightSourceFreshnessSummary
  evidence: TrafficLightRuleEvidence[]
  warnings: TrafficLightWarning[]
  reviewState: TrafficLightReviewStateSummary
  ruleVersion: string
  calculatedAt: string
  allowedActions: TrafficLightAllowedActions
}

export interface TrafficLightSeverityCounts {
  critical: number
  high: number
  medium: number
  low: number
}

export interface TrafficLightSourceFreshnessSummary {
  overallStale: boolean
  staleSources: TrafficLightSourceType[]
  lastUpdatedAt: string | null
}

export interface TrafficLightReviewStateSummary {
  reviewState: TrafficLightReviewState
  reviewedAt: string | null
  reviewedBy: number | null
  stale: boolean
}

export interface TrafficLightAllowedActions {
  canReview: boolean
  canViewDetail: boolean
}

// ─── Portfolio List Response ─────────────────────────────────────────────────────

export interface PortfolioTrafficLightListResponse {
  data: PortfolioTrafficLightItem[]
  meta: PortfolioTrafficLightPaginationMeta
}

export interface PortfolioTrafficLightPaginationMeta {
  page: number
  perPage: number
  total: number
  totalPages: number
  calculatedAt: string
}

// ─── Portfolio Traffic Light Counts ───────────────────────────────────────────────

export interface PortfolioTrafficLightCounts {
  red: number
  yellow: number
  green: number
  gray: number
  total: number
  calculatedAt: string
}

// ─── Detail Response ─────────────────────────────────────────────────────────────

export interface PortfolioTrafficLightDetailResponse {
  data: PortfolioTrafficLightItem
}

// ─── Review Marker ───────────────────────────────────────────────────────────────

export const TRAFFIC_LIGHT_REVIEW_STATES = [
  'acknowledged',
  'needs_follow_up',
  'false_positive',
] as const
export type TrafficLightReviewState = (typeof TRAFFIC_LIGHT_REVIEW_STATES)[number]

export const TRAFFIC_LIGHT_REVIEW_STATE_LABELS: Record<TrafficLightReviewState, string> = {
  acknowledged: '已关注',
  needs_follow_up: '需跟进',
  false_positive: '误报',
}

/** 复核标记创建/更新请求。 */
export interface PortfolioTrafficLightReviewRequest {
  reviewState: TrafficLightReviewState
  note?: string
}

/** 复核标记响应。 */
export interface PortfolioTrafficLightReviewResponse {
  data: PortfolioTrafficLightReviewMarker
}

export interface PortfolioTrafficLightReviewMarker {
  id: number
  projectId: number
  organizationId: number
  actorId: number
  reviewState: TrafficLightReviewState
  note: string | null
  ruleVersion: string
  inputSignatureHash: string
  stale: boolean
  previousReviewState: TrafficLightReviewState | null
  createdAt: string
  updatedAt: string
}

// ─── Query Types ─────────────────────────────────────────────────────────────────

export interface PortfolioTrafficLightListQuery {
  page?: number
  perPage?: number
  sort?: PortfolioTrafficLightSortKey
  order?: 'asc' | 'desc'
  filterStatus?: TrafficLightStatus | TrafficLightStatus[]
  filterProjectStatus?: string
  filterStale?: boolean
  filterWarningCode?: TrafficLightWarningCode
  filterReviewState?: TrafficLightReviewState
}

export const PORTFOLIO_TRAFFIC_LIGHT_SORT_KEYS = {
  PROJECT_NAME: 'project_name',
  TRAFFIC_LIGHT: 'traffic_light',
  UPDATED_AT: 'updated_at',
  SEVERITY_CRITICAL: 'severity_critical',
  SEVERITY_HIGH: 'severity_high',
} as const

export type PortfolioTrafficLightSortKey =
  (typeof PORTFOLIO_TRAFFIC_LIGHT_SORT_KEYS)[keyof typeof PORTFOLIO_TRAFFIC_LIGHT_SORT_KEYS]

// ─── Constants ───────────────────────────────────────────────────────────────────

export const PORTFOLIO_TRAFFIC_LIGHT_MAX_PER_PAGE = 100
export const PORTFOLIO_TRAFFIC_LIGHT_DEFAULT_PER_PAGE = 20
export const PORTFOLIO_TRAFFIC_LIGHT_STALE_THRESHOLD_MINUTES = 60

// ─── Input Signature ─────────────────────────────────────────────────────────────

/** 计算输入签名哈希（SHA-256 的低敏前身，用于复核标记的失效检测）。
 *  对主要来源的时间戳和状态值做确定性拼接，不包含任何敏感字段。
 */
export function computeTrafficLightInputSignature(inputs: TrafficLightSignatureInputs): string {
  const parts = [
    inputs.healthDiagnosisUpdatedAt ?? 'null',
    inputs.predictionUpdatedAt ?? 'null',
    inputs.riskSummaryUpdatedAt ?? 'null',
    inputs.resourceSummaryUpdatedAt ?? 'null',
    inputs.dashboardUpdatedAt ?? 'null',
    inputs.taskOverdueCount,
    '',
    inputs.milestoneStatusSummary ?? 'null',
    inputs.changeImpactCount,
    '',
    JSON.stringify([...inputs.availableSources].sort()),
  ]
  // 使用简单的确定性摘要（非密码学强度，仅用于 stale 检测）
  return digestString(parts.join('|'))
}

/** 输入签名的来源数据。 */
export interface TrafficLightSignatureInputs {
  healthDiagnosisUpdatedAt: string | null
  predictionUpdatedAt: string | null
  riskSummaryUpdatedAt: string | null
  resourceSummaryUpdatedAt: string | null
  dashboardUpdatedAt: string | null
  taskOverdueCount: number
  milestoneStatusSummary: string | null
  changeImpactCount: number
  availableSources: TrafficLightSourceType[]
}

// ─── Simple Hash Helper ──────────────────────────────────────────────────────────

/** 简单确定性字符串摘要（非密码学，仅用于 stale 检测）。 */
function digestString(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  // 转为十六进制正数
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ─── Deterministic Scoring ───────────────────────────────────────────────────────

/** 交通灯评分输入（来自各来源的信号）。 */
export interface TrafficLightScoringInput {
  healthDiagnosis: TrafficLightHealthSignal
  prediction: TrafficLightPredictionSignal
  risk: TrafficLightRiskSignal
  resource: TrafficLightResourceSignal
  task: TrafficLightTaskSignal
  milestone: TrafficLightMilestoneSignal
  changeImpact: TrafficLightChangeSignal
  sources: TrafficLightSourceInput[]
}

export interface TrafficLightHealthSignal {
  available: boolean
  forbidden: boolean
  overallLabel: string | null // 'healthy' | 'attention' | 'warning' | 'critical'
  overallScore: number | null
  updatedAt: string | null
}

export interface TrafficLightPredictionSignal {
  available: boolean
  forbidden: boolean
  highestSeverity: TrafficLightSeverity | null
  updatedAt: string | null
}

export interface TrafficLightRiskSignal {
  available: boolean
  forbidden: boolean
  highRiskCount: number
  criticalRiskCount: number
  updatedAt: string | null
}

export interface TrafficLightResourceSignal {
  available: boolean
  forbidden: boolean
  overloadCount: number
  maxUtilization: number | null
  updatedAt: string | null
}

export interface TrafficLightTaskSignal {
  available: boolean
  forbidden: boolean
  overdueCount: number
  soonDueCount: number
  totalCount: number
  updatedAt: string | null
}

export interface TrafficLightMilestoneSignal {
  available: boolean
  forbidden: boolean
  atRiskCount: number
  missedCount: number
  updatedAt: string | null
}

export interface TrafficLightChangeSignal {
  available: boolean
  forbidden: boolean
  openCount: number
  highImpactCount: number
  updatedAt: string | null
}

export interface TrafficLightSourceInput {
  type: TrafficLightSourceType
  available: boolean
  forbidden: boolean
  stale: boolean
  updatedAt: string | null
}

/** 交通灯评分结果。 */
export interface TrafficLightScoringResult {
  status: TrafficLightStatus
  severities: TrafficLightSeverityCounts
  evidence: TrafficLightRuleEvidence[]
  warnings: TrafficLightWarning[]
  signatureInputs: TrafficLightSignatureInputs
}

// ─── Scoring Engine ──────────────────────────────────────────────────────────────

/** 确定性交通灯评分引擎。
 *  零 AI 依赖，只使用规则版本化的纯函数。
 */
export function scoreTrafficLight(input: TrafficLightScoringInput): TrafficLightScoringResult {
  const evidence: TrafficLightRuleEvidence[] = []
  const severities: TrafficLightSeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 }
  const warnings: TrafficLightWarning[] = []

  // 检查数据是否完全缺失/受限
  const anyAvailable = input.sources.some((s) => s.available && !s.forbidden)
  if (!anyAvailable) {
    return {
      status: 'gray',
      severities,
      evidence: [
        makeEvidence('TL-R12', 'critical', 'gray', '所有来源数据不可用或权限不足'),
        makeEvidence('TL-R13', 'high', 'gray', '权限不足或数据未生成，无法评分'),
      ],
      warnings: [{ code: 'DATA_UNAVAILABLE', message: '所有来源数据均不可用' }],
      signatureInputs: buildSignatureInputs(input),
    }
  }

  // 检查关键来源 stale
  const hasStale = input.sources.some((s) => s.stale && s.available)
  if (hasStale) {
    evidence.push(makeEvidence('TL-R14', 'medium', 'gray', '部分来源数据已过期'))
    warnings.push({ code: 'SOURCE_STALE', message: '部分来源数据已过期' })
  }

  // ─── 红灯规则 ─────────────────────────────────────────
  // TL-R01: 关键路径严重延期
  if (input.healthDiagnosis.available && input.healthDiagnosis.overallLabel === 'critical') {
    evidence.push(makeEvidence('TL-R01', 'critical', 'red', '项目健康诊断为"严重"'))
    severities.critical++
  }

  if (input.milestone.available && input.milestone.missedCount > 0) {
    evidence.push(
      makeEvidence(
        'TL-R01',
        'critical',
        'red',
        `关键里程碑已错过 ${input.milestone.missedCount} 个`,
      ),
    )
    severities.critical++
  }

  // TL-R02: 高风险集中暴露
  if (input.risk.available && input.risk.criticalRiskCount > 0) {
    evidence.push(
      makeEvidence('TL-R02', 'critical', 'red', `存在 ${input.risk.criticalRiskCount} 个严重风险`),
    )
    severities.critical++
  }

  // TL-R03: 资源严重超载
  if (
    input.resource.available &&
    input.resource.maxUtilization !== null &&
    input.resource.maxUtilization > 150
  ) {
    evidence.push(
      makeEvidence(
        'TL-R03',
        'critical',
        'red',
        `资源最高利用率 ${input.resource.maxUtilization}% 严重超载`,
      ),
    )
    severities.critical++
  }

  // TL-R04: 里程碑重大偏差
  if (input.milestone.available && input.milestone.atRiskCount >= 3) {
    evidence.push(
      makeEvidence('TL-R04', 'high', 'red', `${input.milestone.atRiskCount} 个里程碑处于风险状态`),
    )
    severities.high++
  }

  // TL-R05: 逾期任务占比过高
  if (input.task.available && input.task.totalCount > 0) {
    const overdueRatio = input.task.overdueCount / input.task.totalCount
    if (overdueRatio >= 0.3) {
      evidence.push(
        makeEvidence(
          'TL-R05',
          'high',
          'red',
          `逾期任务占比 ${Math.round(overdueRatio * 100)}% >= 30%`,
        ),
      )
      severities.high++
    }
  }

  // ─── 黄灯规则 ─────────────────────────────────────────
  // TL-R06: 中等延期或风险上升
  if (input.task.available && input.task.totalCount > 0) {
    const overdueRatio = input.task.overdueCount / input.task.totalCount
    if (overdueRatio >= 0.15 && overdueRatio < 0.3) {
      evidence.push(
        makeEvidence(
          'TL-R06',
          'medium',
          'yellow',
          `逾期任务占比 ${Math.round(overdueRatio * 100)}% >= 15%`,
        ),
      )
      severities.medium++
    }
  }

  if (input.healthDiagnosis.available && input.healthDiagnosis.overallLabel === 'warning') {
    evidence.push(makeEvidence('TL-R06', 'medium', 'yellow', '项目健康诊断为"需警惕"'))
    severities.medium++
  }

  // TL-R07: 资源轻度超载
  if (
    input.resource.available &&
    input.resource.maxUtilization !== null &&
    input.resource.maxUtilization > 120 &&
    input.resource.maxUtilization <= 150
  ) {
    evidence.push(
      makeEvidence(
        'TL-R07',
        'medium',
        'yellow',
        `资源利用率 ${input.resource.maxUtilization}% 轻度超载`,
      ),
    )
    severities.medium++
  }

  if (input.resource.available && input.resource.overloadCount > 0) {
    evidence.push(
      makeEvidence('TL-R07', 'medium', 'yellow', `${input.resource.overloadCount} 个资源超载`),
    )
    severities.medium++
  }

  // TL-R08: 预测严重度升高
  if (input.prediction.available && input.prediction.highestSeverity) {
    const sev = input.prediction.highestSeverity
    if (sev === 'critical' || sev === 'high') {
      evidence.push(makeEvidence('TL-R08', 'high', 'yellow', `预测严重度为 ${sev}`))
      severities.high++
    } else if (sev === 'medium') {
      evidence.push(makeEvidence('TL-R08', 'medium', 'yellow', '预测严重度为 medium'))
      severities.medium++
    }
  }

  // TL-R09: 数据质量显著下降
  if (hasStale) {
    const staleCount = input.sources.filter((s) => s.stale && s.available).length
    if (staleCount >= 3) {
      evidence.push(makeEvidence('TL-R09', 'medium', 'yellow', `${staleCount} 个来源数据已过期`))
      severities.medium++
    }
  }

  // TL-R10: 健康诊断结果恶化
  if (input.healthDiagnosis.available && input.healthDiagnosis.overallLabel === 'attention') {
    evidence.push(makeEvidence('TL-R10', 'medium', 'yellow', '项目健康诊断为"需关注"'))
    severities.medium++
  }

  // TL-R11: 变更冲击未消化
  if (input.changeImpact.available && input.changeImpact.highImpactCount > 0) {
    evidence.push(
      makeEvidence(
        'TL-R11',
        'medium',
        'yellow',
        `${input.changeImpact.highImpactCount} 个高影响变更未消化`,
      ),
    )
    severities.medium++
  }

  // 对每个来源标记禁止/不可用的 evidence
  for (const src of input.sources) {
    if (src.forbidden) {
      evidence.push(makeEvidence('TL-R13', 'low', 'gray', `${src.type} 来源权限不足`, false))
      warnings.push({
        code: 'PERMISSION_REDACTED',
        message: `${src.type} 因权限不足已脱敏`,
        source: src.type,
      })
    } else if (!src.available) {
      evidence.push(makeEvidence('TL-R12', 'low', 'gray', `${src.type} 来源数据不可用`, false))
    }
  }

  // ─── 判定最终灯色 ──────────────────────────────────────
  let status: TrafficLightStatus
  if (severities.critical > 0) {
    status = 'red'
  } else if (severities.high > 0 || severities.medium > 0) {
    status = 'yellow'
  } else {
    status = 'green'
  }

  return {
    status,
    severities,
    evidence,
    warnings,
    signatureInputs: buildSignatureInputs(input),
  }
}

function makeEvidence(
  ruleId: TrafficLightRuleId,
  severity: TrafficLightSeverity,
  status: TrafficLightStatus,
  message: string,
  contributing: boolean = true,
): TrafficLightRuleEvidence {
  return {
    ruleId,
    ruleVersion: TRAFFIC_LIGHT_RULE_VERSION,
    severity,
    status,
    message,
    evidenceRefs: [],
    sourceFreshness: {
      source: 'project_dashboard',
      lastUpdatedAt: null,
      isStale: false,
      staleReason: null,
    },
    contributing,
  }
}

function buildSignatureInputs(input: TrafficLightScoringInput): TrafficLightSignatureInputs {
  return {
    healthDiagnosisUpdatedAt: input.healthDiagnosis.updatedAt,
    predictionUpdatedAt: input.prediction.updatedAt,
    riskSummaryUpdatedAt: input.risk.updatedAt,
    resourceSummaryUpdatedAt: input.resource.updatedAt,
    dashboardUpdatedAt: input.task.updatedAt,
    taskOverdueCount: input.task.overdueCount,
    milestoneStatusSummary: input.milestone.available
      ? `atRisk:${input.milestone.atRiskCount},missed:${input.milestone.missedCount}`
      : null,
    changeImpactCount: input.changeImpact.highImpactCount,
    availableSources: input.sources.filter((s) => s.available && !s.forbidden).map((s) => s.type),
  }
}

// ─── Review State Transitions ────────────────────────────────────────────────────

/** 允许的复核状态转换。 */
export function isValidReviewTransition(
  _from: TrafficLightReviewState | null,
  _to: TrafficLightReviewState,
): boolean {
  // 任意状态可转换到任意复核状态（均不修改项目事实）
  return true
}

/** 检查复核标记是否因输入签名变化而 stale。 */
export function isReviewStale(markerSignature: string, currentSignature: string): boolean {
  return markerSignature !== currentSignature
}
