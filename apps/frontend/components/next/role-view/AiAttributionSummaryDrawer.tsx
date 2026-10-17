'use client'

import * as React from 'react'
import {
  Sparkles,
  X,
  Copy,
  Check,
  Bot,
  TrendingDown,
  Layers,
  ShieldAlert,
  ArrowRightCircle,
  HelpCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AiAttributionTarget } from './ObjectiveExecutionMatrix'

export interface AiAttributionSummaryDrawerProps {
  /** 抽屉显隐 */
  open: boolean
  /** 关闭抽屉回调 */
  onClose: () => void
  /** 当前选中的归因目标 */
  target: AiAttributionTarget | null
  /** 呼出 AI 同事深入追问回调（只读透传上下文） */
  onConsultAiColleague?: (target: AiAttributionTarget) => void
  /** 自定义类名 */
  className?: string
}

export interface AiAttributionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 按钮文字，默认为「AI 归因摘要」 */
  label?: string
  /** 提示文案，默认为「查看 AI 战略归因与推演依据」 */
  tooltip?: string
  /** 尺寸档位 */
  size?: 'sm' | 'md'
}

/**
 * AI 归因摘要微标操作点（可复用触发器）。
 * 带有琥珀色与天青微光，支持 Tooltip、键盘 Focus 与 Enter 激活。
 */
export function AiAttributionButton({
  label = 'AI 归因摘要',
  tooltip = '查看 AI 战略归因与推演依据',
  size = 'sm',
  className,
  ...props
}: AiAttributionButtonProps) {
  return (
    <button
      type="button"
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium transition-all',
        'border-amber-600/30 bg-amber-50/80 text-amber-900',
        'hover:border-amber-600/60 hover:bg-amber-100/80 hover:shadow-sm',
        'focus-visible:outline-2 focus-visible:outline-amber-600 focus-visible:outline-offset-1',
        'motion-reduce:transition-none',
        size === 'sm' ? 'min-h-[28px] px-2 py-1 text-xs' : 'min-h-[34px] px-3 py-1.5 text-sm',
        className,
      )}
      {...props}
    >
      <Sparkles className={cn(size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5', 'text-amber-600')} />
      <span>{label}</span>
    </button>
  )
}

/** 数据源未提供该段时的诚实占位文案（不得用范例叙述冒充真实归因） */
export const ATTRIBUTION_NO_DATA_TEXT = '暂无数据：数据源尚未提供该项归因'

/** 解析结构化推演报告数据；缺失字段一律显示为暂无，不回退写死的范例文字 */
function resolveAttributionDetails(target: AiAttributionTarget) {
  const historyEvolution = target.historyEvolution?.filter((item) => item.trim()) ?? []
  const bottleneckCause = target.bottleneckCause || target.reason || null
  const riskCorrelation = target.riskCorrelation || null
  const forecastAdvice = target.forecastAdvice || null

  return { historyEvolution, bottleneckCause, riskCorrelation, forecastAdvice }
}

function NoDataHint() {
  return (
    <span data-testid="attribution-no-data" className="text-[var(--nx-role-text,#38342c)]/50">
      {ATTRIBUTION_NO_DATA_TEXT}
    </span>
  )
}

/**
 * AI 战略归因摘要只读抽屉（v3-ui-next-batch1-strategy-launch-tasks §1.7 / spec「AI 战略归因摘要操作点与只读下钻联动交互」）。
 *
 * 红线恪守（RL-01）：
 * 1. 严格纯只读：无任何一键执行、自动改期、自动创建任务或一键落库按钮；
 * 2. 交互期间发出写操作请求为 0；
 * 3. 呼出 AI 同事时仅作为只读上下文传递。
 */
export function AiAttributionSummaryDrawer({
  open,
  onClose,
  target,
  onConsultAiColleague,
  className,
}: AiAttributionSummaryDrawerProps) {
  const [copied, setCopied] = React.useState(false)

  // 监听 Esc 键关闭
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose()
      }
    }
    if (open) {
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open || !target) return null

  const details = resolveAttributionDetails(target)

  const handleCopyReport = async () => {
    const reportText = [
      `# 战略归因推演报告：${target.title}`,
      `归因依据：${target.reason || target.basis || '无'}`,
      '',
      '## 1. 历史演进与关键偏离节点',
      ...(details.historyEvolution.length > 0
        ? details.historyEvolution.map((item) => `- ${item}`)
        : [ATTRIBUTION_NO_DATA_TEXT]),
      '',
      '## 2. 瓶颈资源归因',
      details.bottleneckCause ?? ATTRIBUTION_NO_DATA_TEXT,
      '',
      '## 3. 关联风险分析',
      details.riskCorrelation ?? ATTRIBUTION_NO_DATA_TEXT,
      '',
      '## 4. 未来周期推演与建议',
      details.forecastAdvice ?? ATTRIBUTION_NO_DATA_TEXT,
      '',
      '> 声明：本报告由开项 AI 同事根据历史事实只读汇编，不包含任何自动落库动作。',
    ].join('\n')

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(reportText)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // 安全容错
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI 战略归因摘要"
      data-ai-attribution-drawer="true"
      className="fixed inset-0 z-50 flex justify-end"
    >
      {/* 遮罩背景（点击关闭） */}
      <div
        data-testid="drawer-backdrop"
        onClick={onClose}
        className="fixed inset-0 bg-stone-900/30 backdrop-blur-[1px] transition-opacity motion-reduce:transition-none"
        aria-hidden="true"
      />

      {/* 浅纸色侧滑抽屉（max-w-md） */}
      <div
        className={cn(
          'relative z-10 flex h-full w-full max-w-md flex-col justify-between overflow-y-auto',
          'border-l border-[rgba(56,52,44,0.15)] bg-[var(--nx-role-surface,#ebe9e1)] text-[var(--nx-role-text,#38342c)]',
          'shadow-xl transition-transform duration-300 ease-out motion-reduce:transition-none',
          className,
        )}
      >
        {/* 抽屉头部 */}
        <div className="border-b border-[rgba(56,52,44,0.12)] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-600/30 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                <Bot className="h-3.5 w-3.5 text-amber-700" />
                AI 战略归因
              </span>
              <span className="text-xs text-[var(--nx-role-text,#38342c)]/60">只读报告</span>
            </div>
            <button
              type="button"
              data-testid="drawer-close-btn"
              onClick={onClose}
              aria-label="关闭归因抽屉"
              className="rounded-md p-1 text-[var(--nx-role-text,#38342c)]/60 hover:bg-[rgba(56,52,44,0.08)] hover:text-[var(--nx-role-text,#38342c)] focus-visible:outline-2 focus-visible:outline-amber-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <h3
            className="mt-3 text-lg font-bold text-[var(--nx-role-text,#38342c)]"
            data-testid="drawer-target-title"
          >
            {target.title}
          </h3>
          {target.reason && (
            <p className="mt-1 text-xs text-[var(--nx-role-text,#38342c)]/70">
              偏差标注：{target.reason}
            </p>
          )}
        </div>

        {/* 抽屉正文区（历史演进、瓶颈分析、风险关联、推演建议） */}
        <div className="flex-1 space-y-6 p-5 text-sm" data-testid="drawer-body">
          {/* 1. 历史演进与关键偏离节点 */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--nx-role-accent,#d97706)]">
              <TrendingDown className="h-3.5 w-3.5" />
              <span>历史演进与关键偏离节点</span>
            </h4>
            {details.historyEvolution.length > 0 ? (
              <ul className="space-y-2 rounded-lg border border-[rgba(56,52,44,0.1)] bg-[var(--nx-role-bg,#f5f4ef)] p-3.5 text-xs">
                {details.historyEvolution.map((node, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--nx-role-accent,#d97706)] shrink-0" />
                    <span className="leading-relaxed text-[var(--nx-role-text,#38342c)]/90">
                      {node}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border border-[rgba(56,52,44,0.1)] bg-[var(--nx-role-bg,#f5f4ef)] p-3.5 text-xs">
                <NoDataHint />
              </div>
            )}
          </section>

          {/* 2. 瓶颈资源归因 */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--nx-role-accent,#d97706)]">
              <Layers className="h-3.5 w-3.5" />
              <span>瓶颈资源归因分析</span>
            </h4>
            <div className="rounded-lg border border-[rgba(56,52,44,0.1)] bg-[var(--nx-role-bg,#f5f4ef)] p-3.5 text-xs leading-relaxed text-[var(--nx-role-text,#38342c)]/90">
              {details.bottleneckCause ?? <NoDataHint />}
            </div>
          </section>

          {/* 3. 关联风险分析 */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--nx-role-accent,#d97706)]">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>关联风险与上下游传导</span>
            </h4>
            <div className="rounded-lg border border-[rgba(56,52,44,0.1)] bg-[var(--nx-role-bg,#f5f4ef)] p-3.5 text-xs leading-relaxed text-[var(--nx-role-text,#38342c)]/90">
              {details.riskCorrelation ?? <NoDataHint />}
            </div>
          </section>

          {/* 4. 未来周期推演与建议 */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--nx-role-accent,#d97706)]">
              <ArrowRightCircle className="h-3.5 w-3.5" />
              <span>未来周期推演建议</span>
            </h4>
            <div className="rounded-lg border border-amber-600/20 bg-amber-50/50 p-3.5 text-xs leading-relaxed text-amber-950">
              {details.forecastAdvice ?? <NoDataHint />}
            </div>
          </section>
        </div>

        {/* 抽屉底部操作栏（纯只读操作，零落库按钮） */}
        <div className="border-t border-[rgba(56,52,44,0.12)] p-4 space-y-3 bg-[var(--nx-role-surface,#ebe9e1)]">
          <div className="flex flex-col sm:flex-row gap-2">
            {/* 复制归因报告 */}
            <button
              type="button"
              data-testid="btn-copy-report"
              onClick={handleCopyReport}
              className={cn(
                'flex-1 inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium',
                'border-[rgba(56,52,44,0.18)] bg-[var(--nx-role-bg,#f5f4ef)] text-[var(--nx-role-text,#38342c)]',
                'hover:bg-[rgba(56,52,44,0.06)] active:bg-[rgba(56,52,44,0.1)]',
                'focus-visible:outline-2 focus-visible:outline-amber-600',
                'transition-colors motion-reduce:transition-none',
              )}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-emerald-700">已复制到剪贴板</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>复制归因报告</span>
                </>
              )}
            </button>

            {/* 呼出 AI 同事深入追问 */}
            {onConsultAiColleague && (
              <button
                type="button"
                data-testid="btn-consult-ai"
                onClick={() => onConsultAiColleague(target)}
                className={cn(
                  'flex-1 inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium',
                  'border-amber-600/40 bg-amber-600 text-white',
                  'hover:bg-amber-700 active:bg-amber-800',
                  'focus-visible:outline-2 focus-visible:outline-amber-600',
                  'transition-colors motion-reduce:transition-none',
                )}
              >
                <HelpCircle className="h-3.5 w-3.5" />
                <span>呼出 AI 同事深入追问</span>
              </button>
            )}
          </div>

          {/* RL-01 安全声明 */}
          <div className="flex items-center justify-center text-[10px] text-[var(--nx-role-text,#38342c)]/50 gap-1">
            <span>🛡️ 纯只读报告 · 零自动落库 · 零修改网络请求</span>
          </div>
        </div>
      </div>
    </div>
  )
}
