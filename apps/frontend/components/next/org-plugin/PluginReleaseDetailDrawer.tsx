'use client'

/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.2 —— 插件 release 详情抽屉。
 *
 * 组织私有目录 release 详情的只读治理抽屉：
 * - 事实表（状态/兼容性/审批轮次/影响计数/审查要点）；
 * - 受影响安装清单（canManageReview = 持 review 或 manage 权限才渲染；有界列表，
 *   纯只读呈现——「目录事实，实例停用须走独立确认流程」）；
 * - 变更集（统一变更流历史：plugin_change_request:view + 治理视野双门，只读）；
 * - 目录管理动作菜单（按 plugin_registry:review|manage|rollback 渲染；无权限动作
 *   不渲染、不以 disabled 暗示存在性），动作经 PluginReleaseActionDialog
 *   「提交 → 审批 → 最终确认」闭环（RL-06）；
 * - 三态：详情骨架 / 错误中性重试 / 各子区语义化空态。
 */
import * as React from 'react'
import { AlertTriangle, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAffectedInstallations, useDirectoryReleaseDetail } from '@/hooks/use-plugin-directory'
import { usePluginChangeRequests } from '@/hooks/use-plugin-change-requests'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { usePermissions } from '@/hooks/use-permissions'
import type {
  AffectedInstallationItem,
  DirectoryChangeAction,
  DirectoryReleaseDetail,
} from '@/lib/api/plugin-directory'
import type { DirectoryActionPermissions } from '@/lib/next/org-plugin/org-plugin-adapter'
import {
  DIRECTORY_ACTION_LABELS,
  changeRequestKindLabel,
  changeRequestStateLabel,
  directoryReleaseStatusMetaOf,
  formatPluginDate,
  hasAnyDirectoryAction,
  installationStatusLabel,
  legalDirectoryActions,
} from '@/lib/next/org-plugin/org-plugin-adapter'
import { PluginReleaseActionDialog } from './PluginReleaseActionDialog'

const chipClass =
  'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] leading-none'

function shortUid(uid: string): string {
  return uid.length > 10 ? `${uid.slice(0, 10)}…` : uid
}

export interface PluginReleaseDetailDrawerProps {
  /** 选中 releaseId；null = 关闭。 */
  releaseId: string | null
  onClose: () => void
}

export function PluginReleaseDetailDrawer({ releaseId, onClose }: PluginReleaseDetailDrawerProps) {
  const { can } = usePermissions()

  const open = releaseId !== null
  const { data, isLoading, isError, refetch } = useDirectoryReleaseDetail(releaseId)
  const [pendingAction, setPendingAction] = React.useState<DirectoryChangeAction | null>(null)

  React.useEffect(() => {
    if (!open) setPendingAction(null)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && pendingAction === null) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pendingAction, onClose])

  if (!open) return null

  const canApprove = can('plugin_registry:review')
  const canManage = can('plugin_registry:manage')
  const canRollback = can('plugin_registry:rollback')
  const canManageReview = canApprove || canManage
  const canViewChangeRequests = can('plugin_change_request:view')
  const actionPermissions = { canApprove, canManage, canRollback }

  return (
    <div data-plugin-release-detail-drawer className="fixed inset-0 z-40" role="presentation">
      <button
        type="button"
        aria-label="关闭详情抽屉"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="插件版本详情"
        className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[-24px_0_64px_rgba(0,0,0,0.45)]"
      >
        {/* 抽屉头 */}
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
            <h3 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
              插件版本详情
            </h3>
          </div>
          <button
            type="button"
            data-plugin-detail-close
            aria-label="关闭"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </header>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div
              data-plugin-detail-skeleton
              aria-busy="true"
              role="status"
              aria-label="正在加载插件版本详情"
              className="space-y-2"
            >
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-8 animate-pulse rounded-md bg-[var(--nx-bg-1)]"
                  aria-hidden
                />
              ))}
            </div>
          ) : isError || !data ? (
            <div
              data-plugin-detail-error
              role="alert"
              className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
            >
              <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">目录条目详情加载失败</p>
              <button
                type="button"
                data-plugin-detail-retry
                onClick={() => void refetch()}
                className="flex h-8 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                重新加载
              </button>
            </div>
          ) : (
            <ReleaseDetailBody
              detail={data}
              actionPermissions={actionPermissions}
              canManageReview={canManageReview}
              canViewChangeRequests={canViewChangeRequests}
              pendingAction={pendingAction}
              onRequestAction={(action) => setPendingAction(action)}
            />
          )}
        </div>
      </div>

      {data && pendingAction ? (
        <PluginReleaseActionDialog
          action={pendingAction}
          releaseId={data.releaseId}
          pluginIdentity={data.pluginIdentity}
          version={data.version}
          status={data.status}
          onClose={() => setPendingAction(null)}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 详情主体（数据就绪后渲染）
// ---------------------------------------------------------------------------

function ReleaseDetailBody({
  detail,
  actionPermissions,
  canManageReview,
  canViewChangeRequests,
  pendingAction,
  onRequestAction,
}: {
  detail: DirectoryReleaseDetail
  actionPermissions: DirectoryActionPermissions
  canManageReview: boolean
  canViewChangeRequests: boolean
  pendingAction: DirectoryChangeAction | null
  onRequestAction: (action: DirectoryChangeAction) => void
}) {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const statusMeta = directoryReleaseStatusMetaOf(detail.status)
  const actions = legalDirectoryActions(detail.status, actionPermissions)
  const showChangeSet = canManageReview && canViewChangeRequests && organizationId !== null
  const changeSetQuery = usePluginChangeRequests(organizationId ?? 0, {
    pluginId: detail.pluginIdentity,
    page: 1,
    perPage: 8,
  })

  return (
    <div className="flex flex-col gap-4" data-plugin-detail-body>
      {/* 徽标行 */}
      <div className="flex flex-wrap items-center gap-2">
        {statusMeta ? (
          <span
            data-plugin-detail-status={detail.status}
            title={statusMeta.description}
            className={cn(chipClass, statusMeta.chipClass)}
          >
            {statusMeta.label}
          </span>
        ) : null}
        {detail.fixtureOnly ? (
          <span
            data-plugin-fixture-badge
            title="由本机示例插件库离线写入，不是真实业务数据"
            className={cn(
              chipClass,
              'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
            )}
          >
            示例数据
          </span>
        ) : null}
        <span
          data-plugin-detail-compat={detail.compatibilityAllowed ? 'allowed' : 'review'}
          className={cn(
            chipClass,
            detail.compatibilityAllowed
              ? 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)] text-[var(--nx-status-success)]'
              : 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]',
          )}
        >
          {detail.compatibilityAllowed ? '宿主兼容' : '需兼容审查'}
        </span>
      </div>

      {/* 事实表 */}
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3.5 text-[11px]">
        <div>
          <dt className="text-[var(--nx-text-muted)]">插件标识</dt>
          <dd
            data-plugin-detail-identity
            className="mt-0.5 break-all font-mono text-[var(--nx-text-primary)]"
          >
            {detail.pluginIdentity}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--nx-text-muted)]">版本</dt>
          <dd data-plugin-detail-version className="mt-0.5 font-mono text-[var(--nx-text-primary)]">
            v{detail.version}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--nx-text-muted)]">安装中实例</dt>
          <dd data-plugin-detail-active-count className="mt-0.5 text-[var(--nx-text-primary)]">
            {detail.impact.activeCount}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--nx-text-muted)]">历史卸载</dt>
          <dd data-plugin-detail-uninstalled-count className="mt-0.5 text-[var(--nx-text-primary)]">
            {detail.impact.uninstalledCount}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--nx-text-muted)]">最近审批轮次</dt>
          <dd data-plugin-detail-review className="mt-0.5 text-[var(--nx-text-primary)]">
            {detail.review ? `第 ${detail.review.latestCycleNumber} 轮` : '尚无审批记录'}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--nx-text-muted)]">兼容性摘要</dt>
          <dd
            data-plugin-detail-digest
            className="mt-0.5 truncate font-mono text-[var(--nx-text-primary)]"
            title={detail.compatibility.digest}
          >
            {detail.compatibility.digest ? `${detail.compatibility.digest.slice(0, 12)}…` : '—'}
          </dd>
        </div>
        {detail.compatibility.reasonCodes.length > 0 ? (
          <div className="col-span-2">
            <dt className="text-[var(--nx-text-muted)]">审查要点</dt>
            <dd className="mt-0.5 text-[var(--nx-text-primary)]">
              {detail.compatibility.reasonCodes.join('、')}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[var(--nx-text-muted)]">创建时间</dt>
          <dd data-plugin-detail-created className="mt-0.5 text-[var(--nx-text-primary)]">
            {formatPluginDate(detail.createdAt)}
          </dd>
        </div>
      </dl>

      {/* 受影响安装（治理视野；只读事实，实例停用须独立确认） */}
      {canManageReview ? (
        <section
          aria-label="受影响安装清单"
          className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3.5"
        >
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
            受影响安装（仅目录事实；停用实例须经独立确认流程）
          </h4>
          <AffectedInstallationsSection releaseId={detail.releaseId} />
        </section>
      ) : null}

      {/* 变更集（统一变更流历史，只读） */}
      {showChangeSet ? (
        <section
          aria-label="变更集"
          className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3.5"
        >
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
            变更集（统一变更流历史）
          </h4>
          {changeSetQuery.isLoading ? (
            <div className="space-y-1.5 py-2" aria-busy="true">
              <div className="h-5 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
              <div className="h-5 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
            </div>
          ) : changeSetQuery.isError ? (
            <p data-plugin-changeset-error className="py-2 text-[11px] text-[var(--nx-text-muted)]">
              变更集暂不可用。
            </p>
          ) : (changeSetQuery.data?.data ?? []).length === 0 ? (
            <p data-plugin-changeset-empty className="py-2 text-[11px] text-[var(--nx-text-muted)]">
              当前没有与该版本关联的变更请求。
            </p>
          ) : (
            <ul data-plugin-changeset-list className="flex flex-col py-1.5">
              {(changeSetQuery.data?.data ?? []).map((request) => (
                <li
                  key={request.id}
                  data-plugin-changeset-row={request.id}
                  className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)]/60 py-1.5 text-[11px] last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        chipClass,
                        'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]',
                      )}
                    >
                      {changeRequestKindLabel(request.kind)}
                    </span>
                    <span className="truncate font-mono text-[var(--nx-text-muted)]">
                      {shortUid(request.id)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[var(--nx-text-muted)]">
                    <span data-plugin-changeset-state>
                      {changeRequestStateLabel(request.state)}
                    </span>
                    <span>{formatPluginDate(request.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* 目录管理动作（无权限动作不渲染；全部须经审批与最终确认） */}
      {hasAnyDirectoryAction(detail.status, actionPermissions) ? (
        <section
          aria-label="目录管理动作"
          data-plugin-detail-actions
          className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3.5"
        >
          <p className="w-full text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
            目录管理动作（均需审批与最终确认后才生效）
          </p>
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              data-plugin-action={action}
              disabled={pendingAction !== null}
              onClick={() => onRequestAction(action)}
              className={cn(
                'flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                action === 'disable' || action === 'rollback'
                  ? 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)] hover:border-[var(--nx-status-danger)]'
                  : 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)] hover:border-[var(--nx-accent)]',
              )}
            >
              {DIRECTORY_ACTION_LABELS[action]}
            </button>
          ))}
        </section>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 受影响安装清单（有界；错误中性呈现）
// ---------------------------------------------------------------------------

function AffectedInstallationsSection({ releaseId }: { releaseId: string }) {
  const { data, isLoading, error } = useAffectedInstallations(releaseId)
  if (isLoading) {
    return (
      <div className="space-y-1.5 py-1.5" aria-busy="true">
        <div className="h-5 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-5 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
      </div>
    )
  }
  if (error) {
    return (
      <p data-plugin-affected-error className="py-1.5 text-[11px] text-[var(--nx-text-muted)]">
        受影响安装清单暂不可用。
      </p>
    )
  }
  const items = data?.data ?? []
  if (items.length === 0) {
    return (
      <p data-plugin-affected-empty className="py-1.5 text-[11px] text-[var(--nx-text-muted)]">
        当前没有安装实例引用此版本。
      </p>
    )
  }
  return (
    <ul data-plugin-affected-list className="flex flex-col py-1.5">
      {items.map((item: AffectedInstallationItem) => (
        <li
          key={item.id}
          data-plugin-affected-row={item.id}
          className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)]/60 py-1.5 text-[11px] last:border-b-0"
        >
          <span className="truncate font-mono text-[var(--nx-text-primary)]">{item.pluginId}</span>
          <span className="flex shrink-0 items-center gap-2 text-[var(--nx-text-muted)]">
            <span>v{item.version}</span>
            <span data-plugin-affected-status>{installationStatusLabel(item.status)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
