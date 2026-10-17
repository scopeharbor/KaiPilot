import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createScale } from '@/lib/gantt/geometry'
import { GanttBarsLayer } from '@/components/views/gantt/core/GanttBarsLayer'
import { GanttLeftColumn } from '@/components/views/gantt/core/GanttLeftColumn'
import type { GanttRenderTask } from '@/lib/gantt/types'

function task(p: Partial<GanttRenderTask> & { id: number }): GanttRenderTask {
  return {
    name: `任务${p.id}`,
    wbsCode: String(p.id),
    depth: 0,
    parentId: null,
    kind: 'task',
    startDay: 0,
    durationDays: 4,
    progress: 0.5,
    status: 'in_progress',
    ...p,
  }
}

const scale = createScale('day', { rowHeight: 24 })

describe('简化入口视觉（task 5.2）', () => {
  const tasks = [task({ id: 0, kind: 'summary', name: '阶段A', durationDays: 10 })]
  const visibleRows = [{ index: 0, start: 0 }]

  function renderBars(entry: 'standard' | 'simplified') {
    return render(
      <GanttBarsLayer
        scale={scale}
        tasks={tasks}
        visibleRows={visibleRows}
        visibleDayRange={{ startDay: 0, endDay: 30 }}
        width={800}
        height={100}
        entry={entry}
        hoveredTaskId={null}
        selectedTaskId={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
  }

  it('简化入口给阶段行铺整行分组底纹；标准入口不铺', () => {
    const simplified = renderBars('simplified')
    const band = simplified.container.querySelector('rect[fill="var(--gray-50)"]')
    expect(band).toBeTruthy()
    expect(band?.getAttribute('width')).toBe('800')

    const standard = renderBars('standard')
    expect(standard.container.querySelector('rect[fill="var(--gray-50)"]')).toBeNull()
  })
})

describe('左栏可及性与键盘导航（task 8.1）', () => {
  const tasks = [
    task({ id: 0, name: '任务0', depth: 0 }),
    task({ id: 1, name: '任务1', depth: 1 }),
    task({ id: 2, name: '任务2', depth: 1 }),
  ]
  const visibleRows = tasks.map((_, i) => ({ index: i, start: i * 24 }))

  function renderCol(onSelect = vi.fn()) {
    const utils = render(
      <GanttLeftColumn
        tasks={tasks}
        visibleRows={visibleRows}
        rowHeight={24}
        totalHeight={72}
        showWbsCode
        showAssigneeAvatar={false}
        hoveredTaskId={null}
        selectedTaskId={null}
        onHover={vi.fn()}
        onSelect={onSelect}
      />,
    )
    return { ...utils, onSelect }
  }

  it('容器为 tree、行为 treeitem，可聚焦且带层级', () => {
    const { container, getAllByRole } = renderCol()
    expect(container.querySelector('[role="tree"]')).toBeTruthy()
    const items = getAllByRole('treeitem')
    expect(items).toHaveLength(3)
    expect(items[0]!.getAttribute('tabindex')).toBe('0')
    expect(items[1]!.getAttribute('aria-level')).toBe('2') // depth 1 → level 2
  })

  it('方向键移动选中、Enter 选中当前', () => {
    const { getAllByRole, onSelect } = renderCol()
    const items = getAllByRole('treeitem')
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenCalledWith(1) // 下一行 task1
    fireEvent.keyDown(items[2]!, { key: 'ArrowUp' })
    expect(onSelect).toHaveBeenCalledWith(1) // 上一行 task1
    fireEvent.keyDown(items[1]!, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(1) // 当前行 task1
  })
})
