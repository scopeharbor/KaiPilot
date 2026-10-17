'use client'

import { useEffect, useRef } from 'react'
import { useCompilerProgressStore } from '@/lib/compiler/compiler-progress-store'
import { useRealtimeContext } from '@/providers/realtime-provider'
import type { RealtimeEventEnvelope } from '@/lib/realtime/client'
import type { StreamingProgressEnvelope } from '@aiproj/types/progress-streaming'

const COMPILER_EVENT_TYPE = 'compiler:progress'

interface CompilerRealtimeEventEnvelope extends RealtimeEventEnvelope {
  envelope?: StreamingProgressEnvelope
}

/**
 * useCompilerProgress —— 订阅 Compiler 实时进度事件并投影到 progress store。
 *
 * 在 Compiler run 详情页或观测摘要组件中使用。
 * 自动处理：连接/断开、gap 暂停、REST fallback。
 */
export function useCompilerProgress(projectId: number | undefined, runId: number | undefined) {
  const { client, connected } = useRealtimeContext()
  const applyEnvelope = useCompilerProgressStore((s) => s.applyEnvelope)
  const setDisconnected = useCompilerProgressStore((s) => s.setDisconnected)
  const markHeartbeatStale = useCompilerProgressStore((s) => s.markHeartbeatStale)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 订阅实时事件
  useEffect(() => {
    if (!projectId || !runId || !client || !connected) return

    const unsub = client.on('realtime:event', (event: RealtimeEventEnvelope) => {
      if (event.projectId !== projectId) return
      if (event.type !== COMPILER_EVENT_TYPE) return

      // 从 event payload 中提取 StreamingProgressEnvelope
      const envelope = (event as CompilerRealtimeEventEnvelope).envelope
      if (!envelope) return

      applyEnvelope(envelope)
    })

    return () => {
      unsub()
    }
  }, [projectId, runId, client, connected, applyEnvelope])

  // 连接状态跟踪
  useEffect(() => {
    if (!runId) return

    if (!connected) {
      setDisconnected(runId)
    }
  }, [connected, runId, setDisconnected])

  // Heartbeat 超时检测
  useEffect(() => {
    if (!runId) return

    // 30 秒无事件标记 stale
    heartbeatRef.current = setInterval(() => {
      const state = useCompilerProgressStore.getState().getRunState(runId)
      if (!state) return

      const now = Date.now()
      const lastEvent = state.lastEventTime ? new Date(state.lastEventTime).getTime() : 0
      if (now - lastEvent > 30_000 && state.overallStatus === 'running') {
        markHeartbeatStale(runId)
      }
    }, 10_000)

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [runId, markHeartbeatStale])
}

/**
 * 获取 Compiler run 的当前进度状态。
 */
export function useCompilerRunState(runId: number | undefined) {
  return useCompilerProgressStore((s) => (runId ? s.getRunState(runId) : undefined))
}
