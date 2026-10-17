import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { throttledSessionStorage } from '@/lib/throttled-session-storage'

describe('合并写入的 sessionStorage 持久化', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.sessionStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('连续多次写入只在延迟后落一次，且是最新值；未落盘前读到的也是最新值', () => {
    const storage = throttledSessionStorage<{ n: number }>(500)!
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    for (let n = 1; n <= 1000; n++) storage.setItem('k', { state: { n }, version: 0 })
    expect(spy).not.toHaveBeenCalled()
    expect(storage.getItem('k')).toEqual({ state: { n: 1000 }, version: 0 })
    vi.advanceTimersByTime(500)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(window.sessionStorage.getItem('k')!)).toEqual({
      state: { n: 1000 },
      version: 0,
    })
    spy.mockRestore()
  })

  test('页面隐藏时立即写入，刷新不丢', () => {
    const storage = throttledSessionStorage<{ n: number }>(500)!
    storage.setItem('k', { state: { n: 7 }, version: 0 })
    window.dispatchEvent(new Event('pagehide'))
    expect(JSON.parse(window.sessionStorage.getItem('k')!).state.n).toBe(7)
  })

  test('删除会丢弃尚未写入的值', () => {
    const storage = throttledSessionStorage<{ n: number }>(500)!
    storage.setItem('k', { state: { n: 1 }, version: 0 })
    storage.removeItem('k')
    vi.advanceTimersByTime(500)
    expect(window.sessionStorage.getItem('k')).toBeNull()
  })
})
