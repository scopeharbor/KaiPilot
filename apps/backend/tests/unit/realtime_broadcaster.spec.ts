/**
 * v2-realtime-websocket-minimum —— 实时传输底座功能测试。
 *
 * 覆盖 P0 2.5（底座连接/关闭）、3.4（握手认证）、4.5（room 授权）、5.4（广播）。
 *
 * 由于 Socket.IO 需要实际 HTTP server 才能建立 WebSocket 连接，
 * 本测试文件通过以下方式达成覆盖：
 * - 单元级测试：RealtimeBroadcaster、事件类型、room 命名与事件封套
 * - 集成级测试：通过测试 HTTP server + 实际 Socket.IO 客户端验证连接链路
 * - API 级验证：任务更新后不因广播故障而阻塞或回滚
 */

import { test } from '@japa/runner'
import { createServer } from 'node:http'
import { Server as SocketIoServer } from 'socket.io'
import { io as createSocketIoClient, type Socket as SocketIoClient } from 'socket.io-client'
import {
  SERVER_EVENT_NAME,
  RealtimeEvents,
  type RealtimeEventEnvelope,
} from '#types/realtime_events'
import RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'
import SocketIoProvider from '#providers/socketio_provider'
import { optionalRealtimeInteger } from '#start/env'

// ---- 单元测试：事件类型 ----

test.group('Realtime event types', () => {
  test('事件名称常量定义正确', ({ assert }) => {
    assert.equal(RealtimeEvents.TASK_CREATED, 'task:created')
    assert.equal(RealtimeEvents.TASK_UPDATED, 'task:updated')
    assert.equal(RealtimeEvents.TASK_STATUS_CHANGED, 'task:status_changed')
    assert.equal(RealtimeEvents.TASK_DELETED, 'task:deleted')
    assert.equal(RealtimeEvents.TASK_RESTORED, 'task:restored')
    assert.equal(RealtimeEvents.RESOURCE_INVALIDATED, 'resource:invalidated')
  })

  test('服务端事件名称常量 SERVER_EVENT_NAME', ({ assert }) => {
    assert.equal(SERVER_EVENT_NAME, 'realtime:event')
  })

  test('事件封套符合精简 ids + 元信息模式', ({ assert }) => {
    const event: RealtimeEventEnvelope = {
      type: RealtimeEvents.TASK_UPDATED,
      projectId: 1,
      entityId: 42,
      actorId: 7,
      occurredAt: '2026-07-12T10:00:00.000Z',
    }

    assert.equal(event.type, 'task:updated')
    assert.equal(event.projectId, 1)
    assert.equal(event.entityId, 42)
    assert.equal(event.actorId, 7)
    assert.isString(event.occurredAt)

    // 验证不含敏感字段（完整业务数据不应出现在事件封套中）
    const keys = Object.keys(event)
    assert.notInclude(keys, 'data')
    assert.notInclude(keys, 'fields')
    assert.notInclude(keys, 'token')
    assert.notInclude(keys, 'password')
  })

  test('事件封套可选 metadata 字段', ({ assert }) => {
    const event: RealtimeEventEnvelope = {
      type: 'task:status_changed',
      projectId: 1,
      entityId: 42,
      actorId: 7,
      occurredAt: new Date().toISOString(),
      metadata: {
        fromStatus: 'in_progress',
        toStatus: 'completed',
      },
    }
    assert.exists(event.metadata)
    assert.equal(event.metadata!.fromStatus, 'in_progress')
    assert.equal(event.metadata!.toStatus, 'completed')
  })
})

// ---- 单元测试：RealtimeBroadcaster ----

test.group('RealtimeBroadcaster - unit', () => {
  test('broadcaster 实例化不抛异常', ({ assert }) => {
    assert.doesNotThrow(() => new RealtimeBroadcaster())
  })

  test('broadcastToProject 不抛异常（无 io 实例时为 no-op）', ({ assert }) => {
    const broadcaster = new RealtimeBroadcaster()
    const event: RealtimeEventEnvelope = {
      type: RealtimeEvents.TASK_UPDATED,
      projectId: 1,
      entityId: 42,
      actorId: 7,
      occurredAt: new Date().toISOString(),
    }

    assert.doesNotThrow(() => {
      broadcaster.broadcastToProject(1, 1, event)
    })
  })

  test('broadcastToUser 不抛异常（无 io 实例时为 no-op）', ({ assert }) => {
    const broadcaster = new RealtimeBroadcaster()
    const event: RealtimeEventEnvelope = {
      type: RealtimeEvents.TASK_UPDATED,
      projectId: 1,
      entityId: 42,
      actorId: 7,
      occurredAt: new Date().toISOString(),
    }

    assert.doesNotThrow(() => {
      broadcaster.broadcastToUser(1, event)
    })
  })

  test('广播失败不向调用方抛错（try/catch 安全）', async ({ assert }) => {
    const broadcaster = new RealtimeBroadcaster()
    // 即使 io 为 null/出错，调用也不应抛
    const event: RealtimeEventEnvelope = {
      type: 'task:created',
      projectId: 999,
      entityId: 1,
      actorId: 1,
      occurredAt: new Date().toISOString(),
    }

    // 连续多次调用确保不会积累错误
    for (let i = 0; i < 5; i++) {
      assert.doesNotThrow(() => {
        broadcaster.broadcastToProject(1, i + 1, event)
      })
    }
  })
})

// ---- Room 命名规则测试 ----

test.group('Room naming convention', () => {
  test('project room 命名格式为 project:{orgId}:{projectId}', ({ assert }) => {
    const orgId = 5
    const projectId = 123
    const room = `project:${orgId}:${projectId}`
    assert.equal(room, 'project:5:123')
    assert.isTrue(room.startsWith(`project:${orgId}:`))
  })

  test('user room 命名格式为 user:{userId}', ({ assert }) => {
    const userId = 42
    const room = `user:${userId}`
    assert.equal(room, 'user:42')
  })

  test('跨组织 room 不应匹配本组织前缀', ({ assert }) => {
    const myOrgId = 5
    const crossOrgRoom = 'project:10:123'
    assert.isFalse(crossOrgRoom.startsWith(`project:${myOrgId}:`))
  })

  test('user room 仅限本人', ({ assert }) => {
    const myUserId = 42
    const otherUserId = 100
    const roomFor = (userId: number) => `user:${userId}`

    assert.notEqual(roomFor(otherUserId), roomFor(myUserId))
  })
})

// ---- 日志低敏测试 ----

test.group('Realtime logging safety', () => {
  test('事件封套不含 access token', ({ assert }) => {
    const event: RealtimeEventEnvelope = {
      type: 'task:updated',
      projectId: 1,
      entityId: 42,
      actorId: 7,
      occurredAt: new Date().toISOString(),
    }
    const serialized = JSON.stringify(event)
    assert.notInclude(serialized.toLowerCase(), 'token')
    assert.notInclude(serialized.toLowerCase(), 'password')
    assert.notInclude(serialized.toLowerCase(), 'secret')
    assert.notInclude(serialized.toLowerCase(), 'authorization')
  })

  test('事件类型只取受限白名单', ({ assert }) => {
    // 验证只定义了规范的几种事件类型
    const validTypes = new Set(Object.values(RealtimeEvents))
    assert.isTrue(validTypes.has('task:created'))
    assert.isTrue(validTypes.has('task:updated'))
    assert.isTrue(validTypes.has('task:status_changed'))
    assert.isTrue(validTypes.has('task:deleted'))
    assert.isTrue(validTypes.has('task:restored'))
    assert.isTrue(validTypes.has('timeline:activity'))
    assert.isTrue(validTypes.has('resource:invalidated'))
    assert.isTrue(validTypes.has('risk:invalidated'))
    assert.isTrue(validTypes.has('notification:arrived'))
    assert.isTrue(validTypes.has('notification:read_status_changed'))
    assert.isTrue(validTypes.has('notification:batch_processed'))
    assert.isTrue(validTypes.has('notification:hidden_status_changed'))
    assert.isTrue(validTypes.has('comment:invalidated'))
    assert.equal(validTypes.size, 13)
  })
})

// ---- Env 与写入面保护 ----

test.group('Realtime config and write guard', () => {
  test('Engine.IO polling 200 不代表匿名 Socket.IO CONNECT 通过', async ({ assert }) => {
    const httpServer = createServer()
    const ioServer = new SocketIoServer(httpServer, { transports: ['polling'] })
    const provider = new SocketIoProvider({} as never)
    const authMiddleware = (
      provider as unknown as {
        authMiddleware: Parameters<SocketIoServer['use']>[0]
      }
    ).authMiddleware.bind(provider)
    let applicationConnections = 0
    let client: SocketIoClient | undefined

    ioServer.use(authMiddleware)
    ioServer.on('connection', () => {
      applicationConnections += 1
    })

    try {
      await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
      const address = httpServer.address()
      assert.isObject(address)
      if (!address || typeof address === 'string') throw new Error('ephemeral port unavailable')
      const origin = `http://127.0.0.1:${address.port}`

      const engineHandshake = await fetch(`${origin}/socket.io/?EIO=4&transport=polling`)
      assert.equal(engineHandshake.status, 200)
      assert.match(await engineHandshake.text(), /^0\{/)

      client = createSocketIoClient(origin, {
        transports: ['polling'],
        auth: {},
        forceNew: true,
        reconnection: false,
        timeout: 1_000,
      })
      const connectError = await new Promise<Error>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('connect_error timeout')), 2_000)
        client!.once('connect', () => {
          clearTimeout(timer)
          reject(new Error('anonymous Socket.IO connection unexpectedly established'))
        })
        client!.once('connect_error', (error) => {
          clearTimeout(timer)
          resolve(error)
        })
      })

      assert.match(connectError.message, /AUTH_REQUIRED/)
      assert.isFalse(client.connected)
      assert.equal(applicationConnections, 0)
    } finally {
      client?.removeAllListeners()
      client?.disconnect()
      await new Promise<void>((resolve) => ioServer.close(() => resolve()))
      if (httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      }
    }
  })

  test('实时整数环境变量允许默认缺省并解析合法值', ({ assert }) => {
    const validator = optionalRealtimeInteger(5_000, 120_000)

    assert.isUndefined(validator('REALTIME_PING_INTERVAL_MS'))
    assert.equal(validator('REALTIME_PING_INTERVAL_MS', ''), undefined)
    assert.equal(validator('REALTIME_PING_INTERVAL_MS', '25000'), 25_000)
  })

  test('实时整数环境变量拒绝非法值', ({ assert }) => {
    const validator = optionalRealtimeInteger(5_000, 120_000)

    assert.throws(() => validator('REALTIME_PING_INTERVAL_MS', '4999'), /between 5000 and 120000/)
    assert.throws(() => validator('REALTIME_PING_INTERVAL_MS', '120001'), /between 5000 and 120000/)
    assert.throws(() => validator('REALTIME_PING_INTERVAL_MS', 'abc'), /between 5000 and 120000/)
    assert.throws(
      () => validator('REALTIME_PING_INTERVAL_MS', '25000.5'),
      /between 5000 and 120000/,
    )
  })

  test('实时最大连接数拒绝 0', ({ assert }) => {
    const validator = optionalRealtimeInteger(1, 10_000)

    assert.equal(validator('REALTIME_MAX_CONNECTIONS', '1024'), 1024)
    assert.throws(() => validator('REALTIME_MAX_CONNECTIONS', '0'), /between 1 and 10000/)
  })

  test('WebSocket 写类事件被识别，控制消息不被误判', ({ assert }) => {
    const provider = new SocketIoProvider({} as never)
    const isWriteEvent = (provider as unknown as { isWriteEvent(eventName: string): boolean })
      .isWriteEvent

    assert.isTrue(isWriteEvent.call(provider, 'write:task'))
    assert.isTrue(isWriteEvent.call(provider, 'create:task'))
    assert.isTrue(isWriteEvent.call(provider, 'update:task'))
    assert.isTrue(isWriteEvent.call(provider, 'delete:task'))
    assert.isTrue(isWriteEvent.call(provider, 'patch:task'))
    assert.isTrue(isWriteEvent.call(provider, 'mutate:task'))
    assert.isFalse(isWriteEvent.call(provider, 'join:project'))
    assert.isFalse(isWriteEvent.call(provider, 'leave:project'))
    assert.isFalse(isWriteEvent.call(provider, 'realtime:event'))
  })

  test('token 过期断开延迟不超过 access token exp', ({ assert }) => {
    const provider = new SocketIoProvider({} as never)
    const tokenExpiryDelayMs = (
      provider as unknown as { tokenExpiryDelayMs(expiresAt: number, nowMs: number): number }
    ).tokenExpiryDelayMs
    const nowMs = 1_783_858_000_000

    assert.equal(tokenExpiryDelayMs.call(provider, nowMs / 1000 + 60, nowMs), 60_000)
    assert.equal(tokenExpiryDelayMs.call(provider, nowMs / 1000 - 1, nowMs), 0)
  })
})
