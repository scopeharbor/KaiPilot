'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { FileEdit, FolderOpen } from 'lucide-react'
import PermissionGuard from '@/components/PermissionGuard'
import { projectKeys, projectsApi, type Project } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { Alert } from '@/components/ui/Alert'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * 变更管理入口枢纽页（`/change-requests`）——侧栏「变更管理」的落点。
 *
 * V1 中变更请求是**项目级**功能（后端仅有 `/projects/:id/change-requests` 与扁平
 * `/change-requests/:id`，无跨项目聚合端点）。故本页不做聚合，而是列出当前组织内的
 * 项目，引导进入各自的变更请求视图，诚实反映功能边界并消除顶层 404。
 */
export default function ChangeRequestsHubPage() {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)
  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }
  return (
    <PermissionGuard
      require={['change_request:create', 'change_request:approve']}
      mode="any"
      fallback={<Alert className="my-8">无权访问变更管理</Alert>}
    >
      <ChangeRequestsHubContent organizationId={organizationId} />
    </PermissionGuard>
  )
}

function ChangeRequestsHubContent({ organizationId }: { organizationId: number }) {
  const projects = useQuery({
    queryKey: projectKeys.list(organizationId, { perPage: 50 }),
    queryFn: () => projectsApi.list({ perPage: 50 }),
  })

  return (
    <div className="space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-800 text-balance">变更管理</h1>
        <p className="max-w-2xl text-sm text-gray-500">
          变更请求按项目管理。选择一个项目，进入其变更请求登记与审批。
        </p>
      </header>

      {projects.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="正在加载项目">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : null}

      {projects.isError ? (
        <Alert variant="danger" title="项目加载失败">
          请稍后重试，或检查网络连接。
        </Alert>
      ) : null}

      {projects.data && projects.data.data.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="还没有项目"
          description="创建项目后，可在各项目内登记与审批变更请求。"
        />
      ) : null}

      {projects.data && projects.data.data.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.data.map((project: Project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}/change-requests`}
                className="block rounded-[var(--radius-lg)] outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
              >
                <Card
                  variant="outlined"
                  className="h-full transition-colors hover:border-primary-300"
                >
                  <CardContent className="flex items-start gap-3 pt-[var(--card-pad)]">
                    <span className="rounded-[var(--radius-md)] bg-primary-50 p-2 text-primary-600">
                      <FileEdit className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <p className="truncate font-medium text-gray-800">{project.name}</p>
                      <p className="truncate font-mono text-xs text-gray-500">
                        {project.code || '未设置编码'}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
