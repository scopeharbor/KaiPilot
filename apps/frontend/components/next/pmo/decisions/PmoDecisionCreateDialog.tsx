'use client'

import * as React from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useCreateDecisionCase } from '@/hooks/use-decision-workbench'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  PMO_DECISION_QUESTION_MAX_LENGTH,
  PMO_DECISION_SCOPE_SUMMARY_MAX_LENGTH,
  PMO_DECISION_TITLE_MAX_LENGTH,
} from '@aiproj/types'

/**
 * PMO 决策议题建卡对话框（v3-ui-next-pmo-domain W6 · tasks 6.2，
 * spec「决策工作台队列与议题建立」场景）。
 *
 * - 入口门禁在容器层（仅 `pmo_decision:manage` 可见本组件），此处只做表单校验；
 * - 字段对齐既有 POST .../cases 契约：标题（必填 ≤200）/ 决策问题（必填 ≤500）/
 *   范围摘要（可选 ≤300）；负责人恒为当前登录用户（后端审计 actor，透明展示）；
 * - 提交为显式用户动作：成功后由 mutation 失效 cases 缓存（列表自动刷新）并关闭；
 *   失败保留输入并回显服务端错误，不做乐观静默（design Decision 4）；
 * - Esc / 遮罩 / 取消可关闭；提交中禁用（防双击双写）。
 */
export interface PmoDecisionCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const fieldClass =
  'w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50 placeholder:text-[var(--nx-text-muted)]'
const labelClass = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'

/** 统一错误提取：ApiError（非 Error 实例）与 Error 均可读（服务端 message 优先）。 */
export function resolveDecisionActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return fallback
}

export function PmoDecisionCreateDialog({ open, onOpenChange }: PmoDecisionCreateDialogProps) {
  const user = useAuthStore((state) => state.user)
  const createCase = useCreateDecisionCase()

  const [title, setTitle] = React.useState('')
  const [question, setQuestion] = React.useState('')
  const [scopeSummary, setScopeSummary] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setTitle('')
      setQuestion('')
      setScopeSummary('')
      setFormError(null)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !createCase.isPending) onOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, createCase.isPending, onOpenChange])

  if (!open) return null

  const identity = user ? `${user.fullName ?? user.email}（用户 #${user.id}）` : null
  const canSubmit =
    title.trim() !== '' && question.trim() !== '' && !createCase.isPending && user !== null

  async function handleCreate(): Promise<void> {
    if (!canSubmit || user === null) return
    setFormError(null)
    try {
      await createCase.mutateAsync({
        title: title.trim(),
        decisionQuestion: question.trim(),
        scopeSummary: scopeSummary.trim() === '' ? undefined : scopeSummary.trim(),
        ownerId: user.id,
      })
      onOpenChange(false)
    } catch (error) {
      setFormError(resolveDecisionActionError(error, '议题创建失败，请重试'))
    }
  }

  return (
    <div data-pmo-decision-create-dialog className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-pmo-decision-create-scrim
        aria-label="关闭新建议题"
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="新建议题"
        data-pmo-decision-create-panel
        className="absolute left-1/2 top-1/2 flex max-h-[80vh] w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] shadow-[0_0_64px_rgba(0,0,0,0.6)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Plus className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">新建议题</h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                POST /pmo/decision-workbench/cases · 进入 draft 状态
              </p>
            </div>
          </div>
          <button
            type="button"
            data-pmo-decision-create-close
            aria-label="关闭新建议题"
            onClick={() => onOpenChange(false)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {formError ? (
            <p
              role="alert"
              aria-label="创建失败"
              data-pmo-decision-create-error
              className="rounded-sm border border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {formError}
            </p>
          ) : null}
          <label className="block">
            <span className={labelClass}>议题标题（必填）</span>
            <input
              data-pmo-decision-create-title
              className={fieldClass}
              maxLength={PMO_DECISION_TITLE_MAX_LENGTH}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：是否调整 Q4 跨项目资源投入方向"
            />
          </label>
          <label className="block">
            <span className={labelClass}>决策问题（必填）</span>
            <textarea
              data-pmo-decision-create-question
              className={cn(fieldClass, 'min-h-20 resize-y leading-relaxed')}
              maxLength={PMO_DECISION_QUESTION_MAX_LENGTH}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="用一句话描述需要拍板的问题，AI 不会代为决定。"
            />
          </label>
          <label className="block">
            <span className={labelClass}>范围摘要（可选）</span>
            <input
              data-pmo-decision-create-scope
              className={fieldClass}
              maxLength={PMO_DECISION_SCOPE_SUMMARY_MAX_LENGTH}
              value={scopeSummary}
              onChange={(event) => setScopeSummary(event.target.value)}
              placeholder="例如：项目 A / 项目 B · 2026-Q4 资源计划"
            />
          </label>
          <p
            data-pmo-decision-create-identity
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
          >
            议题将记录你的身份（{identity ?? '当前用户'}）为负责人与审计 actor，创建后立即进入{' '}
            <span data-draft-status-hint className="text-[var(--nx-text-secondary)]">
              draft
            </span>{' '}
            草稿状态。
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3.5">
          <button
            type="button"
            data-pmo-decision-create-cancel
            disabled={createCase.isPending}
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            data-pmo-decision-create-submit
            disabled={!canSubmit}
            onClick={() => void handleCreate()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-40"
          >
            {createCase.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : null}
            创建议题
          </button>
        </footer>
      </div>
    </div>
  )
}

export default PmoDecisionCreateDialog
