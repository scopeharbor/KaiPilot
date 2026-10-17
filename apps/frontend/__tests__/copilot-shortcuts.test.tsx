import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useCopilotStore } from '@/stores/copilot-store'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import {
  buildCopilotCommands,
  copilotToggleShortcut,
} from '@/lib/command-registry/built-in/copilot'
import { CommandPaletteProvider } from '@/components/layout/CommandPalette'
import { useCopilotToggleShortcutDisplay } from '@/lib/copilot/panel-shortcut'
import { shortcutOverrideStore } from '@/lib/command-registry/shortcut-store'
import {
  detectShortcutConflict,
  parseShortcutInput,
  resolveEffectiveBindings,
} from '@/lib/command-registry/shortcut'
import { accessTokenWith } from './_jwt-helper'
import type { RegisteredCommand } from '@/lib/command-registry/types'

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ canAny: () => true, can: () => true, canAll: () => true }),
}))
vi.mock('@/hooks/use-search', () => ({
  useSearchSuggestions: () => ({ data: { data: [] }, isLoading: false }),
}))

function resetStores() {
  act(() => {
    useCopilotStore.setState({
      open: false,
      form: 'drawer',
      draft: '',
      streaming: false,
      streamPhase: 'idle',
      messages: [],
      demoActions: [],
      demoAssumptions: [],
      streamError: null,
    })
    shortcutOverrideStore.clearAll()
    useCommandRegistryStore.getState().clear()
    localStorage.clear()
    sessionStorage.clear()
  })
}

beforeEach(() => {
  resetStores()
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
})

afterEach(() => {
  resetStores()
})

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** 注册 Copilot 开关命令（同应用启动路径：built-in 注册）。 */
function registerCopilotCommand() {
  act(() => {
    useCommandRegistryStore.getState().addCommands(buildCopilotCommands())
  })
}

describe('Copilot 开关快捷键（v3-copilot-sidebar-shell 任务 2.3/2.7/2.8）', () => {
  test('命令以 Cmd/Ctrl + / 注册且可被冲突检测看到（任务 2.8）', () => {
    registerCopilotCommand()
    const cmd = useCommandRegistryStore.getState().commands.get('copilot.toggle')
    expect(cmd).toBeDefined()
    const chord = parseShortcutInput(copilotToggleShortcut())
    expect(chord).toBe('ctrl+/')
    // 参与冲突检测：其他命令占住该和弦时，重绑请求会被拒绝
    const other: RegisteredCommand = {
      id: 'ctx.demo',
      label: '示例命令',
      icon: cmd!.icon,
      group: 'contextual',
      effect: 'navigate',
      execute: () => {},
    }
    const bindings = resolveEffectiveBindings([cmd!, other], shortcutOverrideStore.getAll())
    const conflict = detectShortcutConflict('ctrl+/', bindings, [cmd!, other])
    expect(conflict.conflicted).toBe(true)
    expect(conflict.conflictingCommandId).toBe('copilot.toggle')
  })

  test('按下注册快捷键可开关面板（任务 2.7）', async () => {
    registerCopilotCommand()
    function PanelProbe() {
      const open = useCopilotStore((s) => s.open)
      return <div data-testid="panel-open">{String(open)}</div>
    }
    renderWithProviders(
      <CommandPaletteProvider>
        <PanelProbe />
      </CommandPaletteProvider>,
    )
    expect(screen.getByTestId('panel-open').textContent).toBe('false')
    // runCommand 经 setTimeout(0) 执行命令，需冲刷宏任务
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId('panel-open').textContent).toBe('true')
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId('panel-open').textContent).toBe('false')
  })

  test('重绑后显示文本同步更新（任务 2.7）', () => {
    registerCopilotCommand()
    function ShortcutProbe() {
      const display = useCopilotToggleShortcutDisplay()
      return <div data-testid="display">{display}</div>
    }
    renderWithProviders(<ShortcutProbe />)
    // jsdom 非 mac → 默认 'Ctrl+/'
    expect(screen.getByTestId('display').textContent).toBe('Ctrl+/')
    // 用户经既有自定义路径重绑
    act(() => {
      shortcutOverrideStore.set('copilot.toggle', 'ctrl+alt+c')
    })
    expect(screen.getByTestId('display').textContent).toBe('ctrl+alt+c')
    // 清除覆盖后回到注册表默认
    act(() => {
      shortcutOverrideStore.remove('copilot.toggle')
    })
    expect(screen.getByTestId('display').textContent).toBe('Ctrl+/')
  })

  test('未注册命令时不显示任何和弦（不硬编码）', () => {
    function ShortcutProbe() {
      const display = useCopilotToggleShortcutDisplay()
      return <div data-testid="display">{display}</div>
    }
    renderWithProviders(<ShortcutProbe />)
    expect(screen.getByTestId('display').textContent).toBe('')
  })
})
