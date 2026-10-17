'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ClipboardList, ShieldX } from 'lucide-react'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { PermissionGuard } from '@/components/PermissionGuard'
import {
  isNotFoundError,
  ProjectSpaceNotFoundView,
} from '@/components/next/project-space/ProjectSpaceContainer'
import { NewChangeRequestForm } from '@/components/next/change-requests/NewChangeRequestForm'
import { CHANGE_REQUEST_CREATE } from '@/components/next/change-requests/cr-permissions'
import { cn } from '@/lib/utils'

/**
 * 新建变更请求路由（/next/projects/:id/change-requests/new，
 * v3-ui-next-risk-change-domains W2 · tasks 2.3 / spec「变更请求创建」）。
 *
 * - 准入门禁：change_request:create（已核实后端权限系列）；无权 → 受限横幅零发包；
 * - 路径 id 非正整数 → 中性 404（RL-05）；
 * - 项目详情载入后执行组织归属校验：跨租户统一渲染中性「项目不存在或已被移除」；
 * - 表单提交 POST /projects/:projectId/change-requests 成功后平滑跳转详情页。
 */
export default function NextProjectNewChangeRequestPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = Number(params?.id)
  const validId = Number.isInteger(projectId) && projectId > 0

  return (
    <PermissionGuard
      require={CHANGE_REQUEST_CREATE}
      fallback={
        <div
          data-permission-fallback
          data-change-requests-permission-fallback
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
        >
          <ClipboardList
            className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            暂无变更请求创建权限
          </h3>
          <p className="mx-auto mt-1.5 max-w-sm text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人开通 change_request:create 权限，获得后即可申请项目变更。
          </p>
        </div>
      }
    >
      {validId ? (
        <NewChangeRequestWorkPage projectId={projectId} />
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}

/** 新建页项目上下文守卫（RL-05 组织隔离 + 加载骨架 + 错误卡）。 */
function NewChangeRequestWorkPage({ projectId }: { projectId: number }) {
  const router = useRouter()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const register = useProjectSpaceEntityStore((state) => state.register)
  const clear = useProjectSpaceEntityStore((state) => state.clear)
  const tier = useImmersionTier()

  const {
    data: project,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  })

  const orgMismatch =
    project !== undefined &&
    currentOrganizationId !== null &&
    project.organizationId !== currentOrganizationId
  const notFound = orgMismatch || (isError && isNotFoundError(error))

  React.useEffect(() => {
    if (project !== undefined && !orgMismatch) {
      register(projectId, project.name)
    } else {
      clear(projectId)
    }
    return () => clear(projectId)
  }, [project, orgMismatch, projectId, register, clear])

  if (isPending) {
    return (
      <div
        role="status"
        aria-label="正在加载新建变更请求工作面"
        aria-busy="true"
        data-cr-new-skeleton
        className="space-y-4"
      >
        <div className="h-12 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
        <div className="h-80 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      </div>
    )
  }
  if (notFound) {
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  }
  if (isError || project === undefined) {
    return (
      <div
        role="alert"
        aria-label="新建变更请求工作面加载失败"
        data-cr-new-error
        className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
      >
        <ShieldX className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">新建工作面加载失败</h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            重新载入
          </button>
          <button
            type="button"
            onClick={() => router.push('/next')}
            className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            返回角色首页
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      data-cr-new-workspace
      data-cr-project-id={projectId}
      className={cn(
        'flex flex-col gap-4',
        tier === 'precise' ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href={`/next/projects/${projectId}`}
            aria-label="返回项目主空间"
            data-cr-back-to-space
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <ClipboardList className="h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
          <h2
            data-cr-new-title
            className="shrink-0 text-sm font-semibold text-[var(--nx-text-primary)]"
          >
            新建变更请求
          </h2>
          <span className="hidden min-w-0 truncate text-xs text-[var(--nx-text-secondary)] sm:inline-block">
            {project.name}
          </span>
          <span
            data-cr-new-code
            className="shrink-0 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            #{project.code ?? `PROJ-${projectId}`}
          </span>
        </div>
        <Link
          href={`/next/projects/${projectId}/change-requests`}
          data-cr-new-back-list
          className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          返回变更请求列表
        </Link>
      </header>

      <NewChangeRequestForm projectId={projectId} mode="create" />
    </div>
  )
}
