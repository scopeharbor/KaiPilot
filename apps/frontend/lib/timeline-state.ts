import {
  CalendarClock,
  CheckCircle2,
  FileText,
  Flag,
  GitBranch,
  ListTodo,
  MessageSquare,
  Network,
  Paperclip,
  PieChart,
  Sparkles,
  TriangleAlert,
  Users,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import type { TimelineCategory, TimelineFilters, TimelineImportance } from '@/lib/api/timeline'

/** 全部合法 category（与后端 validator 白名单对齐）。 */
export const TIMELINE_CATEGORIES: TimelineCategory[] = [
  'project',
  'task',
  'wbs',
  'dependency',
  'gantt',
  'milestone',
  'risk',
  'change_request',
  'document',
  'attachment',
  'diagram',
  'report',
  'comment',
  'ai_draft',
  'draft_layer',
  'member',
  'other',
]

export const TIMELINE_IMPORTANCE: TimelineImportance[] = ['low', 'normal', 'high', 'critical']

type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'ai'

export interface CategoryMeta {
  label: string
  icon: LucideIcon
  badge: BadgeVariant
}

/** category → 中文标签 + 图标 + 语义色（事件卡片渲染）。 */
export const CATEGORY_META: Record<TimelineCategory, CategoryMeta> = {
  project: { label: '项目', icon: Flag, badge: 'primary' },
  task: { label: '任务', icon: ListTodo, badge: 'info' },
  wbs: { label: 'WBS', icon: Network, badge: 'info' },
  dependency: { label: '依赖', icon: GitBranch, badge: 'neutral' },
  gantt: { label: '甘特', icon: Waypoints, badge: 'info' },
  milestone: { label: '里程碑', icon: CheckCircle2, badge: 'success' },
  risk: { label: '风险', icon: TriangleAlert, badge: 'warning' },
  change_request: { label: '变更', icon: GitBranch, badge: 'warning' },
  document: { label: '文档', icon: FileText, badge: 'neutral' },
  attachment: { label: '附件', icon: Paperclip, badge: 'neutral' },
  diagram: { label: '图表', icon: PieChart, badge: 'neutral' },
  report: { label: '报表', icon: PieChart, badge: 'neutral' },
  comment: { label: '评论', icon: MessageSquare, badge: 'neutral' },
  ai_draft: { label: 'AI 草案', icon: Sparkles, badge: 'ai' },
  draft_layer: { label: 'AI 草案层', icon: Sparkles, badge: 'ai' },
  member: { label: '成员', icon: Users, badge: 'neutral' },
  other: { label: '其它', icon: CalendarClock, badge: 'neutral' },
}

export const IMPORTANCE_META: Record<TimelineImportance, { label: string; badge: BadgeVariant }> = {
  low: { label: '低', badge: 'neutral' },
  normal: { label: '一般', badge: 'neutral' },
  high: { label: '重要', badge: 'warning' },
  critical: { label: '关键', badge: 'danger' },
}

/**
 * 快捷筛选分组：把细粒度 category 归并成用户可理解的类型开关。
 */
export const CATEGORY_FILTER_GROUPS: {
  key: string
  label: string
  categories: TimelineCategory[]
}[] = [
  { key: 'task', label: '任务', categories: ['task', 'wbs', 'dependency', 'gantt'] },
  { key: 'milestone', label: '里程碑', categories: ['milestone'] },
  { key: 'risk', label: '风险', categories: ['risk'] },
  { key: 'change_request', label: '变更', categories: ['change_request'] },
  { key: 'comment', label: '评论', categories: ['comment'] },
  { key: 'file', label: '文件/报表', categories: ['document', 'attachment', 'diagram', 'report'] },
  { key: 'ai', label: 'AI 草案', categories: ['ai_draft', 'draft_layer'] },
]

function parseCategories(raw: string | null): TimelineCategory[] | undefined {
  if (!raw) return undefined
  const valid = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is TimelineCategory => (TIMELINE_CATEGORIES as string[]).includes(s))
  return valid.length > 0 ? valid : undefined
}

function parseImportance(raw: string | null): TimelineImportance[] | undefined {
  if (!raw) return undefined
  const valid = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is TimelineImportance => (TIMELINE_IMPORTANCE as string[]).includes(s))
  return valid.length > 0 ? valid : undefined
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 从 URL search params 解析筛选态；非法值被丢弃。 */
export function parseTimelineState(params: URLSearchParams): TimelineFilters {
  const filters: TimelineFilters = {}
  const categories = parseCategories(params.get('category'))
  if (categories) filters.categories = categories
  const importance = parseImportance(params.get('importance'))
  if (importance) filters.importance = importance
  if (params.get('keyOnly') === '1' || params.get('keyOnly') === 'true') filters.keyOnly = true
  if (params.get('relatedToMe') === '1' || params.get('relatedToMe') === 'true') {
    filters.relatedToMe = true
  }
  const search = params.get('search')?.trim()
  if (search) filters.search = search.slice(0, 100)
  const from = params.get('from')
  if (from && DATE_RE.test(from)) filters.from = from
  const to = params.get('to')
  if (to && DATE_RE.test(to)) filters.to = to
  return filters
}

/** 序列化筛选态为 URL query（默认值省略，保持链接干净）。 */
export function serializeTimelineState(filters: TimelineFilters): string {
  const params = new URLSearchParams()
  if (filters.categories && filters.categories.length > 0) {
    params.set('category', filters.categories.join(','))
  }
  if (filters.importance && filters.importance.length > 0) {
    params.set('importance', filters.importance.join(','))
  }
  if (filters.keyOnly) params.set('keyOnly', '1')
  if (filters.relatedToMe) params.set('relatedToMe', '1')
  if (filters.search) params.set('search', filters.search)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  return params.toString()
}

/** 是否设置了任一筛选（用于「筛选无结果」与「清除筛选」判断）。 */
export function hasActiveTimelineFilters(filters: TimelineFilters): boolean {
  return Boolean(
    (filters.categories && filters.categories.length) ||
    (filters.importance && filters.importance.length) ||
    filters.keyOnly ||
    filters.relatedToMe ||
    filters.search ||
    filters.from ||
    filters.to,
  )
}

/** 时间分组标签：今天/昨天/本周/更早（按天）。 */
export type TimelineGroupKey = 'today' | 'yesterday' | 'thisWeek' | 'earlier'

export const TIMELINE_GROUP_LABELS: Record<TimelineGroupKey, string> = {
  today: '今天',
  yesterday: '昨天',
  thisWeek: '本周',
  earlier: '更早',
}

/** 按发生时间把事件归入时间组（稳定倒序：today→earlier）。 */
export function groupKeyForDate(occurredAt: string, now: Date = new Date()): TimelineGroupKey {
  const d = new Date(occurredAt)
  if (Number.isNaN(d.getTime())) return 'earlier'
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000)
  // 本周起点（周一）
  const day = (startOfToday.getDay() + 6) % 7
  const startOfWeek = new Date(startOfToday.getTime() - day * 24 * 60 * 60 * 1000)

  if (d >= startOfToday) return 'today'
  if (d >= startOfYesterday) return 'yesterday'
  if (d >= startOfWeek) return 'thisWeek'
  return 'earlier'
}

export const TIMELINE_GROUP_ORDER: TimelineGroupKey[] = [
  'today',
  'yesterday',
  'thisWeek',
  'earlier',
]

/** 相对时间中文短语（与通知面板一致：刚刚 / N 分钟前 / …）。 */
export function formatRelativeTime(occurredAt: string, now: Date = new Date()): string {
  const date = new Date(occurredAt)
  if (Number.isNaN(date.getTime())) return ''
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diffSec < 60) return '刚刚'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} 小时前`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay} 天前`
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

/** 精确时钟（tooltip / 无障碍标签用）。 */
export function formatClockTime(occurredAt: string): string {
  const date = new Date(occurredAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
