/**
 * v3-classic-ui-openproject-views —— 旧版项目视图与页面 OpenProject 式。
 *
 * 覆盖：概览页内容与路由、面包屑「概览」、侧栏概览高亮、任务表格（ID 列 / 状态标示 / 列模板）、
 * 甘特左表（WBS 列、不显示全局 #id）、页面标题字阶令牌、列表视图工具列。
 * 项目头精简与软跳转入口见 projects-pages.test；看板列头与卡片见 kanban-view.test。
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { projectKeys } from '@/lib/api/projects'
import type { Task } from '@/lib/api/tasks'
import type { GanttRenderTask } from '@/lib/gantt/types'
import { useAuthStore } from '@/stores/auth-store'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { TaskStatusPill } from '@/components/views/tasks/TaskStatusPill'
import { TaskListTable } from '@/components/views/list/TaskListTable'
import { GanttLeftColumn } from '@/components/views/gantt/core/GanttLeftColumn'
import { accessTokenWith } from './_jwt-helper'

let mockPathname = '/projects/7/overview'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: '7' }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }),
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: ['project:view'],
    canAny: () => true,
    can: () => true,
    hasPermission: () => true,
    canAll: () => true,
  }),
}))

function login() {
  act(() => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '项目经理',
        organizations: [{ id: 1, name: '组织', slug: 'org', role: 'owner' }],
      },
      accessToken: accessTokenWith(['project:view'], { organizationId: 1, roleVersion: 1 }),
      refreshToken: 'r',
      permissions: ['project:view'],
      currentOrganizationId: 1,
      roleVersion: 1,
      isAuthenticated: true,
      hasHydrated: true,
    })
  })
}

function clientWithProject() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(projectKeys.detail(7), {
    id: 7,
    name: '新园区建设',
    code: 'PARK',
    description: '园区一期土建与机电',
    status: 'active',
    progressPercent: 30,
    healthStatus: 'normal',
    stats: { taskCount: 12, milestoneCount: 2, memberCount: 4 },
  })
  client.setQueryData(projectKeys.dashboard(7), {
    stats: {},
    metrics: [],
    warnings: [],
    recentActivity: [],
    contradictionSummary: undefined,
    trizInnovationWorkbenchSummary: { hasViewPermission: false, summary: null },
  })
  return client
}

function renderWith(ui: React.ReactNode, client = clientWithProject()) {
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  )
}

function makeTask(id: number, patch: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 7,
    name: `任务${id}`,
    description: null,
    status: 'in_progress',
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
    kanbanRank: 0,
    assigneeId: null,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    assignee: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: null,
    ...patch,
  } as Task
}

beforeEach(() => {
  mockPathname = '/projects/7/overview'
  login()
})

describe('项目概览', () => {
  test('概览页显示项目信息、关键指标与最近活动', async () => {
    const { default: OverviewPage } = await import('@/app/(dashboard)/projects/[id]/overview/page')
    renderWith(<OverviewPage />)
    expect(screen.getByRole('heading', { name: '项目信息' })).toBeInTheDocument()
    expect(screen.getByText('园区一期土建与机电')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '项目关键指标' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '最近活动' })).toBeInTheDocument()
    // OpenProject 式两列小部件；无 TRIZ 权限时「创新工具」整块隐藏（has-[nav:empty]:hidden）
    const widgets = document.querySelector('[data-project-overview-widgets]')!
    expect(widgets.className).toContain('xl:grid-cols-2')
    expect(widgets.children).toHaveLength(2)
    const tools = document.querySelector('[data-project-innovation-tools]')!
    expect(tools.className).toContain('has-[nav:empty]:hidden')
  })

  test('侧栏「概览」高亮、面包屑末段为「概览」', async () => {
    const { Sidebar } = await import('@/components/layout/Sidebar')
    const { Breadcrumb } = await import('@/components/layout/Breadcrumb')
    renderWith(
      <>
        <Sidebar forceCollapsed={false} />
        <Breadcrumb />
      </>,
    )
    expect(screen.getByRole('link', { name: '概览' })).toHaveAttribute('aria-current', 'page')
    const crumbs = screen.getByRole('navigation', { name: /面包屑/ })
    expect(within(crumbs).getByText('概览')).toBeInTheDocument()
  })
})

describe('OpenProject 式任务表格', () => {
  test('ID 列按钮打开任务，状态带圆点与文字，任务列自适应剩余宽度', () => {
    const onOpen = vi.fn()
    render(
      <TaskListTable
        rows={[makeTask(2, { status: 'blocked' }), makeTask(5, { status: 'completed' })]}
        sort={['+name']}
        selectedIds={new Set()}
        onSortChange={vi.fn()}
        onToggle={vi.fn()}
        onTogglePage={vi.fn()}
        onOpen={onOpen}
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'ID' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开任务 #5' }))
    expect(onOpen).toHaveBeenCalledWith(5)
    expect(document.querySelector('[data-task-status="blocked"]')?.textContent).toBe('阻塞')
    const headerRow = screen.getAllByRole('row')[0] as HTMLElement
    expect(headerRow.style.gridTemplateColumns).toContain('minmax(240px, 1fr)')
  })

  test('状态标示：六种状态都有文字与圆点', () => {
    const statuses = [
      'not_started',
      'in_progress',
      'completed',
      'blocked',
      'on_hold',
      'cancelled',
    ] as const
    render(
      <>
        {statuses.map((status) => (
          <TaskStatusPill key={status} status={status} />
        ))}
      </>,
    )
    for (const label of ['待处理', '进行中', '已完成', '阻塞', '暂停', '已取消']) {
      const pill = screen.getByText(label)
      expect(pill.querySelector('[aria-hidden]')).toBeTruthy()
    }
  })
})

describe('甘特左表', () => {
  const task = (id: number, wbsCode: string, depth = 0): GanttRenderTask => ({
    id,
    name: `任务${id}`,
    wbsCode,
    depth,
    parentId: null,
    kind: 'task',
    startDay: 0,
    durationDays: 3,
    progress: 0,
    status: 'in_progress',
  })

  test('显示 WBS 编号列，不显示全局 #编号', () => {
    render(
      <GanttLeftColumn
        tasks={[task(41, '1.1'), task(42, '1.2', 1)]}
        visibleRows={[
          { index: 0, start: 0 },
          { index: 1, start: 34 },
        ]}
        rowHeight={34}
        totalHeight={68}
        showWbsCode
        showAssigneeAvatar={false}
        hoveredTaskId={null}
        selectedTaskId={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('1.2')).toBeInTheDocument()
    expect(screen.queryByText('#41')).not.toBeInTheDocument()
  })
})

describe('页面标题字阶与视图工具列', () => {
  test('字阶收敛只在旧版色系生效，默认令牌不变', () => {
    const classic = readFileSync(join(process.cwd(), 'app/classic-theme.css'), 'utf8')
    const globals = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
    const structure = classic.slice(
      classic.indexOf(':root[data-classic-palette] {'),
      classic.indexOf('}', classic.indexOf(':root[data-classic-palette] {')),
    )
    expect(structure).toContain('--fs-2xl: 1.375rem;')
    expect(structure).toContain('--fs-3xl: 1.75rem;')
    expect(globals).toMatch(/--fs-2xl: 1\.75rem;/)
    expect(globals).toMatch(/--fs-3xl: 2\.25rem;/)
  })

  test('列表视图标题区为紧凑工具列', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/views/list/TaskListViewContent.tsx'),
      'utf8',
    )
    expect(source).toContain('data-view-toolbar')
    expect(source).toMatch(/<h2 className="text-lg font-semibold text-gray-800">任务列表<\/h2>/)
  })
})
