import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GanttNavControls } from '@/components/views/gantt/nav/GanttNavControls'
import { GanttOverviewBar } from '@/components/views/gantt/nav/GanttOverviewBar'
import type { GanttModel, GanttRenderTask } from '@/lib/gantt/types'

function task(id: number, extra: Partial<GanttRenderTask> = {}): GanttRenderTask {
  return {
    id,
    name: `T${id}`,
    wbsCode: String(id),
    depth: 0,
    parentId: null,
    kind: 'task',
    startDay: id * 5,
    durationDays: 3,
    progress: 0,
    status: 'not_started',
    ...extra,
  }
}

const model: GanttModel = {
  epochMs: Date.parse('2026-07-06T00:00:00Z'),
  timeRange: { startDay: 0, endDay: 40 },
  tasks: [
    task(1, { isCritical: true }),
    task(2),
    task(3, { isCritical: true, startDay: 30, durationDays: 4 }),
  ],
  dependencies: [],
  milestones: [],
}

function pointer(target: Element, type: string, values: { pointerId: number; clientX: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    clientX: { value: values.clientX },
    clientY: { value: 0 },
  })
  fireEvent(target, event)
}

describe('GanttNavControls（task 4.2/4.6）', () => {
  it('导航按钮只调用视口命令、不产生写入', () => {
    const onScrollToDay = vi.fn()
    const onScrollToTask = vi.fn()
    const { getByLabelText } = render(
      <GanttNavControls
        model={model}
        todayDay={12}
        selectedTaskId={2}
        onScrollToDay={onScrollToDay}
        onScrollToTask={onScrollToTask}
      />,
    )
    fireEvent.click(getByLabelText('定位到今天'))
    expect(onScrollToDay).toHaveBeenLastCalledWith(12)
    fireEvent.click(getByLabelText('定位到项目开始'))
    expect(onScrollToDay).toHaveBeenLastCalledWith(0)
    fireEvent.click(getByLabelText('定位到项目结束'))
    expect(onScrollToDay).toHaveBeenLastCalledWith(40)
    fireEvent.click(getByLabelText('定位到选中任务'))
    expect(onScrollToTask).toHaveBeenLastCalledWith(2)
    // 关键路径起点=最小 startDay 的关键任务(1)，终点=最大 endDay 的关键任务(3)。
    fireEvent.click(getByLabelText('定位到关键路径起点'))
    expect(onScrollToTask).toHaveBeenLastCalledWith(1)
    fireEvent.click(getByLabelText('定位到关键路径终点'))
    expect(onScrollToTask).toHaveBeenLastCalledWith(3)
  })

  it('无选中任务时选中任务定位按钮禁用', () => {
    const { getByLabelText } = render(
      <GanttNavControls
        model={model}
        todayDay={12}
        selectedTaskId={null}
        onScrollToDay={vi.fn()}
        onScrollToTask={vi.fn()}
      />,
    )
    expect(getByLabelText('定位到选中任务')).toHaveProperty('disabled', true)
  })
})

describe('GanttOverviewBar（task 4.4/4.7）', () => {
  it('拖动概览条只调用 onNavigateToDay，不触发任何业务写入', () => {
    const onNavigateToDay = vi.fn()
    const { getByRole } = render(
      <GanttOverviewBar
        model={model}
        visibleDayRange={{ startDay: 5, endDay: 20 }}
        onNavigateToDay={onNavigateToDay}
      />,
    )
    const strip = getByRole('slider')
    // jsdom getBoundingClientRect 宽度为 0 → ratio 落到 0 → 定位到项目起点，仍只调用导航回调。
    pointer(strip, 'pointerdown', { pointerId: 1, clientX: 100 })
    pointer(strip, 'pointermove', { pointerId: 1, clientX: 200 })
    pointer(strip, 'pointerup', { pointerId: 1, clientX: 200 })
    expect(onNavigateToDay).toHaveBeenCalled()
    // 每次回调参数都在项目范围内。
    for (const call of onNavigateToDay.mock.calls) {
      expect(call[0]).toBeGreaterThanOrEqual(0)
      expect(call[0]).toBeLessThanOrEqual(40)
    }
  })

  it('键盘操作概览条只调用视口导航', () => {
    const onNavigateToDay = vi.fn()
    const { getByRole } = render(
      <GanttOverviewBar
        model={model}
        visibleDayRange={{ startDay: 5, endDay: 19 }}
        onNavigateToDay={onNavigateToDay}
      />,
    )
    const strip = getByRole('slider')

    fireEvent.keyDown(strip, { key: 'ArrowRight' })
    expect(onNavigateToDay).toHaveBeenLastCalledWith(19)

    fireEvent.keyDown(strip, { key: 'Home' })
    expect(onNavigateToDay).toHaveBeenLastCalledWith(0)

    fireEvent.keyDown(strip, { key: 'End' })
    expect(onNavigateToDay).toHaveBeenLastCalledWith(40)
  })

  it('渲染视口窗与关键路径范围叠加', () => {
    const { container } = render(
      <GanttOverviewBar
        model={model}
        visibleDayRange={{ startDay: 5, endDay: 20 }}
        baselineSummary={{ early: 1, late: 2, unchanged: 0, added: 0, deleted: 0 }}
        onNavigateToDay={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-gantt-overview-viewport]')).not.toBeNull()
    expect(container.querySelector('[data-gantt-overview-critical]')).not.toBeNull()
    expect(container.textContent).toContain('基线：提前 1 · 滞后 2')
  })
})
