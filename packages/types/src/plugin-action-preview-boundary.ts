/**
 * plugin-action-preview-boundary —— V3 插件写入动作统一边界共享契约
 * （纯类型 + 常量 + 确定性纯函数 + 封闭字段集校验 + 确认句柄 + 幂等派生 +
 *   批量逐项结果 + 低敏 sanitization + 类型守卫，零网络/IO/数据库依赖）。
 *
 * 本模块是前后端共享的纯 TypeScript 模块。
 * 测试见 `plugin-action-preview-boundary.test.ts`，
 * fixtures 见 `plugin-action-preview-boundary-fixtures.ts`。
 *
 * # 语义要点（对应 specs/plugin-action-preview-boundary/spec.md 七条 Requirement）
 * - 插件只能产生版本化 PluginActionProposal；插件执行路径不具有领域写权限与事务提交权。
 * - preview 必须含动作类型/scope/插件 identity+version/before-after diff/assumptions/
 *   permission+compatibility 摘要/dry-run findings/可逆性/受影响项；隐藏对象不得出现。
 * - 确认前全前置重校验：actor/scope/安装态/plugin version/grant/preview digest/target
 *   revision/Policy/dry-run 任一变化即 stale 阻断，禁止静默刷新后继续提交。
 * - 确认句柄一次性且跨 scope 不可重放：绑定 proposal/preview digest/actor/org/project/
 *   plugin version/target revision/幂等键/过期时间；重复消费返回同一幂等结果不重复写入。
 * - 正式写入只由宿主登记且与 action kind 精确匹配的核心 adapter 在事务中执行；
 *   批量逐项独立结果，失败项不得被成功项洗白（fullyApplied 由逐项结局推导）。
 * - 决策语义分离：modify 必须生成新 preview digest 后才能确认；reject/discard 永不写入；
 *   approval/高置信度不自动转为 confirmation（唯一合法确认来源是显式用户确认）。
 * - 动作生命周期低敏可审计：审计事件不落 prompt/模型输出全文/tool 参数结果/raw
 *   payload/secret/token/Authorization。
 *
 * # 复用纪律（对应 design.md D2）
 * - source 签名新鲜度判定与幂等键派生直接复用 `copilot-action-boundary.js` 的
 *   `isCopilotActionSourceSignatureFresh` / `deriveCopilotActionIdempotencyKey` 纯函数；
 *   不复制其 UI/会话层逻辑。除该显式复用外零外部运行时依赖。
 */

import type { CopilotActionSourceSignature } from './copilot-action-boundary.js'
import {
  assertCopilotDryRunGate,
  deriveCopilotActionIdempotencyKey,
  isCopilotActionSourceSignatureFresh,
} from './copilot-action-boundary.js'

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** proposal schema 版本（封闭集，演进时新增版本常量并保留旧版校验）。 */
export const PLUGIN_ACTION_SCHEMA_VERSION = 'plugin-action-proposal-v1' as const
export type PluginActionSchemaVersion = typeof PLUGIN_ACTION_SCHEMA_VERSION

/**
 * 合法 action kind（封闭集）。
 * 设计约束：每个新 action kind 必须走独立 change 与测试，不允许运行时动态注册新 kind 字符串。
 * 首个 kind 为本 change 的低风险 fixture domain pilot。
 */
export const PLUGIN_ACTION_KINDS = ['plugin.pilot.item.create'] as const
export type PluginActionKind = (typeof PLUGIN_ACTION_KINDS)[number]

/** 插件宿主表面（proposal 来源）。 */
export const PLUGIN_ACTION_SURFACES = [
  'server-hook',
  'command-palette',
  'copilot-tool',
  'event-subscription',
] as const
export type PluginActionSurface = (typeof PLUGIN_ACTION_SURFACES)[number]

/** 稳定 reason code（封闭集，非泄露；API/审计共用）。 */
export const PLUGIN_ACTION_REASON_CODES = [
  // proposal / 载荷
  'action-proposal-invalid',
  'action-kind-unknown',
  'action-payload-too-large',
  'action-sensitive-material',
  // registry / adapter
  'adapter-missing',
  'adapter-not-host-owned',
  'adapter-descriptor-invalid',
  // 安装与版本
  'install-not-enabled',
  'plugin-version-mismatch',
  // 权限与隔离
  'permission-denied',
  'cross-scope-denied',
  // 新鲜度
  'preview-stale',
  'source-signature-stale',
  // 句柄
  'handle-invalid',
  'handle-expired',
  'handle-consumed',
  // 提交门
  'dry-run-blocking',
  'audit-failed',
  'apply-failed',
] as const
export type PluginActionReasonCode = (typeof PLUGIN_ACTION_REASON_CODES)[number]

/** 最终结果状态（决策翻译后的终态呈现）。 */
export const PLUGIN_ACTION_RESULT_STATUSES = [
  'applied', // 按原样确认并写入
  'modified', // 用户修改 → 新 preview → 确认后写入（与 applied 恒区分）
  'rejected', // 显式拒绝，永不写入
  'discarded', // 丢弃，永不写入
  'stale_blocked', // 新鲜度失配阻断
  'permission_denied', // 权限不足（非泄露）
  'dry_run_failed', // dry-run blocking finding 阻断
  'partial_failure', // 批量部分失败（逐项结果呈现）
  'idempotent_replay', // 幂等重复确认：返回既有结果，不重复写入
  'expired', // 句柄/预览过期
] as const
export type PluginActionResultStatus = (typeof PLUGIN_ACTION_RESULT_STATUSES)[number]

/** 批量逐项结局。 */
export const PLUGIN_ACTION_PER_ITEM_OUTCOMES = [
  'applied',
  'failed',
  'denied',
  'stale_blocked',
  'dry_run_failed',
  'skipped',
] as const
export type PluginActionPerItemOutcome = (typeof PLUGIN_ACTION_PER_ITEM_OUTCOMES)[number]

/** 批量策略：由 action kind 固定声明，不由插件或请求控制。 */
export const PLUGIN_ACTION_BATCH_POLICIES = ['all-or-nothing', 'per-item'] as const
export type PluginActionBatchPolicy = (typeof PLUGIN_ACTION_BATCH_POLICIES)[number]

/** 可逆性档位。 */
export const PLUGIN_ACTION_REVERSIBILITY = [
  'reversible',
  'partially_reversible',
  'irreversible',
] as const
export type PluginActionReversibility = (typeof PLUGIN_ACTION_REVERSIBILITY)[number]

/** adapter 归属：只能是宿主核心。 */
export const PLUGIN_ACTION_ADAPTER_OWNERS = ['host-core'] as const
export type PluginActionAdapterOwner = (typeof PLUGIN_ACTION_ADAPTER_OWNERS)[number]

/**
 * 合法确认来源（封闭集）：approval、高置信度、批量快捷操作等一律不是确认。
 * spec Requirement「approval 或高置信度 MUST NOT 自动转为 confirmation」的类型层承载。
 */
export const PLUGIN_ACTION_CONFIRMATION_SOURCES = ['explicit-user-confirm'] as const
export type PluginActionConfirmationSource = (typeof PLUGIN_ACTION_CONFIRMATION_SOURCES)[number]

/** 有界上限。 */
export const PLUGIN_ACTION_MAX_INPUT_BYTES = 16 * 1024
export const PLUGIN_ACTION_MAX_DIFF_ENTRIES = 64
export const PLUGIN_ACTION_MAX_FINDINGS = 32
export const PLUGIN_ACTION_MAX_ASSUMPTIONS = 16
export const PLUGIN_ACTION_MAX_SOURCE_REFS = 8
export const PLUGIN_ACTION_MAX_AFFECTED_ITEMS = 128
export const PLUGIN_ACTION_HANDLE_TTL_SECONDS = 600

/** proposal 顶层允许字段（封闭集；差集字段立即 invalid）。 */
export const PLUGIN_ACTION_PROPOSAL_ALLOWED_FIELDS = [
  'schemaVersion',
  'actionKind',
  'scope',
  'inputPayload',
  'sourceRefs',
  'createdAt',
] as const

/** source ref 允许字段（封闭集）。 */
export const PLUGIN_ACTION_SOURCE_REF_FIELDS = [
  'surface',
  'pluginId',
  'pluginVersion',
  'installationId',
  'contributionKey',
  'contentDigest',
  'capturedAt',
] as const

// =============================================================================
// 2. 核心类型
// =============================================================================

/** 动作 scope（组织必填；项目可选）。 */
export interface PluginActionScope {
  readonly organizationId: number
  readonly projectId: number | null
}

/** 来源引用（捕获时固化，用于确认前新鲜度重校验）。 */
export interface PluginActionSourceRef {
  readonly surface: PluginActionSurface
  readonly pluginId: string
  readonly pluginVersion: string
  /** 安装 id（宿主回填；未装为 null）。 */
  readonly installationId: number | null
  readonly contributionKey: string | null
  /** 来源内容摘要（贡献负载在捕获时刻的确定性 hash）。 */
  readonly contentDigest: string
  /** ISO-8601 捕获时间戳（缺时间戳无法区分「未变」与「从未捕获」，契约拒绝）。 */
  readonly capturedAt: string
}

/**
 * 版本化动作提案（插件产出的唯一合法写入意图载体）。
 * 只含稳定结构：kind/scope/有界规范输入/来源引用；不含任何执行代码或 SQL。
 */
export interface PluginActionProposal {
  readonly schemaVersion: PluginActionSchemaVersion
  readonly actionKind: PluginActionKind
  readonly scope: PluginActionScope
  /** 有界规范输入（每 kind 封闭字段集，由 validateActionInputForKind 校验）。 */
  readonly inputPayload: Record<string, unknown>
  readonly sourceRefs: readonly PluginActionSourceRef[]
  /** 创建时间（ISO）。不参与 canonical digest（易变字段不入摘要）。 */
  readonly createdAt?: string
}

/** preview diff 单条。 */
export interface PluginActionPreviewEntry {
  readonly targetRef: string
  readonly field: string
  readonly before: unknown
  readonly after: unknown
}

/** dry-run / 校验 finding。 */
export interface PluginActionFinding {
  readonly code: string
  readonly severity: 'blocking' | 'warning'
  /** 审查导向中文消息，低敏（不回显来源全文）。 */
  readonly message: string
}

/**
 * 标准 preview：确认前唯一审查界面数据。
 * 隐藏或无权限对象不得进入 affectedItemRefs/diffEntries（上游过滤后才有 digest）。
 */
export interface PluginActionPreview {
  readonly previewDigest: string
  readonly proposalDigest: string
  readonly actionKind: PluginActionKind
  readonly scope: PluginActionScope
  readonly pluginRef: {
    readonly pluginId: string
    readonly pluginVersion: string
    readonly installationId: number | null
  }
  readonly diffEntries: readonly PluginActionPreviewEntry[]
  readonly assumptions: readonly string[]
  readonly permissionSummary: {
    readonly requiredPermissions: readonly string[]
    readonly granted: boolean
  }
  readonly compatibilitySummary: string | null
  readonly dryRun: { readonly canApply: boolean; readonly findings: readonly PluginActionFinding[] }
  readonly reversibility: PluginActionReversibility
  readonly affectedItemRefs: readonly string[]
  readonly batchPolicy: PluginActionBatchPolicy
  readonly issuedAt: string
  readonly expiresAt: string
}

/** 一次性确认句柄（服务器签发；绑定全链路 revision，design.md D3）。 */
export interface PluginActionConfirmHandle {
  readonly handle: string
  readonly proposalId: string
  readonly previewDigest: string
  readonly actorUserId: number
  readonly organizationId: number
  readonly projectId: number | null
  readonly pluginId: string
  readonly pluginVersion: string
  /** 目标 revision 绑定（adapter 语义：行版本/快照序号等字符串化）。 */
  readonly targetRevision: string
  readonly idempotencyKey: string
  readonly expiresAt: string
}

/** 句柄签发输入（authority 字段全部服务端提供）。 */
export interface PluginActionHandleIssuanceInput {
  proposalId: string
  previewDigest: string
  actorUserId: number
  organizationId: number
  projectId: number | null
  pluginId: string
  pluginVersion: string
  targetRevision: string
  idempotencyKey: string
  /** 服务端当前时间（ISO）；测试显式注入保证确定性。 */
  nowIso: string
  ttlSeconds?: number
}

/** 可信审计 receipt（提交门产物；strict 下审计失败即回滚）。 */
export interface PluginActionAuditReceipt {
  /** audit_logs 行 id；0 表示降级写入（仅 non-strict 场景）。 */
  readonly auditLogId: number
  readonly createdAt: string
}

/** 正式应用 receipt（确认成功执行的唯一凭证）。 */
export interface PluginActionApplyReceipt {
  readonly proposalId: string
  readonly status: 'applied' | 'modified'
  readonly idempotencyKey: string
  readonly writtenRefs: readonly string[]
  readonly auditReceipt: PluginActionAuditReceipt
  readonly appliedAt: string
}

/** 批量逐项结果。 */
export interface PluginActionPerItemResult {
  readonly itemRef: string
  readonly outcome: PluginActionPerItemOutcome
  readonly reasonCode: PluginActionReasonCode | null
  readonly message: string
}

/** 批量结果汇总（fullyApplied 恒由逐项结局推导）。 */
export interface PluginActionBulkResult {
  readonly results: readonly PluginActionPerItemResult[]
  readonly fullyApplied: boolean
}

/** adapter 登记描述符（静态元数据；不含任何可执行语义）。 */
export interface PluginActionAdapterDescriptor {
  readonly actionKind: PluginActionKind
  readonly owner: PluginActionAdapterOwner
  readonly batchPolicy: PluginActionBatchPolicy
  readonly reversibility: PluginActionReversibility
  readonly requiredPermissions: readonly string[]
}

/** 校验 finding（path 低敏：只给字段路径不给值）。 */
export interface PluginActionValidationFinding {
  readonly code: PluginActionReasonCode
  readonly path?: string
  readonly message: string
}

export interface PluginActionValidationResult {
  readonly valid: boolean
  readonly findings: readonly PluginActionValidationFinding[]
}

// =============================================================================
// 3. 确定性纯函数（hash / 序列化 / digest / 句柄）
// =============================================================================

/** 确定性 FNV-1a 32-bit 哈希（本模块私有副本，与其他模块互不耦合）。 */
export function actionFnv1a32(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 确定性稳定 JSON 序列化（键排序递归；数组保序）。 */
export function actionStableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => actionStableSerialize(v)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + actionStableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * proposal canonical digest：覆盖 schemaVersion/actionKind/scope/inputPayload/sourceRefs。
 * 键序无关、跨进程稳定；createdAt 等易变字段不入摘要。
 */
export function computeProposalDigest(
  proposal: Pick<
    PluginActionProposal,
    'schemaVersion' | 'actionKind' | 'scope' | 'inputPayload' | 'sourceRefs'
  >,
): string {
  const boundedSources = proposal.sourceRefs.slice(0, PLUGIN_ACTION_MAX_SOURCE_REFS)
  const canonical = {
    schemaVersion: proposal.schemaVersion,
    actionKind: proposal.actionKind,
    scope: { organizationId: proposal.scope.organizationId, projectId: proposal.scope.projectId },
    inputPayload: proposal.inputPayload,
    sourceRefs: boundedSources,
    omittedSourceRefs: Math.max(0, proposal.sourceRefs.length - PLUGIN_ACTION_MAX_SOURCE_REFS),
  }
  return actionFnv1a32(actionStableSerialize(canonical))
}

/**
 * preview canonical digest：对全部审查相关字段做稳定序列化哈希。
 * 隐藏对象过滤必须发生在 digest 计算之前（digest 即用户所见）。
 */
export function computePreviewDigest(preview: Omit<PluginActionPreview, 'previewDigest'>): string {
  const boundedDiff = preview.diffEntries.slice(0, PLUGIN_ACTION_MAX_DIFF_ENTRIES)
  const boundedFindings = preview.dryRun.findings.slice(0, PLUGIN_ACTION_MAX_FINDINGS)
  const boundedAssumptions = preview.assumptions.slice(0, PLUGIN_ACTION_MAX_ASSUMPTIONS)
  const boundedItems = preview.affectedItemRefs.slice(0, PLUGIN_ACTION_MAX_AFFECTED_ITEMS)
  const canonical = {
    proposalDigest: preview.proposalDigest,
    actionKind: preview.actionKind,
    scope: { organizationId: preview.scope.organizationId, projectId: preview.scope.projectId },
    pluginRef: preview.pluginRef,
    diffEntries: boundedDiff,
    omittedDiffEntries: Math.max(0, preview.diffEntries.length - PLUGIN_ACTION_MAX_DIFF_ENTRIES),
    assumptions: [...boundedAssumptions].sort(),
    permissionSummary: preview.permissionSummary,
    compatibilitySummary: preview.compatibilitySummary,
    dryRun: { canApply: preview.dryRun.canApply, findings: boundedFindings },
    reversibility: preview.reversibility,
    affectedItemRefs: [...boundedItems].sort(),
    omittedAffectedItems: Math.max(
      0,
      preview.affectedItemRefs.length - PLUGIN_ACTION_MAX_AFFECTED_ITEMS,
    ),
    batchPolicy: preview.batchPolicy,
  }
  return actionFnv1a32(actionStableSerialize(canonical))
}

/** 计算句柄绑定 digest（全部 authority 绑定字段的规范序列化哈希）。 */
export function computeActionHandleDigest(
  handle: Omit<PluginActionConfirmHandle, 'handle'>,
): string {
  const canonical = {
    proposalId: handle.proposalId,
    previewDigest: handle.previewDigest,
    actorUserId: handle.actorUserId,
    organizationId: handle.organizationId,
    projectId: handle.projectId,
    pluginId: handle.pluginId,
    pluginVersion: handle.pluginVersion,
    targetRevision: handle.targetRevision,
    idempotencyKey: handle.idempotencyKey,
    expiresAt: handle.expiresAt,
  }
  return actionFnv1a32(actionStableSerialize(canonical))
}

/** 服务器签发一次性确认句柄。 */
export function buildPluginActionConfirmHandle(
  input: PluginActionHandleIssuanceInput,
): PluginActionConfirmHandle {
  const ttlSeconds = input.ttlSeconds ?? PLUGIN_ACTION_HANDLE_TTL_SECONDS
  const expiresAt = new Date(new Date(input.nowIso).getTime() + ttlSeconds * 1000).toISOString()
  const base: Omit<PluginActionConfirmHandle, 'handle'> = {
    proposalId: input.proposalId,
    previewDigest: input.previewDigest,
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    targetRevision: input.targetRevision,
    idempotencyKey: input.idempotencyKey,
    expiresAt,
  }
  const digest = computeActionHandleDigest(base)
  return { ...base, handle: `pact-cfm-${digest.slice(0, 12)}` }
}

export type ActionHandleBindingResult =
  { valid: true } | { valid: false; error: PluginActionReasonCode; reason: string }

/**
 * 确认句柄绑定校验（确认前全前置复核的类型层一半；spec Requirement 3/4）。
 * 判定顺序：requestId → 跨 scope → actor → 过期 → 新鲜度绑定 → 结构 digest。
 * 任一失败 fail-closed；调用方 MUST NOT 静默刷新后继续提交。
 */
export function validateActionHandleBinding(
  handle: PluginActionConfirmHandle,
  expected: {
    proposalId: string
    previewDigest: string
    actorUserId: number
    organizationId: number
    projectId: number | null
    pluginId: string
    pluginVersion: string
    targetRevision: string
    idempotencyKey: string
    nowIso: string
  },
): ActionHandleBindingResult {
  if (handle.proposalId !== expected.proposalId) {
    return { valid: false, error: 'handle-invalid', reason: 'Handle proposal mismatch' }
  }
  if (
    handle.organizationId !== expected.organizationId ||
    (handle.projectId ?? null) !== (expected.projectId ?? null)
  ) {
    return { valid: false, error: 'cross-scope-denied', reason: 'Handle scope mismatch' }
  }
  if (handle.actorUserId !== expected.actorUserId) {
    return { valid: false, error: 'permission-denied', reason: 'Handle actor mismatch' }
  }
  if (new Date(handle.expiresAt).getTime() <= new Date(expected.nowIso).getTime()) {
    return { valid: false, error: 'handle-expired', reason: 'Handle has expired' }
  }
  if (
    handle.previewDigest !== expected.previewDigest ||
    handle.targetRevision !== expected.targetRevision ||
    handle.idempotencyKey !== expected.idempotencyKey
  ) {
    return {
      valid: false,
      error: 'preview-stale',
      reason: 'Bound preview/revision changed since issuance; re-preview required',
    }
  }
  if (handle.pluginId !== expected.pluginId || handle.pluginVersion !== expected.pluginVersion) {
    return { valid: false, error: 'plugin-version-mismatch', reason: 'Bound plugin changed' }
  }
  const digest = computeActionHandleDigest(handle)
  if (!handle.handle.startsWith(`pact-cfm-${digest.slice(0, 12)}`)) {
    return { valid: false, error: 'handle-invalid', reason: 'Handle digest mismatch' }
  }
  return { valid: true }
}

// =============================================================================
// 4. 幂等派生（复用 Copilot primitive，design.md D2）
// =============================================================================

/** source ref → Copilot source signature 的最小映射（仅取三个新鲜度字段）。 */
export function toCopilotSourceSignature(ref: PluginActionSourceRef): CopilotActionSourceSignature {
  return {
    sourceRef: `${ref.surface}:${ref.pluginId}:${ref.contributionKey ?? '-'}`,
    contentHash: ref.contentDigest,
    capturedAt: ref.capturedAt,
  }
}

/** 确认前来源新鲜度重校验（复用 isCopilotActionSourceSignatureFresh）。 */
export function revalidateActionSourceRefs(
  current: readonly PluginActionSourceRef[],
  recorded: readonly PluginActionSourceRef[],
): { fresh: boolean; mismatchedIndexes: readonly number[] } {
  const mismatchedIndexes: number[] = []
  const length = Math.max(current.length, recorded.length)
  for (let i = 0; i < length; i++) {
    const cur = current[i]
    const rec = recorded[i]
    if (
      !cur ||
      !rec ||
      !isCopilotActionSourceSignatureFresh(
        toCopilotSourceSignature(cur),
        toCopilotSourceSignature(rec),
      )
    ) {
      mismatchedIndexes.push(i)
    }
  }
  return { fresh: mismatchedIndexes.length === 0, mismatchedIndexes }
}

/**
 * 服务端幂等键派生：action kind + proposal digest + 目标引用 + 来源签名。
 * 不接受客户端自定义键作为权威；两个语义不同的动作永不共享键。
 */
export function deriveActionIdempotencyKey(params: {
  readonly actionKind: PluginActionKind
  readonly proposalDigest: string
  readonly targetEntityRefs: readonly string[]
  readonly sourceRefs: readonly PluginActionSourceRef[]
}): string {
  return deriveCopilotActionIdempotencyKey({
    normalizedActionInput: `plugin-action|${params.actionKind}|${params.proposalDigest}`,
    targetEntityRefs: params.targetEntityRefs,
    sourceSignatures: params.sourceRefs.map(toCopilotSourceSignature),
  })
}

// =============================================================================
// 5. proposal / 输入载荷校验（封闭字段集）
// =============================================================================

function finding(
  code: PluginActionReasonCode,
  message: string,
  path?: string,
): PluginActionValidationFinding {
  return path ? { code, path, message } : { code, message }
}

function isValidScope(v: unknown): v is PluginActionScope {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  const keys = Object.keys(s)
  const allowed = ['organizationId', 'projectId']
  if (!keys.every((k) => allowed.includes(k))) return false
  return (
    typeof s.organizationId === 'number' &&
    Number.isInteger(s.organizationId) &&
    s.organizationId > 0 &&
    (s.projectId === null ||
      (typeof s.projectId === 'number' && Number.isInteger(s.projectId) && s.projectId > 0))
  )
}

function isSourceRefLike(v: unknown): v is PluginActionSourceRef {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  if (
    !Object.keys(r).every((k) => (PLUGIN_ACTION_SOURCE_REF_FIELDS as readonly string[]).includes(k))
  ) {
    return false
  }
  return (
    typeof r.surface === 'string' &&
    (PLUGIN_ACTION_SURFACES as readonly string[]).includes(r.surface) &&
    typeof r.pluginId === 'string' &&
    r.pluginId.length > 0 &&
    typeof r.pluginVersion === 'string' &&
    r.pluginVersion.length > 0 &&
    (r.installationId === null || typeof r.installationId === 'number') &&
    (r.contributionKey === null || typeof r.contributionKey === 'string') &&
    typeof r.contentDigest === 'string' &&
    r.contentDigest.length > 0 &&
    typeof r.capturedAt === 'string' &&
    r.capturedAt.length > 0
  )
}

/**
 * proposal 形状校验：
 * - schemaVersion 必须匹配当前版本；
 * - actionKind 必须在封闭集内；
 * - 顶层/sourceRef 出现未知字段立即 invalid（防夹带执行语义）;
 * - sourceRefs 数量有界且逐条形状合法；
 * - 输入载荷按 kind 分派的封闭字段集校验 + 大小上限 + 敏感材料扫描。
 */
export function validatePluginActionProposal(raw: unknown): PluginActionValidationResult {
  const findings: PluginActionValidationFinding[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, findings: [finding('action-proposal-invalid', '提案必须是对象')] }
  }
  const p = raw as Record<string, unknown>

  for (const key of Object.keys(p)) {
    if (!(PLUGIN_ACTION_PROPOSAL_ALLOWED_FIELDS as readonly string[]).includes(key)) {
      findings.push(finding('action-proposal-invalid', `未知顶层字段被拒绝`, key))
    }
  }
  if (findings.some((f) => f.path === undefined)) {
    return { valid: false, findings }
  }

  if (p.schemaVersion !== PLUGIN_ACTION_SCHEMA_VERSION) {
    findings.push(finding('action-proposal-invalid', 'schemaVersion 不受支持', 'schemaVersion'))
  }
  if (
    typeof p.actionKind !== 'string' ||
    !(PLUGIN_ACTION_KINDS as readonly string[]).includes(p.actionKind)
  ) {
    findings.push(finding('action-kind-unknown', '未知的 action kind', 'actionKind'))
  }
  if (!isValidScope(p.scope)) {
    findings.push(
      finding('action-proposal-invalid', 'scope 必须是 {organizationId, projectId}', 'scope'),
    )
  }

  const sourceRefs = p.sourceRefs
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    findings.push(finding('action-proposal-invalid', 'sourceRefs 必须是非空数组', 'sourceRefs'))
  } else {
    if (sourceRefs.length > PLUGIN_ACTION_MAX_SOURCE_REFS) {
      findings.push(finding('action-proposal-invalid', 'sourceRefs 超出上限', 'sourceRefs'))
    }
    sourceRefs.forEach((ref, i) => {
      if (!isSourceRefLike(ref)) {
        findings.push(finding('action-proposal-invalid', '来源引用形状非法', `sourceRefs[${i}]`))
      }
    })
  }

  const payload = p.inputPayload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    findings.push(finding('action-proposal-invalid', 'inputPayload 必须是对象', 'inputPayload'))
  } else {
    if (JSON.stringify(payload).length > PLUGIN_ACTION_MAX_INPUT_BYTES) {
      findings.push(finding('action-payload-too-large', '输入载荷超出大小上限', 'inputPayload'))
    }
    if (
      typeof p.actionKind === 'string' &&
      (PLUGIN_ACTION_KINDS as readonly string[]).includes(p.actionKind)
    ) {
      findings.push(
        ...validateActionInputForKind(p.actionKind as PluginActionKind, payload).findings,
      )
    }
  }

  return { valid: findings.length === 0, findings }
}

// --- 每 kind 封闭字段集输入校验 ---------------------------------------------

/** pilot fixture domain 动作输入字段（封闭集）。 */
export const PLUGIN_ACTION_PILOT_ITEM_INPUT_FIELDS = ['title', 'content'] as const

export interface PluginActionPilotItemInput {
  readonly title: string
  readonly content: string
}

const PILOT_TITLE_MAX = 200
const PILOT_CONTENT_MAX = 2000

/** pilot kind 输入校验：封闭字段集 + 长度上限 + 敏感材料扫描。 */
export function validatePilotItemInput(payload: unknown): PluginActionValidationResult {
  const findings: PluginActionValidationFinding[] = []
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      findings: [finding('action-proposal-invalid', '输入必须是对象', 'inputPayload')],
    }
  }
  const p = payload as Record<string, unknown>
  for (const key of Object.keys(p)) {
    if (!(PLUGIN_ACTION_PILOT_ITEM_INPUT_FIELDS as readonly string[]).includes(key)) {
      findings.push(finding('action-proposal-invalid', '未知输入字段被拒绝', `inputPayload.${key}`))
    }
  }
  if (typeof p.title !== 'string' || p.title.trim().length === 0) {
    findings.push(
      finding('action-proposal-invalid', 'title 必须是非空字符串', 'inputPayload.title'),
    )
  } else if (p.title.length > PILOT_TITLE_MAX) {
    findings.push(finding('action-proposal-invalid', 'title 超长', 'inputPayload.title'))
  }
  if (typeof p.content !== 'string') {
    findings.push(
      finding('action-proposal-invalid', 'content 必须是字符串', 'inputPayload.content'),
    )
  } else if (p.content.length > PILOT_CONTENT_MAX) {
    findings.push(finding('action-proposal-invalid', 'content 超长', 'inputPayload.content'))
  }
  for (const [key, value] of Object.entries(p)) {
    if (typeof value === 'string' && containsActionSensitiveValue(value)) {
      findings.push(
        finding('action-sensitive-material', '输入包含疑似敏感材料', `inputPayload.${key}`),
      )
    }
  }
  return { valid: findings.length === 0, findings }
}

/** 按 kind 分派的输入校验入口；未知 kind 返回 action-kind-unknown。 */
export function validateActionInputForKind(
  kind: PluginActionKind,
  payload: unknown,
): PluginActionValidationResult {
  switch (kind) {
    case 'plugin.pilot.item.create':
      return validatePilotItemInput(payload)
    default: {
      const exhaustive: never = kind
      void exhaustive
      return {
        valid: false,
        findings: [finding('action-kind-unknown', '未知的 action kind')],
      }
    }
  }
}

// =============================================================================
// 6. host-owned adapter registry 校验（design.md D1）
// =============================================================================

/** 描述符禁止属性模式：任何 repository/model/SQL/事务/网络声明都是平行写通道企图。 */
const ADAPTER_FORBIDDEN_KEY_PATTERNS: readonly RegExp[] = [
  /repository/i,
  /model/i,
  /\bsql\b/i,
  /rawquery/i,
  /querybuilder/i,
  /database/i,
  /dbclient/i,
  /transaction/i,
  /migration/i,
  /http/i,
  /url/i,
  /fetch/i,
  /webhook/i,
  /handler/i,
  /exec/i,
  /eval/i,
]

const ADAPTER_FORBIDDEN_VALUE_PATTERNS: readonly RegExp[] = [
  /^https?:\/\//i,
  /\b(select|insert|update|delete)\b.+\b(from|into|set)\b/i,
]

/** 深度扫描描述符中的禁止属性/值（任意代码/URL/SQL/直写通道声明）。 */
export function findForbiddenAdapterProperties(value: unknown, path = ''): readonly string[] {
  const hits: string[] = []
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findForbiddenAdapterProperties(v, `${path}[${i}]`)))
    return hits
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key
      if (ADAPTER_FORBIDDEN_KEY_PATTERNS.some((p) => p.test(key))) {
        hits.push(childPath)
      }
      hits.push(...findForbiddenAdapterProperties(child, childPath))
    }
    return hits
  }
  if (typeof value === 'string') {
    if (ADAPTER_FORBIDDEN_VALUE_PATTERNS.some((p) => p.test(value))) {
      hits.push(path)
    }
  }
  return hits
}

/** adapter 描述符登记校验：未知 kind / 非 host-core 归属 / 禁止属性均拒绝。 */
export function validateAdapterDescriptor(raw: unknown): PluginActionValidationResult {
  const findings: PluginActionValidationFinding[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      findings: [finding('adapter-descriptor-invalid', '描述符必须是对象')],
    }
  }
  const d = raw as Record<string, unknown>
  if (
    typeof d.actionKind !== 'string' ||
    !(PLUGIN_ACTION_KINDS as readonly string[]).includes(d.actionKind)
  ) {
    findings.push(finding('action-kind-unknown', '未知的 action kind', 'actionKind'))
  }
  if (d.owner !== 'host-core') {
    findings.push(
      finding(
        'adapter-not-host-owned',
        'adapter 只能由宿主核心登记，插件自带 adapter 一律拒绝',
        'owner',
      ),
    )
  }
  if (
    typeof d.batchPolicy !== 'string' ||
    !(PLUGIN_ACTION_BATCH_POLICIES as readonly string[]).includes(d.batchPolicy)
  ) {
    findings.push(finding('adapter-descriptor-invalid', 'batchPolicy 非法', 'batchPolicy'))
  }
  if (
    typeof d.reversibility !== 'string' ||
    !(PLUGIN_ACTION_REVERSIBILITY as readonly string[]).includes(d.reversibility)
  ) {
    findings.push(finding('adapter-descriptor-invalid', 'reversibility 非法', 'reversibility'))
  }
  if (
    !Array.isArray(d.requiredPermissions) ||
    d.requiredPermissions.some((x) => typeof x !== 'string')
  ) {
    findings.push(
      finding(
        'adapter-descriptor-invalid',
        'requiredPermissions 必须是字符串数组',
        'requiredPermissions',
      ),
    )
  }
  for (const hit of findForbiddenAdapterProperties(d)) {
    findings.push(finding('adapter-descriptor-invalid', '描述符包含禁止的直写/代码/网络声明', hit))
  }
  return { valid: findings.length === 0, findings }
}

// =============================================================================
// 7. 决策语义（modify/reject/discard 与确认来源）
// =============================================================================

export const PLUGIN_ACTION_DECISION_KINDS = ['accept', 'reject', 'modify', 'discard'] as const
export type PluginActionDecisionKind = (typeof PLUGIN_ACTION_DECISION_KINDS)[number]

export type ActionDecisionTranslation =
  | {
      readonly ok: true
      /** 是否存在正式写入意图（reject/discard 恒 false）。 */
      readonly writeIntent: boolean
      /**
       * 是否要求重新 preview（modify 恒 true：修改后必须生成新 preview digest，
       * 旧句柄因 previewDigest 失配而 stale）。
       */
      readonly requiresRePreview: boolean
      readonly note: string
    }
  | { readonly ok: false; readonly reasonCode: PluginActionReasonCode; readonly reason: string }

/**
 * 决策翻译（spec Requirement 7）：
 * - modify 缺 userModifiedValue → invalid；
 * - reject/discard → 无写入意图；
 * - 只有显式用户确认才是合法确认来源。
 */
export function translateActionDecision(input: {
  readonly decision: PluginActionDecisionKind
  readonly userModifiedValue?: unknown
}): ActionDecisionTranslation {
  switch (input.decision) {
    case 'accept':
      return { ok: true, writeIntent: true, requiresRePreview: false, note: '按原样确认' }
    case 'modify':
      if (input.userModifiedValue === undefined) {
        return {
          ok: false,
          reasonCode: 'action-proposal-invalid',
          reason: '修改决策必须携带修改后的值',
        }
      }
      return {
        ok: true,
        writeIntent: true,
        requiresRePreview: true,
        note: '已记录修改；需重新预览生成新 preview digest 后才能确认',
      }
    case 'reject':
      return {
        ok: true,
        writeIntent: false,
        requiresRePreview: false,
        note: '已拒绝，正式数据不变',
      }
    case 'discard':
      return {
        ok: true,
        writeIntent: false,
        requiresRePreview: false,
        note: '已丢弃，正式数据不变',
      }
    default: {
      const exhaustive: never = input.decision
      void exhaustive
      return { ok: false, reasonCode: 'action-proposal-invalid', reason: '未知决策类型' }
    }
  }
}

/** 唯一合法确认来源守卫：审批/高置信度/自动触发一律不是确认。 */
export function isExplicitUserConfirm(source: string): source is PluginActionConfirmationSource {
  return (PLUGIN_ACTION_CONFIRMATION_SOURCES as readonly string[]).includes(source)
}

// =============================================================================
// 8. 批量逐项结果组装
// =============================================================================

/** 组装批量结果：fullyApplied 恒由逐项结局推导，失败不被成功洗白。 */
export function assembleActionBulkResults(
  results: readonly PluginActionPerItemResult[],
): PluginActionBulkResult {
  return {
    results,
    fullyApplied: results.length > 0 && results.every((r) => r.outcome === 'applied'),
  }
}

/** dry-run 门禁（复用 Copilot 断言语义）：canApply=false 时 apply 必须阻断。 */
export function assertActionDryRunGate(dryRunCanApply: boolean): boolean {
  return assertCopilotDryRunGate(dryRunCanApply)
}

/** preview 是否可确认：dry-run 有 blocking finding 或 canApply=false 均不可确认。 */
export function isActionPreviewConfirmable(preview: PluginActionPreview): boolean {
  if (!assertActionDryRunGate(preview.dryRun.canApply)) return false
  return !preview.dryRun.findings.some((f) => f.severity === 'blocking')
}

// =============================================================================
// 9. 低敏 sanitization（审计 envelope 用）
// =============================================================================

const ACTION_SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /secret/i,
  /token/i,
  /password/i,
  /apikey/i,
  /api_key/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /private[_-]?key/i,
  // 生命周期低敏红线：prompt/模型输出/tool 参数结果/raw payload 一律不入审计
  /prompt/i,
  /completion/i,
  /modeloutput/i,
  /toolargs/i,
  /toolresult/i,
  /rawpayload/i,
]

const ACTION_SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /(?:^|\s|=)(?:sk|pk|tk)[-_][A-Za-z0-9]{20,}/,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._\-]+/,
  /(?:^|\s)(?:ghp|gho|ghu|ghs|ghr)[-_][A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
]

export function isActionSensitiveKey(key: string): boolean {
  return ACTION_SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))
}

export function containsActionSensitiveValue(value: string): boolean {
  return ACTION_SENSITIVE_VALUE_PATTERNS.some((p) => p.test(value))
}

/**
 * 低敏脱敏：敏感/生命周期键整体剔除，疑似敏感值替换为 '[REDACTED]'，递归处理普通对象。
 * 用于审计 metadata 写入前的最后防线。
 */
export function sanitizeActionEnvelope<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (isActionSensitiveKey(key)) continue
    if (typeof value === 'string' && containsActionSensitiveValue(value)) {
      result[key] = '[REDACTED]'
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string' && containsActionSensitiveValue(item)
          ? '[REDACTED]'
          : item !== null && typeof item === 'object'
            ? sanitizeActionEnvelope(item as Record<string, unknown>)
            : item,
      )
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeActionEnvelope(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result as Partial<T>
}

/** 二次扫描：断言 envelope 已无敏感残留（返回违规路径；空数组 = 干净）。 */
export function scanActionEnvelopeForSensitiveResidue(
  value: unknown,
  path = '',
): readonly string[] {
  const hits: string[] = []
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...scanActionEnvelopeForSensitiveResidue(v, `${path}[${i}]`)))
    return hits
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key
      if (isActionSensitiveKey(key)) hits.push(childPath)
      hits.push(...scanActionEnvelopeForSensitiveResidue(child, childPath))
    }
    return hits
  }
  if (typeof value === 'string' && containsActionSensitiveValue(value)) {
    hits.push(path)
  }
  return hits
}

// =============================================================================
// 10. 类型守卫
// =============================================================================

export function isPluginActionKind(v: unknown): v is PluginActionKind {
  return typeof v === 'string' && (PLUGIN_ACTION_KINDS as readonly string[]).includes(v)
}

export function isPluginActionSurface(v: unknown): v is PluginActionSurface {
  return typeof v === 'string' && (PLUGIN_ACTION_SURFACES as readonly string[]).includes(v)
}

export function isPluginActionReasonCode(v: unknown): v is PluginActionReasonCode {
  return typeof v === 'string' && (PLUGIN_ACTION_REASON_CODES as readonly string[]).includes(v)
}

export function isPluginActionResultStatus(v: unknown): v is PluginActionResultStatus {
  return typeof v === 'string' && (PLUGIN_ACTION_RESULT_STATUSES as readonly string[]).includes(v)
}

export function isPluginActionDecisionKind(v: unknown): v is PluginActionDecisionKind {
  return typeof v === 'string' && (PLUGIN_ACTION_DECISION_KINDS as readonly string[]).includes(v)
}

export function isPluginActionPerItemOutcome(v: unknown): v is PluginActionPerItemOutcome {
  return typeof v === 'string' && (PLUGIN_ACTION_PER_ITEM_OUTCOMES as readonly string[]).includes(v)
}
