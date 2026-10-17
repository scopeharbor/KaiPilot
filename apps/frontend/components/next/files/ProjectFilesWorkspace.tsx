'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import {
  isNotFoundError,
  ProjectSpaceErrorView,
  ProjectSpaceNotFoundView,
  ProjectSpaceSkeleton,
} from '@/components/next/project-space/ProjectSpaceContainer'
import { DomainPageHeader } from '@/components/next/common/DomainPageHeader'
import { FileUploadDropzone } from './FileUploadDropzone'
import { FileDocumentsOrganizer } from './FileDocumentsOrganizer'
import { FileAttachmentList } from './FileAttachmentList'

/**
 * 项目文件库新轨主工作区（v3-ui-next-resource-team-domains W3 · tasks 3.7，
 * spec「项目文件与附件统一管理」/「附件拖拽上传与进度反馈」/「文件安全下载与受控删除」）。
 *
 * - 项目详情经 projectsApi.get 载入（与主工作面同键 projectKeys.detail，RL-04）；
 * - RL-05 组织隔离：跨组织 / HTTP 404 统一中性空态「项目不存在或已被移除」；
 * - 顶部统一功能域页头 DomainPageHeader（← 返回项目工作面 + entity store 面包屑
 *   联动 `<项目名> · 项目文件库`，由页头组件自身注册/清理）；
 * - 功能区：上传释放区（file:manage 门禁，无权限物理禁用）→ 轻量文档/文件夹组织
 *   （filesApi.list/create）→ 附件与交付物底册（attachmentsApi.list + 安全下载 +
 *   受控删除二次确认，删除/上传入口按 file:manage 隐藏）；
 * - 沉浸阶梯：immersive/light 消费 .nx-space-atmosphere 深空光晕，precise 纯色降级。
 */

export function ProjectFilesWorkspace({ projectId }: { projectId: number }) {
  const router = useRouter()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const { hasPermission } = usePermissions()
  const tier = useImmersionTier()

  // 写能力门禁：上传 / 新建文档 / 删除文件（RL-06 界面隐藏，服务端仍为最终边界）。
  const canManageFiles = hasPermission('file:manage')

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

  // RL-05 组织隔离：跨组织项目视同不存在。
  const orgMismatch =
    project !== undefined &&
    currentOrganizationId !== null &&
    project.organizationId !== currentOrganizationId
  const notFound = orgMismatch || (isError && isNotFoundError(error))

  if (isPending) {
    return <ProjectSpaceSkeleton />
  }
  if (notFound) {
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  }
  if (isError || project === undefined) {
    return (
      <ProjectSpaceErrorView
        onRetry={() => void refetch()}
        onBackHome={() => router.push('/next')}
      />
    )
  }

  return (
    <div
      data-files-workspace-space
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 统一功能域页头：返回主工作面 + 面包屑同步（页头组件自注册/清理） */}
      <DomainPageHeader
        projectId={projectId}
        projectName={project.name}
        domainLabel="项目文件库"
        description="项目交付物归档 · 附件上传与安全下载 · 轻量文档与文件夹组织"
      />

      {/* 拖拽上传释放区（file:manage 门禁；只读时物理禁用） */}
      <FileUploadDropzone projectId={projectId} canManage={canManageFiles} />

      {/* 轻量文档 / 文件夹组织 */}
      <FileDocumentsOrganizer projectId={projectId} canManage={canManageFiles} />

      {/* 附件与交付物底册 */}
      <FileAttachmentList projectId={projectId} canManage={canManageFiles} />
    </div>
  )
}

export default ProjectFilesWorkspace
