'use client'

import * as React from 'react'
import { AlertTriangle, RefreshCw, Sparkles, Target, Users, X } from 'lucide-react'
import type { ResourceSkillMatrixDrillDownResponse, SkillGapEntry } from '@aiproj/types'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import {
  useResourceSkillMatrixCandidates,
  useResourceSkillMatrixDrillDown,
  useResourceSkillMatrixSkillDetail,
  useResourceSkillMatrixSummary,
} from '@/hooks/use-resource-skill-matrix'
import { cn } from '@/lib/utils'
import {
  formatCapacityHours,
  formatCoveragePercent,
  getCoverageToneColor,
  getGapSeverityChipClass,
  getGapSeverityLabel,
  getSkillSourceLabel,
  getWarningToneChipClass,
} from '@/lib/next/org-skill-matrix/skill-matrix-adapter'
import { SkillCandidateCards } from './SkillCandidateCards'
import { SkillCoverageRing } from './SkillCoverageRing'
import { SkillGapTable } from './SkillGapTable'

/**
 * 技能矩阵工作台（v3-ui-next-org-portfolio-domains W8 · tasks 8.2/8.3，
 * spec「全局资源入口、技能矩阵与问题风险入口」技能矩阵项）。
 *
 * 组织级全局视窗（无 projectId 上下文；组织 ID 由页面经 auth 有效租户传入）：
 * - 首屏消费 `useResourceSkillMatrixSummary`（既有 GET /resource-skill-matrix/summary）：
 *   KPI 条（覆盖率/缺口/候选/Skill 建议）、warning 徽标、freshness 来源行、覆盖率环
 *   （SkillCoverageRing）与关键缺口表（SkillGapTable）；
 * - 选中技能后（覆盖行/缺口行任一入口）按需加载 `candidates`（候选资源卡）与
 *   `skill-detail`（advisory 只读提示，来源标注 + advisoryOnly + 零自动写，RL-01）；
 * - 候选卡「下钻明细」走既有 `drill-down` 只读二次授权端点（证据引用按 visibility
 *   低敏呈现）；契约 `{ items, meta }` 已与后端实码一致（v3-legacy-contract-debt-fixes
 *   2.1/2.2），直接消费 `items`（extractDrillDownItems）；
 * - 三态闭环：骨架（aria-busy）/ 语义空态 / 错误重试（4xx 中性「数据不可见」态与
 *   5xx 可重试态区分，RL-05）；全部交互只读，零写请求；
 * - 精确档降级：root 挂 data-immersion 剥离氛围光晕、以纯色发丝线呈现。
 */
export interface SkillMatrixWorkspaceProps {
  organizationId: number
}

/** 下钻端点响应解包（契约已对齐 `{ items, meta }`）。 */
function extractDrillDownItems(payload: ResourceSkillMatrixDrillDownResponse | undefined) {
  if (!payload || !Array.isArray(payload.items)) return []
  return payload.items
}

function getErrorStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status
    return typeof status === 'number' ? status : null
  }
  return null
}

export function SkillMatrixWorkspace({ organizationId }: SkillMatrixWorkspaceProps) {
  const tier = useImmersionTier()
  const [selectedSkillKey, setSelectedSkillKey] = React.useState<string | null>(null)
  const [drillSkillKey, setDrillSkillKey] = React.useState<string | null>(null)

  const summaryQuery = useResourceSkillMatrixSummary(organizationId)

  const candidatesQuery = useResourceSkillMatrixCandidates(
    organizationId,
    selectedSkillKey ?? '',
    undefined,
  )
  const skillDetailQuery = useResourceSkillMatrixSkillDetail(
    organizationId,
    selectedSkillKey ?? undefined,
  )
  const drillDownQuery = useResourceSkillMatrixDrillDown(
    organizationId,
    drillSkillKey === null ? undefined : 'resource',
    drillSkillKey ?? undefined,
  )

  const summary = summaryQuery.data
  const gapBySelectedSkill: SkillGapEntry | undefined = summary?.criticalGaps.find(
    (gap) => gap.skillKey === selectedSkillKey,
  )
  const drillDownRows = extractDrillDownItems(drillDownQuery.data)

  const selectSkill = React.useCallback((skillKey: string) => {
    setSelectedSkillKey(skillKey)
    setDrillSkillKey(null)
  }, [])
  const closeDetail = React.useCallback(() => {
    setSelectedSkillKey(null)
    setDrillSkillKey(null)
  }, [])

  // ── 三态：加载骨架 ──────────────────────────────────────────────────────
  if (summaryQuery.isLoading) {
    return (
      <div data-skill-matrix-skeleton aria-busy="true" className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-24 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            />
          ))}
        </div>
        <div className="h-64 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
        <div className="h-40 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
      </div>
    )
  }

  // ── 三态：错误（4xx 中性态 / 5xx 可重试） ─────────────────────────────────
  if (summaryQuery.isError || summary === undefined) {
    const status = getErrorStatus(summaryQuery.error)
    const retryable = status === null || status >= 500
    return (
      <div
        data-skill-matrix-error
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-8 py-12 text-center"
      >
        <AlertTriangle className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
          {retryable ? '加载技能矩阵失败' : '技能矩阵数据不可见'}
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          {retryable
            ? '服务暂不可用，请稍后重试。'
            : '当前组织无可访问的技能矩阵数据（数据可能已脱敏或当前组织暂无资源/需求）。'}
        </p>
        {retryable ? (
          <button
            type="button"
            data-skill-matrix-error-retry
            onClick={() => void summaryQuery.refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重试
          </button>
        ) : null}
      </div>
    )
  }

  const {
    overallCoverageRatio,
    totalGaps,
    totalCandidateResources,
    totalSkillAdvisories,
    coverageBySkill,
    criticalGaps,
    warnings,
  } = summary

  const isEmpty = coverageBySkill.length === 0 && criticalGaps.length === 0

  // ── 三态：语义空态 ───────────────────────────────────────────────────────
  if (isEmpty) {
    return (
      <div
        data-skill-matrix-empty
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-8 py-14 text-center"
      >
        <Target className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
        <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">暂无技能数据</h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          当前组织暂无资源或任务需求数据。为资源登记技能标签并建立任务需求后，技能矩阵将自动聚合展示。
        </p>
      </div>
    )
  }

  const calculatedAt = summary.meta.calculatedAt
    ? new Date(summary.meta.calculatedAt).toLocaleString('zh-CN')
    : '—'

  const detail = skillDetailQuery.data
  const detailAdvisories = detail?.advisory ?? []
  const selectedSeverity = gapBySelectedSkill?.severity ?? detail?.gapSeverity ?? null

  const kpis = [
    {
      key: 'coverage',
      label: '技能覆盖率',
      value: formatCoveragePercent(overallCoverageRatio),
      icon: Target,
      tone: getCoverageToneColor(overallCoverageRatio),
    },
    {
      key: 'gaps',
      label: '技能缺口',
      value: String(totalGaps),
      icon: AlertTriangle,
      tone: 'var(--nx-status-danger)',
    },
    {
      key: 'candidates',
      label: '候选资源',
      value: String(totalCandidateResources),
      icon: Users,
      tone: 'var(--nx-accent)',
    },
    {
      key: 'advisories',
      label: 'Skill 建议',
      value: String(totalSkillAdvisories),
      icon: Sparkles,
      tone: 'var(--nx-chart-4)',
    },
  ]

  return (
    <div
      data-skill-matrix-workspace
      data-immersion={tier}
      aria-busy={
        summaryQuery.isFetching ||
        candidatesQuery.isFetching ||
        skillDetailQuery.isFetching ||
        drillDownQuery.isFetching
      }
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-workspace-surface)]',
      )}
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Target className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">技能矩阵</h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              组织级技能覆盖 · 关键缺口 · 候选资源 · Skill advisory（只读分析）
            </p>
          </div>
        </div>
        <span className="text-[11px] text-[var(--nx-text-muted)]">计算时间：{calculatedAt}</span>
      </header>

      {/* warning 徽标 */}
      {warnings.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-skill-warnings>
          {warnings.map((warning, index) => (
            <span
              key={`${warning.code}-${index}`}
              data-skill-warning={warning.code}
              className={cn(
                'rounded-sm border px-2 py-0.5 text-[10px]',
                getWarningToneChipClass(warning.severity),
              )}
            >
              {warning.message}
            </span>
          ))}
        </div>
      ) : null}

      {/* KPI 条 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-skill-kpis>
        {kpis.map((kpi) => {
          const Icon = kpi.icon
          return (
            <div
              key={kpi.key}
              data-skill-kpi={kpi.key}
              className="flex items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-3"
            >
              <Icon className="h-5 w-5 shrink-0" style={{ color: kpi.tone }} aria-hidden />
              <div className="min-w-0">
                <p className="truncate font-mono text-lg font-semibold text-[var(--nx-text-primary)]">
                  {kpi.value}
                </p>
                <p className="truncate text-[10px] text-[var(--nx-text-muted)]">{kpi.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* 覆盖率环 + 关键缺口 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-skill-matrix-overview>
        <SkillCoverageRing
          overallRatio={overallCoverageRatio}
          rows={coverageBySkill}
          selectedSkillKey={selectedSkillKey}
          onSelectSkill={selectSkill}
        />
        <SkillGapTable
          gaps={criticalGaps}
          selectedSkillKey={selectedSkillKey}
          onSelectSkill={selectSkill}
        />
      </div>

      {/* 选中技能后的候选/建议/下钻面板（无选中时只读提示，零请求） */}
      {selectedSkillKey === null ? (
        <div
          data-skill-detail-empty
          className="rounded-lg border border-dashed border-[var(--nx-border-hairline)] px-4 py-6 text-center text-xs text-[var(--nx-text-muted)]"
        >
          在上方覆盖率行或关键缺口行选择一个技能，查看候选资源与 Skill 建议（只读）。
        </div>
      ) : (
        <section
          data-skill-detail-panel
          className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
        >
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                技能 {detail?.skillLabel ?? selectedSkillKey}
              </h3>
              {selectedSeverity ? (
                <span
                  data-skill-detail-severity
                  className={cn(
                    'rounded-sm border px-1.5 py-0.5 text-[10px]',
                    getGapSeverityChipClass(selectedSeverity),
                  )}
                >
                  {getGapSeverityLabel(selectedSeverity)}
                </span>
              ) : null}
              {gapBySelectedSkill ? (
                <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                  缺口 {formatCapacityHours(gapBySelectedSkill.gapCapacityHours)}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              data-skill-detail-close
              aria-label="取消技能选择"
              onClick={closeDetail}
              className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              取消选择
            </button>
          </header>

          {/* Skill advisory 只读提示（来源标注 + advisoryOnly + 零自动写，RL-01） */}
          {skillDetailQuery.isLoading ? (
            <div className="h-14 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)]" />
          ) : skillDetailQuery.isError ? (
            (() => {
              const detailStatus = getErrorStatus(skillDetailQuery.error)
              return (
                <div className="rounded-md border border-dashed border-[var(--nx-border-hairline)] px-3 py-2 text-[11px] text-[var(--nx-text-muted)]">
                  Skill advisory 暂不可见
                  {detailStatus !== null && detailStatus < 500
                    ? '（无查看 Skill 明细的权限或数据已脱敏）'
                    : '，请稍后重试'}
                </div>
              )
            })()
          ) : (
            <div data-skill-advisory-wrap>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-[var(--nx-chart-4)]" aria-hidden />
                <span
                  data-skill-advisory-source
                  className="text-[10px] text-[var(--nx-text-muted)]"
                >
                  Skill 建议 · 只读 — 来源：Compiler Skill 库自动匹配 · advisoryOnly 未激活 ·
                  不自动写入选程
                </span>
              </div>
              {detailAdvisories.length === 0 ? (
                <p className="rounded-md border border-dashed border-[var(--nx-border-hairline)] px-3 py-2 text-[11px] text-[var(--nx-text-muted)]">
                  暂无该技能的 Skill advisory
                </p>
              ) : (
                <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                  {detailAdvisories.map((advisory, index) => (
                    <li
                      key={`${advisory.skillKey}-${index}`}
                      data-skill-advisory={advisory.skillKey}
                      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-[var(--nx-text-primary)]">
                          {advisory.skillName}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                          v{advisory.skillVersion}
                        </span>
                        {advisory.evaluationOnly ? (
                          <span className="rounded-sm border border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]">
                            评审中 Eval
                          </span>
                        ) : (
                          <span className="rounded-sm border border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)] px-1.5 py-0.5 text-[10px] text-[var(--nx-status-success)]">
                            可用
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                        {advisory.matchReason}
                      </p>
                      {advisory.matchedTags.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {advisory.matchedTags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 候选资源卡（下钻明细） */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-[var(--nx-text-primary)]">
              候选资源
              <span className="ml-2 text-[10px] font-normal text-[var(--nx-text-muted)]">
                按技能 {selectedSkillKey} 的可用容量匹配
              </span>
            </h4>
            <SkillCandidateCards
              skillKey={selectedSkillKey}
              candidates={candidatesQuery.data?.candidates ?? []}
              isLoading={candidatesQuery.isLoading}
              onDrillDown={() => setDrillSkillKey(selectedSkillKey)}
            />
          </div>

          {/* 下钻明细（drill-down 只读二次授权） */}
          {drillSkillKey !== null ? (
            <div
              data-skill-drilldown
              className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-[var(--nx-text-primary)]">
                  下钻明细 · {drillSkillKey}
                </h4>
                <button
                  type="button"
                  data-skill-drilldown-close
                  aria-label="关闭下钻明细"
                  onClick={() => setDrillSkillKey(null)}
                  className="flex h-6 items-center rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-[10px] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]"
                >
                  关闭
                </button>
              </div>
              {drillDownQuery.isLoading ? (
                <div
                  data-skill-drilldown-loading
                  aria-busy="true"
                  className="flex flex-col gap-1.5"
                >
                  {[0, 1].map((item) => (
                    <div
                      key={item}
                      className="h-16 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)]"
                    />
                  ))}
                </div>
              ) : drillDownQuery.isError ? (
                (() => {
                  const drillStatus = getErrorStatus(drillDownQuery.error)
                  return (
                    <p className="rounded-md border border-dashed border-[var(--nx-border-hairline)] px-3 py-2 text-[11px] text-[var(--nx-text-muted)]">
                      {drillStatus !== null && drillStatus < 500
                        ? '下钻明细不可见（无权限或资源已不在当前组织）'
                        : '下钻明细加载失败，请稍后重试'}
                    </p>
                  )
                })()
              ) : drillDownRows.length === 0 ? (
                <p className="rounded-md border border-dashed border-[var(--nx-border-hairline)] px-3 py-2 text-[11px] text-[var(--nx-text-muted)]">
                  该技能暂无可用下钻明细
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {drillDownRows.map((item) => (
                    <li
                      key={item.itemId}
                      data-skill-drilldown-row={item.itemId}
                      className="flex flex-col gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--nx-text-primary)]">
                          {item.itemName}
                          <span className="ml-1.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                            #{item.itemId}
                          </span>
                        </span>
                        <span className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                          resource
                        </span>
                      </div>
                      {item.evidenceRefs.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.evidenceRefs.map((evidence, index) => (
                            <span
                              key={`${evidence.source}-${index}`}
                              data-skill-drilldown-evidence={evidence.visibility}
                              className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
                            >
                              {getSkillSourceLabel(evidence.source)} ·{' '}
                              {evidence.visibility === 'full'
                                ? evidence.valueSummary
                                : evidence.visibility === 'low_sensitivity'
                                  ? '低敏摘要'
                                  : '受限'}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </section>
      )}

      {/* fresh 来源行 */}
      <footer
        data-skill-freshness
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--nx-text-muted)]"
      >
        <span>来源新鲜度：</span>
        {summary.meta.sourceFreshness.map((source) => (
          <span key={source.source} className="inline-flex items-center gap-1">
            {getSkillSourceLabel(source.source)}
            <span
              className={cn(
                'rounded-sm px-1',
                source.stale
                  ? 'border border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]'
                  : 'border border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)] text-[var(--nx-status-success)]',
              )}
            >
              {source.stale ? '过时' : '当前'}
            </span>
          </span>
        ))}
      </footer>
    </div>
  )
}

export default SkillMatrixWorkspace
