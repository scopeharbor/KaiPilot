/**
 * v3-plugin-private-registry-lifecycle — PluginRegistryList 组件（task 8.3 partial）。
 *
 * 组织私有插件目录列表：展示低敏 identity/version/digest/compatibility/status。
 * 空态、加载、错误与无权限状态兼容主题和密度。
 */
'use client'

import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'

// =============================================================================
// Types
// =============================================================================

type RegistryReleaseStatus =
  'draft' | 'pending_review' | 'approved' | 'rejected' | 'deprecated' | 'withdrawn'

interface PluginRegistryEntry {
  entryId: string
  pluginIdentity: string
  pluginName: string
  recommendedVersion: string | null
  releaseCount: number
  latestApprovedVersion: string | null
  latestStatus: RegistryReleaseStatus
  createdAt: string
  updatedAt: string
}

interface PluginRegistryListProps {
  entries: PluginRegistryEntry[]
  loading?: boolean
  error?: string
  onSelect?: (entry: PluginRegistryEntry) => void
}

// =============================================================================
// Status Badge
// =============================================================================

type BadgeVariant = ComponentProps<typeof Badge>['variant']

/** 状态 → Badge 变体（本仓库 Badge 无 secondary/destructive，用 neutral/danger）。 */
const STATUS_VARIANTS: Record<RegistryReleaseStatus, BadgeVariant> = {
  draft: 'neutral',
  pending_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  deprecated: 'outline',
  withdrawn: 'danger',
}

const STATUS_LABELS: Record<RegistryReleaseStatus, string> = {
  draft: '草稿',
  pending_review: '待审核',
  approved: '已批准',
  rejected: '已拒绝',
  deprecated: '已弃用',
  withdrawn: '已撤回',
}

function StatusBadge({ status }: { status: RegistryReleaseStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function PluginRegistryListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        </Card>
      ))}
    </div>
  )
}

// =============================================================================
// Empty State
// =============================================================================

function PluginRegistryEmptyState() {
  return <EmptyState title="暂无私有插件" description="组织尚未登记任何私有插件目录条目。" />
}

// =============================================================================
// Error State
// =============================================================================

function PluginRegistryErrorState({ message }: { message: string }) {
  return (
    <Card className="p-6 text-center">
      <p className="text-sm text-destructive">{message}</p>
    </Card>
  )
}

// =============================================================================
// Entry Card
// =============================================================================

function PluginRegistryEntryCard({
  entry,
  onSelect,
}: {
  entry: PluginRegistryEntry
  onSelect?: (entry: PluginRegistryEntry) => void
}) {
  return (
    <Card
      className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onSelect?.(entry)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-medium">{entry.pluginName || entry.pluginIdentity}</span>
          <StatusBadge status={entry.latestStatus} />
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {entry.recommendedVersion && <span>推荐: v{entry.recommendedVersion}</span>}
          <span>{entry.releaseCount} 个版本</span>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {entry.pluginIdentity}
        {entry.latestApprovedVersion && (
          <span className="ml-2">最新批准: v{entry.latestApprovedVersion}</span>
        )}
      </div>
    </Card>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function PluginRegistryList({
  entries,
  loading = false,
  error,
  onSelect,
}: PluginRegistryListProps) {
  if (loading) return <PluginRegistryListSkeleton />
  if (error) return <PluginRegistryErrorState message={error} />
  if (entries.length === 0) return <PluginRegistryEmptyState />

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <PluginRegistryEntryCard key={entry.entryId} entry={entry} onSelect={onSelect} />
      ))}
    </div>
  )
}
