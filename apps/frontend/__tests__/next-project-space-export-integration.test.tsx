/**
 * v3-ui-next-chart-export W2（tasks 2.4）—— 项目空间看板汇出接入点一集成测试。
 *
 * 装配目标：ProjectSpaceContainer 顶栏 data-project-space-toolbar-slot 内挂载
 * ProjectExportMenu（ManualTaskCreateDrawer 旁），捕获目标 [data-project-space-board-slot]。
 *
 * 验证（spec「项目空间工作面看板『汇出』接入点」+「权限继承与只读对齐」）：
 * - 项目观察员（仅 project:view / task:view）可正常导出 PNG / JPG，捕获的 DOM 目标
 *   精确为 [data-project-space-board-slot]；
 * - 工具栏呼出 1200×630 看板分享卡：W1 真实弹窗装配 KanbanShareCardTemplate，
 *   携带当前看板四列权威任务数据与 HUD 度量（RL-04）；
 * - 中性 404（接口 404 与跨组织隔离）下汇出菜单物理不渲染不可达（RL-05）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { ProjectSpaceContainer } from '@/components/next/project-space/ProjectSpaceContainer'
import { kanbanApi, type KanbanColumn, type KanbanFilters } from '@/lib/api/kanban'
import { projectsApi, type Project } from '@/lib/api/projects'
import type { Task } from '@/lib/api/tasks'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'

// ---------------------------------------------------------------------------
// 引擎部分 mock（保留 W1 真实语义，仅替换 3 个导出出口）
// ---------------------------------------------------------------------------

const engineMock = vi.hoisted(() => ({
  exportNodeToPng: vi.fn(async () => 'png-data-url'),
  exportNodeToSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  exportNodeToJpeg: vi.fn(async () => 'jpeg-data-url'),
}))

vi.mock('@/lib/next/chart-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/next/chart-export')>()
  return { ...actual, ...engineMock }
})

const toastMock = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@/components/ui/Toast', () => ({ toast: toastMock.toast }))

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function taskOf(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: PROJECT_ID,
    name: `任务 ${id}`,
    description: null,
    status: 'not_started',
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
    ...overrides,
  }
}

const boardState: Record<KanbanColumn, Task[]> = {
  pending: [taskOf(1, { name: '数据库索引优化', status: 'not_started' })],
  in_progress: [taskOf(2, { name: '接口对接', status: 'in_progress' })],
  completed: [taskOf(3, { name: '原型评审', status: 'completed' })],
  other: [taskOf(4, { name: '需求挂起', status: 'on_hold' })],
}

let projectGetSpy: MockInstance<typeof projectsApi.get>
let kanbanListSpy: MockInstance<typeof kanbanApi.listColumn>

function renderContainer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProjectSpaceContainer projectId={PROJECT_ID} />
    </QueryClientProvider>,
  )
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'observer@example.com',
      fullName: '周观澜',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'observer' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

beforeEach(() => {
  projectGetSpy?.mockRestore()
  kanbanListSpy?.mockRestore()
  navMock.push.mockReset()
  engineMock.exportNodeToPng.mockReset()
  engineMock.exportNodeToSvg.mockReset()
  engineMock.exportNodeToJpeg.mockReset()
  engineMock.exportNodeToPng.mockResolvedValue('png-data-url')
  engineMock.exportNodeToSvg.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  engineMock.exportNodeToJpeg.mockResolvedValue('jpeg-data-url')
  toastMock.toast.mockReset()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
  setAuth(['project:view', 'task:view', 'task:create', 'task:update'])
  projectGetSpy = vi.spyOn(projectsApi, 'get').mockResolvedValue(makeProject())
  kanbanListSpy = vi
    .spyOn(kanbanApi, 'listColumn')
    .mockImplementation(
      async (_projectId: number, column: KanbanColumn, _filters?: KanbanFilters) => ({
        data: boardState[column],
        meta: { total: boardState[column].length, page: 1, perPage: 25, totalPages: 1 },
      }),
    )
})

const PNG_ITEM = '导出看板快照 (PNG - 2x超清)'
const JPG_ITEM = '导出兼容图 (JPG - 白底)'
const SHARE_ITEM = '生成 1200×630 看板分享卡'

describe('项目空间看板汇出接入点（tasks 2.4）', () => {
  test('项目观察员（只读权限）在工具栏汇出 PNG：捕获目标为 [data-project-space-board-slot]', async () => {
    setAuth(['project:view', 'task:view'])
    renderContainer()
    await screen.findByText('开项核心引擎')

    const trigger = screen.getByRole('button', { name: '汇出看板' })
    expect(trigger).toBeEnabled()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: PNG_ITEM }))

    await waitFor(() => expect(engineMock.exportNodeToPng).toHaveBeenCalledTimes(1))
    const [target, options] = engineMock.exportNodeToPng.mock.calls[0] as unknown as [
      HTMLElement,
      { entityName: string; viewType: string },
    ]
    expect(target).toBe(document.querySelector('[data-project-space-board-slot]'))
    expect(target.hasAttribute('data-project-space-board-slot')).toBe(true)
    expect(options).toEqual({ entityName: '开项核心引擎', viewType: '看板工作面' })
  })

  test('观察员导出 JPG 白底兼容图同样可用', async () => {
    setAuth(['project:view', 'task:view'])
    renderContainer()
    await screen.findByText('开项核心引擎')

    fireEvent.click(screen.getByRole('button', { name: '汇出看板' }))
    fireEvent.click(screen.getByRole('menuitem', { name: JPG_ITEM }))

    await waitFor(() => expect(engineMock.exportNodeToJpeg).toHaveBeenCalledTimes(1))
    const [target] = engineMock.exportNodeToJpeg.mock.calls[0] as unknown as [HTMLElement]
    expect(target).toBe(document.querySelector('[data-project-space-board-slot]'))
  })

  test('「生成 1200×630 看板分享卡」呼出真实分享卡：四列权威数据与 HUD 度量（RL-04）', async () => {
    renderContainer()
    await screen.findByText('开项核心引擎')

    fireEvent.click(screen.getByRole('button', { name: '汇出看板' }))
    fireEvent.click(screen.getByRole('menuitem', { name: SHARE_ITEM }))

    const dialog = await screen.findByRole('dialog', { name: '看板分享卡' })
    expect(dialog).toBeInTheDocument()

    const card = dialog.querySelector('[data-share-card]') as HTMLElement | null
    expect(card?.getAttribute('aria-label')).toBe('开项核心引擎 看板工作面分享卡')

    // 四列计数：待处理 1 / 进行中 1 / 已完成 1 / 其他 1
    await waitFor(() => {
      const countCells = Array.from(dialog.querySelectorAll('[data-kanban-column-count]')).map(
        (node) => node.textContent,
      )
      expect(countCells).toEqual(['1', '1', '1', '1'])
    })

    // HUD：任务总数 4 / 进行中 1 / 已完成 1 / 逾期预警 0 / 完成率 25%
    const values = Array.from(dialog.querySelectorAll('[data-kanban-metric-value]')).map(
      (node) => node.textContent,
    )
    expect(values).toEqual(['4', '1', '1', '0', '25%'])
    expect(dialog.querySelector('[data-share-card-watermark]')?.textContent).toContain(
      'Evidence Console',
    )
  })

  test('接口 404：中性 404 空态下汇出菜单物理不渲染不可达（RL-05）', async () => {
    projectGetSpy.mockRejectedValue({ status: 404 })
    renderContainer()

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(
      document
        .querySelector('[data-project-space-empty]')
        ?.getAttribute('data-project-space-empty'),
    ).toBe('not_found')
    expect(document.querySelector('[data-project-export-menu]')).toBeNull()
    expect(document.querySelector('[data-project-space-board-slot]')).toBeNull()
    expect(screen.queryByRole('button', { name: '汇出看板' })).not.toBeInTheDocument()
  })

  test('跨组织项目（org 不匹配）同样渲染中性 404，汇出入口不可达', async () => {
    projectGetSpy.mockResolvedValue(makeProject({ organizationId: 2 }))
    renderContainer()

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(document.querySelector('[data-project-export-menu]')).toBeNull()
    expect(screen.queryByRole('button', { name: '汇出看板' })).not.toBeInTheDocument()
  })
})
