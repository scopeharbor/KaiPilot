/**
 * OBS 组织分解结构数据适配器纯函数（v3-chart-gallery-tier2-org-contract-plans W1 · task 1.2）。
 *
 * 职责：
 * 1. 纯函数下沉解析后端 `ObsTreeNode[]` 树形结构；
 * 2. 提取部门物化路径、层级深度与部门负责人（缺省占位「未指定负责人」）；
 * 3. 规整成员数、任务总数、完成数与卷算预估总工时；
 * 4. 提供节点 Key 提取与一键全展开/折叠模型；
 * 5. 提供按部门名称、代码与负责人的关键词过滤与高亮检索；
 * 6. 处理空组织树（未挂载部门或无成员）的安全降级（isEmpty: true）。
 */
import type { ObsTreeNode, ObsNodeMetrics } from '@/lib/api/project-metrics'

export const OBS_DEFAULT_LEADER_TEXT = '未指定负责人'

export interface ObsNodeViewModel {
  id: number
  key: string
  name: string
  code: string
  depth: number
  path: string
  leaderName: string
  rawLeaderName: string | null
  metrics: ObsNodeMetrics
  children: ObsNodeViewModel[]
  hasChildren: boolean
}

export interface ObsTreeViewModel {
  rootNodes: ObsNodeViewModel[]
  totalDepartments: number
  totalMembers: number
  totalTasks: number
  totalCompletedTasks: number
  totalEstimatedHours: number
  allNodeKeys: string[]
  isEmpty: boolean
}

function mapObsNode(node: ObsTreeNode): ObsNodeViewModel {
  const children = (node.children || []).map(mapObsNode)
  return {
    id: node.id,
    key: `obs-node-${node.id}`,
    name: node.name || '',
    code: node.code || '',
    depth: node.depth ?? 0,
    path: node.path || '',
    leaderName: node.leaderName?.trim() || OBS_DEFAULT_LEADER_TEXT,
    rawLeaderName: node.leaderName,
    metrics: {
      memberCount: node.metrics?.memberCount ?? 0,
      taskCount: node.metrics?.taskCount ?? 0,
      completedTaskCount: node.metrics?.completedTaskCount ?? 0,
      totalEstimatedHours: node.metrics?.totalEstimatedHours ?? 0,
    },
    children,
    hasChildren: children.length > 0,
  }
}

/**
 * 遍历收集整棵树的所有节点 key（供一键展开/折叠）。
 */
export function collectObsNodeKeys(nodes: ObsNodeViewModel[]): string[] {
  const keys: string[] = []
  function traverse(list: ObsNodeViewModel[]) {
    for (const item of list) {
      keys.push(item.key)
      if (item.children.length > 0) {
        traverse(item.children)
      }
    }
  }
  traverse(nodes)
  return keys
}

/**
 * 计算整棵树的部门节点总数。
 */
function countAllDepartments(nodes: ObsNodeViewModel[]): number {
  let count = 0
  function traverse(list: ObsNodeViewModel[]) {
    for (const item of list) {
      count += 1
      if (item.children.length > 0) {
        traverse(item.children)
      }
    }
  }
  traverse(nodes)
  return count
}

/**
 * 将原始 OBS 树转换为视图模型。
 */
export function buildObsTreeViewModel(
  rawNodes: ObsTreeNode[] | null | undefined,
): ObsTreeViewModel {
  if (!rawNodes || !Array.isArray(rawNodes) || rawNodes.length === 0) {
    return {
      rootNodes: [],
      totalDepartments: 0,
      totalMembers: 0,
      totalTasks: 0,
      totalCompletedTasks: 0,
      totalEstimatedHours: 0,
      allNodeKeys: [],
      isEmpty: true,
    }
  }

  const rootNodes = rawNodes.map(mapObsNode)
  const totalDepartments = countAllDepartments(rootNodes)
  const allNodeKeys = collectObsNodeKeys(rootNodes)

  // 顶层汇总：后端已完成自底向上卷算，直接汇总根节点度量
  let totalMembers = 0
  let totalTasks = 0
  let totalCompletedTasks = 0
  let totalEstimatedHours = 0

  for (const root of rootNodes) {
    totalMembers += root.metrics.memberCount
    totalTasks += root.metrics.taskCount
    totalCompletedTasks += root.metrics.completedTaskCount
    totalEstimatedHours += root.metrics.totalEstimatedHours
  }

  return {
    rootNodes,
    totalDepartments,
    totalMembers,
    totalTasks,
    totalCompletedTasks,
    totalEstimatedHours,
    allNodeKeys,
    isEmpty: rootNodes.length === 0,
  }
}

/**
 * 依据关键词过滤组织树（保留自身命中或子孙命中的节点分支）。
 */
export function filterObsTreeByKeyword(
  nodes: ObsNodeViewModel[],
  keyword: string,
): ObsNodeViewModel[] {
  const query = keyword.trim().toLowerCase()
  if (!query) return nodes

  function filterNode(node: ObsNodeViewModel): ObsNodeViewModel | null {
    const isSelfMatch =
      node.name.toLowerCase().includes(query) ||
      node.code.toLowerCase().includes(query) ||
      (node.rawLeaderName && node.rawLeaderName.toLowerCase().includes(query))

    const filteredChildren = node.children
      .map(filterNode)
      .filter((child): child is ObsNodeViewModel => child !== null)

    if (isSelfMatch || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
        hasChildren: filteredChildren.length > 0,
      }
    }
    return null
  }

  return nodes.map(filterNode).filter((node): node is ObsNodeViewModel => node !== null)
}

/**
 * 提取满足关键词搜索命中的所有节点及其祖先节点 Key，用于搜索时自动展开相关树枝。
 */
export function collectMatchingNodeKeys(nodes: ObsNodeViewModel[], keyword: string): Set<string> {
  const matched = new Set<string>()
  const query = keyword.trim().toLowerCase()
  if (!query) return matched

  function traverse(node: ObsNodeViewModel, ancestorKeys: string[]): boolean {
    const isSelfMatch =
      node.name.toLowerCase().includes(query) ||
      node.code.toLowerCase().includes(query) ||
      (node.rawLeaderName && node.rawLeaderName.toLowerCase().includes(query))

    let childMatched = false
    const currentAncestors = [...ancestorKeys, node.key]

    for (const child of node.children) {
      if (traverse(child, currentAncestors)) {
        childMatched = true
      }
    }

    if (isSelfMatch || childMatched) {
      matched.add(node.key)
      for (const aKey of ancestorKeys) {
        matched.add(aKey)
      }
      return true
    }
    return false
  }

  for (const root of nodes) {
    traverse(root, [])
  }

  return matched
}
