'use client'

import React from 'react'
import {
  AlertCircle,
  HelpCircle,
  Info,
  Award,
  Zap,
  CheckCircle2,
  Lock,
  Sparkles,
  Braces,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { TrizClarificationCardDTO } from '@aiproj/types'
import { getTrizClarificationWarningLabel } from '@aiproj/types'
import { cn } from '@/lib/utils'

export interface TrizCardProps {
  card: TrizClarificationCardDTO
  onAnswer: (
    cardId: string,
    action: 'answer' | 'adopt_default' | 'skip',
    value: string | number | string[] | null,
  ) => void
  onDeferReview?: (cardId: string) => void
  disabled?: boolean
  existingAnswer?: {
    action: string
    value: string | number | string[] | null
  } | null
}

const categoryMeta = {
  critical: {
    label: '关键',
    icon: AlertCircle,
    className: 'text-red-600 border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800',
    iconClass: 'text-red-500',
  },
  recommended: {
    label: '建议',
    icon: Info,
    className:
      'text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800',
    iconClass: 'text-amber-500',
  },
  optional: {
    label: '可选',
    icon: HelpCircle,
    className:
      'text-slate-600 border-slate-200 bg-slate-50 dark:bg-slate-900 dark:border-slate-700',
    iconClass: 'text-slate-400',
  },
}

export function TrizClarificationCard({
  card,
  onAnswer,
  onDeferReview,
  disabled,
  existingAnswer,
}: TrizCardProps) {
  const cat = categoryMeta[card.category] ?? categoryMeta.optional
  const CatIcon = cat.icon
  const hasWarning = card.warningCodes.length > 0
  const hasSourceRefs = card.sourceRefs.length > 0
  const isAnswered = !!existingAnswer

  return (
    <div
      className={cn(
        'rounded-lg border p-4 space-y-4 transition-colors',
        card.category === 'critical'
          ? 'border-red-200 dark:border-red-800'
          : card.category === 'recommended'
            ? 'border-amber-200 dark:border-amber-800'
            : 'border-slate-200 dark:border-slate-700',
        isAnswered && 'opacity-80',
      )}
      role="region"
      aria-label={`TRIZ 澄清卡片: ${card.title}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border',
              cat.className,
            )}
          >
            <CatIcon className="w-3 h-3" />
            {cat.label}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            <Award className="w-3 h-3" />
            TRIZ
          </span>
          {card.trizCategory && (
            <span className="text-xs text-muted-foreground">
              {trizCategoryLabel(card.trizCategory)}
            </span>
          )}
        </div>
      </div>

      {/* Title & Description */}
      <div>
        <h4 className="text-sm font-semibold">{card.title}</h4>
        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{card.description}</p>
      </div>

      {/* Impact Scope */}
      {card.impactScope.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {card.impactScope.map((scope, i) => (
            <span
              key={i}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs',
                scope.severity === 'high'
                  ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                  : scope.severity === 'medium'
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    : 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
              )}
            >
              <Zap className="w-3 h-3" />
              {scope.domain}
            </span>
          ))}
        </div>
      )}

      {/* Source Refs */}
      {hasSourceRefs && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">
            <span className="inline-flex items-center gap-1">
              <Braces className="w-3 h-3" />
              来源矛盾 ({card.sourceRefs.length})
            </span>
          </summary>
          <ul className="mt-1 space-y-1 pl-4 list-disc">
            {card.sourceRefs.map((ref, i) => (
              <li key={i}>
                <span className="font-medium">{ref.title}</span>
                <span className="text-muted-foreground">
                  {' '}
                  ({ref.type}, {ref.severity})
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Warnings */}
      {hasWarning && (
        <div className="space-y-1">
          {card.warningCodes.map((code) => (
            <div
              key={code}
              className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400"
            >
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{getTrizClarificationWarningLabel(code)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick Options */}
      {!isAnswered && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {card.quickOptions.map((option) => (
              <Button
                key={String(option.value)}
                variant={option.recommended ? 'primary' : 'outline'}
                size="sm"
                onClick={() => onAnswer(card.cardId, 'answer', option.value)}
                disabled={disabled}
                aria-label={option.label}
              >
                {option.recommended && <Sparkles className="w-3 h-3 mr-1" />}
                {option.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {card.defaultValue && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAnswer(card.cardId, 'adopt_default', card.defaultValue)}
                disabled={disabled}
                className="text-xs"
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                采纳默认：{String(card.defaultValue)}
              </Button>
            )}
            {card.allowSkip && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAnswer(card.cardId, 'skip', null)}
                disabled={disabled}
                className="text-xs text-muted-foreground"
              >
                跳过
              </Button>
            )}
            {onDeferReview && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDeferReview(card.cardId)}
                disabled={disabled}
                className="text-xs text-muted-foreground"
              >
                <Lock className="w-3 h-3 mr-1" />
                暂缓确认
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Answered state */}
      {isAnswered && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4" />
          <span>
            已{existingAnswer?.action === 'adopt_default' ? '采纳默认' : '回答'}：
            {String(existingAnswer?.value ?? '')}
          </span>
        </div>
      )}
    </div>
  )
}

function trizCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    trade_off: '取舍',
    priority: '优先级',
    constraint: '约束',
    assumption: '假设',
    solution_preference: '解决偏好',
  }
  return labels[category] ?? category
}

/** TRIZ 卡片列表容器 */
export function TrizCardList({
  cards,
  ...props
}: { cards: TrizClarificationCardDTO[] } & Omit<TrizCardProps, 'card'>) {
  if (cards.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Award className="w-4 h-4 text-purple-500" />
        <h3 className="text-sm font-semibold">TRIZ 矛盾确认</h3>
        <span className="text-xs text-muted-foreground">
          系统检测到项目存在目标冲突，需要您确认取舍
        </span>
      </div>
      {cards.map((card) => (
        <TrizClarificationCard key={card.cardId} card={card} {...props} />
      ))}
    </div>
  )
}
