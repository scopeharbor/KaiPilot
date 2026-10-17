'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'

export default function ReportsHubPage() {
  const organizationId = useAuthStore((s) => s.currentOrganizationId)
  const filters = { perPage: 20 }
  const projectsQuery = useQuery({
    queryKey: projectKeys.list(organizationId ?? 0, filters),
    queryFn: () => projectsApi.list(filters),
    enabled: organizationId != null,
  })

  if (projectsQuery.isLoading) {
    return (
      <div className="space-y-3 py-6" aria-busy="true">
        <BrandLoader size={56} label="正在载入项目报告…" />
        {[0, 1, 2].map((k) => (
          <Skeleton key={k} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  const projects = projectsQuery.data?.data ?? []

  if (!projects.length) {
    return (
      <div className="py-12">
        <EmptyState
          illustration="report"
          icon={BarChart3}
          title="还没有项目"
          description="创建项目后，可以进入项目报告页生成进度、延期、工作量和里程碑报告。"
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 py-6">
      <header className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-gray-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">项目报告</h1>
          <p className="text-sm text-gray-500">
            V1 支持按项目生成进度、延期、工作量和里程碑报告，并导出 Markdown 或 CSV。
          </p>
        </div>
      </header>

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}/reports`}
              className="block rounded-lg border border-border bg-white transition-colors hover:border-primary-300 hover:bg-primary-50/40"
            >
              <Card className="border-0 shadow-none">
                <CardHeader>
                  <CardTitle className="truncate">{project.name}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-gray-500">
                  <p className="line-clamp-2">{project.description || '暂无描述'}</p>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
