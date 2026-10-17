/**
 * 搜索路由同化页测试（/next/search?q=...，v3-ui-next-batch3-global-convergence W1）。
 *
 * 覆盖：
 * 1. 访问 /next/search?q=架构设计 自动提取关键词；
 * 2. 平滑重定向 router.replace('/next')；
 * 3. 暂存 space-map-prefill 并在 50ms 内派发 space-map-trigger 事件；
 * 4. 空间地图 Overlay 接收后自动打开并预填「架构设计」。
 */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import SearchAssimilationPage from '@/app/(next)/next/search/page'

const replaceMock = vi.fn()
let currentSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => currentSearchParams,
}))

describe('SearchAssimilationPage 路由同化测试', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    replaceMock.mockReset()
    currentSearchParams = new URLSearchParams('q=架构设计')
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('访问 /next/search?q=架构设计 触发 router.replace("/next") 并暂存检索词', () => {
    render(<SearchAssimilationPage />)

    // 验证立即平滑重定向
    expect(replaceMock).toHaveBeenCalledWith('/next')

    // 验证写入 sessionStorage 预填缓存
    expect(window.sessionStorage.getItem('space-map-prefill')).toBe('架构设计')

    // 验证过渡状态
    expect(screen.getByTestId('search-assimilation-page')).toBeInTheDocument()
  })

  test('派发 space-map-trigger 事件携带 query 与 spaces 镜头', () => {
    const triggerListener = vi.fn()
    window.addEventListener('space-map-trigger', triggerListener)

    render(<SearchAssimilationPage />)

    // 推进定时器 50ms
    act(() => {
      vi.advanceTimersByTime(60)
    })

    expect(triggerListener).toHaveBeenCalledTimes(1)
    const event = triggerListener.mock.calls[0]![0] as CustomEvent
    expect(event.detail).toEqual({
      query: '架构设计',
      lens: 'spaces',
    })

    window.removeEventListener('space-map-trigger', triggerListener)
  })
})
