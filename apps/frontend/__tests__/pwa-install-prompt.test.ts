import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePwaInstallPrompt } from '@/hooks/use-pwa-install-prompt'

const STORAGE_KEY = 'pwa-install-dismissed'

/** 模拟 beforeinstallprompt 事件（含浏览器私有属性） */
interface MockBeforeInstallPromptEvent extends Event {
  prompt: ReturnType<typeof vi.fn>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** 构造一个模拟的 beforeinstallprompt 事件 */
function createMockBeforeInstallPrompt(
  outcome: 'accepted' | 'dismissed' = 'accepted',
): MockBeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt') as MockBeforeInstallPromptEvent
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome })
  return event
}

describe('usePwaInstallPrompt', () => {
  let addListenerMap: Map<string, EventListener>
  let removeListenerMap: Map<string, EventListener>

  beforeEach(() => {
    addListenerMap = new Map()
    removeListenerMap = new Map()

    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
      addListenerMap.set(type.toString(), handler as EventListener)
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, handler) => {
      removeListenerMap.set(type.toString(), handler as EventListener)
    })

    // 默认非 standalone
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: browser)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---- 初始状态 ----

  test('初始状态为 unsupported', () => {
    const { result } = renderHook(() => usePwaInstallPrompt())
    expect(result.current.state).toBe('unsupported')
    expect(result.current.isStandalone).toBe(false)
  })

  // ---- available 状态 ----

  test('收到 beforeinstallprompt 后状态变为 available', () => {
    const { result } = renderHook(() => usePwaInstallPrompt())

    act(() => {
      const handler = addListenerMap.get('beforeinstallprompt')
      expect(handler).toBeDefined()
      handler!(createMockBeforeInstallPrompt())
    })

    expect(result.current.state).toBe('available')
  })

  // ---- prompt 流程 ----

  test('调用 install 后状态变为 prompting 然后 accepted 变为 installed', async () => {
    const { result } = renderHook(() => usePwaInstallPrompt())

    act(() => {
      const handler = addListenerMap.get('beforeinstallprompt')
      handler!(createMockBeforeInstallPrompt('accepted'))
    })
    expect(result.current.state).toBe('available')

    await act(async () => {
      await result.current.install()
    })

    expect(result.current.state).toBe('installed')
  })

  test('用户拒绝后状态回到 available', async () => {
    const { result } = renderHook(() => usePwaInstallPrompt())

    act(() => {
      const handler = addListenerMap.get('beforeinstallprompt')
      handler!(createMockBeforeInstallPrompt('dismissed'))
    })
    expect(result.current.state).toBe('available')

    await act(async () => {
      await result.current.install()
    })

    expect(result.current.state).toBe('available')
  })

  // ---- appinstalled 事件 ----

  test('收到 appinstalled 后状态变为 installed', () => {
    const { result } = renderHook(() => usePwaInstallPrompt())

    act(() => {
      const handler = addListenerMap.get('appinstalled')
      expect(handler).toBeDefined()
      handler!(new Event('appinstalled'))
    })

    expect(result.current.state).toBe('installed')
  })

  // ---- dismiss 流程 ----

  test('dismiss 将状态设为 dismissed 并写入 localStorage', () => {
    const { result } = renderHook(() => usePwaInstallPrompt())

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.state).toBe('dismissed')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  test('dismiss 后收到 beforeinstallprompt 仍保持 dismissed', () => {
    const { result } = renderHook(() => usePwaInstallPrompt())

    act(() => {
      result.current.dismiss()
    })

    act(() => {
      const handler = addListenerMap.get('beforeinstallprompt')
      handler!(createMockBeforeInstallPrompt())
    })

    expect(result.current.state).toBe('dismissed')
  })

  // ---- resetDismissed ----

  test('resetDismissed 清除 localStorage 并回到 unsupported', () => {
    const { result } = renderHook(() => usePwaInstallPrompt())

    act(() => {
      result.current.dismiss()
    })
    expect(result.current.state).toBe('dismissed')

    act(() => {
      result.current.resetDismissed()
    })

    expect(result.current.state).toBe('unsupported')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  // ---- standalone 检测 ----

  test('standalone 模式下状态为 installed', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    const { result } = renderHook(() => usePwaInstallPrompt())
    expect(result.current.state).toBe('installed')
    expect(result.current.isStandalone).toBe(true)
  })

  // ---- listener cleanup ----

  test('组件卸载后移除事件监听', () => {
    const { unmount } = renderHook(() => usePwaInstallPrompt())

    unmount()

    expect(addListenerMap.get('beforeinstallprompt')).toBeDefined()
    expect(removeListenerMap.get('beforeinstallprompt')).toBeDefined()
    expect(addListenerMap.get('appinstalled')).toBeDefined()
    expect(removeListenerMap.get('appinstalled')).toBeDefined()
  })

  // ---- 没有后端写入 ----

  test('安装流程不调用任何外部 API（无后端写入）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { result } = renderHook(() => usePwaInstallPrompt())

    act(() => {
      const handler = addListenerMap.get('beforeinstallprompt')
      handler!(createMockBeforeInstallPrompt('accepted'))
    })

    await act(async () => {
      await result.current.install()
    })

    act(() => {
      result.current.dismiss()
    })

    // 没有任何 fetch（无后端写入）
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
