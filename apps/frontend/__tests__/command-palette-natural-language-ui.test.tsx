/**
 * CommandPalette 自然语言候选 UI 测试（spec「智能建议分组 / 写意图审查 / 搜索建议回归 / feature-off」）。
 *
 * 覆盖：
 * - 智能建议分组展示候选、原因/预览摘要、blocked 说明与 requiresReview 标记（4.1/4.2）；
 * - 候选执行复用 runCommand：navigate / ui-setting / open-form 只做既有安全动作（4.3/4.4）；
 * - 高级搜索入口与最多 5 条建议行为不回退（4.5/4.6）；
 * - feature-off 后不展示智能建议，旧命令仍可用（5.1/5.2）。
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { Plus } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { useRegisterCommands } from '@/lib/command-registry/use-register-commands'
import { buildNavigationCommands } from '@/lib/command-registry/built-in/navigation'
import { buildThemeCommands } from '@/lib/command-registry/built-in/theme'
import { buildDensityCommands } from '@/lib/command-registry/built-in/density'
import { CommandPaletteProvider, useCommandPalette } from '@/components/layout/CommandPalette'
import { setNaturalLanguageCommandsEnabled } from '@/lib/command-palette-natural-language'
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
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme }),
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

// —— useSearchSuggestions mock（mutable data） —— //
let mockSuggestions: Array<{
  entityType: string
  entityId: number
  title: string
  target: string
}> = []
vi.mock('@/hooks/use-search', () => ({
  useSearchSuggestions: () => ({ data: { data: mockSuggestions }, isLoading: false }),
}))

const ctxNewTask: RegisteredCommand = {
  id: 'ctx.project.new-task',
  label: '新建任务',
  keywords: ['任务', '新建', 'create', 'task'],
  icon: Plus,
  group: 'contextual',
  effect: 'open-form',
  requiresPermission: ['task:create'],
  when: (c) => c.pathname.startsWith('/projects/'),
  execute: () => {
    // 与 ProjectContextCommands 一致：只导航到预填表单入口，不直接创建记录。
    routerPush('/projects/1/list?newTask=1')
  },
}

function ContextCommands({ commands }: { commands: RegisteredCommand[] }) {
  useRegisterCommands(commands, [commands])
  return null
}

function PaletteOpener() {
  const { setOpen } = useCommandPalette()
  React.useEffect(() => {
    setOpen(true)
  }, [setOpen])
  return null
}

function renderPalette(extra?: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CommandPaletteProvider>
        {extra}
        <PaletteOpener />
      </CommandPaletteProvider>
    </QueryClientProvider>,
  )
}

async function typeSearch(value: string) {
  const input = screen.getByPlaceholderText('输入命令或搜索页面…')
  await act(async () => {
    fireEvent.change(input, { target: { value } })
  })
}

async function clickItem(text: string, container?: HTMLElement) {
  const scope = container ? within(container) : screen
  const node = scope.getByText(text)
  await act(async () => {
    fireEvent.click(node)
    // runCommand 用 setTimeout(0) 延后 execute；等待宏任务落地。
    await new Promise((r) => setTimeout(r, 10))
  })
}

function nlGroup(): HTMLElement {
  const heading = screen.getByText('智能建议')
  return (heading.closest('[cmdk-group]') ?? heading.parentElement) as HTMLElement
}

beforeEach(() => {
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
  useCommandRegistryStore.getState().clear()
  mockPathname = '/dashboard'
  mockParams = {}
  grantedPermissions = []
  mockSuggestions = []
  routerPush.mockClear()
  setTheme.mockClear()
  setNaturalLanguageCommandsEnabled(true)
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

describe('CommandPalette - 智能建议分组', () => {
  test('自然语言输入生成候选并展示原因与预览摘要', async () => {
    grantedPermissions = ['project:view']
    renderPalette()
    await typeSearch('打开项目列表')
    const group = nlGroup()
    expect(within(group).getByText('项目列表')).toBeInTheDocument()
    // 原因 + 预览摘要
    expect(within(group).getByText(/命中「项目列表」/)).toBeInTheDocument()
    expect(within(group).getByText(/跳转到「项目列表」/)).toBeInTheDocument()
  })

  test('智能建议分组插在「快捷操作」之后、「跳转页面」之前', async () => {
    mockPathname = '/projects/1/kanban'
    mockParams = { id: '1' }
    grantedPermissions = ['task:create', 'project:view']
    renderPalette(<ContextCommands commands={[ctxNewTask]} />)
    await typeSearch('新建任务')
    const headings = screen.getAllByText(/快捷操作|智能建议|跳转页面/)
    const texts = headings.map((h) => h.textContent)
    expect(texts.indexOf('快捷操作')).toBeLessThan(texts.indexOf('智能建议'))
    expect(texts.indexOf('智能建议')).toBeLessThan(texts.indexOf('跳转页面'))
  })

  test('写意图候选展示 requiresReview 标记', async () => {
    mockPathname = '/projects/1/kanban'
    mockParams = { id: '1' }
    grantedPermissions = ['task:create']
    renderPalette(<ContextCommands commands={[ctxNewTask]} />)
    await typeSearch('给这个项目新建任务')
    expect(within(nlGroup()).getByText('需人工确认')).toBeInTheDocument()
  })

  test('写意图无承接命令时展示 blocked 说明，不可执行', async () => {
    // 无 task:create 权限 → ctx.project.new-task 被面板过滤，解析器无可承接命令。
    grantedPermissions = []
    renderPalette(<ContextCommands commands={[ctxNewTask]} />)
    await typeSearch('删除这个任务')
    const group = nlGroup()
    expect(within(group).getByText('无法直接执行该操作')).toBeInTheDocument()
    expect(within(group).getByText('不可直接执行')).toBeInTheDocument()
    // 无权限命令不得出现在智能建议中。
    expect(within(group).queryByText('新建任务')).not.toBeInTheDocument()
  })
})

describe('CommandPalette - 候选执行复用 runCommand', () => {
  test('navigate 候选：点击后走既有导航命令', async () => {
    grantedPermissions = ['project:view']
    renderPalette()
    await typeSearch('打开项目列表')
    await clickItem('项目列表', nlGroup())
    expect(routerPush).toHaveBeenCalledWith('/projects')
  })

  test('ui-setting 候选：点击后走 settings bridge 切换主题', async () => {
    renderPalette()
    await typeSearch('切换到深色主题')
    await clickItem('深色主题', nlGroup())
    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  test('open-form 候选：只导航到预填表单入口，不直接写库', async () => {
    mockPathname = '/projects/1/kanban'
    mockParams = { id: '1' }
    grantedPermissions = ['task:create']
    renderPalette(<ContextCommands commands={[ctxNewTask]} />)
    await typeSearch('给这个项目新建任务')
    await clickItem('新建任务', nlGroup())
    // 唯一的副作用是跳转到带预填参数的表单路由。
    expect(routerPush).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith('/projects/1/list?newTask=1')
  })
})

describe('CommandPalette - 既有搜索建议回归', () => {
  test('输入 ≥2 字符时高级搜索入口仍出现，建议最多 5 条且只安全导航', async () => {
    mockSuggestions = Array.from({ length: 7 }, (_, i) => ({
      entityType: 'task',
      entityId: i + 1,
      title: `示例任务${i + 1}`,
      target: `/projects/1/tasks/${i + 1}`,
    }))
    renderPalette()
    await typeSearch('示例')
    // 高级搜索入口
    expect(screen.getByText('搜索 "示例"')).toBeInTheDocument()
    // 最多 5 条建议
    expect(screen.getByText('示例任务5')).toBeInTheDocument()
    expect(screen.queryByText('示例任务6')).not.toBeInTheDocument()
    // 建议只导航
    await clickItem('示例任务1')
    expect(routerPush).toHaveBeenCalledWith('/projects/1/tasks/1')
  })

  test('智能建议为空时高级搜索入口仍作为 fallback 可用', async () => {
    renderPalette()
    await typeSearch('zzzz')
    expect(screen.queryByText('智能建议')).not.toBeInTheDocument()
    await clickItem('搜索 "zzzz"')
    expect(routerPush).toHaveBeenCalledWith('/search?q=' + encodeURIComponent('zzzz'))
  })
})

describe('CommandPalette - feature-off 回退', () => {
  test('关闭自然语言候选后不展示智能建议，旧命令仍可用', async () => {
    setNaturalLanguageCommandsEnabled(false)
    renderPalette()
    await typeSearch('打开项目列表')
    expect(screen.queryByText('智能建议')).not.toBeInTheDocument()
    // 旧命令行为不变：输入命令名可命中并执行。
    await typeSearch('深色主题')
    await clickItem('深色主题')
    expect(setTheme).toHaveBeenCalledWith('dark')
  })
})
