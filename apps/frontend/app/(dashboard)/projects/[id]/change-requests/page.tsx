'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Plus, FileText, Clock, CheckCircle, XCircle, RotateCcw } from 'lucide-react'
import PermissionGuard from '@/components/PermissionGuard'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import {
  changeRequestKeys,
  listChangeRequests,
  type ChangeRequestStatus,
  type ChangeRequestType,
  type ChangeRequestPriority,
} from '@/lib/api/change-requests'

const STATUS_LABELS: Record<ChangeRequestStatus, string> = {
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

const STATUS_ICONS: Record<ChangeRequestStatus, typeof FileText> = {
  draft: FileText,
  submitted: Clock,
  under_review: Clock,
  approved: CheckCircle,
  rejected: XCircle,
  returned: RotateCcw,
  implemented: CheckCircle,
  closed: CheckCircle,
  cancelled: XCircle,
}

const TYPE_LABELS: Record<ChangeRequestType, string> = {
  scope: '范围',
  schedule: '进度',
  cost: '成本',
  resource: '资源',
  quality: '质量',
  risk: '风险',
  other: '其他',
}

const PRIORITY_LABELS: Record<ChangeRequestPriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('zh-CN')
}

export default function ProjectChangeRequestsPage() {
  const projectId = Number(useParams().id)
  return (
    <PermissionGuard
      require="change_request:create"
      fallback={<Alert className="my-8">无权查看变更请求</Alert>}
    >
      <ChangeRequestsPageContent projectId={projectId} />
    </PermissionGuard>
  )
}

function ChangeRequestsPageContent({ projectId }: { projectId: number }) {
  const [statusFilter, setStatusFilter] = useState<ChangeRequestStatus | ''>('')
  const [typeFilter, setTypeFilter] = useState<ChangeRequestType | ''>('')
  const [priorityFilter, setPriorityFilter] = useState<ChangeRequestPriority | ''>('')
  const [page, setPage] = useState(1)

  const filters = useMemo(
    () => ({
      status: statusFilter || undefined,
      changeType: typeFilter || undefined,
      priority: priorityFilter || undefined,
      page,
      perPage: 20,
    }),
    [statusFilter, typeFilter, priorityFilter, page],
  )

  const { data, isLoading, error } = useQuery({
    queryKey: changeRequestKeys.list(projectId, filters),
    queryFn: () => listChangeRequests(projectId, filters),
  })

  const rows = data?.data ?? []
  const meta = data?.meta

  if (error) {
    return <Alert className="my-8">加载变更请求失败</Alert>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">变更请求</h1>
          <p className="text-sm text-muted-foreground">管理项目变更日志与审批流程</p>
        </div>
        <Link href={`/projects/${projectId}/change-requests/new`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            新建变更请求
          </Button>
        </Link>
      </div>

      {/* 筛选栏 */}
      <Card>
        <CardContent className="flex gap-4 py-4">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as ChangeRequestStatus | '')
              setPage(1)
            }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value as ChangeRequestType | '')
              setPage(1)
            }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">全部类型</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => {
              setPriorityFilter(e.target.value as ChangeRequestPriority | '')
              setPage(1)
            }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">全部优先级</option>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* 列表 */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="暂无变更请求"
          description="点击「新建变更请求」开始记录项目变更。"
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>编号</TableHead>
                <TableHead>标题</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>优先级</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((cr) => {
                const Icon = STATUS_ICONS[cr.status]
                return (
                  <TableRow key={cr.id}>
                    <TableCell className="font-mono text-xs">{cr.crCode}</TableCell>
                    <TableCell>
                      <Link
                        href={`/projects/${projectId}/change-requests/${cr.id}`}
                        className="text-primary hover:underline"
                      >
                        {cr.title}
                      </Link>
                    </TableCell>
                    <TableCell>{TYPE_LABELS[cr.changeType]}</TableCell>
                    <TableCell>{PRIORITY_LABELS[cr.priority]}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-sm">
                        <Icon className="h-3.5 w-3.5" />
                        {STATUS_LABELS[cr.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(cr.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableCaption>
              共 {meta?.total ?? 0} 条，第 {meta?.page ?? 1}/{meta?.totalPages ?? 1} 页
            </TableCaption>
          </Table>
        </Card>
      )}

      {/* 分页 */}
      {meta && meta.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </Button>
          <span className="py-2 text-sm text-muted-foreground">
            {meta.page} / {meta.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  )
}
