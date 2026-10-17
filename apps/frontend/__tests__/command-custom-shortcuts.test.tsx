import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { Sun } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { buildNavigationCommands } from '@/lib/command-registry/built-in/navigation'
import { buildThemeCommands } from '@/lib/command-registry/built-in/theme'
import { buildDensityCommands } from '@/lib/command-registry/built-in/density'
import { CommandPaletteProvider, useCommandPalette } from '@/components/layout/CommandPalette'
import { accessTokenWith } from './_jwt-helper'
import { shortcutOverrideStore } from '@/lib/command-registry/shortcut-store'
import type { RegisteredCommand } from '@/lib/command-registry/types'

let mockPathname = '/dashboard'
const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => mockPathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))
const setTheme = vi.fn()
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme }),
}))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    canAny: () => true,
    can: () => true,
    canAll: () => true,
  }),
}))
vi.mock('@/hooks/use-search', () => ({
  useSearchSuggestions: () => ({ data: { data: [] }, isLoading: false }),
}))

beforeEach(() => {
  localStorage.clear()
  shortcutOverrideStore.clearAll()
  useCommandRegistryStore.getState().clear()
  mockPathname = '/dashboard'
  routerPush.mockClear()
  setTheme.mockClear()
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
  act(() => {
    useAuthStore.setState({
      user: { id: 1, email: 'test@test.com', fullName: 'Test', organizations: [] },
      accessToken: accessTokenWith(['project:view']),
      permissions: ['project:view'],
      currentOrganizationId: 1,
      roleVersion: 1,
      isAuthenticated: true,
    })
  })
  useCommandRegistryStore
    .getState()
    .addCommands([...buildNavigationCommands(), ...buildThemeCommands(), ...buildDensityCommands()])
})

afterEach(() => {
  localStorage.clear()
})

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function PaletteOpener() {
  const { setOpen } = useCommandPalette()
  React.useEffect(() => {
    setOpen(true)
  }, [setOpen])
  return null
}

describe('Custom shortcuts - palette integration', () => {
  test('管理入口按钮在面板底部', () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.getByText('管理快捷键…')).toBeInTheDocument()
  })

  test('点击进入管理界面', () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    fireEvent.click(screen.getByText('管理快捷键…'))
    expect(screen.getAllByText('管理快捷键').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('返回命令面板')).toBeInTheDocument()
  })

  test('管理界面只显示当前可见命令', () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    fireEvent.click(screen.getByText('管理快捷键…'))
    expect(screen.getByText('项目列表')).toBeInTheDocument()
    expect(screen.getByText('浅色主题')).toBeInTheDocument()
  })

  test('无可见命令时空态', () => {
    useCommandRegistryStore.getState().clear()
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    fireEvent.click(screen.getByText('管理快捷键…'))
    expect(screen.getByText('当前没有可见命令')).toBeInTheDocument()
  })

  test('显示默认快捷键', () => {
    const cmd: RegisteredCommand = {
      id: 'ctx.demo',
      label: '示例命令',
      icon: Sun,
      group: 'contextual',
      effect: 'navigate',
      shortcut: 'Ctrl+Shift+D',
      execute: () => {},
    }
    useCommandRegistryStore.getState().addCommands([cmd])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    fireEvent.click(screen.getByText('管理快捷键…'))
    expect(screen.getByText('Ctrl+Shift+D')).toBeInTheDocument()
  })

  test('设置后显示自定义快捷键', () => {
    shortcutOverrideStore.set('theme.dark', 'ctrl+alt+d')
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    fireEvent.click(screen.getByText('管理快捷键…'))
    expect(screen.getByText('ctrl+alt+d')).toBeInTheDocument()
  })

  test('重置全部清空所有', () => {
    shortcutOverrideStore.set('theme.dark', 'ctrl+alt+d')
    shortcutOverrideStore.set('nav.dashboard', 'ctrl+shift+d')
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    fireEvent.click(screen.getByText('管理快捷键…'))
    fireEvent.click(screen.getByText('重置全部'))
    expect(shortcutOverrideStore.getAll().size).toBe(0)
  })

  test('无自定义快捷键时不显示重置', () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    fireEvent.click(screen.getByText('管理快捷键…'))
    expect(screen.queryByText('重置全部')).not.toBeInTheDocument()
  })

  test('返回命令面板按钮工作', () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    fireEvent.click(screen.getByText('管理快捷键…'))
    fireEvent.click(screen.getByText('返回命令面板'))
    expect(screen.getByText('管理快捷键…')).toBeInTheDocument()
  })
})
