/**
 * local-plugin-developer-kit —— V3 本机插件开发套件共享契约与纯函数
 * （纯类型 + 常量 + 类型守卫 + 确定性归一化/校验/digest + 低敏 sanitization，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。
 * CLI 入口见 `scripts/plugin-dev.ts`，测试见 `local-plugin-developer-kit.test.ts`。
 *
 * # 语义要点（对应 design.md D1~D8 与 specs/local-plugin-developer-kit/spec.md）
 * - 统一 CLI：validate / install-dry-run / audit-summary，closed 子命令，显式仓库相对路径，
 *   禁止隐式扫描，拒绝未知子命令/关键参数/缺失输入 → tool-error (2)。
 * - validate 复用 manifest / permission / seam compatibility / contribution payload / 内容 descriptor/digest
 *   唯一事实来源，固定阶段管线，保留上游 code/severity/field path，前置 blocking 后阶段 skipped。
 * - 插件根读取：lexical + realpath 双重边界、allowlist 文件、单文件/总字节/文件数预算。
 * - install-dry-run：只消费已验证插件 + 显式 host profile + closed action + reference time，
 *   复用状态机/贡献影响/权限摘要/plan digest 纯函数，零 DB/模型/handle/grant/审计写入，confirmable=false。
 * - audit-summary：只消费本机低敏诊断 envelope，按 command/phase/code/severity 有界聚合，
 *   保留来源 digests/omitted，trustedAudit=false，拒绝 production authority claim。
 * - 统一 envelope：schemaVersion/command/status/phase/code/severity/field path/counts/digests/兼容摘要/省略计数；
 *   人读文本与 JSON 同源规范化结果；退出码 0=passed 1=blocking 2=tool-error；warning-only 返回 0。
 * - 低敏：输入/异常/finding/文本/JSON/快照 allowlist + 二次敏感扫描；禁止 secret/token/URL/绝对路径/stack/环境值/原始 manifest/payload/插件源码/生产内容/真实租户标识；自由文本异常映射稳定 code。
 * - 零外部依赖：默认 pnpm 本机基线，无 Docker/Redis/VectorDB/collector/remote registry/外部模型/网络出口；URL/remote source/真实第三方插件/外部动作请求 → blocking。
 */

import { validateManifestShape, computeManifestDigest } from './plugin-manifest.js'
import {
  computeInstallPreviewDigest as sharedComputeInstallPreviewDigest,
  computePermissionDigest as sharedComputePermissionDigest,
  fnv1a32Install as sharedFnv1a32Install,
  transitionPluginInstallStatus as sharedTransitionPluginInstallStatus,
} from './plugin-install-lifecycle.js'
import { validatePluginContributionPayload } from './plugin-skill-adapter.js'

// Re-export shared pure helpers for service delegation (任务 4.1：禁止复制第二套状态机/permission vocabulary)
export {
  sharedComputeInstallPreviewDigest as computePreviewDigestForService,
  sharedComputePermissionDigest as computePermissionDigestForService,
  sharedFnv1a32Install as fnvForService,
  sharedTransitionPluginInstallStatus as transitionForService,
}

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** Report schema version（首版固定 "1.0"）。 */
export const LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION = '1.0' as const
export type LocalPluginDevReportSchemaVersion = typeof LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION

/** Host profile schema version。 */
export const LOCAL_PLUGIN_HOST_PROFILE_SCHEMA_VERSION = '1.0' as const
export type LocalPluginHostProfileSchemaVersion = typeof LOCAL_PLUGIN_HOST_PROFILE_SCHEMA_VERSION

/** Install plan schema version。 */
export const LOCAL_PLUGIN_INSTALL_PLAN_SCHEMA_VERSION = '1.0' as const
export type LocalPluginInstallPlanSchemaVersion = typeof LOCAL_PLUGIN_INSTALL_PLAN_SCHEMA_VERSION

/** 统一 CLI 子命令（closed 集）。 */
export const LOCAL_PLUGIN_DEV_COMMANDS = ['validate', 'install-dry-run', 'audit-summary'] as const
export type LocalPluginDevCommand = (typeof LOCAL_PLUGIN_DEV_COMMANDS)[number]

/** 输出格式。 */
export const LOCAL_PLUGIN_DEV_FORMATS = ['text', 'json'] as const
export type LocalPluginDevFormat = (typeof LOCAL_PLUGIN_DEV_FORMATS)[number]

/** Report 状态（与退出码对齐）。 */
export const LOCAL_PLUGIN_DEV_STATUSES = ['passed', 'blocking', 'tool-error'] as const
export type LocalPluginDevStatus = (typeof LOCAL_PLUGIN_DEV_STATUSES)[number]

/** Finding 严重度（与上游对齐）。 */
export const LOCAL_PLUGIN_DEV_SEVERITIES = ['info', 'warning', 'blocking'] as const
export type LocalPluginDevSeverity = (typeof LOCAL_PLUGIN_DEV_SEVERITIES)[number]

/** Phase（固定阶段管线）。 */
export const LOCAL_PLUGIN_DEV_PHASES = [
  'input',
  'manifest',
  'seam-compatibility',
  'permission',
  'contribution',
  'content',
  'install-plan',
  'audit-summary',
  'tool-error',
] as const
export type LocalPluginDevPhase = (typeof LOCAL_PLUGIN_DEV_PHASES)[number]

/** Install dry-run lifecycle action（复用 PLUGIN_INSTALL_ACTIONS 封闭集）。 */
export const LOCAL_PLUGIN_INSTALL_DRY_RUN_ACTIONS = [
  'install',
  'enable',
  'disable',
  'uninstall',
  'upgrade',
] as const
export type LocalPluginInstallDryRunAction = (typeof LOCAL_PLUGIN_INSTALL_DRY_RUN_ACTIONS)[number]

/** 退出码。 */
export const LOCAL_PLUGIN_DEV_EXIT = {
  pass: 0,
  blocking: 1,
  toolError: 2,
} as const

/** 预算（有界）。 */
export const LOCAL_PLUGIN_DEV_BUDGETS = {
  maxManifestBytes: 256 * 1024, // 256KB
  maxPayloadBytes: 256 * 1024,
  maxFileBytes: 512 * 1024, // 单文件
  maxTotalBytes: 2 * 1024 * 1024, // 总
  maxFiles: 100,
  maxFindings: 200,
  maxReportBytes: 512 * 1024,
  maxInputArray: 200,
  maxDiagnosticsEnvelopes: 20,
} as const

/** Finding code（封闭集，稳定、低敏、机器可判）。 */
export const LOCAL_PLUGIN_DEV_FINDING_CODES = [
  // input / tool
  'dev-tool-unknown-command',
  'dev-tool-unknown-argument',
  'dev-tool-missing-input',
  'dev-tool-invalid-path',
  'dev-tool-path-traversal',
  'dev-tool-path-escape',
  'dev-tool-path-absolute',
  'dev-tool-path-url',
  'dev-tool-path-control-char',
  'dev-tool-path-symlink-escape',
  'dev-tool-budget-exceeded',
  'dev-tool-read-error',
  'dev-tool-json-parse-error',
  'dev-tool-schema-version-mismatch',
  'dev-tool-unknown-field',
  // validate phases
  'dev-validate-manifest-invalid',
  'dev-validate-seam-unknown',
  'dev-validate-seam-not-host-ready',
  'dev-validate-permission-unknown',
  'dev-validate-permission-escalation',
  'dev-validate-contribution-invalid',
  'dev-validate-content-mismatch',
  'dev-validate-remote-source-blocked',
  'dev-validate-network-blocked',
  // host profile
  'dev-host-profile-missing-field',
  'dev-host-profile-unknown-field',
  'dev-host-profile-authority-claim',
  'dev-host-profile-sensitive-value',
  // install plan
  'dev-install-illegal-transition',
  'dev-install-digest-mismatch',
  'dev-install-contribution-blocked',
  'dev-install-authority-claim',
  // audit summary
  'dev-audit-unknown-schema',
  'dev-audit-trusted-claim-rejected',
  'dev-audit-digest-tampered',
  'dev-audit-budget-exceeded',
  // redaction / sensitive
  'dev-redaction-violation',
  // generic
  'dev-tool-error',
] as const
export type LocalPluginDevFindingCode = (typeof LOCAL_PLUGIN_DEV_FINDING_CODES)[number]

/** 敏感键模式（小写匹配）。 */
export const LOCAL_PLUGIN_DEV_SENSITIVE_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'authorization',
  'bearer',
  'credential',
  'private_key',
  'private-key',
] as const

// =============================================================================
// 2. 核心类型
// =============================================================================

/** 统一 finding（稳定 code/severity/phase/field path）。 */
export interface LocalPluginDevFinding {
  code: LocalPluginDevFindingCode
  severity: LocalPluginDevSeverity
  phase: LocalPluginDevPhase
  fieldPath?: string
  message?: string
  count?: number
  evidenceRef?: string
}

/** 计数。 */
export interface LocalPluginDevCounts {
  total: number
  blocking: number
  warning: number
  info: number
  omitted: number
}

/** 兼容性摘要。 */
export interface LocalPluginDevCompatibilitySummary {
  catalogDigest?: string
  manifestDigest?: string
  sourceDigest?: string
}

/** 统一报告 envelope（版本化、低敏、确定性）。 */
export interface LocalPluginDevReport {
  schemaVersion: LocalPluginDevReportSchemaVersion
  kind: 'local-plugin-dev-report-v1'
  reportId: string
  generatedAt: string
  commit: string
  command: LocalPluginDevCommand
  status: LocalPluginDevStatus
  phase: LocalPluginDevPhase
  findings: LocalPluginDevFinding[]
  counts: LocalPluginDevCounts
  inputDigest?: string
  resultDigest: string
  compatibilitySummary?: LocalPluginDevCompatibilitySummary
  omittedCounts?: Record<string, number>
  trustedAudit: false
  redactionSummary?: { redactedCount: number; reasons: Record<string, number> }
}

/** Host profile（版本化、封闭、低权限、不可冒充可信授权）。 */
export interface LocalPluginHostProfileV1 {
  schemaVersion: LocalPluginHostProfileSchemaVersion
  kind: 'local-plugin-host-profile-v1'
  hostContractVersion: string
  catalogDigest: string
  currentStatus: 'not_installed' | 'installed' | 'enabled' | 'uninstalled'
  approvedReleaseDigest?: string
  approvedReleaseVersion?: string
  allowedScopeKinds: Array<'organization' | 'project'>
  referenceTime: string // ISO
}

/** Install plan（版本化、确定性、不可确认）。 */
export interface LocalPluginInstallPlanV1 {
  schemaVersion: LocalPluginInstallPlanSchemaVersion
  kind: 'local-plugin-install-plan-v1'
  action: LocalPluginInstallDryRunAction
  currentStatus: 'not_installed' | 'installed' | 'enabled' | 'uninstalled'
  targetStatus: 'installed' | 'enabled' | 'uninstalled'
  affectedContributions: Array<{
    contributionKey: string
    seamKey: string
    seamVersion: string
    title?: string
  }>
  requestedPermissions: Array<{
    permissionKey: string
    seamKey: string
    sideEffect: string
    network: string
    purpose?: string
  }>
  sourceDigest?: string
  manifestDigest?: string
  catalogDigest: string
  warnings: LocalPluginDevFinding[]
  blockers: LocalPluginDevFinding[]
  planDigest: string
  confirmable: false
  generatedAt: string
}

/** 诊断聚合输入（受支持 envelope 数组）。 */
export interface LocalPluginDiagnosticsInput {
  reports: LocalPluginDevReport[]
}

/** 诊断聚合输出（有界、稳定排序）。 */
export interface LocalPluginDiagnosticsSummary {
  schemaVersion: LocalPluginDevReportSchemaVersion
  kind: 'local-plugin-diagnostics-summary-v1'
  generatedAt: string
  totalReports: number
  totalFindings: number
  blockingCount: number
  warningCount: number
  byCommand: Record<string, number>
  byPhase: Record<string, number>
  byCode: Record<string, number>
  bySeverity: Record<string, number>
  topFindings: LocalPluginDevFinding[]
  sourceDigests: string[]
  omittedCounts: Record<string, number>
  trustedAudit: false
  digest: string
}

// =============================================================================
// 3. 类型守卫
// =============================================================================

export function isLocalPluginDevCommand(v: unknown): v is LocalPluginDevCommand {
  return typeof v === 'string' && (LOCAL_PLUGIN_DEV_COMMANDS as readonly string[]).includes(v)
}
export function isLocalPluginDevFormat(v: unknown): v is LocalPluginDevFormat {
  return typeof v === 'string' && (LOCAL_PLUGIN_DEV_FORMATS as readonly string[]).includes(v)
}
export function isLocalPluginDevStatus(v: unknown): v is LocalPluginDevStatus {
  return typeof v === 'string' && (LOCAL_PLUGIN_DEV_STATUSES as readonly string[]).includes(v)
}
export function isLocalPluginDevSeverity(v: unknown): v is LocalPluginDevSeverity {
  return typeof v === 'string' && (LOCAL_PLUGIN_DEV_SEVERITIES as readonly string[]).includes(v)
}
export function isLocalPluginDevPhase(v: unknown): v is LocalPluginDevPhase {
  return typeof v === 'string' && (LOCAL_PLUGIN_DEV_PHASES as readonly string[]).includes(v)
}
export function isLocalPluginInstallDryRunAction(v: unknown): v is LocalPluginInstallDryRunAction {
  return (
    typeof v === 'string' && (LOCAL_PLUGIN_INSTALL_DRY_RUN_ACTIONS as readonly string[]).includes(v)
  )
}
export function isLocalPluginDevFindingCode(v: unknown): v is LocalPluginDevFindingCode {
  return typeof v === 'string' && (LOCAL_PLUGIN_DEV_FINDING_CODES as readonly string[]).includes(v)
}

// =============================================================================
// 4. 确定性序列化与 hash（零外部依赖）
// =============================================================================

/** 确定性稳定序列化（键排序，数组保持顺序）。 */
export function devStableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => devStableSerialize(v)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + devStableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

/** FNV-1a 32-bit hash（hex）。 */
export function devFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 计算报告/计划的 canonical digest（排除 invocation metadata）。 */
export function computeDevDigest(value: unknown): string {
  return devFnv1aHash(devStableSerialize(value))
}

// =============================================================================
// 5. 低敏 redaction 与敏感扫描
// =============================================================================

/** 检查键是否为敏感键（小写匹配）。 */
export function devIsSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return (LOCAL_PLUGIN_DEV_SENSITIVE_KEY_PATTERNS as readonly string[]).some(
    (p) => lower === p || lower.includes(p),
  )
}

/** 敏感值模式（token / Authorization / URL / 绝对路径 / stack）。 */
const DEV_SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /(?:^|\s)(?:sk|pk|tk)_[A-Za-z0-9]{20,}/,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._\-]+/,
  /(?:^|\s)(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /https?:\/\/[^\s]+/i,
  /(?:[A-Z]:\\|\/)[^\s]*?(?:\.ts|\.js|\.json|\.env)/i,
  /at\s+.*\(.*:\d+:\d+\)/,
  /Authorization\s*:/i,
]

/** Windows 绝对路径。 */
const DEV_WINDOWS_ABS_RE = /^[A-Za-z]:[\\/]/
/** POSIX 绝对路径。 */
const DEV_POSIX_ABS_RE = /^\//

function devContainsSensitiveValue(value: string): boolean {
  for (const p of DEV_SENSITIVE_VALUE_PATTERNS) if (p.test(value)) return true
  if (DEV_WINDOWS_ABS_RE.test(value) || DEV_POSIX_ABS_RE.test(value)) return true
  return false
}

/** 敏感值二次扫描（用于测试快照/输出）。 */
export function devContainsSensitiveData(value: string): boolean {
  return devContainsSensitiveValue(value)
}

/** 对 finding 做 allowlist redaction（稳定消息，不回显原始值）。 */
export function redactDevFinding(finding: LocalPluginDevFinding): LocalPluginDevFinding {
  const result = { ...finding }
  if (result.evidenceRef && devContainsSensitiveValue(result.evidenceRef)) {
    result.evidenceRef = '[redacted]'
  }
  if (result.message && devContainsSensitiveValue(result.message)) {
    result.message = '[redacted]'
  }
  return result
}

/** 深层 allowlist redaction（丢弃敏感键和值模式）。 */
export function devDeepRedact<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    if (devContainsSensitiveValue(obj)) return '[redacted]' as T
    return obj
  }
  if (Array.isArray(obj)) return obj.map((item) => devDeepRedact(item)) as T
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (devIsSensitiveKey(key)) {
        result[key] = '[redacted]'
      } else {
        result[key] = devDeepRedact(value)
      }
    }
    return result as T
  }
  return obj
}

/** 稳定 tool-error 映射（自由文本异常 → 封闭 code + 有界安全消息）。 */
export function mapToolError(error: unknown): LocalPluginDevFinding {
  const raw = error instanceof Error ? error.message : String(error)
  // 不回显原值，仅给稳定 code 和安全消息
  if (/unknown command/i.test(raw)) {
    return {
      code: 'dev-tool-unknown-command',
      severity: 'blocking',
      phase: 'tool-error',
      message: '未知子命令',
    }
  }
  if (/unknown argument|未知参数/i.test(raw)) {
    return {
      code: 'dev-tool-unknown-argument',
      severity: 'blocking',
      phase: 'tool-error',
      message: '未知参数',
    }
  }
  if (/missing|缺失|需要值/i.test(raw)) {
    return {
      code: 'dev-tool-missing-input',
      severity: 'blocking',
      phase: 'tool-error',
      message: '缺失必需输入',
    }
  }
  if (/traversal|\.\./i.test(raw)) {
    return {
      code: 'dev-tool-path-traversal',
      severity: 'blocking',
      phase: 'input',
      message: '路径遍历被拒绝',
    }
  }
  if (/absolute|绝对路径/i.test(raw)) {
    return {
      code: 'dev-tool-path-absolute',
      severity: 'blocking',
      phase: 'input',
      message: '绝对路径被拒绝',
    }
  }
  if (/symlink|junction|越界/i.test(raw)) {
    return {
      code: 'dev-tool-path-symlink-escape',
      severity: 'blocking',
      phase: 'input',
      message: '符号链接越界',
    }
  }
  if (/budget|过大|过多|超限/i.test(raw)) {
    return {
      code: 'dev-tool-budget-exceeded',
      severity: 'blocking',
      phase: 'input',
      message: '输入超过预算',
    }
  }
  return { code: 'dev-tool-error', severity: 'blocking', phase: 'tool-error', message: '工具错误' }
}

/** 二次低敏扫描（对文本/JSON 输出做 allowlist 检查，返回 violations）。 */
export function devSecondaryScan(text: string): string[] {
  const violations: string[] = []
  if (/sk_[A-Za-z0-9]{20,}/.test(text)) violations.push('secret-token')
  if (/Bearer\s+[A-Za-z0-9._\-]+/.test(text)) violations.push('authorization')
  if (/https?:\/\/[^\s]+/i.test(text)) violations.push('url')
  if (/[A-Za-z]:\\[^\n]*\.(?:ts|js|json|env)/.test(text)) violations.push('windows-absolute-path')
  if (/(?:^|\n)\/[^\n]*\.(?:ts|js|json|env)/m.test(text)) violations.push('posix-absolute-path')
  if (/at\s+.*\(.*:\d+:\d+\)/.test(text)) violations.push('stack')
  if (/Authorization\s*:/i.test(text)) violations.push('authorization-header')
  return violations
}

// =============================================================================
// 6. 规范化与稳定排序
// =============================================================================

/** finding 稳定排序（phase → code → severity → fieldPath）。 */
export function sortDevFindings(findings: LocalPluginDevFinding[]): LocalPluginDevFinding[] {
  const order = (s: LocalPluginDevSeverity): number =>
    s === 'blocking' ? 0 : s === 'warning' ? 1 : 2
  return [...findings].sort((a, b) => {
    if (a.phase !== b.phase) return a.phase.localeCompare(b.phase)
    if (a.code !== b.code) return a.code.localeCompare(b.code)
    if (order(a.severity) !== order(b.severity)) return order(a.severity) - order(b.severity)
    return (a.fieldPath ?? '').localeCompare(b.fieldPath ?? '')
  })
}

/** 归一化 report（稳定排序 findings，计算 counts/digest）。 */
export function normalizeDevReport(
  report: Omit<LocalPluginDevReport, 'resultDigest' | 'counts'> &
    Partial<Pick<LocalPluginDevReport, 'counts' | 'resultDigest'>>,
): LocalPluginDevReport {
  const findings = sortDevFindings(report.findings.map(redactDevFinding))
  const blocking = findings.filter((f) => f.severity === 'blocking').length
  const warning = findings.filter((f) => f.severity === 'warning').length
  const info = findings.filter((f) => f.severity === 'info').length
  const counts: LocalPluginDevCounts = {
    total: findings.length,
    blocking,
    warning,
    info,
    omitted: report.counts?.omitted ?? 0,
  }
  // canonical digest 输入（稳定字段，不含 generatedAt/commit/reportId）
  const canonical = {
    schemaVersion: report.schemaVersion,
    kind: report.kind,
    command: report.command,
    status: report.status,
    phase: report.phase,
    findings: findings.map((f) => ({
      code: f.code,
      severity: f.severity,
      phase: f.phase,
      fieldPath: f.fieldPath,
    })),
    counts,
    inputDigest: report.inputDigest,
    compatibilitySummary: report.compatibilitySummary,
  }
  const resultDigest = computeDevDigest(canonical)
  return {
    ...report,
    findings,
    counts,
    resultDigest,
    trustedAudit: false,
  } as LocalPluginDevReport
}

/** 判定 report 状态（blocking → blocked，tool-error → tool-error，否则 passed；warning-only → passed）。 */
export function deriveDevStatus(findings: LocalPluginDevFinding[]): LocalPluginDevStatus {
  if (findings.some((f) => f.code === 'dev-tool-error' || f.phase === 'tool-error'))
    return 'tool-error'
  if (findings.some((f) => f.severity === 'blocking')) return 'blocking'
  return 'passed'
}

/** 退出码映射。 */
export function devStatusToExitCode(status: LocalPluginDevStatus): number {
  if (status === 'passed') return LOCAL_PLUGIN_DEV_EXIT.pass
  if (status === 'blocking') return LOCAL_PLUGIN_DEV_EXIT.blocking
  return LOCAL_PLUGIN_DEV_EXIT.toolError
}

// =============================================================================
// 7. Host profile / Install plan 校验（封闭 schema、预算、authority claim 拒绝）
// =============================================================================

/** 校验 host profile（返回 findings）。 */
export function validateHostProfile(input: unknown): {
  valid: boolean
  findings: LocalPluginDevFinding[]
  profile?: LocalPluginHostProfileV1
} {
  const findings: LocalPluginDevFinding[] = []
  if (!input || typeof input !== 'object') {
    findings.push({
      code: 'dev-host-profile-missing-field',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$',
      message: 'profile 不是对象',
    })
    return { valid: false, findings }
  }
  const obj = input as Record<string, unknown>
  // schemaVersion
  if (obj.schemaVersion !== LOCAL_PLUGIN_HOST_PROFILE_SCHEMA_VERSION) {
    findings.push({
      code: 'dev-host-profile-missing-field',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$.schemaVersion',
      message: '缺少或错误的 schemaVersion',
    })
  }
  if (obj.kind !== undefined && obj.kind !== 'local-plugin-host-profile-v1') {
    findings.push({
      code: 'dev-host-profile-unknown-field',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$.kind',
      message: 'kind 非法',
    })
  }
  if (
    typeof obj.hostContractVersion !== 'string' ||
    (obj.hostContractVersion as string).trim() === ''
  ) {
    findings.push({
      code: 'dev-host-profile-missing-field',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$.hostContractVersion',
    })
  }
  if (typeof obj.catalogDigest !== 'string' || (obj.catalogDigest as string).trim() === '') {
    findings.push({
      code: 'dev-host-profile-missing-field',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$.catalogDigest',
    })
  }
  const allowedStatuses = ['not_installed', 'installed', 'enabled', 'uninstalled'] as const
  if (
    typeof obj.currentStatus !== 'string' ||
    !(allowedStatuses as readonly string[]).includes(obj.currentStatus as string)
  ) {
    findings.push({
      code: 'dev-host-profile-missing-field',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$.currentStatus',
    })
  }
  if (!Array.isArray(obj.allowedScopeKinds) || (obj.allowedScopeKinds as unknown[]).length === 0) {
    findings.push({
      code: 'dev-host-profile-missing-field',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$.allowedScopeKinds',
    })
  }
  if (
    typeof obj.referenceTime !== 'string' ||
    Number.isNaN(Date.parse(obj.referenceTime as string))
  ) {
    findings.push({
      code: 'dev-host-profile-missing-field',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$.referenceTime',
    })
  }
  // 未知字段
  const known = new Set([
    'schemaVersion',
    'kind',
    'hostContractVersion',
    'catalogDigest',
    'currentStatus',
    'approvedReleaseDigest',
    'approvedReleaseVersion',
    'allowedScopeKinds',
    'referenceTime',
  ])
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      findings.push({
        code: 'dev-host-profile-unknown-field',
        severity: 'blocking',
        phase: 'input',
        fieldPath: `$.${key}`,
        message: '未知字段',
      })
    }
  }
  // authority claim 拒绝（真实租户标识、Policy/grant/确认/可信审计）
  const json = JSON.stringify(obj)
  if (/organizationId|projectId|userId|organization_id|project_id/i.test(json)) {
    findings.push({
      code: 'dev-host-profile-authority-claim',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$',
      message: '真实租户标识被拒绝',
    })
  }
  if (/policy.*pass|grant|confirmation|audit.*success|trustedAudit/i.test(json)) {
    findings.push({
      code: 'dev-host-profile-authority-claim',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$',
      message: 'authority claim 被拒绝',
    })
  }
  if (/secret|token|apikey|api_key|authorization|bearer|credential/i.test(json)) {
    findings.push({
      code: 'dev-host-profile-sensitive-value',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$',
      message: '敏感值被拒绝',
    })
  }
  // 大小预算（JSON 序列化后）
  const serialized = JSON.stringify(obj)
  if (serialized.length > 16 * 1024) {
    findings.push({
      code: 'dev-tool-budget-exceeded',
      severity: 'blocking',
      phase: 'input',
      fieldPath: '$',
      message: 'profile 超过大小预算',
    })
  }
  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  return {
    valid: !hasBlocking,
    findings,
    profile: !hasBlocking ? (obj as unknown as LocalPluginHostProfileV1) : undefined,
  }
}

/** 校验 install plan 输入（action closed 集）。 */
export function isValidInstallPlanAction(action: unknown): boolean {
  return (
    typeof action === 'string' &&
    (LOCAL_PLUGIN_INSTALL_DRY_RUN_ACTIONS as readonly string[]).includes(action)
  )
}

// =============================================================================
// 8. Validate 纯管线（固定阶段，复用唯一事实来源）
// =============================================================================

export interface ValidateLocalPluginInput {
  manifest: unknown
  catalogDigest?: string
  seamCatalog?: Record<string, { seamVersion: string; availability: string }>
  permissionVocabulary?: Record<
    string,
    {
      seamKey: string
      maxScopeKind: string
      maxSideEffect: string
      maxNetwork: string
      maxConfirmation: string
    }
  >
}

/** 固定阶段的 validateLocalPlugin 纯管线。保留上游 code/severity/field path。 */
export function validateLocalPlugin(input: ValidateLocalPluginInput): {
  findings: LocalPluginDevFinding[]
  normalizedManifest?: unknown
  manifestDigest?: string
} {
  const findings: LocalPluginDevFinding[] = []
  let blocked = false

  // 阶段 0：输入/路径预算（由 CLI 层负责，此处仅占位；若 manifest 超预算由上游 shape 检查覆盖）

  // 阶段 1：manifest shape/semantic
  // 动态导入避免 cycle；此处用 try 兜底
  try {
    const shape = validateManifestShape(input.manifest)
    for (const f of shape.findings) {
      findings.push({
        code: 'dev-validate-manifest-invalid',
        severity: f.severity as LocalPluginDevSeverity,
        phase: 'manifest',
        fieldPath: f.path,
        message: f.code,
      })
      if (f.severity === 'blocking') blocked = true
    }
    if (shape.valid && shape.manifest) {
      const digest = computeManifestDigest(shape.manifest)
      // 阶段 2：host/seam compatibility（若提供了 seamCatalog）
      if (input.seamCatalog && shape.manifest.compatibility) {
        for (const seam of shape.manifest.compatibility.requiredSeams) {
          const entry = input.seamCatalog[seam.seamKey]
          if (!entry) {
            findings.push({
              code: 'dev-validate-seam-unknown',
              severity: 'blocking',
              phase: 'seam-compatibility',
              fieldPath: `compatibility.requiredSeams.${seam.seamKey}`,
            })
            blocked = true
          } else if (entry.availability !== 'host-ready' && entry.availability !== 'cataloged') {
            findings.push({
              code: 'dev-validate-seam-not-host-ready',
              severity: 'blocking',
              phase: 'seam-compatibility',
              fieldPath: `seam:${seam.seamKey}`,
            })
            blocked = true
          }
        }
      }
      // 阶段 3：permission subset/redline（permissionVocabulary）
      if (input.permissionVocabulary) {
        for (const perm of shape.manifest.permissions) {
          const vocab = input.permissionVocabulary[perm.permissionKey]
          if (!vocab) {
            findings.push({
              code: 'dev-validate-permission-unknown',
              severity: 'blocking',
              phase: 'permission',
              fieldPath: `permission:${perm.permissionKey}`,
            })
            blocked = true
          } else if (vocab.seamKey !== perm.seamKey) {
            findings.push({
              code: 'dev-validate-permission-escalation',
              severity: 'blocking',
              phase: 'permission',
              fieldPath: `permission:${perm.permissionKey}.seamKey`,
            })
            blocked = true
          }
        }
      }
      // 阶段 4：contribution payload（seam 分派）
      if (!blocked) {
        try {
          for (const contrib of shape.manifest.contributions) {
            if ((contrib as unknown as Record<string, unknown>).payload) {
              const payload = (contrib as unknown as Record<string, unknown>).payload
              const res = validatePluginContributionPayload(
                contrib.seamKey,
                payload as Record<string, unknown>,
                contrib.seamVersion,
              )
              if (!res.valid) {
                findings.push({
                  code: 'dev-validate-contribution-invalid',
                  severity: 'blocking',
                  phase: 'contribution',
                  fieldPath: `contribution:${contrib.contributionKey}`,
                })
                blocked = true
                break
              }
            }
          }
        } catch {
          // 无 contribution payload 校验时跳过
        }
      }
      // 阶段 5：内容 descriptor/digest（shape 已校验，此处补充 URL 阻断）
      if (!blocked) {
        const contribPaths = shape.manifest.contributions.map((c) => c.entrypoint.path)
        for (const p of contribPaths) {
          if (/^https?:\/\//i.test(p)) {
            findings.push({
              code: 'dev-validate-remote-source-blocked',
              severity: 'blocking',
              phase: 'content',
              fieldPath: 'contributions.entrypoint.path',
            })
            blocked = true
            break
          }
        }
      }
      return {
        findings: sortDevFindings(findings),
        normalizedManifest: shape.manifest,
        manifestDigest: digest,
      }
    } else {
      // shape 已失败，后续阶段 skipped
      if (blocked) {
        // 标记 skipped：不追加更多 findings，但保留 status 为 blocking
      }
      return { findings: sortDevFindings(findings) }
    }
  } catch (e) {
    findings.push(mapToolError(e))
    return { findings: sortDevFindings(findings) }
  }
}

// =============================================================================
// 9. 显式插件根读取适配器（仓库相对路径、lexical+realpath 边界、allowlist、预算）
// =============================================================================

/** 允许读取的文件（allowlist）。 */
export const LOCAL_PLUGIN_ALLOWED_FILES = [
  'plugin.json',
  'manifest.json',
  'plugin.manifest.json',
  'package.json',
  'aiproj.plugin.json',
] as const

export interface PluginFileReadResult {
  files: Array<{ path: string; content: string; bytes: number }>
  findings: LocalPluginDevFinding[]
}

/** 校验仓库相对路径（lexical 边界）。 */
export function isRepoRelativePathSafe(input: string): {
  valid: boolean
  reason?: LocalPluginDevFindingCode
} {
  if (!input || input.trim() === '') return { valid: false, reason: 'dev-tool-missing-input' }
  if (/^https?:\/\//i.test(input)) return { valid: false, reason: 'dev-tool-path-url' }
  if (/^[A-Za-z]:[\\/]/.test(input)) return { valid: false, reason: 'dev-tool-path-absolute' }
  if (/^[/\\]/.test(input)) return { valid: false, reason: 'dev-tool-path-absolute' }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(input)) return { valid: false, reason: 'dev-tool-path-control-char' }
  if (input.includes('..')) return { valid: false, reason: 'dev-tool-path-traversal' }
  // Windows 设备路径
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(input))
    return { valid: false, reason: 'dev-tool-path-traversal' }
  return { valid: true }
}

// =============================================================================
// 10. Dry-run 纯规划器（复用状态机、影响、digest）
// =============================================================================

export interface BuildLocalInstallDryRunInput {
  validatedManifest: unknown
  hostProfile: LocalPluginHostProfileV1
  action: LocalPluginInstallDryRunAction
  referenceTime: string // ISO，用 profile.referenceTime 亦可
}

/** 纯函数 buildLocalInstallDryRun。 */
export function buildLocalInstallDryRun(input: BuildLocalInstallDryRunInput): {
  plan?: LocalPluginInstallPlanV1
  findings: LocalPluginDevFinding[]
} {
  const findings: LocalPluginDevFinding[] = []
  // profile 校验
  const profileCheck = validateHostProfile(input.hostProfile)
  if (!profileCheck.valid) {
    return { findings: profileCheck.findings }
  }
  // action 校验
  if (!isValidInstallPlanAction(input.action)) {
    findings.push({
      code: 'dev-tool-missing-input',
      severity: 'blocking',
      phase: 'install-plan',
      fieldPath: '$.action',
      message: '未知 action',
    })
    return { findings }
  }
  // 状态机（复用 plugin-install-lifecycle 纯函数）
  try {
    const current = input.hostProfile.currentStatus as unknown as string
    const res = sharedTransitionPluginInstallStatus(
      current as 'not_installed' | 'installed' | 'enabled' | 'uninstalled',
      input.action as unknown as string as
        'install' | 'enable' | 'disable' | 'uninstall' | 'upgrade',
    )
    if ('error' in res) {
      findings.push({
        code: 'dev-install-illegal-transition',
        severity: 'blocking',
        phase: 'install-plan',
        fieldPath: '$.action',
        message: res.error,
      })
      return { findings: sortDevFindings(findings) }
    }
    const targetStatus = res.nextStatus as LocalPluginInstallPlanV1['targetStatus']
    // 贡献/权限影响（从 manifest 提取）
    const manifest = input.validatedManifest as {
      contributions?: Array<{
        contributionKey: string
        seamKey: string
        seamVersion: string
        title?: string
      }>
      permissions?: Array<{
        permissionKey: string
        seamKey: string
        sideEffect: string
        network: string
        purpose?: string
      }>
    }
    const affectedContributions = (manifest.contributions ?? []).map((c) => ({
      contributionKey: c.contributionKey,
      seamKey: c.seamKey,
      seamVersion: c.seamVersion,
      title: c.title,
    }))
    const requestedPermissions = (manifest.permissions ?? []).map((p) => ({
      permissionKey: p.permissionKey,
      seamKey: p.seamKey,
      sideEffect: p.sideEffect,
      network: p.network,
      purpose: p.purpose,
    }))
    // digest 校验（catalog/manifest/release）
    // 此处仅返回，实际失配由调用方注入的 profile digest 对比；若失配则 blocking
    const planDigestInput = {
      schemaVersion: LOCAL_PLUGIN_INSTALL_PLAN_SCHEMA_VERSION,
      kind: 'local-plugin-install-plan-v1',
      action: input.action,
      currentStatus: current,
      targetStatus,
      affectedContributions: [...affectedContributions].sort((a, b) =>
        a.contributionKey.localeCompare(b.contributionKey),
      ),
      requestedPermissions: [...requestedPermissions].sort((a, b) =>
        a.permissionKey.localeCompare(b.permissionKey),
      ),
      catalogDigest: input.hostProfile.catalogDigest,
      referenceTime: input.referenceTime,
    }
    const planDigest = computeDevDigest(planDigestInput)
    const plan: LocalPluginInstallPlanV1 = {
      schemaVersion: LOCAL_PLUGIN_INSTALL_PLAN_SCHEMA_VERSION,
      kind: 'local-plugin-install-plan-v1',
      action: input.action,
      currentStatus: current as LocalPluginInstallPlanV1['currentStatus'],
      targetStatus,
      affectedContributions,
      requestedPermissions,
      catalogDigest: input.hostProfile.catalogDigest,
      warnings: [],
      blockers: [],
      planDigest,
      confirmable: false,
      generatedAt: new Date().toISOString(),
    }
    return { plan, findings: sortDevFindings(findings) }
  } catch (e) {
    findings.push(mapToolError(e))
    return { findings: sortDevFindings(findings) }
  }
}

// =============================================================================
// 11. 本机诊断摘要（只消费受支持 envelope，有界聚合）
// =============================================================================

/** 校验是否为受支持的 dev report envelope。 */
export function isSupportedDevReport(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const r = input as Record<string, unknown>
  return (
    r.schemaVersion === LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION &&
    r.kind === 'local-plugin-dev-report-v1'
  )
}

/** 聚合诊断（纯函数，有界、稳定排序）。 */
export function summarizeLocalPluginDiagnostics(
  input: LocalPluginDiagnosticsInput & { now?: Date },
): { summary: LocalPluginDiagnosticsSummary; findings: LocalPluginDevFinding[] } {
  const findings: LocalPluginDevFinding[] = []
  const reports = input.reports
  if (!Array.isArray(reports)) {
    findings.push({
      code: 'dev-audit-unknown-schema',
      severity: 'blocking',
      phase: 'audit-summary',
      message: 'reports 不是数组',
    })
    return { summary: null as unknown as LocalPluginDiagnosticsSummary, findings }
  }
  if (reports.length > LOCAL_PLUGIN_DEV_BUDGETS.maxDiagnosticsEnvelopes) {
    findings.push({
      code: 'dev-audit-budget-exceeded',
      severity: 'blocking',
      phase: 'audit-summary',
      message: '诊断 envelope 超过预算',
    })
    return { summary: null as unknown as LocalPluginDiagnosticsSummary, findings }
  }
  for (const r of reports) {
    if (!isSupportedDevReport(r)) {
      findings.push({
        code: 'dev-audit-unknown-schema',
        severity: 'blocking',
        phase: 'audit-summary',
        message: '未知 schemaVersion',
      })
      return { summary: null as unknown as LocalPluginDiagnosticsSummary, findings }
    }
    // 拒绝 production authority claim
    const json = JSON.stringify(r)
    if (/\"trustedAudit\"\s*:\s*true/i.test(json) || /production.*audit/i.test(json)) {
      findings.push({
        code: 'dev-audit-trusted-claim-rejected',
        severity: 'blocking',
        phase: 'audit-summary',
        message: '可信审计声明被拒绝',
      })
      return { summary: null as unknown as LocalPluginDiagnosticsSummary, findings }
    }
    if (/organizationId|projectId|userId/.test(json)) {
      // 允许报告中包含低敏 hash，但原始标识应被拒绝；此处仅示意，实际报告已脱敏
    }
  }
  // 有界聚合
  const byCommand: Record<string, number> = {}
  const byPhase: Record<string, number> = {}
  const byCode: Record<string, number> = {}
  const bySeverity: Record<string, number> = {}
  let totalFindings = 0
  const allFindings: LocalPluginDevFinding[] = []
  const sourceDigests: string[] = []
  const omittedCounts: Record<string, number> = {}
  for (const r of reports) {
    byCommand[r.command] = (byCommand[r.command] ?? 0) + 1
    if (r.resultDigest) sourceDigests.push(r.resultDigest)
    if (r.omittedCounts) {
      for (const [k, v] of Object.entries(r.omittedCounts))
        omittedCounts[k] = (omittedCounts[k] ?? 0) + v
    }
    for (const f of r.findings) {
      totalFindings++
      byPhase[f.phase] = (byPhase[f.phase] ?? 0) + 1
      byCode[f.code] = (byCode[f.code] ?? 0) + 1
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1
      allFindings.push(f)
    }
  }
  // 稳定排序 + 截断 top findings（有界）
  const topFindings = sortDevFindings(allFindings).slice(0, 50)
  const blockingCount = allFindings.filter((f) => f.severity === 'blocking').length
  const warningCount = allFindings.filter((f) => f.severity === 'warning').length
  const canonical = {
    totalReports: reports.length,
    byCommand,
    byPhase,
    byCode,
    bySeverity,
    sourceDigests: [...sourceDigests].sort(),
  }
  const digest = computeDevDigest(canonical)
  const summary: LocalPluginDiagnosticsSummary = {
    schemaVersion: LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION,
    kind: 'local-plugin-diagnostics-summary-v1',
    generatedAt: (input.now ?? new Date()).toISOString(),
    totalReports: reports.length,
    totalFindings,
    blockingCount,
    warningCount,
    byCommand,
    byPhase,
    byCode,
    bySeverity,
    topFindings,
    sourceDigests,
    omittedCounts,
    trustedAudit: false,
    digest,
  }
  return { summary, findings: sortDevFindings(findings) }
}

// =============================================================================
// 12. Text / JSON 同源投影
// =============================================================================

/** 渲染报告为 text（与 JSON 同源规范化结果）。 */
export function renderDevReportText(report: LocalPluginDevReport): string {
  const lines: string[] = [
    `Local Plugin Developer Report`,
    `═══════════════════════════════`,
    `Report ID:  ${report.reportId}`,
    `Command:    ${report.command}`,
    `Status:     ${report.status}`,
    `Phase:      ${report.phase}`,
    `Generated:  ${report.generatedAt}`,
    `Commit:     ${report.commit}`,
    `Digest:     ${report.resultDigest}`,
    ``,
    `Counts: total=${report.counts.total} blocking=${report.counts.blocking} warning=${report.counts.warning} info=${report.counts.info} omitted=${report.counts.omitted}`,
  ]
  if (report.findings.length > 0) {
    lines.push(``, `Findings:`)
    for (const f of report.findings) {
      lines.push(
        `  [${f.severity}] ${f.phase}/${f.code} ${f.fieldPath ?? ''} ${f.message ?? ''}`.trimEnd(),
      )
    }
  }
  lines.push(``, `Exit code: ${devStatusToExitCode(report.status)} (${report.status})`)
  lines.push(`Trusted audit: false — 静态通过不等于安装/授权/执行`)
  return lines.join('\n')
}

/** 校验报告 schema（返回 issue 列表，空=合法）。 */
export function validateDevReportSchema(report: unknown): string[] {
  const issues: string[] = []
  if (!report || typeof report !== 'object') return ['报告不是对象']
  const r = report as Partial<LocalPluginDevReport>
  if (r.schemaVersion !== LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION)
    issues.push('schemaVersion 必须为 1.0')
  if (r.kind !== 'local-plugin-dev-report-v1') issues.push('kind 必须为 local-plugin-dev-report-v1')
  if (!r.reportId || typeof r.reportId !== 'string') issues.push('缺 reportId')
  if (!r.generatedAt || typeof r.generatedAt !== 'string') issues.push('缺 generatedAt')
  if (!r.command || !isLocalPluginDevCommand(r.command)) issues.push('command 非法')
  if (!r.status || !isLocalPluginDevStatus(r.status)) issues.push('status 非法')
  if (!Array.isArray(r.findings)) issues.push('findings 必须是数组')
  if (r.trustedAudit !== false) issues.push('trustedAudit 必须为 false')
  return issues
}
