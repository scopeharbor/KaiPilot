/**
 * security-and-penetration-gate —— V3 安全与渗透测试门禁共享契约（纯类型 + 常量 + 类型守卫 +
 * 确定性 hash/序列化 + 低敏 sanitization + catalog 校验 helpers，零运行时依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块），只定义
 * 类型、枚举常量、类型守卫、低敏 redaction helpers 与 gate catalog 校验 helpers。
 * deterministic 规则引擎见 `security-and-penetration-gate-rules.ts`，catalog 与 attack
 * fixture 见 `security-and-penetration-gate-catalog.ts` / `-fixtures.ts`，CLI 见
 * `scripts/security-penetration-gate.ts`。
 *
 * # 语义要点（对应 design.md D1~D6 与 spec）
 * - Gate catalog 是事实入口：每个 gate 必须登记 id/domain/surface/ownerCapability/
 *   requiredEvidence/defaultFixturePack/blockingRuleFamily/authorizationBoundary/
 *   severity/expectedCommand。未知 high-risk surface 必须产生 `catalog_gap` finding。
 * - 状态语义：passed / warned / blocked / degraded / skipped / waived / catalog_gap；
 *   redline 违规（AI 自动执行、客户端权威租户/权限声明、跨租数据泄露、secret 持久化、
 *   未授权真实外部动作、无确认正式写入）一律 blocking，waiver 不能降级。
 * - 低敏纪律：finding/evidence/report 不含 raw prompt、模型输出、provider 原始载荷、
 *   raw SAML/XML、raw SCIM payload、Authorization 头、bearer/access/refresh token、
 *   API key、password/secret、明文/密文、wrapped data key、审计 changes/metadata 全量、
 *   OCR 全文、文件/报表正文、绝对存储路径、完整日志或跨租户数据。
 * - 授权边界：真实 IdP/SCIM/KMS/DLP/OCR/AI provider smoke、真实 OAuth/token exchange、
 *   webhook 外发、公开发布、外部扫描默认调用需要用户明确授权；未授权时 gate 必须
 *   skipped/degraded 并给出 authorization-boundary reason。
 */

// =============================================================================
// 1. 枚举与常量（稳定 kebab-case 值，禁止随意改动；新增先更新 catalog 与测试）
// =============================================================================

/** 安全域（首批 catalog 覆盖，对应 observation-and-inventory.md §6 的 18 类 surface）。 */
export const SECURITY_DOMAINS = [
  'authentication-session',
  'rbac-policy',
  'tenant-identification',
  'multitenant-api',
  'multitenant-database',
  'sso-saml2',
  'sso-oidc',
  'scim-provisioning',
  'kms-encryption',
  'dlp-watermarking',
  'compliance-evidence',
  'audit-integrity',
  'files-reports-ocr',
  'ai-compiler-boundary',
  'preview-confirm',
  'export-download',
  'background-jobs',
  'sse-streams',
  'idempotency',
] as const
export type SecurityDomain = (typeof SECURITY_DOMAINS)[number]

/** 首批必须覆盖的 V3 high-risk surface（spec: Requirement 2）。 */
export const REQUIRED_SECURITY_HIGH_RISK_SURFACES: readonly string[] = [
  'authentication-session',
  'rbac-policy',
  'tenant-identification',
  'multitenant-api',
  'multitenant-database',
  'sso-saml2',
  'sso-oidc',
  'scim-provisioning',
  'kms-encryption',
  'dlp-watermarking',
  'compliance-evidence',
  'audit-integrity',
  'files-reports-ocr',
  'ai-compiler-boundary',
  'preview-confirm',
  'export-download',
  'background-jobs',
  'sse-streams',
  'idempotency',
] as const

/** gate 结果状态（runner 输出语义）。 */
export const SECURITY_GATE_STATUSES = [
  'passed',
  'warned',
  'blocked',
  'degraded',
  'skipped',
  'waived',
  'catalog_gap',
] as const
export type SecurityGateStatus = (typeof SECURITY_GATE_STATUSES)[number]

/** 报告整体状态（聚合语义：任一 blocked → blocked；否则任一 warned → warned；任一 degraded/skipped → degraded；否则 passed）。 */
export const SECURITY_REPORT_STATUSES = ['passed', 'warned', 'degraded', 'blocked'] as const
export type SecurityReportStatus = (typeof SECURITY_REPORT_STATUSES)[number]

/** finding 严重度（blocking = redline 违规，waiver 不能降级）。 */
export const SECURITY_SEVERITIES = ['info', 'warning', 'blocking'] as const
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number]

/** 授权边界。 */
export const SECURITY_AUTHORIZATION_BOUNDARIES = [
  'local-only',
  'fixture-mock',
  'requires-user-authorization',
  'no-external',
] as const
export type SecurityAuthorizationBoundary = (typeof SECURITY_AUTHORIZATION_BOUNDARIES)[number]

/** blocked/degraded/skipped 原因码（必须显式登记，禁止静默退化）。 */
export const SECURITY_REASON_CODES = [
  'graph-stale',
  'graph-incomplete',
  'fixture-pack-missing',
  'neighbor-capability-absent',
  'external-not-authorized',
  'command-not-found',
  'test-not-run',
  'waiver-expired',
  'waiver-rejected-redline',
] as const
export type SecurityReasonCode = (typeof SECURITY_REASON_CODES)[number]

/** finding 代码（机器可判；redline 一律 blocking）。 */
export const SECURITY_FINDING_CODES = [
  'catalog_gap',
  'catalog-invalid',
  'redline-ai-auto-execution',
  'redline-client-authoritative-claim',
  'redline-tenant-leakage',
  'redline-secret-persistence',
  'redline-unauthorized-external-action',
  'redline-unconfirmed-formal-write',
  'missing-evidence',
  'stale-graph-absence',
  'needs-source-verification',
  'waiver-expired',
  'waiver-rejected-redline',
  'redaction-violation',
] as const
export type SecurityFindingCode = (typeof SECURITY_FINDING_CODES)[number]

/** 阻断性 redline 规则族（spec Requirement 6；waiver 不能静默放行）。 */
export const SECURITY_REDLINE_RULE_FAMILIES = [
  'ai-auto-execution',
  'client-authoritative-claim',
  'tenant-leakage',
  'secret-persistence',
  'unauthorized-external-action',
  'unconfirmed-formal-write',
  'auth-rbac-weakness',
  'sso-scim-scope-mismatch',
  'dlp-kms-compliance-bypass',
  'audit-mutation',
] as const
export type SecurityRedlineRuleFamily = (typeof SECURITY_REDLINE_RULE_FAMILIES)[number]

/** 证据引用类别（低敏：仅路径/ID + 可选说明）。 */
export const SECURITY_EVIDENCE_KINDS = [
  'observation-manifest',
  'graph-probe',
  'source-fallback',
  'test-result',
  'fixture-id',
  'openspec-spec',
  'report-file',
] as const
export type SecurityEvidenceKind = (typeof SECURITY_EVIDENCE_KINDS)[number]

/** 攻击场景类别（spec Requirement 3：P0 attack packs 覆盖清单）。 */
export const ATTACK_SCENARIO_KINDS = [
  'cross-tenant-enumeration',
  'horizontal-privilege-escalation',
  'vertical-privilege-escalation',
  'route-body-query-org-mismatch',
  'client-forged-decision',
  'handle-replay',
  'sso-replay-scope-mismatch',
  'scim-replay-scope-mismatch',
  'secret-token-leakage',
  'dlp-bypass',
  'audit-mutation',
  'path-traversal',
  'injection',
  'open-redirect',
  'oversized-input',
  'unconfirmed-formal-write',
  'unauthorized-external-action',
] as const
export type AttackScenarioKind = (typeof ATTACK_SCENARIO_KINDS)[number]

/** 攻击夹具期望结局（低敏，只描述期望行为）。 */
export const ATTACK_EXPECTED_OUTCOMES = [
  'non-leaking-failure',
  'scoped-success',
  'denied-before-side-effect',
  'blocked',
  'waived',
] as const
export type AttackExpectedOutcome = (typeof ATTACK_EXPECTED_OUTCOMES)[number]

/** 低敏 redaction 原因码。 */
export const SECURITY_REDACTION_REASON_CODES = [
  'secret',
  'token',
  'authorization-header',
  'prompt',
  'model-output',
  'provider-payload',
  'webhook-body',
  'raw-saml-xml',
  'raw-scim-payload',
  'file-body',
  'report-body',
  'audit-metadata',
  'absolute-path',
  'oversized-log',
  'cross-tenant-id',
] as const
export type SecurityRedactionReasonCode = (typeof SECURITY_REDACTION_REASON_CODES)[number]

// =============================================================================
// 2. 类型守卫
// =============================================================================

export function isSecurityDomain(v: unknown): v is SecurityDomain {
  return typeof v === 'string' && (SECURITY_DOMAINS as readonly string[]).includes(v)
}
export function isSecurityGateStatus(v: unknown): v is SecurityGateStatus {
  return typeof v === 'string' && (SECURITY_GATE_STATUSES as readonly string[]).includes(v)
}
export function isSecurityReportStatus(v: unknown): v is SecurityReportStatus {
  return typeof v === 'string' && (SECURITY_REPORT_STATUSES as readonly string[]).includes(v)
}
export function isSecuritySeverity(v: unknown): v is SecuritySeverity {
  return typeof v === 'string' && (SECURITY_SEVERITIES as readonly string[]).includes(v)
}
export function isSecurityAuthorizationBoundary(v: unknown): v is SecurityAuthorizationBoundary {
  return (
    typeof v === 'string' && (SECURITY_AUTHORIZATION_BOUNDARIES as readonly string[]).includes(v)
  )
}
export function isSecurityReasonCode(v: unknown): v is SecurityReasonCode {
  return typeof v === 'string' && (SECURITY_REASON_CODES as readonly string[]).includes(v)
}
export function isSecurityFindingCode(v: unknown): v is SecurityFindingCode {
  return typeof v === 'string' && (SECURITY_FINDING_CODES as readonly string[]).includes(v)
}
export function isSecurityRedlineRuleFamily(v: unknown): v is SecurityRedlineRuleFamily {
  return typeof v === 'string' && (SECURITY_REDLINE_RULE_FAMILIES as readonly string[]).includes(v)
}
export function isSecurityEvidenceKind(v: unknown): v is SecurityEvidenceKind {
  return typeof v === 'string' && (SECURITY_EVIDENCE_KINDS as readonly string[]).includes(v)
}
export function isAttackScenarioKind(v: unknown): v is AttackScenarioKind {
  return typeof v === 'string' && (ATTACK_SCENARIO_KINDS as readonly string[]).includes(v)
}
export function isAttackExpectedOutcome(v: unknown): v is AttackExpectedOutcome {
  return typeof v === 'string' && (ATTACK_EXPECTED_OUTCOMES as readonly string[]).includes(v)
}
export function isSecurityRedactionReasonCode(v: unknown): v is SecurityRedactionReasonCode {
  return typeof v === 'string' && (SECURITY_REDACTION_REASON_CODES as readonly string[]).includes(v)
}

/** 未知枚举统一判定：任何守卫失败的值不得被当作 passed。 */
export function isKnownSecurityValue(v: unknown): boolean {
  return (
    isSecurityDomain(v) ||
    isSecurityGateStatus(v) ||
    isSecuritySeverity(v) ||
    isSecurityFindingCode(v) ||
    isSecurityRedlineRuleFamily(v) ||
    isAttackScenarioKind(v)
  )
}

// =============================================================================
// 3. 核心接口
// =============================================================================

/** 一条证据引用：低敏，仅路径/ID + 可选说明。 */
export interface SecurityEvidenceRef {
  kind: SecurityEvidenceKind
  /** 仓库相对路径（source-fallback/openspec-spec/report-file）或稳定 ID（其余）。 */
  path?: string
  id?: string
  note?: string
}

/** gate catalog 条目（D1：事实入口，运行器只能执行 catalog 中登记的 gate）。 */
export interface SecurityGateCatalogEntry {
  /** 稳定 gate ID，kebab-case，如 `auth-session-redline`。 */
  gateId: string
  domain: SecurityDomain
  /** owner capability（OpenSpec capability id，如 `authentication`）。 */
  ownerCapability: string
  /** 该 gate 要求的最低证据（低敏描述列表）。 */
  requiredEvidence: string[]
  /** 默认 fixture pack 引用（`security-and-penetration-gate-fixtures.ts` 注册的 pack id）。 */
  defaultFixturePack: string
  /** 本地可执行验证命令（低敏，不含 secret）；缺省时须声明 degraded-placeholder 原因。 */
  expectedCommand?: string
  /** 阻断性规则族（redline）。 */
  blockingRuleFamily: SecurityRedlineRuleFamily
  authorizationBoundary: SecurityAuthorizationBoundary
  /** 默认严重度：warning（新 gate 起步）或 blocking（redline 稳定后升级）。 */
  severity: Extract<SecuritySeverity, 'warning' | 'blocking'>
  /** 该 gate 允许的 degraded/skipped 原因码（显式登记，防止静默退化）。 */
  allowedReasonCodes: SecurityReasonCode[]
  /** 关联的既有 focused test 文件（低敏路径，人工/CI 复核用）。 */
  evidenceTestRefs?: string[]
  notes?: string
}

/** 攻击场景夹具条目（spec Requirement 3：fixture-first、租户负极）。 */
export interface AttackScenarioFixture {
  /** 稳定 scenario ID，kebab-case，如 `x-tenant-enumeration-tasks`。 */
  scenarioId: string
  kind: AttackScenarioKind
  domain: SecurityDomain
  /** 人类可读名（低敏）。 */
  name: string
  /** 低敏描述：不含真实载荷/exploit 细节。 */
  description: string
  /** 是否双组织夹具意图（cross-tenant / scope-mismatch 类必须 true）。 */
  twoOrgIntent: boolean
  /** 期望结局（非泄露失败 / scoped 成功 / 副作用前拒绝 / blocked / waived）。 */
  expectedOutcome: AttackExpectedOutcome
  /** 夹具包引用。 */
  fixturePack: string
  /** 该夹具必须离线（默认 true：禁止真实 IdP/网络/provider）。 */
  offlineOnly: boolean
  /** 该夹具禁止出现的敏感键/字段（sanitization 测试对象）。 */
  forbiddenFields: string[]
  notes?: string
}

/** finding（低敏：summary/evidenceRefs 不含原始敏感材料）。 */
export interface SecurityFinding {
  /** 确定性 finding ID（规则 ID + subject path + source hash 派生）。 */
  findingId: string
  /** 规则 ID，如 `SEC-RL-001`（redline）/ `SEC-CAT-001`（catalog gap）。 */
  ruleId: string
  code: SecurityFindingCode
  severity: SecuritySeverity
  /** 结果状态：blocked / warned / degraded / waived / passed。 */
  status: SecurityGateStatus
  /** 主体路径（仓库相对路径或符号名，低敏）。 */
  subjectPath: string
  evidenceRefs: SecurityEvidenceRef[]
  /** 输入源 hash（确定性，低敏）。 */
  sourceHash: string
  /** 脱敏摘要。 */
  summary: string
  reasonCode?: SecurityReasonCode
  waiverRef?: string
}

/** waiver：必须含 ruleId/subjectPath/owner/reason/expiry/mitigation/evidenceRefs/approvalContext。 */
export interface SecurityWaiver {
  waiverId: string
  /** 仅 warning 级 finding 可 waiver；redline rule family 一律拒绝。 */
  ruleId: string
  subjectPath: string
  owner: string
  reason: string
  expiresAt?: string
  mitigation: string
  evidenceRefs: SecurityEvidenceRef[]
  approvalContext: string
  createdAt?: string
}

/** gate 结果。 */
export interface SecurityGateResult {
  gateId: string
  domain: SecurityDomain
  status: SecurityGateStatus
  severity: SecuritySeverity
  exitCode: number | null
  command?: string
  findings: SecurityFinding[]
  evidenceRefs: SecurityEvidenceRef[]
  reasonCode?: SecurityReasonCode
  waiverRef?: string
  durationMs: number
}

/** Observation context（关联 OpenSpec change 与 Observation Plane）。 */
export interface SecurityObservationContext {
  objective?: string
  scopeType?: string
  scopeId?: string
  manifestId?: string
  generatedAt?: string
  graphVersion?: string
  graphFreshness: 'fresh' | 'stale' | 'unknown'
  sourceFallbackRefs: SecurityEvidenceRef[]
}

/** 机器可读报告（D5：低敏且可归档）。 */
export interface SecurityGateReport {
  schemaVersion: '1.0'
  reportId: string
  generatedAt: string
  changeName?: string
  commit: string
  status: SecurityReportStatus
  environment: {
    platform: string
    nodeVersion: string
    commit: string
    graphVersion?: string
    graphFreshness: 'fresh' | 'stale' | 'unknown'
  }
  observation: SecurityObservationContext
  gates: SecurityGateResult[]
  findings: SecurityFinding[]
  evidenceRefs: SecurityEvidenceRef[]
  waiverRefs: SecurityWaiver[]
  degraded: Array<{
    gateId: string
    reasonCode: SecurityReasonCode
    sourceRefs: SecurityEvidenceRef[]
    nextProbes: string[]
  }>
  sourceFallback: { used: boolean; refs: SecurityEvidenceRef[]; graphIncomplete: boolean }
  redactionSummary: {
    redactedCount: number
    reasons: Partial<Record<SecurityRedactionReasonCode, number>>
  }
}

// =============================================================================
// 4. 确定性 hash / stable serialize / status normalization（2.2）
// =============================================================================

/** 确定性 32-bit FNV-1a hash（hex），低敏 hash 不依赖 node:crypto。 */
export function securityFnv1aHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 稳定序列化：递归稳定排序对象键（不同键序的等价对象产生相同字符串）。 */
export function securityStableSerialize(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => securityStableSerialize(v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${securityStableSerialize(obj[k])}`).join(',')}}`
}

/** 对象/数组/标量的确定性 source hash（key 序无关）。 */
export function computeSecuritySourceHash(value: unknown): string {
  return securityFnv1aHash(securityStableSerialize(value))
}

/** 规范化 gate 状态：未知/非法输入 → 'catalog_gap'（不得当作 passed）。 */
export function normalizeSecurityGateStatus(v: unknown): SecurityGateStatus {
  return isSecurityGateStatus(v) ? v : 'catalog_gap'
}

/** 规范化 severity：未知/非法输入 → 'warning'（保守；redline 由规则引擎显式抬升）。 */
export function normalizeSecuritySeverity(v: unknown): SecuritySeverity {
  return isSecuritySeverity(v) ? v : 'warning'
}

/** 聚合 gate 结果 → 报告状态。 */
export function aggregateSecurityReportStatus(gates: SecurityGateResult[]): SecurityReportStatus {
  if (gates.some((g) => g.status === 'blocked')) return 'blocked'
  if (gates.some((g) => g.status === 'warned')) return 'warned'
  if (gates.some((g) => g.status === 'degraded' || g.status === 'skipped')) return 'degraded'
  return 'passed'
}

/** 生成稳定 reportId（确定性前缀 + 时间戳）。 */
export function makeSecurityReportId(
  changeName: string | undefined,
  now: Date = new Date(),
): string {
  const prefix = changeName ? `sec-${changeName}` : 'sec'
  return `${prefix}-${now.toISOString().replace(/[:.]/g, '-')}`
}

// =============================================================================
// 5. 低敏 sanitization helpers（2.3；spec Requirement 5）
// =============================================================================

/** 禁止键表：finding/evidence/report 中出现即删除或打码（spec Scenario: Secret-like fields）。 */
export const SECURITY_FORBIDDEN_KEYS = [
  'authorization',
  'proxy-authorization',
  'apiKey',
  'api_key',
  'secret',
  'password',
  'passphrase',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'bearerToken',
  'bearer_token',
  'prompt',
  'modelOutput',
  'model_output',
  'rawXml',
  'raw_xml',
  'rawScimPayload',
  'raw_scim_payload',
  'fileBody',
  'file_body',
  'reportBody',
  'report_body',
  'absolutePath',
  'absolute_path',
  'privateKey',
  'private_key',
  'wrappedDataKey',
  'wrapped_data_key',
  'ciphertext',
  'plaintext',
  'webhookSecret',
  'webhook_secret',
  'changes',
  'metadata',
] as const

/** 禁止键的 regex 匹配（大小写不敏感，key 级）。 */
const FORBIDDEN_KEY_RE =
  /^(authorization|proxy-authorization|api[-_]?key|secret|password|passphrase|access[-_]?token|refresh[-_]?token|bearer[-_]?token|prompt|model[-_]?output|raw[-_]?xml|raw[-_]?scim[-_]?payload|file[-_]?body|report[-_]?body|absolute[-_]?path|private[-_]?key|wrapped[-_]?data[-_]?key|ciphertext|plaintext|webhook[-_]?secret|changes|metadata)$/i

/** 敏感值正则表（值级检测：secret-like 文本片段）。 */
export const SECURITY_SENSITIVE_PATTERNS: ReadonlyArray<{
  reason: SecurityRedactionReasonCode
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
    reason: 'raw-saml-xml',
    pattern: /<(?:saml|Assertion|SAMLResponse|ds:Signature)[\s>]/gi,
    label: 'saml-xml',
  },
  {
    reason: 'raw-scim-payload',
    pattern: /"(?:schemas|urn:ietf:params:scim)"|"userName"\s*:/gi,
    label: 'scim-payload',
  },
  {
    reason: 'absolute-path',
    pattern: /(?:[A-Za-z]:\\|\/home\/|\/var\/|\/tmp\/|\/Users\/)[^\s"']+/gi,
    label: 'absolute-path',
  },
  {
    reason: 'cross-tenant-id',
    pattern: /\b(?:tenant_id|tenantId|organization_id|organizationId)\s*[:=]\s*[A-Za-z0-9-]{8,}/gi,
    label: 'tenant-id',
  },
]

export interface SecurityRedactResult {
  text: string
  redactedCount: number
  reasons: Partial<Record<SecurityRedactionReasonCode, number>>
}

/** 文本级 redaction：敏感片段替换为 `[REDACTED:label:hash]`。 */
export function redactSecurityText(text: string, maxBytes = 64 * 1024): SecurityRedactResult {
  const reasons: Partial<Record<SecurityRedactionReasonCode, number>> = {}
  let redactedCount = 0
  let current = text

  if (Buffer.byteLength(current, 'utf8') > maxBytes) {
    const hash = securityFnv1aHash(current)
    current = `[REDACTED:oversized-log:${hash.slice(0, 8)}]${current.slice(0, 500)}\n...\n${current.slice(-500)}`
    reasons['oversized-log'] = (reasons['oversized-log'] ?? 0) + 1
    redactedCount += 1
  }

  for (const { reason, pattern, label } of SECURITY_SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0
    const matched = current.match(pattern)
    if (!matched) continue
    let count = 0
    current = current.replace(pattern, (frag) => {
      count += 1
      return `[REDACTED:${label}:${securityFnv1aHash(frag).slice(0, 8)}]`
    })
    if (count > 0) {
      redactedCount += count
      reasons[reason] = (reasons[reason] ?? 0) + count
    }
  }

  return { text: current, redactedCount, reasons }
}

/** 值级扫描：文本中是否命中任何敏感模式。 */
export function containsSecuritySensitiveContent(text: string): boolean {
  if (text.length === 0) return false
  for (const { pattern } of SECURITY_SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) return true
  }
  return false
}

/**
 * 对象级 sanitization：深度遍历，删除禁止键（key 级），并对字符串值做文本 redaction。
 * 返回 { value, droppedKeys, redactedCount }。用于 finding/evidence/report 落盘前。
 */
export function sanitizeSecurityEvidence(
  value: unknown,
  seen = new WeakSet<object>(),
): { value: unknown; droppedKeys: string[]; redactedCount: number } {
  if (value === null || value === undefined) return { value, droppedKeys: [], redactedCount: 0 }
  if (typeof value !== 'object') {
    if (typeof value === 'string' && containsSecuritySensitiveContent(value)) {
      const r = redactSecurityText(value)
      return { value: r.text, droppedKeys: [], redactedCount: r.redactedCount }
    }
    return { value, droppedKeys: [], redactedCount: 0 }
  }
  if (seen.has(value)) return { value: '[REDACTED:circular]', droppedKeys: [], redactedCount: 0 }
  seen.add(value)

  if (Array.isArray(value)) {
    let redactedCount = 0
    const droppedKeys: string[] = []
    const items = value.map((item) => {
      const r = sanitizeSecurityEvidence(item, seen)
      redactedCount += r.redactedCount
      droppedKeys.push(...r.droppedKeys)
      return r.value
    })
    return { value: items, droppedKeys, redactedCount }
  }

  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  let redactedCount = 0
  const droppedKeys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_KEY_RE.test(k)) {
      droppedKeys.push(k)
      redactedCount += 1
      continue
    }
    const r = sanitizeSecurityEvidence(v, seen)
    redactedCount += r.redactedCount
    droppedKeys.push(...r.droppedKeys)
    out[k] = r.value
  }
  return { value: out, droppedKeys, redactedCount }
}

/** 低敏 keyword 扫描（测试证明 finding/evidence 摘要不含敏感材料）。 */
export const SECURITY_SENSITIVE_KEYWORDS = [
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
  '<saml:',
  'SAMLResponse',
  'userName',
] as const

// =============================================================================
// 6. Gate catalog 校验 helpers（2.4 测试对象；spec Requirement 2）
// =============================================================================

export interface SecurityCatalogIssue {
  kind:
    | 'missing-field'
    | 'duplicate-id'
    | 'unknown-domain'
    | 'unknown-severity'
    | 'unknown-rule-family'
    | 'unknown-authorization-boundary'
    | 'missing-owner-capability'
    | 'missing-required-evidence'
    | 'missing-fixture-pack'
    | 'missing-command'
    | 'reason-code-not-allowed'
  gateId?: string
  message: string
}

/** 校验单个 catalog 条目（缺必填字段 / 未知枚举 / 证据与命令声明）。 */
export function validateSecurityCatalogEntry(
  entry: SecurityGateCatalogEntry,
): SecurityCatalogIssue[] {
  const issues: SecurityCatalogIssue[] = []
  const missing = (field: string): void => {
    issues.push({
      kind: 'missing-field',
      gateId: entry.gateId,
      message: `gate ${entry.gateId} 缺必填字段 ${field}`,
    })
  }
  if (!entry.gateId || entry.gateId.trim() === '') missing('gateId')
  if (!entry.domain || !isSecurityDomain(entry.domain)) {
    issues.push({
      kind: 'unknown-domain',
      gateId: entry.gateId,
      message: `gate ${entry.gateId} 的 domain 未知: ${String(entry.domain)}`,
    })
  }
  if (!entry.ownerCapability || entry.ownerCapability.trim() === '') missing('ownerCapability')
  if (!Array.isArray(entry.requiredEvidence) || entry.requiredEvidence.length === 0)
    missing('requiredEvidence')
  if (!entry.defaultFixturePack || entry.defaultFixturePack.trim() === '')
    missing('defaultFixturePack')
  if (entry.severity !== 'warning' && entry.severity !== 'blocking') {
    issues.push({
      kind: 'unknown-severity',
      gateId: entry.gateId,
      message: `gate ${entry.gateId} 的 severity 非法: ${String(entry.severity)}`,
    })
  }
  if (!entry.blockingRuleFamily || !isSecurityRedlineRuleFamily(entry.blockingRuleFamily)) {
    issues.push({
      kind: 'unknown-rule-family',
      gateId: entry.gateId,
      message: `gate ${entry.gateId} 的 blockingRuleFamily 非法: ${String(entry.blockingRuleFamily)}`,
    })
  }
  if (
    !entry.authorizationBoundary ||
    !isSecurityAuthorizationBoundary(entry.authorizationBoundary)
  ) {
    issues.push({
      kind: 'unknown-authorization-boundary',
      gateId: entry.gateId,
      message: `gate ${entry.gateId} 缺有效 authorizationBoundary`,
    })
  }
  if (
    entry.authorizationBoundary === 'requires-user-authorization' &&
    !entry.expectedCommand &&
    !entry.allowedReasonCodes.includes('external-not-authorized')
  ) {
    issues.push({
      kind: 'missing-command',
      gateId: entry.gateId,
      message: `gate ${entry.gateId} 授权门 gate 须声明 expectedCommand 或允许 external-not-authorized`,
    })
  }
  if (!Array.isArray(entry.allowedReasonCodes) || entry.allowedReasonCodes.length === 0)
    missing('allowedReasonCodes')
  for (const rc of entry.allowedReasonCodes) {
    if (!isSecurityReasonCode(rc)) {
      issues.push({
        kind: 'reason-code-not-allowed',
        gateId: entry.gateId,
        message: `gate ${entry.gateId} 的 allowedReasonCodes 含未知码: ${String(rc)}`,
      })
    }
  }
  return issues
}

/** 校验整个 catalog（重复 id / 缺必填 surface）。 */
export function validateSecurityCatalog(
  entries: SecurityGateCatalogEntry[],
): SecurityCatalogIssue[] {
  const issues: SecurityCatalogIssue[] = []
  const seen = new Set<string>()
  const surfaces = new Set(entries.map((e) => e.domain))
  for (const entry of entries) {
    issues.push(...validateSecurityCatalogEntry(entry))
    if (seen.has(entry.gateId)) {
      issues.push({
        kind: 'duplicate-id',
        gateId: entry.gateId,
        message: `gate id 重复: ${entry.gateId}`,
      })
    }
    seen.add(entry.gateId)
  }
  for (const surface of REQUIRED_SECURITY_HIGH_RISK_SURFACES) {
    if (!surfaces.has(surface as SecurityDomain)) {
      issues.push({
        kind: 'missing-field',
        message: `required high-risk surface 无 catalog 条目: ${surface}`,
      })
    }
  }
  return issues
}

/** 检查 domain 是否在 catalog 中有覆盖（缺 → 调用方应产生 catalog_gap finding）。 */
export function findSecuritySurfaceCoverage(
  entries: SecurityGateCatalogEntry[],
  domain: SecurityDomain,
): SecurityGateCatalogEntry[] {
  return entries.filter((e) => e.domain === domain)
}

/** 未登记的 high-risk surface → catalog_gap finding（低敏）。 */
export function makeSecurityCatalogGapFinding(
  domain: string,
  evidenceRefs: SecurityEvidenceRef[] = [],
): SecurityFinding {
  return {
    findingId: `catalog-gap-${securityFnv1aHash(domain)}`,
    ruleId: 'SEC-CAT-001',
    code: 'catalog_gap',
    severity: 'blocking',
    status: 'blocked',
    subjectPath: `domain:${domain}`,
    evidenceRefs,
    sourceHash: securityFnv1aHash(domain),
    summary: `high-risk security surface 无 catalog 条目: ${domain}（未知 surface 不得静默放行）`,
  }
}

// =============================================================================
// 7. Waiver / 报告 helpers（2.5 测试对象；spec Requirement 7）
// =============================================================================

/** waiver 是否过期（expiresAt 为 ISO 日期字符串；无 expiresAt 视为永不过期）。 */
export function isSecurityWaiverExpired(waiver: SecurityWaiver, now: Date = new Date()): boolean {
  if (!waiver.expiresAt) return false
  const expiry = new Date(waiver.expiresAt)
  if (Number.isNaN(expiry.getTime())) return false
  return expiry.getTime() < now.getTime()
}

/**
 * waiver 求值：仅 warning 级 finding 可 waiver；redline finding（code 以 `redline-` 开头）
 * 一律拒绝（保持 blocking，spec Requirement 7）。
 * 返回 { accepted, rejected, reason }。
 */
export function evaluateSecurityWaiver(
  finding: SecurityFinding,
  waiver: SecurityWaiver,
  now: Date = new Date(),
): { accepted: boolean; rejected: boolean; reason: string } {
  if (finding.ruleId !== waiver.ruleId) {
    return {
      accepted: false,
      rejected: true,
      reason: `ruleId 不匹配: finding=${finding.ruleId} waiver=${waiver.ruleId}`,
    }
  }
  if (finding.subjectPath !== waiver.subjectPath) {
    return {
      accepted: false,
      rejected: true,
      reason: `subjectPath 不匹配: finding=${finding.subjectPath} waiver=${waiver.subjectPath}`,
    }
  }
  if (finding.code.startsWith('redline-')) {
    return {
      accepted: false,
      rejected: true,
      reason: `redline finding 不可 waiver: ${finding.code}`,
    }
  }
  if (finding.severity === 'blocking') {
    return {
      accepted: false,
      rejected: true,
      reason: `blocking finding 不可 waiver: ${finding.ruleId}`,
    }
  }
  if (!waiver.owner || waiver.owner.trim() === '') {
    return { accepted: false, rejected: true, reason: 'waiver 缺 owner' }
  }
  if (!waiver.reason || waiver.reason.trim() === '') {
    return { accepted: false, rejected: true, reason: 'waiver 缺 reason' }
  }
  if (!waiver.mitigation || waiver.mitigation.trim() === '') {
    return { accepted: false, rejected: true, reason: 'waiver 缺 mitigation' }
  }
  if (!Array.isArray(waiver.evidenceRefs) || waiver.evidenceRefs.length === 0) {
    return { accepted: false, rejected: true, reason: 'waiver 缺 evidenceRefs' }
  }
  if (!waiver.approvalContext || waiver.approvalContext.trim() === '') {
    return { accepted: false, rejected: true, reason: 'waiver 缺 approvalContext' }
  }
  if (isSecurityWaiverExpired(waiver, now)) {
    return { accepted: false, rejected: true, reason: 'waiver 已过期' }
  }
  return { accepted: true, rejected: false, reason: 'accepted' }
}

/** 报告 schema 校验（6.1 contract gate 使用）：返回 issue 列表。 */
export function validateSecurityReportSchema(report: unknown): string[] {
  const issues: string[] = []
  if (!report || typeof report !== 'object') return ['报告不是对象']
  const r = report as Partial<SecurityGateReport>
  if (r.schemaVersion !== '1.0') issues.push('schemaVersion 必须为 1.0')
  if (!r.reportId || typeof r.reportId !== 'string') issues.push('缺 reportId')
  if (!r.generatedAt) issues.push('缺 generatedAt')
  if (!r.commit) issues.push('缺 commit')
  if (!r.status || !isSecurityReportStatus(r.status)) issues.push('status 非法')
  if (!r.environment || typeof r.environment !== 'object') issues.push('缺 environment')
  if (!r.observation || typeof r.observation !== 'object') issues.push('缺 observation')
  if (!Array.isArray(r.gates)) issues.push('gates 必须是数组')
  if (!Array.isArray(r.findings)) issues.push('findings 必须是数组')
  if (!Array.isArray(r.evidenceRefs)) issues.push('evidenceRefs 必须是数组')
  if (!Array.isArray(r.waiverRefs)) issues.push('waiverRefs 必须是数组')
  if (!r.sourceFallback || typeof r.sourceFallback !== 'object') issues.push('缺 sourceFallback')
  return issues
}
