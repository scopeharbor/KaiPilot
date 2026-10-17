import type {
  ProjectDraft,
  ProjectDraftDependency,
  ProjectDraftSelection,
  ProjectDraftTask,
  ProjectDraftWbsNode,
} from '@aiproj/types'

/**
 * 草案转正选择集的纯函数计算库（v3-ui-next-draft-confirm W1 / tasks 1.1）。
 *
 * 与后端 `apps/backend/app/services/ai_draft/import_selection.ts`（filterDraftBySelection
 * lines 148-234）保持数学逻辑 100% 对齐：
 * - WBS 选择保留完整祖先父链（选中节点自身 + 逐级父节点直至根）；
 * - 选中任务的直接 WBS 节点及其祖先自动保留；
 * - 两端任一未选的依赖在导入时被丢弃（悬空依赖）；
 * - 反选父节点时整棵子孙子树与挂载任务联动清除。
 *
 * 本模块零 DOM、零状态、零网络：所有函数确定性纯函数，供 Store 与组件 100% 复用。
 */

// ---------------------------------------------------------------------------
// WBS 节点集合工具（兼容扁平输入与嵌套输入；parentId 为权威关系）
// ---------------------------------------------------------------------------

/**
 * 收集全部 WBS 节点（去重保序）：
 * - 嵌套树输入：递归 children；
 * - 扁平输入（children 均为空数组）：直接补录全部节点；
 * - parentId 为权威关系，children 字段冗余时仍以父链补全。
 */
export function collectWbsNodes(nodes: ProjectDraftWbsNode[]): ProjectDraftWbsNode[] {
  const seen = new Set<string>()
  const collected: ProjectDraftWbsNode[] = []
  const push = (node: ProjectDraftWbsNode): void => {
    if (!seen.has(node.id)) {
      seen.add(node.id)
      collected.push(node)
    }
  }
  const walk = (list: ProjectDraftWbsNode[]): void => {
    for (const node of list) {
      push(node)
      if (node.children.length > 0) walk(node.children)
    }
  }
  walk(nodes)
  for (const node of nodes) push(node)
  return collected
}

/** 节点 ID → 节点反查表（供祖先追溯与子树查找）。 */
export function buildWbsNodeIdMap(nodes: ProjectDraftWbsNode[]): Map<string, ProjectDraftWbsNode> {
  return new Map(collectWbsNodes(nodes).map((node) => [node.id, node]))
}

/**
 * 祖先父链追溯（含起点自身），向上回溯至根节点。
 * 与服务端 `import_selection.ts:162-169` 的父链保留逐字对齐：
 * 选中节点自身与全部祖先必须进入选择集，杜绝悬空孤儿节点。
 */
export function resolveAncestors(
  wbsMap: Map<string, ProjectDraftWbsNode>,
  startIds: Iterable<string>,
): Set<string> {
  const ancestors = new Set<string>()
  for (const id of startIds) {
    let current = wbsMap.get(id)
    while (current) {
      ancestors.add(current.id)
      current = current.parentId ? wbsMap.get(current.parentId) : undefined
    }
  }
  return ancestors
}

// ---------------------------------------------------------------------------
// 子树联动查找
// ---------------------------------------------------------------------------

/** 子树联动范围：目标节点自身 + 全部子孙 WBS 节点 + 挂载在这些节点上的全部任务。 */
export interface DescendantScope {
  wbsNodeIds: string[]
  taskIds: string[]
}

function buildChildrenMap(nodes: ProjectDraftWbsNode[]): Map<string, ProjectDraftWbsNode[]> {
  const children = new Map<string, ProjectDraftWbsNode[]>()
  for (const node of collectWbsNodes(nodes)) {
    const target = node.parentId ?? ''
    const bucket = children.get(target)
    if (bucket === undefined) {
      children.set(target, [node])
    } else {
      bucket.push(node)
    }
  }
  return children
}

/**
 * 递归查找目标节点（含自身）的子孙 WBS 节点与挂载任务，供 WBS 勾选级联使用：
 * - 勾选节点时整棵子树（节点 + 子孙 + 任务）进入选择集；
 * - 反选节点时整棵子树联动清除（spec「反选父节点联动取消其下属所有子节点与挂载任务」）；
 * - 节点不存在或树为空时返回空范围（幂等安全）。
 */
export function resolveDescendantWbsAndTasks(
  wbsNodes: ProjectDraftWbsNode[],
  nodeId: string,
  tasks: ProjectDraftTask[],
): DescendantScope {
  const childrenMap = buildChildrenMap(wbsNodes)
  const target = buildWbsNodeIdMap(wbsNodes).get(nodeId)
  if (!target) return { wbsNodeIds: [], taskIds: [] }

  const wbsNodeIds: string[] = []
  const walk = (node: ProjectDraftWbsNode): void => {
    wbsNodeIds.push(node.id)
    for (const child of childrenMap.get(node.id) ?? []) walk(child)
  }
  walk(target)

  const wbsIdSet = new Set(wbsNodeIds)
  const taskIds = tasks.filter((task) => wbsIdSet.has(task.wbsNodeId)).map((task) => task.id)
  return { wbsNodeIds, taskIds }
}

// ---------------------------------------------------------------------------
// 悬空依赖分析
// ---------------------------------------------------------------------------

/**
 * 悬空依赖实时分析：当且仅当依赖两端任务均在选中集中，该依赖导入后方可保留；
 * 两端任一未选即判定为悬空，转正时将被服务端自动移除（import_selection.ts:193-196）。
 * 返回受影响的依赖明细（供警告徽章与解绑影响透视展示）。
 */
export function findDanglingDependencies(
  dependencies: ProjectDraftDependency[],
  selectedTaskIds: ReadonlySet<string> | readonly string[],
): ProjectDraftDependency[] {
  const selected = new Set(selectedTaskIds)
  return dependencies.filter(
    (dep) => !selected.has(dep.predecessorId) || !selected.has(dep.successorId),
  )
}

// ---------------------------------------------------------------------------
// 三态勾选判定
// ---------------------------------------------------------------------------

export type WbsCheckState = 'checked' | 'indeterminate' | 'unchecked'

/**
 * WBS 节点三态判定（树选择器语义）：
 * - checked：节点自身与整棵子树（全部子孙节点 + 挂载任务）均在选中集；
 * - indeterminate：节点自身未全选，但子树内存在任意选中节点或任务；
 * - unchecked：子树内无任何选中项。
 */
export function resolveWbsCheckState(
  selection: ProjectDraftSelection,
  wbsNodes: ProjectDraftWbsNode[],
  nodeId: string,
  tasks: ProjectDraftTask[],
): WbsCheckState {
  const scope = resolveDescendantWbsAndTasks(wbsNodes, nodeId, tasks)
  const selectedWbs = new Set(selection.wbsNodeIds)
  const selectedTasks = new Set(selection.taskIds)

  const nodeChecked = selectedWbs.has(nodeId)
  if (
    nodeChecked &&
    scope.wbsNodeIds.every((id) => selectedWbs.has(id)) &&
    scope.taskIds.every((id) => selectedTasks.has(id))
  ) {
    return 'checked'
  }
  if (
    nodeChecked ||
    scope.wbsNodeIds.some((id) => selectedWbs.has(id)) ||
    scope.taskIds.some((id) => selectedTasks.has(id))
  ) {
    return 'indeterminate'
  }
  return 'unchecked'
}

// ---------------------------------------------------------------------------
// 选择集统计指标
// ---------------------------------------------------------------------------

/** 选择集统计指标（控制栏「已选 X/Y 项任务，A/B 个 WBS 分支」口径）。 */
export interface DraftSelectionCounts {
  selectedTasks: number
  totalTasks: number
  selectedWbsNodes: number
  totalWbsNodes: number
  /** 顶层 WBS 分支（根节点）数量。 */
  selectedBranches: number
  totalBranches: number
  totalDependencies: number
  /** 两端任务均保留、可随转正落库的依赖数。 */
  selectedDependencies: number
  /** 悬空依赖数（转正时将被自动移除）。 */
  danglingDependencies: number
}

/** 顶层根节点：parentId 为空或指向不存在节点的节点（与 buildWbsTree 同口径）。 */
export function collectWbsRoots(nodes: ProjectDraftWbsNode[]): ProjectDraftWbsNode[] {
  const idMap = buildWbsNodeIdMap(nodes)
  return collectWbsNodes(nodes).filter(
    (node) => node.parentId === null || !idMap.has(node.parentId),
  )
}

/**
 * 选择集统计指标计算：任务 / WBS 节点 / 顶层分支 / 依赖。
 * 所有计数与草案实际元素求交集，外部传入的过期选择集不会虚增指标。
 */
export function computeSelectionCounts(
  draft: ProjectDraft,
  selection: ProjectDraftSelection,
): DraftSelectionCounts {
  const selectedTaskIds = new Set(selection.taskIds)
  const selectedWbsIds = new Set(selection.wbsNodeIds)

  const allWbsNodes = collectWbsNodes(draft.wbs)
  const allTaskIds = draft.tasks.map((task) => task.id)
  const selectedTasks = draft.tasks.filter((task) => selectedTaskIds.has(task.id)).length

  const roots = collectWbsRoots(draft.wbs)
  let selectedBranches = 0
  for (const root of roots) {
    const scope = resolveDescendantWbsAndTasks(draft.wbs, root.id, draft.tasks)
    const branchSelected =
      scope.wbsNodeIds.some((id) => selectedWbsIds.has(id)) ||
      scope.taskIds.some((id) => selectedTaskIds.has(id))
    if (branchSelected) selectedBranches += 1
  }

  const dangling = findDanglingDependencies(draft.dependencies, selection.taskIds)
  const totalDependencies = draft.dependencies.length

  return {
    selectedTasks,
    totalTasks: allTaskIds.length,
    selectedWbsNodes: allWbsNodes.filter((node) => selectedWbsIds.has(node.id)).length,
    totalWbsNodes: allWbsNodes.length,
    selectedBranches,
    totalBranches: roots.length,
    totalDependencies,
    selectedDependencies: totalDependencies - dangling.length,
    danglingDependencies: dangling.length,
  }
}

// ---------------------------------------------------------------------------
// 全选选择集构造（initSelection / selectAll / 切回全部接受共用）
// ---------------------------------------------------------------------------

/** 空选择集（默认未选策略 discard；含全部五个 ID 集合的空数组）。 */
export function createEmptySelection(): ProjectDraftSelection {
  return {
    taskIds: [],
    wbsNodeIds: [],
    acceptanceIds: [],
    milestoneIds: [],
    riskHintIds: [],
    unselectedStrategy: 'discard',
  }
}

/**
 * 全选选择集：全部有效节点、任务、验收标准、里程碑与风险提示处于选中态
 * （spec 需求一第 2 条「mode: 'all' 时所有生成的有效元素处于选中态」）。
 */
export function buildFullSelection(draft: ProjectDraft): ProjectDraftSelection {
  return {
    taskIds: draft.tasks.map((task) => task.id),
    wbsNodeIds: collectWbsNodes(draft.wbs).map((node) => node.id),
    acceptanceIds: draft.acceptanceCriteria.map((item) => item.id),
    milestoneIds: draft.milestoneHints.map((item) => item.id),
    riskHintIds: draft.riskHints.map((item) => item.id),
    unselectedStrategy: 'discard',
  }
}
