'use client'

/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.2 —— 插件目录 release 底册列表。
 *
 * 组织私有目录 release 生命周期底册（Layer 2 暗黑仪器感）：
 * - 顶栏：状态筛选 / 来源筛选（仅非 production 注册）/ 排序，全部本地状态回传工作台
 *   （URL 稳定，目录页状态不落 query——与旧轨 PluginDirectoryWorkbench 一致）；
 * - 行：状态徽标（双通道：语义色 + 文字）、示例数据来源徽标、插件标识、版本与
 *   受影响安装计数（formatAffectedInstallationSummary）；
 * - 三态闭环：几何匹配骨架行（aria-busy）、语义化空态、错误重试；
 * - 本组件纯只读：点击行把选中态回传工作台（详情抽屉在别处），零写请求。
 */
import * as React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  DirectoryReleaseListItem,
  DirectoryReleaseStatus,
  DirectorySortKey,
} from '@/lib/api/plugin-directory'
import {
  DIRECTORY_RELEASE_STATUS_OPTIONS,
  directoryReleaseStatusMetaOf,
  formatAffectedInstallationSummary,
} from '@/lib/next/org-plugin/org-plugin-adapter'

/** 来源过滤三态：不过滤 / 只看示例数据 / 排除示例数据。 */
export type PluginFixtureFilter = '' | 'only' | 'exclude'

const chipClass =
  'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] leading-none'

export interface PluginReleaseListProps {
  statusFilter: DirectoryReleaseStatus | ''
  fixtureFilter: PluginFixtureFilter
  sortKey: DirectorySortKey
  releases: readonly DirectoryReleaseListItem[]
  isLoading: boolean
  isError: boolean
  showStale: boolean
  /** 非 production 才展示示例数据来源筛选与说明。 */
  fixtureEntryEnabled: boolean
  selectedReleaseId: string | null
  onStatusFilterChange: (status: DirectoryReleaseStatus | '') => void
  onFixtureFilterChange: (value: PluginFixtureFilter) => void
  onSortKeyChange: (sort: DirectorySortKey) => void
  onToggleRelease: (releaseId: string) => void
  onRetry: () => void
  onResetFilters: () => void
}

export function PluginReleaseList({
  statusFilter,
  fixtureFilter,
  sortKey,
  releases,
  isLoading,
  isError,
  showStale,
  fixtureEntryEnabled,
  selectedReleaseId,
  onStatusFilterChange,
  onFixtureFilterChange,
  onSortKeyChange,
  onToggleRelease,
  onRetry,
  onResetFilters,
}: PluginReleaseListProps) {
  const hasFilters = statusFilter !== '' || fixtureFilter !== ''
  return (
    <section aria-label="插件目录版本底册" className="flex flex-col gap-3">
      {/* 筛选条 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="按状态筛选"
          data-plugin-filter-status
          value={statusFilter}
          onChange={(event) =>
            onStatusFilterChange(event.target.value as DirectoryReleaseStatus | '')
          }
          className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        >
          <option value="">全部状态</option>
          {DIRECTORY_RELEASE_STATUS_OPTIONS.map((meta) => (
            <option key={meta.status} value={meta.status}>
              {meta.label}
            </option>
          ))}
        </select>
        {fixtureEntryEnabled ? (
          <select
            aria-label="按来源筛选"
            data-plugin-filter-fixture
            value={fixtureFilter}
            onChange={(event) => onFixtureFilterChange(event.target.value as PluginFixtureFilter)}
            className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          >
            <option value="">全部来源</option>
            <option value="only">仅示例数据</option>
            <option value="exclude">排除示例数据</option>
          </select>
        ) : null}
        <select
          aria-label="排序方式"
          data-plugin-filter-sort
          value={sortKey}
          onChange={(event) => onSortKeyChange(event.target.value as DirectorySortKey)}
          className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        >
          <option value="-createdAt">最新优先</option>
          <option value="+createdAt">最早优先</option>
          <option value="-version">版本从高到低</option>
          <option value="+version">版本从低到高</option>
        </select>
        {hasFilters ? (
          <button
            type="button"
            data-plugin-filter-reset
            onClick={onResetFilters}
            className="flex h-8 items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            重置筛选
          </button>
        ) : null}
        {showStale ? (
          <span
            data-plugin-list-stale
            role="status"
            className="text-[11px] text-[var(--nx-status-warning)]"
          >
            目录数据可能已过期，正在等待刷新
          </span>
        ) : null}
      </div>

      {fixtureEntryEnabled ? (
        <p
          role="note"
          aria-label="示例数据说明"
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]/60 px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
        >
          标记为「示例数据」的版本由本机示例插件库离线写入，仅用于开发与演示环境；
          它们不连接任何外部服务，也不会出现在生产环境。
        </p>
      ) : null}

      {/* 三态主体 */}
      {isLoading ? (
        <div
          data-plugin-releases-skeleton
          role="status"
          aria-label="正在加载插件目录"
          aria-busy="true"
          className="space-y-1.5"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-md bg-[var(--nx-bg-1)]"
              aria-hidden
            />
          ))}
        </div>
      ) : isError ? (
        <div
          data-plugin-releases-error
          role="alert"
          aria-label="插件目录加载错误"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">插件目录加载失败</p>
          <p className="max-w-md text-[11px] text-[var(--nx-text-muted)]">
            请稍后重试；若持续失败请联系组织管理员。
          </p>
          <button
            type="button"
            data-plugin-releases-retry
            onClick={onRetry}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新加载
          </button>
        </div>
      ) : releases.length === 0 ? (
        <div
          data-plugin-releases-empty
          className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <p className="text-sm text-[var(--nx-text-secondary)]">
            {hasFilters ? '暂无满足当前筛选条件的插件版本' : '组织私有目录暂无插件版本'}
          </p>
          {hasFilters ? (
            <button
              type="button"
              data-plugin-empty-reset
              onClick={onResetFilters}
              className="h-8 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              清除筛选条件
            </button>
          ) : (
            <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              组织尚未发布满足当前筛选条件的私有插件版本。
            </p>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="插件版本列表">
          {releases.map((release) => {
            const meta = directoryReleaseStatusMetaOf(release.status)
            const selected = release.releaseId === selectedReleaseId
            return (
              <li key={release.releaseId}>
                <button
                  type="button"
                  data-plugin-release-row={release.releaseId}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onToggleRelease(release.releaseId)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-md border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                    selected
                      ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]'
                      : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] hover:border-[var(--nx-border-focus)]/50',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {meta ? (
                      <span
                        data-plugin-release-status={release.status}
                        title={meta.description}
                        className={cn(chipClass, meta.chipClass)}
                      >
                        {meta.label}
                      </span>
                    ) : null}
                    {release.fixtureOnly ? (
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
                      data-plugin-release-identity
                      className="truncate font-mono text-[13px] text-[var(--nx-text-primary)]"
                      title={release.pluginIdentity}
                    >
                      {release.pluginIdentity}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-4 text-[11px] text-[var(--nx-text-muted)]">
                    <span data-plugin-release-version className="font-mono">
                      v{release.version}
                    </span>
                    <span data-plugin-release-impact>
                      {formatAffectedInstallationSummary({
                        activeCount: release.activeInstallationCount,
                        uninstalledCount: release.uninstalledInstallationCount,
                      })}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default PluginReleaseList
