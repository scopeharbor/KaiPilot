'use client'

import * as React from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import type { ColleagueTrizRun } from '@/stores/next-ai-colleague-store'
import {
  TRIZ_TARGET_LABELS,
  type TrizInterventionTarget,
  type TrizOverrideInput,
  type TrizSolutionDraft,
} from '@/lib/api/triz-copilot'
import { recommendedTargetForSignal } from '@/lib/next/signals/signal-solve-statement'
import { AiConnectionRequiredAction } from '@/components/ai/AiConnectionRequiredAction'
import { TrizEvidenceDrawer } from './TrizEvidenceDrawer'
import { TrizInterventionPreviewCard } from './TrizInterventionPreviewCard'
import {
  TRIZ_CLARIFICATION_OPTIONS,
  TRIZ_PATH_BADGES,
  TRIZ_TARGET_CHOICES,
  trizFallbackReasonText,
} from './triz-copilot-copy'

/**
 * 矛盾求解卡组（v3-triz-contradiction-copilot W5；2026-10-12 改为分步引导）。
 *
 * 用户反馈：进入矛盾求解后一次铺开参数、原则、置信度、降级说明、三套方案全文，
 * 「太多看不过来、看不懂要干嘛、也没帮我解决问题」。现在按四步走，每步只给一句话结论
 * 和一个「下一步」（默认采用 AI 的推荐），细节都折叠起来：
 *   ① AI 分析：一句大白话说清「想改善什么、什么会变差」（信息不够时先问一句）；
 *   ② 选方案：三条方案只显示标题与第一条做法，AI 推荐的排第一；
 *   ③ 怎么落实：新建任务 / 登记风险 / 提变更请求（按信号类型推荐一种）；
 *   ④ 确认：差异预览 + 显式确认，写入后来源信号自动标记已处理、从信号建议里消失。
 *
 * 不变的红线：零自动落库（RL-01，确认按钮是唯一写请求触发点）；规则匹配与模型推理如实区分；
 * 澄清触顶时照常给出已有方案，绝不停在空结果。
 */
export interface TrizContradictionCardProps {
  run: ColleagueTrizRun
  /** 澄清回答（快捷选项胶囊与自由输入共用同一入口） */
  onAnswerClarification: (answer: string) => void
  /** 选定 Top 3 中的一条方案（零请求） */
  onSelectSolution: (solutionIndex: number) => void
  /** 选定落库类型并生成差异预览（写工具 execute，阶段一零写入） */
  onChooseTarget: (target: TrizInterventionTarget) => void
  /** 显式确认落库（携带本卡 previewToken） */
  onConfirmIntervention: (previewToken: string) => void
  /** 放弃落库（零请求） */
  onCancelIntervention: () => void
  /** 409 过期 / 失败后重新生成差异预览 */
  onRepreview: () => void
  /** 映射依据改判参数并重算 */
  onOverride: (input: TrizOverrideInput) => void
  /** 求解失败重试 */
  onRetrySolve: () => void
  /** 沉浸精确档（停用过渡动画） */
  precise?: boolean
}

const STEPS = ['AI 分析', '选方案', '怎么落实', '确认'] as const

/** 当前所处步骤（0 起；4 = 已完成）。 */
function currentStep(run: ColleagueTrizRun): number {
  if (run.phase === 'committed') return 4
  if (
    run.phase === 'previewing' ||
    run.phase === 'preview_ready' ||
    run.phase === 'committing' ||
    run.phase === 'conflict' ||
    run.phase === 'cancelled'
  )
    return 3
  if (run.phase === 'clarifying' || run.phase === 'answered' || run.mapping === null) return 0
  if (run.selectedSolutionIndex === null) return 1
  return 2
}

function StepBar({ step }: { step: number }) {
  return (
    <ol data-triz-steps className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
      {STEPS.map((label, index) => {
        const done = index < step
        const active = index === step
        return (
          <li key={label} className="flex items-center gap-1">
            <span
              data-triz-step={index}
              data-state={done ? 'done' : active ? 'active' : 'todo'}
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${
                active
                  ? 'border-[var(--nx-space-cyan)]/60 text-[var(--nx-text-primary)]'
                  : done
                    ? 'border-transparent text-[var(--nx-status-success)]'
                    : 'border-transparent text-[var(--nx-text-muted)]'
              }`}
            >
              {done ? <Check className="h-3 w-3" aria-hidden /> : <span>{index + 1}</span>}
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <ChevronRight className="h-3 w-3 text-[var(--nx-text-muted)]" aria-hidden />
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** 一句大白话结论：想改善什么、什么会变差。 */
function plainSummary(run: ColleagueTrizRun): string {
  const mapping = run.mapping
  const improving = mapping?.improvingParameter
  const worsening = mapping?.worseningParameter
  if (improving && worsening) {
    return `想改善「${improving.displayName}」，但「${worsening.displayName}」会跟着变差。`
  }
  if (improving) return `核心是想改善「${improving.displayName}」，代价还不明确。`
  return '信息还不够判断矛盾在哪里，先补充一句会更准。'
}

function PrimaryButton({
  children,
  disabled,
  onClick,
  ...rest
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      {...rest}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--nx-space-cyan)]/60 bg-[var(--nx-space-cyan)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--nx-text-primary)] hover:bg-[var(--nx-space-cyan)]/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
    >
      {children}
      <ChevronRight className="h-3 w-3" aria-hidden />
    </button>
  )
}

function SolutionCard({
  solution,
  recommended,
  selected,
  disabled,
  onSelect,
}: {
  solution: TrizSolutionDraft
  recommended: boolean
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [first, ...rest] = solution.actionPoints
  return (
    <li
      data-triz-solution={solution.index}
      data-selected={selected ? 'true' : 'false'}
      className={`rounded-md border p-2.5 ${
        selected
          ? 'border-[var(--nx-space-cyan)]/60 bg-[var(--nx-bg-0)]'
          : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-[var(--nx-text-primary)]">
            {solution.title}
            {recommended && (
              <span
                data-triz-solution-recommended
                className="rounded bg-[var(--nx-ai)]/15 px-1 py-0.5 text-[10px] font-normal text-[var(--nx-ai)]"
              >
                AI 推荐
              </span>
            )}
          </div>
          {first && (
            <p
              data-triz-action-point
              className="mt-0.5 text-[11px] text-[var(--nx-text-secondary)]"
            >
              {first.text}
            </p>
          )}
        </div>
        <button
          type="button"
          data-triz-solution-select={solution.index}
          disabled={disabled}
          onClick={onSelect}
          className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)] disabled:opacity-50 hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          {selected ? '已选定' : '用这个'}
        </button>
      </div>

      <details className="mt-1 text-[10px] text-[var(--nx-text-muted)]">
        <summary className="cursor-pointer select-none text-[var(--nx-space-cyan)]">
          做法与代价
        </summary>
        {rest.length > 0 && (
          <ul className="mt-1 list-disc pl-4 text-[11px] text-[var(--nx-text-secondary)]">
            {rest.map((point) => (
              <li key={point.text} data-triz-action-point>
                {point.text}
                {point.entityRefs.length > 0 && (
                  <span className="ml-1 text-[10px] text-[var(--nx-text-muted)]">
                    （关联 {point.entityRefs.join('、')}）
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1">
          好处：{solution.impact.positive}；代价：{solution.impact.negative}
        </p>
        {solution.preconditions.length > 0 && (
          <p className="mt-0.5">前置条件：{solution.preconditions.join('；')}</p>
        )}
        {solution.entityBinding === 'none' && (
          <p data-triz-solution-unbound className="mt-0.5 text-[var(--nx-status-warning)]">
            这条是通用建议，没有对应到项目里的具体任务或风险。
          </p>
        )}
        <p data-triz-solution-principle className="mt-0.5">
          依据：原则 #{solution.principle.number} {solution.principle.displayName}
        </p>
        <button
          type="button"
          data-triz-solution-expand={solution.index}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 inline-flex items-center gap-1 text-[var(--nx-space-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
          原则释义
        </button>
        {expanded && (
          <div data-triz-principle-detail className="mt-1">
            <p>{solution.principle.definition}</p>
            <p className="mt-0.5">软件/管理实例：{solution.principle.softwareExamples}</p>
            <p className="mt-0.5">PM 场景释义：{solution.principle.pmInterpretation}</p>
            <p className="mt-0.5">来源：{solution.principle.source}</p>
          </div>
        )}
      </details>
    </li>
  )
}

export function TrizContradictionCard({
  run,
  onAnswerClarification,
  onSelectSolution,
  onChooseTarget,
  onConfirmIntervention,
  onCancelIntervention,
  onRepreview,
  onOverride,
  onRetrySolve,
  precise = false,
}: TrizContradictionCardProps) {
  const mapping = run.mapping
  const badge = mapping ? TRIZ_PATH_BADGES[mapping.path] : null
  const runPath = mapping?.path ?? run.path
  const busy = run.phase === 'previewing' || run.phase === 'committing'
  const selectable = run.phase === 'solved' || run.phase === 'exhausted'
  const showPreview =
    run.phase === 'previewing' ||
    run.phase === 'preview_ready' ||
    run.phase === 'committing' ||
    run.phase === 'committed' ||
    run.phase === 'cancelled' ||
    run.phase === 'conflict' ||
    (run.phase === 'error' && run.diff !== null)
  const degraded = run.path === 'rule' && (mapping?.fallbackReasons.length ?? 0) > 0
  const exhausted = run.phase === 'exhausted' || run.budgetState === 'exhausted'
  const permissionDenied = run.error?.code === 'PERMISSION_DENIED'
  const step = currentStep(run)
  const solutions = run.solutions.slice(0, 3)
  const recommendedSolution = solutions[0]?.index ?? null
  const recommendedTarget = recommendedTargetForSignal(run.sourceSignalType)
  const selectedSolution =
    solutions.find((solution) => solution.index === run.selectedSolutionIndex) ?? null

  return (
    <div
      data-triz-card
      data-phase={run.phase}
      data-run-path={run.path}
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-[var(--nx-ai)]" aria-hidden />
        <span className="text-[11px] font-medium text-[var(--nx-text-primary)]">矛盾求解</span>
        {run.sourceSignalCode && (
          <span
            data-triz-source-signal
            className="font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            {run.sourceSignalCode}
          </span>
        )}
        {badge && (
          <span
            data-triz-path-badge={runPath}
            title={badge.detail}
            className="rounded bg-[var(--nx-space-cyan)]/15 px-1.5 py-0.5 text-[10px] text-[var(--nx-space-cyan)]"
          >
            {badge.label}
          </span>
        )}
      </div>

      <StepBar step={step} />

      {run.sourceSignalCode && run.statement && (
        <p data-triz-statement className="mt-2 text-[11px] leading-5 text-[var(--nx-text-muted)]">
          {run.statement}
        </p>
      )}

      {permissionDenied && (
        <p
          data-triz-permission-notice
          className="mt-2 flex items-start gap-1.5 rounded border border-[var(--nx-status-warning)]/40 px-2 py-1.5 text-[11px] text-[var(--nx-text-secondary)]"
        >
          <ShieldAlert
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          {run.error?.message}
        </p>
      )}

      {/* ① AI 分析：等待中 / 追问 / 一句话结论 */}
      {run.phase === 'clarifying' && run.analysisId === null && run.error === null && (
        <p
          data-triz-analyzing
          role="status"
          className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--nx-space-cyan)]" aria-hidden />
          AI 正在读取项目数据并分析矛盾…
        </p>
      )}

      {run.phase === 'clarifying' && run.clarificationPrompt && (
        <div
          data-triz-clarification
          data-round={run.clarificationRound}
          className="mt-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2"
        >
          <p className="text-[11px] text-[var(--nx-text-secondary)]">{run.clarificationPrompt}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {TRIZ_CLARIFICATION_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                data-triz-clarification-option
                onClick={() => onAnswerClarification(option)}
                className="rounded-full border border-[var(--nx-border-hairline)] px-2 py-0.5 text-[10px] text-[var(--nx-text-secondary)] hover:border-[var(--nx-space-cyan)]/50 hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
              >
                {option}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-[var(--nx-text-muted)]">
            点一个最接近的，或直接在输入框里用一句话说明（最多再问{' '}
            {Math.max(0, run.maxClarificationRounds - run.clarificationRound)} 次）
          </p>
        </div>
      )}

      {run.phase === 'answered' && (
        <p data-triz-answered className="mt-2 text-[11px] text-[var(--nx-text-muted)]">
          已收到你的补充，继续分析（见下一条）。
        </p>
      )}

      {mapping && run.phase !== 'clarifying' && run.phase !== 'answered' && (
        <div
          data-triz-summary
          className="mt-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5"
        >
          <p className="text-[11px] leading-5 text-[var(--nx-text-primary)]">
            <span className="text-[var(--nx-text-muted)]">AI 判断：</span>
            {plainSummary(run)}
          </p>
        </div>
      )}

      {exhausted && (
        <p
          data-triz-exhausted
          className="mt-2 rounded border border-[var(--nx-status-warning)]/40 px-2 py-1.5 text-[11px] text-[var(--nx-text-secondary)]"
        >
          不再继续追问：{run.clarificationReason ?? run.budgetReason ?? '已到上限'}。
          下面按目前的信息给出方案，可以直接选用。
        </p>
      )}

      {degraded && (
        <p
          data-triz-degradation
          className="mt-1.5 flex items-start gap-1 text-[10px] text-[var(--nx-text-muted)]"
        >
          <AlertTriangle
            className="mt-0.5 h-3 w-3 shrink-0 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          <span>
            这次没有用上模型：
            {(mapping?.fallbackReasons ?? [])
              .map((reason) => trizFallbackReasonText(reason))
              .join('；')}
            。下面是规则模板给出的方案。
          </span>
        </p>
      )}

      {/* ② 选方案（进入确认后由预览承载所选方案，列表收起） */}
      {step >= 3 ? null : solutions.length > 0 ? (
        <>
          <ul data-triz-solutions className="mt-2 flex flex-col gap-2">
            {solutions.map((solution) => (
              <SolutionCard
                key={solution.index}
                solution={solution}
                recommended={solution.index === recommendedSolution}
                selected={run.selectedSolutionIndex === solution.index}
                disabled={busy || !selectable}
                onSelect={() => onSelectSolution(solution.index)}
              />
            ))}
          </ul>
          {step === 1 && selectable && recommendedSolution !== null && (
            <div className="mt-2">
              <PrimaryButton
                data-triz-next="solution"
                onClick={() => onSelectSolution(recommendedSolution)}
              >
                下一步：用 AI 推荐的方案
              </PrimaryButton>
            </div>
          )}
        </>
      ) : (
        run.phase !== 'clarifying' &&
        run.phase !== 'answered' &&
        run.phase !== 'error' && (
          <p data-triz-no-solution className="mt-2 text-[11px] text-[var(--nx-text-muted)]">
            这次没有得出可用方案（信息不足）。可以在输入框补充一句「想改善什么、因此什么变差了」后重试。
          </p>
        )
      )}

      {/* ③ 怎么落实 */}
      {selectedSolution && step === 2 && (
        <div
          data-triz-target-chooser
          className="mt-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2"
        >
          <p className="text-[11px] text-[var(--nx-text-secondary)]">
            要怎么落实「{selectedSolution.title}」？生成预览后还要你确认才会写入。
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <PrimaryButton
              data-triz-next="target"
              data-triz-target={recommendedTarget}
              disabled={busy || !selectable}
              onClick={() => onChooseTarget(recommendedTarget)}
            >
              下一步：
              {TRIZ_TARGET_CHOICES.find((choice) => choice.target === recommendedTarget)?.label ??
                TRIZ_TARGET_LABELS[recommendedTarget]}
            </PrimaryButton>
            {TRIZ_TARGET_CHOICES.filter((choice) => choice.target !== recommendedTarget).map(
              (choice) => (
                <button
                  key={choice.target}
                  type="button"
                  data-triz-target={choice.target}
                  disabled={busy || !selectable}
                  onClick={() => onChooseTarget(choice.target)}
                  title={choice.hint}
                  className="rounded border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)] disabled:opacity-50 hover:border-[var(--nx-space-cyan)]/50 hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                >
                  {choice.label}
                </button>
              ),
            )}
          </div>
        </div>
      )}

      {/* ④ 确认（差异预览 / 确认 / 回执 / 409） */}
      {showPreview && (
        <TrizInterventionPreviewCard
          run={run}
          onConfirm={onConfirmIntervention}
          onCancel={onCancelIntervention}
          onRepreview={onRepreview}
        />
      )}

      {run.phase === 'committed' && run.sourceSignalId && (
        <p data-triz-signal-resolved className="mt-1.5 text-[11px] text-[var(--nx-status-success)]">
          信号 {run.sourceSignalCode ?? `#S${run.sourceSignalId}`}{' '}
          已标记为已处理，信号建议里的这张卡片会自动消失。
        </p>
      )}

      {run.phase === 'cancelled' && run.selectedSolutionIndex !== null && (
        <div className="mt-1.5">
          <PrimaryButton
            data-triz-next="repick"
            onClick={() => onSelectSolution(run.selectedSolutionIndex!)}
          >
            重新选择落实方式
          </PrimaryButton>
        </div>
      )}

      {run.phase === 'error' && run.diff === null && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--nx-status-danger)]">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {run.error?.message ?? '求解失败'}
          {run.error?.code === 'AI_CONNECTION_REQUIRED' ? <AiConnectionRequiredAction /> : null}
          <button
            type="button"
            data-triz-retry-solve
            onClick={onRetrySolve}
            className="rounded border border-[var(--nx-border-hairline)] px-2 py-0.5 text-[11px] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            重试
          </button>
        </div>
      )}

      {busy && (
        <p
          data-triz-busy
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {run.phase === 'committing' ? '正在写入…' : '正在生成预览…'}
        </p>
      )}

      {/* 分析细节（折叠）：矛盾类型 / 参数 / 置信度 / 记录号 / 映射依据与改判 */}
      {mapping && (
        <details data-triz-details className="mt-2 text-[10px] text-[var(--nx-text-muted)]">
          <summary className="cursor-pointer select-none">分析细节</summary>
          <div data-triz-parameters className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span data-triz-contradiction-type>{mapping.contradictionTypeLabel}</span>
            <span>
              改善：
              {mapping.improvingParameter
                ? `${mapping.improvingParameter.displayName}（#${mapping.improvingParameter.number}）`
                : '未识别'}
            </span>
            <span>
              变差：
              {mapping.worseningParameter
                ? `${mapping.worseningParameter.displayName}（#${mapping.worseningParameter.number}）`
                : '未识别'}
            </span>
            <span data-triz-confidence>置信度 {Math.round(mapping.confidence * 100)}%</span>
            {run.analysisId !== null && <span data-triz-analysis-id>记录 #{run.analysisId}</span>}
            {run.humanOverride && <span data-triz-human-override>已人工改判</span>}
          </div>
          <div className="mt-1">
            <TrizEvidenceDrawer run={run} onOverride={onOverride} precise={precise} />
          </div>
        </details>
      )}
    </div>
  )
}
