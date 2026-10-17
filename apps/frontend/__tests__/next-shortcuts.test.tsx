import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useCopilotStore } from '@/stores/copilot-store'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { buildCopilotCommands } from '@/lib/command-registry/built-in/copilot'
import { CommandPaletteProvider } from '@/components/layout/CommandPalette'
import { shortcutOverrideStore } from '@/lib/command-registry/shortcut-store'
import { accessTokenWith } from './_jwt-helper'
import type { CommandContext } from '@/lib/command-registry/types'
import {
  nextSpaceMapShortcutLabel,
  nextSummonShortcutLabel,
  useNextShortcuts,
} from '@/hooks/use-next-shortcuts'

const { navMocks } = vi.hoisted(() => ({ navMocks: { pathname: '/next' } }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => navMocks.pathname,
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
  navMocks.pathname = '/next'
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

/** 派发可取消的 keydown 事件并返回事件对象（默认 preventDefault 断言用）。 */
function fireKey(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
  target.dispatchEvent(event)
  return event
}

function ShortcutProbe({
  onToggleAiSummon = () => {},
  onOpenSpaceMap = () => {},
  enabled,
}: {
  onToggleAiSummon?: () => void
  onOpenSpaceMap?: () => void
  enabled?: boolean
}) {
  useNextShortcuts({ onToggleAiSummon, onOpenSpaceMap, enabled })
  return (
    <div>
      <input data-testid="probe-input" />
      <textarea data-testid="probe-textarea" />
      <span data-testid="probe-mounted">mounted</span>
    </div>
  )
}

/** 与 CommandPalette 面板一致的 when 过滤谓词（仅验证守卫语义，非实现复制）。 */
function toVisibleCommands(ctx: CommandContext) {
  return buildCopilotCommands().filter((cmd) => !cmd.when || cmd.when(ctx))
}

describe('hooks/use-next-shortcuts（v3-ui-next-shell-space-map D5 第二层）', () => {
  test('Ctrl+/ 触发 AI 唤起回调，Ctrl+M 触发空间地图回调，且事件被精确拦截', () => {
    const onToggleAiSummon = vi.fn()
    const onOpenSpaceMap = vi.fn()
    render(<ShortcutProbe onToggleAiSummon={onToggleAiSummon} onOpenSpaceMap={onOpenSpaceMap} />)

    const aiEvent = fireKey(window, { key: '/', ctrlKey: true })
    expect(onToggleAiSummon).toHaveBeenCalledTimes(1)
    expect(aiEvent.defaultPrevented).toBe(true)

    const mapEvent = fireKey(window, { key: 'm', ctrlKey: true })
    expect(onOpenSpaceMap).toHaveBeenCalledTimes(1)
    expect(mapEvent.defaultPrevented).toBe(true)
  })

  test('Mac 口径：Meta（Cmd）+/ 与 Meta+M 同样命中', () => {
    const onToggleAiSummon = vi.fn()
    const onOpenSpaceMap = vi.fn()
    render(<ShortcutProbe onToggleAiSummon={onToggleAiSummon} onOpenSpaceMap={onOpenSpaceMap} />)

    fireKey(window, { key: '/', metaKey: true })
    expect(onToggleAiSummon).toHaveBeenCalledTimes(1)

    fireKey(window, { key: 'm', metaKey: true })
    expect(onOpenSpaceMap).toHaveBeenCalledTimes(1)
  })

  test('非目标快捷键不触发：裸 / 与 m、Ctrl+K、Ctrl+Shift+/ 均忽略', () => {
    const onToggleAiSummon = vi.fn()
    const onOpenSpaceMap = vi.fn()
    render(<ShortcutProbe onToggleAiSummon={onToggleAiSummon} onOpenSpaceMap={onOpenSpaceMap} />)

    fireKey(window, { key: '/' })
    fireKey(window, { key: 'm' })
    fireKey(window, { key: 'k', ctrlKey: true })
    fireKey(window, { key: '/', ctrlKey: true, shiftKey: true })
    expect(onToggleAiSummon).not.toHaveBeenCalled()
    expect(onOpenSpaceMap).not.toHaveBeenCalled()
  })

  test('可编辑目标抑制：input / textarea 内按下快捷键不触发，离开后恢复', () => {
    const onToggleAiSummon = vi.fn()
    const onOpenSpaceMap = vi.fn()
    render(<ShortcutProbe onToggleAiSummon={onToggleAiSummon} onOpenSpaceMap={onOpenSpaceMap} />)

    const input = screen.getByTestId('probe-input')
    input.focus()
    fireKey(input, { key: '/', ctrlKey: true })
    fireKey(input, { key: 'm', ctrlKey: true })
    expect(onToggleAiSummon).not.toHaveBeenCalled()
    expect(onOpenSpaceMap).not.toHaveBeenCalled()

    const textarea = screen.getByTestId('probe-textarea')
    textarea.focus()
    fireKey(textarea, { key: '/', ctrlKey: true })
    expect(onToggleAiSummon).not.toHaveBeenCalled()

    // 焦点离开可编辑目标后（事件目标为 window）恢复响应
    fireKey(window, { key: '/', ctrlKey: true })
    expect(onToggleAiSummon).toHaveBeenCalledTimes(1)
  })

  test('enabled=false 时完全停用监听', () => {
    const onToggleAiSummon = vi.fn()
    const onOpenSpaceMap = vi.fn()
    render(
      <ShortcutProbe
        enabled={false}
        onToggleAiSummon={onToggleAiSummon}
        onOpenSpaceMap={onOpenSpaceMap}
      />,
    )
    fireKey(window, { key: '/', ctrlKey: true })
    fireKey(window, { key: 'm', ctrlKey: true })
    expect(onToggleAiSummon).not.toHaveBeenCalled()
    expect(onOpenSpaceMap).not.toHaveBeenCalled()
  })

  test('卸载后监听器移除，不再响应', () => {
    const onToggleAiSummon = vi.fn()
    const { unmount } = render(<ShortcutProbe onToggleAiSummon={onToggleAiSummon} />)
    unmount()
    fireKey(window, { key: '/', ctrlKey: true })
    expect(onToggleAiSummon).not.toHaveBeenCalled()
  })

  test('快捷键展示文案平台化（jsdom 非 Mac → Ctrl 前缀）', () => {
    expect(nextSummonShortcutLabel()).toBe('Ctrl+/')
    expect(nextSpaceMapShortcutLabel()).toBe('Ctrl+M')
  })
})

describe('旧 Copilot 命令注册表守卫（v3-ui-next-shell-space-map D5 第一层）', () => {
  const makeCtx = (pathname: string): CommandContext => ({
    pathname,
    params: {},
    searchParams: new URLSearchParams(),
  })

  test('copilot.toggle 的 when 守卫：/next 及子路径下不可见，旧轨路由可见', () => {
    const copilot = buildCopilotCommands().find((c) => c.id === 'copilot.toggle')
    expect(copilot).toBeDefined()
    expect(copilot!.when?.(makeCtx('/next'))).toBe(false)
    expect(copilot!.when?.(makeCtx('/next/create'))).toBe(false)
    expect(copilot!.when?.(makeCtx('/next/charts'))).toBe(false)
    expect(copilot!.when?.(makeCtx('/dashboard'))).toBe(true)
    expect(copilot!.when?.(makeCtx('/'))).toBe(true)
  })

  test('按面板过滤谓词模拟：新轨下 copilot.toggle 从可见命令中被剔除', () => {
    expect(toVisibleCommands(makeCtx('/next')).map((c) => c.id)).not.toContain('copilot.toggle')
    expect(toVisibleCommands(makeCtx('/dashboard')).map((c) => c.id)).toContain('copilot.toggle')
  })

  test('E2E：位于 /next 时按下 Ctrl+/ 不触发旧 Copilot 面板（保持关闭）', async () => {
    navMocks.pathname = '/next'
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
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId('panel-open').textContent).toBe('false')
  })

  test('E2E：位于 /dashboard 时 Ctrl+/ 仍正常开关旧 Copilot 面板（守卫不破坏旧轨）', async () => {
    navMocks.pathname = '/dashboard'
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
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId('panel-open').textContent).toBe('true')
  })
})
