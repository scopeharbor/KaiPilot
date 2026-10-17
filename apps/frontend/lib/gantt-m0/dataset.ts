/**
 * gantt-performance-poc / M0 —— 确定性 1000 任务数据集生成器（留存资产）。
 *
 * 契约（见 `specs/gantt-m0-baseline/spec.md`「固定复杂度且可复现」需求）：
 * - 恰好 `TASK_COUNT` 个任务；
 * - 多层 WBS：显式构造一条深度达 `DEEP_SPINE_LEN` 的脊柱，保证落在 3~20 层区间的深层结构；
 * - FS/SS/FF/SF 四类依赖各有可观实例（轮转分配保证每类覆盖）；
 * - 含里程碑任务（`durationDays === 0`）；
 * - 六状态混合分布。
 *
 * 纯函数、由 `seed` 驱动：**禁用** `Math.random` 与 `Date.now`，同一 seed 逐次一致。
 */

import {
  DEPENDENCY_TYPES,
  GANTT_TASK_STATUSES,
  type DependencyType,
  type GanttDependency,
  type GanttMilestone,
  type GanttSpec,
  type GanttSpecSummary,
  type GanttTask,
  type GanttTaskStatus,
} from './types'

export const TASK_COUNT = 1000
/** 显式脊柱长度：保证 WBS 深度深入 3~20 层区间，不依赖随机命中。 */
const DEEP_SPINE_LEN = 16
const MAX_DEPTH = 19 // 深度 0..19 => 层级 1..20，命中 V1 WBS 上限
const HORIZON_DAYS = 360
const MAX_LEAF_DURATION = 20
const MILESTONE_RATE = 0.04
const TARGET_DEPENDENCY_COUNT = 820

/** mulberry32：确定性 PRNG（只用 Math.imul，无 Math.random / Date）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 状态权重（混合但偏「进行中/未开始」，贴近真实在制项目）。 */
const STATUS_WEIGHTS: Record<GanttTaskStatus, number> = {
  not_started: 34,
  in_progress: 28,
  completed: 20,
  blocked: 7,
  on_hold: 6,
  cancelled: 5,
}

function pickStatus(r: number): GanttTaskStatus {
  const total = GANTT_TASK_STATUSES.reduce((s, k) => s + STATUS_WEIGHTS[k], 0)
  let acc = r * total
  for (const status of GANTT_TASK_STATUSES) {
    acc -= STATUS_WEIGHTS[status]
    if (acc <= 0) return status
  }
  return 'not_started'
}

function progressForStatus(status: GanttTaskStatus, r: number): number {
  switch (status) {
    case 'completed':
      return 1
    case 'in_progress':
      return Math.round((0.15 + r * 0.7) * 100) / 100
    case 'blocked':
    case 'on_hold':
      return Math.round(r * 0.5 * 100) / 100
    default:
      return 0
  }
}

interface TreeNode {
  parentId: number | null
  depth: number
  childOrdinal: number // 在其父下的序号（从 1 起），用于 outline 编号
}

/**
 * 构造 1000 节点的 WBS 森林：先铺一条 `DEEP_SPINE_LEN` 的深脊柱（确定性保证深层），
 * 其余节点按「延展当前深链 / 挂到近期节点 / 挂到浅层」的加权策略混合，得到深浅并存的真实形态。
 */
function buildTree(rand: () => number): TreeNode[] {
  const nodes: TreeNode[] = []
  const childCount: number[] = [] // 每个节点已有的子节点数

  const countRoots = (): number => nodes.filter((n) => n.parentId === null).length
  const addNode = (parentId: number | null, depth: number): void => {
    let childOrdinal: number
    if (parentId === null) {
      childOrdinal = countRoots() + 1
    } else {
      childOrdinal = (childCount[parentId] ?? 0) + 1
      childCount[parentId] = childOrdinal
    }
    nodes.push({ parentId, depth, childOrdinal })
    childCount.push(0)
  }

  // 1) 深脊柱：node0 为根，之后每个挂到上一个，深度线性增长。
  addNode(null, 0)
  for (let i = 1; i < DEEP_SPINE_LEN; i++) {
    addNode(i - 1, nodes[i - 1]!.depth + 1)
  }

  // 2) 其余节点混合分布。
  for (let i = DEEP_SPINE_LEN; i < TASK_COUNT; i++) {
    const roll = rand()
    let parentId: number
    if (roll < 0.4) {
      // 延展最近节点，继续长深链（受 MAX_DEPTH 约束）。
      parentId = i - 1
    } else if (roll < 0.75) {
      // 挂到最近 24 个节点之一（局部丛生）。
      const windowStart = Math.max(0, i - 24)
      parentId = windowStart + Math.floor(rand() * (i - windowStart))
    } else {
      // 挂到任意已存在节点（全局浅丛生）。
      parentId = Math.floor(rand() * i)
    }
    let depth = nodes[parentId]!.depth + 1
    if (depth > MAX_DEPTH) {
      // 触顶则回退到其父，避免超过 20 层。
      const grandParent = nodes[parentId]!.parentId
      parentId = grandParent === null ? parentId : grandParent
      depth = nodes[parentId]!.depth + 1
    }
    addNode(parentId, depth)
  }

  return nodes
}

/** 依据树结构计算 outline 编号（"1.2.3"）。 */
function computeOutlineCodes(nodes: TreeNode[]): string[] {
  const codes: string[] = new Array(nodes.length)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    codes[i] =
      node.parentId === null
        ? String(node.childOrdinal)
        : `${codes[node.parentId]!}.${node.childOrdinal}`
  }
  return codes
}

/**
 * 生成 M0 验证数据集。纯函数：同一 `seed` 逐次一致。
 */
export function buildGanttM0Dataset(seed: number): GanttSpec {
  const rand = mulberry32(seed)
  const tree = buildTree(rand)
  const codes = computeOutlineCodes(tree)

  const tasks: GanttTask[] = []
  const milestones: GanttMilestone[] = []
  let maxEndDay = 0

  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]!
    const isMilestone = rand() < MILESTONE_RATE
    const durationDays = isMilestone ? 0 : 1 + Math.floor(rand() * MAX_LEAF_DURATION)
    const startDay = Math.floor(rand() * Math.max(1, HORIZON_DAYS - durationDays))
    const status = pickStatus(rand())
    const progress = progressForStatus(status, rand())

    tasks.push({
      id: i,
      name: `任务 ${codes[i]!}`,
      wbsCode: codes[i]!,
      depth: node.depth,
      parentId: node.parentId,
      startDay,
      durationDays,
      progress,
      status,
      isMilestone,
    })

    if (isMilestone) {
      milestones.push({ id: milestones.length, taskId: i, day: startDay })
    }
    maxEndDay = Math.max(maxEndDay, startDay + durationDays)
  }

  const dependencies = buildDependencies(rand, tasks.length)

  return {
    seed,
    tasks,
    dependencies,
    milestones,
    timeRange: { startDay: 0, endDay: maxEndDay },
  }
}

/**
 * 生成依赖：successor 索引恒大于 predecessor 索引 → 天然无环。
 * 类型按轮转分配，保证 FS/SS/FF/SF 四类都有可观实例。
 */
function buildDependencies(rand: () => number, taskCount: number): GanttDependency[] {
  const deps: GanttDependency[] = []
  const seen = new Set<string>()
  let attempts = 0
  const maxAttempts = TARGET_DEPENDENCY_COUNT * 6

  while (deps.length < TARGET_DEPENDENCY_COUNT && attempts < maxAttempts) {
    attempts++
    const successorId = 1 + Math.floor(rand() * (taskCount - 1))
    // 依赖局部性：真实项目里任务多依赖近邻前置，少量跨阶段长程依赖。
    // 随机长程依赖会让大量连线纵跨视口，对依赖线渲染是不真实的最坏情况。
    let predecessorId: number
    if (rand() < 0.85) {
      predecessorId = Math.max(0, successorId - (1 + Math.floor(rand() * 20)))
    } else {
      predecessorId = Math.floor(rand() * successorId)
    }
    if (predecessorId === successorId) continue
    const key = `${predecessorId}->${successorId}`
    if (seen.has(key)) continue
    seen.add(key)
    const type: DependencyType = DEPENDENCY_TYPES[deps.length % DEPENDENCY_TYPES.length]!
    deps.push({
      id: deps.length,
      predecessorId,
      successorId,
      type,
      lagDays: Math.floor(rand() * 6),
    })
  }

  return deps
}

/** 统计速览：供控制面板展示与测试断言。 */
export function summarizeDataset(spec: GanttSpec): GanttSpecSummary {
  const statusCounts = Object.fromEntries(GANTT_TASK_STATUSES.map((s) => [s, 0])) as Record<
    GanttTaskStatus,
    number
  >
  const dependencyTypeCounts = Object.fromEntries(DEPENDENCY_TYPES.map((t) => [t, 0])) as Record<
    DependencyType,
    number
  >

  let maxDepth = 0
  for (const task of spec.tasks) {
    statusCounts[task.status]++
    if (task.depth > maxDepth) maxDepth = task.depth
  }
  for (const dep of spec.dependencies) {
    dependencyTypeCounts[dep.type]++
  }

  return {
    taskCount: spec.tasks.length,
    dependencyCount: spec.dependencies.length,
    milestoneCount: spec.milestones.length,
    maxDepth: maxDepth + 1, // 深度 0 基 → 层级
    statusCounts,
    dependencyTypeCounts,
    spanDays: spec.timeRange.endDay - spec.timeRange.startDay,
  }
}
