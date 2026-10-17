'use client'

import * as React from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  AlertTriangle,
  Trash2,
  RefreshCw,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

/**
 * Copilot 记得什么 —— 只读视图 + 逐条操作（v3-copilot-memory-user-and-project §8）。
 *
 * - 按 scope 分组展示（user / project / organization）
 * - 每条记忆显示：inferred 视觉标识 + 置信度 + 来源溯源 + 时效标签
 * - 逐条操作：编辑 / 失效 / 删除（删除给不可恢复提示）
 * - 候选确认交互：忽略候选零成本
 * - 无后端连接时显示占位态
 */

export interface MemoryEntry {
  readonly id: string
  readonly scope: 'user' | 'project' | 'organization'
  readonly summary: string
  readonly tags: readonly string[]
  readonly confidence: number
  readonly status: string
  readonly validityTier: string
  readonly observedAt: string
  readonly lastConfirmedAt?: string
  readonly basisCount: number
}

interface CopilotMemoryViewProps {
  /** 记忆条目列表（缺省为空数组）。 */
  memories?: readonly MemoryEntry[]
  /** 是否加载中。 */
  loading?: boolean
  /** 确认候选回调。 */
  onConfirm?: (entryId: string) => void
  /** 忽略候选回调。 */
  onIgnore?: (entryId: string) => void
  /** 编辑回调。 */
  onEdit?: (entryId: string) => void
  /** 失效回调。 */
  onInvalidate?: (entryId: string) => void
  /** 删除回调。 */
  onDelete?: (entryId: string) => void
}

/** Scope 分组标题。 */
const SCOPE_LABELS: Record<string, string> = {
  user: '用户偏好',
  project: '项目约定',
  organization: '组织约定',
}

/** 状态视觉映射。 */
type MemoryStatusConfig = { icon: LucideIcon; color: string; label: string }

/** 未知状态回退（noUncheckedIndexedAccess 下索引访问可能为 undefined）。 */
const STATUS_FALLBACK: MemoryStatusConfig = { icon: Eye, color: 'text-blue-500', label: '待确认' }

const STATUS_CONFIG: Record<string, MemoryStatusConfig> = {
  candidate: STATUS_FALLBACK,
  confirmed: { icon: Check, color: 'text-green-500', label: '已确认' },
  edited: { icon: Edit3, color: 'text-yellow-500', label: '已编辑' },
  possibly_outdated: { icon: AlertTriangle, color: 'text-orange-500', label: '可能过期' },
  invalidated: { icon: EyeOff, color: 'text-gray-400', label: '已失效' },
}

/** 时效档标签。 */
const TIER_LABELS: Record<string, string> = {
  ephemeral: '临时',
  short: '短期',
  medium: '中期',
  long: '长期',
  durable: '持久',
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level = confidence >= 0.85 ? 'high' : confidence >= 0.5 ? 'medium' : 'low'
  const colors = {
    high: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    low: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
        colors[level],
      )}
    >
      {Math.round(confidence * 100)}%
    </span>
  )
}

function MemoryEntryCard({
  entry,
  onConfirm,
  onIgnore,
  onEdit,
  onInvalidate,
  onDelete,
}: {
  entry: MemoryEntry
  onConfirm?: (id: string) => void
  onIgnore?: (id: string) => void
  onEdit?: (id: string) => void
  onInvalidate?: (id: string) => void
  onDelete?: (id: string) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const statusConfig = STATUS_CONFIG[entry.status] ?? STATUS_FALLBACK
  const StatusIcon = statusConfig.icon

  return (
    <div
      role="article"
      aria-label={`记忆条目：${entry.summary.slice(0, 50)}（${statusConfig.label}，置信度 ${Math.round(entry.confidence * 100)}%）`}
      className={cn(
        'rounded-lg border border-border bg-card p-3 transition-colors',
        entry.status === 'candidate' &&
          'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20',
        entry.status === 'possibly_outdated' &&
          'border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20',
      )}
    >
      {/* 头部：inferred 标识 + scope + 状态 + 置信度 */}
      <div className="flex items-center gap-2 text-xs">
        <span
          aria-label="此内容为推断，非已验证事实"
          className="inline-flex items-center gap-1 rounded bg-purple-100 px-1.5 py-0.5 font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
        >
          <Brain className="h-3 w-3" aria-hidden="true" />
          推断
        </span>
        <span className={cn('flex items-center gap-1', statusConfig.color)}>
          <StatusIcon className="h-3 w-3" aria-hidden="true" />
          {statusConfig.label}
        </span>
        <ConfidenceBadge confidence={entry.confidence} />
        <span className="text-muted-foreground">
          {TIER_LABELS[entry.validityTier] ?? entry.validityTier}
        </span>
      </div>

      {/* 内容摘要 */}
      <p className="mt-2 min-w-0 text-sm leading-relaxed break-words">{entry.summary}</p>

      {/* 标签 */}
      {entry.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 展开：溯源 + 操作 */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={`memory-detail-${entry.id}`}
        className={cn(
          'mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground',
          focusRing,
        )}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {expanded ? '收起' : `来源 · ${entry.basisCount} 条对话`}
      </button>

      {expanded && (
        <div
          id={`memory-detail-${entry.id}`}
          role="region"
          aria-label="记忆详情与操作"
          className="mt-2 space-y-2 border-t border-border pt-2"
        >
          {/* 溯源 */}
          <p className="text-xs text-muted-foreground">
            来自 {entry.basisCount} 条对话消息 · 观察于{' '}
            {new Date(entry.observedAt).toLocaleDateString('zh-CN')}
            {entry.lastConfirmedAt && (
              <> · 确认于 {new Date(entry.lastConfirmedAt).toLocaleDateString('zh-CN')}</>
            )}
          </p>

          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-2">
            {entry.status === 'candidate' && (
              <>
                {onConfirm && (
                  <button
                    onClick={() => onConfirm(entry.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700',
                      focusRing,
                    )}
                  >
                    <Check className="h-3 w-3" /> 确认
                  </button>
                )}
                {onIgnore && (
                  <button
                    onClick={() => onIgnore(entry.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary',
                      focusRing,
                    )}
                  >
                    忽略
                  </button>
                )}
              </>
            )}
            {entry.status !== 'candidate' && entry.status !== 'invalidated' && (
              <>
                {onEdit && (
                  <button
                    onClick={() => onEdit(entry.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary',
                      focusRing,
                    )}
                  >
                    <Edit3 className="h-3 w-3" /> 编辑
                  </button>
                )}
                {onInvalidate && (
                  <button
                    onClick={() => onInvalidate(entry.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary',
                      focusRing,
                    )}
                  >
                    <EyeOff className="h-3 w-3" /> 失效
                  </button>
                )}
                {onDelete && !confirmDelete && (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded border border-destructive/50 px-2 py-1 text-xs text-destructive hover:bg-destructive/10',
                      focusRing,
                    )}
                  >
                    <Trash2 className="h-3 w-3" /> 删除
                  </button>
                )}
                {onDelete && confirmDelete && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-destructive">确认删除？不可恢复。</span>
                    <button
                      onClick={() => {
                        onDelete(entry.id)
                        setConfirmDelete(false)
                      }}
                      className={cn(
                        'rounded bg-destructive px-2 py-1 text-xs text-white hover:bg-destructive/90',
                        focusRing,
                      )}
                    >
                      确认删除
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className={cn(
                        'rounded border border-border px-2 py-1 text-xs hover:bg-secondary',
                        focusRing,
                      )}
                    >
                      取消
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function CopilotMemoryView({
  memories = [],
  loading = false,
  onConfirm,
  onIgnore,
  onEdit,
  onInvalidate,
  onDelete,
}: CopilotMemoryViewProps) {
  // 按 scope 分组
  const grouped = React.useMemo(() => {
    const groups: Record<string, MemoryEntry[]> = { user: [], project: [], organization: [] }
    for (const m of memories) {
      const key = m.scope in groups ? m.scope : 'user'
      ;(groups[key] ?? groups.user!).push(m)
    }
    return groups
  }, [memories])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        加载中…
      </div>
    )
  }

  if (memories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
        <Brain className="mb-3 h-8 w-8 opacity-50" />
        <p className="text-sm">Copilot 还没有记住任何内容。</p>
        <p className="mt-1 text-xs">随着对话进行，Copilot 会从你的对话中推断偏好和约定。</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-1">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Brain className="h-4 w-4" />
        Copilot 记得什么
      </h3>
      {(Object.entries(grouped) as [string, MemoryEntry[]][]).map(
        ([scope, entries]) =>
          entries.length > 0 && (
            <div key={scope}>
              <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                {SCOPE_LABELS[scope] ?? scope}（{entries.length}）
              </h4>
              <div className="space-y-2">
                {entries.map((entry) => (
                  <MemoryEntryCard
                    key={entry.id}
                    entry={entry}
                    onConfirm={onConfirm}
                    onIgnore={onIgnore}
                    onEdit={onEdit}
                    onInvalidate={onInvalidate}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </div>
          ),
      )}
    </div>
  )
}
