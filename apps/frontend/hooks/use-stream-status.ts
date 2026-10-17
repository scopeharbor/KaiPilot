'use client'
import { useState, useEffect, useCallback } from 'react'
import { getStreamClient, type StreamConnectionStatus } from '@/lib/realtime/stream-client'

export interface StreamStatusState {
  status: StreamConnectionStatus
  activeStreams: number
  isReconnecting: boolean
}

export function useStreamConnectionStatus(): StreamStatusState {
  const [status, setStatus] = useState<StreamConnectionStatus>('idle')
  const [activeStreams] = useState(0)
  useEffect(() => {
    const client = getStreamClient()
    const unsubscribe = client.client.onStatusChange((s) => {
      setStatus(s as StreamConnectionStatus)
    })
    return () => unsubscribe()
  }, [])
  return {
    status,
    activeStreams,
    isReconnecting: status === 'reconnecting' || status === 'connecting',
  }
}

export interface StreamRecoveryState {
  needsRecovery: boolean
  recoveryState: 'none' | 'gap' | 'replaying' | 'reset-required'
  resetToRest: () => void
}

export function useStreamRecovery(_streamId?: string): StreamRecoveryState {
  const [needsRecovery] = useState(false)
  const [recoveryState] = useState<'none' | 'gap' | 'replaying' | 'reset-required'>('none')
  const resetToRest = useCallback(() => {}, [])
  return { needsRecovery, recoveryState, resetToRest }
}
