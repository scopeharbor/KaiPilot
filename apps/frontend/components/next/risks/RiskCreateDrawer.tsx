'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, X } from 'lucide-react'
import { createRisk, type RiskCategory } from '@/lib/api/risks'
import { RISK_CATEGORY_OPTIONS, RISK_SCALE_OPTIONS } from '@/components/next/charts/risk/risk-meta'

/**
 * 新建风险抽屉（v3-ui-next-risk-change-domains W1 · tasks 1.7）。
 *
 * - 写操作直连既有端点 POST /projects/:projectId/risks（新建入口已在容器层按
 *   risk:manage / risk:create 门禁，此处不再重复渲染级校验）；
 * - 字段：风险标题（必填）、描述、分类、概率（1-5）、影响度（1-5）与缓解措施，
 *   与图表馆登记镜头抽屉模式同构（RL-04 共用同一表单语义）；
 * - 保存成功后统一失效 ['risks'] / ['risks-v2'] / ['risk-matrix'] 前缀缓存
 *   （登记底册追加、矩阵对应格计数 +1、工作台总览刷新）；
 * - Esc / 遮罩 / 取消均可关闭；标题必填校验 + 提交中禁用双保险。
 */
export interface RiskCreateDrawerProps {
  projectId: number
  open: boolean
  onClose: () => void
}

export function RiskCreateDrawer({ projectId, open, onClose }: RiskCreateDrawerProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [category, setCategory] = React.useState<RiskCategory>('technical')
  const [probability, setProbability] = React.useState(3)
  const [impact, setImpact] = React.useState(3)
  const [mitigation, setMitigation] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setCategory('technical')
      setProbability(3)
      setImpact(3)
      setMitigation('')
      setFormError(null)
    }
  }, [open])

  // Esc 关闭
  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const createMutation = useMutation({
    mutationFn: () =>
      createRisk(projectId, {
        title: title.trim(),
        description: description.trim() === '' ? '（人工登记）' : description.trim(),
        category,
        probability,
        impact,
        mitigationStrategy: mitigation.trim() === '' ? null : mitigation.trim(),
      }),
    onSuccess: () => {
      setFormError(null)
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['risks'] }),
        queryClient.invalidateQueries({ queryKey: ['risks-v2'] }),
        queryClient.invalidateQueries({ queryKey: ['risk-matrix'] }),
      ])
      onClose()
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : '新建风险失败，请重试')
    },
  })

  if (!open) return null

  const canSubmit = title.trim() !== '' && !createMutation.isPending

  const fieldClass =
    'h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'
  const labelClass = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'

  return (
    <div data-risk-create-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-risk-create-scrim
        aria-label="关闭新建风险"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="新建风险"
        data-risk-create-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Plus className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">新建风险</h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                POST /projects/{projectId}/risks
              </p>
            </div>
          </div>
          <button
            type="button"
            data-risk-create-close
            aria-label="关闭新建风险"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {formError ? (
            <p
              role="alert"
              aria-label="新建风险失败"
              data-risk-create-error
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {formError}
            </p>
          ) : null}

          <div>
            <label htmlFor="risk-create-title" className={labelClass}>
              风险标题 <span className="text-[var(--nx-status-danger)]">*</span>
            </label>
            <input
              id="risk-create-title"
              data-risk-create-title
              type="text"
              value={title}
              maxLength={255}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：核心数据库迁移导致服务中断"
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="risk-create-description" className={labelClass}>
              风险描述（可选）
            </label>
            <textarea
              id="risk-create-description"
              data-risk-create-description
              rows={3}
              value={description}
              maxLength={5000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="描述风险背景、触发条件与影响路径…"
              className={`${fieldClass} h-auto resize-y py-1.5 leading-relaxed`}
            />
          </div>

          <div>
            <label htmlFor="risk-create-category" className={labelClass}>
              风险分类
            </label>
            <select
              id="risk-create-category"
              data-risk-create-category
              value={category}
              onChange={(event) => setCategory(event.target.value as RiskCategory)}
              className={fieldClass}
            >
              {RISK_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="risk-create-probability" className={labelClass}>
                发生概率
              </label>
              <select
                id="risk-create-probability"
                data-risk-create-probability
                value={probability}
                onChange={(event) => setProbability(Number(event.target.value))}
                className={fieldClass}
              >
                {RISK_SCALE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="risk-create-impact" className={labelClass}>
                影响度
              </label>
              <select
                id="risk-create-impact"
                data-risk-create-impact
                value={impact}
                onChange={(event) => setImpact(Number(event.target.value))}
                className={fieldClass}
              >
                {RISK_SCALE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="risk-create-mitigation" className={labelClass}>
              缓解措施（可选）
            </label>
            <textarea
              id="risk-create-mitigation"
              data-risk-create-mitigation
              rows={3}
              value={mitigation}
              maxLength={5000}
              onChange={(event) => setMitigation(event.target.value)}
              placeholder="填写预置缓解与应对措施…"
              className={`${fieldClass} h-auto resize-y py-1.5 leading-relaxed`}
            />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <button
            type="button"
            data-risk-create-cancel
            onClick={onClose}
            disabled={createMutation.isPending}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-risk-create-submit
            disabled={!canSubmit}
            onClick={() => createMutation.mutate()}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden />
            )}
            保存风险
          </button>
        </footer>
      </aside>
    </div>
  )
}

export default RiskCreateDrawer
