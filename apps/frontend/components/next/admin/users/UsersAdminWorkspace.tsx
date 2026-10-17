'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Filter,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  X,
} from 'lucide-react'
import { apiFetch, usersApi, type ManagedUser } from '@/lib/api-client'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'

/**
 * 用户管理工作区（/next/admin/users，v3-ui-next-settings-admin-domains W6 · tasks 6.5，
 * spec「管理后台门户与平台治理控制台」Requirement 4 + design 敏感写操作确认矩阵）。
 *
 * - **准入门禁 `system:admin`**（后端已核实：`start/rbac/routes.ts` 的 `users.index` /
 *   `users.update` 均为 `SYSTEM:admin`；`POST /users/:id/two-factor/reset` 在
 *   `TwoFactorController.adminReset` 内显式判 `system:admin`）。本工作区由页面
 *   `PermissionGuard` 守卫，无权时不挂载（RL-06 零请求）；工作区内部再持有 `can()`
 *   决定写控件可见性（只读体验层，后端 Policy 仍为最终边界）；
 * - 检索：姓名/邮箱关键字（`usersApi.list({ search })`，服务端大小写不敏感模糊匹配）；
 *   底册列身份徽标（超级管理员 / 平台一般用户）+ 状态徽标（已启用 / 已禁用），
 *   颜色与文本双通道（RL-15）；
 * - **启用 / 禁用账号**：二次确认弹窗（明示 RoleVersion 即时失效后果）→
 *   `usersApi.update(id, { isActive })`；成功后失效 `['users']` 查询缓存使状态徽标即时
 *   刷新（服务端 `UserService.update` 在 isActive 变化时 `bumpRoleVersion`，旧令牌随即
 *   失效——前端如实提示，不阻断、不绕过）；
 * - **管理员重置他人 2FA（高危区）**：阻断式确认弹窗 + **人工核身留痕**（必填理由
 *   ≥4 字，对齐后端 `twoFactorAdminResetValidator`）→ `POST /users/:id/two-factor/reset`；
 *   失败回显服务端 `ApiError.message`，绝不静默；
 * - **AI 使用**：每行可打开抽屉查看该用户的 AI 用量；Google 个人版用户还可点开对话记录
 *   （见 `UserAiInsightDrawer`，读取对话逐次留痕）；
 * - **平台统一 AI 配置**：「仅 Google 登录用户」筛选（`auth_provider=google`）+ 每个账号的
 *   「允许自行配置」开关 → `usersApi.update(id, { allowSelfAiConfig })`。默认关闭 = 个人版
 *   使用平台统一 AI 配置；开关变化会递增 RoleVersion，对方重新登录后权限生效；
 * - 三态闭环：几何同构骨架 / 语义空态（区分「暂无用户」与「无匹配用户」）/
 *   错误重试卡（触发既有 refetch）；精确档 `precise` 剥离氛围光晕（RL-15）。
 */

/** 用户查询键（与旧轨 `/admin/users` 同形，命中同一份缓存语义）。 */
export const userAdminKeys = {
  all: ['users'] as const,
  list: (search: string, authProvider?: string) =>
    [...userAdminKeys.all, authProvider ? { search, authProvider } : { search }] as const,
}

/** 从任意错误对象提取可展示文案（ApiError 非 Error 实例，需按形状读取）。 */
export function adminErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  return fallback
}

/** 管理员代为重置 2FA 的最小留痕理由长度（对齐后端 validator minLength(4)）。 */
export const TWO_FACTOR_RESET_REASON_MIN = 4

export function UsersAdminWorkspace() {
  const tier = useImmersionTier()
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const canManage = can('system:admin')

  const [search, setSearch] = React.useState('')
  const [googleOnly, setGoogleOnly] = React.useState(false)
  const [toggleTarget, setToggleTarget] = React.useState<ManagedUser | null>(null)
  const [resetTarget, setResetTarget] = React.useState<ManagedUser | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  const authProvider = googleOnly ? 'google' : undefined
  const usersQuery = useQuery({
    queryKey: userAdminKeys.list(search, authProvider),
    queryFn: () => usersApi.list({ search: search || undefined, authProvider }),
    enabled: canManage,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: userAdminKeys.all })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      usersApi.update(id, { isActive }),
    onSuccess: async (updated) => {
      await invalidate()
      setNotice(
        `${updated.fullName || updated.email} 已${updated.isActive ? '启用' : '禁用'}；该账号的会话版本已递增（RoleVersion），旧令牌将即刻失效。`,
      )
      setToggleTarget(null)
    },
    onError: (error) => setActionError(adminErrorMessage(error, '账号状态更新失败，请重试')),
  })

  const resetMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiFetch<{ userId: number; state: string; message: string }>(
        `/users/${id}/two-factor/reset`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
    onSuccess: async (result) => {
      await invalidate()
      setNotice(`已重置该用户的两步验证：${result.message ?? '需重新绑定'}。该操作已留痕。`)
      setResetTarget(null)
    },
    onError: (error) => setActionError(adminErrorMessage(error, '两步验证重置失败，请重试')),
  })

  // 平台统一 AI 配置（私有 SaaS）的「允许自行配置」开关；开源个人版没有平台统一配置
  const pending = { aiConfig: false }

  const rawData = usersQuery.data as unknown
  const rows: ManagedUser[] = Array.isArray(rawData)
    ? (rawData as ManagedUser[])
    : Array.isArray((rawData as { data?: unknown })?.data)
      ? (rawData as { data: ManagedUser[] }).data
      : []
  const isEmpty = usersQuery.data !== undefined && rows.length === 0
  const busy = toggleMutation.isPending || resetMutation.isPending || pending.aiConfig

  return (
    <div
      data-admin-users
      data-immersion={tier}
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-surface)]',
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <UserCog className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1
              data-admin-users-title
              className="text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              用户管理
            </h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              查看平台用户并管理账号启用状态；高危动作一律人工确认并留痕。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-admin-users-google-filter
            aria-pressed={googleOnly}
            onClick={() => setGoogleOnly((value) => !value)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
              googleOnly
                ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)]'
                : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)]',
            )}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />仅 Google 登录用户
          </button>
          <label className="flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
            <input
              data-admin-users-search
              type="search"
              aria-label="搜索用户"
              placeholder="按姓名或邮箱搜索"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-8 w-56 bg-transparent text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:outline-none"
            />
          </label>
          <button
            type="button"
            data-admin-users-refresh
            onClick={() => void usersQuery.refetch()}
            disabled={usersQuery.isFetching}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', usersQuery.isFetching && 'animate-spin')}
              aria-hidden
            />
            刷新
          </button>
        </div>
      </header>

      {notice ? (
        <p
          data-admin-users-notice
          role="status"
          className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-[11px] text-[var(--nx-text-secondary)]"
        >
          {notice}
        </p>
      ) : null}

      {!canManage ? (
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看用户管理的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 system:admin 权限方可管理平台用户。请联系平台管理员授予权限。
          </p>
        </div>
      ) : usersQuery.isPending ? (
        <UsersTableSkeleton />
      ) : usersQuery.isError ? (
        <div
          data-admin-users-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
        >
          <ShieldAlert className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">用户底册加载失败</p>
          <button
            type="button"
            data-admin-users-retry
            onClick={() => void usersQuery.refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新载入
          </button>
        </div>
      ) : isEmpty ? (
        <div
          data-admin-users-empty
          className="rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
        >
          <UserCog className="mx-auto h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="mt-3 text-sm text-[var(--nx-text-secondary)]">
            {search ? '没有匹配的用户' : '暂无用户'}
          </p>
          <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
            {search ? '尝试使用其他姓名或邮箱关键字。' : '用户创建后会显示在这里。'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
          <table className="w-full min-w-[56rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)]">
                {['用户', '身份', '状态', '所属组织', '操作'].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className={cn(
                      'h-9 px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]',
                      label === '操作' && 'text-right',
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => (
                <tr
                  key={user.id}
                  data-admin-user-row={user.id}
                  className="border-t border-[var(--nx-border-hairline)] first:border-t-0 hover:bg-[var(--nx-bg-0)]"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] font-mono text-[11px] text-[var(--nx-text-secondary)]"
                      >
                        {initialsOf(user)}
                      </span>
                      <div className="min-w-0">
                        <p
                          data-admin-user-name
                          className="truncate font-medium text-[var(--nx-text-primary)]"
                        >
                          {user.fullName || '未设置姓名'}
                        </p>
                        <p
                          data-admin-user-email
                          className="mt-0.5 truncate font-mono text-[10px] text-[var(--nx-text-muted)]"
                        >
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5" data-admin-user-identity={user.id}>
                    {user.isSuperAdmin ? (
                      <span className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] px-1.5 py-0.5 text-[10px] text-[var(--nx-accent)]">
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                        超级管理员
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                        平台一般用户
                      </span>
                    )}
                    {user.authProvider === 'google' ? (
                      <span
                        data-admin-user-google={user.id}
                        className="ml-1 inline-flex items-center rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                      >
                        Google 登录
                      </span>
                    ) : null}
                    {user.twoFactorExempt ? (
                      <span
                        data-admin-user-2fa-exempt={user.id}
                        className="ml-1 inline-flex items-center rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                      >
                        免两步验证
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5" data-admin-user-status={user.id}>
                    <span
                      data-admin-user-status-value={user.isActive ? 'active' : 'inactive'}
                      className={cn(
                        'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px]',
                        user.isActive
                          ? 'border-[rgba(16,185,129,0.4)] text-[var(--nx-status-success)]'
                          : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
                      )}
                    >
                      {user.isActive ? '已启用' : '已禁用'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-[var(--nx-text-secondary)]">
                    {user.organizations.length === 0
                      ? '—'
                      : user.organizations
                          .map(
                            (organization) =>
                              `${organization.name}（${({ owner: '组织所有者', admin: '组织管理员', member: '组织成员', viewer: '只读成员' } as Record<string, string>)[organization.role] ?? organization.role}）`,
                          )
                          .join('、')}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        data-admin-user-toggle={user.id}
                        disabled={busy}
                        onClick={() => {
                          setActionError(null)
                          setNotice(null)
                          setToggleTarget(user)
                        }}
                        className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {user.isActive ? '禁用账号' : '启用账号'}
                      </button>
                      <button
                        type="button"
                        data-admin-user-reset-2fa={user.id}
                        disabled={busy}
                        onClick={() => {
                          setActionError(null)
                          setNotice(null)
                          setResetTarget(user)
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-sm border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.06)] px-2 text-[11px] text-[var(--nx-status-danger)] transition-colors hover:border-[var(--nx-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <KeyRound className="h-3 w-3" aria-hidden />
                        重置两步验证
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {usersQuery.data && rows.length > 0 ? (
        <p data-admin-users-meta className="text-[11px] text-[var(--nx-text-muted)]">
          共 {usersQuery.data.meta.total} 个用户
          {search ? `（关键字「${search}」）` : ''}
        </p>
      ) : null}

      {/* 启用 / 禁用账号：二次确认 */}
      <AdminActionDialog
        open={toggleTarget !== null}
        title={toggleTarget?.isActive ? '禁用该账号？' : '启用该账号？'}
        description={toggleTarget?.email}
        confirmLabel={toggleTarget?.isActive ? '确认禁用' : '确认启用'}
        danger={toggleTarget?.isActive === true}
        error={actionError}
        running={toggleMutation.isPending}
        testId="admin-user-toggle-dialog"
        onClose={() => {
          setToggleTarget(null)
          setActionError(null)
        }}
        onConfirm={async () => {
          if (!toggleTarget) return
          setActionError(null)
          try {
            await toggleMutation.mutateAsync({
              id: toggleTarget.id,
              isActive: !toggleTarget.isActive,
            })
          } catch {
            /* 错误已由 onError 落至 actionError 并保持弹窗打开 */
          }
        }}
      >
        <p data-admin-user-toggle-impact className="text-[11px] leading-relaxed">
          {toggleTarget?.isActive
            ? '禁用后该账号将无法登录，其现有令牌因 RoleVersion 递增即刻失效。该操作会写入审计日志。'
            : '启用后该账号恢复登录能力；请确认已完成人工核身。该操作会写入审计日志。'}
        </p>
      </AdminActionDialog>

      {/* 管理员重置他人 2FA：高危阻断式确认 + 人工核身留痕 */}
      <AdminActionDialog
        open={resetTarget !== null}
        title="重置该用户的两步验证？"
        description={resetTarget?.email}
        confirmLabel="确认重置"
        danger
        error={actionError}
        running={resetMutation.isPending}
        testId="admin-user-reset-2fa-dialog"
        onClose={() => {
          setResetTarget(null)
          setActionError(null)
        }}
      >
        <ResetTwoFactorForm
          running={resetMutation.isPending}
          onSubmit={async (reason) => {
            if (!resetTarget) return
            setActionError(null)
            try {
              await resetMutation.mutateAsync({ id: resetTarget.id, reason })
            } catch {
              /* 错误已由 onError 落至 actionError 并保持弹窗打开 */
            }
          }}
        />
      </AdminActionDialog>
    </div>
  )
}

/**
 * 高危重置表单：必填理由（≥4 字，后端 `twoFactorAdminResetValidator` 同口径）。
 * 理由不足时按钮禁用且不发请求（零请求边界）。
 */
function ResetTwoFactorForm({
  running,
  onSubmit,
}: {
  running: boolean
  onSubmit: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = React.useState('')
  const trimmed = reason.trim()
  const valid = trimmed.length >= TWO_FACTOR_RESET_REASON_MIN

  return (
    <form
      data-admin-user-reset-2fa-form
      className="flex flex-col gap-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid || running) return
        void onSubmit(trimmed)
      }}
    >
      <p
        data-admin-user-reset-2fa-impact
        className="flex items-start gap-2 rounded-sm border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.08)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--nx-status-danger)]"
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          该用户认证器与恢复码将全部作废，需重新绑定后才能再次启用两步验证。本项目无邮件自助通道，
          请先完成**人工核身**（电话/当面确认本人身份）再执行；理由将写入审计日志。
        </span>
      </p>
      <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
        核身与重置理由（至少 {TWO_FACTOR_RESET_REASON_MIN} 字）
        <textarea
          data-admin-user-reset-reason
          aria-label="核身与重置理由"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        />
      </label>
      <button
        type="submit"
        data-admin-user-reset-submit
        disabled={!valid || running}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.14)] px-3 text-xs font-medium text-[var(--nx-status-danger)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            正在重置…
          </>
        ) : (
          '确认重置两步验证'
        )}
      </button>
    </form>
  )
}

/**
 * 管理后台统一动作确认弹窗（域内私有：使用方仅在用户管理内）。
 *
 * - 阻断式：`role="alertdialog"` + `aria-modal`，遮罩与 Esc 均可关闭（提交中禁用）；
 * - 失败以行内 `role="alert"` 回显服务端 `ApiError.message` 且保持弹窗打开可重试；
 * - 破坏性动作使用 danger 双通道（红色边框 + 文字标签），不靠颜色单通道（RL-15）。
 */
export function AdminActionDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  error,
  running,
  testId,
  children,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description?: string | null
  confirmLabel?: string
  danger?: boolean
  error?: string | null
  running: boolean
  testId: string
  children?: React.ReactNode
  onConfirm?: () => Promise<void> | void
  onClose: () => void
}) {
  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !running) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, running, onClose])

  if (!open) return null

  return (
    <div data-admin-action-dialog={testId} className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-admin-action-scrim
        aria-label="关闭确认弹窗"
        tabIndex={-1}
        onClick={running ? undefined : onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        data-admin-action-panel
        className="absolute left-1/2 top-1/2 flex max-h-[80vh] w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h3>
            {description ? (
              <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--nx-text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            data-admin-action-close
            aria-label="关闭确认弹窗"
            disabled={running}
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 text-[var(--nx-text-secondary)]">
          {error ? (
            <p
              role="alert"
              data-admin-action-error
              className="rounded-sm border border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {error}
            </p>
          ) : null}
          {children}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3.5">
          <button
            type="button"
            data-admin-action-cancel
            disabled={running}
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            取消
          </button>
          {/* 高危重置表单自带提交按钮（需理由）；未提供 onConfirm 时只渲染取消。 */}
          {onConfirm ? (
            <button
              type="button"
              data-admin-action-submit
              disabled={running}
              onClick={() => void onConfirm()}
              className={cn(
                'inline-flex h-8 min-w-24 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                danger
                  ? 'border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.14)] text-[var(--nx-status-danger)]'
                  : 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)]',
              )}
            >
              {running ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  处理中…
                </>
              ) : (
                (confirmLabel ?? '确认')
              )}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  )
}

/** 头像缩写：姓名首字 → 邮箱首字 → 兜底占位（不崩）。 */
export function initialsOf(user: Pick<ManagedUser, 'fullName' | 'email'>): string {
  const source = user.fullName?.trim() || user.email?.trim() || ''
  return source.slice(0, 2).toUpperCase() || '—'
}

/** 高密度骨架（与真实表格几何同构）。 */
export function UsersTableSkeleton() {
  return (
    <div
      data-admin-users-skeleton
      role="status"
      aria-busy="true"
      aria-label="正在加载用户底册"
      className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded-sm bg-[var(--nx-bg-0)]"
          aria-hidden
        />
      ))}
    </div>
  )
}

export default UsersAdminWorkspace
