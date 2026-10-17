'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { ShieldAlert, AlertCircle, FolderOpen, ArrowRight, Plus } from 'lucide-react'
import { PageReadinessBanner } from '@/components/help/PageReadinessBanner'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Textarea } from '@/components/ui/Textarea'
import {
  ISSUE_PRIORITY_LABELS,
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
  ISSUE_STATUS_TRANSITIONS,
  ISSUE_TYPE_LABELS,
  issueKeys,
  issuesApi,
  type CreateIssueInput,
  type Issue,
  type IssuePriority,
  type IssueSeverity,
  type IssueStatus,
  type IssueType,
} from '@/lib/api/issues'
import { projectKeys, projectsApi, type Project } from '@/lib/api/projects'
import { readinessFor } from '@/lib/help/readiness'
import { ISSUE_RISK_TAXONOMY } from '@/lib/help/taxonomy'
import { useAuthStore } from '@/stores/auth-store'

const SEVERITY_VARIANT: Record<IssueSeverity, 'danger' | 'warning' | 'neutral'> = {
  critical: 'danger',
  major: 'warning',
  minor: 'neutral',
  trivial: 'neutral',
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

/**
 * `/risks` 问题与风险入口（v3-help-and-operational-issues-center 3.2，design F）。
 *
 * - 旧 `/risks` URL 与风险语义保留：风险登记册真实入口（项目级）；
 * - 「项目问题」清单接入 `/projects/:projectId/issues`：登记、筛选与状态流转
 *   （resolved 必须回填根因与措施，由后端状态机守卫）；
 * - 产品故障/系统异常 → 引导到帮助中心故障排查（不进入项目风险记录）。
 */
export default function IssuesAndRisksPage() {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)

  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }

  return (
    <div className="space-y-6 py-6" data-testid="issues-and-risks-page">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldAlert className="h-6 w-6 text-primary" /> 问题与风险
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          「项目问题」是已发生且正在阻塞目标的事实；「项目风险」是尚未发生但有概率与影响的不确定事件；
          「产品故障」是软件/API/配置异常，请走故障排查，不进入项目风险记录。
        </p>
      </div>

      <PageReadinessBanner readiness={readinessFor('/risks')!} helpArticleTitle="问题与风险" />

      {/* 概念区分（taxonomy 卡片） */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ISSUE_RISK_TAXONOMY.map((t) => (
          <Card key={t.kind}>
            <CardContent className="p-4">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-medium">{t.label}</span>
                <Badge variant={t.implemented ? 'success' : 'warning'}>
                  {t.implemented ? '可用' : '规划中'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{t.definition}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium">示例：</span>
                {t.example}（{t.where}）
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="risk" data-testid="issues-risk-tabs">
        <TabsList>
          <TabsTrigger value="risk">项目风险</TabsTrigger>
          <TabsTrigger value="issue">项目问题</TabsTrigger>
        </TabsList>

        <TabsContent value="risk" className="pt-4" data-testid="risks-tab">
          <RiskProjectsHub />
        </TabsContent>

        <TabsContent value="issue" className="pt-4" data-testid="issues-tab">
          <ProjectIssuesPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function useOrganizationProjects() {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)
  return useQuery({
    queryKey: projectKeys.list(organizationId ?? 0, { perPage: 50 }),
    queryFn: () => projectsApi.list({ perPage: 50 }),
    enabled: organizationId != null,
  })
}

function NoProjectsState() {
  return (
    <EmptyState
      icon={FolderOpen}
      title="还没有项目"
      description="创建项目后，即可在项目内维护风险登记册与问题清单。"
      action={
        <Button asChild>
          <Link href="/projects/new">创建项目</Link>
        </Button>
      }
    />
  )
}

function ProjectListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2].map((k) => (
        <Skeleton key={k} className="h-14 w-full" />
      ))}
    </div>
  )
}

function RiskProjectsHub() {
  const projects = useOrganizationProjects()

  if (projects.isLoading) return <ProjectListSkeleton />

  const projectList = projects.data?.data ?? []
  if (projectList.length === 0) return <NoProjectsState />

  return (
    <div data-testid="risk-projects-hub">
      <p className="mb-3 text-sm text-muted-foreground">
        风险登记册按项目维护。选择项目进入风险工作台：
      </p>
      <ul className="space-y-2">
        {projectList.map((p) => (
          <li key={p.id}>
            <Card className="hover:border-primary/40">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  {p.description && (
                    <p className="truncate text-xs text-muted-foreground">{p.description}</p>
                  )}
                </div>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/projects/${p.id}/risks`}>
                    进入风险登记册 <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProjectIssuesPanel() {
  const projects = useOrganizationProjects()
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)

  if (projects.isLoading) return <ProjectListSkeleton />

  const projectList: Project[] = projects.data?.data ?? []
  if (projectList.length === 0) return <NoProjectsState />

  const projectId = selectedProjectId ?? projectList[0]!.id

  return (
    <div className="space-y-4" data-testid="project-issues-panel">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">项目</span>
        <select
          aria-label="选择项目"
          className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
          value={projectId}
          onChange={(e) => setSelectedProjectId(Number(e.target.value))}
        >
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
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
  const [statusFilter, setStatusFilter] = useState<IssueStatus | 'all'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [resolving, setResolving] = useState<Issue | null>(null)

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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="问题状态筛选"
          className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as IssueStatus | 'all')}
        >
          <option value="all">全部状态</option>
          {(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((s) => (
            <option key={s} value={s}>
              {ISSUE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {issues.data && (
          <span className="text-sm text-muted-foreground">共 {issues.data.meta.total} 条</span>
        )}
        <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> 登记问题
        </Button>
      </div>

      {statusMutation.isError && !resolving && (
        <Alert variant="danger">
          <AlertDescription>{errorMessage(statusMutation.error)}</AlertDescription>
        </Alert>
      )}

      {issues.isLoading ? (
        <ProjectListSkeleton />
      ) : issues.isError ? (
        <Alert variant="danger">
          <AlertDescription>问题清单加载失败：{errorMessage(issues.error)}</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={AlertCircle}
          title="暂无项目问题"
          description="把已经发生、正在阻塞目标的事实登记为问题，指定严重度并跟进到解决。"
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编号</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>严重度</TableHead>
                  <TableHead>优先级</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>登记时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((issue) => (
                  <TableRow key={issue.id} data-testid="issue-row">
                    <TableCell className="font-mono text-xs">{issue.code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{issue.title}</div>
                      {issue.resolution && (
                        <div className="text-xs text-muted-foreground">
                          措施：{issue.resolution}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{ISSUE_TYPE_LABELS[issue.type] ?? issue.type}</TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_VARIANT[issue.severity] ?? 'neutral'}>
                        {ISSUE_SEVERITY_LABELS[issue.severity] ?? issue.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>{ISSUE_PRIORITY_LABELS[issue.priority] ?? issue.priority}</TableCell>
                    <TableCell>
                      <select
                        aria-label={`变更 ${issue.code} 状态`}
                        className="rounded-md border bg-transparent px-1.5 py-1 text-xs"
                        value={issue.status}
                        disabled={statusMutation.isPending}
                        onChange={(e) => handleStatusChange(issue, e.target.value as IssueStatus)}
                      >
                        <option value={issue.status}>{ISSUE_STATUS_LABELS[issue.status]}</option>
                        {(ISSUE_STATUS_TRANSITIONS[issue.status] ?? []).map((next) => (
                          <option key={next} value={next}>
                            → {ISSUE_STATUS_LABELS[next]}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell className="text-xs">{issue.createdAt?.slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<IssueType>('blocker')
  const [severity, setSeverity] = useState<IssueSeverity>('major')
  const [priority, setPriority] = useState<IssuePriority>('medium')

  const createMutation = useMutation({
    mutationFn: (input: CreateIssueInput) => issuesApi.create(projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: issueKeys.lists(projectId) })
      setTitle('')
      setDescription('')
      onOpenChange(false)
    },
  })

  const selectClass = 'w-full rounded-md border bg-transparent px-2 py-1.5 text-sm'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>登记项目问题</DialogTitle>
          <DialogDescription>
            记录已经发生、正在阻塞项目目标的事实，编号自动生成。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="issue-title" className="text-sm font-medium">
              标题
            </label>
            <Input
              id="issue-title"
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label htmlFor="issue-type" className="text-sm font-medium">
                分类
              </label>
              <select
                id="issue-type"
                className={selectClass}
                value={type}
                onChange={(e) => setType(e.target.value as IssueType)}
              >
                {(Object.keys(ISSUE_TYPE_LABELS) as IssueType[]).map((v) => (
                  <option key={v} value={v}>
                    {ISSUE_TYPE_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="issue-severity" className="text-sm font-medium">
                严重度
              </label>
              <select
                id="issue-severity"
                className={selectClass}
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IssueSeverity)}
              >
                {(Object.keys(ISSUE_SEVERITY_LABELS) as IssueSeverity[]).map((v) => (
                  <option key={v} value={v}>
                    {ISSUE_SEVERITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="issue-priority" className="text-sm font-medium">
                优先级
              </label>
              <select
                id="issue-priority"
                className={selectClass}
                value={priority}
                onChange={(e) => setPriority(e.target.value as IssuePriority)}
              >
                {(Object.keys(ISSUE_PRIORITY_LABELS) as IssuePriority[]).map((v) => (
                  <option key={v} value={v}>
                    {ISSUE_PRIORITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="issue-description" className="text-sm font-medium">
              描述（可选）
            </label>
            <Textarea
              id="issue-description"
              rows={3}
              maxLength={10000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {createMutation.isError && (
            <Alert variant="danger">
              <AlertDescription>{errorMessage(createMutation.error)}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
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
          >
            {createMutation.isPending ? '提交中...' : '确认登记'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [rootCause, setRootCause] = useState('')
  const [resolution, setResolution] = useState('')

  return (
    <Dialog
      open={issue !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>标记为已解决</DialogTitle>
          <DialogDescription>
            {issue ? `${issue.code} ${issue.title}` : ''}：解决前必须填写根本原因与解决措施。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="issue-root-cause" className="text-sm font-medium">
              根本原因
            </label>
            <Textarea
              id="issue-root-cause"
              rows={2}
              maxLength={5000}
              defaultValue={issue?.rootCause ?? ''}
              onChange={(e) => setRootCause(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="issue-resolution" className="text-sm font-medium">
              解决措施
            </label>
            <Textarea
              id="issue-resolution"
              rows={2}
              maxLength={5000}
              defaultValue={issue?.resolution ?? ''}
              onChange={(e) => setResolution(e.target.value)}
            />
          </div>
          {error && (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            disabled={
              pending ||
              !(rootCause.trim() || issue?.rootCause) ||
              !(resolution.trim() || issue?.resolution)
            }
            onClick={() =>
              onConfirm(
                rootCause.trim() || issue?.rootCause || '',
                resolution.trim() || issue?.resolution || '',
              )
            }
          >
            {pending ? '提交中...' : '确认解决'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
