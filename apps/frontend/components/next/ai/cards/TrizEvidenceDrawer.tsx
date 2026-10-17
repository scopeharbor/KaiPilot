'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import Link from 'next/link'
import { ExternalLink, X } from 'lucide-react'
import type { ColleagueTrizRun } from '@/stores/next-ai-colleague-store'
import type { TrizOverrideInput, TrizParameterItem } from '@/lib/api/triz-copilot'
import { useTrizParameters } from '@/hooks/use-triz-parameters'
import {
  TRIZ_PATH_BADGES,
  trizContradictionMatrixHref,
  trizFallbackReasonText,
} from './triz-copilot-copy'

/**
 * 映射依据抽屉（v3-triz-contradiction-copilot W5 · tasks 5.3）。
 *
 * 呈现（spec「映射依据可查看与可改判」第 1 条）：改善 / 恶化参数、矛盾类型、
 * 命中的推荐原则编号集合（**含未进 Top 3 的编号**）、`path` 徽标与置信度、来源章节（RL-10）。
 *
 * - 诚实披露：`rule` 路径文案明确写「规则匹配 / 未调用模型」，与 `ai` 路径严格区分，绝不冒充推理；
 * - 改判：从收敛后的参数候选中改选改善 / 恶化参数并确认重算（服务端只改本分析记录，
 *   业务数据零变更，且产生改判审计）；参数只在本视图中作为**改判入口**出现，
 *   对话流内不出现参数表（design D1）；
 * - 跳转：把当前参数对推送到图表馆 TRIZ 分馆矛盾矩阵件（该镜头未注册时图表馆
 *   有中性回退，跳转本身不阻断）。
 */
export interface TrizEvidenceDrawerProps {
  run: ColleagueTrizRun
  /** 改判参数并重算（由外层调用 `overrideTrizParameters`） */
  onOverride: (input: TrizOverrideInput) => void
  /** 面板级沉浸档位（精确档停用过渡动画） */
  precise?: boolean
}

function ParameterBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-wide text-[var(--nx-text-muted)]">{label}</div>
      <div className="text-xs text-[var(--nx-text-primary)]">{value}</div>
    </div>
  )
}

/** 参数择项：以当前参数为默认值，候选取自动态 39 项参数列表（值为参数编号）。 */
function ParameterSelect({
  label,
  value,
  onChange,
  testId,
  options,
  disabled = false,
}: {
  label: string
  value: number | null
  onChange: (next: number | null) => void
  testId: string
  options: TrizParameterItem[]
  disabled?: boolean
}) {
  const known = options.some((option) => option.number === value)
  return (
    <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
      {label}
      <select
        data-triz-override-param={testId}
        value={value === null ? '' : String(value)}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
        disabled={disabled}
        className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 text-[11px] text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
      >
        <option value="">（未识别）</option>
        {!known && value !== null && <option value={String(value)}>当前参数 #{value}</option>}
        {options.map((option) => (
          <option key={option.number} value={String(option.number)}>
            {option.displayName}（#{option.number}）
          </option>
        ))}
      </select>
    </label>
  )
}

export function TrizEvidenceDrawer({ run, onOverride, precise = false }: TrizEvidenceDrawerProps) {
  const [open, setOpen] = React.useState(false)
  const mapping = run.mapping
  const improvingNumber = mapping?.improvingParameter?.number ?? null
  const worseningNumber = mapping?.worseningParameter?.number ?? null
  const [improving, setImproving] = React.useState<number | null>(improvingNumber)
  const [worsening, setWorsening] = React.useState<number | null>(worseningNumber)

  const { data: parameters = [], isError: parametersError } = useTrizParameters(run.projectId)

  // 外部（受理 / 改判 / 澄清续轮）更新后同步本地择项，避免抽屉残留上一轮参数。
  React.useEffect(() => {
    setImproving(improvingNumber)
    setWorsening(worseningNumber)
  }, [improvingNumber, worseningNumber])

  if (!mapping) return null

  const badge = TRIZ_PATH_BADGES[mapping.path]
  const topNumbers = new Set(run.solutions.map((solution) => solution.principle.number))
  const matrixHref =
    improvingNumber !== null && worseningNumber !== null
      ? trizContradictionMatrixHref(run.projectId, improvingNumber, worseningNumber)
      : null
  const changed = improving !== improvingNumber || worsening !== worseningNumber

  const submitOverride = () => {
    const input: TrizOverrideInput = {}
    if (improving !== null) input.improvingParameter = improving
    if (worsening !== null) input.worseningParameter = worsening
    onOverride(input)
    setOpen(false)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          data-triz-evidence-trigger
          className="rounded border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-space-cyan)]/50 hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          查看映射依据
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-testid="triz-evidence-scrim"
          className={`fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/40 ${
            precise ? '' : 'backdrop-blur-xs'
          }`}
        />
        <DialogPrimitive.Content
          role="dialog"
          aria-modal="true"
          aria-label="映射依据"
          aria-describedby={undefined}
          data-triz-evidence-drawer
          data-triz-path={mapping.path}
          // Portal 逃逸 `[data-next-track]` 令牌作用域；本层自己用 --nx-* 画底色与边框，
          // 令牌必须挂在 Content 上而不是内层，否则背景透明、内容直接叠在 AI 同事面板上。
          data-next-track
          className={`fixed bottom-0 right-0 top-12 z-[var(--z-modal)] flex w-[400px] max-w-full flex-col overflow-y-auto border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 outline-none ${
            precise ? '' : 'transition-transform duration-200 ease-out'
          }`}
        >
          <div data-next-track className="flex h-full flex-col gap-3">
            <header className="flex items-start justify-between gap-2">
              <div>
                <DialogPrimitive.Title className="text-sm font-semibold text-[var(--nx-text-primary)]">
                  映射依据
                </DialogPrimitive.Title>
                <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">
                  分析记录 #{run.analysisId}
                  {run.humanOverride ? ' · 已人工改判' : ''}
                </p>
              </div>
              <DialogPrimitive.Close
                aria-label="关闭映射依据"
                data-triz-evidence-close
                className="shrink-0 rounded p-1 text-[var(--nx-text-muted)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </DialogPrimitive.Close>
            </header>

            {/* path 徽标：规则匹配与模型推理诚实区分（RL-07，不得冒充） */}
            <div
              data-triz-path-badge={mapping.path}
              className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-[var(--nx-space-cyan)]/15 px-1.5 py-0.5 text-[10px] text-[var(--nx-space-cyan)]">
                  {badge.label}
                </span>
                <span className="text-[10px] text-[var(--nx-text-secondary)]">
                  置信度 {Math.round(mapping.confidence * 100)}%
                </span>
                <span className="text-[10px] text-[var(--nx-text-muted)]">
                  {mapping.contradictionTypeLabel}
                </span>
              </div>
              <p data-triz-path-detail className="mt-1 text-[10px] text-[var(--nx-text-muted)]">
                {badge.detail}
              </p>
            </div>

            <section data-triz-evidence-parameters className="grid grid-cols-2 gap-2">
              <ParameterBlock
                label="改善参数"
                value={
                  mapping.improvingParameter
                    ? `${mapping.improvingParameter.displayName}（#${mapping.improvingParameter.number}）`
                    : '未识别'
                }
              />
              <ParameterBlock
                label="恶化参数"
                value={
                  mapping.worseningParameter
                    ? `${mapping.worseningParameter.displayName}（#${mapping.worseningParameter.number}）`
                    : '未识别'
                }
              />
            </section>

            <section data-triz-evidence-principles>
              <h3 className="text-[11px] font-medium text-[var(--nx-text-primary)]">
                候选原则（{mapping.candidatePrinciples.length} 条）
              </h3>
              <ul className="mt-1 flex flex-col gap-1">
                {mapping.candidatePrinciples.map((principle) => (
                  <li
                    key={principle.number}
                    data-triz-candidate-principle={principle.number}
                    className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-primary)]">
                      <span className="text-[var(--nx-text-muted)]">#{principle.number}</span>
                      {principle.displayName}
                      {topNumbers.has(principle.number) ? (
                        <span className="rounded bg-[var(--nx-space-cyan)]/15 px-1 text-[9px] text-[var(--nx-space-cyan)]">
                          Top 3
                        </span>
                      ) : (
                        <span
                          data-triz-principle-excluded
                          className="rounded bg-[var(--nx-bg-1)] px-1 text-[9px] text-[var(--nx-text-muted)]"
                        >
                          未进 Top 3
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">
                      {principle.source}
                    </p>
                  </li>
                ))}
                {mapping.candidatePrinciples.length === 0 && (
                  <li className="text-[11px] text-[var(--nx-text-muted)]">
                    本次未命中任何候选原则（信息不足）。
                  </li>
                )}
              </ul>
              {run.excludedPrincipleNumbers.length > 0 && (
                <p
                  data-triz-excluded-principles
                  className="mt-1 text-[10px] text-[var(--nx-text-muted)]"
                >
                  未进 Top 3 的原则编号：
                  {run.excludedPrincipleNumbers.map((number) => `#${number}`).join('、')}
                </p>
              )}
            </section>

            {mapping.sourceSections.length > 0 && (
              <section data-triz-evidence-source>
                <h3 className="text-[11px] font-medium text-[var(--nx-text-primary)]">来源章节</h3>
                <ul className="mt-1 list-disc pl-4 text-[10px] text-[var(--nx-text-muted)]">
                  {mapping.sourceSections.map((section) => (
                    <li key={section}>{section}</li>
                  ))}
                </ul>
              </section>
            )}

            {mapping.fallbackReasons.length > 0 && (
              <section data-triz-evidence-fallback>
                <h3 className="text-[11px] font-medium text-[var(--nx-text-primary)]">降级说明</h3>
                <ul className="mt-1 list-disc pl-4 text-[10px] text-[var(--nx-text-muted)]">
                  {mapping.fallbackReasons.map((reason) => (
                    <li key={reason}>{trizFallbackReasonText(reason)}</li>
                  ))}
                </ul>
              </section>
            )}

            <section
              data-triz-override
              className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2"
            >
              <h3 className="text-[11px] font-medium text-[var(--nx-text-primary)]">
                改判参数并重算
              </h3>
              <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">
                只更新本分析记录与方案，项目任务 / 风险 / 变更等业务数据零变更。
              </p>
              {parametersError && (
                <p
                  data-triz-override-degradation
                  className="mt-1 rounded bg-[var(--nx-bg-1)] px-2 py-1 text-[10px] text-[var(--nx-text-muted)]"
                >
                  改判候选不可用（仅供查看）
                </p>
              )}
              <div className="mt-2 flex flex-col gap-2">
                <ParameterSelect
                  label="改善参数"
                  value={improving}
                  onChange={setImproving}
                  testId="improving"
                  options={parameters}
                  disabled={parametersError}
                />
                <ParameterSelect
                  label="恶化参数"
                  value={worsening}
                  onChange={setWorsening}
                  testId="worsening"
                  options={parameters}
                  disabled={parametersError}
                />
                <button
                  type="button"
                  data-triz-override-submit
                  disabled={!changed || parametersError}
                  onClick={submitOverride}
                  className="inline-flex items-center justify-center gap-1 rounded border border-[var(--nx-space-cyan)]/60 bg-[var(--nx-bg-1)] px-2 py-1 text-[11px] text-[var(--nx-text-primary)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                >
                  确认重算
                </button>
              </div>
            </section>

            <section>
              {matrixHref ? (
                <Link
                  href={matrixHref}
                  data-triz-matrix-link
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--nx-space-cyan)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  在图表馆查看矛盾矩阵
                </Link>
              ) : (
                <p
                  data-triz-matrix-link-unavailable
                  className="text-[10px] text-[var(--nx-text-muted)]"
                >
                  参数未识别，暂无法跳转矛盾矩阵（可先改判参数）。
                </p>
              )}
            </section>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
