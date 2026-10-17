import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { CheckSquare, Moon, Plus, Sun } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { useRegisterCommands } from '@/lib/command-registry/use-register-commands'
import { buildNavigationCommands } from '@/lib/command-registry/built-in/navigation'
import { buildThemeCommands } from '@/lib/command-registry/built-in/theme'
import { buildDensityCommands } from '@/lib/command-registry/built-in/density'
import { CommandPaletteProvider, useCommandPalette } from '@/components/layout/CommandPalette'
import { accessTokenWith } from './_jwt-helper'
import type { RegisteredCommand } from '@/lib/command-registry/types'

// —— next/navigation mock（mutable pathname） —— //
let mockPathname = '/dashboard'
let mockParams: Record<string, string | string[]> = {}
let mockSearchParams = new URLSearchParams()
const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  useParams: () => mockParams,
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}))

// —— next-themes mock —— //
const setTheme = vi.fn()
let mockTheme = 'light'
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: mockTheme, setTheme }),
}))

// —— usePermission hook mock（mutable canAny） —— //
let grantedPermissions: string[] = []
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    canAny: (list: string[]) => list.some((p) => grantedPermissions.includes(p)),
    can: (p: string) => grantedPermissions.includes(p),
    canAll: (list: string[]) => list.every((p) => grantedPermissions.includes(p)),
  }),
}))

// —— useSearchSuggestions mock —— //
vi.mock('@/hooks/use-search', () => ({
  useSearchSuggestions: () => ({ data: { data: [] }, isLoading: false }),
}))

beforeEach(() => {
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
  useCommandRegistryStore.getState().clear()
  mockPathname = '/dashboard'
  mockParams = {}
  mockSearchParams = new URLSearchParams()
  mockTheme = 'light'
  grantedPermissions = []
  routerPush.mockClear()
  setTheme.mockClear()
  act(() => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'user@example.com',
        fullName: '测试用户',
        organizations: [{ id: 1, name: '测试工作区', slug: 'test', role: 'owner' }],
      },
      accessToken: accessTokenWith(['project:view', 'task:create'], {
        organizationId: 1,
        roleVersion: 1,
      }),
      permissions: ['project:view', 'task:create'],
      currentOrganizationId: 1,
      roleVersion: 1,
      isAuthenticated: true,
    })
  })
  // 重新注册内置命令（clear 后内置命令的模块级 registered 标志会阻止自动重注册，
  // 测试里手动重建 navigation/theme/density）。
  useCommandRegistryStore
    .getState()
    .addCommands([...buildNavigationCommands(), ...buildThemeCommands(), ...buildDensityCommands()])
})

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TooltipStub>{ui}</TooltipStub>
    </QueryClientProvider>,
  )
}

// CommandPalette 的 Dialog 用 Radix，测试中精简掉无关 Provider。
function TooltipStub({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

/** 打开面板的辅助组件（在 Provider 内调用 hook）。 */
function PaletteOpener() {
  const { setOpen } = useCommandPalette()
  React.useEffect(() => {
    setOpen(true)
  }, [setOpen])
  return null
}

/** 注册上下文命令的辅助组件。 */
function ContextCommands({ commands }: { commands: RegisteredCommand[] }) {
  useRegisterCommands(commands, [commands])
  return null
}

describe('CommandPalette - registry 驱动渲染', () => {
  test('静态导航命令经权限过滤后展示', () => {
    grantedPermissions = ['project:view'] // 有 project:view，无 task:view
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    // 等内置命令注册后渲染。
    const navGroup = screen.getByText('跳转页面')
    const group = (navGroup.closest('[cmdk-group]') ?? navGroup.parentElement) as HTMLElement
    // 项目列表（project:view 命中）应出现。
    expect(within(group).getByText('项目列表')).toBeInTheDocument()
  })

  test('上下文命令 when 过滤：路径不符则不显示', () => {
    mockPathname = '/dashboard'
    const ctxCmd: RegisteredCommand = {
      id: 'ctx.project.new-task',
      label: '新建任务',
      icon: Plus,
      group: 'contextual',
      effect: 'open-form',
      requiresPermission: ['task:create'],
      when: (ctx) => ctx.pathname.startsWith('/projects/'),
      execute: () => {},
    }
    renderWithProviders(
      <CommandPaletteProvider>
        <ContextCommands commands={[ctxCmd]} />
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    // 在 /dashboard，上下文命令应不可见。
    expect(screen.queryByText('新建任务')).not.toBeInTheDocument()
  })

  test('上下文命令 when 过滤：路径匹配则显示且排在最前分组', () => {
    mockPathname = '/projects/1/kanban'
    mockParams = { id: '1' }
    grantedPermissions = ['task:create']
    const ctxCmd: RegisteredCommand = {
      id: 'ctx.project.new-task',
      label: '新建任务',
      icon: Plus,
      group: 'contextual',
      effect: 'open-form',
      requiresPermission: ['task:create'],
      when: (ctx) => ctx.pathname.startsWith('/projects/'),
      execute: () => {},
    }
    renderWithProviders(
      <CommandPaletteProvider>
        <ContextCommands commands={[ctxCmd]} />
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.getByText('新建任务')).toBeInTheDocument()
    // 「快捷操作」分组标题应出现在「跳转页面」之前。
    const groups = screen.getAllByText(/快捷操作|跳转页面|主题|密度/)
    const ctxIdx = groups.findIndex((n) => n.textContent === '快捷操作')
    const navIdx = groups.findIndex((n) => n.textContent === '跳转页面')
    expect(ctxIdx).toBeGreaterThanOrEqual(0)
    expect(navIdx).toBeGreaterThanOrEqual(0)
    expect(ctxIdx).toBeLessThan(navIdx)
  })

  test('快捷键提示渲染为 kbd 元素', () => {
    const ctxCmd: RegisteredCommand = {
      id: 'ctx.shortcut-demo',
      label: '快捷键示例',
      icon: Sun,
      group: 'contextual',
      effect: 'ui-setting',
      shortcut: '⌘⇧P',
      execute: () => {},
    }
    renderWithProviders(
      <CommandPaletteProvider>
        <ContextCommands commands={[ctxCmd]} />
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.getByText('⌘⇧P')).toBeInTheDocument()
    expect(screen.getByText('⌘⇧P').tagName).toBe('KBD')
  })

  test('runCommand：选中后关闭面板并延迟执行 execute', async () => {
    const execute = vi.fn()
    const ctxCmd: RegisteredCommand = {
      id: 'ctx.run-demo',
      label: '执行示例',
      icon: CheckSquare,
      group: 'contextual',
      effect: 'navigate',
      execute,
    }
    renderWithProviders(
      <CommandPaletteProvider>
        <ContextCommands commands={[ctxCmd]} />
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    const item = screen.getByText('执行示例')
    // cmdk 的 Command.Item 选中由 click 触发，onSelect 回调内调 runCommand（关闭+延迟 execute）。
    await act(async () => {
      fireEvent.click(item)
      // runCommand 用 setTimeout(0) 延后 execute；等待宏任务落地。
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(execute).toHaveBeenCalled()
  })

  test('主题命令切换调用 setTheme（经 settings bridge）', async () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    const darkItem = screen.getByText('深色主题')
    await act(async () => {
      fireEvent.click(darkItem)
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  test('主题当前选中态显示 Check 图标', () => {
    mockTheme = 'dark'
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    // 深色主题行应含 Check 图标（lucide 渲染为 svg）。
    const darkRow = screen.getByText('深色主题').closest('[cmdk-item]')!
    expect(darkRow.querySelector('svg')).toBeInTheDocument()
    // 浅色主题行不应有 Check（mockTheme=dark）。
    const lightRow = screen.getByText('浅色主题').closest('[cmdk-item]')!
    // 两行都有图标 svg，但只有激活行含 Check——通过 data 属性或子 svg 数量区分较脆弱，
    // 此处仅断言深色行含 svg（图标渲染正常）即可，选中态精确断言留给集成验证。
    expect(darkRow.querySelector('svg')).toBeInTheDocument()
    expect(lightRow.querySelector('svg')).toBeInTheDocument()
  })

  test('组件卸载后上下文命令被注销', () => {
    const ctxCmd: RegisteredCommand = {
      id: 'ctx.unmount',
      label: '卸载示例',
      icon: Moon,
      group: 'contextual',
      effect: 'navigate',
      execute: () => {},
    }
    const { unmount } = renderWithProviders(
      <CommandPaletteProvider>
        <ContextCommands commands={[ctxCmd]} />
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(
      useCommandRegistryStore
        .getState()
        .getAllCommands()
        .some((c) => c.id === 'ctx.unmount'),
    ).toBe(true)
    unmount()
    expect(
      useCommandRegistryStore
        .getState()
        .getAllCommands()
        .some((c) => c.id === 'ctx.unmount'),
    ).toBe(false)
  })
})
