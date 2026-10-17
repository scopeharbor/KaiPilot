'use client'

/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.2 —— 插件目录主工作台。
 *
 * 组织私有插件目录（/next/organization/plugin-directory）的 Layer 2 暗黑仪器感工作台：
 * - 数据 100% 复用既有 use-plugin-directory hooks（GET /plugin-directory/releases，
 *   组织 ID 取 JWT 租户上下文，零手搓 organizationId 注入）；
 * - release 底册（PluginReleaseList：状态/来源/排序筛选、三态闭环）→ 点击行打开
 *   PluginReleaseDetailDrawer（事实表/受影响安装/变更集/动作菜单）→ 动作统一走
 *   PluginReleaseActionDialog「提交 → 审批 → 最终确认」闭环（RL-06）；
 * - 页面级权限 plugin_registry:view 由路由页整页把关（本组件只在已授权后挂载）；
 * - 动作级权限（review/manage/rollback）由抽屉内按需渲染，无权限不渲染；
 * - 沉浸阶梯：immersive/light 消费 .nx-space-atmosphere 深空光晕，precise 纯色降级。
 */
import * as React from 'react'
import { Package, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDirectoryReleases } from '@/hooks/use-plugin-directory'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import type { DirectoryReleaseStatus, DirectorySortKey } from '@/lib/api/plugin-directory'
import { PluginReleaseList, type PluginFixtureFilter } from './PluginReleaseList'
import { PluginReleaseDetailDrawer } from './PluginReleaseDetailDrawer'

/** 示例数据来源入口：非 production 才注册（生产构建被静态消除）。 */
const FIXTURE_LIBRARY_ENTRY_ENABLED = process.env.NODE_ENV !== 'production'

export function PluginDirectoryWorkspace() {
  const tier = useImmersionTier()
  const [statusFilter, setStatusFilter] = React.useState<DirectoryReleaseStatus | ''>('')
  const [fixtureFilter, setFixtureFilter] = React.useState<PluginFixtureFilter>('')
  const [sortKey, setSortKey] = React.useState<DirectorySortKey>('-createdAt')
  const [selectedReleaseId, setSelectedReleaseId] = React.useState<string | null>(null)

  const fixtureOnly =
    FIXTURE_LIBRARY_ENTRY_ENABLED && fixtureFilter !== '' ? fixtureFilter === 'only' : undefined

  const listQuery = useDirectoryReleases({
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(fixtureOnly === undefined ? {} : { fixtureOnly }),
    sort: sortKey,
  })
  const releases = listQuery.data?.data ?? []
  const showStale = Boolean(listQuery.dataUpdatedAt) && listQuery.isStale && !listQuery.isFetching

  const resetFilters = () => {
    setStatusFilter('')
    setFixtureFilter('')
    setSortKey('-createdAt')
  }

  return (
    <div
      data-plugin-directory-workspace
      aria-busy={listQuery.isLoading || listQuery.isFetching}
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Package className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">插件目录</h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              组织私有插件版本目录 · 分发生命周期治理 · 管理动作均经审批与最终确认后生效
            </p>
          </div>
        </div>
        <button
          type="button"
          data-plugin-refresh
          aria-label="刷新插件目录"
          onClick={() => void listQuery.refetch()}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          刷新
        </button>
      </header>

      {/* release 底册 */}
      <PluginReleaseList
        statusFilter={statusFilter}
        fixtureFilter={fixtureFilter}
        sortKey={sortKey}
        releases={releases}
        isLoading={listQuery.isLoading}
        isError={Boolean(listQuery.error)}
        showStale={showStale}
        fixtureEntryEnabled={FIXTURE_LIBRARY_ENTRY_ENABLED}
        selectedReleaseId={selectedReleaseId}
        onStatusFilterChange={setStatusFilter}
        onFixtureFilterChange={setFixtureFilter}
        onSortKeyChange={setSortKey}
        onToggleRelease={(releaseId) =>
          setSelectedReleaseId((current) => (current === releaseId ? null : releaseId))
        }
        onRetry={() => void listQuery.refetch()}
        onResetFilters={resetFilters}
      />

      {/* 详情抽屉（含动作确认闭环） */}
      <PluginReleaseDetailDrawer
        releaseId={selectedReleaseId}
        onClose={() => setSelectedReleaseId(null)}
      />
    </div>
  )
}

export default PluginDirectoryWorkspace
