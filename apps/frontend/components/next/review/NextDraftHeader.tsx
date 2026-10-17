'use client'

import * as React from 'react'
import { ShieldCheck } from 'lucide-react'
import type { ProjectType } from '@aiproj/types'
import { formatDraftShortCode } from '@/components/next/theater/TheaterSettledView'
import { projectTypeLabel } from '@/components/next/theater/TheaterIntentFeedback'

export interface NextDraftHeaderProps {
  /** 草案会话标识（短码派生源，如 `df_7e3f1a90` → #DRAFT-7E3F1A90）。 */
  draftId: string
  /** 草案版本号（如 1 → 展示 v1）。 */
  version: number
  /** 项目类型（消费 `draft.projectType`）。 */
  projectType: ProjectType
  /** 生成耗时毫秒；无数据时为 null → 展示「—」。 */
  elapsedMs: number | null
}

/** 生成耗时格式化：毫秒 → 「2.4s」；无数据 → 「—」。 */
export function formatElapsed(elapsedMs: number | null): string {
  if (elapsedMs === null || !Number.isFinite(elapsedMs)) return '—'
  return `${(elapsedMs / 1000).toFixed(1)}s`
}

/**
 * 审查工作面常驻信息顶栏（v3-ui-next-draft-review-panel tasks 3.5 / design D2）。
 *
 * - UID 短码 `#DRAFT-XXXXXXXX`（formatDraftShortCode 派生）、版本徽章 `v{n}`；
 * - 9/9 模块完备绿标（ShieldCheck 成功图标 + 中文双通道）；
 * - 生成耗时与项目类型中文徽章；
 * - 纯展示组件：零请求、零副作用、零正式表写入（RL-01）。
 */
export function NextDraftHeader({
  draftId,
  version,
  projectType,
  elapsedMs,
}: NextDraftHeaderProps) {
  return (
    <header
      data-next-draft-header
      aria-label="草案审查信息栏"
      className="flex flex-wrap items-center gap-2.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3"
    >
      <span
        data-draft-uid
        className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1 font-mono text-xs text-[var(--nx-text-secondary)]"
      >
        #DRAFT-{formatDraftShortCode(draftId)}
      </span>
      <span
        data-draft-version
        className="rounded border border-[var(--nx-border-hairline)] px-2 py-1 font-mono text-[11px] text-[var(--nx-text-muted)]"
      >
        v{version}
      </span>
      <span
        data-draft-complete
        className="inline-flex items-center gap-1.5 rounded border border-[var(--nx-status-success)]/50 bg-[var(--nx-status-success)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--nx-status-success)]"
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        9/9 模块已完备
      </span>
      <span
        data-draft-project-type
        className="rounded border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-muted)]"
      >
        {projectTypeLabel(projectType)}
      </span>
      <span
        data-draft-elapsed
        className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--nx-text-muted)]"
        title="生成耗时"
      >
        耗时
        <span className="text-[var(--nx-text-secondary)]">{formatElapsed(elapsedMs)}</span>
      </span>
    </header>
  )
}

export default NextDraftHeader
