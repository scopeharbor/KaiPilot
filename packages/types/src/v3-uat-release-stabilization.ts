/**
 * v3-uat-release-stabilization —— V3 UAT 与发布稳定化收口治理的共享契约（纯类型与纯函数，零运行时依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。它只定义
 * 类型、枚举常量、低敏校验纯函数与确定性校验规则；仓库工件（scope ledger / UAT matrix /
 * release evidence manifest）是 Markdown/JSON 文档，见 `docs/v2-v3/planning/v3-uat-release-stabilization/`。
 *
 * # 语义（对应 spec `v3-uat-release-stabilization` 与 design D1~D7）
 * - triage 六类：`release-blocking` / `known-issue` / `deferred` / `authorization-gated` /
 *   `out-of-scope` / `accepted-risk`（spec：Blocker and deferral triage MUST be deterministic）。
 * - scope ledger：基于当前 OpenSpec 状态捕获；**V2.5 release map 不得作为 V3 release authority**；
 *   捕获时间超过 `SCOPE_CAPTURE_MAX_AGE_DAYS` 视为 stale 并阻塞发布声明。
 * - UAT matrix：release-critical workflow 必须有场景或显式延期，否则阻塞 release readiness。
 * - evidence manifest：failed/skipped/deferred/authorization-gated 门禁必须可见（带 triage note），
 *   不得静默省略；专项门禁（performance/security）缺失或不完整 → blocked/pending，**不得计为 passed**。
 * - 授权门：真实 OAuth/token、Webhook/Web Push、外部写回、公开发布、生产部署、大规模真实模型评测
 *   默认保持 authorization-gated；授权后按 `AuthorizedRealVerification` 模板记录。
 * - 低敏纪律：所有 summary/evidence 字段不得含 secret/token/原始 prompt/原始模型输出/provider 原始载荷/
 *   完整日志/生产数据/跨租户明细；`sanitizeUatEvidenceSummary` 复用 performance 模块的值级 redaction。
 */

// ── v3-release-gate-ai-quality-slots 导入 ──────────────────────────────────
import {
  AI_QUALITY_SLOT_IDS,
  validateAiQualitySlotTypedEvidence,
  type AiQualitySlotRecord,
} from './release-gate-ai-quality-slots.js'
import {
  validateEvidenceRecord,
  type ReleaseTrustEvidenceRecord,
} from './release-trust-and-evidence-center.js'

// =============================================================================
// 1. Triage 类别（spec：确定性分类）
// =============================================================================

/** 非通过 finding 的确定性分类（spec 原文顺序）。 */
export const UAT_TRIAGE_CATEGORIES = [
  'release-blocking',
  'known-issue',
  'deferred',
  'authorization-gated',
  'out-of-scope',
  'accepted-risk',
] as const
export type UatTriageCategory = (typeof UAT_TRIAGE_CATEGORIES)[number]

/** 常见别名 → 规范类别（归一化表，确定性）。 */
export const TRIAGE_CATEGORY_ALIASES: Record<string, UatTriageCategory> = {
  'release-blocking': 'release-blocking',
  blocking: 'release-blocking',
  blocker: 'release-blocking',
  'release blocker': 'release-blocking',
  'known-issue': 'known-issue',
  'known issue': 'known-issue',
  issue: 'known-issue',
  deferred: 'deferred',
  deferral: 'deferred',
  postponed: 'deferred',
  'authorization-gated': 'authorization-gated',
  'auth-gated': 'authorization-gated',
  gated: 'authorization-gated',
  'requires-authorization': 'authorization-gated',
  'out-of-scope': 'out-of-scope',
  excluded: 'out-of-scope',
  'accepted-risk': 'accepted-risk',
  accepted: 'accepted-risk',
  risk: 'accepted-risk',
}

/** 把任意输入归一化为规范 triage 类别；无法识别返回 undefined（调用方须显式处理）。 */
export function normalizeTriageCategory(raw: string): UatTriageCategory | undefined {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (key.length === 0) return undefined
  if (TRIAGE_CATEGORY_ALIASES[key]) return TRIAGE_CATEGORY_ALIASES[key]
  return (UAT_TRIAGE_CATEGORIES as readonly string[]).includes(key)
    ? (key as UatTriageCategory)
    : undefined
}

export const UAT_TRIAGE_LABELS: Record<UatTriageCategory, string> = {
  'release-blocking': '发布阻塞：未解决前禁止 release-ready 声明',
  'known-issue': '已知问题：有记录、有影响评估、不阻塞发布',
  deferred: '延期：有理由、有发布影响与后续路径，区别于 passed',
  'authorization-gated': '授权门：真实外部动作需用户明确授权，默认 fixture/mock',
  'out-of-scope': '范围外：明确排除，非缺口',
  'accepted-risk': '已接受风险：有边界与记录',
}

// =============================================================================
// 2. Scope ledger（D1：explicit and current-state based）
// =============================================================================

export const SCOPE_ENTRY_STATUSES = [
  'included',
  'excluded',
  'deferred',
  'authorization-gated',
  'active',
  'archived',
  'blocked',
] as const
export type ScopeEntryStatus = (typeof SCOPE_ENTRY_STATUSES)[number]

export const SCOPE_LEDGER_REQUIRED_ENTRY_FIELDS = ['id', 'label', 'status'] as const

/** ledger 捕获元数据（spec：Current OpenSpec state is captured）。 */
export interface ScopeLedgerCapture {
  /** 捕获日期，ISO `YYYY-MM-DD`。超过 SCOPE_CAPTURE_MAX_AGE_DAYS 即 stale。 */
  capturedAt: string
  /** `openspec-cn list` 结果存放路径（低敏）。 */
  openspecListRef: string
  /** 逐 change status 存放路径。 */
  perChangeStatusRefs?: string[]
  archivedDependencyRefs?: string[]
  gitHeadSha?: string
  graphFreshnessNote?: string
  progressRefs?: string[]
}

export interface ScopeLedgerEntry {
  id: string
  label: string
  status: ScopeEntryStatus
  rationale?: string
  /** 低敏证据路径（仓库相对）。 */
  sourceRefs?: string[]
}

export interface ScopeLedger {
  capture: ScopeLedgerCapture
  entries: ScopeLedgerEntry[]
  /** 仓库是否无权威 V3 release map（真实缺口必须记录，不得隐藏）。 */
  v3ReleaseMapGap: boolean
  /** 权威说明（低敏）；若把 V2.5 release map 当 V3 authority 会触发校验失败。 */
  authorityNote?: string
  /** 本 run 的权威依据路径（低敏）。 */
  authorityRefs?: string[]
}

/** V2.5 release map 的仓库路径（V3 authority 红线）。 */
export const V25_RELEASE_MAP_PATH = 'docs/v2-v3/planning/v2.5-release-map.md'
export const SCOPE_CAPTURE_MAX_AGE_DAYS = 7

export const SCOPE_LEDGER_ISSUE_KINDS = [
  'missing-capture',
  'invalid-captured-at',
  'stale-capture',
  'missing-required-field',
  'invalid-status',
  'v25-map-as-authority',
  'release-map-gap-unrecorded',
] as const
export type ScopeLedgerIssueKind = (typeof SCOPE_LEDGER_ISSUE_KINDS)[number]

export interface ScopeLedgerIssue {
  kind: ScopeLedgerIssueKind
  severity: 'blocking' | 'warning'
  entryId?: string
  message: string
}

/**
 * 确定性校验 scope ledger（任务 1.4）：
 * 必填字段、stale capture（> 7 天阻塞发布声明）、V2.5 map 不得作为 V3 authority。
 * `now` 仅供测试注入固定时间，默认取当前时间。
 */
export function validateScopeLedger(
  ledger: ScopeLedger,
  now: Date = new Date(),
): ScopeLedgerIssue[] {
  const issues: ScopeLedgerIssue[] = []

  if (!ledger.capture || typeof ledger.capture !== 'object') {
    issues.push({
      kind: 'missing-capture',
      severity: 'blocking',
      message: '缺少 capture 元数据（capturedAt/openspecListRef 必填）',
    })
    return issues
  }

  const parsed = new Date(ledger.capture.capturedAt)
  if (Number.isNaN(parsed.getTime())) {
    issues.push({
      kind: 'invalid-captured-at',
      severity: 'blocking',
      message: `capturedAt 不是合法日期：${ledger.capture.capturedAt}`,
    })
  } else {
    const ageDays = (now.getTime() - parsed.getTime()) / 86_400_000
    if (ageDays > SCOPE_CAPTURE_MAX_AGE_DAYS) {
      issues.push({
        kind: 'stale-capture',
        severity: 'blocking',
        message: `scope 捕获已过期（capturedAt=${ledger.capture.capturedAt}，超过 ${SCOPE_CAPTURE_MAX_AGE_DAYS} 天），发布声明被阻塞，须刷新捕获`,
      })
    }
  }
  if (!ledger.capture.openspecListRef || ledger.capture.openspecListRef.length === 0) {
    issues.push({
      kind: 'missing-required-field',
      severity: 'blocking',
      message: 'capture.openspecListRef 必填（`openspec-cn list` 结果路径）',
    })
  }

  for (const entry of ledger.entries) {
    for (const field of SCOPE_LEDGER_REQUIRED_ENTRY_FIELDS) {
      if (!entry[field as keyof ScopeLedgerEntry]) {
        issues.push({
          kind: 'missing-required-field',
          severity: 'blocking',
          entryId: entry.id,
          message: `条目缺少必填字段 ${field}`,
        })
      }
    }
    if (!(SCOPE_ENTRY_STATUSES as readonly string[]).includes(entry.status)) {
      issues.push({
        kind: 'invalid-status',
        severity: 'blocking',
        entryId: entry.id,
        message: `条目状态非法：${String(entry.status)}`,
      })
    }
  }

  // V2.5 map 不得作为 V3 authority（1.4 规则 / spec Requirement 1）
  const authorityText = `${ledger.authorityNote ?? ''} ${(ledger.authorityRefs ?? []).join(' ')}`
  if (
    authorityText.includes(V25_RELEASE_MAP_PATH) &&
    /authority|权威|依据|mandate/i.test(authorityText)
  ) {
    issues.push({
      kind: 'v25-map-as-authority',
      severity: 'blocking',
      message: `V2.5 release map（${V25_RELEASE_MAP_PATH}）是历史收口记录，不得作为 V3 release authority`,
    })
  }

  if (ledger.v3ReleaseMapGap !== true) {
    issues.push({
      kind: 'release-map-gap-unrecorded',
      severity: 'warning',
      message:
        '未记录 V3 release map 缺口（v3ReleaseMapGap 应为 true）：缺口必须显式记录，或最终 GA 声明保持 blocked',
    })
  }

  return issues
}

// =============================================================================
// 3. UAT matrix（D2：persona-and-risk based）
// =============================================================================

export const UAT_SCENARIO_SEVERITIES = ['release-blocking', 'high', 'medium', 'low'] as const
export type UatScenarioSeverity = (typeof UAT_SCENARIO_SEVERITIES)[number]

export const UAT_SCENARIO_STATUSES = ['planned', 'passed', 'failed', 'deferred', 'blocked'] as const
export type UatScenarioStatus = (typeof UAT_SCENARIO_STATUSES)[number]

/** release-critical 工作流（spec：Cross-role workflow coverage is present）。 */
export const RELEASE_CRITICAL_WORKFLOWS = [
  'project-task-workflows',
  'ai-draft-preview-confirm',
  'tenant-selection',
  'enterprise-governance',
  'audit-evidence',
  'reporting-export',
  'cross-tenant-negative',
] as const
export type ReleaseCriticalWorkflow = (typeof RELEASE_CRITICAL_WORKFLOWS)[number]

export const UAT_SCENARIO_REQUIRED_FIELDS = [
  'id',
  'workflow',
  'actor',
  'tenantContext',
  'fixture',
  'entryPoint',
  'expectedEvidence',
  'severity',
  'status',
] as const

export interface UatScenario {
  id: string
  workflow: string
  title?: string
  /** 执行角色，如 `专业PM` / `非专业入门者` / `组织管理员` / `super-admin`。 */
  actor: string
  /** 租户上下文（低敏），如 `测试组织 A`。 */
  tenantContext: string
  /** fixture / seed 数据引用（低敏路径或描述）。 */
  fixture: string
  /** 工作流入点（URL/命令/UI 路径，低敏）。 */
  entryPoint: string
  /** 期望的低敏证据（断言/审计/行为）。 */
  expectedEvidence: string
  severity: UatScenarioSeverity
  status: UatScenarioStatus
  deferralReason?: string
  /** 断言清单（RBAC/租户隔离/预览/人工确认/审计等，任务 6.2）。 */
  assertions?: string[]
}

/** 工作流级显式延期（spec：Missing release-critical workflow blocks readiness 的豁免路径）。 */
export interface WorkflowDeferral {
  workflow: string
  reason: string
  impact: string
  followUpPath: string
}

export interface UatMatrix {
  scenarios: UatScenario[]
  workflowDeferrals?: WorkflowDeferral[]
}

export const UAT_MATRIX_ISSUE_KINDS = [
  'missing-release-critical-scenario',
  'invalid-severity',
  'invalid-status',
  'missing-required-field',
  'blocking-scenario-failed',
  'deferred-without-reason',
  'duplicate-scenario-id',
] as const
export type UatMatrixIssueKind = (typeof UAT_MATRIX_ISSUE_KINDS)[number]

export interface UatMatrixIssue {
  kind: UatMatrixIssueKind
  severity: 'blocking' | 'warning'
  workflow?: string
  scenarioId?: string
  message: string
}

/**
 * 确定性校验 UAT matrix（任务 3.3）：
 * 每个 release-critical workflow 必须有 planned/passed 场景，或显式 workflowDeferrals 延期，
 * 否则 release readiness 阻塞。
 */
export function validateUatMatrix(
  matrix: UatMatrix,
  requiredWorkflows: readonly string[] = RELEASE_CRITICAL_WORKFLOWS,
): UatMatrixIssue[] {
  const issues: UatMatrixIssue[] = []
  const seenIds = new Set<string>()

  const coveredByScenario = new Map<string, boolean>()
  const deferredWorkflows = new Set((matrix.workflowDeferrals ?? []).map((d) => d.workflow))

  for (const scenario of matrix.scenarios) {
    if (seenIds.has(scenario.id)) {
      issues.push({
        kind: 'duplicate-scenario-id',
        severity: 'warning',
        scenarioId: scenario.id,
        message: `场景 id 重复：${scenario.id}`,
      })
    }
    seenIds.add(scenario.id)

    for (const field of UAT_SCENARIO_REQUIRED_FIELDS) {
      const value = scenario[field as keyof UatScenario]
      if (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.length === 0)
      ) {
        issues.push({
          kind: 'missing-required-field',
          severity: 'blocking',
          scenarioId: scenario.id,
          message: `场景 ${scenario.id} 缺少必填字段 ${field}`,
        })
      }
    }
    if (!(UAT_SCENARIO_SEVERITIES as readonly string[]).includes(scenario.severity)) {
      issues.push({
        kind: 'invalid-severity',
        severity: 'blocking',
        scenarioId: scenario.id,
        message: `场景 ${scenario.id} 严重度非法：${String(scenario.severity)}`,
      })
    }
    if (!(UAT_SCENARIO_STATUSES as readonly string[]).includes(scenario.status)) {
      issues.push({
        kind: 'invalid-status',
        severity: 'blocking',
        scenarioId: scenario.id,
        message: `场景 ${scenario.id} 状态非法：${String(scenario.status)}`,
      })
    }
    if (scenario.status === 'deferred' && !scenario.deferralReason) {
      issues.push({
        kind: 'deferred-without-reason',
        severity: 'warning',
        scenarioId: scenario.id,
        message: `场景 ${scenario.id} 标记 deferred 但缺少 deferralReason`,
      })
    }
    if (
      scenario.severity === 'release-blocking' &&
      (scenario.status === 'failed' || scenario.status === 'blocked')
    ) {
      issues.push({
        kind: 'blocking-scenario-failed',
        severity: 'blocking',
        scenarioId: scenario.id,
        message: `release-blocking 场景 ${scenario.id} 状态为 ${scenario.status}，release readiness 阻塞`,
      })
    }
    if (scenario.status === 'planned' || scenario.status === 'passed') {
      coveredByScenario.set(scenario.workflow, true)
    }
  }

  for (const workflow of requiredWorkflows) {
    if (!coveredByScenario.get(workflow) && !deferredWorkflows.has(workflow)) {
      issues.push({
        kind: 'missing-release-critical-scenario',
        severity: 'blocking',
        workflow,
        message: `release-critical 工作流 ${workflow} 无 planned/passed 场景且无显式延期，release readiness 阻塞`,
      })
    }
  }

  for (const deferral of matrix.workflowDeferrals ?? []) {
    if (!deferral.reason || !deferral.impact || !deferral.followUpPath) {
      issues.push({
        kind: 'deferred-without-reason',
        severity: 'warning',
        workflow: deferral.workflow,
        message: `工作流延期缺少 reason/impact/followUpPath：${deferral.workflow}`,
      })
    }
  }

  return issues
}

// =============================================================================
// 4. Evidence manifest（D3：low-sensitive handles；D5：专项门禁摘要）
// =============================================================================

export const UAT_GATE_STATUSES = [
  'passed',
  'failed',
  'skipped',
  'deferred',
  'authorization-gated',
  'pending',
  'blocked',
] as const
export type UatGateStatus = (typeof UAT_GATE_STATUSES)[number]

/**
 * manifest 必含的门槽（任务 3.5）。
 *
 * 注意：v3-release-gate-ai-quality-slots 新增的五个 AI 门槽
 * （ai-output-quality / ai-offline-regression / ai-cost / ai-model-drift / ai-security-events）
 * 存储在 manifest.aiQualitySlots[] 中，由 AI 专用校验逻辑检查，不在此数组中。
 * 此数组仅覆盖 gates[] 数组中的既有门槽。
 */
export const REQUIRED_MANIFEST_GATE_SLOTS = [
  'openspec',
  'typecheck',
  'lint',
  'format',
  'tests',
  'build',
  'browser-smoke',
  'specialized-gates',
  'uat-scenarios',
  'known-issues',
] as const
export type RequiredManifestGateSlot = (typeof REQUIRED_MANIFEST_GATE_SLOTS)[number]

/** 专项门禁（D5：只消费稳定摘要，不重复实现）。 */
export const SPECIALIZED_GATE_IDS = ['performance-scale', 'security-penetration'] as const
export type SpecializedGateId = (typeof SPECIALIZED_GATE_IDS)[number]

export const SPECIALIZED_GATE_STATUSES = [
  'passed',
  'failed',
  'pending',
  'blocked',
  'deferred',
  'authorization-gated',
] as const
export type SpecializedGateStatus = (typeof SPECIALIZED_GATE_STATUSES)[number]

export interface EvidenceGate {
  gateId: string
  name: string
  scope: string
  status: UatGateStatus
  command?: string
  /** 低敏结果摘要（写前过 sanitize）。 */
  resultSummary?: string
  timestamp?: string
  evidenceLocation?: string
  owner?: string
  /** 非 passed 门禁必须带 triage note（spec：failed gates visible with triage status）。 */
  triageNote?: string
  /** 取证方式与统一记录引用；由 release trust bundle 解析。 */
  mode?: 'rerun' | 'referenced'
  recordId?: string
}

/** 专项门禁稳定摘要（任务 5.1 字段集）。 */
export interface SpecializedGateSummary {
  gateId: SpecializedGateId
  /** 来源 change 名。 */
  sourceChange: string
  /** 来源工件/报告路径（低敏）。 */
  sourceArtifact: string
  scope: string
  status: SpecializedGateStatus
  blockingFindings: string[]
  residualRisk: string[]
  commandRefs: string[]
  date: string
  notes?: string
}

export interface TriageFinding {
  findingId: string
  category: UatTriageCategory
  /** 低敏摘要。 */
  summary: string
  rationale: string
  /** 低敏证据引用（路径/章节）。 */
  evidenceRef: string
  owner: string
  nextAction: string
  releaseImpact: string
}

/** 授权后真实外部验证记录（任务 5.5 模板；未授权不得产生）。 */
export interface AuthorizedRealVerification {
  verificationId: string
  gateId: AuthorizationGateId
  providerOrEndpoint: string
  model?: string
  callCount?: number
  tokenUsage?: number
  costBoundary: string
  resultSummary: string
  redactionBoundary: string
  authorizedBy: string
  authorizedAt: string
}

/** 发布声明等级（7.5：不得夸大）。 */
export const RELEASE_CLAIM_LEVELS = [
  'locally-stabilized',
  'locally-stabilized-with-deferrals',
  'v3-ga',
  'production-deployed',
  'real-external-validated',
] as const
export type ReleaseClaimLevel = (typeof RELEASE_CLAIM_LEVELS)[number]

export interface EvidenceManifest {
  manifestId: string
  createdAt: string
  releaseStatus: 'ready' | 'not-ready'
  releaseClaim: ReleaseClaimLevel
  gates: EvidenceGate[]
  specializedGates: SpecializedGateSummary[]
  findings: TriageFinding[]
  authorizedRealVerifications: AuthorizedRealVerification[]
  knownIssues: string[]
  /**
   * v3-release-gate-ai-quality-slots 新增：五个 AI 门槽记录。
   * 每个记录包含运行引用（D1）、判定口径（D5）、聚合描述（D3）。
   * 无此字段时，AI 门槽视为缺失（pending 输入，不得计为 passed）。
   */
  aiQualitySlots?: AiQualitySlotRecord[]
}

export interface EvidenceManifestValidationContext {
  currentHead: string
  records: readonly ReleaseTrustEvidenceRecord[]
}

export interface EvidenceManifestFreshness {
  status: 'current' | 'stale' | 'insufficient-evidence'
  staleGateIds: readonly string[]
  missingGateIds: readonly string[]
}

/** 新鲜度只由 typed record 的采集 HEAD 推导；createdAt 不参与判定。 */
export function deriveEvidenceManifestFreshness(
  manifest: EvidenceManifest,
  context: EvidenceManifestValidationContext,
): EvidenceManifestFreshness {
  const records = new Map(context.records.map((record) => [record.recordId, record]))
  const refs = [
    ...manifest.gates.map((gate) => ({ id: gate.gateId, recordId: gate.recordId })),
    ...(manifest.aiQualitySlots ?? []).map((slot) => ({
      id: slot.slotId,
      recordId: slot.recordId,
    })),
  ]
  const missingGateIds = refs
    .filter(({ recordId }) => !recordId || !records.has(recordId))
    .map(({ id }) => id)
    .sort()
  const staleGateIds = refs
    .filter(({ recordId }) => {
      const record = recordId ? records.get(recordId) : undefined
      return record !== undefined && record.collectedHead !== context.currentHead
    })
    .map(({ id }) => id)
    .sort()
  return {
    status:
      missingGateIds.length > 0
        ? 'insufficient-evidence'
        : staleGateIds.length > 0
          ? 'stale'
          : 'current',
    staleGateIds,
    missingGateIds,
  }
}

export const MANIFEST_ISSUE_KINDS = [
  'missing-required-field',
  'invalid-gate-status',
  'missing-gate-slot',
  'gate-not-triaged',
  'missing-specialized-gate',
  'specialized-gate-incomplete-passed',
  'specialized-gate-not-counted-as-passed',
  'release-blocking-unresolved',
  'contradicting-release-status',
  'overstating-claim',
  'deferred-without-rationale',
  'incomplete-authorized-verification',
  'sensitive-evidence',
  'invalid-specialized-status',
  'missing-evidence-record',
  'stale-evidence-record',
] as const
export type ManifestIssueKind = (typeof MANIFEST_ISSUE_KINDS)[number]

export interface ManifestIssue {
  kind: ManifestIssueKind
  severity: 'blocking' | 'warning' | 'info'
  subject: string
  message: string
}

const NON_PASSED_GATE_STATUSES: ReadonlySet<UatGateStatus> = new Set([
  'failed',
  'skipped',
  'deferred',
  'authorization-gated',
  'pending',
  'blocked',
])

/**
 * 确定性校验 evidence manifest（任务 3.6 / 5.2 / 7.5）：
 * - 必填门槽齐全；failed/skipped/deferred/authorization-gated 门禁必须可见且带 triage note；
 * - 专项门禁缺失/不完整 → blocked/pending，不得计为 passed；
 * - release-blocking finding 未解决 → releaseStatus 必须 not-ready；
 * - 发布声明不得夸大（无授权真实验证时不得声称 GA/生产/真实外部验证）。
 */
export function validateEvidenceManifest(
  manifest: EvidenceManifest,
  context?: EvidenceManifestValidationContext,
): ManifestIssue[] {
  const issues: ManifestIssue[] = []
  const subject = `manifest:${manifest.manifestId}`
  const recordMap = context
    ? new Map(context.records.map((record) => [record.recordId, record]))
    : undefined

  if (
    !manifest.manifestId ||
    !manifest.createdAt ||
    !manifest.releaseStatus ||
    !manifest.releaseClaim
  ) {
    issues.push({
      kind: 'missing-required-field',
      severity: 'blocking',
      subject,
      message: 'manifest 缺少必填字段（manifestId/createdAt/releaseStatus/releaseClaim）',
    })
  }
  if (manifest.releaseStatus !== 'ready' && manifest.releaseStatus !== 'not-ready') {
    issues.push({
      kind: 'missing-required-field',
      severity: 'blocking',
      subject,
      message: `releaseStatus 非法：${String(manifest.releaseStatus)}`,
    })
  }
  if (!(RELEASE_CLAIM_LEVELS as readonly string[]).includes(manifest.releaseClaim)) {
    issues.push({
      kind: 'missing-required-field',
      severity: 'blocking',
      subject,
      message: `releaseClaim 非法：${String(manifest.releaseClaim)}`,
    })
  }

  const gateIds = new Set<string>()
  for (const gate of manifest.gates) {
    gateIds.add(gate.gateId)
    if (!(UAT_GATE_STATUSES as readonly string[]).includes(gate.status)) {
      issues.push({
        kind: 'invalid-gate-status',
        severity: 'blocking',
        subject: `gate:${gate.gateId}`,
        message: `门禁状态非法：${String(gate.status)}`,
      })
    }
    if (NON_PASSED_GATE_STATUSES.has(gate.status) && !gate.triageNote) {
      issues.push({
        kind: 'gate-not-triaged',
        severity: 'blocking',
        subject: `gate:${gate.gateId}`,
        message: `门禁 ${gate.gateId} 状态为 ${gate.status} 但缺少 triageNote（不得静默省略非通过门禁）`,
      })
    }
    if (context && recordMap) {
      const record = gate.recordId ? recordMap.get(gate.recordId) : undefined
      if (!gate.recordId || !record) {
        issues.push({
          kind: 'missing-evidence-record',
          severity: 'blocking',
          subject: `gate:${gate.gateId}`,
          message: `门禁 ${gate.gateId} 只有散文结论或路径，未解析到 typed evidence record`,
        })
      } else {
        const recordIssues = validateEvidenceRecord(record)
        if (recordIssues.length > 0) {
          issues.push({
            kind: 'missing-evidence-record',
            severity: 'blocking',
            subject: `gate:${gate.gateId}`,
            message: `门禁 ${gate.gateId} 的 typed evidence record 缺少可复算 provenance`,
          })
        }
        if (record.collectedHead !== context.currentHead) {
          issues.push({
            kind: 'stale-evidence-record',
            severity: 'blocking',
            subject: `gate:${gate.gateId}`,
            message: `门禁 ${gate.gateId} 的 rerun 记录采自旧 HEAD ${record.collectedHead}；记录 HEAD 优先于 createdAt`,
          })
        }
      }
    }
  }
  for (const slot of REQUIRED_MANIFEST_GATE_SLOTS) {
    if (!gateIds.has(slot)) {
      issues.push({
        kind: 'missing-gate-slot',
        severity: 'blocking',
        subject,
        message: `缺少必填门槽：${slot}`,
      })
    }
  }

  for (const gateId of SPECIALIZED_GATE_IDS) {
    const summary = manifest.specializedGates.find((g) => g.gateId === gateId)
    if (!summary) {
      issues.push({
        kind: 'missing-specialized-gate',
        severity: 'blocking',
        subject: `specialized:${gateId}`,
        message: `专项门禁 ${gateId} 缺失：不得计为 passed，须记录为 pending/blocked 输入`,
      })
      continue
    }
    if (!(SPECIALIZED_GATE_STATUSES as readonly string[]).includes(summary.status)) {
      issues.push({
        kind: 'invalid-specialized-status',
        severity: 'blocking',
        subject: `specialized:${gateId}`,
        message: `专项门禁状态非法：${String(summary.status)}`,
      })
    }
    if (summary.status === 'passed') {
      const incomplete =
        summary.blockingFindings.length > 0 ||
        summary.commandRefs.length === 0 ||
        summary.date.length === 0 ||
        summary.sourceArtifact.length === 0
      if (incomplete) {
        issues.push({
          kind: 'specialized-gate-incomplete-passed',
          severity: 'blocking',
          subject: `specialized:${gateId}`,
          message: `专项门禁 ${gateId} 标记 passed 但不完整（存在 blocking findings / 缺命令引用 / 缺日期 / 缺来源工件），passed 声明无效`,
        })
      }
    } else {
      // 未通过（pending/blocked/…）不得被任何统计计为 passed（5.2 语义）
      issues.push({
        kind: 'specialized-gate-not-counted-as-passed',
        severity: 'warning',
        subject: `specialized:${gateId}`,
        message: `专项门禁 ${gateId} 状态为 ${summary.status}：作为 pending 输入处理，不计入 passed`,
      })
    }
  }

  const blockingFindings = manifest.findings.filter((f) => f.category === 'release-blocking')
  if (blockingFindings.length > 0 && manifest.releaseStatus === 'ready') {
    issues.push({
      kind: 'contradicting-release-status',
      severity: 'blocking',
      subject,
      message: `存在未解决 release-blocking finding（${blockingFindings.map((f) => f.findingId).join('、')}）但 releaseStatus=ready，必须为 not-ready`,
    })
  }
  if (blockingFindings.length === 0 && manifest.releaseStatus === 'not-ready') {
    issues.push({
      kind: 'release-blocking-unresolved',
      severity: 'info',
      subject,
      message:
        'releaseStatus=not-ready 且无 release-blocking finding：not-ready 由哪些输入驱动？需在 knownIssues/专项门禁中可见',
    })
  }

  const deferred = manifest.findings.filter((f) => f.category === 'deferred')
  for (const finding of deferred) {
    if (!finding.rationale || !finding.nextAction) {
      issues.push({
        kind: 'deferred-without-rationale',
        severity: 'warning',
        subject: `finding:${finding.findingId}`,
        message: `deferred finding ${finding.findingId} 缺少 rationale/nextAction（须与 passed 区分）`,
      })
    }
  }

  const overstateClaim = new Set<ReleaseClaimLevel>([
    'v3-ga',
    'production-deployed',
    'real-external-validated',
  ])
  if (
    overstateClaim.has(manifest.releaseClaim) &&
    manifest.authorizedRealVerifications.length === 0
  ) {
    issues.push({
      kind: 'overstating-claim',
      severity: 'blocking',
      subject,
      message: `releaseClaim=${manifest.releaseClaim} 但无任何 authorizedRealVerifications 记录：发布声明夸大（7.5 禁止）`,
    })
  }

  for (const verification of manifest.authorizedRealVerifications) {
    if (
      !verification.providerOrEndpoint ||
      !verification.resultSummary ||
      !verification.redactionBoundary
    ) {
      issues.push({
        kind: 'incomplete-authorized-verification',
        severity: 'warning',
        subject: `auth-verification:${verification.verificationId}`,
        message: `授权真实验证记录不完整（缺 providerOrEndpoint/resultSummary/redactionBoundary）`,
      })
    }
  }

  if (manifestContainsSensitiveEvidence(manifest)) {
    issues.push({
      kind: 'sensitive-evidence',
      severity: 'blocking',
      subject,
      message:
        'manifest 证据字段命中敏感内容（secret/token/prompt/模型输出/provider 载荷/日志），禁止入库存档',
    })
  }

  // ── v3-release-gate-ai-quality-slots AI 门槽校验 ──────────────────────────
  // D1: passed 状态必须携带 runReference
  // D2: 无数据时状态必须为 pending，绝不为 passed
  // D3: 门槽记录不含敏感内容
  if (manifest.aiQualitySlots) {
    const aiSlotIds = new Set<string>()
    for (const slot of manifest.aiQualitySlots) {
      aiSlotIds.add(slot.slotId)

      // D1: passed 必须有 runReference
      if (slot.status === 'passed' && !slot.runReference) {
        issues.push({
          kind: 'invalid-gate-status',
          severity: 'blocking',
          subject: `ai-slot:${slot.slotId}`,
          message: `AI 门槽 ${slot.slotId} 状态为 passed 但缺少 runReference：人工断言无法把门槽标为通过`,
        })
      }

      // D1: passed 的 runReference.runId 不能为空
      if (slot.status === 'passed' && slot.runReference && !slot.runReference.runId) {
        issues.push({
          kind: 'invalid-gate-status',
          severity: 'blocking',
          subject: `ai-slot:${slot.slotId}`,
          message: `AI 门槽 ${slot.slotId} 的 runReference.runId 为空：运行标识必须具体`,
        })
      }

      // D2: pending 状态不应有 runReference（或引用失效）
      if (slot.status === 'pending' && slot.runReference) {
        issues.push({
          kind: 'invalid-gate-status',
          severity: 'warning',
          subject: `ai-slot:${slot.slotId}`,
          message: `AI 门槽 ${slot.slotId} 状态为 pending 但有 runReference：引用可能失效`,
        })
      }

      // D3: 检查敏感内容
      const slotText = JSON.stringify(slot)
      if (containsSensitiveContent(slotText)) {
        issues.push({
          kind: 'sensitive-evidence',
          severity: 'blocking',
          subject: `ai-slot:${slot.slotId}`,
          message: `AI 门槽 ${slot.slotId} 记录命中敏感内容（secret/token/prompt/模型输出/provider 载荷），禁止入库存档`,
        })
      }
      if (context && recordMap) {
        const typed = validateAiQualitySlotTypedEvidence(
          slot,
          (recordId) => recordMap.get(recordId),
          context.currentHead,
        )
        if (!typed.valid) {
          issues.push({
            kind: typed.stale ? 'stale-evidence-record' : 'missing-evidence-record',
            severity: 'blocking',
            subject: `ai-slot:${slot.slotId}`,
            message: typed.message ?? `AI 门槽 ${slot.slotId} typed evidence 无效`,
          })
        }
      }
    }

    // 检查五个 AI 门槽是否齐全
    for (const aiSlotId of AI_QUALITY_SLOT_IDS) {
      if (!aiSlotIds.has(aiSlotId)) {
        issues.push({
          kind: 'missing-gate-slot',
          severity: 'blocking',
          subject: `ai-slot:${aiSlotId}`,
          message: `缺少必填 AI 门槽：${aiSlotId}（缺失时视为 pending 输入，不得计为 passed）`,
        })
      }
    }
  } else {
    // 无 aiQualitySlots 字段 → 五个 AI 门槽全部缺失
    for (const aiSlotId of AI_QUALITY_SLOT_IDS) {
      issues.push({
        kind: 'missing-gate-slot',
        severity: 'blocking',
        subject: `ai-slot:${aiSlotId}`,
        message: `缺少必填 AI 门槽：${aiSlotId}（缺失时视为 pending 输入，不得计为 passed）`,
      })
    }
  }

  return issues
}

// =============================================================================
// 5. 授权门（D6：默认延期；5.3 分类；5.4 不触发真实 provider）
// =============================================================================

export const AUTHORIZATION_GATE_IDS = [
  'real-oauth-token-exchange',
  'webhook-callback-outbound',
  'web-push',
  'external-writeback',
  'public-publishing',
  'production-deployment',
  'large-real-model-evaluation',
] as const
export type AuthorizationGateId = (typeof AUTHORIZATION_GATE_IDS)[number]

export interface AuthorizationGate {
  gateId: AuthorizationGateId
  label: string
  /** 解除门所需授权形式（低敏描述）。 */
  requiredAuthorization: string
  /** 未授权默认边界。 */
  defaultBoundary: string
}

export const AUTHORIZATION_GATES: readonly AuthorizationGate[] = [
  {
    gateId: 'real-oauth-token-exchange',
    label: '真实 OAuth/token 交换',
    requiredAuthorization: '用户明确授权真实 token 交换',
    defaultBoundary: '本地 fixture/mock + authorization-gated 证据',
  },
  {
    gateId: 'webhook-callback-outbound',
    label: 'Webhook 回调/外发',
    requiredAuthorization: '用户明确授权外发回调',
    defaultBoundary: '本地 fixture/mock + authorization-gated 证据',
  },
  {
    gateId: 'web-push',
    label: 'Web Push 外发',
    requiredAuthorization: '用户明确授权 Web Push 外发',
    defaultBoundary: '本地 fixture/mock + authorization-gated 证据',
  },
  {
    gateId: 'external-writeback',
    label: '外部写回（GitHub/GitLab 等）',
    requiredAuthorization: '用户明确授权外部写回',
    defaultBoundary: '只读证据/本地 fixture，不写回',
  },
  {
    gateId: 'public-publishing',
    label: '公开 npm 发布/公开发布',
    requiredAuthorization: '用户明确授权公开发布',
    defaultBoundary: '不发布，记录为授权门',
  },
  {
    gateId: 'production-deployment',
    label: '生产部署',
    requiredAuthorization: '用户明确授权生产部署',
    defaultBoundary: '本机/localhost 验证，不部署',
  },
  {
    gateId: 'large-real-model-evaluation',
    label: '大规模真实模型评测',
    requiredAuthorization: '用户明确授权（含成本/范围边界）',
    defaultBoundary: '少量受控调用或 fixture/mock，记录 provider/model/token',
  },
]

export function classifyAuthorizationGate(raw: string): AuthorizationGate | undefined {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '-')
  return AUTHORIZATION_GATES.find((gate) => gate.gateId === key || gate.label === raw.trim())
}

/** 外部动作证据种类（5.4：未授权真实动作只允许 fixture/mock/authorization-gated）。 */
export type ExternalActionEvidenceKind =
  'fixture' | 'mock' | 'authorization-gated' | 'real-invocation'

/** 未授权时禁止真实 provider 调用：只有 fixture/mock/authorization-gated 被允许。 */
export function assertNoRealProviderInvocation(kind: ExternalActionEvidenceKind): boolean {
  return kind === 'fixture' || kind === 'mock' || kind === 'authorization-gated'
}

/**
 * 证据一致性断言（任务 5.4）：某授权门动作在 manifest 中的证据种类必须与授权状态匹配——
 * 已授权 → 允许 real-invocation；未授权 → 只能是 fixture/mock/authorization-gated。
 */
export function assertUnauthorizedActionEvidence(
  manifest: EvidenceManifest,
  gateId: string,
  kind: ExternalActionEvidenceKind,
): boolean {
  const authorized = manifest.authorizedRealVerifications.some((v) => v.gateId === gateId)
  return authorized ? kind === 'real-invocation' : assertNoRealProviderInvocation(kind)
}

// =============================================================================
// 6. 授权后真实验证模板（任务 5.5）
// =============================================================================

/** 生成空模板（未填字段即无效记录；调用方填写后须再过低敏校验）。 */
export function makeAuthorizedRealVerificationTemplate(
  gateId: AuthorizationGateId,
): AuthorizedRealVerification {
  return {
    verificationId: '',
    gateId,
    providerOrEndpoint: '',
    costBoundary: '',
    resultSummary: '',
    redactionBoundary: '',
    authorizedBy: '',
    authorizedAt: '',
  }
}

// =============================================================================
// 7. 低敏 sanitizer（任务 2.4 / 4.4；复用 performance 模块值级 redaction）
// =============================================================================

import {
  containsSensitiveContent,
  countSensitiveHits,
  redactSensitiveText,
} from './performance-and-scale-gates.js'

/** 校验一段文本是否低敏（无 secret/token/prompt/模型输出/provider 载荷/日志等命中）。 */
export function validateEvidenceLowSensitive(text: string): { ok: boolean; hitCount: number } {
  const hitCount = countSensitiveHits(text)
  return { ok: hitCount === 0, hitCount }
}

/** 低敏化一段证据摘要（截断超长 + 值级 redaction）。返回的文本可安全写入 manifest/报告。 */
export function sanitizeUatEvidenceSummary(text: string, maxBytes = 16 * 1024): string {
  return redactSensitiveText(text, maxBytes).text
}

function manifestContainsSensitiveEvidence(manifest: EvidenceManifest): boolean {
  const texts: string[] = []
  for (const gate of manifest.gates) {
    if (gate.resultSummary) texts.push(gate.resultSummary)
    if (gate.triageNote) texts.push(gate.triageNote)
  }
  for (const summary of manifest.specializedGates) {
    texts.push(...summary.blockingFindings, ...summary.residualRisk)
  }
  for (const finding of manifest.findings) {
    texts.push(finding.summary, finding.rationale, finding.releaseImpact)
  }
  for (const verification of manifest.authorizedRealVerifications) {
    texts.push(verification.resultSummary, verification.costBoundary)
  }
  for (const issue of manifest.knownIssues) {
    texts.push(issue)
  }
  return texts.some((text) => containsSensitiveContent(text))
}

// =============================================================================
// 8. 必填工件检测（任务 4.1：missing artifact 必须低敏指出缺哪个）
// =============================================================================

export const REQUIRED_STABILIZATION_ARTIFACTS = [
  'openspec/changes/v3-uat-and-release-stabilization/proposal.md',
  'openspec/changes/v3-uat-and-release-stabilization/design.md',
  'openspec/changes/v3-uat-and-release-stabilization/tasks.md',
  'openspec/changes/v3-uat-and-release-stabilization/specs/v3-uat-release-stabilization/spec.md',
  'openspec/changes/v3-uat-and-release-stabilization/observation-and-inventory.md',
  'docs/v2-v3/planning/v3-uat-release-stabilization/scope-ledger.md',
  'docs/v2-v3/planning/v3-uat-release-stabilization/uat-matrix.md',
  'docs/v2-v3/planning/v3-uat-release-stabilization/release-evidence-manifest.md',
  'docs/v2-v3/planning/v3-uat-release-stabilization/release-evidence-manifest.json',
  'packages/types/src/v3-uat-release-stabilization.ts',
  'scripts/check-v3-uat-stabilization.ts',
] as const

/** 返回缺失工件清单（低敏错误：只点名缺失路径，不 dump 内容）。 */
export function detectMissingRequiredArtifacts(present: readonly string[]): string[] {
  const presentSet = new Set(present)
  return REQUIRED_STABILIZATION_ARTIFACTS.filter((path) => !presentSet.has(path))
}

// =============================================================================
// 9. 整体稳定化评估（任务 4.1 / 7.5）
// =============================================================================

export interface StabilizationInput {
  /** 仓库中实际存在的工件路径（仓库相对 posix）。 */
  artifactsPresent: readonly string[]
  /** OpenSpec change tasks 是否全部勾选。 */
  tasksComplete: boolean
  ledger: ScopeLedger | null
  matrix: UatMatrix | null
  manifest: EvidenceManifest | null
  /** 仓库模式注入；fixture 可省略以保持纯领域测试。 */
  evidenceContext?: EvidenceManifestValidationContext
}

export interface UatStabilizationIssue {
  ruleId: string
  severity: 'blocking' | 'warning' | 'info'
  subject: string
  message: string
}

export interface StabilizationCheckResult {
  status: 'ready' | 'not-ready'
  issues: UatStabilizationIssue[]
  blockingCount: number
  warningCount: number
  summary: string
}

/** 组装单条 issue（ruleId 稳定；message 低敏）。 */
export function makeStabilizationIssue(
  ruleId: string,
  severity: 'blocking' | 'warning' | 'info',
  subject: string,
  message: string,
): UatStabilizationIssue {
  return { ruleId, severity, subject, message: sanitizeUatEvidenceSummary(message) }
}

/**
 * 本地 fixture-first 稳定化检查的纯函数核心（任务 4.1）：
 * 必填工件 / tasks 完成 / scope freshness / triage 一致性 / OpenSpec 就绪。
 * 任一 blocking issue → not-ready；无 blocking → ready（可含 warning）。
 */
export function evaluateStabilization(
  input: StabilizationInput,
  now: Date = new Date(),
): StabilizationCheckResult {
  const issues: UatStabilizationIssue[] = []

  for (const missing of detectMissingRequiredArtifacts(input.artifactsPresent)) {
    issues.push(
      makeStabilizationIssue('UAT-ART-001', 'blocking', missing, `缺少必填工件：${missing}`),
    )
  }

  if (!input.tasksComplete) {
    issues.push(
      makeStabilizationIssue(
        'UAT-ART-002',
        'blocking',
        'openspec-tasks',
        'OpenSpec change tasks 未全部勾选（release readiness 阻塞）',
      ),
    )
  }

  if (!input.ledger) {
    issues.push(
      makeStabilizationIssue('UAT-LED-001', 'blocking', 'scope-ledger', '缺少 scope ledger 输入'),
    )
  } else {
    for (const issue of validateScopeLedger(input.ledger, now)) {
      issues.push(
        makeStabilizationIssue(
          'UAT-LED-002',
          issue.severity,
          `scope-ledger:${issue.entryId ?? ''}`,
          `[${issue.kind}] ${issue.message}`,
        ),
      )
    }
  }

  if (!input.matrix) {
    issues.push(
      makeStabilizationIssue('UAT-MTX-001', 'blocking', 'uat-matrix', '缺少 UAT matrix 输入'),
    )
  } else {
    for (const issue of validateUatMatrix(input.matrix)) {
      issues.push(
        makeStabilizationIssue(
          'UAT-MTX-002',
          issue.severity,
          issue.workflow ?? issue.scenarioId ?? 'uat-matrix',
          `[${issue.kind}] ${issue.message}`,
        ),
      )
    }
  }

  if (!input.manifest) {
    issues.push(
      makeStabilizationIssue(
        'UAT-MAN-001',
        'blocking',
        'evidence-manifest',
        '缺少 release evidence manifest 输入',
      ),
    )
  } else {
    for (const issue of validateEvidenceManifest(input.manifest, input.evidenceContext)) {
      issues.push(
        makeStabilizationIssue(
          'UAT-MAN-002',
          issue.severity,
          issue.subject,
          `[${issue.kind}] ${issue.message}`,
        ),
      )
    }
    for (const finding of input.manifest.findings) {
      if (finding.category === 'release-blocking') {
        issues.push(
          makeStabilizationIssue(
            'UAT-TRG-001',
            'blocking',
            `finding:${finding.findingId}`,
            `未解决 release-blocking finding：${finding.findingId}`,
          ),
        )
      }
    }
  }

  const blockingCount = issues.filter((i) => i.severity === 'blocking').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  const status = blockingCount === 0 ? 'ready' : 'not-ready'
  const summary = `V3 UAT 稳定化检查：${status}（blocking=${blockingCount}，warning=${warningCount}）`

  return { status, issues, blockingCount, warningCount, summary }
}

export function isUatReleaseReady(result: StabilizationCheckResult): boolean {
  return result.status === 'ready'
}

/** 汇总 findings 分类计数（低敏，供报告展示）。 */
export function summarizeUatFindings(
  findings: readonly TriageFinding[],
): Record<UatTriageCategory, number> {
  const counts = Object.fromEntries(
    UAT_TRIAGE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<UatTriageCategory, number>
  for (const finding of findings) {
    counts[finding.category] = (counts[finding.category] ?? 0) + 1
  }
  return counts
}

/** 汇总 manifest 门禁状态计数。 */
export function countUatGateStatuses(
  gates: readonly EvidenceGate[],
): Record<UatGateStatus, number> {
  const counts = Object.fromEntries(UAT_GATE_STATUSES.map((status) => [status, 0])) as Record<
    UatGateStatus,
    number
  >
  for (const gate of gates) {
    counts[gate.status] = (counts[gate.status] ?? 0) + 1
  }
  return counts
}
