'use client'

import * as React from 'react'
import Link from 'next/link'
import { QueryClientContext } from '@tanstack/react-query'
import {
  PROJECT_SIGNAL_TYPE_LABELS,
  SIGNAL_HIT_CONDITION_LABELS,
  signalCodeOf,
  type ProjectSignal,
} from '@/lib/api/project-signals'
import {
  useDismissProjectSignal,
  useRoleSignalQueue,
  type RoleSignalQueueItem,
} from '@/hooks/use-project-signals'
import {
  SIGNAL_SEVERITY_LABELS,
  SIGNAL_TIER_LABELS,
  evidenceCoverageLabel,
  evidenceRedactionNotice,
  evidenceWindowLabel,
  primaryEvidenceReadings,
  primaryEvidenceThresholds,
  signalSeverityChipClass,
  signalTierChipClass,
  tierSummaryText,
} from '@/lib/next/signals/signal-presentation'
import { openSignalSolverFlow } from '@/lib/next/signals/signal-solver-handoff'
import { CopyableCode } from '@/components/next/common/CopyableCode'
import { usePermissions } from '@/hooks/use-permissions'

/**
 * 角色首页「信号建议」队列（v3-triz-contradiction-copilot W6 · tasks 6.1 /
 * spec「建议队列与信号卡的承载边界」「低打扰与禁个人监控」）。
 *
 * 承载裁决（design D11 方式 ② / D17 ①）：**并列新增** `data-role-signal-queue` 区，
 * 挂载于 `RoleHomeContainer` 的 `[data-role-home]` 内、既有骨架卡槽
 * `<RoleSuggestionCards />` 之后（追加式）；骨架槽、`SuggestionSlot` 契约与
 * `role-bucket.ts` 零改动。
 *
 * 低打扰（spec 第 1 条）：纯被动收件箱——无弹窗、无推送、无自动打开面板、无打断；
 * 只有用户主动点击「进入矛盾求解」才会打开 AI 同事面板。
 * 只承载低置信信号（高置信归项目空间信号卡，同一信号不同时出现在两处，D10）。
 * 证据只呈现团队 / 项目聚合口径读数，DOM 中不存在任何按人维度的度量或排名。
 *
 * 无 QueryClient 的环境（纯静态用例）不渲染任何信号痕迹，绝不抛错。
 */
export function RoleSignalQueue() {
  const hasQueryClient = React.useContext(QueryClientContext) !== undefined
  if (!hasQueryClient) return null
  return <RoleSignalQueueLive />
}

export const ROLE_SIGNAL_QUEUE_HEADING = '信号建议'

/** 信号类型中文名（服务端标签优先，缺省回退同源常量）。 */
function signalTypeLabel(signal: ProjectSignal): string {
  return (
    signal.signalTypeLabel || PROJECT_SIGNAL_TYPE_LABELS[signal.signalType] || signal.signalType
  )
}

function RoleSignalQueueItemView({
  item,
  canTriggerAi,
}: {
  item: RoleSignalQueueItem
  canTriggerAi: boolean
}) {
  const { signal, projectId, projectName } = item
  const dismiss = useDismissProjectSignal()
  const dismissFailed = dismiss.isError && dismiss.variables?.signalId === signal.id

  const redactionNotice = evidenceRedactionNotice(signal)
  const evidence = signal.evidence

  return (
    <li
      data-role-signal-item={signal.id}
      className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
          {signalTypeLabel(signal)}
        </h3>
        <span
          data-role-signal-severity={signal.id}
          className={`rounded border px-1.5 py-0.5 text-[11px] leading-none ${signalSeverityChipClass(signal.severity)}`}
        >
          {SIGNAL_SEVERITY_LABELS[signal.severity] ?? signal.severity}
        </span>
        <span
          data-role-signal-tier={signal.id}
          className={`rounded border px-1.5 py-0.5 text-[11px] leading-none ${signalTierChipClass(signal.confidenceTier)}`}
        >
          {SIGNAL_TIER_LABELS[signal.confidenceTier]}
        </span>
        <CopyableCode
          code={signalCodeOf(signal)}
          data-testid={`signal-code-${signal.id}`}
          className="ml-auto text-[11px]"
        />
      </div>

      <p className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--nx-text-muted)]">
        <Link
          data-role-signal-project={signal.id}
          href={`/next/projects/${projectId}`}
          className="text-[var(--nx-text-secondary)] underline-offset-2 hover:text-[var(--nx-text-primary)] hover:underline"
        >
          {projectName}
        </Link>
        <span>观测窗 {signal.observationWindow}</span>
      </p>

      {evidence ? (
        <dl
          data-role-signal-evidence={signal.id}
          className="flex flex-col gap-1 font-mono text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
        >
          <div className="flex flex-wrap gap-x-3">
            {primaryEvidenceReadings(evidence, 3).map((entry) => (
              <span key={entry.key}>
                {entry.label}：{entry.value}
              </span>
            ))}
          </div>
          <div>
            阈值参考线：
            {primaryEvidenceThresholds(evidence, 2)
              .map((entry) => `${entry.label} ${entry.value}`)
              .join(' · ')}
          </div>
          <div>{evidenceWindowLabel(evidence)}</div>
          <div>{evidenceCoverageLabel(evidence)}</div>
          <div>
            命中：
            {evidence.hitConditions
              .map((condition) => SIGNAL_HIT_CONDITION_LABELS[condition] ?? condition)
              .join(' · ')}
          </div>
        </dl>
      ) : (
        <p
          data-role-signal-redacted={signal.id}
          className="text-xs leading-5 text-[var(--nx-text-muted)]"
        >
          {redactionNotice}
        </p>
      )}

      {evidence?.truncated ? (
        <p className="text-[11px] leading-5 text-[var(--nx-text-muted)]">
          事实读取被上限截断，读数可能不完整（已如实标注）。
        </p>
      ) : null}
      {evidence?.dataInsufficient ? (
        <p className="text-[11px] leading-5 text-[var(--nx-text-muted)]">
          数据不足：{evidence.insufficientReason ?? '关键数据缺失'}
        </p>
      ) : null}

      <p
        data-role-signal-tier-reason={signal.id}
        className="text-[11px] leading-5 text-[var(--nx-text-muted)]"
      >
        {tierSummaryText(signal)}
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-role-signal-dismiss={signal.id}
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate({ projectId, signalId: signal.id })}
          className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-60"
        >
          {dismiss.isPending && dismiss.variables?.signalId === signal.id ? '忽略中…' : '忽略'}
        </button>
        <button
          type="button"
          data-role-signal-solve={signal.id}
          disabled={!canTriggerAi}
          title={canTriggerAi ? undefined : '当前角色缺少 ai:trigger 权限'}
          onClick={() => openSignalSolverFlow({ projectId, signal })}
          className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-60"
        >
          进入矛盾求解
        </button>
      </div>

      {dismissFailed ? (
        <p
          data-role-signal-dismiss-error={signal.id}
          role="alert"
          className="text-[11px] text-[var(--nx-status-danger)]"
        >
          忽略失败，请稍后重试。
        </p>
      ) : null}
    </li>
  )
}

function RoleSignalQueueLive() {
  const { enabled, items, isLoading, isError, error, refetch } = useRoleSignalQueue()
  const { can } = usePermissions()
  const canTriggerAi = can('ai:trigger')

  // 未认证 / 组织上下文未就绪：不渲染任何信号痕迹（也不发请求）。
  if (!enabled) return null

  return (
    <section
      data-role-signal-queue
      aria-label="信号建议队列"
      className="relative z-[1] flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-[0.02em] text-[var(--nx-text-primary)]">
          {ROLE_SIGNAL_QUEUE_HEADING}
        </h2>
        <span className="font-mono text-xs text-[var(--nx-text-muted)]">
          低置信 · 被动收件箱 · 团队聚合口径
        </span>
      </div>
      <p className="text-xs leading-5 text-[var(--nx-text-muted)]">
        来自既有项目数据的被动读数，只在你查看时呈现：不弹窗、不推送、不打断当前操作；
        高置信信号归项目空间信号卡。
      </p>

      {isError ? (
        <div
          data-role-signal-queue-error
          role="alert"
          aria-label="信号读取失败"
          className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
        >
          <h3 className="text-sm font-medium text-[var(--nx-status-danger)]">信号读取失败</h3>
          <p className="text-xs leading-5 text-[var(--nx-text-muted)]">
            {errorMessageOf(error)}（当前未展示任何信号，也不代表没有信号。）
          </p>
          <button
            type="button"
            data-role-signal-retry
            onClick={refetch}
            className="inline-flex h-8 w-fit items-center justify-center rounded-md border border-[var(--nx-border-focus)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            重新载入
          </button>
        </div>
      ) : isLoading ? (
        <div
          data-role-signal-queue-loading
          role="status"
          aria-busy="true"
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 text-xs text-[var(--nx-text-muted)]"
        >
          正在读取信号…
        </div>
      ) : items.length === 0 ? (
        <div
          data-role-signal-queue-empty
          role="status"
          className="flex flex-col gap-1 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
        >
          <p className="text-xs leading-5 text-[var(--nx-text-secondary)]">
            当前没有待查看的低置信信号。
          </p>
          <p className="text-[11px] leading-5 text-[var(--nx-text-muted)]">
            雷达只列出真实越界的读数；无越界时保持空白，不预填任何内容。
          </p>
        </div>
      ) : (
        <ul
          data-role-signal-queue-list
          aria-label="低置信信号列表"
          className="grid list-none gap-3 p-0 lg:grid-cols-2"
        >
          {items.map((item) => (
            <RoleSignalQueueItemView key={item.signal.id} item={item} canTriggerAi={canTriggerAi} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** 错误文案（保留服务端 message，供错误态与空态可辨识）。 */
function errorMessageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown }
    if (typeof candidate.message === 'string' && candidate.message.trim() !== '') {
      return candidate.message
    }
  }
  return '信号数据读取失败，请稍后重试'
}

export default RoleSignalQueue
