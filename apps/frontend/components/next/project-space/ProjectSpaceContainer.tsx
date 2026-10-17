'use client'

import { CopyableCode } from '@/components/next/common/CopyableCode'
import { formatProjectCode } from '@aiproj/types'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { isEditableTarget } from '@/lib/command-registry/shortcut'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import { calendarDisplayApi, calendarDisplayKeys } from '@/lib/api/calendar-display'
import { KANBAN_COLUMNS, type KanbanColumn } from '@/lib/api/kanban'
import { useAuthStore } from '@/stores/auth-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { cn } from '@/lib/utils'
import { LensSwitcher, type ProjectSpaceLensId } from './LensSwitcher'
import { ManualTaskCreateDrawer } from './ManualTaskCreateDrawer'
import { ProjectDomainMenu } from './ProjectDomainMenu'
import { ProjectExportMenu } from '../export/ProjectExportMenu'
import { ProjectTimelineBar } from './ProjectTimelineBar'
import { TaskPlacementSlot } from './TaskPlacementSlot'
import { ProjectSignalCards } from '../signals/ProjectSignalCards'
import { WorkspaceCalendarLens } from '../lenses/WorkspaceCalendarLens'
import { WorkspaceKanbanBoard } from './WorkspaceKanbanBoard'
import { WorkspaceListLens } from '../lenses/WorkspaceListLens'
import { WorkspaceTimelineLens } from '../lenses/WorkspaceTimelineLens'
import { WorkspaceWbsLens } from '../lenses/WorkspaceWbsLens'
import { WorkspaceGanttLens } from '../gantt/WorkspaceGanttLens'
import { WorkspaceTaskDetailDrawer } from './WorkspaceTaskDetailDrawer'
import { TaskRecycleBinDrawer } from './TaskRecycleBinDrawer'

/** URL ?lens= 可解析的显式镜头白名单（缺省无参数即看板）。 */
const URL_LENS_WHITELIST: readonly ProjectSpaceLensId[] = [
  'gantt',
  'wbs',
  'list',
  'calendar',
  'timeline',
]

/** 从 URL 查询参数解析镜头 id（非法/缺省回落看板）。 */
function parseLensParam(params: URLSearchParams): ProjectSpaceLensId {
  const lensParam = params.get('lens')
  if (lensParam !== null && (URL_LENS_WHITELIST as readonly string[]).includes(lensParam)) {
    return lensParam as ProjectSpaceLensId
  }
  return 'kanban'
}

/** 从 URL 查询参数解析 focusTask 编号（非正整数非法参数安全忽略返回 null）。 */
function parseFocusTaskId(search: string | URLSearchParams | null): number | null {
  if (!search) return null
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const raw = params.get('focusTask')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** 从 URL 查询参数解析是否需要展开回收站抽屉（?drawer=recycle-bin）。 */
function parseRecycleBinOpen(search: string | URLSearchParams | null): boolean {
  if (!search) return false
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  return params.get('drawer') === 'recycle-bin'
}

/**
 * 单项目空间主骨架容器（v3-ui-next-project-space design Decision 1/2 / spec「项目空间路由与数据加载」）。
 *
 * - 项目详情经 `projectsApi.get` 载入（TanStack Query，缓存在 projectKeys.detail）；
 * - RL-05 组织隔离：接口 404 或 `project.organizationId` 与当前会话
 *   `currentOrganizationId` 不一致 → 统一中性 404 空态（data-project-space-empty="not_found"，
 *   文案仅「项目不存在或已被移除」），严禁泄露租户间资源存在性；
 * - 加载期渲染仪器感骨架屏（aria-busy="true"），杜绝内容跳动与空态误报；
 * - 顶栏坐标联动：项目加载成功即向 entity store 上报 project.name（NextAppShell
 *   订阅后经 resolveSpaceBreadcrumb 计算 `/next/projects/:id · <名称>` 回显）；
 * - 总装（W5）：工作面六镜头（看板/甘特/WBS/列表/日历/时间线）按 activeLens
 *   动态条件挂载于对应 -slot（统一标注 data-project-space-lens-slot），
 *   手动新建抽屉（ManualTaskCreateDrawer）与镜头切换器挂载于 Header 工具栏；
 *   全局快捷键 `P`（焦点非输入域时）唤起 pending 列放置卡（D5 第一方入口方式一，
 *   RL-01：展开本身零网络请求）；
 * - 沉浸阶梯：成功态根节点按档位切换氛围——immersive/light 消费 `.nx-space-atmosphere`
 *   深空光晕（precise 下由 CSS 规则彻底停用），精确档降级为纯色暗黑仪器面板；
 * - 高置信信号区（v3-triz-contradiction-copilot W6 · tasks 6.2 / design D17 ②）：
 *   成功态分支内 `<ProjectTimelineBar />` 与镜头槽组之间新增独立
 *   `<section data-project-space-signal-slot aria-label="项目信号区域">`，承载
 *   `ProjectSignalCards`（只读高置信信号卡 + 证据明细抽屉 + 「进入矛盾求解」跳转）；
 *   非覆盖式（不 fixed / 不绝对定位，不压镜头插槽），骨架 / 404 / 错误态零信号痕迹。
 */

export interface ProjectSpaceContainerProps {
  projectId: number
}

/** 404 判定（后端 RESOURCE_NOT_FOUND，跨租户掩蔽统一返回 HTTP 404）。 */
export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 404
  )
}

/** 中性 404 空态（RL-05）：仅提示「项目不存在或已被移除」，零租户存在性线索。 */
export function ProjectSpaceNotFoundView({ onBackHome }: { onBackHome: () => void }) {
  return (
    <div
      data-project-space-empty="not_found"
      role="status"
      aria-label="项目不存在或已被移除"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
    >
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">项目不存在或已被移除</h3>
      <button
        type="button"
        data-project-space-back-home
        onClick={onBackHome}
        className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
      >
        返回角色首页
      </button>
    </div>
  )
}

/** 非 404 加载失败（500 / 网络断开）：规范错误卡，可重新载入。 */
export function ProjectSpaceErrorView({
  onRetry,
  onBackHome,
}: {
  onRetry: () => void
  onBackHome: () => void
}) {
  return (
    <div
      data-project-space-empty="error"
      role="alert"
      aria-label="项目加载错误"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
    >
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">项目加载失败</h3>
      <p className="text-xs text-[var(--nx-text-muted)]">
        项目数据加载失败，请稍后重试或返回角色首页。
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-project-space-retry
          onClick={onRetry}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          重新载入
        </button>
        <button
          type="button"
          data-project-space-back-home
          onClick={onBackHome}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          返回角色首页
        </button>
      </div>
    </div>
  )
}

/** 仪器感加载骨架：发丝脉冲的主轴与看板列占位，禁止空态误报。 */
export function ProjectSpaceSkeleton() {
  return (
    <div
      data-project-space-skeleton
      role="status"
      aria-label="正在加载项目空间"
      aria-busy="true"
      className="flex flex-col gap-4"
    >
      <div className="h-9 w-2/5 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
      <div className="h-28 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((column) => (
          <div
            key={column}
            className="h-44 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
          />
        ))}
      </div>
    </div>
  )
}

export function ProjectSpaceContainer({ projectId }: ProjectSpaceContainerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const register = useProjectSpaceEntityStore((state) => state.register)
  const clear = useProjectSpaceEntityStore((state) => state.clear)
  const tier = useImmersionTier()

  // 读初始 lens 状态：从 window.location.search 解析（默认 kanban，不读 useSearchParams 快照）
  const [activeLens, setActiveLens] = React.useState<ProjectSpaceLensId>(() => {
    if (typeof window !== 'undefined') {
      return parseLensParam(new URLSearchParams(window.location.search))
    }
    return 'kanban'
  })

  // focusTask 解析与抽屉状态联动（W4 · 任务 4.3）
  const [focusTaskId, setFocusTaskId] = React.useState<number | null>(() => {
    if (typeof window !== 'undefined') {
      const fromWindow = parseFocusTaskId(window.location.search)
      if (fromWindow !== null) return fromWindow
    }
    return parseFocusTaskId(searchParams)
  })

  // 回收站抽屉联动状态（?drawer=recycle-bin）
  const [recycleBinOpen, setRecycleBinOpen] = React.useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      if (parseRecycleBinOpen(window.location.search)) return true
    }
    return parseRecycleBinOpen(searchParams)
  })

  // URL searchParams 响应同步
  React.useEffect(() => {
    const fromParams = parseFocusTaskId(searchParams)
    const fromWindow =
      typeof window !== 'undefined' ? parseFocusTaskId(window.location.search) : null
    setFocusTaskId(fromParams ?? fromWindow)

    const recycleParams = parseRecycleBinOpen(searchParams)
    const recycleWindow =
      typeof window !== 'undefined' ? parseRecycleBinOpen(window.location.search) : false
    setRecycleBinOpen(recycleParams || recycleWindow)
  }, [searchParams])

  // 点卡片打开详情抽屉：同步 ?focusTask=，刷新 / 分享链接可直达（此前看板没接这个回调，点卡片无反应）
  const handleOpenTask = React.useCallback((taskId: number) => {
    setFocusTaskId(taskId)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('focusTask', String(taskId))
      window.history.replaceState(null, '', url.pathname + url.search)
    }
  }, [])

  // 关闭详情抽屉：平滑剔除 focusTask 参数并 router.replace
  const handleCloseDetailDrawer = React.useCallback(
    (open: boolean) => {
      if (!open) {
        setFocusTaskId(null)
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href)
          url.searchParams.delete('focusTask')
          const nextSearch = url.search ? url.search : ''
          const nextPath = url.pathname + nextSearch
          window.history.replaceState(null, '', nextPath)
          router.replace(nextPath)
        }
      }
    },
    [router],
  )

  // 关闭回收站抽屉：平滑剔除 drawer 参数并 router.replace
  const handleCloseRecycleBinDrawer = React.useCallback(
    (open: boolean) => {
      setRecycleBinOpen(open)
      if (!open && typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.delete('drawer')
        const nextSearch = url.search ? url.search : ''
        const nextPath = url.pathname + nextSearch
        window.history.replaceState(null, '', nextPath)
        router.replace(nextPath)
      }
    },
    [router],
  )

  // 离开拦截守卫 ref：由 WorkspaceGanttLens 注册
  const requestLensSwitchRef = React.useRef<((lensId: ProjectSpaceLensId) => boolean) | null>(null)

  // 镜头切换函数（更新状态与 URL replaceState）
  const changeLens = React.useCallback((lensId: ProjectSpaceLensId) => {
    setActiveLens(lensId)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (lensId === 'kanban') {
        url.searchParams.delete('lens')
      } else {
        url.searchParams.set('lens', lensId)
      }
      window.history.replaceState(null, '', url.pathname + url.search)
    }
  }, [])

  // popstate 监听：浏览器前进后退时同步 lens, focusTask, recycle-bin 状态
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePopState = () => {
      setActiveLens(parseLensParam(new URLSearchParams(window.location.search)))
      setFocusTaskId(parseFocusTaskId(window.location.search))
      setRecycleBinOpen(parseRecycleBinOpen(window.location.search))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // LensSwitcher 点击切换处理：若当前在甘特镜头且存在守卫拦截，先经 requestLensSwitch 校验
  const handleLensSelect = React.useCallback(
    (lensId: ProjectSpaceLensId) => {
      if (activeLens === lensId) return
      if (activeLens === 'gantt' && requestLensSwitchRef.current) {
        const allowed = requestLensSwitchRef.current(lensId)
        if (!allowed) {
          // 被未保存变更阻断，离开确认弹窗已由 WorkspaceGanttLens 唤起
          return
        }
      }
      changeLens(lensId)
    },
    [activeLens, changeLens],
  )

  // D7 方式一（全局快捷键 P）：展开 pending 列放置卡；受控驱动各列 TaskPlacementSlot。
  const [placementColumn, setPlacementColumn] = React.useState<KanbanColumn | null>(null)

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'p' || event.metaKey || event.ctrlKey || event.altKey) return
      // 焦点在输入域时坚决不响应（与 useNextShortcuts 同一抑制口径）。
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      setPlacementColumn((current) => (current === 'pending' ? null : 'pending'))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const placementSlots: Partial<Record<KanbanColumn, React.ReactNode>> = React.useMemo(
    () =>
      Object.fromEntries(
        KANBAN_COLUMNS.map((column) => [
          column.id,
          <TaskPlacementSlot
            key={column.id}
            projectId={projectId}
            columnId={column.id}
            open={placementColumn === column.id}
            onOpenChange={(open) => setPlacementColumn(open ? column.id : null)}
          />,
        ]),
      ),
    [projectId, placementColumn],
  )

  // 日历曆法显示设定（个人 > 项目 > 组织 > 默认）；只在日历镜头需要时取
  const { data: calendarDisplay } = useQuery({
    queryKey: calendarDisplayKeys.detail(projectId),
    queryFn: () => calendarDisplayApi.get(projectId),
    enabled: activeLens === 'calendar',
    staleTime: 60_000,
  })

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

  // RL-05 组织隔离：跨组织项目视同不存在，绝不向客户端泄露资源属性。
  const orgMismatch =
    project !== undefined &&
    currentOrganizationId !== null &&
    project.organizationId !== currentOrganizationId
  const notFound = orgMismatch || (isError && isNotFoundError(error))

  // 顶栏坐标联动注册：项目加载成功且组织校验通过才上报名称；卸载 / 失败 / 越界即清空。
  React.useEffect(() => {
    if (project !== undefined && !orgMismatch) {
      register(projectId, project.name)
    } else {
      clear(projectId)
    }
    return () => clear(projectId)
  }, [project, orgMismatch, projectId, register, clear])

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
      data-project-space
      className={cn(
        'flex min-w-0 flex-col gap-4',
        // 沉浸阶梯：immersive/light 消费深空氛围光晕；精确档降级纯色仪器面板
        // （precise 的 `.nx-space-atmosphere::before` 停用规则在 next-tokens.css 全局生效）。
        tier === 'precise' ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere',
      )}
    >
      {/* 空间顶栏 Header：项目名称 · #编号 | 镜头切换器 | 手动新建（D7 第二入口） */}
      <header
        data-project-space-header
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex min-w-0 max-w-full items-center gap-3">
          <h2
            data-project-space-title
            className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
          >
            {project.name}
          </h2>
          <span data-project-space-code className="shrink-0">
            <CopyableCode code={formatProjectCode(project)} prefix="#" />
          </span>
        </div>
        <div className="flex min-w-0 w-full flex-wrap items-center gap-3 xl:w-auto">
          <LensSwitcher activeLensId={activeLens} onSelect={handleLensSelect} />
          <div
            data-project-space-toolbar-slot
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            {/* 功能域菜单（v3-ui-next-resource-team-domains W4 · tasks 4.1/4.3 扩展重组）：
                协同管理（资源工作台/成员与团队/项目文件库）+ 治理与分析（风险管理/
                变更请求/报表中心/图表馆）双分组入口，位于 LensSwitcher 与手动新建之间；
                风险与变更徽标在 QueryClient 可用时由菜单自取 useRiskSummary /
                useChangeRequests（design D2，缓存失效自动联动），LensSwitcher 六镜头
                纯粹性不变（资源/成员/文件严禁混入排程镜头）。 */}
            <ProjectDomainMenu projectId={projectId} />
            <ManualTaskCreateDrawer projectId={projectId} />
            <button
              type="button"
              data-project-space-recycle-bin-trigger
              aria-label="打开任务回收站"
              onClick={() => setRecycleBinOpen(true)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-accent)] hover:text-[var(--nx-text-primary)] cursor-pointer"
            >
              回收站
            </button>
            {/* 汇出菜单（v3-ui-next-chart-export W2 / v3-ui-next-remaining-lenses 5.4）：
                感知 activeLens 解析当前镜头工作面为截取目标 + 规范镜头中文文件名；
                仅成功态挂载，404 物理不可达（RL-05）。 */}
            <ProjectExportMenu
              projectId={projectId}
              entityName={project.name}
              activeLens={activeLens}
            />
          </div>
        </div>
      </header>

      {/* 时间主轴 HUD（过去 / 今天锚点 / 未来） */}
      <ProjectTimelineBar
        startDate={project.startDate}
        endDate={project.endDate}
        progressPercent={project.progressPercent}
      />

      {/* 高置信信号区（v3-triz-contradiction-copilot W6 · tasks 6.2 / design D17 ②）：
          独立 section 落在 ProjectTimelineBar 之后、镜头槽组之前——六镜头下均可见，
          处于工作面之上且参与文档流（非覆盖式，不压 [data-project-space-lens-slot]）；
          只在成功态挂载（骨架 / 404 / 错误态零信号痕迹）。 */}
      <section data-project-space-signal-slot aria-label="项目信号区域">
        <ProjectSignalCards projectId={projectId} />
      </section>

      {/* 工作面镜头插槽（v3-ui-next-remaining-lenses W5 总装）：六镜头按 activeLens
          动态条件挂载，统一标注 data-project-space-lens-slot + 各镜头专属 -slot 属性
          （汇出菜单经 resolveTarget 以通用镜头插槽定位当前工作面）。 */}
      {activeLens === 'gantt' ? (
        <section
          data-project-space-gantt-slot
          data-project-space-lens-slot
          aria-label="工作面甘特区域"
        >
          <WorkspaceGanttLens
            projectId={projectId}
            onRequestLensSwitchRef={requestLensSwitchRef}
            onLensChange={changeLens}
            onOpenTask={handleOpenTask}
            focusTaskId={focusTaskId}
          />
        </section>
      ) : null}
      {activeLens === 'wbs' ? (
        <section
          data-project-space-wbs-slot
          data-project-space-lens-slot
          aria-label="工作面WBS区域"
        >
          <WorkspaceWbsLens
            projectId={projectId}
            onOpenTask={handleOpenTask}
            focusTaskId={focusTaskId}
          />
        </section>
      ) : null}
      {activeLens === 'list' ? (
        <section
          data-project-space-list-slot
          data-project-space-lens-slot
          aria-label="工作面列表区域"
        >
          <WorkspaceListLens
            sharedDetail
            projectId={projectId}
            onOpenTask={(task) => handleOpenTask(task.id)}
          />
        </section>
      ) : null}
      {activeLens === 'calendar' ? (
        <section
          data-project-space-calendar-slot
          data-project-space-lens-slot
          aria-label="工作面日历区域"
        >
          <WorkspaceCalendarLens
            projectId={projectId}
            onOpenTask={handleOpenTask}
            focusTaskId={focusTaskId}
            calendarSystems={calendarDisplay?.systems}
          />
        </section>
      ) : null}
      {activeLens === 'timeline' ? (
        <section
          data-project-space-timeline-slot
          data-project-space-lens-slot
          aria-label="工作面时间线区域"
        >
          <WorkspaceTimelineLens
            projectId={projectId}
            onOpenTask={handleOpenTask}
            focusTaskId={focusTaskId}
          />
        </section>
      ) : null}
      {activeLens === 'kanban' ? (
        <section
          data-project-space-board-slot
          data-project-space-lens-slot
          aria-label="工作面看板区域"
        >
          <WorkspaceKanbanBoard
            projectId={projectId}
            placementSlots={placementSlots}
            onOpenTask={handleOpenTask}
          />
        </section>
      ) : null}

      {/* 任务详情内敛抽屉（W4 · 任务 4.1/4.3：拔除 ?focusTask= 技术债） */}
      <WorkspaceTaskDetailDrawer
        projectId={projectId}
        projectCode={project?.code ?? null}
        taskId={focusTaskId}
        open={focusTaskId !== null}
        onOpenChange={handleCloseDetailDrawer}
      />

      {/* 任务回收站内敛管理抽屉（W4 · 任务 4.5） */}
      <TaskRecycleBinDrawer
        projectId={projectId}
        open={recycleBinOpen}
        onOpenChange={handleCloseRecycleBinDrawer}
      />
    </div>
  )
}

export default ProjectSpaceContainer
