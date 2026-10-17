import { redirect } from 'next/navigation'

export interface NextTaskDetailRedirectPageProps {
  params: Promise<{ id: string; taskId: string }> | { id: string; taskId: string }
}

/**
 * 单任务独立路由重定向同化（v3-ui-next-batch1-strategy-launch-tasks W4 · 4.9）。
 *
 * 外部深链、书签或旧路径访问 `/next/projects/:id/tasks/:taskId` 时，
 * 平滑重定向至单项目空间并携带 `focusTask` 参数，原地滑出详情抽屉，消除孤立页面。
 */
export default async function NextTaskDetailRedirectPage({
  params,
}: NextTaskDetailRedirectPageProps) {
  const resolved = await Promise.resolve(params)
  const projectId = resolved.id
  const taskId = resolved.taskId
  redirect(`/next/projects/${projectId}?focusTask=${taskId}`)
}
