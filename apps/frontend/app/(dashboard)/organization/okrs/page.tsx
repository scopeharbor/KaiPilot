'use client'

// OKR 层级管理工作台首页（v3-okr-hierarchy-management §6.3）。
// 首屏：周期选择、筛选、目标树、KR 摘要、warning/freshness 与详情入口。

import { useState } from 'react'
import { useOkrTree, useOkrCycles } from '@/hooks/use-okr'
import type { OkrTreeQuery, OkrScope, OkrStatus, OkrObjectiveTree } from '@aiproj/types'
import { cn } from '@/lib/utils'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { Alert } from '@/components/ui/Alert'

export default function OkrWorkbenchPage() {
  // 路由 `/organization/okrs` 没有 :organizationId 参数（幽灵参数修复）：
  // 组织 id 一律从 auth store 的有效租户上下文取，取不到（未选择组织）时不发任何查询。
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }
  return <OkrWorkbench organizationId={organizationId} />
}

function OkrWorkbench({ organizationId }: { organizationId: number }) {
  const [selectedCycleId, setSelectedCycleId] = useState<number | undefined>()
  const [scopeFilter, setScopeFilter] = useState<OkrScope | undefined>()
  const [statusFilter, setStatusFilter] = useState<OkrStatus | undefined>()

  const treeQuery: OkrTreeQuery = {
    cycleId: selectedCycleId,
    scope: scopeFilter,
    status: statusFilter,
    depth: 5,
  }

  const { data: cyclesData, isLoading: cyclesLoading } = useOkrCycles(organizationId, {})
  const { data: treeData, isLoading: treeLoading, error } = useOkrTree(organizationId, treeQuery)

  const cycles = cyclesData?.data ?? []
  const tree = treeData?.data ?? []
  const meta = treeData?.meta

  if (cyclesLoading || treeLoading) {
    return <div className="p-6 text-muted-foreground">加载中...</div>
  }

  if (error) {
    return <div className="p-6 text-destructive">加载失败：{(error as Error).message}</div>
  }

  return (
    <div className="p-6 space-y-4" data-testid="okr-workbench">
      {/* 头部：周期选择 + 筛选 */}
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">OKR 层级管理</h1>

        <select
          className="border rounded px-3 py-1.5 text-sm"
          value={selectedCycleId ?? ''}
          onChange={(e) => setSelectedCycleId(e.target.value ? Number(e.target.value) : undefined)}
          aria-label="选择 OKR 周期"
        >
          <option value="">全部周期</option>
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>

        <select
          className="border rounded px-3 py-1.5 text-sm"
          value={scopeFilter ?? ''}
          onChange={(e) => setScopeFilter((e.target.value || undefined) as OkrScope | undefined)}
          aria-label="按范围筛选"
        >
          <option value="">全部范围</option>
          <option value="organization">组织</option>
          <option value="team">团队</option>
          <option value="project">项目</option>
        </select>

        <select
          className="border rounded px-3 py-1.5 text-sm"
          value={statusFilter ?? ''}
          onChange={(e) => setStatusFilter((e.target.value || undefined) as OkrStatus | undefined)}
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="active">活跃</option>
          <option value="paused">暂停</option>
          <option value="completed">已完成</option>
        </select>

        {meta && (
          <span className="text-xs text-muted-foreground">
            共 {meta.totalNodes} 个节点 · 最大深度 {meta.maxDepth}
            {meta.truncated && ' · 已截断'}
          </span>
        )}
      </div>

      {/* Warnings */}
      {meta?.warnings && meta.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
          {meta.warnings.map((w, i) => (
            <div key={i}>{w.message}</div>
          ))}
        </div>
      )}

      {/* 空态 */}
      {tree.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          暂无 OKR 数据。请先创建 OKR 周期和目标。
        </div>
      )}

      {/* 目标树 */}
      <div className="space-y-2">
        {tree.map((node) => (
          <ObjectiveTreeNode key={node.objective.id} node={node} depth={0} />
        ))}
      </div>
    </div>
  )
}

// ── 递归树节点 ────────────────────────────────────────────────────────────

function ObjectiveTreeNode({ node, depth }: { node: OkrObjectiveTree; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2)
  const { objective, children, keyResults } = node

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-200 text-gray-700',
    active: 'bg-green-200 text-green-800',
    paused: 'bg-amber-200 text-amber-800',
    completed: 'bg-blue-200 text-blue-800',
    archived: 'bg-red-200 text-red-800',
  }

  const confidenceIcons: Record<string, string> = {
    high: '●',
    medium: '◐',
    low: '○',
  }

  return (
    <div className="border-l-2 border-border pl-4" style={{ marginLeft: depth * 16 }}>
      <div className="flex items-center gap-2 py-2 group">
        {/* 展开/折叠 */}
        {children.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs w-5 h-5 flex items-center justify-center hover:bg-muted rounded"
            aria-label={expanded ? '折叠' : '展开'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}

        {/* 状态徽标 */}
        <span
          className={cn(
            'text-xs px-1.5 py-0.5 rounded',
            statusColors[objective.status] ?? 'bg-gray-100',
          )}
        >
          {objective.status}
        </span>

        {/* scope 标签 */}
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {objective.scope}
        </span>

        {/* 标题 */}
        <span className="font-medium text-sm">{objective.title}</span>

        {/* 进度 */}
        <span className="text-xs text-muted-foreground ml-auto">
          {confidenceIcons[objective.confidence] ?? '?'} {objective.progress}%
        </span>

        {/* KR 摘要 */}
        {keyResults.length > 0 && (
          <span className="text-xs text-muted-foreground">{keyResults.length} KR</span>
        )}
      </div>

      {/* KR 列表（展开时显示） */}
      {expanded && keyResults.length > 0 && (
        <div className="ml-6 space-y-1 mb-2">
          {keyResults.map((kr) => (
            <div key={kr.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-3 h-3 rounded-full bg-primary/20 inline-block" />
              <span className="flex-1">{kr.title}</span>
              <span>
                {kr.currentValue}/{kr.targetValue}
              </span>
              <span>{confidenceIcons[kr.confidence]}</span>
            </div>
          ))}
        </div>
      )}

      {/* 子节点 */}
      {expanded &&
        children.map((child) => (
          <ObjectiveTreeNode key={child.objective.id} node={child} depth={depth + 1} />
        ))}
    </div>
  )
}
