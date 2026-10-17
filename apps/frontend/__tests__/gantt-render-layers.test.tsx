import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createScale } from '@/lib/gantt/geometry'
import { GanttBarsLayer } from '@/components/views/gantt/core/GanttBarsLayer'
import { GanttLeftColumn } from '@/components/views/gantt/core/GanttLeftColumn'
import type { GanttRenderTask } from '@/lib/gantt/types'

function task(partial: Partial<GanttRenderTask> & { id: number }): GanttRenderTask {
  return {
    name: `任务${partial.id}`,
    wbsCode: '1',
    depth: 0,
    parentId: null,
    kind: 'task',
    startDay: 0,
    durationDays: 4,
    progress: 0.5,
    status: 'in_progress',
    ...partial,
  }
}

const scale = createScale('day', { rowHeight: 20 })

describe('GanttBarsLayer —— 语义色 / 里程碑与汇总区分 / 时间窗裁剪', () => {
  const tasks: GanttRenderTask[] = [
    task({
      id: 0,
      kind: 'task',
      status: 'in_progress',
      startDay: 0,
      durationDays: 5,
      progress: 0.6,
      baselineStartDay: 0,
      baselineEndDay: 2,
    }),
    task({ id: 1, kind: 'milestone', startDay: 3, durationDays: 0, name: '里程碑A' }),
    task({ id: 2, kind: 'summary', startDay: 0, durationDays: 10, name: '阶段A' }),
    task({ id: 3, kind: 'task', status: 'in_progress', startDay: 2, durationDays: 4 }),
    task({
      id: 4,
      kind: 'task',
      status: 'blocked',
      startDay: 400,
      durationDays: 4,
      name: '远处任务',
    }),
  ]
  const visibleRows = tasks.map((_, i) => ({ index: i, start: i * 20 }))

  function renderLayer() {
    return render(
      <GanttBarsLayer
        scale={scale}
        tasks={tasks}
        milestones={[{ id: 1, taskId: 1, day: 3, name: '里程碑A', status: 'missed' }]}
        visibleRows={visibleRows}
        visibleDayRange={{ startDay: 0, endDay: 30 }}
        width={800}
        height={200}
        hoveredTaskId={null}
        selectedTaskId={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
  }

  it('里程碑用菱形（polygon）、汇总用折角条（path）区分叶子任务', () => {
    const { container } = renderLayer()
    expect(container.querySelector('polygon[fill="var(--danger)"]')).toBeTruthy()
    expect(container.querySelector('path')).toBeTruthy()
  })

  it('同状态任务共用同一语义色（禁止每任务一色）', () => {
    const { container } = renderLayer()
    const inProgress = container.querySelectorAll('rect[fill="var(--in-progress)"]')
    // t0 与 t3 同为 in_progress：各出轨道 + 进度两条 → ≥4，且颜色一致。
    expect(inProgress.length).toBeGreaterThanOrEqual(4)
  })

  it('时间窗外任务不绘制（横向裁剪）', () => {
    const { container } = renderLayer()
    expect(
      container.querySelector('[aria-label="任务：远处任务，Enter 打开任务依赖详情"]'),
    ).toBeNull()
    // 视口内任务照常绘制。
    expect(container.querySelector('[aria-label="里程碑：里程碑A"]')).toBeTruthy()
  })

  it('基线条与滞后方向使用只读叠加图元', () => {
    const { container } = renderLayer()
    expect(container.querySelector('[data-gantt-baseline]')).toBeTruthy()
    expect(container.querySelector('[data-gantt-deviation="late"]')?.textContent).toContain('滞后')
  })
})

describe('GanttLeftColumn —— preset 驱动 WBS 编号 / 头像显隐', () => {
  const tasks = [
    task({ id: 0, wbsCode: '1.2', assignee: { id: 3, initials: 'M3', name: '成员3' } }),
  ]
  const visibleRows = [{ index: 0, start: 0 }]

  function renderCol(showWbsCode: boolean, showAssigneeAvatar: boolean) {
    return render(
      <GanttLeftColumn
        tasks={tasks}
        visibleRows={visibleRows}
        rowHeight={20}
        totalHeight={20}
        showWbsCode={showWbsCode}
        showAssigneeAvatar={showAssigneeAvatar}
        hoveredTaskId={null}
        selectedTaskId={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
  }

  it('标准入口：显示 WBS 编号、隐藏头像', () => {
    const { queryByText } = renderCol(true, false)
    expect(queryByText('1.2')).toBeTruthy()
    expect(queryByText('M3')).toBeNull()
  })

  it('简化入口：隐藏 WBS 编号、显示头像', () => {
    const { queryByText } = renderCol(false, true)
    expect(queryByText('1.2')).toBeNull()
    expect(queryByText('M3')).toBeTruthy()
  })
})
