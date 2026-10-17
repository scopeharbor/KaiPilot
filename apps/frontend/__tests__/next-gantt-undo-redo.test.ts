/**
 * v3-ui-next-gantt-lens W2（task 2.5/2.6）—— 多步 Undo/Redo 历史栈、分支截断与快捷键测试。
 *
 * 覆盖：游标逐步回退/重做、回到基线快照（cursor=0）、≥100 步容量、
 * 撤销后新命令自动截断 redo tail（重做按钮置灰），以及
 * Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z、Ctrl+Y 全局快捷键与输入控件豁免。
 */

import { renderHook, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import { useWhatIfUndoRedoShortcuts } from '@/hooks/use-what-if-session'
import type { GanttRenderDependency, GanttRenderTask } from '@/lib/gantt/types'

/** 固定 epoch（2026-01-12 = 周一）。 */
const EPOCH_MS = Date.UTC(2026, 0, 12)
const MS_PER_DAY = 86_400_000

function iso(day: number): string {
  return new Date(EPOCH_MS + day * MS_PER_DAY).toISOString().slice(0, 10)
}

function makeTask(id: number, startDay: number): GanttRenderTask {
  return {
    id,
    name: `任务 ${id}`,
    wbsCode: '',
    depth: 0,
    parentId: null,
    kind: 'task',
    startDay,
    durationDays: 5,
    progress: 0,
    status: 'not_started',
  }
}

const BASE_TASKS: readonly GanttRenderTask[] = [makeTask(1, 0), makeTask(2, 10), makeTask(3, 20)]
const BASE_DEPS: readonly GanttRenderDependency[] = []

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

function enterWithCommands(count: number) {
  const store = useWhatIfSessionStore.getState()
  store.enterSession(BASE_TASKS, BASE_DEPS, null, 'v1', 101, EPOCH_MS)
  for (let i = 0; i < count; i++) {
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: iso((i + 1) * 3) })
  }
}

describe('多步 Undo/Redo 历史栈（B4 甘特镜头 W2）', () => {
  beforeEach(resetStore)
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('连续多步命令逐步 Undo 回退，每一步重放有效命令集重算派生模型', () => {
    enterWithCommands(3)
    const store = useWhatIfSessionStore.getState()
    expect(store.session.history.cursor).toBe(3)

    store.undo()
    let s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(2)
    // 重放前 2 条命令：任务 1 落在第 2 条命令的落点（day 6）
    expect(s.derivedPreview!.model.tasks.find((t) => t.id === 1)!.startDay).toBe(6)

    store.undo()
    s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(1)
    expect(s.derivedPreview!.model.tasks.find((t) => t.id === 1)!.startDay).toBe(3)

    store.undo()
    s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(0)
    // cursor=0：派生模型回退至基线快照
    expect(s.derivedPreview!.model.tasks.find((t) => t.id === 1)!.startDay).toBe(0)
    expect(s.hasUnsavedChanges).toBe(false)

    store.undo() // 不能再退
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(0)
  })

  it('Redo 逐步重做至栈顶，随后重做按钮禁用', () => {
    enterWithCommands(2)
    const store = useWhatIfSessionStore.getState()
    store.undo()
    store.undo()
    expect(store.getControlsState().canRedo).toBe(true)

    store.redo()
    let s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(1)
    expect(s.derivedPreview!.model.tasks.find((t) => t.id === 1)!.startDay).toBe(3)

    store.redo()
    s = useWhatIfSessionStore.getState().session
    expect(s.history.cursor).toBe(2)
    expect(s.derivedPreview!.model.tasks.find((t) => t.id === 1)!.startDay).toBe(6)

    store.redo() // 栈顶，不能再重做
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(2)
    expect(useWhatIfSessionStore.getState().getControlsState().canRedo).toBe(false)
  })

  it('历史容量 ≥ 100 步：超限时保留最新 100 条并保持游标满位', () => {
    const store = useWhatIfSessionStore.getState()
    store.enterSession(BASE_TASKS, BASE_DEPS, null, 'v1', 101, EPOCH_MS)
    for (let i = 0; i < 105; i++) {
      store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: iso((i % 20) + 1) })
    }
    const s = useWhatIfSessionStore.getState().session
    expect(s.history.maxEntries).toBe(100)
    expect(s.history.entries.length).toBe(100)
    expect(s.history.cursor).toBe(100)
    // 压缩后还能继续 undo/redo
    store.undo()
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(99)
    store.redo()
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(100)
  })

  it('撤销后产生新拖拽：自动截断 redo tail，重做按钮置灰', () => {
    enterWithCommands(2)
    const store = useWhatIfSessionStore.getState()
    store.undo() // cursor=1，第 2 步进入 redo tail

    // 新命令（第 3 条落点不同）
    store.executeCommand({ kind: 'move-task', taskId: 2, newStartDate: iso(15) })
    const s = useWhatIfSessionStore.getState().session
    expect(s.history.entries.length).toBe(2) // 旧 tail 被截断
    expect(s.history.cursor).toBe(2)
    expect(s.history.entries[1]).toMatchObject({ kind: 'move-task', taskId: 2 })
    expect(useWhatIfSessionStore.getState().getControlsState().canRedo).toBe(false)
  })

  it('Ctrl+Z 触发撤销、Ctrl+Shift+Z 触发重做（全局快捷键）', () => {
    enterWithCommands(2)
    const { unmount } = renderHook(() => useWhatIfUndoRedoShortcuts())
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(2)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(1)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(2)

    // 撤销后再用 Ctrl+Y 重做
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(1)
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(2)
    unmount()
  })

  it('Cmd+Z（Mac 修饰键）同样触发撤销', () => {
    enterWithCommands(2)
    const { unmount } = renderHook(() => useWhatIfUndoRedoShortcuts())
    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(1)
    unmount()
  })

  it('输入控件内按键不劫持（INPUT 聚焦时 Ctrl+Z 不触发撤销）', () => {
    enterWithCommands(2)
    const { unmount } = renderHook(() => useWhatIfUndoRedoShortcuts())
    const input = document.createElement('input')
    input.setAttribute('data-testid', 'field')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(2)
    input.remove()
    unmount()
  })

  it('无命令历史时快捷键零副作用（cursor=0 不撤销不报错）', () => {
    const { unmount } = renderHook(() => useWhatIfUndoRedoShortcuts())
    const store = useWhatIfSessionStore.getState()
    store.enterSession(BASE_TASKS, BASE_DEPS, null, 'v1', 101, EPOCH_MS)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(0)
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(0)
    unmount()
  })
})
