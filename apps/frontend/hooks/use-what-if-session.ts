'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import { ganttSchedulingApi, isScheduleStaleError } from '@/lib/api/gantt-scheduling'
import { computeImpactSummary } from '@/lib/gantt/what-if-impact'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { dependencyKeys } from '@/lib/api/dependencies'
import type { ImpactSummary } from '@/lib/gantt/what-if-impact'
import type { WhatIfCommand } from '@/lib/gantt/what-if-types'
import type { GanttModel, GanttRenderTask, GanttRenderDependency } from '@/lib/gantt/types'
import type { WorkingCalendarSettingsInput } from '@/lib/gantt/working-calendar'

/**
 * useWhatIfUndoRedoShortcuts —— What-if 多步撤销/重做全局快捷键（B4 甘特镜头 W2）。
 *
 * 键位（spec「试算多步撤销（Undo）与重做（Redo）」）：
 * - `Cmd/Ctrl+Z` → Undo（cursor > 0 时）
 * - `Cmd/Ctrl+Shift+Z` / `Ctrl+Y` → Redo（存在可重做命令时）
 *
 * 输入控件（INPUT/TEXTAREA/contentEditable）内不劫持按键；无命令历史时零副作用。
 * 撤销/重做全程走 store 内存命令栈（RL-08，零网络零持久化）。
 */
export function useWhatIfUndoRedoShortcuts() {
  const undo = useWhatIfSessionStore((s) => s.undo)
  const redo = useWhatIfSessionStore((s) => s.redo)
  const cursor = useWhatIfSessionStore((s) => s.session.history.cursor)
  const redoable = useWhatIfSessionStore(
    (s) => s.session.history.entries.length - s.session.history.cursor,
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        if (cursor > 0) undo()
        return
      }
      if (key === 'z' && event.shiftKey) {
        event.preventDefault()
        if (redoable > 0) redo()
        return
      }
      if (key === 'y') {
        event.preventDefault()
        if (redoable > 0) redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, cursor, redoable])
}

/**
 * useWhatIfSession —— 甘特 What-if session 集成 Hook。
 *
 * 接受从页面传入的数据（model/tasks/dependencies/calendar），
 * 避免重复拉取——符合现有甘特页面的数据流（useProjectGanttModel）。
 */

/** applySession 的两阶段提交结果契约（W4 装配 UI 呈现用）。 */
export type WhatIfApplyOutcome =
  | { outcome: 'committed' }
  | {
      outcome: 'conflict'
      conflicts: Array<{ taskId: number; taskName: string; code: string; message: string }>
    }
  | { outcome: 'stale' }
  | { outcome: 'failed'; message: string }
export function useWhatIfSession(
  projectId: number,
  deps: {
    model: GanttModel | null
    calendarSettings: WorkingCalendarSettingsInput | null
  },
) {
  const store = useWhatIfSessionStore()
  const session = useWhatIfSessionStore((s) => s.session)
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const applyInProgress = useRef(false)
  const wasActiveRef = useRef(false)

  // ── Enter What-if ────────────────────────────────────────────

  /** 进入快照时的任务/依赖内容签名（stale 检测只对「内容真正变化」触发）。 */
  const snapshotSignatureRef = useRef<string | null>(null)

  const enterSession = useCallback(() => {
    if (!deps.model) return
    wasActiveRef.current = true
    const tasks: readonly GanttRenderTask[] = deps.model.tasks
    const dependencies: readonly GanttRenderDependency[] = deps.model.dependencies
    const calendarSettings = deps.calendarSettings ?? null
    const serverRevision = `v_${Date.now()}`
    snapshotSignatureRef.current = scheduleContentSignature(tasks, dependencies)
    store.enterSession(
      tasks,
      dependencies,
      calendarSettings,
      serverRevision,
      projectId,
      deps.model.epochMs,
    )
  }, [deps.model, deps.calendarSettings, projectId, store])

  // ── Exit / Discard / Reset ──────────────────────────────────

  const exitSession = useCallback(() => {
    wasActiveRef.current = false
    store.exitSession()
  }, [store])

  const discardSession = useCallback(() => {
    wasActiveRef.current = false
    store.discardSession()
  }, [store])

  const resetSession = useCallback(() => {
    store.resetSession()
  }, [store])

  // ── Undo / Redo ─────────────────────────────────────────────

  const undo = useCallback(() => store.undo(), [store])
  const redo = useCallback(() => store.redo(), [store])

  // ── Execute Command ──────────────────────────────────────────

  const executeCommand = useCallback(
    (command: WhatIfCommand) => store.executeCommand(command),
    [store],
  )

  // ── Apply ────────────────────────────────────────────────────

  /**
   * 两阶段提交（preview→confirm）的唯一入口（spec「显式应用方案与 preview→confirm
   * 两阶段提交」/ design D7）：
   * - 阶段 1 `mode: 'preview'`：获取 previewToken 并做服务端冲突检测；
   *   `conflicts`（含 CYCLE 依赖环）非空时原位阻断，绝不进入阶段 2；
   * - 阶段 2 `mode: 'commit'`：携带 previewToken 逐条事务落库；
   * - HTTP 409（SCHEDULE_STALE，TOCTOU 并发修改）将 session 置为 `stale`，
   *   Apply 按钮随即被 `getControlsState().canApply` 禁用；恢复路径为
   *   「放弃并刷新」（discardSession）或「基于最新数据重新试算」（重新 enterSession）。
   */
  const applySession = useCallback(async (): Promise<WhatIfApplyOutcome> => {
    if (applyInProgress.current) return { outcome: 'failed', message: '提交正在进行中' }
    if (!session.baseSnapshot || session.history.cursor === 0) {
      return { outcome: 'failed', message: '没有变更需要应用' }
    }
    if (session.status === 'stale') {
      toast({
        variant: 'warning',
        title: '数据已变更',
        description: '请丢弃后重新进入 What-if 模式。',
      })
      return { outcome: 'stale' }
    }

    applyInProgress.current = true

    try {
      const activeCmds = session.history.entries.slice(0, session.history.cursor)
      if (activeCmds.length === 0) {
        toast({ variant: 'warning', title: '没有变更需要应用' })
        return { outcome: 'failed', message: '没有变更需要应用' }
      }

      // 逐个应用命令到后端（用 schedule preview + commit 模式）
      for (const cmd of activeCmds) {
        if (cmd.kind === 'add-dependency' || cmd.kind === 'remove-dependency') continue

        const request = buildScheduleRequest(cmd, projectId)
        if (!request) continue

        // 阶段 1：preview——获取 previewToken 并检测冲突
        const previewResult = await ganttSchedulingApi.execute(projectId, {
          ...request,
          mode: 'preview',
        })

        if (previewResult.conflicts?.length) {
          store.setBackendPreview({
            previewToken: previewResult.previewToken,
            changes: previewResult.changes.map((c) => ({
              taskId: c.taskId,
              taskName: c.taskName,
              before: c.before,
              after: c.after,
            })),
            warnings: previewResult.warnings ?? [],
            conflicts: previewResult.conflicts.map((c) => ({
              taskId: c.taskId,
              taskName: c.taskName,
              code: c.code,
              message: c.message,
            })),
            calendar: previewResult.calendar,
          })
          const cycleCount = previewResult.conflicts.filter((c) => c.code === 'CYCLE').length
          toast({
            variant: 'warning',
            title: cycleCount > 0 ? '检测到依赖环，禁止提交' : '排程冲突',
            description: `${previewResult.conflicts.length} 个冲突，已阻断阶段 2 提交。`,
          })
          // CYCLE / 阻塞冲突：原位中断，绝不发出 commit
          return { outcome: 'conflict', conflicts: previewResult.conflicts }
        }

        // 阶段 2：commit——携带 previewToken 单事务落库
        await ganttSchedulingApi.execute(projectId, {
          ...request,
          mode: 'commit',
          previewToken: previewResult.previewToken,
        })
      }

      store.onApplySuccess()
      wasActiveRef.current = false

      // 甘特实际读的是 taskKeys.view(…'gantt') / dependencyKeys.project 等键：原先只失效
      // ['tasks', id] 这类旧键，应用成功后画面仍是旧排期，看起来像「没应用上」
      await Promise.all([
        invalidateTaskQueries(queryClient, projectId),
        queryClient.invalidateQueries({ queryKey: dependencyKeys.project(projectId) }),
        queryClient.invalidateQueries({ queryKey: ['gantt-schedule', projectId] }),
      ])

      toast({
        variant: 'success',
        title: '方案已应用',
        description: `${activeCmds.length} 项变更已提交。`,
      })
      return { outcome: 'committed' }
    } catch (error) {
      // TOCTOU 并发防线：preview 与 commit 之间数据被他人修改 → 409 SCHEDULE_STALE。
      // 会话整体置 stale（Apply 禁用），交由 HUD 提供「放弃并刷新 / 重新试算」恢复动作。
      if (isScheduleStaleError(error)) {
        store.markStale()
        toast({
          variant: 'warning',
          title: '排程已过期',
          description: '该项目排程已被其他协作者修改，请放弃试算或基于最新数据重新试算。',
        })
        return { outcome: 'stale' }
      }
      const message = error instanceof Error ? error.message : '应用失败'
      store.onApplyError(message)
      toast({ variant: 'error', title: '应用失败', description: message })
      return { outcome: 'failed', message }
    } finally {
      applyInProgress.current = false
    }
  }, [session, projectId, store, queryClient, toast])

  // ── Stale 检测 ─────────────────────────────────────────────

  // 只对「内容真正变化」触发：进入沙盒后立刻以新时间戳调用 updateServerRevision 会
  // 因 serverRevision 失配而把刚建立的 session 误标 stale（V2.5 遗留竞态）。外部
  // （协作者/后台作业）确实导致任务与依赖内容变化时，重新比对 inputHash 并标 stale。
  useEffect(() => {
    if (!session.baseSnapshot || session.status !== 'active') {
      snapshotSignatureRef.current = null
      return
    }
    if (!deps.model) return
    const signature = scheduleContentSignature(deps.model.tasks, deps.model.dependencies)
    if (snapshotSignatureRef.current === null) {
      snapshotSignatureRef.current = signature
      return
    }
    if (signature === snapshotSignatureRef.current) return
    snapshotSignatureRef.current = signature
    const serverRevision = `v_${Date.now()}`
    store.updateServerRevision(serverRevision, deps.model.tasks, deps.model.dependencies)
  }, [deps.model, session.baseSnapshot, session.status, store])

  // ── 返回 ─────────────────────────────────────────────────────

  // 控件状态由 session 快照内存派生：zustand v5 的 useStore 用 useSyncExternalStore
  // 直连 selector，`(s) => s.getControlsState()` 每次返回新对象会被判定为快照变化，
  // 触发无限重渲染（Maximum update depth）。以 session 引用为 key 的 useMemo 保证
  // 仅 session 真正变化时重新计算，且逻辑仍委托 store 的 getControlsState 单一实现。
  const controls = useMemo(() => useWhatIfSessionStore.getState().getControlsState(), [session])

  return {
    session,
    isActive: session.status === 'active' || session.status === 'stale',
    baseSnapshot: session.baseSnapshot,
    derivedPreview: session.derivedPreview,
    backendPreview: session.backendPreview,
    history: session.history,
    status: session.status,
    errorMessage: session.errorMessage,
    hasUnsavedChanges: session.hasUnsavedChanges,
    controls,
    enterSession,
    exitSession,
    discardSession,
    resetSession,
    executeCommand,
    undo,
    redo,
    applySession,
  }
}

/**
 * useWhatIfImpactSummary —— 监听 session 变化，自动计算 impact summary 并写入 store。
 *
 * B4 甘特镜头 W2 扩展：若用户已勾选「已知晓告警」（warningConfirmed），且重算前后的
 * 告警/阻塞签名（数量 + 证据原因码集合 + 冲突数）完全一致，则保留确认态，
 * 避免与排程无关的轻微派生变化反复重置确认框。
 */
export function useWhatIfImpactSummary() {
  const session = useWhatIfSessionStore((s) => s.session)
  const setImpactSummary = useWhatIfSessionStore((s) => s.setImpactSummary)
  const directCommandTaskIds = useMemo(
    () =>
      session.history.entries
        .slice(0, session.history.cursor)
        .filter(
          (c): c is WhatIfCommand & { kind: 'move-task' | 'resize-duration' | 'milestone-move' } =>
            c.kind === 'move-task' || c.kind === 'resize-duration' || c.kind === 'milestone-move',
        )
        .map((c) => ('taskId' in c ? c.taskId : -1))
        .filter((id) => id > 0),
    [session.history],
  )

  useEffect(() => {
    if (!session.baseSnapshot || !session.derivedPreview) {
      setImpactSummary(null)
      return
    }

    const summary = computeImpactSummary({
      baseSnapshot: session.baseSnapshot,
      previewModel: session.derivedPreview.model,
      directCommandTaskIds,
      backendPreviewToken: session.backendPreview?.previewToken ?? null,
      serverRevision: session.baseSnapshot.serverRevision ?? 'unknown',
    })

    // 读取最新确认态（getState 直接读，不入 effect deps——避免“set 新对象 → 重跑 effect”自激循环）
    const prev = useWhatIfSessionStore.getState().impactSummary
    if (
      prev?.gate.warningConfirmed &&
      impactWarningSignature(prev) === impactWarningSignature(summary)
    ) {
      setImpactSummary({ ...summary, gate: { ...summary.gate, warningConfirmed: true } })
      return
    }
    setImpactSummary(summary)
  }, [
    session.baseSnapshot,
    session.derivedPreview,
    session.backendPreview?.previewToken,
    directCommandTaskIds,
    setImpactSummary,
  ])
}

/** 告警/阻塞签名：同签名视为「告警集未变化」，保留确认态。 */
function impactWarningSignature(summary: ImpactSummary): string {
  const codes = summary.evidence
    .filter((e) => e.severity === 'warning' || e.severity === 'blocker')
    .map((e) => `${e.severity}:${e.reasonCode}:${e.entityId}`)
    .sort()
    .join('|')
  return `${summary.gate.warningCount}:${summary.gate.blockerCount}:${summary.conflicts.total}:${codes}`
}

/** 排程相关内容签名（tasks 的 id/startDay/durationDays + deps 的 id/端点/类型/滞期）。 */
function scheduleContentSignature(
  tasks: readonly GanttRenderTask[],
  dependencies: readonly GanttRenderDependency[],
): string {
  return JSON.stringify({
    tasks: tasks.map((t) => [t.id, t.startDay, t.durationDays, t.kind]),
    dependencies: dependencies.map((d) => [
      d.id,
      d.predecessorId,
      d.successorId,
      d.type,
      d.lagDays,
    ]),
  })
}

/** 命令 → ScheduleRequest */
function buildScheduleRequest(
  cmd: WhatIfCommand,
  _projectId: number,
): {
  mode: 'preview'
  taskId: number
  operation: 'move' | 'resize'
  startDate: string
  endDate?: string
  autoSchedule: boolean
} | null {
  switch (cmd.kind) {
    case 'move-task':
      return {
        mode: 'preview',
        taskId: cmd.taskId,
        operation: 'move',
        startDate: cmd.newStartDate,
        autoSchedule: true,
      }
    case 'resize-duration':
      return {
        mode: 'preview',
        taskId: cmd.taskId,
        operation: 'resize',
        startDate: cmd.newStartDate,
        endDate: cmd.newEndDate,
        autoSchedule: true,
      }
    case 'milestone-move':
      return {
        mode: 'preview',
        taskId: cmd.taskId,
        operation: 'move',
        startDate: cmd.newDate,
        autoSchedule: true,
      }
    default:
      return null
  }
}
