'use client'

import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import * as React from 'react'
import {
  AlertTriangle,
  Users,
  CalendarClock,
  Target,
  Bot,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react'
import type { SuggestionSlot } from '@/lib/next/role-bucket'

export type SuggestionCategory = 'risk' | 'resource' | 'schedule' | 'okr' | 'general'

export interface SuggestionItem {
  id: string
  category: SuggestionCategory
  title: string
  desc: string
  metricLabel: string
  actionLabel?: string
  contextPayload?: Record<string, unknown>
}

export interface RoleSuggestionCardsProps {
  slots?: readonly SuggestionSlot[]
  cards?: readonly SuggestionItem[]
  onAiSummon?: (context: {
    cardId: string
    title: string
    prompt: string
    payload?: Record<string, unknown>
  }) => void
  onActionClick?: (item: SuggestionItem | SuggestionSlot) => void
}

const CATEGORY_ICONS: Record<SuggestionCategory, React.ComponentType<{ className?: string }>> = {
  risk: AlertTriangle,
  resource: Users,
  schedule: CalendarClock,
  okr: Target,
  general: Sparkles,
}

const CATEGORY_COLORS: Record<SuggestionCategory, { border: string; text: string; bg: string }> = {
  risk: {
    border: 'border-[var(--nx-status-danger)]/30',
    text: 'text-[var(--nx-status-danger)]',
    bg: 'bg-[var(--nx-status-danger)]/10',
  },
  resource: {
    border: 'border-[var(--nx-status-warning)]/30',
    text: 'text-[var(--nx-status-warning)]',
    bg: 'bg-[var(--nx-status-warning)]/10',
  },
  schedule: {
    border: 'border-[var(--nx-status-info)]/30',
    text: 'text-[var(--nx-status-info)]',
    bg: 'bg-[var(--nx-status-info)]/10',
  },
  okr: {
    border: 'border-[var(--nx-accent)]/30',
    text: 'text-[var(--nx-accent)]',
    bg: 'bg-[var(--nx-accent)]/10',
  },
  general: {
    border: 'border-[var(--nx-border-hairline)]',
    text: 'text-[var(--nx-text-muted)]',
    bg: 'bg-[var(--nx-bg-1)]',
  },
}

/**
 * 角色首页高密度业务化建议卡槽组件（v3-ui-next-batch3-global-convergence W4 · tasks 4.5）。
 *
 * 升级特性：
 * - 涵盖风险干预、资源超载、排程推进与 OKR 对齐 4 类真实态势感知卡片；
 * - 每张卡片提供可量化指标微标与暗黑仪器感「呼出 AI 同事推演」只读下钻按钮；
 * - 纯只读态，恪守 RL-01：严苛保证零写库、零自动修改业务数据；
 * - 兼容旧版 slots 骨架输入，确保无缝平滑演进。
 */
export function RoleSuggestionCards({
  slots,
  cards,
  onAiSummon,
  onActionClick,
}: RoleSuggestionCardsProps) {
  // 决定渲染条目：外部传入 cards > 外部传入 slots（升级包装） > 空（诚实空态，不回退写死的范例卡）
  const itemsToRender = React.useMemo<SuggestionItem[]>(() => {
    if (cards && cards.length > 0) {
      return [...cards]
    }
    if (slots && slots.length > 0) {
      return slots.map((s) => ({
        id: s.id,
        category: 'general' as SuggestionCategory,
        title: s.title,
        desc: s.desc,
        metricLabel: s.metricLabel,
        actionLabel: '呼出 AI 同事推演',
      }))
    }
    return []
  }, [cards, slots])

  const handleAction = (item: SuggestionItem) => {
    const prompt = `请针对「${item.title}」（${item.metricLabel}）进行深入推演与行动建议分析`
    if (onActionClick) {
      onActionClick(item)
    }
    if (onAiSummon) {
      onAiSummon({
        cardId: item.id,
        title: item.title,
        prompt,
        payload: item.contextPayload,
      })
      return
    }
    // 角色首页没有传入回调：直接打开 AI 同事面板，把这张卡的推演请求作为首条消息发出。
    // 原先两个回调都没接，按钮点了没有任何反应（实测）。只读分析，不产生写操作。
    const store = useNextAiColleagueStore.getState()
    store.openPanel()
    void store.submitUserMessage(prompt, {
      contextType: 'role_home',
      currentProjectId: null,
      pathname: typeof window !== 'undefined' ? window.location.pathname : '/next',
      ...(store.context?.permissions ? { permissions: store.context.permissions } : {}),
      ...(store.context?.isSuperAdmin !== undefined
        ? { isSuperAdmin: store.context.isSuperAdmin }
        : {}),
    })
  }

  return (
    <section
      data-role-suggestion-cards
      aria-label="建议卡槽"
      className="relative z-[1] flex flex-col gap-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-[0.02em] text-[var(--nx-text-primary)]">
            AI 态势感知建议
          </h2>
          <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.2 font-mono text-[10px] text-[var(--nx-text-muted)]">
            READONLY · RL-01
          </span>
        </div>
        <span className="font-mono text-xs text-[var(--nx-text-muted)]">
          {itemsToRender.length} 类态势雷达
        </span>
      </div>

      {itemsToRender.length === 0 && (
        <p
          data-role-suggestion-empty=""
          className="rounded-lg border border-dashed border-[var(--nx-border-hairline)] p-4 text-xs text-[var(--nx-text-muted)]"
        >
          暂无态势建议：数据源尚未提供可展示的建议卡。
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {itemsToRender.map((item) => {
          const category = item.category || 'general'
          const CategoryIcon = CATEGORY_ICONS[category] || Sparkles
          const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.general
          const actionLabel = item.actionLabel || '呼出 AI 同事推演'

          return (
            <article
              key={item.id}
              data-role-suggestion-slot={item.id}
              data-suggestion-card={item.id}
              data-suggestion-category={category}
              className={`flex flex-col justify-between gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 transition-colors hover:border-[var(--nx-border-focus)]`}
            >
              <div className="flex flex-col gap-2">
                {/* 类别图标 + 标题 + 指标微标 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <CategoryIcon className={`h-4 w-4 shrink-0 ${colors.text}`} />
                    <h3
                      className="truncate text-sm font-medium text-[var(--nx-text-primary)]"
                      title={item.title}
                    >
                      {item.title}
                    </h3>
                  </div>

                  {/* 量化指标微标 */}
                  <span
                    data-metric-badge=""
                    className={`shrink-0 rounded border ${colors.border} ${colors.bg} px-1.5 py-0.5 font-mono text-[11px] font-medium ${colors.text}`}
                  >
                    {item.metricLabel}
                  </span>
                </div>

                {/* 描述说明 */}
                <p className="text-xs leading-5 text-[var(--nx-text-muted)]">{item.desc}</p>
              </div>

              {/* 只读下钻按钮（呼出 AI 同事推演） */}
              <div className="flex items-center justify-between border-t border-[var(--nx-border-hairline)] pt-2.5">
                <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">主动雷达</span>

                <button
                  type="button"
                  onClick={() => handleAction(item)}
                  aria-label={`${actionLabel} - ${item.title}`}
                  className="flex items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1 text-[11px] font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-bg-2)]"
                >
                  <Bot className="h-3 w-3 text-cyan-400" aria-hidden />
                  <span>{actionLabel}</span>
                  <ArrowUpRight className="h-2.5 w-2.5 text-[var(--nx-text-muted)]" />
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
