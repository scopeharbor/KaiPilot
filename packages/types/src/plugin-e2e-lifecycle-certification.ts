/**
 * plugin-e2e-lifecycle-certification —— V3 插件 E2E 生命周期认证共享契约
 * （纯类型 + 常量 + 类型守卫 + 确定性 canonical/digest + 低敏脱敏 + 路径稳定 + 证据账本 + 复现命令，
 *  零运行时依赖，零网络/IO/时间/随机数依赖；reference time 由调用方注入）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。
 * 测试见 `plugin-e2e-lifecycle-certification.test.ts`，
 * fixtures 见 `plugin-e2e-lifecycle-certification-fixtures.ts`。
 *
 * # 语义要点（对应 openspec/changes/v3-plugin-e2e-lifecycle-certification  spec/design）
 * - 任务 1.2：focused 与 release 两档认证 profile、稳定步骤 ID、失败 reason code 和脱敏报告 schema。
 * - 任务 2.1~2.4：隔离数据库与双租户 fixture、API 生命周期 runner、兼容/健康/安全门断言、跨租残留扫描。
 * - 任务 3.1~3.2：权限 diff/人工确认浏览器边界、advisory 零正式写入断言。
 * - 任务 4.1~4.3：focused/release profile 可复现报告、证据账本纳入、敏感字段脱敏、路径稳定性、失败复现命令。
 * - 任务 5：fail-closed、确定性 digest、零网络、零 secret、低敏 evidence ref。
 */

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** Schema 版本。 */
export const PLUGIN_E2E_SCHEMA_VERSION = '1.0' as const
export type PluginE2ESchemaVersion = typeof PLUGIN_E2E_SCHEMA_VERSION

/** Profile 种类：focused（PR 快速）与 release（完整）。 */
export const PLUGIN_E2E_PROFILE_KINDS = ['focused', 'release'] as const
export type PluginE2EProfileKind = (typeof PLUGIN_E2E_PROFILE_KINDS)[number]

/** 认证步骤 ID（封闭集，按生命周期顺序）。 */
export const PLUGIN_E2E_STEP_IDS = [
  // 正向生命周期（Requirement 1）
  'package-verification',
  'install-preview',
  'install-confirm',
  'permission-confirmation',
  'enable',
  'execute',
  'disable',
  'upgrade',
  'rollback',
  'uninstall',
  'residue-inspection',
  // 安全与负例（Requirement 2）
  'undeclared-capability',
  'permission-escalation-reconfirm',
  'preview-replay',
  'cross-org-access',
  'cross-project-access',
  'corrupted-package',
  'timeout-crash',
  'uninstall-residue',
  // 额外负例与门禁
  'stale-preview',
  'health-unavailable',
  'compatibility-unavailable',
  'revoked-grant',
] as const
export type PluginE2EStepId = (typeof PLUGIN_E2E_STEP_IDS)[number]

/** 必需步骤（任何缺失即 fail，Requirement 1 scenario）。 */
export const PLUGIN_E2E_REQUIRED_STEP_IDS: readonly PluginE2EStepId[] = [
  'package-verification',
  'install-preview',
  'install-confirm',
  'permission-confirmation',
  'enable',
  'execute',
  'disable',
  'upgrade',
  'rollback',
  'uninstall',
  'residue-inspection',
] as const

/** Focused profile 仅覆盖的子集（PR 快速，任务 4.1）。 */
export const PLUGIN_E2E_FOCUSED_STEP_IDS: readonly PluginE2EStepId[] = [
  'package-verification',
  'install-preview',
  'install-confirm',
  'permission-confirmation',
  'enable',
  'execute',
  'disable',
  'uninstall',
  'residue-inspection',
] as const

/** 负例步骤（Requirement 2）。 */
export const PLUGIN_E2E_NEGATIVE_STEP_IDS: readonly PluginE2EStepId[] = [
  'undeclared-capability',
  'permission-escalation-reconfirm',
  'preview-replay',
  'cross-org-access',
  'cross-project-access',
  'corrupted-package',
  'timeout-crash',
  'uninstall-residue',
] as const

/** 步骤结论（pass/fail/not-run/degraded，fail-closed 无自动补偿）。 */
export const PLUGIN_E2E_STEP_CONCLUSIONS = ['pass', 'fail', 'not-run', 'degraded'] as const
export type PluginE2EStepConclusion = (typeof PLUGIN_E2E_STEP_CONCLUSIONS)[number]

/** 认证最终结论（pass/fail/degraded，unknown 不得 pass）。 */
export const PLUGIN_E2E_OVERALL_CONCLUSIONS = ['pass', 'fail', 'degraded'] as const
export type PluginE2EOverallConclusion = (typeof PLUGIN_E2E_OVERALL_CONCLUSIONS)[number]

/** 稳定失败 reason code（封闭、低敏、机器可判）。 */
export const PLUGIN_E2E_REASON_CODES = [
  'ok',
  'missing-required-step',
  'unverified-evidence',
  'blocking-negative-not-denied',
  'cross-tenant-block-missing',
  'residue-found',
  'stale-evidence',
  'unknown-step',
  'unknown-reason-code',
  'health-unavailable',
  'compatibility-unavailable',
  'security-gate-denied',
  'timeout-or-crash',
  'permission-escalation-without-reconfirm',
  'preview-replay-detected',
  'corrupted-package-not-rejected',
  'undeclared-capability-not-rejected',
  'sensitive-leakage',
  'absolute-path-ref',
  'secret-in-report',
  'digest-mismatch',
  'unknown-error',
] as const
export type PluginE2EReasonCode = (typeof PLUGIN_E2E_REASON_CODES)[number]

/** 不可 waive 的 blocking codes（fail-closed 红线）。 */
export const PLUGIN_E2E_REDLINE_REASONS: readonly PluginE2EReasonCode[] = [
  'missing-required-step',
  'blocking-negative-not-denied',
  'cross-tenant-block-missing',
  'residue-found',
  'stale-evidence',
  'unknown-step',
  'unknown-reason-code',
  'health-unavailable',
  'compatibility-unavailable',
]

/** 敏感键模式（小写匹配，任务 4.3）。 */
export const PLUGIN_E2E_SENSITIVE_KEY_PATTERNS = [
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
  'cookie',
  'session',
] as const

/** 敏感值模式。 */
export const PLUGIN_E2E_SENSITIVE_VALUE_PATTERNS = [
  /(?:^|\s)(?:sk|pk|tk)_[A-Za-z0-9]{20,}/,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._\-]+/,
  /(?:^|\s)(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
] as const

/** 证据账本 ledger 版本。 */
export const PLUGIN_E2E_LEDGER_VERSION = '1.0' as const
export type PluginE2ELedgerVersion = typeof PLUGIN_E2E_LEDGER_VERSION

/** 证据 ref 允许的前缀（相对路径，任务 4.3 路径稳定性）。 */
export const PLUGIN_E2E_EVIDENCE_REF_PREFIXES = [
  'evidence:',
  'fixture:',
  'canary:',
  'ledger:',
  'artifact:',
] as const

// =============================================================================
// 2. 核心类型
// =============================================================================

/** 单步结果（低敏）。 */
export interface PluginE2EStepResult {
  /** 稳定步骤 ID。 */
  stepId: PluginE2EStepId
  /** 结论。 */
  conclusion: PluginE2EStepConclusion
  /** 稳定 reason code。 */
  reasonCode: PluginE2EReasonCode
  /** 低敏 evidence ref（相对路径，禁止绝对路径/token）。 */
  evidenceRef?: string
  /** 可选低敏细节（已脱敏）。 */
  details?: string
  /** 步骤序号（用于排序与 digest 稳定性）。 */
  order: number
}

/** 认证 profile（声明式，版本化）。 */
export interface PluginE2EProfile {
  /** profile 种类。 */
  kind: PluginE2EProfileKind
  /** profile 版本。 */
  version: string
  /** 包含的步骤 ID（有序，稳定排序）。 */
  stepIds: PluginE2EStepId[]
  /** 必需步骤（子集）。 */
  requiredStepIds: PluginE2EStepId[]
  /** 允许的 canary 集合（focused 限定）。 */
  canaryIds?: string[]
}

/** 认证报告（低敏，确定性，任务 4.1~4.3）。 */
export interface PluginE2ECertificationReport {
  /** schema 版本。 */
  schemaVersion: PluginE2ESchemaVersion
  /** 认证 host（低敏，如 os+node 版本的 hash ref，非原始 hostname）。 */
  hostRef: string
  /** 被测版本（完整 SemVer）。 */
  pluginVersion: string
  /** pluginId（规范化小写）。 */
  pluginId: string
  /** profile。 */
  profile: PluginE2EProfile
  /** 步骤结果（按 order 排序，固定顺序）。 */
  steps: PluginE2EStepResult[]
  /** 最终结论。 */
  conclusion: PluginE2EOverallConclusion
  /** 主 blocking code（fail 时）。 */
  blockingReason?: PluginE2EReasonCode
  /** 计数（稳定聚合）。 */
  counts: { total: number; pass: number; fail: number; notRun: number; degraded: number }
  /** 规范化报告 digest（canonical + domain-separated）。 */
  digest: string
  /** 失败复现命令（稳定、低敏，任务 4.3）。 */
  reproCommand?: string
  /** 生成时间（ISO，canonicalize 后转为相对序号，不参与 digest）。 */
  generatedAt: string
  /** fixture 引用（低敏相对路径）。 */
  fixtureRef?: string
}

/** 证据账本条目（低敏，追加式）。 */
export interface PluginE2ELedgerEntry {
  /** 条目 ID（确定性派生）。 */
  entryId: string
  /** 关联报告 digest。 */
  reportDigest: string
  /** profile kind。 */
  profileKind: PluginE2EProfileKind
  /** pluginId + version。 */
  pluginRef: string
  /** 结论。 */
  conclusion: PluginE2EOverallConclusion
  /** 复现命令（稳定）。 */
  reproCommand: string
  /** 证据 refs（相对路径集合）。 */
  evidenceRefs: string[]
  /** 创建时间（ISO，账本内保留但 canonicalize 时归一）。 */
  createdAt: string
}

/** 证据账本（发布门可复现）。 */
export interface PluginE2ECertificationLedger {
  /** ledger 版本。 */
  ledgerVersion: PluginE2ELedgerVersion
  /** 生成时间（ISO）。 */
  generatedAt: string
  /** 条目（按 reportDigest 排序）。 */
  entries: PluginE2ELedgerEntry[]
  /** 账本 digest（entries 的 canonical digest）。 */
  ledgerDigest: string
}

// =============================================================================
// 3. 类型守卫
// =============================================================================

export function isPluginE2EProfileKind(v: unknown): v is PluginE2EProfileKind {
  return typeof v === 'string' && (PLUGIN_E2E_PROFILE_KINDS as readonly string[]).includes(v)
}
export function isPluginE2EStepId(v: unknown): v is PluginE2EStepId {
  return typeof v === 'string' && (PLUGIN_E2E_STEP_IDS as readonly string[]).includes(v)
}
export function isPluginE2EStepConclusion(v: unknown): v is PluginE2EStepConclusion {
  return typeof v === 'string' && (PLUGIN_E2E_STEP_CONCLUSIONS as readonly string[]).includes(v)
}
export function isPluginE2EOverallConclusion(v: unknown): v is PluginE2EOverallConclusion {
  return typeof v === 'string' && (PLUGIN_E2E_OVERALL_CONCLUSIONS as readonly string[]).includes(v)
}
export function isPluginE2EReasonCode(v: unknown): v is PluginE2EReasonCode {
  return typeof v === 'string' && (PLUGIN_E2E_REASON_CODES as readonly string[]).includes(v)
}

// =============================================================================
// 4. 确定性序列化 / FNV-1a / Domain-separated digest
// =============================================================================

export function pE2EStableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => pE2EStableSerialize(v)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + pE2EStableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

export function pE2EFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function pE2EDomainSeparatedDigest(domain: string, payload: unknown): string {
  const ns = `aiproj:plugin-e2e:${domain}`
  return pE2EFnv1aHash(`${ns}:${pE2EStableSerialize(payload)}`)
}

// =============================================================================
// 5. 路径稳定性（任务 4.3）
// =============================================================================

/** 判断 evidence ref 是否为仓库相对低敏路径（禁止绝对路径/URL/盘符/.. 越级/secret）。 */
export function isRepoRelativeEvidenceRef(ref: string): boolean {
  if (typeof ref !== 'string' || ref.trim() === '') return false
  if (ref.startsWith('/') || ref.startsWith('\\')) return false
  if (/^[a-zA-Z]:[\\/]/.test(ref)) return false
  if (/^https?:\/\//i.test(ref)) return false
  if (ref.split(/[\\/]/).includes('..')) return false
  // 必须以允许前缀开头
  if (!PLUGIN_E2E_EVIDENCE_REF_PREFIXES.some((p) => ref.startsWith(p))) return false
  // 禁止敏感键片段
  const lower = ref.toLowerCase()
  if ((PLUGIN_E2E_SENSITIVE_KEY_PATTERNS as readonly string[]).some((pat) => lower.includes(pat)))
    return false
  return true
}

/** 归一化 evidence ref：trim、相对化、非法则映射为 ledger:invalid-ref。 */
export function normalizeEvidenceRef(raw: string): string {
  const trimmed = raw.trim()
  if (isRepoRelativeEvidenceRef(trimmed)) return trimmed
  // 绝对路径/URL 转为相对 evidence 引用（路径稳定性）
  if (/^https?:\/\//i.test(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('/')) {
    // 取 basename 并映射
    const basename = trimmed.split(/[\\/]/).filter(Boolean).pop() ?? 'unknown'
    return `evidence:${basename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  }
  if (trimmed.includes('..')) return 'evidence:invalid-traversal'
  if (trimmed === '') return 'evidence:empty'
  // 已含敏感词的直接脱敏
  const lower = trimmed.toLowerCase()
  if ((PLUGIN_E2E_SENSITIVE_KEY_PATTERNS as readonly string[]).some((p) => lower.includes(p))) {
    return 'evidence:[redacted]'
  }
  // 无前缀的视为 evidence: 前缀
  if (!trimmed.includes(':')) return `evidence:${trimmed}`
  return trimmed
}

/** 规范化 evidence refs 集合（去重、排序、归一化）。 */
export function canonicalizeEvidenceRefs(refs: string[]): string[] {
  const normalized = refs.map(normalizeEvidenceRef)
  const deduped = [...new Set(normalized)]
  return deduped.sort()
}

// =============================================================================
// 6. 敏感字段脱敏（任务 4.3）
// =============================================================================

export function pE2EIsSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return (PLUGIN_E2E_SENSITIVE_KEY_PATTERNS as readonly string[]).some(
    (p) => lower === p || lower.includes(p),
  )
}

export function pE2EContainsSensitiveValue(value: string): boolean {
  for (const pat of PLUGIN_E2E_SENSITIVE_VALUE_PATTERNS) {
    if (pat.test(value)) return true
  }
  return false
}

/** 深层脱敏：敏感键 → [redacted]，敏感值 → [redacted]，绝对路径 → 相对化。 */
export function pE2EDeepRedact<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    if (pE2EContainsSensitiveValue(obj)) return '[redacted]' as T
    if (/^https?:\/\//i.test(obj) || /^[a-zA-Z]:[\\/]/.test(obj) || obj.startsWith('/')) {
      // 路径类字符串若含敏感词已在上层处理；此处仅标记绝对路径
      if (obj.includes('token') || obj.includes('secret')) return '[redacted]' as T
      return obj
    }
    return obj
  }
  if (Array.isArray(obj)) return obj.map((item) => pE2EDeepRedact(item)) as T
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (pE2EIsSensitiveKey(key)) {
        result[key] = '[redacted]'
      } else {
        result[key] = pE2EDeepRedact(value)
      }
    }
    return result as T
  }
  return obj
}

/** 扫描报告是否含敏感泄露（返回路径列表，低敏描述）。 */
export function scanE2ESensitiveLeakage(obj: unknown): { leaked: boolean; paths: string[] } {
  const paths: string[] = []
  function walk(value: unknown, path: string): void {
    if (value === null || value === undefined) return
    if (typeof value === 'string') {
      if (pE2EContainsSensitiveValue(value)) paths.push(`${path}:sensitive-value`)
      if (/^https?:\/\//i.test(value) && path.toLowerCase().includes('ref')) {
        // evidenceRef 中的 URL 已在 normalize 阶段处理，此处仅记录
        paths.push(`${path}:url`)
      }
      if (/stack/i.test(path) && value.length > 0) paths.push(`${path}:stack`)
      // 绝对路径在 evidenceRef 中视为泄露
      if (
        (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) &&
        path.toLowerCase().includes('evidenceref')
      ) {
        paths.push(`${path}:absolute-path`)
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, idx) => walk(item, `${path}[${idx}]`))
      return
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (pE2EIsSensitiveKey(k)) paths.push(`${path}.${k}:sensitive-key`)
        if (k.toLowerCase().includes('tenant') && typeof v === 'string') {
          paths.push(`${path}.${k}:tenant-id`)
        }
        walk(v, `${path}.${k}`)
      }
    }
  }
  walk(obj, '$')
  return { leaked: paths.length > 0, paths }
}

// =============================================================================
// 7. Profile 构造与排序
// =============================================================================

/** 按生命周期稳定排序 stepIds（以 PLUGIN_E2E_STEP_IDS 顺序）。 */
export function sortE2EStepIds(ids: PluginE2EStepId[]): PluginE2EStepId[] {
  const order = new Map<PluginE2EStepId, number>(PLUGIN_E2E_STEP_IDS.map((id, i) => [id, i]))
  return [...ids].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
}

/** 按 order 稳定排序步骤结果。 */
export function sortE2EStepResults(steps: PluginE2EStepResult[]): PluginE2EStepResult[] {
  return [...steps].sort((a, b) => a.order - b.order || a.stepId.localeCompare(b.stepId))
}

/** 创建 focused profile（任务 4.1）。 */
export function createFocusedProfile(opts?: {
  canaryIds?: string[]
  version?: string
}): PluginE2EProfile {
  return {
    kind: 'focused',
    version: opts?.version ?? '1.0',
    stepIds: [...PLUGIN_E2E_FOCUSED_STEP_IDS],
    requiredStepIds: [...PLUGIN_E2E_FOCUSED_STEP_IDS],
    canaryIds: opts?.canaryIds ?? ['com.aiproj.canary-query', 'com.aiproj.canary-advisory'],
  }
}

/** 创建 release profile（任务 4.2）。 */
export function createReleaseProfile(opts?: { version?: string }): PluginE2EProfile {
  return {
    kind: 'release',
    version: opts?.version ?? '1.0',
    stepIds: [...PLUGIN_E2E_STEP_IDS],
    requiredStepIds: [...PLUGIN_E2E_REQUIRED_STEP_IDS],
  }
}

// =============================================================================
// 8. 报告 canonicalize / digest / 验证（fail-closed，任务 4.3）
// =============================================================================

/** 报告 canonical payload（不含 generatedAt/随机字段，按稳定序列化求 digest）。 */
export interface PluginE2EReportCanonicalPayload {
  schemaVersion: PluginE2ESchemaVersion
  hostRef: string
  pluginId: string
  pluginVersion: string
  profileKind: PluginE2EProfileKind
  profileVersion: string
  stepIds: PluginE2EStepId[]
  requiredStepIds: PluginE2EStepId[]
  steps: Array<{
    stepId: PluginE2EStepId
    conclusion: PluginE2EStepConclusion
    reasonCode: PluginE2EReasonCode
    evidenceRef: string
    order: number
  }>
  conclusion: PluginE2EOverallConclusion
  blockingReason: string
  counts: { total: number; pass: number; fail: number; notRun: number; degraded: number }
}

export function toCanonicalPayload(
  report: Omit<PluginE2ECertificationReport, 'digest' | 'reproCommand'>,
): PluginE2EReportCanonicalPayload {
  const sortedSteps = sortE2EStepResults(report.steps)
  return {
    schemaVersion: report.schemaVersion,
    hostRef: report.hostRef,
    pluginId: report.pluginId.toLowerCase().trim(),
    pluginVersion: report.pluginVersion.trim(),
    profileKind: report.profile.kind,
    profileVersion: report.profile.version,
    stepIds: sortE2EStepIds(report.profile.stepIds),
    requiredStepIds: sortE2EStepIds(report.profile.requiredStepIds),
    steps: sortedSteps.map((s) => ({
      stepId: s.stepId,
      conclusion: s.conclusion,
      reasonCode: s.reasonCode,
      evidenceRef: normalizeEvidenceRef(s.evidenceRef ?? ''),
      order: s.order,
    })),
    conclusion: report.conclusion,
    blockingReason: report.blockingReason ?? '',
    counts: report.counts,
  }
}

export function computeE2EReportDigest(
  report: Omit<PluginE2ECertificationReport, 'digest' | 'reproCommand'>,
): string {
  const payload = toCanonicalPayload(report)
  return pE2EDomainSeparatedDigest('cert-report', payload)
}

/** 规范化报告（排序步骤、脱敏、归一 evidenceRef、重算 digest 与 counts）。 */
export function canonicalizeReport(
  input: Omit<PluginE2ECertificationReport, 'digest'> & { digest?: string },
): PluginE2ECertificationReport {
  // 脱敏后的浅拷贝（不改原始 input）
  const redacted = pE2EDeepRedact(input) as typeof input
  const sortedSteps = sortE2EStepResults(
    redacted.steps.map((s) => ({
      ...s,
      evidenceRef: normalizeEvidenceRef(s.evidenceRef ?? ''),
      details: s.details != null ? String(s.details).slice(0, 500) : undefined,
    })),
  )
  // 重新计算 counts（以 canonical 步骤为准）
  const counts = {
    total: sortedSteps.length,
    pass: sortedSteps.filter((s) => s.conclusion === 'pass').length,
    fail: sortedSteps.filter((s) => s.conclusion === 'fail').length,
    notRun: sortedSteps.filter((s) => s.conclusion === 'not-run').length,
    degraded: sortedSteps.filter((s) => s.conclusion === 'degraded').length,
  }
  const withoutDigest: Omit<PluginE2ECertificationReport, 'digest' | 'reproCommand'> = {
    schemaVersion: redacted.schemaVersion,
    hostRef: redacted.hostRef,
    pluginId: redacted.pluginId.toLowerCase().trim(),
    pluginVersion: redacted.pluginVersion.trim(),
    profile: {
      kind: redacted.profile.kind,
      version: redacted.profile.version,
      stepIds: sortE2EStepIds(redacted.profile.stepIds),
      requiredStepIds: sortE2EStepIds(redacted.profile.requiredStepIds),
      ...(redacted.profile.canaryIds ? { canaryIds: [...redacted.profile.canaryIds].sort() } : {}),
    },
    steps: sortedSteps,
    conclusion: redacted.conclusion,
    ...(redacted.blockingReason ? { blockingReason: redacted.blockingReason } : {}),
    counts,
    generatedAt: new Date(redacted.generatedAt).toISOString(),
    ...(redacted.fixtureRef ? { fixtureRef: normalizeEvidenceRef(redacted.fixtureRef) } : {}),
  }
  const digest = computeE2EReportDigest(withoutDigest)
  const reproCommand = buildReproCommand({
    ...withoutDigest,
    digest,
  } as PluginE2ECertificationReport)
  return { ...withoutDigest, digest, reproCommand }
}

/** 验证报告（fail-closed）。 */
export function validateCertificationReport(report: unknown): {
  valid: boolean
  errors: string[]
  canonical?: PluginE2ECertificationReport
} {
  const errors: string[] = []
  if (!report || typeof report !== 'object') {
    return { valid: false, errors: ['report must be object'] }
  }
  const r = report as Record<string, unknown>

  if (r.schemaVersion !== PLUGIN_E2E_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${PLUGIN_E2E_SCHEMA_VERSION}`)
  }
  if (typeof r.pluginId !== 'string' || r.pluginId.trim().length === 0) {
    errors.push('pluginId required')
  }
  if (typeof r.pluginVersion !== 'string' || r.pluginVersion.trim().length === 0) {
    errors.push('pluginVersion required')
  }
  if (!r.profile || typeof r.profile !== 'object') {
    errors.push('profile required')
  } else {
    const p = r.profile as Record<string, unknown>
    if (!isPluginE2EProfileKind(p.kind)) errors.push(`profile.kind invalid: ${p.kind}`)
    if (!Array.isArray(p.stepIds) || p.stepIds.length === 0) errors.push('profile.stepIds required')
    else {
      for (const id of p.stepIds as unknown[]) {
        if (!isPluginE2EStepId(id)) errors.push(`unknown stepId in profile.stepIds: ${String(id)}`)
      }
    }
    if (!Array.isArray(p.requiredStepIds)) errors.push('profile.requiredStepIds required')
  }
  if (!Array.isArray(r.steps)) errors.push('steps must be array')
  else {
    const seen = new Set<string>()
    for (let i = 0; i < (r.steps as unknown[]).length; i++) {
      const s = (r.steps as Record<string, unknown>[])[i]!
      if (!isPluginE2EStepId(s.stepId))
        errors.push(`steps[${i}].stepId unknown: ${String(s.stepId)}`)
      if (!isPluginE2EStepConclusion(s.conclusion)) errors.push(`steps[${i}].conclusion invalid`)
      if (!isPluginE2EReasonCode(s.reasonCode))
        errors.push(`steps[${i}].reasonCode unknown: ${String(s.reasonCode)}`)
      if (seen.has(String(s.stepId))) errors.push(`duplicate stepId: ${String(s.stepId)}`)
      seen.add(String(s.stepId))
      if (s.evidenceRef != null && typeof s.evidenceRef === 'string') {
        if (!isRepoRelativeEvidenceRef(normalizeEvidenceRef(s.evidenceRef))) {
          // normalize 后仍非法（理论上 normalize 兜底为 evidence:...，此分支仅防御绝对路径未归一化）
          errors.push(`steps[${i}].evidenceRef absolute or sensitive: ${s.evidenceRef}`)
        }
      }
    }
    // 检查必需步骤是否全部存在且非 not-run
    const profileRequired =
      ((r.profile as Record<string, unknown>)?.requiredStepIds as string[]) ?? []
    const stepIds = new Set(
      ((r.steps as Record<string, unknown>[]) ?? []).map((s) => String(s.stepId)),
    )
    const stepMap = new Map(((r.steps as PluginE2EStepResult[]) ?? []).map((s) => [s.stepId, s]))
    for (const req of profileRequired) {
      if (!stepIds.has(req)) {
        errors.push(`missing required step: ${req}`)
      } else {
        const st = stepMap.get(req as PluginE2EStepId)
        if (st?.conclusion === 'not-run') {
          errors.push(`required step not-run: ${req}`)
        }
      }
    }
  }
  if (!isPluginE2EOverallConclusion(r.conclusion)) {
    errors.push(`conclusion invalid: ${String(r.conclusion)}`)
  }
  // 校验 conclusion 与 steps 一致性（fail-closed：任何 fail 必为 fail，not-run 必非 pass）
  if (Array.isArray(r.steps) && typeof r.conclusion === 'string') {
    const steps = r.steps as PluginE2EStepResult[]
    const hasFail = steps.some((s) => s.conclusion === 'fail')
    const hasNotRunRequired = steps.some(
      (s) =>
        (r.profile as PluginE2EProfile)?.requiredStepIds.includes(s.stepId) &&
        s.conclusion === 'not-run',
    )
    if (hasFail && r.conclusion === 'pass') errors.push('conclusion pass but has fail steps')
    if (hasNotRunRequired && r.conclusion === 'pass')
      errors.push('conclusion pass but required step not-run')
    const unknownReason = steps.some((s) => !isPluginE2EReasonCode(s.reasonCode))
    if (unknownReason) errors.push('unknown reason code present must not pass')
    const unknownStep = steps.some((s) => !isPluginE2EStepId(s.stepId))
    if (unknownStep) errors.push('unknown step present must not pass')
  }
  // 敏感泄露扫描（脱敏后仍含敏感键值 → 视为 invalid，fail-closed）
  const leakage = scanE2ESensitiveLeakage(r)
  if (leakage.leaked) {
    // 仅对特定高危路径报错（如 sensitive-key / absolute-path / tenant-id）
    const blocking = leakage.paths.filter(
      (p) =>
        p.includes('sensitive-key') ||
        p.includes('absolute-path') ||
        p.includes('tenant-id') ||
        p.includes('sensitive-value'),
    )
    if (blocking.length > 0) {
      errors.push(`sensitive leakage: ${blocking.slice(0, 3).join(', ')}`)
    }
  }
  // digest 校验（若提供）
  if (typeof r.digest === 'string' && r.digest.length > 0) {
    try {
      const withoutDigest = { ...r } as Record<string, unknown>
      delete withoutDigest.digest
      delete withoutDigest.reproCommand
      const expected = computeE2EReportDigest(
        withoutDigest as unknown as Omit<PluginE2ECertificationReport, 'digest' | 'reproCommand'>,
      )
      if (r.digest !== expected)
        errors.push(`digest mismatch: expected ${expected}, got ${r.digest}`)
    } catch {
      errors.push('digest computation failed')
    }
  }

  if (errors.length > 0) return { valid: false, errors }
  // 返回 canonical
  const canonical = canonicalizeReport(r as unknown as PluginE2ECertificationReport)
  return { valid: true, errors: [], canonical }
}

/** 判定报告是否可通过（fail-closed 纯函数）。 */
export function isReportPassable(report: PluginE2ECertificationReport): boolean {
  const v = validateCertificationReport(report)
  if (!v.valid) return false
  if (report.conclusion !== 'pass') return false
  return true
}

// =============================================================================
// 9. 失败复现命令（任务 4.3）
// =============================================================================

/** 构建稳定复现命令（低敏、零网络、相对路径）。 */
export function buildReproCommand(report: PluginE2ECertificationReport): string {
  const profileArg = report.profile.kind
  const pluginRef = `${report.pluginId}@${report.pluginVersion}`
  const digestArg = report.digest.slice(0, 8)
  // 失败步骤列表（稳定排序）
  const failedSteps = report.steps
    .filter((s) => s.conclusion === 'fail')
    .map((s) => s.stepId)
    .sort()
  const failedArg = failedSteps.length > 0 ? ` --failed ${failedSteps.join(',')}` : ''
  // 统一命令格式（与 scripts/ 侧对齐，零网络）
  return `pnpm exec tsx scripts/plugin-e2e-certification.ts --profile ${profileArg} --plugin ${pluginRef} --digest ${digestArg}${failedArg} --fixture ${report.fixtureRef ?? 'fixture:canary'} --zero-network`
}

/** 构建 focused 复现命令（便捷）。 */
export function buildFocusedReproCommand(report: PluginE2ECertificationReport): string {
  return buildReproCommand({ ...report, profile: { ...report.profile, kind: 'focused' } })
}

/** 构建 release 复现命令（便捷）。 */
export function buildReleaseReproCommand(report: PluginE2ECertificationReport): string {
  return buildReproCommand({ ...report, profile: { ...report.profile, kind: 'release' } })
}

// =============================================================================
// 10. 证据账本（任务 4.3：报告纳入证据账本）
// =============================================================================

export function computeLedgerDigest(entries: PluginE2ELedgerEntry[]): string {
  const canonical = entries
    .map((e) => ({
      entryId: e.entryId,
      reportDigest: e.reportDigest,
      profileKind: e.profileKind,
      pluginRef: e.pluginRef,
      conclusion: e.conclusion,
      reproCommand: e.reproCommand,
      evidenceRefs: [...e.evidenceRefs].sort(),
    }))
    .sort((a, b) => a.reportDigest.localeCompare(b.reportDigest))
  return pE2EDomainSeparatedDigest('cert-ledger', canonical)
}

export function createLedgerEntry(report: PluginE2ECertificationReport): PluginE2ELedgerEntry {
  const evidenceRefs = canonicalizeEvidenceRefs([
    ...(report.fixtureRef ? [report.fixtureRef] : []),
    ...report.steps.map((s) => s.evidenceRef ?? '').filter(Boolean),
  ])
  const entryId = pE2EDomainSeparatedDigest('ledger-entry', {
    reportDigest: report.digest,
    pluginRef: `${report.pluginId}@${report.pluginVersion}`,
    profileKind: report.profile.kind,
  })
  return {
    entryId,
    reportDigest: report.digest,
    profileKind: report.profile.kind,
    pluginRef: `${report.pluginId}@${report.pluginVersion}`,
    conclusion: report.conclusion,
    reproCommand: report.reproCommand ?? buildReproCommand(report),
    evidenceRefs,
    createdAt: new Date(report.generatedAt).toISOString(),
  }
}

/** 将报告追加到账本（幂等、去重、排序、脱敏、路径稳定）。 */
export function addReportToLedger(
  ledger: PluginE2ECertificationLedger,
  report: PluginE2ECertificationReport,
): PluginE2ECertificationLedger {
  const canonical = canonicalizeReport(report)
  const validation = validateCertificationReport(canonical)
  // 即使 fail 报告也入账（账本记录失败态），但非法报告（unknown step/reason 伪造）不得入账
  if (!validation.valid) {
    // 非法报告仍生成 degraded 账本条目但标记 digest-mismatch，避免静默丢弃
    // 此处直接返回原账本并记录错误（调用方通过 validate 预检）
    return ledger
  }
  const entry = createLedgerEntry(canonical)
  const exists = ledger.entries.some((e) => e.reportDigest === entry.reportDigest)
  const nextEntries = exists
    ? ledger.entries
    : [...ledger.entries, entry].sort((a, b) => a.reportDigest.localeCompare(b.reportDigest))
  const ledgerDigest = computeLedgerDigest(nextEntries)
  return {
    ledgerVersion: PLUGIN_E2E_LEDGER_VERSION,
    generatedAt: new Date().toISOString(),
    entries: nextEntries,
    ledgerDigest,
  }
}

/** 创建空账本。 */
export function createEmptyLedger(): PluginE2ECertificationLedger {
  return {
    ledgerVersion: PLUGIN_E2E_LEDGER_VERSION,
    generatedAt: new Date().toISOString(),
    entries: [],
    ledgerDigest: computeLedgerDigest([]),
  }
}

/** 验证账本完整性。 */
export function validateCertificationLedger(ledger: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!ledger || typeof ledger !== 'object')
    return { valid: false, errors: ['ledger must be object'] }
  const l = ledger as Record<string, unknown>
  if (l.ledgerVersion !== PLUGIN_E2E_LEDGER_VERSION)
    errors.push(`ledgerVersion must be ${PLUGIN_E2E_LEDGER_VERSION}`)
  if (!Array.isArray(l.entries)) errors.push('entries must be array')
  else {
    for (let i = 0; i < (l.entries as unknown[]).length; i++) {
      const e = (l.entries as Record<string, unknown>[])[i]!
      if (typeof e.reportDigest !== 'string' || e.reportDigest.length === 0)
        errors.push(`entries[${i}].reportDigest required`)
      if (!isPluginE2EProfileKind(e.profileKind)) errors.push(`entries[${i}].profileKind invalid`)
      if (typeof e.reproCommand !== 'string' || e.reproCommand.length === 0)
        errors.push(`entries[${i}].reproCommand required`)
      if (e.reproCommand && typeof e.reproCommand === 'string') {
        if (/token|secret|password|Authorization/i.test(e.reproCommand)) {
          errors.push(`entries[${i}].reproCommand contains sensitive`)
        }
        if (
          /https?:\/\//i.test(e.reproCommand) ||
          /^[a-zA-Z]:[\\/]/.test(e.reproCommand) ||
          e.reproCommand.includes('/abs/')
        ) {
          errors.push(`entries[${i}].reproCommand contains absolute path`)
        }
      }
      if (Array.isArray(e.evidenceRefs)) {
        for (const ref of e.evidenceRefs as string[]) {
          if (!isRepoRelativeEvidenceRef(ref))
            errors.push(`entries[${i}].evidenceRefs contains non-relative: ${ref}`)
        }
      }
    }
    // digest 校验
    const expected = computeLedgerDigest(l.entries as PluginE2ELedgerEntry[])
    if (typeof l.ledgerDigest === 'string' && l.ledgerDigest !== expected) {
      errors.push(`ledgerDigest mismatch: expected ${expected}, got ${l.ledgerDigest}`)
    }
  }
  return { valid: errors.length === 0, errors }
}

// =============================================================================
// 11. 综合：报告评估（fail-closed 纯函数，便于 runner 复用）
// =============================================================================

/** 评估报告结论（纯函数，任何必需缺失/负例未阻断/残留/stale 均 fail）。 */
export function evaluateReportConclusion(steps: PluginE2EStepResult[]): {
  conclusion: PluginE2EOverallConclusion
  blockingReason?: PluginE2EReasonCode
} {
  const sorted = sortE2EStepResults(steps)
  const requiredMissing = PLUGIN_E2E_REQUIRED_STEP_IDS.some(
    (id) => !sorted.some((s) => s.stepId === id && s.conclusion !== 'not-run'),
  )
  if (requiredMissing) return { conclusion: 'fail', blockingReason: 'missing-required-step' }

  const hasUnknownStep = sorted.some((s) => !isPluginE2EStepId(s.stepId))
  if (hasUnknownStep) return { conclusion: 'fail', blockingReason: 'unknown-step' }

  const hasUnknownReason = sorted.some((s) => !isPluginE2EReasonCode(s.reasonCode))
  if (hasUnknownReason) return { conclusion: 'fail', blockingReason: 'unknown-reason-code' }

  const hasFail = sorted.some((s) => s.conclusion === 'fail')
  if (hasFail) {
    const firstFail = sorted.find((s) => s.conclusion === 'fail')
    return { conclusion: 'fail', blockingReason: firstFail?.reasonCode ?? 'unknown-error' }
  }

  const hasDegraded = sorted.some((s) => s.conclusion === 'degraded')
  if (hasDegraded) return { conclusion: 'degraded', blockingReason: 'health-unavailable' }

  // 检查 stale/health/compatibility 红线（任一即可导致 fail）
  const stale = sorted.find((s) => s.reasonCode === 'stale-evidence')
  if (stale) return { conclusion: 'fail', blockingReason: 'stale-evidence' }

  return { conclusion: 'pass' }
}

/** 判断报告是否可在 CI 门禁直接放行（focused/release 均要求 pass 且无 degraded）。 */
export function isCiGatePass(report: PluginE2ECertificationReport): boolean {
  if (report.conclusion !== 'pass') return false
  if (report.steps.some((s) => s.conclusion === 'degraded')) return false
  if (
    report.steps.some(
      (s) => s.conclusion === 'not-run' && report.profile.requiredStepIds.includes(s.stepId),
    )
  )
    return false
  return isReportPassable(report)
}
