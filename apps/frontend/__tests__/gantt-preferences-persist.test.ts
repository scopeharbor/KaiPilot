import { beforeEach, describe, expect, it } from 'vitest'
import { createGanttViewStore } from '@/stores/gantt-store'

const KEY = 'aiproj-gantt-test'

describe('stores/gantt-store 偏好持久化（task 1.5/1.6）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('修改 UI 偏好后写入 localStorage，且只含 UI 偏好、无业务数据', () => {
    const store = createGanttViewStore({ persistKey: KEY })
    store.getState().setEntry('simplified')
    store.getState().setGranularity('week')
    store.getState().setMode('schedule')
    store.getState().toggleShowProblemChain()
    store.getState().setCompareBaseline(true)
    // 业务性交互态：不应进入持久化。
    store.getState().toggleSelection(42)
    store.getState().setDraft({
      kind: 'schedule',
      draft: { taskId: 42, operation: 'move', startDay: 1, endDay: 3 },
    })

    const raw = localStorage.getItem(KEY)
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw!).state
    expect(persisted).toMatchObject({
      entry: 'simplified',
      granularity: 'week',
      mode: 'schedule',
      showProblemChain: true,
      compareBaseline: true,
    })
    // 业务/瞬时态一律不落盘。
    expect(persisted.selection).toBeUndefined()
    expect(persisted.draft).toBeUndefined()
    expect(persisted.selectedTaskId).toBeUndefined()
    expect(persisted.dragPreview).toBeUndefined()
  })

  it('重新打开（新建同 key store）恢复上次 UI 偏好，交互态回默认', () => {
    const first = createGanttViewStore({ persistKey: KEY })
    first.getState().setEntry('simplified')
    first.getState().setGranularity('month')
    first.getState().setShowAllDependencies(true)
    first.getState().toggleSelection(9) // 业务态，不持久化

    // 模拟重新打开：从同一 localStorage key 重新水合。
    const reopened = createGanttViewStore({ persistKey: KEY })
    const s = reopened.getState()
    expect(s.entry).toBe('simplified')
    expect(s.granularity).toBe('month')
    expect(s.showAllDependencies).toBe(true)
    // 服务端事实来源相关的交互态不来自持久化，回默认空。
    expect(s.selection.size).toBe(0)
    expect(s.selectedTaskId).toBeNull()
  })

  it('不带 persistKey 的实例不写 localStorage（dev harness/测试隔离）', () => {
    const store = createGanttViewStore()
    store.getState().setEntry('simplified')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(localStorage.length).toBe(0)
  })
})
