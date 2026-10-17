'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Search, UserPlus, X } from 'lucide-react'
import {
  projectKeys,
  projectMembersApi,
  type ProjectMember,
  type ProjectRole,
} from '@/lib/api/projects'
import { membersApi, type OrganizationMember } from '@/lib/api-client'
import { toast } from '@/components/ui/Toast'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { isMemberRoleAssignable, memberRoleLabel } from '@/lib/next/members/member-helpers'

/**
 * 添加项目成员弹窗（v3-ui-next-resource-team-domains W2 · tasks 2.5）。
 *
 * 项目成员必须先是组织成员，所以直接从组织成员里勾选（可搜索、可多选、可全选），
 * 已在项目中的人不再出现；选一个项目角色后一次加入。此前需要逐个手输邮箱，
 * 25 人的团队要重复 25 次，而且对方本来就在组织里。
 *
 * - 拥有者角色只能经所有权转让产生，不在此开放；
 * - 逐个提交：任一失败（如刚被别人加入）不影响其余人，失败项留在列表并标注原因；
 * - 成功后失效成员底册缓存，列表即时刷新。
 */

export interface MemberInviteModalProps {
  projectId: number
  open: boolean
  /** 项目角色清单（调用方就绪数据；本组件内部过滤不可常规授予角色）。 */
  roles: ProjectRole[]
  onClose: () => void
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  return fallback
}

const ORG_ROLE_LABEL: Record<OrganizationMember['role'], string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
}

function displayName(member: OrganizationMember): string {
  return member.user?.fullName?.trim() || member.user?.email || `用户 #${member.userId}`
}

export function MemberInviteModal({ projectId, open, roles, onClose }: MemberInviteModalProps) {
  const queryClient = useQueryClient()
  const organizationId = useAuthStore((state) => state.currentOrganizationId)
  const [keyword, setKeyword] = React.useState('')
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [projectRoleId, setProjectRoleId] = React.useState('')
  const [failures, setFailures] = React.useState<Map<number, string>>(new Map())

  const assignableRoles = React.useMemo(
    () => roles.filter((role) => isMemberRoleAssignable(role)),
    [roles],
  )

  const orgMembersQuery = useQuery({
    queryKey: ['organizations', organizationId, 'members'] as const,
    queryFn: () => membersApi.list(organizationId!),
    enabled: open && organizationId !== null,
  })
  const projectMembers =
    queryClient.getQueryData<ProjectMember[]>(projectKeys.members(projectId)) ?? []

  const candidates = React.useMemo(() => {
    const inProject = new Set(projectMembers.map((member) => Number(member.userId)))
    return (orgMembersQuery.data ?? [])
      .filter((member) => !inProject.has(Number(member.userId)))
      .sort((a, b) => displayName(a).localeCompare(displayName(b), 'zh-Hans-CN'))
  }, [orgMembersQuery.data, projectMembers])

  const visible = React.useMemo(() => {
    const trimmed = keyword.trim().toLowerCase()
    if (!trimmed) return candidates
    return candidates.filter(
      (member) =>
        displayName(member).toLowerCase().includes(trimmed) ||
        (member.user?.email ?? '').toLowerCase().includes(trimmed),
    )
  }, [candidates, keyword])

  // 每次呼出重置为初始态（默认角色 = 普通成员，否则最低序可用角色）。
  React.useEffect(() => {
    if (!open) return
    setKeyword('')
    setSelected(new Set())
    setFailures(new Map())
    const defaultRole =
      assignableRoles.find((role) => role.name === 'Member') ?? assignableRoles[0] ?? undefined
    setProjectRoleId(defaultRole ? String(defaultRole.id) : '')
  }, [open, assignableRoles])

  const add = useMutation({
    mutationFn: async (values: { userIds: number[]; projectRoleId: number }) => {
      const results: Array<{ userId: number; ok: boolean; message?: string }> = []
      for (const userId of values.userIds) {
        try {
          await projectMembersApi.add(projectId, { userId, projectRoleId: values.projectRoleId })
          results.push({ userId, ok: true })
        } catch (error) {
          results.push({ userId, ok: false, message: apiErrorMessage(error, '加入失败') })
        }
      }
      return results
    },
    onSuccess: (results) => {
      const succeeded = results.filter((r) => r.ok)
      const failed = results.filter((r) => !r.ok)
      if (succeeded.length) {
        void queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) })
        toast({
          variant: 'success',
          title: `已将 ${succeeded.length} 人加入项目`,
          description: failed.length ? `${failed.length} 人未加入，见弹窗内说明` : undefined,
        })
      }
      if (!failed.length) {
        onClose()
        return
      }
      setFailures(new Map(failed.map((r) => [r.userId, r.message ?? '加入失败'])))
      setSelected(new Set(failed.map((r) => r.userId)))
    },
  })

  // Esc 关闭（请求在途时禁止）。
  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !add.isPending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, add.isPending, onClose])

  if (!open) return null

  const pending = add.isPending
  const allVisibleSelected =
    visible.length > 0 && visible.every((m) => selected.has(Number(m.userId)))
  const toggle = (userId: number) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  const toggleAllVisible = () =>
    setSelected((current) => {
      const next = new Set(current)
      for (const member of visible) {
        if (allVisibleSelected) next.delete(Number(member.userId))
        else next.add(Number(member.userId))
      }
      return next
    })
  const canSubmit = selected.size > 0 && projectRoleId !== '' && !pending

  return (
    <div data-member-invite-modal className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-member-invite-scrim
        aria-label="关闭添加项目成员"
        tabIndex={-1}
        disabled={pending}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40 disabled:cursor-not-allowed"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="添加项目成员"
        data-member-invite-panel
        className="absolute left-1/2 top-1/2 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.25)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <UserPlus className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">添加项目成员</h3>
              <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
                从组织成员中勾选，可多选；不在组织里的人请先到「组织设置」邀请
              </p>
            </div>
          </div>
          <button
            type="button"
            data-member-invite-close
            aria-label="关闭添加项目成员"
            disabled={pending}
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-text-muted)]"
                aria-hidden
              />
              <input
                data-member-invite-search
                type="search"
                value={keyword}
                disabled={pending}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="按姓名或邮箱搜索"
                aria-label="搜索组织成员"
                className="h-9 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] pl-8 pr-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              />
            </label>
            <button
              type="button"
              data-member-invite-select-all
              disabled={pending || visible.length === 0}
              onClick={toggleAllVisible}
              className="h-9 shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-40"
            >
              {allVisibleSelected ? '取消全选' : '全选'}
            </button>
          </div>

          <ul
            data-member-invite-candidates
            aria-label="可加入的组织成员"
            className="min-h-[160px] flex-1 overflow-y-auto rounded-sm border border-[var(--nx-border-hairline)]"
          >
            {orgMembersQuery.isLoading ? (
              <li className="flex h-24 items-center justify-center text-xs text-[var(--nx-text-muted)]">
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                正在加载组织成员…
              </li>
            ) : visible.length === 0 ? (
              <li className="flex h-24 items-center justify-center px-4 text-center text-xs text-[var(--nx-text-muted)]">
                {candidates.length === 0 ? '组织成员都已在项目中' : '没有匹配的成员'}
              </li>
            ) : (
              visible.map((member) => {
                const userId = Number(member.userId)
                const checked = selected.has(userId)
                const failure = failures.get(userId)
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      data-member-invite-candidate={userId}
                      disabled={pending}
                      onClick={() => toggle(userId)}
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-[var(--nx-border-hairline)]/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--nx-bg-2)]',
                        checked && 'bg-[var(--nx-bg-2)]',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                          checked
                            ? 'border-[var(--nx-accent)] bg-[var(--nx-accent)] text-white'
                            : 'border-[var(--nx-border-hairline)]',
                        )}
                      >
                        {checked ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-[var(--nx-text-primary)]">
                          {displayName(member)}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--nx-text-muted)]">
                          {member.user?.email}
                        </span>
                        {failure ? (
                          <span className="block text-[11px] text-[var(--nx-status-danger)]">
                            {failure}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--nx-text-muted)]">
                        组织{ORG_ROLE_LABEL[member.role]}
                      </span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>

          <div>
            <label
              htmlFor="member-invite-role"
              className="mb-1.5 block text-[11px] font-medium text-[var(--nx-text-secondary)]"
            >
              项目角色
            </label>
            <select
              id="member-invite-role"
              data-member-invite-role
              value={projectRoleId}
              disabled={pending}
              onChange={(event) => setProjectRoleId(event.target.value)}
              className="h-9 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
            >
              {assignableRoles.map((role) => (
                <option key={role.id} value={String(role.id)}>
                  {memberRoleLabel(role.name)}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
              项目经理可在本项目内编辑、指派任务和调整排期；加入后仍可在成员列表里单独调整角色。
            </p>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <span
            data-member-invite-selected-count
            className="text-[11px] text-[var(--nx-text-muted)]"
          >
            已选 {selected.size} 人
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={onClose}
              className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              data-member-invite-submit
              disabled={!canSubmit}
              onClick={() =>
                add.mutate({ userIds: [...selected], projectRoleId: Number(projectRoleId) })
              }
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <UserPlus className="h-3.5 w-3.5" aria-hidden />
              )}
              加入项目{selected.size > 1 ? `（${selected.size} 人）` : ''}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default MemberInviteModal
