/**
 * 新轨界面文字变体入口测试（简体 / 台灣繁體 / 香港繁體）。
 *
 * 新轨不做中英字典切换；语言入口 100% 沿用旧轨机制：
 * 复用 components/locale/text-variant-switcher + lib/locale/variant-store
 * （localStorage key `aiproj-text-variant` + <html lang>/data-text-variant 同步），
 * 整页 DOM 转换由根布局常驻的 VariantRuntime 承担（app/layout.tsx）。
 *
 * 本文件只断言「入口在新轨两个无旧轨 chrome 的表面存在且可用」：
 * 1. 新轨常驻顶栏（NextTopbar）操作区；
 * 2. 新轨登录页（NextLoginForm）右上角控制组。
 * 切换行为本身由 __tests__/locale/text-variant-switcher.test.tsx 覆盖。
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { NextTopbar } from '@/components/next/layout/NextTopbar'
import { NextLoginForm } from '@/components/next/auth/NextLoginForm'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { getVariant } from '@/lib/locale/variant-store'

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

function renderTopbar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <NextTopbar />
    </QueryClientProvider>,
  )
}

/** jsdom 无 PointerEvent：走键盘 ArrowDown 展开 Radix 下拉（与 locale 既有测试同款）。 */
function openSwitcherMenu(): void {
  fireEvent.keyDown(screen.getByRole('button', { name: '切换界面文字' }), { key: 'ArrowDown' })
}

beforeEach(() => {
  routerPush.mockClear()
  localStorage.clear()
  useNextTrackStore.getState().reset()
  useNextAiColleagueStore.setState({
    isOpen: false,
    messages: [],
    executionState: 'idle',
    pendingAction: null,
  })
  document.documentElement.removeAttribute('data-immersion')
  delete document.documentElement.dataset.textVariant
  document.documentElement.lang = 'zh-CN'
})

describe('新轨界面文字变体入口（沿用旧轨简繁切换）', () => {
  test('常驻顶栏操作区挂载变体切换按钮', () => {
    renderTopbar()
    const header = document.querySelector('[data-next-topbar]') as HTMLElement
    expect(header).toBeTruthy()
    expect(screen.getByTestId('text-variant-switcher-trigger')).toBeInTheDocument()
  })

  test('新轨登录页控制组挂载变体切换按钮', () => {
    render(<NextLoginForm />)
    const controls = document.querySelector('[data-login-controls]') as HTMLElement
    expect(controls).toBeTruthy()
    expect(screen.getByTestId('text-variant-switcher-trigger')).toBeInTheDocument()
  })

  test('顶栏切换到台灣繁體：写 localStorage + 同步 <html lang>/data-text-variant', () => {
    renderTopbar()
    openSwitcherMenu()
    act(() => {
      fireEvent.click(screen.getByText('台灣繁體'))
    })
    expect(getVariant()).toBe('tw')
    expect(localStorage.getItem('aiproj-text-variant')).toBe('tw')
    expect(document.documentElement.lang).toBe('zh-TW')
    expect(document.documentElement.dataset.textVariant).toBe('tw')
  })
})
