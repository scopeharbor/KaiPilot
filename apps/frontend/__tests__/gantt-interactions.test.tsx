import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { GanttBarsLayer } from '@/components/views/gantt/core/GanttBarsLayer'
import { createScale } from '@/lib/gantt/geometry'
import type { GanttRenderTask } from '@/lib/gantt/types'
import type { GanttInteractionMode } from '@/lib/gantt/interaction-types'

const scale = createScale('day', { rowHeight: 24, pxPerDay: 20 })

function task(
  id: number,
  name: string,
  kind: GanttRenderTask['kind'] = 'task',
  extra: Partial<GanttRenderTask> = {},
): GanttRenderTask {
  return {
    id,
    name,
    wbsCode: String(id),
    depth: 0,
    parentId: null,
    kind,
    startDay: id * 2,
    durationDays: kind === 'milestone' ? 0 : 3,
    progress: 0,
    status: 'not_started',
    ...extra,
  }
}

function renderLayer(options: {
  editable?: boolean
  dependencyEditable?: boolean
  onScheduleDraft?: Mock
  onDependencyDraft?: Mock
  onMilestoneDraft?: Mock
  onProgressDraft?: Mock
  onSelect?: Mock
  tasks?: GanttRenderTask[]
  mode?: GanttInteractionMode
}) {
  const { tasks: tasksOverride, onSelect = vi.fn(), ...rest } = options
  const tasks = tasksOverride ?? [task(1, 'A'), task(2, 'B'), task(3, '阶段', 'summary')]
  return render(
    <GanttBarsLayer
      scale={scale}
      tasks={tasks}
      visibleRows={tasks.map((_, index) => ({ index, start: index * 24 }))}
      visibleDayRange={{ startDay: 0, endDay: 30 }}
      width={800}
      height={100}
      hoveredTaskId={1}
      selectedTaskId={null}
      onHover={vi.fn()}
      onSelect={onSelect}
      {...rest}
    />,
  )
}

function pointer(
  target: Element,
  type: string,
  values: { pointerId: number; clientX: number; clientY?: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    clientX: { value: values.clientX },
    clientY: { value: values.clientY ?? 0 },
  })
  fireEvent(target, event)
}

describe('甘特日期交互', () => {
  it('指针移动期间不提交，释放后才产生排程草稿', () => {
    const onScheduleDraft = vi.fn()
    const { getByLabelText, container } = renderLayer({ editable: true, onScheduleDraft })
    const bar = getByLabelText('任务：A，方向键移动，Shift 加速')
    const svg = container.querySelector('svg')!
    pointer(bar, 'pointerdown', { pointerId: 1, clientX: 40 })
    pointer(svg, 'pointermove', { pointerId: 1, clientX: 80 })
    expect(onScheduleDraft).not.toHaveBeenCalled()
    pointer(svg, 'pointerup', { pointerId: 1, clientX: 80 })
    expect(onScheduleDraft).toHaveBeenCalledWith({
      taskId: 1,
      operation: 'move',
      startDay: 4,
      endDay: 6,
    })
  })

  it('拖动改期松开后补发的 click 不再打开任务详情；不拖动的单击仍会选中', () => {
    const onScheduleDraft = vi.fn()
    const onSelect = vi.fn()
    const { getByLabelText, container } = renderLayer({ editable: true, onScheduleDraft, onSelect })
    const bar = getByLabelText('任务：A，方向键移动，Shift 加速')
    const svg = container.querySelector('svg')!
    pointer(bar, 'pointerdown', { pointerId: 1, clientX: 40 })
    pointer(svg, 'pointermove', { pointerId: 1, clientX: 80 })
    pointer(svg, 'pointerup', { pointerId: 1, clientX: 80 })
    fireEvent.click(bar)
    expect(onScheduleDraft).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()

    pointer(bar, 'pointerdown', { pointerId: 2, clientX: 40 })
    pointer(svg, 'pointerup', { pointerId: 2, clientX: 40 })
    fireEvent.click(bar)
    expect(onSelect).toHaveBeenCalledWith(1, { toggle: false, range: false })
  })

  it('键盘方向键移动 1 天，Shift 移动 5 天，summary 无手柄', () => {
    const onScheduleDraft = vi.fn()
    const { getByLabelText, queryByLabelText } = renderLayer({ editable: true, onScheduleDraft })
    const bar = getByLabelText('任务：A，方向键移动，Shift 加速')
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    fireEvent.keyDown(bar, { key: 'ArrowLeft', shiftKey: true })
    expect(onScheduleDraft).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ taskId: 1, startDay: 3 }),
    )
    expect(onScheduleDraft).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ taskId: 1, startDay: -3 }),
    )
    expect(queryByLabelText('改期手柄：调整任务「阶段」工期')).toBeNull()
  })

  it('右侧手柄用键盘调整工期', () => {
    const onScheduleDraft = vi.fn()
    const { getByLabelText } = renderLayer({ editable: true, onScheduleDraft })
    fireEvent.keyDown(getByLabelText('改期手柄：调整任务「A」工期'), { key: 'ArrowRight' })
    expect(onScheduleDraft).toHaveBeenCalledWith({
      taskId: 1,
      operation: 'resize',
      startDay: 2,
      endDay: 5,
    })
  })
})

describe('甘特进度调整（task 2.6）', () => {
  it('上/下方向键按 ±10%（Shift ±25%）生成进度草稿，不改日期', () => {
    const onProgressDraft = vi.fn()
    const onScheduleDraft = vi.fn()
    const { getByLabelText } = renderLayer({
      editable: true,
      onProgressDraft,
      onScheduleDraft,
      tasks: [task(1, 'A', 'task', { progress: 0.4 })],
    })
    const bar = getByLabelText(/任务：A/)
    fireEvent.keyDown(bar, { key: 'ArrowUp' })
    expect(onProgressDraft).toHaveBeenLastCalledWith({
      taskId: 1,
      progress: expect.closeTo(0.5, 5),
    })
    fireEvent.keyDown(bar, { key: 'ArrowDown', shiftKey: true })
    expect(onProgressDraft).toHaveBeenLastCalledWith({
      taskId: 1,
      progress: expect.closeTo(0.15, 5),
    })
    // 进度键不触发排程草稿。
    expect(onScheduleDraft).not.toHaveBeenCalled()
  })

  it('进度手柄拖拽释放后才提交进度草稿', () => {
    const onProgressDraft = vi.fn()
    const { getByLabelText, container } = renderLayer({
      editable: true,
      onProgressDraft,
      tasks: [task(1, 'A', 'task', { progress: 0 })],
    })
    const knob = getByLabelText(/调整任务「A」进度/)
    const svg = container.querySelector('svg')!
    pointer(knob, 'pointerdown', { pointerId: 9, clientX: 0 })
    // durationDays=3, pxPerDay=20 → barWidthPx=60；拖 30px ≈ +50%。
    pointer(svg, 'pointermove', { pointerId: 9, clientX: 30 })
    expect(onProgressDraft).not.toHaveBeenCalled()
    pointer(svg, 'pointerup', { pointerId: 9, clientX: 30 })
    expect(onProgressDraft).toHaveBeenCalledWith({ taskId: 1, progress: expect.closeTo(0.5, 5) })
  })

  it('无进度回调时不渲染进度手柄', () => {
    const { queryByLabelText } = renderLayer({
      editable: true,
      tasks: [task(1, 'A', 'task', { progress: 0 })],
    })
    expect(queryByLabelText(/调整任务「A」进度/)).toBeNull()
  })
})

describe('甘特里程碑改期（task 2.5）', () => {
  const milestoneTask = task(1, 'M1', 'milestone', { milestoneId: 11, durationDays: 0 })

  it('真实里程碑方向键生成里程碑日期草稿（不走排程草稿）', () => {
    const onMilestoneDraft = vi.fn()
    const onScheduleDraft = vi.fn()
    const { getByLabelText } = renderLayer({
      editable: true,
      onMilestoneDraft,
      onScheduleDraft,
      tasks: [milestoneTask],
    })
    const diamond = getByLabelText(/里程碑：M1/)
    fireEvent.keyDown(diamond, { key: 'ArrowRight' })
    expect(onMilestoneDraft).toHaveBeenCalledWith({ milestoneId: 11, taskId: 1, day: 3 })
    expect(onScheduleDraft).not.toHaveBeenCalled()
  })

  it('只读时里程碑不可键盘改期', () => {
    const onMilestoneDraft = vi.fn()
    const { getByLabelText } = renderLayer({
      editable: false,
      onMilestoneDraft,
      tasks: [milestoneTask],
    })
    const diamond = getByLabelText(/里程碑：M1（只读）/)
    fireEvent.keyDown(diamond, { key: 'ArrowRight' })
    expect(onMilestoneDraft).not.toHaveBeenCalled()
  })
})

describe('交互模式门控（task 5.1/5.4）', () => {
  const editTasks = [task(1, 'A', 'task', { progress: 0.3 })]
  const common = {
    editable: true,
    dependencyEditable: true,
    onScheduleDraft: vi.fn(),
    onDependencyDraft: vi.fn(),
    onProgressDraft: vi.fn(),
    tasks: editTasks,
  }

  it('select 模式：不暴露改期手柄、依赖锚点、进度手柄', () => {
    const { queryByLabelText } = renderLayer({ ...common, mode: 'select' })
    expect(queryByLabelText('改期手柄：调整任务「A」工期')).toBeNull()
    expect(queryByLabelText('依赖开始锚点：任务「A」')).toBeNull()
    expect(queryByLabelText(/调整任务「A」进度/)).toBeNull()
  })

  it('schedule 模式：只暴露改期手柄，不暴露依赖锚点/进度手柄', () => {
    const { queryByLabelText } = renderLayer({ ...common, mode: 'schedule' })
    expect(queryByLabelText('改期手柄：调整任务「A」工期')).not.toBeNull()
    expect(queryByLabelText('依赖开始锚点：任务「A」')).toBeNull()
    expect(queryByLabelText(/调整任务「A」进度/)).toBeNull()
  })

  it('dependency 模式：只暴露依赖锚点', () => {
    const { queryByLabelText } = renderLayer({ ...common, mode: 'dependency' })
    expect(queryByLabelText('依赖开始锚点：任务「A」')).not.toBeNull()
    expect(queryByLabelText('改期手柄：调整任务「A」工期')).toBeNull()
  })

  it('progress 模式：只暴露进度手柄', () => {
    const { queryByLabelText } = renderLayer({ ...common, mode: 'progress' })
    expect(queryByLabelText(/调整任务「A」进度/)).not.toBeNull()
    expect(queryByLabelText('改期手柄：调整任务「A」工期')).toBeNull()
    expect(queryByLabelText('依赖开始锚点：任务「A」')).toBeNull()
  })

  it('省略 mode 时（dev harness）保持全暴露向后兼容', () => {
    const { queryByLabelText } = renderLayer(common)
    expect(queryByLabelText('改期手柄：调整任务「A」工期')).not.toBeNull()
    expect(queryByLabelText('依赖开始锚点：任务「A」')).not.toBeNull()
    expect(queryByLabelText(/调整任务「A」进度/)).not.toBeNull()
  })
})

describe('甘特依赖锚点', () => {
  it('键盘从开始锚点连到结束锚点推断 SF', () => {
    const onDependencyDraft = vi.fn()
    const { getByLabelText } = renderLayer({
      dependencyEditable: true,
      onDependencyDraft,
    })
    fireEvent.keyDown(getByLabelText('依赖开始锚点：任务「A」'), { key: 'Enter' })
    fireEvent.keyDown(getByLabelText('依赖结束锚点：任务「B」'), { key: 'Enter' })
    expect(onDependencyDraft).toHaveBeenCalledWith({
      predecessorId: 1,
      successorId: 2,
      type: 'sf',
    })
  })

  it('只读模式不渲染调整手柄与依赖锚点', () => {
    const { queryByLabelText } = renderLayer({})
    expect(queryByLabelText('改期手柄：调整任务「A」工期')).toBeNull()
    expect(queryByLabelText('依赖开始锚点：任务「A」')).toBeNull()
  })
})

describe('甘特键盘可访问路径（task 5.2/5.4）', () => {
  it('任务条 Enter 打开详情，Ctrl+Enter 多选，Shift+Space 范围选择', () => {
    const onSelect = vi.fn()
    const { getByLabelText } = renderLayer({ onSelect, editable: false })
    const bar = getByLabelText('任务：A，Enter 打开任务依赖详情')

    fireEvent.keyDown(bar, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith(1, { toggle: false, range: false })

    fireEvent.keyDown(bar, { key: 'Enter', ctrlKey: true })
    expect(onSelect).toHaveBeenLastCalledWith(1, { toggle: true, range: false })

    fireEvent.keyDown(bar, { key: ' ', shiftKey: true })
    expect(onSelect).toHaveBeenLastCalledWith(1, { toggle: false, range: true })
  })

  it('只读任务条可聚焦打开详情，但方向键不会生成改期草稿', () => {
    const onSelect = vi.fn()
    const onScheduleDraft = vi.fn()
    const { getByLabelText } = renderLayer({
      editable: false,
      onSelect,
      onScheduleDraft,
    })
    const bar = getByLabelText('任务：A，Enter 打开任务依赖详情')

    expect(bar.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(bar, { key: 'Enter' })
    fireEvent.keyDown(bar, { key: 'ArrowRight' })

    expect(onSelect).toHaveBeenCalledWith(1, { toggle: false, range: false })
    expect(onScheduleDraft).not.toHaveBeenCalled()
  })
})
