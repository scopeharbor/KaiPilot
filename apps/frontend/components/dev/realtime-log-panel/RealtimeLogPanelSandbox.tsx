'use client'

/**
 * RealtimeLogPanelSandbox —— v2-5-streaming-realtime-log-panel 浏览器核对沙箱。
 *
 * 不连真实 stream client（避免依赖后端 / WebSocket 连接）；用本地定时器模拟日志流喂入
 * useRealtimeLogPanelState，核对：渲染、severity 过滤、自动滚动/暂停、gap/恢复态、
 * 空态、feature-off、无敏感字段落 DOM、无 JS 错误。
 *
 * 抛弃型 dev 脚手架：归档后可移除，仅组件/hook/log-buffer 留存。
 */

import { useEffect, useState } from 'react'
import { RealtimeLogPanel } from '@/components/realtime/realtime-log-panel'
import { useRealtimeLogPanelState } from '@/hooks/use-realtime-log-panel-state'
import { Button } from '@/components/ui/Button'
import type { RealtimeLogEvent } from '@aiproj/types'

const STAGES = ['charter', 'wbs', 'tasks', 'dependencies', 'acceptance']
const CODES = ['stage.started', 'stage.completed', 'stage.retried', 'stage.failed']
const SEVERITIES = ['info', 'warn', 'error'] as const

let tick = 0

function nextLogEvent(): RealtimeLogEvent {
  tick += 1
  const stage = STAGES[tick % STAGES.length] ?? 'charter'
  const severity = SEVERITIES[tick % SEVERITIES.length] ?? 'info'
  const messageCode = CODES[tick % CODES.length] ?? 'stage.started'
  return {
    streamId: 'demo-stream',
    stageId: stage,
    phase: 'running',
    attempt: (tick % 3) + 1,
    severity,
    messageCode,
    count: tick,
    durationMs: 100 + ((tick * 37) % 900),
    safeRefs: [`ref-${tick}`],
    hash: `${tick.toString(16).padStart(8, '0')}`.repeat(8).slice(0, 16),
    timestamp: new Date(Date.now()).toISOString(),
  }
}

export function RealtimeLogPanelSandbox() {
  const [enabled, setEnabled] = useState(true)
  const [streaming, setStreaming] = useState(false)
  const panel = useRealtimeLogPanelState('demo-stream', 'ai-draft')

  useEffect(() => {
    if (!streaming) return
    const id = setInterval(() => {
      panel.ingestLog(nextLogEvent())
    }, 800)
    return () => clearInterval(id)
  }, [streaming, panel])

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">实时日志面板 · 浏览器核对沙箱</h1>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => setStreaming((s) => !s)}>
          {streaming ? '暂停日志流' : '启动日志流'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => panel.ingestLog(nextLogEvent())}>
          追加一条
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // 先正常 sequence=1，再跳到 999 触发 SEQUENCE_GAP（reduceStreamEnvelope gap 语义）
            panel.ingestEnvelope({
              domain: 'ai-draft',
              streamId: 'demo-stream',
              sequence: 1,
              type: 'progress',
              payload: {},
              contractVersion: 'v1',
              occurredAt: new Date().toISOString(),
            } as never)
            panel.ingestEnvelope({
              domain: 'ai-draft',
              streamId: 'demo-stream',
              sequence: 999,
              type: 'progress',
              payload: {},
              contractVersion: 'v1',
              occurredAt: new Date().toISOString(),
            } as never)
          }}
        >
          模拟序列缺口
        </Button>
        <Button variant="ghost" size="sm" onClick={() => panel.reset('RESET')}>
          重置缓冲
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEnabled((e) => !e)}>
          {enabled ? 'feature-off' : 'feature-on'}
        </Button>
      </div>

      <RealtimeLogPanel
        logBuffer={panel.logBuffer}
        needsReset={panel.needsReset}
        disconnected={panel.disconnected}
        enabled={enabled}
        viewportHeight={360}
      />

      <p className="text-xs text-muted-foreground">
        核对项：日志行渲染（messageCode 人读标签 / stage / attempt / severity / 耗时 / 计数 / hash /
        时间戳）；severity 过滤按钮（带计数，纯展示不改缓冲）；自动滚动跟随 + 上滚暂停 +
        「最新」入口；序列缺口 → 冻结提示 + 恢复态；feature-off → 面板消失；无敏感字段落 DOM。
      </p>
    </div>
  )
}
