import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextOfflineFallback } from '@/components/next/offline/NextOfflineFallback'
import { useNextTrackStore } from '@/stores/next-track-store'

// ---------------------------------------------------------------------------
// jsdom 兼容环境配置与 Mock
// ---------------------------------------------------------------------------
function setupJsdom() {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventMock extends MouseEvent {}
    window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
  }
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
}

const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/offline',
}))

const fetchStub = vi.fn()
vi.stubGlobal('fetch', fetchStub)

describe('NextOfflineFallback 离线深空兜底展示组件 (W3 / task 3.1 & 3.2)', () => {
  beforeEach(() => {
    setupJsdom()
    fetchStub.mockClear()
    replaceMock.mockClear()
    useNextTrackStore.setState({ track: 'legacy', immersionTier: null, source: null })
    document.documentElement.removeAttribute('data-immersion')
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-immersion')
  })

  test('静态渲染结构：标题、说明、离线模式标识与 WifiOff 图标', () => {
    const { container } = render(<NextOfflineFallback />)

    expect(screen.getByText('当前处于离线状态')).toBeInTheDocument()
    expect(screen.getByText(/网络连接已断开，部分功能暂时不可用/)).toBeInTheDocument()
    expect(screen.getByText('开项 KaiPilot — 离线模式')).toBeInTheDocument()

    const icon = container.querySelector('svg.lucide-wifi-off')
    expect(icon).toBeInTheDocument()

    const main = container.querySelector('main[data-next-track][data-offline-fallback]')
    expect(main).toBeInTheDocument()

    // RL-15: 严格零 Canvas 画布节点
    expect(container.querySelector('canvas')).toBeNull()
  })

  test('双通道冷青与琥珀状态微标呈现', () => {
    render(<NextOfflineFallback />)

    const cyanBadge = screen.getByTestId('status-badge-cyan')
    expect(cyanBadge).toBeInTheDocument()
    expect(cyanBadge).toHaveAttribute('data-channel', 'cyan')
    expect(cyanBadge.textContent).toContain('离线外壳 · 活跃')

    const amberBadge = screen.getByTestId('status-badge-amber')
    expect(amberBadge).toBeInTheDocument()
    expect(amberBadge).toHaveAttribute('data-channel', 'amber')
    expect(amberBadge.textContent).toContain('链路状态 · 断开')

    const iconContainer = screen.getByTestId('offline-icon-container')
    expect(iconContainer).toBeInTheDocument()
    expect(iconContainer.className).toContain('border-[var(--nx-space-cyan)]/30')
  })

  test('暗黑仪器风发丝线边框与深空背景令牌映射', () => {
    render(<NextOfflineFallback />)

    const main = screen.getByRole('main')
    expect(main.className).toContain('bg-[var(--nx-space-bg)]')

    const card = screen.getByTestId('offline-card')
    expect(card).toBeInTheDocument()
    expect(card.className).toContain('border-[var(--nx-border-hairline)]')
    expect(card.className).toContain('bg-[var(--nx-workspace-surface)]')
  })

  test('精确档（precise）纯平降级：移除光晕层与阴影', () => {
    useNextTrackStore.setState({ track: 'legacy', immersionTier: 'precise', source: null })
    render(<NextOfflineFallback />)

    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('data-immersion', 'precise')
    expect(main.className).not.toContain('nx-space-atmosphere')

    const card = screen.getByTestId('offline-card')
    expect(card.className).not.toContain('shadow-2xl')
  })

  test('默认旧轨（legacy）偏好下，重试连接按钮链接至 /dashboard 并触发定向导航', () => {
    useNextTrackStore.setState({ track: 'legacy', immersionTier: null, source: null })
    render(<NextOfflineFallback />)

    const retryBtn = screen.getByTestId('retry-button')
    expect(retryBtn).toHaveAttribute('href', '/dashboard')

    fireEvent.click(retryBtn)
    expect(replaceMock).toHaveBeenCalledWith('/dashboard')
  })

  test('新轨（next）偏好下，重试连接按钮智能导流至 /next 并触发定向导航', () => {
    useNextTrackStore.setState({ track: 'next', immersionTier: null, source: null })
    render(<NextOfflineFallback />)

    const retryBtn = screen.getByTestId('retry-button')
    expect(retryBtn).toHaveAttribute('href', '/next')

    fireEvent.click(retryBtn)
    expect(replaceMock).toHaveBeenCalledWith('/next')
  })

  test('外部注入 onRetry 回调时优先执行该回调', () => {
    const customRetry = vi.fn()
    useNextTrackStore.setState({ track: 'next', immersionTier: null, source: null })
    render(<NextOfflineFallback onRetry={customRetry} />)

    const retryBtn = screen.getByTestId('retry-button')
    fireEvent.click(retryBtn)

    expect(customRetry).toHaveBeenCalledWith('/next')
    expect(replaceMock).not.toHaveBeenCalled()
  })

  test('断网场景（navigator.onLine === false）下点击重试展示轻度警告且不触发跳转与网络请求', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

    render(<NextOfflineFallback />)

    const retryBtn = screen.getByTestId('retry-button')
    act(() => {
      fireEvent.click(retryBtn)
    })

    // 不触发路由跳转
    expect(replaceMock).not.toHaveBeenCalled()

    // 呈现离线警告横幅
    const warning = screen.getByTestId('offline-warning-banner')
    expect(warning).toBeInTheDocument()
    expect(warning.textContent).toContain('网络连接尚未恢复')

    // RL-01: 严苛断言零网络请求
    expect(fetchStub).not.toHaveBeenCalled()
  })

  test('RL-01 零写铁律：渲染与多次交互期间 HTTP 请求调用严格为 0', () => {
    render(<NextOfflineFallback />)

    const retryBtn = screen.getByTestId('retry-button')
    act(() => {
      fireEvent.click(retryBtn)
      fireEvent.click(retryBtn)
    })

    expect(fetchStub).not.toHaveBeenCalled()
  })
})
