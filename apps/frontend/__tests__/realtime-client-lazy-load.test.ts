/**
 * v3-frontend-load-performance —— socket.io-client 按需加载。
 *
 * 覆盖：
 * - 模块导入时不加载 socket.io-client，首次 connect 才建 socket
 * - 加载期间重复 connect 只建一个 socket
 * - 加载期间 disconnect 不再建 socket
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

const ioMock = vi.hoisted(() =>
  vi.fn(() => ({
    connected: false,
    on: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
)
vi.mock('socket.io-client', () => ({ io: ioMock }))

import { RealtimeClient } from '@/lib/realtime/client'

describe('RealtimeClient 按需加载 socket.io-client', () => {
  beforeEach(() => {
    ioMock.mockClear()
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', organizations: [] },
      accessToken: accessTokenWith(['task:view']),
      refreshToken: 'refresh-1',
    })
  })

  afterEach(() => {
    useAuthStore.getState().clear()
  })

  test('导入模块不建 socket，connect 后加载完成才建', async () => {
    const client = new RealtimeClient()
    expect(ioMock).not.toHaveBeenCalled()

    client.connect()
    expect(client.status).toBe('connecting')
    await vi.waitFor(() => expect(ioMock).toHaveBeenCalledTimes(1))
    const [, options] = ioMock.mock.calls[0] as unknown as [string, { auth: { token: string } }]
    expect(options.auth.token).toBe(useAuthStore.getState().accessToken)
    client.disconnect()
  })

  test('加载期间重复 connect 只建一个 socket', async () => {
    const client = new RealtimeClient()
    client.connect()
    client.connect()
    client.connect()
    await vi.waitFor(() => expect(ioMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ioMock).toHaveBeenCalledTimes(1)
    client.disconnect()
  })

  test('加载期间 disconnect 不再建 socket', async () => {
    const client = new RealtimeClient()
    client.connect()
    client.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ioMock).not.toHaveBeenCalled()
    expect(client.status).toBe('disconnected')
  })
})
