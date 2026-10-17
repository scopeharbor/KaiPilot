// OKR 组织级展示层纯函数适配器（v3-ui-next-org-portfolio-domains W2 · tasks 2.1，
// spec「OKR 层级管理与达成仪表盘（幽灵守卫修复）」）。
//
// 新轨 OKR 两页（/next/organization/okrs、/next/organization/okrs/dashboard）的
// 展示层纯函数底座：
// - 周期/目标/关键结果中文标签、状态徽标语义色映射（draft/active/paused/completed/
//   archived → `--nx-*` 既有令牌 rgba 展开，杜绝臆造令牌）；
// - 进度条带分段色阶（与 @aiproj/types OKR 进度分布五桶 <25%/25-49%/50-74%/75-99%/100%
//   同源）+ 数值文本双通道；KR 进度折算公式与 types 层 computeKrProgressPercent
//   语义一致（(current-baseline)/(target-baseline) 截断 0-100 取整）；
// - warning/freshness 标记：树 meta 警告码标签/徽标分档与「数据陈旧」中性提示，
//   相对时间格式化（供「计算于 X 分钟前」类新鲜度回显）；
// - 目标树扁平化行模型（objective/KR 双行型 + 深度缩进 + 展开态收敛 + 统计聚合）；
// - OKR 仪表盘分区标签（KPI 指标/警告码/关注原因/数据源）与受限指标判定/数值
//   格式化（RL-05 脱敏：受限仅中性占位，不猜数值）。
//
// 本文件为纯计算层：零网络、零 DOM、零 store 依赖。语义颜色类名均为确定性静态
// 字符串，Tailwind v4 自动内容扫描可拾取；rgba 展开值为令牌色值的固定透明度
// 展开（0.5 发丝边框 / 0.16 底色），色值来源与 app/(next)/next-tokens.css 实码
// 一一对应。
import type {
  OkrCycle,
  OkrCycleListResponse,
  OkrDashboardMetric,
  OkrDashboardMetricKey,
  OkrDashboardSource,
  OkrDashboardSourceFreshness,
  OkrDashboardSummary,
  OkrDashboardWarning,
  OkrDashboardWarningCode,
  OkrKeyResult,
  OkrObjective,
  OkrObjectiveTree,
  OkrScope,
  OkrStatus,
  OkrTreeResponse,
  OkrWarning,
  OkrWarningCode,
} from '@aiproj/types'
import {
  OKR_DASHBOARD_ATTENTION_REASONS,
  OKR_DASHBOARD_METRIC_KEYS,
  OKR_DASHBOARD_SECTIONS,
  OKR_DASHBOARD_WARNING_CODES,
  OKR_WARNING_CODES,
} from '@aiproj/types'

// ─── 周期标签 ──────────────────────────────────────────────────────────────

/** 周期未选择时的中文占位。 */
export const OKR_CYCLE_ALL_LABEL = '全部周期'

/** 周期条目标签（标题 + 状态短标签；状态未知仅回退标题）。 */
export function formatOkrCycleLabel(cycle: OkrCycle): string {
  const status = OKR_STATUS_LABELS[cycle.status]
  return status ? `${cycle.title}（${status}）` : cycle.title
}

/** 周期起止窗口文案（YYYY-MM-DD 起止；缺失侧以「—」占位）。 */
export function formatOkrCycleWindow(cycle: OkrCycle): string {
  return `${cycle.startDate} → ${cycle.endDate}`
}

// ─── 范围标签 ──────────────────────────────────────────────────────────────

/** OKR scope → 中文短标签。 */
export const OKR_SCOPE_LABELS: Record<OkrScope, string> = {
  organization: '组织',
  team: '团队',
  project: '项目',
  individual: '个人',
}

/** 范围筛选选项（含「全部范围」哨兵）。 */
export const OKR_SCOPE_FILTER_OPTIONS: ReadonlyArray<{ value: OkrScope | 'all'; label: string }> = [
  { value: 'all', label: '全部范围' },
  ...(Object.keys(OKR_SCOPE_LABELS) as OkrScope[]).map((scope) => ({
    value: scope,
    label: OKR_SCOPE_LABELS[scope],
  })),
]

// ─── 状态徽标映射（目标 / 周期 / KR 共用） ────────────────────────────────

/** OKR 状态 → 中文标签（与旧轨 `lib/okr-dashboard-ui.ts` OKR_STATUS_LABELS 同文案）。 */
export const OKR_STATUS_LABELS: Record<OkrStatus, string> = {
  draft: '草稿',
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
}

/** 状态徽标色板（令牌色 + 固定透明度展开；中性「进行中」语义绿对应旧轨绿徽标）。 */
const OKR_STATUS_TEXT: Record<OkrStatus, string> = {
  draft: 'text-[var(--nx-text-secondary)]',
  active: 'text-[var(--nx-status-success)]',
  paused: 'text-[var(--nx-status-warning)]',
  completed: 'text-[var(--nx-workspace-blue)]',
  archived: 'text-[var(--nx-text-muted)]',
}

const OKR_STATUS_BORDER_BG: Record<OkrStatus, string> = {
  draft: 'border-[rgba(148,163,184,0.5)] bg-[rgba(148,163,184,0.16)]',
  active: 'border-[rgba(16,185,129,0.5)] bg-[rgba(16,185,129,0.16)]',
  paused: 'border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.16)]',
  completed: 'border-[rgba(79,117,255,0.5)] bg-[rgba(79,117,255,0.16)]',
  archived: 'border-[rgba(122,139,161,0.5)] bg-[rgba(122,139,161,0.16)]',
}

export interface OkrStatusMeta {
  status: OkrStatus
  label: string
  /** 徽标语义色类名（text 令牌色 + 令牌色 rgba 展开 + 发丝线边框）。 */
  chipClass: string
}

/** OKR 状态全量映射（确定性纯常量）。 */
export const OKR_STATUS_META: Record<OkrStatus, OkrStatusMeta> = {
  draft: {
    status: 'draft',
    label: OKR_STATUS_LABELS.draft,
    chipClass: `${OKR_STATUS_BORDER_BG.draft} ${OKR_STATUS_TEXT.draft}`,
  },
  active: {
    status: 'active',
    label: OKR_STATUS_LABELS.active,
    chipClass: `${OKR_STATUS_BORDER_BG.active} ${OKR_STATUS_TEXT.active}`,
  },
  paused: {
    status: 'paused',
    label: OKR_STATUS_LABELS.paused,
    chipClass: `${OKR_STATUS_BORDER_BG.paused} ${OKR_STATUS_TEXT.paused}`,
  },
  completed: {
    status: 'completed',
    label: OKR_STATUS_LABELS.completed,
    chipClass: `${OKR_STATUS_BORDER_BG.completed} ${OKR_STATUS_TEXT.completed}`,
  },
  archived: {
    status: 'archived',
    label: OKR_STATUS_LABELS.archived,
    chipClass: `${OKR_STATUS_BORDER_BG.archived} ${OKR_STATUS_TEXT.archived}`,
  },
}

/** 状态筛选选项（含「全部状态」哨兵；归档目标仍可在树中回显但默认不进筛选菜单）。 */
export const OKR_STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: OkrStatus | 'all'; label: string }> =
  [
    { value: 'all', label: '全部状态' },
    { value: 'draft', label: OKR_STATUS_LABELS.draft },
    { value: 'active', label: OKR_STATUS_LABELS.active },
    { value: 'paused', label: OKR_STATUS_LABELS.paused },
    { value: 'completed', label: OKR_STATUS_LABELS.completed },
  ]

/** 未知状态回退。 */
export function okrStatusMetaOf(status: string | undefined): OkrStatusMeta | null {
  if (!status) return null
  return OKR_STATUS_META[status as OkrStatus] ?? null
}

/** scope 徽标类名（中性，低强调）。 */
export function okrScopeChipClass(scope: string | undefined): string {
  if (!scope || !(scope in OKR_SCOPE_LABELS)) return ''
  return 'border-[rgba(56,189,248,0.4)] bg-[rgba(56,189,248,0.1)] text-[var(--nx-accent)]'
}

// ─── 进度条带（0-100 分段色阶，双通道） ───────────────────────────────────

export type OkrProgressBandKey = 'lt25' | 'lt50' | 'lt75' | 'lt100' | 'done'

export interface OkrProgressBand {
  /** 与 @aiproj/types OKR 进度分布桶同键。 */
  key: OkrProgressBandKey
  /** 分段标签（<25% / 25-49% / 50-74% / 75-99% / 100%）。 */
  label: string
  min: number
  max: number
  /** 条带填充色类（语义色令牌 + rgba 展开）。 */
  fillClass: string
}

/**
 * 进度分段表：边界与 @aiproj/types okr-dashboard computeOkrDashboardSummary
 * progressBuckets 完全一致（lt25 0-24 / lt50 25-49 / lt75 50-74 / lt100 75-99 /
 * done 100-100）。色阶沿低→高取冷调 chart 系与状态色，低进度段用警示色，
 * 100% 用成功绿——颜色仅供快速扫描，真实语义永远以数值文本为准（双通道）。
 */
export const OKR_PROGRESS_BANDS: readonly OkrProgressBand[] = [
  { key: 'lt25', label: '<25%', min: 0, max: 24, fillClass: 'bg-[var(--nx-status-danger)]' },
  { key: 'lt50', label: '25-49%', min: 25, max: 49, fillClass: 'bg-[var(--nx-status-warning)]' },
  { key: 'lt75', label: '50-74%', min: 50, max: 74, fillClass: 'bg-[var(--nx-chart-1)]' },
  { key: 'lt100', label: '75-99%', min: 75, max: 99, fillClass: 'bg-[var(--nx-chart-3)]' },
  { key: 'done', label: '100%', min: 100, max: 100, fillClass: 'bg-[var(--nx-status-success)]' },
]

/**
 * 进度值 → 分段（0-100 之外的异常值回落最近的合法桶；null/NaN 返回 null）。
 */
export function okrProgressBandOf(progress: number | null | undefined): OkrProgressBand | null {
  if (progress === null || progress === undefined || Number.isNaN(progress)) return null
  const band = OKR_PROGRESS_BANDS.find((b) => progress >= b.min && progress <= b.max)
  if (band) return band
  return progress < 0 ? OKR_PROGRESS_BANDS[0]! : OKR_PROGRESS_BANDS[OKR_PROGRESS_BANDS.length - 1]!
}

/** 进度数值文本（null 回落「—」，不渲染猜测值）。 */
export function formatOkrProgressText(progress: number | null | undefined): string {
  if (progress === null || progress === undefined || Number.isNaN(progress)) return '—'
  return `${Math.round(progress)}%`
}

/**
 * KR 当前值 → 0-100 进度（语义与 @aiproj/types okr-dashboard computeKrProgressPercent
 * 一致：目标=基线时按 0 处理，clamp 0-100 后取整）。
 */
export function okrKeyResultProgress(kr: OkrKeyResult): number {
  if (kr.targetValue === kr.baselineValue) return 0
  const raw = ((kr.currentValue - kr.baselineValue) / (kr.targetValue - kr.baselineValue)) * 100
  return Math.max(0, Math.min(100, Math.round(raw)))
}

// ─── 相对时间 / 新鲜度 ─────────────────────────────────────────────────────

/** ISO 时间 → 中文相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）；null 回落「未知」。 */
export function formatOkrRelativeTime(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!iso) return '未知'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '未知'
  const diff = nowMs - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))} 小时前`
  return `${Math.floor(diff / (24 * 60 * 60_000))} 天前`
}

/** 树 meta 警告中与「数据陈旧/不可用」相关的码集合。 */
const OKR_STALE_RELATED_CODES: ReadonlySet<OkrWarningCode> = new Set<OkrWarningCode>([
  OKR_WARNING_CODES.STALE_EVIDENCE,
  OKR_WARNING_CODES.EVIDENCE_UNAVAILABLE,
  OKR_WARNING_CODES.CACHE_DEGRADED,
])

/** 「数据陈旧」中性提示文案（不泄露具体值）。 */
export const OKR_STALE_DATA_NOTICE = '部分目标或关键结果的证据已过期或不可用，数值仅供参考。'

/** 是否命中「数据陈旧」警告（命中时界面应挂中性提示条）。 */
export function hasOkrStaleWarning(warnings: readonly OkrWarning[] | undefined): boolean {
  if (!warnings || warnings.length === 0) return false
  return warnings.some((w) => OKR_STALE_RELATED_CODES.has(w.code))
}

// ─── 树 meta 警告码映射 ────────────────────────────────────────────────────

export type OkrWarningTone = 'neutral' | 'warning' | 'danger'

export interface OkrWarningMeta {
  code: OkrWarningCode
  /** 短标签（中性、无存在性暗示）。 */
  label: string
  tone: OkrWarningTone
  chipClass: string
}

const OKR_WARNING_TEXT: Record<OkrWarningTone, string> = {
  neutral: 'text-[var(--nx-text-secondary)]',
  warning: 'text-[var(--nx-status-warning)]',
  danger: 'text-[var(--nx-status-danger)]',
}

const OKR_WARNING_BORDER_BG: Record<OkrWarningTone, string> = {
  neutral: 'border-[rgba(148,163,184,0.5)] bg-[rgba(148,163,184,0.16)]',
  warning: 'border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.16)]',
  danger: 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.16)]',
}

function makeOkrWarningMeta(
  code: OkrWarningCode,
  label: string,
  tone: OkrWarningTone,
): OkrWarningMeta {
  return {
    code,
    label,
    tone,
    chipClass: `${OKR_WARNING_BORDER_BG[tone]} ${OKR_WARNING_TEXT[tone]}`,
  }
}

/** 树 meta 警告码 → 中文标签与徽标分档（全码覆盖，文案中性）。 */
export const OKR_TREE_WARNING_META: Record<OkrWarningCode, OkrWarningMeta> = {
  [OKR_WARNING_CODES.EMPTY_OKR_RESULT]: makeOkrWarningMeta(
    OKR_WARNING_CODES.EMPTY_OKR_RESULT,
    '空结果',
    'neutral',
  ),
  [OKR_WARNING_CODES.EMPTY_KEY_RESULTS]: makeOkrWarningMeta(
    OKR_WARNING_CODES.EMPTY_KEY_RESULTS,
    '关键结果为空',
    'neutral',
  ),
  [OKR_WARNING_CODES.RESTRICTED_CHILD]: makeOkrWarningMeta(
    OKR_WARNING_CODES.RESTRICTED_CHILD,
    '含受限子项',
    'warning',
  ),
  [OKR_WARNING_CODES.STALE_EVIDENCE]: makeOkrWarningMeta(
    OKR_WARNING_CODES.STALE_EVIDENCE,
    '证据过期',
    'warning',
  ),
  [OKR_WARNING_CODES.EVIDENCE_UNAVAILABLE]: makeOkrWarningMeta(
    OKR_WARNING_CODES.EVIDENCE_UNAVAILABLE,
    '证据不可用',
    'warning',
  ),
  [OKR_WARNING_CODES.CYCLE_DETECTED]: makeOkrWarningMeta(
    OKR_WARNING_CODES.CYCLE_DETECTED,
    '对齐环路',
    'danger',
  ),
  [OKR_WARNING_CODES.MAX_DEPTH_EXCEEDED]: makeOkrWarningMeta(
    OKR_WARNING_CODES.MAX_DEPTH_EXCEEDED,
    '超出最大深度',
    'warning',
  ),
  [OKR_WARNING_CODES.DUPLICATE_ALIGNMENT]: makeOkrWarningMeta(
    OKR_WARNING_CODES.DUPLICATE_ALIGNMENT,
    '重复对齐',
    'warning',
  ),
  [OKR_WARNING_CODES.DISABLED_SCOPE]: makeOkrWarningMeta(
    OKR_WARNING_CODES.DISABLED_SCOPE,
    '引用已禁用范围',
    'warning',
  ),
  [OKR_WARNING_CODES.CROSS_ORGANIZATION]: makeOkrWarningMeta(
    OKR_WARNING_CODES.CROSS_ORGANIZATION,
    '跨组织引用',
    'danger',
  ),
  [OKR_WARNING_CODES.INVALID_WEIGHT]: makeOkrWarningMeta(
    OKR_WARNING_CODES.INVALID_WEIGHT,
    '权重无效',
    'danger',
  ),
  [OKR_WARNING_CODES.INVALID_MEASUREMENT]: makeOkrWarningMeta(
    OKR_WARNING_CODES.INVALID_MEASUREMENT,
    '度量无效',
    'danger',
  ),
  [OKR_WARNING_CODES.AI_DRAFT_UNAVAILABLE]: makeOkrWarningMeta(
    OKR_WARNING_CODES.AI_DRAFT_UNAVAILABLE,
    'AI 草案不可用',
    'neutral',
  ),
  [OKR_WARNING_CODES.AI_CONTEXT_RESTRICTED]: makeOkrWarningMeta(
    OKR_WARNING_CODES.AI_CONTEXT_RESTRICTED,
    'AI 上下文受限',
    'warning',
  ),
  [OKR_WARNING_CODES.LARGE_TREE_TRUNCATED]: makeOkrWarningMeta(
    OKR_WARNING_CODES.LARGE_TREE_TRUNCATED,
    '大树已截断',
    'warning',
  ),
  [OKR_WARNING_CODES.CACHE_DEGRADED]: makeOkrWarningMeta(
    OKR_WARNING_CODES.CACHE_DEGRADED,
    '缓存降级',
    'warning',
  ),
}

/** 未知码回退（脏数据仍可中性呈现，不做存在性断言）。 */
export function okrWarningMetaOf(code: string | undefined): OkrWarningMeta | null {
  if (!code) return null
  return OKR_TREE_WARNING_META[code as OkrWarningCode] ?? null
}

// ─── 目标树扁平化行模型 ────────────────────────────────────────────────────

export type OkrTreeRowKind = 'objective' | 'key_result'

export interface OkrTreeRowModel {
  /** 稳定行键（objective 前缀 `o:`、key_result 前缀 `kr:`）。 */
  key: string
  kind: OkrTreeRowKind
  /** 层级深度（森林根 objective 为 0；其 KR 行与子 objective 为 depth+1）。 */
  depth: number
  objective: OkrObjective
  keyResult: OkrKeyResult | null
  /** 当前行是否可展开（objective 行：有子目标或 KR 时 true）。 */
  expandable: boolean
  /** 子目标数（不含 KR）。 */
  childObjectiveCount: number
  /** 直属 KR 数。 */
  keyResultCount: number
  /** 子树聚合：可见 objective 后代总数（不含自身）。 */
  descendantObjectiveCount: number
}

/** 行型目标树 meta 统计（整树聚合）。 */
export interface OkrTreeRowStats {
  objectiveCount: number
  keyResultCount: number
  /** 全部 objective 进度均值（无 objective 时为 null）。 */
  averageProgress: number | null
}

/**
 * cycles/tree hook 查询数据归一化。
 *
 * 数据层事实：lib/api/okr.ts 经 `apiFetch`（lib/api-client.ts 会把响应体 `{data,
 * meta}` 展开为 `body.data`）访问 GET /okrs/cycles 与 /okrs/tree；展开后 hook 数据
 * 为纯数组。声明契约（@aiproj/types OkrCycleListResponse/OkrTreeResponse）则保持
 * `{ data, meta }` 信封形态。两形态均可能来自既有数据层，本归一化对两形态做
 * 确定性收敛（数组 → 元素列表且 meta 缺省；信封 → 解包 data/meta），绝不猜测
 * 业务值；meta 不可得时上层自然降级为行内统计派生。
 */
export function okrCycleListOf(payload: OkrCycleListResponse | OkrCycle[] | undefined): OkrCycle[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.data ?? [])
}

export function okrCycleListMeta(payload: OkrCycleListResponse | OkrCycle[] | undefined) {
  if (!payload || Array.isArray(payload)) return undefined
  return payload.meta
}

export function okrTreeListOf(
  payload: OkrTreeResponse | OkrObjectiveTree[] | undefined,
): OkrObjectiveTree[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.data ?? [])
}

export function okrTreeMetaOf(payload: OkrTreeResponse | OkrObjectiveTree[] | undefined) {
  if (!payload || Array.isArray(payload)) return undefined
  return payload.meta
}

/** 行型目标树 meta 统计（整树聚合）。 */

/**
 * 目标树扁平化行模型（O 行 → 展开后直属 KR 行与子目标 O 行，宽度有限递归）。
 * expandedKeys 之外的 objective 不展开：其直属 KR 与其全部子目标 O 行均不产出；
 * 森林根 objective 恒可见（展开与否只决定其子树深度内容）。
 */
export function flattenOkrTreeRows(
  roots: readonly OkrObjectiveTree[],
  expandedKeys: ReadonlySet<number> = new Set(),
  depth = 0,
  rows: OkrTreeRowModel[] = [],
): OkrTreeRowModel[] {
  for (const node of roots) {
    const objective = node.objective
    const descendantObjectiveCount = countObjectiveNodes(node)
    rows.push({
      key: `o:${objective.id}`,
      kind: 'objective',
      depth,
      objective,
      keyResult: null,
      expandable: node.children.length > 0 || node.keyResults.length > 0,
      childObjectiveCount: node.children.length,
      keyResultCount: node.keyResults.length,
      descendantObjectiveCount,
    })
    if (!expandedKeys.has(objective.id)) continue
    for (const kr of node.keyResults) {
      rows.push({
        key: `kr:${kr.id}`,
        kind: 'key_result',
        depth: depth + 1,
        objective,
        keyResult: kr,
        expandable: false,
        childObjectiveCount: 0,
        keyResultCount: 0,
        descendantObjectiveCount: 0,
      })
    }
    flattenOkrTreeRows(node.children, expandedKeys, depth + 1, rows)
  }
  return rows
}

function countObjectiveNodes(node: OkrObjectiveTree): number {
  let count = 0
  for (const child of node.children) {
    count += 1 + countObjectiveNodes(child)
  }
  return count
}

/** 行模型树统计聚合（客观行数 + objective 平均进度）。 */
export function summarizeOkrTreeRows(rows: readonly OkrTreeRowModel[]): OkrTreeRowStats {
  let objectiveCount = 0
  let keyResultCount = 0
  let progressSum = 0
  for (const row of rows) {
    if (row.kind === 'objective') {
      objectiveCount += 1
      if (row.objective.progress !== null && !Number.isNaN(row.objective.progress)) {
        progressSum += row.objective.progress
      }
    } else {
      keyResultCount += 1
    }
  }
  return {
    objectiveCount,
    keyResultCount,
    averageProgress: objectiveCount === 0 ? null : Math.round(progressSum / objectiveCount),
  }
}

// ─── OKR 仪表盘分区（spec「达成仪表盘：sections 分区摘要卡片矩阵」） ──────

/** sections 白名单 → 中文卡标题（旧轨 OkrDashboard 各面板语义同源）。 */
export const OKR_DASHBOARD_SECTION_LABELS: Record<
  (typeof OKR_DASHBOARD_SECTIONS)[keyof typeof OKR_DASHBOARD_SECTIONS],
  string
> = {
  [OKR_DASHBOARD_SECTIONS.CYCLE_CONTEXT]: '周期上下文',
  [OKR_DASHBOARD_SECTIONS.KPI]: '关键指标',
  [OKR_DASHBOARD_SECTIONS.PROGRESS_DISTRIBUTION]: '进度分布',
  [OKR_DASHBOARD_SECTIONS.ATTENTION]: '关注项',
  [OKR_DASHBOARD_SECTIONS.ALIGNMENT_HEALTH]: '对齐健康度',
  [OKR_DASHBOARD_SECTIONS.EVIDENCE_FRESHNESS]: '证据新鲜度',
  [OKR_DASHBOARD_SECTIONS.BACKFLOW]: '进度回流',
}

export type OkrDashboardSectionKey = keyof typeof OKR_DASHBOARD_SECTION_LABELS

/** KPI 指标 key → 中文标签（全量 18 键，文案与旧轨 OKR_METRIC_LABELS 同源）。 */
export const OKR_DASHBOARD_METRIC_LABELS: Record<OkrDashboardMetricKey, string> = {
  okr_total_objectives: '目标总数',
  okr_active_objectives: '进行中的目标',
  okr_completed_objectives: '已完成目标',
  okr_at_risk_objectives: '风险目标',
  okr_behind_objectives: '进度落后目标',
  okr_total_key_results: '关键结果总数',
  okr_behind_key_results: '进度落后关键结果',
  okr_stale_key_results: '新鲜度过期关键结果',
  okr_missing_evidence_key_results: '缺证据关键结果',
  okr_overall_progress_avg: '平均进度',
  okr_confidence_avg: '平均信心分',
  okr_alignment_health_score: '对齐健康度',
  okr_orphan_objective_count: '孤立目标',
  okr_weak_alignment_count: '弱对齐',
  okr_stale_evidence_count: '过期证据',
  okr_recent_progress_count: '最近进度事件',
  okr_backflow_candidate_count: '回流候选',
  okr_backflow_conflict_count: '回流冲突',
}

/** 顶部 KPI 卡固定顺序（活跃目标 → 风险目标 → 落后 KR → 平均进度）。 */
export const OKR_DASHBOARD_KPI_ORDER: readonly OkrDashboardMetricKey[] = [
  OKR_DASHBOARD_METRIC_KEYS.ACTIVE_OBJECTIVES,
  OKR_DASHBOARD_METRIC_KEYS.AT_RISK_OBJECTIVES,
  OKR_DASHBOARD_METRIC_KEYS.BEHIND_KEY_RESULTS,
  OKR_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
]

/** 仪表盘 KPI 卡 KPI 选区（按固定顺序取白名单键）。 */
export function selectOkrDashboardKpis(
  summary: OkrDashboardSummary | undefined,
): OkrDashboardMetric[] {
  if (!summary) return []
  const byKey = new Map(summary.kpis.map((metric) => [metric.key, metric]))
  const out: OkrDashboardMetric[] = []
  for (const key of OKR_DASHBOARD_KPI_ORDER) {
    const metric = byKey.get(key)
    if (metric) out.push(metric)
  }
  return out
}

/** 指标受限判定（null 值 / forbidden / unavailable → 中性「不可见」，RL-05）。 */
export function isOkrMetricRedacted(metric: OkrDashboardMetric): boolean {
  return metric.value === null || metric.status === 'forbidden' || metric.status === 'unavailable'
}

/** 受限指标中性文案（只表达无权限/不可用，绝不猜数值）。 */
export const OKR_METRIC_REDACTED_TEXT = '不可见'

/** 指标数值格式化（count/percent/score/avg；受限回落中性占位）。 */
export function formatOkrMetricValue(metric: OkrDashboardMetric): string {
  if (isOkrMetricRedacted(metric)) return OKR_METRIC_REDACTED_TEXT
  const value = metric.value as number
  switch (metric.unit) {
    case 'percent':
      return `${Math.round(value)}%`
    case 'score':
      return value.toFixed(1)
    case 'avg':
      return value.toFixed(1)
    case 'count':
      return String(value)
    default:
      return String(value)
  }
}

/** 仪表盘警告码 → 中文标签（全码覆盖，文案与旧轨 OKR_WARNING_LABELS 同源）。 */
export const OKR_DASHBOARD_WARNING_LABELS: Record<OkrDashboardWarningCode, string> = {
  [OKR_DASHBOARD_WARNING_CODES.EMPTY_OKR_DASHBOARD]: '当前周期内暂无可见目标',
  [OKR_DASHBOARD_WARNING_CODES.PERMISSION_REDACTED]: '部分指标因权限被脱敏',
  [OKR_DASHBOARD_WARNING_CODES.SOURCE_STALE]: '数据来源已过期',
  [OKR_DASHBOARD_WARNING_CODES.SOURCE_PARTIAL]: '数据来源仅返回部分结果',
  [OKR_DASHBOARD_WARNING_CODES.SOURCE_UNAVAILABLE]: '数据来源不可用',
  [OKR_DASHBOARD_WARNING_CODES.BACKFLOW_SUMMARY_UNAVAILABLE]: '进度回流摘要暂不可用',
  [OKR_DASHBOARD_WARNING_CODES.BACKFLOW_SUMMARY_FORBIDDEN]: '当前角色无进度回流查看权限',
  [OKR_DASHBOARD_WARNING_CODES.RESTRICTED_EVIDENCE]: '存在受限证据未展示',
  [OKR_DASHBOARD_WARNING_CODES.ATTENTION_TRUNCATED]: '关注项已按上限截断',
  [OKR_DASHBOARD_WARNING_CODES.ORPHAN_OBJECTIVE]: '存在孤立目标',
  [OKR_DASHBOARD_WARNING_CODES.WEAK_ALIGNMENT]: '存在弱对齐关系',
  [OKR_DASHBOARD_WARNING_CODES.DISABLED_SCOPE_REFERENCED]: '有指向已禁用范围的对齐',
  [OKR_DASHBOARD_WARNING_CODES.CACHE_DEGRADED]: '缓存降级读取',
}

/** 仪表盘警告码 → 徽标 tone（与树警告同色板）。 */
export function okrDashboardWarningTone(code: OkrDashboardWarningCode): OkrWarningTone {
  switch (code) {
    case OKR_DASHBOARD_WARNING_CODES.ORPHAN_OBJECTIVE:
    case OKR_DASHBOARD_WARNING_CODES.WEAK_ALIGNMENT:
    case OKR_DASHBOARD_WARNING_CODES.SOURCE_STALE:
    case OKR_DASHBOARD_WARNING_CODES.SOURCE_PARTIAL:
    case OKR_DASHBOARD_WARNING_CODES.SOURCE_UNAVAILABLE:
    case OKR_DASHBOARD_WARNING_CODES.CACHE_DEGRADED:
    case OKR_DASHBOARD_WARNING_CODES.ATTENTION_TRUNCATED:
    case OKR_DASHBOARD_WARNING_CODES.RESTRICTED_EVIDENCE:
    case OKR_DASHBOARD_WARNING_CODES.DISABLED_SCOPE_REFERENCED:
      return 'warning'
    case OKR_DASHBOARD_WARNING_CODES.BACKFLOW_SUMMARY_FORBIDDEN:
    case OKR_DASHBOARD_WARNING_CODES.PERMISSION_REDACTED:
      return 'danger'
    default:
      return 'neutral'
  }
}

/** 仪表盘警告 chip 类名（复用树警告色板工具）。 */
export function okrDashboardWarningChipClass(warning: OkrDashboardWarning): string {
  const tone = okrDashboardWarningTone(warning.code)
  return `${OKR_WARNING_BORDER_BG[tone]} ${OKR_WARNING_TEXT[tone]}`
}

/** 仪表盘警告 → 行内文案（code 有标签用标签，否则回落后端 message）。 */
export function formatOkrDashboardWarning(warning: OkrDashboardWarning): string {
  return OKR_DASHBOARD_WARNING_LABELS[warning.code] ?? warning.message ?? '未知警告'
}

/** 关注原因 → 中文标签（旧轨 OKR_ATTENTION_REASON_LABELS 同源）。 */
export const OKR_ATTENTION_REASON_LABELS: Record<
  (typeof OKR_DASHBOARD_ATTENTION_REASONS)[keyof typeof OKR_DASHBOARD_ATTENTION_REASONS],
  string
> = {
  [OKR_DASHBOARD_ATTENTION_REASONS.BEHIND_TARGET]: '进度落后目标',
  [OKR_DASHBOARD_ATTENTION_REASONS.STALE_EVIDENCE]: '证据过期',
  [OKR_DASHBOARD_ATTENTION_REASONS.MISSING_KEY_RESULTS]: '缺少关键结果',
  [OKR_DASHBOARD_ATTENTION_REASONS.WEAK_ALIGNMENT]: '弱对齐',
  [OKR_DASHBOARD_ATTENTION_REASONS.BLOCKED_PROGRESS]: '进度受阻',
  [OKR_DASHBOARD_ATTENTION_REASONS.LOW_CONFIDENCE]: '信心不足',
  [OKR_DASHBOARD_ATTENTION_REASONS.BACKFLOW_UNAVAILABLE]: '回流不可用',
}

/** 数据源 kind → 中文短标签。 */
export const OKR_DASHBOARD_SOURCE_LABELS: Record<OkrDashboardSource, string> = {
  okr_cycle: '周期',
  okr_objective: '目标',
  okr_key_result: '关键结果',
  okr_alignment: '对齐',
  okr_evidence: '证据',
  okr_progress_history: '进度历史',
  okr_backflow: '回流',
  computed: '计算源',
}

/** 数据源新鲜度 → 陈旧中性提示（无具体数值）。 */
export function formatOkrSourceFreshness(source: OkrDashboardSourceFreshness): string {
  const label = OKR_DASHBOARD_SOURCE_LABELS[source.source] ?? source.source
  if (source.isStale) return `${label}数据已过期`
  return `${label}数据正常`
}

/** 关注原因标签（未知回落原文）。 */
export function okrAttentionReasonLabel(reason: string): string {
  return (
    OKR_ATTENTION_REASON_LABELS[
      reason as (typeof OKR_DASHBOARD_ATTENTION_REASONS)[keyof typeof OKR_DASHBOARD_ATTENTION_REASONS]
    ] ?? reason
  )
}
