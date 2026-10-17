'use client'

import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import type { ComponentType } from 'react'
import {
  DRAFT_VALIDATION_DIMENSIONS,
  type DraftOverallRiskLevel,
  type DraftValidationDimension,
  type DraftValidationReport,
} from '@aiproj/types'
import { MONO_FONT_STACK } from '@/lib/next/chart-export'
import { extractValidationMetrics } from '@/lib/next/share-card-metrics'

/** 五维校验指标标准中文标签（RL-14：静态映射，禁止运行时注入）。 */
const DIMENSION_LABELS: Readonly<Record<DraftValidationDimension, string>> = {
  factualAccuracy: '事实准确性',
  logicalConsistency: '逻辑一致性',
  assumptionClarity: '假设清晰度',
  completeness: '完整性',
  numericPlausibility: '数值合理性',
}

/** 整体风险等级中文标签。 */
const RISK_LEVEL_LABELS: Readonly<Record<DraftOverallRiskLevel, string>> = {
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

function riskIcon(level: DraftOverallRiskLevel): ComponentType<{ className?: string }> {
  switch (level) {
    case 'low':
      return ShieldCheck
    case 'medium':
      return ShieldAlert
    default:
      return ShieldOff
  }
}

/** 维度得分 → 能量条颜色：高分段绿、中分段黄、低分段红（文本分数双通道）。 */
function scoreColor(score: number): string {
  if (score >= 80) return 'var(--nx-status-success)'
  if (score >= 60) return 'var(--nx-status-warning)'
  return 'var(--nx-status-danger)'
}

export interface ValidationReportShareCardTemplateProps {
  /** 服务端权威反幻觉自检报告（spec：严禁前端伪造或裁剪）。 */
  validation: DraftValidationReport
}

/** 卡片内最多嵌入的 Blocking/Warning 规则编号数量。 */
const MAX_RULE_CHIPS = 3

/**
 * 反幻觉自检报告分享卡数据区模板（design §8 / spec §草案审查面板接入点）。
 *
 * - 左侧：综合置信度大字 + 风险等级盾牌徽章 + 阻断/警告计数与规则编号；
 * - 右侧：五维加权能量条（事实 0.30 / 逻辑 0.25 / 假设 0.20 / 完整 0.10 / 数值 0.15）。
 */
export function ValidationReportShareCardTemplate({
  validation,
}: ValidationReportShareCardTemplateProps) {
  const metrics = extractValidationMetrics(validation)
  const RiskIcon = riskIcon(metrics.overallRiskLevel)
  const riskToken = RISK_LEVEL_TOKENS[metrics.overallRiskLevel]
  const ruleChips = [
    ...metrics.blockingRuleIds.map((ruleId) => ({
      ruleId,
      tone: 'var(--nx-status-danger)',
    })),
    ...metrics.warningRuleIds.map((ruleId) => ({
      ruleId,
      tone: 'var(--nx-status-warning)',
    })),
  ].slice(0, MAX_RULE_CHIPS)

  return (
    <div data-validation-template style={{ flex: 1, minWidth: 0, display: 'flex', gap: 24 }}>
      <div
        style={{
          width: 330,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '18px 20px',
          borderRadius: 8,
          border: '1px solid var(--nx-border-hairline)',
          backgroundColor: 'var(--nx-bg-0)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, color: 'var(--nx-text-muted)' }}>综合置信度</span>
          <span
            data-validation-confidence
            style={{
              fontSize: 52,
              lineHeight: '56px',
              fontWeight: 700,
              color: 'var(--nx-text-primary)',
              fontFamily: MONO_FONT_STACK,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {metrics.confidenceScore}
          </span>
        </div>

        <span
          data-validation-risk
          data-risk-level={validation.overallRiskLevel}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 12px',
            borderRadius: 999,
            border: `1px solid ${riskToken}`,
            color: riskToken,
            fontSize: 13,
            fontWeight: 600,
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          <RiskIcon data-icon className="h-4 w-4" aria-hidden />
          {RISK_LEVEL_LABELS[metrics.overallRiskLevel]}
        </span>

        <div
          data-validation-issue-counts
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            marginTop: 4,
            paddingTop: 12,
            borderTop: '1px solid var(--nx-border-hairline)',
            fontSize: 12,
            color: 'var(--nx-text-secondary)',
            fontFamily: MONO_FONT_STACK,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span data-validation-blocking-count>
            阻断项：<b style={{ color: 'var(--nx-status-danger)' }}>{metrics.blockingCount}</b>
          </span>
          <span data-validation-warning-count>
            警告项：<b style={{ color: 'var(--nx-status-warning)' }}>{metrics.warningCount}</b>
          </span>
          {ruleChips.length > 0 ? (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
              {ruleChips.map(({ ruleId, tone }) => (
                <span
                  key={ruleId}
                  data-validation-rule-chip
                  style={{
                    padding: '1px 6px',
                    borderRadius: 4,
                    border: `1px solid ${tone}`,
                    color: tone,
                    fontSize: 10,
                  }}
                >
                  [{ruleId}]
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '18px 20px',
          borderRadius: 8,
          border: '1px solid var(--nx-border-hairline)',
          backgroundColor: 'var(--nx-bg-0)',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--nx-text-muted)' }}>五维反幻觉加权检定</span>
        {DRAFT_VALIDATION_DIMENSIONS.map((dimension) => {
          const score = Math.round(metrics.dimensionScores[dimension] ?? 0)
          const weight = metrics.dimensionWeights[dimension]
          return (
            <div
              key={dimension}
              data-dimension-bar
              data-dimension={dimension}
              style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--nx-text-primary)' }}>
                  {DIMENSION_LABELS[dimension]}
                </span>
                <span
                  data-dimension-weight
                  style={{
                    fontSize: 10,
                    color: 'var(--nx-text-muted)',
                    fontFamily: MONO_FONT_STACK,
                  }}
                >
                  权重 {weight.toFixed(2)}
                </span>
                <span
                  data-dimension-score
                  style={{
                    marginLeft: 'auto',
                    fontSize: 13,
                    fontWeight: 600,
                    color: scoreColor(score),
                    fontFamily: MONO_FONT_STACK,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {score}
                </span>
              </div>
              <div
                role="meter"
                aria-label={`${DIMENSION_LABELS[dimension]}得分`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={score}
                style={{
                  height: 8,
                  borderRadius: 4,
                  overflow: 'hidden',
                  backgroundColor: 'var(--nx-bg-1)',
                }}
              >
                <div
                  data-dimension-score-bar
                  style={{
                    height: '100%',
                    borderRadius: 4,
                    width: `${score}%`,
                    backgroundColor: scoreColor(score),
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ValidationReportShareCardTemplate
