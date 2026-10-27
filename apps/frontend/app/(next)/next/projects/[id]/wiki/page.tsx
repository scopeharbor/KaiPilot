'use client'

import { useParams, useRouter } from 'next/navigation'
import { WikiWorkspace } from '@/components/next/wiki/WikiWorkspace'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'

/**
 * 项目记忆维基（/next/projects/:id/wiki）。
 * 路径 id 非数字直接中性 404、零请求；项目成员判定由后端完成（非成员同样 404）。
 */
export default function ProjectWikiPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = Number(params?.id)
  if (!Number.isInteger(projectId) || projectId <= 0)
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  return <WikiWorkspace scopeKind="project" scopeRefId={projectId} />
}
