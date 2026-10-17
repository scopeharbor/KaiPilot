'use client'

import { ShieldCheck, Target } from 'lucide-react'
import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * 风险列表结构化卡片（v3-ui-next-ai-colleague spec「结构化查询结果卡片渲染」）。
 *
 * - 消费只读工具 `list_project_risks` 的输出：风险描述、严重度语义徽标
 *   （冷红 / 琥珀 / 中性冷青双通道：色彩 + 中文）、应对状态与责任人；
 * - 附带评分与处置期限等仪器感辅助信息；所有字段经防御收敛，绝不抛错。
 */

/** 风险严重度双通道标签（与风险工作台 SEVERITY_LABELS 对齐）。 */
export const RISK_LEVEL_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}

/** 严重度语义色（冷红高风险 / 琥珀中风险 / 中性冷青低风险，全部消费 --nx-* 令牌）。 */
const RISK_LEVEL_TONE: Record<string, string> = {
  low: 'border-[var(--nx-border-focus)]/60 text-[var(--nx-space-cyan)]',
  medium: 'border-[var(--nx-status-warning)]/60 text-[var(--nx-status-warning)]',
  high: 'border-[var(--nx-status-danger)]/60 text-[var(--nx-status-danger)]',
  critical: 'border-[var(--nx-status-danger)]/80 text-[var(--nx-status-danger)]',
}

/** 风险应对处置状态中文回显（与 RiskStatus 枚举对齐）。 */
export const RISK_STATUS_LABELS: Record<string, string> = {
  identified: '已识别',
  analyzing: '分析中',
  mitigating: '应对中',
  resolved: '已解决',
  accepted: '已接受',
  closed: '已关闭',
}

const RISK_STATUS_TONE: Record<string, string> = {
  identified: 'text-[var(--nx-text-muted)]',
  analyzing: 'text-[var(--nx-space-cyan)]',
  mitigating: 'text-[var(--nx-status-warning)]',
  resolved: 'text-[var(--nx-status-success)]',
  accepted: 'text-[var(--nx-text-secondary)]',
  closed: 'text-[var(--nx-text-muted)]',
}

function toFinite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** `list_project_risks` 有界风险条目（字段名与后端 BoundedRiskItem 对齐，容忍缺省）。 */
export interface RiskListCardItem {
  id: number
  riskCode?: string | null
  title: string
  category?: string
  probability?: number
  impact?: number
  score?: number
  riskLevel?: string
  status?: string
  priority?: string
  ownerId?: number | null
  /** 责任人名称（后端列表条目暂无此字段时回退为「成员 #id / 未指派」）。 */
  ownerName?: string | null
  identifiedAt?: string | null
  targetResolutionDate?: string | null
  mitigationStrategy?: string | null
}

export interface RiskListCardData {
  items: RiskListCardItem[]
  meta?: { total: number; page: number; perPage: number; totalPages: number }
}

export interface RiskListCardProps {
  data: RiskListCardData
  /** 命中工具名（v1 恒为规则直连，默认诚实标注 list_project_risks）。 */
  toolName?: string
}

export function RiskListCard({ data, toolName = 'list_project_risks' }: RiskListCardProps) {
  const items = Array.isArray(data.items) ? data.items : []
  const total = toFinite(data.meta?.total, items.length)
  const shown = items.length

  return (
    <article
      data-card="risk-list"
      className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--nx-text-primary)]">风险清单</span>
        <RuleMatchBadge toolName={toolName} />
      </div>

      {shown === 0 ? (
        <p data-risk-list-empty className="px-3 py-4 text-xs text-[var(--nx-text-muted)]">
          当前没有登记的风险条目
        </p>
      ) : (
        <ul className="divide-y divide-[var(--nx-border-hairline)]">
          {items.map((item) => {
            const id = toFinite(item.id, 0)
            const title =
              typeof item.title === 'string' && item.title.trim() !== ''
                ? item.title
                : `风险 #${id || '未知'}`
            const riskCode =
              typeof item.riskCode === 'string' && item.riskCode.trim() !== ''
                ? item.riskCode
                : null
            const level = typeof item.riskLevel === 'string' ? item.riskLevel : ''
            const levelLabel = RISK_LEVEL_LABELS[level] ?? level
            const status = typeof item.status === 'string' ? item.status : ''
            const statusLabel = RISK_STATUS_LABELS[status] ?? status
            const score = toFinite(item.score, NaN)

            const ownerName = (() => {
              if (typeof item.ownerName === 'string' && item.ownerName.trim() !== '') {
                return item.ownerName
              }
              if (typeof item.ownerId === 'number' && Number.isFinite(item.ownerId)) {
                return `成员 #${item.ownerId}`
              }
              return '未指派'
            })()

            return (
              <li
                key={String(id)}
                data-risk-item
                data-risk-id={id}
                className="group px-3 py-2 transition-colors hover:bg-[var(--nx-bg-0)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4
                      data-risk-title
                      className="truncate text-xs font-medium text-[var(--nx-text-primary)]"
                    >
                      {title}
                    </h4>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-none text-[var(--nx-text-muted)]">
                      {riskCode ? (
                        <span data-risk-code className="font-mono">
                          {riskCode}
                        </span>
                      ) : null}
                      <span data-risk-owner>{ownerName}</span>
                      {Number.isFinite(score) ? (
                        <span data-risk-score className="inline-flex items-center gap-0.5">
                          <Target className="h-3 w-3" aria-hidden />
                          评分 {score}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      data-risk-level
                      className={`rounded-sm border px-1.5 py-0.5 text-[10px] leading-none ${RISK_LEVEL_TONE[level] ?? 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]'}`}
                    >
                      {levelLabel || '等级未知'}
                    </span>
                    {statusLabel ? (
                      <span
                        data-risk-status
                        className={`inline-flex items-center gap-0.5 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] leading-none ${RISK_STATUS_TONE[status] ?? 'text-[var(--nx-text-secondary)]'}`}
                      >
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                        {statusLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="border-t border-[var(--nx-border-hairline)] px-3 py-1.5 text-[10px] text-[var(--nx-text-muted)]">
        <span data-risk-list-truncate>
          展示前 {shown} 项，共 {total} 项
        </span>
      </div>
    </article>
  )
}

export default RiskListCard
