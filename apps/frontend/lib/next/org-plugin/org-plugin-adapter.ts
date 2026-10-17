/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.1 —— 插件治理域呈现层纯函数适配器。
 *
 * 新轨插件目录与插件策略工作台（/next/organization/plugin-directory、
 * /next/organization/plugin-policies）的展示层纯计算底座：
 * - 私有目录 release 生命周期（draft/pending_review/approved/rejected/deprecated/withdrawn）
 *   中文标签与徽标语义色类名映射（文案语义与旧轨 PluginDirectoryWorkbench
 *   STATUS_LABELS/STATUS_BADGE_VARIANTS 同源）；
 * - 当前状态 × 权限下合法的目录管理动作矩阵（approve/disable/restore/rollback），
 *   无权限动作不出现在返回值——**不渲染、不以 disabled 暗示能力存在**（RL-06）；
 * - 受影响安装计数与实例状态的中文格式化；
 * - 回滚阻断码中文说明（与旧 DirectoryActionDialog BLOCKING_LABELS 同源，只复述后端裁决）；
 * - 策略包激活状态（active/disabled）徽标映射与激活闭环步骤标签（copy → 统一变更请求
 *   → 审批 → 最终确认）；影响摘要动作中文标签。
 *
 * 本文件是纯计算层：零网络、零 DOM、零 store 依赖；只从既有 lib/api 引入类型。
 * 语义色类名为确定性静态字符串（Tailwind v4 内容扫描可拾取）；rgba 展开值是
 * next-tokens.css 令牌色值的固定透明度展开（0.45 发丝边框 / 0.14 底色），
 * 与同批 help-knowledge 适配器（knowledge-adapter.ts）同一纪律，非新色板。
 */
import type {
  DirectoryChangeAction,
  DirectoryReleaseStatus,
  DirectoryRollbackBlockingCode,
} from '@/lib/api/plugin-directory'

// =============================================================================
// 目录 release 生命周期状态徽标
// =============================================================================

export interface DirectoryReleaseStatusMeta {
  status: DirectoryReleaseStatus
  /** 中文标签。 */
  label: string
  /** 语义说明（tooltip/描述）。 */
  description: string
  /** 徽标语义色类名（令牌色文字 + rgba 展开边框/底色）。 */
  chipClass: string
}

const STATUS_CHIP_BORDER_BG: Record<DirectoryReleaseStatus, string> = {
  draft: 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]',
  pending_review: 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)]',
  approved: 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)]',
  rejected: 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)]',
  deprecated: 'border-[rgba(251,191,36,0.45)] bg-[rgba(251,191,36,0.14)]',
  withdrawn: 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)]',
}

const STATUS_CHIP_TEXT: Record<DirectoryReleaseStatus, string> = {
  draft: 'text-[var(--nx-text-muted)]',
  pending_review: 'text-[var(--nx-status-warning)]',
  approved: 'text-[var(--nx-status-success)]',
  rejected: 'text-[var(--nx-status-danger)]',
  deprecated: 'text-[var(--nx-chart-4)]',
  withdrawn: 'text-[var(--nx-status-danger)]',
}

export const DIRECTORY_RELEASE_STATUS_META: Record<
  DirectoryReleaseStatus,
  DirectoryReleaseStatusMeta
> = {
  draft: {
    status: 'draft',
    label: '草稿',
    description: '草稿 · 尚未提交组织审核',
    chipClass: `${STATUS_CHIP_BORDER_BG.draft} ${STATUS_CHIP_TEXT.draft}`,
  },
  pending_review: {
    status: 'pending_review',
    label: '待审核',
    description: '待审核 · 等待具备审批权限的治理者处理',
    chipClass: `${STATUS_CHIP_BORDER_BG.pending_review} ${STATUS_CHIP_TEXT.pending_review}`,
  },
  approved: {
    status: 'approved',
    label: '已批准',
    description: '已批准 · 组织成员可在目录中发现该版本',
    chipClass: `${STATUS_CHIP_BORDER_BG.approved} ${STATUS_CHIP_TEXT.approved}`,
  },
  rejected: {
    status: 'rejected',
    label: '已拒绝',
    description: '已拒绝 · 不进入组织分发',
    chipClass: `${STATUS_CHIP_BORDER_BG.rejected} ${STATUS_CHIP_TEXT.rejected}`,
  },
  deprecated: {
    status: 'deprecated',
    label: '已弃用',
    description: '已弃用 · 不再推荐新安装',
    chipClass: `${STATUS_CHIP_BORDER_BG.deprecated} ${STATUS_CHIP_TEXT.deprecated}`,
  },
  withdrawn: {
    status: 'withdrawn',
    label: '已撤回',
    description: '已撤回 · 已停止分发，可恢复送审',
    chipClass: `${STATUS_CHIP_BORDER_BG.withdrawn} ${STATUS_CHIP_TEXT.withdrawn}`,
  },
}

/** 状态选择器选项（固定顺序与后端枚举一致）。 */
export const DIRECTORY_RELEASE_STATUS_OPTIONS: DirectoryReleaseStatusMeta[] = [
  DIRECTORY_RELEASE_STATUS_META.draft,
  DIRECTORY_RELEASE_STATUS_META.pending_review,
  DIRECTORY_RELEASE_STATUS_META.approved,
  DIRECTORY_RELEASE_STATUS_META.rejected,
  DIRECTORY_RELEASE_STATUS_META.deprecated,
  DIRECTORY_RELEASE_STATUS_META.withdrawn,
]

/** 未知状态回退（脏数据仍可渲染，中性呈现）。 */
export function directoryReleaseStatusMetaOf(
  status: string | undefined,
): DirectoryReleaseStatusMeta | null {
  if (!status) return null
  return DIRECTORY_RELEASE_STATUS_META[status as DirectoryReleaseStatus] ?? null
}

// =============================================================================
// 目录管理动作矩阵（当前状态 × 权限）
//
// 语义与旧轨 PluginDirectoryWorkbench legalActions 同源：
// - approve（批准）：pending_review 且 plugin_registry:review
// - disable（停止分发）：approved/deprecated 且 plugin_registry:manage
// - restore（恢复送审）：withdrawn 且 plugin_registry:manage
// - rollback（回滚推荐指针）：approved 且 plugin_registry:rollback
// 无权限的动作不返回——UI 不渲染，也不以 disabled 暗示能力存在（RL-06）。
// =============================================================================

export interface DirectoryActionPermissions {
  canApprove: boolean
  canManage: boolean
  canRollback: boolean
}

export const DIRECTORY_ACTION_LABELS: Record<DirectoryChangeAction, string> = {
  approve: '批准',
  disable: '停止分发',
  restore: '恢复送审',
  rollback: '回滚到此版本',
}

export const DIRECTORY_ACTION_ORDER: readonly DirectoryChangeAction[] = [
  'approve',
  'disable',
  'restore',
  'rollback',
]

/** 当前状态下合法动作（结合权限；顺序固定）。 */
export function legalDirectoryActions(
  status: DirectoryReleaseStatus,
  permissions: DirectoryActionPermissions,
): DirectoryChangeAction[] {
  const actions: DirectoryChangeAction[] = []
  if (permissions.canApprove && status === 'pending_review') actions.push('approve')
  if (permissions.canManage && (status === 'approved' || status === 'deprecated')) {
    actions.push('disable')
  }
  if (permissions.canManage && status === 'withdrawn') actions.push('restore')
  if (permissions.canRollback && status === 'approved') actions.push('rollback')
  return actions
}

/** 目录动作是否至少存在一个可渲染入口（供详情区分「治理者」与「纯浏览」）。 */
export function hasAnyDirectoryAction(
  status: DirectoryReleaseStatus,
  permissions: DirectoryActionPermissions,
): boolean {
  return legalDirectoryActions(status, permissions).length > 0
}

// =============================================================================
// 目录动作对话框文案（提交 ≠ 生效 表达）
// =============================================================================

export const DIRECTORY_ACTION_TITLES: Record<DirectoryChangeAction, string> = {
  approve: '批准此版本进入组织目录',
  disable: '停止分发此版本',
  restore: '恢复此版本重新送审',
  rollback: '回滚推荐版本',
}

export const DIRECTORY_ACTION_DESCRIPTIONS: Record<DirectoryChangeAction, string> = {
  approve: '批准后本组织成员可在目录中发现并安装该版本。审批与最终确认分两步，均需人工操作。',
  disable: '停止分发只影响目录的可发现性，已安装实例保持原状，不会被停用或卸载。',
  restore: '恢复会让该版本重新回到送审流程，需要再次通过审批与兼容性检查才能分发。',
  rollback: '回滚只切换目录的推荐版本指针；已安装实例不会被自动降级。',
}

/** 提交按钮一律表述「提交」，与「生效」区分（RL-06 语义）。 */
export const DIRECTORY_ACTION_SUBMIT_LABELS: Record<DirectoryChangeAction, string> = {
  approve: '提交批准申请',
  disable: '提交停止分发申请',
  restore: '提交恢复申请',
  rollback: '提交回滚申请',
}

// =============================================================================
// 受影响安装计数与实例状态格式化
// =============================================================================

export interface AffectedInstallationCounts {
  activeCount: number
  uninstalledCount: number
}

/** 「安装中 N」；存在历史卸载时追加「 · 已卸载 M」。 */
export function formatAffectedInstallationSummary(counts: AffectedInstallationCounts): string {
  const { activeCount, uninstalledCount } = counts
  const base = `安装中 ${activeCount}`
  return uninstalledCount > 0 ? `${base} · 已卸载 ${uninstalledCount}` : base
}

const INSTALLATION_STATUS_LABELS: Record<string, string> = {
  enabled: '已启用',
  installed: '未启用',
  uninstalled: '已卸载',
}

/** 实例状态中文标签；未知状态原样返回（数据契约外不做猜测）。 */
export function installationStatusLabel(status: string): string {
  return INSTALLATION_STATUS_LABELS[status] ?? status
}

// =============================================================================
// 回滚阻断码中文说明（只复述后端裁决，本地不放行）
// =============================================================================

export const DIRECTORY_ROLLBACK_BLOCKING_LABELS: Record<DirectoryRollbackBlockingCode, string> = {
  'rollback-target-not-approved': '目标版本未处于已批准状态，不能作为回滚目标。',
  'rollback-target-integrity-incomplete': '目标版本的完整性信息不完整，无法校验制品。',
  'rollback-target-incompatible': '目标版本与当前宿主不兼容，回滚会破坏运行时。',
  'rollback-permission-elevation': '目标版本声明了更多权限，提权须走权限升级流程，不能借回滚完成。',
  'rollback-target-missing': '目标版本不存在或已不可用。',
}

/** 阻断码 → 中文；未知码原样回退。 */
export function directoryRollbackBlockingLabel(code: string): string {
  return DIRECTORY_ROLLBACK_BLOCKING_LABELS[code as DirectoryRollbackBlockingCode] ?? code
}

// =============================================================================
// 统一变更请求：状态与类型标签（与 @aiproj/types PLUGIN_CHANGE_REQUEST_STATES /
// PLUGIN_CHANGE_KINDS 封闭集同源；展示层只复述，不做推断）
// =============================================================================

const CHANGE_REQUEST_STATE_LABELS: Record<string, string> = {
  draft: '草稿',
  'pending-approval': '待审批',
  approved: '已审批',
  rejected: '已拒绝',
  'awaiting-confirmation': '待确认',
  applied: '已生效',
  withdrawn: '已撤回',
  expired: '已过期',
  failed: '失败',
}

/** 变更请求状态中文标签（展示层回退原值）。 */
export function changeRequestStateLabel(state: string | undefined | null): string {
  if (!state) return '—'
  return CHANGE_REQUEST_STATE_LABELS[state] ?? state
}

const CHANGE_REQUEST_KIND_LABELS: Record<string, string> = {
  install: '安装',
  'permission-upgrade': '权限升级',
  'version-upgrade': '版本升级',
  'policy-bundle-change': '策略变更',
  'registry-release-change': '目录变更',
}

/** 变更请求类型中文标签（展示层回退原值）。 */
export function changeRequestKindLabel(kind: string | undefined | null): string {
  if (!kind) return '—'
  return CHANGE_REQUEST_KIND_LABELS[kind] ?? kind
}

// =============================================================================
// 插件策略包：激活状态徽标 + 激活闭环步骤 + 影响摘要动作标签
// =============================================================================

export interface PolicyActivationMeta {
  status: 'active' | 'disabled'
  label: string
  description: string
  chipClass: string
}

const ACTIVATION_CHIP_BORDER_BG: Record<'active' | 'disabled', string> = {
  active: 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)]',
  disabled: 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]',
}

const ACTIVATION_CHIP_TEXT: Record<'active' | 'disabled', string> = {
  active: 'text-[var(--nx-status-success)]',
  disabled: 'text-[var(--nx-text-muted)]',
}

export const POLICY_ACTIVATION_META: Record<'active' | 'disabled', PolicyActivationMeta> = {
  active: {
    status: 'active',
    label: '生效中',
    description: '生效中 · 组织当前执行该策略版本',
    chipClass: `${ACTIVATION_CHIP_BORDER_BG.active} ${ACTIVATION_CHIP_TEXT.active}`,
  },
  disabled: {
    status: 'disabled',
    label: '已停用',
    description: '已停用 · 组织未执行组织策略版本',
    chipClass: `${ACTIVATION_CHIP_BORDER_BG.disabled} ${ACTIVATION_CHIP_TEXT.disabled}`,
  },
}

/** 激活状态 → 徽标元信息（未知回退 disabled 中性呈现）。 */
export function policyActivationMetaOf(status: string | undefined): PolicyActivationMeta {
  if (status === 'active') return POLICY_ACTIVATION_META.active
  return POLICY_ACTIVATION_META.disabled
}

/**
 * 策略激活闭环步骤标签（copy → 统一变更请求 → 审批 → 最终确认）：
 * RL-06 写路径的每一步都是独立人工动作，不自动串联。
 */
export const POLICY_ACTIVATION_STEP_LABELS = {
  compose: '提交变更请求',
  changeRequest: '统一变更请求（未生效）',
  approve: '由另一位管理员审批',
  confirm: '最终确认并生效',
} as const

export type PolicyActivationStep = keyof typeof POLICY_ACTIVATION_STEP_LABELS

/** 影响摘要动作中文标签（copy/enable/disable/upgrade）。 */
export const POLICY_ACTION_LABELS: Record<string, string> = {
  copy: '复制',
  enable: '启用',
  disable: '停用',
  upgrade: '升级',
}

/** 影响摘要动作中文标签（未知动作原样回退）。 */
export function policyActionLabel(action: string): string {
  return POLICY_ACTION_LABELS[action] ?? action
}

// =============================================================================
// 日期展示（UTC 日历日，与同批适配器一致）
// =============================================================================

/** ISO 时间串 → `YYYY-MM-DD`（UTC 日历日）；非法输入原样截断前 10 位。 */
export function formatPluginDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}
