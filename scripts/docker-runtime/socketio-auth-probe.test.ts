import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  probeUnauthenticatedSocketIoConnect,
  type SocketIoProbeClientFactory,
} from './socketio-auth-probe.js'

type EventName = 'connect' | 'connect_error'

function fakeClient(outcome: 'auth-rejected' | 'connected' | 'transport-error' | 'silent') {
  const listeners = new Map<EventName, (...args: never[]) => void>()
  const state = {
    connectedCalls: 0,
    disconnectCalls: 0,
    removeCalls: 0,
    options: undefined as unknown,
  }
  const client = {
    once(event: EventName, listener: (...args: never[]) => void) {
      listeners.set(event, listener)
      return this
    },
    connect() {
      state.connectedCalls += 1
      queueMicrotask(() => {
        if (outcome === 'auth-rejected') {
          listeners.get('connect_error')?.(new Error('AUTH_REQUIRED: 缺少访问令牌') as never)
        } else if (outcome === 'transport-error') {
          listeners.get('connect_error')?.(new Error('xhr poll error') as never)
        } else if (outcome === 'connected') {
          listeners.get('connect')?.()
        }
      })
      return this
    },
    disconnect() {
      state.disconnectCalls += 1
      return this
    },
    removeAllListeners() {
      state.removeCalls += 1
      listeners.clear()
      return this
    },
  }
  const factory: SocketIoProbeClientFactory = (_origin, options) => {
    state.options = options
    return client
  }
  return { factory, state }
}

test('真实 CONNECT 收到 AUTH_REQUIRED 才通过，并固定无 token/polling 配置', async () => {
  const { factory, state } = fakeClient('auth-rejected')
  const result = await probeUnauthenticatedSocketIoConnect('http://127.0.0.1:18080', {
    clientFactory: factory,
    timeoutMs: 50,
  })

  assert.equal(result.ok, true)
  assert.equal(result.outcome, 'auth-rejected')
  assert.deepEqual(state.options, {
    path: '/socket.io',
    transports: ['polling'],
    auth: {},
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    timeout: 50,
  })
  assert.equal(state.connectedCalls, 1)
  assert.equal(state.disconnectCalls, 1)
  assert.equal(state.removeCalls, 1)
})

test('transport 错误或匿名 connect 都失败且完整 cleanup', async () => {
  for (const outcome of ['transport-error', 'connected'] as const) {
    const { factory, state } = fakeClient(outcome)
    const result = await probeUnauthenticatedSocketIoConnect('http://127.0.0.1:18080', {
      clientFactory: factory,
      timeoutMs: 50,
    })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, outcome)
    assert.equal(state.disconnectCalls, 1)
    assert.equal(state.removeCalls, 1)
  }
})

test('timeout fail closed，关闭 client 且不留下活动 timer', async () => {
  const { factory, state } = fakeClient('silent')
  const result = await probeUnauthenticatedSocketIoConnect('http://127.0.0.1:18080', {
    clientFactory: factory,
    timeoutMs: 10,
  })

  assert.equal(result.ok, false)
  assert.equal(result.outcome, 'timeout')
  assert.equal(state.disconnectCalls, 1)
  assert.equal(state.removeCalls, 1)
})
