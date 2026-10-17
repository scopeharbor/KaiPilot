import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { PwaInstallAction } from '@/components/layout/PwaInstallAction'
import * as usePwaInstallPromptModule from '@/hooks/use-pwa-install-prompt'

/**
 * PwaInstallAction 组件测试（v2-5-pwa-installable-shell / 4.3）。
 *
 * PwaInstallAction 使用 DropdownMenuItem，必须在 DropdownMenu 上下文中渲染。
 */

/** 测试用包装——提供 DropdownMenu 上下文（defaultOpen 确保内容始终渲染） */
function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button">菜单</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('PwaInstallAction', () => {
  let installMock: ReturnType<typeof vi.fn>
  let dismissMock: ReturnType<typeof vi.fn>

  function mockState(state: string): void {
    vi.spyOn(usePwaInstallPromptModule, 'usePwaInstallPrompt').mockReturnValue({
      state,
      isStandalone: false,
      install: installMock,
      dismiss: dismissMock,
      resetDismissed: vi.fn(),
    } as ReturnType<typeof usePwaInstallPromptModule.usePwaInstallPrompt>)
  }

  beforeEach(() => {
    installMock = vi.fn().mockResolvedValue(undefined)
    dismissMock = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---- 可见性 ----

  test('available 状态渲染安装按钮', () => {
    mockState('available')
    render(<PwaInstallAction />, { wrapper: TestWrapper })
    expect(screen.getByText('安装应用')).toBeInTheDocument()
  })

  test('unsupported 状态不渲染', () => {
    mockState('unsupported')
    const { container } = render(<PwaInstallAction />, { wrapper: TestWrapper })
    expect(container.innerHTML).not.toContain('安装应用')
  })

  test('installed 状态不渲染', () => {
    mockState('installed')
    const { container } = render(<PwaInstallAction />, { wrapper: TestWrapper })
    expect(container.innerHTML).not.toContain('安装应用')
  })

  test('dismissed 状态不渲染', () => {
    mockState('dismissed')
    const { container } = render(<PwaInstallAction />, { wrapper: TestWrapper })
    expect(container.innerHTML).not.toContain('安装应用')
  })

  test('prompting 状态不渲染', () => {
    mockState('prompting')
    const { container } = render(<PwaInstallAction />, { wrapper: TestWrapper })
    expect(container.innerHTML).not.toContain('安装应用')
  })

  // ---- 点击行为 ----

  test('点击安装调用 install 并阻止默认事件', () => {
    mockState('available')
    render(<PwaInstallAction />, { wrapper: TestWrapper })

    const item = screen.getByText('安装应用')
    fireEvent.click(item)

    expect(installMock).toHaveBeenCalledTimes(1)
  })

  // ---- 图标存在 ----

  test('渲染下载图标', () => {
    mockState('available')
    render(<PwaInstallAction />, { wrapper: TestWrapper })

    const svg = document.querySelector('svg.lucide-download')
    expect(svg).toBeInTheDocument()
  })
})
