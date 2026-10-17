/**
 * performance-and-scale-gates —— V3 性能与规模门禁共享契约（纯类型 + 常量 + 类型守卫 + 低敏 helpers，零运行时依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块），只定义
 * 类型、枚举常量、类型守卫、低敏 redaction helpers 与 gate catalog 校验 helpers。
 * deterministic runner 见 `performance-gate-runner.ts`，规模 fixture 见
 * `performance-scale-fixtures.ts`，初始 catalog 数据见 `performance-gate-catalog.ts`。
 *
 * # 语义要点（对应 design.md D1~D8 与 spec）
 * - Gate catalog 是事实入口：每个 gate 必须登记 id/surface/ownerCapability/scopeKind/profile/
 *   fixtureProfile/command/metrics/budgets/phase/severity/evidencePolicy/authorizationBoundary。
 *   未知 high-risk surface 必须产生 `catalog_gap` finding，不得静默放行。
 * - 预算分 hard/soft：hard 违规在 blocking severity 下阻断；soft 违规警告（除非 catalog 标记 blocking）。
 *   时间类指标默认抗抖：记录 environment summary / warmup / iterations / median-p95 / stability。
 * - 报告低敏：不得包含完整 stdout/stderr、prompt、模型输出、token、secret、provider 原始载荷、
 *   webhook body、完整源码、生产数据或跨租户明细；大输出只记录 byte count / hash / handle。
 * - 授权边界：真实 provider / 外部压测 / 外发 smoke / 大规模真实模型评测需要用户明确授权；
 *   未授权时 gate 必须 skipped/degraded 并给出 authorization-boundary reason。
 */

// =============================================================================
// 1. 枚举与常量（稳定 kebab-case 值，禁止随意改动；新增先更新 catalog 与测试）
// =============================================================================

/** V3 high-risk surface 稳定 ID。 */
export const GATE_SURFACES = [
  'project-task-wbs-gantt',
  'ai-draft-streaming',
  'compiler-run-validation',
  'multitenant-boundary',
  'enterprise-security',
  'report-export-job',
  'frontend-core-rendering',
  'contract-integrity',
] as const
export type GateSurface = (typeof GATE_SURFACES)[number]

/** 首批必须覆盖的 V3 high-risk surface（spec: Initial catalog MUST cover）。 */
export const REQUIRED_V3_HIGH_RISK_SURFACES: readonly GateSurface[] = [
  'project-task-wbs-gantt',
  'ai-draft-streaming',
  'compiler-run-validation',
  'multitenant-boundary',
  'enterprise-security',
  'report-export-job',
  'frontend-core-rendering',
] as const

/** gate 生命周期阶段。 */
export const GATE_PHASES = ['proposal', 'apply', 'archive', 'release', 'continuous'] as const
export type GatePhase = (typeof GATE_PHASES)[number]

/** 规模 profile：smoke 默认、v3-default 可选、stress-local 仅 archive/release 或显式运行。 */
export const GATE_PROFILES = ['smoke', 'v3-default', 'stress-local'] as const
export type GateProfile = (typeof GATE_PROFILES)[number]

/** 指标种类。 */
export const METRIC_KINDS = ['count', 'duration', 'bytes', 'ratio', 'boolean', 'hash'] as const
export type MetricKind = (typeof METRIC_KINDS)[number]

/** 预算档位：hard = 确定性资源边界；soft = 时间类/环境敏感指标默认档。 */
export const BUDGET_KINDS = ['hard', 'soft'] as const
export type BudgetKind = (typeof BUDGET_KINDS)[number]

/** gate 结果状态（runner 输出语义）。 */
export const GATE_STATUSES = [
  'passed',
  'blocked',
  'warned',
  'degraded',
  'skipped',
  'waived',
  'catalog_gap',
] as const
export type GateStatus = (typeof GATE_STATUSES)[number]

/** 报告整体状态（聚合语义：任一 blocked → blocked；否则任一 warned → warned；任一 degraded/skipped → degraded；否则 passed）。 */
export const REPORT_STATUSES = ['passed', 'warned', 'degraded', 'blocked'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

/** waiver 类型。 */
export const WAIVER_TYPES = ['temporary', 'permanent'] as const
export type WaiverType = (typeof WAIVER_TYPES)[number]

/** 证据引用类别（低敏：仅路径/ID + 可选说明）。 */
export const EVIDENCE_KINDS = [
  'observation-manifest',
  'graph-probe',
  'source-fallback',
  'test-result',
  'report-file',
  'fixture-id',
  'openspec-spec',
] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

/** scope 绑定方式。 */
export const SCOPE_KINDS = ['change', 'surface', 'profile', 'global'] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]

/** 授权边界。 */
export const AUTHORIZATION_BOUNDARIES = [
  'local-only',
  'fixture-mock',
  'requires-user-authorization',
  'no-external',
] as const
export type AuthorizationBoundary = (typeof AUTHORIZATION_BOUNDARIES)[number]

/** degraded/skipped 原因码（必须显式登记，禁止静默退化）。 */
export const REASON_CODES = [
  'optional-dependency-missing',
  'external-not-authorized',
  'environment-unstable',
  'surface-not-stable',
  'command-not-found',
  'timeout',
  'fixture-db-unavailable',
] as const
export type ReasonCode = (typeof REASON_CODES)[number]

/** finding 代码（机器可判）。 */
export const FINDING_CODES = [
  'catalog_gap',
  'catalog-invalid',
  'hard-budget-exceeded',
  'soft-budget-exceeded',
  'command-failed',
  'missing-evidence',
  'needs-source-verification',
  'timeout',
  'waiver-expired',
  'redaction-violation',
] as const
export type FindingCode = (typeof FINDING_CODES)[number]

/** redaction 原因码。 */
export const REDACTION_REASON_CODES = [
  'secret',
  'token',
  'authorization-header',
  'prompt',
  'model-output',
  'provider-payload',
  'webhook-body',
  'oversized-log',
  'cross-tenant-id',
] as const
export type RedactionReasonCode = (typeof REDACTION_REASON_CODES)[number]

// =============================================================================
// 2. 类型守卫
// =============================================================================

export function isGateSurface(v: unknown): v is GateSurface {
  return typeof v === 'string' && (GATE_SURFACES as readonly string[]).includes(v)
}
export function isGateProfile(v: unknown): v is GateProfile {
  return typeof v === 'string' && (GATE_PROFILES as readonly string[]).includes(v)
}
export function isGateStatus(v: unknown): v is GateStatus {
  return typeof v === 'string' && (GATE_STATUSES as readonly string[]).includes(v)
}
export function isReportStatus(v: unknown): v is ReportStatus {
  return typeof v === 'string' && (REPORT_STATUSES as readonly string[]).includes(v)
}
export function isMetricKind(v: unknown): v is MetricKind {
  return typeof v === 'string' && (METRIC_KINDS as readonly string[]).includes(v)
}
export function isBudgetKind(v: unknown): v is BudgetKind {
  return typeof v === 'string' && (BUDGET_KINDS as readonly string[]).includes(v)
}
export function isReasonCode(v: unknown): v is ReasonCode {
  return typeof v === 'string' && (REASON_CODES as readonly string[]).includes(v)
}
export function isAuthorizationBoundary(v: unknown): v is AuthorizationBoundary {
  return typeof v === 'string' && (AUTHORIZATION_BOUNDARIES as readonly string[]).includes(v)
}
export function isFindingCode(v: unknown): v is FindingCode {
  return typeof v === 'string' && (FINDING_CODES as readonly string[]).includes(v)
}
export function isEvidenceKind(v: unknown): v is EvidenceKind {
  return typeof v === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(v)
}
export function isGatePhase(v: unknown): v is GatePhase {
  return typeof v === 'string' && (GATE_PHASES as readonly string[]).includes(v)
}
export function isWaiverType(v: unknown): v is WaiverType {
  return typeof v === 'string' && (WAIVER_TYPES as readonly string[]).includes(v)
}
// 3. 核心接口
// =============================================================================

/** 一条 metric 预算。 */
export interface MetricBudget {
  /** 指标名（kebab-case，与 catalog 校验的已知指标名对照）。 */
  metric: string
  kind: MetricKind
  /** hard 预算（确定性资源边界；超限在 blocking severity 下阻断）。 */
  hard?: number
  /** soft 预算（环境敏感；超限警告，除非 catalog 标记 blocking）。 */
  soft?: number
  unit?: string
  note?: string
}

/** gate catalog 条目（D3：事实入口，运行器只能执行 catalog 中登记的 gate）。 */
export interface GateCatalogEntry {
  /** 稳定 gate ID，kebab-case，如 `gantt-scale-smoke-1000`。 */
  id: string
  surface: GateSurface
  /** owner capability（OpenSpec capability id，如 `gantt-diagram`）。 */
  ownerCapability: string
  scopeKind: ScopeKind
  profile: GateProfile | GateProfile[]
  /** 使用的 fixture profile（`performance-scale-fixtures.ts` 注册）。 */
  fixtureProfile: string
  /** 本地可执行命令（probeKind=command/focused-test 时必填；低敏，不含 secret）。 */
  command?: string
  /** probe 种类。 */
  probeKind: 'contract' | 'fixture' | 'focused-test' | 'command' | 'degraded-placeholder'
  metrics: MetricBudget[]
  phase: GatePhase
  /** 默认严重度：warning（新 gate 起步）或 blocking（稳定后升级）。 */
  severity: 'warning' | 'blocking'
  evidencePolicy: {
    /** 允许出现在报告中的 evidence kind 白名单。 */
    allowedEvidenceKinds: EvidenceKind[]
    /** 输出上限（字节），超出按 oversized-log redact。 */
    maxOutputBytes: number
  }
  authorizationBoundary: AuthorizationBoundary
  /** 该 gate 允许的 degraded/skipped 原因码（显式登记，防止静默退化）。 */
  allowedReasonCodes: ReasonCode[]
  notes?: string
}

/** 环境摘要（时间类指标必须记录）。 */
export interface EnvironmentSummary {
  platform: string
  nodeVersion: string
  pnpmVersion?: string
  commit: string
  branch?: string
  profile: GateProfile
  graphVersion?: string
  graphFreshness: 'fresh' | 'stale' | 'unknown'
}

/** 低敏命令摘要（不含输出正文）。 */
export interface CommandSummary {
  command: string
  exitCode: number | null
  durationMs: number
  stdoutBytes: number
  stderrBytes: number
  stdoutHash: string
  stderrHash: string
  redactionWarnings: RedactionWarning[]
  outputHandle?: string
}

/** redaction 警告（仅记录原因 + 字节 + hash）。 */
export interface RedactionWarning {
  reason: RedactionReasonCode
  byteCount: number
  hash: string
}

/** metric 摘要（低敏，含阈值与稳定性标记）。 */
export interface MetricSummary {
  metric: string
  kind: MetricKind
  observed: number
  unit?: string
  /** 时间类指标：median/p95 聚合与稳定性标记。 */
  medianMs?: number
  p95Ms?: number
  iterationCount?: number
  warmupIterations?: number
  stability?: 'stable' | 'unstable'
  thresholds?: { hard?: number; soft?: number }
}

/** finding（低敏：summary 不含原始敏感材料）。 */
export interface GateFinding {
  code: FindingCode
  severity: 'error' | 'warning' | 'info'
  gateId?: string
  summary: string
  evidenceRefs: EvidenceRef[]
}

/** 证据引用：低敏，仅路径/ID + 可选说明。 */
export interface EvidenceRef {
  kind: EvidenceKind
  /** 仓库相对路径或稳定 ID（如 manifest id / fixture id）。 */
  path?: string
  id?: string
  note?: string
}

/** waiver：必须含 reason、expiry 或 follow-up ref、approver 类别与受影响 gate IDs。 */
export interface Waiver {
  waiverId: string
  type: WaiverType
  gateIds: string[]
  reason: string
  expiresAt?: string
  followUpRef?: string
  approverCategory: string
  note?: string
}

/** Observation context（关联 OpenSpec change 与 Observation Plane）。 */
export interface ObservationContext {
  objective?: string
  scopeType?: string
  scopeId?: string
  manifestId?: string
  generatedAt?: string
  graphVersion?: string
  graphFreshness: 'fresh' | 'stale' | 'unknown'
  sourceFallbackRefs: EvidenceRef[]
}

/** redaction 汇总。 */
export interface RedactionSummary {
  redactedCount: number
  reasons: Partial<Record<RedactionReasonCode, number>>
}

/** gate 结果。 */
export interface GateResult {
  gateId: string
  surface: GateSurface
  status: GateStatus
  exitCode: number | null
  durationMs: number
  metricSummaries: MetricSummary[]
  commandSummary?: CommandSummary
  findings: GateFinding[]
  redactionSummary: RedactionSummary
  evidenceRefs: EvidenceRef[]
  reasonCode?: ReasonCode
  waiverRef?: string
}

/** 机器可读报告（D6：低敏且可归档）。 */
export interface PerformanceScaleGateReport {
  schemaVersion: '1.0'
  reportId: string
  generatedAt: string
  changeName?: string
  commit: string
  profile: GateProfile
  surface?: GateSurface
  gateIds?: string[]
  environment: EnvironmentSummary
  observation: ObservationContext
  commands: CommandSummary[]
  gates: GateResult[]
  metricSummaries: MetricSummary[]
  status: ReportStatus
  redactionSummary: RedactionSummary
  evidenceRefs: EvidenceRef[]
  waiverRefs: Waiver[]
  sourceFallback: { used: boolean; refs: EvidenceRef[]; graphIncomplete: boolean }
}

// =============================================================================
// 4. 低敏 redaction helpers（2.2）
// =============================================================================

/** 敏感模式表：reason + 正则 + 标签。 */
export const SENSITIVE_PATTERNS: ReadonlyArray<{
  reason: RedactionReasonCode
  pattern: RegExp
  label: string
}> = [
  {
    reason: 'secret',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
    label: 'private-key',
  },
  {
    reason: 'secret',
    pattern: /\b(?:ghp|gho|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/g,
    label: 'github-token',
  },
  {
    reason: 'token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    label: 'jwt',
  },
  {
    reason: 'token',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    label: 'api-key',
  },
  {
    reason: 'token',
    pattern: /\b(?:token|api[_-]?key|secret)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./]{12,}/gi,
    label: 'key-value',
  },
  {
    reason: 'authorization-header',
    pattern: /(?:authorization|proxy-authorization|proxy_authorization)\s*[:=]\s*[^\s,;]+/gi,
    label: 'auth-header',
  },
  {
    reason: 'prompt',
    pattern:
      /(?:<system>|<user>|<assistant>|system prompt|user prompt|你是一个|You are an? (?:AI|expert|assistant)|system_instruction)/gi,
    label: 'prompt-marker',
  },
  {
    reason: 'model-output',
    pattern:
      /(?:model_output|modelOutput|choices\[\d+\]\.text|generated_text|completion\.text|raw provider|provider_payload|providerPayload)/gi,
    label: 'model-output-marker',
  },
  {
    reason: 'provider-payload',
    pattern:
      /(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|dashscope|api\.deepseek\.com)(?:\/[^\s"']*)?/gi,
    label: 'provider-endpoint',
  },
  {
    reason: 'webhook-body',
    pattern:
      /(?:x-hub-signature|x-github-event|x-gitlab-event|x-webhook-signature|webhook_secret|webhookSecret)/gi,
    label: 'webhook-marker',
  },
  {
    reason: 'cross-tenant-id',
    pattern: /\b(?:tenant_id|tenantId|organization_id|organizationId)\s*[:=]\s*[A-Za-z0-9-]{8,}/gi,
    label: 'tenant-id',
  },
]

/** 逐值低敏扫描：文本中是否命中任何敏感模式（用于测试与守卫）。 */
export function containsSensitiveContent(text: string): boolean {
  if (text.length === 0) return false
  for (const { pattern } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) return true
  }
  return false
}

/** 统计文本中敏感命中的总次数（redaction-safety 指标用：剩余命中数 0 = 安全）。 */
export function countSensitiveHits(text: string): number {
  let hits = 0
  for (const { pattern } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      hits += 1
      if (m[0].length === 0) pattern.lastIndex += 1
    }
  }
  return hits
}

/** 确定性 32-bit FNV-1a hash（hex），低敏 hash 不依赖 node:crypto。 */
export function fnv1aHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 截断 + 打码一个敏感片段。 */
function maskFragment(fragment: string, label: string): string {
  const hash = fnv1aHash(fragment)
  return `[REDACTED:${label}:${hash.slice(0, 8)}]`
}

export interface RedactResult {
  text: string
  warnings: RedactionWarning[]
  redactedCount: number
}

/**
 * 低敏 redaction：把文本中的敏感内容替换为 `[REDACTED:label:hash]`，
 * 并逐类累计 RedactionWarning。超长日志按 oversized-log 截断（保留首尾 500 字 + hash）。
 * 返回的 text 可安全写入报告；warnings 只含原因/字节/hash。
 */
export function redactSensitiveText(text: string, maxBytes = 64 * 1024): RedactResult {
  const warnings: RedactionWarning[] = []
  const reasons: Partial<Record<RedactionReasonCode, number>> = {}
  let redactedCount = 0
  let current = text

  if (Buffer.byteLength(current, 'utf8') > maxBytes) {
    const hash = fnv1aHash(current)
    current = `[REDACTED:oversized-log:${hash.slice(0, 8)}]${current.slice(0, 500)}\n...\n${current.slice(-500)}`
    warnings.push({ reason: 'oversized-log', byteCount: Buffer.byteLength(text, 'utf8'), hash })
    reasons['oversized-log'] = (reasons['oversized-log'] ?? 0) + 1
    redactedCount += 1
  }

  for (const { reason, pattern, label } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0
    const matched = current.match(pattern)
    if (!matched) continue
    let count = 0
    current = current.replace(pattern, (frag) => {
      count += 1
      return maskFragment(frag, label)
    })
    if (count > 0) {
      redactedCount += count
      const hash = fnv1aHash(matched[0] ?? '')
      warnings.push({ reason, byteCount: (matched[0] ?? '').length, hash })
      reasons[reason] = (reasons[reason] ?? 0) + count
    }
  }

  return { text: current, warnings, redactedCount }
}

/** 汇总 warnings → RedactionSummary。 */
export function summarizeRedactions(warnings: RedactionWarning[]): RedactionSummary {
  const reasons: Partial<Record<RedactionReasonCode, number>> = {}
  for (const w of warnings) {
    reasons[w.reason] = (reasons[w.reason] ?? 0) + 1
  }
  return { redactedCount: warnings.reduce((acc, w) => acc + w.byteCount, 0), reasons }
}

// =============================================================================
// 5. Gate catalog 校验 helpers（2.3）
// =============================================================================

/** 已知 metric 名（新 metric 必须先登记；catalog 校验对未知 metric 报 warning）。 */
export const KNOWN_METRIC_NAMES = [
  'projects',
  'tasks',
  'wbs-nodes',
  'gantt-tasks',
  'dependency-edges',
  'critical-path-length',
  'tenant-count',
  'connection-count',
  'stream-events',
  'compiler-validations',
  'report-rows',
  'export-bytes',
  'job-count',
  'render-nodes',
  'fixture-determinism',
  'catalog-integrity',
  'redaction-safety',
  'waiver-validity',
  'schema-validity',
  'exit-code',
  'duration-ms',
  'stdout-bytes',
] as const
export type KnownMetricName = (typeof KNOWN_METRIC_NAMES)[number]

export interface CatalogIssue {
  kind:
    | 'missing-field'
    | 'duplicate-id'
    | 'unknown-surface'
    | 'unknown-profile'
    | 'unknown-metric'
    | 'budget-incompatible'
    | 'missing-owner-capability'
    | 'authorization-boundary'
    | 'missing-command'
    | 'reason-code-not-allowed'
    | 'missing-fixture-profile'
  gateId?: string
  message: string
}

/** 校验单个 catalog 条目（缺必填字段 / 未知枚举 / 预算兼容性）。 */
export function validateGateCatalogEntry(entry: GateCatalogEntry): CatalogIssue[] {
  const issues: CatalogIssue[] = []
  const missing = (field: string): void => {
    issues.push({
      kind: 'missing-field',
      gateId: entry.id,
      message: `gate ${entry.id} 缺必填字段 ${field}`,
    })
  }
  if (!entry.id || entry.id.trim() === '') missing('id')
  if (!entry.surface || !isGateSurface(entry.surface)) {
    issues.push({
      kind: 'unknown-surface',
      gateId: entry.id,
      message: `gate ${entry.id} 的 surface 未知: ${String(entry.surface)}`,
    })
  }
  if (!entry.ownerCapability || entry.ownerCapability.trim() === '') missing('ownerCapability')
  if (!entry.scopeKind) missing('scopeKind')
  const profiles = Array.isArray(entry.profile) ? entry.profile : [entry.profile]
  for (const p of profiles) {
    if (!isGateProfile(p)) {
      issues.push({
        kind: 'unknown-profile',
        gateId: entry.id,
        message: `gate ${entry.id} 的 profile 未知: ${String(p)}`,
      })
    }
  }
  if (!entry.fixtureProfile || entry.fixtureProfile.trim() === '') {
    issues.push({
      kind: 'missing-fixture-profile',
      gateId: entry.id,
      message: `gate ${entry.id} 缺 fixtureProfile`,
    })
  }
  if (entry.probeKind !== 'degraded-placeholder' && (!entry.metrics || entry.metrics.length === 0))
    missing('metrics')
  for (const m of entry.metrics ?? []) {
    if (!isMetricKind(m.kind)) {
      issues.push({
        kind: 'unknown-metric',
        gateId: entry.id,
        message: `gate ${entry.id} 的 metric ${m.metric} kind 未知: ${String(m.kind)}`,
      })
    }
    if (m.hard === undefined && m.soft === undefined) {
      issues.push({
        kind: 'budget-incompatible',
        gateId: entry.id,
        message: `gate ${entry.id} 的 metric ${m.metric} 缺 hard/soft 预算`,
      })
    }
    if (m.hard !== undefined && m.soft !== undefined && m.hard < m.soft) {
      issues.push({
        kind: 'budget-incompatible',
        gateId: entry.id,
        message: `gate ${entry.id} 的 metric ${m.metric} hard(${m.hard}) < soft(${m.soft}) 不兼容`,
      })
    }
    if (m.kind === 'count' && (m.hard ?? 0) < 0) {
      issues.push({
        kind: 'budget-incompatible',
        gateId: entry.id,
        message: `gate ${entry.id} 的 count metric ${m.metric} hard 不能为负`,
      })
    }
  }
  if (!entry.phase || !isGatePhase(entry.phase)) missing('phase')
  if (entry.severity !== 'warning' && entry.severity !== 'blocking') missing('severity')
  if (
    !entry.evidencePolicy ||
    !Array.isArray(entry.evidencePolicy.allowedEvidenceKinds) ||
    (entry.evidencePolicy.maxOutputBytes ?? 0) <= 0
  ) {
    missing('evidencePolicy')
  }
  if (!entry.authorizationBoundary || !isAuthorizationBoundary(entry.authorizationBoundary)) {
    issues.push({
      kind: 'authorization-boundary',
      gateId: entry.id,
      message: `gate ${entry.id} 缺有效 authorizationBoundary`,
    })
  }
  if ((entry.probeKind === 'focused-test' || entry.probeKind === 'command') && !entry.command) {
    issues.push({
      kind: 'missing-command',
      gateId: entry.id,
      message: `gate ${entry.id} probeKind=${entry.probeKind} 但缺 command`,
    })
  }
  if (!Array.isArray(entry.allowedReasonCodes)) missing('allowedReasonCodes')
  return issues
}

/** 校验整个 catalog（重复 id / 缺必填 surface / owner capability / 授权边界）。 */
export function validateGateCatalog(entries: GateCatalogEntry[]): CatalogIssue[] {
  const issues: CatalogIssue[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    issues.push(...validateGateCatalogEntry(entry))
    if (seen.has(entry.id)) {
      issues.push({ kind: 'duplicate-id', gateId: entry.id, message: `gate id 重复: ${entry.id}` })
    }
    seen.add(entry.id)
  }
  return issues
}

/** 检查 high-risk surface 是否在 catalog 中有覆盖（缺 → 调用方应产生 catalog_gap finding）。 */
export function findSurfaceCoverage(
  entries: GateCatalogEntry[],
  surface: GateSurface,
  profile: GateProfile,
): GateCatalogEntry[] {
  return entries.filter(
    (e) =>
      e.surface === surface &&
      (Array.isArray(e.profile) ? e.profile.includes(profile) : e.profile === profile),
  )
}

/** 未登记的 high-risk surface → catalog_gap finding（低敏）。 */
export function makeCatalogGapFinding(
  surface: string,
  evidenceRefs: EvidenceRef[] = [],
): GateFinding {
  return {
    code: 'catalog_gap',
    severity: 'error',
    summary: `high-risk surface 无 catalog 条目: ${surface}（未知 surface 不得静默放行）`,
    evidenceRefs,
  }
}

// =============================================================================
// 6. Waiver / 状态 / 报告 helpers（2.5 测试对象）
// =============================================================================

/** waiver 是否过期（expiresAt 为 ISO 日期字符串；无 expiresAt 视为永不过期）。 */
export function isWaiverExpired(waiver: Waiver, now: Date = new Date()): boolean {
  if (!waiver.expiresAt) return false
  const expiry = new Date(waiver.expiresAt)
  if (Number.isNaN(expiry.getTime())) return false
  return expiry.getTime() < now.getTime()
}

/** 合法状态迁移表（gate 生命周期）：允许的 from → to 集合。 */
export const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<GateStatus, readonly GateStatus[]>> = {
  passed: ['warned', 'degraded', 'waived'],
  warned: ['passed', 'degraded', 'blocked', 'waived'],
  degraded: ['passed', 'warned', 'waived', 'skipped'],
  skipped: ['waived', 'degraded'],
  blocked: ['passed', 'warned', 'waived'],
  waived: ['passed'],
  catalog_gap: ['waived'],
}

/** 状态迁移是否合法（用于 gate 生命周期断言与测试）；同状态自环视为合法。 */
export function canTransitionStatus(from: GateStatus, to: GateStatus): boolean {
  if (from === to) return true
  return ALLOWED_STATUS_TRANSITIONS[from]?.includes(to) ?? false
}

/** 聚合 gate 结果 → 报告状态。 */
export function aggregateReportStatus(gates: GateResult[]): ReportStatus {
  if (gates.some((g) => g.status === 'blocked')) return 'blocked'
  if (gates.some((g) => g.status === 'warned')) return 'warned'
  if (gates.some((g) => g.status === 'degraded' || g.status === 'skipped')) return 'degraded'
  return 'passed'
}

/** 生成稳定 reportId（确定性前缀 + 时间戳）。 */
export function makeReportId(
  changeName: string | undefined,
  profile: GateProfile,
  now: Date = new Date(),
): string {
  const prefix = changeName ? `perf-${changeName}` : 'perf'
  return `${prefix}-${profile}-${now.toISOString().replace(/[:.]/g, '-')}`
}

/** 报告 schema 校验（6.1 contract gate 使用）：返回 issue 列表。 */
export function validateReportSchema(report: unknown): string[] {
  const issues: string[] = []
  if (!report || typeof report !== 'object') return ['报告不是对象']
  const r = report as Partial<PerformanceScaleGateReport>
  if (r.schemaVersion !== '1.0') issues.push('schemaVersion 必须为 1.0')
  if (!r.reportId || typeof r.reportId !== 'string') issues.push('缺 reportId')
  if (!r.generatedAt) issues.push('缺 generatedAt')
  if (!r.profile || !isGateProfile(r.profile)) issues.push('profile 非法')
  if (!r.environment || typeof r.environment !== 'object') issues.push('缺 environment')
  if (!r.observation || typeof r.observation !== 'object') issues.push('缺 observation')
  if (!Array.isArray(r.commands)) issues.push('commands 必须是数组')
  if (!Array.isArray(r.gates)) issues.push('gates 必须是数组')
  if (!r.status || !isReportStatus(r.status)) issues.push('status 非法')
  if (!r.redactionSummary || typeof r.redactionSummary !== 'object')
    issues.push('缺 redactionSummary')
  if (!Array.isArray(r.evidenceRefs)) issues.push('evidenceRefs 必须是数组')
  if (!Array.isArray(r.waiverRefs)) issues.push('waiverRefs 必须是数组')
  return issues
}

/** 低敏 keyword 扫描（测试证明 finding/evidence 摘要不含敏感材料）。 */
export const GATE_SENSITIVE_KEYWORDS = [
  '-----BEGIN',
  'PRIVATE KEY',
  'sk-proj',
  'ghp_',
  'Bearer ',
  'authorization:',
  '<system>',
  'system prompt',
  '你是一个',
  'model_output',
  'choices[0].text',
  'api.openai.com',
  'x-hub-signature',
  'webhook_secret',
] as const
