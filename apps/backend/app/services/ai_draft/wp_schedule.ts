/**
 * 工作包层级的排期可行性（2026-09-27）。
 *
 * 实测：可行性问题要等两百个任务都生成、排期之后才暴露（依赖等待、单点角色），修起来又贵又不彻底。
 * 这里在拆任务之前，先按工作包的依赖与各角色人数由程序排一遍：
 * - 不可行 → 把关键链、瓶颈角色与截止日交给模型做单点修复（删伪依赖 / 改派 / 重估），
 *   程序重排后只保留真正缩短延期的修改；
 * - 仍不可行 → 在生成任务之前就把带数字的取舍交给用户；
 * - 可行的工作包计划随后约束任务层依赖（跨工作包的任务依赖必须有工作包依赖作依据）。
 */

import type { ProjectDraftWorkPackage } from '@aiproj/types'
import type { PromptSet } from '../ai_m0/prompts.ts'
import { tryParseJson } from '../ai_m0/recovery.ts'
import { memoryView, type ContextUsageLog } from './draft_memory.ts'

type JsonObject = Record<string, unknown>

/** 单个工作包里同一角色最多几人并行（再多沟通成本抵消产出）。 */
const MAX_PARALLEL_PER_ROLE = 2
const HORIZON = 2_000

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface WorkPackagePlan {
  /** 相对开工日的工作日下标（含首日为 0）。 */
  start: Map<string, number>
  end: Map<string, number>
  /** 完工所需工作日。 */
  totalWorkdays: number
  lateWorkdays: number
  /** 纯依赖最长链（工作包 id）。 */
  chain: string[]
  chainWorkdays: number
  /** 各角色：投入人天 / 可用人天。 */
  roleLoads: Array<{ role: string; load: number; capacity: number }>
}

/** 工作包的前置：本包 dependsOn 里的工作包 id，以及「整项能力」依赖展开为该能力的全部工作包。 */
export function packagePredecessors(
  workPackages: readonly ProjectDraftWorkPackage[],
): Map<string, string[]> {
  const byCapability = new Map<string, string[]>()
  for (const pkg of workPackages) {
    byCapability.set(pkg.capabilityId, [...(byCapability.get(pkg.capabilityId) ?? []), pkg.id])
  }
  const ids = new Set(workPackages.map((pkg) => pkg.id))
  const result = new Map<string, string[]>()
  for (const pkg of workPackages) {
    const preds = new Set<string>()
    for (const dep of pkg.dependsOn) {
      if (ids.has(dep) && dep !== pkg.id) preds.add(dep)
      else if (byCapability.has(dep) && dep !== pkg.capabilityId) {
        for (const id of byCapability.get(dep)!) preds.add(id)
      }
    }
    result.set(pkg.id, [...preds])
  }
  return result
}

function durationOf(pkg: ProjectDraftWorkPackage, headcount: ReadonlyMap<string, number>) {
  const roles = Object.entries(pkg.roleEffort ?? {})
  if (roles.length === 0)
    return {
      days: Math.max(1, Math.ceil(pkg.effortDays / MAX_PARALLEL_PER_ROLE)),
      usage: new Map<string, number>(),
    }
  const usage = new Map<string, number>()
  let days = 1
  for (const [role, effort] of roles) {
    const people = Math.max(
      1,
      Math.min(headcount.get(role) ?? MAX_PARALLEL_PER_ROLE, MAX_PARALLEL_PER_ROLE),
    )
    usage.set(role, people)
    days = Math.max(days, Math.ceil(effort / people))
  }
  return { days, usage }
}

/**
 * 串行进度生成法排工作包：依赖可行 + 各角色同日占用 ≤ 人数。依赖成环时忽略造成环的回边（排期仍可算）。
 */
export function scheduleWorkPackages(args: {
  workPackages: readonly ProjectDraftWorkPackage[]
  headcount: ReadonlyMap<string, number>
  workdays: number
}): WorkPackagePlan {
  const { workPackages, headcount } = args
  const preds = packagePredecessors(workPackages)
  const info = new Map(workPackages.map((pkg) => [pkg.id, durationOf(pkg, headcount)]))
  // 拓扑序（Kahn）；成环时剩余节点按原顺序接上，并忽略指向尚未排定节点的依赖。
  const indegree = new Map(workPackages.map((pkg) => [pkg.id, preds.get(pkg.id)!.length]))
  const successors = new Map<string, string[]>(workPackages.map((pkg) => [pkg.id, []]))
  for (const [id, list] of preds) for (const pred of list) successors.get(pred)!.push(id)
  const order: string[] = []
  const queue = workPackages.filter((pkg) => indegree.get(pkg.id) === 0).map((pkg) => pkg.id)
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of successors.get(id)!) {
      indegree.set(next, indegree.get(next)! - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  for (const pkg of workPackages) if (!order.includes(pkg.id)) order.push(pkg.id)

  const usage = new Map<string, Int32Array>()
  const row = (role: string) => {
    let value = usage.get(role)
    if (!value) {
      value = new Int32Array(HORIZON + 64)
      usage.set(role, value)
    }
    return value
  }
  const start = new Map<string, number>()
  const end = new Map<string, number>()
  for (const id of order) {
    const { days, usage: need } = info.get(id)!
    let earliest = 0
    for (const pred of preds.get(id)!) {
      const finished = end.get(pred)
      if (finished !== undefined) earliest = Math.max(earliest, finished + 1)
    }
    const fits = (from: number) => {
      for (const [role, people] of need) {
        const cap = headcount.get(role)
        if (cap === undefined) continue
        const line = row(role)
        for (let day = from; day < from + days; day++) if (line[day]! + people > cap) return false
      }
      return true
    }
    let from = earliest
    while (from + days < HORIZON && !fits(from)) from++
    for (const [role, people] of need) {
      if (!headcount.has(role)) continue
      const line = row(role)
      for (let day = from; day < from + days; day++) line[day]! += people
    }
    start.set(id, from)
    end.set(id, from + days - 1)
  }
  const totalWorkdays = Math.max(0, ...[...end.values()].map((value) => value + 1))

  // 纯依赖最长链（不含人手约束）：判断瓶颈在依赖还是人手。
  const finish = new Map<string, number>()
  const via = new Map<string, string | null>()
  for (const id of order) {
    let best: string | null = null
    for (const pred of preds.get(id)!) {
      if (!finish.has(pred)) continue
      if (best === null || finish.get(pred)! > finish.get(best)!) best = pred
    }
    finish.set(id, (best ? finish.get(best)! : 0) + info.get(id)!.days)
    via.set(id, best)
  }
  let tail: string | null = null
  for (const [id, value] of finish) if (tail === null || value > finish.get(tail)!) tail = id
  const chain: string[] = []
  for (let current = tail; current; current = via.get(current) ?? null) chain.unshift(current)

  const loads = new Map<string, number>()
  for (const pkg of workPackages) {
    for (const [role, effort] of Object.entries(pkg.roleEffort ?? {})) {
      loads.set(role, (loads.get(role) ?? 0) + effort)
    }
  }
  return {
    start,
    end,
    totalWorkdays,
    lateWorkdays: Math.max(0, totalWorkdays - args.workdays),
    chain,
    chainWorkdays: tail ? finish.get(tail)! : 0,
    roleLoads: [...loads.entries()]
      .map(([role, load]) => ({ role, load, capacity: (headcount.get(role) ?? 0) * args.workdays }))
      .sort((a, b) => b.load / Math.max(1, b.capacity) - a.load / Math.max(1, a.capacity)),
  }
}

const FEASIBILITY_SYSTEM = [
  '你是资深项目经理。项目已拆成工作包，程序按依赖与各角色人数排期后晚于截止日。你要在拆任务之前调整工作包，让计划可行。只返回 JSON。',
  '先判断原因：chain.workdays 接近或超过 workdays → 依赖链太长；某角色 load 明显超过 capacity → 人手瓶颈。',
  '可做的单点调整（ops）：',
  '{"id":"cap-1-wp2","dependsOn":["cap-1-wp1"]}  // 删掉并不真实的前置（后者不需要前者的产出也能开始），或把「整项能力」依赖改成只依赖其中一个工作包',
  '{"id":"cap-3-wp1","roleEffort":{"后端开发":4,"测试":2},"effortDays":6}  // 改派给有余量的角色（只能用 roleCapacity 中的角色）或按真实工作量重估',
  '要求：不得删减交付范围；不得把工作量压到不现实；行业里必需的先后（设计→开发、开发→联调→测试→验收→上线）必须保留。',
  '输出：{"ops":[...],"reasoning":"一句话","ifStillLate":"仍无法按期时给用户的具体取舍（加几人 / 哪些放二期 / 延到哪天）"}',
].join('\n')

/** 工作包排期不可行时的单点修复循环：只保留真正缩短延期的修改。 */
export async function repairWorkPackageFeasibility(args: {
  workPackages: ProjectDraftWorkPackage[]
  headcount: ReadonlyMap<string, number>
  workdays: number
  call: (input: {
    prompt: PromptSet
    promptName: 'draft.decompose.feasibility'
    sentence: string
  }) => Promise<string>
  usage?: ContextUsageLog
  maxRounds?: number
}): Promise<{
  before: WorkPackagePlan
  after: WorkPackagePlan
  rounds: number
  advice: string | null
}> {
  const evaluate = () =>
    scheduleWorkPackages({
      workPackages: args.workPackages,
      headcount: args.headcount,
      workdays: args.workdays,
    })
  const before = evaluate()
  let current = before
  let advice: string | null = null
  let rounds = 0
  const ids = new Set(args.workPackages.map((pkg) => pkg.id))
  const capabilityIds = new Set(args.workPackages.map((pkg) => pkg.capabilityId))
  for (let round = 1; round <= (args.maxRounds ?? 3) && current.lateWorkdays > 0; round++) {
    rounds = round
    const view = memoryView('decompose.feasibility', [
      ['workdays', () => args.workdays],
      [
        'plan',
        () => ({ totalWorkdays: current.totalWorkdays, lateWorkdays: current.lateWorkdays }),
      ],
      ['chain', () => ({ workdays: current.chainWorkdays, packageIds: current.chain })],
      ['roleCapacity', () => Object.fromEntries(args.headcount)],
      ['roleLoads', () => current.roleLoads],
      [
        'workPackages',
        () =>
          args.workPackages.map((pkg) => ({
            id: pkg.id,
            capabilityId: pkg.capabilityId,
            name: pkg.name,
            effortDays: pkg.effortDays,
            roleEffort: pkg.roleEffort ?? {},
            dependsOn: pkg.dependsOn,
            window: [current.start.get(pkg.id), current.end.get(pkg.id)],
          })),
      ],
    ])
    args.usage?.record(view.usage)
    const snapshot = JSON.parse(JSON.stringify(args.workPackages)) as ProjectDraftWorkPackage[]
    try {
      const raw = await args.call({
        promptName: 'draft.decompose.feasibility',
        sentence: '工作包排期可行性修复',
        prompt: { systemPrompt: FEASIBILITY_SYSTEM, userPrompt: JSON.stringify(view.payload) },
      })
      const parsed = tryParseJson(raw)
      if (!parsed.ok || !isObject(parsed.value)) continue
      if (typeof parsed.value.ifStillLate === 'string' && parsed.value.ifStillLate.trim()) {
        advice = parsed.value.ifStillLate.trim().slice(0, 400)
      }
      const byId = new Map(args.workPackages.map((pkg) => [pkg.id, pkg]))
      for (const op of Array.isArray(parsed.value.ops) ? parsed.value.ops.filter(isObject) : []) {
        const pkg = byId.get(String(op.id ?? ''))
        if (!pkg) continue
        if (Array.isArray(op.dependsOn)) {
          pkg.dependsOn = op.dependsOn
            .map(String)
            .filter((dep) => (ids.has(dep) || capabilityIds.has(dep)) && dep !== pkg.id)
        }
        if (Number(op.effortDays) >= 1)
          pkg.effortDays = Math.min(60, Math.round(Number(op.effortDays)))
        if (isObject(op.roleEffort)) {
          const roles = Object.fromEntries(
            Object.entries(op.roleEffort)
              .map(([role, days]) => [role, Math.max(0, Math.round(Number(days) || 0))] as const)
              .filter(([role, days]) => args.headcount.has(role) && days > 0),
          )
          if (Object.keys(roles).length > 0) pkg.roleEffort = roles
        }
      }
      const next = evaluate()
      if (next.lateWorkdays < current.lateWorkdays) {
        current = next
      } else {
        args.workPackages.splice(0, args.workPackages.length, ...snapshot)
      }
    } catch {
      args.workPackages.splice(0, args.workPackages.length, ...snapshot)
    }
  }
  return { before, after: current, rounds, advice }
}

/**
 * 任务层依赖对齐工作包计划：
 * - 跨工作包的任务依赖，若两包之间没有（传递的）工作包依赖，就是不真实的串联 → 删除；
 * - 工作包依赖 A→B 在任务层没有任何对应时，补「A 的最后任务 → B 的首个任务」。
 * 返回删除与补充的条数。
 */
export function alignTaskDependencies(
  aggregate: JsonObject,
  packageOfNode: ReadonlyMap<string, string>,
  workPackages: readonly ProjectDraftWorkPackage[],
): { removed: number; added: number } {
  const preds = packagePredecessors(workPackages)
  // 传递闭包：reach.get(b) 含 b 的全部（传递）前置工作包。
  const reach = new Map<string, Set<string>>()
  const visit = (id: string, trail: Set<string>): Set<string> => {
    const cached = reach.get(id)
    if (cached) return cached
    const result = new Set<string>()
    if (trail.has(id)) return result
    trail.add(id)
    for (const pred of preds.get(id) ?? []) {
      result.add(pred)
      for (const upstream of visit(pred, trail)) result.add(upstream)
    }
    trail.delete(id)
    reach.set(id, result)
    return result
  }
  for (const pkg of workPackages) visit(pkg.id, new Set())

  const tasks = (Array.isArray(aggregate.tasks) ? aggregate.tasks : []).filter(isObject)
  const packageOfTask = new Map(
    tasks.map((task) => [String(task.id), packageOfNode.get(String(task.wbsNodeId)) ?? null]),
  )
  const deps = (Array.isArray(aggregate.dependencies) ? aggregate.dependencies : []).filter(
    isObject,
  )
  const dropped: JsonObject[] = []
  const kept = deps.filter((dep) => {
    const from = packageOfTask.get(String(dep.predecessorId))
    const to = packageOfTask.get(String(dep.successorId))
    if (!from || !to || from === to) return true
    if (reach.get(to)?.has(from)) return true
    dropped.push(dep)
    return false
  })

  const tasksOfPackage = new Map<string, string[]>()
  for (const task of tasks) {
    const pkg = packageOfTask.get(String(task.id))
    if (pkg) tasksOfPackage.set(pkg, [...(tasksOfPackage.get(pkg) ?? []), String(task.id)])
  }
  const linked = new Set(
    kept
      .map((dep) => {
        const from = packageOfTask.get(String(dep.predecessorId))
        const to = packageOfTask.get(String(dep.successorId))
        return from && to && from !== to ? `${from}>${to}` : null
      })
      .filter((key): key is string => key !== null),
  )
  let added = 0
  // 本函数在生成中会调用两次：编号要避开已有依赖（含上一次补的 dep-wpN），否则前端按 id 渲染时撞 key。
  const usedIds = new Set(kept.map((dep) => String(dep.id)))
  let seq = 0
  const nextId = () => {
    let id = `dep-wp${++seq}`
    while (usedIds.has(id)) id = `dep-wp${++seq}`
    usedIds.add(id)
    return id
  }
  for (const [to, list] of preds) {
    for (const from of list) {
      if (linked.has(`${from}>${to}`)) continue
      // 工作包依赖成环时不沿环补任务依赖（否则任务层成环，排期无法计算）。
      if (reach.get(from)?.has(to)) continue
      const fromTasks = tasksOfPackage.get(from)
      const toTasks = tasksOfPackage.get(to)
      if (!fromTasks?.length || !toTasks?.length) continue
      added++
      kept.push({
        id: nextId(),
        predecessorId: fromTasks[fromTasks.length - 1],
        successorId: toTasks[0],
        type: 'FS',
        lagDays: {
          value: 0,
          marker: {
            confidence: 0.8,
            source: 'inferred',
            reason: '按工作包先后补齐',
            needsConfirmation: true,
          },
        },
      })
    }
  }
  // 删完（含补齐包间衔接之后）一个前置都不剩的任务，恢复它原有的跨包依赖：没有前置的任务会被
  // 排到开工日（实测：「组织 UAT 验证并签字」「修复 UAT 发现的缺陷」被排在项目第一天，早于开发）。
  // 真实的先后总比漂到开工日好；其余无依据的跨包串联照删。
  const hasPredecessor = new Set(kept.map((dep) => String(dep.successorId)))
  let removed = 0
  for (const dep of dropped) {
    if (hasPredecessor.has(String(dep.successorId))) removed++
    else kept.push(dep)
  }
  aggregate.dependencies = kept
  return { removed, added }
}

/**
 * 破除依赖环（确定性）：环会让排期无法计算，所有任务停在开工日（实测）。
 * 每次找到一个环，优先删程序补的依赖（dep-wp 包间衔接、dep-q 修复补充、dep-s 拆分），
 * 其次删环里最后加入的那条模型依赖；直到无环。返回删除条数。
 */
export function breakDependencyCycles(aggregate: JsonObject): number {
  const priority = (id: string) =>
    id.startsWith('dep-wp') ? 0 : id.startsWith('dep-q') ? 1 : id.startsWith('dep-s') ? 2 : 3
  let removed = 0
  for (let guard = 0; guard < 500; guard++) {
    const deps = (Array.isArray(aggregate.dependencies) ? aggregate.dependencies : []).filter(
      isObject,
    )
    const next = new Map<string, JsonObject[]>()
    for (const dep of deps) {
      const from = String(dep.predecessorId)
      next.set(from, [...(next.get(from) ?? []), dep])
    }
    const state = new Map<string, 1 | 2>()
    let cycle: JsonObject[] | null = null
    const stack: JsonObject[] = []
    const visit = (node: string) => {
      if (cycle) return
      state.set(node, 1)
      for (const dep of next.get(node) ?? []) {
        if (cycle) return
        const to = String(dep.successorId)
        stack.push(dep)
        if (state.get(to) === 1) {
          const at = stack.findIndex((item) => String(item.predecessorId) === to)
          cycle = stack.slice(at)
          return
        }
        if (!state.has(to)) visit(to)
        stack.pop()
      }
      state.set(node, 2)
    }
    for (const node of next.keys()) {
      if (cycle) break
      if (!state.has(node)) visit(node)
    }
    if (!cycle) break
    const edges = cycle as JsonObject[]
    const victim = [...edges].sort((a, b) => {
      const byPriority = priority(String(a.id)) - priority(String(b.id))
      return byPriority !== 0 ? byPriority : deps.indexOf(b) - deps.indexOf(a)
    })[0]!
    aggregate.dependencies = deps.filter((dep) => dep !== victim)
    removed++
  }
  return removed
}
