'use client'

import * as React from 'react'
import { ArrowRight, BadgeCheck, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  DRAFT_VALIDATION_DIMENSIONS,
  type DraftOverallRiskLevel,
  type DraftValidationDimension,
} from '@aiproj/types'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

/** 五维校验指标标准中文标签（静态映射，RL-14：禁止运行时注入）。 */
export const DIMENSION_LABELS: Readonly<Record<DraftValidationDimension, string>> = {
  factualAccuracy: '事实准确性',
  logicalConsistency: '逻辑一致性',
  assumptionClarity: '假设清晰度',
  completeness: '完整性',
  numericPlausibility: '数值合理性',
}

/** 整体风险等级中文标签。 */
export const RISK_LEVEL_LABELS: Readonly<Record<DraftOverallRiskLevel, string>> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '严重风险',
}

const RISK_LEVEL_TOKENS: Readonly<Record<DraftOverallRiskLevel, string>> = {
  low: 'var(--nx-status-success)',
  medium: 'var(--nx-status-warning)',
  high: 'var(--nx-status-danger)',
  critical: 'var(--nx-status-danger)',
}

/**
 * 草案会话 UID 截短编码：取字母数字字符的末 8 位并大写（如 `#DRAFT-7E3F1A90`）。
 * 确定性纯函数，供落定视图与审计展示共用。
 */
export function formatDraftShortCode(draftId: string): string {
  const alnum = draftId.replace(/[^a-zA-Z0-9]/g, '')
  const code = alnum.slice(-8).toUpperCase()
  return code.length > 0 ? code : 'PENDING'
}

export interface TheaterSettledViewProps {
  /** 草案会话标识（design D8 移交契约；短码展示用 formatDraftShortCode）。 */
  draftId: string
  /** 草案版本号（如 1 → 展示 v1）。 */
  version: number
  /** 点击「进入草案审查」回调（B2c 对接锚点：装配层调用 store.enterReview()）。 */
  onEnterReview: () => void
  /** 可选「重新生成」入口（沿用已确认上下文重新发起生成）。 */
  onRegenerate?: () => void
}

/**
 * 草案落定态视图（tasks 3.3 / design D8）。
 *
 * - draft.completed 沉淀入 store 后呈现：草案 UID 短码、版本号、9/9 模块完备绿标、
 *   初始五维校验评分与整体风险等级徽章；
 * - 主行动按钮「进入草案审查（Review Draft）」通过 onEnterReview 向 B2c 移交；
 * - **RL-01 零自动转正**：纯展示组件，零 useEffect、零网络请求、绝不调用
 *   confirm 接口；正式项目表零写入，必须由用户在审查阶段人工确认转正。
 */
export function TheaterSettledView({
  draftId,
  version,
  onEnterReview,
  onRegenerate,
}: TheaterSettledViewProps) {
  const validation = useAiProjectDraftStore((state) => state.validation)

  if (!validation) return null

  const riskToken = RISK_LEVEL_TOKENS[validation.overallRiskLevel]
  const riskLabel = RISK_LEVEL_LABELS[validation.overallRiskLevel]

  return (
    <section
      data-theater-settled
      aria-label="草案落定视图"
      className="nx-space-atmosphere mx-auto w-full max-w-3xl rounded-lg border border-[var(--nx-border-focus)]/60 bg-[var(--nx-workspace-surface)]/90 px-6 py-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            data-theater-settled-uid
            className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1 font-mono text-xs text-[var(--nx-text-secondary)]"
          >
            #DRAFT-{formatDraftShortCode(draftId)}
          </span>
          <span
            data-theater-settled-version
            className="rounded border border-[var(--nx-border-hairline)] px-2 py-1 font-mono text-[11px] text-[var(--nx-text-muted)]"
          >
            v{version}
          </span>
        </div>
        <span
          data-theater-settled-complete
          className="inline-flex items-center gap-1.5 rounded border border-[var(--nx-status-success)]/50 bg-[var(--nx-status-success)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--nx-status-success)]"
        >
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
          9/9 模块已就绪
        </span>
      </header>

      <div className="mt-4">
        <h2 className="text-base font-semibold text-[var(--nx-text-primary)]">
          项目草案已建造就绪，等待进入审查
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--nx-text-muted)]">
          草案会话已生成，尚未创建任何正式项目记录；经人工审查确认后才可转正落库。
        </p>
      </div>

      <div
        data-theater-settled-score
        className="mt-5 flex flex-wrap items-center gap-4 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--nx-text-muted)]">置信度评分</span>
          <span
            data-theater-settled-confidence
            className="font-mono text-lg font-semibold text-[var(--nx-text-primary)]"
          >
            {Math.round(validation.confidenceScore)}
          </span>
        </div>
        <span
          data-theater-settled-risk
          className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium"
          style={{ color: riskToken, borderColor: riskToken }}
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {riskLabel}
        </span>
        {validation.canConfirm ? (
          <span
            data-theater-settled-confirmable
            className="rounded border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2 py-1 text-[11px] text-[var(--nx-accent)]"
          >
            可进入审查
          </span>
        ) : null}
      </div>

      <dl data-theater-settled-dimensions className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {DRAFT_VALIDATION_DIMENSIONS.map((dimension) => (
          <div
            key={dimension}
            data-dimension={dimension}
            className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-center"
          >
            <dt className="text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
              {DIMENSION_LABELS[dimension]}
            </dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold text-[var(--nx-text-primary)]">
              {Math.round(validation.dimensionScores[dimension])}
            </dd>
          </div>
        ))}
      </dl>

      <footer className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-theater-enter-review
          onClick={onEnterReview}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 py-2 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)]"
        >
          进入草案审查（Review Draft）
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
        {onRegenerate ? (
          <button
            type="button"
            data-theater-regenerate
            onClick={onRegenerate}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 py-2 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            重新生成（Regenerate）
          </button>
        ) : null}
      </footer>
    </section>
  )
}

export default TheaterSettledView
