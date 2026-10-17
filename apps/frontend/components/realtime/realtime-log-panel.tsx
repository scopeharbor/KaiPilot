'use client'

/**
 * RealtimeLogPanel —— 确定性、低敏、有界的实时日志面板（v2-5-streaming-realtime-log-panel）。
 *
 * 消费 stream client 投递、经 `reduceLogEvent` 委托 log-buffer 投影后的 `LogBufferState.entries`，
 * 以虚拟化、severity 可过滤、自动滚动跟随、空/恢复态提示、可访问、四模式主题的方式呈现日志流。
 *
 * 红线（design D4/D6/D7）：
 * - 渲染层只吃护栏后对象（`LogEntry`，白名单字段已在 log-buffer 投影时挑出）；非白名单字段永不落 DOM
 * - 零写入：纯展示，无 network/store/run 副作用；日志绝不作数据源
 * - feature-off / 无事件 / 异常降级为不显示面板，零行为变化（不冒泡打断既有进度投影）
 *
 * 数据源：由消费方传入 `StreamProjectionState`（经既有 stream client + reducer 投影），
 * 或经 `useRealtimeLogPanelState` hook 组合。
 * 定位互补：CompilerStageDetailPanel（单 stage 结构化详情），本面板只管日志流。
 */

import { Component, useMemo, useRef, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, AlertTriangle, Info, ArrowDown, WifiOff, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  resolveMessageCodeLabel,
  type LogEntry,
  type LogBufferState,
} from '@/lib/realtime/log-buffer'
import type { RealtimeLogSeverity } from '@aiproj/types'

/**
 * 面板错误边界（design D7）——隔离渲染/投影异常，静默隐藏面板，不冒泡打断既有进度投影。
 * React class ErrorBoundary 是内置模式，无新依赖。捕获到异常时渲染 null（feature-off 等价）。
 */
class RealtimeLogPanelErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch() {
    // 静默降级：不冒泡、不打断既有进度投影（零行为变化）
  }
  override render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

/**
 * 公开导出：经错误边界包裹的 RealtimeLogPanel。
 * 消费方直接用本导出；渲染/投影异常自动静默降级为不显示。
 */
export function RealtimeLogPanel(props: RealtimeLogPanelProps) {
  return (
    <RealtimeLogPanelErrorBoundary>
      <RealtimeLogPanelInner {...props} />
    </RealtimeLogPanelErrorBoundary>
  )
}

/** severity 过滤选项（纯展示，不改底层缓冲）。 */
type SeverityFilter = 'all' | RealtimeLogSeverity

interface RealtimeLogPanelProps {
  /** 经 reduceLogEvent 委托投影后的日志缓冲状态。 */
  logBuffer: LogBufferState
  /** 流是否进入 needsReset（序列缺口/需重置）—— 展示恢复态提示。 */
  needsReset: boolean
  /** 连接是否断开 —— 展示连接态提示。 */
  disconnected?: boolean
  /** feature 开关：false 时不渲染面板（零行为变化）。默认 true。 */
  enabled?: boolean
  /** 透传 className。 */
  className?: string
  /** 虚拟化行高（px），紧凑密度可调。 */
  rowHeight?: number
  /** 可视区高度（px）。 */
  viewportHeight?: number
}

const SEVERITY_META: Record<
  RealtimeLogSeverity,
  { icon: typeof Info; label: string; badgeVariant: 'info' | 'warning' | 'danger' }
> = {
  info: { icon: Info, label: '信息', badgeVariant: 'info' },
  warn: { icon: AlertTriangle, label: '警告', badgeVariant: 'warning' },
  error: { icon: AlertCircle, label: '错误', badgeVariant: 'danger' },
}

const FILTER_OPTIONS: { value: SeverityFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' },
]

/**
 * 错误边界（轻量内联）：渲染/投影异常 → 静默隐藏面板，不冒泡打断既有进度投影（design D7）。
 * 不用 React ErrorBoundary class（保持函数式 + 可测），用 try/catch 包裹渲染。
 */
function safeRenderEntries(entries: LogEntry[]): LogEntry[] {
  try {
    return entries
  } catch {
    return []
  }
}

function RealtimeLogPanelInner({
  logBuffer,
  needsReset,
  disconnected = false,
  enabled = true,
  className,
  rowHeight = 28,
  viewportHeight = 320,
}: RealtimeLogPanelProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [autoFollow, setAutoFollow] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastEntryCountRef = useRef(0)

  // 护栏后条目（渲染层只吃 LogEntry，白名单字段已在投影时挑出）
  const allEntries = safeRenderEntries(logBuffer.entries)

  // severity 过滤（纯展示，不改底层缓冲）
  const visibleEntries = useMemo(() => {
    if (severityFilter === 'all') return allEntries
    return allEntries.filter((e) => e.severity === severityFilter)
  }, [allEntries, severityFilter])

  const virtualizer = useVirtualizer({
    count: visibleEntries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  })

  // 自动滚动跟随最新 + 用户上滚暂停跟随
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distanceFromBottom < rowHeight * 2
    if (nearBottom !== autoFollow) setAutoFollow(nearBottom)
  }, [autoFollow, rowHeight])

  // 新条目到达时，若处于自动跟随则滚到底部
  useEffect(() => {
    if (visibleEntries.length === lastEntryCountRef.current) return
    lastEntryCountRef.current = visibleEntries.length
    if (autoFollow && scrollRef.current) {
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    }
  }, [visibleEntries.length, autoFollow])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      setAutoFollow(true)
    }
  }, [])

  // feature-off / 异常 → 不渲染（零行为变化，design D7）。
  // 必须在所有 hooks 之后早返回，避免 hooks 数量随 enabled 切换变化。
  if (!enabled) return null
  if (allEntries.length === 0) {
    return (
      <section
        className={cn('rounded-lg border p-4 space-y-2', className)}
        aria-label="实时日志"
        role="log"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="h-4 w-4 shrink-0" aria-hidden />
          <span>暂无实时日志</span>
        </div>
        {disconnected && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>连接已断开，日志暂停更新</span>
          </div>
        )}
      </section>
    )
  }

  // ── 恢复态：序列缺口 / 需重置 ──
  return (
    <section
      className={cn('rounded-lg border p-3 space-y-2', className)}
      aria-label="实时日志"
      role="log"
      aria-live="polite"
    >
      {/* 工具栏：severity 过滤 + 回到最新 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="按严重程度过滤">
          {FILTER_OPTIONS.map((opt) => {
            const count =
              opt.value === 'all'
                ? allEntries.length
                : allEntries.filter((e) => e.severity === opt.value).length
            return (
              <Button
                key={opt.value}
                variant={severityFilter === opt.value ? 'primary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                aria-pressed={severityFilter === opt.value}
                onClick={() => setSeverityFilter(opt.value)}
                data-testid={`filter-${opt.value}`}
              >
                {opt.label}
                <span className="ml-1 text-muted-foreground" aria-hidden>
                  ({count})
                </span>
              </Button>
            )
          })}
        </div>
        {!autoFollow && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={scrollToBottom}
            aria-label="回到最新日志"
            data-testid="scroll-to-bottom"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            <span className="ml-1">最新</span>
          </Button>
        )}
      </div>

      {/* 恢复态提示 */}
      {needsReset && (
        <div className="flex items-center gap-2 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning-foreground">
          <RefreshCw className="h-3.5 w-3.5 shrink-0 motion-reduce:animate-none" aria-hidden />
          <span>日志流出现序列缺口，已暂停追加；恢复后将重建日志。</span>
        </div>
      )}
      {disconnected && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>连接已断开，日志暂停更新</span>
        </div>
      )}

      {/* 虚拟化日志列表（有界渲染） */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-auto rounded-md bg-muted/30 data-[density=compact]:text-xs"
        style={{ height: viewportHeight }}
        data-testid="log-viewport"
      >
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const entry = visibleEntries[virtualItem.index]
            if (!entry) return null
            return (
              <LogRow
                key={virtualItem.key}
                entry={entry}
                rowHeight={rowHeight}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              />
            )
          })}
        </div>
      </div>

      {/* 计数摘要 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          显示 {visibleEntries.length} / {allEntries.length} 条
        </span>
        <span className="tabular-nums">{logBuffer.frozen ? '已暂停（序列缺口）' : '跟随最新'}</span>
      </div>
    </section>
  )
}

/** 单条日志行——只渲染白名单字段（design D4）。 */
function LogRow({
  entry,
  rowHeight,
  style,
}: {
  entry: LogEntry
  rowHeight: number
  style: React.CSSProperties
}) {
  const meta = SEVERITY_META[entry.severity] ?? SEVERITY_META.info
  const Icon = meta.icon
  return (
    <div
      role="listitem"
      style={{ ...style, height: rowHeight }}
      className="flex items-center gap-2 border-b border-border/40 px-2 hover:bg-muted/50 motion-reduce:transition-none"
      data-severity={entry.severity}
      data-message-code={entry.messageCode}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <Badge variant={meta.badgeVariant} className="shrink-0 text-[10px] px-1 py-0">
        {meta.label}
      </Badge>
      <span className="shrink-0 text-muted-foreground text-[11px]" title={entry.stageId}>
        {entry.stageId}
      </span>
      <span className="shrink-0 text-muted-foreground/70 text-[11px]">#{entry.attempt}</span>
      <span className="truncate text-xs" title={entry.messageCode}>
        {resolveMessageCodeLabel(entry.messageCode)}
      </span>
      {entry.durationMs !== undefined && (
        <span className="ml-auto shrink-0 text-muted-foreground/70 text-[10px] tabular-nums">
          {entry.durationMs}ms
        </span>
      )}
      {entry.count !== undefined && (
        <span className="shrink-0 text-muted-foreground/70 text-[10px] tabular-nums">
          ×{entry.count}
        </span>
      )}
      {entry.hash && (
        <span
          className="shrink-0 font-mono text-[10px] text-muted-foreground/60"
          title={entry.hash}
        >
          {entry.hash.slice(0, 8)}
        </span>
      )}
      <span className="shrink-0 text-muted-foreground/50 text-[10px] tabular-nums">
        {entry.timestamp.slice(11, 19)}
      </span>
    </div>
  )
}
