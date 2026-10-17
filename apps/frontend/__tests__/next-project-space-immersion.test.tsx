/**
 * v3-ui-next-project-space tasks 4.3 —— 沉浸三档降级与精确档平整化测试。
 *
 * 覆盖（spec「沉浸阶梯与精确档降级」）：
 * - immersive 档：项目空间根节点消费 `.nx-space-atmosphere` 深空氛围光晕，
 *   时间主轴今天锚点保留电光天青色微光；
 * - light 档：保留静态氛围与基本微光（呼吸动效由 CSS 媒体查询统一关闭）；
 * - precise 档（手动）：氛围类让位纯色暗黑仪器面板、主轴微光归零、
 *   刻度文字高对比度，业务数据与交互 100% 等价（看板任务照常渲染）；
 * - 系统 `prefers-reduced-motion: reduce`（未手动覆盖）：hook 合成降级为
 *   precise 等价表现（纯 CSS 规则 + 组件类同步双保险）；
 * - 数据等价：三档切换不改看板列数据投影（同源查询、零额外请求）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { ProjectSpaceContainer } from '@/components/next/project-space/ProjectSpaceContainer'
import { kanbanApi } from '@/lib/api/kanban'
import type { Project } from '@/lib/api/projects'
import type { Task } from '@/lib/api/tasks'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'

const apiMock = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/lib/api/projects', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/projects')>()
  return { ...original, projectsApi: { ...original.projectsApi, get: apiMock.get } }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/projects/101',
  useParams: () => ({ id: '101' }),
  useSearchParams: () => new URLSearchParams(),
}))

const PROJECT_ID = 101

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-101',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    budgetCents: null,
    currency: null,
    progressPercent: 35,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
}

function taskOf(id: number, status: Task['status']): Task {
  return {
    id,
    projectId: PROJECT_ID,
    name: `任务 ${id}`,
    description: null,
    status,
    priority: 'medium',
    taskType: 'task',
    startDate: null,
    endDate: null,
    actualStartDate: null,
    actualEndDate: null,
    durationDays: null,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 0,
    kanbanRank: 1024,
    assigneeId: null,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
  }
}

const COLUMN_TASKS: Record<string, Task[]> = {
  pending: [taskOf(1, 'not_started')],
  in_progress: [taskOf(2, 'in_progress')],
  completed: [],
  other: [],
}

function setAuth() {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: ['project:view', 'task:view', 'task:update', 'task:create'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function renderContainer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProjectSpaceContainer projectId={PROJECT_ID} />
    </QueryClientProvider>,
  )
}

/** 系统减弱动画偏好桩（jsdom 无 matchMedia，useImmersionTier 的事件订阅需最小实现）。 */
function stubReducedMotion(reduce: boolean) {
  // 只回答 reduced-motion 查询；其他媒体查询（如手机断点）一律不命中，避免被当成手机布局
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

beforeEach(() => {
  // 定向恢复（vi.restoreAllMocks 会清空 setup.ts 注入的 window.matchMedia vi.fn
  // 实现，使 useImmersionTier 在 jsdom 下崩溃，故逐 spy mockRestore）。
  kanbanListSpy?.mockRestore()
  apiMock.get.mockReset()
  apiMock.get.mockResolvedValue(makeProject())
  kanbanListSpy = vi
    .spyOn(kanbanApi, 'listColumn')
    .mockImplementation(async (_projectId: number, column: string) => ({
      data: COLUMN_TASKS[column] ?? [],
      meta: { total: (COLUMN_TASKS[column] ?? []).length, page: 1, perPage: 25, totalPages: 1 },
    }))
  setAuth()
  useNextTrackStore.setState({ immersionTier: null })
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  document.documentElement.removeAttribute('data-immersion')
})

let kanbanListSpy: MockInstance<typeof kanbanApi.listColumn>

afterEach(() => {
  vi.unstubAllGlobals()
  // act 包裹：afterEach 先于 RTL cleanup 执行，组件仍挂载时重置 store 会触发订阅
  // 重渲染，需在 act 内冲刷（与 next-project-timeline-bar.test.tsx 同口径）。
  act(() => useNextTrackStore.setState({ immersionTier: null }))
  document.documentElement.removeAttribute('data-immersion')
})

describe('沉浸三档（spec「沉浸阶梯与精确档降级」）', () => {
  test('immersive 档：深空氛围光晕 + 时间主轴电光微光，看板任务照常投影', async () => {
    renderContainer()
    await screen.findByText('开项核心引擎')
    await screen.findByText('任务 1')

    const root = document.querySelector('[data-project-space]') as HTMLElement
    expect(root.className).toContain('nx-space-atmosphere')

    const bar = document.querySelector('[data-timeline-bar]') as HTMLElement
    expect(bar.getAttribute('data-immersion')).toBe('immersive')
    const todayLine = document.querySelector('[data-timeline-today-line]') as HTMLElement
    expect(todayLine.className).toContain('shadow-[0_0_8px_var(--nx-space-cyan)]')
    // 业务等价基线：看板列与任务渲染
    expect(document.querySelector('[data-workspace-kanban-board]')).not.toBeNull()
    expect(document.querySelector('[data-kanban-column="pending"] [data-task-id]')).not.toBeNull()
  })

  test('light 档：氛围保留，档位同步至组件与 html', async () => {
    useNextTrackStore.setState({ immersionTier: 'light' })
    renderContainer()
    await screen.findByText('开项核心引擎')
    await screen.findByText('任务 1')

    const root = document.querySelector('[data-project-space]') as HTMLElement
    expect(root.className).toContain('nx-space-atmosphere')
    expect(document.querySelector('[data-timeline-bar]')?.getAttribute('data-immersion')).toBe(
      'light',
    )
    expect(document.documentElement.getAttribute('data-immersion')).toBe('light')
    // 基本静态微光保留（呼吸动效由 prefers-reduced-motion CSS 规则统一关闭）
    expect(document.querySelector('[data-timeline-today-line]')?.className).toContain(
      'shadow-[0_0_8px_var(--nx-space-cyan)]',
    )
  })

  test('precise 档（手动）：氛围隐藏、主轴平整化、文字高对比，看板数据等价', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    renderContainer()
    await screen.findByText('开项核心引擎')
    await screen.findByText('任务 2')

    const root = document.querySelector('[data-project-space]') as HTMLElement
    // 精确档：氛围类让位纯色暗黑仪器面板
    expect(root.className).not.toContain('nx-space-atmosphere')
    expect(root.className).toContain('bg-[var(--nx-workspace-bg)]')

    const bar = document.querySelector('[data-timeline-bar]') as HTMLElement
    expect(bar.getAttribute('data-immersion')).toBe('precise')
    const todayLine = document.querySelector('[data-timeline-today-line]') as HTMLElement
    expect(todayLine.className).not.toContain('shadow-[0_0_8px_var(--nx-space-cyan)]')
    const label = document.querySelector('[data-timeline-today-label]') as HTMLElement
    expect(label.className).toContain('text-[var(--nx-text-primary)]')
    const future = document.querySelector('[data-timeline-future]') as HTMLElement
    expect(future.className).not.toContain('border-dashed')

    // 数据与交互 100% 等价：四列与任务照常渲染，零额外请求语义（与 immersive 同源）
    expect(document.querySelector('[data-workspace-kanban-board]')).not.toBeNull()
    expect(
      document.querySelector('[data-kanban-column="in_progress"] [data-task-id]'),
    ).not.toBeNull()
    expect(document.querySelector('[data-timeline-period]')?.textContent).toBe(
      '2026-09-01 ~ 2026-09-30',
    )
  })

  test('系统 prefers-reduced-motion（未手动覆盖）：自动合成精确档等价表现', async () => {
    stubReducedMotion(true)
    renderContainer()
    await screen.findByText('开项核心引擎')

    // hook 合成：reduced-motion → precise（手动档 null）
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
    })
    const root = document.querySelector('[data-project-space]') as HTMLElement
    expect(root.className).not.toContain('nx-space-atmosphere')
    // 时间主轴随任务数据渲染（与其他档位用例一样等数据就绪，不在项目名出现的瞬间就断言）
    const todayLine = await waitFor(() => {
      const line = document.querySelector('[data-timeline-today-line]')
      expect(line).not.toBeNull()
      return line as HTMLElement
    })
    expect(todayLine.className).not.toContain('shadow-[0_0_8px_var(--nx-space-cyan)]')
    // 业务逻辑不受影响：项目名与时间主轴照常
    expect(document.querySelector('[data-timeline-axis]')).not.toBeNull()
  })

  test('三档切换为纯视觉浓度变化：看板数据查询键与请求语义不变', async () => {
    const { unmount } = renderContainer()
    await screen.findByText('开项核心引擎')
    await screen.findByText('任务 1')
    unmount()

    // 切换 precise 后再渲染：请求次数与服务端事实一致（无额外/丢失请求）
    useNextTrackStore.setState({ immersionTier: 'precise' })
    apiMock.get.mockClear()
    vi.mocked(kanbanApi.listColumn).mockClear()
    renderContainer()
    await screen.findByText('开项核心引擎')
    await screen.findByText('任务 1')
    expect(apiMock.get).toHaveBeenCalledTimes(1)
    expect(kanbanApi.listColumn).toHaveBeenCalledTimes(4)
  })
})
