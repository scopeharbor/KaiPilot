'use client'

import { GanttChart } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useCallback, useMemo, useRef, useState } from 'react'
import { GanttView } from '@/components/views/gantt/GanttView'
import { MilestoneManager } from '@/components/views/gantt/milestones/MilestoneManager'
import { GanttBaselineControls } from '@/components/views/gantt/baseline/GanttBaselineControls'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useProjectGanttModel } from '@/hooks/use-project-gantt'
import { useGanttInteraction } from '@/hooks/use-gantt-interaction'
import { usePermissions } from '@/hooks/use-permissions'
import { useGanttBaseline } from '@/hooks/use-gantt-baseline'
import { useGanttStore } from '@/stores/gantt-store'
import { Button } from '@/components/ui/Button'
import { TaskDependenciesPanel } from '@/components/tasks/TaskDependenciesPanel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { applySchedulePreviewToModel } from '@/lib/gantt/model-from-api'
import { applyBaselineToModel, summarizeBaselineDeviation } from '@/lib/gantt/baseline'
import type { DependencyType } from '@/lib/gantt/types'

const DAY_MS = 86_400_000

function dayToIso(epochMs: number, day: number) {
  return new Date(epochMs + day * DAY_MS).toISOString().slice(0, 10)
}

/** 项目内甘特图视图（spec gantt-render-engine T018 + V2 交互升级）：拉真实 tasks + dependencies 渲染。 */
export default function ProjectGanttPage() {
  const params = useParams()
  const projectId = Number(params.id)
  const { model, project, isLoading, isError } = useProjectGanttModel(projectId)
  const { can, canAny } = usePermissions()
  const baselineQuery = useGanttBaseline(projectId)
  const compareBaseline = useGanttStore((s) => s.compareBaseline)
  const setCompareBaseline = useGanttStore((s) => s.setCompareBaseline)
  const interaction = useGanttInteraction(projectId, model ?? null, project ?? null)
  const {
    schedule,
    schedulePreview,
    previewSchedule,
    commitSchedule,
    cancelSchedule,
    dependencyDraft,
    dependencyType,
    setDependencyType,
    lagDays,
    setLagDays,
    openDependency,
    confirmDependency,
    cancelDependency,
    createDependency,
    needsScheduleTaskId,
    previewDependencySchedule,
    milestoneDraft,
    openMilestoneAdjust,
    confirmMilestoneAdjust,
    cancelMilestoneAdjust,
    milestonePending,
    progressDraft,
    openProgressAdjust,
    confirmProgressAdjust,
    cancelProgressAdjust,
    progressPending,
  } = interaction
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const ganttExportRef = useRef<HTMLDivElement>(null)
  const lastInteractionTriggerRef = useRef<HTMLElement | null>(null)

  const editable = can('task:update')
  const dependencyEditable = canAny(['task:update', 'task:update:self'])

  // preview 激活时把变更应用到模型并重算关键路径，拖拽期间高亮随 preview 实时变化（T021 task 5.1）。
  const scheduledModel = useMemo(() => {
    if (!model || !schedulePreview || schedulePreview.changes.length === 0) return model
    return applySchedulePreviewToModel(model, schedulePreview.changes, schedulePreview.calendar)
  }, [model, schedulePreview])
  const displayModel = useMemo(
    () =>
      scheduledModel && compareBaseline
        ? applyBaselineToModel(scheduledModel, baselineQuery.data ?? null)
        : scheduledModel,
    [baselineQuery.data, compareBaseline, scheduledModel],
  )
  const baselineSummary = useMemo(() => {
    const current = scheduledModel ?? model
    return current
      ? summarizeBaselineDeviation(current, baselineQuery.data ?? null)
      : { early: 0, late: 0, unchanged: 0, added: 0, deleted: 0 }
  }, [baselineQuery.data, model, scheduledModel])

  const rememberInteractionTrigger = useCallback(() => {
    const active = typeof document !== 'undefined' ? document.activeElement : null
    lastInteractionTriggerRef.current = active instanceof HTMLElement ? active : null
  }, [])

  const restoreInteractionFocus = useCallback((event?: Event) => {
    const target = lastInteractionTriggerRef.current
    if (!target || !document.contains(target)) return
    event?.preventDefault()
    target.focus({ preventScroll: true })
  }, [])

  const handleScheduleDraft = useCallback(
    (draft: Parameters<typeof previewSchedule>[0]) => {
      rememberInteractionTrigger()
      void previewSchedule(draft)
    },
    [previewSchedule, rememberInteractionTrigger],
  )

  const handleDependencyDraft = useCallback(
    (draft: Parameters<typeof openDependency>[0]) => {
      rememberInteractionTrigger()
      openDependency(draft)
    },
    [openDependency, rememberInteractionTrigger],
  )

  const handleMilestoneDraft = useCallback(
    (draft: Parameters<typeof openMilestoneAdjust>[0]) => {
      rememberInteractionTrigger()
      openMilestoneAdjust(draft)
    },
    [openMilestoneAdjust, rememberInteractionTrigger],
  )

  const handleProgressDraft = useCallback(
    (draft: Parameters<typeof openProgressAdjust>[0]) => {
      rememberInteractionTrigger()
      openProgressAdjust(draft)
    },
    [openProgressAdjust, rememberInteractionTrigger],
  )

  const handleTaskSelect = useCallback(
    (taskId: number) => {
      rememberInteractionTrigger()
      setSelectedTaskId(taskId)
    },
    [rememberInteractionTrigger],
  )

  if (isLoading) {
    return (
      <div
        className="flex h-[calc(100vh-13rem)] min-h-[480px] flex-col gap-4 py-4"
        aria-busy="true"
      >
        <BrandLoader size={64} label="正在载入甘特图数据…" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-full w-full flex-1" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="py-10">
        <EmptyState
          icon={GanttChart}
          title="甘特图加载失败"
          description="拉取任务或依赖时出错，请稍后重试。"
        />
      </div>
    )
  }

  if (!model || model.tasks.length === 0) {
    return (
      <div className="py-10">
        <EmptyState
          icon={GanttChart}
          title="暂无任务可展示"
          description="为项目添加带起止日期的任务后，甘特图会在此呈现任务条、依赖与关键路径。"
        />
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-13rem)] min-h-[480px] py-4">
      {needsScheduleTaskId !== null ? (
        <div className="mb-2 flex items-center justify-between rounded-[var(--radius-md)] border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
          <span>依赖已保存；任务日期尚未自动改变。</span>
          <Button size="sm" variant="outline" onClick={previewDependencySchedule}>
            预览排程调整
          </Button>
        </div>
      ) : null}
      <div ref={ganttExportRef} className="h-full">
        <GanttView
          model={displayModel ?? model}
          editable={editable}
          dependencyEditable={dependencyEditable}
          onScheduleDraft={handleScheduleDraft}
          onDependencyDraft={handleDependencyDraft}
          onMilestoneDraft={handleMilestoneDraft}
          onProgressDraft={handleProgressDraft}
          onTaskSelect={handleTaskSelect}
          baselineSummary={baselineSummary}
          toolbarExtra={
            <>
              <MilestoneManager projectId={projectId} />
              <GanttBaselineControls
                projectId={projectId}
                baseline={baselineQuery.data}
                baselineLoading={baselineQuery.isLoading}
                compareEnabled={compareBaseline}
                onCompareChange={setCompareBaseline}
                summary={baselineSummary}
                exportTarget={ganttExportRef}
                canSave={editable}
              />
            </>
          }
        />
      </div>

      <Dialog
        open={schedulePreview !== null}
        onOpenChange={(open) => {
          if (!open && !schedule.isPending) cancelSchedule()
        }}
      >
        <DialogContent className="max-w-2xl" onCloseAutoFocus={restoreInteractionFocus}>
          <DialogHeader>
            <DialogTitle>确认排程调整</DialogTitle>
            <DialogDescription aria-live="polite">
              将影响 {schedulePreview?.changes.length ?? 0} 个任务。确认前不会写入正式排期。
            </DialogDescription>
          </DialogHeader>
          {schedulePreview?.conflicts.length ? (
            <div className="rounded-[var(--radius-md)] border border-danger bg-danger-bg p-3 text-sm text-danger">
              {schedulePreview.conflicts.map((conflict) => (
                <p key={`${conflict.taskId}-${conflict.code}`}>
                  {conflict.taskName}：{conflict.message}
                </p>
              ))}
            </div>
          ) : null}
          <div className="max-h-72 overflow-auto rounded-[var(--radius-md)] border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-muted">
                <tr>
                  <th className="px-3 py-2">任务</th>
                  <th className="px-3 py-2">调整前</th>
                  <th className="px-3 py-2">调整后</th>
                </tr>
              </thead>
              <tbody>
                {schedulePreview?.changes.map((change) => (
                  <tr key={change.taskId} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{change.taskName}</td>
                    <td className="px-3 py-2 text-muted">
                      {change.before.startDate} → {change.before.endDate}
                    </td>
                    <td className="px-3 py-2">
                      {change.after.startDate} → {change.after.endDate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {schedulePreview?.warnings.map((warning) => (
            <p key={warning} className="text-sm text-warning">
              {warning}
            </p>
          ))}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={schedule.isPending}
              onClick={cancelSchedule}
              aria-label="取消排程预览并返回甘特图"
            >
              取消
            </Button>
            <Button
              loading={schedule.isPending}
              disabled={
                !schedulePreview?.changes.length || Boolean(schedulePreview?.conflicts.length)
              }
              onClick={() => void commitSchedule()}
              aria-label="确认排程调整并返回甘特图"
            >
              确认调整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dependencyDraft !== null} onOpenChange={(open) => !open && cancelDependency()}>
        <DialogContent onCloseAutoFocus={restoreInteractionFocus}>
          <DialogHeader>
            <DialogTitle>建立任务依赖</DialogTitle>
            <DialogDescription>
              确认依赖类型与 Lag/Lead；日期不会在本步骤自动改变。
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">依赖类型</span>
            <select
              className="h-9 rounded-[var(--radius-md)] border border-border bg-gray-0 px-3"
              value={dependencyType}
              onChange={(event) => setDependencyType(event.target.value as DependencyType)}
            >
              <option value="fs">FS 完成→开始</option>
              <option value="ss">SS 开始→开始</option>
              <option value="ff">FF 完成→完成</option>
              <option value="sf">SF 开始→完成</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Lag / Lead（工作日）</span>
            <input
              className="h-9 rounded-[var(--radius-md)] border border-border bg-gray-0 px-3"
              type="number"
              min={-999}
              max={999}
              value={lagDays}
              onChange={(event) => setLagDays(Number(event.target.value))}
            />
          </label>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={cancelDependency}
              aria-label="取消建立依赖并返回甘特图"
            >
              取消
            </Button>
            <Button
              loading={createDependency.isPending}
              onClick={() => void confirmDependency()}
              aria-label="确认建立依赖并返回甘特图"
            >
              建立依赖
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedTaskId !== null}
        onOpenChange={(open) => !open && setSelectedTaskId(null)}
      >
        <DialogContent
          className="max-h-[85vh] max-w-4xl overflow-auto"
          onCloseAutoFocus={restoreInteractionFocus}
        >
          <DialogHeader>
            <DialogTitle>任务依赖详情</DialogTitle>
            <DialogDescription>
              查看或删除当前任务的前置与后续依赖。删除后任务日期不会自动改变。
            </DialogDescription>
          </DialogHeader>
          {selectedTaskId !== null ? (
            <TaskDependenciesPanel
              projectId={projectId}
              taskId={selectedTaskId}
              canEdit={dependencyEditable}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 里程碑目标日期确认（task 2.5）：确认前不写入，仅改 plannedDate。 */}
      <Dialog
        open={milestoneDraft !== null}
        onOpenChange={(open) => !open && cancelMilestoneAdjust()}
      >
        <DialogContent onCloseAutoFocus={restoreInteractionFocus}>
          <DialogHeader>
            <DialogTitle>确认里程碑日期调整</DialogTitle>
            <DialogDescription>
              仅调整里程碑目标日期，确认前不会写入。任务、依赖与基线不会因此改变。
            </DialogDescription>
          </DialogHeader>
          {milestoneDraft ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">里程碑</dt>
              <dd className="font-medium">
                {model.tasks.find((t) => t.id === milestoneDraft.taskId)?.name ?? '里程碑'}
              </dd>
              <dt className="text-muted">调整前</dt>
              <dd className="text-muted">
                {dayToIso(
                  model.epochMs,
                  model.tasks.find((t) => t.id === milestoneDraft.taskId)?.startDay ??
                    milestoneDraft.day,
                )}
              </dd>
              <dt className="text-muted">调整后</dt>
              <dd>{dayToIso(model.epochMs, milestoneDraft.day)}</dd>
            </dl>
          ) : null}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={milestonePending}
              onClick={cancelMilestoneAdjust}
              aria-label="取消里程碑日期调整并返回甘特图"
            >
              取消
            </Button>
            <Button
              loading={milestonePending}
              onClick={() => void confirmMilestoneAdjust()}
              aria-label="确认里程碑日期调整并返回甘特图"
            >
              确认调整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 任务进度确认（task 2.6）：确认前不写入，只改进度，禁止隐式改期。 */}
      <Dialog
        open={progressDraft !== null}
        onOpenChange={(open) => !open && cancelProgressAdjust()}
      >
        <DialogContent onCloseAutoFocus={restoreInteractionFocus}>
          <DialogHeader>
            <DialogTitle>确认进度调整</DialogTitle>
            <DialogDescription>
              仅调整任务完成度，确认前不会写入。任务起止日期、依赖与里程碑不会因此改变。
            </DialogDescription>
          </DialogHeader>
          {progressDraft ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">任务</dt>
              <dd className="font-medium">
                {model.tasks.find((t) => t.id === progressDraft.taskId)?.name ?? '任务'}
              </dd>
              <dt className="text-muted">调整前</dt>
              <dd className="text-muted">
                {Math.round(
                  (model.tasks.find((t) => t.id === progressDraft.taskId)?.progress ?? 0) * 100,
                )}
                %
              </dd>
              <dt className="text-muted">调整后</dt>
              <dd>{Math.round(progressDraft.progress * 100)}%</dd>
            </dl>
          ) : null}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={progressPending}
              onClick={cancelProgressAdjust}
              aria-label="取消进度调整并返回甘特图"
            >
              取消
            </Button>
            <Button
              loading={progressPending}
              onClick={() => void confirmProgressAdjust()}
              aria-label="确认进度调整并返回甘特图"
            >
              确认调整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
