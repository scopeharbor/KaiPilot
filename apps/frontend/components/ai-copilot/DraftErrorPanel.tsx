'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ProjectDraftFailureDetail, ProjectDraftGenerationStage } from '@aiproj/types'

export const draftStageLabels: Record<ProjectDraftGenerationStage, string> = {
  charter_scope: '章程与范围',
  wbs_tasks: 'WBS 与任务',
  schedule_dependencies: '排期与依赖',
  resources_risks_acceptance: '资源、风险与验收',
  reconcile_review: '一致性复核',
}

export interface DraftErrorPanelProps {
  error: string | null
  failure?: ProjectDraftFailureDetail | null
  onRetry: () => void
  onBack: () => void
}

export function DraftErrorPanel({ error, failure, onRetry, onBack }: DraftErrorPanelProps) {
  const stage = failure?.stage
  const stageLabel = stage ? (draftStageLabels[stage] ?? stage) : null
  const reasonCode = failure?.reasonCode
  const errors = failure?.errors ?? []
  const displayMessage = error || failure?.message || '草案生成失败，请根据错误原因重试。'

  return (
    <section
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6 md:py-8"
      data-draft-error-panel
    >
      <div className="rounded-[var(--radius-xl)] border border-danger/30 bg-danger-bg/70 p-6 text-center shadow-sm">
        <AlertCircle className="mx-auto h-10 w-10 text-danger" aria-hidden />
        <h2 className="mt-3 text-xl font-semibold text-heading">草案生成失败</h2>

        {stageLabel || reasonCode ? (
          <div
            className="mt-3 flex flex-wrap items-center justify-center gap-2"
            data-testid="draft-failure-tags"
          >
            {stageLabel ? (
              <span
                className="inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-3 py-1 text-xs font-medium text-danger"
                data-testid="draft-failure-stage"
              >
                失败阶段：{stageLabel}
              </span>
            ) : null}
            {reasonCode ? (
              <span
                className="inline-flex items-center rounded-full border border-border bg-gray-100 px-3 py-1 font-mono text-xs text-gray-700"
                data-testid="draft-failure-reason-code"
              >
                原因码：{reasonCode}
              </span>
            ) : null}
          </div>
        ) : null}

        <p className="mt-3 text-sm leading-6 text-danger/90" data-testid="draft-failure-message">
          {displayMessage}
        </p>

        {errors.length > 0 ? (
          <div
            className="mt-4 rounded-[var(--radius-lg)] border border-danger/20 bg-gray-0 p-4 text-left shadow-sm"
            data-testid="draft-failure-errors"
          >
            <h3 className="text-xs font-semibold text-heading">脱敏错误摘要</h3>
            <ul className="mt-2 space-y-1.5 text-xs text-gray-700">
              {errors.map((err, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden />
                  <div className="flex-1">
                    {err.path ? (
                      <code className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">
                        {err.path}
                      </code>
                    ) : null}
                    {err.code ? (
                      <span className="mr-1.5 font-mono text-gray-500">[{err.code}]</span>
                    ) : null}
                    <span>{err.message}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-5 flex justify-center gap-3">
          <Button type="button" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            重试
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            返回上下文
          </Button>
        </div>
      </div>
    </section>
  )
}
