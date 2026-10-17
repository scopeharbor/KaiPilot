/**
 * 新轨甘特镜头工作面（v3-ui-next-gantt-lens W4 tasks 4.1 / spec「甘特时间镜头渲染与性能预算」）。
 *
 * 核心架构职责：
 * 1. 数据加载：消费 `useNextGanttModel(projectId)`，并行拉满 1000 任务/依赖/里程碑；
 * 2. 沉浸阶梯切换：消费 `useImmersionTier()` 与 `prefers-reduced-motion`，在 precise 档
 *    或减弱动画下自动挂载纯 DOM 高密度表格（`WorkspaceGanttPreciseTable`），
 *    否则挂载暗黑仪器感 SVG 画板（`WorkspaceGanttChart`）；
 * 3. What-if 沙盒编排：挂载 `useWhatIfSession`，在试算激活时（active/stale）
 *    将派生模型（`session.derivedPreview.model`）同时传给 SVG 画板与精确档表格；
 * 4. 拖拽手柄装配：集成 `useGanttDragInteraction`，将平移/拉伸/里程碑手柄
 *    spread 到画板图元（与 W1 的 barLayout/data-task-id 对齐）；
 * 5. HUD 与两阶段提交：挂载 `WorkspaceGanttWhatIfHud`，接通 `applySession()`
 *    两阶段原子提交（preview→commit）并反馈 outcome；
 * 6. 离开拦截守卫：挂载 `useGanttNavigationGuard` 与 `WorkspaceGanttLeaveDialog`，
 *    通过 `onRequestLensSwitchRef` 与父级空间容器的 `LensSwitcher` 形成受控拦截闭环。
 */

'use client'

import * as React from 'react'
import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'
import { MobileGanttSchedule } from './MobileGanttSchedule'
import type { StoreApi, UseBoundStore } from 'zustand'
import { cn } from '@/lib/utils'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { useGanttStore, type GanttViewState } from '@/stores/gantt-store'
import { useNextGanttModel, NX_PX_PER_DAY } from '@/lib/gantt/next-gantt-adapter'
import { useWhatIfSession } from '@/hooks/use-what-if-session'
import { useGanttDragInteraction } from '@/hooks/use-gantt-drag-interaction'
import { useGanttNavigationGuard } from '@/hooks/use-gantt-navigation-guard'
import type { ProjectSpaceLensId } from '@/components/next/project-space/LensSwitcher'
import { WorkspaceGanttChart } from './WorkspaceGanttChart'
import { WorkspaceGanttPreciseTable } from './WorkspaceGanttPreciseTable'
import { WorkspaceGanttWhatIfHud } from './WorkspaceGanttWhatIfHud'
import { WorkspaceGanttLeaveDialog } from './WorkspaceGanttLeaveDialog'

export interface WorkspaceGanttLensProps {
  projectId: number
  className?: string
  /** 镜头切换通知（例如放弃并离开模态框放行时触发）。 */
  onLensChange?: (lensId: ProjectSpaceLensId) => void
  /** 父级注入的 ref，在 LensSwitcher 点击时调用以触发拦截守卫。 */
  onRequestLensSwitchRef?: React.MutableRefObject<((lensId: ProjectSpaceLensId) => boolean) | null>
  /** 可选：首屏渲染完成度量（性能预算测试消费）。 */
  onRenderComplete?: (metric: { durationMs: number; activeElements: number }) => void
  /** 可选测试注入：自定义 gantt store 实例。 */
  store?: UseBoundStore<StoreApi<GanttViewState>>
  /** 打开任务详情（容器同步 ?focusTask=）。 */
  onOpenTask?: (taskId: number) => void
  /** 聚焦任务：滚动到该任务并选中。 */
  focusTaskId?: number | null
}

/** 仪器感甘特骨架加载屏。 */
export function WorkspaceGanttLensSkeleton() {
  return (
    <div
      data-gantt-lens-skeleton
      role="status"
      aria-label="正在加载甘特排程"
      aria-busy="true"
      className="flex h-[600px] flex-col rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-4"
    >
      <div className="flex h-9 items-center justify-between border-b border-[var(--nx-border-hairline)] pb-2">
        <div className="flex gap-2">
          <div className="h-6 w-12 animate-pulse rounded bg-[var(--nx-bg-1)]" />
          <div className="h-6 w-12 animate-pulse rounded bg-[var(--nx-bg-1)]" />
          <div className="h-6 w-12 animate-pulse rounded bg-[var(--nx-bg-1)]" />
        </div>
        <div className="h-6 w-24 animate-pulse rounded bg-[var(--nx-bg-1)]" />
      </div>
      <div className="flex flex-1 flex-col gap-3 py-4">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-6 w-32 animate-pulse rounded bg-[var(--nx-bg-1)]" />
            <div
              className="h-6 animate-pulse rounded bg-[var(--nx-workspace-surface)]"
              style={{
                width: `${Math.max(120, ((i * 70) % 360) + 100)}px`,
                marginLeft: `${(i * 45) % 200}px`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export function WorkspaceGanttLens({
  projectId,
  className,
  onLensChange,
  onRequestLensSwitchRef,
  onRenderComplete,
  store,
  onOpenTask,
  focusTaskId = null,
}: WorkspaceGanttLensProps) {
  const mobile = useMobileWorkspace()
  const [mobileOverview, setMobileOverview] = React.useState(false)
  const tier = useImmersionTier()
  const { can } = usePermissions()
  // 甘特编辑即改排期，只对项目管理者开放（与后端 authorizeScheduleChange 一致）
  const canEdit = can('task:update')

  // 1. 数据取数（复用 useNextGanttModel，拉满 1000 任务、依赖、里程碑）
  const { model, isLoading, isError, error } = useNextGanttModel(projectId)

  // 2. What-if 会话控制器
  const whatIf = useWhatIfSession(projectId, {
    model,
    calendarSettings: null,
  })
  const { session, applySession, enterSession, executeCommand } = whatIf

  // 3. 试算激活判定与展示模型（试算激活时两套视图均传 derivedPreview.model）
  // 提交失败（error）仍算试算中：保留试算画面与横幅，用户可修正 / 撤销 / 放弃（原先 error 态
  // 横幅消失、拖拽被拒，只能刷新页面）
  const isWhatIfActive =
    session.status === 'active' || session.status === 'stale' || session.status === 'error'
  const displayModel = React.useMemo(() => {
    if (isWhatIfActive && session.derivedPreview) {
      return session.derivedPreview.model
    }
    return model
  }, [isWhatIfActive, session.derivedPreview, model])

  // 4. 粒度与时间换算密度（用于整数天吸附与拖拽）
  const useStore = store ?? useGanttStore
  const granularity = useStore((s) => s.granularity)
  const nextGranularity = granularity === 'quarter' ? 'month' : granularity
  const pxPerDay = NX_PX_PER_DAY[nextGranularity]

  // 5. 拖拽排程交互（PointerSensor + 网格吸附 + 幽灵条 + RBAC 防线）
  const dragInteraction = useGanttDragInteraction({
    tasks: displayModel?.tasks ?? [],
    dependencies: displayModel?.dependencies ?? [],
    calendarSettings: null,
    epochMs: displayModel?.epochMs ?? Date.now(),
    pxPerDay,
    projectId,
  })

  // 6. 双通道未保存离开拦截守卫
  const guard = useGanttNavigationGuard({
    onLensSelect: onLensChange,
  })

  // 注册给父级容器的 LensSwitcher
  React.useEffect(() => {
    if (onRequestLensSwitchRef) {
      onRequestLensSwitchRef.current = guard.requestLensSwitch
    }
    return () => {
      if (onRequestLensSwitchRef) {
        onRequestLensSwitchRef.current = null
      }
    }
  }, [guard.requestLensSwitch, onRequestLensSwitchRef])

  // 7. 减弱动效偏好监听
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(media.matches)
    const listener = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  // 精确档或减弱动效下切换为纯 DOM 表格
  const isPreciseMode = tier === 'precise' || prefersReducedMotion

  // 8. 提交状态管理
  const [applying, setApplying] = React.useState(false)
  const handleApply = React.useCallback(async () => {
    setApplying(true)
    try {
      await applySession()
    } finally {
      setApplying(false)
    }
  }, [applySession])

  // ── 加载与错误分支 ─────────────────────────────────────────────
  if (isLoading) {
    return <WorkspaceGanttLensSkeleton />
  }

  if (isError || !model || !displayModel) {
    return (
      <div
        data-gantt-lens-error
        role="alert"
        className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-6 text-center"
      >
        <p className="text-sm font-medium text-[var(--nx-status-danger)]">甘特排程数据加载失败</p>
        <p className="text-xs text-[var(--nx-text-muted)]">
          {error instanceof Error ? error.message : '请稍后重试或检查网络连接'}
        </p>
      </div>
    )
  }

  return (
    <div
      data-gantt-lens
      data-what-if-active={isWhatIfActive ? 'true' : undefined}
      className={cn(
        'relative flex h-[calc(100dvh-15rem)] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] sm:min-h-[520px]',
        isWhatIfActive && 'ring-1 ring-[var(--nx-status-warning)]/60',
        className,
      )}
    >
      {mobile ? (
        <div
          role="group"
          aria-label="排程展示方式"
          className="grid shrink-0 grid-cols-2 gap-2 border-b border-[var(--nx-border-hairline)] p-2"
        >
          <button
            type="button"
            aria-pressed={!mobileOverview}
            onClick={() => setMobileOverview(false)}
            className={`min-h-11 rounded-lg text-sm ${!mobileOverview ? 'bg-[var(--nx-bg-0)] text-[var(--nx-accent)]' : ''}`}
          >
            任务排程
          </button>
          <button
            type="button"
            aria-pressed={mobileOverview}
            onClick={() => setMobileOverview(true)}
            className={`min-h-11 rounded-lg text-sm ${mobileOverview ? 'bg-[var(--nx-bg-0)] text-[var(--nx-accent)]' : ''}`}
          >
            图形总览
          </button>
        </div>
      ) : null}
      {/* 顶部 What-if 试算控制横幅（活跃态弹出，含浓缩影响标签与操作按钮） */}
      {isWhatIfActive ? (
        <div className="p-2 border-b border-[var(--nx-border-hairline)]">
          <WorkspaceGanttWhatIfHud onApply={handleApply} applying={applying} />
        </div>
      ) : null}

      {/* 画板主体：精确档表格 vs 暗黑仪器感 SVG 画板 */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {mobile && !mobileOverview ? (
          <MobileGanttSchedule model={displayModel} onOpenTask={onOpenTask} />
        ) : isPreciseMode && !mobile ? (
          <WorkspaceGanttPreciseTable
            model={displayModel}
            canEdit={canEdit}
            session={{
              status: session.status,
              enterSession: () => {
                enterSession()
              },
              executeCommand: (cmd) => executeCommand(cmd),
            }}
            onOpenTask={onOpenTask}
            focusTaskId={focusTaskId}
          />
        ) : (
          <WorkspaceGanttChart
            className="min-h-0 flex-1"
            model={displayModel}
            store={store}
            onRenderComplete={onRenderComplete}
            getMoveHandleProps={mobile ? undefined : dragInteraction.getMoveHandleProps}
            getResizeHandleProps={mobile ? undefined : dragInteraction.getResizeHandleProps}
            getMilestoneHandleProps={mobile ? undefined : dragInteraction.getMilestoneHandleProps}
            ghost={dragInteraction.ghost}
            onOpenTask={onOpenTask}
            focusTaskId={focusTaskId}
          />
        )}
      </div>

      {/* 未保存离开阻断模态框 */}
      <WorkspaceGanttLeaveDialog
        open={guard.dialogOpen}
        navigationLabel={guard.pendingLabel}
        onStay={guard.stay}
        onDiscardAndLeave={guard.discardAndLeave}
      />
    </div>
  )
}

export default WorkspaceGanttLens
