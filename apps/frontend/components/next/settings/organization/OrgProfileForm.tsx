'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Lock, Save } from 'lucide-react'
import { z } from 'zod'
import { organizationsApi, type Organization } from '@/lib/api-client'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'

/**
 * 组织资料表单（v3-ui-next-settings-admin-domains W2 · tasks 2.1，
 * spec「组织设置与成员治理」段 1）。
 *
 * - 字段契约与后端 `updateOrganizationValidator`（apps/backend/app/validators/organization.ts）
 *   逐项对齐：名称 2-255、slug 2-120 且 `^[a-z0-9]+(?:-[a-z0-9]+)*$`、简介 ≤2000；
 *   前端 Zod 校验只做即时反馈，服务端校验仍是唯一事实（RL-11 无绕过捷径）；
 * - 写门 `org:manage`（展示层）：无该权限时**物理隐藏**表单，改渲染只读定义列表，
 *   与旧轨 `PermissionGuard(org:manage)` 的降级语义等价（RL-06）；
 * - 脏检查：表单值与初始值一致时保存按钮禁用（确认矩阵「更新组织资料 → 保存前
 *   脏检查提示」），保存成功后回写表单基线并失效组织查询缓存（详情 + 列表前缀）；
 * - 失败按 `ApiError.message` 原文回显，绝不静默吞咽。
 */

/** 组织资料表单校验契约（与后端 updateOrganizationValidator 同源口径）。 */
export const orgProfileSchema = z.object({
  name: z.string().trim().min(2, '组织名称至少需要 2 个字符').max(255, '组织名称最多 255 个字符'),
  slug: z
    .string()
    .trim()
    .min(2, '组织标识至少需要 2 个字符')
    .max(120, '组织标识最多 120 个字符')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '组织标识只能使用小写字母、数字和短横线'),
  description: z.string().trim().max(2000, '组织简介不能超过 2000 个字符'),
})

export type OrgProfileValues = z.infer<typeof orgProfileSchema>

export function orgProfileKey(organizationId: number): readonly unknown[] {
  return ['organizations', organizationId]
}

/** 组织详情查询键（列表前缀，用于统一失效）。 */
export const ORGANIZATIONS_QUERY_ROOT = ['organizations'] as const

/** 服务端错误原文提取（api-client 抛出的 ApiError 形如 { status, code, message }）。 */
export function orgApiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  return fallback
}

export function toProfileValues(organization: Organization): OrgProfileValues {
  return {
    name: organization.name,
    slug: organization.slug,
    description: organization.description ?? '',
  }
}

export interface OrgProfileFormProps {
  organization: Organization
  /** slug 是组织唯一标识，只读态仍需展示（无 org:manage 用户）。 */
  className?: string
}

export function OrgProfileForm({ organization, className }: OrgProfileFormProps) {
  const { can } = usePermissions()
  const canManage = can('org:manage')
  const queryClient = useQueryClient()

  const [values, setValues] = React.useState<OrgProfileValues>(() => toProfileValues(organization))
  const [baseline, setBaseline] = React.useState<OrgProfileValues>(() =>
    toProfileValues(organization),
  )
  const [errors, setErrors] = React.useState<Partial<Record<keyof OrgProfileValues, string>>>({})
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [savedNotice, setSavedNotice] = React.useState(false)

  // 组织数据刷新（切换组织 / 失效重取）后同步基线，避免用户看到陈旧草稿。
  React.useEffect(() => {
    const next = toProfileValues(organization)
    setValues(next)
    setBaseline(next)
    setErrors({})
    setServerError(null)
    setSavedNotice(false)
  }, [organization])

  const update = useMutation({
    mutationFn: (input: OrgProfileValues) =>
      organizationsApi.update(organization.id, {
        name: input.name,
        slug: input.slug,
        description: input.description || null,
      }),
    onSuccess: (updated) => {
      const next = toProfileValues(updated)
      setValues(next)
      setBaseline(next)
      setErrors({})
      setSavedNotice(true)
      queryClient.setQueryData(orgProfileKey(updated.id), updated)
      void queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_QUERY_ROOT })
    },
    onError: (error) => {
      setSavedNotice(false)
      setServerError(orgApiErrorMessage(error, '保存组织资料失败，请稍后重试'))
    },
  })

  const dirty =
    values.name !== baseline.name ||
    values.slug !== baseline.slug ||
    values.description !== baseline.description

  const validateField = (field: keyof OrgProfileValues, next: OrgProfileValues) => {
    const result = orgProfileSchema.safeParse(next)
    const message = result.success
      ? undefined
      : result.error.issues.find((issue) => issue.path[0] === field)?.message
    setErrors((current) => ({ ...current, [field]: message }))
  }

  const handleChange = (field: keyof OrgProfileValues, raw: string) => {
    const next = { ...values, [field]: raw }
    setValues(next)
    setServerError(null)
    setSavedNotice(false)
    validateField(field, next)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setServerError(null)
    const parsed = orgProfileSchema.safeParse(values)
    if (!parsed.success) {
      const nextErrors: Partial<Record<keyof OrgProfileValues, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof OrgProfileValues | undefined
        if (field && !nextErrors[field]) nextErrors[field] = issue.message
      }
      setErrors(nextErrors)
      return
    }
    if (!dirty || update.isPending) return
    update.mutate(parsed.data)
  }

  if (!canManage) {
    return (
      <section
        data-org-profile
        data-org-profile-readonly
        className={cn(
          'rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4',
          className,
        )}
      >
        <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">组织信息</h2>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
          <Lock className="h-3 w-3" aria-hidden />
          你没有编辑组织资料的权限（需要 org:manage），以下为只读信息。
        </p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
              组织名称
            </dt>
            <dd data-org-profile-name className="mt-0.5 text-[var(--nx-text-primary)]">
              {organization.name}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
              组织标识
            </dt>
            <dd data-org-profile-slug className="mt-0.5 font-mono text-[var(--nx-text-primary)]">
              {organization.slug}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
              组织简介
            </dt>
            <dd data-org-profile-description className="mt-0.5 text-[var(--nx-text-primary)]">
              {organization.description || '尚未填写组织简介'}
            </dd>
          </div>
        </dl>
      </section>
    )
  }

  const fieldClass =
    'h-9 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-primary)] transition-colors focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50'
  const errorFieldClass =
    'border-[var(--nx-status-danger)] focus:border-[var(--nx-status-danger)] focus:ring-[var(--nx-status-danger)]'
  const labelClass = 'mb-1.5 block text-[11px] font-medium text-[var(--nx-text-secondary)]'

  return (
    <section
      data-org-profile
      className={cn(
        'rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4',
        className,
      )}
    >
      <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">组织信息</h2>
      <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
        名称与简介会展示给组织内成员；组织标识（slug）是对外唯一标识，改动会影响既有链接。
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="org-profile-name" className={labelClass}>
            组织名称 <span className="text-[var(--nx-status-danger)]">*</span>
          </label>
          <input
            id="org-profile-name"
            data-org-profile-name-input
            value={values.name}
            maxLength={255}
            disabled={update.isPending}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => handleChange('name', event.target.value)}
            onBlur={() => validateField('name', values)}
            className={cn(fieldClass, errors.name && errorFieldClass)}
          />
          {errors.name ? (
            <p
              data-org-profile-name-error
              role="alert"
              className="mt-1 text-[11px] text-[var(--nx-status-danger)]"
            >
              {errors.name}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="org-profile-slug" className={labelClass}>
            组织标识 <span className="text-[var(--nx-status-danger)]">*</span>
          </label>
          <input
            id="org-profile-slug"
            data-org-profile-slug-input
            value={values.slug}
            maxLength={120}
            disabled={update.isPending}
            aria-invalid={Boolean(errors.slug)}
            onChange={(event) => handleChange('slug', event.target.value)}
            onBlur={() => validateField('slug', values)}
            className={cn(fieldClass, 'font-mono', errors.slug && errorFieldClass)}
          />
          {errors.slug ? (
            <p
              data-org-profile-slug-error
              role="alert"
              className="mt-1 text-[11px] text-[var(--nx-status-danger)]"
            >
              {errors.slug}
            </p>
          ) : null}
        </div>

        <div className="md:col-span-2">
          <label htmlFor="org-profile-description" className={labelClass}>
            组织简介
          </label>
          <textarea
            id="org-profile-description"
            data-org-profile-description-input
            value={values.description}
            maxLength={2000}
            rows={3}
            disabled={update.isPending}
            aria-invalid={Boolean(errors.description)}
            onChange={(event) => handleChange('description', event.target.value)}
            onBlur={() => validateField('description', values)}
            className={cn(fieldClass, 'h-auto py-2', errors.description && errorFieldClass)}
          />
          {errors.description ? (
            <p
              data-org-profile-description-error
              role="alert"
              className="mt-1 text-[11px] text-[var(--nx-status-danger)]"
            >
              {errors.description}
            </p>
          ) : null}
        </div>

        {serverError ? (
          <p
            data-org-profile-server-error
            role="alert"
            className="md:col-span-2 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
          >
            {serverError}
          </p>
        ) : null}

        {savedNotice && !dirty ? (
          <p
            data-org-profile-saved
            role="status"
            className="md:col-span-2 text-[11px] text-[var(--nx-status-success)]"
          >
            组织资料已保存
          </p>
        ) : null}

        <div className="flex items-center gap-3 md:col-span-2">
          <button
            type="submit"
            data-org-profile-save
            disabled={!dirty || update.isPending}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {update.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            保存组织资料
          </button>
          <span data-org-profile-dirty-hint className="text-[11px] text-[var(--nx-text-muted)]">
            {dirty ? '有未保存的改动' : '当前无改动'}
          </span>
        </div>
      </form>
    </section>
  )
}

export default OrgProfileForm
