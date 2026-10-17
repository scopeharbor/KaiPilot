'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Loader2,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'
import {
  projectsApi,
  projectKeys,
  type CreateProjectInput,
  type Project,
  type ProjectPriority,
  type ProjectStatus,
} from '@/lib/api/projects'
import {
  buildProjectCreateInput,
  inferProjectPlacementDraft,
  projectFormSchema,
  type ProjectFormData,
  type ProjectPlacementDraft,
} from '@/lib/next/project-placement-rule'
import { useAuthStore } from '@/stores/auth-store'

export interface ProjectManualPlacementModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (project: Project) => void
  initialInput?: string
}

export interface ProjectPlacementCardProps {
  onSuccess?: (project: Project) => void
  onCancel?: () => void
  initialInput?: string
}

/**
 * 放置立项卡片（可嵌入剧场首屏或模态弹窗）
 */
export function ProjectPlacementCard({
  onSuccess,
  onCancel,
  initialInput = '',
}: ProjectPlacementCardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canCreate = hasPermission('project:create')

  const [input, setInput] = React.useState(initialInput)
  const [submitting, setSubmitting] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [fullMode, setFullMode] = React.useState(false)

  // 本地确定性规则推断草案
  const draft = React.useMemo<ProjectPlacementDraft | null>(() => {
    return inferProjectPlacementDraft(input)
  }, [input])

  // 全量字段表单数据
  const [formData, setFormData] = React.useState<Partial<ProjectFormData>>({
    name: '',
    code: '',
    description: '',
    priority: 'medium',
    status: 'planning',
    startDate: '',
    endDate: '',
  })
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({})

  // 当草案推断出内容且切换全量模式时预填表单
  React.useEffect(() => {
    if (draft) {
      setFormData((prev) => ({
        ...prev,
        name: prev.name || draft.name,
        code: prev.code || draft.code,
        priority: draft.priority,
        status: draft.status,
        startDate: prev.startDate || draft.startDate,
        endDate: prev.endDate || draft.endDate || '',
      }))
    }
  }, [draft])

  // 提交创建（放置立项快速模式）
  const handleConfirmPlacement = async () => {
    if (!canCreate) {
      setErrorMessage('未授权操作：缺少 project:create 权限')
      return
    }
    if (!draft) return

    setSubmitting(true)
    setErrorMessage(null)

    try {
      const payload = buildProjectCreateInput(draft)
      const newProject = await projectsApi.create(payload)

      // 集中让项目列表缓存失效（design D2 / D7）
      await queryClient.invalidateQueries({ queryKey: projectKeys.all })

      if (onSuccess) {
        onSuccess(newProject)
      } else {
        router.push(`/next/projects/${newProject.id}`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建项目失败，请稍后重试'
      setErrorMessage(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // 提交创建（全量表单模式）
  const handleConfirmFullForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canCreate) {
      setErrorMessage('未授权操作：缺少 project:create 权限')
      return
    }

    const validation = projectFormSchema.safeParse(formData)
    if (!validation.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of validation.error.issues) {
        if (issue.path[0]) {
          fieldErrors[issue.path[0] as string] = issue.message
        }
      }
      setFormErrors(fieldErrors)
      return
    }

    setSubmitting(true)
    setErrorMessage(null)

    try {
      const validData = validation.data
      const payload: CreateProjectInput = {
        name: validData.name,
        code: validData.code,
        priority: validData.priority as ProjectPriority,
        status: validData.status as ProjectStatus,
        description: validData.description || null,
        startDate: validData.startDate || undefined,
        endDate: validData.endDate || undefined,
      }
      const newProject = await projectsApi.create(payload)

      await queryClient.invalidateQueries({ queryKey: projectKeys.all })

      if (onSuccess) {
        onSuccess(newProject)
      } else {
        router.push(`/next/projects/${newProject.id}`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建项目失败，请检查表单输入'
      setErrorMessage(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      if (fullMode) {
        void handleConfirmFullForm(e)
      } else {
        void handleConfirmPlacement()
      }
    }
  }

  return (
    <div
      data-testid="project-manual-placement-card"
      data-project-manual-placement=""
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 text-[var(--nx-text-primary)] shadow-md"
    >
      {/* 权限未通过警示 */}
      {!canCreate && (
        <div
          data-testid="placement-permission-blocked"
          className="flex items-center gap-2 rounded-md border border-[var(--nx-status-danger)]/30 bg-[var(--nx-status-danger)]/10 p-3 text-xs text-[var(--nx-status-danger)]"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>您当前暂未获得 project:create 权限，仅可查阅立项规则，无法提交落库。</span>
        </div>
      )}

      {/* 错误提示 */}
      {errorMessage && (
        <div
          data-testid="placement-error-banner"
          className="flex items-center gap-2 rounded-md border border-[var(--nx-status-danger)]/30 bg-[var(--nx-status-danger)]/10 p-2.5 text-xs text-[var(--nx-status-danger)]"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {!fullMode ? (
        // ── 模式 A：一句话放置立项 ──
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--nx-accent)]" />
              <h3 className="text-sm font-medium">一句话放置立项</h3>
            </div>
            <button
              type="button"
              data-testid="btn-toggle-full-form"
              onClick={() => setFullMode(true)}
              className="flex items-center gap-1 text-xs text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
            >
              <span>全量字段模式</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="relative">
            <input
              type="text"
              data-testid="placement-input"
              aria-label="一句话立项输入"
              placeholder="例如：海外电商支付网关改造，高优先级，10月30日上线"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={submitting}
              className="h-10 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
            />
          </div>

          {/* 待确认推断预览态 */}
          {draft && (
            <div
              data-testid="placement-draft-preview"
              className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--nx-text-primary)]" data-placement-name>
                    {draft.name}
                  </span>
                  <span
                    data-placement-code
                    className="rounded bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
                  >
                    {draft.code}
                  </span>
                </div>

                {/* 琥珀色待确认微标 */}
                <span
                  data-testid="placement-marker"
                  data-placement-marker
                  data-confidence={draft.marker.confidence}
                  title={draft.marker.reason}
                  className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-status-warning)]/50 bg-[var(--nx-status-warning)]/10 px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-status-warning)]"
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  <span>待确认推断 ({draft.marker.confidence})</span>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--nx-text-secondary)]">
                <span data-placement-priority>
                  优先级：
                  <span
                    className={`font-medium ${
                      draft.priority === 'critical'
                        ? 'text-[var(--nx-status-danger)]'
                        : draft.priority === 'high'
                          ? 'text-[var(--nx-status-warning)]'
                          : 'text-[var(--nx-status-info)]'
                    }`}
                  >
                    {draft.priority === 'critical'
                      ? '紧急'
                      : draft.priority === 'high'
                        ? '高'
                        : draft.priority === 'low'
                          ? '低'
                          : '中'}
                  </span>
                </span>

                <span data-placement-dates className="flex items-center gap-1 font-mono">
                  <Calendar className="h-3 w-3 text-[var(--nx-text-muted)]" />
                  <span>起 {draft.startDate}</span>
                  {draft.endDate && <span data-placement-end-date>至 {draft.endDate}</span>}
                </span>
              </div>
            </div>
          )}

          {/* 底部按钮栏 */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-[var(--nx-text-muted)]">
              <kbd className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1 font-mono text-[10px]">
                Ctrl+Enter
              </kbd>{' '}
              人工确认立项（零自动落库）
            </span>

            <div className="flex items-center gap-2">
              {onCancel && (
                <button
                  type="button"
                  data-testid="btn-cancel-placement"
                  onClick={onCancel}
                  className="h-8 rounded-md px-3 text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
                >
                  取消
                </button>
              )}
              <button
                type="button"
                data-testid="btn-confirm-placement"
                disabled={!canCreate || !draft || submitting}
                onClick={handleConfirmPlacement}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)]/10 px-4 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-accent)]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                <span>确认立项</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        // ── 模式 B：极简全量字段录入抽屉/面板 ──
        <form onSubmit={handleConfirmFullForm} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">极简项目全量录入</h3>
            <button
              type="button"
              data-testid="btn-back-to-quick"
              onClick={() => setFullMode(false)}
              className="flex items-center gap-1 text-xs text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
            >
              <span>收起为一句话放置</span>
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">
                项目名称 <span className="text-[var(--nx-status-danger)]">*</span>
              </label>
              <input
                type="text"
                data-testid="full-input-name"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              />
              {formErrors.name && (
                <p className="mt-0.5 text-[10px] text-[var(--nx-status-danger)]">
                  {formErrors.name}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">
                标识代码 <span className="text-[var(--nx-status-danger)]">*</span>
              </label>
              <input
                type="text"
                data-testid="full-input-code"
                value={formData.code || ''}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 font-mono text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              />
              {formErrors.code && (
                <p className="mt-0.5 text-[10px] text-[var(--nx-status-danger)]">
                  {formErrors.code}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">项目描述</label>
              <textarea
                rows={2}
                data-testid="full-input-description"
                value={formData.description || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">优先级</label>
              <select
                data-testid="full-select-priority"
                value={formData.priority || 'medium'}
                onChange={(e) =>
                  setFormData({ ...formData, priority: e.target.value as ProjectPriority })
                }
                className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="critical">紧急</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">
                计划截止日期
              </label>
              <input
                type="date"
                data-testid="full-input-end-date"
                value={formData.endDate || ''}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--nx-border-hairline)]">
            <button
              type="button"
              onClick={() => setFullMode(false)}
              className="h-8 rounded-md px-3 text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
            >
              返回快速模式
            </button>
            <button
              type="submit"
              data-testid="btn-submit-full-form"
              disabled={!canCreate || submitting}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)]/10 px-4 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-accent)]/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CornerDownLeft className="h-3.5 w-3.5" />
              )}
              <span>提交创建</span>
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * 放置立项与手动极简模式模态弹窗（ProjectManualPlacementModal）
 */
export function ProjectManualPlacementModal({
  open,
  onOpenChange,
  onSuccess,
  initialInput = '',
}: ProjectManualPlacementModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-testid="placement-modal-scrim"
          className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/60 backdrop-blur-md"
        />
        <DialogPrimitive.Content
          aria-label="放置立项与手动模式"
          aria-modal="true"
          data-project-placement-modal=""
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 outline-none"
        >
          <div data-next-track className="w-full max-w-xl">
            <div className="relative">
              <DialogPrimitive.Close
                aria-label="关闭放置立项"
                className="absolute right-3 top-3 z-10 rounded p-1 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] focus:outline-none"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
              <ProjectPlacementCard
                initialInput={initialInput}
                onSuccess={(proj) => {
                  onOpenChange(false)
                  onSuccess?.(proj)
                }}
                onCancel={() => onOpenChange(false)}
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export default ProjectManualPlacementModal
