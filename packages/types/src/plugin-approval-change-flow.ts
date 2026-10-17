/**
 * plugin-approval-change-flow —— V3 插件统一变更请求与审批确认状态机共享契约
 * （纯类型 + 常量 + 确定性状态机 + canonical diff + handle/receipt + 类型守卫 + 低敏 sanitization，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。
 * 测试见 `plugin-approval-change-flow.test.ts`，fixtures 见 `plugin-approval-change-flow-fixtures.ts`。
 *
 * # 语义要点（对应 design.md D1~D5 与 specs/plugin-approval-change-flow/spec.md）
 * - 统一 PluginChangeRequest 覆盖 install / permission-upgrade / version-upgrade 三类变更。
 * - 阶段不可跳跃：preview →（策略要求时）审批 → 发起人显式确认 → 核心事务提交 → 可信审计。
 * - 审批 ≠ 确认：即使同一 actor 兼任，两条事件与权限独立记录。
 * - 确认句柄为服务器签发的有界 digest，绑定 request/actor/org/project/revision/digest/expiresAt，
 *   数据库原子 compare-and-swap 一次性消费；客户端不得提供 authority 字段。
 * - 领域提交与可信审计 receipt 处于同一事务边界；审计失败必须回滚（fail-closed）。
 */

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** 变更类型枚举（封闭集）。`policy-bundle-change` 由 v3-plugin-policy-bundles 按 design D4 兼容扩展新增；`registry-release-change` 由 v3-organization-private-plugin-directory 按 design D2 新增（目录 approve/disable/restore/rollback 统一走变更流）。 */
export const PLUGIN_CHANGE_KINDS = [
  'install',
  'permission-upgrade',
  'version-upgrade',
  'policy-bundle-change',
  'registry-release-change',
] as const
export type PluginChangeKind = (typeof PLUGIN_CHANGE_KINDS)[number]

/** 请求状态枚举（封闭集，spec Requirement 5 九态）。 */
export const PLUGIN_CHANGE_REQUEST_STATES = [
  'draft',
  'pending-approval',
  'approved',
  'rejected',
  'awaiting-confirmation',
  'applied',
  'withdrawn',
  'expired',
  'failed',
] as const
export type PluginChangeRequestState = (typeof PLUGIN_CHANGE_REQUEST_STATES)[number]

/** 终态集合（进入后不允许再转移）。 */
export const PLUGIN_CHANGE_TERMINAL_STATES = [
  'rejected',
  'applied',
  'withdrawn',
  'expired',
] as const
export type PluginChangeTerminalState = (typeof PLUGIN_CHANGE_TERMINAL_STATES)[number]

/** append-only 决策事件类型（D1）。 */
export const PLUGIN_CHANGE_DECISION_EVENTS = [
  'requested',
  'previewed',
  'approved',
  'rejected',
  'withdrawn',
  'confirmed',
  'applied',
  'failed',
  'expired',
] as const
export type PluginChangeDecisionEventKind = (typeof PLUGIN_CHANGE_DECISION_EVENTS)[number]

/**
 * 状态转移表（事件驱动）。
 * - draft 经 preview 后按策略进入 pending-approval 或 awaiting-confirmation。
 * - approved 只能进入 awaiting-confirmation（审批 ≠ 确认，D3）。
 * - failed 可经重新预览回到 awaiting-confirmation（可重试且不重复应用）。
 */
export const PLUGIN_CHANGE_STATE_TRANSITIONS: Record<
  PluginChangeRequestState,
  readonly PluginChangeRequestState[]
> = {
  draft: ['pending-approval', 'awaiting-confirmation', 'withdrawn', 'expired'],
  'pending-approval': ['approved', 'rejected', 'withdrawn', 'expired'],
  approved: ['awaiting-confirmation', 'withdrawn', 'expired'],
  rejected: [],
  'awaiting-confirmation': ['applied', 'failed', 'withdrawn', 'expired'],
  applied: [],
  withdrawn: [],
  expired: [],
  failed: ['awaiting-confirmation', 'expired'],
}

/** 错误码 / reason code（稳定、非泄露）。 */
export const PLUGIN_CHANGE_ERROR_CODES = [
  // 请求与状态机
  'plugin-change-request-not-found',
  'plugin-change-illegal-transition',
  'plugin-change-already-decided',
  // handle 与新鲜度
  'plugin-change-handle-invalid',
  'plugin-change-handle-expired',
  'plugin-change-handle-replayed',
  'plugin-change-stale',
  // 权限与多租户
  'plugin-change-permission-denied',
  'plugin-change-cross-org',
  'plugin-change-maker-checker-required',
  'plugin-change-self-approval-denied',
  'plugin-change-permission-elevation-denied',
  // 领域校验（adapter 独立 reason code）
  'plugin-change-release-mismatch',
  'plugin-change-compatibility-blocking',
  'plugin-change-target-invalid',
  // 提交门
  'plugin-change-audit-failed',
  'plugin-change-apply-failed',
  // 通用
  'plugin-change-payload-invalid',
  'plugin-change-expired',
  'plugin-change-tool-error',
] as const
export type PluginChangeErrorCode = (typeof PLUGIN_CHANGE_ERROR_CODES)[number]

/** RBAC 权限码。 */
export const PLUGIN_CHANGE_PERMISSIONS = [
  'plugin_change_request:view',
  'plugin_change_request:manage',
  'plugin_change_request:approve',
] as const
export type PluginChangePermission = (typeof PLUGIN_CHANGE_PERMISSIONS)[number]

/** 低敏审计动作码。 */
export const PLUGIN_CHANGE_AUDIT_ACTIONS = [
  'plugin_change_requested',
  'plugin_change_approved',
  'plugin_change_rejected',
  'plugin_change_withdrawn',
  'plugin_change_confirmed',
  'plugin_change_applied',
  'plugin_change_failed',
] as const
export type PluginChangeAuditAction = (typeof PLUGIN_CHANGE_AUDIT_ACTIONS)[number]

/** 默认确认句柄 TTL 秒数。 */
export const PLUGIN_CHANGE_HANDLE_TTL_SECONDS = 600

/** canonical diff 有界上限（防 payload 无限膨胀）。 */
export const PLUGIN_CHANGE_MAX_DIFF_ENTRIES = 64

// =============================================================================
// 2. 核心类型与 DTO
// =============================================================================

/** 权限差异（canonical diff 的权限维度）。 */
export interface PluginChangePermissionDelta {
  /** 新增权限 key（排序去重）。 */
  added: readonly string[]
  /** 移除权限 key（排序去重）。 */
  removed: readonly string[]
  /** 不变权限 key（排序去重）。 */
  unchanged: readonly string[]
}

/** 版本差异（canonical diff 的版本维度）。 */
export interface PluginChangeVersionDelta {
  /** 当前版本（未安装为 null）。 */
  currentVersion: string | null
  /** 目标版本。 */
  targetVersion: string
  /** 当前 release id（未安装为 null）。 */
  currentReleaseId: number | null
  /** 目标 release id。 */
  targetReleaseId: number
}

/**
 * 有界 canonical diff：共享层只持有该结构，
 * 不理解安装或 registry 内部字段（design.md D2）。
 */
export interface PluginChangeCanonicalDiff {
  kind: PluginChangeKind
  pluginId: string
  /** 安装状态差异（install 类必填）。 */
  installStatusBefore?: PluginInstallStatusRef
  installStatusAfter?: PluginInstallStatusRef
  /** 版本差异（version-upgrade / install 类必填）。 */
  versionDelta?: PluginChangeVersionDelta
  /** 权限差异（permission-upgrade 必填；install/version-upgrade 有权限清单时也填写）。 */
  permissionDelta?: PluginChangePermissionDelta
  /** 兼容性摘要 before/after。 */
  compatibilityDigestBefore?: string | null
  compatibilityDigestAfter?: string | null
  /** 目录管理动作（registry-release-change 必填）：approve/disable/restore/rollback。 */
  registryAction?: PluginRegistryActionRef
  /** 目录 release 状态差异（registry-release-change 的 approve/disable/restore 填写）。 */
  releaseStatusDelta?: PluginRegistryReleaseStatusDelta
  /** 有界受影响安装计数（registry-release-change 的 disable/rollback 填写，低敏聚合）。 */
  affectedInstallationSummary?: PluginChangeAffectedInstallationSummary
}

/** 安装状态引用（复用 install lifecycle 语义但不导入其类型，保持零内部依赖）。 */
export type PluginInstallStatusRef = 'installed' | 'enabled' | 'uninstalled' | 'not_installed'

/**
 * 目录管理动作引用（registry-release-change；与私有 registry 状态机语义对齐但零依赖）：
 * approve = pending_review->approved；disable = approved->withdrawn（阻断未来分发）；
 * restore = withdrawn->draft（重新进入审批周期）；rollback = 推荐指针切换至历史 release。
 */
export type PluginRegistryActionRef = 'approve' | 'disable' | 'restore' | 'rollback'

/** 目录 release 状态引用（与 registry 状态机同词表，零依赖本地声明）。 */
export type PluginRegistryReleaseStatusRef =
  'draft' | 'pending_review' | 'approved' | 'rejected' | 'deprecated' | 'withdrawn'

/** 目录 release 状态差异（before/after 一经创建不可变）。 */
export interface PluginRegistryReleaseStatusDelta {
  from: PluginRegistryReleaseStatusRef
  to: PluginRegistryReleaseStatusRef
}

/** 有界受影响安装摘要（禁用/回滚影响清单的低敏计数投影，不含实例明细）。 */
export interface PluginChangeAffectedInstallationSummary {
  /** 目标 release 名下活动安装数（installed+enabled）。 */
  activeCount: number
  /** 已卸载安装数。 */
  uninstalledCount: number
  /** rollback 显式选中待降级的安装 id（有界；空 = 仅指针切换）。 */
  selectedInstanceIds?: readonly number[]
}

/**
 * 变更请求记录（对应 plugin_change_requests 表的领域投影）。
 * before/after 摘要一经创建不可变（spec Requirement 1）。
 */
export interface PluginChangeRequestRecord {
  /** 请求 ID（UUID，服务器生成）。 */
  id: string
  /** 归属组织 ID。 */
  organizationId: string
  /** 可选项目 ID。 */
  projectId: string | null
  /** 变更类型。 */
  kind: PluginChangeKind
  /** 当前状态。 */
  state: PluginChangeRequestState
  /** 插件标识。 */
  pluginId: string
  /** 发起人 actor ref（userId 字符串化）。 */
  requestedBy: string
  /** 目标 revision（release id 或安装 revision 的字符串绑定）。 */
  targetRevision: string
  /** 不可变 canonical diff。 */
  diff: PluginChangeCanonicalDiff
  /** diff 摘要。 */
  diffDigest: string
  /** 权限清单摘要。 */
  permissionDigest: string
  /** 兼容性摘要。 */
  compatibilityDigest: string
  /** 是否需要审批（组织策略判定结果，创建时固化）。 */
  approvalRequired: boolean
  /** 审批人（已审批时）。 */
  approvedBy: string | null
  /** 乐观锁行版本（CAS 基础）。 */
  rowVersion: number
  /** 过期时间（ISO）。 */
  expiresAt: string
  /** 创建时间（ISO）。 */
  createdAt: string
  /** 更新时间（ISO）。 */
  updatedAt: string
}

/**
 * 确认句柄（服务器签发的有界 digest，design.md D4）。
 * 绑定 requestId、rowVersion、actor、organization/project、target revision、
 * diff/permission/compatibility digest 与 expiresAt；一次性消费。
 */
export interface PluginChangeConfirmHandle {
  /** 句柄值（`chg-cfm-<digest12>-<rowVersion>` 形式）。 */
  handle: string
  requestId: string
  organizationId: string
  projectId: string | null
  /** 被授权执行确认的 actor ref。 */
  actorRef: string
  /** 签发时的请求行版本。 */
  rowVersion: number
  /** 目标 revision 绑定。 */
  targetRevision: string
  diffDigest: string
  permissionDigest: string
  compatibilityDigest: string
  /** 过期时间（ISO）。 */
  expiresAt: string
}

/** 句柄签发输入（全部 authority 字段由服务端提供）。 */
export interface PluginChangeHandleIssuanceInput {
  requestId: string
  organizationId: string
  projectId: string | null
  actorRef: string
  rowVersion: number
  targetRevision: string
  diffDigest: string
  permissionDigest: string
  compatibilityDigest: string
  /** 服务端当前时间（ISO）；测试显式注入保证确定性。 */
  nowIso: string
  ttlSeconds?: number
}

/** 可信审计 receipt（提交门的必要结果，design.md D5）。 */
export interface PluginChangeAuditReceipt {
  /** audit_logs 行 id（0 表示降级写入，仅 non-strict 场景）。 */
  auditLogId: number
  createdAt: string
}

/** append-only 决策事件（对应 plugin_change_decisions 表的领域投影）。 */
export interface PluginChangeDecisionEvent {
  /** 幂等 ID（由 requestId+event+idempotencyKey 派生）。 */
  id: string
  requestId: string
  organizationId: string
  event: PluginChangeDecisionEventKind
  /** 决策者 actor ref。 */
  actorRef: string
  /** 客户端幂等键（服务端校验后落库）。 */
  idempotencyKey: string
  fromState: PluginChangeRequestState
  toState: PluginChangeRequestState
  /** 稳定 reason code（拒绝/失败时必填）。 */
  reasonCode: PluginChangeErrorCode | null
  /** 事件发生时的请求 diff digest（审计对照）。 */
  diffDigest: string
  createdAt: string
}

/** 状态转移纯函数结果。 */
export type ChangeStateTransitionResult =
  { ok: true; next: PluginChangeRequestState } | { ok: false; error: PluginChangeErrorCode }

/** handle 绑定校验结果。 */
export type HandleBindingResult =
  { valid: true } | { valid: false; error: PluginChangeErrorCode; reason: string }

// =============================================================================
// 3. 确定性纯函数
// =============================================================================

/** 确定性 FNV-1a 32-bit 哈希。 */
export function changeFnv1a32(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 确定性稳定 JSON 序列化（键排序递归）。 */
export function changeStableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => changeStableSerialize(v)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + changeStableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

/** 规范化权限 key 列表：去空白、去空、去重、排序。 */
export function normalizeChangePermissionKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.map((k) => k.trim()).filter((k) => k.length > 0))].sort()
}

/**
 * 计算权限差异：requested 相对 current 的 added/removed/unchanged。
 * 输出恒定排序（幂等纯函数）。
 */
export function computePermissionDelta(
  current: readonly string[],
  requested: readonly string[],
): PluginChangePermissionDelta {
  const cur = new Set(normalizeChangePermissionKeys(current))
  const req = normalizeChangePermissionKeys(requested)
  const added: string[] = []
  const removed: string[] = []
  const unchanged: string[] = []
  for (const key of req) {
    if (cur.has(key)) unchanged.push(key)
    else added.push(key)
  }
  for (const key of cur) {
    if (!req.includes(key)) removed.push(key)
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    unchanged: unchanged.sort(),
  }
}

/** 判定权限差异是否构成提升（存在新增权限）。 */
export function isPermissionElevation(delta: PluginChangePermissionDelta): boolean {
  return delta.added.length > 0
}

/**
 * 权限提升 fail-closed 检查：requested 必须同时落在 actorAllowed 与 orgPolicyAllowed 内。
 * 任一越界即返回被拒的具体越界集合（不泄露原因之外的细节）。
 */
export function checkPermissionElevationBounds(
  requested: readonly string[],
  actorAllowed: readonly string[],
  orgPolicyAllowed: readonly string[],
):
  | { ok: true }
  | { ok: false; code: 'plugin-change-permission-elevation-denied'; violations: string[] } {
  const actor = new Set(normalizeChangePermissionKeys(actorAllowed))
  const policy = new Set(normalizeChangePermissionKeys(orgPolicyAllowed))
  const violations: string[] = []
  for (const key of normalizeChangePermissionKeys(requested)) {
    if (!actor.has(key) || !policy.has(key)) violations.push(key)
  }
  if (violations.length > 0) {
    return { ok: false, code: 'plugin-change-permission-elevation-denied', violations }
  }
  return { ok: true }
}

/** 计算 canonical diff 摘要（有界：超限条目截断并计入 omitted）。 */
export function computeChangeDiffDigest(diff: PluginChangeCanonicalDiff): string {
  const bounded = boundChangeDiff(diff)
  return changeFnv1a32(changeStableSerialize(bounded.diff) + `|omitted:${bounded.omitted}`)
}

/** 有界化 canonical diff（超过 MAX_DIFF_ENTRIES 的列表条目截断）。 */
export function boundChangeDiff(diff: PluginChangeCanonicalDiff): {
  diff: PluginChangeCanonicalDiff
  omitted: number
} {
  let omitted = 0
  // 泛型：权限 key 词表为 string[]，受影响实例 id 为 number[]，同一截断语义共用。
  const cap = <T>(keys: readonly T[] | undefined): readonly T[] | undefined => {
    if (!keys) return keys
    if (keys.length <= PLUGIN_CHANGE_MAX_DIFF_ENTRIES) return keys
    omitted += keys.length - PLUGIN_CHANGE_MAX_DIFF_ENTRIES
    return keys.slice(0, PLUGIN_CHANGE_MAX_DIFF_ENTRIES)
  }
  const permissionDelta = diff.permissionDelta
    ? {
        added: cap(diff.permissionDelta.added) ?? [],
        removed: cap(diff.permissionDelta.removed) ?? [],
        unchanged: cap(diff.permissionDelta.unchanged) ?? [],
      }
    : undefined
  const affectedInstallationSummary = diff.affectedInstallationSummary
    ? {
        ...diff.affectedInstallationSummary,
        selectedInstanceIds: cap(diff.affectedInstallationSummary.selectedInstanceIds),
      }
    : undefined
  return {
    diff: { ...diff, permissionDelta, affectedInstallationSummary },
    omitted,
  }
}

/** 计算句柄绑定 digest（对全部 authority 绑定字段做规范序列化哈希）。 */
export function computeChangeHandleDigest(
  handle: Omit<PluginChangeConfirmHandle, 'handle'>,
): string {
  const canonical = {
    requestId: handle.requestId,
    organizationId: handle.organizationId,
    projectId: handle.projectId,
    actorRef: handle.actorRef,
    rowVersion: handle.rowVersion,
    targetRevision: handle.targetRevision,
    diffDigest: handle.diffDigest,
    permissionDigest: handle.permissionDigest,
    compatibilityDigest: handle.compatibilityDigest,
    expiresAt: handle.expiresAt,
  }
  return changeFnv1a32(changeStableSerialize(canonical))
}

/**
 * 计算句柄核心绑定 digest（不含 expiresAt）。
 * 服务端持久化与重建对照使用：expiresAt 经数据库时间列往返后文本形式可能变化
 * （时区后缀 / 毫秒精度），不能参与严格等值比较；有效期由独立的过期检查承担。
 */
export function computeChangeHandleCoreDigest(
  handle: Omit<PluginChangeConfirmHandle, 'handle' | 'expiresAt'>,
): string {
  const canonical = {
    requestId: handle.requestId,
    organizationId: handle.organizationId,
    projectId: handle.projectId,
    actorRef: handle.actorRef,
    rowVersion: handle.rowVersion,
    targetRevision: handle.targetRevision,
    diffDigest: handle.diffDigest,
    permissionDigest: handle.permissionDigest,
    compatibilityDigest: handle.compatibilityDigest,
  }
  return changeFnv1a32(changeStableSerialize(canonical))
}

/** 服务器签发确认句柄（authority 字段全部来自服务端输入）。 */
export function buildChangeConfirmHandle(
  input: PluginChangeHandleIssuanceInput,
): PluginChangeConfirmHandle {
  const ttlSeconds = input.ttlSeconds ?? PLUGIN_CHANGE_HANDLE_TTL_SECONDS
  const expiresAt = new Date(new Date(input.nowIso).getTime() + ttlSeconds * 1000).toISOString()
  const base: Omit<PluginChangeConfirmHandle, 'handle'> = {
    requestId: input.requestId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    actorRef: input.actorRef,
    rowVersion: input.rowVersion,
    targetRevision: input.targetRevision,
    diffDigest: input.diffDigest,
    permissionDigest: input.permissionDigest,
    compatibilityDigest: input.compatibilityDigest,
    expiresAt,
  }
  // 句柄值嵌入核心绑定 digest（不含 expiresAt）：服务端持久化核心摘要后，
  // 可在不依赖时间文本形式的前提下重建对照；有效期由独立过期检查承担。
  const core = computeChangeHandleCoreDigest(base)
  return { ...base, handle: `chg-cfm-${core.slice(0, 12)}-${input.rowVersion}` }
}

/**
 * 校验确认句柄与当前服务端状态的绑定一致性。
 * 任一绑定值变化 → stale（要求重新预览）；过期 → expired。
 */
export function validateChangeHandleBinding(
  handle: PluginChangeConfirmHandle,
  expected: {
    requestId: string
    organizationId: string
    projectId: string | null
    actorRef: string
    rowVersion: number
    targetRevision: string
    diffDigest: string
    permissionDigest: string
    compatibilityDigest: string
    nowIso: string
  },
): HandleBindingResult {
  if (handle.requestId !== expected.requestId) {
    return {
      valid: false,
      error: 'plugin-change-handle-invalid',
      reason: 'Handle request mismatch',
    }
  }
  if (handle.organizationId !== expected.organizationId) {
    return {
      valid: false,
      error: 'plugin-change-cross-org',
      reason: 'Handle organization mismatch',
    }
  }
  if ((handle.projectId ?? null) !== (expected.projectId ?? null)) {
    return {
      valid: false,
      error: 'plugin-change-handle-invalid',
      reason: 'Handle project mismatch',
    }
  }
  if (handle.actorRef !== expected.actorRef) {
    return {
      valid: false,
      error: 'plugin-change-permission-denied',
      reason: 'Handle actor mismatch',
    }
  }
  if (new Date(handle.expiresAt).getTime() <= new Date(expected.nowIso).getTime()) {
    return { valid: false, error: 'plugin-change-handle-expired', reason: 'Handle has expired' }
  }
  if (
    handle.rowVersion !== expected.rowVersion ||
    handle.targetRevision !== expected.targetRevision ||
    handle.diffDigest !== expected.diffDigest ||
    handle.permissionDigest !== expected.permissionDigest ||
    handle.compatibilityDigest !== expected.compatibilityDigest
  ) {
    return {
      valid: false,
      error: 'plugin-change-stale',
      reason: 'Bound state changed since issuance; re-preview required',
    }
  }
  const digest = computeChangeHandleCoreDigest(handle)
  if (!handle.handle.startsWith(`chg-cfm-${digest.slice(0, 12)}`)) {
    return { valid: false, error: 'plugin-change-handle-invalid', reason: 'Handle digest mismatch' }
  }
  return { valid: true }
}

/** 判定状态转移是否合法（目标状态必须在转移表中）。 */
export function isValidChangeStateTransition(
  from: PluginChangeRequestState,
  to: PluginChangeRequestState,
): boolean {
  return PLUGIN_CHANGE_STATE_TRANSITIONS[from].includes(to)
}

/**
 * 事件驱动状态转移（离线可复算）。
 * - `previewed` 按 `approvalRequired` 分流：需要审批 → pending-approval，否则 → awaiting-confirmation；
 *   从 failed 出发的 previewed 是重试路径（必须重新预览后回到 awaiting-confirmation）。
 * - 终态上的任何事件都是非法转移（幂等语义由 Service 层以 already-decided 呈现）。
 */
export function transitionChangeRequestState(
  from: PluginChangeRequestState,
  event: PluginChangeDecisionEventKind,
  opts?: { approvalRequired?: boolean },
): ChangeStateTransitionResult {
  let to: PluginChangeRequestState
  if (event === 'previewed') {
    if (from === 'failed') {
      to = 'awaiting-confirmation'
    } else if (opts?.approvalRequired === false) {
      to = 'awaiting-confirmation'
    } else {
      to = 'pending-approval'
    }
  } else {
    const table: Record<
      Exclude<PluginChangeDecisionEventKind, 'previewed'>,
      PluginChangeRequestState
    > = {
      requested: 'draft',
      approved: 'approved',
      rejected: 'rejected',
      withdrawn: 'withdrawn',
      confirmed: 'awaiting-confirmation',
      applied: 'applied',
      failed: 'failed',
      expired: 'expired',
    }
    to = table[event]
  }
  if (!isValidChangeStateTransition(from, to)) {
    return { ok: false, error: 'plugin-change-illegal-transition' }
  }
  return { ok: true, next: to }
}

/** 判定请求是否已过期。 */
export function isChangeRequestExpired(expiresAt: string, nowIso: string): boolean {
  return new Date(expiresAt).getTime() <= new Date(nowIso).getTime()
}

/** 判定是否终态。 */
export function isChangeTerminalState(state: PluginChangeRequestState): boolean {
  return (PLUGIN_CHANGE_TERMINAL_STATES as readonly string[]).includes(state)
}

/** 判定某事件在当前状态下是否允许由指定 actor 执行（职责分离规则）。 */
export function checkMakerCheckerForChange(input: {
  event: 'approved' | 'rejected'
  requesterRef: string
  decisionMakerRef: string
}): { ok: true } | { ok: false; code: PluginChangeErrorCode } {
  if (input.decisionMakerRef === input.requesterRef) {
    return { ok: false, code: 'plugin-change-self-approval-denied' }
  }
  return { ok: true }
}

/** 派生决策事件幂等 ID（requestId+event+idempotencyKey 确定性派生）。 */
export function computeChangeDecisionId(
  requestId: string,
  event: PluginChangeDecisionEventKind,
  idempotencyKey: string,
): string {
  return `pdce-${changeFnv1a32(`${requestId}|${event}|${idempotencyKey}`)}-${event}`
}

// =============================================================================
// 4. 低敏审计与脱敏工具
// =============================================================================

const CHANGE_SENSITIVE_KEY_PATTERNS = [
  /secret/i,
  /token/i,
  /password/i,
  /apikey/i,
  /api_key/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /private[_-]?key/i,
]

const CHANGE_SENSITIVE_VALUE_PATTERNS = [
  /(?:^|\s)(?:sk|pk|tk)_[A-Za-z0-9]{20,}/,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._\-]+/,
  /(?:^|\s)(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
]

export function isChangeSensitiveKey(key: string): boolean {
  return CHANGE_SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))
}

export function containsChangeSensitiveValue(value: string): boolean {
  return CHANGE_SENSITIVE_VALUE_PATTERNS.some((p) => p.test(value))
}

/** 低敏脱敏：敏感键剔除、疑似敏感值替换为 [REDACTED]，递归处理普通对象。 */
export function sanitizeChangeForAudit<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (isChangeSensitiveKey(key)) continue
    if (typeof value === 'string' && containsChangeSensitiveValue(value)) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeChangeForAudit(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result as Partial<T>
}

// =============================================================================
// 5. 类型守卫
// =============================================================================

export function isPluginChangeKind(v: unknown): v is PluginChangeKind {
  return typeof v === 'string' && (PLUGIN_CHANGE_KINDS as readonly string[]).includes(v)
}

export function isPluginChangeRequestState(v: unknown): v is PluginChangeRequestState {
  return typeof v === 'string' && (PLUGIN_CHANGE_REQUEST_STATES as readonly string[]).includes(v)
}

export function isPluginChangeDecisionEventKind(v: unknown): v is PluginChangeDecisionEventKind {
  return typeof v === 'string' && (PLUGIN_CHANGE_DECISION_EVENTS as readonly string[]).includes(v)
}

export function isPluginChangeErrorCode(v: unknown): v is PluginChangeErrorCode {
  return typeof v === 'string' && (PLUGIN_CHANGE_ERROR_CODES as readonly string[]).includes(v)
}

export function isPluginChangePermission(v: unknown): v is PluginChangePermission {
  return typeof v === 'string' && (PLUGIN_CHANGE_PERMISSIONS as readonly string[]).includes(v)
}
