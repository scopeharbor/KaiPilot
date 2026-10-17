import { ProjectHeader } from '@/components/layout/ProjectHeader'
import { ProjectRealtimeBridge } from '@/components/layout/ProjectRealtimeBridge'
import { ProjectContextCommands } from '@/components/layout/ProjectContextCommands'
import { CustomViewManager } from '@/components/views/custom-views/CustomViewManager'

/**
 * 项目内路由 layout（build-app-shell-layout / spec project-view-tabs）：
 *
 * - 挂共享项目头（名称/描述/操作 + 统计 + 最近活动 + 6 视图 Tab）；
 * - 切换视图时项目头不重挂，`children` 由 App Router 增量替换（不整页重载）；
 * - 视图占位路由在 `(views)/*` 路由组下，落到 layout 的 `children` 位置；
 * - V2（v2-custom-views-view-config）：CustomViewManager 包裹 children，读取 URL
 *   `?customView=ID` 并为子视图注入自定义视图配置上下文。
 * - V2.5（command-palette-registry）：挂 `ProjectContextCommands` 注册项目级上下文命令
 *   （如「新建任务」），随 layout 生命周期注册/注销。
 */
interface ProjectDetailLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function ProjectDetailLayout({ children, params }: ProjectDetailLayoutProps) {
  const { id } = await params
  const projectId = Number(id)

  return (
    <>
      <ProjectRealtimeBridge projectId={Number.isFinite(projectId) ? projectId : undefined} />
      <ProjectHeader />
      {Number.isFinite(projectId) ? <ProjectContextCommands projectId={projectId} /> : null}
      <CustomViewManager>{children}</CustomViewManager>
    </>
  )
}
