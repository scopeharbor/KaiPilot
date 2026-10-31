/**
 * v3-classic-ui-openproject-style —— 旧版界面 OpenProject 式版面与精选色系。
 *
 * 覆盖：色系清单与回退、首屏脚本（/next 不写）、CSS 合约（变量齐全、预览色块一致、对比度、
 * 默认强调色为品牌色、不定义 --nx-*）、ui-store 色系偏好、外壳挂载写入 / 卸载移除、
 * 外观菜单切换色系、项目内模块菜单、全局模块菜单按权限过滤。
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  CLASSIC_PALETTES,
  CLASSIC_PALETTE_IDS,
  DEFAULT_CLASSIC_PALETTE,
  classicPaletteBootScript,
  isNextTrackPath,
  resolveClassicPalette,
} from '@/lib/classic-palettes'
import { UI_STORE_KEY, useUiStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { projectKeys } from '@/lib/api/projects'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { accessTokenWith } from './_jwt-helper'

let mockPathname = '/projects'
const mockRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ({}),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

const mockSetTheme = vi.fn()
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: mockSetTheme }),
}))

let grantedPermissions: string[] = []
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: grantedPermissions,
    canAny: (list: string[]) => list.some((p) => grantedPermissions.includes(p)),
    can: (p: string) => grantedPermissions.includes(p),
    hasPermission: (p: string) => grantedPermissions.includes(p),
    canAll: (list: string[]) => list.every((p) => grantedPermissions.includes(p)),
  }),
}))

const ATTR = 'data-classic-palette'
const CSS = readFileSync(join(process.cwd(), 'app/classic-theme.css'), 'utf8')

function loginAs(permissions: string[]) {
  grantedPermissions = permissions
  act(() => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'user@example.com',
        fullName: '测试用户',
        organizations: [{ id: 1, name: '测试工作区', slug: 'test', role: 'owner' }],
      },
      accessToken: accessTokenWith(permissions, { organizationId: 1, roleVersion: 1 }),
      refreshToken: 'r',
      permissions,
      currentOrganizationId: 1,
      roleVersion: 1,
      isAuthenticated: true,
    })
  })
}

function renderWithProviders(ui: React.ReactNode, client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  )
}

function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
}

/** 取某个选择器块里的变量表（只认 `--x: value;`）。 */
function cssBlock(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`)
  expect(start, `缺少选择器 ${selector}`).toBeGreaterThanOrEqual(0)
  const body = CSS.slice(start + selector.length + 2, CSS.indexOf('}', start))
  const vars: Record<string, string> = {}
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[match[1]!] = match[2]!.trim()
  return vars
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const REQUIRED_VARS = [
  '--classic-accent',
  '--shell-header-bg',
  '--shell-header-fg',
  '--shell-header-hover',
  '--shell-header-border',
  '--shell-sidebar-bg',
  '--shell-sidebar-fg',
  '--shell-sidebar-muted',
  '--shell-sidebar-hover',
  '--shell-sidebar-border',
  '--shell-sidebar-active-bg',
  '--shell-sidebar-active-fg',
]

beforeEach(() => {
  mockPathname = '/projects'
  mockRouter.push.mockReset()
  grantedPermissions = []
  document.documentElement.removeAttribute(ATTR)
  localStorage.clear()
  act(() => useUiStore.setState({ classicPalette: DEFAULT_CLASSIC_PALETTE }))
})

afterEach(() => {
  document.documentElement.removeAttribute(ATTR)
  window.history.replaceState(null, '', '/')
})

describe('色系清单', () => {
  test('7 套色系、id 唯一、默认为开项蓝；未知 id 回退默认', () => {
    expect(CLASSIC_PALETTES.map((p) => p.id)).toEqual([...CLASSIC_PALETTE_IDS])
    expect(new Set(CLASSIC_PALETTE_IDS).size).toBe(7)
    expect(resolveClassicPalette('forest').label).toBe('森林绿')
    expect(resolveClassicPalette('no-such').id).toBe('brand')
    expect(resolveClassicPalette(undefined).label).toBe('开项蓝')
  })

  test('新版路径判定：/next、/next-login 及子路径是新版，其余不是', () => {
    expect(isNextTrackPath('/next')).toBe(true)
    expect(isNextTrackPath('/next/projects/1')).toBe(true)
    expect(isNextTrackPath('/next-login')).toBe(true)
    expect(isNextTrackPath('/dashboard')).toBe(false)
    expect(isNextTrackPath('/nextgen')).toBe(false)
  })
})

describe('首屏脚本', () => {
  const run = () => new Function(classicPaletteBootScript(UI_STORE_KEY))()

  test('旧版路径写入保存的色系；未保存或非法时写默认色系', () => {
    window.history.replaceState(null, '', '/dashboard')
    run()
    expect(document.documentElement.getAttribute(ATTR)).toBe('brand')
    localStorage.setItem(UI_STORE_KEY, JSON.stringify({ state: { classicPalette: 'violet' } }))
    run()
    expect(document.documentElement.getAttribute(ATTR)).toBe('violet')
    localStorage.setItem(UI_STORE_KEY, JSON.stringify({ state: { classicPalette: 'evil' } }))
    run()
    expect(document.documentElement.getAttribute(ATTR)).toBe('brand')
  })

  test('新版路径首屏不写色系', () => {
    localStorage.setItem(UI_STORE_KEY, JSON.stringify({ state: { classicPalette: 'forest' } }))
    for (const path of ['/next', '/next/projects/3', '/next-login']) {
      window.history.replaceState(null, '', path)
      run()
      expect(document.documentElement.hasAttribute(ATTR)).toBe(false)
    }
  })
})

describe('CSS 合约', () => {
  test('每套色系浅色 / 深色块都定义全部必需变量，预览色块与 CSS 一致', () => {
    for (const palette of CLASSIC_PALETTES) {
      const light = cssBlock(`:root[${ATTR}='${palette.id}']`)
      const dark = cssBlock(`:root[${ATTR}='${palette.id}'][data-mode='dark']`)
      for (const name of REQUIRED_VARS) {
        expect(light[name], `${palette.id} 浅色缺 ${name}`).toBeTruthy()
        expect(dark[name], `${palette.id} 深色缺 ${name}`).toBeTruthy()
      }
      expect(light['--shell-header-bg']).toBe(palette.swatch.header)
      expect(light['--shell-sidebar-bg']).toBe(palette.swatch.sidebar)
      expect(light['--classic-accent']).toBe(palette.swatch.accent)
    }
  })

  test('顶栏、侧栏文字与选中项对各自底色的对比度 ≥ 4.5:1（浅色与深色）', () => {
    const pairs: Array<[string, string]> = [
      ['--shell-header-fg', '--shell-header-bg'],
      ['--shell-sidebar-fg', '--shell-sidebar-bg'],
      ['--shell-sidebar-muted', '--shell-sidebar-bg'],
      ['--shell-sidebar-active-fg', '--shell-sidebar-active-bg'],
    ]
    for (const palette of CLASSIC_PALETTES) {
      for (const block of [
        cssBlock(`:root[${ATTR}='${palette.id}']`),
        cssBlock(`:root[${ATTR}='${palette.id}'][data-mode='dark']`),
      ]) {
        for (const [fg, bg] of pairs) {
          const ratio = contrast(block[fg]!, block[bg]!)
          expect(ratio, `${palette.id} ${fg} / ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
            4.5,
          )
        }
      }
    }
  })

  test('默认色系强调色为品牌色；文件只覆盖既有令牌，不定义 --nx-*', () => {
    expect(cssBlock(`:root[${ATTR}='brand']`)['--classic-accent']).toBe('#3b6bef')
    expect(cssBlock(`:root[${ATTR}]`)['--classic-accent']).toBe('#3b6bef')
    expect(CSS).not.toMatch(/--nx-[\w-]+\s*:/)
    // 所有规则都限定在旧版色系属性或旧版外壳之下
    const selectors = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) =>
      m[1]!.trim(),
    )
    // @media 等 at-rule 只是包裹层，其内部规则同样逐条校验
    for (const selector of selectors.filter((item) => !item.startsWith('@'))) {
      // 也允许以旧版外壳开头的 :is(...) 分组（页面标题区规则）
      expect(selector, selector).toMatch(
        /^(:root\[data-classic-palette|\[data-classic-shell\]|:is\(\s*\[data-classic-shell\])/,
      )
    }
  })

  test('默认令牌层的卡片阴影等于原来的 md / lg，新版与未设属性的页面视觉不变', () => {
    const globals = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
    expect(globals).toContain('--shadow-card: var(--shadow-md);')
    expect(globals).toContain('--shadow-card-hover: var(--shadow-lg);')
  })
})

describe('色系偏好', () => {
  test('外壳挂上属性后切换色系即时写入；未挂属性（新版界面）时只存偏好不写 DOM', () => {
    act(() => useUiStore.getState().setClassicPalette('teal'))
    expect(useUiStore.getState().classicPalette).toBe('teal')
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false)

    document.documentElement.setAttribute(ATTR, 'teal')
    act(() => useUiStore.getState().setClassicPalette('wine'))
    expect(document.documentElement.getAttribute(ATTR)).toBe('wine')
    act(() => useUiStore.getState().setClassicPalette('bogus' as never))
    expect(useUiStore.getState().classicPalette).toBe('brand')
  })

  test('持久化偏好里的未知色系回退默认', async () => {
    localStorage.setItem(
      UI_STORE_KEY,
      JSON.stringify({ state: { classicPalette: 'neon', density: 'compact' }, version: 0 }),
    )
    await act(async () => {
      await useUiStore.persist.rehydrate()
    })
    expect(useUiStore.getState().classicPalette).toBe('brand')
    expect(useUiStore.getState().density).toBe('compact')
    act(() => useUiStore.getState().setDensity('comfortable'))
  })

  test('旧版外壳挂载写入、切换更新、卸载移除色系属性', async () => {
    const { useClassicPaletteAttribute } = await import('@/components/layout/use-shell-tone')
    act(() => useUiStore.setState({ classicPalette: 'graphite' }))
    const hook = renderHook(() => useClassicPaletteAttribute())
    expect(document.documentElement.getAttribute(ATTR)).toBe('graphite')
    act(() => useUiStore.getState().setClassicPalette('sky'))
    expect(document.documentElement.getAttribute(ATTR)).toBe('sky')
    hook.unmount()
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false)
  })

  test('外观菜单列出 7 套色系，选择后写入并标记当前项', async () => {
    const { ThemeDensityMenu } = await import('@/components/layout/ThemeDensityMenu')
    document.documentElement.setAttribute(ATTR, 'brand')
    renderWithProviders(<ThemeDensityMenu />)
    openMenu(screen.getByRole('button', { name: '外观菜单' }))
    for (const palette of CLASSIC_PALETTES) {
      expect(screen.getByRole('menuitem', { name: palette.label })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('menuitem', { name: '森林绿' }))
    expect(useUiStore.getState().classicPalette).toBe('forest')
    expect(document.documentElement.getAttribute(ATTR)).toBe('forest')
  })
})

describe('项目内模块菜单', () => {
  test('路径解析与当前模块判定', async () => {
    const { projectIdFromPath, activeProjectModule } =
      await import('@/components/layout/ProjectSidebarMenu')
    expect(projectIdFromPath('/projects/7/gantt')).toBe(7)
    expect(projectIdFromPath('/projects/7')).toBe(7)
    expect(projectIdFromPath('/projects')).toBeNull()
    expect(projectIdFromPath('/projects/new')).toBeNull()
    expect(activeProjectModule('/projects/7', 7)).toBe('overview')
    expect(activeProjectModule('/projects/7/overview', 7)).toBe('overview')
    expect(activeProjectModule('/projects/7/gantt', 7)).toBe('gantt')
    expect(activeProjectModule('/projects/7/risks/12', 7)).toBe('risks')
    expect(activeProjectModule('/projects/7/triz-workbench', 7)).toBeNull()
  })

  test('进入项目后侧栏显示返回链接、项目名与模块菜单，当前模块选中，全局导航不显示', async () => {
    loginAs(['project:view'])
    mockPathname = '/projects/7/gantt'
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    client.setQueryData(projectKeys.detail(7), { id: 7, name: '新园区建设' })
    const { Sidebar } = await import('@/components/layout/Sidebar')
    renderWithProviders(<Sidebar forceCollapsed={false} />, client)

    expect(screen.getByRole('link', { name: '返回全部项目' })).toHaveAttribute('href', '/projects')
    expect(screen.getByText('新园区建设')).toBeInTheDocument()
    const gantt = screen.getByRole('link', { name: '甘特图' })
    expect(gantt).toHaveAttribute('href', '/projects/7/gantt')
    expect(gantt).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '概览' })).toHaveAttribute(
      'href',
      '/projects/7/overview',
    )
    expect(screen.getByRole('link', { name: '概览' })).not.toHaveAttribute('aria-current')
    expect(screen.queryByText('核心功能')).not.toBeInTheDocument()
  })

  test('离开项目恢复全局导航', async () => {
    loginAs(['project:view'])
    mockPathname = '/projects'
    const { Sidebar } = await import('@/components/layout/Sidebar')
    renderWithProviders(<Sidebar forceCollapsed={false} />)
    expect(screen.getByText('核心功能')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '返回全部项目' })).not.toBeInTheDocument()
  })
})

describe('顶栏菜单', () => {
  test('全局模块菜单与侧栏同源，按权限过滤', async () => {
    loginAs(['project:view'])
    const { GlobalModulesMenu } = await import('@/components/layout/Topbar')
    renderWithProviders(<GlobalModulesMenu />)
    openMenu(screen.getByRole('button', { name: '全局模块' }))
    expect(screen.getByRole('menuitem', { name: '项目列表' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'AI 快速创建' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: '项目列表' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/projects')
  })

  test('新建菜单只对有建项目权限的用户出现，并链接既有路由', async () => {
    const { CreateMenu } = await import('@/components/layout/Topbar')
    loginAs(['project:view'])
    const { unmount } = renderWithProviders(<CreateMenu />)
    expect(screen.queryByRole('button', { name: '新建' })).not.toBeInTheDocument()
    unmount()

    loginAs(['project:view', 'project:create'])
    renderWithProviders(<CreateMenu />)
    openMenu(screen.getByRole('button', { name: '新建' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新建项目' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/projects/new')
  })

  test('项目下拉打开时才读取最近项目，列出项目与「查看全部项目」', async () => {
    const { ProjectQuickSwitcher } = await import('@/components/layout/Topbar')
    const api = await import('@/lib/api/projects')
    const list = vi.spyOn(api.projectsApi, 'list').mockResolvedValue({
      data: [{ id: 3, name: '数据中台', code: 'DP' } as never],
      meta: { total: 1, page: 1, perPage: 8, totalPages: 1 },
    })
    loginAs(['project:view'])
    renderWithProviders(<ProjectQuickSwitcher />)
    expect(list).not.toHaveBeenCalled()
    openMenu(screen.getByRole('button', { name: '选择项目' }))
    expect(list).toHaveBeenCalledWith({ perPage: 8 })
    fireEvent.click(await screen.findByRole('menuitem', { name: /数据中台/ }))
    expect(mockRouter.push).toHaveBeenCalledWith('/projects/3')
    list.mockRestore()
  })
})
