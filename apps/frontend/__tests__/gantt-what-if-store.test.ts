/**
 * What-if store 单元测试 —— session 生命周期、命令、undo/redo、stale、Apply 流程。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import type { GanttRenderTask, GanttRenderDependency } from '@/lib/gantt/types'

function makeTask(id: number, startDay = 0, durationDays = 5): GanttRenderTask {
  return {
    id,
    name: `Task ${id}`,
    wbsCode: '',
    depth: 0,
    parentId: null,
    kind: 'task',
    startDay,
    durationDays,
    progress: 0,
    status: 'not_started',
  }
}

function makeBaseTasks(): readonly GanttRenderTask[] {
  return [makeTask(1, 0, 5), makeTask(2, 10, 3), makeTask(3, 15, 7)]
}

function makeBaseDeps(): readonly GanttRenderDependency[] {
  return [{ id: 1, predecessorId: 1, successorId: 2, type: 'fs', lagDays: 0 }]
}

describe('WhatIfSessionStore', () => {
  beforeEach(() => {
    useWhatIfSessionStore.setState({
      session: {
        status: 'idle',
        baseSnapshot: null,
        history: { entries: [], cursor: 0, maxEntries: 100 },
        derivedPreview: null,
        backendPreview: null,
        errorMessage: null,
        hasUnsavedChanges: false,
      },
    })
  })

  it('enterSession 创建 base snapshot', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('active')
    expect(s.baseSnapshot).not.toBeNull()
    expect(s.baseSnapshot!.serverRevision).toBe('v1')
    expect(s.baseSnapshot!.tasks.length).toBe(3)
  })

  it('exitSession 保持数据但状态为 idle', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    store.exitSession()
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('idle')
    expect(s.baseSnapshot).not.toBeNull()
  })

  it('discardSession 清理所有数据', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    store.discardSession()
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('idle')
    expect(s.baseSnapshot).toBeNull()
  })

  it('resetSession 清除命令和 preview', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: '2025-02-01' })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(1)
    store.resetSession()
    const s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(0)
    expect(s.derivedPreview).toBeNull()
    expect(s.hasUnsavedChanges).toBe(false)
  })

  it('executeCommand 增加历史并产生 derived preview', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    const result = store.executeCommand({
      kind: 'move-task',
      taskId: 1,
      newStartDate: '2025-02-01',
    })
    expect(result.valid).toBe(true)
    const s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(1)
    expect(s.derivedPreview).not.toBeNull()
    expect(s.hasUnsavedChanges).toBe(true)
  })

  it('undo 减少 cursor', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: '2025-02-01' })
    store.executeCommand({ kind: 'move-task', taskId: 2, newStartDate: '2025-03-01' })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(2)
    store.undo()
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(1)
    store.undo()
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(0)
    store.undo() // 不能再 undo
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(0)
  })

  it('redo 增加 cursor', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: '2025-02-01' })
    store.executeCommand({ kind: 'move-task', taskId: 2, newStartDate: '2025-03-01' })
    store.undo()
    store.undo()
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(0)
    store.redo()
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(1)
    store.redo()
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(2)
    store.redo() // 不能超过 entries.length
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(2)
  })

  it('新命令截断 redo tail', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: '2025-02-01' })
    store.executeCommand({ kind: 'move-task', taskId: 2, newStartDate: '2025-03-01' })
    store.undo() // cursor=1
    store.executeCommand({ kind: 'move-task', taskId: 3, newStartDate: '2025-04-01' })
    const s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(2)
    expect(s.history.entries.length).toBe(2) // redo tail 被截断
  })

  it('markStale 标记 stale 并禁用 Apply', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: '2025-02-01' })
    store.markStale()
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('stale')
    const controls = store.getControlsState()
    expect(controls.canApply).toBe(false)
    expect(controls.isStale).toBe(true)
  })

  it('onApplySuccess 清理 session', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    store.onApplySuccess()
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('idle')
    expect(s.baseSnapshot).toBeNull()
    expect(s.history.cursor).toBe(0)
  })

  it('onApplyError 设置错误消息', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    store.onApplyError('服务不可用')
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('error')
    expect(s.errorMessage).toBe('服务不可用')
  })

  it('updateServerRevision 检测变化并标记 stale', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1')
    const newTasks = [makeTask(1, 99, 5)] // startDay 变了
    store.updateServerRevision('v2', newTasks, [])
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('stale')
  })

  it('无 session 时返回 idle 状态', () => {
    const store = useWhatIfSessionStore.getState()
    const controls = store.getControlsState()
    expect(controls.isActive).toBe(false)
    expect(controls.canUndo).toBe(false)
    expect(controls.canRedo).toBe(false)
    expect(controls.canApply).toBe(false)
  })

  it('confirmWarnings 更新 gate', () => {
    // 设一个 impactSummary
    useWhatIfSessionStore.setState({
      impactSummary: {
        isAuthoritative: true,
        timeline: { before: 'a', after: 'b', workingDelta: null },
        tasks: { direct: 0, propagated: 0, unchanged: 1, total: 1 },
        criticalPath: {
          baseCriticalTaskCount: 0,
          previewCriticalTaskCount: 0,
          addedCriticalTaskIds: [],
          removedCriticalTaskIds: [],
          baseTotalFloatRange: null,
          previewTotalFloatRange: null,
        },
        milestones: { total: 0, delayed: 0, advanced: 0, unchanged: 0 },
        conflicts: { cycleCount: 0, constraintViolationCount: 0, total: 0 },
        baseline: {
          finishVariance: null,
          startVariance: null,
          durationVariance: null,
          hasBaseline: false,
        },
        evidence: [],
        gate: {
          hasBlocker: false,
          hasWarning: true,
          blockerCount: 0,
          warningCount: 1,
          warningConfirmed: false,
        },
      },
    })
    expect(useWhatIfSessionStore.getState().impactSummary?.gate.warningConfirmed).toBe(false)
    useWhatIfSessionStore.getState().confirmWarnings()
    expect(useWhatIfSessionStore.getState().impactSummary?.gate.warningConfirmed).toBe(true)
  })

  it('discardSession 清空 impactSummary', () => {
    const store = useWhatIfSessionStore.getState()
    useWhatIfSessionStore.setState({
      impactSummary: {
        isAuthoritative: true,
        timeline: { before: 'a', after: 'b', workingDelta: null },
        tasks: { direct: 0, propagated: 0, unchanged: 1, total: 1 },
        criticalPath: {
          baseCriticalTaskCount: 0,
          previewCriticalTaskCount: 0,
          addedCriticalTaskIds: [],
          removedCriticalTaskIds: [],
          baseTotalFloatRange: null,
          previewTotalFloatRange: null,
        },
        milestones: { total: 0, delayed: 0, advanced: 0, unchanged: 0 },
        conflicts: { cycleCount: 0, constraintViolationCount: 0, total: 0 },
        baseline: {
          finishVariance: null,
          startVariance: null,
          durationVariance: null,
          hasBaseline: false,
        },
        evidence: [],
        gate: {
          hasBlocker: false,
          hasWarning: false,
          blockerCount: 0,
          warningCount: 0,
          warningConfirmed: false,
        },
      },
    })
    store.discardSession()
    expect(useWhatIfSessionStore.getState().impactSummary).toBeNull()
  })
})
