import { io, type ManagerOptions, type SocketOptions } from 'socket.io-client'

export interface SocketIoAuthProbeResult {
  ok: boolean
  outcome: 'auth-rejected' | 'connected' | 'transport-error' | 'timeout'
  detail: string
}

interface ProbeSocket {
  once(event: 'connect', listener: () => void): this
  once(event: 'connect_error', listener: (error: Error) => void): this
  connect(): this
  disconnect(): this
  removeAllListeners(): this
}

export type SocketIoProbeClientFactory = (
  uri: string,
  options: Partial<ManagerOptions & SocketOptions>,
) => ProbeSocket

export interface SocketIoAuthProbeOptions {
  timeoutMs?: number
  clientFactory?: SocketIoProbeClientFactory
}

const AUTH_REJECTION = /AUTH_REQUIRED|unauthori[sz]ed|认证|令牌/i

function boundedMessage(error: Error): string {
  return error.message.replace(/[\r\n]+/g, ' ').slice(0, 160) || error.name
}

/**
 * 完成真正的 Socket.IO CONNECT，而不是只请求 Engine.IO polling handshake。
 * 无 token client 只有收到 auth 分类的 connect_error 才算通过；transport/proxy 错误、
 * 意外 connect 或 timeout 都失败。无论结果如何都移除监听器、断开 client 并清理 timer。
 */
export async function probeUnauthenticatedSocketIoConnect(
  origin: string,
  options: SocketIoAuthProbeOptions = {},
): Promise<SocketIoAuthProbeResult> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const createClient = options.clientFactory ?? (io as SocketIoProbeClientFactory)
  const socket = createClient(origin, {
    path: '/socket.io',
    transports: ['polling'],
    auth: {},
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    timeout: timeoutMs,
  })

  return new Promise((resolve) => {
    let settled = false
    // const 声明在 listener 注册之后、connect() 之前：任何事件回调都只能在
    // connect() 后触发，彼时 timer 必已初始化（finish 内的 clearTimeout 安全）。
    const timer = setTimeout(() => {
      finish({
        ok: false,
        outcome: 'timeout',
        detail: `Socket.IO CONNECT 在 ${timeoutMs}ms 内无认证结果`,
      })
    }, timeoutMs)

    function finish(result: SocketIoAuthProbeResult) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.disconnect()
      resolve(result)
    }

    socket.once('connect', () => {
      finish({
        ok: false,
        outcome: 'connected',
        detail: '未认证 client 意外建立 application socket connection',
      })
    })
    socket.once('connect_error', (error) => {
      const message = boundedMessage(error)
      finish(
        AUTH_REJECTION.test(message)
          ? {
              ok: true,
              outcome: 'auth-rejected',
              detail: `Socket.IO CONNECT 被认证中间件拒绝（${message}）`,
            }
          : {
              ok: false,
              outcome: 'transport-error',
              detail: `Socket.IO CONNECT 未得到认证拒绝（${message}）`,
            },
      )
    })

    socket.connect()
  })
}
