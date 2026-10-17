/**
 * v3-ui-next-help-knowledge-domain W2 · tasks 2.1 —— 知识库四层映射纯函数适配器。
 *
 * 新轨知识库工作台（/next/knowledge）与运营别名路由的展示层纯函数底座：
 * - L1-L4 四层语义色彩/文本映射（令牌全部为 `app/(next)/next-tokens.css` 既有令牌，
 *   色值随令牌实码：L1 冷蓝 --nx-workspace-blue #4f75ff、L2 翠绿 --nx-status-success
 *   #10b981、L3 紫罗兰 --nx-chart-7 #c084fc + SYNTHETIC 警示标识、L4 琥珀金
 *   --nx-chart-4 #fbbf24；杜绝臆造令牌 --nx-accent-gold / --nx-accent-purple）；
 * - 生命周期状态（draft/pending/active/deprecated/outdated）微标文本与语义色映射；
 * - 确定性生命周期推进目标表（与 @aiproj/types KNOWLEDGE_LIFECYCLE_TRANSITIONS 同源，
 *   pending → active 专属「人工确认转正」通道，不混入推进下拉）；
 * - 多条件复合过滤纯函数 `filterKnowledgeItems`（关键词模糊 + 层级多选 + 状态多选
 *   + 领域精确收敛）。
 *
 * 本文件是纯计算层：零网络、零 DOM、零 store 依赖；所有语义颜色类名均为确定性
 * 静态字符串，Tailwind v4 自动内容扫描可拾取（与 @/lib/next/* 既有实现同目录）。
 * rgba 展开值是令牌色值的固定透明度展开（0.45 发丝边框 / 0.14 底色），
 * 色值来源与 next-tokens.css 实码一一对应，非新色板。
 */
import type {
  KnowledgeItemLowSensitiveProjection,
  KnowledgeLayer,
  KnowledgeLifecycleStatus,
} from '@aiproj/types'
import { KNOWLEDGE_LAYERS, KNOWLEDGE_LIFECYCLE_STATUSES } from '@aiproj/types'

// ── 四层语义映射（Layer 2 工作面色彩语义，见 design「令牌引用对齐表」）────

export interface KnowledgeLayerMeta {
  /** 层码（L1-L4）。 */
  code: KnowledgeLayer
  /** 短名（徽标第二段）。 */
  shortName: string
  /** 完整名称（「L1 规范」）。 */
  fullName: string
  /** 层级职责一句话说明。 */
  description: string
  /** 徽标语义色类名（text 令牌色 + 令牌色 rgba 展开 + 发丝线）。 */
  chipClass: string
}

/** 徽标色板统一后缀（令牌色固定透明度展开，供 chipClass 组合）。 */
const LAYER_CHIP_TEXT: Record<KnowledgeLayer, string> = {
  L1: 'text-[var(--nx-workspace-blue)]',
  L2: 'text-[var(--nx-status-success)]',
  L3: 'text-[var(--nx-chart-7)]',
  L4: 'text-[var(--nx-chart-4)]',
}

const LAYER_CHIP_BORDER_BG: Record<KnowledgeLayer, string> = {
  L1: 'border-[rgba(79,117,255,0.45)] bg-[rgba(79,117,255,0.14)]',
  L2: 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)]',
  L3: 'border-[rgba(192,132,252,0.45)] bg-[rgba(192,132,252,0.14)]',
  L4: 'border-[rgba(251,191,36,0.45)] bg-[rgba(251,191,36,0.14)]',
}

/** L1-L4 全量映射（确定性纯常量）。 */
export const KNOWLEDGE_LAYER_META: Record<KnowledgeLayer, KnowledgeLayerMeta> = {
  L1: {
    code: 'L1',
    shortName: '规范',
    fullName: 'L1 规范',
    description: '权威标准 · 直接引用 · 定期评审',
    chipClass: `${LAYER_CHIP_BORDER_BG.L1} ${LAYER_CHIP_TEXT.L1}`,
  },
  L2: {
    code: 'L2',
    shortName: '观察',
    fullName: 'L2 观察',
    description: '真实经验 · 参考 · 持续采集',
    chipClass: `${LAYER_CHIP_BORDER_BG.L2} ${LAYER_CHIP_TEXT.L2}`,
  },
  L3: {
    code: 'L3',
    shortName: '合成',
    fullName: 'L3 合成',
    description: '合成案例 · 仅供模型评测参考',
    chipClass: `${LAYER_CHIP_BORDER_BG.L3} ${LAYER_CHIP_TEXT.L3}`,
  },
  L4: {
    code: 'L4',
    shortName: '现实',
    fullName: 'L4 现实',
    description: '产品数据 · 匿名聚合 · 自动采集',
    chipClass: `${LAYER_CHIP_BORDER_BG.L4} ${LAYER_CHIP_TEXT.L4}`,
  },
}

export const KNOWLEDGE_LAYER_OPTIONS: KnowledgeLayerMeta[] = KNOWLEDGE_LAYERS.map(
  (layer) => KNOWLEDGE_LAYER_META[layer],
)

/** 未知层回退（健壮性：脏数据仍可渲染）。 */
export function layerMetaOf(layer: string | undefined): KnowledgeLayerMeta | null {
  if (!layer) return null
  return KNOWLEDGE_LAYER_META[layer as KnowledgeLayer] ?? null
}

/** L3 合成警示微标文案（平台级约定，见 spec「四层知识底册表格」）。 */
export const SYNTHETIC_BADGE_TEXT = 'SYNTHETIC'

/** SYNTHETIC 徽标语义色类名（紫罗兰令牌 + 展开）。 */
export const SYNTHETIC_BADGE_CLASS =
  'border-[rgba(192,132,252,0.5)] bg-[rgba(192,132,252,0.18)] text-[var(--nx-chart-7)]'

/** SYNTHETIC 提示语（原生 title tooltip，禁止当作不可置疑事实）。 */
export const SYNTHETIC_TOOLTIP_TEXT = '此条目由 AI 合成，仅供模型评测参考，严禁当作权威标准执行'

/** 是否必须渲染 SYNTHETIC 警示徽标（L3 层或条目自带合成标记）。 */
export function requiresSyntheticBadge(item: {
  layer?: KnowledgeLayer | string
  isSynthetic?: boolean
}): boolean {
  return Boolean(item?.isSynthetic) || item?.layer === 'L3'
}

// ── 生命周期状态语义映射 ───────────────────────────────────────────

export interface KnowledgeStatusMeta {
  status: KnowledgeLifecycleStatus
  /** 中文名。 */
  label: string
  /** 语义说明（tooltip/文案）。 */
  description: string
  /** 微标语义色类名。 */
  chipClass: string
}

/** 状态徽标色板（翡翠绿/琥珀黄/中性冷灰/琥珀金/警示红，全部既有令牌）。 */
const STATUS_CHIP_BORDER_BG: Record<KnowledgeLifecycleStatus, string> = {
  active: 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)]',
  pending: 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)]',
  draft: 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]',
  deprecated: 'border-[rgba(251,191,36,0.45)] bg-[rgba(251,191,36,0.14)]',
  outdated: 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)]',
}

const STATUS_CHIP_TEXT: Record<KnowledgeLifecycleStatus, string> = {
  active: 'text-[var(--nx-status-success)]',
  pending: 'text-[var(--nx-status-warning)]',
  draft: 'text-[var(--nx-text-muted)]',
  deprecated: 'text-[var(--nx-chart-4)]',
  outdated: 'text-[var(--nx-status-danger)]',
}

export const KNOWLEDGE_STATUS_META: Record<KnowledgeLifecycleStatus, KnowledgeStatusMeta> = {
  draft: {
    status: 'draft',
    label: '草稿',
    description: '草稿 · 待 AI 结构化或人工完善',
    chipClass: `${STATUS_CHIP_BORDER_BG.draft} ${STATUS_CHIP_TEXT.draft}`,
  },
  pending: {
    status: 'pending',
    label: '待审',
    description: '待审 · 需人工确认转正后方可对外生效',
    chipClass: `${STATUS_CHIP_BORDER_BG.pending} ${STATUS_CHIP_TEXT.pending}`,
  },
  active: {
    status: 'active',
    label: '活跃',
    description: '活跃 · 可被正常检索引用',
    chipClass: `${STATUS_CHIP_BORDER_BG.active} ${STATUS_CHIP_TEXT.active}`,
  },
  deprecated: {
    status: 'deprecated',
    label: '已弃用',
    description: '已弃用 · 不再推荐引用',
    chipClass: `${STATUS_CHIP_BORDER_BG.deprecated} ${STATUS_CHIP_TEXT.deprecated}`,
  },
  outdated: {
    status: 'outdated',
    label: '已过时',
    description: '已过时 · 定期评审标记待复核',
    chipClass: `${STATUS_CHIP_BORDER_BG.outdated} ${STATUS_CHIP_TEXT.outdated}`,
  },
}

export const KNOWLEDGE_STATUS_OPTIONS: KnowledgeStatusMeta[] = KNOWLEDGE_LIFECYCLE_STATUSES.map(
  (status) => KNOWLEDGE_STATUS_META[status],
)

/** 未知状态回退。 */
export function statusMetaOf(status: string | undefined): KnowledgeStatusMeta | null {
  if (!status) return null
  return KNOWLEDGE_STATUS_META[status as KnowledgeLifecycleStatus] ?? null
}

// ── 生命周期推进目标（确定性白名单，与 @aiproj/types 状态机同源）──────

/**
 * 各状态可推进目标（排除 pending → active：该通道专属「确认转正」人工门，
 * 走 POST /knowledge/:id/confirm，禁止通过通用 transition 下拉直达）。
 * - draft → pending（提交候选）
 * - pending → draft（退回完善）
 * - active → deprecated / outdated
 * - deprecated → active（复核后恢复）
 * - outdated → active / deprecated
 */
export const KNOWLEDGE_TRANSITION_TARGETS: Record<
  KnowledgeLifecycleStatus,
  KnowledgeLifecycleStatus[]
> = {
  draft: ['pending'],
  pending: ['draft'],
  active: ['deprecated', 'outdated'],
  deprecated: ['active'],
  outdated: ['active', 'deprecated'],
}

/** 是否可「确认转正」（仅 pending 可走 confirm 人工门）。 */
export function canConfirmPromotion(status: KnowledgeLifecycleStatus): boolean {
  return status === 'pending'
}

/** 推进目标（白名单空数组 = 无推进出口）。 */
export function nextKnowledgeStatuses(
  status: KnowledgeLifecycleStatus,
): KnowledgeLifecycleStatus[] {
  return KNOWLEDGE_TRANSITION_TARGETS[status] ?? []
}

// ── 日期展示（UTC 日历日，确定性） ───────────────────────────────

/** ISO 时间串 → `YYYY-MM-DD`（UTC 日历日）；非法输入原样截断前 10 位。 */
export function formatKnowledgeDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

// ── 多条件复合过滤（纯函数） ─────────────────────────────────────

export interface KnowledgeItemFilters {
  /** 关键词模糊（标题/领域/用途/复杂度/来源标题；trim 后空串 = 不约束）。 */
  keyword?: string
  /** 层级多选（空数组/缺省 = 全部）。 */
  layers?: readonly KnowledgeLayer[]
  /** 状态多选（空数组/缺省 = 全部）。 */
  statuses?: readonly KnowledgeLifecycleStatus[]
  /** 领域精确收敛（trim 后空串 = 不约束；大小写不敏感精确匹配）。 */
  domain?: string
}

/**
 * 复合过滤：keyword 模糊 ∩ layers 多选 ∩ statuses 多选 ∩ domain 精确。
 * 所有维度的空值/缺省/空数组均视为「不约束」，天然支持整体重置。
 */
export function filterKnowledgeItems(
  items: readonly KnowledgeItemLowSensitiveProjection[],
  filters: KnowledgeItemFilters,
): KnowledgeItemLowSensitiveProjection[] {
  const keyword = (filters.keyword ?? '').trim().toLowerCase()
  const domain = (filters.domain ?? '').trim().toLowerCase()
  const layerSet =
    filters.layers && filters.layers.length > 0 ? new Set(filters.layers as KnowledgeLayer[]) : null
  const statusSet =
    filters.statuses && filters.statuses.length > 0
      ? new Set(filters.statuses as KnowledgeLifecycleStatus[])
      : null

  return items.filter((item) => {
    if (layerSet && !layerSet.has(item.layer)) return false
    if (statusSet && !statusSet.has(item.status)) return false
    if (domain && (item.domain ?? '').trim().toLowerCase() !== domain) return false
    if (keyword) {
      const sourceTitles =
        item.provenance?.sources?.map((source) => source.title ?? '').join(' ') ?? ''
      const haystack =
        `${item.title} ${item.domain} ${item.purpose} ${item.complexity ?? ''} ${sourceTitles}`.toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })
}

/** 过滤是否处于激活态（工具栏「重置筛选」可见性依据）。 */
export function hasActiveKnowledgeFilters(filters: KnowledgeItemFilters): boolean {
  return (
    (filters.keyword ?? '').trim() !== '' ||
    (filters.domain ?? '').trim() !== '' ||
    Boolean(filters.layers && filters.layers.length > 0) ||
    Boolean(filters.statuses && filters.statuses.length > 0)
  )
}

/** 当前组织知识条目去重后按 updatedAt 降序（最近更新在前）。 */
export function sortKnowledgeItemsByUpdatedAt(
  items: readonly KnowledgeItemLowSensitiveProjection[],
): KnowledgeItemLowSensitiveProjection[] {
  return [...items].sort((a, b) => {
    const at = new Date(a.updatedAt).getTime()
    const bt = new Date(b.updatedAt).getTime()
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0
    if (Number.isNaN(at)) return 1
    if (Number.isNaN(bt)) return -1
    return bt - at
  })
}
