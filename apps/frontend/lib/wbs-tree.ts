import type { MoveWbsNodeInput, WbsNode } from '@/lib/api/wbs'

export interface VisibleWbsRow {
  node: WbsNode
  depth: number
}

function groupByParent(nodes: WbsNode[]): Map<number | null, WbsNode[]> {
  const groups = new Map<number | null, WbsNode[]>()
  for (const node of nodes) {
    const group = groups.get(node.parentId) ?? []
    group.push(node)
    groups.set(node.parentId, group)
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id)
  }
  return groups
}

/** 将后端平铺树转换为仅包含展开节点的可视行。 */
export function flattenVisibleWbs(nodes: WbsNode[]): VisibleWbsRow[] {
  const groups = groupByParent(nodes)
  const rows: VisibleWbsRow[] = []
  const visit = (parentId: number | null, depth: number) => {
    for (const node of groups.get(parentId) ?? []) {
      rows.push({ node, depth })
      if (!node.collapsed) visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  return rows
}

/** 乐观移动：同步维护 parent/order/depth/path/code，失败时由 mutation context 整体回滚。 */
export function moveWbsOptimistically(
  source: WbsNode[],
  nodeId: number,
  input: MoveWbsNodeInput,
): WbsNode[] {
  const nodes = source.map((node) => ({ ...node }))
  const moving = nodes.find((node) => node.id === nodeId)
  if (!moving) return source
  const nextParentId = input.parentId === undefined ? moving.parentId : input.parentId
  const parent = nextParentId === null ? null : nodes.find((node) => node.id === nextParentId)
  if (parent && (parent.id === moving.id || parent.path.startsWith(moving.path))) return source

  moving.parentId = nextParentId ?? null
  const groups = groupByParent(nodes)
  const destination = (groups.get(moving.parentId) ?? []).filter((node) => node.id !== moving.id)
  const target = Math.min(Math.max(input.displayOrder ?? destination.length, 0), destination.length)
  destination.splice(target, 0, moving)
  groups.set(moving.parentId, destination)

  const refreshedGroups = groupByParent(nodes)
  refreshedGroups.set(moving.parentId, destination)
  const visit = (
    parentId: number | null,
    parentPath: string,
    parentCode: string | null,
    depth: number,
  ) => {
    const group = refreshedGroups.get(parentId) ?? []
    group.forEach((node, index) => {
      node.displayOrder = index
      node.depth = depth
      node.path = `${parentPath}${node.id}/`
      node.code = parentCode ? `${parentCode}.${index + 1}` : String(index + 1)
      node.isLeaf = (refreshedGroups.get(node.id) ?? []).length === 0
      visit(node.id, node.path, node.code, depth + 1)
    })
  }
  visit(null, '/', null, 0)
  return nodes
}
