'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, FolderOpen, Plus } from 'lucide-react'
import {
  issuesApi,
  issueKeys,
  ISSUE_PRIORITY_LABELS,
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
  ISSUE_STATUS_TRANSITIONS,
  ISSUE_TYPE_LABELS,
  type CreateIssueInput,
  type Issue,
  type IssuePriority,
  type IssueSeverity,
  type IssueStatus,
  type IssueType,
} from '@/lib/api/issues'
import { projectKeys, projectsApi, type Project } from '@/lib/api/projects'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { NEW_PROJECT_CREATE_HREF } from '@/lib/next/org-risk-global/global-risk-adapter'
import { cn } from '@/lib/utils'

/**
 * 项目问题工作台（新轨 /next/risks「项目问题」tab 的真实 CRUD 面板）。
 *
 * 能力对齐旧轨 /risks（5700d5f6）：项目选择 → 问题清单（状态筛选）→ 登记 →
 * 状态机流转（open → in_progress → resolved/closed/rejected）；resolved 必须回填
 * 根因与措施（后端状态机守卫，前端同样置灰拦截，不依赖服务端报错兜底）。
 *
 * - 数据源：`/projects/:projectId/issues`（issuesApi），写操作全部经二次确认/显式提交；
 * - 新轨仪器感样式（--nx-* 令牌），弹层接入 useDialogA11y（Escape/焦点归还）。
 */

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

const SEVERITY_TONE: Record<IssueSeverity, string> = {
  critical: 'text-[var(--nx-status-danger)]',
  major: 'text-[var(--nx-status-warning)]',
  minor: 'text-[var(--nx-text-secondary)]',
  trivial: 'text-[var(--nx-text-muted)]',
}

const selectClass =
  'h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] outline-none focus:border-[var(--nx-border-focus)]'

export interface IssueWorkbenchProps {
  organizationId: number
}

export function IssueWorkbench({ organizationId }: IssueWorkbenchProps) {
  const [selectedProjectId, setSelectedProjectId] = React.useState<number | null>(null)

  const projects = useQuery({
    queryKey: projectKeys.list(organizationId, { perPage: 50 }),
    queryFn: () => projectsApi.list({ perPage: 50 }),
    enabled: organizationId != null,
  })

  if (projects.isLoading) {
    return (
      <div data-issue-workbench-loading className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2].map((k) => (
          <div
            key={k}
            className="h-10 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          />
        ))}
      </div>
    )
  }

  if (projects.isError) {
    return (
      <div
        data-issue-workbench-error
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3 text-xs text-[var(--nx-status-danger)]"
      >
        项目列表加载失败：{errorMessage(projects.error)}
      </div>
    )
  }

  const projectList: Project[] = projects.data?.data ?? []
  if (projectList.length === 0) {
    return (
      <div
        data-issue-workbench-empty-projects
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-8 text-center"
      >
        <FolderOpen className="h-5 w-5 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-xs text-[var(--nx-text-secondary)]">还没有项目</p>
        <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
          创建项目后，即可在项目内登记与跟进问题清单。
        </p>
        <a
          href={NEW_PROJECT_CREATE_HREF}
          className="mt-1 inline-flex h-7 items-center rounded-md border border-[var(--nx-border-focus)] px-3 text-xs text-[var(--nx-accent)] hover:bg-[var(--nx-bg-0)]"
        >
          去创建项目
        </a>
      </div>
    )
  }

  const projectId = selectedProjectId ?? projectList[0]!.id

  return (
    <div data-issue-workbench className="flex flex-col gap-3">
      <label className="flex w-fit items-center gap-2 text-xs text-[var(--nx-text-muted)]">
        项目
        <select
          aria-label="选择项目"
          data-issue-project-select
          className={selectClass}
          value={projectId}
          onChange={(event) => setSelectedProjectId(Number(event.target.value))}
        >
          {projectList.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <IssueList key={projectId} projectId={projectId} />
    </div>
  )
}

function IssueList({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = React.useState<IssueStatus | 'all'>('all')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [resolving, setResolving] = React.useState<Issue | null>(null)

  const filters = statusFilter === 'all' ? { perPage: 100 } : { status: statusFilter, perPage: 100 }
  const issues = useQuery({
    queryKey: issueKeys.list(projectId, filters),
    queryFn: () => issuesApi.list(projectId, filters),
  })

  const statusMutation = useMutation({
    mutationFn: (input: {
      issue: Issue
      status: IssueStatus
      rootCause?: string
      resolution?: string
    }) =>
      issuesApi.changeStatus(projectId, input.issue.id, {
        status: input.status,
        rootCause: input.rootCause,
        resolution: input.resolution,
      }),
    onSuccess: () => {
      setResolving(null)
      void queryClient.invalidateQueries({ queryKey: issueKeys.lists(projectId) })
    },
  })

  const handleStatusChange = (issue: Issue, status: IssueStatus) => {
    if (status === 'resolved') {
      statusMutation.reset()
      setResolving(issue)
      return
    }
    statusMutation.mutate({ issue, status })
  }

  const rows = issues.data?.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="问题状态筛选"
          data-issue-status-filter
          className={selectClass}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as IssueStatus | 'all')}
        >
          <option value="all">全部状态</option>
          {(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((status) => (
            <option key={status} value={status}>
              {ISSUE_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {issues.data ? (
          <span className="text-[11px] text-[var(--nx-text-muted)]">
            共 {issues.data.meta.total} 条
          </span>
        ) : null}
        <button
          type="button"
          data-issue-create-open
          onClick={() => setCreateOpen(true)}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-accent)] transition-colors hover:bg-[var(--nx-space-surface)]"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          登记问题
        </button>
      </div>

      {statusMutation.isError && !resolving ? (
        <div
          data-issue-status-error
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3 text-xs text-[var(--nx-status-danger)]"
        >
          {errorMessage(statusMutation.error)}
        </div>
      ) : null}

      {issues.isLoading ? (
        <div data-issue-list-loading className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((k) => (
            <div
              key={k}
              className="h-10 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            />
          ))}
        </div>
      ) : issues.isError ? (
        <div
          data-issue-list-error
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3 text-xs text-[var(--nx-status-danger)]"
        >
          问题清单加载失败：{errorMessage(issues.error)}
        </div>
      ) : rows.length === 0 ? (
        <div
          data-issue-list-empty
          className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-8 text-center"
        >
          <AlertCircle className="h-5 w-5 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs text-[var(--nx-text-secondary)]">暂无项目问题</p>
          <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            把已经发生、正在阻塞目标的事实登记为问题，指定严重度并跟进到解决。
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--nx-border-hairline)]">
          <table className="w-full text-left text-xs" data-issue-table>
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)] text-[11px] text-[var(--nx-text-muted)]">
                <th className="px-3 py-2 font-medium">编号</th>
                <th className="px-3 py-2 font-medium">标题</th>
                <th className="px-3 py-2 font-medium">分类</th>
                <th className="px-3 py-2 font-medium">严重度</th>
                <th className="px-3 py-2 font-medium">优先级</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">登记时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((issue) => (
                <tr
                  key={issue.id}
                  data-issue-row={issue.id}
                  className="border-b border-[var(--nx-border-hairline)] last:border-0"
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--nx-text-muted)]">
                    {issue.code}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-[var(--nx-text-primary)]">{issue.title}</div>
                    {issue.resolution ? (
                      <div className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
                        措施：{issue.resolution}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-[var(--nx-text-secondary)]">
                    {ISSUE_TYPE_LABELS[issue.type] ?? issue.type}
                  </td>
                  <td className={cn('px-3 py-2', SEVERITY_TONE[issue.severity])}>
                    {ISSUE_SEVERITY_LABELS[issue.severity] ?? issue.severity}
                  </td>
                  <td className="px-3 py-2 text-[var(--nx-text-secondary)]">
                    {ISSUE_PRIORITY_LABELS[issue.priority] ?? issue.priority}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`变更 ${issue.code} 状态`}
                      data-issue-status-select={issue.id}
                      className={selectClass}
                      value={issue.status}
                      disabled={statusMutation.isPending}
                      onChange={(event) =>
                        handleStatusChange(issue, event.target.value as IssueStatus)
                      }
                    >
                      <option value={issue.status}>{ISSUE_STATUS_LABELS[issue.status]}</option>
                      {(ISSUE_STATUS_TRANSITIONS[issue.status] ?? []).map((next) => (
                        <option key={next} value={next}>
                          → {ISSUE_STATUS_LABELS[next]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[var(--nx-text-muted)]">
                    {issue.createdAt?.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateIssueDialog projectId={projectId} open={createOpen} onOpenChange={setCreateOpen} />

      <ResolveIssueDialog
        issue={resolving}
        pending={statusMutation.isPending}
        error={statusMutation.isError ? errorMessage(statusMutation.error) : null}
        onCancel={() => setResolving(null)}
        onConfirm={(rootCause, resolution) =>
          resolving &&
          statusMutation.mutate({ issue: resolving, status: 'resolved', rootCause, resolution })
        }
      />
    </div>
  )
}

const dialogShellClass =
  'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-5 shadow-2xl outline-none'

function DialogBackdrop({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]">{children}</div>
}

function CreateIssueDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [type, setType] = React.useState<IssueType>('blocker')
  const [severity, setSeverity] = React.useState<IssueSeverity>('major')
  const [priority, setPriority] = React.useState<IssuePriority>('medium')

  useDialogA11y({ ref: dialogRef, open, onClose: () => onOpenChange(false) })

  const createMutation = useMutation({
    mutationFn: (input: CreateIssueInput) => issuesApi.create(projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: issueKeys.lists(projectId) })
      setTitle('')
      setDescription('')
      onOpenChange(false)
    },
  })

  if (!open) return null

  return (
    <DialogBackdrop>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="登记项目问题"
        tabIndex={-1}
        data-issue-create-dialog
        className={dialogShellClass}
      >
        <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">登记项目问题</h3>
        <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
          记录已经发生、正在阻塞项目目标的事实，编号自动生成。
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
            标题
            <input
              id="issue-title"
              maxLength={255}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-primary)] outline-none focus:border-[var(--nx-border-focus)]"
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
              分类
              <select
                id="issue-type"
                className={selectClass}
                value={type}
                onChange={(event) => setType(event.target.value as IssueType)}
              >
                {(Object.keys(ISSUE_TYPE_LABELS) as IssueType[]).map((value) => (
                  <option key={value} value={value}>
                    {ISSUE_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
              严重度
              <select
                id="issue-severity"
                className={selectClass}
                value={severity}
                onChange={(event) => setSeverity(event.target.value as IssueSeverity)}
              >
                {(Object.keys(ISSUE_SEVERITY_LABELS) as IssueSeverity[]).map((value) => (
                  <option key={value} value={value}>
                    {ISSUE_SEVERITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
              优先级
              <select
                id="issue-priority"
                className={selectClass}
                value={priority}
                onChange={(event) => setPriority(event.target.value as IssuePriority)}
              >
                {(Object.keys(ISSUE_PRIORITY_LABELS) as IssuePriority[]).map((value) => (
                  <option key={value} value={value}>
                    {ISSUE_PRIORITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
            描述（可选）
            <textarea
              id="issue-description"
              rows={3}
              maxLength={10000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-2 text-xs text-[var(--nx-text-primary)] outline-none focus:border-[var(--nx-border-focus)]"
            />
          </label>
          {createMutation.isError ? (
            <div
              data-issue-create-error
              className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-xs text-[var(--nx-status-danger)]"
            >
              {errorMessage(createMutation.error)}
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-7 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)]"
          >
            取消
          </button>
          <button
            type="button"
            data-issue-create-confirm
            disabled={!title.trim() || createMutation.isPending}
            onClick={() =>
              createMutation.mutate({
                title: title.trim(),
                description: description.trim() || null,
                type,
                severity,
                priority,
              })
            }
            className="h-7 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMutation.isPending ? '提交中…' : '确认登记'}
          </button>
        </div>
      </div>
    </DialogBackdrop>
  )
}

function ResolveIssueDialog({
  issue,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  issue: Issue | null
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (rootCause: string, resolution: string) => void
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const [rootCause, setRootCause] = React.useState('')
  const [resolution, setResolution] = React.useState('')

  useDialogA11y({ ref: dialogRef, open: issue !== null, onClose: onCancel })

  React.useEffect(() => {
    setRootCause('')
    setResolution('')
  }, [issue])

  if (!issue) return null

  const canConfirm = rootCause.trim().length > 0 && resolution.trim().length > 0 && !pending

  return (
    <DialogBackdrop>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`解决问题 ${issue.code}`}
        tabIndex={-1}
        data-issue-resolve-dialog
        className={dialogShellClass}
      >
        <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">解决问题 {issue.code}</h3>
        <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
          标记为已解决必须回填根因与解决措施，便于复盘与知识沉淀。
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
            根因
            <textarea
              id="issue-root-cause"
              rows={2}
              maxLength={5000}
              value={rootCause}
              onChange={(event) => setRootCause(event.target.value)}
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-2 text-xs text-[var(--nx-text-primary)] outline-none focus:border-[var(--nx-border-focus)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
            解决措施
            <textarea
              id="issue-resolution"
              rows={2}
              maxLength={5000}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-2 text-xs text-[var(--nx-text-primary)] outline-none focus:border-[var(--nx-border-focus)]"
            />
          </label>
          {error ? (
            <div
              data-issue-resolve-error
              className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-xs text-[var(--nx-status-danger)]"
            >
              {error}
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-7 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)]"
          >
            取消
          </button>
          <button
            type="button"
            data-issue-resolve-confirm
            disabled={!canConfirm}
            onClick={() => onConfirm(rootCause.trim(), resolution.trim())}
            className="h-7 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '提交中…' : '确认解决'}
          </button>
        </div>
      </div>
    </DialogBackdrop>
  )
}

export default IssueWorkbench
