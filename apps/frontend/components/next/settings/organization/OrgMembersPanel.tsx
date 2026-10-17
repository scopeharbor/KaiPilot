'use client'

import * as React from 'react'
import { CreateOrganizationAccountForm } from './CreateOrganizationAccountForm'
import { toast } from '@/components/ui/Toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw, Search, ShieldAlert, Trash2, UserPlus, Users, X } from 'lucide-react'
import { z } from 'zod'
import { membersApi, type OrganizationMember } from '@/lib/api-client'
import { usePermissions } from '@/hooks/use-permissions'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { cn } from '@/lib/utils'
import { ORGANIZATIONS_QUERY_ROOT, orgApiErrorMessage } from './OrgProfileForm'
import {
  ORG_MEMBER_ROLE_LABELS,
  ORG_ROLE_LABELS,
  formatMemberJoinedAt,
  orgMemberDisplayName,
  orgMemberInitials,
  orgMembersQueryKey,
  readMemberCreatedAt,
} from './org-member-helpers'

/**
 * 组织成员底册与治理（v3-ui-next-settings-admin-domains W2 · tasks 2.2，
 * spec「组织设置与成员治理」段 2）。
 *
 * - 底册列：姓名 / 邮箱 / 组织角色徽标 / 加入时间（`createdAt`，UTC 日历日确定性
 *   格式化）——角色标签映射与旧轨 `ORG_ROLE_LABELS` 语义对齐（见
 *   `org-member-helpers.ts`，本域内收敛为单一事实源）；
 * - 写门 `org:member:manage`：无权限时角色下拉与移除按钮**物理隐藏**，仅渲染
 *   静态角色徽标（RL-06，无写入口）；
 * - 角色修改走 `membersApi.update`（PUT /organizations/:id/members/:memberId）；
 *   owner 行不可改（后端 `updateRole` 明确拒绝「请先转交组织所有权」，前端同样禁用）；
 * - 移除成员：二次确认 + 明示「将解除其在组织内全部项目指派」影响，确认后
 *   `membersApi.delete`；owner 行移除按钮禁用（后端拒绝移除组织 owner）；
 * - 邀请：邮箱 onBlur/提交即时 Zod 校验，非法输入**零请求**（spec 场景）；
 *   角色选项仅 admin/member/viewer（owner 只能经所有权转让产生，与后端
 *   `inviteMemberValidator` 枚举一致）；
 * - 写操作成功后失效成员底册缓存；失败按 `ApiError.message` 原文回显。
 */

export interface OrgMembersPanelProps {
  organizationId: number
  className?: string
  api?: typeof membersApi
}

/** 邀请表单校验契约（与后端 inviteMemberValidator 同源：email + admin/member/viewer）。 */
export const orgMemberInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, '请输入成员邮箱')
    .max(254, '邮箱最多 254 个字符')
    .email('请输入有效的邮箱地址'),
  role: z.enum(['admin', 'member', 'viewer'], { error: '请选择组织角色' }),
})

export type OrgMemberInviteValues = z.infer<typeof orgMemberInviteSchema>

export function OrgMembersPanel({
  organizationId,
  className,
  api = membersApi,
}: OrgMembersPanelProps) {
  const { can } = usePermissions()
  const canManage = can('org:member:manage')
  const queryClient = useQueryClient()

  const [keyword, setKeyword] = React.useState('')
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [removeTarget, setRemoveTarget] = React.useState<OrganizationMember | null>(null)
  const [removeError, setRemoveError] = React.useState<string | null>(null)

  const membersQuery = useQuery({
    queryKey: orgMembersQueryKey(organizationId),
    queryFn: () => api.list(organizationId),
  })

  const invalidateMembers = () => {
    void queryClient.invalidateQueries({ queryKey: orgMembersQueryKey(organizationId) })
    void queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_QUERY_ROOT })
    void queryClient.invalidateQueries({ queryKey: ['platform', 'organizations'] })
    void queryClient.invalidateQueries({ queryKey: ['platform', 'organization-managers'] })
    void queryClient.invalidateQueries({ queryKey: ['users'] })
  }

  const updateRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: number; role: OrganizationMember['role'] }) =>
      api.update(organizationId, memberId, role),
    onSuccess: invalidateMembers,
  })

  const remove = useMutation({
    mutationFn: (memberId: number) => api.delete(organizationId, memberId),
    onSuccess: () => {
      setRemoveTarget(null)
      setRemoveError(null)
      invalidateMembers()
    },
    onError: (error) => {
      setRemoveError(orgApiErrorMessage(error, '移除成员失败，请稍后重试'))
    },
  })

  const members = membersQuery.data ?? []
  const busy = updateRole.isPending || remove.isPending

  const filtered = React.useMemo(() => {
    const trimmed = keyword.trim().toLowerCase()
    if (trimmed === '') return members
    return members.filter((member) => {
      const name = orgMemberDisplayName(member).toLowerCase()
      const email = (member.user?.email ?? '').toLowerCase()
      return name.includes(trimmed) || email.includes(trimmed)
    })
  }, [members, keyword])

  return (
    <section
      data-org-members
      className={cn(
        'rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">组织成员</h2>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              按姓名或邮箱检索；组织管理员可建立、邀请与管理成员。
            </p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="relative flex w-full items-center sm:w-auto">
            <Search
              className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[var(--nx-text-muted)]"
              aria-hidden
            />
            <input
              data-org-members-search
              aria-label="检索组织成员"
              value={keyword}
              placeholder="检索姓名或邮箱"
              onChange={(event) => setKeyword(event.target.value)}
              className="h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] pl-7 pr-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none sm:w-52"
            />
          </label>
          {canManage ? (
            <button
              type="button"
              onClick={() => setCreateOpen((value) => !value)}
              className="h-8 rounded-md border border-[var(--nx-border-focus)] px-3 text-xs text-[var(--nx-accent)]"
            >
              建立成员账号
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              data-org-members-invite-open
              onClick={() => setInviteOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              邀请成员
            </button>
          ) : null}
        </div>
      </header>

      {canManage && createOpen && (
        <CreateOrganizationAccountForm
          createAccount={api.createAccount}
          organizationId={organizationId}
          onCancel={() => setCreateOpen(false)}
          onCreated={() => {
            invalidateMembers()
            setCreateOpen(false)
          }}
        />
      )}

      <div className="mt-4">
        {membersQuery.isPending ? (
          <MembersRosterSkeleton />
        ) : membersQuery.isError ? (
          <div
            data-org-members-error
            role="alert"
            aria-label="成员加载失败"
            className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-8 text-center"
          >
            <ShieldAlert className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
            <p className="text-sm text-[var(--nx-text-secondary)]">成员加载失败</p>
            <button
              type="button"
              data-org-members-retry
              onClick={() => void membersQuery.refetch()}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重新载入
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div
            data-org-members-empty
            className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-8 text-center"
          >
            <Users className="mx-auto h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
            <p className="mt-2 text-sm text-[var(--nx-text-secondary)]">
              {members.length === 0 ? '当前组织暂无成员' : '没有匹配的成员'}
            </p>
            <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
              {members.length === 0
                ? canManage
                  ? '使用右上角「邀请成员」将协作者加入组织。'
                  : '请联系组织管理员邀请成员。'
                : '调整检索关键词后重试。'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]">
            <table data-org-members-table className="w-full min-w-[46rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--nx-border-hairline)]">
                  <Th>成员</Th>
                  <Th>组织角色</Th>
                  <Th>加入时间</Th>
                  {canManage ? <Th align="right">操作</Th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => {
                  const display = orgMemberDisplayName(member)
                  const isOwner = member.role === 'owner'
                  return (
                    <tr
                      key={member.id}
                      data-org-member-row={member.id}
                      className="border-b border-[var(--nx-border-hairline)] last:border-b-0"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[11px] font-medium text-[var(--nx-text-secondary)]"
                          >
                            {orgMemberInitials(member)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs text-[var(--nx-text-primary)]">
                              {display}
                            </p>
                            <p className="truncate text-[11px] text-[var(--nx-text-muted)]">
                              {member.user?.email ?? '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          data-org-member-role={member.id}
                          className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-0.5 text-[11px] text-[var(--nx-text-secondary)]"
                        >
                          {ORG_MEMBER_ROLE_LABELS[member.role]}
                        </span>
                        {canManage ? (
                          <select
                            data-org-member-role-select={member.id}
                            aria-label={`调整 ${display} 的组织角色`}
                            value={member.role}
                            disabled={isOwner || busy}
                            onChange={(event) =>
                              updateRole.mutate({
                                memberId: member.id,
                                role: event.target.value as OrganizationMember['role'],
                              })
                            }
                            className="ml-2 h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {Object.entries(ORG_ROLE_LABELS).map(([value, label]) => (
                              <option key={value} value={value} disabled={value === 'owner'}>
                                {label}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--nx-text-muted)]">
                        {formatMemberJoinedAt(readMemberCreatedAt(member))}
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            data-org-member-remove={member.id}
                            aria-label={`移除 ${display}`}
                            disabled={isOwner || busy}
                            onClick={() => {
                              setRemoveTarget(member)
                              setRemoveError(null)
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-transparent disabled:hover:text-[var(--nx-text-secondary)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {removeTarget ? (
        <RemoveMemberDialog
          member={removeTarget}
          pending={remove.isPending}
          error={removeError}
          onCancel={() => {
            if (remove.isPending) return
            setRemoveTarget(null)
            setRemoveError(null)
          }}
          onConfirm={() => {
            setRemoveError(null)
            remove.mutate(removeTarget.id)
          }}
        />
      ) : null}

      {inviteOpen ? (
        <InviteMemberDialog
          inviteMember={api.invite}
          organizationId={organizationId}
          onClose={() => setInviteOpen(false)}
          onInvited={invalidateMembers}
        />
      ) : null}
    </section>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]',
        align === 'right' ? 'w-24 text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  )
}

/** 成员底册加载骨架（几何与真实表格同构）。 */
export function MembersRosterSkeleton() {
  return (
    <div
      data-org-members-skeleton
      role="status"
      aria-label="正在加载组织成员"
      aria-busy="true"
      className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 border-b border-[var(--nx-border-hairline)] px-3 py-3 last:border-b-0"
        >
          <div className="h-7 w-7 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/3 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
            <div className="h-2.5 w-1/2 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
          </div>
          <div className="h-6 w-24 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
          <div className="h-6 w-20 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
        </div>
      ))}
    </div>
  )
}

/** 移除成员二次确认（明示解除项目指派影响）。 */
function RemoveMemberDialog({
  member,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  member: OrganizationMember
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const display = orgMemberDisplayName(member)

  // 本组件仅在 removeTarget 存在时挂载，故对 hook 恒为 open；在途删除拒绝 Escape 关闭。
  const removeDialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: removeDialogRef,
    open: true,
    onClose: onCancel,
    canClose: () => !pending,
  })

  return (
    <div data-org-member-remove-dialog className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="关闭移除确认"
        tabIndex={-1}
        disabled={pending}
        onClick={onCancel}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60 disabled:cursor-not-allowed"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="移除组织成员"
        ref={removeDialogRef}
        tabIndex={-1}
        className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-5 shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">移除组织成员</h3>
          </div>
          <button
            type="button"
            aria-label="关闭"
            disabled={pending}
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--nx-text-secondary)]">
          将把「{display}」移出当前组织。该成员在组织内全部项目的指派将一并解除，
          其账号本身保留。此操作不可撤销。
        </p>
        {error ? (
          <p
            data-org-member-remove-error
            role="alert"
            className="mt-3 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
          >
            {error}
          </p>
        ) : null}
        <footer className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            data-org-member-remove-cancel
            disabled={pending}
            onClick={onCancel}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-org-member-remove-confirm
            disabled={pending}
            onClick={onConfirm}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.12)] px-4 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[rgba(239,68,68,0.2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            )}
            确认移除
          </button>
        </footer>
      </div>
    </div>
  )
}

/** 邀请成员弹窗（即时校验：非法输入零请求）。 */
function InviteMemberDialog({
  inviteMember,
  organizationId,
  onClose,
  onInvited,
}: {
  organizationId: number
  onClose: () => void
  onInvited: () => void
  inviteMember: typeof membersApi.invite
}) {
  const [emailText, setEmailText] = React.useState('')
  const [role, setRole] = React.useState<OrgMemberInviteValues['role']>('member')
  const [emailError, setEmailError] = React.useState<string | undefined>(undefined)
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [failures, setFailures] = React.useState<Array<{ email: string; message: string }>>([])

  /** 一次可粘贴多个邮箱：换行 / 逗号 / 分号 / 空格分隔，去重。 */
  const parseEmails = (text: string) => [
    ...new Set(
      text
        .split(/[\s,;，；]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]

  const invite = useMutation({
    mutationFn: async (values: { emails: string[]; role: OrgMemberInviteValues['role'] }) => {
      const results: Array<{ email: string; ok: boolean; message?: string }> = []
      // 逐个邀请：任一失败（未注册 / 已是成员 / 超出人数上限）不影响其余人
      for (const email of values.emails) {
        try {
          await inviteMember(organizationId, { email, role: values.role })
          results.push({ email, ok: true })
        } catch (error) {
          results.push({ email, ok: false, message: orgApiErrorMessage(error, '邀请失败') })
        }
      }
      return results
    },
    onSuccess: (results) => {
      const succeeded = results.filter((r) => r.ok)
      const failed = results.filter((r) => !r.ok)
      if (succeeded.length) {
        onInvited()
        toast({
          variant: 'success',
          title: `已邀请 ${succeeded.length} 人加入组织`,
          description: failed.length ? `${failed.length} 人未成功，见弹窗内说明` : undefined,
        })
      }
      if (failed.length === 0) {
        setEmailText('')
        setRole('member')
        onClose()
        return
      }
      setFailures(failed.map((r) => ({ email: r.email, message: r.message ?? '邀请失败' })))
      setEmailText(failed.map((r) => r.email).join('\n'))
    },
    onError: (error) => {
      setServerError(orgApiErrorMessage(error, '邀请成员失败，请稍后重试'))
    },
  })

  const validate = (text: string): string | undefined => {
    const emails = parseEmails(text)
    if (emails.length === 0) return '请输入成员邮箱'
    const invalid = emails.filter(
      (email) => !orgMemberInviteSchema.shape.email.safeParse(email).success,
    )
    return invalid.length ? `请输入有效的邮箱地址：${invalid.join('、')}` : undefined
  }

  const handleEmailChange = (value: string) => {
    setEmailText(value)
    setServerError(null)
    setFailures([])
    setEmailError(value.trim() === '' ? undefined : validate(value))
  }

  const handleSubmit = () => {
    setServerError(null)
    const error = validate(emailText)
    if (error) {
      setEmailError(error)
      return
    }
    if (invite.isPending) return
    invite.mutate({ emails: parseEmails(emailText), role })
  }

  const pending = invite.isPending
  const emailCount = parseEmails(emailText).length

  // 本组件仅在 inviteOpen 存在时挂载，故对 hook 恒为 open；在途邀请拒绝 Escape 关闭。
  const inviteDialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: inviteDialogRef,
    open: true,
    onClose,
    canClose: () => !pending,
  })

  return (
    <div data-org-member-invite-dialog className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="关闭邀请弹窗"
        tabIndex={-1}
        disabled={pending}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40 disabled:cursor-not-allowed"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="邀请组织成员"
        ref={inviteDialogRef}
        tabIndex={-1}
        className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-5 shadow-[0_0_48px_rgba(0,0,0,0.25)]"
      >
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <UserPlus className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">邀请组织成员</h3>
          </div>
          <button
            type="button"
            aria-label="关闭"
            disabled={pending}
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="mt-4 space-y-4">
          {serverError ? (
            <p
              data-org-member-invite-error
              role="alert"
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {serverError}
            </p>
          ) : null}
          {failures.length ? (
            <ul
              data-org-member-invite-error
              data-org-member-invite-failures
              role="alert"
              className="space-y-1 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {failures.map((f) => (
                <li key={f.email}>
                  {f.email}：{f.message}
                </li>
              ))}
            </ul>
          ) : null}

          <div>
            <label
              htmlFor="org-member-invite-email"
              className="mb-1.5 block text-[11px] font-medium text-[var(--nx-text-secondary)]"
            >
              成员邮箱 <span className="text-[var(--nx-status-danger)]">*</span>
              <span className="ml-1 font-normal text-[var(--nx-text-muted)]">
                可一次粘贴多个，换行或逗号分隔
              </span>
            </label>
            <textarea
              id="org-member-invite-email"
              data-org-member-invite-email
              value={emailText}
              rows={4}
              disabled={pending}
              placeholder={'name@example.com\nsecond@example.com'}
              autoComplete="off"
              aria-invalid={Boolean(emailError)}
              onChange={(event) => handleEmailChange(event.target.value)}
              onBlur={() => setEmailError(validate(emailText))}
              className={cn(
                'w-full resize-y rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50',
                emailError &&
                  'border-[var(--nx-status-danger)] focus:border-[var(--nx-status-danger)]',
              )}
            />
            {emailError ? (
              <p
                data-org-member-invite-email-error
                role="alert"
                className="mt-1 text-[11px] text-[var(--nx-status-danger)]"
              >
                {emailError}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="org-member-invite-role"
              className="mb-1.5 block text-[11px] font-medium text-[var(--nx-text-secondary)]"
            >
              组织角色
            </label>
            <select
              id="org-member-invite-role"
              data-org-member-invite-role
              value={role}
              disabled={pending}
              onChange={(event) => {
                setRole(event.target.value as OrgMemberInviteValues['role'])
                setServerError(null)
              }}
              className="h-9 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
            >
              <option value="admin">管理员</option>
              <option value="member">成员</option>
              <option value="viewer">只读</option>
            </select>
            <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
              仅已注册账号可被邀请；组织所有者角色只能通过「转交所有权」产生。项目里的「项目经理」在项目成员页设置即可，无需给组织管理员。
            </p>
          </div>
        </div>

        <footer className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            data-org-member-invite-cancel
            disabled={pending}
            onClick={onClose}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-org-member-invite-submit
            disabled={pending}
            onClick={handleSubmit}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
            )}
            {emailCount > 1 ? `发送邀请（${emailCount} 人）` : '发送邀请'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default OrgMembersPanel
