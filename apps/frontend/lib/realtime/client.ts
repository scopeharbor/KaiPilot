/**
 * Socket.IO 实时客户端封装（design D8）。
 *
 * 职责：
 * - 从 auth-store 取 access token 以 `auth.token` 连接
 * - 指数退避重连（有上限）
 * - 令牌过期先复用既有刷新流程再重连
 * - 暴露最小连接状态与事件订阅
 *
 * 使用方式：
 * ```ts
 * const client = new RealtimeClient()
 * client.connect()
 * client.joinProject(projectId)
 * client.on('realtime:event', (event) => { ... })
 * client.disconnect()
 * ```
 */

import { io, type Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth-store'
import { API_BASE_URL, refreshSession } from '@/lib/api-client'

/**
 * 事件类型枚举，与后端 realtime_events.ts 同步。
 */
export const RealtimeEventTypes = {
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_STATUS_CHANGED: 'task:status_changed',
  TASK_DELETED: 'task:deleted',
  TASK_RESTORED: 'task:restored',
  RESOURCE_INVALIDATED: 'resource:invalidated',
  // V2 通知中心事件
  NOTIFICATION_ARRIVED: 'notification:arrived',
  NOTIFICATION_READ_STATUS_CHANGED: 'notification:read_status_changed',
  NOTIFICATION_BATCH_PROCESSED: 'notification:batch_processed',
  NOTIFICATION_HIDDEN_STATUS_CHANGED: 'notification:hidden_status_changed',
} as const

/** 服务端 → 客户端事件封套 */
export interface RealtimeEventEnvelope {
  type: string
  projectId: number
  entityId: number
  actorId: number
  occurredAt: string
  metadata?: Record<string, unknown>
}

/** 连接状态 */
export type RealtimeConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

/** 重连配置 */
const RECONNECTION_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]
const MAX_RECONNECTION_DELAY = 30000

/**
 * 从 API_BASE_URL 提取 WebSocket 地址。
 * 生产环境应使用 NEXT_PUBLIC_WS_URL 或从 API_BASE_URL 派生。
 *
 * v3-docker-compose-runtime-foundation（design D4 / task 4.4）：
 * 当 NEXT_PUBLIC_API_URL 为相对同源路径（如 `/api/v1`）时，API_BASE_URL 没有绝对基址，
 * 此时从当前浏览器 origin 推导 ws(s):// 地址——edge 代理把 `/socket.io` 转发到内部
 * backend，因此目标主机换 IP/域名无需 rebuild。SSR/非浏览器环境无 location，返回空串
 * 让 socket.io 回退默认同源解析（connect 仅在浏览器侧触发）。
 */
export function getWsUrl(): string {
  // API_BASE_URL 是 http://.../api/v1 或相对路径 /api/v1，需要去掉 /api/v1
  const base = API_BASE_URL.replace(/\/api\/v1\/?$/, '')
  if (base === '' || base.startsWith('/')) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin.replace(/^http/, 'ws')
    }
    return ''
  }
  return base.replace(/^http/, 'ws')
}

/** 回退延迟计算（指数退避） */
function getBackoffDelay(attempt: number): number {
  const index = Math.min(attempt, RECONNECTION_DELAYS.length - 1)
  return Math.min(RECONNECTION_DELAYS[index] ?? MAX_RECONNECTION_DELAY, MAX_RECONNECTION_DELAY)
}

export class RealtimeClient {
  private socket: Socket | null = null
  private connectionStatus: RealtimeConnectionStatus = 'disconnected'
  private statusListeners: Set<(status: RealtimeConnectionStatus) => void> = new Set()
  private eventListeners: Map<string, Set<(data: unknown) => void>> = new Map()
  private reconnectionAttempts = 0
  private shouldReconnect = true
  private currentProjectId: number | null = null

  /** 当前连接状态 */
  get status(): RealtimeConnectionStatus {
    return this.connectionStatus
  }

  /** 是否已连接 */
  get connected(): boolean {
    return this.socket?.connected ?? false
  }

  // ---- 生命周期 ----

  /**
   * 建立连接。从 auth-store 取 access token 传入。
   * 连接成功后自动加入之前加入的项目频道。
   */
  connect(): void {
    if (this.socket?.connected) return

    this.shouldReconnect = true
    this.setStatus('connecting')

    const token = useAuthStore.getState().accessToken
    if (!token) {
      // 无 token 时尝试等 auth-store 初始化完成
      const unsubscribe = useAuthStore.subscribe((state) => {
        if (state.accessToken && this.shouldReconnect) {
          unsubscribe()
          this.connect()
        }
      })
      return
    }

    const wsUrl = getWsUrl()
    this.socket = io(wsUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: false, // 我们手动控制重连
      timeout: 30000,
    })

    this.socket.on('connect', () => {
      this.reconnectionAttempts = 0
      this.setStatus('connected')

      // 重连成功后重新加入项目频道
      if (this.currentProjectId !== null) {
        this.joinProject(this.currentProjectId)
      }
    })

    this.socket.on('disconnect', (reason) => {
      this.setStatus('disconnected')
      if (this.shouldReconnect && reason !== 'io client disconnect') {
        this.scheduleReconnect()
      }
    })

    this.socket.on('connect_error', async (error) => {
      // 令牌过期：尝试刷新后重试
      if (error.message?.includes('AUTH_REQUIRED') || error.message?.includes('invalid token')) {
        try {
          const refreshed = await refreshSession()
          if (refreshed && this.socket) {
            const newToken = useAuthStore.getState().accessToken
            this.socket.auth = { token: newToken }
            this.socket.connect()
            return
          }
        } catch {
          // 刷新失败，继续重连
        }
      }
      this.setStatus('reconnecting')
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    })

    // 转发服务端事件
    this.socket.on('realtime:event', (data: unknown) => this.handleServerEvent(data))
  }

  /**
   * 断开连接并停止重连。
   */
  disconnect(): void {
    this.shouldReconnect = false
    this.currentProjectId = null
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.setStatus('disconnected')
  }

  // ---- Room 管理 ----

  /**
   * 加入项目频道。
   * 发送 join:project 控制消息，附带 ack 回调。
   */
  joinProject(projectId: number): Promise<boolean> {
    this.currentProjectId = projectId
    if (!this.socket?.connected) return Promise.resolve(false)

    return new Promise((resolve) => {
      this.socket!.emit('join:project', { projectId }, (res: { ok: boolean; error?: string }) => {
        resolve(res.ok)
      })
    })
  }

  /**
   * 离开项目频道。
   */
  leaveProject(projectId: number): void {
    if (this.currentProjectId === projectId) {
      this.currentProjectId = null
    }
    this.socket?.emit('leave:project', { projectId })
  }

  // ---- 事件订阅 ----

  /**
   * 订阅服务端事件。返回取消订阅函数。
   */
  on(event: string, handler: (data: RealtimeEventEnvelope) => void): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(handler as (data: unknown) => void)
    return () => {
      this.eventListeners.get(event)?.delete(handler as (data: unknown) => void)
    }
  }

  /**
   * 订阅连接状态变更。返回取消订阅函数。
   */
  onStatusChange(handler: (status: RealtimeConnectionStatus) => void): () => void {
    this.statusListeners.add(handler)
    return () => this.statusListeners.delete(handler)
  }

  /**
   * 服务端事件入口：派发给 'realtime:event' 通用监听者，并按事件自身 type 再派发一次——
   * 按类型订阅的监听者（如 notification:arrived）此前永远收不到，通知只能靠刷新页面。
   */
  handleServerEvent(data: unknown): void {
    this.dispatchEvent('realtime:event', data)
    const type = (data as { type?: unknown } | null)?.type
    if (typeof type === 'string' && type !== 'realtime:event') this.dispatchEvent(type, data)
  }

  // ---- 内部 ----

  private setStatus(status: RealtimeConnectionStatus): void {
    this.connectionStatus = status
    this.statusListeners.forEach((handler) => handler(status))
  }

  private dispatchEvent(event: string, data: unknown): void {
    this.eventListeners.get(event)?.forEach((handler) => handler(data))
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    const delay = getBackoffDelay(this.reconnectionAttempts)
    this.reconnectionAttempts++
    this.setStatus('reconnecting')

    setTimeout(() => {
      if (!this.shouldReconnect) return
      const token = useAuthStore.getState().accessToken
      if (!token) {
        // 无 token 时等 auth-store 初始化
        return
      }
      if (this.socket) {
        this.socket.auth = { token }
        this.socket.connect()
      } else {
        this.connect()
      }
    }, delay)
  }
}

/** 单例 */
let instance: RealtimeClient | null = null

export function getRealtimeClient(): RealtimeClient {
  if (!instance) {
    instance = new RealtimeClient()
  }
  return instance
}

export function resetRealtimeClient(): void {
  if (instance) {
    instance.disconnect()
    instance = null
  }
}
