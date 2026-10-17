'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, OctagonAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import type { EvidenceItem, ReasonCode } from '@/lib/gantt/what-if-impact'

const MS_PER_DAY = 86_400_000

/**
 * 试算影响摘要抽屉（v3-ui-next-gantt-lens spec「试算影响摘要动态度量与呈现」/ W2）。
 *
 * - 与 `computeImpactSummary` 联动，呈现项目整体完工日期变动（workingDelta）、
 *   直接修改与级联顺延任务明细对比卡、关键路径漂移增减列表与潜在冲突告警；
 * - 存在告警时提供「已知晓告警」确认勾选框（confirmWarnings），未勾选前
 *   HUD「应用方案」保持禁用（spec「告警确认机制」）；
 * - 纯展示 + store 读取：任务日期由 baseSnapshot / derivedPreview 模型确定性还原
 *   （原排期 vs 试算排期），零网络零持久化（RL-08）。
 */
export interface WorkspaceGanttImpactDrawerProps {
  open: boolean
  onClose: () => void
}

/** epochMs + 整天偏移 → 'YYYY-MM-DD'（UTC 零点）。 */
function formatDay(epochMs: number, day: number): string {
  return new Date(epochMs + day * MS_PER_DAY).toISOString().slice(0, 10)
}

/** 任务排期区间文案：`2026-01-01 ~ 2026-01-05`；里程碑（0 工期）为单日。 */
export function formatTaskDateRange(
  epochMs: number,
  startDay: number,
  durationDays: number,
): string {
  if (durationDays <= 0) return formatDay(epochMs, startDay)
  return `${formatDay(epochMs, startDay)} ~ ${formatDay(epochMs, startDay + durationDays - 1)}`
}

/** 项目整体完工日期变动文案（纯函数便于测试）。 */
export function formatWorkingDelta(delta: number | null): string {
  if (delta === null || delta === 0) return '项目整体完工日期无变化'
  return delta > 0
    ? `项目整体完工日期延后 ${delta} 天`
    : `项目整体完工日期提前 ${Math.abs(delta)} 天`
}

const REASON_LABEL: Partial<Record<ReasonCode, string>> = {
  DIRECT_DATE_MOVE: '直接调整日期',
  DIRECT_RESIZE: '直接调整工期',
  DEPENDENCY_PROPAGATION: '依赖级联顺延',
  MILESTONE_DELAYED: '里程碑延后',
  MILESTONE_ADVANCED: '里程碑提前',
  CRITICAL_PATH_ENTERED: '进入关键路径',
  CRITICAL_PATH_EXITED: '脱离关键路径',
  CYCLE_DETECTED: '依赖环',
}

export function reasonLabel(code: ReasonCode): string {
  return REASON_LABEL[code] ?? code
}

interface TaskRow {
  id: number
  name: string
  propagation: 'direct' | 'cascade'
  reasonCode: ReasonCode
  beforeDate: string
  afterDate: string
  beforeDuration: number
  afterDuration: number
}

/**
 * 抽屉挂到 document.body（portal）：原先渲染在 HUD 的 `relative z-20` 层叠上下文里，
 * 自身的 `fixed z-50` 只在该上下文内生效，甘特时间轴表头（日期行）会盖在抽屉上面。
 * Portal 同时逃逸了 `[data-next-track]` 令牌作用域（--nx-* 全部失效 → 抽屉底色透明、
 * 文字与页面叠在一起），故抽屉首层重挂 `data-next-track`（AiColleaguePanel 同款范式），
 * 层级用 `--z-modal`，盖过顶栏。
 */
export function WorkspaceGanttImpactDrawer(props: WorkspaceGanttImpactDrawerProps) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  if (!props.open) return null
  const body = <ImpactDrawerBody {...props} />
  return mounted && typeof document !== 'undefined' ? createPortal(body, document.body) : body
}

function ImpactDrawerBody({ open, onClose }: WorkspaceGanttImpactDrawerProps) {
  const session = useWhatIfSessionStore((s) => s.session)
  const summary = useWhatIfSessionStore((s) => s.impactSummary)
  const confirmWarnings = useWhatIfSessionStore((s) => s.confirmWarnings)

  const base = session.baseSnapshot
  const previewModel = session.derivedPreview?.model ?? null

  // 空态与常规态两个分支共用同一容器（容器带 tabIndex={-1}，焦点优先落抽屉本身）。
  // 本抽屉零写请求、告警勾选态存于 what-if store，Escape 关闭与「关闭 / 遮罩点按」等价，
  // 无在途写与未保存脏值判据 → 不设 canClose（默认放行）。
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({ ref: dialogRef, open, onClose })

  if (!open) return null

  if (!base || !previewModel || !summary) {
    return (
      <div
        data-what-if-impact-drawer
        role="dialog"
        aria-modal="true"
        aria-label="试算影响摘要"
        ref={dialogRef}
        tabIndex={-1}
        data-next-track
        className="fixed inset-0 z-[var(--z-modal)]"
      >
        <div className="absolute inset-0 bg-black/50" data-impact-backdrop onClick={onClose} />
        <aside className="absolute right-0 top-0 flex h-full w-[440px] max-w-[92vw] flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]">
          <DrawerHeader onClose={onClose} />
          <p data-impact-empty className="px-4 py-6 text-xs text-[var(--nx-text-muted)]">
            暂无影响数据
          </p>
        </aside>
      </div>
    )
  }

  const baseTaskById = new Map(base.tasks.map((task) => [task.id, task]))
  const previewTaskById = new Map(previewModel.tasks.map((task) => [task.id, task]))
  const epochMs = previewModel.epochMs

  const taskRows: TaskRow[] = summary.evidence
    // 直接/级联任务明细只保留普通任务行的排期变化证据：
    // - 里程碑行由「里程碑变动」指标与告警区块表达（generateEvidence 会同时产出
    //   task 型 DEPENDENCY_PROPAGATION 与 milestone 型 MILESTONE_DELAYED，去重防重复行）；
    // - 关键路径漂移由独立区块呈现（CP_ENTERED/EXITED 不在此重复）。
    .filter((item) => {
      if (item.entityType !== 'task') return false
      if (
        item.reasonCode === 'CRITICAL_PATH_ENTERED' ||
        item.reasonCode === 'CRITICAL_PATH_EXITED'
      ) {
        return false
      }
      const row = baseTaskById.get(item.entityId) ?? previewTaskById.get(item.entityId)
      if (row?.kind === 'milestone') return false
      return true
    })
    .map((item) => {
      const beforeTask = baseTaskById.get(item.entityId)
      const afterTask = previewTaskById.get(item.entityId)
      return {
        id: item.entityId,
        name: item.entityName,
        propagation: item.propagation === 'direct' ? 'direct' : 'cascade',
        reasonCode: item.reasonCode,
        beforeDate: beforeTask
          ? formatTaskDateRange(epochMs, beforeTask.startDay, beforeTask.durationDays)
          : (item.before ?? '—'),
        afterDate: afterTask
          ? formatTaskDateRange(epochMs, afterTask.startDay, afterTask.durationDays)
          : (item.after ?? '—'),
        beforeDuration: beforeTask?.durationDays ?? 0,
        afterDuration: afterTask?.durationDays ?? 0,
      }
    })

  const directRows = taskRows.filter((row) => row.propagation === 'direct')
  const cascadeRows = taskRows.filter((row) => row.propagation === 'cascade')

  const addedCpTasks = summary.criticalPath.addedCriticalTaskIds.map((id) => ({
    id,
    name: previewTaskById.get(id)?.name ?? `任务 #${id}`,
  }))
  const removedCpTasks = summary.criticalPath.removedCriticalTaskIds.map((id) => ({
    id,
    name: baseTaskById.get(id)?.name ?? `任务 #${id}`,
  }))

  const warningItems = summary.evidence.filter((item) => item.severity === 'warning')
  const blockerItems = summary.evidence.filter((item) => item.severity === 'blocker')
  const hasWarnings = summary.gate.hasWarning
  const warningsConfirmed = summary.gate.warningConfirmed

  return (
    <div
      data-what-if-impact-drawer
      role="dialog"
      aria-modal="true"
      aria-label="试算影响摘要"
      ref={dialogRef}
      tabIndex={-1}
      data-next-track
      className="fixed inset-0 z-[var(--z-modal)]"
    >
      {/* 遮罩：点击关闭抽屉 */}
      <div className="absolute inset-0 bg-black/50" data-impact-backdrop onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-[440px] max-w-[92vw] flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] shadow-2xl">
        <DrawerHeader onClose={onClose} />

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* 1) 项目整体完工日期变动 */}
          <section
            data-impact-timeline
            className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
          >
            <h3 className="text-xs font-semibold text-[var(--nx-text-primary)]">
              项目整体完工日期
            </h3>
            <p className="mt-1.5 text-xs text-[var(--nx-text-secondary)]">
              <span className="text-[var(--nx-text-muted)]">原定</span> {summary.timeline.before}
              <span className="mx-1.5 text-[var(--nx-text-muted)]">→</span>
              <span className="text-[var(--nx-text-primary)]">试算</span> {summary.timeline.after}
            </p>
            <p
              data-impact-working-delta
              className={cn(
                'mt-2 inline-block rounded-sm px-2 py-0.5 text-xs font-semibold',
                (summary.timeline.workingDelta ?? 0) > 0
                  ? 'bg-[var(--nx-status-warning)]/12 text-[var(--nx-status-warning)]'
                  : (summary.timeline.workingDelta ?? 0) < 0
                    ? 'bg-[var(--nx-status-success)]/12 text-[var(--nx-status-success)]'
                    : 'bg-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
              )}
            >
              {formatWorkingDelta(summary.timeline.workingDelta)}
            </p>
            {summary.milestones.total > 0 ? (
              <p data-impact-milestones className="mt-2 text-[11px] text-[var(--nx-text-muted)]">
                里程碑：延后 {summary.milestones.delayed} · 提前 {summary.milestones.advanced} ·
                未变 {summary.milestones.unchanged}
              </p>
            ) : null}
          </section>

          {/* 2) 直接修改与级联影响任务明细对比卡 */}
          <section className="space-y-3">
            <TaskListSection
              title="直接修改"
              rows={directRows}
              dataList="data-impact-direct-list"
            />
            <TaskListSection
              title="级联影响（依赖顺延）"
              rows={cascadeRows}
              dataList="data-impact-cascade-list"
            />
          </section>

          {/* 3) 关键路径漂移 */}
          <section
            data-impact-critical-path
            className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
          >
            <h3 className="text-xs font-semibold text-[var(--nx-text-primary)]">关键路径漂移</h3>
            {addedCpTasks.length === 0 && removedCpTasks.length === 0 ? (
              <p className="mt-1.5 text-xs text-[var(--nx-text-muted)]">关键路径无漂移</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-xs">
                {addedCpTasks.map((task) => (
                  <li
                    key={`add-${task.id}`}
                    data-cp-added
                    className="flex items-center gap-1.5 text-[var(--nx-workspace-blue)]"
                  >
                    <span className="font-bold">+</span> {task.name}
                    <span className="text-[var(--nx-text-muted)]">新加入关键路径</span>
                  </li>
                ))}
                {removedCpTasks.map((task) => (
                  <li
                    key={`rm-${task.id}`}
                    data-cp-removed
                    className="flex items-center gap-1.5 text-[var(--nx-text-muted)]"
                  >
                    <span className="font-bold">−</span> {task.name}
                    <span>脱离关键路径</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 4) 告警与冲突 + 已知晓确认 */}
          <section
            data-impact-warnings
            className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
          >
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--nx-text-primary)]">
              {summary.conflicts.total > 0 ? (
                <OctagonAlert className="h-3.5 w-3.5 text-[var(--nx-status-danger)]" aria-hidden />
              ) : (
                <AlertTriangle
                  className="h-3.5 w-3.5 text-[var(--nx-status-warning)]"
                  aria-hidden
                />
              )}
              排程告警与冲突
            </h3>

            {summary.conflicts.total > 0 ? (
              <p data-impact-conflicts className="mt-1.5 text-xs text-[var(--nx-status-danger)]">
                依赖环 {summary.conflicts.cycleCount} · 约束违反{' '}
                {summary.conflicts.constraintViolationCount}
              </p>
            ) : null}

            {blockerItems.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {blockerItems.map((item, index) => (
                  <WarningRow key={`blocker-${index}`} item={item} variant="blocker" />
                ))}
              </ul>
            ) : null}

            {hasWarnings || blockerItems.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {warningItems.map((item, index) => (
                  <WarningRow key={`warning-${index}`} item={item} variant="warning" />
                ))}
              </ul>
            ) : (
              <p data-impact-no-warnings className="mt-1.5 text-xs text-[var(--nx-text-muted)]">
                无排程告警
              </p>
            )}

            {hasWarnings ? (
              <label className="mt-3 flex items-start gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2.5 py-2 text-xs text-[var(--nx-text-secondary)]">
                <input
                  type="checkbox"
                  data-impact-confirm-warnings
                  checked={warningsConfirmed}
                  onChange={confirmWarnings}
                  className="mt-0.5 accent-[var(--nx-space-cyan)]"
                />
                <span>
                  已知晓告警
                  {!warningsConfirmed ? (
                    <span
                      data-impact-gate-hint
                      className="block text-[11px] text-[var(--nx-text-muted)]"
                    >
                      未勾选确认前，「应用方案」按钮保持禁用
                    </span>
                  ) : null}
                </span>
              </label>
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  )
}

function DrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] px-4 py-3">
      <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">试算影响摘要</h2>
      <button
        type="button"
        data-impact-close
        aria-label="关闭影响摘要"
        onClick={onClose}
        className="rounded-sm p-1 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

function TaskListSection({
  title,
  rows,
  dataList,
}: {
  title: string
  rows: TaskRow[]
  dataList: 'data-impact-direct-list' | 'data-impact-cascade-list'
}) {
  return (
    <section className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3">
      <h3 className="text-xs font-semibold text-[var(--nx-text-primary)]">
        {title}
        <span className="ml-1.5 text-[var(--nx-text-muted)]">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="mt-1.5 text-xs text-[var(--nx-text-muted)]">无</p>
      ) : (
        <ul {...{ [dataList]: '' }} className="mt-2 space-y-2">
          {rows.map((row) => (
            <li
              key={`${row.propagation}-${row.id}`}
              data-impact-task-row
              data-impact-propagation={row.propagation}
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2.5 py-2"
            >
              <p className="flex items-center justify-between gap-2 text-xs text-[var(--nx-text-primary)]">
                <span className="truncate font-medium">{row.name}</span>
                <span className="shrink-0 rounded-sm bg-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                  {reasonLabel(row.reasonCode)}
                </span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-[var(--nx-text-secondary)]">
                <span className="text-[var(--nx-text-muted)]">原排期</span>
                <span data-impact-before-date>{row.beforeDate}</span>
                <span className="text-[var(--nx-text-muted)]">→</span>
                <span className="text-[var(--nx-text-muted)]">试算</span>
                <span data-impact-after-date className="text-[var(--nx-text-primary)]">
                  {row.afterDate}
                </span>
                {row.beforeDuration !== row.afterDuration ? (
                  <span className="ml-auto text-[var(--nx-text-muted)]">
                    工期 {row.beforeDuration}天 → {row.afterDuration}天
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function WarningRow({ item, variant }: { item: EvidenceItem; variant: 'warning' | 'blocker' }) {
  return (
    <li
      data-impact-warning={variant}
      className={cn(
        'flex items-start gap-1.5 rounded-sm border px-2 py-1.5 text-[11px]',
        variant === 'blocker'
          ? 'border-[var(--nx-status-danger)]/40 bg-[var(--nx-status-danger)]/8 text-[var(--nx-status-danger)]'
          : 'border-[var(--nx-status-warning)]/40 bg-[var(--nx-status-warning)]/8 text-[var(--nx-status-warning)]',
      )}
    >
      {variant === 'blocker' ? (
        <OctagonAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      )}
      <span>
        {item.entityName} · {reasonLabel(item.reasonCode)}
      </span>
    </li>
  )
}

export default WorkspaceGanttImpactDrawer
