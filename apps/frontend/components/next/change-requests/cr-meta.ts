'use client'

/**
 * 变更请求域共享静态元数据与确定性纯函数
 * （v3-ui-next-risk-change-domains W2 · tasks 2.1–2.10）。
 *
 * - 全部为静态标签表与纯函数（RL-14 确定性渲染：零运行时注入、零副作用）；
 * - 状态机合法动作以后端 `change_request_service.VALID_TRANSITIONS`（服务端事实，
 *   simple-change-approval design D2）为镜像，前端只呈现服务端将接受的推进动作；
 * - 色标只消费 --nx-* Design Tokens（由消费组件映射），本模块不依赖视觉实现。
 */
import type {
  ChangeRequestImpactSummary,
  ChangeRequestPriority,
  ChangeRequestStatus,
  ChangeRequestType,
  ChangeImpactDimension,
  ChangeImpactSeverity,
} from '@/lib/api/change-requests'

/** 双通道徽标通道命名（状态文本 + 图标 + 语义色）。 */
export type CrStatusTone = 'neutral' | 'active' | 'success' | 'danger' | 'warning'

export const CR_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  under_review: '审核中',
  approved: '已批准',
  rejected: '已拒绝',
  returned: '退回修改',
  implemented: '已实施',
  closed: '已关闭',
  cancelled: '已取消',
}

/** 状态语义通道：决定徽标图标族与色标（草稿=文件/流转=时钟/通过=对勾/终止=叉号/退回=回转）。 */
export const CR_STATUS_TONES: Record<ChangeRequestStatus, CrStatusTone> = {
  draft: 'neutral',
  submitted: 'active',
  under_review: 'active',
  approved: 'success',
  rejected: 'danger',
  returned: 'warning',
  implemented: 'success',
  closed: 'neutral',
  cancelled: 'danger',
}

/** 状态筛选下拉顺序（spec「多维组合过滤能力」九态全量）。 */
export const CR_STATUS_OPTIONS: ReadonlyArray<{ value: ChangeRequestStatus; label: string }> = (
  [
    'draft',
    'submitted',
    'under_review',
    'approved',
    'rejected',
    'returned',
    'implemented',
    'closed',
    'cancelled',
  ] as const
).map((value) => ({ value, label: CR_STATUS_LABELS[value] }))

/** 生命周期主轴（详情页状态机指示条）：draft → submitted → under_review → approved → implemented → closed。 */
export const CR_LIFECYCLE_MAIN: ReadonlyArray<ChangeRequestStatus> = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'implemented',
  'closed',
]

/** 主轴上所处步序（0 基）；非主轴状态（rejected/cancelled/returned）返回 -1。 */
export function crLifecycleIndex(status: ChangeRequestStatus): number {
  return CR_LIFECYCLE_MAIN.indexOf(status)
}

/** 分支终止状态：拒绝 / 取消 / 退回修改（不占用主轴节点）。 */
export function isCrBranchStatus(status: ChangeRequestStatus): boolean {
  return status === 'rejected' || status === 'cancelled' || status === 'returned'
}

/**
 * 状态机合法推进动作（镜像后端 change_request_service.VALID_TRANSITIONS）。
 * draft/returned 另行承载「编辑 + 提交审批」；UI 动作区据此渲染，严禁给出非法选项。
 */
export const CR_ALLOWED_ACTIONS: Record<
  ChangeRequestStatus,
  ReadonlyArray<'submit' | 'approve' | 'reject' | 'return' | 'implement' | 'close' | 'cancel'>
> = {
  draft: ['submit', 'cancel'],
  submitted: ['approve', 'reject', 'cancel'],
  under_review: ['approve', 'reject', 'return'],
  approved: ['implement', 'cancel'],
  rejected: [],
  returned: ['submit', 'cancel'],
  implemented: ['close'],
  closed: [],
  cancelled: [],
}

export const CR_TYPE_LABELS: Record<ChangeRequestType, string> = {
  scope: '范围',
  schedule: '进度',
  cost: '成本',
  resource: '资源',
  quality: '质量',
  risk: '风险',
  other: '其他',
}

export const CR_TYPE_OPTIONS: ReadonlyArray<{ value: ChangeRequestType; label: string }> = (
  ['scope', 'schedule', 'cost', 'resource', 'quality', 'risk', 'other'] as const
).map((value) => ({ value, label: CR_TYPE_LABELS[value] }))

export const CR_PRIORITY_LABELS: Record<ChangeRequestPriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
}

export const CR_PRIORITY_OPTIONS: ReadonlyArray<{ value: ChangeRequestPriority; label: string }> = (
  ['low', 'medium', 'high', 'urgent'] as const
).map((value) => ({ value, label: CR_PRIORITY_LABELS[value] }))

/** 优先级语义通道：urgent 警戒红 / high 警示琥珀 / medium 强调青 / low 中性。 */
export const CR_PRIORITY_TONES: Record<
  ChangeRequestPriority,
  'danger' | 'warning' | 'accent' | 'neutral'
> = {
  low: 'neutral',
  medium: 'accent',
  high: 'warning',
  urgent: 'danger',
}

/** 初始六维影响摘要录入顺序与标签（新建/编辑/只读回显共用）。 */
export const CR_IMPACT_SUMMARY_FIELDS: ReadonlyArray<{
  key: keyof ChangeRequestImpactSummary
  label: string
  placeholder: string
}> = [
  { key: 'scope', label: '范围影响', placeholder: '受影响的范围、交付物与验收口径…' },
  { key: 'schedule', label: '进度影响', placeholder: '工期变化、里程碑偏移与关键路径影响…' },
  { key: 'resources', label: '资源影响', placeholder: '新增/调整的人力、设备与依赖资源…' },
  { key: 'cost', label: '成本影响', placeholder: '预算增减、成本构成变化…' },
  { key: 'risks', label: '风险', placeholder: '本次变更引入或消除的风险…' },
  { key: 'assumptions', label: '假设前提', placeholder: '本次评估依赖的假设前提…' },
]

/** 六维影响分析维度标签（适配面板维度卡片共用；related_object 为穿透对象维度）。 */
export const CR_IMPACT_DIMENSION_LABELS: Record<ChangeImpactDimension, string> = {
  scope: '范围',
  schedule: '进度',
  resource: '资源',
  risk: '风险',
  quality: '质量',
  assumption: '假设',
  related_object: '关联对象',
}

export const CR_SEVERITY_LABELS: Record<ChangeImpactSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  none: '无',
}

/** 严重度语义通道（适配面板柱状分布与穿透条目着色）。 */
export const CR_SEVERITY_TONES: Record<
  ChangeImpactSeverity,
  'danger' | 'warning' | 'accent' | 'neutral'
> = {
  critical: 'danger',
  high: 'warning',
  medium: 'accent',
  low: 'neutral',
  none: 'neutral',
}

export const CR_SEVERITY_ORDER: readonly ChangeImpactSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'none',
]

/** 影响分析整体状态标签（适配面板角标）。 */
export const CR_ANALYSIS_STATUS_LABELS: Record<string, string> = {
  pending: '分析中',
  completed: '已完成',
  failed: '失败',
  stale: '已过期',
}

/** 相对时间（简体中文）；null → '-'。 */
export function formatCrDate(value: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** 纯日期（YYYY-MM-DD 展示），供日期范围输入值比较回显。 */
export function formatCrDateOnly(value: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('zh-CN')
}

/** 提交时间优先、创建时间兜底（草稿尚无提交时间）。 */
export function crSubmissionTime(cr: { submittedAt: string | null; createdAt: string }): string {
  return cr.submittedAt ?? cr.createdAt
}
