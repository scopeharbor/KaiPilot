/**
 * v3-ui-next-gantt-lens W4 tasks 4.2 —— 新轨甘特端到端全链路集成测试。
 *
 * 全链路覆盖（tasks 4.2 / spec「全链路端到端闭环」/ design 决策 10）：
 * 1. 镜头切换：从看板切换至甘特镜头，?lens=gantt URL 双向绑定；
 * 2. 甘特渲染：暗黑仪器感画板就绪，日标尺、今天线、任务条与依赖连线；
 * 3. 拖拽进沙盒：
 *    - jsdom 本地 polyfill PointerEvent = MouseEvent；
 *    - 逐 fireEvent 派发（不包单 act），注入 getBoundingClientRect 几何；
 *    - 拖拽平移任务自动激活 What-if 沙盒，零网络写操作（RL-08）；
 * 4. 仪器感 HUD 与影响抽屉：展示变更计数与浓缩标签，展开抽屉核对工期变动；
 * 5. Undo / Redo：多步撤销与重做；
 * 6. 两阶段提交全链路：mock ganttSchedulingApi 的 preview → commit 顺序提交成功并刷新；
 * 7. 409 Stale 恢复与放弃回滚：模拟并发冲突置 stale，放弃试算无损回滚；
 * 8. 未保存离开守卫拦截：切镜头被阻断弹出模态框，留在当前 vs 放弃并离开放行。
 */

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectSpaceContainer } from '@/components/next/project-space/ProjectSpaceContainer'
import { projectsApi, type Project } from '@/lib/api/projects'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { dependenciesApi, type TaskDependency } from '@/lib/api/dependencies'
import { milestonesApi, type Milestone } from '@/lib/api/milestones'
import { kanbanApi, type KanbanColumn } from '@/lib/api/kanban'
import { ganttSchedulingApi } from '@/lib/api/gantt-scheduling'
import { useAuthStore } from '@/stores/auth-store'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'

// ---------------------------------------------------------------------------
// 1. jsdom 环境 Polyfill 与全局 Mock
// ---------------------------------------------------------------------------

function polyfillPointerEvent() {
  if (typeof window.PointerEvent === 'undefined') {
    class FakePointerEvent extends MouseEvent {
      readonly pointerId: number
      constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
        super(type, params)
        this.pointerId = params.pointerId ?? 1
      }
    }
    ;(window as unknown as { PointerEvent: typeof FakePointerEvent }).PointerEvent =
      FakePointerEvent
  }
}

const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: navMock.push,
    replace: navMock.replace,
    back: navMock.back,
  }),
  useSearchParams: () => new URLSearchParams(),
}))

const toastMock = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: toastMock.toast }),
  toast: toastMock.toast,
}))

// ---------------------------------------------------------------------------
// 2. Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 42

function makeProject(): Project {
  return {
    id: PROJECT_ID,
    organizationId: 1,
    name: '星舰智能排程系统',
    code: 'STAR-42',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-10-31',
    budgetCents: null,
    currency: null,
    progressPercent: 20,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  }
}

function makeTask(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: PROJECT_ID,
    name: `排程任务 ${id}`,
    description: null,
    status: 'in_progress',
    priority: 'high',
    taskType: 'task',
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    actualStartDate: null,
    actualEndDate: null,
    durationDays: 5,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 30,
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

const FIXTURE_TASKS: Task[] = [
  makeTask(1, {
    name: '动力系统自检',
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    durationDays: 5,
  }),
  makeTask(2, {
    name: '导航链路标定',
    startDate: '2026-09-06',
    endDate: '2026-09-10',
    durationDays: 5,
  }),
]

const FIXTURE_DEPS: TaskDependency[] = [
  {
    id: 1,
    predecessorId: 1,
    successorId: 2,
    type: 'fs',
    lagDays: 0,
    predecessor: {
      id: 1,
      name: '动力系统自检',
      status: 'in_progress',
      startDate: '2026-09-01',
      endDate: '2026-09-05',
    },
    successor: {
      id: 2,
      name: '导航链路标定',
      status: 'in_progress',
      startDate: '2026-09-06',
      endDate: '2026-09-10',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: null,
  },
]

const FIXTURE_MILESTONES: Milestone[] = []

const boardState: Record<KanbanColumn, Task[]> = {
  pending: [],
  in_progress: FIXTURE_TASKS,
  completed: [],
  other: [],
}

// ---------------------------------------------------------------------------
// 3. 辅助函数
// ---------------------------------------------------------------------------

function setAuth(permissions = ['task:update', 'task:view', 'project:view']) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '张总师',
      organizations: [{ id: 1, name: '开项空间', slug: 'aiproj', role: 'admin' }],
      isSuperAdmin: false,
    },
    currentOrganizationId: 1,
    permissions,
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
  })
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
  useProjectSpaceEntityStore.getState().clear(PROJECT_ID)
}

/** 逐 fireEvent 派发拖拽指针序列（不包单 act） */
function performDragSequence(handle: Element, startX: number, endX: number) {
  fireEvent.pointerDown(handle, { clientX: startX, clientY: 100, pointerId: 1, button: 0 })
  // 产生轻微位移突破 5px 激活阈值
  fireEvent.pointerMove(handle, { clientX: startX + 15, clientY: 100, pointerId: 1 })
  // 移动到目标落点
  fireEvent.pointerMove(handle, { clientX: endX, clientY: 100, pointerId: 1 })
  // 释放指针
  fireEvent.pointerUp(handle, { clientX: endX, clientY: 100, pointerId: 1 })
}

describe('v3-ui-next-gantt-lens 全链路集成测试 (W4)', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    polyfillPointerEvent()
    resetStores()
    setAuth()

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

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })

    // 注入 getBoundingClientRect 几何模拟
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 800,
        right: 1200,
        width: 1200,
        height: 800,
        toJSON: () => {},
      }
    })

    // Mock API 接口
    vi.spyOn(projectsApi, 'get').mockResolvedValue(makeProject())
    vi.spyOn(tasksApi, 'list').mockResolvedValue({
      data: FIXTURE_TASKS,
      meta: { total: 2, page: 1, pageSize: 100, totalPages: 1 },
    } as unknown as ReturnType<typeof tasksApi.list> extends Promise<infer R> ? R : never)
    vi.spyOn(dependenciesApi, 'listByProject').mockResolvedValue(FIXTURE_DEPS)
    vi.spyOn(milestonesApi, 'list').mockResolvedValue({
      data: FIXTURE_MILESTONES,
      meta: { total: 0, page: 1, pageSize: 100, totalPages: 0 },
    } as unknown as ReturnType<typeof milestonesApi.list> extends Promise<infer R> ? R : never)
    vi.spyOn(kanbanApi, 'listColumn').mockImplementation(async (_pid, col) => ({
      data: boardState[col] ?? [],
      meta: { total: (boardState[col] ?? []).length, page: 1, perPage: 100, totalPages: 1 },
    }))

    // 初始 URL
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}`)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('镜头切换：从看板平滑切至甘特时间镜头，URL 绑定 ?lens=gantt 并渲染画板', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={PROJECT_ID} />
      </QueryClientProvider>,
    )

    // 初始处于看板镜头
    await waitFor(() => {
      expect(container.querySelector('[data-project-space-board-slot]')).toBeInTheDocument()
    })
    expect(container.querySelector('[data-project-space-gantt-slot]')).not.toBeInTheDocument()

    // 查找并点击 LensSwitcher 中的「甘特图」
    const ganttTrigger = screen.getByRole('button', { name: '甘特图' })
    expect(ganttTrigger).toBeInTheDocument()
    fireEvent.click(ganttTrigger)

    // 看板 slot 卸载，甘特 slot 挂载
    await waitFor(() => {
      expect(container.querySelector('[data-project-space-gantt-slot]')).toBeInTheDocument()
      expect(container.querySelector('[data-gantt-chart]')).toBeInTheDocument()
    })

    // URL 双向绑定更新为 ?lens=gantt
    expect(window.location.search).toContain('lens=gantt')
  })

  it('甘特默认只读浏览态：零网络写请求、无 What-if HUD 横幅', async () => {
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=gantt`)

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={PROJECT_ID} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-gantt-chart]')).toBeInTheDocument()
    })

    // 默认只读浏览态，无试算 HUD
    expect(container.querySelector('[data-what-if-hud]')).not.toBeInTheDocument()

    // 画板工具栏与图元正常呈现
    expect(container.querySelector('[data-gantt-toolbar]')).toBeInTheDocument()
    expect(container.querySelector('[data-gantt-canvas]')).toBeInTheDocument()
  })

  it('拖拽平移任务条自动激活 What-if 沙盒并展示 HUD（零网络写 RL-08）', async () => {
    const scheduleSpy = vi.spyOn(ganttSchedulingApi, 'execute')
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=gantt`)

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={PROJECT_ID} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-gantt-canvas]')).toBeInTheDocument()
    })

    // 找到任务 1 的图元
    const taskBarGroup = container.querySelector('[data-gantt-bar-group][data-task-id="1"]')
    expect(taskBarGroup).toBeInTheDocument()

    // 逐 fireEvent 派发指针序列拖拽平移（从 100px 向右移到 220px，约顺延 3 天）
    performDragSequence(taskBarGroup!, 100, 220)

    // 拖拽完成自动唤起 What-if 沙盒，顶部浮现 HUD
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-hud]')).toBeInTheDocument()
    })

    // HUD 标注「⚡ What-if 试算中 · 正式数据未变更」与变更命令计数
    expect(screen.getByText(/⚡ What-if 试算中 · 正式数据未变更/)).toBeInTheDocument()
    const countBadge = container.querySelector('[data-what-if-command-count]')
    expect(countBadge).toHaveTextContent('已变更 1 项命令')

    // 恪守 RL-08 红线：拖拽推演过程中零网络写请求
    expect(scheduleSpy).not.toHaveBeenCalled()
  })

  it('展开查验影响摘要抽屉与工期变动呈现', async () => {
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=gantt`)

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={PROJECT_ID} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        container.querySelector('[data-gantt-bar-group][data-task-id="1"]'),
      ).toBeInTheDocument()
    })

    // 拖拽激活沙盒
    const taskBarGroup = container.querySelector('[data-gantt-bar-group][data-task-id="1"]')!
    performDragSequence(taskBarGroup, 100, 220)

    await waitFor(() => {
      expect(container.querySelector('[data-what-if-hud]')).toBeInTheDocument()
    })

    // 点击 HUD 的「查看影响详情」按钮
    const openDrawerBtn = container.querySelector('[data-what-if-open-impact]') as HTMLElement
    expect(openDrawerBtn).toBeInTheDocument()
    fireEvent.click(openDrawerBtn)

    // 影响摘要抽屉展开
    await waitFor(() => {
      expect(document.querySelector('[data-what-if-impact-drawer]')).toBeInTheDocument()
    })

    // 抽屉内包含试算影响摘要标题与直接修改明细
    expect(screen.getByText('试算影响摘要')).toBeInTheDocument()

    // 关闭抽屉
    const closeBtn = screen.getByRole('button', { name: '关闭影响摘要' })
    fireEvent.click(closeBtn)
    await waitFor(() => {
      expect(document.querySelector('[data-what-if-impact-drawer]')).not.toBeInTheDocument()
    })
  })

  it('多步编辑之撤销（Undo）与重做（Redo）', async () => {
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=gantt`)

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={PROJECT_ID} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        container.querySelector('[data-gantt-bar-group][data-task-id="1"]'),
      ).toBeInTheDocument()
    })

    // 拖拽产生第 1 条命令
    performDragSequence(
      container.querySelector('[data-gantt-bar-group][data-task-id="1"]')!,
      100,
      220,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-what-if-command-count]')).toHaveTextContent(
        '已变更 1 项命令',
      )
    })

    // 触发 Undo 按钮
    const undoBtn = container.querySelector('[data-what-if-undo]') as HTMLElement
    expect(undoBtn).toBeInTheDocument()
    fireEvent.click(undoBtn)

    // 命令计数回到 0
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-command-count]')).toHaveTextContent(
        '已变更 0 项命令',
      )
    })

    // 触发 Redo 按钮
    const redoBtn = container.querySelector('[data-what-if-redo]') as HTMLElement
    expect(redoBtn).toBeInTheDocument()
    fireEvent.click(redoBtn)

    // 命令计数恢复为 1
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-command-count]')).toHaveTextContent(
        '已变更 1 项命令',
      )
    })
  })

  it('显式应用方案顺利通过 preview → commit 两阶段提交全链路', async () => {
    const executeSpy = vi.spyOn(ganttSchedulingApi, 'execute')
    // 阶段 1：preview 返回 previewToken
    executeSpy.mockResolvedValueOnce({
      changes: [
        {
          taskId: 1,
          taskName: '动力系统自检',
          before: { startDate: '2026-09-01', endDate: '2026-09-05', durationDays: 5 },
          after: { startDate: '2026-09-04', endDate: '2026-09-08', durationDays: 5 },
          reason: 'direct_move',
          dependencyIds: [],
        },
      ],
      conflicts: [],
      warnings: [],
      affectedTaskIds: [1],
      previewToken: 'tok_star_42',
      committed: false,
      calendar: { version: 1, workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
    })
    // 阶段 2：commit 落库成功
    executeSpy.mockResolvedValueOnce({
      changes: [],
      conflicts: [],
      warnings: [],
      affectedTaskIds: [1],
      previewToken: 'tok_star_42',
      committed: true,
      calendar: { version: 1, workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
    })

    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=gantt`)

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={PROJECT_ID} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        container.querySelector('[data-gantt-bar-group][data-task-id="1"]'),
      ).toBeInTheDocument()
    })

    // 拖拽触发命令
    performDragSequence(
      container.querySelector('[data-gantt-bar-group][data-task-id="1"]')!,
      100,
      220,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-what-if-hud]')).toBeInTheDocument()
    })

    // 设置后端已生成的有效 preview 供 HUD 解锁提交
    useWhatIfSessionStore.getState().setBackendPreview({
      previewToken: 'tok_star_42',
      changes: [],
      warnings: [],
      conflicts: [],
      calendar: { version: 1, workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
    })

    // 若试算产生告警，确认知晓告警以满足门禁（backendPreview + 无 blocker + 告警已确认 + 非 stale）
    useWhatIfSessionStore.getState().confirmWarnings()

    // 点击「应用方案」主按钮
    const applyBtn = container.querySelector('[data-what-if-apply]') as HTMLButtonElement
    await waitFor(() => {
      expect(applyBtn).not.toBeDisabled()
    })
    fireEvent.click(applyBtn)

    // 顺序执行 preview 与 commit
    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledTimes(2)
    })
    expect(executeSpy).toHaveBeenNthCalledWith(
      1,
      PROJECT_ID,
      expect.objectContaining({ mode: 'preview' }),
    )
    expect(executeSpy).toHaveBeenNthCalledWith(
      2,
      PROJECT_ID,
      expect.objectContaining({ mode: 'commit', previewToken: 'tok_star_42' }),
    )

    // 提交成功后销毁 session，HUD 卸载
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-hud]')).not.toBeInTheDocument()
    })
  })

  it('409 Stale 并发冲突与「放弃试算」安全回滚', async () => {
    const staleError = new Error('SCHEDULE_STALE')
    ;(staleError as unknown as { status: number; code: string }).status = 409
    ;(staleError as unknown as { code: string }).code = 'SCHEDULE_STALE'

    vi.spyOn(ganttSchedulingApi, 'execute').mockRejectedValue(staleError)

    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=gantt`)

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={PROJECT_ID} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        container.querySelector('[data-gantt-bar-group][data-task-id="1"]'),
      ).toBeInTheDocument()
    })

    // 拖拽进入沙盒
    performDragSequence(
      container.querySelector('[data-gantt-bar-group][data-task-id="1"]')!,
      100,
      220,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-what-if-hud]')).toBeInTheDocument()
    })

    // 触发 409 Stale
    useWhatIfSessionStore.getState().markStale()

    // HUD 显示冷橙色过期警示态
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-stale="true"]')).toBeInTheDocument()
      expect(screen.getByText(/该项目排程已被其他协作者修改/)).toBeInTheDocument()
    })

    // 点击「放弃试算」
    const discardBtn = container.querySelector('[data-what-if-discard]') as HTMLElement
    expect(discardBtn).toBeInTheDocument()
    fireEvent.click(discardBtn)

    // 弹出确认小窗，点击「确认放弃」
    const confirmDiscardBtn = container.querySelector(
      '[data-what-if-discard-confirm]',
    ) as HTMLElement
    expect(confirmDiscardBtn).toBeInTheDocument()
    fireEvent.click(confirmDiscardBtn)

    // session 销毁，HUD 卸载
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-hud]')).not.toBeInTheDocument()
    })
  })

  it('未保存离开守卫拦截：切镜头被阻断弹出模态框，留在当前 vs 放弃并离开', async () => {
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=gantt`)

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={PROJECT_ID} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        container.querySelector('[data-gantt-bar-group][data-task-id="1"]'),
      ).toBeInTheDocument()
    })

    // 拖拽激活沙盒并产生未保存变更
    performDragSequence(
      container.querySelector('[data-gantt-bar-group][data-task-id="1"]')!,
      100,
      220,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-what-if-hud]')).toBeInTheDocument()
    })

    // 点击 LensSwitcher 中的「看板」尝试离开甘特图
    const kanbanBtn = screen.getByRole('button', { name: '看板' })
    fireEvent.click(kanbanBtn)

    // 切换被守卫拦截，未直接切看板，弹出离开确认模态框
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-leave-dialog]')).toBeInTheDocument()
    })
    expect(screen.getByText('离开前请确认')).toBeInTheDocument()
    expect(screen.getByText(/若此时离开，所有试算内容将被丢弃/)).toBeInTheDocument()

    // 动作 1：点击「留在当前页面」
    const stayBtn = container.querySelector('[data-leave-dialog-stay]') as HTMLElement
    fireEvent.click(stayBtn)

    // 模态框关闭，仍停留在甘特图，HUD 和未保存变更完好保留
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-leave-dialog]')).not.toBeInTheDocument()
    })
    expect(container.querySelector('[data-gantt-chart]')).toBeInTheDocument()
    expect(container.querySelector('[data-what-if-hud]')).toBeInTheDocument()

    // 动作 2：再次点击「看板」，弹出模态框
    fireEvent.click(kanbanBtn)
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-leave-dialog]')).toBeInTheDocument()
    })

    // 点击「放弃并离开」
    const discardAndLeaveBtn = container.querySelector('[data-leave-dialog-discard]') as HTMLElement
    fireEvent.click(discardAndLeaveBtn)

    // 放行导航：session 销毁，工作面平滑切换回看板
    await waitFor(() => {
      expect(container.querySelector('[data-project-space-board-slot]')).toBeInTheDocument()
      expect(container.querySelector('[data-project-space-gantt-slot]')).not.toBeInTheDocument()
    })
  })
})
