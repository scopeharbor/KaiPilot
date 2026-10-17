import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GanttChart } from '@/components/views/gantt/core/GanttChart'
import { createGanttViewStore } from '@/stores/gantt-store'
import type { GanttModel } from '@/lib/gantt/types'

// jsdom 无 canvas 2d 上下文，依赖线层 getContext 返回 null 时安全早退。
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null) as never
})

const model: GanttModel = {
  epochMs: Date.parse('2026-07-06T00:00:00Z'),
  timeRange: { startDay: 0, endDay: 20 },
  tasks: [
    {
      id: 1,
      name: '任务A',
      wbsCode: '1',
      depth: 0,
      parentId: null,
      kind: 'task',
      startDay: 0,
      durationDays: 3,
      progress: 0.2,
      status: 'in_progress',
    },
  ],
  dependencies: [],
  milestones: [],
}

describe('甘特交互模式切换器（task 5.1/5.4）', () => {
  it('可编辑用户：五模式齐全、带中文可访问名，切到依赖模式暴露依赖锚点', () => {
    const store = createGanttViewStore()
    const { getByLabelText, queryByLabelText } = render(
      <GanttChart
        model={model}
        store={store}
        editable
        dependencyEditable
        onScheduleDraft={vi.fn()}
        onDependencyDraft={vi.fn()}
      />,
    )
    // 默认 select 模式不暴露编辑图元。
    expect(queryByLabelText('依赖开始锚点：任务「任务A」')).toBeNull()
    // 模式按钮带中文可访问名。
    expect(getByLabelText('切换到依赖模式')).toBeTruthy()
    expect(getByLabelText('切换到标准甘特入口')).toBeTruthy()
    expect(getByLabelText('切换到日视图时间粒度')).toBeTruthy()
    expect(getByLabelText('显示问题链叠加层')).toBeTruthy()
    fireEvent.click(getByLabelText('切换到依赖模式'))
    expect(store.getState().mode).toBe('dependency')
    expect(queryByLabelText('依赖开始锚点：任务「任务A」')).not.toBeNull()
  })

  it('只读用户：只提供选择/基线模式，展示中文只读提示', () => {
    const store = createGanttViewStore()
    const { getByText, queryByLabelText } = render(
      <GanttChart model={model} store={store} editable={false} dependencyEditable={false} />,
    )
    expect(getByText('只读模式：无编辑权限')).toBeTruthy()
    expect(queryByLabelText('切换到选择模式')).not.toBeNull()
    expect(queryByLabelText('切换到基线模式')).not.toBeNull()
    // 编辑类模式不提供。
    expect(queryByLabelText('切换到改期模式')).toBeNull()
    expect(queryByLabelText('切换到依赖模式')).toBeNull()
    expect(queryByLabelText('切换到进度模式')).toBeNull()
  })
})
