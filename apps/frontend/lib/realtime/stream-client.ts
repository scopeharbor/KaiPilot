import { getRealtimeClient, RealtimeClient } from './client'
import type { Socket } from 'socket.io-client'

export type StreamConnectionStatus =
  'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

export interface StreamEventCallback {
  onEvent?: (envelope: unknown) => void
  onLog?: (log: unknown) => void
  onStatus?: (status: unknown) => void
  onResetRequired?: (reset: unknown) => void
  onSubscribed?: (sub: unknown) => void
}

export class StreamClient {
  private callbacks: Map<string, StreamEventCallback> = new Map()

  get client(): RealtimeClient {
    return getRealtimeClient()
  }

  /** 取底层 socket.io 连接（RealtimeClient 将 socket 设为 private，此处经结构化转型访问）。 */
  private resolveSocket(): Socket | null {
    return (this.client as unknown as { socket: Socket | null }).socket
  }

  subscribe(
    domain: string,
    streamId: string,
    lastSequence?: number,
    callbacks?: StreamEventCallback,
  ): boolean {
    const socket = this.resolveSocket()
    if (!socket?.connected) return false
    if (callbacks) {
      this.callbacks.set(streamId, callbacks)
    }
    const payload: Record<string, unknown> = { domain, streamId }
    if (lastSequence !== undefined) payload.lastSequence = lastSequence
    socket.emit('subscribe:stream', payload, (res: { ok: boolean; error?: string }) => {
      if (res.ok) {
        this.setupStreamListeners(socket, streamId)
      }
    })
    return true
  }

  private setupStreamListeners(socket: Socket, streamId: string): void {
    const cb = this.callbacks.get(streamId)
    if (!cb) return
    if (cb.onEvent) socket.on('stream:event', cb.onEvent)
    if (cb.onLog) socket.on('stream:log', cb.onLog)
    if (cb.onResetRequired) socket.on('stream:reset-required', cb.onResetRequired)
    if (cb.onSubscribed) socket.on('stream:subscribed', cb.onSubscribed)
  }

  unsubscribe(streamId: string, domain?: string): void {
    this.callbacks.delete(streamId)
    const socket = this.resolveSocket()
    if (socket?.connected) {
      socket.emit('unsubscribe:stream', { streamId, domain: domain ?? '' })
    }
  }

  resume(
    streamId: string,
    lastSequence: number,
    contractVersion: string,
    callbacks?: StreamEventCallback,
  ): boolean {
    const socket = this.resolveSocket()
    if (!socket?.connected) return false
    if (callbacks) this.callbacks.set(streamId, callbacks)
    this.setupStreamListeners(socket, streamId)
    socket.emit(
      'resume:stream',
      { streamId, lastSequence, contractVersion },
      (res: { ok: boolean; error?: string }) => {
        if (!res.ok && callbacks?.onResetRequired) {
          callbacks.onResetRequired({
            streamId,
            reasonCode: 'RESUME_FAILED',
            reasonMessage: res.error ?? 'Unknown error',
          })
        }
      },
    )
    return true
  }

  ack(streamId: string, sequence: number): void {
    const socket = this.resolveSocket()
    if (socket?.connected) {
      socket.emit('ack:stream', { streamId, sequence })
    }
  }

  sendHeartbeat(): void {
    const socket = this.resolveSocket()
    if (socket?.connected) {
      socket.emit('client:heartbeat', () => {})
    }
  }

  getStatus(streamId: string): void {
    const socket = this.resolveSocket()
    if (socket?.connected) {
      socket.emit('status:stream', { streamId }, () => {})
    }
  }

  disconnect(): void {
    this.callbacks.clear()
  }
}

let streamClientInstance: StreamClient | null = null
export function getStreamClient(): StreamClient {
  if (!streamClientInstance) streamClientInstance = new StreamClient()
  return streamClientInstance
}
export function resetStreamClient(): void {
  if (streamClientInstance) {
    streamClientInstance.disconnect()
    streamClientInstance = null
  }
}
