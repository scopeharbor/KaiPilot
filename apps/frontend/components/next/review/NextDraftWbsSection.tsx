'use client'

import * as React from 'react'
import { Check, ChevronDown, ChevronRight, FileText, Minus } from 'lucide-react'
import type { ProjectDraftTask, ProjectDraftWbsNode } from '@aiproj/types'
import {
  buildWbsTree,
  extractMarkedValue,
  flattenWbsNodes,
  getDefaultExpandedNodeIds,
} from '@/lib/next/draft-review-helpers'
import {
  collectWbsNodes,
  resolveWbsCheckState,
  type WbsCheckState,
} from '@/lib/next/draft-selection-helpers'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

const EMPTY_TASKS: ProjectDraftTask[] = []

/**
 * WBS 分解树勾选检视（v3-ui-next-draft-confirm W1 / tasks 1.3）。
 *
 * 多层树形层级展示大纲编码（outlineCode）、节点名称与描述；叶节点挂「叶子」徽章，
 * 纯说明节点挂「说明节点」徽章；支持节点级只读展开/折叠与「全部展开/全部收起」。
 *
 * 本变更新增多选勾选交互（Checkbox 三态：checked / indeterminate / unchecked）：
 * - 每个节点行首提供受控 Checkbox，勾选变动经 `useAiDraftConfirmStore.toggleWbs`
 *   写入选择集——勾选节点自动包含其全部子孙 WBS 节点、挂载任务与完整祖先父链；
 * - 反选父节点联动取消其下属所有子节点与挂载任务；
 * - 子节点部分选中时父节点渲染半选（indeterminate）视觉态；
 * - 勾选仅作用于本地草案副本选择集，零网络请求（RL-01、RL-06）。
 *
 * 草案数据与选择集分别读取自 `useAiProjectDraftStore` / `useAiDraftConfirmStore`，
 * 保持 `wbs` 单一 props 契约不变（供既有检视容器直接挂载）。
 */
export interface NextDraftWbsSectionProps {
  wbs: ProjectDraftWbsNode[]
}

interface WbsRowProps {
  node: ProjectDraftWbsNode
  depth: number
  expanded: Set<string>
  onToggle: (nodeId: string) => void
  checkStates: ReadonlyMap<string, WbsCheckState>
  onCheck: (nodeId: string) => void
}

/** 暗黑仪器风受控 Checkbox：纯 DOM button + ARIA，选中态战术冷蓝、半选 Minus 图标。 */
function WbsCheckbox({
  node,
  checkState,
  onCheck,
}: {
  node: ProjectDraftWbsNode
  checkState: WbsCheckState
  onCheck: (nodeId: string) => void
}) {
  const ariaChecked =
    checkState === 'checked' ? true : checkState === 'indeterminate' ? 'mixed' : false
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ariaChecked}
      aria-label={`选择 WBS 节点 ${node.outlineCode} ${extractMarkedValue(node.name)}`}
      data-wbs-checkbox
      data-wbs-checkbox-id={node.id}
      onClick={() => onCheck(node.id)}
      className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)] ${
        checkState === 'unchecked'
          ? 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-transparent hover:border-[var(--nx-border-focus)]'
          : 'border-[var(--nx-workspace-blue)] bg-[var(--nx-workspace-blue)]/20 text-[var(--nx-workspace-blue)]'
      }`}
    >
      {checkState === 'indeterminate' ? (
        <Minus className="h-3 w-3" strokeWidth={3} aria-hidden />
      ) : checkState === 'checked' ? (
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
      ) : null}
    </button>
  )
}

function WbsRow({ node, depth, expanded, onToggle, checkStates, onCheck }: WbsRowProps) {
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(node.id)
  const checkState = checkStates.get(node.id) ?? 'unchecked'
  const rowId = `nx-wbs-row-${node.id}`
  const childrenId = `nx-wbs-children-${node.id}`

  return (
    <li aria-label={`WBS 节点 ${node.outlineCode} ${extractMarkedValue(node.name)}`}>
      <div className="flex items-start gap-2 py-1.5" style={{ paddingLeft: `${depth * 16}px` }}>
        <WbsCheckbox node={node} checkState={checkState} onCheck={onCheck} />
        {hasChildren ? (
          <button
            type="button"
            data-wbs-toggle
            data-wbs-node-id={node.id}
            aria-expanded={isExpanded}
            aria-controls={childrenId}
            aria-label={`${isExpanded ? '收起' : '展开'} ${node.outlineCode} ${extractMarkedValue(node.name)}`}
            onClick={() => onToggle(node.id)}
            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        ) : (
          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[var(--nx-text-muted)]">
            <ChevronRight className="h-3.5 w-3.5 opacity-0" aria-hidden />
          </span>
        )}

        <div id={rowId} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-wbs-outline-code
              className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
            >
              {node.outlineCode}
            </span>
            <span data-wbs-node-name className="text-xs font-medium text-[var(--nx-text-primary)]">
              {extractMarkedValue(node.name)}
            </span>
            {node.isLeaf ? (
              <span
                data-wbs-leaf-badge
                className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
              >
                叶子
              </span>
            ) : null}
            {node.isNote ? (
              <span
                data-wbs-note-badge
                className="rounded-sm border border-[var(--nx-status-warning)]/40 bg-[var(--nx-status-warning)]/10 px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]"
              >
                说明节点
              </span>
            ) : null}
          </div>
          {extractMarkedValue(node.description) !== '' ? (
            <p
              data-wbs-node-description
              className="mt-0.5 text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
            >
              {extractMarkedValue(node.description)}
            </p>
          ) : null}
        </div>
      </div>

      {hasChildren ? (
        <ul
          id={childrenId}
          hidden={!isExpanded}
          className="border-l border-[var(--nx-border-hairline)] pl-1"
        >
          {node.children.map((child) => (
            <WbsRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              checkStates={checkStates}
              onCheck={onCheck}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function NextDraftWbsSection({ wbs }: NextDraftWbsSectionProps) {
  const roots = React.useMemo(() => buildWbsTree(wbs), [wbs])
  const [expanded, setExpanded] = React.useState<Set<string>>(() =>
    getDefaultExpandedNodeIds(roots),
  )

  const draft = useAiProjectDraftStore((state) => state.draft)
  const mode = useAiDraftConfirmStore((state) => state.mode)
  const selection = useAiDraftConfirmStore((state) => state.selection)

  const wbsNodes = draft?.wbs ?? wbs
  const tasks = draft?.tasks ?? EMPTY_TASKS

  // 每个节点行的三态勾选判定：全部接受模式下整体视为选中（spec 默认全选），
  // 局部选择模式下按选择集与子树联动计算。
  const checkStates = React.useMemo(() => {
    const map = new Map<string, WbsCheckState>()
    if (mode === 'all') {
      for (const node of collectWbsNodes(wbsNodes)) map.set(node.id, 'checked')
      return map
    }
    for (const node of collectWbsNodes(wbsNodes)) {
      map.set(node.id, resolveWbsCheckState(selection, wbsNodes, node.id, tasks))
    }
    return map
  }, [mode, selection, wbsNodes, tasks])

  const handleCheck = React.useCallback((nodeId: string) => {
    const currentDraft = useAiProjectDraftStore.getState().draft
    if (!currentDraft) return
    useAiDraftConfirmStore.getState().toggleWbs(nodeId, currentDraft)
  }, [])

  const handleToggle = React.useCallback((nodeId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const handleExpandAll = React.useCallback(() => {
    setExpanded(new Set(flattenWbsNodes(roots).map((node) => node.id)))
  }, [roots])

  const handleCollapseAll = React.useCallback(() => {
    setExpanded(new Set())
  }, [])

  if (roots.length === 0) {
    return (
      <section aria-label="WBS 分解树" className="text-left">
        <p className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3 text-xs text-[var(--nx-text-muted)]">
          暂无 WBS 分解结构
        </p>
      </section>
    )
  }

  return (
    <section data-wbs-section aria-label="WBS 分解树" className="text-left">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
          <FileText className="h-3.5 w-3.5" aria-hidden />
          按大纲编码排序的分解树（勾选节点实施局部接受）
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-wbs-expand-all
            onClick={handleExpandAll}
            className="rounded-sm border border-[var(--nx-border-hairline)] px-2 py-0.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
          >
            全部展开
          </button>
          <button
            type="button"
            data-wbs-collapse-all
            onClick={handleCollapseAll}
            className="rounded-sm border border-[var(--nx-border-hairline)] px-2 py-0.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
          >
            全部收起
          </button>
        </div>
      </div>

      <ul
        data-wbs-tree
        className="space-y-0.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2"
      >
        {roots.map((root) => (
          <WbsRow
            key={root.id}
            node={root}
            depth={0}
            expanded={expanded}
            onToggle={handleToggle}
            checkStates={checkStates}
            onCheck={handleCheck}
          />
        ))}
      </ul>
    </section>
  )
}

export default NextDraftWbsSection
