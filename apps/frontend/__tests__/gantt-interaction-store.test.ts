import { describe, expect, it } from 'vitest'
import { createGanttViewStore } from '@/stores/gantt-store'
import { availableModes, resolveMode, inferDependencyType } from '@/lib/gantt/interaction-types'

/** 每个用例建独立实例（非持久化），互不污染。 */
function fresh() {
  return createGanttViewStore()
}

describe('stores/gantt-store 交互态', () => {
  it('默认状态：select 模式、无选中/焦点/草稿、关键路径开', () => {
    const s = fresh().getState()
    expect(s.mode).toBe('select')
    expect(s.entry).toBe('standard')
    expect(s.granularity).toBe('day')
    expect(s.selectedTaskId).toBeNull()
    expect(s.focusTaskId).toBeNull()
    expect(s.selection.size).toBe(0)
    expect(s.draft).toBeNull()
    expect(s.navigationTarget).toBeNull()
    expect(s.showCriticalPath).toBe(true)
    expect(s.compareBaseline).toBe(false)
  })

  it('入口切换：standard ↔ simplified', () => {
    const store = fresh()
    store.getState().setEntry('simplified')
    expect(store.getState().entry).toBe('simplified')
    store.getState().setEntry('standard')
    expect(store.getState().entry).toBe('standard')
  })

  it('多选：toggle 增删并同步主选，clear 清空', () => {
    const store = fresh()
    store.getState().toggleSelection(1)
    store.getState().toggleSelection(2)
    expect([...store.getState().selection].sort()).toEqual([1, 2])
    expect(store.getState().selectedTaskId).toBe(2)
    store.getState().toggleSelection(2)
    expect(store.getState().selection.has(2)).toBe(false)
    store.getState().clearSelection()
    expect(store.getState().selection.size).toBe(0)
  })

  it('setSelection 用可迭代值替换整个集合（引用变化触发渲染）', () => {
    const store = fresh()
    const before = store.getState().selection
    store.getState().setSelection([3, 4, 4])
    const after = store.getState().selection
    expect(after).not.toBe(before)
    expect([...after].sort()).toEqual([3, 4])
  })

  it('模式切换会清理未确认草稿（草稿清理红线）', () => {
    const store = fresh()
    store.getState().setDraft({
      kind: 'schedule',
      draft: { taskId: 1, operation: 'move', startDay: 2, endDay: 4 },
    })
    expect(store.getState().draft).not.toBeNull()
    store.getState().setMode('dependency')
    expect(store.getState().mode).toBe('dependency')
    expect(store.getState().draft).toBeNull()
  })

  it('导航目标：请求后可读、消费后清空', () => {
    const store = fresh()
    store.getState().requestNavigation({ kind: 'task', taskId: 7 })
    expect(store.getState().navigationTarget).toEqual({ kind: 'task', taskId: 7 })
    store.getState().clearNavigation()
    expect(store.getState().navigationTarget).toBeNull()
  })

  it('叠加层开关：问题链 / 全部依赖 / 基线对比互相独立', () => {
    const store = fresh()
    store.getState().toggleShowProblemChain()
    store.getState().toggleCompareBaseline()
    expect(store.getState().showProblemChain).toBe(true)
    expect(store.getState().compareBaseline).toBe(true)
    expect(store.getState().showAllDependencies).toBe(false)
  })

  it('resetInteraction 复位交互态但保留可用性设定', () => {
    const store = fresh()
    store.getState().toggleSelection(5)
    store.getState().setFocusTaskId(5)
    store.getState().setMode('schedule')
    store.getState().resetInteraction()
    const s = store.getState()
    expect(s.selection.size).toBe(0)
    expect(s.focusTaskId).toBeNull()
    expect(s.mode).toBe('select')
    expect(s.draft).toBeNull()
  })
})

describe('lib/gantt/interaction-types 只读降级派生', () => {
  it('无编辑权限：schedule/progress/dependency 全部不可用，仅剩查看类', () => {
    expect(availableModes(false, false)).toEqual(['select', 'baselineInspect'])
  })

  it('仅任务编辑权限：schedule/progress 可用，dependency 不可用', () => {
    expect(availableModes(true, false)).toEqual([
      'select',
      'schedule',
      'progress',
      'baselineInspect',
    ])
  })

  it('全权限：五种模式齐全', () => {
    expect(availableModes(true, true)).toEqual([
      'select',
      'schedule',
      'dependency',
      'progress',
      'baselineInspect',
    ])
  })

  it('resolveMode：当前模式不可用时回落 select', () => {
    expect(resolveMode('schedule', false, false)).toBe('select')
    expect(resolveMode('dependency', true, false)).toBe('select')
    expect(resolveMode('baselineInspect', false, false)).toBe('baselineInspect')
    expect(resolveMode('schedule', true, true)).toBe('schedule')
  })

  it('inferDependencyType：四类锚点组合', () => {
    expect(inferDependencyType('start', 'start')).toBe('ss')
    expect(inferDependencyType('start', 'finish')).toBe('sf')
    expect(inferDependencyType('finish', 'start')).toBe('fs')
    expect(inferDependencyType('finish', 'finish')).toBe('ff')
  })
})
