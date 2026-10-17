'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import { resourceKeys, resourcesApi, type Resource } from '@/lib/api/resources'
import { PageReadinessBanner } from '@/components/help/PageReadinessBanner'
import { readinessFor } from '@/lib/help/readiness'
import { Users } from 'lucide-react'

/**
 * `/resources` 资源视图（v3-help-and-operational-issues-center 3.4）。
 *
 * 显式项目选择：由用户在下拉框中选定项目（默认第一个），不再隐式锁定第一个项目；
 * 分配与负载等深度视图从「进入项目资源页」进入。
 */
export default function ResourcesPage() {
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: projectKeys.all,
    queryFn: () => projectsApi.list(),
  })
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)

  const projectList = projects?.data ?? []
  const projectId =
    selectedProjectId !== null && projectList.some((p) => p.id === selectedProjectId)
      ? selectedProjectId
      : projectList[0]?.id

  return (
    <div className="space-y-4">
      <div className="p-6 pb-0">
        <PageReadinessBanner readiness={readinessFor('/resources')!} helpArticleTitle="资源视图" />
      </div>
      {projectsLoading ? (
        <div className="space-y-4 p-6" aria-busy="true">
          <BrandLoader size={56} label="正在载入资源视图…" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !projectId ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Users className="mb-4 h-12 w-12" />
          <p>暂无项目，请先创建项目</p>
        </div>
      ) : (
        <div className="space-y-6 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">资源管理</h1>
            <div className="flex items-center gap-3">
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
              <Link
                href={`/projects/${projectId}/resources`}
                className="text-sm text-primary hover:underline"
              >
                进入项目资源页（分配/负载）
              </Link>
            </div>
          </div>
          <ProjectResources key={projectId} projectId={projectId} />
        </div>
      )}
    </div>
  )
}

function ProjectResources({ projectId }: { projectId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: resourceKeys.lists(projectId),
    queryFn: () => resourcesApi.list(projectId, { perPage: 50 }),
  })

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <BrandLoader size={56} label="正在载入资源列表…" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>日产能(h)</TableHead>
              <TableHead>时区</TableHead>
              <TableHead>创建时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.data?.length ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  暂无资源，请添加
                </TableCell>
              </TableRow>
            ) : (
              data.data.map((r: Resource) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    {r.resourceType === 'human'
                      ? '人员'
                      : r.resourceType === 'material'
                        ? '物料'
                        : r.resourceType === 'equipment'
                          ? '设备'
                          : '预算'}
                  </TableCell>
                  <TableCell>{r.role}</TableCell>
                  <TableCell>{r.status === 'active' ? '活跃' : '停用'}</TableCell>
                  <TableCell>{r.dailyCapacityHours}</TableCell>
                  <TableCell>{r.timezone}</TableCell>
                  <TableCell>{r.createdAt?.slice(0, 10)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
