'use client'

import type { ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileDiff,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react'
import type { ColleagueTrizRun } from '@/stores/next-ai-colleague-store'
import { TRIZ_TARGET_LABELS, type TrizInterventionTarget } from '@/lib/api/triz-copilot'
import { trizInterventionFieldLabel } from './triz-copilot-copy'

/**
 * 落库差异预览与显式确认卡（v3-triz-contradiction-copilot W5 · tasks 5.4）。
 *
 * - 受控纯展示组件：差异字段、挂接实体、来源标注与阶段全部由外层运行态提供；
 * - **RL-01 铁律**：只有用户显式点击「确认落库」才由外层携带 `previewToken` 发起 confirm；
 *   本组件不含任何定时器与自动提交路径（无点击 = 零写请求）；
 * - `previewing` / `committing` 为在途态；`committed` 呈现来源回执（分析记录 ID / 方案序号 /
 *   原则编号 / 落库实体 ID）；`conflict` 为 409 过期态，只提供「重新预览」与「放弃」，
 *   严禁静默重试或假成功；`cancelled` 呈现「未写入任何数据」。
 */
export interface TrizInterventionPreviewCardProps {
  run: ColleagueTrizRun
  /** 显式确认（携带本卡自己的 previewToken；外层做令牌一致性校验） */
  onConfirm: (previewToken: string) => void
  /** 放弃（本地销毁令牌，零网络请求） */
  onCancel: () => void
  /** 409 过期 / 失败后重新生成差异预览（以最新事实重发 execute 换新令牌） */
  onRepreview: () => void
}

function entityEntries(
  entity: Record<string, unknown>,
): Array<{ key: string; label: string; value: string }> {
  return Object.entries(entity)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({
      key,
      label: trizInterventionFieldLabel(key),
      value: Array.isArray(value) ? value.join('、') : String(value),
    }))
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mt-2 border-t border-[var(--nx-border-hairline)] pt-2">{children}</div>
}

export function TrizInterventionPreviewCard({
  run,
  onConfirm,
  onCancel,
  onRepreview,
}: TrizInterventionPreviewCardProps) {
  const { phase, targetKind, diff, receipt, error } = run
  const target: TrizInterventionTarget = targetKind ?? diff?.target ?? 'task'
  const targetLabel = TRIZ_TARGET_LABELS[target]
  const entries = diff ? entityEntries(diff.entity) : []

  if (phase === 'previewing') {
    return (
      <Shell>
        <div
          data-triz-intervention-preview
          data-phase="previewing"
          role="status"
          className="flex items-center gap-2 text-[11px] text-[var(--nx-text-secondary)]"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--nx-space-cyan)]" aria-hidden />
          正在生成「{targetLabel}」落库差异预览（业务数据尚未写入）…
        </div>
      </Shell>
    )
  }

  if (phase === 'committed') {
    return (
      <Shell>
        <div
          data-triz-intervention-preview
          data-phase="committed"
          data-target={target}
          className="rounded-md border border-[var(--nx-status-success)]/40 bg-[var(--nx-bg-0)] p-3"
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-status-success)]">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            已确认落库：{targetLabel}
          </div>
          <dl
            data-triz-receipt
            className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px] text-[var(--nx-text-secondary)]"
          >
            <dt>来源分析记录</dt>
            <dd data-receipt-analysis-id>#{receipt?.analysisId ?? run.analysisId ?? '—'}</dd>
            <dt>来源方案序号</dt>
            <dd data-receipt-solution-index>
              第 {receipt?.solutionIndex ?? run.selectedSolutionIndex ?? '—'} 条
            </dd>
            <dt>来源原则编号</dt>
            <dd data-receipt-principle-number>原则 #{receipt?.principleNumber ?? '—'}</dd>
            <dt>落库实体 ID</dt>
            <dd data-receipt-entity-id>#{receipt?.entityId ?? '—'}</dd>
          </dl>
          <p className="mt-2 text-[10px] text-[var(--nx-text-muted)]">
            令牌已失效；如需再次落库请重新生成预览（防重复写入）。
          </p>
        </div>
      </Shell>
    )
  }

  if (phase === 'cancelled') {
    return (
      <Shell>
        <div
          data-triz-intervention-preview
          data-phase="cancelled"
          className="flex items-center gap-2 text-[11px] text-[var(--nx-text-muted)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          已放弃落库：令牌已在本地销毁，未发起任何写请求，业务数据零变更。
        </div>
      </Shell>
    )
  }

  if (phase === 'conflict') {
    return (
      <Shell>
        <div
          data-triz-intervention-preview
          data-phase="conflict"
          className="rounded-md border border-[var(--nx-status-danger)]/40 bg-[var(--nx-bg-0)] p-3"
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-status-danger)]">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
            预览已过期（{error?.code ?? 'SCHEDULE_STALE'}）：底层数据在预览后被修改
          </div>
          <p className="mt-1 text-[11px] text-[var(--nx-text-secondary)]">
            {error?.message ?? '分析记录或绑定实体已被他人修改，请重新生成差异预览后再确认。'}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-triz-repreview
              onClick={onRepreview}
              className="inline-flex items-center gap-1 rounded border border-[var(--nx-space-cyan)]/50 px-2 py-1 text-[11px] text-[var(--nx-text-primary)] hover:bg-[var(--nx-bg-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              重新预览
            </button>
            <button
              type="button"
              data-triz-cancel
              onClick={onCancel}
              className="rounded border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              放弃落库
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (phase === 'error' && !diff) {
    return (
      <Shell>
        <div
          data-triz-intervention-preview
          data-phase="error"
          className="rounded-md border border-[var(--nx-status-danger)]/40 bg-[var(--nx-bg-0)] p-3 text-[11px] text-[var(--nx-text-secondary)]"
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-status-danger)]">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            落库流程未完成：{error?.message ?? '请求失败'}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-triz-repreview
              onClick={onRepreview}
              className="rounded border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              重新预览
            </button>
            <button
              type="button"
              data-triz-cancel
              onClick={onCancel}
              className="rounded border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              放弃落库
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (!diff) return null

  const committing = phase === 'committing'
  const provenance = diff.provenance

  return (
    <Shell>
      <div
        data-triz-intervention-preview
        data-phase={phase}
        data-target={target}
        className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-primary)]">
          <FileDiff className="h-3.5 w-3.5 text-[var(--nx-space-cyan)]" aria-hidden />
          差异预览 · 新建{targetLabel}
        </div>
        <p data-triz-provenance className="mt-1 text-[10px] text-[var(--nx-text-muted)]">
          来源：分析记录 #{provenance.analysisId} · 方案第 {provenance.solutionIndex} 条 · 原则 #
          {provenance.principleNumber} · 知识包 {provenance.knowledgePackVersion}
        </p>

        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px]">
          {entries.map((entry) => (
            <div key={entry.key} className="contents">
              <dt className="text-[var(--nx-text-muted)]">{entry.label}</dt>
              <dd
                data-triz-field={entry.key}
                className="break-words text-[var(--nx-text-secondary)]"
              >
                {entry.value}
              </dd>
            </div>
          ))}
          {entries.length === 0 && (
            <dd className="text-[var(--nx-text-muted)]">
              该目标无字段草案（异常回执，请重新预览）
            </dd>
          )}
        </dl>

        {diff.links.length > 0 && (
          <div data-triz-links className="mt-2 text-[11px] text-[var(--nx-text-secondary)]">
            关联实体：
            {diff.links.map((link) => `${link.label ?? link.ref}(${link.kind})`).join('、')}
          </div>
        )}

        {diff.notes.length > 0 && (
          <ul className="mt-2 list-disc pl-4 text-[10px] text-[var(--nx-text-muted)]">
            {diff.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}

        {(phase === 'error' || error) && diff && (
          <p className="mt-2 text-[11px] text-[var(--nx-status-danger)]">
            {error?.message ?? '提交失败，可重试确认或放弃'}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            data-triz-confirm
            disabled={committing}
            onClick={() => onConfirm(run.previewToken ?? '')}
            className="inline-flex items-center gap-1 rounded border border-[var(--nx-space-cyan)]/60 bg-[var(--nx-bg-1)] px-2.5 py-1 text-[11px] font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-space-cyan)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            {committing && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {committing ? '正在提交…' : '确认落库'}
          </button>
          <button
            type="button"
            data-triz-cancel
            disabled={committing}
            onClick={onCancel}
            className="rounded border border-[var(--nx-border-hairline)] px-2.5 py-1 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            放弃落库
          </button>
          <span className="text-[10px] text-[var(--nx-text-muted)]">确认前业务表零写入</span>
        </div>
      </div>
    </Shell>
  )
}
