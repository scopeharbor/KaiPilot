'use client'

import { useMemo } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { useCompilerProgress } from '@/hooks/use-compiler-progress'
import { useCompilerRunState } from '@/hooks/use-compiler-progress'
import { cn } from '@/lib/utils'
import { selectCompilerRunEta } from '@/lib/compiler/compiler-eta'
import type { CompilerRunState, StageProgressState } from '@/lib/compiler/compiler-progress-store'

/**
 * CompilerStageDetailPanel —— Compiler run 的只读流式逐 Stage 明细面板。
 *
 * 消费既有 useCompilerProgress + useCompilerRunState 订阅，
 * 将 CompilerRunState.stages 的逐 Stage 生命周期确定性上屏。
 *
 * 数据源：Zustand live 投影（compiler:progress）
 * 定位互补：CompilerObservabilitySummary（REST 事后聚合 rollup）
 *
 * 覆盖状态：
 * - 空态（无 run / stages 为空）：「等待 Stage 事件」
 * - 运行中：逐 Stage 列表 + 连接状态
 * - 终态：completed/failed/cancelled 横幅，列表冻结
 * - 断连/停滞：连接提示 / 恢复中提示
 *
 * 无副作用：不渲染 resume/replay/cancel/retry/apply 等控件。
 * 低敏白名单：只渲染 stageId/phase/status/fsmState/attemptNumber/durationMs/errorCode/timestamp/llmCalls。
 */
export function CompilerStageDetailPanel({
  projectId,
  runId,
}: {
  projectId: number
  runId: number
}) {
  // 订阅实时事件 + 读快照（不新增 store/socket/reducer）
  useCompilerProgress(projectId, runId)
  const runState = useCompilerRunState(runId)

  // ── Stage 排序：Map 首次出现顺序 ──
  const stageEntries = useMemo(() => {
    if (!runState?.stages || runState.stages.size === 0) return []
    return [...runState.stages.entries()].map(([stageId, stage]) => ({ stageId, stage }))
  }, [runState?.stages])

  const isRunning = runState?.overallStatus === 'running' || runState?.overallStatus === 'unknown'
  const completedCount = stageEntries.filter((s) => s.stage.fsmState === 'completed').length
  const seenCount = stageEntries.length
  const isDisconnected = runState?.connected === false
  const isStale = runState?.heartbeatStale === true && runState?.overallStatus === 'running'

  // v2-5-streaming-eta-estimation：run 级 ETA 纯派生 selector（零 state 写入）。
  // 暖机期 / 异常态 / 全完成 → formatted 为空，UI 不渲染。
  const compilerEta = runState ? selectCompilerRunEta(runState) : null
  const showCompilerEta = Boolean(
    compilerEta &&
    compilerEta.etaMs !== null &&
    compilerEta.confidence !== 'initial' &&
    compilerEta.formatted !== '',
  )
  const compilerEtaPrefix = compilerEta?.confidence === 'converging' ? '估算中…' : '预计剩余'

  // ── 空态（无 run 记录）──
  if (!runState) {
    return (
      <section className="rounded-lg border p-4 space-y-3" aria-label="编译器逐阶段明细">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
          <span>等待 Stage 事件</span>
        </div>
      </section>
    )
  }

  // ── 空态（有 run 但 stages 为空）──
  if (runState && stageEntries.length === 0) {
    return (
      <section className="rounded-lg border p-4 space-y-3" aria-label="编译器逐阶段明细">
        {runState.connected === false ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            <span>连接已断开，等待 Stage 事件</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            <span>等待 Stage 事件</span>
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="rounded-lg border p-4 space-y-4" aria-label="编译器逐阶段明细">
      {/* ── 顶部汇总：aria-live polite ── */}
      <div className="flex items-center justify-between" aria-live="polite" aria-atomic="true">
        <div className="flex items-center gap-2 min-w-0">
          <RunStatusIcon
            status={runState.overallStatus}
            isStale={isStale}
            isDisconnected={isDisconnected}
          />
          <span className="text-sm font-medium">
            {runState.overallStatus === 'completed'
              ? '编译完成'
              : runState.overallStatus === 'failed'
                ? '编译失败'
                : runState.overallStatus === 'cancelled'
                  ? '编译已取消'
                  : '编译运行中'}
          </span>
        </div>

        {/* 连接/停滞/状态徽标 */}
        <div className="flex items-center gap-2 shrink-0">
          {isStale && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
              <Clock className="h-3 w-3" aria-hidden />
              正在恢复
            </span>
          )}
          {isDisconnected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-xs font-medium text-danger">
              <WifiOff className="h-3 w-3" aria-hidden />
              连接已断开
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success">
              <Wifi className="h-3 w-3" aria-hidden />
              已连接
            </span>
          )}
        </div>
      </div>

      {/* ── 已完成 N / 已见 M 进度语义 ── */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          已完成 {completedCount} / 已见 {seenCount}
        </span>
        {showCompilerEta && compilerEta ? (
          <span className="motion-reduce:transition-none">
            <span aria-hidden>·</span> <span aria-hidden>{compilerEtaPrefix}</span>{' '}
            {compilerEta.formatted}
          </span>
        ) : null}
      </div>

      {/* ── 终态横幅 ── */}
      {runState.overallStatus === 'completed' && (
        <div className="flex items-center gap-2 rounded-md border border-success bg-success-bg p-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>编译全部完成</span>
        </div>
      )}

      {runState.overallStatus === 'failed' && (
        <div className="flex items-start gap-2 rounded-md border border-danger bg-danger-bg p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <span className="font-medium">编译失败</span>
            {stageEntries
              .filter((s) => s.stage.fsmState === 'failed')
              .slice(0, 1)
              .map((s) => (
                <p key={s.stageId} className="mt-1 text-xs opacity-80">
                  {s.stage.phase}：{s.stage.errorCode ?? '未知错误'}
                </p>
              ))}
          </div>
        </div>
      )}

      {runState.overallStatus === 'cancelled' && (
        <div className="flex items-center gap-2 rounded-md border border-warning bg-warning-bg p-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>编译已取消</span>
        </div>
      )}

      {/* ── 停滞/恢复中提示 ── */}
      {isStale && (
        <div className="flex items-center gap-2 rounded-md border border-warning bg-warning-bg p-3 text-sm text-warning">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          <span>进度暂停，正在恢复</span>
        </div>
      )}

      {isDisconnected && isRunning && !isStale && (
        <div className="flex items-center gap-2 rounded-md border border-info bg-info-bg p-3 text-sm text-info">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          <span>连接已断开</span>
        </div>
      )}

      {/* ── 逐 Stage 列表 ── */}
      <div role="list" className="divide-y divide-border">
        {stageEntries.map(({ stageId, stage }) => (
          <StageRow key={stageId} stage={stage} />
        ))}
      </div>

      {/* ── 无障碍 sr-only 汇总 ── */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {runState.overallStatus === 'completed'
          ? `编译完成，已完成 ${completedCount} 个，共 ${seenCount} 个阶段。`
          : runState.overallStatus === 'failed'
            ? `编译失败，已完成 ${completedCount} 个，共 ${seenCount} 个阶段。`
            : runState.overallStatus === 'cancelled'
              ? `编译已取消，已完成 ${completedCount} 个，共 ${seenCount} 个阶段。`
              : isStale
                ? `进度暂停，正在恢复，已完成 ${completedCount} 个，共 ${seenCount} 个阶段。`
                : `编译运行中，已完成 ${completedCount} 个，共 ${seenCount} 个阶段。`}
      </p>
    </section>
  )
}

// ── 单 Stage 行 ──────────────────────────────────────────

function StageRow({ stage }: { stage: StageProgressState }) {
  const isTerminal =
    stage.fsmState === 'completed' || stage.fsmState === 'failed' || stage.fsmState === 'cancelled'

  return (
    <div
      role="listitem"
      className={cn('flex items-center gap-3 py-2.5 text-sm', isTerminal ? 'opacity-80' : '')}
    >
      {/* 状态图标 */}
      <span className="shrink-0" aria-hidden>
        <StageStatusIcon
          status={stage.status}
          fsmState={stage.fsmState}
          needsReview={stage.needsReview}
        />
      </span>

      {/* sr-only 状态文本 */}
      <span className="sr-only">
        {stage.fsmState === 'completed'
          ? '已完成'
          : stage.fsmState === 'failed'
            ? '失败'
            : stage.fsmState === 'cancelled'
              ? '已取消'
              : stage.fsmState === 'started' || stage.fsmState === 'running'
                ? '运行中'
                : '等待中'}
        {stage.needsReview ? '，需要人工审查' : ''}
      </span>

      {/* Phase 标签 */}
      <span className="min-w-0 flex-1 truncate font-medium">{stage.phase}</span>

      {/* Attempt */}
      {stage.attemptNumber != null && (
        <span className="shrink-0 text-xs text-muted-foreground">第 {stage.attemptNumber} 次</span>
      )}

      {/* Duration */}
      {stage.durationMs != null && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDuration(stage.durationMs)}
        </span>
      )}

      {/* LLM Calls */}
      {stage.llmCalls > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground">{stage.llmCalls} 次调用</span>
      )}

      {/* Error Code */}
      {stage.errorCode != null && (
        <span className="shrink-0 text-xs text-danger">{stage.errorCode}</span>
      )}

      {/* Timestamp */}
      {stage.timestamp != null && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatTimestamp(stage.timestamp)}
        </span>
      )}
    </div>
  )
}

// ── 图标辅助组件 ──────────────────────────────────────────

function StageStatusIcon({
  status,
  fsmState,
  needsReview,
}: {
  status: StageProgressState['status']
  fsmState: StageProgressState['fsmState']
  needsReview: StageProgressState['needsReview']
}) {
  if (fsmState === 'completed') {
    return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
  }
  if (fsmState === 'failed') {
    return <XCircle className="h-4 w-4 text-danger" aria-hidden />
  }
  if (fsmState === 'cancelled') {
    return <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
  }
  if (needsReview) {
    return <AlertCircle className="h-4 w-4 text-warning" aria-hidden />
  }
  if (status === 'started' || status === 'progress') {
    return (
      <Loader2 className="h-4 w-4 animate-spin text-ai motion-reduce:animate-none" aria-hidden />
    )
  }
  return <Circle className="h-4 w-4 text-gray-400" aria-hidden />
}

function RunStatusIcon({
  status,
  isStale,
  isDisconnected,
}: {
  status: CompilerRunState['overallStatus']
  isStale: boolean
  isDisconnected: boolean
}) {
  if (status === 'completed') {
    return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
  }
  if (status === 'failed') {
    return <XCircle className="h-4 w-4 text-danger" aria-hidden />
  }
  if (status === 'cancelled') {
    return <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
  }
  if (isStale) {
    return <Clock className="h-4 w-4 text-warning" aria-hidden />
  }
  if (isDisconnected) {
    return <WifiOff className="h-4 w-4 text-info" aria-hidden />
  }
  return <Loader2 className="h-4 w-4 animate-spin text-ai motion-reduce:animate-none" aria-hidden />
}

// ── 格式化辅助 ──────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60000)
  const sec = Math.round((ms % 60000) / 1000)
  return `${min}m ${sec}s`
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ts
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ts
  }
}
