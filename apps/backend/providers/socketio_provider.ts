/**
 * Socket.IO 实时传输底座 Provider（design D2/D7/D9）。
 *
 * 在 AdonisJS 应用就绪阶段 attach Socket.IO 到底层 Node HTTP server（共用端口），
 * 使用单节点内存 adapter，注册 `io` 单例供 RealtimeBroadcaster 消费。
 * 关闭时 `io.close()` 释放全部连接。
 *
 * 单节点本机可用，不需要 Redis、不需要独立进程、不需要容器化。
 * 多节点 Redis Adapter 需切换 `// TODO-DEBT: REALTIME-REDIS-ADAPTER` 标记点，
 * 业务代码不受影响。
 */

import type { ApplicationService } from '@adonisjs/core/types'
import { Server as SocketIOServer } from 'socket.io'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import server from '@adonisjs/core/services/server'
import { isStreamingWsEnabled } from '#services/streaming/streaming_ws_config'
import {
  getStreamingServiceDiagnostics,
  authorizeSubscription,
  buildStreamRoom,
  addSubscriber,
  removeSubscriber,
  cleanupSocketSubscriptions,
  getOrCreateStream,
  isValidStreamId,
  getReplayResponse,
} from '#services/streaming/streaming_ws_service'

/**
 * 全局 io 实例引用，供 RealtimeBroadcaster 通过 getSocketIo() 获取。
 */
let ioInstance: SocketIOServer | null = null

/**
 * 获取全局 Socket.IO 实例（供 RealtimeBroadcaster 消费）。
 * 未就绪或已停用时返回 null。
 */
export function getSocketIo(): SocketIOServer | null {
  return ioInstance
}

export default class SocketIoProvider {
  private io: SocketIOServer | null = null
  private readonly tokenExpiryTimers = new Map<string, NodeJS.Timeout>()

  constructor(protected app: ApplicationService) {}

  /**
   * 在应用启动后（ready 阶段）attach Socket.IO 到 HTTP server。
   * 单节点使用内存 adapter；多节点时在下方标记点切换为 Redis Adapter。
   */
  async ready() {
    const enabled = env.get('REALTIME_ENABLED', true)
    if (!enabled) {
      logger.info('Socket.IO 实时通道已停用（REALTIME_ENABLED=false），REST 读写不受影响')
      return
    }

    const nodeServer = server.getNodeServer()
    if (!nodeServer) {
      logger.warn('Node HTTP server 尚未就绪，跳过 Socket.IO 挂载')
      return
    }

    const pingInterval = env.get('REALTIME_PING_INTERVAL_MS', 25000)
    const pingTimeout = env.get('REALTIME_PING_TIMEOUT_MS', 20000)
    const connectTimeout = env.get('REALTIME_CONNECT_TIMEOUT_MS', 30000)

    ioInstance = new SocketIOServer(nodeServer, {
      // 传输降级：WS 被代理/防火墙阻断时回退到 polling
      transports: ['websocket', 'polling'],
      // 心跳：死连接清理的关键
      pingInterval,
      pingTimeout,
      connectTimeout,
      // CORS 对齐既有 FRONTEND_URL
      cors: {
        origin: env.get('FRONTEND_URL', 'http://localhost:3000'),
        credentials: true,
      },
      maxHttpBufferSize: 1e4, // 客户端控制消息仅带 room 名，足够
    })

    this.io = ioInstance

    // 握手认证中间件（设计 D3）：令牌校验 + 即时失效复刻
    this.io.use(this.authMiddleware.bind(this))

    // 连接生命周期管理（设计 D7）：心跳已内建，此处注册 join/leave 控制消息
    this.io.on('connection', (socket) => {
      const data = socket.data as {
        userId: number
        organizationId: number
        roleVersion: number
        tokenExpiresAt?: number
      }
      const logMeta = {
        userId: data.userId,
        organizationId: data.organizationId,
        socketId: socket.id,
      }

      logger.info(logMeta, 'WebSocket 连接已建立')
      this.scheduleTokenExpiryDisconnect(socket, data.tokenExpiresAt, logMeta)

      // 自动加入用户个人频道（设计 D4）
      socket.join(this.userRoom(data.userId))

      // 项目频道 join 控制消息（设计 D6：客户端只发控制消息）
      socket.on(
        'join:project',
        (
          payload: { projectId: number },
          callback?: (res: { ok: boolean; error?: string }) => void,
        ) => {
          this.handleJoinProject(socket, data, payload, callback)
        },
      )

      socket.on('leave:project', (payload: { projectId: number }) => {
        this.handleLeaveProject(socket, data, payload)
      })

      // Compiler run 频道 join/leave（task 3：验证 JWT org、project membership、RBAC）
      socket.on(
        'join:compiler-run',
        (
          payload: { projectId: number; runId: number },
          callback?: (res: { ok: boolean; error?: string }) => void,
        ) => {
          this.handleJoinCompilerRun(socket, data, payload, callback)
        },
      )
      socket.on('leave:compiler-run', (payload: { projectId: number; runId: number }) => {
        this.handleLeaveCompilerRun(socket, data, payload)
      })

      socket.on('disconnect', (reason) => {
        this.clearTokenExpiryTimer(socket.id)
        cleanupSocketSubscriptions(socket.id)
        logger.info({ ...logMeta, reason }, 'WebSocket 连接已断开')
      })

      // ── v2-5-streaming-websocket-service: Stream 控制消息 ───────────

      // 注册 stream 控制消息处理器（仅当 Streaming WS enabled 时生效）
      this.registerStreamControls(socket, data, logMeta)

      // 明确禁止经 WebSocket 写业务数据（设计 D6）。
      // Socket.IO 不支持 `write:*` 通配监听，使用 onAny 覆盖所有客户端事件。
      socket.onAny((eventName, ...args) => {
        if (!this.isWriteEvent(eventName)) return

        const callback = args.at(-1)
        if (typeof callback === 'function') {
          callback({ ok: false, error: 'WRITE_NOT_ALLOWED: 业务写入必须走 REST API' })
        }
        logger.warn({ ...logMeta, eventName }, '收到被禁止的写入类消息，已拒绝')
      })
    })

    logger.info(
      {
        pingInterval,
        pingTimeout,
      },
      'Socket.IO 实时传输底座已启动（单节点，内存 adapter）',
    )
  }

  /**
   * 应用关闭时优雅关闭 Socket.IO 服务器。
   */
  async shutdown() {
    if (this.io) {
      const sockets = await this.io.fetchSockets()
      const before = sockets.length
      this.io.close()
      this.clearAllTokenExpiryTimers()
      logger.info({ connectionsBeforeClose: before }, 'Socket.IO 服务器已关闭，连接已释放')
      this.io = null
    }
  }

  // ---- 握手认证中间件（设计 D3） ----

  /**
   * Socket.IO 握手认证中间件。
   * 从 `auth.token` 取 access token，用 TokenService 校验签名/有效期，
   * 再复刻 auth_middleware 即时失效语义（禁用用户 / roleVersion 失配）。
   *
   * 认证成功把 { userId, organizationId, roleVersion } 写入 socket.data。
   * 失败返回分类错误，禁止进入任何业务 room。
   */
  private async authMiddleware(
    socket: {
      handshake: { auth: Record<string, unknown>; headers: Record<string, unknown> }
      data: Record<string, unknown>
      emit: (event: string, ...args: unknown[]) => void
      disconnect: () => void
    },
    next: (err?: Error) => void,
  ) {
    try {
      const token = socket.handshake.auth?.token as string | undefined
      if (!token) {
        return next(new Error('AUTH_REQUIRED: 缺少访问令牌'))
      }

      // 动态加载 TokenService 避免循环依赖
      const { default: TokenService } = await import('#services/token_service')
      const tokenService = new TokenService()
      const payload = await tokenService.verifyAccessToken(token)

      const sub = Number(payload.sub)
      const organizationId = payload.organizationId ?? null
      const roleVersion = payload.roleVersion
      const tokenExpiresAt = typeof payload.exp === 'number' ? payload.exp : undefined

      if (!sub || !organizationId) {
        return next(new Error('AUTH_REQUIRED: 令牌负载无效'))
      }

      // 复刻即时失效：User.find(sub)，检查 isActive + roleVersion
      const { default: User } = await import('#models/user')
      const user = await User.find(sub)
      if (!user) {
        return next(new Error('AUTH_REQUIRED: 用户不存在'))
      }
      if (!user.isActive) {
        return next(new Error('ACCOUNT_INACTIVE: 账户已被禁用'))
      }
      if (user.roleVersion !== roleVersion) {
        return next(new Error('ROLE_VERSION_MISMATCH: 角色已变更，请刷新令牌'))
      }

      // 认证成功，绑定 payload 到 socket.data
      socket.data.userId = sub
      socket.data.organizationId = organizationId
      socket.data.roleVersion = roleVersion
      socket.data.tokenExpiresAt = tokenExpiresAt

      next()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('无效') || message.includes('过期')) {
        return next(new Error('AUTH_REQUIRED: 访问令牌无效或已过期'))
      }
      logger.warn({ error: message }, 'WebSocket 握手认证异常')
      return next(new Error('AUTH_REQUIRED: 认证失败'))
    }
  }

  // ---- Room 管理与授权（设计 D4） ----

  /**
   * 处理加入项目频道。
   * 1. 校验 organizationId 归属本连接
   * 2. 复用既有权限判定（PermissionService.canAccessProject）
   * 3. 满足条件则加入，否则返回分类错误
   */
  private async handleJoinProject(
    socket: {
      join: (room: string) => void
      data: Record<string, unknown>
      emit: (event: string, ...args: unknown[]) => void
    },
    data: { userId: number; organizationId: number; roleVersion: number },
    payload: { projectId: number },
    callback?: (res: { ok: boolean; error?: string }) => void,
  ) {
    try {
      const projectId = Number(payload.projectId)
      if (!projectId || !Number.isFinite(projectId)) {
        callback?.({ ok: false, error: 'VALIDATION_ERROR: 无效的项目 ID' })
        return
      }

      const orgId = data.organizationId
      const roomName = this.projectRoom(orgId, projectId)

      // 校验组织归属（结构性隔离：room 名含 orgId）
      if (!roomName.startsWith(`project:${orgId}:`)) {
        callback?.({ ok: false, error: 'PERMISSION_DENIED: 跨组织 room 不可加入' })
        return
      }

      // 校验用户对该项目有访问权（复用既有 RbacService 权限判定链）
      try {
        const { default: RbacService } = await import('#services/rbac_service')
        const rbacService = new RbacService()
        const { default: User } = await import('#models/user')
        const user = await User.find(data.userId)
        if (!user) {
          callback?.({ ok: false, error: 'AUTH_REQUIRED: 用户不存在' })
          return
        }
        const result = await rbacService.check(user, 'project:view' as never, orgId, projectId)
        if (!result.allowed) {
          callback?.({ ok: false, error: 'PERMISSION_DENIED: 无权访问该项目' })
          return
        }
      } catch {
        callback?.({ ok: false, error: 'PERMISSION_DENIED: 无权访问该项目' })
        return
      }

      socket.join(roomName)
      logger.info(
        { userId: data.userId, organizationId: orgId, projectId, room: roomName },
        '用户已加入项目频道',
      )
      callback?.({ ok: true })
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : 'unknown' }, '加入项目频道异常')
      callback?.({ ok: false, error: 'INTERNAL_ERROR: 加入项目频道失败' })
    }
  }

  /**
   * 处理离开项目频道。
   */
  private handleLeaveProject(
    socket: { leave: (room: string) => void; data: Record<string, unknown> },
    data: { userId: number; organizationId: number; roleVersion: number },
    payload: { projectId: number },
  ) {
    const projectId = Number(payload.projectId)
    if (!projectId || !Number.isFinite(projectId)) return
    const orgId = data.organizationId
    const roomName = this.projectRoom(orgId, projectId)
    socket.leave(roomName)
    logger.info(
      { userId: data.userId, organizationId: orgId, projectId, room: roomName },
      '用户已离开项目频道',
    )
  }

  // ---- Room 命名辅助 ----

  /** 项目频道 room 名（设计 D4）：`project:{organizationId}:{projectId}` */
  private projectRoom(organizationId: number, projectId: number): string {
    return `project:${organizationId}:${projectId}`
  }

  /** 用户个人频道 room 名：`user:{userId}` */
  private userRoom(userId: number): string {
    return `user:${userId}`
  }

  /** Compiler run 频道 room 名：`compiler-run:{organizationId}:{runId}` */
  private runRoom(organizationId: number, runId: number): string {
    return `compiler-run:${organizationId}:${runId}`
  }

  /**
   * 处理加入 Compiler run 频道（task 3.1-3.3）。
   */
  private async handleJoinCompilerRun(
    socket: {
      join: (room: string) => void
      data: Record<string, unknown>
      emit: (event: string, ...args: unknown[]) => void
    },
    data: { userId: number; organizationId: number; roleVersion: number },
    payload: { projectId: number; runId: number },
    callback?: (res: { ok: boolean; error?: string }) => void,
  ) {
    try {
      const runId = Number(payload.runId)
      const projectId = Number(payload.projectId)
      if (!runId || !Number.isFinite(runId)) {
        callback?.({ ok: false, error: 'VALIDATION_ERROR: 无效的 run ID' })
        return
      }
      if (!projectId || !Number.isFinite(projectId)) {
        callback?.({ ok: false, error: 'VALIDATION_ERROR: 无效的项目 ID' })
        return
      }

      const orgId = data.organizationId
      const roomName = this.runRoom(orgId, runId)

      // 结构隔离：room 名含 orgId
      if (!roomName.startsWith(`compiler-run:${orgId}:`)) {
        callback?.({ ok: false, error: 'PERMISSION_DENIED: 跨组织 room 不可加入' })
        return
      }

      // 校验项目访问权限
      try {
        const { default: RbacService } = await import('#services/rbac_service')
        const rbacService = new RbacService()
        const { default: User } = await import('#models/user')
        const user = await User.find(data.userId)
        if (!user) {
          callback?.({ ok: false, error: 'AUTH_REQUIRED: 用户不存在' })
          return
        }
        const result = await rbacService.check(user, 'project:view' as never, orgId, projectId)
        if (!result.allowed) {
          callback?.({ ok: false, error: 'PERMISSION_DENIED: 无权访问该项目' })
          return
        }
      } catch {
        callback?.({ ok: false, error: 'PERMISSION_DENIED: 无权访问该项目' })
        return
      }

      socket.join(roomName)
      logger.info(
        { userId: data.userId, organizationId: orgId, runId, room: roomName },
        '用户已加入 Compiler run 频道',
      )
      callback?.({ ok: true })
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : 'unknown' },
        '加入 Compiler run 频道异常',
      )
      callback?.({ ok: false, error: 'INTERNAL_ERROR: 加入 Compiler run 频道失败' })
    }
  }

  /**
   * 处理离开 Compiler run 频道（task 3）。
   */
  private handleLeaveCompilerRun(
    socket: { leave: (room: string) => void; data: Record<string, unknown> },
    data: { userId: number; organizationId: number; roleVersion: number },
    payload: { projectId: number; runId: number },
  ) {
    const runId = Number(payload.runId)
    if (!runId || !Number.isFinite(runId)) return
    const orgId = data.organizationId
    const roomName = this.runRoom(orgId, runId)
    socket.leave(roomName)
    logger.info(
      { userId: data.userId, organizationId: orgId, runId, room: roomName },
      '用户已离开 Compiler run 频道',
    )
  }

  // ── v2-5-streaming-websocket-service: Stream 控制消息 ───────────

  /**
   * 注册 stream 控制消息处理器。
   * 只在 Streaming WebSocket Service 启用时才注册。
   */
  private registerStreamControls(
    socket: {
      id: string
      join: (room: string) => void
      leave: (room: string) => void
      data: Record<string, unknown>
      emit: (event: string, ...args: unknown[]) => void
      on: (event: string, handler: (...args: any[]) => void) => void
    },
    data: { userId: number; organizationId: number; roleVersion: number },
    logMeta: Record<string, unknown>,
  ): void {
    if (!isStreamingWsEnabled()) return
    const orgId = data.organizationId
    const userId = data.userId

    // subscribe:stream —— 订阅长任务 stream
    socket.on(
      'subscribe:stream',
      async (
        payload: {
          domain: string
          streamId: string
          lastSequence?: number
          contractVersion?: string
        },
        callback?: (res: { ok: boolean; error?: string }) => void,
      ) => {
        try {
          const { domain, streamId } = payload
          if (!domain || !streamId) {
            callback?.({ ok: false, error: 'VALIDATION_ERROR: domain 和 streamId 为必填项' })
            return
          }

          const auth = await authorizeSubscription(userId, orgId, domain, streamId)
          if (!auth.allowed) {
            callback?.({ ok: false, error: `PERMISSION_DENIED: ${auth.reasonMessage}` })
            logger.warn(
              { ...logMeta, domain, streamId, reason: auth.reasonCode },
              'Stream 订阅被拒绝',
            )
            return
          }

          const room = buildStreamRoom(orgId, domain, streamId)
          socket.join(room)
          getOrCreateStream(streamId, domain, orgId)
          addSubscriber(streamId, domain, socket.id)

          callback?.({ ok: true })
          socket.emit('stream:subscribed', {
            streamId,
            domain,
            organizationId: orgId,
            expectedHeartbeatIntervalMs: 25_000,
            currentMaxSequence: 0,
          })
          logger.info({ ...logMeta, domain, streamId, room }, 'Stream 订阅成功')
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown'
          logger.warn({ ...logMeta, error: message }, 'Stream 订阅异常')
          callback?.({ ok: false, error: 'INTERNAL_ERROR: 订阅操作失败' })
        }
      },
    )

    // unsubscribe:stream —— 取消订阅
    socket.on('unsubscribe:stream', (payload: { domain: string; streamId: string }) => {
      const { domain, streamId } = payload
      if (!streamId) return
      const room = buildStreamRoom(orgId, domain ?? '', streamId)
      socket.leave(room)
      if (domain) removeSubscriber(streamId, domain, socket.id)
      logger.info({ ...logMeta, streamId }, 'Stream 取消订阅')
    })

    // resume:stream —— 从游标恢复
    socket.on(
      'resume:stream',
      async (
        payload: { streamId: string; lastSequence: number; contractVersion: string },
        callback?: (res: { ok: boolean; error?: string }) => void,
      ) => {
        try {
          const { streamId, lastSequence, contractVersion } = payload
          if (!streamId || !lastSequence || !contractVersion) {
            callback?.({ ok: false, error: 'VALIDATION_ERROR: 缺少恢复参数' })
            return
          }
          if (!isValidStreamId(streamId)) {
            callback?.({ ok: false, error: 'VALIDATION_ERROR: 无效的 streamId' })
            return
          }
          const replay = await getReplayResponse(streamId, '', lastSequence, contractVersion)
          if (replay.resetRequired) {
            socket.emit('stream:reset-required', {
              streamId,
              reasonCode: replay.resetMessage ?? 'REPLAY_UNAVAILABLE',
              reasonMessage: 'Replay 不可用，请通过 REST/SSE 获取权威状态',
            })
            callback?.({ ok: false, error: `RESET_REQUIRED: ${replay.resetMessage}` })
            return
          }
          for (const envelope of replay.events) {
            socket.emit('stream:event', envelope)
          }
          callback?.({ ok: true })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown'
          logger.warn({ ...logMeta, error: message }, 'Stream resume 异常')
          callback?.({ ok: false, error: 'INTERNAL_ERROR: 恢复操作失败' })
        }
      },
    )

    // ack:stream —— 客户端确认
    socket.on('ack:stream', (payload: { streamId: string; sequence: number }) => {
      logger.debug(
        { ...logMeta, streamId: payload.streamId, sequence: payload.sequence },
        'Stream ack 已接收',
      )
    })

    // client:heartbeat —— 客户端心跳
    socket.on(
      'client:heartbeat',
      (callback?: (res: { timestamp: string; serverTime: number }) => void) => {
        callback?.({ timestamp: new Date().toISOString(), serverTime: Date.now() })
      },
    )

    // status:stream —— 流状态查询
    socket.on(
      'status:stream',
      (
        payload: { streamId: string },
        callback?: (res: { ok: boolean; status?: string; error?: string }) => void,
      ) => {
        if (!payload?.streamId) {
          callback?.({ ok: false, error: 'VALIDATION_ERROR: 缺少 streamId' })
          return
        }
        callback?.({ ok: true, status: 'active' })
      },
    )

    // diagnostics:stream —— 服务诊断信息
    socket.on('diagnostics:stream', (callback?: (res: Record<string, unknown>) => void) => {
      callback?.(getStreamingServiceDiagnostics() as unknown as Record<string, unknown>)
    })
  }

  private isWriteEvent(eventName: string): boolean {
    return /^(write:|apply:|sync:|external:|deploy:|publish:|package-manager:|repository:|create:|update:|delete:|patch:|mutate:)/.test(
      eventName,
    )
  }

  private scheduleTokenExpiryDisconnect(
    socket: { id: string; disconnect: (close?: boolean) => void },
    tokenExpiresAt: number | undefined,
    logMeta: Record<string, unknown>,
  ): void {
    if (!tokenExpiresAt) return

    const delayMs = this.tokenExpiryDelayMs(tokenExpiresAt)
    const timer = setTimeout(() => {
      logger.info(logMeta, 'WebSocket access token 已到期，断开连接以触发客户端刷新重连')
      socket.disconnect(true)
      this.clearTokenExpiryTimer(socket.id)
    }, delayMs)

    this.tokenExpiryTimers.set(socket.id, timer)
  }

  private tokenExpiryDelayMs(tokenExpiresAt: number, nowMs = Date.now()): number {
    return Math.max(tokenExpiresAt * 1000 - nowMs, 0)
  }

  private clearTokenExpiryTimer(socketId: string): void {
    const timer = this.tokenExpiryTimers.get(socketId)
    if (!timer) return

    clearTimeout(timer)
    this.tokenExpiryTimers.delete(socketId)
  }

  private clearAllTokenExpiryTimers(): void {
    for (const timer of this.tokenExpiryTimers.values()) {
      clearTimeout(timer)
    }
    this.tokenExpiryTimers.clear()
  }
}
