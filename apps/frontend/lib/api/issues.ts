import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'

/** 议题分类（对齐后端 IssueType）。 */
export type IssueType = 'bug' | 'blocker' | 'technical' | 'process' | 'other'
/** 四级严重度。 */
export type IssueSeverity = 'critical' | 'major' | 'minor' | 'trivial'
/** 议题优先级。 */
export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low'
/** 状态机：open → in_progress → resolved / closed / rejected。 */
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'rejected'

/** 项目问题（对齐后端 Issue.serialize()）。 */
export interface Issue {
  id: number
  organizationId: number
  projectId: number
  relatedTaskId: number | null
  reportedBy: number
  assigneeId: number | null
  code: string
  title: string
  description: string | null
  type: IssueType
  severity: IssueSeverity
  priority: IssuePriority
  status: IssueStatus
  rootCause: string | null
  resolution: string | null
  resolvedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string | null
}

export interface PaginatedIssues {
  data: Issue[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface IssueListFilters {
  status?: IssueStatus
  severity?: IssueSeverity
  type?: IssueType
  priority?: IssuePriority
  assigneeId?: number
  page?: number
  perPage?: number
}

export interface CreateIssueInput {
  title: string
  description?: string | null
  type?: IssueType
  severity?: IssueSeverity
  priority?: IssuePriority
}

export interface ChangeIssueStatusInput {
  status: IssueStatus
  rootCause?: string | null
  resolution?: string | null
}

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  bug: '缺陷',
  blocker: '阻塞',
  technical: '技术债',
  process: '流程问题',
  other: '其他',
}

export const ISSUE_SEVERITY_LABELS: Record<IssueSeverity, string> = {
  critical: '致命',
  major: '严重',
  minor: '一般',
  trivial: '轻微',
}

export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
}

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
  rejected: '已驳回',
}

/** 与后端 IssueService.ALLOWED_TRANSITIONS 一致；仅用于提供合法选项，最终以后端校验为准。 */
export const ISSUE_STATUS_TRANSITIONS: Record<IssueStatus, readonly IssueStatus[]> = {
  open: ['in_progress', 'rejected'],
  in_progress: ['open', 'resolved', 'rejected'],
  resolved: ['closed', 'open'],
  closed: ['open'],
  rejected: ['open'],
}

function buildQuery(filters: IssueListFilters): string {
  const query = new URLSearchParams()
  if (filters.status) query.set('status', filters.status)
  if (filters.severity) query.set('severity', filters.severity)
  if (filters.type) query.set('type', filters.type)
  if (filters.priority) query.set('priority', filters.priority)
  if (filters.assigneeId) query.set('assigneeId', String(filters.assigneeId))
  if (filters.page) query.set('page', String(filters.page))
  if (filters.perPage) query.set('perPage', String(filters.perPage))
  return query.size ? `?${query.toString()}` : ''
}

const base = (projectId: number) => `/projects/${projectId}/issues`

export const issuesApi = {
  list: (projectId: number, filters: IssueListFilters = {}) =>
    apiFetchEnvelope<PaginatedIssues>(`${base(projectId)}${buildQuery(filters)}`),
  create: (projectId: number, input: CreateIssueInput) =>
    apiFetch<Issue>(base(projectId), { method: 'POST', body: JSON.stringify(input) }),
  changeStatus: (projectId: number, issueId: number, input: ChangeIssueStatusInput) =>
    apiFetch<Issue>(`${base(projectId)}/${issueId}/status`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
}

export const issueKeys = {
  all: ['issues'] as const,
  lists: (projectId: number) => [...issueKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: IssueListFilters = {}) =>
    [...issueKeys.lists(projectId), filters] as const,
}
