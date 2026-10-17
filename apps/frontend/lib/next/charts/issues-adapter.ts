/**
 * 议题与变更追踪数据适配器（v3-chart-gallery-tier2-governance-matrices W1 · task 1.4）。
 *
 * 职责：
 * 1. 纯函数解析后端议题列表信封 `PaginatedIssues`；
 * 2. 装配状态分组度量卡模型（open/in_progress/resolved/closed/rejected）；
 * 3. 装配严重度分布统计模型（critical/major/minor/trivial）；
 * 4. 映射业务编号（ISS-NNN）、严重度与状态徽标；
 * 5. 提供类型与严重度本地筛选辅助函数；
 * 6. 恪守 DOM 中性规范，零惊恐词汇；
 * 7. 处理无议题记录时的空态安全降级。
 */
import type {
  Issue,
  IssuePriority,
  IssueSeverity,
  IssueStatus,
  IssueType,
  PaginatedIssues,
} from '@/lib/api/issues'
import {
  ISSUE_PRIORITY_LABELS,
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
  ISSUE_TYPE_LABELS,
} from '@/lib/api/issues'

export interface IssueRowViewModel {
  id: number
  code: string
  title: string
  description: string | null
  type: IssueType
  typeLabel: string
  severity: IssueSeverity
  severityLabel: string
  severityClassName: string
  priority: IssuePriority
  priorityLabel: string
  priorityClassName: string
  status: IssueStatus
  statusLabel: string
  statusClassName: string
  createdAt: string
  createdAtFormatted: string
  resolvedAt: string | null
  resolution: string | null
}

export interface IssuesStatusCounts {
  open: number
  in_progress: number
  resolved: number
  closed: number
  rejected: number
}

export interface IssuesSeverityCounts {
  critical: number
  major: number
  minor: number
  trivial: number
}

export interface IssuesViewModel {
  totalCount: number
  statusCounts: IssuesStatusCounts
  severityCounts: IssuesSeverityCounts
  rows: IssueRowViewModel[]
  isEmpty: boolean
}

export const ISSUE_SEVERITY_BADGES: Record<IssueSeverity, { className: string }> = {
  critical: {
    className: 'bg-rose-500/15 text-rose-300 border border-rose-500/30 font-semibold',
  },
  major: {
    className: 'bg-amber-500/15 text-amber-300 border border-amber-500/30 font-medium',
  },
  minor: {
    className: 'bg-blue-500/15 text-blue-300 border border-blue-500/30 font-normal',
  },
  trivial: {
    className: 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30 font-normal',
  },
}

export const ISSUE_STATUS_BADGES: Record<IssueStatus, { className: string }> = {
  open: {
    className: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
  },
  in_progress: {
    className: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30',
  },
  resolved: {
    className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  },
  closed: {
    className: 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30',
  },
  rejected: {
    className: 'bg-zinc-600/15 text-zinc-400 border border-zinc-600/30',
  },
}

export const ISSUE_PRIORITY_BADGES: Record<IssuePriority, { className: string }> = {
  urgent: {
    className: 'text-rose-400 font-medium',
  },
  high: {
    className: 'text-amber-400 font-medium',
  },
  medium: {
    className: 'text-zinc-300',
  },
  low: {
    className: 'text-zinc-500',
  },
}

export function formatCreatedAt(isoString: string): string {
  if (!isoString) return '-'
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return isoString
  }
}

export function formatIssueRow(issue: Issue): IssueRowViewModel {
  const severityCfg = ISSUE_SEVERITY_BADGES[issue.severity] || ISSUE_SEVERITY_BADGES.minor
  const statusCfg = ISSUE_STATUS_BADGES[issue.status] || ISSUE_STATUS_BADGES.open
  const priorityCfg = ISSUE_PRIORITY_BADGES[issue.priority] || ISSUE_PRIORITY_BADGES.medium

  return {
    id: issue.id,
    code: issue.code || `ISS-${String(issue.id).padStart(3, '0')}`,
    title: issue.title,
    description: issue.description,
    type: issue.type,
    typeLabel: ISSUE_TYPE_LABELS[issue.type] || issue.type,
    severity: issue.severity,
    severityLabel: ISSUE_SEVERITY_LABELS[issue.severity] || issue.severity,
    severityClassName: severityCfg.className,
    priority: issue.priority,
    priorityLabel: ISSUE_PRIORITY_LABELS[issue.priority] || issue.priority,
    priorityClassName: priorityCfg.className,
    status: issue.status,
    statusLabel: ISSUE_STATUS_LABELS[issue.status] || issue.status,
    statusClassName: statusCfg.className,
    createdAt: issue.createdAt,
    createdAtFormatted: formatCreatedAt(issue.createdAt),
    resolvedAt: issue.resolvedAt,
    resolution: issue.resolution,
  }
}

/**
 * 构建议题与变更追踪视图模型纯函数。
 */
export function buildIssuesViewModel(
  data: PaginatedIssues | { data: Issue[] } | Issue[] | null | undefined,
): IssuesViewModel {
  const list: Issue[] = Array.isArray(data)
    ? data
    : data && Array.isArray((data as PaginatedIssues).data)
      ? (data as PaginatedIssues).data
      : []

  const statusCounts: IssuesStatusCounts = {
    open: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
    rejected: 0,
  }

  const severityCounts: IssuesSeverityCounts = {
    critical: 0,
    major: 0,
    minor: 0,
    trivial: 0,
  }

  const rows: IssueRowViewModel[] = list.map((issue) => {
    if (issue.status in statusCounts) {
      statusCounts[issue.status]++
    }
    if (issue.severity in severityCounts) {
      severityCounts[issue.severity]++
    }
    return formatIssueRow(issue)
  })

  return {
    totalCount: rows.length,
    statusCounts,
    severityCounts,
    rows,
    isEmpty: rows.length === 0,
  }
}

/**
 * 本地多维筛选辅助函数。
 */
export function filterIssueRows(
  rows: IssueRowViewModel[],
  filters: { type?: IssueType | 'all'; severity?: IssueSeverity | 'all' },
): IssueRowViewModel[] {
  return rows.filter((r) => {
    if (filters.type && filters.type !== 'all' && r.type !== filters.type) {
      return false
    }
    if (filters.severity && filters.severity !== 'all' && r.severity !== filters.severity) {
      return false
    }
    return true
  })
}
