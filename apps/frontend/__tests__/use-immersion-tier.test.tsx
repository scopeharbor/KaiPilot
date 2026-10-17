import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useNextTrackStore } from '@/stores/next-track-store'

type MatchMediaListener = (event: { matches: boolean }) => void

/**
 * 可控制的 matchMedia mock：initialMatches 为初始命中态；
 * emit() 模拟系统设置变化（更新命中态并触发全部监听器）。
 */
function installMatchMediaMock(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<MatchMediaListener>()
  const mock = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    addEventListener: (_type: string, listener: MatchMediaListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: MatchMediaListener) =>
      listeners.delete(listener),
    addListener: (listener: MatchMediaListener) => listeners.add(listener),
    removeListener: (listener: MatchMediaListener) => listeners.delete(listener),
    dispatchEvent: () => false,
    onchange: null,
  }))
  vi.stubGlobal('matchMedia', mock)
  return {
    emit: (next: boolean) => {
      matches = next
      for (const listener of listeners) listener({ matches: next })
    },
    mock,
  }
}

beforeEach(() => {
  localStorage.clear()
  useNextTrackStore.getState().reset()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-immersion')
})

describe('hooks/use-immersion-tier（v3-ui-next-track-foundation D-f）', () => {
  test('默认档：无手动选择且系统未减弱动画 → immersive', () => {
    installMatchMediaMock(false)
    const { result } = renderHook(() => useImmersionTier())
    expect(result.current).toBe('immersive')
  })

  test('系统减弱动画自动降级：未手动选择且 prefers-reduced-motion → precise', () => {
    installMatchMediaMock(true)
    const { result } = renderHook(() => useImmersionTier())
    expect(result.current).toBe('precise')
  })

  test('手动覆盖优先：系统减弱动画时手动选择 light 仍以 light 为准', () => {
    installMatchMediaMock(true)
    act(() => useNextTrackStore.getState().setImmersionTier('light'))
    const { result } = renderHook(() => useImmersionTier())
    expect(result.current).toBe('light')
  })

  test('手动清除（null）后恢复系统合成', () => {
    installMatchMediaMock(false)
    act(() => useNextTrackStore.getState().setImmersionTier('precise'))
    const { result } = renderHook(() => useImmersionTier())
    expect(result.current).toBe('precise')

    act(() => useNextTrackStore.getState().setImmersionTier(null))
    expect(result.current).toBe('immersive')
  })

  test('媒体查询动态变更：未手动覆盖时实时降级/回升', () => {
    const media = installMatchMediaMock(false)
    const { result } = renderHook(() => useImmersionTier())
    expect(result.current).toBe('immersive')

    act(() => media.emit(true))
    expect(result.current).toBe('precise')

    act(() => media.emit(false))
    expect(result.current).toBe('immersive')
  })

  test('手动覆盖期间忽略系统媒体查询变化（手动选择为最高准则）', () => {
    const media = installMatchMediaMock(false)
    act(() => useNextTrackStore.getState().setImmersionTier('light'))
    const { result } = renderHook(() => useImmersionTier())

    act(() => media.emit(true))
    expect(result.current).toBe('light')
  })

  test('DOM 同步：最终档位写入 <html data-immersion>，卸载后清除', () => {
    installMatchMediaMock(false)
    const { unmount } = renderHook(() => useImmersionTier())
    expect(document.documentElement.getAttribute('data-immersion')).toBe('immersive')

    act(() => {
      useNextTrackStore.getState().setImmersionTier('precise')
    })
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')

    unmount()
    expect(document.documentElement.hasAttribute('data-immersion')).toBe(false)
  })
})
