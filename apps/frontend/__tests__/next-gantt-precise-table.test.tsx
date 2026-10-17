/**
 * v3-ui-next-gantt-lens tasks 3.9 —— 精确档表格化甘特测试。
 *
 * 覆盖（spec「精确档高密度纯 DOM 表格化甘特降级」两场景 + design D2）：
 * - precise 档：纯 DOM 表格（零 SVG）、发丝线日期网格、实色条按天对齐、今天列高亮；
 * - 左侧紧凑信息表：WBS/名称/起止日期/工期/状态/负责人/前置微章（FS #id）；
 * - 拖拽等价：实色条平移（move-task）与右缘拉伸（resize-duration）自动唤起 What-if
 *   沙盒（enterSession），活跃沙盒中拖拽续接同一命令栈（不重复 enter）；
 * - 权限防线：只读（canEdit=false）无手柄、零命令；stale 沙盒拒绝新命令；
 * - 行点击写入 gantt-store selectedTaskId（任务选中聚焦等价）。
 */
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  WorkspaceGanttPreciseTable,
  preciseDayToIso,
  type PreciseTableSessionController,
} from '@/components/next/gantt/WorkspaceGanttPreciseTable'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useGanttStore } from '@/stores/gantt-store'
import type { GanttModel } from '@/lib/gantt/types'
import type { WhatIfSessionStatus } from '@/lib/gantt/what-if-types'

/** epoch 对齐今天：确保「今天」列落在网格内。 */
const EPOCH_MS = (() => {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
})()

const MODEL: GanttModel = {
  tasks: [
    {
      id: 1,
      name: '支付网关联调',
      wbsCode: '1.1',
      depth: 0,
      parentId: null,
      kind: 'task',
      startDay: 0,
      durationDays: 5,
      progress: 0.4,
      status: 'in_progress',
      assignee: { id: 9, initials: '张', name: '张三' },
    },
    {
      id: 2,
      name: '联调验收',
      wbsCode: '1.2',
      depth: 0,
      parentId: null,
      kind: 'task',
      startDay: 7,
      durationDays: 3,
      progress: 0,
      status: 'not_started',
    },
    {
      id: 3,
      name: '原型发布',
      wbsCode: 'M1',
      depth: 0,
      parentId: null,
      kind: 'milestone',
      startDay: 12,
      durationDays: 0,
      progress: 1,
      status: 'in_progress',
      milestoneId: 5,
    },
  ],
  dependencies: [{ id: 1, predecessorId: 1, successorId: 2, type: 'fs', lagDays: 0 }],
  milestones: [],
  timeRange: { startDay: 0, endDay: 15 },
  epochMs: EPOCH_MS,
}

function makeSession(status: WhatIfSessionStatus = 'idle') {
  return {
    status,
    enterSession: vi.fn(),
    executeCommand: vi.fn(() => ({ valid: true, error: null })),
  } as unknown as PreciseTableSessionController & {
    enterSession: ReturnType<typeof vi.fn>
    executeCommand: ReturnType<typeof vi.fn>
  }
}

function pointerEvent(type: string, x: number, y: number) {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    clientX: x,
    clientY: y,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    pointerType: 'mouse',
  })
  return event
}

function renderTable(session: ReturnType<typeof makeSession>, canEdit = true) {
  return render(
    <WorkspaceGanttPreciseTable
      model={MODEL}
      calendarSettings={null}
      canEdit={canEdit}
      session={session}
    />,
  )
}

describe('components/next/gantt/WorkspaceGanttPreciseTable', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // restoreAllMocks 会把 setup.ts 注入的 matchMedia mock 实现重置为空，按 setup 同款重建
    if (typeof window !== 'undefined') {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    }
    useNextTrackStore.getState().setImmersionTier(null)
    act(() => useGanttStore.getState().resetInteraction())
  })

  afterEach(() => {
    useNextTrackStore.getState().setImmersionTier(null)
  })

  test('precise 档渲染为纯 DOM 表格：零 SVG、发丝线日期网格、今天列高亮', () => {
    useNextTrackStore.getState().setImmersionTier('precise')
    const { container } = renderTable(makeSession())

    expect(container.querySelector('[data-precise-table]')).not.toBeNull()
    expect(container.querySelector('[data-immersion="precise"]')).not.toBeNull()
    // 纯 DOM 表格：绝对不允许 SVG 图元
    expect(container.querySelectorAll('svg').length).toBe(0)
    // 高密度发丝线网格：16 天单元格 + 今天列
    expect(container.querySelectorAll('[data-precise-day-col]').length).toBe(16)
    expect(container.querySelector('[data-precise-today-col]')).not.toBeNull()
    expect(container.querySelector('[data-precise-rows="3"]')).not.toBeNull()
  })

  test('左侧紧凑信息表：WBS/名称/起止日期/工期/状态/负责人/前置微章', () => {
    const { container } = renderTable(makeSession())

    // 名称同时出现在左表与实色条（等价展示），断言定位到左表行
    const leftRow1 = container.querySelectorAll('[data-precise-row="1"]')[0]!
    const leftRow2 = container.querySelectorAll('[data-precise-row="2"]')[0]!
    const leftRow3 = container.querySelectorAll('[data-precise-row="3"]')[0]!
    expect(leftRow1.textContent).toContain('支付网关联调')
    expect(leftRow2.textContent).toContain('联调验收')
    expect(leftRow3.textContent).toContain('◆ 原型发布')
    expect(leftRow1.textContent).toContain('1.1')
    expect(leftRow1.textContent).toContain('5天')
    expect(leftRow1.textContent).toContain('进行中')
    expect(leftRow1.textContent).toContain('张')
    // 前置依赖徽章：FS #1（紧凑文本徽章，点击可高亮前后行见 store 选中测试）
    const badge = container.querySelector('[data-precise-dep-badge]')
    expect(badge?.textContent).toBe('FS #1')
    // 起止日期列
    expect(leftRow1.textContent).toContain(preciseDayToIso(EPOCH_MS, 0))
  })

  test('右侧实色条按天对齐：几何左缘/宽度与日期网格一致；里程碑棱形锚定', () => {
    const { container } = renderTable(makeSession())

    const bar1 = container.querySelector('[data-precise-bar="1"]') as HTMLElement
    const bar2 = container.querySelector('[data-precise-bar="2"]') as HTMLElement
    expect(bar1.style.left).toBe('0px')
    expect(bar1.style.width).toBe('220px') // 5 天 × 44px
    expect(bar2.style.left).toBe('308px') // 7 天 × 44px
    expect(bar2.style.width).toBe('132px') // 3 天 × 44px
    // 里程碑：45° 棱形字符锚定在对应日期列
    const milestone = container.querySelector('[data-precise-milestone="3"]') as HTMLElement
    expect(milestone).not.toBeNull()
    expect(milestone.style.left).toBe('528px') // 12 天 × 44px
    expect(milestone.textContent).toContain('◆')
  })

  test('实色条拖拽平移：自动唤起 What-if 沙盒并派发 move-task 命令（零持久化零网络）', () => {
    const session = makeSession('idle')
    const { container } = renderTable(session)

    const bar = container.querySelector('[data-precise-bar="1"]') as HTMLElement
    fireEvent(bar, pointerEvent('pointerdown', 100, 60))
    // 幽灵投影条：+2 天吸附
    fireEvent(window, pointerEvent('pointermove', 188, 60))
    expect(container.querySelector('[data-precise-ghost]')).not.toBeNull()
    fireEvent(window, pointerEvent('pointerup', 188, 60))

    // 进入沙盒（正式数据零写入：仅内存 session）
    expect(session.enterSession).toHaveBeenCalledTimes(1)
    expect(session.enterSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      null,
      expect.stringMatching(/^v_/),
    )
    expect(session.executeCommand).toHaveBeenCalledTimes(1)
    expect(session.executeCommand.mock.calls[0]![0]).toMatchObject({
      kind: 'move-task',
      taskId: 1,
      newStartDate: preciseDayToIso(EPOCH_MS, 2),
    })
  })

  test('右缘把手拉伸工期：活跃沙盒续接同一命令栈派发 resize-duration', () => {
    const session = makeSession('active')
    const { container } = renderTable(session)

    const handle = container.querySelector('[data-precise-resize]') as HTMLElement
    expect(handle).not.toBeNull()
    fireEvent(handle, pointerEvent('pointerdown', 220, 60))
    fireEvent(window, pointerEvent('pointermove', 264, 60)) // +1 天
    fireEvent(window, pointerEvent('pointerup', 264, 60))

    // 已活跃沙盒：不重复 enterSession，直接追加命令
    expect(session.enterSession).not.toHaveBeenCalled()
    expect(session.executeCommand).toHaveBeenCalledTimes(1)
    expect(session.executeCommand.mock.calls[0]![0]).toMatchObject({
      kind: 'resize-duration',
      taskId: 1,
      newStartDate: preciseDayToIso(EPOCH_MS, 0),
      newEndDate: preciseDayToIso(EPOCH_MS, 5), // 工期 5 天 → 6 天（含当日）
    })
  })

  test('无位移（delta=0）不派发任何命令', () => {
    const session = makeSession('active')
    const { container } = renderTable(session)

    const bar = container.querySelector('[data-precise-bar="1"]') as HTMLElement
    fireEvent(bar, pointerEvent('pointerdown', 100, 60))
    fireEvent(window, pointerEvent('pointermove', 104, 60)) // 4px < 半格，吸附回 0
    fireEvent(window, pointerEvent('pointerup', 104, 60))
    expect(session.executeCommand).not.toHaveBeenCalled()
    expect(session.enterSession).not.toHaveBeenCalled()
  })

  test('只读观察者（canEdit=false）：无拉伸手柄、拖拽零命令、不唤起沙盒', () => {
    const session = makeSession('idle')
    const { container } = renderTable(session, false)

    expect(container.querySelectorAll('[data-precise-resize]').length).toBe(0)
    const bar = container.querySelector('[data-precise-bar="1"]') as HTMLElement
    fireEvent(bar, pointerEvent('pointerdown', 100, 60))
    fireEvent(window, pointerEvent('pointermove', 300, 60))
    fireEvent(window, pointerEvent('pointerup', 300, 60))
    expect(session.enterSession).not.toHaveBeenCalled()
    expect(session.executeCommand).not.toHaveBeenCalled()
  })

  test('stale 沙盒拒绝新拖拽命令（TOCTOU 防线，恢复动作由 HUD 提供）', () => {
    const session = makeSession('stale')
    const { container } = renderTable(session)

    const bar = container.querySelector('[data-precise-bar="1"]') as HTMLElement
    fireEvent(bar, pointerEvent('pointerdown', 100, 60))
    fireEvent(window, pointerEvent('pointermove', 300, 60))
    fireEvent(window, pointerEvent('pointerup', 300, 60))
    expect(session.enterSession).not.toHaveBeenCalled()
    expect(session.executeCommand).not.toHaveBeenCalled()
  })

  test('行点击选中任务写入 gantt-store（任务选中聚焦等价）', () => {
    const session = makeSession()
    const { container } = renderTable(session)

    const leftRow = container.querySelectorAll('[data-precise-row="1"]')[0] as HTMLElement
    fireEvent.click(leftRow)
    expect(useGanttStore.getState().selectedTaskId).toBe(1)
  })
})
