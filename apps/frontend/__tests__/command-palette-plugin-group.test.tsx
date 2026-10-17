/**
 * command-palette-plugin-group.test.tsx —— 「插件能力」分组的面板级行为测试
 * （v3-command-palette-plugin-action-pack 任务 3.5 / 3.6）。
 *
 * 覆盖：
 * - 分组排序：「插件能力」位于「密度」之后、「更多」之前
 * - 权限隐藏：requiresPermission 未命中时整条命令不可见
 * - 执行前 TOCTOU：owner 命令被移除后面板中即刻消失
 * - 写入只开 preview：执行仅派发宿主预览事件（零路由跳转、零业务写入）
 * - 核心命令故障隔离：单插件命令执行抛错不影响核心命令渲染与执行
 *
 * 纪律：全部内存态；零网络、零 provider、零业务写入。
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { Plus } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { buildNavigationCommands } from '@/lib/command-registry/built-in/navigation'
import { buildThemeCommands } from '@/lib/command-registry/built-in/theme'
import { buildDensityCommands } from '@/lib/command-registry/built-in/density'
import { CommandPaletteProvider, useCommandPalette } from '@/components/layout/CommandPalette'
import { adaptPluginCommand } from '@/lib/command-registry/plugin-command-adapter'
import type { PluginUiCommandAcceptedCommand } from '@aiproj/types'

// —— next/navigation mock —— //
let mockPathname = '/dashboard'
const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({}),
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

vi.mock('@/hooks/use-search', () => ({
  useSearchSuggestions: () => ({ data: { data: [] }, isLoading: false }),
}))

beforeEach(() => {
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
  useCommandRegistryStore.getState().clear()
  mockPathname = '/dashboard'
  grantedPermissions = ['project:view']
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

const PACK_ID = 'com.aiproj.official.command-action-pack'

function makeAccepted(
  overrides: Partial<PluginUiCommandAcceptedCommand> = {},
): PluginUiCommandAcceptedCommand {
  return {
    id: `ext.plugin.${PACK_ID}.discover-plugin-capabilities`,
    pluginId: PACK_ID,
    contributionKey: 'discover-plugin-capabilities',
    manifestDigest: 'sha256:pack-001',
    instanceRevision: '1',
    label: '浏览插件能力',
    keywords: ['插件', '发现'],
    iconKey: 'Search',
    actionKey: 'navigate',
    actionParams: { route: '/settings/integrations' },
    requiredPermissions: [],
    scopeKind: 'organization',
    ...overrides,
  }
}

/** 注册插件 owner 命令（走生产适配器）。 */
function seedPluginCommand(accepted: PluginUiCommandAcceptedCommand) {
  const cmd = adaptPluginCommand(accepted, { organizationId: 'org-1' })
  const result = useCommandRegistryStore
    .getState()
    .replaceOwnerCommands(accepted.pluginId, accepted.instanceRevision, accepted.manifestDigest, [
      cmd,
    ])
  if (!result.success) throw new Error(`seed failed: ${result.reason}`)
}

describe('插件能力分组（任务 3.6）', () => {
  test('分组排序：插件能力位于密度之后、更多之前', () => {
    seedPluginCommand(makeAccepted())
    // 注册一条自定义分组命令，保证「更多」分组出现
    useCommandRegistryStore.getState().addCommands([
      {
        id: 'ext.custom.tool',
        label: '自定义工具',
        icon: Plus,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
    ])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )

    const headings = Array.from(document.querySelectorAll('[cmdk-group-heading]')).map(
      (el) => el.textContent ?? '',
    )
    const densityIdx = headings.indexOf('密度')
    const pluginIdx = headings.indexOf('插件能力')
    const customIdx = headings.indexOf('更多')
    expect(pluginIdx).toBeGreaterThan(-1)
    expect(densityIdx).toBeGreaterThan(-1)
    expect(customIdx).toBeGreaterThan(-1)
    expect(pluginIdx).toBeGreaterThan(densityIdx)
    expect(pluginIdx).toBeLessThan(customIdx)

    // 命令出现在「插件能力」分组内，且带「插件」来源徽标
    const groups = Array.from(document.querySelectorAll('[cmdk-group]'))
    const pluginGroup = groups.find(
      (g) => g.querySelector('[cmdk-group-heading]')?.textContent === '插件能力',
    )
    expect(pluginGroup).toBeDefined()
    expect(within(pluginGroup as HTMLElement).getByText('浏览插件能力')).toBeInTheDocument()
    expect(within(pluginGroup as HTMLElement).getByText('插件')).toBeInTheDocument()
  })

  test('权限隐藏：requiresPermission 未命中的插件命令不可见，命中后出现', () => {
    seedPluginCommand(makeAccepted({ requiredPermissions: ['plugins:manage'] }))
    const { rerender } = renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.queryByText('浏览插件能力')).toBeNull()

    // 授予权限后可见
    grantedPermissions = ['plugins:manage']
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CommandPaletteProvider>
          <PaletteOpener />
        </CommandPaletteProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByText('浏览插件能力')).toBeInTheDocument()
  })

  test('执行前 TOCTOU：owner 命令移除后从面板消失', () => {
    seedPluginCommand(makeAccepted())
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(screen.getByText('浏览插件能力')).toBeInTheDocument()

    // 模拟 disable/uninstall 的原子撤销
    act(() => {
      useCommandRegistryStore.getState().removeOwnerCommands(PACK_ID)
    })

    expect(screen.queryByText('浏览插件能力')).toBeNull()
    // 核心命令不受影响
    expect(screen.getByText('项目列表')).toBeInTheDocument()
  })

  test('写入只开 preview：点击后仅派发宿主预览事件，无路由跳转', () => {
    const dispatched: Array<CustomEvent> = []
    const listener = (e: Event) => dispatched.push(e as CustomEvent)
    window.addEventListener('aiproj:plugin-action-preview', listener)

    seedPluginCommand(
      makeAccepted({
        id: `ext.plugin.${PACK_ID}.open-sample-action-preview`,
        contributionKey: 'open-sample-action-preview',
        label: '预览插件建议操作',
        iconKey: 'Shield',
        actionKey: 'open-plugin-action-preview',
        actionParams: { actionRef: 'official/sample@1.0.0' },
      }),
    )
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )

    fireEvent.click(screen.getByText('预览插件建议操作'))

    // runCommand 用 setTimeout(0) 执行；断言后自行清理监听器
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          expect(dispatched).toHaveLength(1)
          expect(dispatched[0]!.detail).toMatchObject({
            actionRef: 'official/sample@1.0.0',
            pluginId: PACK_ID,
          })
          // 零路由跳转、零 location 写入
          expect(routerPush).not.toHaveBeenCalled()
          resolve()
        } catch (error) {
          reject(error as Error)
        } finally {
          window.removeEventListener('aiproj:plugin-action-preview', listener)
        }
      }, 10)
    })
  })

  test('核心命令故障隔离：单插件命令抛错不影响核心命令渲染与执行', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {
      throw new Error('boom')
    })
    seedPluginCommand(
      makeAccepted({
        id: `ext.plugin.${PACK_ID}.open-sample-action-preview`,
        contributionKey: 'open-sample-action-preview',
        label: '会出错的预览',
        iconKey: 'Shield',
        actionKey: 'open-plugin-action-preview',
        actionParams: { actionRef: 'official/boom@1.0.0' },
      }),
    )
    const first = renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )

    // 插件命令渲染正常；点击后 runCommand 关面板，execute 抛错被 adapter 捕获
    fireEvent.click(screen.getByText('会出错的预览'))
    await new Promise((r) => setTimeout(r, 10))
    first.unmount()
    expect(dispatchSpy).toHaveBeenCalled()

    // 重新打开面板：核心命令仍可正常渲染与执行（故障只影响出错命令本身）
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    fireEvent.click(screen.getByText('浅色主题'))
    await new Promise((r) => setTimeout(r, 10))
    expect(setTheme).toHaveBeenCalledWith('light')
    dispatchSpy.mockRestore()
  })
})
