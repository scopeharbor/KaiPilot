import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { RoleHomeContainer } from '@/components/next/home/RoleHomeContainer'
import NextHomePage from '@/app/(next)/next/page'

/** 建议卡改由 useRoleSuggestionItems 拉取真实数据源（TanStack Query）——渲染须带 Provider。 */
function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

/** 服务端租户上下文的合法形状（判定与渲染不需要的字段给占位）。 */
function context(membershipRole: string | null = null, isSuperAdmin = false) {
  return {
    actorRef: 'user:1',
    organizationId: 1,
    projectId: null,
    membershipRole,
    scopeMode: 'org',
    selectionSource: 'test',
    resolutionReason: 'test',
    scopeHash: 'hash',
    resolvedAt: '2026-01-01T00:00:00.000Z',
    warningCodes: [],
    isSuperAdmin,
  }
}

/** 以指定组织角色注入已认证会话（有名字与组织名的低敏展示数据）。 */
function setAuthOrgRole(
  role: string,
  options: { orgName?: string; fullName?: string; effectiveMembershipRole?: string | null } = {},
) {
  const { orgName = '北极星研发部', fullName = '王启明', effectiveMembershipRole = null } = options
  useAuthStore.setState({
    hasHydrated: true,
    isAuthenticated: true,
    currentOrganizationId: 1,
    user: {
      id: 1,
      email: 'user@example.com',
      fullName,
      organizations: [{ id: 1, name: orgName, slug: 'northstar', role }],
    },
    effectiveTenantContext: context(effectiveMembershipRole),
  })
}

function resetAuthState() {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

beforeEach(() => {
  resetAuthState()
})

describe('components/next/home/RoleHomeContainer（v3-ui-next-shell-space-map D6/D7 / tasks 3.8）', () => {
  test('PM 视角：欢迎语聚焦项目组合与交付态势，建议区渲染健康度巡检 / 关键路径风险 / 排程偏离', () => {
    setAuthOrgRole('project_manager')
    const { container } = renderWithQuery(<RoleHomeContainer />)

    expect(screen.getByText('你好，王启明')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '项目组合与交付态势' })).toBeInTheDocument()
    expect(screen.getByText('项目经理视角')).toBeInTheDocument()
    expect(screen.getByText('当前工作区 · 北极星研发部')).toBeInTheDocument()
    for (const slot of ['健康度巡检', '关键路径风险', '排程偏离']) {
      expect(screen.getByText(slot)).toBeInTheDocument()
    }

    const home = container.querySelector('[data-role-home]')
    expect(home?.getAttribute('data-role-bucket')).toBe('pm')
    expect(home?.className).toContain('nx-space-atmosphere')
    expect(container.querySelector('canvas')).toBeNull()
  })

  test('Member 视角：今日任务与协作焦点 + 今日聚焦 / 前置阻塞卡槽', () => {
    setAuthOrgRole('member', { fullName: '李小红' })
    renderWithQuery(<RoleHomeContainer />)

    expect(screen.getByRole('heading', { name: '今日任务与协作焦点' })).toBeInTheDocument()
    expect(screen.getByText('成员视角')).toBeInTheDocument()
    expect(screen.getByText('今日聚焦')).toBeInTheDocument()
    expect(screen.getByText('前置阻塞')).toBeInTheDocument()
    expect(screen.getByText('你好，李小红')).toBeInTheDocument()
  })

  test('Admin 视角：组织治理与系统效能 + 租户资源 / 权限矩阵 / 审计概览卡槽', () => {
    setAuthOrgRole('owner', { orgName: '集团总部' })
    renderWithQuery(<RoleHomeContainer />)

    expect(screen.getByRole('heading', { name: '组织治理与系统效能' })).toBeInTheDocument()
    expect(screen.getByText('管理员视角')).toBeInTheDocument()
    for (const slot of ['租户资源', '权限矩阵', '审计概览']) {
      expect(screen.getByText(slot)).toBeInTheDocument()
    }
    expect(screen.getByText('当前工作区 · 集团总部')).toBeInTheDocument()
  })

  test('Observer 视角：只读洞察与报表概览 + 里程碑进度卡槽（组织角色与服务端 membershipRole 两条路径）', () => {
    setAuthOrgRole('readonly_observer', { fullName: '观察者' })
    const { unmount } = renderWithQuery(<RoleHomeContainer />)
    expect(screen.getByRole('heading', { name: '只读洞察与报表概览' })).toBeInTheDocument()
    expect(screen.getByText('观察员视角')).toBeInTheDocument()
    expect(screen.getByText('里程碑进度')).toBeInTheDocument()
    unmount()

    setAuthOrgRole('owner', { effectiveMembershipRole: 'Read-only Observer' })
    renderWithQuery(<RoleHomeContainer />)
    expect(screen.getByRole('heading', { name: '只读洞察与报表概览' })).toBeInTheDocument()
  })

  test('未知 / 未识别角色：标准「开项项目空间」欢迎语与通用导览卡槽，页面不报错', () => {
    setAuthOrgRole('custom-role-weird')
    const { container } = renderWithQuery(<RoleHomeContainer />)

    expect(screen.getByRole('heading', { name: '开项项目空间' })).toBeInTheDocument()
    expect(screen.getByText('访客视角')).toBeInTheDocument()
    expect(screen.getByText('空间导览')).toBeInTheDocument()
    expect(container.querySelector('canvas')).toBeNull()
  })

  test('未登录（user 为 null）：回退通用欢迎语，无组织标识，零报错', () => {
    renderWithQuery(<RoleHomeContainer />)

    expect(screen.getByText('欢迎回来')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '开项项目空间' })).toBeInTheDocument()
    expect(screen.queryByText(/当前工作区/)).not.toBeInTheDocument()
  })

  test('认证水合前：渲染平滑骨架态，不展示任何角色化内容', () => {
    useAuthStore.setState({ hasHydrated: false, isAuthenticated: false, user: null })
    const { container } = renderWithQuery(<RoleHomeContainer />)

    expect(screen.getByText('正在加载角色工作台…')).toBeInTheDocument()
    expect(container.querySelector('[data-role-home]')?.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('heading', { name: '项目组合与交付态势' })).not.toBeInTheDocument()
  })

  test('接入首页（page.tsx）：角色化容器被整体渲染', () => {
    setAuthOrgRole('project_manager')
    renderWithQuery(<NextHomePage />)

    expect(screen.getByRole('heading', { name: '项目组合与交付态势' })).toBeInTheDocument()
    expect(screen.getByText('健康度巡检')).toBeInTheDocument()
  })
})
