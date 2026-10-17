/**
 * plugin-capability-seam-catalog —— V3 插件能力接缝目录共享契约（纯类型 + 常量 + 类型守卫 +
 * 确定性 hash/序列化 + SemVer 兼容 + 归一化/查找/摘要 + catalog validator + 低敏 sanitization，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。curated 目录
 * 见 `plugin-capability-seam-catalog-curated.ts`，测试夹具见 `-fixtures.ts`，本机 checker
 * 见 `scripts/check-plugin-capability-seams.ts`。
 *
 * # 语义要点（对应 design.md D1~D9 与 specs/plugin-capability-seam-catalog/spec.md）
 * - catalog 是宿主核心契约：`seamKey` + 完整 SemVer `seamVersion`；插件未来只能引用已登记接缝，
 *   目录登记 ≠ host/安装/执行已交付（`availability` 与 `deliveryStatus` 分离）。
 * - 三态分离：`classification`（应由谁承载）≠ `deliveryStatus`（实现事实）≠ `availability`
 *   （是否可被插件调用）；无 host 实现证据的条目 MUST NOT 标记 `host-ready`。
 * - 核心 authority 不可下放：有效租户、认证、RBAC/Policy、组织隔离、事务提交、可信审计、
 *   Compiler 不变量、AI/正式写入人工确认、发布/安全门禁。任何 entry 声明下放 → blocking redline。
 * - 版本兼容：严格 `MAJOR.MINOR.PATCH`，首期只允许 exact 或 same-major 且宿主不低于请求；
 *   跨 major、请求未来版本、非法/预发布版本、deprecated 无迁移、未知 seam → 不兼容 + 稳定 reason code。
 * - 低敏纪律：finding/report 只含 seam key、稳定 reason code、severity、field path、计数、hash
 *   与低敏 evidence refs；sanitizer 拒绝/打码 prompt、model output、secret/token/API key/
 *   Authorization、provider payload、跨租户原始标识。
 */

// =============================================================================
// 1. 枚举与常量（稳定 kebab-case 值，禁止随意改动；新增先更新 curated catalog 与测试）
// =============================================================================

/** 宿主接缝 surface / family（`REQUIRED_PLUGIN_SEAM_FAMILIES` 同序覆盖）。 */
export const SEAM_SURFACES = [
  'skill-adapter',
  'compiler-contribution',
  'server-query',
  'server-command-proposal',
  'ui-slot',
  'report-renderer',
  'data-transformer',
  'notification-template',
  'template-pack',
  'ocr-profile',
  'event-subscription',
  'copilot-tool',
] as const
export type SeamSurface = (typeof SEAM_SURFACES)[number]

/** 首批最小 family 覆盖（spec Requirement 4；每个 family 至少一个可独立验收条目）。 */
export const REQUIRED_PLUGIN_SEAM_FAMILIES: readonly string[] = [...SEAM_SURFACES]

/** 能力承载裁决（D1/D3：回答「应该由谁承载」）。 */
export const SEAM_CLASSIFICATIONS = ['core', 'plugin', 'hybrid', 'conditional', 'deferred'] as const
export type SeamClassification = (typeof SEAM_CLASSIFICATIONS)[number]

/** 交付事实状态（D3：回答「代码/底座事实完成度」）。 */
export const SEAM_DELIVERY_STATUSES = [
  'delivered',
  'incremental-gap',
  'net-new',
  'conditional',
  'deferred',
] as const
export type SeamDeliveryStatus = (typeof SEAM_DELIVERY_STATUSES)[number]

/** 可用性（D3：回答「后续 manifest 是否可引用」；无 host 证据不得 host-ready）。 */
export const SEAM_AVAILABILITIES = ['cataloged', 'host-ready', 'deprecated'] as const
export type SeamAvailability = (typeof SEAM_AVAILABILITIES)[number]

/** 允许的操作模式（host contract）。 */
export const SEAM_OPERATION_MODES = [
  'none',
  'read-only',
  'advisory',
  'render',
  'transform',
  'preview',
  'proposal',
  'formal-write',
  'external-action',
] as const
export type SeamOperationMode = (typeof SEAM_OPERATION_MODES)[number]

/** 显式 tenant/project scope（`global` 为合法枚举值但触发红线：plugin seam 不得 global authority）。 */
export const SEAM_SCOPE_MODES = ['organization', 'project', 'global'] as const
export type SeamScopeMode = (typeof SEAM_SCOPE_MODES)[number]

/** 数据所有权（`core-authoritative` 合法但仅允许 classification=core 的条目声明）。 */
export const SEAM_DATA_OWNERSHIPS = [
  'none',
  'non-authoritative-read',
  'non-authoritative-render',
  'host-brokered',
  'plugin-owned-local',
  'core-authoritative',
] as const
export type SeamDataOwnership = (typeof SEAM_DATA_OWNERSHIPS)[number]

/** 副作用类别（D5 矩阵；external-action 必须 conditional + host-brokered）。 */
export const SEAM_SIDE_EFFECT_CLASSES = [
  'none',
  'read-only',
  'advisory',
  'render',
  'transform',
  'preview',
  'proposal',
  'formal-write',
  'external-action',
] as const
export type SeamSideEffectClass = (typeof SEAM_SIDE_EFFECT_CLASSES)[number]

/** 人工确认策略（`not-required` 只允许无副作用/纯读/渲染类）。 */
export const SEAM_CONFIRMATION_POLICIES = [
  'not-required',
  'required',
  'host-brokered',
  'forbidden',
] as const
export type SeamConfirmationPolicy = (typeof SEAM_CONFIRMATION_POLICIES)[number]

/** 审计策略（`plugin-self-asserted` 合法枚举值但触发红线：插件不得自证可信审计）。 */
export const SEAM_AUDIT_POLICIES = [
  'core-owned-low-sensitive',
  'core-owned-full',
  'plugin-self-asserted',
  'none',
] as const
export type SeamAuditPolicy = (typeof SEAM_AUDIT_POLICIES)[number]

/** 网络策略（`direct-allowed` 合法枚举值但触发红线：本契约内无 seam 获授权未中介直连）。 */
export const SEAM_NETWORK_POLICIES = [
  'none',
  'host-brokered',
  'fixture-mock-only',
  'direct-allowed',
] as const
export type SeamNetworkPolicy = (typeof SEAM_NETWORK_POLICIES)[number]

/** 失败降级模式（`fail-open` 合法枚举值但触发红线：失败不得扩大权限/回退 global authority）。 */
export const SEAM_FAILURE_MODES = [
  'isolate-drop',
  'controlled-degrade',
  'block-extension',
  'fail-open',
] as const
export type SeamFailureMode = (typeof SEAM_FAILURE_MODES)[number]

/** 版本兼容策略（D6：首期只允许 exact 或 same-major）。 */
export const SEAM_COMPATIBILITY_POLICIES = ['exact', 'same-major'] as const
export type SeamCompatibilityPolicy = (typeof SEAM_COMPATIBILITY_POLICIES)[number]

/** 兼容判定 reason code（稳定、低敏、机器可判）。 */
export const SEAM_COMPATIBILITY_REASONS = [
  'compatible-exact',
  'compatible-same-major',
  'incompatible-major-mismatch',
  'incompatible-requested-future',
  'incompatible-invalid-version',
  'incompatible-deprecated-no-migration',
  'incompatible-unknown-seam',
  'incompatible-ambiguous-identity',
] as const
export type SeamCompatibilityReason = (typeof SEAM_COMPATIBILITY_REASONS)[number]

/** 证据新鲜度（host-ready/high-risk 缺 fresh 证据 → blocking）。 */
export const SEAM_EVIDENCE_FRESHNESS = ['fresh', 'stale', 'missing'] as const
export type SeamEvidenceFreshness = (typeof SEAM_EVIDENCE_FRESHNESS)[number]

/** finding 严重度。 */
export const SEAM_SEVERITIES = ['info', 'warning', 'blocking'] as const
export type SeamSeverity = (typeof SEAM_SEVERITIES)[number]

/** finding code（机器可判；redline 一律 blocking）。 */
export const SEAM_FINDING_CODES = [
  'seam-schema-invalid',
  'seam-unknown-enum',
  'seam-duplicate-identity',
  'seam-invalid-version',
  'seam-required-family-gap',
  'seam-unknown-contract-ref',
  'seam-unknown-owner-ref',
  'seam-state-contradiction',
  'seam-host-ready-no-evidence',
  'seam-core-authority-delegation',
  'seam-scope-permission-missing',
  'seam-matrix-inconsistent',
  'seam-external-action-unauthorized',
  'seam-evidence-stale',
  'seam-evidence-missing',
  'seam-evidence-path-invalid',
  'seam-graph-absent-no-fallback',
  'seam-redaction-violation',
] as const
export type SeamFindingCode = (typeof SEAM_FINDING_CODES)[number]

/** 不可下放的核心 authority family（D5/CORE_AUTHORITY_FAMILIES）。 */
export const CORE_AUTHORITY_FAMILIES = [
  'effective-tenant',
  'authentication',
  'rbac-policy',
  'organization-isolation',
  'transaction-commit',
  'trusted-audit',
  'compiler-invariants',
  'ai-human-confirmation',
  'release-security-gate',
] as const
export type CoreAuthorityFamily = (typeof CORE_AUTHORITY_FAMILIES)[number]

/** 租户权威解析（client-supplied → 红线）。 */
export const SEAM_TENANT_AUTHORITIES = ['server-resolved', 'client-supplied'] as const
export type SeamTenantAuthority = (typeof SEAM_TENANT_AUTHORITIES)[number]

/** 正式写入通道（direct-model-db → 红线；仅 host-brokered-command 合法）。 */
export const SEAM_FORMAL_WRITE_CHANNELS = ['host-brokered-command', 'direct-model-db'] as const
export type SeamFormalWriteChannel = (typeof SEAM_FORMAL_WRITE_CHANNELS)[number]

/** Compiler 不变量归属（plugin → 红线）。 */
export const SEAM_COMPILER_INVARIANT_OWNERSHIPS = ['core', 'plugin'] as const
export type SeamCompilerInvariantOwnership = (typeof SEAM_COMPILER_INVARIANT_OWNERSHIPS)[number]
export function isSeamCompilerInvariantOwnership(v: unknown): v is SeamCompilerInvariantOwnership {
  return (
    typeof v === 'string' && (SEAM_COMPILER_INVARIANT_OWNERSHIPS as readonly string[]).includes(v)
  )
}

/** 证据引用类别（低敏：仅路径/ID）。 */
export const SEAM_EVIDENCE_KINDS = [
  'spec',
  'source',
  'test',
  'observation',
  'graph',
  'runbook',
] as const
export type SeamEvidenceKind = (typeof SEAM_EVIDENCE_KINDS)[number]

/** 低敏 redaction 原因码。 */
export const SEAM_REDACTION_REASON_CODES = [
  'secret',
  'token',
  'authorization-header',
  'prompt',
  'model-output',
  'provider-payload',
  'cross-tenant-id',
  'oversized-log',
] as const
export type SeamRedactionReasonCode = (typeof SEAM_REDACTION_REASON_CODES)[number]

/** 稳定规则 ID（`SEAM-<族>-<序号>`；ID 一经发布不得更改含义）。 */
export const SEAM_RULE_IDS = {
  schemaInvalid: 'SEAM-SCH-001',
  unknownEnum: 'SEAM-ENUM-001',
  duplicateIdentity: 'SEAM-DUP-001',
  invalidVersion: 'SEAM-VER-001',
  requiredFamilyGap: 'SEAM-CAT-001',
  unknownContractRef: 'SEAM-REF-001',
  unknownOwnerRef: 'SEAM-REF-002',
  stateContradiction: 'SEAM-STATE-001',
  hostReadyNoEvidence: 'SEAM-EV-001',
  coreAuthorityDelegation: 'SEAM-RL-001',
  scopePermissionMissing: 'SEAM-SCOPE-001',
  matrixInconsistent: 'SEAM-MTX-001',
  externalActionUnauthorized: 'SEAM-EXT-001',
  evidenceStale: 'SEAM-EV-002',
  evidenceMissing: 'SEAM-EV-003',
  evidencePathInvalid: 'SEAM-EV-004',
  graphAbsentNoFallback: 'SEAM-OBS-001',
  redactionViolation: 'SEAM-SAN-001',
} as const
export type SeamRuleId = (typeof SEAM_RULE_IDS)[keyof typeof SEAM_RULE_IDS]

// =============================================================================
// 2. 类型守卫
// =============================================================================

export function isSeamSurface(v: unknown): v is SeamSurface {
  return typeof v === 'string' && (SEAM_SURFACES as readonly string[]).includes(v)
}
export function isSeamClassification(v: unknown): v is SeamClassification {
  return typeof v === 'string' && (SEAM_CLASSIFICATIONS as readonly string[]).includes(v)
}
export function isSeamDeliveryStatus(v: unknown): v is SeamDeliveryStatus {
  return typeof v === 'string' && (SEAM_DELIVERY_STATUSES as readonly string[]).includes(v)
}
export function isSeamAvailability(v: unknown): v is SeamAvailability {
  return typeof v === 'string' && (SEAM_AVAILABILITIES as readonly string[]).includes(v)
}
export function isSeamOperationMode(v: unknown): v is SeamOperationMode {
  return typeof v === 'string' && (SEAM_OPERATION_MODES as readonly string[]).includes(v)
}
export function isSeamScopeMode(v: unknown): v is SeamScopeMode {
  return typeof v === 'string' && (SEAM_SCOPE_MODES as readonly string[]).includes(v)
}
export function isSeamDataOwnership(v: unknown): v is SeamDataOwnership {
  return typeof v === 'string' && (SEAM_DATA_OWNERSHIPS as readonly string[]).includes(v)
}
export function isSeamSideEffectClass(v: unknown): v is SeamSideEffectClass {
  return typeof v === 'string' && (SEAM_SIDE_EFFECT_CLASSES as readonly string[]).includes(v)
}
export function isSeamConfirmationPolicy(v: unknown): v is SeamConfirmationPolicy {
  return typeof v === 'string' && (SEAM_CONFIRMATION_POLICIES as readonly string[]).includes(v)
}
export function isSeamAuditPolicy(v: unknown): v is SeamAuditPolicy {
  return typeof v === 'string' && (SEAM_AUDIT_POLICIES as readonly string[]).includes(v)
}
export function isSeamNetworkPolicy(v: unknown): v is SeamNetworkPolicy {
  return typeof v === 'string' && (SEAM_NETWORK_POLICIES as readonly string[]).includes(v)
}
export function isSeamFailureMode(v: unknown): v is SeamFailureMode {
  return typeof v === 'string' && (SEAM_FAILURE_MODES as readonly string[]).includes(v)
}
export function isSeamCompatibilityPolicy(v: unknown): v is SeamCompatibilityPolicy {
  return typeof v === 'string' && (SEAM_COMPATIBILITY_POLICIES as readonly string[]).includes(v)
}
export function isSeamCompatibilityReason(v: unknown): v is SeamCompatibilityReason {
  return typeof v === 'string' && (SEAM_COMPATIBILITY_REASONS as readonly string[]).includes(v)
}
export function isSeamEvidenceFreshness(v: unknown): v is SeamEvidenceFreshness {
  return typeof v === 'string' && (SEAM_EVIDENCE_FRESHNESS as readonly string[]).includes(v)
}
export function isSeamSeverity(v: unknown): v is SeamSeverity {
  return typeof v === 'string' && (SEAM_SEVERITIES as readonly string[]).includes(v)
}
export function isSeamFindingCode(v: unknown): v is SeamFindingCode {
  return typeof v === 'string' && (SEAM_FINDING_CODES as readonly string[]).includes(v)
}
export function isCoreAuthorityFamily(v: unknown): v is CoreAuthorityFamily {
  return typeof v === 'string' && (CORE_AUTHORITY_FAMILIES as readonly string[]).includes(v)
}
export function isSeamTenantAuthority(v: unknown): v is SeamTenantAuthority {
  return typeof v === 'string' && (SEAM_TENANT_AUTHORITIES as readonly string[]).includes(v)
}
export function isSeamFormalWriteChannel(v: unknown): v is SeamFormalWriteChannel {
  return typeof v === 'string' && (SEAM_FORMAL_WRITE_CHANNELS as readonly string[]).includes(v)
}

/** 未知枚举统一判定：任何成员值不在已知集内 → 未知。 */
export function isKnownSeamValue(v: unknown): boolean {
  return (
    isSeamSurface(v) ||
    isSeamClassification(v) ||
    isSeamDeliveryStatus(v) ||
    isSeamAvailability(v) ||
    isSeamOperationMode(v) ||
    isSeamScopeMode(v) ||
    isSeamDataOwnership(v) ||
    isSeamSideEffectClass(v) ||
    isSeamConfirmationPolicy(v) ||
    isSeamAuditPolicy(v) ||
    isSeamNetworkPolicy(v) ||
    isSeamFailureMode(v) ||
    isSeamCompatibilityPolicy(v) ||
    isSeamEvidenceFreshness(v) ||
    isSeamSeverity(v) ||
    isSeamFindingCode(v)
  )
}

// =============================================================================
// 3. 核心接口
// =============================================================================

/** 一条证据引用：低敏，仅路径/ID + 可选说明。 */
export interface SeamEvidenceRef {
  kind: SeamEvidenceKind
  /** 仓库相对路径（spec/source/test/runbook）或稳定 ID（observation/graph）。 */
  path: string
  note?: string
}

/** 清理/replacement 信息（availability=deprecated 时使用）。 */
export interface SeamDeprecation {
  replacedBy?: string
  migrationRef?: string
}

/**
 * 目录条目（D3：identity + governance + host contract + authority + lifecycle metadata）。
 * 至少包含：identity、classification、deliveryStatus、availability、surface、ownerRef、
 * operationModes、input/output contract refs、scopeModes、requiredPermissions、
 * dataOwnership、sideEffectClass、confirmationPolicy、auditPolicy、networkPolicy、
 * failureMode、compatibilityPolicy、evidenceRefs、evidenceFreshness。
 */
export interface PluginCapabilitySeamEntry {
  // identity
  seamKey: string
  seamVersion: string
  title: string
  description?: string
  surface: SeamSurface
  // governance
  classification: SeamClassification
  deliveryStatus: SeamDeliveryStatus
  ownerRef: string
  contractRefs: string[]
  evidenceRefs: SeamEvidenceRef[]
  evidenceFreshness: SeamEvidenceFreshness
  // host contract
  operationModes: SeamOperationMode[]
  inputContractRef: string
  outputContractRef: string
  compatibilityPolicy: SeamCompatibilityPolicy
  failureMode: SeamFailureMode
  // authority
  scopeModes: SeamScopeMode[]
  requiredPermissions: string[]
  dataOwnership: SeamDataOwnership
  sideEffectClass: SeamSideEffectClass
  confirmationPolicy: SeamConfirmationPolicy
  auditPolicy: SeamAuditPolicy
  networkPolicy: SeamNetworkPolicy
  tenantAuthority?: SeamTenantAuthority
  formalWriteChannel?: SeamFormalWriteChannel
  compilerInvariantOwnership?: SeamCompilerInvariantOwnership
  coreAuthorityDelegations?: CoreAuthorityFamily[]
  // lifecycle metadata
  availability: SeamAvailability
  deprecated?: SeamDeprecation
}

/** finding（低敏：summary/fieldPath 不含原始敏感材料）。 */
export interface SeamFinding {
  findingId: string
  ruleId: SeamRuleId
  code: SeamFindingCode
  severity: SeamSeverity
  seamKey: string
  fieldPath: string
  summary: string
  sourceHash: string
}

/** 校验输入上下文（4.7：evidence ref 本地存在性 + graph freshness/source fallback）。 */
export interface SeamValidationContext {
  /** 已知合法 contract ref 集（提供时启用未知 ref 检测）。 */
  knownContractRefs?: string[]
  /** 已知合法 owner ref 集（提供时启用未知 owner ref 检测）。 */
  knownOwnerRefs?: string[]
  /** 本地 ref 存在性解析器（低敏：返回仓库相对路径是否存在）。 */
  evidencePathResolver?: (path: string) => boolean
  /** 图谱已知不完整但未提供 source fallback → SEAM-OBS-001 blocking。 */
  graphAbsentWithoutFallback?: boolean
}

/** 目录校验结果（findings 稳定排序；digest 确定性）。 */
export interface SeamCatalogValidationResult {
  digest: string
  entries: PluginCapabilitySeamEntry[]
  findings: SeamFinding[]
  blockingCount: number
  warningCount: number
}

// =============================================================================
// 3b. 报告类型（task 2.1 「finding/report 类型」；checker 输出契约）
// =============================================================================

export const SEAM_REPORT_STATUSES = ['passed', 'degraded', 'blocked'] as const
export type SeamReportStatus = (typeof SEAM_REPORT_STATUSES)[number]
export function isSeamReportStatus(v: unknown): v is SeamReportStatus {
  return typeof v === 'string' && (SEAM_REPORT_STATUSES as readonly string[]).includes(v)
}

/** 机器可读报告（低敏、可归档、可进入发布门禁）。 */
export interface SeamCatalogReport {
  schemaVersion: '1.0'
  reportId: string
  generatedAt: string
  changeName?: string
  commit: string
  status: SeamReportStatus
  objective?: string
  environment: {
    platform: string
    nodeVersion: string
    commit: string
    graphFreshness: 'fresh' | 'stale' | 'unknown'
  }
  catalogDigest: string
  entryCount: number
  families: Array<{ family: string; entryCount: number; availabilities: string[] }>
  findings: SeamFinding[]
  redactionSummary: {
    redactedCount: number
    reasons: Partial<Record<SeamRedactionReasonCode, number>>
  }
}

/** 聚合 report 状态：任一 blocking → blocked；任一 warning → degraded；否则 passed。 */
export function aggregateSeamReportStatus(findings: SeamFinding[]): SeamReportStatus {
  if (findings.some((f) => f.severity === 'blocking')) return 'blocked'
  if (findings.some((f) => f.severity === 'warning')) return 'degraded'
  return 'passed'
}

/** 报告 schema 校验（checker 输出契约；返回 issue 列表，空 = 合法）。 */
export function validateSeamReportSchema(report: unknown): string[] {
  const issues: string[] = []
  if (!report || typeof report !== 'object') return ['报告不是对象']
  const r = report as Partial<SeamCatalogReport>
  if (r.schemaVersion !== '1.0') issues.push('schemaVersion 必须为 1.0')
  if (!r.reportId || typeof r.reportId !== 'string') issues.push('缺 reportId')
  if (!r.generatedAt || typeof r.generatedAt !== 'string') issues.push('缺 generatedAt')
  if (!r.commit || typeof r.commit !== 'string') issues.push('缺 commit')
  if (!r.status || !isSeamReportStatus(r.status)) issues.push('status 非法')
  if (typeof r.catalogDigest !== 'string' || r.catalogDigest.length === 0)
    issues.push('缺 catalogDigest')
  if (typeof r.entryCount !== 'number' || r.entryCount < 0) issues.push('entryCount 非法')
  if (!Array.isArray(r.families)) issues.push('families 必须是数组')
  if (!Array.isArray(r.findings)) issues.push('findings 必须是数组')
  if (!r.environment || typeof r.environment !== 'object') issues.push('缺 environment')
  if (!r.redactionSummary || typeof r.redactionSummary !== 'object')
    issues.push('缺 redactionSummary')
  return issues
}

// =============================================================================
// 4. 确定性 hash / stable serialize / SemVer（2.3/2.5；task 2.5 复用既有模式，无导出撞名）
// =============================================================================

/** 确定性 32-bit FNV-1a hash（hex），低敏，不依赖 node:crypto。 */
export function seamFnv1aHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 稳定序列化：递归稳定排序对象键（不同键序的等价对象产生相同字符串）。 */
export function seamStableSerialize(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => seamStableSerialize(v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${seamStableSerialize(obj[k])}`).join(',')}}`
}

/** 任意值的确定性 source hash（key 序无关）。 */
export function computeSeamSourceHash(value: unknown): string {
  return seamFnv1aHash(seamStableSerialize(value))
}

/**
 * 严格 `MAJOR.MINOR.PATCH` 解析。prerelease/build（如 `1.2.0-beta`）视为非法：
 * 本契约只接受完整 SemVer 三段数字（design D6）；返回 null 表示非法。
 */
export function parseSeamVersion(
  v: string,
): { major: number; minor: number; patch: number } | null {
  if (typeof v !== 'string') return null
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/** 版本比较：a > b → 1，a === b → 0，a < b → -1（非法版本视为最小）。 */
export function compareSeamVersions(a: string, b: string): number {
  const pa = parseSeamVersion(a)
  const pb = parseSeamVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  return pa.patch - pb.patch
}

/** 兼容判定结果（稳定 reason code 代替自由文本）。 */
export interface SeamCompatibilityResult {
  compatible: boolean
  reasonCode: SeamCompatibilityReason
}

/**
 * 兼容 helper：exact 或 same-major 且宿主版本不低于请求版本（D6）。
 * - deprecated 且无 migrationRef → 不兼容 `incompatible-deprecated-no-migration`
 * - 版本非法 → `incompatible-invalid-version`
 * - exact：版本字符串相等 → `compatible-exact`，否则 `incompatible-major-mismatch`
 * - same-major：major 相等且 catalog.minor/patch >= requested → `compatible-same-major`；
 *   major 不同 → `incompatible-major-mismatch`；未来 minor/patch → `incompatible-requested-future`
 */
export function checkSeamCompatibility(options: {
  catalogVersion: string
  requestedVersion: string
  policy: SeamCompatibilityPolicy
  deprecated?: SeamDeprecation
}): SeamCompatibilityResult {
  const { catalogVersion, requestedVersion, policy, deprecated } = options
  const catalog = parseSeamVersion(catalogVersion)
  const requested = parseSeamVersion(requestedVersion)
  if (!catalog || !requested)
    return { compatible: false, reasonCode: 'incompatible-invalid-version' }
  if (deprecated && !deprecated.migrationRef) {
    return { compatible: false, reasonCode: 'incompatible-deprecated-no-migration' }
  }
  if (policy === 'exact') {
    const cat = `${catalog.major}.${catalog.minor}.${catalog.patch}`
    const req = `${requested.major}.${requested.minor}.${requested.patch}`
    return cat === req
      ? { compatible: true, reasonCode: 'compatible-exact' }
      : { compatible: false, reasonCode: 'incompatible-major-mismatch' }
  }
  // same-major
  if (catalog.major !== requested.major) {
    return { compatible: false, reasonCode: 'incompatible-major-mismatch' }
  }
  if (catalog.minor > requested.minor) {
    return { compatible: true, reasonCode: 'compatible-same-major' }
  }
  if (catalog.minor === requested.minor && catalog.patch >= requested.patch) {
    return { compatible: true, reasonCode: 'compatible-same-major' }
  }
  return { compatible: false, reasonCode: 'incompatible-requested-future' }
}

// =============================================================================
// 5. 归一化 / 稳定排序 / 查找 / digest（2.5；确定性纪律 2.6）
// =============================================================================

/** 归一化一个条目：深拷贝、trim 字符串、稳定排序内层数组、丢弃 unknown 键（不可变输入；缺字段容错）。 */
export function normalizeSeamEntry(input: PluginCapabilitySeamEntry): PluginCapabilitySeamEntry {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? (v as string[]).map((s) => (typeof s === 'string' ? s.trim() : '')) : []
  const sortedStr = (v: unknown): string[] => [...strArr(v)].sort((a, b) => a.localeCompare(b))
  const sortedArr = <T>(v: unknown): T[] =>
    Array.isArray(v) ? ([...v].sort((a, b) => String(a).localeCompare(String(b))) as T[]) : []
  const entry: PluginCapabilitySeamEntry = {
    seamKey: str(input.seamKey),
    seamVersion: str(input.seamVersion),
    title: str(input.title),
    surface: input.surface as SeamSurface,
    classification: input.classification as SeamClassification,
    deliveryStatus: input.deliveryStatus as SeamDeliveryStatus,
    ownerRef: str(input.ownerRef),
    contractRefs: sortedStr(input.contractRefs),
    evidenceRefs: (Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [])
      .map((r) => ({
        kind: (r?.kind ?? 'spec') as SeamEvidenceKind,
        path: str(r?.path),
        note: r?.note !== undefined ? str(r.note) : undefined,
      }))
      .sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`)),
    evidenceFreshness: input.evidenceFreshness as SeamEvidenceFreshness,
    operationModes: sortedArr<SeamOperationMode>(input.operationModes),
    inputContractRef: str(input.inputContractRef),
    outputContractRef: str(input.outputContractRef),
    compatibilityPolicy: input.compatibilityPolicy as SeamCompatibilityPolicy,
    failureMode: input.failureMode as SeamFailureMode,
    scopeModes: sortedArr<SeamScopeMode>(input.scopeModes),
    requiredPermissions: sortedStr(input.requiredPermissions),
    dataOwnership: input.dataOwnership as SeamDataOwnership,
    sideEffectClass: input.sideEffectClass as SeamSideEffectClass,
    confirmationPolicy: input.confirmationPolicy as SeamConfirmationPolicy,
    auditPolicy: input.auditPolicy as SeamAuditPolicy,
    networkPolicy: input.networkPolicy as SeamNetworkPolicy,
    availability: input.availability as SeamAvailability,
  }
  if (input.description !== undefined) entry.description = str(input.description)
  if (input.tenantAuthority !== undefined)
    entry.tenantAuthority = input.tenantAuthority as SeamTenantAuthority
  if (input.formalWriteChannel !== undefined)
    entry.formalWriteChannel = input.formalWriteChannel as SeamFormalWriteChannel
  if (input.compilerInvariantOwnership !== undefined) {
    entry.compilerInvariantOwnership =
      input.compilerInvariantOwnership as SeamCompilerInvariantOwnership
  }
  if (input.coreAuthorityDelegations !== undefined) {
    entry.coreAuthorityDelegations = sortedArr<CoreAuthorityFamily>(input.coreAuthorityDelegations)
  }
  if (input.deprecated !== undefined) {
    entry.deprecated = {
      replacedBy:
        input.deprecated.replacedBy !== undefined ? str(input.deprecated.replacedBy) : undefined,
      migrationRef:
        input.deprecated.migrationRef !== undefined
          ? str(input.deprecated.migrationRef)
          : undefined,
    }
  }
  return entry
}

/** 按 seamKey + SemVer 稳定排序（输入顺序变化不影响 normalized 输出）。 */
export function normalizeSeamEntries(
  entries: PluginCapabilitySeamEntry[],
): PluginCapabilitySeamEntry[] {
  const normalized = entries.map((e) => normalizeSeamEntry(e))
  return normalized.sort((a, b) => {
    const keyCmp = a.seamKey.localeCompare(b.seamKey)
    if (keyCmp !== 0) return keyCmp
    return compareSeamVersions(a.seamVersion, b.seamVersion)
  })
}

/** 无歧义精确查找：exact seamKey+seamVersion，且该 identity 唯一时才返回 entry；否则 null。 */
export function lookupSeamEntry(
  entries: PluginCapabilitySeamEntry[],
  seamKey: string,
  seamVersion: string,
): PluginCapabilitySeamEntry | null {
  const matches = entries.filter((e) => e.seamKey === seamKey && e.seamVersion === seamVersion)
  if (matches.length !== 1) return null
  return matches[0]!
}

/** 返回某 seamKey 的所有版本（稳定升序）。 */
export function findSeamVersions(entries: PluginCapabilitySeamEntry[], seamKey: string): string[] {
  return entries
    .filter((e) => e.seamKey === seamKey)
    .map((e) => e.seamVersion)
    .sort(compareSeamVersions)
}

/** 检测重复 identity（seamKey + seamVersion 出现多次）。 */
export function findDuplicateSeamIdentities(entries: PluginCapabilitySeamEntry[]): string[] {
  const seen = new Map<string, number>()
  for (const e of entries) {
    const id = `${e.seamKey}@${e.seamVersion}`
    seen.set(id, (seen.get(id) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id)
}

/**
 * manifest 级请求解析：给定 seamKey + version，返回目录中可引用的接缝。
 * - 未知 seam → `incompatible-unknown-seam`（fail closed，不静默降级到其他 seam）
 * - 重复 identity → `incompatible-ambiguous-identity`（不得任意选择其中一个）
 * - exact 命中且唯一 → `compatible-exact`
 * - 否则按各候选条目的 compatibilityPolicy 取最高兼容版本 → `compatible-same-major`
 * - 都不兼容 → `incompatible-major-mismatch` / `incompatible-requested-future`
 */
export function resolveSeamRequest(
  entries: PluginCapabilitySeamEntry[],
  seamKey: string,
  requestedVersion: string,
): SeamCompatibilityResult {
  const candidates = entries.filter((e) => e.seamKey === seamKey)
  if (candidates.length === 0) return { compatible: false, reasonCode: 'incompatible-unknown-seam' }
  if (findDuplicateSeamIdentities(candidates).length > 0) {
    return { compatible: false, reasonCode: 'incompatible-ambiguous-identity' }
  }
  const exact = candidates.find((e) => e.seamVersion === requestedVersion)
  if (exact) {
    if (exact.deprecated && !exact.deprecated.migrationRef) {
      return { compatible: false, reasonCode: 'incompatible-deprecated-no-migration' }
    }
    return { compatible: true, reasonCode: 'compatible-exact' }
  }
  const compatible = candidates
    .map((candidate) => ({
      candidate,
      result: checkSeamCompatibility({
        catalogVersion: candidate.seamVersion,
        requestedVersion,
        policy: candidate.compatibilityPolicy,
        deprecated: candidate.deprecated,
      }),
    }))
    .filter(({ result }) => result.compatible)
    .sort((a, b) => compareSeamVersions(b.candidate.seamVersion, a.candidate.seamVersion))
  if (compatible.length > 0) return { compatible: true, reasonCode: 'compatible-same-major' }
  const highest = [...candidates].sort((a, b) =>
    compareSeamVersions(b.seamVersion, a.seamVersion),
  )[0]!
  return checkSeamCompatibility({
    catalogVersion: highest.seamVersion,
    requestedVersion,
    policy: highest.compatibilityPolicy,
    deprecated: highest.deprecated,
  })
}

/** 目录 digest：仅基于规范字段的稳定序列化 hash（输入顺序无关）。 */
export function computeSeamCatalogDigest(entries: PluginCapabilitySeamEntry[]): string {
  return computeSeamSourceHash(normalizeSeamEntries(entries))
}

// =============================================================================
// 6. Catalog validator（4.1/4.3/4.5/4.7；redo 红线规则 + 稳定性）
// =============================================================================

export function makeSeamFinding(params: {
  ruleId: SeamRuleId
  code: SeamFindingCode
  severity: SeamSeverity
  seamKey: string
  fieldPath: string
  summary: string
  sourceHash: string
}): SeamFinding {
  const { ruleId, code, severity, seamKey, fieldPath, summary, sourceHash } = params
  return {
    findingId: `${ruleId}-${seamFnv1aHash(`${seamKey}:${fieldPath}:${sourceHash}`)}`,
    ruleId,
    code,
    severity,
    seamKey,
    fieldPath,
    summary,
    sourceHash,
  }
}

/** finding 稳定排序（ruleId → seamKey → fieldPath → findingId）。 */
export function sortSeamFindings(findings: SeamFinding[]): SeamFinding[] {
  return [...findings].sort((a, b) => {
    if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId)
    if (a.seamKey !== b.seamKey) return a.seamKey.localeCompare(b.seamKey)
    if (a.fieldPath !== b.fieldPath) return a.fieldPath.localeCompare(b.fieldPath)
    return a.findingId.localeCompare(b.findingId)
  })
}

/** 红线 finding code 集：不可 waiver，warning waiver 不得放行（spec Requirement 7/8）。 */
export const SEAM_REDLINE_FINDING_CODES: readonly SeamFindingCode[] = [
  'seam-core-authority-delegation',
  'seam-external-action-unauthorized',
  'seam-graph-absent-no-fallback',
]

/**
 * waiver 可放行性：blocking 严重度或红线 code 一律不可 waiver（返回 false）。
 * catalog 本身不实现 waiver 基础设施；该守卫用于证明红线负例无法被 warning waiver 放行。
 */
export function isSeamFindingWaiverable(finding: SeamFinding): boolean {
  if (finding.severity === 'blocking') return false
  if ((SEAM_REDLINE_FINDING_CODES as readonly string[]).includes(finding.code)) return false
  return true
}

/** 三态一致性判定（D3）：返回矛盾描述或 null。 */
export function checkSeamStateConsistency(entry: PluginCapabilitySeamEntry): string | null {
  const { classification, deliveryStatus, availability } = entry
  if (availability === 'host-ready') {
    if (deliveryStatus !== 'delivered') {
      return `availability=host-ready 但 deliveryStatus=${deliveryStatus}（必须 delivered）`
    }
    if (classification === 'deferred' || classification === 'conditional') {
      return `availability=host-ready 与 classification=${classification} 矛盾`
    }
  }
  if (
    (deliveryStatus === 'net-new' ||
      deliveryStatus === 'conditional' ||
      deliveryStatus === 'deferred') &&
    availability === 'host-ready'
  ) {
    return `deliveryStatus=${deliveryStatus} 不得标记 host-ready`
  }
  if (
    (classification === 'deferred' || classification === 'conditional') &&
    deliveryStatus === 'delivered'
  ) {
    return `classification=${classification} 与 deliveryStatus=delivered 矛盾`
  }
  if (availability === 'deprecated' && !entry.deprecated?.migrationRef) {
    return 'availability=deprecated 但无 migrationRef'
  }
  return null
}

/** 核心 authority 下放红线检测（4.3）：返回 delegation 描述或 null。 */
export function checkSeamCoreAuthorityDelegation(entry: PluginCapabilitySeamEntry): string | null {
  const problems: string[] = []
  const isPluginOwned = entry.classification === 'plugin' || entry.classification === 'hybrid'
  if (entry.scopeModes.includes('global')) {
    problems.push('scopeModes 含 global（插件 seam 不得拥有 global authority）')
  }
  if (entry.tenantAuthority === 'client-supplied') {
    problems.push('tenantAuthority=client-supplied（client/plugin 不得决定有效租户）')
  }
  if (entry.formalWriteChannel === 'direct-model-db') {
    problems.push('formalWriteChannel=direct-model-db（插件不得直写模型/数据库）')
  }
  if (entry.auditPolicy === 'plugin-self-asserted') {
    problems.push('auditPolicy=plugin-self-asserted（插件不得自证可信审计）')
  }
  if (entry.networkPolicy === 'direct-allowed') {
    problems.push('networkPolicy=direct-allowed（不得未授权直连外部）')
  }
  if (entry.failureMode === 'fail-open') {
    problems.push('failureMode=fail-open（失败不得扩大权限/回退 global authority）')
  }
  if (entry.compilerInvariantOwnership === 'plugin') {
    problems.push('compilerInvariantOwnership=plugin（Compiler 不变量不得下放）')
  }
  if (
    entry.confirmationPolicy === 'not-required' &&
    ['preview', 'proposal', 'formal-write', 'external-action'].includes(entry.sideEffectClass)
  ) {
    problems.push(
      `sideEffectClass=${entry.sideEffectClass} 要求人工确认但 confirmationPolicy=not-required`,
    )
  }
  if (
    isPluginOwned &&
    entry.dataOwnership === 'core-authoritative' &&
    (entry.surface === 'ui-slot' || entry.surface === 'server-query')
  ) {
    problems.push(
      'ui-slot/server-query 不得声明覆盖正式项目/任务/风险/权限事实（core-authoritative）',
    )
  }
  if (entry.coreAuthorityDelegations && entry.coreAuthorityDelegations.length > 0) {
    problems.push(`coreAuthorityDelegations=${entry.coreAuthorityDelegations.join(',')}`)
  }
  return problems.length > 0 ? problems.join('；') : null
}

/** 一致性矩阵（4.5）：返回矛盾描述数组（external-action 专属规则见 `checkSeamExternalActionAuthorization`）。 */
export function checkSeamMatrixConsistency(entry: PluginCapabilitySeamEntry): string[] {
  const problems: string[] = []
  const { operationModes, sideEffectClass, confirmationPolicy, auditPolicy } = entry
  if (operationModes.includes('formal-write')) {
    if (entry.formalWriteChannel !== 'host-brokered-command') {
      problems.push('formal-write 必须声明 formalWriteChannel=host-brokered-command')
    }
    if (confirmationPolicy === 'not-required') {
      problems.push('formal-write 必须要求人工确认')
    }
    if (auditPolicy === 'none') {
      problems.push('formal-write 必须登记核心审计')
    }
  }
  if (['preview', 'proposal'].includes(sideEffectClass)) {
    if (confirmationPolicy === 'not-required') {
      problems.push('preview/proposal 必须关联后续核心确认')
    }
    if (auditPolicy === 'none') {
      problems.push('preview/proposal 缺审计登记')
    }
  }
  if (sideEffectClass === 'transform' && entry.dataOwnership === 'core-authoritative') {
    problems.push('transformer 不得声明 core-authoritative（不得越过领域 validator）')
  }
  if (entry.dataOwnership === 'plugin-owned-local' && entry.networkPolicy === 'direct-allowed') {
    problems.push('plugin-owned-local + direct-allowed 矛盾（本地数据不得直连外发）')
  }
  return problems
}

/** external-action 授权边界（spec Requirement 8 场景）：返回矛盾描述数组。 */
export function checkSeamExternalActionAuthorization(entry: PluginCapabilitySeamEntry): string[] {
  const problems: string[] = []
  if (entry.classification !== 'conditional') {
    problems.push('external-action 必须 classification=conditional')
  }
  if (entry.networkPolicy !== 'host-brokered') {
    problems.push('external-action 必须 networkPolicy=host-brokered（默认 fixture/mock）')
  }
  if (entry.auditPolicy === 'none' || entry.auditPolicy === 'plugin-self-asserted') {
    problems.push('external-action 必须登记核心审计')
  }
  if (entry.confirmationPolicy === 'not-required') {
    problems.push('external-action 必须受显式用户授权门约束')
  }
  return problems
}

/** 单条目 schema/枚举校验：返回 issues（field path + message）。 */
export function validateSeamEntryShape(
  entry: unknown,
): Array<{ fieldPath: string; message: string }> {
  const issues: Array<{ fieldPath: string; message: string }> = []
  if (!entry || typeof entry !== 'object') {
    issues.push({ fieldPath: '<root>', message: '条目不是对象' })
    return issues
  }
  const e = entry as Partial<PluginCapabilitySeamEntry>
  const missing = (field: string): void => {
    issues.push({ fieldPath: field, message: `缺必填字段 ${field}` })
  }
  if (!e.seamKey || e.seamKey.trim() === '') missing('seamKey')
  if (!e.seamVersion || e.seamVersion.trim() === '') missing('seamVersion')
  if (!e.title || e.title.trim() === '') missing('title')
  if (e.surface === undefined || e.surface === null || !isSeamSurface(e.surface)) {
    issues.push({ fieldPath: 'surface', message: `未知 surface: ${String(e.surface)}` })
  }
  if (!isSeamClassification(e.classification)) {
    issues.push({
      fieldPath: 'classification',
      message: `未知 classification: ${String(e.classification)}`,
    })
  }
  if (!isSeamDeliveryStatus(e.deliveryStatus)) {
    issues.push({
      fieldPath: 'deliveryStatus',
      message: `未知 deliveryStatus: ${String(e.deliveryStatus)}`,
    })
  }
  if (!isSeamAvailability(e.availability)) {
    issues.push({
      fieldPath: 'availability',
      message: `未知 availability: ${String(e.availability)}`,
    })
  }
  if (!e.ownerRef || e.ownerRef.trim() === '') missing('ownerRef')
  if (!Array.isArray(e.contractRefs) || e.contractRefs.length === 0) missing('contractRefs')
  if (!Array.isArray(e.evidenceRefs) || e.evidenceRefs.length === 0) missing('evidenceRefs')
  if (!isSeamEvidenceFreshness(e.evidenceFreshness)) {
    issues.push({
      fieldPath: 'evidenceFreshness',
      message: `未知 evidenceFreshness: ${String(e.evidenceFreshness)}`,
    })
  }
  if (!Array.isArray(e.operationModes) || e.operationModes.length === 0) missing('operationModes')
  if (!e.inputContractRef || e.inputContractRef.trim() === '') missing('inputContractRef')
  if (!e.outputContractRef || e.outputContractRef.trim() === '') missing('outputContractRef')
  if (!isSeamCompatibilityPolicy(e.compatibilityPolicy)) {
    issues.push({
      fieldPath: 'compatibilityPolicy',
      message: `未知 compatibilityPolicy: ${String(e.compatibilityPolicy)}`,
    })
  }
  if (!isSeamFailureMode(e.failureMode)) {
    issues.push({ fieldPath: 'failureMode', message: `未知 failureMode: ${String(e.failureMode)}` })
  }
  if (!Array.isArray(e.scopeModes) || e.scopeModes.length === 0) missing('scopeModes')
  if (!Array.isArray(e.requiredPermissions) || e.requiredPermissions.length === 0)
    missing('requiredPermissions')
  if (!isSeamDataOwnership(e.dataOwnership)) {
    issues.push({
      fieldPath: 'dataOwnership',
      message: `未知 dataOwnership: ${String(e.dataOwnership)}`,
    })
  }
  if (!isSeamSideEffectClass(e.sideEffectClass)) {
    issues.push({
      fieldPath: 'sideEffectClass',
      message: `未知 sideEffectClass: ${String(e.sideEffectClass)}`,
    })
  }
  if (!isSeamConfirmationPolicy(e.confirmationPolicy)) {
    issues.push({
      fieldPath: 'confirmationPolicy',
      message: `未知 confirmationPolicy: ${String(e.confirmationPolicy)}`,
    })
  }
  if (!isSeamAuditPolicy(e.auditPolicy)) {
    issues.push({ fieldPath: 'auditPolicy', message: `未知 auditPolicy: ${String(e.auditPolicy)}` })
  }
  if (!isSeamNetworkPolicy(e.networkPolicy)) {
    issues.push({
      fieldPath: 'networkPolicy',
      message: `未知 networkPolicy: ${String(e.networkPolicy)}`,
    })
  }
  if (e.tenantAuthority !== undefined && !isSeamTenantAuthority(e.tenantAuthority)) {
    issues.push({
      fieldPath: 'tenantAuthority',
      message: `未知 tenantAuthority: ${String(e.tenantAuthority)}`,
    })
  }
  if (e.formalWriteChannel !== undefined && !isSeamFormalWriteChannel(e.formalWriteChannel)) {
    issues.push({
      fieldPath: 'formalWriteChannel',
      message: `未知 formalWriteChannel: ${String(e.formalWriteChannel)}`,
    })
  }
  if (
    e.compilerInvariantOwnership !== undefined &&
    !isSeamCompilerInvariantOwnership(e.compilerInvariantOwnership)
  ) {
    issues.push({
      fieldPath: 'compilerInvariantOwnership',
      message: `未知 compilerInvariantOwnership: ${String(e.compilerInvariantOwnership)}`,
    })
  }
  // 枚举成员有效性（operationModes/scopeModes/contractRefs/permissions）
  for (const om of e.operationModes ?? []) {
    if (!isSeamOperationMode(om)) {
      issues.push({ fieldPath: 'operationModes', message: `未知操作模式: ${String(om)}` })
    }
  }
  for (const sm of e.scopeModes ?? []) {
    if (!isSeamScopeMode(sm)) {
      issues.push({ fieldPath: 'scopeModes', message: `未知 scope 模式: ${String(sm)}` })
    }
  }
  return issues
}

/** 校验并评估一个目录（4.1/4.3/4.5/4.7）。findings 稳定排序。 */
export function validateSeamCatalog(
  input: PluginCapabilitySeamEntry[],
  context: SeamValidationContext = {},
): SeamCatalogValidationResult {
  const rawFindings: SeamFinding[] = []
  const normalized = normalizeSeamEntries(input)
  const knownContractRefs = new Set(context.knownContractRefs ?? [])
  const knownOwnerRefs = new Set(context.knownOwnerRefs ?? [])

  // 4.1: schema / 枚举 / 必填 / identity / version
  for (const entry of normalized) {
    const shapeIssues = validateSeamEntryShape(entry)
    for (const issue of shapeIssues) {
      const isEnumIssue =
        /未知 (surface|classification|deliveryStatus|availability|evidenceFreshness|compatibilityPolicy|failureMode|dataOwnership|sideEffectClass|confirmationPolicy|auditPolicy|networkPolicy|tenantAuthority|formalWriteChannel|compilerInvariantOwnership|操作模式|scope 模式)/.test(
          issue.message,
        )
      rawFindings.push(
        makeSeamFinding({
          ruleId: isEnumIssue ? SEAM_RULE_IDS.unknownEnum : SEAM_RULE_IDS.schemaInvalid,
          code: isEnumIssue ? 'seam-unknown-enum' : 'seam-schema-invalid',
          severity: 'blocking',
          seamKey: entry.seamKey || '<unknown>',
          fieldPath: issue.fieldPath,
          summary: isEnumIssue
            ? `条目枚举无效：${issue.message}`
            : `条目结构无效：${issue.message}`,
          sourceHash: computeSeamSourceHash([entry.seamKey, issue.fieldPath]),
        }),
      )
    }
    if (parseSeamVersion(entry.seamVersion) === null) {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.invalidVersion,
          code: 'seam-invalid-version',
          severity: 'blocking',
          seamKey: entry.seamKey,
          fieldPath: 'seamVersion',
          summary: `seamVersion 非法（要求 MAJOR.MINOR.PATCH）: ${entry.seamVersion}`,
          sourceHash: computeSeamSourceHash([entry.seamKey, entry.seamVersion]),
        }),
      )
    }
    // 4.1: 未知 contract/owner refs（提供 known 集时启用）
    if (knownContractRefs.size > 0) {
      for (const ref of entry.contractRefs) {
        if (!knownContractRefs.has(ref)) {
          rawFindings.push(
            makeSeamFinding({
              ruleId: SEAM_RULE_IDS.unknownContractRef,
              code: 'seam-unknown-contract-ref',
              severity: 'blocking',
              seamKey: entry.seamKey,
              fieldPath: `contractRefs[${ref}]`,
              summary: `未知 contract ref: ${ref}`,
              sourceHash: computeSeamSourceHash([entry.seamKey, ref]),
            }),
          )
        }
      }
    }
    if (knownOwnerRefs.size > 0 && !knownOwnerRefs.has(entry.ownerRef)) {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.unknownOwnerRef,
          code: 'seam-unknown-owner-ref',
          severity: 'blocking',
          seamKey: entry.seamKey,
          fieldPath: 'ownerRef',
          summary: `未知 ownerRef: ${entry.ownerRef}`,
          sourceHash: computeSeamSourceHash([entry.seamKey, entry.ownerRef]),
        }),
      )
    }
    // 4.5: scope/permission 缺失（spec Requirement 8 场景：org/project scoped 无权限 → blocking）
    if (entry.scopeModes.length === 0 || entry.requiredPermissions.length === 0) {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.scopePermissionMissing,
          code: 'seam-scope-permission-missing',
          severity: 'blocking',
          seamKey: entry.seamKey,
          fieldPath: 'scopeModes',
          summary:
            entry.scopeModes.length === 0
              ? 'scopeModes 为空（禁止隐式 scope）'
              : 'organization/project scoped entry 缺 requiredPermissions',
          sourceHash: computeSeamSourceHash([entry.seamKey, 'scope-permission']),
        }),
      )
    }
    // 4.3: 核心 authority 红线（blocking，不可 waiver）
    const delegation = checkSeamCoreAuthorityDelegation(entry)
    if (delegation !== null) {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.coreAuthorityDelegation,
          code: 'seam-core-authority-delegation',
          severity: 'blocking',
          seamKey: entry.seamKey,
          fieldPath: 'authority',
          summary: `核心 authority 下放红线：${delegation}`,
          sourceHash: computeSeamSourceHash([entry.seamKey, delegation]),
        }),
      )
    }
    // 4.1: 三态一致性
    const stateIssue = checkSeamStateConsistency(entry)
    if (stateIssue !== null) {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.stateContradiction,
          code: 'seam-state-contradiction',
          severity: 'blocking',
          seamKey: entry.seamKey,
          fieldPath: 'availability',
          summary: `三态矛盾：${stateIssue}`,
          sourceHash: computeSeamSourceHash([entry.seamKey, stateIssue]),
        }),
      )
    }
    // 4.5: 一致性矩阵
    for (const problem of checkSeamMatrixConsistency(entry)) {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.matrixInconsistent,
          code: 'seam-matrix-inconsistent',
          severity: 'blocking',
          seamKey: entry.seamKey,
          fieldPath: 'matrix',
          summary: `矩阵不一致：${problem}`,
          sourceHash: computeSeamSourceHash([entry.seamKey, problem]),
        }),
      )
    }
    // 4.5/8: external action 授权边界（spec Scenario: 外部动作被标为默认可用 → fail closed）
    if (
      entry.sideEffectClass === 'external-action' ||
      entry.operationModes.includes('external-action')
    ) {
      for (const problem of checkSeamExternalActionAuthorization(entry)) {
        rawFindings.push(
          makeSeamFinding({
            ruleId: SEAM_RULE_IDS.externalActionUnauthorized,
            code: 'seam-external-action-unauthorized',
            severity: 'blocking',
            seamKey: entry.seamKey,
            fieldPath: 'sideEffectClass',
            summary: `external-action 未满足授权边界：${problem}`,
            sourceHash: computeSeamSourceHash([entry.seamKey, problem]),
          }),
        )
      }
    }
    // 4.7: evidence freshness / local ref 校验
    const highRisk =
      entry.availability === 'host-ready' || entry.sideEffectClass === 'external-action'
    if (
      entry.availability === 'host-ready' &&
      (entry.evidenceFreshness !== 'fresh' || entry.evidenceRefs.length === 0)
    ) {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.hostReadyNoEvidence,
          code: 'seam-host-ready-no-evidence',
          severity: 'blocking',
          seamKey: entry.seamKey,
          fieldPath: 'evidenceRefs',
          summary: `host-ready 缺新鲜证据（freshness=${entry.evidenceFreshness}, refs=${entry.evidenceRefs.length}）`,
          sourceHash: computeSeamSourceHash([entry.seamKey, 'host-ready-evidence']),
        }),
      )
    }
    if (entry.evidenceFreshness === 'missing') {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.evidenceMissing,
          code: 'seam-evidence-missing',
          severity: 'warning',
          seamKey: entry.seamKey,
          fieldPath: 'evidenceFreshness',
          summary: '普通 cataloged 条目证据缺失（degraded）',
          sourceHash: computeSeamSourceHash([entry.seamKey, 'evidence-missing']),
        }),
      )
    } else if (entry.evidenceFreshness === 'stale') {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.evidenceStale,
          code: 'seam-evidence-stale',
          severity: highRisk ? 'blocking' : 'warning',
          seamKey: entry.seamKey,
          fieldPath: 'evidenceFreshness',
          summary: `证据过期（freshness=stale${highRisk ? '，high-risk 阻塞' : '，degraded'}）`,
          sourceHash: computeSeamSourceHash([entry.seamKey, 'evidence-stale']),
        }),
      )
    }
    if (context.evidencePathResolver && entry.evidenceRefs.length > 0) {
      for (const ref of entry.evidenceRefs) {
        if (
          ref.kind === 'spec' ||
          ref.kind === 'source' ||
          ref.kind === 'test' ||
          ref.kind === 'runbook'
        ) {
          if (!context.evidencePathResolver(ref.path)) {
            rawFindings.push(
              makeSeamFinding({
                ruleId: SEAM_RULE_IDS.evidencePathInvalid,
                code: 'seam-evidence-path-invalid',
                severity: highRisk ? 'blocking' : 'warning',
                seamKey: entry.seamKey,
                fieldPath: `evidenceRefs[${ref.path}]`,
                summary: `证据 ref 路径不存在（${highRisk ? 'high-risk 阻塞' : 'degraded'}）: ${ref.path}`,
                sourceHash: computeSeamSourceHash([entry.seamKey, ref.path]),
              }),
            )
          }
        }
      }
    }
    // 4.9: 低敏扫描（条目自身含敏感材料 → blocking redaction violation）
    const entryStrings: string[] = [
      entry.seamKey,
      entry.title,
      entry.description ?? '',
      entry.ownerRef,
      entry.inputContractRef,
      entry.outputContractRef,
      ...entry.contractRefs,
      ...entry.requiredPermissions,
    ]
    if (entryStrings.some((s) => containsSeamSensitiveContent(s))) {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.redactionViolation,
          code: 'seam-redaction-violation',
          severity: 'blocking',
          seamKey: entry.seamKey,
          fieldPath: '<entry-text>',
          summary: '条目文本含敏感材料（secret/token/prompt/provider payload），必须清理',
          sourceHash: computeSeamSourceHash([entry.seamKey, 'redaction']),
        }),
      )
    }
  }

  // 4.1: 重复 identity（blocking；lookup 不得任意选择）
  for (const id of findDuplicateSeamIdentities(normalized)) {
    const [key] = id.split('@')
    rawFindings.push(
      makeSeamFinding({
        ruleId: SEAM_RULE_IDS.duplicateIdentity,
        code: 'seam-duplicate-identity',
        severity: 'blocking',
        seamKey: key ?? id,
        fieldPath: 'seamVersion',
        summary: `重复 identity: ${id}`,
        sourceHash: computeSeamSourceHash([id, 'duplicate']),
      }),
    )
  }

  // 4.7: 图谱空结果无 source fallback → blocking（空图谱不得证明不存在）
  if (context.graphAbsentWithoutFallback === true) {
    rawFindings.push(
      makeSeamFinding({
        ruleId: SEAM_RULE_IDS.graphAbsentNoFallback,
        code: 'seam-graph-absent-no-fallback',
        severity: 'blocking',
        seamKey: '<catalog>',
        fieldPath: 'evidence',
        summary: '图谱空/过期结果无 source fallback：不得据此判定实现不存在',
        sourceHash: computeSeamSourceHash(['graph-absent', 'no-fallback']),
      }),
    )
  }

  const findings = sortSeamFindings(rawFindings)
  const blockingCount = findings.filter((f) => f.severity === 'blocking').length
  const warningCount = findings.filter((f) => f.severity === 'warning').length
  return {
    digest: computeSeamCatalogDigest(normalized),
    entries: normalized,
    findings,
    blockingCount,
    warningCount,
  }
}

/** 带 required family 覆盖校验的目录评估入口（curated catalog 与 checker 使用）。 */
export function evaluateSeamCatalog(
  input: PluginCapabilitySeamEntry[],
  options: SeamValidationContext & { requiredFamilies?: readonly string[] } = {},
): SeamCatalogValidationResult {
  const entries = input.map((raw) => normalizeSeamEntry(raw))
  const rawFindings: SeamFinding[] = []
  const requiredFamilies = options.requiredFamilies ?? REQUIRED_PLUGIN_SEAM_FAMILIES
  for (const family of requiredFamilies) {
    if (!entries.some((e) => e.surface === family)) {
      rawFindings.push(
        makeSeamFinding({
          ruleId: SEAM_RULE_IDS.requiredFamilyGap,
          code: 'seam-required-family-gap',
          severity: 'blocking',
          seamKey: `family:${family}`,
          fieldPath: 'surface',
          summary: `required family 无目录条目: ${family}`,
          sourceHash: computeSeamSourceHash(['family-gap', family]),
        }),
      )
    }
  }
  const validated = validateSeamCatalog(entries, options)
  const findings = sortSeamFindings([...validated.findings, ...rawFindings])
  return {
    digest: validated.digest,
    entries: validated.entries,
    findings,
    blockingCount: findings.filter((f) => f.severity === 'blocking').length,
    warningCount: findings.filter((f) => f.severity === 'warning').length,
  }
}

// =============================================================================
// 7. 低敏 sanitization（4.9；spec Requirement 11）
// =============================================================================

/** 禁止键表：finding/evidence/report 中出现即删除或打码。 */
export const SEAM_FORBIDDEN_KEYS = [
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
  'providerPayload',
  'provider_payload',
  'rawResponse',
  'raw_response',
  'tenantAgencyId',
  'tenant_agency_id',
] as const

/** 禁止键的 regex 匹配（大小写不敏感，key 级）。 */
const SEAM_FORBIDDEN_KEY_RE =
  /^(authorization|proxy[-_]?authorization|api[-_]?key|secret|password|passphrase|access[-_]?token|refresh[-_]?token|bearer[-_]?token|prompt|model[-_]?output|provider[-_]?payload|raw[-_]?response|tenant[-_]?agency[-_]?id)$/i

/** 敏感值正则表（值级检测：出现即 redact/拒绝）。 */
export const SEAM_SENSITIVE_PATTERNS: ReadonlyArray<{
  reason: SeamRedactionReasonCode
  pattern: RegExp
  label: string
}> = [
  {
    reason: 'secret',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
    label: 'private-key',
  },
  {
    reason: 'token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    label: 'jwt',
  },
  {
    reason: 'token',
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    label: 'api-key',
  },
  {
    reason: 'token',
    pattern:
      /\b(?:token|api[_-]?key|secret|access[-_]?token|refresh[-_]?token|bearer[-_]?token)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./]{12,}/gi,
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
    reason: 'cross-tenant-id',
    pattern:
      /\b(?:tenant_id|tenantId|organization_id|organizationId)\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/gi,
    label: 'tenant-id',
  },
]

export interface SeamRedactResult {
  text: string
  redactedCount: number
  reasons: Partial<Record<SeamRedactionReasonCode, number>>
}

/** 文本级 redaction：敏感片段替换为 `[REDACTED:label:hash]`；超长内容整体打码。 */
export function redactSeamText(text: string, maxBytes = 64 * 1024): SeamRedactResult {
  const reasons: Partial<Record<SeamRedactionReasonCode, number>> = {}
  let redactedCount = 0
  let current = text

  if (text.length > maxBytes) {
    const hash = seamFnv1aHash(current)
    current = `[REDACTED:oversized-log:${hash.slice(0, 8)}]${current.slice(0, 500)}\n...\n${current.slice(-500)}`
    reasons['oversized-log'] = (reasons['oversized-log'] ?? 0) + 1
    redactedCount += 1
  }

  for (const { reason, pattern, label } of SEAM_SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0
    const matched = current.match(pattern)
    if (!matched) continue
    let count = 0
    current = current.replace(pattern, (frag) => {
      count += 1
      return `[REDACTED:${label}:${seamFnv1aHash(frag).slice(0, 8)}]`
    })
    if (count > 0) {
      redactedCount += count
      reasons[reason] = (reasons[reason] ?? 0) + count
    }
  }

  return { text: current, redactedCount, reasons }
}

/** 值级扫描：文本中是否命中任何敏感模式。 */
export function containsSeamSensitiveContent(text: string): boolean {
  if (text.length === 0) return false
  for (const { pattern } of SEAM_SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) return true
  }
  return false
}

/**
 * 低敏 finding/report sanitizer：只允许 key、reason code、severity、field path、计数、hash
 * 与 evidence refs；对字符串值做文本 redaction，遇到 forbidden 键直接丢弃。
 * 返回 { sanitized, droppedKeys, redactedCount }。
 */
export function sanitizeSeamOutput(
  value: unknown,
  seen = new WeakSet<object>(),
): { sanitized: unknown; droppedKeys: string[]; redactedCount: number } {
  if (value === null || value === undefined)
    return { sanitized: value, droppedKeys: [], redactedCount: 0 }
  if (typeof value !== 'object') {
    if (typeof value === 'string') {
      const r = redactSeamText(value)
      if (r.redactedCount > 0) {
        return { sanitized: r.text, droppedKeys: [], redactedCount: r.redactedCount }
      }
    }
    return { sanitized: value, droppedKeys: [], redactedCount: 0 }
  }
  if (seen.has(value))
    return { sanitized: '[REDACTED:circular]', droppedKeys: [], redactedCount: 0 }
  seen.add(value)

  if (Array.isArray(value)) {
    let redactedCount = 0
    const droppedKeys: string[] = []
    const items = value.map((item) => {
      const r = sanitizeSeamOutput(item, seen)
      redactedCount += r.redactedCount
      droppedKeys.push(...r.droppedKeys)
      return r.sanitized
    })
    return { sanitized: items, droppedKeys, redactedCount }
  }

  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  let redactedCount = 0
  const droppedKeys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (SEAM_FORBIDDEN_KEY_RE.test(k)) {
      droppedKeys.push(k)
      redactedCount += 1
      continue
    }
    const r = sanitizeSeamOutput(v, seen)
    redactedCount += r.redactedCount
    droppedKeys.push(...r.droppedKeys)
    out[k] = r.sanitized
  }
  return { sanitized: out, droppedKeys, redactedCount }
}
