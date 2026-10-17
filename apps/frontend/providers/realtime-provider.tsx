'use client'

/**
 * RealtimeProvider — 实时连接生命周期管理（design D8）。
 *
 * 在应用挂载时建立 WebSocket 连接，在卸载时断开连接。
 * 连接状态通过 context 暴露。
 *
 * 不引入新的全局状态范式：令牌/刷新复用 auth-store 与既有流程。
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import {
  getRealtimeClient,
  type RealtimeClient,
  type RealtimeConnectionStatus,
} from '@/lib/realtime/client'

interface RealtimeContextValue {
  /** 当前连接状态 */
  status: RealtimeConnectionStatus
  /** 是否已连接 */
  connected: boolean
  /** 获取实时客户端单例 */
  client: RealtimeClient | null
}

const RealtimeContext = createContext<RealtimeContextValue>({
  status: 'disconnected',
  connected: false,
  client: null,
})

export function useRealtimeContext(): RealtimeContextValue {
  return useContext(RealtimeContext)
}

interface RealtimeProviderProps {
  children: ReactNode
}

export function RealtimeProvider({ children }: RealtimeProviderProps) {
  const [status, setStatus] = useState<RealtimeConnectionStatus>('disconnected')
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const clientRef = useRef<RealtimeClient | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return

    const client = getRealtimeClient()
    clientRef.current = client

    // 监听状态变更
    const unsubStatus = client.onStatusChange(setStatus)

    // 建立连接
    client.connect()

    return () => {
      unsubStatus()
      // 注意：不在 unmount 时断连接——Provider 在根级别，页面切换不应断连
    }
  }, [isAuthenticated])

  const value: RealtimeContextValue = {
    status,
    connected: status === 'connected',
    client: clientRef.current,
  }

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}
