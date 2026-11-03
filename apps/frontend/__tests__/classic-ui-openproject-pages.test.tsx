/**
 * v3-classic-ui-openproject-pages —— 旧版内页 OpenProject 式重新设计。
 *
 * 覆盖：基础组件 data-slot 标记、旧版主题第 5 节样式合约、设置与管理侧栏（显示 / 高亮 / 权限过滤）、
 * 设置菜单配置派生、面包屑中文段名。仪表盘小部件见 copilot-operating-entry-surface.test。
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { TooltipProvider } from '@/components/ui/Tooltip'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Select, SelectTrigger, SelectValue } from '@/components/ui/Select'
import {
  GENERIC_SEGMENT_LABELS,
  activeSettingsHref,
  isSettingsPath,
  settingsMenuGroups,
} from '@/lib/settings-navigation'
import { accessTokenWith } from './_jwt-helper'

let mockPathname = '/settings/organization'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }),
}))

let granted: string[] = []
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: granted,
    canAny: (list: string[]) => list.some((p) => granted.includes(p)),
    can: (p: string) => granted.includes(p),
    hasPermission: (p: string) => granted.includes(p),
    canAll: (list: string[]) => list.every((p) => granted.includes(p)),
  }),
}))

const CSS = readFileSync(join(process.cwd(), 'app/classic-theme.css'), 'utf8')
const SECTION5 = CSS.slice(CSS.indexOf('5. 内页'))

function loginAs(permissions: string[]) {
  granted = permissions
  act(() => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '项目经理',
        organizations: [{ id: 1, name: '组织', slug: 'org', role: 'owner' }],
      },
      accessToken: accessTokenWith(permissions, { organizationId: 1, roleVersion: 1 }),
      refreshToken: 'r',
      permissions,
      currentOrganizationId: 1,
      roleVersion: 1,
      isAuthenticated: true,
      hasHydrated: true,
    })
  })
}

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockPathname = '/settings/organization'
})

describe('基础组件标记', () => {
  test('卡片各部分带 data-slot', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>标题</CardTitle>
          <CardDescription>说明</CardDescription>
        </CardHeader>
        <CardContent>内容</CardContent>
        <CardFooter>页脚</CardFooter>
      </Card>,
    )
    expect(screen.getByText('标题')).toHaveAttribute('data-slot', 'card-title')
    expect(screen.getByText('说明')).toHaveAttribute('data-slot', 'card-description')
    expect(screen.getByText('内容')).toHaveAttribute('data-slot', 'card-content')
    expect(screen.getByText('页脚')).toHaveAttribute('data-slot', 'card-footer')
    expect(screen.getByText('标题').closest('[data-slot="card-header"]')).toBeTruthy()
    expect(screen.getByText('标题').closest('[data-slot="card"]')).toBeTruthy()
  })

  test('按钮、输入框、多行输入、下拉框与标签带 data-slot', () => {
    render(
      <>
        <Button variant="secondary" size="sm">
          取消
        </Button>
        <Button>保存</Button>
        <Input aria-label="名称" />
        <Textarea aria-label="简介" />
        <Select>
          <SelectTrigger aria-label="角色">
            <SelectValue placeholder="选择角色" />
          </SelectTrigger>
        </Select>
        <Badge>进行中</Badge>
      </>,
    )
    const cancel = screen.getByRole('button', { name: '取消' })
    expect(cancel).toHaveAttribute('data-slot', 'button')
    expect(cancel).toHaveAttribute('data-variant', 'secondary')
    expect(cancel).toHaveAttribute('data-size', 'sm')
    expect(screen.getByRole('button', { name: '保存' })).toHaveAttribute('data-variant', 'primary')
    expect(screen.getByRole('textbox', { name: '名称' })).toHaveAttribute('data-slot', 'input')
    expect(screen.getByRole('textbox', { name: '简介' })).toHaveAttribute('data-slot', 'textarea')
    expect(screen.getByRole('combobox', { name: '角色' })).toHaveAttribute(
      'data-slot',
      'select-trigger',
    )
    expect(screen.getByText('进行中')).toHaveAttribute('data-slot', 'badge')
  })
})

describe('旧版主题第 5 节样式合约', () => {
  test('页面标题规则限定在旧版外壳内容区，标题区规则排除项目头', () => {
    expect(SECTION5).toMatch(/\[data-classic-shell\] \[data-page-content\] h1 \{/)
    expect(SECTION5).toContain(':first-child:not([data-project-header])')
    expect(SECTION5).toContain('[data-project-header] ~ *')
  })

  test('卡片两种写法都有标题栏规则，p-0 内容区不用负外边距', () => {
    expect(SECTION5).toMatch(/\[data-slot='card-header'\] \{/)
    expect(SECTION5).toContain(":not([class~='p-0'])")
    const p0Start = SECTION5.indexOf("[data-slot='card-content'][class~='p-0']")
    expect(p0Start).toBeGreaterThan(0)
    const p0Rule = SECTION5.slice(p0Start, SECTION5.indexOf('}', p0Start))
    expect(p0Rule).not.toContain('margin')
  })

  test('控件高度只在精确指针下收紧；按钮与标签规则挂在旧版色系属性下', () => {
    const media = SECTION5.slice(SECTION5.indexOf('@media (pointer: fine)'))
    expect(media).toContain("[data-slot='button'][data-size='default']")
    expect(media).toContain("[data-slot='input'], [data-slot='select-trigger']")
    const beforeMedia = SECTION5.slice(0, SECTION5.indexOf('@media (pointer: fine)'))
    expect(beforeMedia).not.toMatch(/height:\s*32px/)
    expect(SECTION5).toMatch(
      /:root\[data-classic-palette\] \[data-slot='badge'\] \{\s*border-radius: 9999px;/,
    )
  })
})

describe('设置与管理菜单', () => {
  test('配置派生：两步验证归个人组，/settings 归组织组，/admin 归平台管理组', () => {
    const groups = settingsMenuGroups()
    const byId = Object.fromEntries(groups.map((g) => [g.id, g.items.map((i) => i.href)]))
    expect(byId.personal).toEqual(['/settings/profile', '/settings/security/two-factor'])
    expect(byId.organization!.slice(0, 2)).toEqual(['/settings/organization', '/settings/ai-usage'])
    expect(byId.organization!.every((href) => href.startsWith('/settings/'))).toBe(true)
    expect(byId.organization).not.toContain('/settings/security/two-factor')
    expect(byId.platform!.every((href) => href.startsWith('/admin/'))).toBe(true)
  })

  test('路径判定与最长前缀高亮', () => {
    expect(isSettingsPath('/settings')).toBe(true)
    expect(isSettingsPath('/admin/users')).toBe(true)
    expect(isSettingsPath('/settingsx')).toBe(false)
    expect(isSettingsPath('/projects/1/settings')).toBe(false)
    const items = settingsMenuGroups().flatMap((g) => g.items)
    expect(activeSettingsHref('/settings/security/two-factor', items)).toBe(
      '/settings/security/two-factor',
    )
    expect(activeSettingsHref('/settings/organization', items)).toBe('/settings/organization')
    expect(activeSettingsHref('/dashboard', items)).toBeNull()
  })

  test('进入设置页：侧栏显示设置菜单，当前页高亮，全局导航不显示', async () => {
    loginAs(['org:view', 'project:view'])
    const { Sidebar } = await import('@/components/layout/Sidebar')
    renderWith(<Sidebar forceCollapsed={false} />)
    expect(screen.getByRole('link', { name: '返回' })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: '个人资料' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '组织设置' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('核心功能')).not.toBeInTheDocument()
  })

  test('无权限条目与空组不显示', async () => {
    mockPathname = '/settings/profile'
    loginAs(['project:view'])
    const { Sidebar } = await import('@/components/layout/Sidebar')
    renderWith(<Sidebar forceCollapsed={false} />)
    expect(screen.getByRole('link', { name: '个人资料' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('link', { name: '组织设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '用户管理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '平台管理' })).not.toBeInTheDocument()
  })

  test('离开设置路径恢复全局导航', async () => {
    mockPathname = '/projects'
    loginAs(['project:view'])
    const { Sidebar } = await import('@/components/layout/Sidebar')
    renderWith(<Sidebar forceCollapsed={false} />)
    expect(screen.getByText('核心功能')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '返回' })).not.toBeInTheDocument()
  })
})

describe('面包屑中文段名', () => {
  test('设置页显示「设置」「组织」，不显示英文段', async () => {
    loginAs(['org:view'])
    const { Breadcrumb } = await import('@/components/layout/Breadcrumb')
    renderWith(<Breadcrumb />)
    const crumbs = screen.getByRole('navigation', { name: /面包屑/ })
    expect(within(crumbs).getByText('设置')).toBeInTheDocument()
    expect(within(crumbs).getByText('组织')).toBeInTheDocument()
    expect(crumbs.textContent).not.toContain('organization')
    expect(GENERIC_SEGMENT_LABELS['ai-usage']).toBe('AI 用量')
  })
})
