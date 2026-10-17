'use client'

import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import type { ComponentType } from 'react'
import {
  DRAFT_VALIDATION_DIMENSIONS,
  DRAFT_VALIDATION_DIMENSION_WEIGHTS,
  type DraftOverallRiskLevel,
  type DraftValidationIssue,
  type DraftValidationReport,
  type DraftValidationSeverity,
} from '@aiproj/types'
import { DIMENSION_LABELS, RISK_LEVEL_LABELS } from '@/components/next/theater/TheaterSettledView'
import { NextDraftValidationExportButton } from '../export/NextDraftValidationExportButton'

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

const RISK_COLORS: Readonly<Record<DraftOverallRiskLevel, string>> = {
  low: 'var(--nx-status-success)',
  medium: 'var(--nx-status-warning)',
  high: 'var(--nx-status-danger)',
  critical: 'var(--nx-status-danger)',
}

function riskIcon(level: DraftOverallRiskLevel): IconComponent {
  switch (level) {
    case 'low':
      return ShieldCheck
    case 'medium':
      return ShieldAlert
    case 'high':
      return AlertTriangle
    case 'critical':
      return ShieldOff
  }
}

/** 维度得分 → 能量条颜色：高分段绿、中分段黄、低分段红（双通道同时呈现文本分数）。 */
function scoreColor(score: number): string {
  if (score >= 80) return 'var(--nx-status-success)'
  if (score >= 60) return 'var(--nx-status-warning)'
  return 'var(--nx-status-danger)'
}

const SEVERITY_LABELS: Readonly<Record<DraftValidationSeverity, string>> = {
  blocking: '阻断',
  warning: '警告',
  info: '提示',
}

const SEVERITY_COLORS: Readonly<Record<DraftValidationSeverity, string>> = {
  blocking: 'var(--nx-status-danger)',
  warning: 'var(--nx-status-warning)',
  info: 'var(--nx-text-secondary)',
}

export interface NextDraftValidationReportProps {
  /** 服务端权威校验报告；为 null 时不渲染（由主容器兜底）。 */
  validation: DraftValidationReport | null
  /** 草案会话 ID（汇出报告卡短码派生源，如 `df_7e3f1a90` → #DRAFT-7E3F1A90）。 */
  draftId?: string
}

/** 整体风险等级徽章（颜色 + 图标 + 中文文本双通道）。 */
function RiskBadge({ level }: { level: DraftOverallRiskLevel }) {
  const token = RISK_COLORS[level]
  const Icon = riskIcon(level)
  return (
    <span
      data-risk-badge
      data-risk-level={level}
      className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-medium"
      style={{ color: token, borderColor: token }}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {RISK_LEVEL_LABELS[level]}
    </span>
  )
}

/** 单条规则违规明细（规则 ID / 严重度标签 / 中文消息 / 字段路径）。 */
function IssueRow({ issue }: { issue: DraftValidationIssue }) {
  const severityLabel = SEVERITY_LABELS[issue.severity]
  const severityToken = SEVERITY_COLORS[issue.severity]
  return (
    <li
      data-validation-issue
      className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          data-issue-rule-id
          className="rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-secondary)]"
        >
          [{issue.ruleId}]
        </span>
        <span
          data-issue-severity
          className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
          style={{ color: severityToken, borderColor: severityToken }}
        >
          {severityLabel}
        </span>
      </div>
      <p
        data-issue-message
        className="mt-1.5 text-[11px] leading-relaxed text-[var(--nx-text-primary)]"
      >
        {issue.message}
      </p>
      {issue.path !== null && issue.path.length > 0 ? (
        <span
          data-issue-path
          className="mt-1 block font-mono text-[10px] text-[var(--nx-text-muted)]"
        >
          {issue.path}
        </span>
      ) : null}
    </li>
  )
}

/**
 * 反幻觉自检报告（design D5 / tasks 2.3）。
 *
 * - 权威消费服务端 `DraftValidationReport`，严禁前端裁剪或改写（spec §反幻觉自检报告）；
 * - 五维能量条：事实准确性 0.30 / 逻辑一致性 0.25 / 假设清晰度 0.20 / 完整性 0.10 / 数值合理性 0.15；
 * - 整体风险等级徽章与 Blocking / Warning 分组明细；零写操作入口（RL-01、RL-06），
 *   头部另挂只读「汇出报告卡」按钮（v3-ui-next-chart-export，导出对齐 ai:view 只读权限）。
 */
export function NextDraftValidationReport({ validation, draftId }: NextDraftValidationReportProps) {
  if (validation === null) return null

  const { blocking, warning } = validation

  return (
    <section
      data-next-validation-report
      aria-label="反幻觉自检报告"
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2.5">
        <h3 className="text-xs font-semibold text-[var(--nx-text-primary)]">反幻觉自检报告</h3>
        <div className="flex items-center gap-2">
          <RiskBadge level={validation.overallRiskLevel} />
          {/* 汇出报告卡（v3-ui-next-chart-export W2）：紧随 RiskBadge 挂载，
              点击呼出 1200×630 反幻觉证据分享卡（validation 为 null 时本组件整体不渲染）。 */}
          <NextDraftValidationExportButton validation={validation} draftId={draftId} />
        </div>
      </header>

      <div className="flex items-baseline justify-between border-b border-[var(--nx-border-hairline)] px-3 py-2.5">
        <span className="text-[10px] text-[var(--nx-text-muted)]">综合置信度</span>
        <span
          data-confidence-score
          className="font-mono text-lg font-semibold text-[var(--nx-text-primary)]"
        >
          {Math.round(validation.confidenceScore)}
        </span>
      </div>

      <ul className="space-y-2.5 px-3 py-2.5">
        {DRAFT_VALIDATION_DIMENSIONS.map((dimension) => {
          const score = Math.round(validation.dimensionScores[dimension] ?? 0)
          const weight = DRAFT_VALIDATION_DIMENSION_WEIGHTS[dimension]
          return (
            <li key={dimension} data-dimension-bar data-dimension={dimension}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-[var(--nx-text-secondary)]">
                  {DIMENSION_LABELS[dimension]}
                </span>
                <span
                  data-dimension-weight
                  className="font-mono text-[10px] text-[var(--nx-text-muted)]"
                >
                  权重 {weight.toFixed(2)}
                </span>
              </div>
              <div
                role="meter"
                aria-label={`${DIMENSION_LABELS[dimension]}得分`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={score}
                className="mt-1 h-1.5 overflow-hidden rounded-sm bg-[var(--nx-bg-0)]"
              >
                <div
                  data-dimension-score
                  className="h-full rounded-sm"
                  style={{ width: `${score}%`, backgroundColor: scoreColor(score) }}
                />
              </div>
              <span
                data-dimension-score-value
                className="mt-0.5 block text-right font-mono text-[10px] text-[var(--nx-text-secondary)]"
              >
                {score}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="border-t border-[var(--nx-border-hairline)] px-3 py-2.5">
        <h4
          data-blocking-heading
          className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-status-danger)]"
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          阻断项（{blocking.length}）
        </h4>
        {blocking.length === 0 ? (
          <p
            data-blocking-empty
            className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            无阻断项
          </p>
        ) : (
          <ul data-blocking-list className="mt-1.5 space-y-1.5">
            {blocking.map((issue, index) => (
              <IssueRow key={`${issue.ruleId}-${index}`} issue={issue} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--nx-border-hairline)] px-3 py-2.5">
        <h4
          data-warning-heading
          className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-status-warning)]"
        >
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
          警告项（{warning.length}）
        </h4>
        {warning.length === 0 ? (
          <p data-warning-empty className="mt-1.5 text-[11px] text-[var(--nx-text-muted)]">
            无警告项
          </p>
        ) : (
          <ul data-warning-list className="mt-1.5 space-y-1.5">
            {warning.map((issue, index) => (
              <IssueRow key={`${issue.ruleId}-${index}`} issue={issue} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export default NextDraftValidationReport
