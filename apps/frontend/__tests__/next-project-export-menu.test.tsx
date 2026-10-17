/**
 * v3-ui-next-chart-export W2（tasks 2.2）—— 项目空间汇出下拉菜单单元测试。
 *
 * 引擎（lib/next/chart-export）以部分 mock 消费 design.md §1 API 契约
 * （保留字体栈/文件名等真实语义，仅 spy 三个导出出口）；分享卡弹窗与模板
 * 使用 W1 真实组件，验证装配链路：
 * - 下拉展开/收起（触发钮切换、Escape、点击外部关闭）与 4 项指令文案；
 * - 每项指令点击 → 正确引擎出口 + 捕获目标为 [data-project-space-board-slot]；
 * - 导出执行中加载微动效与禁用态（aria-busy="true" / disabled）与完成复位；
 * - 异常时 Toast「图表汇出失败，请稍后重试」且触发器复位（spec 运行环境降级）；
 * - 看板分享卡呼出真实 ChartShareCardModal：1200×630 画布、四列微缩结构与
 *   HUD 度量（任务总数/进行中/已完成/逾期预警/完成率，RL-04 读 TanStack 缓存）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { ProjectExportMenu } from '@/components/next/export/ProjectExportMenu'
import { kanbanApi, type KanbanColumn, type KanbanFilters } from '@/lib/api/kanban'
import type { Task } from '@/lib/api/tasks'
import { useAuthStore } from '@/stores/auth-store'

// ---------------------------------------------------------------------------
// 引擎部分 mock：保留 W1 真实导出（字体栈 / 文件名 / Blob 语义），仅替换 3 个出口
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 101

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
  other: [],
}

let kanbanListSpy: MockInstance<typeof kanbanApi.listColumn>

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <div data-project-space-board-slot aria-label="工作面看板区域" />
      <ProjectExportMenu projectId={PROJECT_ID} entityName="开项核心引擎" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  kanbanListSpy?.mockRestore()
  engineMock.exportNodeToPng.mockReset()
  engineMock.exportNodeToSvg.mockReset()
  engineMock.exportNodeToJpeg.mockReset()
  engineMock.exportNodeToPng.mockResolvedValue('png-data-url')
  engineMock.exportNodeToSvg.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  engineMock.exportNodeToJpeg.mockResolvedValue('jpeg-data-url')
  toastMock.toast.mockReset()
  useAuthStore.setState({
    user: { id: 1, email: 'observer@example.com', fullName: '观察员', organizations: [] },
    accessToken: null,
    refreshToken: null,
    permissions: ['project:view', 'task:view'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
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
const SVG_ITEM = '导出看板矢量图 (SVG)'
const JPG_ITEM = '导出兼容图 (JPG - 白底)'
const SHARE_ITEM = '生成 1200×630 看板分享卡'

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: '汇出看板' }))
}

describe('ProjectExportMenu 下拉菜单（tasks 2.2）', () => {
  test('触发钮展开菜单：4 项指令文案齐全；再次点击收起', () => {
    renderMenu()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    openMenu()
    expect(screen.getByRole('menu', { name: '汇出看板选项' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: PNG_ITEM })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: SVG_ITEM })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: JPG_ITEM })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: SHARE_ITEM })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '汇出看板' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('Escape 与点击菜单外部均收起下拉', () => {
    renderMenu()
    openMenu()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    openMenu()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('点击「PNG - 2x超清」以 2x 引擎导出并捕获 [data-project-space-board-slot]', async () => {
    renderMenu()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: PNG_ITEM }))

    await waitFor(() => {
      expect(engineMock.exportNodeToPng).toHaveBeenCalledTimes(1)
    })
    const [target, options] = engineMock.exportNodeToPng.mock.calls[0] as unknown as [
      HTMLElement,
      { entityName: string; viewType: string },
    ]
    expect(target).toBe(document.querySelector('[data-project-space-board-slot]'))
    expect(target.hasAttribute('data-project-space-board-slot')).toBe(true)
    expect(options).toEqual({ entityName: '开项核心引擎', viewType: '看板工作面' })
    // 指令执行后菜单收起
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(engineMock.exportNodeToSvg).not.toHaveBeenCalled()
    expect(engineMock.exportNodeToJpeg).not.toHaveBeenCalled()
  })

  test('点击「SVG」与「JPG - 白底」分别调用 toSvg / toJpeg 引擎出口', async () => {
    renderMenu()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: SVG_ITEM }))
    await waitFor(() => expect(engineMock.exportNodeToSvg).toHaveBeenCalledTimes(1))
    expect(engineMock.exportNodeToPng).not.toHaveBeenCalled()

    // 复用同一组件前必须等防抖复位：导出期间触发器为禁用态（见「导出执行中触发器…」用例），
    // 此时点击会被浏览器丢弃、菜单展不开。
    await waitFor(() => expect(screen.getByRole('button', { name: '汇出看板' })).toBeEnabled())

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: JPG_ITEM }))
    await waitFor(() => expect(engineMock.exportNodeToJpeg).toHaveBeenCalledTimes(1))
    expect(engineMock.exportNodeToPng).not.toHaveBeenCalled()
  })

  test('导出执行中触发器 aria-busy 旋转禁用态，完成后复位（防抖）', async () => {
    renderMenu()
    let releaseExport!: (value: string) => void
    engineMock.exportNodeToPng.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseExport = resolve
        }),
    )

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: PNG_ITEM }))

    const trigger = screen.getByRole('button', { name: '汇出看板' })
    await waitFor(() => expect(trigger).toHaveAttribute('aria-busy', 'true'))
    expect(trigger).toBeDisabled()

    await act(async () => {
      releaseExport('png-data-url')
    })
    await waitFor(() => expect(trigger).not.toHaveAttribute('aria-busy', 'true'))
    expect(trigger).toBeEnabled()
  })

  test('引擎异常：Toast 提示「图表汇出失败，请稍后重试」，触发器复位且不崩溃', async () => {
    renderMenu()
    engineMock.exportNodeToPng.mockRejectedValueOnce(new Error('canvas 显存不足'))

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: PNG_ITEM }))

    await waitFor(() => {
      expect(toastMock.toast).toHaveBeenCalledWith({
        variant: 'error',
        title: '图表汇出失败，请稍后重试',
      })
    })
    const trigger = screen.getByRole('button', { name: '汇出看板' })
    expect(trigger).toHaveAttribute('aria-busy', 'false')
    expect(trigger).toBeEnabled()
  })

  test('捕获目标缺失：不调用引擎并 Toast 错误（图表汇出失败，请稍后重试）', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ProjectExportMenu projectId={PROJECT_ID} entityName="开项核心引擎" />
      </QueryClientProvider>,
    )
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: PNG_ITEM }))

    await waitFor(() => {
      expect(toastMock.toast).toHaveBeenCalledWith({
        variant: 'error',
        title: '图表汇出失败，请稍后重试',
      })
    })
    expect(engineMock.exportNodeToPng).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '汇出看板' })).toBeEnabled()
  })

  test('「生成 1200×630 看板分享卡」呼出真实分享卡：四列微缩结构与 HUD 度量', async () => {
    const { container } = renderMenu()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: SHARE_ITEM }))

    // W1 ChartShareCardModal 真实渲染：居中预览 1200×630 卡片
    const dialog = await screen.findByRole('dialog', { name: '看板分享卡' })
    expect(dialog).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    // ShareCardCanvas：实体名 / 视图徽章 / Evidence Console 水印
    const entity = container.querySelector('[data-share-card-entity]')
    expect(entity?.textContent).toBe('开项核心引擎')
    expect(container.querySelector('[data-share-card-view-badge]')?.textContent).toBe('看板工作面')
    expect(container.querySelector('[data-share-card-watermark]')?.textContent).toContain(
      'Evidence Console',
    )

    // 四列微缩结构（RL-04：等待 TanStack Query 缓存数据到达）
    await waitFor(() => {
      expect(
        container.querySelector('[data-kanban-column-key="pending"] [data-kanban-column-count]')
          ?.textContent,
      ).toBe('1')
    })
    expect(
      container.querySelector('[data-kanban-column-key="inProgress"] [data-kanban-column-count]')
        ?.textContent,
    ).toBe('1')
    expect(
      container.querySelector('[data-kanban-column-key="completed"] [data-kanban-column-count]')
        ?.textContent,
    ).toBe('1')
    expect(
      container.querySelector('[data-kanban-column-key="other"] [data-kanban-column-count]')
        ?.textContent,
    ).toBe('0')
    expect(container.querySelector('[data-kanban-task]')?.textContent).toBe('数据库索引优化')

    // HUD 度量带：任务总数 3 / 进行中 1 / 已完成 1 / 逾期预警 0 / 完成率 33%
    await waitFor(() => {
      const values = Array.from(container.querySelectorAll('[data-kanban-metric-value]')).map(
        (node) => node.textContent,
      )
      expect(values).toEqual(['3', '1', '1', '0', '33%'])
    })
  })
})
