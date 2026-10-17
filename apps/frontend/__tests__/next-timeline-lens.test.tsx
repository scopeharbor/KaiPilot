/**
 * v3-ui-next-remaining-lenses W4 任务 4.4 —— 时间线流向镜头渲染与流动主轴测试。
 *
 * 覆盖（tasks 4.4 / spec「时间线流向镜头里程碑与任务流动呈现」场景）：
 * 1. 流动主轴与时间升序节点渲染（里程碑棱形 + 阶段任务卡片混合穿插）；
 * 2. 里程碑 45° 旋转棱形微标与状态信号色（planned / at_risk / achieved / missed）；
 * 3. 阶段任务推进卡片排版：进度百分比、工期、AI Agent 专属标识、逾期标记；
 * 4. 今天流动指示线按插值索引动态锚定（含「今天」发光标签）；
 * 5. 点击「聚焦今天」调用指示线 DOM scrollIntoView（平滑居中）；空数据禁用；
 * 6. 悬停里程碑浮现明细卡（状态、说明、同阶段任务流清单）；
 * 7. 无里程碑 / 无流向节点空态引导卡；接口异常错误卡与「重新载入」恢复。
 */

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { milestonesApi, type Milestone } from '@/lib/api/milestones'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { buildTimelineFlowChain, todayDateKey } from '@/lib/next/lenses-timeline-adapter'
import { WorkspaceTimelineLens } from '@/components/next/lenses/WorkspaceTimelineLens'

// 与组件几何常量保持一致（画板插值定位断言）。
const FLOW_PAD_X = 176
const FLOW_STEP_PX = 280

const PROJECT_ID = 101
const TODAY = todayDateKey()

/** 以本地「今天」为基线的日历平移（UTC 算术，规避 DST）。 */
function day(offset: number): string {
  const parts = TODAY.split('-')
  const y = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 0)
  const d = Number(parts[2] ?? 0)
  const dt = new Date(Date.UTC(y, m - 1, d) + offset * 86_400_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
}

function makeMilestone(id: number, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    projectId: PROJECT_ID,
    name: `里程碑 ${id}`,
    description: null,
    status: 'planned',
    storedStatus: 'planned',
    plannedDate: day(10 + id),
    autoCalculated: false,
    displayOrder: id,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function makeTask(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: PROJECT_ID,
    name: `任务 ${id}`,
    description: null,
    status: 'in_progress',
    priority: 'medium',
    taskType: 'task',
    startDate: day(2 * id),
    endDate: day(2 * id + 3),
    actualStartDate: null,
    actualEndDate: null,
    durationDays: 4,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 40,
    assigneeId: 1,
    assignee: { id: 1, fullName: '张总师', email: 'pm@example.com', initials: 'ZS' },
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function flowFixture(): { milestones: Milestone[]; tasks: Task[] } {
  const milestones = [
    makeMilestone(1, {
      name: '需求冻结',
      status: 'achieved',
      plannedDate: day(-40),
      description: '需求基线封板，进入研发阶段',
    }),
    makeMilestone(2, { name: '联调通过', status: 'missed', plannedDate: day(-10) }),
    makeMilestone(3, {
      name: '验收发布',
      status: 'planned',
      plannedDate: day(20),
      description: '验收通过后发布生产环境',
    }),
    makeMilestone(4, { name: '风险收口', status: 'at_risk', plannedDate: day(45) }),
  ]
  const tasks = [
    makeTask(1, {
      name: '需求评审纪要归档',
      status: 'completed',
      startDate: day(-36),
      endDate: day(-30),
      durationDays: 6,
      progressPercent: 100,
    }),
    makeTask(2, {
      name: '核心链路联调',
      status: 'in_progress',
      startDate: day(-6),
      endDate: day(5),
      durationDays: 11,
      progressPercent: 45,
    }),
    makeTask(3, {
      name: '智能体旁路验证',
      status: 'in_progress',
      startDate: day(0),
      endDate: day(8),
      durationDays: 8,
      progressPercent: 30,
      assigneeId: 11,
      assigneeType: 'agent',
      agentAssignee: { id: 11, name: '排程 Agent', initials: 'AG', model: 'gpt-4' },
    }),
    makeTask(4, {
      name: '发布演练',
      status: 'not_started',
      startDate: day(30),
      endDate: day(35),
      durationDays: 5,
      progressPercent: 0,
    }),
    makeTask(5, {
      name: '缺陷收敛清零',
      status: 'in_progress',
      startDate: day(-12),
      endDate: day(-3),
      durationDays: 9,
      progressPercent: 60,
    }),
  ]
  return { milestones, tasks }
}

function envelopeOf<T>(items: T[]): {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
} {
  return { data: items, meta: { total: items.length, page: 1, perPage: 100, totalPages: 1 } }
}

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
}

function renderLens(
  client: QueryClient,
  opts: {
    projectId?: number
    onRenderComplete?: (metric: { durationMs: number; activeElements: number }) => void
    onOpenTask?: (taskId: number) => void
    focusTaskId?: number | null
  } = {},
) {
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceTimelineLens
        projectId={opts.projectId ?? PROJECT_ID}
        onRenderComplete={opts.onRenderComplete}
        onOpenTask={opts.onOpenTask}
        focusTaskId={opts.focusTaskId}
      />
    </QueryClientProvider>,
  )
}

describe('WorkspaceTimelineLens 时间线流向镜头 (W4)', () => {
  // vi.restoreAllMocks 会清空 setup.ts 的 matchMedia vi.fn polyfill（implementation 归零），
  // 与既有镜头测试同一模式：每用例重建 polyfill，供 useImmersionTier 消费。
  beforeEach(() => {
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('渲染时间升序流动主轴：里程碑棱形锚点与阶段任务卡片穿插', async () => {
    const { milestones, tasks } = flowFixture()
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf(milestones))
    vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))

    const { container } = renderLens(makeClient())

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-canvas]')).toBeInTheDocument()
    })

    // 里程碑与任务节点数量
    expect(container.querySelectorAll('[data-timeline-milestone]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-timeline-task-card]')).toHaveLength(5)
    // 主轴 DOM 顺序严格按日期升序（跨里程碑 / 任务两类图元）
    const dates = Array.from(container.querySelectorAll('[data-timeline-node-date]')).map(
      (el) => el.getAttribute('data-timeline-node-date') ?? '',
    )
    expect(dates).toEqual([...dates].sort())
    // 与纯函数合流结果完全一致（m-1 → t-1 → m-2 → … 穿插顺序）
    const expectedIds = buildTimelineFlowChain(milestones, tasks).chain.map((n) => n.id)
    const renderedIds = Array.from(container.querySelectorAll('[data-timeline-node-id]')).map(
      (el) => el.getAttribute('data-timeline-node-id') ?? '',
    )
    expect(renderedIds).toEqual(expectedIds)
    // 工具栏统计
    expect(container.querySelector('[data-timeline-count-milestones]')?.textContent).toBe('4')
    expect(container.querySelector('[data-timeline-count-tasks]')?.textContent).toBe('5')
    expect(container.querySelector('[data-timeline-legend]')).toBeInTheDocument()
  })

  it('里程碑棱形微标 45° 旋转并按状态信号色着色', async () => {
    const { milestones, tasks } = flowFixture()
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf(milestones))
    vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))

    const { container } = renderLens(makeClient())

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-canvas]')).toBeInTheDocument()
    })

    const diamond = (id: string) =>
      container.querySelector<HTMLElement>(
        `[data-timeline-milestone][data-timeline-node-id="${id}"] [data-timeline-diamond]`,
      )

    // 已达成（achieved）：翠绿实心
    const achieved = diamond('m-1')
    expect(achieved).toBeInTheDocument()
    expect(achieved?.classList.contains('rotate-45')).toBe(true)
    expect(achieved?.style.borderColor).toBe('var(--nx-status-success)')
    expect(achieved?.style.backgroundColor).toBe('var(--nx-status-success)')
    // 已逾期（missed）：绯红实心
    const missed = diamond('m-2')
    expect(missed?.style.borderColor).toBe('var(--nx-status-danger)')
    expect(missed?.style.backgroundColor).toBe('var(--nx-status-danger)')
    // 计划中（planned）：发丝框
    const planned = diamond('m-3')
    expect(planned?.style.borderColor).toBe('var(--nx-text-secondary)')
    // 空心棱形用工作面底色填充，压住主轴线
    expect(planned?.style.backgroundColor).toBe('')
    expect(planned?.classList.contains('bg-[var(--nx-workspace-bg)]')).toBe(true)
    // 有风险（at_risk）：亮琥珀发丝框
    const atRisk = diamond('m-4')
    expect(atRisk?.style.borderColor).toBe('var(--nx-status-warning)')
    expect(atRisk?.style.backgroundColor).toBe('')
    // 锚点下方名称与计划日期
    const name = container.querySelector(
      '[data-timeline-milestone][data-timeline-node-id="m-3"] [data-timeline-milestone-name]',
    )
    expect(name).toHaveTextContent('验收发布')
    expect(
      container.querySelector(
        '[data-timeline-milestone][data-timeline-node-id="m-3"] [data-timeline-milestone-date]',
      ),
    ).toHaveTextContent(day(20))
  })

  it('阶段任务卡片排版：进度百分比、工期、Agent 微标与逾期标记', async () => {
    const { milestones, tasks } = flowFixture()
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf(milestones))
    vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))

    const { container } = renderLens(makeClient())

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-canvas]')).toBeInTheDocument()
    })

    const cardOf = (id: string) =>
      container.querySelector<HTMLElement>(
        `[data-timeline-task-card][data-timeline-node-id="${id}"]`,
      )

    // 进度百分比与工期
    const t2 = cardOf('t-2')
    expect(within(t2 as HTMLElement).getByText('45%')).toBeInTheDocument()
    expect(within(t2 as HTMLElement).getByText('11天')).toBeInTheDocument()
    const t1 = cardOf('t-1')
    expect(within(t1 as HTMLElement).getByText('100%')).toBeInTheDocument()
    expect(within(t1 as HTMLElement).getByText('6天')).toBeInTheDocument()
    // 人类负责人姓名缩写微标
    expect(within(t1 as HTMLElement).getByText('ZS')).toBeInTheDocument()
    expect(within(t1 as HTMLElement).getByText('张总师')).toBeInTheDocument()

    // AI Agent 专属微标
    const t3 = cardOf('t-3')
    const agentBadge = t3?.querySelector('[data-timeline-agent-badge]')
    expect(agentBadge).toHaveAttribute('aria-label', 'AI 负责人')
    expect(agentBadge).toHaveTextContent('AI')

    // 逾期任务：越过截止日未完结 → 逾期标记
    const t5 = cardOf('t-5')
    expect(t5).toHaveAttribute('data-task-overdue', 'true')
    expect(t5?.querySelector('[data-timeline-task-name]')).toHaveTextContent('缺陷收敛清零')
  })

  it('今天流动指示线按插值索引动态锚定', async () => {
    const { milestones, tasks } = flowFixture()
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf(milestones))
    vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))

    const { container } = renderLens(makeClient())

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-canvas]')).toBeInTheDocument()
    })

    const marker = container.querySelector<HTMLElement>('[data-timeline-today-marker]')
    expect(marker).toBeInTheDocument()
    expect(marker).toHaveAttribute('aria-label', '今天流动指示线')
    expect(marker?.textContent).toContain('今天')
    // 位置 = 起点留白 + 插值索引 × 节点步距（浮点，与纯函数结果一致）
    const expectedIndex = buildTimelineFlowChain(milestones, tasks).todayIndex
    const expectedX = FLOW_PAD_X + expectedIndex * FLOW_STEP_PX
    expect(parseFloat(marker?.style.left ?? '')).toBeCloseTo(expectedX, 4)
    // 今天标签为电光天青发丝（组件仅消费令牌，此处断言存在样式绑定）
    expect(marker?.style.height).toBe('344px')
  })

  it('点击「聚焦今天」调用今天指示线 DOM scrollIntoView 平滑居中', async () => {
    const { milestones, tasks } = flowFixture()
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf(milestones))
    vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))

    const { container } = renderLens(makeClient())

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-today-marker]')).toBeInTheDocument()
    })

    const marker = container.querySelector<HTMLElement>('[data-timeline-today-marker]')
    const scrollSpy = vi.fn()
    marker!.scrollIntoView = scrollSpy

    fireEvent.click(screen.getByRole('button', { name: /聚焦今天/ }))
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  })

  it('悬停里程碑浮现明细卡：状态、说明与同阶段任务流清单', async () => {
    const { milestones, tasks } = flowFixture()
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf(milestones))
    vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))

    const { container } = renderLens(makeClient())

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-canvas]')).toBeInTheDocument()
    })

    const m3 = container.querySelector<HTMLElement>(
      '[data-timeline-milestone][data-timeline-node-id="m-3"]',
    )
    fireEvent.mouseEnter(m3 as HTMLElement)

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-hover-card]')).toBeInTheDocument()
    })
    const card = container.querySelector('[data-timeline-hover-card][data-hover-kind="milestone"]')
    expect(card).toHaveTextContent('验收发布')
    expect(card?.querySelector('[data-timeline-hover-status]')).toHaveTextContent('计划中')
    expect(card).toHaveTextContent('验收通过后发布生产环境')
    expect(card).toHaveTextContent('阶段任务流 · 1 项')
    expect(card).toHaveTextContent('发布演练')

    // 键盘聚焦等价打开、离开后关闭
    fireEvent.mouseLeave(m3 as HTMLElement)
    await waitFor(() => {
      expect(container.querySelector('[data-timeline-hover-card]')).not.toBeInTheDocument()
    })
    fireEvent.focus(m3 as HTMLElement)
    await waitFor(() => {
      expect(container.querySelector('[data-timeline-hover-card]')).toBeInTheDocument()
    })
    fireEvent.blur(m3 as HTMLElement)
    await waitFor(() => {
      expect(container.querySelector('[data-timeline-hover-card]')).not.toBeInTheDocument()
    })
  })

  it('任务悬停明细卡展示状态、排期与负责人', async () => {
    const { milestones, tasks } = flowFixture()
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf(milestones))
    vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))

    const { container } = renderLens(makeClient())

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-canvas]')).toBeInTheDocument()
    })

    const t2 = container.querySelector<HTMLElement>(
      '[data-timeline-task-card][data-timeline-node-id="t-2"]',
    )
    fireEvent.mouseEnter(t2 as HTMLElement)

    await waitFor(() => {
      expect(
        container.querySelector('[data-timeline-hover-card][data-hover-kind="task"]'),
      ).toBeInTheDocument()
    })
    const card = container.querySelector('[data-timeline-hover-card][data-hover-kind="task"]')
    expect(card?.querySelector('[data-timeline-hover-status]')).toHaveTextContent('进行中')
    expect(card).toHaveTextContent('排期')
    expect(card).toHaveTextContent(day(-6))
    expect(card).toHaveTextContent(day(5))
    expect(card).toHaveTextContent('张总师')
  })

  it('无里程碑时渲染空态引导卡，聚焦按钮禁用', async () => {
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf([]))
    vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf([]))

    const { container } = renderLens(makeClient())

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-empty]')).toBeInTheDocument()
    })
    expect(container.querySelector('[data-timeline-empty]')).toHaveTextContent('尚未建立里程碑')
    expect(container.querySelector('[data-timeline-canvas]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /聚焦今天/ })).toBeDisabled()
    expect(container.querySelector('[data-timeline-summary]')).not.toBeInTheDocument()
  })

  it('里程碑均未设定计划日期时提示暂无流向节点', async () => {
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(
      envelopeOf([
        makeMilestone(1, { plannedDate: null }),
        makeMilestone(2, { plannedDate: null }),
      ]),
    )
    vi.spyOn(tasksApi, 'list').mockResolvedValue(
      envelopeOf([makeTask(1, { startDate: null, endDate: null })]),
    )

    const { container } = renderLens(makeClient())

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-empty]')).toBeInTheDocument()
    })
    expect(container.querySelector('[data-timeline-empty]')).toHaveTextContent('暂无流向节点')
    expect(container.querySelector('[data-timeline-canvas]')).not.toBeInTheDocument()
  })

  it('接口异常渲染错误卡片，「重新载入」重查后平滑恢复', async () => {
    const { milestones, tasks } = flowFixture()
    const milestoneSpy = vi
      .spyOn(milestonesApi, 'list')
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValue(envelopeOf(milestones))
    const taskSpy = vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))

    const { container } = renderLens(makeClient())

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-error]')).toBeInTheDocument()
    })
    expect(container.querySelector('[data-timeline-error]')).toHaveTextContent('时间线数据加载失败')
    expect(container.querySelector('[data-timeline-error]')).toHaveTextContent('网络中断')
    expect(container.querySelector('[data-timeline-canvas]')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /重新载入/ }))

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-canvas]')).toBeInTheDocument()
    })
    expect(container.querySelector('[data-timeline-error]')).not.toBeInTheDocument()
    expect(milestoneSpy).toHaveBeenCalledTimes(2)
    expect(taskSpy).toHaveBeenCalledTimes(2)
  })

  it('加载期呈现仪器感骨架屏（aria-busy），数据就绪后上报渲染完成度量', async () => {
    const { milestones, tasks } = flowFixture()
    const milestoneSpy = vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf(milestones))
    const taskSpy = vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))
    // 拖慢任务查询以观察骨架屏
    taskSpy.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(envelopeOf(tasks)), 60)),
    )
    void milestoneSpy

    const onRenderComplete = vi.fn()
    const { container } = renderLens(makeClient(), { onRenderComplete })

    const skeleton = container.querySelector('[data-timeline-skeleton]')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(skeleton).toHaveAttribute('role', 'status')

    await waitFor(() => {
      expect(container.querySelector('[data-timeline-canvas]')).toBeInTheDocument()
    })
    expect(container.querySelector('[data-timeline-skeleton]')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(onRenderComplete).toHaveBeenCalledTimes(1)
    })
    const metric = onRenderComplete.mock.calls[0]?.[0]
    expect(metric?.durationMs).toBeGreaterThanOrEqual(0)
    // 活动图元 = 4 里程碑 + 5 任务卡 + 1 今天指示线
    expect(metric?.activeElements).toBe(10)
  })

  it('点任务卡打开详情（含键盘回车）；聚焦任务横向滚到该卡并高亮', async () => {
    const { milestones, tasks } = flowFixture()
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf(milestones))
    vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const onOpenTask = vi.fn()

    const { container } = renderLens(makeClient(), { onOpenTask, focusTaskId: 4 })
    await waitFor(() => {
      expect(container.querySelector('[data-timeline-canvas]')).toBeInTheDocument()
    })

    const openTarget = (taskId: number) =>
      container.querySelector<HTMLElement>(
        `[data-timeline-task-card][data-task-id="${taskId}"] [data-timeline-task-open]`,
      )!
    fireEvent.click(openTarget(2))
    expect(onOpenTask).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(openTarget(1), { key: 'Enter' })
    expect(onOpenTask).toHaveBeenLastCalledWith(1)

    const focused = container.querySelector('[data-timeline-task-card][data-task-id="4"]')
    expect(focused).toHaveAttribute('data-focused', 'true')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(focused)
  })

  it('今天指示线压在任务卡之下（不再遮挡卡片内容）', async () => {
    const { milestones, tasks } = flowFixture()
    vi.spyOn(milestonesApi, 'list').mockResolvedValue(envelopeOf(milestones))
    vi.spyOn(tasksApi, 'list').mockResolvedValue(envelopeOf(tasks))
    const { container } = renderLens(makeClient())
    await waitFor(() => {
      expect(container.querySelector('[data-timeline-today-marker]')).toBeInTheDocument()
    })
    const marker = container.querySelector('[data-timeline-today-marker]')!
    expect(marker.className).not.toMatch(/\bz-\d+/)
    // 棱形有实际尺寸（此前缺 h/w，只剩一个点）
    const diamond = container.querySelector('[data-timeline-diamond]')!
    expect(diamond.classList.contains('h-4')).toBe(true)
    expect(diamond.classList.contains('w-4')).toBe(true)
  })
})
