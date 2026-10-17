/**
 * v3-docker-compose-runtime-foundation —— task 4.4
 * Realtime WebSocket URL 推导：
 * - 绝对 API 基址（开发默认）→ 同主机 ws(s) 派生
 * - 相对同源基址（容器栈 `/api/v1`）→ 当前浏览器 origin 推导（edge 转发 /socket.io）
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_URL

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL
  } else {
    process.env.NEXT_PUBLIC_API_URL = ORIGINAL_ENV
  }
  vi.resetModules()
})

describe('getWsUrl（v3-docker-compose-runtime-foundation task 4.4）', () => {
  it('绝对 http API 基址派生 ws 地址', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://example.internal:3333/api/v1'
    vi.resetModules()
    const mod = await import('@/lib/realtime/client')
    expect(mod.getWsUrl()).toBe('ws://example.internal:3333')
  })

  it('绝对 https API 基址派生 wss 地址', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://pm.example.com/api/v1'
    vi.resetModules()
    const mod = await import('@/lib/realtime/client')
    expect(mod.getWsUrl()).toBe('wss://pm.example.com')
  })

  it('相对同源基址（/api/v1）从当前浏览器 origin 推导', async () => {
    process.env.NEXT_PUBLIC_API_URL = '/api/v1'
    vi.resetModules()
    const mod = await import('@/lib/realtime/client')
    // jsdom 当前 origin（如 http://localhost:3000）→ ws://localhost:3000
    expect(mod.getWsUrl()).toBe(window.location.origin.replace(/^http/, 'ws'))
    expect(mod.getWsUrl()).not.toContain('/api/v1')
    expect(mod.getWsUrl()).not.toBe('')
  })

  it('相对基址推导不残留尾部斜杠路径', async () => {
    process.env.NEXT_PUBLIC_API_URL = '/api/v1/'
    vi.resetModules()
    const mod = await import('@/lib/realtime/client')
    expect(mod.getWsUrl()).toBe(window.location.origin.replace(/^http/, 'ws'))
  })
})
