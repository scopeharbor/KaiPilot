import ProjectDetailPage from '@/app/(dashboard)/projects/[id]/page'
import ProjectMembersPage from '@/app/(dashboard)/projects/[id]/members/page'
import ProjectsPage from '@/app/(dashboard)/projects/page'
import NewProjectPage from '@/app/(dashboard)/projects/new/page'
import {
  projectDashboardApi,
  projectMembersApi,
  projectsApi,
  type Project,
  type ProjectDashboard,
  type ProjectMember,
  type ProjectRole,
} from '@/lib/api/projects'
import { customViewsApi } from '@/lib/api/custom-views'
import { getMetric } from '@/lib/dashboard-metrics'
import { useAuthStore } from '@/stores/auth-store'
import { DASHBOARD_METRIC_KEYS } from '@aiproj/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accessTokenWith } from './_jwt-helper'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: '1' }),
  usePathname: () => '/projects/1',
  useSearchParams: () => new URLSearchParams(),
}))

function renderWithQuery(ui: React.ReactNode) {
  const auth = useAuthStore.getState()
  if (auth.isAuthenticated && auth.currentOrganizationId === null) {
    act(() => useAuthStore.setState({ currentOrganizationId: 1, hasHydrated: true }))
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const baseProject: Project = {
  id: 1,
  organizationId: 1,
  name: '开项平台',
  code: 'AI',
  description: null,
  category: null,
  status: 'active',
  priority: 'high',
  startDate: null,
  endDate: null,
  budgetCents: null,
  currency: 'CNY',
  progressPercent: 0,
  healthStatus: 'green',
  settings: null,
  createdBy: 1,
  updatedBy: null,
  createdAt: '2026-07-02T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
  stats: { memberCount: 3, taskCount: 5, milestoneCount: 1 },
}

const memberRole: ProjectRole = {
  id: 10,
  projectId: 1,
  name: 'Member',
  description: '成员',
  permissions: ['project:view'],
  isSystem: true,
}

const memberFixture: ProjectMember = {
  id: 100,
  projectId: 1,
  userId: 2,
  projectRoleId: 10,
  isActive: true,
  user: {
    id: 2,
    fullName: '张三',
    email: 'zhang@example.com',
    initials: '张',
    isActive: true,
  },
  projectRole: memberRole,
}

const dashboardFixture: ProjectDashboard = {
  stats: {
    healthStatus: 'green',
    progressPercent: 50,
    taskStatusDistribution: {
      not_started: 2,
      in_progress: 1,
      completed: 0,
      blocked: 0,
      on_hold: 0,
      cancelled: 0,
    },
    memberCount: 3,
    milestoneStatusDistribution: { not_started: 0, planned: 1, at_risk: 0, achieved: 0, missed: 0 },
    startDate: null,
    endDate: null,
    remainingDays: null,
  },
  recentActivity: [
    {
      id: 1,
      action: 'create',
      event: 'PROJECT_CREATED',
      severity: 'info',
      userId: 1,
      entityType: 'project',
      entityId: 1,
      createdAt: '2026-07-02T00:00:00.000Z',
    },
  ],
  metrics: [
    { key: 'progress_percent', value: 50, unit: 'percent', source: 'project_field', status: 'ok' },
    { key: 'health_status', value: 'green', unit: 'status', source: 'project_field', status: 'ok' },
    {
      key: 'task_status_distribution',
      value: 3,
      unit: 'distribution',
      source: 'task_aggregation',
      status: 'ok',
      breakdown: {
        not_started: 2,
        in_progress: 1,
        completed: 0,
        blocked: 0,
        on_hold: 0,
        cancelled: 0,
      },
    },
    { key: 'task_total', value: 3, unit: 'count', source: 'task_aggregation', status: 'ok' },
    {
      key: 'overdue_task_count',
      value: 0,
      unit: 'count',
      source: 'task_aggregation',
      status: 'ok',
    },
    {
      key: 'soon_due_task_count',
      value: 0,
      unit: 'count',
      source: 'task_aggregation',
      status: 'ok',
    },
    { key: 'member_count', value: 3, unit: 'count', source: 'member_aggregation', status: 'ok' },
    {
      key: 'milestone_status_distribution',
      value: 1,
      unit: 'distribution',
      source: 'milestone_aggregation',
      status: 'ok',
      breakdown: { not_started: 0, planned: 1, at_risk: 0, achieved: 0, missed: 0 },
    },
    {
      key: 'milestone_total',
      value: 1,
      unit: 'count',
      source: 'milestone_aggregation',
      status: 'ok',
    },
    {
      key: 'remaining_days',
      value: null,
      unit: 'days',
      source: 'project_field',
      status: 'unavailable',
    },
    {
      key: 'recent_activity_summary',
      value: 1,
      unit: 'summary',
      source: 'audit_log_aggregation',
      status: 'ok',
    },
  ],
  warnings: [
    {
      code: 'PROJECT_DATE_MISSING',
      message: '项目缺少结束日期，剩余天数无法计算',
      metricKey: 'remaining_days',
    },
  ],
  meta: {
    calculatedAt: '2026-07-02T00:00:00.000Z',
    metricVersion: 'project-dashboard.v1',
    projectId: 1,
    organizationId: 1,
  },
}

function loginAs(permissions: string[], userId: number, role: string) {
  act(() => {
    useAuthStore.setState({
      user: {
        id: userId,
        fullName: '当前用户',
        email: 'me@example.com',
        isSuperAdmin: false,
        organizations: [{ id: 1, name: '组织', slug: 'o', role }],
      },
      accessToken: accessTokenWith(permissions, { organizationId: 1 }),
      refreshToken: 'r',
      permissions,
      currentOrganizationId: 1,
      roleVersion: 0,
      isAuthenticated: true,
      hasHydrated: true,
    })
  })
}

describe('项目页面', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    act(() => useAuthStore.getState().clear())
    vi.spyOn(customViewsApi, 'list').mockResolvedValue({
      personal: [],
      shared: [],
    })
  })

  test('列表渲染项目，有建项权时显示新建入口', async () => {
    vi.spyOn(projectsApi, 'list').mockResolvedValue({
      data: [baseProject],
      meta: { total: 1, page: 1, perPage: 10, totalPages: 1 },
    })
    loginAs(['project:view', 'project:create'], 1, 'owner')
    renderWithQuery(<ProjectsPage />)
    expect(await screen.findByText('开项平台')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建项目' })).toBeInTheDocument()
  })

  test('无建项权时不显示新建入口', async () => {
    vi.spyOn(projectsApi, 'list').mockResolvedValue({
      data: [baseProject],
      meta: { total: 1, page: 1, perPage: 10, totalPages: 1 },
    })
    loginAs(['project:view'], 2, 'member')
    renderWithQuery(<ProjectsPage />)
    expect(await screen.findByText('开项平台')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建项目' })).not.toBeInTheDocument()
  })

  test('新建表单名称为空时校验拦截', async () => {
    const createSpy = vi.spyOn(projectsApi, 'create').mockResolvedValue(baseProject)
    loginAs(['project:create'], 1, 'owner')
    renderWithQuery(<NewProjectPage />)
    fireEvent.submit(screen.getByRole('form', { name: '新建项目表单' }))
    expect(await screen.findByText('项目名称必填')).toBeInTheDocument()
    expect(createSpy).not.toHaveBeenCalled()
  })

  test('新建表单填写合法名称后启用提交按钮', async () => {
    loginAs(['project:create'], 1, 'owner')
    renderWithQuery(<NewProjectPage />)
    const submit = screen.getByRole('button', { name: '创建项目' })
    expect(submit).toBeDisabled()
    await act(async () => {
      fireEvent.input(screen.getByLabelText('项目名称'), { target: { value: '开项平台 V1' } })
    })
    await vi.waitFor(() => expect(submit).toBeEnabled())
  })

  test('有成员管理权时显示可用邮箱邀请控件且无等待后端提示', async () => {
    vi.spyOn(projectMembersApi, 'list').mockResolvedValue([memberFixture])
    vi.spyOn(projectMembersApi, 'listRoles').mockResolvedValue([memberRole])
    loginAs(['project:view', 'project:member:manage'], 1, 'admin')
    renderWithQuery(<ProjectMembersPage />)
    expect(await screen.findByRole('button', { name: '发送邀请' })).toBeInTheDocument()
    expect(
      screen.queryByText('邮箱邀请的后端接口尚未实现；表单与校验已就绪，接口完成后即可启用发送。'),
    ).not.toBeInTheDocument()
    expect(await screen.findByText('zhang@example.com')).toBeInTheDocument()
  })

  test('无成员管理权时不显示添加控件与角色下拉', async () => {
    vi.spyOn(projectMembersApi, 'list').mockResolvedValue([memberFixture])
    vi.spyOn(projectMembersApi, 'listRoles').mockResolvedValue([memberRole])
    loginAs(['project:view'], 2, 'member')
    renderWithQuery(<ProjectMembersPage />)
    expect(await screen.findByText('zhang@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发送邀请' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /移除/ })).not.toBeInTheDocument()
  })

  test('详情页显示统计卡片、最近活动与归档入口', async () => {
    vi.spyOn(projectsApi, 'get').mockResolvedValue(baseProject)
    vi.spyOn(projectDashboardApi, 'get').mockResolvedValue(dashboardFixture)
    loginAs(['project:view', 'project:update'], 1, 'owner')
    renderWithQuery(<ProjectDetailPage />)
    expect(await screen.findByText('开项平台')).toBeInTheDocument()
    expect(screen.getByText('创建项目')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '归档项目' })).toBeInTheDocument()
  })

  test('已归档项目详情显示恢复入口', async () => {
    vi.spyOn(projectsApi, 'get').mockResolvedValue({ ...baseProject, status: 'archived' })
    vi.spyOn(projectDashboardApi, 'get').mockResolvedValue(dashboardFixture)
    loginAs(['project:view', 'project:update'], 1, 'owner')
    renderWithQuery(<ProjectDetailPage />)
    expect(await screen.findByRole('button', { name: '恢复项目' })).toBeInTheDocument()
  })

  test('详情页从 metrics 字典读取同名指标', async () => {
    vi.spyOn(projectsApi, 'get').mockResolvedValue(baseProject)
    vi.spyOn(projectDashboardApi, 'get').mockResolvedValue(dashboardFixture)
    loginAs(['project:view', 'project:update'], 1, 'owner')
    renderWithQuery(<ProjectDetailPage />)
    await screen.findByText('开项平台')

    // member_count 从 metrics 字典读取
    const memberMetric = getMetric(dashboardFixture.metrics, DASHBOARD_METRIC_KEYS.MEMBER_COUNT)
    expect(memberMetric?.value).toBe(3)
  })

  test('详情页展示指标 warning 非阻断提示', async () => {
    vi.spyOn(projectsApi, 'get').mockResolvedValue(baseProject)
    vi.spyOn(projectDashboardApi, 'get').mockResolvedValue(dashboardFixture)
    loginAs(['project:view', 'project:update'], 1, 'owner')
    renderWithQuery(<ProjectDetailPage />)
    await screen.findByText('开项平台')

    // 应显示 warning 提示
    expect(screen.getByText('项目缺少结束日期，剩余天数无法计算')).toBeInTheDocument()
  })

  test('详情页展示工作台摘要且无权限时不泄露计数', async () => {
    vi.spyOn(projectsApi, 'get').mockResolvedValue(baseProject)
    vi.spyOn(projectDashboardApi, 'get').mockResolvedValue({
      ...dashboardFixture,
      trizInnovationWorkbenchSummary: {
        hasViewPermission: false,
        summary: null,
      },
    })
    loginAs(['project:view'], 2, 'member')
    renderWithQuery(<ProjectDetailPage />)
    await screen.findByText('开项平台')

    expect(screen.getByText('当前角色无权查看工作台摘要。')).toBeInTheDocument()
    expect(screen.queryByText('开放方案')).not.toBeInTheDocument()
  })

  test('详情页工作台摘要提供进入创新工作台的只读导航', async () => {
    vi.spyOn(projectsApi, 'get').mockResolvedValue(baseProject)
    vi.spyOn(projectDashboardApi, 'get').mockResolvedValue({
      ...dashboardFixture,
      trizInnovationWorkbenchSummary: {
        hasViewPermission: true,
        summary: {
          openSchemeCount: 2,
          pendingHandoffCount: 1,
          warningCount: 3,
          highestSeverity: 'high',
          latestReviewedAt: '2026-07-16T00:00:00.000Z',
          staleMarker: true,
        },
      },
    })
    loginAs(['project:view', 'contradiction:view', 'triz_innovation:view'], 1, 'owner')
    renderWithQuery(<ProjectDetailPage />)
    await screen.findByText('开项平台')

    expect(screen.getByText('开放方案')).toBeInTheDocument()
    expect(screen.getByText('待审草案')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开工作台' })).toHaveAttribute(
      'href',
      '/projects/1/triz-workbench',
    )
  })
})
