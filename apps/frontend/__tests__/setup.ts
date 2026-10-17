/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom/vitest'
import { act, cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom 缺省无 matchMedia / ResizeObserver：设计系统组件（密度切换、Radix 浮层）需要它们。
if (typeof window !== 'undefined') {
  // Node 26 exposes an experimental global localStorage getter which yields undefined unless
  // --localstorage-file is configured and can also shadow jsdom's implementation. Install a
  // deterministic in-memory Storage before Zustand persist middleware first accesses it.
  const localStorageEntries = new Map<string, string>()
  const testLocalStorage: Storage = {
    get length() {
      return localStorageEntries.size
    },
    clear: () => localStorageEntries.clear(),
    getItem: (key) => localStorageEntries.get(key) ?? null,
    key: (index) => [...localStorageEntries.keys()][index] ?? null,
    removeItem: (key) => localStorageEntries.delete(key),
    setItem: (key, value) => localStorageEntries.set(key, String(value)),
  }
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: testLocalStorage,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: testLocalStorage,
    writable: true,
  })
  // jsdom（vitest pretendToBeVisual）自带原生 rAF 以约 16ms 节拍推进，与测试常用的
  // 0ms 宏任务冲刷不同步（AI 同事面板关闭后焦点回跳的双 rAF 链会因此竞态）。
  // 一律以宏任务（setTimeout 0）模拟，保证 rAF 链在测试中确定性落定。
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 0)) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((handle: number) =>
    window.clearTimeout(handle)) as typeof window.cancelAnimationFrame
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  // Radix Select/ScrollArea 依赖 scrollIntoView（jsdom 缺省）。
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = vi.fn()
  }
}

// 单元测试禁止真实网络。本机开着开发后端（:3333）时，未 mock 的请求会拿到真实 401，
// 触发前端刷新失败→登出、清空会话，而且异步落到下一个用例（实测 next-project-space-route
// 因此 7 例失败、next-change-approval-console 时好时坏）。统一按「后端不可达」处理，
// 与未开后端时的行为一致；需要网络响应的用例自行 spyOn / stubGlobal fetch 覆盖。
if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    return Promise.reject(new TypeError(`Failed to fetch（单元测试禁用真实网络）：${url}`))
  }) as typeof fetch
}

afterEach(async () => {
  // 多轮宏任务冲刷：TanStack Query 的异步 resolve 与 Radix Presence 的离开动画
  // 常在一次 tick 内落不完，单轮 setTimeout(0) 会漏掉链式的后续微任务。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  cleanup()
  // react-focus-guards 的 guard span 与 popper 内容 wrapper 由 Radix 手动插入
  // document.body（不经 React render），cleanup() 卸载 React 树时不会移除它们；
  // 残留节点会持续触发下一个用例里的卸载期状态更新。
  document.body
    .querySelectorAll('[data-radix-focus-guard], [data-radix-popper-content-wrapper]')
    .forEach((node) => node.remove())
})
