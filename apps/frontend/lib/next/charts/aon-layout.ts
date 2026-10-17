/**
 * aon-layout —— AON 紧前节点网络图自研 DAG 分层排版纯函数（v3-ui-next-chart-gallery tasks 3.1）。
 *
 * 设计（design §3.1）：不引 dagre（上游废弃多年），自研轻量分层器：
 * - 拓扑分层：DFS 三色 + Kahn 最长路径，产出 rank（横轴进度层）；
 * - 环保护：三色 DFS 途中遇灰色邻居即判为「回边」（back edge），回边不参与分层与布局，
 *   以 `cycleEdges` 返回供 UI 警示（环不抛错、不阻塞渲染，与 CPM 降级语义一致）；
 * - 层内行序：按「前驱重心（平均行序）」聚类，同层依赖相近的节点纵向相邻，
 *   减少跨层连线交叉；完全确定性（节点 id / 拓扑序作决胜键）；
 * - 坐标：x = rank × (节点宽 + 水平间距)，y = 层内行 × (节点高 + 垂直间距)，单调不重叠。
 *
 * 纯 TS、零 DOM/零 npm 依赖，可无 DOM 直接单测。
 */

export const AON_NODE_WIDTH = 200
export const AON_NODE_HEIGHT = 96
export const AON_H_GAP = 112
export const AON_V_GAP = 48
export const AON_CANVAS_PADDING = 32

/** 布局输入边：仅需任务依赖关系（pred → succ）。 */
export interface AonLayoutEdge {
  predecessorId: number
  successorId: number
}

export interface AonPoint {
  x: number
  y: number
}

export interface AonRankedGraph {
  /** taskId → 分层序号（0 起，沿保留边严格递增） */
  ranks: Map<number, number>
  /** 每层成员（按层内行序排列，r = layer index） */
  layers: number[][]
  /** 拓扑序（去回边后，Kahn 语义；用于决胜与调用方排序） */
  topoOrder: number[]
  /** 参与布局的任务 id（含孤立节点） */
  nodeIds: number[]
  /** 检测到的回边（构成环，已忽略于布局；self-loop 也计入） */
  cycleEdges: AonLayoutEdge[]
  /** 是否检出依赖环路 */
  hasCycle: boolean
}

/** 层内行序：taskId → 该层内的行号（0 起，自顶向下）。 */
export type AonRowOrder = Map<number, number>

const DEFAULT_POINT: AonPoint = { x: 0, y: 0 }

/** 去重键（回边集判定用）。 */
function edgeKey(pred: number, succ: number): string {
  return `${pred}->${succ}`
}

/**
 * 拓扑分层主入口。纯函数：
 * 1. 规整输入：忽略未知端点 / self-loop 先计入回边 / 按 (pred,succ) 去重；
 * 2. DFS 三色：灰色邻居边记入 cycleEdges（确定性：id 升序访问）；
 * 3. 逆完成序得 Kahn 拓扑序；沿拓扑序 DP 得最长路径 rank；
 * 4. 层内按前驱重心排序（barycenter 启发式）。
 */
export function layoutAonGraph(
  taskIds: readonly number[],
  edges: readonly AonLayoutEdge[],
): AonRankedGraph {
  const ids = [...new Set(taskIds)].filter((id) => Number.isInteger(id)).sort((a, b) => a - b)
  const idSet = new Set(ids)

  if (ids.length === 0) {
    return {
      ranks: new Map(),
      layers: [],
      topoOrder: [],
      nodeIds: [],
      cycleEdges: [],
      hasCycle: false,
    }
  }

  // 1) 规整边：自环单独入回边；端点缺失丢弃；同对去重（保留首条）。
  const selfLoops: AonLayoutEdge[] = []
  const seen = new Set<string>()
  const keptEdges: AonLayoutEdge[] = []
  for (const edge of edges) {
    const p = edge.predecessorId
    const s = edge.successorId
    if (!Number.isInteger(p) || !Number.isInteger(s)) continue
    if (!idSet.has(p) || !idSet.has(s)) continue
    if (p === s) {
      selfLoops.push({ predecessorId: p, successorId: s })
      continue
    }
    const key = edgeKey(p, s)
    if (seen.has(key)) continue
    seen.add(key)
    keptEdges.push({ predecessorId: p, successorId: s })
  }

  const succByPred = new Map<number, number[]>()
  for (const edge of keptEdges) {
    const list = succByPred.get(edge.predecessorId) ?? []
    list.push(edge.successorId)
    succByPred.set(edge.predecessorId, list)
  }
  for (const list of succByPred.values()) list.sort((a, b) => a - b)

  // 2) DFS 三色。color: 0=white 1=gray 2=black；post 序 = 完成序（逆拓扑）。
  const color = new Map<number, number>()
  const cycleEdges: AonLayoutEdge[] = []
  const cycleKeys = new Set<string>()
  const finishOrder: number[] = []

  const visit = (node: number): void => {
    color.set(node, 1)
    for (const succ of succByPred.get(node) ?? []) {
      const c = color.get(succ) ?? 0
      if (c === 0) {
        visit(succ)
      } else if (c === 1) {
        const key = edgeKey(node, succ)
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key)
          cycleEdges.push({ predecessorId: node, successorId: succ })
        }
      }
      // c === 2：跨层前向边（含普通边与跳层边），正常参与 rank DP。
    }
    color.set(node, 2)
    finishOrder.push(node)
  }
  for (const id of ids) {
    if ((color.get(id) ?? 0) === 0) visit(id)
  }

  const isBackEdge = new Set<string>(cycleEdges.map((e) => edgeKey(e.predecessorId, e.successorId)))
  for (const loop of selfLoops) {
    isBackEdge.add(edgeKey(loop.predecessorId, loop.successorId))
    cycleEdges.push(loop)
  }
  const allCycleEdges = cycleEdges

  // 3) Kahn 拓扑序 + 最长路径分层（仅沿非回边推进）。
  const topoOrder = [...finishOrder].reverse()
  const ranks = new Map<number, number>(ids.map((id) => [id, 0]))
  for (const id of topoOrder) {
    const rank = ranks.get(id) ?? 0
    for (const succ of succByPred.get(id) ?? []) {
      if (isBackEdge.has(edgeKey(id, succ))) continue
      const current = ranks.get(succ) ?? 0
      if (rank + 1 > current) ranks.set(succ, rank + 1)
    }
  }

  // 4) 层内行序：r=0 按 id；r>0 按紧前一层前驱平均行序（无则 -1 → 靠上），
  //    决胜键为拓扑序下标与 id，保证确定性。
  const membersOfRank = new Map<number, number[]>()
  for (const id of ids) {
    const r = ranks.get(id) ?? 0
    const list = membersOfRank.get(r) ?? []
    list.push(id)
    membersOfRank.set(r, list)
  }
  const maxRank = [...membersOfRank.keys()].reduce((a, b) => Math.max(a, b), 0)
  const topoIndex = new Map<number, number>()
  topoOrder.forEach((id, index) => topoIndex.set(id, index))

  const layers: number[][] = []
  const rowIndex = new Map<number, number>()
  const predsById = new Map<number, number[]>()
  for (const edge of keptEdges) {
    if (isBackEdge.has(edgeKey(edge.predecessorId, edge.successorId))) continue
    const list = predsById.get(edge.successorId) ?? []
    list.push(edge.predecessorId)
    predsById.set(edge.successorId, list)
  }
  for (const list of predsById.values()) list.sort((a, b) => a - b)

  for (let r = 0; r <= maxRank; r++) {
    const members = (membersOfRank.get(r) ?? []).slice()
    const prevLayer = r > 0 ? (layers[r - 1] ?? []) : []
    const prevRow = new Map<number, number>()
    prevLayer.forEach((id, row) => prevRow.set(id, row))

    members.sort((a, b) => {
      const avgOf = (id: number): number => {
        const preds = predsById.get(id) ?? []
        if (preds.length === 0) return -1
        let sum = 0
        let count = 0
        for (const pred of preds) {
          const row = prevRow.get(pred)
          if (row === undefined) continue
          sum += row
          count++
        }
        return count > 0 ? sum / count : -1
      }
      const diff = avgOf(a) - avgOf(b)
      if (diff !== 0) return diff
      const ti = (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0)
      if (ti !== 0) return ti
      return a - b
    })
    members.forEach((id, row) => rowIndex.set(id, row))
    layers.push(members)
  }

  return {
    ranks,
    layers,
    topoOrder,
    nodeIds: ids,
    cycleEdges: allCycleEdges,
    hasCycle: allCycleEdges.length > 0,
  }
}

/**
 * 节点左上角坐标映射（层 = 横轴，层内行 = 纵轴）。
 * x/y 均以 AON_NODE_* 与间距常量推出：横坐标沿 rank 严格单调递增，
 * 同层各行 y 间距固定，异层不同行不重叠。
 */
export function computeAonPositions(graph: AonRankedGraph): Map<number, AonPoint> {
  const positions = new Map<number, AonPoint>()
  graph.layers.forEach((layer, rank) => {
    const x = AON_CANVAS_PADDING + rank * (AON_NODE_WIDTH + AON_H_GAP)
    layer.forEach((id, row) => {
      const y = AON_CANVAS_PADDING + row * (AON_NODE_HEIGHT + AON_V_GAP)
      positions.set(id, { x, y })
    })
  })
  return positions
}

/** 取坐标为已知时的位置（缺省返回 0,0，不抛错）。 */
export function aonNodePoint(positions: Map<number, AonPoint>, taskId: number): AonPoint {
  return positions.get(taskId) ?? DEFAULT_POINT
}

/** 总画布宽（供容器初始 minWidth，fitView 自适应缩放）。 */
export function aonCanvasWidth(graph: AonRankedGraph): number {
  const maxRank = graph.layers.length > 0 ? graph.layers.length - 1 : 0
  return AON_CANVAS_PADDING * 2 + maxRank * (AON_NODE_WIDTH + AON_H_GAP) + AON_NODE_WIDTH
}

/** 总画布高。 */
export function aonCanvasHeight(graph: AonRankedGraph): number {
  const maxRows = graph.layers.reduce((acc, layer) => Math.max(acc, layer.length), 0)
  return (
    AON_CANVAS_PADDING * 2 +
    Math.max(maxRows - 1, 0) * (AON_NODE_HEIGHT + AON_V_GAP) +
    AON_NODE_HEIGHT
  )
}
