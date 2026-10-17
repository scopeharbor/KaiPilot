'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, CalendarClock, ClipboardList, PenLine, ShieldX } from 'lucide-react'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import type { ChangeRequest } from '@/lib/api/change-requests'
import { useChangeRequestDetail } from '@/hooks/use-change-requests'
import { useProjectMembers, buildMemberNameMap } from '@/hooks/use-change-requests'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import {
  isNotFoundError,
  ProjectSpaceNotFoundView,
} from '@/components/next/project-space/ProjectSpaceContainer'
import { CHANGE_REQUEST_CREATE } from './cr-permissions'
import {
  CR_IMPACT_SUMMARY_FIELDS,
  CR_TYPE_LABELS,
  CR_LIFECYCLE_MAIN,
  CR_STATUS_LABELS,
  crLifecycleIndex,
  formatCrDate,
  isCrBranchStatus,
} from './cr-meta'
import { ChangeRequestPriorityMark, ChangeRequestStatusMark } from './ChangeRequestMarks'
import { ChangeImpactAnalysisAdapter } from './ChangeImpactAnalysisAdapter'
import { ChangeApprovalConsole } from './ChangeApprovalConsole'
import { ChangeAuditComments } from './ChangeAuditComments'
import { NewChangeRequestForm } from './NewChangeRequestForm'
import { cn } from '@/lib/utils'

/**
 * 变更请求详情与审批主页容器（v3-ui-next-risk-change-domains W2 · tasks 2.5，
 * design Decision 5 / spec「变更请求受控审批流与全生命周期闭环」）。
 *
 * - 项目组织归属 + 变更实体双层校验：跨租户项目与变更实体不存在一律中性 404
 *   （RL-05，文案零存在性线索）；变更实体 404 使用同款中性空态「变更请求不存在
 *   或已被移除」；
 * - 内容装配：元数据头部（CR 编码/标题/状态/类型/优先级/各阶段时间戳/决策原因/
 *   附加条件）→ 全生命周期状态机指示条 → 变更描述与初始六维影响摘要 → 六维影响
 *   分析适配面板 → 审批决策控制台 → 结构化审计评论区；
 * - 草稿/退回态且请求人本人：就地展开编辑表单（复用 NewChangeRequestForm
 *   mode='edit'，含 AI 影响分析辅助浮层）；
 * - 骨架/错误/空态完备（aria-busy），沉浸阶梯 precise 档停用空间光晕。
 */

export interface ChangeRequestDetailPageProps {
  projectId: number
  changeRequestId: number
}

export function ChangeRequestDetailPage({
  projectId,
  changeRequestId,
}: ChangeRequestDetailPageProps) {
  const router = useRouter()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)
  const register = useProjectSpaceEntityStore((state) => state.register)
  const clear = useProjectSpaceEntityStore((state) => state.clear)
  const { can } = usePermissions()
  const tier = useImmersionTier()
  const canCreate = can(CHANGE_REQUEST_CREATE)

  const [editing, setEditing] = React.useState(false)

  // ---- 项目上下文（RL-05）----
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

  // ---- 变更实体 ----
  const {
    data: crData,
    isPending: crPending,
    isError: crError,
    error: crErrorInfo,
    refetch: refetchCr,
  } = useChangeRequestDetail(changeRequestId)
  const cr: ChangeRequest | undefined = crData?.data
  const crNotFound = crError && isNotFoundError(crErrorInfo)

  // ---- 申请人名映射 ----
  const { data: members } = useProjectMembers(projectId)
  const memberNameMap = React.useMemo(() => buildMemberNameMap(members), [members])
  const nameOf = (userId: number | null | undefined): string => {
    if (userId === null || userId === undefined) return '-'
    return memberNameMap.get(userId) ?? `#${userId}`
  }

  // ---- 顶栏坐标联动 ----
  React.useEffect(() => {
    if (project !== undefined && !orgMismatch) {
      register(projectId, project.name)
    } else {
      clear(projectId)
    }
    return () => clear(projectId)
  }, [project, orgMismatch, projectId, register, clear])

  // 编辑资格：草稿/退回态 + 请求人本人 + change_request:create
  const requesterIsSelf =
    cr?.requesterId !== null && cr?.requesterId !== undefined && cr.requesterId === currentUserId
  const canEditDraft =
    cr !== undefined &&
    (cr.status === 'draft' || cr.status === 'returned') &&
    requesterIsSelf &&
    canCreate

  if (projectPending) {
    return <ChangeRequestDetailSkeleton />
  }
  if (projectNotFound) {
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  }
  if (projectError || project === undefined) {
    return (
      <ChangeRequestDetailErrorView
        onRetry={() => void refetchProject()}
        onBackHome={() => router.push('/next')}
      />
    )
  }

  if (crPending) {
    return <ChangeRequestDetailSkeleton />
  }
  if (crNotFound) {
    // RL-05 中性 404：变更实体不存在/跨组织一律此文案，零泄露
    return (
      <div
        data-cr-detail-not-found
        role="status"
        aria-label="变更请求不存在或已被移除"
        className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
      >
        <ClipboardList className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          变更请求不存在或已被移除
        </h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-cr-detail-not-found-back-list
            onClick={() => router.push(`/next/projects/${projectId}/change-requests`)}
            className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            返回变更请求列表
          </button>
          <button
            type="button"
            onClick={() => router.push('/next')}
            className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            返回角色首页
          </button>
        </div>
      </div>
    )
  }
  if (crError || cr === undefined) {
    return (
      <ChangeRequestDetailErrorView
        onRetry={() => void refetchCr()}
        onBackHome={() => router.push(`/next/projects/${projectId}`)}
      />
    )
  }

  return (
    <div
      data-cr-detail
      data-cr-project-id={projectId}
      data-cr-id={changeRequestId}
      className={cn(
        'flex flex-col gap-4',
        tier === 'precise' ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere',
      )}
    >
      {/* 域头部：返回项目空间 + 项目坐标 + 返回列表 */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href={`/next/projects/${projectId}`}
            aria-label="返回项目主空间"
            data-cr-back-to-space
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <ClipboardList className="h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
          <h2 className="shrink-0 text-sm font-semibold text-[var(--nx-text-primary)]">变更请求</h2>
          <span
            data-cr-detail-code
            className="shrink-0 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            {cr.crCode ?? `CR-${cr.id}`}
          </span>
          <span className="hidden min-w-0 truncate text-xs text-[var(--nx-text-secondary)] sm:inline-block">
            {project.name}
          </span>
        </div>
        <Link
          href={`/next/projects/${projectId}/change-requests`}
          data-cr-detail-back-list
          className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          返回变更请求列表
        </Link>
      </header>

      {editing && canEditDraft ? (
        <NewChangeRequestForm
          projectId={projectId}
          mode="edit"
          crId={cr.id}
          initial={cr}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {/* 标题与状态元数据头部 */}
          <section
            data-cr-detail-header
            className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1
                  data-cr-detail-title
                  className="text-lg font-semibold leading-snug text-[var(--nx-text-primary)]"
                >
                  {cr.title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ChangeRequestStatusMark status={cr.status} />
                  <span
                    data-cr-detail-type
                    className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                  >
                    类型 · {CR_TYPE_LABELS[cr.changeType] ?? cr.changeType}
                  </span>
                  <ChangeRequestPriorityMark priority={cr.priority} />
                  {canEditDraft ? (
                    <button
                      type="button"
                      data-cr-detail-edit
                      onClick={() => setEditing(true)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                    >
                      <PenLine className="h-3 w-3" aria-hidden />
                      编辑基本信息
                    </button>
                  ) : null}
                </div>
              </div>
              <dl
                data-cr-detail-meta
                className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-3 lg:grid-cols-4"
              >
                <MetaEntry label="申请人" value={nameOf(cr.requestedBy ?? cr.requesterId)} />
                <MetaEntry label="创建时间" value={formatCrDate(cr.createdAt)} />
                <MetaEntry label="提交时间" value={formatCrDate(cr.submittedAt)} />
                <MetaEntry label="审批人" value={nameOf(cr.approverId ?? cr.reviewedBy)} skipDash />
                <MetaEntry label="批准时间" value={formatCrDate(cr.approvedAt)} skipDash />
                <MetaEntry label="实施时间" value={formatCrDate(cr.implementedAt)} skipDash />
                <MetaEntry label="关闭时间" value={formatCrDate(cr.closedAt)} skipDash />
              </dl>
            </div>

            {/* 决策原因与附加生效条件（历史决策回显） */}
            {(cr.decisionReason ?? null) !== null || (cr.conditions ?? null) !== null ? (
              <div className="flex flex-col gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5">
                {(cr.decisionReason ?? null) !== null ? (
                  <p
                    data-cr-detail-decision-reason
                    className="text-xs leading-relaxed text-[var(--nx-text-secondary)]"
                  >
                    <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
                      决策原因
                    </span>
                    {cr.decisionReason}
                  </p>
                ) : null}
                {(cr.conditions ?? null) !== null ? (
                  <p
                    data-cr-detail-conditions
                    className="text-xs leading-relaxed text-[var(--nx-text-secondary)]"
                  >
                    <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
                      附加条件
                    </span>
                    {cr.conditions}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* 全生命周期状态机指示条 */}
            <ChangeRequestLifecycleTrack status={cr.status} />
          </section>

          {/* 变更描述与初始六维影响摘要 */}
          <section
            data-cr-detail-description
            className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-4"
          >
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
                变更描述
              </h3>
              <p
                data-cr-detail-description-text
                className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--nx-text-secondary)]"
              >
                {cr.description || '暂无变更描述。'}
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
                初始六维影响摘要
              </h3>
              {cr.impactSummary && Object.values(cr.impactSummary).some(Boolean) ? (
                <dl data-cr-detail-impact-summary className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
                  {CR_IMPACT_SUMMARY_FIELDS.map((field) => {
                    const value = cr.impactSummary?.[field.key]
                    return typeof value === 'string' && value.trim() !== '' ? (
                      <div key={field.key} data-cr-detail-impact-field={field.key}>
                        <dt className="text-[10px] font-medium text-[var(--nx-text-muted)]">
                          {field.label}
                        </dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                          {value}
                        </dd>
                      </div>
                    ) : null
                  })}
                </dl>
              ) : (
                <p className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-3 text-xs text-[var(--nx-text-muted)]">
                  尚未录入初始六维影响摘要。
                </p>
              )}
            </div>
          </section>

          {/* 六维影响分析适配面板 */}
          <ChangeImpactAnalysisAdapter
            projectId={projectId}
            changeRequestId={changeRequestId}
            currentAnalysisId={cr.currentImpactAnalysisId}
          />

          {/* 审批决策控制台 */}
          <ChangeApprovalConsole projectId={projectId} cr={cr} />

          {/* 结构化审计评论区 */}
          <ChangeAuditComments projectId={projectId} changeRequestId={changeRequestId} />
        </>
      )}
    </div>
  )
}

function MetaEntry({
  label,
  value,
  skipDash = false,
}: {
  label: string
  value: string
  skipDash?: boolean
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="shrink-0 text-[10px] text-[var(--nx-text-muted)]">{label}</dt>
      <dd
        data-cr-meta={label}
        className={cn('truncate text-[11px] text-[var(--nx-text-secondary)]')}
      >
        {skipDash && value === '-' ? '' : value}
      </dd>
    </div>
  )
}

/** 全生命周期状态机指示条（主轴 6 步 + 分支终止态标记）。 */
export function ChangeRequestLifecycleTrack({ status }: { status: ChangeRequest['status'] }) {
  const currentIndex = crLifecycleIndex(status)
  const branch = isCrBranchStatus(status)

  return (
    <div
      data-cr-lifecycle
      data-cr-lifecycle-status={status}
      aria-label={`生命周期状态：${CR_STATUS_LABELS[status]}`}
      className="flex flex-wrap items-center gap-x-0 gap-y-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {CR_LIFECYCLE_MAIN.map((step, index) => {
          const reached = currentIndex >= 0 && index < currentIndex
          const isCurrent = index === currentIndex
          const future = currentIndex >= 0 && index > currentIndex
          return (
            <React.Fragment key={step}>
              {index > 0 ? (
                <ArrowRight
                  aria-hidden
                  className={cn(
                    'h-3 w-3 shrink-0',
                    reached || isCurrent
                      ? 'text-[var(--nx-accent)]'
                      : 'text-[var(--nx-text-muted)]',
                  )}
                />
              ) : null}
              <span
                data-cr-lifecycle-node={step}
                data-cr-lifecycle-node-state={
                  branch || future ? 'muted' : isCurrent ? 'current' : 'reached'
                }
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[10px]',
                  !branch && isCurrent
                    ? 'border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] font-medium text-[var(--nx-accent)]'
                    : !branch && reached
                      ? 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]'
                      : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
                )}
              >
                {index + 1}.{CR_STATUS_LABELS[step]}
              </span>
            </React.Fragment>
          )
        })}
      </div>
      {branch ? (
        <span
          data-cr-lifecycle-branch={status}
          className={cn(
            'ml-1 inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[10px] font-medium',
            status === 'returned'
              ? 'border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] text-[var(--nx-status-warning)]'
              : 'border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.08)] text-[var(--nx-status-danger)]',
          )}
        >
          {status === 'returned' ? (
            <PenLine className="h-3 w-3" aria-hidden />
          ) : (
            <CalendarClock className="h-3 w-3" aria-hidden />
          )}
          {status === 'returned'
            ? '已退回修改 · 可重新提交审批'
            : `${CR_STATUS_LABELS[status]} · 流程终止`}
        </span>
      ) : null}
    </div>
  )
}

/** 加载骨架（1:1 结构，杜绝空态闪烁）。 */
export function ChangeRequestDetailSkeleton() {
  return (
    <div
      data-cr-detail-skeleton
      role="status"
      aria-label="正在加载变更请求详情"
      aria-busy="true"
      className="flex flex-col gap-4"
    >
      <div className="h-12 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      <div className="h-36 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      <div className="h-28 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      <div className="h-48 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
    </div>
  )
}

/** 域级错误卡（500/断网）：重新载入 + 返回角色首页。 */
export function ChangeRequestDetailErrorView({
  onRetry,
  onBackHome,
}: {
  onRetry: () => void
  onBackHome: () => void
}) {
  return (
    <div
      role="alert"
      aria-label="变更请求详情加载失败"
      data-cr-detail-error
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
    >
      <ShieldX className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">变更请求详情加载失败</h3>
      <p className="text-xs text-[var(--nx-text-muted)]">
        数据加载失败，请稍后重试或返回项目空间。
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-cr-detail-retry
          onClick={onRetry}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          重新载入
        </button>
        <button
          type="button"
          data-cr-detail-back-home
          onClick={onBackHome}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          返回项目空间
        </button>
      </div>
    </div>
  )
}

export default ChangeRequestDetailPage
