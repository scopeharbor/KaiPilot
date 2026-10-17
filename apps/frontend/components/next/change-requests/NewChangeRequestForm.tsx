'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Bot, Check, Save, Sparkles, X } from 'lucide-react'
import type {
  ChangeRequest,
  ChangeRequestImpactSummary,
  ChangeRequestPriority,
  ChangeRequestType,
} from '@/lib/api/change-requests'
import { useCreateChangeRequest, useUpdateChangeRequest } from '@/hooks/use-change-requests'
import { usePermissions } from '@/hooks/use-permissions'
import { CHANGE_REQUEST_CREATE } from './cr-permissions'
import { CR_IMPACT_SUMMARY_FIELDS, CR_PRIORITY_OPTIONS, CR_TYPE_OPTIONS } from './cr-meta'
import { ChangeAiImpactModal } from './ChangeAiImpactModal'

/**
 * 新建/编辑变更请求表单工作面（v3-ui-next-risk-change-domains W2 · tasks 2.3）。
 *
 * - mode='create'：POST /projects/:projectId/change-requests 建草稿，成功后平滑
 *   跳转新变更详情页（spec「新建变更请求」场景）；必填校验：标题（trim）非空；
 * - mode='edit'：草稿/退回态申请人就地修改基本信息与六维影响摘要（PATCH），
 *   保存成功经 onSaved 回调切回只读详情（服务端 policy 另校验请求人本人）；
 * - 初始六维影响摘要六个文本域与只读回显共用 CR_IMPACT_SUMMARY_FIELDS 契约；
 * - AI 影响分析辅助（RL-01）：仅当已有变更草稿（crId）时提供入口，浮层建议必须
 *   由用户逐项点击「填入表单」才引用至六维文本域，绝不静默覆盖未保存内容；
 * - 中文文案；令牌 var(--nx-*)；表单控件携带 data-cr-form-* 供测试定位。
 */

export interface NewChangeRequestFormProps {
  projectId: number
  mode: 'create' | 'edit'
  /** edit 模式必传：草稿/退回态变更 ID（AI 影响分析与 PATCH 目标）。 */
  crId?: number
  /** edit 模式预填数据（详情对象直传，缺省清空表单）。 */
  initial?: Pick<
    ChangeRequest,
    'title' | 'description' | 'changeType' | 'priority' | 'impactSummary'
  > | null
  /** 取消编辑：详情页切回只读态。create 模式由页内「取消」链接承担。 */
  onCancel?: () => void
  /** edit 保存成功回调（携带最新服务端数据）。 */
  onSaved?: (cr: ChangeRequest) => void
}

const EMPTY_SUMMARY: ChangeRequestImpactSummary = {
  scope: '',
  schedule: '',
  resources: '',
  cost: '',
  risks: '',
  assumptions: '',
}

export function NewChangeRequestForm({
  projectId,
  mode,
  crId,
  initial,
  onCancel,
  onSaved,
}: NewChangeRequestFormProps) {
  const router = useRouter()
  const { can } = usePermissions()
  const canCreate = can(CHANGE_REQUEST_CREATE)

  // ---- 表单态（首次挂载自 initial 预填；AI 填入只落六维摘要，绝不覆盖其他未保存字段）----
  const [title, setTitle] = React.useState(() => initial?.title ?? '')
  const [description, setDescription] = React.useState(() => initial?.description ?? '')
  const [changeType, setChangeType] = React.useState<ChangeRequestType>(
    () => initial?.changeType ?? 'other',
  )
  const [priority, setPriority] = React.useState<ChangeRequestPriority>(
    () => initial?.priority ?? 'medium',
  )
  const [summary, setSummary] = React.useState<ChangeRequestImpactSummary>(() => {
    const base: ChangeRequestImpactSummary = { ...EMPTY_SUMMARY }
    const given = initial?.impactSummary ?? null
    if (given) {
      for (const key of Object.keys(EMPTY_SUMMARY) as Array<keyof ChangeRequestImpactSummary>) {
        const value = given[key]
        if (typeof value === 'string') base[key] = value
      }
    }
    return base
  })
  const [formError, setFormError] = React.useState<string | null>(null)
  const [aiOpen, setAiOpen] = React.useState(false)

  // 表单在 edit 模式随详情刷新而更换目标草稿时，整体重置为最新数据
  React.useEffect(() => {
    if (mode === 'edit' && crId !== undefined) {
      setTitle(initial?.title ?? '')
      setDescription(initial?.description ?? '')
      setChangeType(initial?.changeType ?? 'other')
      setPriority(initial?.priority ?? 'medium')
      const base: ChangeRequestImpactSummary = { ...EMPTY_SUMMARY }
      const given = initial?.impactSummary ?? null
      if (given) {
        for (const key of Object.keys(EMPTY_SUMMARY) as Array<keyof ChangeRequestImpactSummary>) {
          const value = given[key]
          if (typeof value === 'string') base[key] = value
        }
      }
      setSummary(base)
      setFormError(null)
    }
  }, [mode, crId])

  const createMutation = useCreateChangeRequest(projectId)
  const updateMutation = useUpdateChangeRequest(crId ?? 0)

  const saving = mode === 'create' ? createMutation.isPending : updateMutation.isPending
  const canSubmit =
    title.trim() !== '' && !saving && canCreate && (mode !== 'edit' || crId !== undefined)

  const submit = React.useCallback(() => {
    if (title.trim() === '') return
    const payload = {
      title: title.trim(),
      description: description.trim() === '' ? undefined : description.trim(),
      changeType,
      priority,
      impactSummary: summary,
    }
    if (mode === 'create') {
      createMutation.mutate(payload, {
        onSuccess: (result) => {
          router.push(`/next/projects/${projectId}/change-requests/${result.data.id}`)
        },
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : '创建变更请求失败，请重试')
        },
      })
      return
    }
    updateMutation.mutate(payload, {
      onSuccess: (result) => {
        onSaved?.(result.data)
      },
      onError: (error) => {
        setFormError(error instanceof Error ? error.message : '保存修改失败，请重试')
      },
    })
  }, [
    title,
    description,
    changeType,
    priority,
    summary,
    mode,
    createMutation,
    updateMutation,
    projectId,
    router,
    onSaved,
  ])

  const setSummaryField = (key: keyof ChangeRequestImpactSummary, value: string) => {
    setSummary((current) => ({ ...current, [key]: value }))
  }

  // AI 浮层「填入表单」：仅将**非空**建议文本引用至六维影响摘要字段；无建议的
  // 维度与标题/描述等未保存内容保持原样（RL-01 人工采纳边界）。
  const fillFromAi = React.useCallback((suggestions: Record<string, string>) => {
    setSummary((current) => {
      const next = { ...current }
      for (const [dimension, text] of Object.entries(suggestions)) {
        if (
          Object.prototype.hasOwnProperty.call(EMPTY_SUMMARY, dimension) &&
          typeof text === 'string' &&
          text.trim() !== ''
        ) {
          ;(next as Record<string, string | undefined>)[dimension] = text
        }
      }
      return next
    })
    setAiOpen(false)
  }, [])

  const editable = mode === 'edit' ? canCreate : true

  const fieldClass =
    'h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'
  const textareaClass =
    'w-full resize-y rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs leading-relaxed text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'
  const labelClass = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'
  const sectionClass =
    'rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4'

  if (!editable) {
    return (
      <div
        data-cr-form-denied
        className="mx-auto max-w-md rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center text-xs text-[var(--nx-text-muted)]"
      >
        当前会话不具备编辑变更请求的权限（{CHANGE_REQUEST_CREATE}）。
      </div>
    )
  }

  return (
    <div data-cr-form data-cr-form-mode={mode} className="flex flex-col gap-4">
      <section data-cr-form-section="basic" className={sectionClass}>
        <header className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
            基本信息
          </span>
        </header>
        <div className="space-y-3.5">
          <div>
            <label htmlFor="cr-form-title" className={labelClass}>
              变更标题 <span className="text-[var(--nx-status-danger)]">*</span>
            </label>
            <input
              id="cr-form-title"
              data-cr-form-title
              type="text"
              maxLength={255}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：增加移动端扫码登录模块"
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="cr-form-description" className={labelClass}>
              变更描述 <span className="text-[var(--nx-text-muted)]">（可选）</span>
            </label>
            <textarea
              id="cr-form-description"
              data-cr-form-description
              rows={4}
              maxLength={5000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="详细描述变更内容、背景与必要性…"
              className={textareaClass}
            />
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div>
              <label htmlFor="cr-form-type" className={labelClass}>
                变更类型 <span className="text-[var(--nx-status-danger)]">*</span>
              </label>
              <select
                id="cr-form-type"
                data-cr-form-type
                value={changeType}
                onChange={(event) => setChangeType(event.target.value as ChangeRequestType)}
                className={fieldClass}
              >
                {CR_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cr-form-priority" className={labelClass}>
                紧急程度 <span className="text-[var(--nx-status-danger)]">*</span>
              </label>
              <select
                id="cr-form-priority"
                data-cr-form-priority
                value={priority}
                onChange={(event) => setPriority(event.target.value as ChangeRequestPriority)}
                className={fieldClass}
              >
                {CR_PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section data-cr-form-section="impact" className={sectionClass}>
        <header className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
            初始六维影响摘要
          </span>
          <div className="flex items-center gap-2">
            {mode === 'edit' && crId !== undefined ? (
              <button
                type="button"
                data-cr-ai-trigger
                onClick={() => setAiOpen(true)}
                className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
              >
                <Sparkles className="h-3 w-3" aria-hidden />
                AI 影响分析
              </button>
            ) : (
              <span className="text-[10px] text-[var(--nx-text-muted)]">
                保存草稿后可在详情页调用 AI 影响分析辅助
              </span>
            )}
          </div>
        </header>
        <p className="mb-3 text-[10px] text-[var(--nx-text-muted)]">
          按范围 / 进度 / 资源 / 成本 / 风险 / 假设六维定性说明本次变更的预期影响。
        </p>
        <div className="grid gap-3.5 md:grid-cols-2">
          {CR_IMPACT_SUMMARY_FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={`cr-form-impact-${field.key}`} className={labelClass}>
                {field.label}
              </label>
              <textarea
                id={`cr-form-impact-${field.key}`}
                data-cr-form-impact={field.key}
                rows={2}
                value={summary[field.key] ?? ''}
                onChange={(event) => setSummaryField(field.key, event.target.value)}
                placeholder={field.placeholder}
                className={textareaClass}
              />
            </div>
          ))}
        </div>
      </section>

      {formError ? (
        <p
          role="alert"
          aria-label="变更请求表单保存失败"
          data-cr-form-error
          className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
        >
          {formError}
        </p>
      ) : null}

      <footer className="flex items-center justify-end gap-2">
        {mode === 'edit' ? (
          <button
            type="button"
            data-cr-form-cancel
            onClick={onCancel}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            取消编辑
          </button>
        ) : (
          <button
            type="button"
            data-cr-form-cancel
            onClick={() => router.push(`/next/projects/${projectId}/change-requests`)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            取消
          </button>
        )}
        <button
          type="button"
          data-cr-form-submit
          disabled={!canSubmit}
          onClick={submit}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? (
            <Bot className="h-3.5 w-3.5 animate-pulse" aria-hidden />
          ) : mode === 'edit' ? (
            <Save className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden />
          )}
          {saving
            ? mode === 'edit'
              ? '保存中…'
              : '创建中…'
            : mode === 'edit'
              ? '保存修改'
              : '创建草稿'}
        </button>
      </footer>

      {mode === 'edit' && crId !== undefined ? (
        <ChangeAiImpactModal
          open={aiOpen}
          projectId={projectId}
          crId={crId}
          onClose={() => setAiOpen(false)}
          onFill={fillFromAi}
        />
      ) : null}
    </div>
  )
}

export default NewChangeRequestForm
