import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { Plus } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { useRegisterCommands } from '@/lib/command-registry/use-register-commands'
import { buildNavigationCommands } from '@/lib/command-registry/built-in/navigation'
import { buildThemeCommands } from '@/lib/command-registry/built-in/theme'
import { buildDensityCommands } from '@/lib/command-registry/built-in/density'
import {
  COMMAND_HISTORY_STORAGE_KEY,
  useCommandHistoryStore,
} from '@/lib/command-registry/history-store'
import {
  COMMAND_HISTORY_STORAGE_VERSION,
  type CommandUsageRecord,
} from '@/lib/command-registry/history'
import { CommandPaletteProvider, useCommandPalette } from '@/components/layout/CommandPalette'
import { accessTokenWith } from './_jwt-helper'
import type { RegisteredCommand } from '@/lib/command-registry/types'

// —— next/navigation mock（mutable pathname） —— //
let mockPathname = '/dashboard'
let mockParams: Record<string, string | string[]> = {}
const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  useParams: () => mockParams,
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
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

const NOW = Date.now()

beforeEach(() => {
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
  window.localStorage.clear()
  useCommandHistoryStore.getState().reset()
  useCommandRegistryStore.getState().clear()
  useUiStore.setState({ density: 'comfortable' })
  mockPathname = '/dashboard'
  mockParams = {}
  mockTheme = 'light'
  grantedPermissions = ['project:view', 'task:create']
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
  useCommandRegistryStore
    .getState()
    .addCommands([...buildNavigationCommands(), ...buildThemeCommands(), ...buildDensityCommands()])
})

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function PaletteOpener() {
  const { setOpen } = useCommandPalette()
  React.useEffect(() => {
    setOpen(true)
  }, [setOpen])
  return null
}

function ContextCommands({ commands }: { commands: RegisteredCommand[] }) {
  useRegisterCommands(commands, [commands])
  return null
}

/** 直接以确定性时间戳写入历史（绕过 Date.now()，保证评分可预测）。 */
function seedHistory(records: Array<Partial<CommandUsageRecord> & { id: string }>) {
  const map: Record<string, CommandUsageRecord> = {}
  for (const r of records) {
    map[r.id] = { count: 1, firstUsedAt: NOW - 60_000, lastUsedAt: NOW - 60_000, ...r }
  }
  useCommandHistoryStore.setState({
    history: { version: COMMAND_HISTORY_STORAGE_VERSION, records: map },
  })
}

function historyIds(): string[] {
  return Object.keys(useCommandHistoryStore.getState().history.records)
}

function promotedGroup(): HTMLElement | null {
  const heading = screen.queryByText('最近使用')
  return heading ? (heading.closest('[cmdk-group]') as HTMLElement) : null
}

async function clickItem(text: string) {
  await act(async () => {
    fireEvent.click(screen.getByText(text))
    await new Promise((r) => setTimeout(r, 10))
  })
}

describe('CommandPalette - 本地 MRU/frecency 记录', () => {
  test('选中导航命令：记录历史并保留既有跳转行为', async () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    await clickItem('项目列表')
    expect(routerPush).toHaveBeenCalledWith('/projects')
    const rec = useCommandHistoryStore.getState().history.records['nav./projects']
    expect(rec).toBeDefined()
    expect(rec!.count).toBe(1)
    expect(rec!.firstUsedAt).toBeGreaterThan(0)
    expect(rec!.lastUsedAt).toBeGreaterThanOrEqual(rec!.firstUsedAt)
  })

  test('选中主题命令：记录历史并保留 setTheme 行为', async () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    await clickItem('深色主题')
    expect(setTheme).toHaveBeenCalledWith('dark')
    expect(useCommandHistoryStore.getState().history.records['theme.dark']).toBeDefined()
  })

  test('选中密度命令：记录历史并保留密度切换行为', async () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    await clickItem('紧凑密度')
    expect(useUiStore.getState().density).toBe('compact')
    expect(useCommandHistoryStore.getState().history.records['density.compact']).toBeDefined()
  })

  test('选中上下文命令：记录历史并执行原 execute', async () => {
    const execute = vi.fn()
    const ctxCmd: RegisteredCommand = {
      id: 'ctx.project.new-task',
      label: '新建任务',
      icon: Plus,
      group: 'contextual',
      effect: 'open-form',
      execute,
    }
    renderWithProviders(
      <CommandPaletteProvider>
        <ContextCommands commands={[ctxCmd]} />
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    await clickItem('新建任务')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(useCommandHistoryStore.getState().history.records['ctx.project.new-task']).toBeDefined()
  })

  test('再次选中同一命令：count 累加', async () => {
    seedHistory([{ id: 'nav./projects', count: 2 }])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    await clickItem('项目列表')
    expect(useCommandHistoryStore.getState().history.records['nav./projects']!.count).toBe(3)
  })

  test('高级搜索伪命令不记录历史，搜索关键词不落盘', async () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    const input = screen.getByPlaceholderText('输入命令或搜索页面…')
    await act(async () => {
      fireEvent.change(input, { target: { value: '项目' } })
    })
    await clickItem('搜索 "项目"')
    expect(routerPush).toHaveBeenCalledWith('/search?q=' + encodeURIComponent('项目'))
    // search.advanced 不在注册表 → 不记录；本地历史保持为空
    expect(historyIds()).toEqual([])
    const persisted = window.localStorage.getItem(COMMAND_HISTORY_STORAGE_KEY) ?? ''
    expect(persisted).not.toContain('项目')
  })
})

describe('CommandPalette - 写操作边界回归', () => {
  test('被推广的 open-form 命令仍只打开表单，不获得直接写行为', async () => {
    const execute = vi.fn()
    const openFormCmd: RegisteredCommand = {
      id: 'ctx.form',
      label: '打开表单',
      icon: Plus,
      group: 'contextual',
      effect: 'open-form',
      execute,
    }
    useCommandRegistryStore.getState().addCommands([openFormCmd])
    seedHistory([{ id: 'ctx.form' }])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    // 命令出现在「最近使用」推广区
    expect(promotedGroup()).not.toBeNull()
    await clickItem('打开表单')
    // 只调用注册时声明的 execute（打开表单），无路由写入、无 API 写入
    expect(execute).toHaveBeenCalledTimes(1)
    expect(routerPush).not.toHaveBeenCalled()
    // 命令定义未被历史记录改变
    expect(useCommandRegistryStore.getState().commands.get('ctx.form')!.effect).toBe('open-form')
  })

  test('被推广的 open-confirm 命令仍只打开确认界面，不获得直接写行为', async () => {
    const execute = vi.fn()
    const openConfirmCmd: RegisteredCommand = {
      id: 'ctx.confirm',
      label: '打开确认',
      icon: Plus,
      group: 'contextual',
      effect: 'open-confirm',
      execute,
    }
    useCommandRegistryStore.getState().addCommands([openConfirmCmd])
    seedHistory([{ id: 'ctx.confirm' }])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    await clickItem('打开确认')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(routerPush).not.toHaveBeenCalled()
    expect(useCommandRegistryStore.getState().commands.get('ctx.confirm')!.effect).toBe(
      'open-confirm',
    )
  })
})

describe('CommandPalette - 最近使用推广区', () => {
  test('有历史时渲染最近使用，且命令从原分组去重（仅出现一次）', () => {
    seedHistory([{ id: 'nav./projects', count: 2 }])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.getByText('最近使用')).toBeInTheDocument()
    // 去重：整个面板中「项目列表」只出现一次（在推广区，不在原「跳转页面」分组）
    expect(screen.getAllByText('项目列表')).toHaveLength(1)
    expect(within(promotedGroup()!).getByText('项目列表')).toBeInTheDocument()
  })

  test('无历史时不渲染最近使用，保持既有分组展示', () => {
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.queryByText('最近使用')).not.toBeInTheDocument()
    expect(screen.getByText('项目列表')).toBeInTheDocument()
    expect(screen.getByText('跳转页面')).toBeInTheDocument()
  })

  test('推广区按 frecency 排序：高频旧命令排在低频新命令前', () => {
    seedHistory([
      { id: 'theme.dark', count: 1, lastUsedAt: NOW },
      { id: 'nav./projects', count: 5, lastUsedAt: NOW - 60_000 },
    ])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    const items = promotedGroup()!.querySelectorAll('[cmdk-item]')
    expect(items.length).toBe(2)
    expect(items[0]!.textContent).toContain('项目列表')
    expect(items[1]!.textContent).toContain('深色主题')
  })

  test('推广区保留主题选中态指示（Check 图标）', () => {
    mockTheme = 'dark'
    seedHistory([{ id: 'theme.dark', count: 3 }])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    const darkRow = within(promotedGroup()!).getByText('深色主题').closest('[cmdk-item]')!
    // 图标 + Check = 至少两个 svg
    expect(darkRow.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2)
    // 未选中的浅色主题（留在原分组）只有图标
    const lightRow = screen.getByText('浅色主题').closest('[cmdk-item]')!
    expect(lightRow.querySelectorAll('svg').length).toBe(1)
  })

  test('搜索过滤时推广区命令仍可命中，未命中命令被 cmdk 隐藏', async () => {
    seedHistory([
      { id: 'nav./projects', count: 5 },
      { id: 'theme.dark', count: 4 },
    ])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    const input = screen.getByPlaceholderText('输入命令或搜索页面…')
    await act(async () => {
      fireEvent.change(input, { target: { value: '项目' } })
    })
    // 命中的推广项保持可见
    const projectsRow = screen.getByText('项目列表').closest('[cmdk-item]')!
    expect(projectsRow).not.toHaveAttribute('hidden')
    // 未命中的深色主题被 cmdk 过滤（不再渲染）
    expect(screen.queryByText('深色主题')).not.toBeInTheDocument()
  })
})

describe('CommandPalette - 历史不得绕过权限与上下文', () => {
  test('权限被移除后，历史命令不出现在推广区或原分组', () => {
    grantedPermissions = []
    const guarded: RegisteredCommand = {
      id: 'ctx.guarded',
      label: '危险操作',
      icon: Plus,
      group: 'contextual',
      effect: 'open-form',
      requiresPermission: ['admin:all'],
      execute: () => {},
    }
    useCommandRegistryStore.getState().addCommands([guarded])
    seedHistory([{ id: 'ctx.guarded', count: 99 }])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.queryByText('危险操作')).not.toBeInTheDocument()
    expect(screen.queryByText('最近使用')).not.toBeInTheDocument()
  })

  test('上下文不匹配时，历史命令不因本地历史而出现', () => {
    mockPathname = '/dashboard'
    const ctxCmd: RegisteredCommand = {
      id: 'ctx.project.only',
      label: '项目内操作',
      icon: Plus,
      group: 'contextual',
      effect: 'open-form',
      when: (ctx) => ctx.pathname.startsWith('/projects/'),
      execute: () => {},
    }
    useCommandRegistryStore.getState().addCommands([ctxCmd])
    seedHistory([{ id: 'ctx.project.only', count: 99 }])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.queryByText('项目内操作')).not.toBeInTheDocument()
    expect(screen.queryByText('最近使用')).not.toBeInTheDocument()
  })

  test('注册表已移除的命令历史被忽略，面板正常打开', () => {
    seedHistory([{ id: 'nav./gone', count: 99 }])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.queryByText('最近使用')).not.toBeInTheDocument()
    expect(screen.getByText('项目列表')).toBeInTheDocument()
  })

  test('损坏的本地历史不阻断面板打开', async () => {
    window.localStorage.setItem(COMMAND_HISTORY_STORAGE_KEY, 'corrupted{{{')
    await act(async () => {
      await useCommandHistoryStore.persist.rehydrate()
    })
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.getByText('项目列表')).toBeInTheDocument()
    expect(screen.queryByText('最近使用')).not.toBeInTheDocument()
  })
})
