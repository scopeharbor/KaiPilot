'use client'

import * as React from 'react'
import { AlertTriangle, RotateCcw, Undo2, Redo2, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import { useWhatIfImpactSummary, useWhatIfUndoRedoShortcuts } from '@/hooks/use-what-if-session'
import type { ImpactSummary } from '@/lib/gantt/what-if-impact'
import { WorkspaceGanttImpactDrawer } from './WorkspaceGanttImpactDrawer'

/**
 * What-if 试算 HUD 控制横幅（v3-ui-next-gantt-lens spec「What-if 试算沙盒进出与视觉标记」/ W2）。
 *
 * - 沙盒活跃（active/stale/error）时顶部常驻：「⚡ What-if 试算中 · 正式数据未变更」
 *   冷琥珀 + 电光天青仪器感微标（RL-15：发丝线 + 标准色块，无发光滤镜滥用）；
 * - 常驻展示已变更命令计数、浓缩影响标签、撤销/重做/重置、「影响摘要」开关、
 *   「应用方案」主按钮与「放弃试算」次按钮（含二次确认小窗）；
 * - stale 态整体切换冷橙色警示并提示「排程已被其他协作者修改」，应用按钮禁用（W3 409 接驳）；
 * - 「应用方案」一键触发两阶段提交（preview→commit 在 `applySession` 内串联）：不要求预先持有
 *   后端 preview（2026-10-12 修复：原先要求 backendPreview 非空，而它只在服务端回报冲突时才写入，
 *   正常路径下按钮永远禁用，用户「按应用方案没反应」）；上一次提交回报的冲突仍会阻断；
 * - 提交失败（error 态）横幅照常显示错误原因，可继续拖动修正、撤销或放弃试算；
 * - 告警门禁（spec「试算影响摘要动态度量与呈现」）：存在未确认告警时应用按钮禁用，
 *   抽屉勾选「已知晓告警」后解锁。
 */
export interface WorkspaceGanttWhatIfHudProps {
  /** W3 两阶段提交接入点（preview→commit）；缺省 = W2 占位，按钮保持禁用。 */
  onApply?: (() => void) | null
  /** 提交进行中（W3 applying 态，禁用画板手柄与二次点击）。 */
  applying?: boolean
}

/** 浓缩影响标签（HUD 芯片文案构建；纯函数便于测试）。 */
export function buildWhatIfImpactLabel(summary: ImpactSummary | null): string | null {
  if (!summary) return null
  const parts: string[] = []
  const delta = summary.timeline.workingDelta
  if (delta !== null && delta !== 0) {
    parts.push(delta > 0 ? `完工延后 ${delta} 天` : `完工提前 ${Math.abs(delta)} 天`)
  }
  const linked = summary.tasks.direct + summary.tasks.propagated
  if (linked > 0) parts.push(`${linked} 任务联动`)
  if (summary.gate.warningCount > 0) parts.push(`${summary.gate.warningCount} 警告`)
  if (summary.conflicts.total > 0) parts.push(`${summary.conflicts.total} 冲突`)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function WorkspaceGanttWhatIfHud({
  onApply = null,
  applying = false,
}: WorkspaceGanttWhatIfHudProps) {
  const session = useWhatIfSessionStore((s) => s.session)
  const impactSummary = useWhatIfSessionStore((s) => s.impactSummary)
  const discardSession = useWhatIfSessionStore((s) => s.discardSession)
  const resetSession = useWhatIfSessionStore((s) => s.resetSession)
  const undo = useWhatIfSessionStore((s) => s.undo)
  const redo = useWhatIfSessionStore((s) => s.redo)

  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = React.useState(false)

  // 派生监听：derivedPreview 变化自动重算影响摘要（写入 store）
  useWhatIfImpactSummary()
  // 全局快捷键 Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z、Ctrl+Y
  useWhatIfUndoRedoShortcuts()

  const status = session.status
  if (status === 'idle') return null

  const isStale = status === 'stale'
  const isOperational = status === 'active' || status === 'stale' || status === 'error'
  const commandCount = session.history.cursor
  const canUndo = isOperational && commandCount > 0
  const canRedo = isOperational && session.history.cursor < session.history.entries.length
  const canReset = isOperational && commandCount > 0

  const warningsConfirmed = impactSummary?.gate.hasWarning
    ? impactSummary.gate.warningConfirmed
    : true
  const blockerCount = impactSummary?.gate.blockerCount ?? 0
  const serverConflictCount = session.backendPreview?.conflicts.length ?? 0
  const canApply =
    isOperational &&
    commandCount > 0 &&
    !isStale &&
    blockerCount === 0 &&
    serverConflictCount === 0 &&
    warningsConfirmed &&
    !applying

  const applyBlockReason = !isOperational
    ? '当前无可应用的试算方案'
    : commandCount === 0
      ? '还没有变更排程'
      : isStale
        ? '排程数据已过期，无法应用'
        : blockerCount > 0 || serverConflictCount > 0
          ? '存在阻塞性冲突，无法应用（可撤销或继续调整后再试）'
          : !warningsConfirmed
            ? '请先在影响摘要中确认告警'
            : undefined

  const impactLabel = buildWhatIfImpactLabel(impactSummary)

  return (
    <div
      data-what-if-hud
      data-what-if-status={status}
      data-what-if-stale={isStale ? 'true' : undefined}
      role="region"
      aria-label="What-if 试算控制台"
      className={cn(
        'relative z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2',
        'border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]',
        isStale && 'border-[var(--nx-status-warning)]/70',
      )}
    >
      {/* 冷琥珀 + 电光天青微标 */}
      <div className="flex items-center gap-1.5" data-what-if-badge>
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-[var(--nx-space-cyan)]/15 text-[var(--nx-space-cyan)]">
          <Zap className="h-3 w-3" aria-hidden />
        </span>
        <span
          className={cn(
            'text-xs font-semibold tracking-wide',
            isStale ? 'text-[var(--nx-status-warning)]' : 'text-[var(--nx-text-primary)]',
          )}
        >
          ⚡ What-if 试算中 · 正式数据未变更
        </span>
      </div>

      {/* 变更计数 */}
      <span
        data-what-if-command-count
        aria-live="polite"
        className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-0.5 text-xs text-[var(--nx-text-secondary)]"
      >
        已变更 {commandCount} 项命令
      </span>

      {/* 浓缩影响标签 + 影响摘要入口 */}
      <button
        type="button"
        data-what-if-open-impact
        onClick={() => setDrawerOpen(true)}
        className="group inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-0.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-space-cyan)]/60 hover:text-[var(--nx-space-cyan)]"
      >
        <span data-what-if-impact-label>
          {impactLabel ?? (commandCount > 0 ? '暂无影响' : '尚未变更排程')}
        </span>
        <span className="text-[10px] text-[var(--nx-text-muted)] transition-colors group-hover:text-[var(--nx-space-cyan)]">
          查看影响详情 ›
        </span>
      </button>

      {/* 撤销 / 重做 / 重置 */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-what-if-undo
          disabled={!canUndo}
          aria-label="撤销"
          title="撤销 (Ctrl+Z)"
          onClick={undo}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-space-cyan)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          data-what-if-redo
          disabled={!canRedo}
          aria-label="重做"
          title="重做 (Ctrl+Shift+Z)"
          onClick={redo}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-space-cyan)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Redo2 className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          data-what-if-reset
          disabled={!canReset}
          aria-label="重置到初始态"
          title="重置到初始态"
          onClick={resetSession}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-space-cyan)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {/* 提交失败：说明原因，可继续调整 / 撤销 / 放弃 */}
      {status === 'error' && session.errorMessage ? (
        <span
          data-what-if-error-note
          role="alert"
          className="inline-flex items-center gap-1 text-xs text-[var(--nx-status-danger)]"
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          应用失败：{session.errorMessage}（正式数据未变更，可调整后重试）
        </span>
      ) : null}

      {/* stale 警示文案 */}
      {isStale ? (
        <span
          data-what-if-stale-note
          className="inline-flex items-center gap-1 text-xs text-[var(--nx-status-warning)]"
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          ⚠️ 该项目排程已被其他协作者修改，当前试算基于过期数据
        </span>
      ) : null}

      {/* 应用方案（主按钮）/ 放弃试算（次按钮） */}
      <div className="ml-auto flex items-center gap-2">
        {confirmDiscardOpen ? (
          <span className="flex items-center gap-1.5 rounded-sm border border-[var(--nx-status-warning)]/50 bg-[var(--nx-status-warning)]/10 px-2 py-1 text-xs text-[var(--nx-text-secondary)]">
            确定放弃当前所有试算变更吗？
            <button
              type="button"
              data-what-if-discard-confirm
              onClick={() => {
                setConfirmDiscardOpen(false)
                discardSession()
              }}
              className="rounded-sm px-1.5 py-0.5 text-[var(--nx-status-warning)] underline-offset-2 hover:underline"
            >
              确认放弃
            </button>
            <button
              type="button"
              data-what-if-discard-cancel
              onClick={() => setConfirmDiscardOpen(false)}
              className="rounded-sm px-1.5 py-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
            >
              取消
            </button>
          </span>
        ) : (
          <button
            type="button"
            data-what-if-discard
            disabled={applying}
            title="放弃试算并恢复正式排程"
            onClick={() => setConfirmDiscardOpen(true)}
            className="rounded-sm border border-[var(--nx-border-hairline)] px-2.5 py-1 text-xs text-[var(--nx-text-muted)] transition-colors hover:border-[var(--nx-status-danger)]/50 hover:text-[var(--nx-status-danger)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            放弃试算
          </button>
        )}
        <button
          type="button"
          data-what-if-apply
          disabled={!canApply}
          title={applyBlockReason}
          onClick={() => onApply?.()}
          className={cn(
            'rounded-sm px-3 py-1 text-xs font-semibold transition-colors',
            canApply
              ? 'bg-[var(--nx-space-cyan)] text-[#04121a] hover:brightness-110'
              : 'cursor-not-allowed border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)]',
          )}
        >
          {applying ? '应用中…' : '应用方案'}
        </button>
      </div>

      {/* 影响摘要抽屉 */}
      <WorkspaceGanttImpactDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}

export default WorkspaceGanttWhatIfHud
