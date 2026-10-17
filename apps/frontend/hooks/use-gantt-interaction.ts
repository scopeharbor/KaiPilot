'use client'

import { useCallback, useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { useGanttSchedule } from '@/hooks/use-gantt-scheduling'
import { useCreateProjectDependency } from '@/hooks/use-task-dependencies'
import { useAdjustMilestoneDate, useAdjustTaskProgress } from '@/hooks/use-gantt-adjustments'
import type { GanttScheduleRequest, GanttScheduleResponse } from '@/lib/api/gantt-scheduling'
import type { Project } from '@/lib/api/projects'
import type { DependencyType, GanttModel, GanttScheduleDraft } from '@/lib/gantt/types'
import type {
  GanttDependencyDraft,
  GanttMilestoneDateDraft,
  GanttProgressDraft,
} from '@/lib/gantt/interaction-types'
import { shiftIsoByWorkingDays, snapIsoToWorkingDay } from '@/lib/gantt/working-calendar'

const DAY_MS = 86_400_000

function dayToIso(epochMs: number, day: number) {
  return new Date(epochMs + day * DAY_MS).toISOString().slice(0, 10)
}

/**
 * 甘特交互编排 hook（task 1.3，design D2）。
 *
 * 把原先散落在 `ProjectGanttPage` 的 schedule preview/commit、依赖草稿、依赖建立后
 * 「预览排程调整」等**编排状态**收拢到一处：页面只保留展示模型 memo 与对话框渲染，
 * 交互状态与 mutation 顺序在此维护。行为与迁移前保持一致（同一 preview→confirm→commit 流程）。
 */
export function useGanttInteraction(
  projectId: number,
  model: GanttModel | null,
  project: Project | null,
) {
  const schedule = useGanttSchedule(projectId)
  const createDependency = useCreateProjectDependency(projectId)
  // 里程碑/进度确认写入拆成独立 hook（task 2.5/2.6），便于组件测试隔离 mock。
  const milestoneMutation = useAdjustMilestoneDate(projectId)
  const progressMutation = useAdjustTaskProgress(projectId)
  const { toast } = useToast()

  const [scheduleIntent, setScheduleIntent] = useState<GanttScheduleRequest | null>(null)
  const [schedulePreview, setSchedulePreview] = useState<GanttScheduleResponse | null>(null)
  const [dependencyDraft, setDependencyDraft] = useState<GanttDependencyDraft | null>(null)
  const [dependencyType, setDependencyType] = useState<DependencyType>('fs')
  const [lagDays, setLagDays] = useState(0)
  const [needsScheduleTaskId, setNeedsScheduleTaskId] = useState<number | null>(null)
  const [milestoneDraft, setMilestoneDraft] = useState<GanttMilestoneDateDraft | null>(null)
  const [progressDraft, setProgressDraft] = useState<GanttProgressDraft | null>(null)

  const previewSchedule = useCallback(
    async (draft: GanttScheduleDraft) => {
      if (!model || !project) return
      const task = model.tasks.find((item) => item.id === draft.taskId)
      if (!task) return
      const originalStart = dayToIso(model.epochMs, task.startDay)
      const originalEnd = dayToIso(
        model.epochMs,
        task.startDay + Math.max(1, task.durationDays) - 1,
      )
      const rawStart =
        draft.operation === 'move'
          ? shiftIsoByWorkingDays(originalStart, draft.startDay - task.startDay, project.settings)
          : originalStart
      const rawEnd =
        draft.operation === 'resize'
          ? shiftIsoByWorkingDays(
              originalEnd,
              draft.endDay - (task.startDay + Math.max(1, task.durationDays) - 1),
              project.settings,
            )
          : draft.operation === 'move'
            ? rawStart
            : dayToIso(model.epochMs, draft.endDay)
      const intent: GanttScheduleRequest = {
        mode: 'preview',
        taskId: draft.taskId,
        operation: draft.operation,
        startDate: snapIsoToWorkingDay(rawStart, project.settings, 1),
        endDate: snapIsoToWorkingDay(rawEnd, project.settings, 1),
        autoSchedule: true,
      }
      try {
        const result = await schedule.mutateAsync(intent)
        setScheduleIntent(intent)
        setSchedulePreview(result)
      } catch {
        // mutation 已通过统一 Toast 反馈。
      }
    },
    [model, project, schedule],
  )

  const commitSchedule = useCallback(async () => {
    if (!scheduleIntent || !schedulePreview) return
    try {
      await schedule.mutateAsync({
        ...scheduleIntent,
        mode: 'commit',
        previewToken: schedulePreview.previewToken,
      })
      setSchedulePreview(null)
      setScheduleIntent(null)
      setNeedsScheduleTaskId(null)
    } catch {
      // 409 保留 preview，用户可取消并重新操作。
    }
  }, [schedule, scheduleIntent, schedulePreview])

  const cancelSchedule = useCallback(() => {
    setSchedulePreview(null)
    setScheduleIntent(null)
  }, [])

  const openDependency = useCallback(
    (draft: GanttDependencyDraft) => {
      if (draft.predecessorId === draft.successorId) {
        toast({ variant: 'error', title: '任务不能依赖自身' })
        return
      }
      setDependencyDraft(draft)
      setDependencyType(draft.type)
      setLagDays(0)
    },
    [toast],
  )

  const confirmDependency = useCallback(async () => {
    if (!dependencyDraft) return
    try {
      await createDependency.mutateAsync({
        successorId: dependencyDraft.successorId,
        input: {
          predecessorId: dependencyDraft.predecessorId,
          type: dependencyType,
          lagDays,
        },
      })
      setNeedsScheduleTaskId(dependencyDraft.predecessorId)
      setDependencyDraft(null)
    } catch {
      // mutation 已反馈重复、循环与权限错误。
    }
  }, [createDependency, dependencyDraft, dependencyType, lagDays])

  const cancelDependency = useCallback(() => setDependencyDraft(null), [])

  const previewDependencySchedule = useCallback(() => {
    if (!model || needsScheduleTaskId === null) return
    const task = model.tasks.find((item) => item.id === needsScheduleTaskId)
    if (!task) return
    void previewSchedule({
      taskId: task.id,
      operation: 'move',
      startDay: task.startDay,
      endDay: task.startDay + Math.max(1, task.durationDays) - 1,
    })
  }, [model, needsScheduleTaskId, previewSchedule])

  // 里程碑日期草稿：拖拽/键盘产出，确认前不写入（design D2）。
  const openMilestoneAdjust = useCallback((draft: GanttMilestoneDateDraft) => {
    setMilestoneDraft(draft)
  }, [])
  const cancelMilestoneAdjust = useCallback(() => setMilestoneDraft(null), [])
  const confirmMilestoneAdjust = useCallback(async () => {
    if (!model || !milestoneDraft) return
    try {
      await milestoneMutation.mutateAsync({
        milestoneId: milestoneDraft.milestoneId,
        plannedDate: dayToIso(model.epochMs, milestoneDraft.day),
      })
      setMilestoneDraft(null)
    } catch {
      // mutation 已通过 Toast 反馈。
    }
  }, [milestoneDraft, milestoneMutation, model])

  // 进度草稿：确认前只展示待确认摘要，确认后仅改进度。
  const openProgressAdjust = useCallback((draft: GanttProgressDraft) => {
    setProgressDraft(draft)
  }, [])
  const cancelProgressAdjust = useCallback(() => setProgressDraft(null), [])
  const confirmProgressAdjust = useCallback(async () => {
    if (!progressDraft) return
    try {
      await progressMutation.mutateAsync(progressDraft)
      setProgressDraft(null)
    } catch {
      // mutation 已通过 Toast 反馈。
    }
  }, [progressDraft, progressMutation])

  return {
    schedule,
    createDependency,
    scheduleIntent,
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
    needsScheduleTaskId,
    setNeedsScheduleTaskId,
    previewDependencySchedule,
    milestoneDraft,
    openMilestoneAdjust,
    confirmMilestoneAdjust,
    cancelMilestoneAdjust,
    milestonePending: milestoneMutation.isPending,
    progressDraft,
    openProgressAdjust,
    confirmProgressAdjust,
    cancelProgressAdjust,
    progressPending: progressMutation.isPending,
  }
}
