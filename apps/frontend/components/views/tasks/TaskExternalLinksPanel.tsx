'use client'

import { useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { ExternalLink, GitPullRequest, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import {
  useTaskExternalLinks,
  useCreateTaskExternalLink,
  useUpdateTaskExternalLink,
  useDeleteTaskExternalLink,
  useRefreshTaskExternalLink,
} from '@/hooks/use-task-external-links'
import type {
  ExternalLinkDto,
  CreateExternalLinkRequest,
  UpdateExternalLinkRequest,
} from '@aiproj/types'
import {
  mapRefreshResult,
  mapCiSummary,
  type RefreshResultInfo,
  type CiSummaryDisplay,
} from '@/lib/api/task-external-links'
import {
  EXTERNAL_LINK_STATUS_LABELS,
  EXTERNAL_LINK_TYPE_LABELS,
  EXTERNAL_LINK_PROVIDERS,
} from '@aiproj/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'

const LINK_TYPE_OPTIONS = [
  { value: 'issue', label: 'Issue' },
  { value: 'pull_request', label: 'Pull Request' },
  { value: 'merge_request', label: 'Merge Request' },
]

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'merged', label: 'Merged' },
  { value: 'locked', label: 'Locked' },
  { value: 'draft', label: 'Draft' },
  { value: 'unknown', label: '未知' },
]

const PROVIDER_OPTIONS = EXTERNAL_LINK_PROVIDERS.map((p) => ({
  value: p,
  label: p === 'github' ? 'GitHub' : 'GitLab',
}))

/**
 * 表单内的下拉：Radix Select 需要 Trigger/Content/Item 组合，直接塞 <option> 会被原样铺成文字
 * 且没有可点的触发器。`name` 由 Radix 渲染的隐藏原生 select 带进 FormData。
 */
function FormSelect({
  name,
  label,
  options,
  defaultValue,
  placeholder,
  required,
}: {
  name: string
  label: string
  options: { value: string; label: string }[]
  defaultValue?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <Select name={name} defaultValue={defaultValue} required={required}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface TaskExternalLinksPanelProps {
  projectId: number
  taskId: number
}

export function TaskExternalLinksPanel({ projectId, taskId }: TaskExternalLinksPanelProps) {
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canMutate = hasPermission('task:update') || hasPermission('task:update:self')
  const { data, isLoading, isError } = useTaskExternalLinks(projectId, taskId)
  const [showCreate, setShowCreate] = useState(false)
  const [editLink, setEditLink] = useState<ExternalLinkDto | null>(null)

  const links = data ?? []

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-800">外部链接</h3>
        <LoadingSpinner className="h-8 w-8" />
      </section>
    )
  }

  if (isError) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-800">外部链接</h3>
        <p className="text-sm text-danger">外部链接加载失败</p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-800">外部链接</h3>
        {canMutate && (
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                + 添加
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>添加外部链接</DialogTitle>
              </DialogHeader>
              <CreateExternalLinkForm
                projectId={projectId}
                taskId={taskId}
                onSuccess={() => setShowCreate(false)}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-gray-500">暂无外部链接</p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <ExternalLinkCard
              key={link.id}
              link={link}
              projectId={projectId}
              taskId={taskId}
              canMutate={canMutate}
              onEdit={() => setEditLink(link)}
            />
          ))}
        </ul>
      )}

      {editLink && (
        <Dialog open={!!editLink} onOpenChange={(open) => !open && setEditLink(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>编辑外部链接</DialogTitle>
            </DialogHeader>
            <EditExternalLinkForm
              link={editLink}
              projectId={projectId}
              taskId={taskId}
              onSuccess={() => setEditLink(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}

function ExternalLinkCard({
  link,
  projectId,
  taskId,
  canMutate,
  onEdit,
}: {
  link: ExternalLinkDto
  projectId: number
  taskId: number
  canMutate: boolean
  onEdit: () => void
}) {
  const deleteLink = useDeleteTaskExternalLink(projectId, taskId)
  const refreshLink = useRefreshTaskExternalLink(projectId, taskId)
  const [deleting, setDeleting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshInfo, setRefreshInfo] = useState<RefreshResultInfo | null>(null)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteLink.mutateAsync(link.id)
    } finally {
      setDeleting(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshInfo(null)
    try {
      const response = await refreshLink.mutateAsync(link.id)
      setRefreshInfo(mapRefreshResult(response.data, link.provider))
    } catch {
      setRefreshInfo({
        type: 'temporarily_unavailable',
        message: '刷新请求失败，请稍后重试',
        isError: true,
        isRetryable: true,
        requiresReauthorization: false,
      })
    } finally {
      setRefreshing(false)
    }
  }

  const statusVariant = getStatusVariant(link.externalStatus)
  const statusSourceLabel = getStatusSourceLabel(link.statusSource)
  const observedLabel = formatObservedAt(link.lastObservedAt)
  const providerIcon = getProviderIcon(link.provider)
  const ciDisplay = mapCiSummary(link.ciSummary)

  return (
    <li className="rounded-[var(--radius-md)] border border-border bg-gray-0 p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {providerIcon}
          <div>
            <a
              href={link.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary-600 hover:underline"
            >
              {EXTERNAL_LINK_TYPE_LABELS[link.linkType as keyof typeof EXTERNAL_LINK_TYPE_LABELS] ??
                link.linkType}{' '}
              #{link.externalNumber}
            </a>
            <p className="text-xs text-gray-500">
              {link.repositoryOwner}/{link.repositoryName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant={statusVariant}>
            {EXTERNAL_LINK_STATUS_LABELS[
              link.externalStatus as keyof typeof EXTERNAL_LINK_STATUS_LABELS
            ] ?? link.externalStatus}
          </Badge>
        </div>
      </div>

      {link.externalTitle && <p className="mt-1 text-gray-700">{link.externalTitle}</p>}

      {ciDisplay && <CiStatusRow ci={ciDisplay} />}

      <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
        <span>
          {statusSourceLabel}
          {observedLabel ? ` · ${observedLabel}` : ''}
        </span>
        {canMutate && (
          <div className="flex gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing || refreshLink.isPending}
              className="inline-flex items-center gap-1 text-primary-500 hover:underline disabled:opacity-50"
              aria-label={`刷新 ${link.provider} #${link.externalNumber}`}
            >
              <RefreshCw className={refreshing ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
              {refreshing ? '刷新中...' : '刷新'}
            </button>
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1 text-gray-500 hover:underline"
              aria-label={`手动更新 #${link.externalNumber}`}
            >
              <Pencil className="h-3 w-3" />
              手动更新
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1 text-danger hover:underline disabled:opacity-50"
              aria-label={`删除外部链接 #${link.externalNumber}`}
            >
              <Trash2 className="h-3 w-3" />
              {deleting ? '删除中...' : '删除'}
            </button>
          </div>
        )}
      </div>
      {refreshInfo && (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-border bg-gray-50 px-2 py-1 text-xs text-gray-600">
          <span>{refreshInfo.message}</span>
          {refreshInfo.retryAfter ? <span> · 建议 {refreshInfo.retryAfter} 秒后重试</span> : null}
          {refreshInfo.requiresReauthorization ? <span> · 前往集成设置重新连接</span> : null}
          {refreshInfo.isRetryable && !refreshInfo.requiresReauthorization ? (
            <span> · 稍后重试</span>
          ) : null}
        </div>
      )}
    </li>
  )
}

/**
 * 只读 CI/check 状态行（v2-5-code-repository-ci-status-display）。
 * 仅呈现观测信息：状态、来源、上次观测、stale/未配置/需重连/限流/暂时不可用提示。
 * 不触发任何任务写操作。
 */
function CiStatusRow({ ci }: { ci: CiSummaryDisplay }) {
  const observed = formatObservedAt(ci.observedAt)
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"
      data-testid="ci-status-row"
      aria-label={`CI 状态 ${ci.label}`}
    >
      <span className="text-gray-400">CI</span>
      <Badge variant={ci.variant}>{ci.label}</Badge>
      <span className="text-gray-400">· {ci.sourceLabel}</span>
      {observed ? <span className="text-gray-400">· {observed}</span> : null}
      {ci.isStale ? (
        <span className="text-warning" data-testid="ci-stale">
          · 可能已过期
        </span>
      ) : null}
      {ci.hint ? <span className="text-gray-400">· {ci.hint}</span> : null}
      {ci.targetUrl ? (
        <a
          href={ci.targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-500 hover:underline"
        >
          查看
        </a>
      ) : null}
    </div>
  )
}

function CreateExternalLinkForm({
  projectId,
  taskId,
  onSuccess,
}: {
  projectId: number
  taskId: number
  onSuccess: () => void
}) {
  const createLink = useCreateTaskExternalLink(projectId, taskId)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (formData: FormData) => {
    setError(null)
    const payload: CreateExternalLinkRequest = {
      provider: formData.get('provider') as CreateExternalLinkRequest['provider'],
      linkType: formData.get('linkType') as CreateExternalLinkRequest['linkType'],
      repositoryOwner: formData.get('repositoryOwner') as string,
      repositoryName: formData.get('repositoryName') as string,
      externalNumber: Number(formData.get('externalNumber')),
      externalStatus: formData.get('externalStatus') as CreateExternalLinkRequest['externalStatus'],
      externalUrl: formData.get('externalUrl') as string,
      externalTitle: (formData.get('externalTitle') as string) || null,
      note: (formData.get('note') as string) || null,
    }
    try {
      await createLink.mutateAsync(payload)
      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '创建失败')
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Provider</Label>
          <FormSelect
            name="provider"
            label="Provider"
            options={PROVIDER_OPTIONS}
            placeholder="选择"
            required
          />
        </div>
        <div>
          <Label>链接类型</Label>
          <FormSelect
            name="linkType"
            label="链接类型"
            options={LINK_TYPE_OPTIONS}
            defaultValue="issue"
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>仓库 Owner</Label>
          <Input name="repositoryOwner" required placeholder="e.g. facebook" />
        </div>
        <div>
          <Label>仓库名</Label>
          <Input name="repositoryName" required placeholder="e.g. react" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>外部编号</Label>
          <Input name="externalNumber" type="number" required placeholder="e.g. 42" />
        </div>
        <div>
          <Label>状态</Label>
          <FormSelect
            name="externalStatus"
            label="状态"
            options={STATUS_OPTIONS}
            defaultValue="open"
            required
          />
        </div>
      </div>
      <div>
        <Label>外部 URL</Label>
        <Input name="externalUrl" required placeholder="https://github.com/..." />
      </div>
      <div>
        <Label>外部标题</Label>
        <Input name="externalTitle" placeholder="可选" />
      </div>
      <div>
        <Label>备注</Label>
        <Input name="note" placeholder="可选" />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={createLink.isPending}>
        {createLink.isPending ? '创建中...' : '创建'}
      </Button>
    </form>
  )
}

function EditExternalLinkForm({
  link,
  projectId,
  taskId,
  onSuccess,
}: {
  link: ExternalLinkDto
  projectId: number
  taskId: number
  onSuccess: () => void
}) {
  const updateLink = useUpdateTaskExternalLink(projectId, taskId, link.id)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (formData: FormData) => {
    setError(null)
    const payload: UpdateExternalLinkRequest = {
      externalTitle: (formData.get('externalTitle') as string) || null,
      externalStatus: formData.get('externalStatus') as UpdateExternalLinkRequest['externalStatus'],
      note: (formData.get('note') as string) || null,
    }
    try {
      await updateLink.mutateAsync(payload)
      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '更新失败')
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <Label>外部标题</Label>
        <Input name="externalTitle" defaultValue={link.externalTitle ?? ''} />
      </div>
      <div>
        <Label>状态</Label>
        <FormSelect
          name="externalStatus"
          label="状态"
          options={STATUS_OPTIONS}
          defaultValue={link.externalStatus}
        />
      </div>
      <div>
        <Label>备注</Label>
        <Input name="note" defaultValue={link.note ?? ''} />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={updateLink.isPending}>
        {updateLink.isPending ? '更新中...' : '更新'}
      </Button>
    </form>
  )
}

function getStatusVariant(
  status: string,
): 'success' | 'warning' | 'danger' | 'neutral' | 'outline' | 'primary' {
  switch (status) {
    case 'open':
    case 'opened':
      return 'success'
    case 'closed':
      return 'neutral'
    case 'merged':
      return 'primary'
    case 'locked':
      return 'warning'
    case 'draft':
      return 'warning'
    default:
      return 'outline'
  }
}

function getStatusSourceLabel(source: string): string {
  switch (source) {
    case 'manual':
      return '手动更新'
    case 'pre_connection_only':
      return '预连接模式'
    case 'not_configured':
      return '未配置同步'
    case 'refresh_success':
      return '已同步'
    case 'refresh_degraded':
      return '同步降级'
    case 'github_readonly':
      return 'GitHub 只读'
    case 'gitlab_readonly':
      return 'GitLab 只读'
    case 'connection_required':
      return '需要连接'
    case 'reauthorization_required':
      return '需重新授权'
    case 'not_found':
      return '未找到'
    case 'forbidden':
      return '访问被拒'
    case 'rate_limited':
      return '限流中'
    case 'temporarily_unavailable':
      return '暂时不可用'
    case 'unsupported_link':
      return '不支持的链接'
    default:
      return source
  }
}

function getProviderIcon(provider: string) {
  if (provider === 'github') {
    return <ExternalLink className="h-4 w-4 text-gray-700" aria-label="GitHub" />
  }
  if (provider === 'gitlab') {
    return <GitPullRequest className="h-4 w-4 text-orange-600" aria-label="GitLab" />
  }
  return <ExternalLink className="h-4 w-4 text-gray-500" aria-label="外部链接" />
}

function formatObservedAt(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `上次观测 ${date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}
