'use client'

import { useQuery } from '@tanstack/react-query'
import { FolderOpen, Lightbulb } from 'lucide-react'
import Link from 'next/link'
import PermissionGuard from '@/components/PermissionGuard'
import { Alert } from '@/components/ui/Alert'
import { Card, CardContent } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { projectKeys, projectsApi, type Project } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'

/**
 * 顶层推荐入口。推荐候选当前仍按项目收集与处置，本页负责把侧栏
 * `/recommendations` 落点收束到项目级推荐工作台，避免导航 404。
 */
export default function RecommendationsHubPage() {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)

  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }

  return (
    <PermissionGuard
      require={['recommendation:view']}
      fallback={<Alert className="my-8">无权访问智能推荐</Alert>}
    >
      <RecommendationsHubContent organizationId={organizationId} />
    </PermissionGuard>
  )
}

function RecommendationsHubContent({ organizationId }: { organizationId: number }) {
  const projects = useQuery({
    queryKey: projectKeys.list(organizationId, { perPage: 50 }),
    queryFn: () => projectsApi.list({ perPage: 50 }),
  })

  return (
    <div className="space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-800 text-balance">智能推荐</h1>
        <p className="max-w-2xl text-sm text-gray-500">
          推荐按项目生成、刷新与确认。选择项目后，可查看风险、变更影响、排程与 TRIZ 相关建议。
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
          description="创建项目后，可在各项目内收集并处理智能推荐。"
        />
      ) : null}

      {projects.data && projects.data.data.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.data.map((project: Project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}/recommendations`}
                className="block rounded-[var(--radius-lg)] outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
              >
                <Card
                  variant="outlined"
                  className="h-full transition-colors hover:border-primary-300"
                >
                  <CardContent className="flex items-start gap-3 pt-[var(--card-pad)]">
                    <span className="rounded-[var(--radius-md)] bg-primary-50 p-2 text-primary-600">
                      <Lightbulb className="h-5 w-5" aria-hidden />
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
