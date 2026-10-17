'use client'

import * as React from 'react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/Sheet'
import {
  PROJECT_SIGNAL_TYPE_LABELS,
  SIGNAL_HIT_CONDITION_LABELS,
  signalCodeOf,
  type ProjectSignal,
} from '@/lib/api/project-signals'
import { useDismissProjectSignal, useProjectSignals } from '@/hooks/use-project-signals'
import { usePermissions } from '@/hooks/use-permissions'
import {
  SIGNAL_SEVERITY_LABELS,
  SIGNAL_TIER_LABELS,
  evidenceCoverageLabel,
  evidenceRedactionNotice,
  evidenceWindowLabel,
  formatReadingValue,
  primaryEvidenceReadings,
  primaryEvidenceThresholds,
  signalReadingLabel,
  signalSeverityChipClass,
  signalThresholdLabel,
  signalTierChipClass,
  tierConditionViews,
  tierSummaryText,
} from '@/lib/next/signals/signal-presentation'
import { openSignalSolverFlow } from '@/lib/next/signals/signal-solver-handoff'
import { CopyableCode } from '@/components/next/common/CopyableCode'

/**
 * 项目空间「高置信信号卡」（v3-triz-contradiction-copilot W6 · tasks 6.2 /
 * spec「建议队列与信号卡的承载边界」第 3/4 条、「信号到矛盾求解流的跳转」）。
 *
 * 挂载位置（design D17 ②）：`ProjectSpaceContainer` 成功态分支内
 * `<ProjectTimelineBar />` 之后、首个镜头槽条件分支之前，由容器提供
 * `<section data-project-space-signal-slot aria-label="项目信号区域">`。
 * 卡片**在自身行位内**参与文档流，不使用 `fixed` / 绝对定位浮层，不压
 * `[data-project-space-lens-slot]`；骨架态 / 404 态 / 错误态不挂载（零信号痕迹）。
 *
 * 只承载**高置信**信号（`confidenceTier=high`，低置信归角色首页建议队列）；
 * 走读前先做 `confidenceTier` 二次守卫，服务端分层变更也不会串场。
 * 证据、读数、阈值与基期均为团队 / 项目聚合口径；证据明细抽屉为只读，
 * 不含任何按人维度的度量或排名（design D9 ③）。
 */
export interface ProjectSignalCardsProps {
  projectId: number
}

export const PROJECT_SIGNAL_CARDS_HEADING = '高置信信号'

function signalTypeLabel(signal: ProjectSignal): string {
  return (
    signal.signalTypeLabel || PROJECT_SIGNAL_TYPE_LABELS[signal.signalType] || signal.signalType
  )
}

function ProjectSignalCard({
  projectId,
  signal,
  canTriggerAi,
  onOpenEvidence,
}: {
  projectId: number
  signal: ProjectSignal
  canTriggerAi: boolean
  onOpenEvidence: (signal: ProjectSignal) => void
}) {
  const dismiss = useDismissProjectSignal()
  const evidence = signal.evidence
  const redactionNotice = evidenceRedactionNotice(signal)
  const compositeTypes = evidence?.compositeTypes ?? []

  return (
    <li
      data-project-signal-card={signal.id}
      // 浮卡视觉（阴影 + 抬升背景）但仍在文档流内：不遮工作面、不吸顶压插槽。
      className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 shadow-[0_12px_32px_-24px_rgba(0,0,0,0.9)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium text-[var(--nx-text-primary)]">
          {signalTypeLabel(signal)}
        </h4>
        <span
          data-project-signal-severity={signal.id}
          className={`rounded border px-1.5 py-0.5 text-[11px] leading-none ${signalSeverityChipClass(signal.severity)}`}
        >
          {SIGNAL_SEVERITY_LABELS[signal.severity] ?? signal.severity}
        </span>
        <span
          data-project-signal-tier={signal.id}
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

      <p
        data-project-signal-tier-reason={signal.id}
        className="text-[11px] leading-5 text-[var(--nx-text-muted)]"
      >
        {tierSummaryText(signal)}
      </p>

      {evidence ? (
        <dl
          data-project-signal-evidence-summary={signal.id}
          className="flex flex-col gap-1 font-mono text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
        >
          <div className="flex flex-wrap gap-x-3">
            {primaryEvidenceReadings(evidence, 4).map((entry) => (
              <span key={entry.key}>
                {entry.label}：{entry.value}
              </span>
            ))}
          </div>
          <div>
            阈值：
            {primaryEvidenceThresholds(evidence, 3)
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
          {compositeTypes.length > 1 ? (
            <div data-project-signal-composite={signal.id}>
              复合证据：
              {compositeTypes.map((type) => PROJECT_SIGNAL_TYPE_LABELS[type] ?? type).join(' + ')}
            </div>
          ) : null}
        </dl>
      ) : (
        <p
          data-project-signal-redacted={signal.id}
          className="text-xs leading-5 text-[var(--nx-text-muted)]"
        >
          {redactionNotice}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-project-signal-evidence-trigger={signal.id}
          onClick={() => onOpenEvidence(signal)}
          className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          证据明细
        </button>
        <button
          type="button"
          data-project-signal-solve={signal.id}
          disabled={!canTriggerAi}
          title={canTriggerAi ? undefined : '当前角色缺少 ai:trigger 权限'}
          onClick={() => openSignalSolverFlow({ projectId, signal })}
          className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-60"
        >
          进入矛盾求解
        </button>
        <button
          type="button"
          data-project-signal-dismiss={signal.id}
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate({ projectId, signalId: signal.id })}
          className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-60"
        >
          {dismiss.isPending && dismiss.variables?.signalId === signal.id ? '忽略中…' : '忽略'}
        </button>
      </div>

      {dismiss.isError && dismiss.variables?.signalId === signal.id ? (
        <p
          data-project-signal-dismiss-error={signal.id}
          role="alert"
          className="text-[11px] text-[var(--nx-status-danger)]"
        >
          忽略失败，请稍后重试。
        </p>
      ) : null}
    </li>
  )
}

/** 只读证据明细抽屉（数值 / 阈值 / 基期 / 覆盖周期 / 分层理由 / 实体引用计数）。 */
function SignalEvidenceDrawer({
  signal,
  onOpenChange,
}: {
  signal: ProjectSignal | null
  onOpenChange: (open: boolean) => void
}) {
  const evidence = signal?.evidence ?? null
  const redactionNotice = signal ? evidenceRedactionNotice(signal) : null

  return (
    <Sheet open={signal !== null} onOpenChange={onOpenChange}>
      <SheetContent
        data-next-track
        data-project-signal-evidence-drawer
        className="overflow-y-auto border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]"
      >
        <SheetTitle className="text-base font-semibold text-[var(--nx-text-primary)]">
          {signal ? `${signalTypeLabel(signal)} · 证据明细` : '证据明细'}
        </SheetTitle>
        <SheetDescription className="text-xs text-[var(--nx-text-muted)]">
          低敏证据（数值 / 阈值 / 基期 / 实体引用计数），只到团队与项目聚合口径，只读不写入。
        </SheetDescription>

        {signal ? (
          <div data-project-signal-evidence-body className="mt-4 flex flex-col gap-4 p-1 text-xs">
            {evidence ? (
              <>
                <section className="flex flex-col gap-1">
                  <h4 className="text-xs font-medium text-[var(--nx-text-primary)]">读数</h4>
                  <dl className="grid grid-cols-1 gap-1 font-mono text-[11px] text-[var(--nx-text-secondary)] sm:grid-cols-2">
                    {Object.entries(evidence.readings).map(([key, value]) => (
                      <div key={key} data-project-signal-reading={key} className="flex gap-2">
                        <dt className="shrink-0">{signalReadingLabel(key)}</dt>
                        <dd>{formatReadingValue(key, value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="flex flex-col gap-1">
                  <h4 className="text-xs font-medium text-[var(--nx-text-primary)]">阈值</h4>
                  <dl className="grid grid-cols-1 gap-1 font-mono text-[11px] text-[var(--nx-text-secondary)] sm:grid-cols-2">
                    {Object.entries(evidence.thresholds).map(([key, value]) => (
                      <div key={key} data-project-signal-threshold={key} className="flex gap-2">
                        <dt className="shrink-0">{signalThresholdLabel(key)}</dt>
                        <dd>{formatReadingValue(key, value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="flex flex-col gap-1">
                  <h4 className="text-xs font-medium text-[var(--nx-text-primary)]">
                    观测窗与基期
                  </h4>
                  <p className="font-mono text-[11px] text-[var(--nx-text-secondary)]">
                    {evidenceWindowLabel(evidence)}
                  </p>
                  <p className="font-mono text-[11px] text-[var(--nx-text-secondary)]">
                    {evidenceCoverageLabel(evidence)} · 窗口长度 {evidence.window.days} 天
                  </p>
                </section>

                <section className="flex flex-col gap-1">
                  <h4 className="text-xs font-medium text-[var(--nx-text-primary)]">
                    复合证据与命中条件
                  </h4>
                  <p className="text-[11px] text-[var(--nx-text-secondary)]">
                    命中：
                    {evidence.hitConditions
                      .map((condition) => SIGNAL_HIT_CONDITION_LABELS[condition] ?? condition)
                      .join(' · ') || '—'}
                  </p>
                  <p className="text-[11px] text-[var(--nx-text-secondary)]">
                    同窗复合类型：
                    {evidence.compositeTypes
                      .map((type) => PROJECT_SIGNAL_TYPE_LABELS[type] ?? type)
                      .join(' + ') || '—'}
                  </p>
                </section>

                <section className="flex flex-col gap-1">
                  <h4 className="text-xs font-medium text-[var(--nx-text-primary)]">分层理由</h4>
                  <ul className="list-none space-y-1 p-0 text-[11px] text-[var(--nx-text-secondary)]">
                    {tierConditionViews(signal).map((condition) => (
                      <li key={condition.key} data-project-signal-tier-condition={condition.key}>
                        {condition.hit ? '已命中' : '未命中'} · {condition.label}
                        {condition.detail ? `（${condition.detail}）` : ''}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="flex flex-col gap-1">
                  <h4 className="text-xs font-medium text-[var(--nx-text-primary)]">证据引用</h4>
                  <p className="text-[11px] text-[var(--nx-text-secondary)]">
                    项目实体引用计数：登记项 {evidence.entityRefs.risks?.length ?? 0} · 缺陷{' '}
                    {evidence.entityRefs.issues?.length ?? 0} · 里程碑{' '}
                    {evidence.entityRefs.milestones?.length ?? 0}
                  </p>
                  <p className="text-[11px] text-[var(--nx-text-muted)]">
                    {evidence.truncated ? '事实读取被上限截断，读数可能不完整。' : '读数未被截断。'}
                    {evidence.dataInsufficient
                      ? ` 数据不足：${evidence.insufficientReason ?? '关键数据缺失'}。`
                      : ''}
                  </p>
                  {signal.expiresAt ? (
                    <p className="font-mono text-[11px] text-[var(--nx-text-muted)]">
                      过期时间：{signal.expiresAt}
                    </p>
                  ) : null}
                  <p className="font-mono text-[11px] text-[var(--nx-text-muted)]">
                    幂等键：{signal.idempotencyKey}
                  </p>
                </section>
              </>
            ) : (
              <p className="text-[11px] text-[var(--nx-text-muted)]">{redactionNotice}</p>
            )}

            <p className="text-[11px] leading-5 text-[var(--nx-text-muted)]">
              以上读数均为团队 / 项目聚合口径，不含任何按人拆分的数据。
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export function ProjectSignalCards({ projectId }: ProjectSignalCardsProps) {
  const { data, isPending, isError } = useProjectSignals(projectId)
  const { can } = usePermissions()
  const [openSignal, setOpenSignal] = React.useState<ProjectSignal | null>(null)

  const canTriggerAi = can('ai:trigger')
  // 分层路由守卫：只渲染高置信（服务端已按 confidenceTier 过滤，这里再兜一层）。
  const signals = React.useMemo(
    () => (data?.data ?? []).filter((signal) => signal.confidenceTier === 'high'),
    [data],
  )

  // 无信号 / 读取中 / 读取失败：不渲染任何信号痕迹（低打扰；错误态由角色首页队列承载）。
  if (isPending || isError || signals.length === 0) return null

  return (
    <div data-project-signal-cards className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
          {PROJECT_SIGNAL_CARDS_HEADING}
        </h3>
        <span className="font-mono text-xs text-[var(--nx-text-muted)]">
          {signals.length} 条 · 团队聚合口径 · 只读
        </span>
      </div>

      <ul
        data-project-signal-card-list
        aria-label="高置信信号列表"
        className="grid list-none gap-3 p-0 xl:grid-cols-2"
      >
        {signals.map((signal) => (
          <ProjectSignalCard
            key={signal.id}
            projectId={projectId}
            signal={signal}
            canTriggerAi={canTriggerAi}
            onOpenEvidence={setOpenSignal}
          />
        ))}
      </ul>

      <SignalEvidenceDrawer
        signal={openSignal}
        onOpenChange={(open) => {
          if (!open) setOpenSignal(null)
        }}
      />
    </div>
  )
}

export default ProjectSignalCards
