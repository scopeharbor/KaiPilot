/**
 * v3-organization-private-plugin-directory — PluginDirectoryWorkbench（tasks 4.1/4.2）。
 *
 * 组织私有插件目录的权限过滤浏览页：列表、状态筛选、详情（兼容性摘要 +
 * 审批摘要 + 影响计数）与管理员可见的有界受影响安装清单。
 *
 * 边界：
 * - **写入只走变更流**：审批/停止分发/恢复/回滚入口打开 `DirectoryActionDialog`，
 *   由统一插件变更流承载「提交 → 审批 → 确认」三步；本组件自身不发任何写请求。
 *   无权限的动作**不渲染**，也不显示 disabled 能力暗示（D5）；
 * - 能力表述为「组织私有目录」，不使用公开市场术语；
 * - 兼容主题（CSS Variables 语义色）与密度，键盘可达（原生 button/select）。
 */
'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  useAffectedInstallations,
  useDirectoryReleaseDetail,
  useDirectoryReleases,
} from '@/hooks/use-plugin-directory'
import { Button } from '@/components/ui/Button'
import { DirectoryActionDialog } from './DirectoryActionDialog'
import type {
  DirectoryChangeAction,
  DirectoryReleaseStatus,
  DirectorySortKey,
} from '@/lib/api/plugin-directory'

// =============================================================================
// 状态标签
// =============================================================================

const STATUS_BADGE_VARIANTS: Record<
  DirectoryReleaseStatus,
  'neutral' | 'warning' | 'success' | 'danger' | 'outline'
> = {
  draft: 'neutral',
  pending_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  deprecated: 'outline',
  withdrawn: 'danger',
}

const STATUS_LABELS: Record<DirectoryReleaseStatus, string> = {
  draft: '草稿',
  pending_review: '待审核',
  approved: '已批准',
  rejected: '已拒绝',
  deprecated: '已弃用',
  withdrawn: '已撤回',
}

function StatusBadge({ status }: { status: DirectoryReleaseStatus }) {
  return <Badge variant={STATUS_BADGE_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
}

// =============================================================================
// 示例数据来源标记（v3-plugin-fixture-market-seed tasks 4.1/4.2）
//
// 「本机示例插件库」只在 development/test/demo 环境由显式启用的 seed 流程写入，
// production 侧 guard fail closed。因此入口在 production **完全不注册**：
// `process.env.NODE_ENV` 由打包器静态替换，下面的常量在生产构建中恒为 false，
// 相关筛选、提示与徽章分支会被静态消除，不会出现在 production bundle 里。
// =============================================================================

const FIXTURE_LIBRARY_ENTRY_ENABLED = process.env.NODE_ENV !== 'production'

/** 来源过滤三态：不过滤 / 只看示例数据 / 排除示例数据。 */
type FixtureFilterValue = '' | 'only' | 'exclude'

function FixtureOriginBadge() {
  if (!FIXTURE_LIBRARY_ENTRY_ENABLED) return null
  return (
    <Badge variant="outline" title="由本机示例插件库离线写入，不是真实业务数据">
      示例数据
    </Badge>
  )
}

// =============================================================================
// 骨架 / 空态 / 错误态
// =============================================================================

function DirectorySkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="正在加载目录">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        </Card>
      ))}
    </div>
  )
}

/** 错误统一非泄露文案：跨组织/不存在目标共用同一提示，不回显目标细节。 */
function DirectoryErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-6 text-center" role="alert">
      <p className="text-sm text-destructive">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-sm hover:bg-accent/50"
      >
        重试
      </button>
    </Card>
  )
}

// =============================================================================
// 详情面板
// =============================================================================

function AffectedInstallationsSection({ releaseId }: { releaseId: string }) {
  const { data, isLoading, error } = useAffectedInstallations(releaseId)
  if (isLoading) {
    return <Skeleton className="h-16 w-full" />
  }
  if (error) {
    return <p className="text-xs text-muted-foreground">受影响安装清单暂不可用。</p>
  }
  const items = data?.data ?? []
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">当前没有安装实例引用此版本。</p>
  }
  return (
    <ul className="space-y-1" aria-label="受影响安装清单">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between text-xs">
          <span className="font-mono">{item.pluginId}</span>
          <span className="text-muted-foreground">
            v{item.version} ·{' '}
            {item.status === 'enabled'
              ? '已启用'
              : item.status === 'installed'
                ? '未启用'
                : '已卸载'}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 当前状态下允许的受控动作（与后端 registry 状态机同一裁决口径）。
 * 无权限的动作直接不出现在返回值里——不渲染，也不以 disabled 暗示存在该能力。
 */
function legalActions(
  status: DirectoryReleaseStatus,
  permissions: { canApprove: boolean; canManage: boolean; canRollback: boolean },
): DirectoryChangeAction[] {
  const actions: DirectoryChangeAction[] = []
  if (permissions.canApprove && status === 'pending_review') actions.push('approve')
  if (permissions.canManage && (status === 'approved' || status === 'deprecated')) {
    actions.push('disable')
  }
  if (permissions.canManage && status === 'withdrawn') actions.push('restore')
  if (permissions.canRollback && status === 'approved') actions.push('rollback')
  return actions
}

const ACTION_BUTTON_LABELS: Record<DirectoryChangeAction, string> = {
  approve: '批准',
  disable: '停止分发',
  restore: '恢复送审',
  rollback: '回滚到此版本',
}

function ReleaseDetailPanel({
  releaseId,
  canManageReview,
  canApprove,
  canManage,
  canRollback,
  onAction,
}: {
  releaseId: string
  canManageReview: boolean
  canApprove: boolean
  canManage: boolean
  canRollback: boolean
  onAction: (action: DirectoryChangeAction, pluginIdentity: string, version: string) => void
}) {
  const { data, isLoading, error } = useDirectoryReleaseDetail(releaseId)

  if (isLoading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-24 w-full" />
      </Card>
    )
  }
  if (error || !data) {
    return (
      <Card className="p-4" role="alert">
        <p className="text-sm text-destructive">目录条目详情加载失败。</p>
      </Card>
    )
  }

  return (
    <Card className="p-4" aria-label={`版本详情 ${data.pluginIdentity} ${data.version}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={data.status} />
          {data.fixtureOnly && <FixtureOriginBadge />}
          <Badge variant={data.compatibilityAllowed ? 'success' : 'warning'}>
            {data.compatibilityAllowed ? '宿主兼容' : '需兼容审查'}
          </Badge>
        </div>
        <span className="font-mono text-sm">v{data.version}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <dt>插件标识</dt>
          <dd className="font-mono text-foreground">{data.pluginIdentity}</dd>
        </div>
        <div>
          <dt>安装中实例</dt>
          <dd className="text-foreground">{data.impact.activeCount}</dd>
        </div>
        <div>
          <dt>历史卸载</dt>
          <dd className="text-foreground">{data.impact.uninstalledCount}</dd>
        </div>
        <div>
          <dt>最近审批轮次</dt>
          <dd className="text-foreground">
            {data.review ? `第 ${data.review.latestCycleNumber} 轮` : '尚无审批记录'}
          </dd>
        </div>
        <div>
          <dt>兼容性摘要</dt>
          <dd className="truncate font-mono text-foreground" title={data.compatibility.digest}>
            {data.compatibility.digest ? `${data.compatibility.digest.slice(0, 12)}…` : '—'}
          </dd>
        </div>
        {data.compatibility.reasonCodes.length > 0 && (
          <div className="col-span-2 sm:col-span-1">
            <dt>审查要点</dt>
            <dd className="text-foreground">{data.compatibility.reasonCodes.join('、')}</dd>
          </div>
        )}
      </dl>

      {canManageReview && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            受影响安装（仅目录事实；停用实例须经独立确认流程）
          </p>
          <AffectedInstallationsSection releaseId={releaseId} />
        </div>
      )}

      {(() => {
        const actions = legalActions(data.status, { canApprove, canManage, canRollback })
        if (actions.length === 0) return null
        return (
          <div
            className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3"
            aria-label="目录管理动作"
          >
            <span className="mr-1 text-xs text-muted-foreground">
              以下动作均需审批与最终确认后才生效：
            </span>
            {actions.map((action) => (
              <Button
                key={action}
                type="button"
                size="sm"
                variant={action === 'disable' ? 'danger' : 'secondary'}
                onClick={() => onAction(action, data.pluginIdentity, data.version)}
              >
                {ACTION_BUTTON_LABELS[action]}
              </Button>
            ))}
          </div>
        )
      })()}
    </Card>
  )
}

// =============================================================================
// 主组件
// =============================================================================

export interface PluginDirectoryWorkbenchProps {
  /** 管理员视图：持有 review/manage 权限时由页面传入 true，展开管理员可见区块。 */
  canManageReview?: boolean
  /** 持有审批权（plugin_registry:review）：渲染「批准」入口。 */
  canApprove?: boolean
  /** 持有管理权（plugin_registry:manage）：渲染「停止分发」「恢复送审」入口。 */
  canManage?: boolean
  /** 持有回滚权（plugin_registry:rollback）：渲染「回滚到此版本」入口。 */
  canRollback?: boolean
}

interface PendingAction {
  action: DirectoryChangeAction
  releaseId: string
  pluginIdentity: string
  version: string
}

export function PluginDirectoryWorkbench({
  canManageReview = false,
  canApprove = false,
  canManage = false,
  canRollback = false,
}: PluginDirectoryWorkbenchProps) {
  const [statusFilter, setStatusFilter] = useState<DirectoryReleaseStatus | ''>('')
  const [fixtureFilter, setFixtureFilter] = useState<FixtureFilterValue>('')
  const [sortKey, setSortKey] = useState<DirectorySortKey>('-createdAt')
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  // production 构建下入口未注册，来源过滤恒为「不过滤」，请求也不带该参数
  const fixtureOnly =
    FIXTURE_LIBRARY_ENTRY_ENABLED && fixtureFilter !== '' ? fixtureFilter === 'only' : undefined

  const listQuery = useDirectoryReleases({
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(fixtureOnly === undefined ? {} : { fixtureOnly }),
    sort: sortKey,
  })
  const releases = listQuery.data?.data ?? []
  const showStale = Boolean(listQuery.dataUpdatedAt) && listQuery.isStale && !listQuery.isFetching

  return (
    <section aria-label="组织私有插件目录" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">组织私有插件目录</h2>
          <p className="text-xs text-muted-foreground">
            仅本组织可见的私有插件版本；管理动作须经预览与确认流程。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="按状态筛选"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as DirectoryReleaseStatus | '')}
            className="rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="">全部状态</option>
            {(Object.keys(STATUS_LABELS) as DirectoryReleaseStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          {FIXTURE_LIBRARY_ENTRY_ENABLED && (
            <select
              aria-label="按来源筛选"
              value={fixtureFilter}
              onChange={(event) => setFixtureFilter(event.target.value as FixtureFilterValue)}
              className="rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="">全部来源</option>
              <option value="only">仅示例数据</option>
              <option value="exclude">排除示例数据</option>
            </select>
          )}
          <select
            aria-label="排序方式"
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as DirectorySortKey)}
            className="rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="-createdAt">最新优先</option>
            <option value="+createdAt">最早优先</option>
            <option value="-version">版本从高到低</option>
            <option value="+version">版本从低到高</option>
          </select>
        </div>
      </div>

      {FIXTURE_LIBRARY_ENTRY_ENABLED && (
        <p
          className="rounded-[var(--radius-sm)] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          role="note"
          aria-label="示例数据说明"
        >
          标记为「示例数据」的版本由本机示例插件库离线写入，仅用于开发与演示环境；
          它们不连接任何外部服务，也不会出现在生产环境。
        </p>
      )}

      {showStale && (
        <p className="text-xs text-warning" role="status">
          目录数据可能已过期，正在等待刷新。
        </p>
      )}

      {listQuery.isLoading ? (
        <DirectorySkeleton />
      ) : listQuery.error ? (
        <DirectoryErrorState
          message="目录加载失败，请稍后重试。"
          onRetry={() => listQuery.refetch()}
        />
      ) : releases.length === 0 ? (
        <EmptyState
          title="暂无可展示的插件版本"
          description="组织尚未发布满足当前筛选条件的私有插件版本。"
        />
      ) : (
        <ul className="space-y-2" aria-label="目录版本列表">
          {releases.map((release) => {
            const selected = release.releaseId === selectedReleaseId
            return (
              <li key={release.releaseId}>
                <button
                  type="button"
                  aria-expanded={selected}
                  onClick={() => setSelectedReleaseId(selected ? null : release.releaseId)}
                  className="w-full rounded-[var(--radius-sm)] border border-border p-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={release.status} />
                      {release.fixtureOnly && <FixtureOriginBadge />}
                      <span className="font-medium">{release.pluginIdentity}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>v{release.version}</span>
                      <span>
                        安装中 {release.activeInstallationCount}
                        {release.uninstalledInstallationCount > 0 &&
                          ` · 已卸载 ${release.uninstalledInstallationCount}`}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {selectedReleaseId && (
        <ReleaseDetailPanel
          releaseId={selectedReleaseId}
          canManageReview={canManageReview}
          canApprove={canApprove}
          canManage={canManage}
          canRollback={canRollback}
          onAction={(action, pluginIdentity, version) =>
            setPendingAction({ action, releaseId: selectedReleaseId, pluginIdentity, version })
          }
        />
      )}

      {pendingAction && (
        <DirectoryActionDialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingAction(null)
          }}
          action={pendingAction.action}
          releaseId={pendingAction.releaseId}
          pluginIdentity={pendingAction.pluginIdentity}
          version={pendingAction.version}
        />
      )}
    </section>
  )
}
