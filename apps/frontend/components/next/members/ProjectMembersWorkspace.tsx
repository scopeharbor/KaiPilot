'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Crown, RefreshCw, ShieldAlert, UserPlus, Users } from 'lucide-react'
import { projectKeys, projectMembersApi, projectsApi, type ProjectMember } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { DomainPageHeader } from '@/components/next/common/DomainPageHeader'
import {
  isNotFoundError,
  ProjectSpaceErrorView,
  ProjectSpaceNotFoundView,
  ProjectSpaceSkeleton,
} from '@/components/next/project-space/ProjectSpaceContainer'
import {
  countProjectOwners,
  isSelfProjectOwner,
  memberDisplayName,
} from '@/lib/next/members/member-helpers'
import { MemberInviteModal } from './MemberInviteModal'
import { MemberListTable } from './MemberListTable'

/**
 * 成员域新轨主工作台（v3-ui-next-resource-team-domains W2 · tasks 2.7，
 * design §3「成员管理域架构设计」）。
 *
 * - 项目详情经 projectsApi.get 载入（与主工作面同键 projectKeys.detail，RL-04）；
 * - RL-05 组织隔离：跨组织 / HTTP 404 统一中性空态「项目不存在或已被移除」，
 *   项目归属校验通过前不挂载任何成员/角色数据请求（RL-06 防探测）；
 * - 就绪后并行拉取成员底册与项目角色清单（projectKeys.members / roles），
 *   成员总人数度量卡（总数 + 拥有者数）与底册表格同源消费；
 * - 写请求受控居中：变更角色（PATCH）/ 移出（DELETE）/ 所有权转让（POST）均由
 *   本容器触发并统一失效成员缓存，成功后 Toast 反馈、失败精准回显服务端消息；
 *   行内确认弹窗与角色下拉由 MemberListTable 呈现（RL-06 二次确认）；
 * - 写能力门禁：project:member:manage / project:update 任一即放行邀请入口与
 *   行内写控件；只读用户一律隐藏写入口并回退静态徽章；
 * - DomainPageHeader 提供「← 返回项目工作面」与顶栏面包屑联动；
 * - 三态闭环：项目骨架（ProjectSpaceSkeleton）/ 成员数据骨架 / 错误重试卡 /
 *   语义化空态；精确档（precise）停用大气光晕纯色呈现。
 */

export interface ProjectMembersWorkspaceProps {
  projectId: number
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  return fallback
}

export function ProjectMembersWorkspace({ projectId }: ProjectMembersWorkspaceProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)
  const { canAny } = usePermissions()
  const tier = useImmersionTier()

  const [inviteOpen, setInviteOpen] = React.useState(false)
  const canManageMembers = canAny(['project:member:manage', 'project:update'])

  // ---- 项目上下文（RL-05 门禁：项目未验证前不渲染任何成员数据区）----
  const {
    data: project,
    isPending: projectPending,
    isError: projectError,
    error: projectErrorInfo,
    refetch: refetchProject,
  } = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  })

  const orgMismatch =
    project !== undefined &&
    currentOrganizationId !== null &&
    project.organizationId !== currentOrganizationId
  const projectNotFound = orgMismatch || (projectError && isNotFoundError(projectErrorInfo))

  // 项目归属校验通过前（加载中 / 404 / 跨租户）成员端点零请求（RL-05/RL-06）。
  const projectVerified = project !== undefined && !orgMismatch

  // ---- 成员域数据（仅项目验证通过后启用查询）----
  const membersQuery = useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => projectMembersApi.list(projectId),
    enabled: projectVerified,
  })
  const rolesQuery = useQuery({
    queryKey: projectKeys.roles(projectId),
    queryFn: () => projectMembersApi.listRoles(projectId),
    enabled: projectVerified,
  })

  const members = membersQuery.data ?? []
  const roles = rolesQuery.data ?? []
  const memberListPending = membersQuery.isPending || rolesQuery.isPending
  const memberListError = membersQuery.isError || rolesQuery.isError
  const retryMemberList = () => {
    void membersQuery.refetch()
    void rolesQuery.refetch()
  }

  const selfIsOwner = isSelfProjectOwner(members, currentUserId)
  const ownerCount = countProjectOwners(members)
  const totalMembers = members.length

  const invalidateMembers = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) })
  }, [queryClient, projectId])

  // ---- 受控写请求（RL-06：显式确认后才发送，统一失效成员缓存）----
  const changeRoleMutation = useMutation({
    mutationFn: ({ userId, projectRoleId }: { userId: number; projectRoleId: number }) =>
      projectMembersApi.changeRole(projectId, userId, projectRoleId),
    onSuccess: () => {
      toast({ variant: 'success', title: '角色已更新', description: '成员项目角色调整已生效' })
      invalidateMembers()
    },
    onError: (error) => {
      toast({
        variant: 'error',
        title: '角色调整失败',
        description: apiErrorMessage(error, '请稍后重试'),
      })
    },
  })

  const transferOwnerMutation = useMutation({
    mutationFn: (target: ProjectMember) =>
      projectMembersApi.transferOwner(projectId, target.userId),
    onSuccess: (_result, target) => {
      toast({
        variant: 'success',
        title: '所有权已转让',
        description: `${memberDisplayName(target)} 已成为新的项目拥有者`,
      })
      invalidateMembers()
    },
    onError: (error) => {
      toast({
        variant: 'error',
        title: '所有权转让失败',
        description: apiErrorMessage(error, '请稍后重试'),
      })
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: (target: ProjectMember) => projectMembersApi.remove(projectId, target.userId),
    onSuccess: (_result, target) => {
      toast({
        variant: 'success',
        title: '成员已移出',
        description: `${memberDisplayName(target)} 已移出当前项目`,
      })
      invalidateMembers()
    },
    onError: (error) => {
      toast({
        variant: 'error',
        title: '移出成员失败',
        description: apiErrorMessage(error, '请稍后重试'),
      })
    },
  })

  const busy =
    changeRoleMutation.isPending ||
    transferOwnerMutation.isPending ||
    removeMemberMutation.isPending

  if (projectPending) {
    return <ProjectSpaceSkeleton />
  }
  if (projectNotFound) {
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  }
  if (projectError || project === undefined) {
    return (
      <ProjectSpaceErrorView
        onRetry={() => void refetchProject()}
        onBackHome={() => router.push('/next')}
      />
    )
  }

  return (
    <div
      data-members-workspace
      data-member-project-id={projectId}
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 功能域页头：返回项目工作面 + 项目名 · 成员管理 + 邀请入口 */}
      <DomainPageHeader
        projectId={projectId}
        projectName={project.name}
        domainLabel="成员管理"
        description="项目协作者底册 · 角色受控调整 · 所有权转让与成员邀请"
        actions={
          canManageMembers ? (
            <button
              type="button"
              data-member-invite-open
              onClick={() => setInviteOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              添加成员
            </button>
          ) : null
        }
      />

      {/* 成员数据三态区 */}
      {memberListError ? (
        <section
          data-member-list-error
          role="alert"
          aria-label="成员数据加载失败"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-10 text-center"
        >
          <ShieldAlert className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">
            成员底册或项目角色加载失败，请稍后重试。
          </p>
          <button
            type="button"
            data-member-list-retry
            onClick={retryMemberList}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新载入
          </button>
        </section>
      ) : memberListPending ? (
        <MembersRosterSkeleton />
      ) : (
        <>
          {/* 成员总人数度量卡 */}
          <section
            data-member-metric
            className="grid grid-cols-2 gap-3 lg:max-w-md"
            aria-label="成员人数度量"
          >
            <div className="flex items-center gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
                <Users className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
                  项目成员
                </p>
                <p
                  data-member-metric-total={totalMembers}
                  className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
                >
                  共 {totalMembers} 人
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.08)]">
                <Crown className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
                  项目拥有者
                </p>
                <p
                  data-member-metric-owners={ownerCount}
                  className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
                >
                  {ownerCount} 人
                  {selfIsOwner ? (
                    <span className="ml-1.5 align-middle font-mono text-[10px] font-normal text-[var(--nx-text-muted)]">
                      （当前账号）
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          </section>

          {/* 成员底册表格 */}
          <MemberListTable
            projectId={projectId}
            members={members}
            roles={roles}
            canManageMembers={canManageMembers}
            currentUserId={currentUserId}
            selfIsOwner={selfIsOwner}
            busy={busy}
            onChangeRole={(member, projectRoleId) =>
              changeRoleMutation.mutate({ userId: member.userId, projectRoleId })
            }
            onTransferOwner={(target) => transferOwnerMutation.mutate(target)}
            onRemoveMember={(target) => removeMemberMutation.mutate(target)}
          />
        </>
      )}

      {/* 邀请新成员模态 */}
      <MemberInviteModal
        projectId={projectId}
        open={inviteOpen}
        roles={roles}
        onClose={() => setInviteOpen(false)}
      />
    </div>
  )
}

/** 成员底册加载骨架：度量卡与表格几何同构的暗黑脉冲占位。 */
export function MembersRosterSkeleton() {
  return (
    <div
      data-member-roster-skeleton
      role="status"
      aria-label="正在加载项目成员"
      aria-busy="true"
      className="flex flex-col gap-3"
    >
      <div className="grid grid-cols-2 gap-3 lg:max-w-md">
        <div className="h-[4.5rem] animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
        <div className="h-[4.5rem] animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      </div>
      <div className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]">
        <div className="flex gap-3 px-3 py-3">
          <div className="h-3 w-40 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
          <div className="h-3 w-32 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
          <div className="h-3 w-24 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
        </div>
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="flex items-center gap-3 border-t border-[var(--nx-border-hairline)] px-3 py-3"
          >
            <div className="h-8 w-8 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-1/3 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
              <div className="h-2.5 w-1/2 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
            </div>
            <div className="h-6 w-28 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
            <div className="h-6 w-16 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default ProjectMembersWorkspace
