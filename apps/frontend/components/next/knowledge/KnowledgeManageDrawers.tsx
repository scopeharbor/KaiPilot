'use client'

import * as React from 'react'
import { z } from 'zod'
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  FilePlus2,
  History,
  Link2,
  Loader2,
  Plus,
  ShieldAlert,
  X,
} from 'lucide-react'
import {
  useConfirmKnowledge,
  useCreateKnowledge,
  useKnowledgeDetail,
  useTransitionKnowledgeLifecycle,
} from '@/hooks/use-knowledge'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import type { ApiError } from '@/lib/api-client'
import type { KnowledgeItem, KnowledgeLayer, KnowledgeLifecycleStatus } from '@aiproj/types'
import {
  KNOWLEDGE_LAYER_META,
  KNOWLEDGE_STATUS_META,
  SYNTHETIC_BADGE_CLASS,
  SYNTHETIC_BADGE_TEXT,
  SYNTHETIC_TOOLTIP_TEXT,
  canConfirmPromotion,
  formatKnowledgeDate,
  layerMetaOf,
  nextKnowledgeStatuses,
  requiresSyntheticBadge,
  statusMetaOf,
} from '@/lib/next/knowledge/knowledge-adapter'

/**
 * 知识库治理抽屉组（v3-ui-next-help-knowledge-domain W2 · tasks 2.5，
 * spec「知识库记录新建、编辑与生命周期受控治理」）。
 *
 * 导出三件套：
 * - KnowledgeCreateDrawer —— 受控新建抽屉（knowledge:author 入口在工作台层隐藏；
 *   本组件自带 Zod v4 前端即时校验，失焦/提交双校验，非法零外发；合法提交先弹
 *   二次确认模态（RL-06），确认后调用 POST /api/v1/knowledge 并刷新列表缓存）；
 * - KnowledgeReviewDrawer —— 审查治理抽屉：完整正文 / 层级元数据 / 来源溯源 /
 *   审核历史；跨租户或不存在 ID 的中性 404（「未找到相关知识记录」，RL-05 防探测）；
 *   knowledge:manage 才渲染「确认转正」（confirm 门，仅 pending）与「状态推进」
 *   （transition 白名单）按钮，且均需二次确认模态阻断；
 * - KnowledgeConfirmModal —— 通用二次确认模态（RL-06 阻断器），供两抽屉与底册
 *   行内快速操作复用。
 *
 * L3/L4 录入口径：后端 createKnowledgeSchema 只放行 L1/L2/L4（L3 由合成治理
 * Service 独占），表单层级选项与后端契约对齐，并给出不可手录 L3 的提示。
 */

// ── 可手录层级（与后端 createKnowledgeSchema 一致：L1/L2/L4；L3 合成独占） ──
export const MANUAL_CREATABLE_LAYERS: KnowledgeLayer[] = ['L1', 'L2', 'L4']

/** 统一错误信息提取（api-client 抛出的 ApiError 形如 {status,code,message}，非 Error 实例）。 */
export function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  return fallback
}

// ── 新建表单 Zod schema（v4，逐字段 message） ─────────────────────

const createFormSchema = z.object({
  layer: z.enum(['L1', 'L2', 'L4'] as const, { message: '请选择知识层级' }),
  title: z
    .string()
    .trim()
    .min(1, { message: '标题不能为空' })
    .max(500, { message: '标题最多 500 字符' }),
  domain: z
    .string()
    .trim()
    .min(1, { message: '所属领域不能为空' })
    .max(128, { message: '领域最多 128 字符' }),
  purpose: z.string().trim().max(128, { message: '用途最多 128 字符' }),
  complexity: z.string().trim().max(64, { message: '复杂度最多 64 字符' }),
  content: z.string().trim().max(20000, { message: '正文最多 20000 字符' }),
  sourceTitle: z.string().trim().max(500, { message: '来源标题最多 500 字符' }),
  sourceId: z.string().trim().max(255, { message: '来源 ID 最多 255 字符' }),
})

type CreateFormValues = z.infer<typeof createFormSchema>
type CreateFormErrorPath = keyof CreateFormValues

const EMPTY_FORM: CreateFormValues = {
  layer: 'L1',
  title: '',
  domain: '',
  purpose: '',
  complexity: '',
  content: '',
  sourceTitle: '',
  sourceId: '',
}

function collectFieldErrors(result: z.ZodSafeParseResult<CreateFormValues>) {
  if (result.success) return {}
  const map: Partial<Record<CreateFormErrorPath, string>> = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0] as CreateFormErrorPath | undefined
    if (field && !map[field]) map[field] = issue.message
  }
  return map
}

// ── 通用二次确认模态（RL-06） ─────────────────────────────────────

export interface KnowledgeConfirmModalProps {
  /** 注入面板 data-testid（区分场景）。 */
  testId: string
  title: string
  description: React.ReactNode
  confirmLabel: string
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

export function KnowledgeConfirmModal({
  testId,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onCancel,
  onConfirm,
}: KnowledgeConfirmModalProps) {
  return (
    <div data-knowledge-confirm-overlay className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="关闭确认弹窗"
        tabIndex={-1}
        onClick={pending ? undefined : onCancel}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center gap-2.5 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <ShieldAlert className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h3>
        </header>
        <div className="space-y-3 px-5 py-4">
          <div className="text-[13px] leading-relaxed text-[var(--nx-text-secondary)]">
            {description}
          </div>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            写操作将写入审核记录（ReviewRecord），确认后由后端策略再次校验组织归属与权限。
          </p>
          {error ? (
            <p
              role="alert"
              aria-label="知识写操作失败"
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <button
            type="button"
            data-knowledge-confirm-cancel
            onClick={onCancel}
            disabled={pending}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-knowledge-confirm-submit
            aria-label={confirmLabel}
            disabled={pending}
            onClick={onConfirm}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}

// ── 受控新建抽屉 ─────────────────────────────────────────────────

export interface KnowledgeCreateDrawerProps {
  open: boolean
  onClose: () => void
}

export function KnowledgeCreateDrawer({ open, onClose }: KnowledgeCreateDrawerProps) {
  const createMutation = useCreateKnowledge()
  const [form, setForm] = React.useState<CreateFormValues>(EMPTY_FORM)
  const [errors, setErrors] = React.useState<Partial<Record<CreateFormErrorPath, string>>>({})
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [touched, setTouched] = React.useState<Partial<Record<CreateFormErrorPath, boolean>>>({})

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM)
      setErrors({})
      setTouched({})
      setConfirmOpen(false)
      setSubmitError(null)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (confirmOpen && !createMutation.isPending) setConfirmOpen(false)
        else if (!createMutation.isPending) onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, confirmOpen, createMutation.isPending, onClose])

  if (!open) return null

  const update = <K extends keyof CreateFormValues>(field: K, value: CreateFormValues[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSubmitError(null)
  }

  const markTouched = (field: CreateFormErrorPath) => {
    setTouched((prev) => ({ ...prev, [field]: true }))
    const result = createFormSchema.safeParse(form)
    setErrors(collectFieldErrors(result))
  }

  /** 提交前全量校验：失败就地红字阻断，零网络外发。 */
  const validateForm = (): boolean => {
    const result = createFormSchema.safeParse(form)
    const nextErrors = collectFieldErrors(result)
    setErrors(nextErrors)
    setTouched({ title: true, layer: true, domain: true, purpose: true, complexity: true })
    if (!result.success) {
      setSubmitError('请修正标红的必填项后再提交。')
      return false
    }
    return true
  }

  const handleSubmitClick = () => {
    if (createMutation.isPending) return
    if (!validateForm()) return
    // 校验通过：先弹二次确认（RL-06），确认后才发起 POST
    setConfirmOpen(true)
  }

  const handleConfirmedCreate = () => {
    const title = form.title.trim()
    const domain = form.domain.trim()
    const purpose = form.purpose.trim() || '参考'
    const complexity = form.complexity.trim()
    const sourceTitle = form.sourceTitle.trim() || title
    const sourceId = form.sourceId.trim() || `manual-${Date.now()}`
    const layer = form.layer as 'L1' | 'L2' | 'L4'
    const body = {
      layer,
      title,
      content: form.content.trim() === '' ? { raw: '' } : form.content,
      domain,
      purpose,
      ...(complexity !== '' ? { complexity } : {}),
      provenance: {
        sources: [{ layer, sourceId, title: sourceTitle }],
      },
    }
    createMutation.mutate(body, {
      onSuccess: () => {
        setConfirmOpen(false)
        setSubmitError(null)
        onClose()
      },
      onError: (error) => {
        setSubmitError(resolveErrorMessage(error, '创建知识记录失败，请重试'))
      },
    })
  }

  const fieldClass =
    'h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'
  const errorFieldClass =
    'border-[var(--nx-status-danger)] focus:border-[var(--nx-status-danger)] focus:ring-[var(--nx-status-danger)]'
  const labelClass = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'
  const errorText = (field: CreateFormErrorPath) =>
    touched[field] && errors[field] ? (
      <p
        role="alert"
        data-knowledge-create-error={field}
        className="mt-1 text-[11px] text-[var(--nx-status-danger)]"
      >
        {errors[field]}
      </p>
    ) : null

  return (
    <div data-knowledge-create-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-knowledge-create-scrim
        aria-label="关闭新建知识"
        tabIndex={-1}
        onClick={() => {
          if (createMutation.isPending) return
          if (confirmOpen) setConfirmOpen(false)
          else onClose()
        }}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="新建知识"
        data-knowledge-create-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Plus className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">新建知识</h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                POST /api/v1/knowledge · 新记录以草稿落库，经人工确认转正后对外生效
              </p>
            </div>
          </div>
          <button
            type="button"
            data-knowledge-create-close
            aria-label="关闭新建知识"
            onClick={() => {
              if (createMutation.isPending) return
              if (confirmOpen) setConfirmOpen(false)
              else onClose()
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {submitError ? (
            <p
              role="alert"
              aria-label="新建知识校验或提交失败"
              data-knowledge-create-error-banner
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {submitError}
            </p>
          ) : null}

          <div>
            <label htmlFor="knowledge-create-layer" className={labelClass}>
              知识层级 <span className="text-[var(--nx-status-danger)]">*</span>
            </label>
            <select
              id="knowledge-create-layer"
              data-knowledge-create-layer
              value={form.layer}
              onChange={(event) => update('layer', event.target.value as CreateFormValues['layer'])}
              onBlur={() => markTouched('layer')}
              className={cn(fieldClass, touched.layer && errors.layer && errorFieldClass)}
            >
              {MANUAL_CREATABLE_LAYERS.map((layer) => (
                <option key={layer} value={layer}>
                  {KNOWLEDGE_LAYER_META[layer].fullName}（{KNOWLEDGE_LAYER_META[layer].shortName} ·{' '}
                  {KNOWLEDGE_LAYER_META[layer].description.split('·')[0]?.trim() ?? ''}）
                </option>
              ))}
            </select>
            {errorText('layer')}
            <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
              L3 合成由合成治理 Service 独占（仅供模型评测），不可手动创建。
            </p>
          </div>

          <div>
            <label htmlFor="knowledge-create-title" className={labelClass}>
              知识标题 <span className="text-[var(--nx-status-danger)]">*</span>
            </label>
            <input
              id="knowledge-create-title"
              data-knowledge-create-title
              type="text"
              value={form.title}
              maxLength={500}
              onChange={(event) => update('title', event.target.value)}
              onBlur={() => markTouched('title')}
              placeholder="例如：API 错误处理规范"
              className={cn(fieldClass, touched.title && errors.title && errorFieldClass)}
            />
            {errorText('title')}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="knowledge-create-domain" className={labelClass}>
                所属领域 <span className="text-[var(--nx-status-danger)]">*</span>
              </label>
              <input
                id="knowledge-create-domain"
                data-knowledge-create-domain
                type="text"
                value={form.domain}
                maxLength={128}
                onChange={(event) => update('domain', event.target.value)}
                onBlur={() => markTouched('domain')}
                placeholder="如：进度管理 / 接口架构"
                className={cn(fieldClass, touched.domain && errors.domain && errorFieldClass)}
              />
              {errorText('domain')}
            </div>
            <div>
              <label htmlFor="knowledge-create-purpose" className={labelClass}>
                用途（可选）
              </label>
              <input
                id="knowledge-create-purpose"
                data-knowledge-create-purpose
                type="text"
                value={form.purpose}
                maxLength={128}
                onChange={(event) => update('purpose', event.target.value)}
                onBlur={() => markTouched('purpose')}
                placeholder="缺省：参考"
                className={cn(fieldClass, touched.purpose && errors.purpose && errorFieldClass)}
              />
              {errorText('purpose')}
            </div>
          </div>

          <div>
            <label htmlFor="knowledge-create-complexity" className={labelClass}>
              复杂度（可选）
            </label>
            <input
              id="knowledge-create-complexity"
              data-knowledge-create-complexity
              type="text"
              value={form.complexity}
              maxLength={64}
              onChange={(event) => update('complexity', event.target.value)}
              onBlur={() => markTouched('complexity')}
              placeholder="如：初级 / 中级 / 高级"
              className={cn(fieldClass, touched.complexity && errors.complexity && errorFieldClass)}
            />
            {errorText('complexity')}
          </div>

          <div>
            <label htmlFor="knowledge-create-content" className={labelClass}>
              正文内容（Markdown）
            </label>
            <textarea
              id="knowledge-create-content"
              data-knowledge-create-content
              rows={8}
              value={form.content}
              maxLength={20000}
              onChange={(event) => update('content', event.target.value)}
              onBlur={() => markTouched('content')}
              placeholder={'# 规范要点\n\n- 用 Markdown 书写正文…'}
              className={cn(
                fieldClass,
                'h-auto resize-y py-1.5 font-mono text-[11px] leading-relaxed',
                touched.content && errors.content && errorFieldClass,
              )}
            />
            {errorText('content')}
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]">
              来源说明（SourceRef）
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <input
                  id="knowledge-create-source-title"
                  data-knowledge-create-source-title
                  type="text"
                  value={form.sourceTitle}
                  maxLength={500}
                  onChange={(event) => update('sourceTitle', event.target.value)}
                  onBlur={() => markTouched('sourceTitle')}
                  placeholder="来源标题（缺省=知识标题）"
                  className={cn(
                    fieldClass,
                    touched.sourceTitle && errors.sourceTitle && errorFieldClass,
                  )}
                />
                {errorText('sourceTitle')}
              </div>
              <div>
                <input
                  id="knowledge-create-source-id"
                  data-knowledge-create-source-id
                  type="text"
                  value={form.sourceId}
                  maxLength={255}
                  onChange={(event) => update('sourceId', event.target.value)}
                  onBlur={() => markTouched('sourceId')}
                  placeholder="来源 ID（缺省=manual-时间戳）"
                  className={cn(fieldClass, touched.sourceId && errors.sourceId && errorFieldClass)}
                />
                {errorText('sourceId')}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <button
            type="button"
            data-knowledge-create-cancel
            onClick={() => {
              if (createMutation.isPending) return
              if (confirmOpen) setConfirmOpen(false)
              else onClose()
            }}
            disabled={createMutation.isPending}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-knowledge-create-submit
            disabled={createMutation.isPending}
            onClick={handleSubmitClick}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
            )}
            保存草稿
          </button>
        </footer>
      </aside>

      {/* 二次确认（校验通过后） */}
      {confirmOpen ? (
        <KnowledgeConfirmModal
          testId="knowledge-create-confirm-modal"
          title="确认创建知识记录"
          description={
            <span>
              将创建 <span className="text-[var(--nx-text-primary)]">{form.title}</span>（
              {KNOWLEDGE_LAYER_META[form.layer as KnowledgeLayer]?.fullName ?? form.layer} · 领域：
              {form.domain}），记录以草稿（draft）状态落库，须经人工确认转正后方可对外检索引用。
            </span>
          }
          confirmLabel="确认创建"
          pending={createMutation.isPending}
          error={submitError}
          onCancel={() => {
            if (createMutation.isPending) return
            setConfirmOpen(false)
            setSubmitError(null)
          }}
          onConfirm={handleConfirmedCreate}
        />
      ) : null}
    </div>
  )
}

// ── 审查治理抽屉 ─────────────────────────────────────────────────

interface ReviewHistoryRow {
  action?: string
  reviewer?: number
  timestamp?: string
  note?: string
}

/**
 * 读取审核历史（只追加、不可删除）。
 *
 * 契约类型 KnowledgeItem.provenance.reviewHistory 是声明位置；后端 Service 的
 * confirm/transition 实际追加在模型顶层 review_history 列（共享类型未声明该列，
 * 运行时序列化以 camelCase 出参）。两处都读并以非空侧为准，保证新旧记录均可见。
 */
function readReviewHistory(item: KnowledgeItem): ReviewHistoryRow[] {
  const typed = item.provenance?.reviewHistory as ReviewHistoryRow[] | undefined
  const topLevel = (item as unknown as { reviewHistory?: unknown }).reviewHistory
  const fromTop = Array.isArray(topLevel) ? (topLevel as ReviewHistoryRow[]) : []
  return fromTop.length > 0 ? fromTop : (typed ?? [])
}

export interface KnowledgeReviewDrawerProps {
  knowledgeId: number | null
  open: boolean
  onClose: () => void
}

export function KnowledgeReviewDrawer({ knowledgeId, open, onClose }: KnowledgeReviewDrawerProps) {
  const { can } = usePermissions()
  const canManage = can('knowledge:manage')
  const { data, isLoading, isError, error, refetch } = useKnowledgeDetail(open ? knowledgeId : null)
  const confirmMutation = useConfirmKnowledge()
  const transitionMutation = useTransitionKnowledgeLifecycle()

  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [transitionOpen, setTransitionOpen] = React.useState<KnowledgeLifecycleStatus | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setConfirmOpen(false)
      setTransitionOpen(null)
      setActionError(null)
    }
  }, [open])

  if (!open) return null

  const item: KnowledgeItem | null | undefined = data?.data
  const isNotFound = Boolean(
    isError &&
    error &&
    ((error as unknown as ApiError)?.status === 404 ||
      (error as unknown as ApiError)?.code === 'RESOURCE_NOT_FOUND'),
  )
  const writePending = confirmMutation.isPending || transitionMutation.isPending

  const closeIfIdle = () => {
    if (writePending) return
    setConfirmOpen(false)
    setTransitionOpen(null)
    setActionError(null)
    onClose()
  }

  const layerMeta = item ? layerMetaOf(item.layer) : null
  const statusMeta = item ? statusMetaOf(item.status) : null
  const synthetic = item ? requiresSyntheticBadge(item) : false
  const targets = item ? nextKnowledgeStatuses(item.status) : []
  const showConfirm = Boolean(item && canManage && canConfirmPromotion(item.status))

  const renderReviewHistory = (item: KnowledgeItem) => {
    const history = readReviewHistory(item)
    if (history.length === 0) {
      return (
        <p className="text-[11px] text-[var(--nx-text-muted)]" data-knowledge-review-history-empty>
          暂无审核记录
        </p>
      )
    }
    return (
      <ul className="space-y-1.5">
        {history.map((record, index) => {
          const recordEntry: ReviewHistoryRow = record ?? {}
          return (
            <li
              key={`${recordEntry.timestamp ?? 'ts'}-${index}`}
              data-knowledge-review-history-row
              className="flex items-start justify-between gap-3 rounded-sm border border-[var(--nx-border-hairline)]/60 bg-[var(--nx-bg-0)] px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <p className="text-[11px] text-[var(--nx-text-primary)]">
                  {recordEntry.note ?? recordEntry.action ?? '审核动作'}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {recordEntry.action ?? ''}
                  {recordEntry.reviewer != null ? ` · reviewer #${recordEntry.reviewer}` : ''}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                {formatKnowledgeDate(recordEntry.timestamp)}
              </span>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div data-knowledge-review-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-knowledge-review-scrim
        aria-label="关闭审查抽屉"
        tabIndex={-1}
        onClick={closeIfIdle}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="知识审查与治理"
        data-knowledge-review-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <BadgeCheck className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                知识审查与治理
              </h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                GET /api/v1/knowledge/:id · 内容 / 来源溯源 / 审核历史
              </p>
            </div>
          </div>
          <button
            type="button"
            data-knowledge-review-close
            aria-label="关闭审查抽屉"
            onClick={closeIfIdle}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div
              data-knowledge-review-loading
              role="status"
              aria-busy="true"
              aria-label="正在加载知识详情"
              className="space-y-2"
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
              ))}
            </div>
          ) : isNotFound ? (
            <div
              data-knowledge-review-notfound
              className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
            >
              <ShieldAlert className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">未找到相关知识记录</p>
              <p className="text-[11px] text-[var(--nx-text-muted)]">
                记录不存在或已被移除（统一中性处理，不泄露组织间数据存在性）。
              </p>
            </div>
          ) : isError ? (
            <div
              data-knowledge-review-error
              className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
            >
              <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">知识详情加载失败</p>
              <p className="max-w-md text-[11px] text-[var(--nx-text-muted)]">
                {resolveErrorMessage(error, '详情加载失败')}
              </p>
              <button
                type="button"
                data-knowledge-review-retry
                onClick={() => void refetch()}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <Loader2 className="h-3.5 w-3.5" aria-hidden />
                重新加载
              </button>
            </div>
          ) : !item ? (
            <div
              data-knowledge-review-notfound
              className="py-10 text-center text-sm text-[var(--nx-text-secondary)]"
            >
              未找到相关知识记录
            </div>
          ) : (
            <div className="space-y-4">
              {actionError ? (
                <p
                  role="alert"
                  aria-label="知识治理操作失败"
                  data-knowledge-review-action-error
                  className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
                >
                  {actionError}
                </p>
              ) : null}

              {/* 徽标与标题 */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  data-knowledge-review-layer-badge
                  title={layerMeta?.description}
                  className={cn(
                    'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                    layerMeta?.chipClass,
                  )}
                >
                  {layerMeta?.fullName ?? item.layer}
                </span>
                {synthetic ? (
                  <span
                    data-knowledge-review-synthetic-badge
                    title={SYNTHETIC_TOOLTIP_TEXT}
                    className={cn(
                      'inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none',
                      SYNTHETIC_BADGE_CLASS,
                    )}
                  >
                    {SYNTHETIC_BADGE_TEXT}
                  </span>
                ) : null}
                <span
                  data-knowledge-review-status-badge
                  className={cn(
                    'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                    statusMeta?.chipClass,
                  )}
                >
                  {statusMeta?.label ?? item.status}
                </span>
              </div>
              <h4 className="text-base font-semibold leading-snug text-[var(--nx-text-primary)]">
                {item.title}
              </h4>

              {/* 治理操作（仅 knowledge:manage；RL-06 二次确认） */}
              <div
                data-knowledge-review-actions
                className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
              >
                {canManage ? (
                  <>
                    {showConfirm ? (
                      <button
                        type="button"
                        data-knowledge-review-confirm-open
                        disabled={writePending}
                        onClick={() => {
                          setActionError(null)
                          setConfirmOpen(true)
                        }}
                        className="flex h-8 items-center gap-1.5 rounded-md border border-[rgba(16,185,129,0.5)] bg-[rgba(16,185,129,0.12)] px-3 text-xs font-medium text-[var(--nx-status-success)] transition-colors hover:bg-[var(--nx-status-success)] hover:text-white disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        确认转正
                      </button>
                    ) : null}
                    {targets.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-[var(--nx-text-muted)]">状态推进：</span>
                        {targets.map((target) => (
                          <button
                            key={target}
                            type="button"
                            data-knowledge-review-transition-open={target}
                            disabled={writePending}
                            onClick={() => {
                              setActionError(null)
                              setTransitionOpen(target)
                            }}
                            className="h-8 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
                          >
                            推进至{KNOWLEDGE_STATUS_META[target].label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {!showConfirm && targets.length === 0 ? (
                      <span className="text-[11px] text-[var(--nx-text-muted)]">
                        当前状态无可用推进出口
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span
                    data-knowledge-review-readonly-note
                    className="text-[11px] text-[var(--nx-text-muted)]"
                  >
                    只读审查（需要 knowledge:manage 权限方可确认转正或变更状态）
                  </span>
                )}
              </div>

              {/* 元数据 */}
              <div
                data-knowledge-review-meta
                className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-sm border border-[var(--nx-border-hairline)]/60 bg-[var(--nx-bg-0)] px-3 py-2.5 text-[11px]"
              >
                <div>
                  <span className="text-[var(--nx-text-muted)]">领域：</span>
                  <span className="text-[var(--nx-text-secondary)]">{item.domain ?? '—'}</span>
                </div>
                <div>
                  <span className="text-[var(--nx-text-muted)]">用途：</span>
                  <span className="text-[var(--nx-text-secondary)]">{item.purpose ?? '—'}</span>
                </div>
                <div>
                  <span className="text-[var(--nx-text-muted)]">复杂度：</span>
                  <span className="text-[var(--nx-text-secondary)]">{item.complexity ?? '—'}</span>
                </div>
                <div>
                  <span className="text-[var(--nx-text-muted)]">创建：</span>
                  <span className="font-mono text-[var(--nx-text-secondary)]">
                    {formatKnowledgeDate(item.createdAt)}
                    {item.createdBy != null ? ` · #${item.createdBy}` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--nx-text-muted)]">更新：</span>
                  <span className="font-mono text-[var(--nx-text-secondary)]">
                    {formatKnowledgeDate(item.updatedAt)}
                  </span>
                </div>
                {item.retentionDays != null ? (
                  <div>
                    <span className="text-[var(--nx-text-muted)]">保留期：</span>
                    <span className="text-[var(--nx-text-secondary)]">{item.retentionDays} 天</span>
                  </div>
                ) : null}
              </div>

              {/* 正文内容 */}
              <section>
                <h5 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                  <FilePlus2 className="h-3 w-3" aria-hidden />
                  正文内容
                </h5>
                <pre
                  data-knowledge-review-content
                  className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[var(--nx-text-primary)]"
                >
                  {typeof item.content === 'string'
                    ? item.content
                    : JSON.stringify(item.content, null, 2)}
                </pre>
              </section>

              {/* 合成方法（L3 必填展示） */}
              {item.isSynthetic && item.syntheticMethod ? (
                <section>
                  <h5 className="mb-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    合成方法
                  </h5>
                  <p
                    data-knowledge-review-synthetic-method
                    className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 font-mono text-[11px] text-[var(--nx-chart-7)]"
                  >
                    {item.syntheticMethod}
                  </p>
                </section>
              ) : null}

              {/* 来源溯源 */}
              <section>
                <h5 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                  <Link2 className="h-3 w-3" aria-hidden />
                  来源溯源（SourceRef）
                </h5>
                {item.provenance?.sources && item.provenance.sources.length > 0 ? (
                  <ul className="space-y-1.5">
                    {item.provenance.sources.map((source, index) => (
                      <li
                        key={`${source.sourceId ?? 'src'}-${index}`}
                        data-knowledge-review-source-row
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm border border-[var(--nx-border-hairline)]/60 bg-[var(--nx-bg-0)] px-3 py-2 text-[11px]"
                      >
                        <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                          {source.layer ?? item.layer}
                        </span>
                        <span className="text-[var(--nx-text-secondary)]">{source.title}</span>
                        {source.sourceId ? (
                          <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                            ({source.sourceId})
                          </span>
                        ) : null}
                        {source.isSynthetic ? (
                          <span className="font-mono text-[10px] text-[var(--nx-chart-7)]">
                            {SYNTHETIC_BADGE_TEXT}
                          </span>
                        ) : null}
                        {source.section ? (
                          <span className="text-[10px] text-[var(--nx-text-muted)]">
                            章节：{source.section}
                          </span>
                        ) : null}
                        {source.url ? (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate font-mono text-[10px] text-[var(--nx-accent)] underline-offset-2 hover:underline"
                          >
                            {source.url}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-[var(--nx-text-muted)]">无来源记录</p>
                )}
              </section>

              {/* 审核历史 */}
              <section>
                <h5 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                  <History className="h-3 w-3" aria-hidden />
                  审核历史（ReviewRecord）
                </h5>
                {renderReviewHistory(item)}
              </section>
            </div>
          )}
        </div>

        {/* 底部二次确认模态（RL-06） */}
        {confirmOpen && item ? (
          <KnowledgeConfirmModal
            testId="knowledge-review-confirm-modal"
            title="确认转正知识记录"
            description={
              <span>
                「{item.title}」将从「待审」转入「活跃」并进入正常检索引用（唯一人工转正门），
                操作将写入审核记录。
              </span>
            }
            confirmLabel="确认转正"
            pending={confirmMutation.isPending}
            error={actionError}
            onCancel={() => {
              if (confirmMutation.isPending) return
              setConfirmOpen(false)
              setActionError(null)
            }}
            onConfirm={() =>
              confirmMutation.mutate(item.id, {
                onSuccess: () => {
                  setConfirmOpen(false)
                  setActionError(null)
                },
                onError: (error) => {
                  setActionError(resolveErrorMessage(error, '确认转正失败，请重试'))
                },
              })
            }
          />
        ) : null}
        {transitionOpen && item ? (
          <KnowledgeConfirmModal
            testId="knowledge-review-transition-modal"
            title="确认变更知识状态"
            description={
              <span>
                「{item.title}」将由「{statusMeta?.label ?? item.status}」推进至「
                {KNOWLEDGE_STATUS_META[transitionOpen].label}」，并写入审核记录。
              </span>
            }
            confirmLabel={`推进至${KNOWLEDGE_STATUS_META[transitionOpen].label}`}
            pending={transitionMutation.isPending}
            error={actionError}
            onCancel={() => {
              if (transitionMutation.isPending) return
              setTransitionOpen(null)
              setActionError(null)
            }}
            onConfirm={() =>
              transitionMutation.mutate(
                { id: item.id, status: transitionOpen },
                {
                  onSuccess: () => {
                    setTransitionOpen(null)
                    setActionError(null)
                  },
                  onError: (error) => {
                    setActionError(resolveErrorMessage(error, '状态推进失败，请重试'))
                  },
                },
              )
            }
          />
        ) : null}
      </aside>
    </div>
  )
}
