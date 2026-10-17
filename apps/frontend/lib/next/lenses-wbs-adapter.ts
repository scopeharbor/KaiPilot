/**
 * WBS 结构俯瞰镜头（v3-ui-next-remaining-lenses W1）—— 纯函数数据适配层。
 *
 * 独立于其它镜头适配文件（lenses-*-adapter.ts 按镜头拆分，防并行开发冲突），
 * 仅依赖 `lib/wbs-tree.ts` 的 `flattenVisibleWbs` 与 `WbsNode` 类型。
 *
 * 职责（tasks 1.1 / design「WBS 树适配纯函数」）：
 * - `computeVisibleWbsRows(nodes, collapsedSet)`：以 `collapsedSet` 为**权威**折叠态
 *   （覆盖节点自带的 `collapsed` 字段），借道 `flattenVisibleWbs` 输出 DFS 有序可见行，
 *   并附加 `depth`（遍历层级）、`hasChildren`、`childCount`（直属子项数）与
 *   `isExpanded`（有子项且未折叠）元数据；
 * - `createInitialCollapsedSet(nodes)`：初始折叠集（尊重接口返回的 `collapsed`）；
 * - `buildCollapseToSecondLevelSet(nodes)`：折叠至 L2 —— 仅保留根节点（L1）与
 *   一级子工作包（L2）展开，将 `depth >= 2` 且具子项的非叶子节点全部收起
 *   （语义与旧轨 WbsTree 「折叠至第 2 层」一致）。
 *
 * 纯函数、零 DOM / React 状态依赖，jsdom 与 SSR 均可用。
 */

import type { WbsNode } from '@/lib/api/wbs'
import { flattenVisibleWbs } from '@/lib/wbs-tree'

/** WBS 可见行视图模型（design `VisibleWbsRowItem`）。 */
export interface VisibleWbsRowItem {
  node: WbsNode
  /** 遍历层级（自根节点 0 起算），用于缩进像素偏移。 */
  depth: number
  /** 是否拥有直属子节点（在 nodes 数组中可寻址）。 */
  hasChildren: boolean
  /** 当前是否处于展开态（有子项且未被折叠集命中）。 */
  isExpanded: boolean
  /** 直属子项数量（「3 个子项」展示用）。 */
  childCount: number
}

/** 统计每个节点的直属子项数。 */
function countChildrenByParent(nodes: WbsNode[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const node of nodes) {
    if (node.parentId !== null) {
      counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * 将后端平铺 `WbsNode[]` 拍平为当前展开态下的可见行列表。
 *
 * 折叠判定只消费 `collapsedSet`：命中即折叠（连同整棵子树一起隐藏），
 * 未命中即展开——与节点负载中的 `collapsed` 字段无关（该字段仅用于
 * 组件首屏经 `createInitialCollapsedSet` 播种初始集合）。
 */
export function computeVisibleWbsRows(
  nodes: WbsNode[],
  collapsedSet: ReadonlySet<number>,
): VisibleWbsRowItem[] {
  const childCounts = countChildrenByParent(nodes)
  const overlaid = nodes.map((node) =>
    node.collapsed === collapsedSet.has(node.id)
      ? node
      : { ...node, collapsed: collapsedSet.has(node.id) },
  )
  return flattenVisibleWbs(overlaid).map(({ node, depth }) => {
    const childCount = childCounts.get(node.id) ?? 0
    return {
      node,
      depth,
      hasChildren: childCount > 0,
      isExpanded: childCount > 0 && !collapsedSet.has(node.id),
      childCount,
    }
  })
}

/** 初始折叠集合：尊重接口返回的各节点 `collapsed` 属性。 */
export function createInitialCollapsedSet(nodes: WbsNode[]): Set<number> {
  const set = new Set<number>()
  for (const node of nodes) {
    if (node.collapsed) set.add(node.id)
  }
  return set
}

/**
 * 「折叠至 L2」目标集合：收起全部 `depth >= 2` 且具子项的非叶子节点，
 * 仅保留根节点（L1）与一级子工作包（L2）展开。
 */
export function buildCollapseToSecondLevelSet(nodes: WbsNode[]): Set<number> {
  const childCounts = countChildrenByParent(nodes)
  const set = new Set<number>()
  for (const node of nodes) {
    if (node.depth >= 2 && (childCounts.get(node.id) ?? 0) > 0) {
      set.add(node.id)
    }
  }
  return set
}

/** 挂在 WBS 工作包下的任务（tasks.wbs_node_id）。 */
export interface WbsLensTask {
  id: number
  name: string
  status: string
  startDate: string | null
  endDate: string | null
  wbsNodeId: number | null
}

/** 镜头行：WBS 节点行或其下的任务行。 */
export type WbsLensEntry =
  | { kind: 'node'; item: VisibleWbsRowItem; taskCount: number }
  | { kind: 'task'; task: WbsLensTask; depth: number; parentNodeId: number }

/**
 * 把任务插到所属工作包行之后（节点展开时才显示）。
 * 只有任务、没有子节点的工作包也可展开/折叠；节点自身绑定的任务（`node.taskId`）不重复成行。
 */
export function interleaveWbsTaskRows(
  rows: VisibleWbsRowItem[],
  tasks: readonly WbsLensTask[],
  collapsedSet: ReadonlySet<number>,
): WbsLensEntry[] {
  const tasksByNode = new Map<number, WbsLensTask[]>()
  for (const task of tasks) {
    if (task.wbsNodeId === null) continue
    const list = tasksByNode.get(task.wbsNodeId) ?? []
    list.push(task)
    tasksByNode.set(task.wbsNodeId, list)
  }
  const entries: WbsLensEntry[] = []
  for (const row of rows) {
    const nodeTasks = (tasksByNode.get(row.node.id) ?? []).filter(
      (task) => task.id !== row.node.taskId,
    )
    const hasChildren = row.hasChildren || nodeTasks.length > 0
    const isExpanded = hasChildren && !collapsedSet.has(row.node.id)
    entries.push({
      kind: 'node',
      item: hasChildren === row.hasChildren ? row : { ...row, hasChildren, isExpanded },
      taskCount: nodeTasks.length,
    })
    if (!isExpanded) continue
    for (const task of nodeTasks) {
      entries.push({ kind: 'task', task, depth: row.depth + 1, parentNodeId: row.node.id })
    }
  }
  return entries
}

/** 聚焦任务需要展开的祖先节点（含所属工作包本身）。 */
export function wbsAncestorIds(nodes: readonly WbsNode[], nodeId: number): number[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids: number[] = []
  let current = byId.get(nodeId)
  while (current && ids.length < 64) {
    ids.push(current.id)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return ids
}
