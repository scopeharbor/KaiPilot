/**
 * v3-ui-next-gantt-lens W2（task 2.3/2.4）—— 拖拽手柄、整数天吸附、幽灵条与 RBAC 权限防线测试。
 *
 * 排坑要点（design 决策 10）：
 * - 逐 `fireEvent` 派发完整指针序列（pointerdown → pointermove × N → pointerup），
 *   严禁包入单一 `act()`，保证中间态吸附/幽灵条重渲染可见；
 * - 注入 `getBoundingClientRect` 几何模拟（jsdom 缺省全 0，防止任何库内几何换算 NaN），
 *   本 hook 的吸附换算本身走纯数学（ΔclientX / pxPerDay，不经 DOM 几何）。
 *
 * 覆盖：平移/工期拉伸/里程碑平移命令派发、整数天吸附、幽灵条渲染与吸附、只读观察者
 * 与 `task:update:self` 非本人禁用（0 命令派发）。
 */

import * as React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useGanttDragInteraction,
  type GanttDragHandleKind,
} from '@/hooks/use-gantt-drag-interaction'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import { useAuthStore } from '@/stores/auth-store'
import type { GanttRenderDependency, GanttRenderTask } from '@/lib/gantt/types'

/** 画板几何注入：视口 1200×800（与 W1 画板一致，防止库内几何换算 NaN）。 */
const VIEWPORT = { width: 1200, height: 800 }

const EPOCH_MS = Date.UTC(2026, 0, 12) // 周一
const MS_PER_DAY = 86_400_000
const PX_PER_DAY = 28

function iso(day: number): string {
  return new Date(EPOCH_MS + day * MS_PER_DAY).toISOString().slice(0, 10)
}

function makeTask(
  id: number,
  startDay: number,
  durationDays: number,
  overrides: Partial<GanttRenderTask> = {},
): GanttRenderTask {
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
    ...overrides,
  }
}

const TASKS: readonly GanttRenderTask[] = [
  makeTask(1, 0, 5),
  makeTask(2, 5, 3),
  makeTask(3, 8, 0, { kind: 'milestone', milestoneId: 40, name: '里程碑M1' }),
  makeTask(4, 12, 2, { assignee: { id: 2, initials: 'ZZ', name: '张泽' } }),
]
const DEPS: readonly GanttRenderDependency[] = []

function DragHarness({ taskId, kind }: { taskId: number; kind: GanttDragHandleKind }) {
  const task = TASKS.find((t) => t.id === taskId)!
  const { ghost, getMoveHandleProps, getResizeHandleProps, getMilestoneHandleProps } =
    useGanttDragInteraction({
      tasks: TASKS,
      dependencies: DEPS,
      calendarSettings: null,
      epochMs: EPOCH_MS,
      pxPerDay: PX_PER_DAY,
      projectId: 101,
    })
  const handleProps =
    kind === 'move'
      ? getMoveHandleProps(task)
      : kind === 'resize'
        ? getResizeHandleProps(task)
        : getMilestoneHandleProps(task)

  return (
    <>
      <div
        data-task-bar
        data-testid={`bar-${task.id}`}
        data-task-id={task.id}
        data-task-kind={task.kind}
        data-handle-disabled={handleProps.disabled ? 'true' : 'false'}
        {...handleProps}
      >
        {task.name}
      </div>
      {ghost?.active && ghost.taskId === task.id ? (
        <div
          data-gantt-ghost-bar
          data-testid="ghost-bar"
          data-ghost-task-id={ghost.taskId}
          data-ghost-kind={ghost.kind}
          data-ghost-start-day={ghost.startDay}
          data-ghost-duration={ghost.durationDays}
        />
      ) : null}
    </>
  )
}

function resetStores() {
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

/**
 * jsdom 未实现 PointerEvent：RTL 的 fireEvent.pointer* 会退化为普通 Event，
 * 静默丢弃 clientX/pointerId（排坑：与 design 决策 10 的 getBoundingClientRect 注入同源问题）。
 * 以 MouseEvent 充当 PointerEvent 构造器，事件即可携带坐标；pointerId 恒为 undefined，
 * hook 的指针身份比对（===）仍成立。
 */
function polyfillPointerEvent() {
  if (typeof window.PointerEvent === 'undefined') {
    ;(window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent
  }
}

function setPermissions(permissions: string[], userId = 1) {
  useAuthStore.setState({
    user: {
      id: userId,
      email: 'user@example.com',
      fullName: '测试用户',
      organizations: [],
      isSuperAdmin: false,
    },
    permissions,
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
  })
}

/** 完整拖拽序列：逐 fireEvent 派发（不包单 act），返回最终命令快照。 */
function performDrag(
  handle: Element,
  startX: number,
  moves: Array<{ x: number; y?: number }>,
  endX: number,
) {
  fireEvent.pointerDown(handle, { clientX: startX, clientY: 100, pointerId: 1, button: 0 })
  for (const move of moves) {
    fireEvent.pointerMove(handle, { clientX: move.x, clientY: move.y ?? 100, pointerId: 1 })
  }
  fireEvent.pointerUp(handle, { clientX: endX, clientY: 100, pointerId: 1 })
}

function barOf(id: number): HTMLElement {
  return screen.getByTestId(`bar-${id}`)
}

function queryGhost(): HTMLElement | null {
  return screen.queryByTestId('ghost-bar')
}

beforeEach(() => {
  resetStores()
  setPermissions(['task:update'])
  polyfillPointerEvent()
  // 几何注入（排坑：jsdom 缺省矩形全 0）
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: VIEWPORT.width,
    bottom: VIEWPORT.height,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    toJSON: () => ({}),
  })
  // jsdom 无指针捕获实现：桩掉避免 “Not implemented”
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('拖拽交互 hook（B4 甘特镜头 W2）', () => {
  it('平移拖拽：整数天吸附 + 幽灵条渲染 + pointerup 派发 move-task 命令并唤起沙盒', () => {
    render(<DragHarness taskId={1} kind="move" />)
    const bar = barOf(1)
    const startX = 100

    // pointerdown：未激活（阈值内），不渲染激活态幽灵条
    fireEvent.pointerDown(bar, { clientX: startX, clientY: 100, pointerId: 1, button: 0 })
    expect(queryGhost()).toBeNull()

    // 越过 5px 激活阈值：Δ=6px → round(6/28)=0 天 → 幽灵条吸附现值 0
    fireEvent.pointerMove(bar, { clientX: startX + 6, clientY: 100, pointerId: 1 })
    let ghost = queryGhost()
    expect(ghost).not.toBeNull()
    expect(ghost!.getAttribute('data-ghost-start-day')).toBe('0')

    // 移至 +2 天 + 13px（97px → round(3.46)=3 天，整数天吸附验证）
    fireEvent.pointerMove(bar, {
      clientX: startX + PX_PER_DAY * 3 + 13,
      clientY: 100,
      pointerId: 1,
    })
    ghost = queryGhost()
    expect(ghost!.getAttribute('data-ghost-start-day')).toBe('3')
    expect(ghost!.getAttribute('data-ghost-duration')).toBe('5')
    expect(ghost!.getAttribute('data-ghost-kind')).toBe('move')

    // 拖拽中（未释放）零命令，session 未建立
    expect(useWhatIfSessionStore.getState().session.status).toBe('idle')

    // 释放：吸附位移 3 天 ≠ 0 → 派发 move-task 并惰性进入沙盒
    fireEvent.pointerUp(bar, { clientX: startX + PX_PER_DAY * 3 + 13, clientY: 100, pointerId: 1 })
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('active')
    expect(s.projectId).toBe(101)
    expect(s.history.cursor).toBe(1)
    expect(s.history.entries[0]).toEqual({
      kind: 'move-task',
      taskId: 1,
      newStartDate: iso(3),
    })
    expect(s.derivedPreview!.model.tasks.find((t) => t.id === 1)!.startDay).toBe(3)
    expect(s.hasUnsavedChanges).toBe(true)
    expect(queryGhost()).toBeNull()
  })

  it('吸附回原位（Δ=0 天）不派发命令、不建立 session', () => {
    render(<DragHarness taskId={1} kind="move" />)
    const bar = barOf(1)
    // 位移 28*0 + 10px → round(10/28)=0 天
    performDrag(bar, 100, [{ x: 100 + 10 }], 100 + 10)
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('idle')
    expect(s.history.cursor).toBe(0)
  })

  it('右端工期拉伸：resize-duration 命令（保留起点、新终点）', () => {
    render(<DragHarness taskId={2} kind="resize" />)
    const bar = barOf(2)
    const startX = 500
    fireEvent.pointerDown(bar, { clientX: startX, clientY: 100, pointerId: 1, button: 0 })
    // +2 天 + 10px（66px → round(66/28)=2 天）→ 工期 3 → 5
    fireEvent.pointerMove(bar, {
      clientX: startX + PX_PER_DAY * 2 + 10,
      clientY: 100,
      pointerId: 1,
    })
    const ghost = queryGhost()
    expect(ghost!.getAttribute('data-ghost-start-day')).toBe('5')
    expect(ghost!.getAttribute('data-ghost-duration')).toBe('5')

    fireEvent.pointerUp(bar, { clientX: startX + PX_PER_DAY * 2 + 10, clientY: 100, pointerId: 1 })
    const s = useWhatIfSessionStore.getState().session
    expect(s.history.entries[0]).toEqual({
      kind: 'resize-duration',
      taskId: 2,
      newStartDate: iso(5),
      newEndDate: iso(9), // 5 + 5 - 1
    })
  })

  it('左向拉伸压缩工期保底 1 天', () => {
    render(<DragHarness taskId={2} kind="resize" />)
    const bar = barOf(2)
    const startX = 500
    fireEvent.pointerDown(bar, { clientX: startX, clientY: 100, pointerId: 1, button: 0 })
    // -6 天（-168px）→ 工期 max(1, 3-6)=1
    fireEvent.pointerMove(bar, { clientX: startX - PX_PER_DAY * 6, clientY: 100, pointerId: 1 })
    expect(queryGhost()!.getAttribute('data-ghost-duration')).toBe('1')
    fireEvent.pointerUp(bar, { clientX: startX - PX_PER_DAY * 6, clientY: 100, pointerId: 1 })
    expect(useWhatIfSessionStore.getState().session.history.entries[0]).toEqual({
      kind: 'resize-duration',
      taskId: 2,
      newStartDate: iso(5),
      newEndDate: iso(5), // 5 + 1 - 1
    })
  })

  it('里程碑平移：milestone-move 命令（milestoneId 取自实体）', () => {
    render(<DragHarness taskId={3} kind="milestone" />)
    const bar = barOf(3)
    const startX = 800
    // +2 天（57px → round(2.03)=2）
    performDrag(bar, startX, [{ x: startX + PX_PER_DAY * 2 + 1 }], startX + PX_PER_DAY * 2 + 1)
    const s = useWhatIfSessionStore.getState().session
    expect(s.history.entries[0]).toEqual({
      kind: 'milestone-move',
      milestoneId: 40,
      taskId: 3,
      newDate: iso(10),
    })
  })

  it('任务条主体拖拽里程碑行自动降级为里程碑平移', () => {
    render(<DragHarness taskId={3} kind="move" />)
    const bar = barOf(3)
    const startX = 800
    performDrag(bar, startX, [{ x: startX + PX_PER_DAY * 1 + 3 }], startX + PX_PER_DAY * 1 + 3)
    const s = useWhatIfSessionStore.getState().session
    expect(s.history.entries[0]).toEqual({
      kind: 'milestone-move',
      milestoneId: 40,
      taskId: 3,
      newDate: iso(9),
    })
  })

  it('只读观察者（无排程编辑权限）：手柄 disabled，0 命令派发，session 保持 idle', () => {
    setPermissions(['project:view', 'task:view'])
    render(<DragHarness taskId={1} kind="move" />)
    const bar = barOf(1)
    expect(bar.getAttribute('data-handle-disabled')).toBe('true')

    performDrag(bar, 100, [{ x: 100 + PX_PER_DAY * 4 }], 100 + PX_PER_DAY * 4)
    const s = useWhatIfSessionStore.getState().session
    expect(s.status).toBe('idle')
    expect(s.history.cursor).toBe(0)
    expect(s.baseSnapshot).toBeNull()
  })

  it('仅 task:update:self：甘特拖动即改排期，无论是否本人负责一律禁拖（改期交项目经理）', () => {
    setPermissions(['task:update:self'])
    render(
      <>
        <DragHarness taskId={4} kind="move" />
        <DragHarness taskId={1} kind="move" />
      </>,
    )
    // 任务 4 负责人为他人（id=2 ≠ 当前用户 1）：禁用
    const bar4 = barOf(4)
    expect(bar4.getAttribute('data-handle-disabled')).toBe('true')
    performDrag(bar4, 100, [{ x: 100 + PX_PER_DAY * 2 }], 100 + PX_PER_DAY * 2)
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(0)

    // 任务 1 无负责人（本人无 task:update）→ 仍禁用
    const bar1 = barOf(1)
    expect(bar1.getAttribute('data-handle-disabled')).toBe('true')

    // 任务 4 改为本人负责（assignee.id = 1）：仍禁拖——成员推进状态 / 进度，排期由项目经理调整
    cleanup()
    resetStores()
    const TASKS_SELF = [makeTask(4, 12, 2, { assignee: { id: 1, initials: 'ME', name: '本人' } })]
    function SelfHarness() {
      const task = TASKS_SELF[0]!
      const { getMoveHandleProps } = useGanttDragInteraction({
        tasks: TASKS_SELF,
        dependencies: DEPS,
        calendarSettings: null,
        epochMs: EPOCH_MS,
        pxPerDay: PX_PER_DAY,
        projectId: 101,
      })
      const props = getMoveHandleProps(task)
      return (
        <div
          data-task-bar
          data-testid="bar-4"
          data-task-id={4}
          data-handle-disabled={props.disabled ? 'true' : 'false'}
          {...props}
        >
          任务4
        </div>
      )
    }
    render(<SelfHarness />)
    const bar = barOf(4)
    expect(bar.getAttribute('data-handle-disabled')).toBe('true')
    performDrag(bar, 100, [{ x: 100 + PX_PER_DAY * 2 }], 100 + PX_PER_DAY * 2)
    expect(useWhatIfSessionStore.getState().session.history.cursor).toBe(0)
  })

  it('里程碑无工期拉伸手柄（resize 返回 disabled）', () => {
    render(<DragHarness taskId={3} kind="resize" />)
    expect(barOf(3).getAttribute('data-handle-disabled')).toBe('true')
  })
})
