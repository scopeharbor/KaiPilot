/**
 * v3-motion-fallback-closure tasks 1.2 —— 系统减弱动效偏好读取点测试。
 *
 * 覆盖（spec「动效偏好读取点单一化」）：
 * - reduce 命中 → true；未命中 → false；
 * - matchMedia `change` 事件即时反映（用户切换系统无障碍设置）；
 * - 卸载后移除监听（不留悬挂订阅）；
 * - 无 `matchMedia` / SSR 守卫下安全返回 false（jsdom 与首帧一致性）；
 * - `enabled = false` 时不订阅（`use-immersion-tier` 的「手动覆盖时不订阅」语义依赖此项）。
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useMotionPreference } from '@/hooks/use-motion-preference'

type MatchMediaListener = (event: { matches: boolean }) => void

/**
 * 可控 matchMedia 桩：记录监听器注册/移除次数，emit() 模拟系统设置变化。
 */
function installMatchMediaMock(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<MatchMediaListener>()
  const addEventListener = vi.fn((_type: string, listener: MatchMediaListener) => {
    listeners.add(listener)
  })
  const removeEventListener = vi.fn((_type: string, listener: MatchMediaListener) => {
    listeners.delete(listener)
  })
  const mock = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    addEventListener,
    removeEventListener,
    addListener: addEventListener,
    removeListener: removeEventListener,
    dispatchEvent: () => false,
    onchange: null,
  }))
  vi.stubGlobal('matchMedia', mock)

  return {
    mock,
    addEventListener,
    removeEventListener,
    listenerCount: () => listeners.size,
    emit: (next: boolean) => {
      matches = next
      for (const listener of listeners) listener({ matches: next })
    },
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('hooks/use-motion-preference（tasks 1.1 · spec「动效偏好读取点单一化」）', () => {
  test('系统未开启减弱动效 → false', () => {
    const media = installMatchMediaMock(false)
    const { result } = renderHook(() => useMotionPreference())

    expect(result.current).toBe(false)
    expect(media.mock).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })

  test('系统开启减弱动效（reduce 命中）→ true', () => {
    installMatchMediaMock(true)
    const { result } = renderHook(() => useMotionPreference())

    expect(result.current).toBe(true)
  })

  test('媒体查询 change 事件即时反映（reduce 开 → 关双向）', () => {
    const media = installMatchMediaMock(false)
    const { result } = renderHook(() => useMotionPreference())
    expect(result.current).toBe(false)

    act(() => media.emit(true))
    expect(result.current).toBe(true)

    act(() => media.emit(false))
    expect(result.current).toBe(false)
  })

  test('卸载后移除监听：不留悬挂订阅', () => {
    const media = installMatchMediaMock(true)
    const { result, unmount } = renderHook(() => useMotionPreference())
    expect(result.current).toBe(true)
    expect(media.listenerCount()).toBe(1)

    unmount()

    expect(media.removeEventListener).toHaveBeenCalledTimes(1)
    expect(media.listenerCount()).toBe(0)
    // 卸载后再触发系统变化不应再触达（无监听器可触达）
    act(() => media.emit(false))
    expect(media.listenerCount()).toBe(0)
  })

  test('环境无 matchMedia（SSR / 极简 jsdom）→ 安全返回 false，不抛错', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result, unmount } = renderHook(() => useMotionPreference())

    expect(result.current).toBe(false)
    expect(() => unmount()).not.toThrow()
  })

  test('enabled = false 时不订阅（调用方短路时不产生媒体查询监听）', () => {
    const media = installMatchMediaMock(true)
    const { result } = renderHook(() => useMotionPreference(false))

    expect(result.current).toBe(false)
    expect(media.mock).not.toHaveBeenCalled()
    expect(media.addEventListener).not.toHaveBeenCalled()
  })

  test('enabled 由 false 转 true 后开始订阅并读到真实偏好', () => {
    const media = installMatchMediaMock(true)
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMotionPreference(enabled),
      { initialProps: { enabled: false } },
    )
    expect(result.current).toBe(false)

    rerender({ enabled: true })

    expect(result.current).toBe(true)
    expect(media.listenerCount()).toBe(1)
  })
})
