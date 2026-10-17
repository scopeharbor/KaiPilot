/**
 * v3-ui-next-remaining-lenses tasks 5.5 —— 图表汇出菜单全镜头接入与文件名清洗测试
 * （spec「图表汇出菜单全镜头接入与规范命名」Requirement 1~4 场景）。
 *
 * 覆盖：
 * - 各镜头下 resolveTarget 正确解析到对应工作面容器（统一 [data-project-space-lens-slot]，
 *   及无显式 activeLens 时从 DOM 激活切换器项解析镜头）；
 * - 各镜头下派发导出时引擎收到的 viewType 映射为对应规范中文镜头名
 *   （wbs→WBS结构俯瞰 / list→任务列表 / calendar→项目日历 / timeline→时间线流向 /
 *   kanban→看板工作面 / gantt→甘特图时间远眺），规范文件名 `[实体]-[镜头中文名]-[时间戳].[ext]`；
 * - 非法字符清洗（保留中文、数字与下划线）；
 * - 看板镜头独有「看板分享卡」选项；其余镜头仅呈现 PNG/SVG/JPG 三项标准指令；
 * - 导出过程中触发按钮 aria-busy 禁用防抖与异常 Toast 提示。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { ProjectExportMenu, LENS_VIEW_TYPE_MAP } from '@/components/next/export/ProjectExportMenu'
import { LensSwitcher, type ProjectSpaceLensId } from '@/components/next/project-space/LensSwitcher'
import { kanbanApi, type KanbanColumn, type KanbanFilters } from '@/lib/api/kanban'
import { buildExportFilename, sanitizeFilenamePart } from '@/lib/next/chart-export'
import type { Task } from '@/lib/api/tasks'
import { useAuthStore } from '@/stores/auth-store'

// ---------------------------------------------------------------------------
// 引擎部分 mock：保留文件名构造真实语义，仅替换 3 个导出出口
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
// Fixtures & helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = 101

function taskOf(id: number): Task {
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
  }
}

let kanbanListSpy: MockInstance<typeof kanbanApi.listColumn>

/** 渲染菜单 harness：携带统一镜头工作面容器 + 显式 activeLens（模拟容器装配）。 */
function renderMenuFor(activeLens: ProjectSpaceLensId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <div data-project-space-lens-slot aria-label="当前镜头工作面" data-active-lens={activeLens} />
      <ProjectExportMenu projectId={PROJECT_ID} entityName="开项核心引擎" activeLens={activeLens} />
    </QueryClientProvider>,
  )
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: '汇出看板' }))
}

const PNG_ITEM = '导出快照 (PNG - 2x超清)'
const SVG_ITEM = '导出矢量图 (SVG)'
const JPG_ITEM = '导出兼容图 (JPG - 白底)'
const KANBAN_PNG_ITEM = '导出看板快照 (PNG - 2x超清)'
const SHARE_ITEM = '生成 1200×630 看板分享卡'

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
        data: column === 'pending' ? [taskOf(1)] : [],
        meta: { total: column === 'pending' ? 1 : 0, page: 1, perPage: 25, totalPages: 1 },
      }),
    )
})

describe('ProjectExportMenu 全镜头接入（tasks 5.5）', () => {
  test('六镜头 viewType 映射齐备且与 spec 中文名一致', () => {
    expect(LENS_VIEW_TYPE_MAP).toEqual({
      kanban: '看板工作面',
      gantt: '甘特图时间远眺',
      wbs: 'WBS结构俯瞰',
      list: '任务列表',
      calendar: '项目日历',
      timeline: '时间线流向',
    })
  })

  test('各镜头下 resolveTarget 解析到 [data-project-space-lens-slot] 工作面容器', async () => {
    for (const lens of ['wbs', 'list', 'calendar', 'timeline', 'gantt'] as const) {
      const { unmount } = renderMenuFor(lens)
      openMenu()
      fireEvent.click(screen.getByRole('menuitem', { name: PNG_ITEM }))

      await waitFor(() => expect(engineMock.exportNodeToPng).toHaveBeenCalledTimes(1))
      const [target, options] = engineMock.exportNodeToPng.mock.calls.at(-1) as unknown as [
        HTMLElement,
        { entityName: string; viewType: string },
      ]
      expect(target.hasAttribute('data-project-space-lens-slot')).toBe(true)
      expect(target.getAttribute('data-active-lens')).toBe(lens)
      expect(options.viewType).toBe(LENS_VIEW_TYPE_MAP[lens])
      unmount()
      engineMock.exportNodeToPng.mockClear()
    }
  })

  test('无显式 activeLens 时从 DOM 激活切换器项解析镜头（viewType 随激活态联动）', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <div data-project-space-lens-slot aria-label="当前镜头工作面" />
        <LensSwitcher activeLensId="timeline" />
        <ProjectExportMenu projectId={PROJECT_ID} entityName="开项核心引擎" />
      </QueryClientProvider>,
    )
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: PNG_ITEM }))

    await waitFor(() => expect(engineMock.exportNodeToPng).toHaveBeenCalledTimes(1))
    const [, options] = engineMock.exportNodeToPng.mock.calls.at(-1) as unknown as [
      HTMLElement,
      { entityName: string; viewType: string },
    ]
    expect(options.viewType).toBe('时间线流向')
  })

  test('导出文件名：`[项目名]-[镜头中文名]-[YYYYMMDD]_[HHmmss].[ext]` 含对应中文镜头名', () => {
    const fixed = new Date('2026-09-09T16:30:00')
    // WBS：智能车载系统研发-WBS结构俯瞰-20260909_163000.png
    expect(buildExportFilename('智能车载系统研发', LENS_VIEW_TYPE_MAP.wbs, 'png', fixed)).toBe(
      '智能车载系统研发-WBS结构俯瞰-20260909_163000.png',
    )
    for (const [lens, extension] of [
      ['list', 'svg'],
      ['calendar', 'jpg'],
      ['timeline', 'png'],
      ['kanban', 'png'],
      ['gantt', 'svg'],
    ] as const) {
      const filename = buildExportFilename(
        '智能车载系统研发',
        LENS_VIEW_TYPE_MAP[lens],
        extension,
        fixed,
      )
      expect(filename).toContain(LENS_VIEW_TYPE_MAP[lens])
      expect(filename).toContain('20260909_163000')
      expect(filename.endsWith(`.${extension}`)).toBe(true)
    }
  })

  test('非法字符清洗：保留中文、数字与下划线，剥离 OS 保留字符', () => {
    expect(sanitizeFilenamePart('开项/A_2 引擎*核心?')).toBe('开项A_2 引擎核心')
    expect(sanitizeFilenamePart('项目:机密|版_1<2>')).toBe('项目机密版_12')
    // 清洗后的实体 + 镜头中文名仍可组成合法文件名
    const filename = buildExportFilename(
      '项目:A*|方案/B_1',
      LENS_VIEW_TYPE_MAP.timeline,
      'png',
      new Date('2026-09-09T16:30:00'),
    )
    expect(filename).toBe('项目A方案B_1-时间线流向-20260909_163000.png')
  })

  test('看板镜头独享分享卡选项；其余镜头仅呈现 PNG/SVG/JPG 三项标准指令', () => {
    renderMenuFor('kanban')
    openMenu()
    // 看板沿用历史文案（导出看板快照 / 导出看板矢量图）
    expect(screen.getByRole('menuitem', { name: KANBAN_PNG_ITEM })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '导出看板矢量图 (SVG)' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: JPG_ITEM })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: SHARE_ITEM })).toBeInTheDocument()
  })

  test('四新镜头菜单呈现标准 PNG/SVG/JPG 指令且不含看板分享卡（spec 隔离）', () => {
    for (const lens of ['wbs', 'list', 'calendar', 'timeline', 'gantt'] as const) {
      const { unmount } = renderMenuFor(lens)
      openMenu()
      expect(screen.getByRole('menuitem', { name: PNG_ITEM })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: SVG_ITEM })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: JPG_ITEM })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: SHARE_ITEM })).not.toBeInTheDocument()
      unmount()
    }
  })

  test('导出执行中触发器 aria-busy 禁用防抖，完成后复位', async () => {
    renderMenuFor('wbs')
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

  test('引擎异常：Toast「图表汇出失败，请稍后重试」，触发器复位且不崩溃', async () => {
    renderMenuFor('timeline')
    engineMock.exportNodeToJpeg.mockRejectedValueOnce(new Error('canvas 显存不足'))

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: JPG_ITEM }))

    await waitFor(() => {
      expect(toastMock.toast).toHaveBeenCalledWith({
        variant: 'error',
        title: '图表汇出失败，请稍后重试',
      })
    })
    expect(engineMock.exportNodeToJpeg).toHaveBeenCalledTimes(1)
    const [, options] = engineMock.exportNodeToJpeg.mock.calls.at(-1) as unknown as [
      HTMLElement,
      { entityName: string; viewType: string },
    ]
    expect(options.viewType).toBe('时间线流向')
    expect(screen.getByRole('button', { name: '汇出看板' })).toBeEnabled()
  })
})
