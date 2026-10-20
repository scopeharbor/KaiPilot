import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import OfflineFallbackPage from '@/app/offline/page'
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

describe('/offline 路由装配与静态零写网络回归测试 (W3 / task 3.3 & 3.4)', () => {
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

  test('直接访问 /offline 路由可达性挂载与深空外壳装配', () => {
    const { container } = render(<OfflineFallbackPage />)

    // 作用域标记与深空外壳验证
    const main = container.querySelector('main[data-next-track][data-offline-fallback]')
    expect(main).toBeInTheDocument()
    expect(main?.className).toContain('bg-[var(--nx-space-bg)]')

    // 核心文本在主树中正常呈现
    expect(screen.getByText('当前处于离线状态')).toBeInTheDocument()
    expect(screen.getByText(/网络连接已断开，部分功能暂时不可用/)).toBeInTheDocument()
    expect(screen.getByText('开项 Kaiplan — 离线模式')).toBeInTheDocument()

    // 1px 发丝线暗黑仪器卡片
    const card = container.querySelector('[data-offline-card]')
    expect(card).toBeInTheDocument()
    expect(card?.className).toContain('border-[var(--nx-border-hairline)]')
    expect(card?.className).toContain('bg-[var(--nx-workspace-surface)]')

    // RL-15 视觉红线守护：严格零 Canvas 画布
    expect(container.querySelector('canvas')).toBeNull()
  })

  test('断网场景下静态文本渲染与可访问性（A11y）属性验证', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { container } = render(<OfflineFallbackPage />)

    // 主标题具备正确的 heading level 1
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('当前处于离线状态')

    // 根容器具备 main landmark
    expect(screen.getByRole('main')).toBeInTheDocument()

    // 图标带有 aria-hidden 防屏幕阅读器杂音
    const icon = container.querySelector('svg.lucide-wifi-off')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('aria-hidden', 'true')

    // 无任何破坏静态安全性的表单或编辑控件
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelectorAll('button[type="submit"]').length).toBe(0)
  })

  test('双轨重试导航导流策略：legacy 导流至 /dashboard，next 导流至 /next', () => {
    // 1. 默认 / legacy 轨道偏好
    useNextTrackStore.setState({ track: 'legacy', immersionTier: null, source: null })
    const { unmount } = render(<OfflineFallbackPage />)

    const legacyRetryBtn = screen.getByTestId('retry-button')
    expect(legacyRetryBtn).toHaveAttribute('href', '/dashboard')
    fireEvent.click(legacyRetryBtn)
    expect(replaceMock).toHaveBeenCalledWith('/dashboard')

    unmount()
    replaceMock.mockClear()

    // 2. 显式切换为 next 轨道偏好
    useNextTrackStore.setState({ track: 'next', immersionTier: null, source: null })
    render(<OfflineFallbackPage />)

    const nextRetryBtn = screen.getByTestId('retry-button')
    expect(nextRetryBtn).toHaveAttribute('href', '/next')
    fireEvent.click(nextRetryBtn)
    expect(replaceMock).toHaveBeenCalledWith('/next')
  })

  test('断网场景点击重试展示无障碍 alert 并不发起导航', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    render(<OfflineFallbackPage />)

    const retryBtn = screen.getByTestId('retry-button')
    act(() => {
      fireEvent.click(retryBtn)
    })

    expect(replaceMock).not.toHaveBeenCalled()
    const alert = screen.getByRole('status')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveAttribute('aria-live', 'polite')
    expect(alert.textContent).toContain('网络连接尚未恢复')
  })

  test('RL-01 严苛断言：挂载与多次重试交互期间 HTTP 写操作严格为 0', () => {
    const { rerender } = render(<OfflineFallbackPage />)

    const retryBtn = screen.getByTestId('retry-button')

    // 模拟在线点击重试
    act(() => {
      fireEvent.click(retryBtn)
    })

    // 模拟离线状态并再次点击
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    act(() => {
      fireEvent.click(retryBtn)
    })

    // 模拟双轨切换与重新渲染
    act(() => {
      useNextTrackStore.setState({ track: 'next' })
    })
    rerender(<OfflineFallbackPage />)
    act(() => {
      fireEvent.click(retryBtn)
    })

    // 验证 fetch 未被任何逻辑调用（零网络请求、零写操作）
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
