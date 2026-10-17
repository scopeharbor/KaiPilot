'use client'

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * 写操作两阶段 Diff 预览与人工确认卡片
 * （v3-ui-next-ai-colleague D-write / spec「写操作两阶段 Diff 预览与显式确认卡片」）。
 *
 * - 上层收到 `PREVIEW_REQUIRED`（含 `previewToken` 与 `diff`）后渲染本卡，
 *   本卡为**受控纯展示组件**：渲染变更前后起止日期红绿对比（原日期删除线、
 *   目标日期天青色高亮）、联动受影响任务与琥珀色警告/冲突容器；
 * - RL-01 铁律：仅当用户显式点击「确认应用」后才由上层发起 confirm 请求；
 *   「放弃取消」仅本地销毁令牌态，零网络写请求；
 * - 409 `SCHEDULE_STALE` 冲突时卡片切换 `phase="conflict"`（`data-status="conflict"`），
 *   冷红告警槽 + 「重新演练」按钮，严禁假成功或静默重试。
 */

/** `update_task_schedule` Diff 中的单条变更（字段名与后端 ScheduleChange 对齐）。 */
export interface ScheduleChangeItem {
  taskId: number
  taskName: string
  before: { startDate: string; endDate: string; durationDays: number }
  after: { startDate: string; endDate: string; durationDays: number }
  reason: 'direct_move' | 'direct_resize' | 'dependency'
  dependencyIds: number[]
}

/** 非致命调度冲突（与后端 ScheduleConflict 对齐）。 */
export interface ScheduleConflictItem {
  taskId: number
  taskName: string
  code: 'INBOUND_DEPENDENCY' | 'DEPENDENCY_VIOLATION' | 'CYCLE'
  message: string
  dependencyIds: number[]
}

export interface ActionPreviewDiff {
  changes?: ScheduleChangeItem[]
  conflicts?: ScheduleConflictItem[]
  warnings?: string[]
  affectedTaskIds?: number[]
}

export type ActionPreviewPhase = 'preview' | 'committing' | 'committed' | 'cancelled' | 'conflict'

export interface ActionPreviewCardProps {
  toolName: string
  diff: ActionPreviewDiff
  /** 变更节奏（preview=待确认 / committing=提交中 / committed=已生效 / cancelled=已放弃 / conflict=版本冲突）。 */
  phase?: ActionPreviewPhase
  /** 提交成功后的元信息（展示耗时与影响任务数）。 */
  committedMeta?: { durationMs?: number | null; affectedCount?: number | null }
  /** 冲突错误码（如 SCHEDULE_STALE），仅 phase=conflict 时展示。 */
  conflictCode?: string | null
  /** 作废说明（phase=cancelled 时覆盖默认放弃文案；如「该预览已被新操作取代」）。 */
  cancelNote?: string | null
  onConfirm?: () => void
  onCancel?: () => void
  /** 409 冲突后的「重新演练」：以最新上下文重新发起 execute 生成新 previewToken。 */
  onRetry?: () => void
}

const CHANGE_REASON_LABELS: Record<string, string> = {
  direct_move: '直接移动',
  direct_resize: '直接伸缩',
  dependency: '依赖联动',
}

/** ISO 日期（YYYY-MM-DD）→ UTC 毫秒，确定性解析，避免 locale/时区差异。 */
function parseIsoDay(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return Number.NaN
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** 变更推迟天数（after 晚于 before 为正=推迟，为负=提前；解析失败返回 null）。 */
function shiftDays(before: string, after: string): number | null {
  const beforeMs = parseIsoDay(before)
  const afterMs = parseIsoDay(after)
  if (!Number.isFinite(beforeMs) || !Number.isFinite(afterMs)) return null
  return Math.round((afterMs - beforeMs) / 86_400_000)
}

function shiftLabel(before: string, after: string): string | null {
  const days = shiftDays(before, after)
  if (days === null) return null
  if (days === 0) return '日程不变'
  return days > 0 ? `推迟 ${days} 天` : `提前 ${Math.abs(days)} 天`
}

function toFinite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toNullableFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 变更条目的起止日期容错：before/after 缺省或非对象时返回 null（防崩溃）。 */
function changeSpan(change: ScheduleChangeItem | undefined | null): {
  before: { startDate: string; endDate: string }
  after: { startDate: string; endDate: string }
} | null {
  if (!change) return null
  const before = change.before
  const after = change.after
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return null
  const beforeStart = typeof before.startDate === 'string' ? before.startDate : ''
  const beforeEnd = typeof before.endDate === 'string' ? before.endDate : ''
  const afterStart = typeof after.startDate === 'string' ? after.startDate : ''
  const afterEnd = typeof after.endDate === 'string' ? after.endDate : ''
  if (beforeStart === '' || afterStart === '') return null
  return {
    before: { startDate: beforeStart, endDate: beforeEnd },
    after: { startDate: afterStart, endDate: afterEnd },
  }
}

export function ActionPreviewCard({
  toolName,
  diff,
  phase = 'preview',
  committedMeta,
  conflictCode,
  cancelNote,
  onConfirm,
  onCancel,
  onRetry,
}: ActionPreviewCardProps) {
  const changes = Array.isArray(diff.changes) ? diff.changes : []
  const warnings = Array.isArray(diff.warnings)
    ? diff.warnings.filter((w): w is string => typeof w === 'string')
    : []
  const conflicts = Array.isArray(diff.conflicts) ? diff.conflicts : []
  const affectedTaskIds = Array.isArray(diff.affectedTaskIds)
    ? diff.affectedTaskIds.filter((id): id is number => typeof id === 'number')
    : []

  const primary = changes[0]
  const primarySpan = changeSpan(primary)
  const linkedChanges = changes.slice(1)
  const rawAffected = toNullableFinite(committedMeta?.affectedCount)
  const affectedCount =
    rawAffected ?? (affectedTaskIds.length > 0 ? affectedTaskIds.length : changes.length)
  const durationMs = committedMeta?.durationMs

  const isBusy = phase === 'committing'

  return (
    <article
      data-card="action-preview"
      data-status={phase}
      className="overflow-hidden rounded-md border border-[var(--nx-border-focus)]/70 bg-[var(--nx-workspace-surface)]"
    >
      {/* 警示标头 + 规则来源（诚实呈现） */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <span
          data-preview-warning-tag
          className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-status-warning)]/60 px-1.5 py-0.5 text-[10px] leading-none font-medium text-[var(--nx-status-warning)]"
        >
          <ShieldAlert className="h-3 w-3" aria-hidden />
          写操作待确认 · 人工审查
        </span>
        <RuleMatchBadge toolName={toolName} />
      </div>

      {phase === 'conflict' ? (
        <div
          data-conflict-banner
          className="m-3 rounded-sm border border-[var(--nx-status-danger)]/60 bg-[var(--nx-bg-0)] px-3 py-2.5"
        >
          <p className="flex items-start gap-1.5 text-xs leading-5 font-medium text-[var(--nx-status-danger)]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            排程数据已被他人并发修改或预览已过期（版本冲突 409）
          </p>
          <p className="mt-1 text-[11px] leading-4 text-[var(--nx-text-secondary)]">
            当前排程预览基于过期快照计算，系统已安全终止本次写入事务
            {conflictCode ? `（错误码 ${conflictCode}）` : null}。请刷新并重新演练。
          </p>
        </div>
      ) : null}

      {/* Diff 对比主体 */}
      <div className="space-y-2.5 px-3 py-3">
        {primarySpan ? (
          <div data-preview-primary>
            <p className="text-xs font-medium text-[var(--nx-text-primary)]">
              #{primary?.taskId} · {primary?.taskName || '未命名任务'}
            </p>
            <span
              data-preview-reason
              className="mt-1 inline-block rounded-sm border border-[var(--nx-border-hairline)] px-1 py-0.5 text-[10px] leading-none text-[var(--nx-text-muted)]"
            >
              {primary?.reason
                ? (CHANGE_REASON_LABELS[primary.reason] ?? primary.reason)
                : '未知变更'}
            </span>
            <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[11px] leading-4">
              <div className="min-w-0">
                <p className="text-[10px] text-[var(--nx-text-muted)]">开始日期</p>
                <p
                  data-preview-before-start
                  className="line-through decoration-[var(--nx-text-muted)]/60 font-mono text-[var(--nx-text-muted)]"
                >
                  {primarySpan.before.startDate}
                </p>
                <p
                  data-preview-after-start
                  className="font-mono text-[13px] font-medium text-[var(--nx-accent)]"
                >
                  {primarySpan.after.startDate}
                </p>
              </div>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]"
                aria-hidden
              />
              <div className="min-w-0 text-right">
                <p className="text-[10px] text-[var(--nx-text-muted)]">结束日期</p>
                <p
                  data-preview-before-end
                  className="line-through decoration-[var(--nx-text-muted)]/60 font-mono text-[var(--nx-text-muted)]"
                >
                  {primarySpan.before.endDate}
                </p>
                <p
                  data-preview-after-end
                  className="font-mono text-[13px] font-medium text-[var(--nx-accent)]"
                >
                  {primarySpan.after.endDate}
                </p>
              </div>
            </div>
            <p data-preview-shift className="mt-1.5 text-[10px] text-[var(--nx-text-muted)]">
              变更幅度：
              {shiftLabel(primarySpan.before.startDate, primarySpan.after.startDate) ?? '无法计算'}
            </p>
          </div>
        ) : (
          <p data-preview-empty className="text-xs text-[var(--nx-text-muted)]">
            该预览未包含任务变更明细
          </p>
        )}

        {/* 下游联动受影响任务 */}
        {linkedChanges.length > 0 ? (
          <div
            data-preview-linked
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
          >
            <p className="text-[10px] font-medium text-[var(--nx-text-muted)]">
              下游联动受影响任务（{linkedChanges.length}）
            </p>
            <ul data-preview-linked-list className="mt-1 space-y-1">
              {linkedChanges.map((change) => {
                const id = toFinite(change.taskId, 0)
                const span = changeSpan(change)
                const shift = span ? shiftLabel(span.before.startDate, span.after.startDate) : null
                return (
                  <li
                    key={String(id)}
                    className="flex items-center justify-between gap-2 text-[11px] leading-4"
                  >
                    <span className="min-w-0 truncate text-[var(--nx-text-secondary)]">
                      #{id} · {change.taskName || '未命名任务'}
                    </span>
                    <span
                      data-preview-linked-shift
                      className="shrink-0 font-mono text-[var(--nx-accent)]"
                    >
                      {shift ?? '—'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {/* 调度警告（琥珀色容器） */}
        {warnings.length > 0 ? (
          <div
            data-preview-warnings
            className="rounded-sm border border-[var(--nx-status-warning)]/50 bg-[var(--nx-status-warning)]/5 px-2.5 py-2"
          >
            <p className="flex items-center gap-1 text-[10px] font-medium text-[var(--nx-status-warning)]">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              调度警告
            </p>
            <ul className="mt-1 space-y-1">
              {warnings.map((warning, index) => (
                <li key={index} className="text-[11px] leading-4 text-[var(--nx-text-secondary)]">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* 非致命冲突提示（标黄风险提示，D-write） */}
        {conflicts.length > 0 ? (
          <div
            data-preview-conflicts
            className="rounded-sm border border-[var(--nx-status-warning)]/50 bg-[var(--nx-status-warning)]/5 px-2.5 py-2"
          >
            <p className="flex items-center gap-1 text-[10px] font-medium text-[var(--nx-status-warning)]">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              排程冲突提示
            </p>
            <ul className="mt-1 space-y-1">
              {conflicts.map((conflict) => {
                const conflictId = toFinite(conflict.taskId, 0)
                const conflictName =
                  typeof conflict.taskName === 'string' && conflict.taskName.trim() !== ''
                    ? conflict.taskName
                    : '任务'
                const message =
                  typeof conflict.message === 'string' && conflict.message.trim() !== ''
                    ? conflict.message
                    : typeof conflict.code === 'string'
                      ? `冲突类型 ${conflict.code}`
                      : '存在排程冲突'
                return (
                  <li
                    key={`${conflictId}-${typeof conflict.code === 'string' ? conflict.code : 'unknown'}`}
                    className="text-[11px] leading-4 text-[var(--nx-text-secondary)]"
                  >
                    #{conflictId} · {conflictName}：{message}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {/* 结果/决策区 */}
      <div className="border-t border-[var(--nx-border-hairline)] px-3 py-2.5">
        {phase === 'committed' ? (
          <p
            data-preview-committed
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-status-success)]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            已成功应用
            {durationMs !== null && durationMs !== undefined ? (
              <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                · 提交耗时 {durationMs}ms
              </span>
            ) : null}
            {affectedCount > 0 ? (
              <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                · 影响 {affectedCount} 项任务
              </span>
            ) : null}
          </p>
        ) : phase === 'cancelled' ? (
          <p
            data-preview-cancelled
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-muted)]"
          >
            <XCircle className="h-4 w-4 shrink-0" aria-hidden />
            {cancelNote ?? '已由用户放弃操作 · 未发起任何写请求'}
          </p>
        ) : phase === 'conflict' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-preview-retry
              onClick={onRetry}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重新演练 · 获取最新数据
            </button>
            {/* 冲突态同样允许放弃：本地清现场、零请求（RL-01） */}
            <button
              type="button"
              data-preview-cancel
              onClick={onCancel}
              className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] px-3 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              放弃取消
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-preview-confirm
              disabled={isBusy}
              onClick={onConfirm}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-[var(--nx-accent)] px-3 text-[11px] font-medium text-[var(--nx-bg-0)] transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  提交中…
                </>
              ) : (
                '确认应用'
              )}
            </button>
            <button
              type="button"
              data-preview-cancel
              disabled={isBusy}
              onClick={onCancel}
              className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] px-3 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              放弃取消
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

export default ActionPreviewCard
