'use client'

import PermissionGuard from '@/components/PermissionGuard'
import { projectKeys, projectsApi, type Project, type ProjectStatus } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { useQuery } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
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

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'planning', label: '计划中' },
  { value: 'active', label: '进行中' },
  { value: 'on_hold', label: '暂停' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
  { value: 'archived', label: '已归档' },
]

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: '草稿',
  planning: '计划中',
  active: '进行中',
  on_hold: '暂停',
  completed: '已完成',
  cancelled: '已取消',
  archived: '已归档',
}

export default function ProjectsPage() {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)
  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }
  return (
    <PermissionGuard require="project:view" fallback={<Alert className="my-8">无权访问项目</Alert>}>
      <ProjectsListContent organizationId={organizationId} />
    </PermissionGuard>
  )
}

function ProjectsListContent({ organizationId }: { organizationId: number }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const projects = useQuery({
    queryKey: projectKeys.list(organizationId, { search, status, page }),
    queryFn: () =>
      projectsApi.list({
        search: search || undefined,
        status: status === 'all' ? undefined : status,
        page,
        perPage: 10,
      }),
  })

  const totalPages = projects.data?.meta.totalPages ?? 1
  const hasFilters = search.length > 0 || status !== 'all'
  const resetFilters = () => {
    setSearch('')
    setStatus('all')
    setPage(1)
  }

  return (
    <div className="space-y-6 py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-800 text-balance">项目</h1>
          <p className="text-sm text-gray-500">查看和管理当前组织内的全部项目。</p>
        </div>
        <PermissionGuard require="project:create">
          <Button onClick={() => router.push('/projects/new')}>新建项目</Button>
        </PermissionGuard>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          className="sm:max-w-80"
          aria-label="搜索项目"
          placeholder="按名称或编码搜索"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="sm:w-44" aria-label="按状态筛选">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" disabled={!hasFilters} onClick={resetFilters}>
          重置
        </Button>
      </div>

      {projects.isLoading ? <ProjectsTableSkeleton /> : null}
      {projects.isError ? (
        <Alert variant="danger" title="项目加载失败">
          请稍后重试，或检查网络连接。
        </Alert>
      ) : null}
      {projects.data && projects.data.data.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={hasFilters ? '没有匹配的项目' : '还没有项目'}
          description={
            hasFilters ? '调整搜索词或状态筛选后再试。' : '创建项目后可在这里统一跟踪进度。'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={resetFilters}>
                清除筛选
              </Button>
            ) : (
              <PermissionGuard require="project:create">
                <Button onClick={() => router.push('/projects/new')}>新建项目</Button>
              </PermissionGuard>
            )
          }
        />
      ) : null}
      {projects.data && projects.data.data.length > 0 ? (
        <Card variant="outlined" className="overflow-x-auto">
          <Table>
            <TableCaption>项目列表</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>编码</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>成员</TableHead>
                <TableHead>任务</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.data.data.map((project: Project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link
                      className="font-medium text-primary-600 hover:underline"
                      href={`/projects/${project.id}`}
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{project.code || '—'}</TableCell>
                  <TableCell>
                    <Chip>{STATUS_LABEL[project.status] ?? project.status}</Chip>
                  </TableCell>
                  <TableCell>{project.stats?.memberCount ?? '—'}</TableCell>
                  <TableCell>{project.stats?.taskCount ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-4" aria-label="项目分页">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            上一页
          </Button>
          <span className="text-sm text-gray-500">
            第 {page} / {totalPages} 页
          </span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </Button>
        </nav>
      ) : null}
    </div>
  )
}

function ProjectsTableSkeleton() {
  return (
    <Card variant="outlined" className="space-y-3 p-[var(--card-pad)]" aria-label="正在加载项目">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </Card>
  )
}
