'use client'

/**
 * 澄清卡片组件（任务 7.1）
 *
 * 三档视觉区分、影响范围展示、快速选项、跳过控件。
 * 复用 TrizClarificationCard 的视觉模式，但配色走设计 token。
 */
import * as React from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  RegisteredClarificationField,
  ClarificationTier,
  ClarificationImpactSeverity,
} from '@aiproj/types'
import { ConfidenceIndicator } from './ConfidenceIndicator'

// ── 三档视觉配置（走设计 token，不硬编码色值）──

const TIER_CONFIG: Record<
  ClarificationTier,
  {
    borderClass: string
    badgeClass: string
    label: string
    icon: React.ReactNode
  }
> = {
  critical: {
    borderClass: 'border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.06)]',
    badgeClass: 'bg-[hsl(var(--destructive)/0.15)] text-[hsl(var(--destructive))]',
    label: '关键必答',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  recommended: {
    borderClass: 'border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.07)]',
    badgeClass: 'bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]',
    label: '建议补充',
    icon: <Sparkles className="h-3.5 w-3.5" />,
  },
  optional: {
    borderClass: 'border-[hsl(var(--primary)/0.2)] bg-[hsl(var(--primary)/0.05)]',
    badgeClass: 'bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]',
    label: '可选优化',
    icon: <ChevronRight className="h-3.5 w-3.5" />,
  },
}

const SEVERITY_CHIP_CLASS: Record<ClarificationImpactSeverity, string> = {
  high: 'bg-[hsl(var(--destructive)/0.1)] text-[hsl(var(--destructive))]',
  medium: 'bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]',
  low: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
}

interface ClarificationCardProps {
  field: RegisteredClarificationField
  state?: 'unasked' | 'asked_pending' | 'answered' | 'filled_with_default' | 'skipped' | 'blocked'
  confidence?: number
  onAnswer?: (fieldId: string, value: string | number) => void
  onSkip?: (fieldId: string) => void
  onUseDefault?: (fieldId: string) => void
  className?: string
}

export function ClarificationCard({
  field,
  state = 'unasked',
  confidence,
  onAnswer,
  onSkip,
  onUseDefault,
  className,
}: ClarificationCardProps) {
  const config = TIER_CONFIG[field.tier]
  const [selectedValue, setSelectedValue] = React.useState<string | number | null>(null)
  const [customInput, setCustomInput] = React.useState('')

  const isAnswered = state === 'answered' || state === 'filled_with_default'
  const isSkipped = state === 'skipped'
  const isBlocked = state === 'blocked'

  function handleQuickOption(value: string | number) {
    setSelectedValue(value)
    onAnswer?.(field.fieldId, value)
  }

  function handleSubmitCustom() {
    if (customInput.trim()) {
      onAnswer?.(field.fieldId, customInput.trim())
    }
  }

  return (
    <div
      role="region"
      aria-label={`澄清卡片：${field.title}`}
      className={cn(
        'rounded-lg border p-4 transition-colors',
        config.borderClass,
        isAnswered && 'opacity-70',
        isBlocked && 'ring-2 ring-[hsl(var(--destructive))]',
        className,
      )}
    >
      {/* 头部：徽章 + 标题 + 状态 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              config.badgeClass,
            )}
          >
            {config.icon}
            {config.label}
          </span>
          <h4 className="text-sm font-medium text-[hsl(var(--foreground))]">{field.title}</h4>
        </div>
        <div className="flex items-center gap-2">
          {confidence !== undefined && <ConfidenceIndicator confidence={confidence} size="sm" />}
          {isAnswered && <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />}
          {isSkipped && <span className="text-xs text-[hsl(var(--muted-foreground))]">已跳过</span>}
          {isBlocked && <span className="text-xs text-[hsl(var(--destructive))]">已阻断</span>}
        </div>
      </div>

      {/* 说明 */}
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{field.description}</p>

      {/* 影响范围 */}
      {field.impactScope.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {field.impactScope.map((scope, i) => (
            <span
              key={`${scope.domain}-${i}`}
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                SEVERITY_CHIP_CLASS[scope.severity],
              )}
            >
              {scope.domain} ({scope.severity})
            </span>
          ))}
        </div>
      )}

      {/* 快速选项 */}
      {!isAnswered && !isSkipped && field.quickOptions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {field.quickOptions.map((option) => (
            <button
              key={String(option.value)}
              onClick={() => handleQuickOption(option.value)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                selectedValue === option.value
                  ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]'
                  : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]',
                option.recommended && 'border-[hsl(var(--primary)/0.5)]',
              )}
            >
              {option.recommended && <Sparkles className="h-3 w-3" />}
              {option.label}
            </button>
          ))}
        </div>
      )}

      {/* 自由文本输入（无 quickOptions 时） */}
      {!isAnswered && !isSkipped && field.quickOptions.length === 0 && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="请输入..."
            className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-xs"
            onKeyDown={(e) => e.key === 'Enter' && handleSubmitCustom()}
          />
          <button
            onClick={handleSubmitCustom}
            className="rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs text-[hsl(var(--primary-foreground))]"
          >
            确认
          </button>
        </div>
      )}

      {/* 操作按钮 */}
      {!isAnswered && !isSkipped && (
        <div className="mt-3 flex gap-2">
          {field.defaultValue && field.tier === 'recommended' && (
            <button
              onClick={() => onUseDefault?.(field.fieldId)}
              className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]"
            >
              采用默认值
            </button>
          )}
          {field.tier !== 'critical' && (
            <button
              onClick={() => onSkip?.(field.fieldId)}
              className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]"
            >
              跳过
            </button>
          )}
        </div>
      )}

      {/* 已回答/已默认态 */}
      {isAnswered && (
        <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          {state === 'filled_with_default' ? '已采纳默认值' : '已回答'}
        </div>
      )}
    </div>
  )
}
