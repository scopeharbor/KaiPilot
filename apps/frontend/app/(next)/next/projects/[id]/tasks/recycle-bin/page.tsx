import { redirect } from 'next/navigation'

export interface NextTaskRecycleBinRedirectPageProps {
  params: Promise<{ id: string }> | { id: string }
}

/**
 * 任务回收站路由重定向同化（v3-ui-next-batch1-strategy-launch-tasks W4 · 4.9）。
 *
 * 访问 `/next/projects/:id/tasks/recycle-bin` 时，
 * 平滑重定向至单项目空间并携带 `drawer=recycle-bin` 参数，原地滑出回收站抽屉。
 */
export default async function NextTaskRecycleBinRedirectPage({
  params,
}: NextTaskRecycleBinRedirectPageProps) {
  const resolved = await Promise.resolve(params)
  const projectId = resolved.id
  redirect(`/next/projects/${projectId}?drawer=recycle-bin`)
}
