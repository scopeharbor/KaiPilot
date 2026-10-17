import { redirect } from 'next/navigation'

/**
 * 新轨新建项目入口（v3-ui-next-batch1-strategy-launch-tasks W2 任务 2.7）。
 *
 * 淘汰独立旧版项目新建表单，平滑定向至生成剧场手动模式 `/next/create?mode=manual`，
 * 杜绝传统旧表单搬家与 404 悬空。
 */
export default function NewProjectRedirectPage() {
  redirect('/next/create?mode=manual')
}
