/**
 * v3-ui-next-gantt-lens W2（task 2.1/2.2）—— What-if 沙盒状态机与零写入隔离测试。
 *
 * 覆盖：enter/exit/discard/reset 状态流转、单项目单一 session 唯一性（projectId 登记）、
 * 拖拽命令触发本地 derivedPreview 重算（含 FS 后继级联顺延）、undo/redo 重放重算回基线，
 * 以及 RL-08 红线断言：试算全程全局 HTTP 请求数为 0、无 localStorage 写入。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import type { GanttRenderDependency, GanttRenderTask } from '@/lib/gantt/types'

/** 固定 epoch（2026-01-12 = 周一，工作日内排程避免日历噪声）。 */
const EPOCH_MS = Date.UTC(2026, 0, 12)
const MS_PER_DAY = 86_400_000

function iso(day: number): string {
  return new Date(EPOCH_MS + day * MS_PER_DAY).toISOString().slice(0, 10)
}

function makeTask(id: number, startDay: number, durationDays: number): GanttRenderTask {
  return {
    id,
    name: `任务 ${id}`,
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

/** 链：T1(day0,d5) --FS--> T2(day7,d3)，另有里程碑 M1。 */
function makeBaseTasks(): readonly GanttRenderTask[] {
  return [
    makeTask(1, 0, 5),
    makeTask(2, 7, 3),
    {
      id: 3,
      name: '里程碑 原型发布',
      wbsCode: '',
      depth: 0,
      parentId: null,
      kind: 'milestone',
      milestoneId: 40,
      startDay: 10,
      durationDays: 0,
      progress: 0,
      status: 'not_started',
    },
  ]
}

function makeBaseDeps(): readonly GanttRenderDependency[] {
  return [{ id: 1, predecessorId: 1, successorId: 2, type: 'fs', lagDays: 0 }]
}

function resetStore() {
  useWhatIfSessionStore.setState({
    session: {
      status: 'idle',
      projectId: null,
      baseSnapshot: null,
      history: { entries: [], cursor: 0, maxEntries: 100 },
      derivedPreview: null,
      backendPreview: null,
      errorMessage: null,
      hasUnsavedChanges: false,
    },
    impactSummary: null,
  })
}

describe('What-if 沙盒状态机（B4 甘特镜头 W2）', () => {
  let fetchSpy: ReturnType<typeof vi.fn>
  let setItemSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetStore()
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setItemSpy.mockRestore()
  })

  it('enterSession 建立 baseSnapshot + inputHash 并登记 projectId（单项目单 session）', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1', 101, EPOCH_MS)
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('active')
    expect(s.projectId).toBe(101)
    expect(s.baseSnapshot).not.toBeNull()
    expect(s.baseSnapshot!.serverRevision).toBe('v1')
    expect(s.baseSnapshot!.inputHash).toMatch(/^hash_/)
    expect(s.baseSnapshot!.tasks.length).toBe(3)
  })

  it('同一 store 唯一 session：再次 enterSession 替换旧 session（无并行多重沙盒）', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1', 101, EPOCH_MS)
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: iso(3) })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(1)

    // 进入另一项目 timeline：旧 session（含命令）被整体替换
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v2', 202, EPOCH_MS)
    const s = useWhatIfSessionStore.getState().session
    expect(s.projectId).toBe(202)
    expect(s.history.cursor).toBe(0)
    expect(s.hasUnsavedChanges).toBe(false)
    expect(s.derivedPreview).toBeNull()
  })

  it('exitSession 保留数据回 idle；discardSession 彻底清空回初始态', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1', 101, EPOCH_MS)
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: iso(3) })

    store.exitSession()
    let s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('idle')
    expect(s.baseSnapshot).not.toBeNull()

    store.discardSession()
    s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('idle')
    expect(s.baseSnapshot).toBeNull()
    expect(s.projectId).toBeNull()
    expect(s.history.cursor).toBe(0)
  })

  it('resetSession 清空命令历史回到基线快照（无变化态）', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1', 101, EPOCH_MS)
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: iso(3) })
    store.resetSession()
    const s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(0)
    expect(s.derivedPreview).toBeNull()
    expect(s.hasUnsavedChanges).toBe(false)
    expect(s.baseSnapshot).not.toBeNull()
  })

  it('命令执行触发本地 derivedPreview 重算：FS 后继任务自动级联顺延（前端内存派生）', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1', 101, EPOCH_MS)

    const result = store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: iso(3) })
    expect(result.valid).toBe(true)

    const s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(1)
    expect(s.derivedPreview).not.toBeNull()
    expect(s.hasUnsavedChanges).toBe(true)

    // 直接修改：T1 延后 3 天；级联顺延：T2 满足 FS（前置结束后次日）起点被动后移
    const task1 = s.derivedPreview!.model.tasks.find((t) => t.id === 1)!
    const task2 = s.derivedPreview!.model.tasks.find((t) => t.id === 2)!
    expect(task1.startDay).toBe(3)
    expect(task1.durationDays).toBe(5)
    expect(task2.startDay).toBe(8) // T1 end=7 → FS 要求 T2 start ≥ 8
    expect(task2.durationDays).toBe(3)
    expect(s.derivedPreview!.affectedTaskIds).toContain(1)
  })

  it('resize-duration 继承级联语义：后继随前置工期拉伸顺延', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1', 101, EPOCH_MS)
    store.executeCommand({
      kind: 'resize-duration',
      taskId: 1,
      newStartDate: iso(0),
      newEndDate: iso(8), // 工期 5 → 9 天
    })
    const s = useWhatIfSessionStore.getState().session
    const task1 = s.derivedPreview!.model.tasks.find((t) => t.id === 1)!
    const task2 = s.derivedPreview!.model.tasks.find((t) => t.id === 2)!
    expect(task1.durationDays).toBe(9)
    // T1 end=8 → T2 顺延至 9（8 + 1）
    expect(task2.startDay).toBe(9)
  })

  it('undo 重放有效命令重算派生模型：cursor=0 时画板完全回退至基线快照', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1', 101, EPOCH_MS)
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: iso(3) })
    store.executeCommand({ kind: 'move-task', taskId: 2, newStartDate: iso(12) })

    store.undo()
    let s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(1)
    // 撤销后重新推导：T1 仍延后 3 天，T2 恢复级联位（不受直接命令）
    const task2 = s.derivedPreview!.model.tasks.find((t) => t.id === 2)!
    expect(task2.startDay).toBe(8)

    store.undo()
    s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(0)
    const snapshot = s.baseSnapshot!
    const tasks = s.derivedPreview!.model.tasks
    for (const baseTask of snapshot.tasks) {
      const current = tasks.find((t) => t.id === baseTask.id)!
      expect(current.startDay).toBe(baseTask.startDay)
      expect(current.durationDays).toBe(baseTask.durationDays)
    }
  })

  it('RL-08：拖拽命令 + undo/redo 全程零 HTTP 写请求、零 localStorage 写入', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1', 101, EPOCH_MS)

    // 模拟多步拖拽推演 + 撤销重做
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: iso(3) })
    store.executeCommand({
      kind: 'resize-duration',
      taskId: 2,
      newStartDate: iso(8),
      newEndDate: iso(13),
    })
    store.executeCommand({ kind: 'milestone-move', milestoneId: 40, taskId: 3, newDate: iso(15) })
    store.undo()
    store.redo()
    store.undo()
    store.undo()
    store.redo()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    // 放弃试算也是纯内存清理
    useWhatIfSessionStore.getState().discardSession()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('命令非法时校验拦截：未知任务 id 不进入历史（validateCommand 前置校验）', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(makeBaseTasks(), makeBaseDeps(), null, 'v1', 101, EPOCH_MS)
    const result = store.executeCommand({ kind: 'move-task', taskId: 999, newStartDate: iso(3) })
    expect(result.valid).toBe(false)
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(0)
    expect(useWhatIfSessionStore.getState().session.hasUnsavedChanges).toBe(false)
  })
})
