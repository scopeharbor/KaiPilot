'use client'

import * as React from 'react'
import { Crown, Loader2, Trash2, UserRoundCog, UsersRound } from 'lucide-react'
import type { ProjectMember, ProjectRole } from '@/lib/api/projects'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { cn } from '@/lib/utils'
import {
  formatMemberJoinedAt,
  isMemberRoleAssignable,
  isProjectOwnerRole,
  memberDisplayName,
  memberInitials,
  memberRoleLabel,
} from '@/lib/next/members/member-helpers'

/**
 * 成员底册表格（v3-ui-next-resource-team-domains W2 · tasks 2.3，
 * design §3.1/§3.2「成员底册呈现、角色调整与所有权转让」）。
 *
 * 纯展示 + 受控回调（数据与写请求由 ProjectMembersWorkspace 持有）：
 * - 冷黑曜石 1px 发丝线表格：头像缩写 / 姓名 / 邮箱 / 项目角色 / 加入时间；
 * - 写权限角色下拉：仅列示可常规授予角色（拥有者只能经转让产生），变更即回调
 *   `onChangeRole`（调用方触发 PATCH）；拥有者行与只读用户一律静态徽章；
 * - 所有权转让入口：仅当前登录者为 Owner 时对其他成员行开放，点击呼出阻断式
 *   二次确认（RL-06），确认回调 `onTransferOwner`；
 * - 移出成员：普通成员二次确认后回调 `onRemoveMember`；**任何**拥有者行的移除
 *   按钮一律物理置灰禁用并附带悬停 Tooltip 警示「不能移除项目拥有者，请先转让
 *   所有权」（design §3.2：既有服务端拒绝移除任意 Project Owner）；
 * - 写请求在途（busy）时全部行内控件禁用，杜绝重复提交。
 */

export interface MemberListTableProps {
  projectId: number
  /** 成员底册（就绪数组，由工作台查询持有）。 */
  members: ProjectMember[]
  /** 项目角色清单（含拥有者系统角色，下拉/邀请仅列可授予项）。 */
  roles: ProjectRole[]
  /** 是否具备成员写权限（project:member:manage / project:update）。 */
  canManageMembers: boolean
  /** 当前登录用户 id（self 行标记与转让入口判定）。 */
  currentUserId: number | null
  /** 当前登录用户是否为项目拥有者（决定转让入口可见性）。 */
  selfIsOwner: boolean
  /** 任一写请求在途（角色调整 / 转让 / 移除）。 */
  busy: boolean
  onChangeRole: (member: ProjectMember, projectRoleId: number) => void
  onTransferOwner: (member: ProjectMember) => void
  onRemoveMember: (member: ProjectMember) => void
}

export function MemberListTable({
  projectId,
  members,
  roles,
  canManageMembers,
  currentUserId,
  selfIsOwner,
  busy,
  onChangeRole,
  onTransferOwner,
  onRemoveMember,
}: MemberListTableProps) {
  const [transferTarget, setTransferTarget] = React.useState<ProjectMember | null>(null)
  const [removeTarget, setRemoveTarget] = React.useState<ProjectMember | null>(null)

  // 转让 / 移出确认弹层（RL-06 阻断式二次确认）：Escape 关闭；
  // 任一写请求在途（busy）时拒绝关闭，与弹层内「取消 / 确认」按钮的 disabled 判据一致。
  const transferDialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: transferDialogRef,
    open: transferTarget !== null,
    onClose: () => setTransferTarget(null),
    canClose: () => !busy,
  })
  const removeDialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: removeDialogRef,
    open: removeTarget !== null,
    onClose: () => setRemoveTarget(null),
    canClose: () => !busy,
  })

  const assignableRoles = React.useMemo(
    () => roles.filter((role) => isMemberRoleAssignable(role)),
    [roles],
  )

  if (members.length === 0) {
    return (
      <section
        data-member-table
        data-member-table-empty
        className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-12 text-center"
      >
        <UsersRound className="mx-auto h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
        <h3 className="mt-3 text-sm font-medium text-[var(--nx-text-primary)]">当前项目暂无成员</h3>
        <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
          通过顶部「添加成员」从组织成员中勾选加入项目，开始团队协同。
        </p>
      </section>
    )
  }

  return (
    <section
      data-member-table
      data-member-project-id={projectId}
      className="overflow-x-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <table className="w-full min-w-[54rem] border-collapse text-xs">
        <thead>
          <tr className="border-b border-[var(--nx-border-hairline)]">
            <th
              scope="col"
              className="h-9 px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]"
            >
              成员
            </th>
            <th
              scope="col"
              className="h-9 px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]"
            >
              项目角色
            </th>
            <th
              scope="col"
              className="h-9 px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]"
            >
              岗位 · 负载
            </th>
            <th
              scope="col"
              className="h-9 px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]"
            >
              加入时间
            </th>
            <th
              scope="col"
              className="h-9 whitespace-nowrap px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]"
            >
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const display = memberDisplayName(member)
            const roleName = member.projectRole?.name ?? null
            const roleLabel = memberRoleLabel(roleName)
            const isOwner = isProjectOwnerRole(roleName)
            const isSelf = member.userId === currentUserId
            // 服务端拒绝移除任何 Project Owner（project_member_service.remove），UI 一律阻断。
            const ownerRemoveBlocked = isOwner
            const canTransferRow = canManageMembers && selfIsOwner && !isSelf && !isOwner
            const canEditRole = canManageMembers && !isOwner

            return (
              <tr
                key={member.id}
                data-member-row={member.userId}
                data-member-self={isSelf ? 'true' : undefined}
                className="border-t border-[var(--nx-border-hairline)] transition-colors first:border-t-0 hover:bg-[var(--nx-bg-0)]"
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] font-mono text-[11px] font-medium text-[var(--nx-text-secondary)]"
                    >
                      {memberInitials(member)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          data-member-name
                          className="truncate font-medium text-[var(--nx-text-primary)]"
                        >
                          {display}
                        </span>
                        {isSelf ? (
                          <span className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1 py-px font-mono text-[9px] text-[var(--nx-text-muted)]">
                            我
                          </span>
                        ) : null}
                      </div>
                      <p
                        data-member-email
                        className="mt-0.5 truncate font-mono text-[10px] text-[var(--nx-text-muted)]"
                      >
                        {member.user?.email ?? '—'}
                      </p>
                    </div>
                  </div>
                </td>

                <td className="px-3 py-2.5" data-member-role-cell={member.userId}>
                  {canEditRole ? (
                    <select
                      data-member-role-select={member.userId}
                      aria-label={`调整 ${display} 的项目角色`}
                      value={member.projectRoleId !== null ? String(member.projectRoleId) : ''}
                      disabled={busy}
                      onChange={(event) => {
                        const projectRoleId = Number(event.target.value)
                        if (Number.isInteger(projectRoleId) && projectRoleId > 0) {
                          onChangeRole(member, projectRoleId)
                        }
                      }}
                      className="h-7 w-40 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-primary)] transition-colors focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {member.projectRoleId !== null &&
                      !assignableRoles.some((role) => role.id === member.projectRoleId) ? (
                        <option value={String(member.projectRoleId)} disabled>
                          {roleLabel}
                        </option>
                      ) : null}
                      {assignableRoles.map((role) => (
                        <option key={role.id} value={String(role.id)}>
                          {memberRoleLabel(role.name)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      data-member-role-badge={member.userId}
                      title={roleName ?? undefined}
                      className={cn(
                        'inline-flex h-6 max-w-40 items-center gap-1 truncate rounded-sm border px-2 text-[11px]',
                        isOwner
                          ? 'border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.08)] text-[var(--nx-status-warning)]'
                          : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]',
                      )}
                    >
                      {isOwner ? <Crown className="h-3 w-3 shrink-0" aria-hidden /> : null}
                      <span className="truncate">{roleLabel}</span>
                    </span>
                  )}
                </td>

                <td
                  data-member-workload
                  className="px-3 py-2.5 text-[11px] text-[var(--nx-text-secondary)]"
                >
                  {member.primaryRoleHint || member.workload ? (
                    <span className="flex flex-col gap-0.5">
                      {member.primaryRoleHint ? (
                        <span className="text-[var(--nx-text-primary)]">
                          {member.primaryRoleHint}
                        </span>
                      ) : null}
                      {member.workload ? (
                        <span className="text-[10px] text-[var(--nx-text-muted)]">
                          {member.workload.openTaskCount} 项未完成 ·{' '}
                          {member.workload.inProgressTaskCount} 项进行中
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-[var(--nx-text-muted)]">—</span>
                  )}
                </td>

                <td
                  data-member-joined-at
                  className="whitespace-nowrap px-3 py-2.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
                >
                  {formatMemberJoinedAt(member.createdAt)}
                </td>

                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  {canManageMembers ? (
                    <div className="flex flex-nowrap items-center justify-end gap-1.5">
                      {canTransferRow ? (
                        <button
                          type="button"
                          data-member-transfer-open={member.userId}
                          aria-label={`转让所有权给 ${display}`}
                          disabled={busy}
                          onClick={() => setTransferTarget(member)}
                          className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <UserRoundCog className="h-3 w-3" aria-hidden />
                          转让所有权
                        </button>
                      ) : null}
                      <div className="group relative">
                        <button
                          type="button"
                          data-member-remove-open={member.userId}
                          aria-label={`移除 ${display}`}
                          aria-disabled={ownerRemoveBlocked || busy}
                          disabled={ownerRemoveBlocked || busy}
                          onClick={() => setRemoveTarget(member)}
                          className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--nx-border-hairline)] disabled:hover:text-[var(--nx-text-muted)]"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                          移出
                        </button>
                        {ownerRemoveBlocked ? (
                          <span
                            role="tooltip"
                            data-member-owner-remove-tip={member.userId}
                            className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 hidden w-64 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-2 text-left text-[10px] leading-relaxed text-[var(--nx-text-secondary)] shadow-[0_8px_24px_rgba(0,0,0,0.45)] group-hover:block group-focus-within:block"
                          >
                            不能移除项目拥有者，请先转让所有权
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* 所有权转让阻断式二次确认（RL-06） */}
      {transferTarget ? (
        <div className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            aria-label="关闭转让确认弹窗"
            tabIndex={-1}
            onClick={() => setTransferTarget(null)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="确认转让项目所有权"
            data-member-transfer-dialog
            ref={transferDialogRef}
            tabIndex={-1}
            className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <header className="border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text-primary)]">
                <UserRoundCog className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
                转让项目所有权
              </h3>
            </header>
            <div className="px-5 py-4">
              <p className="text-[13px] leading-relaxed text-[var(--nx-text-secondary)]">
                转让所有权后，你将不再拥有该项目的拥有者专属管辖权（如删除项目、转让所有权），
                是否确认转让给
                <span className="mx-1 font-medium text-[var(--nx-text-primary)]">
                  {memberDisplayName(transferTarget)}
                </span>
                ？
              </p>
              <p className="mt-2 font-mono text-[10px] text-[var(--nx-text-muted)]">
                {transferTarget.user?.email ?? `#${transferTarget.userId}`} ·
                此操作将立即生效并写入审计日志
              </p>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
              <button
                type="button"
                data-member-transfer-cancel
                disabled={busy}
                onClick={() => setTransferTarget(null)}
                className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-member-transfer-confirm
                disabled={busy}
                onClick={() => {
                  const target = transferTarget
                  setTransferTarget(null)
                  onTransferOwner(target)
                }}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-status-warning)] bg-[rgba(251,191,36,0.12)] px-4 text-xs font-medium text-[var(--nx-status-warning)] transition-colors hover:bg-[var(--nx-status-warning)] hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                确认转让
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* 移出成员二次确认（RL-06） */}
      {removeTarget ? (
        <div className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            aria-label="关闭移出确认弹窗"
            tabIndex={-1}
            onClick={() => setRemoveTarget(null)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="确认移出项目成员"
            data-member-remove-dialog
            ref={removeDialogRef}
            tabIndex={-1}
            className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <header className="border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text-primary)]">
                <Trash2 className="h-4 w-4 text-[var(--nx-status-danger)]" aria-hidden />
                移出项目成员
              </h3>
            </header>
            <div className="px-5 py-4">
              <p className="text-[13px] leading-relaxed text-[var(--nx-text-secondary)]">
                移出成员将解除
                <span className="mx-1 font-medium text-[var(--nx-text-primary)]">
                  {memberDisplayName(removeTarget)}
                </span>
                在当前项目中的所有指派与权限，是否确认移出？
              </p>
              <p className="mt-2 font-mono text-[10px] text-[var(--nx-text-muted)]">
                {removeTarget.user?.email ?? `#${removeTarget.userId}`} · 此操作不可撤销
              </p>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
              <button
                type="button"
                data-member-remove-cancel
                disabled={busy}
                onClick={() => setRemoveTarget(null)}
                className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-member-remove-confirm
                disabled={busy}
                onClick={() => {
                  const target = removeTarget
                  setRemoveTarget(null)
                  onRemoveMember(target)
                }}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.12)] px-4 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                确认移出
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default MemberListTable
