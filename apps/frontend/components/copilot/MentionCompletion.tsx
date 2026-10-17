'use client'

import * as React from 'react'
import type {
  MentionReference,
  CompletionMentionCandidate,
  MentionableEntityType,
} from '@aiproj/types'
import { DEFAULT_MAX_CANDIDATES, DEBOUNCE_MS } from '@aiproj/types'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

// ===========================================================================
// 类型
// ===========================================================================

interface MentionCompletionProps {
  /** 选中候选时的回调。 */
  onSelect: (ref: MentionReference) => void
  /** 查询候选的异步函数，接收前缀。 */
  queryFn: (prefix: string) => Promise<CompletionMentionCandidate[]>
  /** 最大候选数。 */
  maxCandidates?: number
  /** 当前激活状态。 */
  active: boolean
  /** @ 后输入的前缀。 */
  prefix: string
  /** 触发偏移量（@ 在输入文本中的位置）。 */
  triggerOffset: number
  /** 取消补全的回调。 */
  onCancel: () => void
  /** 关联的 textarea 元素引用（用于定位）。 */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

// ===========================================================================
// 实体类型图标映射
// ===========================================================================

const ENTITY_TYPE_LABELS: Record<MentionableEntityType, string> = {
  project: '项目',
  task: '任务',
  milestone: '里程碑',
  risk: '风险',
  member: '成员',
  document: '文档',
  file: '文件',
  report: '报告',
  change_request: '变更',
  comment: '评论',
  ocr_document: 'OCR 文档',
  external_link: '外部链接',
  wbs_node: 'WBS 节点',
}

// ===========================================================================
// 组件
// ===========================================================================

export function MentionCompletion({
  onSelect,
  queryFn,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  active,
  prefix,
  onCancel,
}: MentionCompletionProps) {
  const [candidates, setCandidates] = React.useState<readonly CompletionMentionCandidate[]>([])
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement>(null)
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // 查询候选
  React.useEffect(() => {
    if (!active) {
      setCandidates([])
      setSelectedIndex(0)
      return
    }

    // 清除之前的 debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    setLoading(true)

    debounceTimerRef.current = setTimeout(() => {
      queryFn(prefix)
        .then((results) => {
          setCandidates(results.slice(0, maxCandidates))
          setSelectedIndex(0)
        })
        .catch(() => {
          setCandidates([])
          setSelectedIndex(0)
        })
        .finally(() => {
          setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [active, prefix, queryFn, maxCandidates])

  // 键盘导航
  React.useEffect(() => {
    if (!active) return

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % Math.max(candidates.length, 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev <= 0 ? Math.max(candidates.length - 1, 0) : prev - 1))
          break
        case 'Enter':
          if (candidates.length > 0 && selectedIndex >= 0 && selectedIndex < candidates.length) {
            e.preventDefault()
            handleSelect(candidates[selectedIndex]!)
          }
          break
        case 'Escape':
          e.preventDefault()
          onCancel()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [active, candidates, selectedIndex, onCancel])

  // 选中候选
  const handleSelect = React.useCallback(
    (candidate: CompletionMentionCandidate) => {
      const ref: MentionReference = {
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        label: candidate.label,
        organizationId: 1, // TODO: 从上下文获取
        projectId: candidate.projectId,
      }
      onSelect(ref)
    },
    [onSelect],
  )

  // 自动滚动到选中项
  React.useEffect(() => {
    if (listRef.current) {
      const item = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      if (item) {
        item.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  if (!active) return null

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="实体提及候选"
      aria-activedescendant={
        selectedIndex >= 0 && selectedIndex < candidates.length
          ? `mention-option-${selectedIndex}`
          : undefined
      }
      className={cn(
        'absolute bottom-full left-0 z-50 mb-1 w-full max-h-60 overflow-y-auto',
        'rounded-[var(--radius-md)] border border-border bg-surface shadow-lg',
      )}
    >
      {loading && candidates.length === 0 && (
        <div className="px-3 py-2 text-sm text-gray-400">搜索中…</div>
      )}

      {!loading && candidates.length === 0 && (
        <div className="px-3 py-2 text-sm text-gray-400">未找到匹配的实体</div>
      )}

      {candidates.map((candidate, index) => (
        <button
          key={`mention:${candidate.entityType}:${candidate.entityId}`}
          id={`mention-option-${index}`}
          role="option"
          aria-selected={index === selectedIndex}
          data-index={index}
          type="button"
          onClick={() => handleSelect(candidate)}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
            index === selectedIndex
              ? 'bg-[var(--primary-50)] text-[var(--primary-600)]'
              : 'hover:bg-gray-50',
            focusRing,
          )}
        >
          {/* 实体类型图标占位 */}
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-100 text-[10px] text-gray-500"
            aria-hidden
          >
            {ENTITY_TYPE_LABELS[candidate.entityType]?.charAt(0) ?? '?'}
          </span>

          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{candidate.label}</div>
            {candidate.summary && (
              <div className="truncate text-xs text-gray-400">{candidate.summary}</div>
            )}
          </div>

          <span className="shrink-0 text-[10px] text-gray-300">
            {ENTITY_TYPE_LABELS[candidate.entityType]}
          </span>
        </button>
      ))}
    </div>
  )
}
