/**
 * v3-ui-next-org-portfolio-domains W6 · tasks 6.1 —— 容量闭环（Org Capacity Loops）
 * 展示层纯函数适配器。
 *
 * - 生命周期状态徽标文本/语义色映射：draft / simulated / selected / handed-off /
 *   observing / reviewed / closed / cancelled 八态语义与旧页 STATE_LABELS 同源
 *   （`app/(dashboard)/organization/resource-capacity-loops/page.tsx`），终态
 *   closed/cancelled 无出边（`@aiproj/types` RESOURCE_CAPACITY_LOOP_ALLOWED_TRANSITIONS）；
 * - 「下一步」动作提示与旧页 nextStateLabel 语义一致；
 * - 粒度标签（日/周/月）与后端 create 枚举 day|week|month 对齐；
 * - URL filters 对既有 `parseRcclUrlFilters`/`serializeRcclUrlFilters`
 *   （`lib/api/resource-capacity-loops.ts`）的纯透传封装，刷新/分享不丢状态；
 * - envelope 归一化：`fetchRcclLoops`/`fetchRcclLoopDetail` 经 apiFetch 解包后的
 *   实际载荷可能是裸数组/裸 detail（live 后端）或 `{data,meta}`/`{data}` 信封
 *   （既有 hook 单测契约），统一在此收敛成组件可消费模型，杜绝组件侧形状分叉。
 *
 * 本文件是纯计算层：零网络、零 DOM、零 store 依赖；语义色类名均为确定性静态
 * 字符串，色值只消费 `app/(next)/next-tokens.css` 既有令牌的固定 rgba 展开
 * （0.45 发丝边框 / 0.14 底色），杜绝臆造令牌。
 */
import { RESOURCE_CAPACITY_LOOP_STATES } from '@aiproj/types'
import {
  parseRcclUrlFilters,
  serializeRcclUrlFilters,
  type RcclLoopDetail,
  type RcclLoopListItem,
  type RcclLoopListResponse,
} from '@/lib/api/resource-capacity-loops'

/** 闭环生命周期状态（后端 validator/state machine 同源八态）。 */
export type RcclLoopState = keyof typeof RESOURCE_CAPACITY_LOOP_STATES
// 值联合（'draft' | 'simulated' | …）派生自常量表，避免字符串字面量漂移。
export type RcclLoopStateValue =
  (typeof RESOURCE_CAPACITY_LOOP_STATES)[keyof typeof RESOURCE_CAPACITY_LOOP_STATES]

export interface LoopStateMeta {
  state: string
  /** 徽标短名（旧页 STATE_LABELS 同源）。 */
  label: string
  /** 语义色 chip 类名（令牌色 + rgba 展开，双通道由文字标签补足）。 */
  chipClass: string
}

/** 中性 chip（draft/closed）。 */
const NEUTRAL_CHIP =
  'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]'

const CHIP_TEXT = {
  cyan: 'text-[var(--nx-space-cyan)]',
  indigo: 'text-[var(--nx-chart-2)]',
  amber: 'text-[var(--nx-status-warning)]',
  teal: 'text-[var(--nx-chart-6)]',
  success: 'text-[var(--nx-status-success)]',
  danger: 'text-[var(--nx-status-danger)]',
} as const

/** 令牌色值固定透明度展开（色值来源 next-tokens.css 实码）。 */
const CHIP_BORDER_BG = {
  cyan: 'border-[rgba(56,189,248,0.45)] bg-[rgba(56,189,248,0.14)]',
  indigo: 'border-[rgba(129,140,248,0.45)] bg-[rgba(129,140,248,0.14)]',
  amber: 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)]',
  teal: 'border-[rgba(34,211,238,0.45)] bg-[rgba(34,211,238,0.14)]',
  success: 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)]',
  danger: 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)]',
} as const

function chip(tone: keyof typeof CHIP_TEXT): string {
  return `${CHIP_BORDER_BG[tone]} ${CHIP_TEXT[tone]}`
}

/** 八态徽标元数据（确定性全量表，未知状态走中性回退）。 */
export const RCCL_STATE_META: Record<RcclLoopStateValue, LoopStateMeta> = {
  draft: { state: 'draft', label: '草稿', chipClass: NEUTRAL_CHIP },
  simulated: { state: 'simulated', label: '已模拟', chipClass: chip('cyan') },
  selected: { state: 'selected', label: '已选择', chipClass: chip('indigo') },
  'handed-off': { state: 'handed-off', label: '已移交', chipClass: chip('amber') },
  observing: { state: 'observing', label: '观察中', chipClass: chip('teal') },
  reviewed: { state: 'reviewed', label: '已复核', chipClass: chip('success') },
  closed: { state: 'closed', label: '已关闭', chipClass: NEUTRAL_CHIP },
  cancelled: { state: 'cancelled', label: '已取消', chipClass: chip('danger') },
}

/** 状态筛选下拉选项（按状态机生命周期顺序）。 */
export const RCCL_STATE_OPTIONS: readonly LoopStateMeta[] = [
  RCCL_STATE_META.draft,
  RCCL_STATE_META.simulated,
  RCCL_STATE_META.selected,
  RCCL_STATE_META['handed-off'],
  RCCL_STATE_META.observing,
  RCCL_STATE_META.reviewed,
  RCCL_STATE_META.closed,
  RCCL_STATE_META.cancelled,
]

/** 状态→展示元数据；未知状态返回中性回退（脏数据仍可渲染，不中断）。 */
export function loopStateMeta(state: string | undefined): LoopStateMeta {
  if (state && state in RCCL_STATE_META) {
    const meta = RCCL_STATE_META[state as RcclLoopStateValue]
    return { state: meta.state, label: meta.label, chipClass: meta.chipClass }
  }
  return { state: state ?? '', label: state ?? '未知', chipClass: NEUTRAL_CHIP }
}

/** 终态判定（closed/cancelled 无出边，动作条不再提供写动作）。 */
export function isLoopTerminalState(state: string | undefined): boolean {
  return state === 'closed' || state === 'cancelled'
}

/** 粒度→中文标签（create 枚举 day|week|month）。 */
export function granularityLabelOf(granularity: string | undefined | null): string {
  if (granularity === 'week') return '周'
  if (granularity === 'month') return '月'
  if (granularity === 'day') return '日'
  return granularity ?? '—'
}

/** 循环窗口人读标签（窗口日期为后端规范 yyyy-MM-dd）。 */
export function loopWindowLabel(windowStart: string, windowEnd: string): string {
  return `${windowStart} ~ ${windowEnd}`
}

/**
 * 下一步动作提示（旧页 nextStateLabel 语义：draft→刷新基线并创建情景 /
 * simulated→人工选择情景 / selected→创建受控 handoff / handed-off→等待下游确认
 * 后捕获观察 / observing→人工复核结论 / reviewed→关闭闭环 / 终态无下一步）。
 */
export function loopNextActionHint(state: string | undefined): string {
  switch (state) {
    case 'draft':
      return '下一步：刷新基线并创建情景'
    case 'simulated':
      return '下一步：人工选择情景'
    case 'selected':
      return '下一步：创建受控 handoff'
    case 'handed-off':
      return '下一步：等待下游确认后捕获观察'
    case 'observing':
      return '下一步：人工复核结论'
    case 'reviewed':
      return '下一步：关闭闭环'
    case 'closed':
      return '闭环已关闭'
    case 'cancelled':
      return '闭环已取消'
    default:
      return ''
  }
}

// ─── URL filters 纯透传封装（tasks 6.1）────────────────────────────────────

export interface RcclUrlFilters {
  state?: string
  page?: number
}

/** 与既有 parseRcclUrlFilters 契约一致的纯透传（供列表页 restorable filters）。 */
export function parseLoopsUrlFilters(
  params: Record<string, string | string[] | undefined>,
): RcclUrlFilters {
  return parseRcclUrlFilters(params)
}

/** 与既有 serializeRcclUrlFilters 契约一致的纯透传（page=1 与默认 perPage 不落 URL）。 */
export function serializeLoopsUrlFilters(filters?: RcclUrlFilters): string {
  return serializeRcclUrlFilters(filters)
}

// ─── envelope 归一化（apiFetch 解包歧义收敛）────────────────────────────────

/** 列表载荷归一化：兼容裸数组（live apiFetch 解包）与 {data,meta} 信封两种形状。 */
export function resolveRcclListPayload(raw: unknown): {
  rows: RcclLoopListItem[]
  meta: RcclLoopListResponse['meta'] | null
} {
  if (Array.isArray(raw)) return { rows: raw, meta: null }
  if (raw !== null && typeof raw === 'object') {
    const envelope = raw as Partial<RcclLoopListResponse>
    if (Array.isArray(envelope.data)) {
      return { rows: envelope.data, meta: envelope.meta ?? null }
    }
  }
  return { rows: [], meta: null }
}

/** 详情载荷归一化：兼容裸 detail（live apiFetch 解包）与 {data: detail} 信封。 */
export function resolveRcclDetailPayload(raw: unknown): RcclLoopDetail | null {
  if (raw === null || raw === undefined) return null
  const isDetail = (value: unknown): value is RcclLoopDetail =>
    typeof value === 'object' &&
    value !== null &&
    'loop' in value &&
    typeof (value as { loop?: { id?: unknown } }).loop === 'object' &&
    typeof (value as { loop: { id?: unknown } }).loop.id === 'number'
  if (isDetail(raw)) return raw
  const nested = (raw as { data?: unknown }).data
  return isDetail(nested) ? nested : null
}
