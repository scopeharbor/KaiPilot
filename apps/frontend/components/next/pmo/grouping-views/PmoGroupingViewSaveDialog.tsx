'use client'

import * as React from 'react'
import { AlertCircle, Save, X } from 'lucide-react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { useGroupingViewCreate, useGroupingViewUpdate } from '@/hooks/use-portfolio-grouping-views'
import { cn } from '@/lib/utils'
import type {
  PmoGroupingViewCreateRequest,
  PmoGroupingViewDefinition,
  PmoGroupingViewQueryDefinition,
  PmoGroupingViewScope,
} from '@aiproj/types'
import {
  PMO_GROUPING_VIEW_SCOPES,
  PMO_GROUPING_VIEW_MAX_NAME_LENGTH,
  PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH,
} from '@aiproj/types'

/**
 * 分组视图保存对话框（v3-ui-next-pmo-domain W3 · tasks 3.2）。
 *
 * - 双模式：create（保存当前预览配置，query 预填）/ edit（编辑既有个人视图，
 *   服务端 Update 契约仅收 name/description/query，scope 冻结展示）；
 * - 名称与 scope 必填校验（scope 选项白名单 personal/organization，组织共享选项
 *   以 canManageShared 门禁）；描述可选但受 400 长度上限约束；
 * - 成功提交后关闭（列表由 hook 失效 `['pmo','grouping-views']` 自动刷新）；
 *   失败保留输入并回显服务端错误（Design D4），不做乐观静默。
 */

export type PmoGroupingViewSaveDialogState =
  | { kind: 'create'; initialQuery: PmoGroupingViewQueryDefinition }
  | { kind: 'edit'; view: PmoGroupingViewDefinition }

export interface PmoGroupingViewSaveDialogProps {
  state: PmoGroupingViewSaveDialogState | null
  canManageShared: boolean
  onClose: () => void
}

const DIM_LABELS: Record<string, string> = {
  status: '状态',
  health: '健康度',
  traffic_light: '交通灯',
  manager: '负责人',
  project_type: '项目类型',
  lifecycle_phase: '生命周期',
  department: '部门',
  source_freshness: '数据新鲜度',
}

const SORT_LABELS: Record<string, string> = {
  group_name: '分组名',
  project_count: '项目数',
  progress_avg: '平均进度',
  health_status: '健康状态',
  traffic_light: '交通灯',
  updated_at: '更新时间',
}

export function PmoGroupingViewSaveDialog({
  state,
  canManageShared,
  onClose,
}: PmoGroupingViewSaveDialogProps) {
  const createMutation = useGroupingViewCreate()
  const updateMutation = useGroupingViewUpdate()

  const isEdit = state?.kind === 'edit'

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [scope, setScope] = React.useState<PmoGroupingViewScope>(PMO_GROUPING_VIEW_SCOPES.PERSONAL)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [descriptionError, setDescriptionError] = React.useState<string | null>(null)

  // 每次打开/切换目标时重置表单（编辑预填既有元数据；新建从空开始）。
  React.useEffect(() => {
    if (!state) return
    if (state.kind === 'edit') {
      setName(state.view.name)
      setDescription(state.view.description ?? '')
      setScope(state.view.scope)
    } else {
      setName('')
      setDescription('')
      setScope(PMO_GROUPING_VIEW_SCOPES.PERSONAL)
    }
    setNameError(null)
    setDescriptionError(null)
    createMutation.reset()
    updateMutation.reset()
  }, [state])

  const dialogRef = React.useRef<HTMLDivElement | null>(null)

  // 保存 / 更新在途期间与取消按钮 disabled={pending} 同判据（此处早于下方 pending 定义，故直接展开表达式）。
  useDialogA11y({
    ref: dialogRef,
    open: state !== null,
    onClose,
    canClose: () => !(createMutation.isPending || updateMutation.isPending),
  })

  if (!state) return null

  const query = isEdit ? state.view.query : state.initialQuery
  const pending = createMutation.isPending || updateMutation.isPending
  const submitError = createMutation.error ?? updateMutation.error

  const handleSubmit = () => {
    let valid = true
    if (!name.trim()) {
      setNameError('请输入视图名称')
      valid = false
    } else if (name.trim().length > PMO_GROUPING_VIEW_MAX_NAME_LENGTH) {
      setNameError(`视图名称不能超过 ${PMO_GROUPING_VIEW_MAX_NAME_LENGTH} 个字符`)
      valid = false
    } else {
      setNameError(null)
    }
    const trimmedDescription = description.trim()
    if (trimmedDescription.length > PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH) {
      setDescriptionError(`描述不能超过 ${PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH} 个字符`)
      valid = false
    } else {
      setDescriptionError(null)
    }
    if (!valid) return

    if (isEdit) {
      updateMutation.mutate(
        {
          id: state.view.id,
          body: {
            name: name.trim(),
            description: trimmedDescription || undefined,
          },
        },
        { onSuccess: () => onClose() },
      )
      return
    }

    const body: PmoGroupingViewCreateRequest = {
      name: name.trim(),
      description: trimmedDescription || undefined,
      scope,
      query: state.initialQuery,
    }
    createMutation.mutate(body, { onSuccess: () => onClose() })
  }

  return (
    <div
      data-gv-save-dialog
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-label={isEdit ? '编辑分组视图' : '保存分组视图'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-4 py-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
              {isEdit ? '编辑分组视图' : '保存为分组视图'}
            </h3>
            <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">
              {isEdit
                ? '修改名称与描述；查询配置请回到预览工作台调整。'
                : '将当前分组配置保存为可复用视图。'}
            </p>
          </div>
          <button
            type="button"
            data-gv-save-cancel
            aria-label="关闭对话框"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3.5">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="gv-save-name"
              className="text-[11px] font-medium text-[var(--nx-text-secondary)]"
            >
              视图名称 <span className="text-[var(--nx-status-danger)]">*</span>
            </label>
            <input
              id="gv-save-name"
              data-gv-save-name
              value={name}
              maxLength={PMO_GROUPING_VIEW_MAX_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：按部门巡检"
              className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-primary)] outline-none transition-colors placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)]"
            />
            {nameError ? (
              <p
                data-gv-save-name-error
                role="alert"
                className="text-[10px] text-[var(--nx-status-danger)]"
              >
                {nameError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="gv-save-desc"
              className="text-[11px] font-medium text-[var(--nx-text-secondary)]"
            >
              描述
            </label>
            <textarea
              id="gv-save-desc"
              data-gv-save-desc
              value={description}
              maxLength={PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="简要描述此视图的用途（可选）"
              rows={2}
              className="resize-none rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-xs text-[var(--nx-text-primary)] outline-none transition-colors placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)]"
            />
            {descriptionError ? (
              <p
                data-gv-save-desc-error
                role="alert"
                className="text-[10px] text-[var(--nx-status-danger)]"
              >
                {descriptionError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--nx-text-secondary)]">
              可见范围 <span className="text-[var(--nx-status-danger)]">*</span>
            </span>
            {isEdit ? (
              <p data-gv-save-scope-static className="px-0.5 text-xs text-[var(--nx-text-primary)]">
                {scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION ? '组织共享' : '仅自己可见'}
              </p>
            ) : (
              <>
                <select
                  data-gv-save-scope
                  value={scope}
                  onChange={(event) => setScope(event.target.value as PmoGroupingViewScope)}
                  aria-label="可见范围"
                  className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] outline-none transition-colors focus:border-[var(--nx-border-focus)]"
                >
                  <option value={PMO_GROUPING_VIEW_SCOPES.PERSONAL}>仅自己可见</option>
                  <option value={PMO_GROUPING_VIEW_SCOPES.ORGANIZATION} disabled={!canManageShared}>
                    组织内共享
                  </option>
                </select>
                {!canManageShared ? (
                  <p className="text-[10px] text-[var(--nx-text-muted)]">
                    组织共享视图需要 portfolio:manage 权限。
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="flex flex-col gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
              分组配置摘要
            </span>
            <p data-gv-save-query-summary className="text-[11px] text-[var(--nx-text-secondary)]">
              维度：{DIM_LABELS[query.primaryGrouping] ?? query.primaryGrouping} · 排序：
              {SORT_LABELS[query.sort ?? 'project_count'] ?? query.sort ?? 'project_count'} ·
              {query.order === 'asc' ? '升序' : '降序'}
            </p>
          </div>

          {submitError ? (
            <div
              data-gv-save-error
              role="alert"
              className="flex items-start gap-1.5 rounded-md border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)] px-2.5 py-2 text-[11px] text-[var(--nx-status-danger)]"
            >
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>
                {submitError instanceof Error ? submitError.message : '保存失败，请稍后重试'}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-4 py-3">
          <button
            type="button"
            data-gv-save-cancel-bottom
            onClick={onClose}
            disabled={pending}
            className="flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-gv-save-submit
            onClick={handleSubmit}
            disabled={pending}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md border px-3.5 text-xs font-medium transition-colors disabled:opacity-50',
              'border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] text-[var(--nx-accent)] hover:border-[var(--nx-accent)]',
            )}
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {pending ? '保存中…' : isEdit ? '保存修改' : '保存视图'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PmoGroupingViewSaveDialog
