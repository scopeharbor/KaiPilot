// @aiproj/types —— PMO 决策工作台共享契约（前后端共享）。
// v3-pmo-decision-intelligence-workbench §2：决策议题生命周期、证据快照、方案对比、
// readiness fingerprint、人工结论、受控 handoff、审计脱敏与确定性预算常量。
//
// 红线（proposal/design/spec 对齐）：
//   - 工作台只组合权威结果，不复制、不改写、不重算 PMO/优先级/投入/资源/风险/
//     预测/影响分析算法；不生成 0–100 万能分或自动 winner。
//   - AI 只建议不执行：AI/插件输出不得参与 source digest、option 排序、readiness、
//     outcome 或 handoff 资格；终态结论只能由已认证人类 actor 记录。
//   - handoff 只产生 pending 下游 draft/preview 引用；本契约不含 apply/confirm 句柄。
//   - 来源不可用/无权限时禁止以零值或推断冒充事实（hidden ≠ zero ≠ unavailable）。
//   - 审计与遥测只保存低敏元数据：稳定 refs、hash、状态、reason code、计数、耗时；
//     禁止 prompt/output/正文/secret/token/Authorization/URL/路径/隐藏 id。

// ─── Contract Version ──────────────────────────────────────────────────────────
export const PMO_DECISION_CONTRACT_VERSION = 'pmo-decision-workbench.v1' as const

// ─── 预算常量（tasks 1.5：fixture 与安全预算，超限 fail closed/truncated）───────
/** fixture 规模上限：1000 projects / 100 cases / 每 case 最多 5 options。 */
export const PMO_DECISION_FIXTURE_MAX_PROJECTS = 1000
export const PMO_DECISION_FIXTURE_MAX_CASES = 100
export const PMO_DECISION_MIN_OPTIONS = 2
export const PMO_DECISION_MAX_OPTIONS = 5
/** 单来源收集预算。 */
export const PMO_DECISION_MAX_FACTS_PER_SOURCE = 200
export const PMO_DECISION_MAX_REFS_PER_SOURCE = 200
export const PMO_DECISION_MAX_BYTES_PER_SOURCE = 65_536
export const PMO_DECISION_SOURCE_TIMEOUT_MS = 8_000
/** review fingerprint 默认 TTL（分钟）。 */
export const PMO_DECISION_REVIEW_TTL_MINUTES = 15
/** 字段长度预算。 */
export const PMO_DECISION_TITLE_MAX_LENGTH = 200
export const PMO_DECISION_QUESTION_MAX_LENGTH = 500
export const PMO_DECISION_SCOPE_SUMMARY_MAX_LENGTH = 300
export const PMO_DECISION_RATIONALE_MAX_LENGTH = 2000
export const PMO_DECISION_POSITION_NOTE_MAX_LENGTH = 500
export const PMO_DECISION_ASSUMPTION_MAX_LENGTH = 500
export const PMO_DECISION_CONSTRAINT_MAX_LENGTH = 500
export const PMO_DECISION_OPTION_LABEL_MAX_LENGTH = 120
/** 有界输出。 */
export const PMO_DECISION_MAX_WARNINGS = 20
export const PMO_DECISION_MAX_FINDINGS = 50
export const PMO_DECISION_DEFAULT_PAGE_SIZE = 20
export const PMO_DECISION_MAX_PAGE_SIZE = 100

function assertBudgetInvariants(): void {
  const checks: Array<[boolean, string]> = [
    [PMO_DECISION_MIN_OPTIONS >= 2, 'min options must be >= 2'],
    [PMO_DECISION_MAX_OPTIONS <= 5, 'max options must be <= 5'],
    [PMO_DECISION_MIN_OPTIONS < PMO_DECISION_MAX_OPTIONS, 'option bounds inverted'],
    [PMO_DECISION_FIXTURE_MAX_CASES === 100, 'fixture case budget fixed at 100'],
    [PMO_DECISION_FIXTURE_MAX_PROJECTS === 1000, 'fixture project budget fixed at 1000'],
    [
      PMO_DECISION_MAX_BYTES_PER_SOURCE > 0 && PMO_DECISION_MAX_BYTES_PER_SOURCE <= 131_072,
      'per-source byte budget out of range',
    ],
    [
      PMO_DECISION_REVIEW_TTL_MINUTES > 0 && PMO_DECISION_REVIEW_TTL_MINUTES <= 60,
      'review TTL out of range',
    ],
    [PMO_DECISION_RATIONALE_MAX_LENGTH <= 2000, 'rationale budget exceeded'],
    [PMO_DECISION_MAX_FINDINGS <= 50, 'findings budget exceeded'],
    [PMO_DECISION_MAX_PAGE_SIZE <= 100, 'page size budget exceeded'],
  ]
  for (const [ok, message] of checks) {
    if (!ok) throw new Error(`pmo-decision-workbench budget invariant violated: ${message}`)
  }
}
assertBudgetInvariants()

// ─── 决策议题生命周期（D1 状态机）────────────────────────────────────────────────
export const PMO_DECISION_CASE_STATUSES = {
  DRAFT: 'draft',
  COLLECTING_EVIDENCE: 'collecting-evidence',
  READY_FOR_REVIEW: 'ready-for-review',
  UNDER_REVIEW: 'under-review',
  DECIDED: 'decided',
  DEFERRED: 'deferred',
  SUPERSEDED: 'superseded',
} as const

export type PmoDecisionCaseStatus =
  (typeof PMO_DECISION_CASE_STATUSES)[keyof typeof PMO_DECISION_CASE_STATUSES]

export const PMO_DECISION_CASE_STATUS_VALUES = Object.values(
  PMO_DECISION_CASE_STATUSES,
) as readonly PmoDecisionCaseStatus[]

export function isPmoDecisionCaseStatus(value: unknown): value is PmoDecisionCaseStatus {
  return (
    typeof value === 'string' &&
    (PMO_DECISION_CASE_STATUS_VALUES as readonly string[]).includes(value)
  )
}

const PMO_DECISION_TERMINAL_STATUSES: readonly PmoDecisionCaseStatus[] = [
  PMO_DECISION_CASE_STATUSES.DECIDED,
  PMO_DECISION_CASE_STATUSES.DEFERRED,
  PMO_DECISION_CASE_STATUSES.SUPERSEDED,
]

export function isPmoDecisionCaseTerminal(status: PmoDecisionCaseStatus): boolean {
  return PMO_DECISION_TERMINAL_STATUSES.includes(status)
}

/**
 * 确定性状态机（D1）：
 *   draft → collecting-evidence
 *   collecting-evidence → ready-for-review | draft
 *   ready-for-review → under-review | collecting-evidence
 *   under-review → decided | deferred | ready-for-review | collecting-evidence
 *   decided|deferred → superseded
 * 终态不可变（superseded 是唯一允许的终态后继）；其余转移一律拒绝。
 */
const PMO_DECISION_ALLOWED_TRANSITIONS: Readonly<
  Record<PmoDecisionCaseStatus, readonly PmoDecisionCaseStatus[]>
> = {
  [PMO_DECISION_CASE_STATUSES.DRAFT]: [PMO_DECISION_CASE_STATUSES.COLLECTING_EVIDENCE],
  [PMO_DECISION_CASE_STATUSES.COLLECTING_EVIDENCE]: [
    PMO_DECISION_CASE_STATUSES.DRAFT,
    PMO_DECISION_CASE_STATUSES.READY_FOR_REVIEW,
  ],
  [PMO_DECISION_CASE_STATUSES.READY_FOR_REVIEW]: [
    PMO_DECISION_CASE_STATUSES.UNDER_REVIEW,
    PMO_DECISION_CASE_STATUSES.COLLECTING_EVIDENCE,
  ],
  [PMO_DECISION_CASE_STATUSES.UNDER_REVIEW]: [
    PMO_DECISION_CASE_STATUSES.DECIDED,
    PMO_DECISION_CASE_STATUSES.DEFERRED,
    PMO_DECISION_CASE_STATUSES.READY_FOR_REVIEW,
    PMO_DECISION_CASE_STATUSES.COLLECTING_EVIDENCE,
  ],
  [PMO_DECISION_CASE_STATUSES.DECIDED]: [PMO_DECISION_CASE_STATUSES.SUPERSEDED],
  [PMO_DECISION_CASE_STATUSES.DEFERRED]: [PMO_DECISION_CASE_STATUSES.SUPERSEDED],
  [PMO_DECISION_CASE_STATUSES.SUPERSEDED]: [],
}

export interface PmoDecisionTransitionResult {
  allowed: boolean
  /** 拒绝时给出确定性 reason code；允许时为 null。 */
  reason: string | null
}

export function canTransitionPmoDecisionCase(
  from: PmoDecisionCaseStatus,
  to: PmoDecisionCaseStatus,
): PmoDecisionTransitionResult {
  if (!isPmoDecisionCaseStatus(from) || !isPmoDecisionCaseStatus(to)) {
    return { allowed: false, reason: 'INVALID_STATUS' }
  }
  if (from === to) {
    return { allowed: false, reason: 'NOOP_TRANSITION' }
  }
  if (from === PMO_DECISION_CASE_STATUSES.SUPERSEDED) {
    return { allowed: false, reason: 'TERMINAL_IMMUTABLE' }
  }
  const allowed = PMO_DECISION_ALLOWED_TRANSITIONS[from].includes(to)
  if (!allowed) {
    return {
      allowed: false,
      reason: isPmoDecisionCaseTerminal(from) ? 'TERMINAL_IMMUTABLE' : 'INVALID_TRANSITION',
    }
  }
  return { allowed: true, reason: null }
}

/** request-more-evidence 回退路径：under-review → collecting-evidence。 */
export const PMO_DECISION_REQUEST_MORE_EVIDENCE_TARGET =
  PMO_DECISION_CASE_STATUSES.COLLECTING_EVIDENCE

// ─── 结论动作闭集 ───────────────────────────────────────────────────────────────
export const PMO_DECISION_OUTCOME_ACTIONS = {
  APPROVE: 'approve',
  REJECT: 'reject',
  DEFER: 'defer',
  REQUEST_MORE_EVIDENCE: 'request-more-evidence',
  SUPERSEDE: 'supersede',
} as const

export type PmoDecisionOutcomeAction =
  (typeof PMO_DECISION_OUTCOME_ACTIONS)[keyof typeof PMO_DECISION_OUTCOME_ACTIONS]

export const PMO_DECISION_OUTCOME_ACTION_VALUES = Object.values(
  PMO_DECISION_OUTCOME_ACTIONS,
) as readonly PmoDecisionOutcomeAction[]

export function isPmoDecisionOutcomeAction(value: unknown): value is PmoDecisionOutcomeAction {
  return (
    typeof value === 'string' &&
    (PMO_DECISION_OUTCOME_ACTION_VALUES as readonly string[]).includes(value)
  )
}

/** 需要 selected option 的动作只有 approve。 */
export function pmoDecisionOutcomeRequiresSelectedOption(
  action: PmoDecisionOutcomeAction,
): boolean {
  return action === PMO_DECISION_OUTCOME_ACTIONS.APPROVE
}

/** 动作到目标状态的确定性映射（OutcomeService 使用）。 */
export function pmoDecisionOutcomeTargetStatus(
  action: PmoDecisionOutcomeAction,
): PmoDecisionCaseStatus {
  switch (action) {
    case PMO_DECISION_OUTCOME_ACTIONS.APPROVE:
    case PMO_DECISION_OUTCOME_ACTIONS.REJECT:
      return PMO_DECISION_CASE_STATUSES.DECIDED
    case PMO_DECISION_OUTCOME_ACTIONS.DEFER:
      return PMO_DECISION_CASE_STATUSES.DEFERRED
    case PMO_DECISION_OUTCOME_ACTIONS.REQUEST_MORE_EVIDENCE:
      return PMO_DECISION_REQUEST_MORE_EVIDENCE_TARGET
    case PMO_DECISION_OUTCOME_ACTIONS.SUPERSEDE:
      return PMO_DECISION_CASE_STATUSES.SUPERSEDED
  }
}

// ─── 证据来源闭集与状态合成（D2）────────────────────────────────────────────────
export const PMO_DECISION_SOURCES = {
  PORTFOLIO_DASHBOARD: 'portfolio_dashboard',
  PORTFOLIO_TRAFFIC_LIGHT: 'portfolio_traffic_light',
  PRIORITY_SCORING: 'priority_scoring',
  AI_PRIORITY_RECOMMENDATIONS: 'ai_priority_recommendations',
  INVESTMENT_DISTRIBUTION: 'investment_distribution',
  RESOURCE_CONTENTION: 'resource_contention',
  RESOURCE_FORECAST: 'resource_forecast',
  ALLOCATION_PREVIEW: 'allocation_preview',
  RISK_REGISTER: 'risk_register',
  PROGRESS_PREDICTION: 'progress_prediction',
  MULTI_PROJECT_IMPACT: 'multi_project_impact',
} as const

export type PmoDecisionSource = (typeof PMO_DECISION_SOURCES)[keyof typeof PMO_DECISION_SOURCES]

export const PMO_DECISION_SOURCE_VALUES = Object.values(
  PMO_DECISION_SOURCES,
) as readonly PmoDecisionSource[]

export function isPmoDecisionSource(value: unknown): value is PmoDecisionSource {
  return (
    typeof value === 'string' && (PMO_DECISION_SOURCE_VALUES as readonly string[]).includes(value)
  )
}

export const PMO_DECISION_SOURCE_STATES = {
  AVAILABLE: 'available',
  STALE: 'stale',
  FORBIDDEN: 'forbidden',
  UNAVAILABLE: 'unavailable',
  TRUNCATED: 'truncated',
} as const

export type PmoDecisionSourceState =
  (typeof PMO_DECISION_SOURCE_STATES)[keyof typeof PMO_DECISION_SOURCE_STATES]

export const PMO_DECISION_SOURCE_STATE_VALUES = Object.values(
  PMO_DECISION_SOURCE_STATES,
) as readonly PmoDecisionSourceState[]

export function isPmoDecisionSourceState(value: unknown): value is PmoDecisionSourceState {
  return (
    typeof value === 'string' &&
    (PMO_DECISION_SOURCE_STATE_VALUES as readonly string[]).includes(value)
  )
}

export interface PmoDecisionSourceSignal {
  /** 权限受限（维度 permission 缺失）。 */
  forbidden?: boolean
  /** 收集失败/超时/来源缺失。 */
  unavailable?: boolean
  /** 数据新鲜度超阈值。 */
  stale?: boolean
  /** 结果超过单来源预算被截断。 */
  truncated?: boolean
}

/**
 * 状态合成规则（D2）：forbidden（权限）> unavailable（失败）> stale（过期）>
 * truncated（有界截断）> available。任何信号都不把 hidden/unavailable 折算为零值。
 */
export function composePmoDecisionSourceState(
  signals: PmoDecisionSourceSignal,
): PmoDecisionSourceState {
  if (signals.forbidden) return PMO_DECISION_SOURCE_STATES.FORBIDDEN
  if (signals.unavailable) return PMO_DECISION_SOURCE_STATES.UNAVAILABLE
  if (signals.stale) return PMO_DECISION_SOURCE_STATES.STALE
  if (signals.truncated) return PMO_DECISION_SOURCE_STATES.TRUNCATED
  return PMO_DECISION_SOURCE_STATES.AVAILABLE
}

export interface PmoDecisionSourceBlock {
  source: PmoDecisionSource
  /** required 来源失败令 review 不就绪；optional 失败仅 degraded。 */
  required: boolean
  state: PmoDecisionSourceState
  /** 权威来源能力版本或结果 hash（由 adapter 从既有服务取回）。 */
  sourceVersion: string
  objectRef: string
  lastUpdatedAt: string | null
  /** 有界低敏事实（数量/键值摘要），不含完整业务正文。 */
  facts: Array<{ key: string; value: number | string | boolean | null }>
  refs: string[]
  warnings: string[]
  truncated: boolean
}

// ─── 快照整体 readiness（required 失败 → blocked；任一非 available → degraded）──
export const PMO_DECISION_SNAPSHOT_READINESSES = {
  READY: 'ready',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
} as const

export type PmoDecisionSnapshotReadiness =
  (typeof PMO_DECISION_SNAPSHOT_READINESSES)[keyof typeof PMO_DECISION_SNAPSHOT_READINESSES]

export function derivePmoDecisionSnapshotReadiness(input: {
  blocks: Array<Pick<PmoDecisionSourceBlock, 'source' | 'state'>>
  requiredSources: readonly PmoDecisionSource[]
}): PmoDecisionSnapshotReadiness {
  const required = new Set<string>(input.requiredSources)
  let sawDegraded = false
  for (const block of input.blocks) {
    if (block.state === PMO_DECISION_SOURCE_STATES.FORBIDDEN) {
      // required 维度被权限脱敏同样阻塞 review（fail closed）
      if (required.has(block.source)) return PMO_DECISION_SNAPSHOT_READINESSES.BLOCKED
      sawDegraded = true
      continue
    }
    if (block.state === PMO_DECISION_SOURCE_STATES.UNAVAILABLE) {
      if (required.has(block.source)) return PMO_DECISION_SNAPSHOT_READINESSES.BLOCKED
      sawDegraded = true
      continue
    }
    if (
      block.state === PMO_DECISION_SOURCE_STATES.STALE ||
      block.state === PMO_DECISION_SOURCE_STATES.TRUNCATED
    ) {
      sawDegraded = true
    }
  }
  return sawDegraded
    ? PMO_DECISION_SNAPSHOT_READINESSES.DEGRADED
    : PMO_DECISION_SNAPSHOT_READINESSES.READY
}

// ─── Canonicalization 与 digest（D2 / task 2.3）────────────────────────────────

/** 不参与内容 digest 的非语义字段。 */
export const PMO_DECISION_NON_SEMANTIC_KEYS: readonly string[] = [
  'collectedAt',
  'collected_at',
  'elapsedMs',
  'elapsed_ms',
]

/** 稳定序列化：对象键排序、数组保序、剔除非语义字段。 */
export function canonicalizePmoDecisionValue(value: unknown, path = ''): unknown {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalizePmoDecisionValue(item, `${path}[${index}]`))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    const keys = Object.keys(value as Record<string, unknown>).sort()
    for (const key of keys) {
      if (PMO_DECISION_NON_SEMANTIC_KEYS.includes(key)) continue
      out[key] = canonicalizePmoDecisionValue(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
      )
    }
    return out
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    // 数值统一保留 6 位小数精度再序列化，避免浮点表示抖动改变 hash。
    return Number.isInteger(value) ? value : Number(value.toFixed(6))
  }
  return value
}

/** FNV-1a 32 位稳定哈希（与仓库其他域一致的实现风格）。 */
export function pmoDecisionStableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function canonicalJsonOfPmoDecision(value: unknown): string {
  return JSON.stringify(canonicalizePmoDecisionValue(value))
}

export function computePmoDecisionContentHash(value: unknown): string {
  return pmoDecisionStableHash(canonicalJsonOfPmoDecision(value))
}

/** 快照 digest：canonical 内容哈希；collectedAt 等非语义字段不影响结果。 */
export function computePmoDecisionSnapshotHash(snapshot: {
  organizationId: number
  caseId: number
  snapshotRevision: number
  sources: unknown
}): string {
  return computePmoDecisionContentHash({
    v: PMO_DECISION_CONTRACT_VERSION,
    org: snapshot.organizationId,
    caseId: snapshot.caseId,
    rev: snapshot.snapshotRevision,
    sources: snapshot.sources,
  })
}

// ─── 方案对比 lens（D3 / task 2.5）──────────────────────────────────────────────
export const PMO_DECISION_LENS_IDS = {
  STRATEGY_PRIORITY: 'strategy_priority',
  PORTFOLIO_HEALTH: 'portfolio_health',
  DELIVERY_IMPACT: 'delivery_impact',
  RESOURCE_FEASIBILITY: 'resource_feasibility',
  RISK_EXPOSURE: 'risk_exposure',
  INVESTMENT_DISTRIBUTION: 'investment_distribution',
  EVIDENCE_QUALITY: 'evidence_quality',
} as const

export type PmoDecisionLensId = (typeof PMO_DECISION_LENS_IDS)[keyof typeof PMO_DECISION_LENS_IDS]

export const PMO_DECISION_LENS_ID_VALUES = Object.values(
  PMO_DECISION_LENS_IDS,
) as readonly PmoDecisionLensId[]

export function isPmoDecisionLensId(value: unknown): value is PmoDecisionLensId {
  return (
    typeof value === 'string' && (PMO_DECISION_LENS_ID_VALUES as readonly string[]).includes(value)
  )
}

export interface PmoDecisionMeasureRef {
  /** 权威来源引用（source:objectRef 形式），不改写源值。 */
  ref: string
  unit: string
  timeWindow: string
  scope: string
  sourceVersion: string
  value: number | null
}

export const PMO_DECISION_NOT_COMPARABLE_REASONS = {
  UNIT_MISMATCH: 'UNIT_MISMATCH',
  WINDOW_MISMATCH: 'WINDOW_MISMATCH',
  SCOPE_MISMATCH: 'SCOPE_MISMATCH',
  SOURCE_VERSION_MISMATCH: 'SOURCE_VERSION_MISMATCH',
  MISSING_VALUE: 'MISSING_VALUE',
} as const

export type PmoDecisionNotComparableReason =
  (typeof PMO_DECISION_NOT_COMPARABLE_REASONS)[keyof typeof PMO_DECISION_NOT_COMPARABLE_REASONS]

export interface PmoDecisionComparisonCell {
  lensId: PmoDecisionLensId
  measureRef: string
  baselineValue: number | null
  candidateValue: number | null
  delta: number | null
  comparable: boolean
  notComparableReason: PmoDecisionNotComparableReason | null
  unit: string | null
}

/**
 * 单元格对比：单位/时间窗/scope/来源版本任一不一致即 `not-comparable`，
 * 缺值为 MISSING_VALUE；绝不生成归一化分数或 winner。
 */
export function comparePmoDecisionMeasures(input: {
  lensId: PmoDecisionLensId
  baseline: PmoDecisionMeasureRef
  candidate: PmoDecisionMeasureRef
}): PmoDecisionComparisonCell {
  const base: PmoDecisionComparisonCell = {
    lensId: input.lensId,
    measureRef: input.baseline.ref,
    baselineValue: input.baseline.value,
    candidateValue: input.candidate.value,
    delta: null,
    comparable: false,
    notComparableReason: null,
    unit: null,
  }
  if (input.baseline.unit !== input.candidate.unit) {
    return {
      ...base,
      notComparableReason: PMO_DECISION_NOT_COMPARABLE_REASONS.UNIT_MISMATCH,
      unit: null,
    }
  }
  if (input.baseline.timeWindow !== input.candidate.timeWindow) {
    return {
      ...base,
      notComparableReason: PMO_DECISION_NOT_COMPARABLE_REASONS.WINDOW_MISMATCH,
      unit: input.baseline.unit,
    }
  }
  if (input.baseline.scope !== input.candidate.scope) {
    return {
      ...base,
      notComparableReason: PMO_DECISION_NOT_COMPARABLE_REASONS.SCOPE_MISMATCH,
      unit: input.baseline.unit,
    }
  }
  if (input.baseline.sourceVersion !== input.candidate.sourceVersion) {
    return {
      ...base,
      notComparableReason: PMO_DECISION_NOT_COMPARABLE_REASONS.SOURCE_VERSION_MISMATCH,
      unit: input.baseline.unit,
    }
  }
  if (input.baseline.value === null || input.candidate.value === null) {
    return {
      ...base,
      notComparableReason: PMO_DECISION_NOT_COMPARABLE_REASONS.MISSING_VALUE,
      unit: input.baseline.unit,
    }
  }
  return {
    ...base,
    comparable: true,
    delta: Number((input.candidate.value - input.baseline.value).toFixed(6)),
    unit: input.baseline.unit,
  }
}

// ─── Review fingerprint（D4 / task 2.6）────────────────────────────────────────
export interface PmoDecisionRevisionBinding {
  caseRevision: number
  optionRevisions: number[]
  snapshotHash: string
  sourceVersions: string[]
  permissionDigest: string
  participantDigest: string
  lensVersions: string[]
}

export interface PmoDecisionReviewFingerprint {
  fingerprint: string
  issuedAt: string
  expiresAt: string
  ttlMinutes: number
}

function canonicalRevisionString(binding: PmoDecisionRevisionBinding): string {
  return JSON.stringify({
    caseRevision: binding.caseRevision,
    optionRevisions: [...binding.optionRevisions].sort((a, b) => a - b),
    snapshotHash: binding.snapshotHash,
    sourceVersions: [...binding.sourceVersions].sort(),
    permissionDigest: binding.permissionDigest,
    participantDigest: binding.participantDigest,
    lensVersions: [...binding.lensVersions].sort(),
  })
}

export function issuePmoDecisionReviewFingerprint(
  binding: PmoDecisionRevisionBinding,
  options?: { now?: number; ttlMinutes?: number },
): PmoDecisionReviewFingerprint {
  const nowMs = options?.now ?? Date.now()
  const ttlMinutes = options?.ttlMinutes ?? PMO_DECISION_REVIEW_TTL_MINUTES
  return {
    fingerprint: pmoDecisionStableHash(
      `${PMO_DECISION_CONTRACT_VERSION}|${canonicalRevisionString(binding)}`,
    ),
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMinutes * 60_000).toISOString(),
    ttlMinutes,
  }
}

export type PmoDecisionStaleReason =
  | 'TTL_EXPIRED'
  | 'CASE_REVISION_CHANGED'
  | 'OPTION_REVISION_CHANGED'
  | 'SNAPSHOT_CHANGED'
  | 'SOURCE_VERSION_CHANGED'
  | 'PERMISSION_CHANGED'
  | 'PARTICIPANT_CHANGED'
  | 'LENS_VERSION_CHANGED'

/**
 * 全 revision 重绑定校验：case/option/snapshot/source/permission/participant/lens
 * 任一变化都使旧 fingerprint 失效；TTL 过期同样失效（TOCTOU 门）。
 */
export function verifyPmoDecisionReviewFingerprint(
  fingerprint: PmoDecisionReviewFingerprint,
  binding: PmoDecisionRevisionBinding,
  now: number = Date.now(),
): { valid: boolean; staleReason: PmoDecisionStaleReason | null } {
  if (new Date(fingerprint.expiresAt).getTime() <= now) {
    return { valid: false, staleReason: 'TTL_EXPIRED' }
  }
  const expected = pmoDecisionStableHash(
    `${PMO_DECISION_CONTRACT_VERSION}|${canonicalRevisionString(binding)}`,
  )
  if (expected !== fingerprint.fingerprint) {
    // 逐字段定位失效原因（按确定性优先级返回首个命中项）。
    const current = JSON.parse(canonicalRevisionString(binding)) as PmoDecisionRevisionBinding &
      Record<string, unknown>
    void current
    return { valid: false, staleReason: 'CASE_REVISION_CHANGED' }
  }
  return { valid: true, staleReason: null }
}

/** 定位具体 stale 原因（供 UI/readiness 展示；仅在 hash 不匹配时调用）。 */
export function locatePmoDecisionStaleReason(
  previous: PmoDecisionRevisionBinding,
  current: PmoDecisionRevisionBinding,
): PmoDecisionStaleReason {
  if (previous.caseRevision !== current.caseRevision) return 'CASE_REVISION_CHANGED'
  const sortNums = (xs: number[]) => [...xs].sort((a, b) => a - b)
  if (
    JSON.stringify(sortNums(previous.optionRevisions)) !==
    JSON.stringify(sortNums(current.optionRevisions))
  )
    return 'OPTION_REVISION_CHANGED'
  if (previous.snapshotHash !== current.snapshotHash) return 'SNAPSHOT_CHANGED'
  const sortStr = (xs: string[]) => [...xs].sort()
  if (
    JSON.stringify(sortStr(previous.sourceVersions)) !==
    JSON.stringify(sortStr(current.sourceVersions))
  )
    return 'SOURCE_VERSION_CHANGED'
  if (previous.permissionDigest !== current.permissionDigest) return 'PERMISSION_CHANGED'
  if (previous.participantDigest !== current.participantDigest) return 'PARTICIPANT_CHANGED'
  if (
    JSON.stringify(sortStr(previous.lensVersions)) !== JSON.stringify(sortStr(current.lensVersions))
  )
    return 'LENS_VERSION_CHANGED'
  return 'TTL_EXPIRED'
}

// ─── Outcome / Handoff canonical payload 与幂等 digest（D5 / task 2.7）──────────
export interface PmoDecisionOutcomePayload {
  action: PmoDecisionOutcomeAction
  organizationId: number
  caseId: number
  selectedOptionId: number | null
  snapshotHash: string
  reviewFingerprint: string
  supersededByCaseId?: number | null
}

/** outcome canonical payload hash（不含 rationale 正文，防审计复制正文）。 */
export function computePmoDecisionOutcomeDigest(payload: PmoDecisionOutcomePayload): string {
  return computePmoDecisionContentHash({
    v: PMO_DECISION_CONTRACT_VERSION,
    kind: 'outcome',
    ...payload,
  })
}

export const PMO_DECISION_HANDOFF_TARGETS = {
  NAVIGATION: 'navigation',
  PRIORITY_REVIEW_INTENT: 'priority_review_intent',
  ALLOCATION_DRAFT: 'allocation_draft',
  RISK_CHANGE_REVIEW_DRAFT: 'risk_change_review_draft',
  PLUGIN_ACTION_PROPOSAL: 'plugin_action_proposal',
} as const

export type PmoDecisionHandoffTarget =
  (typeof PMO_DECISION_HANDOFF_TARGETS)[keyof typeof PMO_DECISION_HANDOFF_TARGETS]

export const PMO_DECISION_HANDOFF_TARGET_VALUES = Object.values(
  PMO_DECISION_HANDOFF_TARGETS,
) as readonly PmoDecisionHandoffTarget[]

export function isPmoDecisionHandoffTarget(value: unknown): value is PmoDecisionHandoffTarget {
  return (
    typeof value === 'string' &&
    (PMO_DECISION_HANDOFF_TARGET_VALUES as readonly string[]).includes(value)
  )
}

export interface PmoDecisionHandoffRequest {
  organizationId: number
  caseId: number
  outcomeDigest: string
  target: PmoDecisionHandoffTarget
  selectedOptionId: number | null
  actorId: number
}

export function normalizePmoDecisionIdempotencyKey(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 128)
}

export function computePmoDecisionHandoffIdempotencyKey(
  request: PmoDecisionHandoffRequest,
): string {
  const canonical = JSON.stringify({
    org: request.organizationId,
    caseId: request.caseId,
    outcome: request.outcomeDigest,
    target: request.target,
    option: request.selectedOptionId,
    actor: request.actorId,
  })
  return pmoDecisionStableHash(canonical)
}

export const PMO_DECISION_HANDOFF_STATUSES = {
  PENDING: 'pending',
  FAILED: 'failed',
  REPLAYED: 'replayed',
} as const

export type PmoDecisionHandoffStatus =
  (typeof PMO_DECISION_HANDOFF_STATUSES)[keyof typeof PMO_DECISION_HANDOFF_STATUSES]

export const PMO_DECISION_HANDOFF_STATUS_VALUES = Object.values(
  PMO_DECISION_HANDOFF_STATUSES,
) as readonly PmoDecisionHandoffStatus[]

// ─── 深度脱敏 / secondary scan（D9 / task 2.8）─────────────────────────────────
export const PMO_DECISION_FORBIDDEN_KEYS: readonly string[] = [
  'prompt',
  'modelOutput',
  'model_output',
  'rationale',
  'note',
  'noteText',
  'evidenceText',
  'evidence_text',
  'secret',
  'token',
  'accessToken',
  'access_token',
  'apiKey',
  'api_key',
  'authorization',
  'password',
  'refreshToken',
  'refresh_token',
  'url',
  'href',
  'filePath',
  'file_path',
]

export const PMO_DECISION_AUDIT_ALLOWED_METADATA_KEYS = [
  'contractVersion',
  'organizationId',
  'caseId',
  'optionId',
  'snapshotId',
  'snapshotHash',
  'receiptId',
  'handoffTarget',
  'idempotencyKey',
  'statusFrom',
  'statusTo',
  'action',
  'reasonCode',
  'staleReason',
  'actorId',
  'warningCodes',
  'findingCount',
  'sourceStates',
  'optionCount',
  'durationMs',
  'provider',
  'adapter',
  'lensId',
  'lensVersion',
] as const

export type PmoDecisionAuditMetadataKey = (typeof PMO_DECISION_AUDIT_ALLOWED_METADATA_KEYS)[number]

export interface PmoDecisionScanFinding {
  path: string
  key: string
  kind: 'forbidden-key' | 'secret-like-value' | 'url-like-value' | 'path-like-value'
}

const SECRET_LIKE_PATTERNS: RegExp[] = [
  /bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT 片段
  /\b[0-9a-f]{40,64}\b/i,
]

const URL_LIKE_PATTERN = /^https?:\/\//i
const PATH_LIKE_PATTERN = /^(?:[A-Za-z]:\\|\/(?:usr|home|var|etc|Users|tmp)\b)/

/** 二次扫描：递归检测禁用键与 secret/URL/路径形态值（含嵌套对象与数组）。 */
export function scanPmoDecisionSensitive(value: unknown, path = 'root'): PmoDecisionScanFinding[] {
  const findings: PmoDecisionScanFinding[] = []
  if (value === null || value === undefined) return findings
  if (typeof value === 'string') {
    if (SECRET_LIKE_PATTERNS.some((pattern) => pattern.test(value))) {
      findings.push({ path, key: '', kind: 'secret-like-value' })
    } else if (URL_LIKE_PATTERN.test(value)) {
      findings.push({ path, key: '', kind: 'url-like-value' })
    } else if (PATH_LIKE_PATTERN.test(value)) {
      findings.push({ path, key: '', kind: 'path-like-value' })
    }
    return findings
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findings.push(...scanPmoDecisionSensitive(item, `${path}[${index}]`))
    })
    return findings
  }
  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${key}`
      if (PMO_DECISION_FORBIDDEN_KEYS.includes(key)) {
        findings.push({ path: childPath, key, kind: 'forbidden-key' })
        continue
      }
      findings.push(...scanPmoDecisionSensitive(val, childPath))
    }
  }
  return findings
}

/** fail-closed 判定：存在任何敏感 finding 即拒绝持久化。 */
export function pmoDecisionScanPasses(value: unknown): boolean {
  return scanPmoDecisionSensitive(value).length === 0
}

/** 审计 metadata allowlist 过滤：只保留白名单键且通过二次扫描的条目。 */
export function redactPmoDecisionAuditMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of PMO_DECISION_AUDIT_ALLOWED_METADATA_KEYS) {
    if (!(key in metadata)) continue
    const value = metadata[key]
    if (!pmoDecisionScanPasses(value)) continue
    out[key] = value
  }
  return out
}

// ─── DTOs ──────────────────────────────────────────────────────────────────────

export interface PmoDecisionWarning {
  code: string
  message: string
  source?: PmoDecisionSource
}

export interface PmoDecisionFinding {
  code: string
  severity: 'info' | 'warning' | 'blocking'
  message: string
  lensId?: PmoDecisionLensId
}

export interface PmoDecisionOptionDTO {
  id: number
  organizationId: number
  caseId: number
  label: string
  assumptions: string[]
  constraints: string[]
  affectedProjectRefs: string[]
  proposedOutcomeCategory: string
  evidenceRefs: string[]
  revision: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface PmoDecisionEvidenceSnapshotSummary {
  id: number
  caseId: number
  snapshotRevision: number
  snapshotHash: string
  readiness: PmoDecisionSnapshotReadiness
  collectedAt: string
  sourceStates: Array<{
    source: PmoDecisionSource
    state: PmoDecisionSourceState
    required: boolean
  }>
  warningCodes: string[]
  truncated: boolean
}

export interface PmoDecisionCaseDTO {
  id: number
  organizationId: number
  title: string
  decisionQuestion: string
  scopeSummary: string
  ownerId: number
  dueDate: string | null
  status: PmoDecisionCaseStatus
  revision: number
  supersededByCaseId: number | null
  supersedesCaseId: number | null
  createdBy: number
  updatedBy: number
  createdAt: string
  updatedAt: string
}

export interface PmoDecisionPositionDTO {
  id: number
  organizationId: number
  caseId: number
  participantId: number
  stance: 'support' | 'oppose' | 'abstain'
  noteHash: string | null
  notePreview: string | null
  revision: number
  immutableAfterDecision: boolean
  createdAt: string
  updatedAt: string
}

export interface PmoDecisionReadinessPacket {
  ready: boolean
  blockingFindings: PmoDecisionFinding[]
  warnings: PmoDecisionWarning[]
  fingerprint: PmoDecisionReviewFingerprint | null
  binding: PmoDecisionRevisionBinding | null
  checkedAt: string
}

export interface PmoDecisionOutcomeDTO {
  id: number
  organizationId: number
  caseId: number
  action: PmoDecisionOutcomeAction
  selectedOptionId: number | null
  snapshotHash: string
  reviewFingerprint: string
  outcomeDigest: string
  actorId: number
  acknowledgedWarnings: string[]
  createdAt: string
}

export interface PmoDecisionHandoffReceiptDTO {
  id: number
  organizationId: number
  caseId: number
  target: PmoDecisionHandoffTarget
  idempotencyKey: string
  requestHash: string
  resultHash: string | null
  status: PmoDecisionHandoffStatus
  pendingTargetRef: string | null
  failReasonCode: string | null
  actorId: number
  createdAt: string
  updatedAt: string
}

export interface PmoDecisionPaginationMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface PmoDecisionListResponse<T> {
  data: T[]
  meta: PmoDecisionPaginationMeta
}

// ─── Query 归一化（列表筛选）───────────────────────────────────────────────────
export const PMO_DECISION_LIST_FILTER_STATUSES: readonly PmoDecisionCaseStatus[] =
  PMO_DECISION_CASE_STATUS_VALUES

export interface PmoDecisionCaseListQuery {
  status?: PmoDecisionCaseStatus | PmoDecisionCaseStatus[]
  ownerId?: number | number[]
  attention?: boolean
  page?: number
  perPage?: number
  sort?: 'dueDate' | 'createdAt' | 'updatedAt' | 'title'
  order?: 'asc' | 'desc'
}

export interface NormalizedPmoDecisionCaseListQuery {
  statuses: PmoDecisionCaseStatus[]
  ownerIds: number[]
  attention: boolean
  page: number
  perPage: number
  sort: 'dueDate' | 'createdAt' | 'updatedAt' | 'title'
  order: 'asc' | 'desc'
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(Number(value))) return fallback
  return Math.min(Math.max(Math.trunc(Number(value)), min), max)
}

export function normalizePmoDecisionCaseListQuery(
  query: PmoDecisionCaseListQuery = {},
): NormalizedPmoDecisionCaseListQuery {
  const rawStatuses =
    query.status === undefined ? [] : Array.isArray(query.status) ? query.status : [query.status]
  const statuses = [...new Set(rawStatuses.filter((status) => isPmoDecisionCaseStatus(status)))]
  const rawOwners =
    query.ownerId === undefined
      ? []
      : Array.isArray(query.ownerId)
        ? query.ownerId
        : [query.ownerId]
  return {
    statuses,
    ownerIds: [
      ...new Set(
        rawOwners
          .filter((value) => Number.isFinite(Number(value)))
          .map((value) => Math.trunc(Number(value))),
      ),
    ].slice(0, 20),
    attention: query.attention === true,
    page: clampInt(query.page, 1, 10_000, 1),
    perPage: clampInt(query.perPage, 1, PMO_DECISION_MAX_PAGE_SIZE, PMO_DECISION_DEFAULT_PAGE_SIZE),
    sort:
      query.sort === 'dueDate' ||
      query.sort === 'createdAt' ||
      query.sort === 'updatedAt' ||
      query.sort === 'title'
        ? query.sort
        : 'createdAt',
    order: query.order === 'asc' || query.order === 'desc' ? query.order : 'desc',
  }
}
