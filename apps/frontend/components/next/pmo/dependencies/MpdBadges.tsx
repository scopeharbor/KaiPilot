'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  freshnessMeta,
  MPD_FRESHNESS_LABELS,
  riskMeta,
  statusMeta,
  type MpdTone,
} from './mpd-adapter'

/**
 * 跨项目依赖域状态徽标（双通道：色点 + 文字；RL-15 状态双通道）。
 * 供底册表格 / 详情抽屉 / 预览 Diff 复用，全部走 mpd-adapter 静态枚举标签。
 */

export const MPD_TONE_CLASSES: Record<MpdTone, { chip: string; dot: string; text: string }> = {
  success: {
    chip: 'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.08)]',
    dot: 'bg-[var(--nx-status-success)]',
    text: 'text-[var(--nx-status-success)]',
  },
  warning: {
    chip: 'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)]',
    dot: 'bg-[var(--nx-status-warning)]',
    text: 'text-[var(--nx-status-warning)]',
  },
  danger: {
    chip: 'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)]',
    dot: 'bg-[var(--nx-status-danger)]',
    text: 'text-[var(--nx-status-danger)]',
  },
  info: {
    chip: 'border-[rgba(56,189,248,0.35)] bg-[rgba(56,189,248,0.08)]',
    dot: 'bg-[var(--nx-accent)]',
    text: 'text-[var(--nx-accent)]',
  },
  neutral: {
    chip: 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]',
    dot: 'bg-[var(--nx-text-muted)]',
    text: 'text-[var(--nx-text-secondary)]',
  },
}

function toneClasses(tone: MpdTone) {
  return MPD_TONE_CLASSES[tone]
}

/** 生命周期/legacy 状态徽标。 */
export function MpdStatusBadge({ value, className }: { value: string; className?: string }) {
  const meta = statusMeta(value)
  const tones = toneClasses(meta.tone)
  return (
    <span
      data-mpd-status={value}
      data-mpd-tone={meta.tone}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px]',
        tones.chip,
        tones.text,
        className,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', tones.dot)} />
      {meta.label}
    </span>
  )
}

/** 风险等级徽标（色阶与图谱边同源，见 mpd-adapter MPD_RISK_COLOR_VAR）。 */
export function MpdRiskBadge({ value, className }: { value: string; className?: string }) {
  const meta = riskMeta(value)
  const tones = toneClasses(meta.tone)
  return (
    <span
      data-mpd-risk={value}
      data-mpd-tone={meta.tone}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px]',
        tones.chip,
        tones.text,
        className,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', tones.dot)} />
      {meta.label}
    </span>
  )
}

/** 新鲜度徽标（fresh/stale/unknown；无字段时不渲染）。 */
export function MpdFreshnessChip({
  value,
  checkedAt,
  className,
}: {
  value: string | null
  checkedAt?: string | null
  className?: string
}) {
  if (!value) return null
  const meta = freshnessMeta(value)
  const tones = toneClasses(meta.tone)
  const label = MPD_FRESHNESS_LABELS[value] ?? meta.label
  return (
    <span
      data-mpd-freshness={value}
      data-mpd-tone={meta.tone}
      title={checkedAt ? `检查于 ${checkedAt}` : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px]',
        tones.chip,
        tones.text,
        className,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', tones.dot)} />
      {label}
    </span>
  )
}

/** 警告码小型标签（只读提示）。 */
export function MpdWarningChips({ codes }: { codes: string[] }) {
  if (!codes || codes.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {codes.map((code) => (
        <span
          key={code}
          data-mpd-warning-code={code}
          className="inline-flex items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-text-muted)]"
        >
          {code}
        </span>
      ))}
    </span>
  )
}
