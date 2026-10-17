'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, UserPlus, X } from 'lucide-react'
import {
  resourceKeys,
  resourcesApi,
  type ResourceRole,
  type ResourceType,
} from '@/lib/api/resources'
import {
  RESOURCE_ROLE_OPTIONS,
  RESOURCE_TYPE_LABELS,
  resourceFormSchema,
  resourceRoleLabel,
  resourceTypeLabel,
  toCreateResourceInput,
} from '@/lib/next/resources/resource-workbench-adapter'

/**
 * 新建资源暗黑仪器感抽屉（v3-ui-next-resource-team-domains W1 · tasks 1.9，
 * spec「受控新建资源（Create Resource）」）。
 *
 * - Zod 表单校验契约（resourceFormSchema）：名称必填、类型必选、日额定工时
 *   0.5~24h、时区非空、单价非负、邮箱格式（可为空），非法输入即时展示微标并
 *   阻断提交（RL-06）；
 * - 提交调用 POST /projects/:projectId/resources（入口已在工作台容器按
 *   resource:manage 门禁，此处不再重复渲染级校验）；
 * - 成功后失效 ['resources','list',projectId] 前缀缓存并关闭抽屉；
 * - Esc / 遮罩 / 取消均可关闭。
 */

/** ApiError（非 Error 实例）与 Error 统一提取可读 message。 */
function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return fallback
}

const FIELD_BASE =
  'h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'
const LABEL_BASE = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'
const ERROR_BASE = 'mt-1 text-[10px] text-[var(--nx-status-danger)]'

export interface ResourceCreateDrawerProps {
  projectId: number
  open: boolean
  onClose: () => void
}

export function ResourceCreateDrawer({ projectId, open, onClose }: ResourceCreateDrawerProps) {
  const queryClient = useQueryClient()
  const [name, setName] = React.useState('')
  const [resourceType, setResourceType] = React.useState<ResourceType>('human')
  const [role, setRole] = React.useState<ResourceRole>('member')
  const [dailyCapacityHoursInput, setDailyCapacityHoursInput] = React.useState('8')
  const [timezone, setTimezone] = React.useState('Asia/Shanghai')
  const [costInput, setCostInput] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [skillTagText, setSkillTagText] = React.useState('')
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  // 打开即重置表单（与上次编辑内容隔离，防脏数据串场）。
  React.useEffect(() => {
    if (open) {
      setName('')
      setResourceType('human')
      setRole('member')
      setDailyCapacityHoursInput('8')
      setTimezone('Asia/Shanghai')
      setCostInput('')
      setEmail('')
      setSkillTagText('')
      setSubmitError(null)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const createMutation = useMutation({
    mutationFn: () => resourcesApi.create(projectId, toCreateResourceInput(parsed.data!)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceKeys.lists(projectId) })
      onClose()
    },
    onError: (error) => {
      setSubmitError(errorText(error, '新建资源失败，请重试'))
    },
  })

  if (!open) return null

  const parsed = resourceFormSchema.safeParse({
    name,
    resourceType,
    role,
    timezone,
    email,
    dailyCapacityHoursInput,
    costInput,
    skillTagText,
  })
  const issues = parsed.success ? [] : parsed.error.issues
  const issueOf = (path: string): string | null => {
    if (issues.length === 0) return null
    const hit = issues.find((issue) => issue.path.join('.') === path)
    return hit ? hit.message : null
  }
  const canSubmit = parsed.success && !createMutation.isPending

  return (
    <div data-resource-create-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-resource-create-scrim
        aria-label="关闭新建资源抽屉"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="新建资源"
        data-resource-create-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <UserPlus className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">新建资源</h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                POST /projects/{projectId}/resources
              </p>
            </div>
          </div>
          <button
            type="button"
            data-resource-create-close
            aria-label="关闭新建资源抽屉"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {submitError ? (
            <p
              role="alert"
              aria-label="新建资源失败"
              data-resource-create-error
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {submitError}
            </p>
          ) : null}

          <div>
            <label htmlFor="resource-create-name" className={LABEL_BASE}>
              资源名称 <span className="text-[var(--nx-status-danger)]">*</span>
            </label>
            <input
              id="resource-create-name"
              data-resource-create-name
              type="text"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：张工 / 双路 GPU 服务器 / 差旅预算"
              className={FIELD_BASE}
            />
            {issueOf('name') ? (
              <p data-resource-create-name-error className={ERROR_BASE}>
                {issueOf('name')}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="resource-create-type" className={LABEL_BASE}>
                资源类型 <span className="text-[var(--nx-status-danger)]">*</span>
              </label>
              <select
                id="resource-create-type"
                data-resource-create-type
                value={resourceType}
                onChange={(event) => setResourceType(event.target.value as ResourceType)}
                className={FIELD_BASE}
              >
                {Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="resource-create-role" className={LABEL_BASE}>
                项目角色
              </label>
              <select
                id="resource-create-role"
                data-resource-create-role
                value={role}
                onChange={(event) => setRole(event.target.value as ResourceRole)}
                className={FIELD_BASE}
              >
                {RESOURCE_ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {resourceRoleLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="resource-create-capacity" className={LABEL_BASE}>
                日额定工时（h）
              </label>
              <input
                id="resource-create-capacity"
                data-resource-create-capacity
                type="number"
                min={0.5}
                max={24}
                step={0.5}
                value={dailyCapacityHoursInput}
                onChange={(event) => setDailyCapacityHoursInput(event.target.value)}
                className={FIELD_BASE}
              />
              {issueOf('dailyCapacityHoursInput') ? (
                <p data-resource-create-capacity-error className={ERROR_BASE}>
                  {issueOf('dailyCapacityHoursInput')}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="resource-create-timezone" className={LABEL_BASE}>
                时区
              </label>
              <input
                id="resource-create-timezone"
                data-resource-create-timezone
                type="text"
                value={timezone}
                maxLength={64}
                onChange={(event) => setTimezone(event.target.value)}
                className={FIELD_BASE}
              />
              {issueOf('timezone') ? (
                <p data-resource-create-timezone-error className={ERROR_BASE}>
                  {issueOf('timezone')}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="resource-create-cost" className={LABEL_BASE}>
                成本单价（元/小时，可选）
              </label>
              <input
                id="resource-create-cost"
                data-resource-create-cost
                type="number"
                min={0}
                step={0.01}
                value={costInput}
                onChange={(event) => setCostInput(event.target.value)}
                placeholder="如 150"
                className={FIELD_BASE}
              />
              {issueOf('costInput') ? (
                <p data-resource-create-cost-error className={ERROR_BASE}>
                  {issueOf('costInput')}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="resource-create-email" className={LABEL_BASE}>
                邮箱（人员资源，可选）
              </label>
              <input
                id="resource-create-email"
                data-resource-create-email
                type="email"
                value={email}
                maxLength={200}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="zhang@example.com"
                className={FIELD_BASE}
              />
              {issueOf('email') ? (
                <p data-resource-create-email-error className={ERROR_BASE}>
                  {issueOf('email')}
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <label htmlFor="resource-create-skill-tags" className={LABEL_BASE}>
              技能标签（逗号分隔，可选）
            </label>
            <input
              id="resource-create-skill-tags"
              data-resource-create-skill-tags
              type="text"
              value={skillTagText}
              maxLength={500}
              onChange={(event) => setSkillTagText(event.target.value)}
              placeholder="例如：React, TypeScript, 性能优化"
              className={FIELD_BASE}
            />
            {issueOf('skillTagText') ? (
              <p className={ERROR_BASE}>{issueOf('skillTagText')}</p>
            ) : null}
          </div>

          <p className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
            类型预览：
            {resourceTypeLabel(resourceType)} · {resourceRoleLabel(role)} ·{' '}
            {dailyCapacityHoursInput || '—'}h/天 · 单价{' '}
            {costInput === '' ? '—' : `¥${Number(costInput).toFixed(2)}`}
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <button
            type="button"
            data-resource-create-cancel
            onClick={onClose}
            disabled={createMutation.isPending}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-resource-create-submit
            aria-label="保存新资源"
            disabled={!canSubmit}
            onClick={() => {
              if (parsed.success) createMutation.mutate()
            }}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden />
            )}
            保存资源
          </button>
        </footer>
      </aside>
    </div>
  )
}

export default ResourceCreateDrawer
