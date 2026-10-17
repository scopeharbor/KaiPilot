/**
 * 草案质量闭环：批判 → 单点修复 → 复查（2026-09-27，取代 reconcile_review 的「整份重写」）。
 *
 * 用户要求：生成过程里出的问题由生成管线自己在局部修掉；只有修不掉、或本就需要人判断的事，
 * 才出现在审查页「待你确认」。整份重写既撑爆上下文（大草案 12 万字以上直接跳过），
 * 又会把确定性后处理的结果冲掉，所以这里只做局部修补：
 *
 * 1. 确定性批判（程序检查）：任务缺少可执行说明（为什么做 / 输入 / 产出 / 完成标准 / 步骤）、
 *    任务名空泛、计划层任务过长（>5 个工作日且不是等待型）、断头任务（非起点却没有前置、
 *    非收尾却没有后继）、负责人缺失。
 * 2. 模型批判（执行者视角审查）：按 WBS 一级分支逐支审查——拿到这些任务能否直接开工、
 *    有没有漏掉的真实工作、依赖是否缺失。每次调用只看「主干记忆 + 本分支任务 + 相邻任务索引」。
 * 3. 单点修复：把本分支的问题交给模型，返回补丁操作（update / split / add / addDependency /
 *    removeDependency），由程序应用并重新编号、重接依赖；再跑一轮批判复查。
 * 4. 最多 MAX_ROUNDS 轮；仍未解决的问题写成 reviewItems，交给人。
 */

import type {
  ConfirmedProjectContext,
  ProjectDraftQualityLoop,
  ProjectDraftReviewItem,
} from '@aiproj/types'
import type { PromptSet } from '../ai_m0/prompts.ts'
import { tryParseJson } from '../ai_m0/recovery.ts'
import {
  buildSpine,
  compactDependencies,
  markedValue,
  memoryView,
  taskIndex,
  type ContextUsageLog,
} from './draft_memory.ts'
import { DRAFT_TASK_EXECUTION_GUIDE } from './stage_schema_guide.ts'
import { longestChainWorkdays } from './schedule_salvage.ts'
import { isOngoingTask } from './resource_plan.ts'

type JsonObject = Record<string, unknown>

export type QualityCall = (args: {
  prompt: PromptSet
  promptName: 'draft.quality.critic' | 'draft.quality.repair'
  sentence: string
}) => Promise<string>

export const QUALITY_LOOP_MAX_ROUNDS = 3
const BRANCH_CONCURRENCY = 4
/** 计划层任务工期上限（工作日）；等待型任务（测评、观察、试运行…）放宽到 WAITING_TASK_MAX。 */
const PLAN_TASK_MAX_DAYS = 5
const WAITING_TASK_MAX_DAYS = 15
const WAITING_TASK =
  /测评|等待|观察|试运行|验收期|公示|审批|评审期|采购周期|备案|培训期|并行运行|压测/u
const VAGUE_TASK =
  /^(推进|跟进|完善|优化|处理|落实|协调|支持|配合|其他|相关|整体|综合)|工作$|事项$|事宜$/u
const CROSS_CUTTING = /项目管理|项目治理|质量保障|质量管理|风险管理|沟通|PMO|变更管理/u

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  const raw = markedValue(value)
  return typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : ''
}

// ---------------------------------------------------------------------------
// 结构辅助
// ---------------------------------------------------------------------------

interface WbsInfo {
  rootOf: Map<string, string>
  rootOrder: string[]
  rootName: Map<string, string>
  leafIds: Set<string>
}

function wbsInfo(aggregate: JsonObject): WbsInfo {
  const rootOf = new Map<string, string>()
  const rootOrder: string[] = []
  const rootName = new Map<string, string>()
  const leafIds = new Set<string>()
  const walk = (nodes: unknown, root: string | null) => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!isObject(node)) continue
      const id = String(node.id)
      const top = root ?? id
      if (root === null) {
        rootOrder.push(id)
        rootName.set(id, text(node.name))
      }
      rootOf.set(id, top)
      const children = Array.isArray(node.children) ? node.children : []
      if (children.length === 0 && node.isNote !== true) leafIds.add(id)
      walk(children, top)
    }
  }
  walk(aggregate.wbs, null)
  return { rootOf, rootOrder, rootName, leafIds }
}

function tasksOf(aggregate: JsonObject): JsonObject[] {
  return (Array.isArray(aggregate.tasks) ? aggregate.tasks : []).filter(isObject)
}

function depsOf(aggregate: JsonObject): JsonObject[] {
  return (Array.isArray(aggregate.dependencies) ? aggregate.dependencies : []).filter(isObject)
}

// ---------------------------------------------------------------------------
// 1) 确定性批判
// ---------------------------------------------------------------------------

export type QualityIssueKind =
  | 'execution_missing'
  | 'vague_task'
  | 'too_long'
  | 'no_predecessor'
  | 'no_successor'
  | 'owner_missing'
  | 'reviewer_finding'

export interface QualityIssue {
  kind: QualityIssueKind
  taskId: string | null
  /** 所属 WBS 一级分支（单点修复按分支分组）。 */
  rootId: string | null
  detail: string
}

const KIND_LABELS: Record<QualityIssueKind, string> = {
  execution_missing: '任务缺少可执行说明',
  vague_task: '任务名称空泛',
  too_long: '计划层任务过长',
  no_predecessor: '缺少前置依赖',
  no_successor: '缺少后继依赖',
  owner_missing: '缺少负责人',
  reviewer_finding: '执行视角审查意见',
}

export function deterministicCritic(aggregate: JsonObject): QualityIssue[] {
  const info = wbsInfo(aggregate)
  const tasks = tasksOf(aggregate)
  const deps = depsOf(aggregate)
  const hasPred = new Set(deps.map((dep) => String(dep.successorId)))
  const hasSucc = new Set(deps.map((dep) => String(dep.predecessorId)))
  const firstRoot = info.rootOrder[0]
  const lastRoot = info.rootOrder[info.rootOrder.length - 1]
  const issues: QualityIssue[] = []
  for (const task of tasks) {
    const id = String(task.id)
    const rootId = info.rootOf.get(String(task.wbsNodeId)) ?? null
    const name = text(task.name)
    const rootName = rootId ? (info.rootName.get(rootId) ?? '') : ''
    const push = (kind: QualityIssueKind, detail: string) =>
      issues.push({ kind, taskId: id, rootId, detail })

    const execution = isObject(task.execution) ? task.execution : null
    const missing: string[] = []
    if (!execution || !String(execution.purpose ?? '').trim()) missing.push('为什么做')
    if (!execution || !Array.isArray(execution.inputs) || execution.inputs.length === 0)
      missing.push('输入')
    if (!execution || !Array.isArray(execution.outputs) || execution.outputs.length === 0)
      missing.push('产出')
    if (!execution || !Array.isArray(execution.doneCriteria) || execution.doneCriteria.length === 0)
      missing.push('完成标准')
    if (!execution || !Array.isArray(execution.steps) || execution.steps.length < 2)
      missing.push('执行步骤')
    if (missing.length > 0) push('execution_missing', `缺少：${missing.join('、')}`)

    if (name.length < 4 || VAGUE_TASK.test(name)) {
      push('vague_task', `「${name}」看不出具体做什么、产出什么，需改成「动词 + 对象 + 结果」`)
    }
    const days = Number(markedValue(task.durationDays))
    const limit = WAITING_TASK.test(name) ? WAITING_TASK_MAX_DAYS : PLAN_TASK_MAX_DAYS
    if (Number.isFinite(days) && days > limit) {
      push(
        'too_long',
        `工期 ${days} 个工作日，超过计划层上限 ${limit} 天，应拆成可在 1–${limit} 天内完成的子任务`,
      )
    }
    // 只有持续性管理工作（例会、周报、跟踪……）才免查前后依赖；项目管理分支里的一次性交付物
    // （项目计划、立项结论报告）照样要有前后：实测「输出立项与启动结论报告」没有后继，
    // 平衡时被排到上线前一天，挂在它上面的「立项启动与需求基线冻结」里程碑也跟着到了项目末尾。
    const crossCutting =
      (CROSS_CUTTING.test(rootName) || CROSS_CUTTING.test(name)) && isOngoingTask(name)
    if (!crossCutting && !hasPred.has(id) && rootId !== firstRoot) {
      push('no_predecessor', '不是项目起点却没有任何前置任务：它开工前需要什么完成？')
    }
    if (!crossCutting && !hasSucc.has(id) && rootId !== lastRoot) {
      push('no_successor', '不是项目收尾却没有任何后继任务：它的产出交给谁用？')
    }
    if (
      !text(task.assigneeHint).trim() &&
      !(markedValue(task.assigneeRoleIds) as unknown[] | undefined)?.length
    ) {
      push('owner_missing', '没有负责人角色')
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// 2) 模型批判 / 3) 单点修复 的 prompt
// ---------------------------------------------------------------------------

const CRITIC_SYSTEM = [
  '你是一位要亲自执行这些任务的资深工程负责人，正在审查项目计划中的一个分支。只返回 JSON。',
  '从执行者视角逐条检查：拿到任务的人能否不再问任何问题就开工？输入从哪来？产出交给谁？怎样算做完？',
  '重点找：1) 真实项目里一定会发生、但本分支漏掉的工作（如环境准备、数据准备、评审、联调、培训、切换、回退预案）；',
  '2) 任务之间缺失的先后约束（包括与 neighborTasks 中其他分支任务的约束）；3) 工期明显不合理（写出理由）；',
  '4) 任务描述与完成标准空泛、无法验收；5) 与项目主干（spine）的目标、范围、约束不一致之处。',
  '不要为了挑错而挑错：没有问题就返回空数组。每条意见必须具体到任务 id 与修改方向。',
  '输出：{"findings":[{"taskId":"task-3 或 null（缺失的工作）","problem":"问题","suggestion":"具体怎么改"}]}',
].join('\n')

const REPAIR_SYSTEM = [
  '你是资深项目经理，正在对项目计划的一个分支做「单点修复」。只返回 JSON。',
  '只修复 issues 中列出的问题，不改动没有问题的任务；不得删除任务（可以拆分）。',
  '可用操作（ops 数组，按顺序执行）：',
  '{"op":"update","taskId":"task-3","set":{"name"?,"description"?,"durationDays"?,"assigneeHint"?,"execution"?,"headcount"?}}',
  '{"op":"split","taskId":"task-3","into":[<任务>,<任务>…]}  // 把过长任务拆成按先后衔接的 2–6 个子任务，前后依赖由系统自动接上',
  '{"op":"add","wbsNodeId":"wbs-7","after":"task-3 或 null","before":"task-5 或 null","task":<任务>}  // 补漏掉的工作',
  '{"op":"addDependency","from":"task-1","to":"task-5","type":"FS","lag":0}',
  '{"op":"removeDependency","from":"task-1","to":"task-5"}',
  '<任务> = {"name","description","durationDays","assigneeHint","execution","headcount"?}，字段都用普通值（不要 Marked 包装），',
  'durationDays 为 1–5 的整数（等待型任务如测评、试运行最多 15），assigneeHint 只能用 spine.teamRoster 中的角色名（无名册时写角色，不写人名）。',
  'headcount 可选（1–50 的整数）：多人同时做这一件事时写投入人数；角色超载时优先用 headcount 表达并行投入或改派，而不是单纯拉长工期。',
  DRAFT_TASK_EXECUTION_GUIDE,
  '输出：{"ops":[...],"unresolved":[{"taskId":"task-3 或 null","reason":"为什么需要人来决定"}]}',
  '【工作量守恒】补任务或拆分时，同一工作包内其它任务相应缩短：工作包总工期不能因为修复而变大（系统会按工作包工作量校准）。',
  '【工期预算】只补真实的先后约束（前一项的产出是后一项的输入）；能并行的工作不要串联。scheduleBudget.projectWorkdays 是项目可用工作日，依赖最长链超出它的新增依赖会被系统剪掉。',
  '只有确实需要用户决策的事（预算、采购、组织协调、业务口径）才写进 unresolved；能按惯例合理处理的直接修。',
].join('\n')

function branchTaskPayload(task: JsonObject, codes: Map<string, string>): JsonObject {
  return {
    id: task.id,
    wbs: codes.get(String(task.wbsNodeId)) ?? task.wbsNodeId,
    wbsNodeId: task.wbsNodeId,
    name: text(task.name),
    description: text(task.description),
    durationDays: markedValue(task.durationDays),
    assigneeHint: text(task.assigneeHint),
    execution: task.execution ?? null,
  }
}

function wbsCodes(aggregate: JsonObject): Map<string, string> {
  const map = new Map<string, string>()
  const walk = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!isObject(node)) continue
      map.set(String(node.id), String(node.outlineCode ?? ''))
      walk(node.children)
    }
  }
  walk(aggregate.wbs)
  return map
}

function branchLeaves(
  aggregate: JsonObject,
  rootId: string,
  info: WbsInfo,
): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = []
  const walk = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!isObject(node)) continue
      const id = String(node.id)
      if (info.rootOf.get(id) === rootId && info.leafIds.has(id)) {
        out.push([id, String(node.outlineCode ?? ''), text(node.name)])
      }
      walk(node.children)
    }
  }
  walk(aggregate.wbs)
  return out
}

/** 与本分支有依赖往来的其它分支任务（索引行），加上各分支的首尾任务，供判断跨分支约束。 */
function neighborIds(aggregate: JsonObject, rootId: string, info: WbsInfo): Set<string> {
  const tasks = tasksOf(aggregate)
  const inBranch = new Set(
    tasks
      .filter((task) => info.rootOf.get(String(task.wbsNodeId)) === rootId)
      .map((task) => String(task.id)),
  )
  const ids = new Set<string>()
  for (const dep of depsOf(aggregate)) {
    const from = String(dep.predecessorId)
    const to = String(dep.successorId)
    if (inBranch.has(from) && !inBranch.has(to)) ids.add(to)
    if (inBranch.has(to) && !inBranch.has(from)) ids.add(from)
  }
  const byRoot = new Map<string, string[]>()
  for (const task of tasks) {
    const root = info.rootOf.get(String(task.wbsNodeId))
    if (!root || root === rootId) continue
    byRoot.set(root, [...(byRoot.get(root) ?? []), String(task.id)])
  }
  for (const list of byRoot.values()) {
    ids.add(list[0])
    ids.add(list[list.length - 1])
  }
  return ids
}

function branchView(
  call: string,
  aggregate: JsonObject,
  context: ConfirmedProjectContext,
  rootId: string,
  info: WbsInfo,
  extra: JsonObject,
) {
  const codes = wbsCodes(aggregate)
  const tasks = tasksOf(aggregate).filter(
    (task) => info.rootOf.get(String(task.wbsNodeId)) === rootId,
  )
  const branchIds = new Set(tasks.map((task) => String(task.id)))
  const neighbors = neighborIds(aggregate, rootId, info)
  return memoryView(call, [
    ['spine', () => buildSpine({ context, aggregate })],
    [
      'branch',
      () => ({
        id: rootId,
        name: info.rootName.get(rootId) ?? '',
        leaves: branchLeaves(aggregate, rootId, info),
      }),
    ],
    ['branchTasks', () => tasks.map((task) => branchTaskPayload(task, codes))],
    [
      'branchDependencies',
      () =>
        compactDependencies(aggregate).filter(
          ([from, to]) => branchIds.has(from) || branchIds.has(to),
        ),
    ],
    [
      'neighborTasks',
      (level) => (level >= 2 ? undefined : taskIndex(aggregate, { onlyIds: neighbors })),
    ],
    ...Object.entries(extra).map(([key, value]) => [key, () => value] as [string, () => unknown]),
  ])
}

// ---------------------------------------------------------------------------
// 补丁应用（确定性）
// ---------------------------------------------------------------------------

interface ApplyStats {
  repairedTasks: Set<string>
  addedDependencies: number
  addedTasks: number
}

let dependencySeq = 0

function marked(value: unknown, reason: string, needsConfirmation = false): JsonObject {
  return { value, marker: { confidence: 0.75, source: 'inferred', reason, needsConfirmation } }
}

function buildTask(
  raw: JsonObject,
  id: string,
  wbsNodeId: string,
  placeholderDate: string,
): JsonObject | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return null
  const days = Math.max(
    1,
    Math.min(WAITING_TASK_MAX_DAYS, Math.round(Number(raw.durationDays) || 1)),
  )
  const task: JsonObject = {
    id,
    wbsNodeId,
    name: marked(name, '单点修复补充'),
    description: marked(typeof raw.description === 'string' ? raw.description : '', '单点修复补充'),
    status: 'not_started',
    durationDays: marked(days, '单点修复估算', true),
    startDate: marked(placeholderDate, '待程序排期', true),
    endDate: marked(placeholderDate, '待程序排期', true),
    assigneeHint: marked(
      typeof raw.assigneeHint === 'string' ? raw.assigneeHint : '',
      '单点修复建议',
      true,
    ),
  }
  if (isObject(raw.execution)) task.execution = raw.execution
  const headcount = Math.round(Number(raw.headcount))
  if (Number.isFinite(headcount) && headcount >= 1 && headcount <= 50) task.headcount = headcount
  return task
}

function nextTaskId(tasks: JsonObject[]): () => string {
  let max = 0
  for (const task of tasks) {
    const match = /^task-(\d+)$/.exec(String(task.id))
    if (match) max = Math.max(max, Number(match[1]))
  }
  return () => `task-${++max}`
}

function addDependency(
  deps: JsonObject[],
  from: string,
  to: string,
  type = 'FS',
  lag = 0,
  /** dep-q = 修复补充的约束（可被关键路径守卫剪掉）；dep-s = 拆分任务的内部先后（不剪）。 */
  prefix: 'dep-q' | 'dep-s' = 'dep-q',
): boolean {
  if (from === to) return false
  if (deps.some((dep) => dep.predecessorId === from && dep.successorId === to)) return false
  // 计数器是进程级的：服务重启后从检查点续跑时可能与已有编号重复，跳过已占用的。
  let id = `${prefix}${++dependencySeq}`
  while (deps.some((dep) => dep.id === id)) id = `${prefix}${++dependencySeq}`
  deps.push({
    id,
    predecessorId: from,
    successorId: to,
    type: ['FS', 'SS', 'FF', 'SF'].includes(type) ? type : 'FS',
    lagDays: marked(Math.round(lag) || 0, '单点修复补充依赖', true),
  })
  return true
}

function createsCycle(deps: JsonObject[], from: string, to: string): boolean {
  // 加 from→to 后若能从 to 走回 from 即成环。
  const next = new Map<string, string[]>()
  for (const dep of deps) {
    const a = String(dep.predecessorId)
    next.set(a, [...(next.get(a) ?? []), String(dep.successorId)])
  }
  const stack = [to]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === from) return true
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(next.get(current) ?? []))
  }
  return false
}

/** 应用一个分支的补丁；非法操作（引用不存在的任务、越出本分支的 WBS、成环依赖）静默跳过。 */
export function applyRepairOps(
  aggregate: JsonObject,
  ops: unknown[],
  allowedWbs: ReadonlySet<string>,
  stats: ApplyStats,
): void {
  const tasks = tasksOf(aggregate)
  const deps = depsOf(aggregate)
  const byId = new Map(tasks.map((task) => [String(task.id), task]))
  const newId = nextTaskId(tasks)
  const charter = isObject(aggregate.charter) ? aggregate.charter : {}
  const placeholder = text(charter.startDate) || new Date().toISOString().slice(0, 10)

  for (const raw of ops) {
    if (!isObject(raw)) continue
    const op = String(raw.op ?? '')
    if (op === 'update') {
      const task = byId.get(String(raw.taskId))
      if (!task || !isObject(raw.set)) continue
      const set = raw.set
      if (typeof set.name === 'string' && set.name.trim())
        task.name = marked(set.name.trim(), '单点修复')
      if (typeof set.description === 'string')
        task.description = marked(set.description, '单点修复')
      if (set.durationDays !== undefined && Number(set.durationDays) >= 1) {
        task.durationDays = marked(Math.round(Number(set.durationDays)), '单点修复估算', true)
      }
      if (typeof set.assigneeHint === 'string' && set.assigneeHint.trim()) {
        task.assigneeHint = marked(set.assigneeHint.trim(), '单点修复建议', true)
        delete task.assigneeRoleIds
      }
      if (isObject(set.execution)) task.execution = set.execution
      if (set.headcount !== undefined) {
        const n = Math.round(Number(set.headcount))
        if (Number.isFinite(n) && n >= 1 && n <= 50) task.headcount = n
        else delete task.headcount
      }
      stats.repairedTasks.add(String(task.id))
    } else if (op === 'split') {
      const task = byId.get(String(raw.taskId))
      const parts = Array.isArray(raw.into) ? raw.into.filter(isObject) : []
      if (!task || parts.length < 2) continue
      const oldId = String(task.id)
      const built = parts
        .slice(0, 8)
        .map((part, index) =>
          buildTask(part, index === 0 ? oldId : newId(), String(task.wbsNodeId), placeholder),
        )
        .filter((item): item is JsonObject => item !== null)
      if (built.length < 2) continue
      // 第一段沿用原 id（入边、里程碑、验收引用都不失效），出边改挂到最后一段。
      const lastId = String(built[built.length - 1].id)
      for (const dep of deps) if (dep.predecessorId === oldId) dep.predecessorId = lastId
      Object.assign(task, built[0])
      const index = tasks.indexOf(task)
      tasks.splice(index + 1, 0, ...built.slice(1))
      for (let i = 1; i < built.length; i++) {
        addDependency(deps, String(built[i - 1].id), String(built[i].id), 'FS', 0, 'dep-s')
        byId.set(String(built[i].id), built[i])
      }
      stats.repairedTasks.add(oldId)
      stats.addedTasks += built.length - 1
    } else if (op === 'add') {
      const wbsNodeId = String(raw.wbsNodeId ?? '')
      if (!allowedWbs.has(wbsNodeId) || !isObject(raw.task)) continue
      const task = buildTask(raw.task, newId(), wbsNodeId, placeholder)
      if (!task) continue
      const after = typeof raw.after === 'string' ? byId.get(raw.after) : undefined
      const index = after ? tasks.indexOf(after) + 1 : tasks.length
      tasks.splice(index, 0, task)
      byId.set(String(task.id), task)
      if (after) addDependency(deps, String(after.id), String(task.id))
      if (
        typeof raw.before === 'string' &&
        byId.has(raw.before) &&
        !createsCycle(deps, String(task.id), raw.before)
      ) {
        addDependency(deps, String(task.id), raw.before)
      }
      stats.addedTasks++
      stats.repairedTasks.add(String(task.id))
    } else if (op === 'addDependency') {
      const from = String(raw.from ?? '')
      const to = String(raw.to ?? '')
      if (!byId.has(from) || !byId.has(to) || createsCycle(deps, from, to)) continue
      if (
        addDependency(deps, from, to, String(raw.type ?? 'FS').toUpperCase(), Number(raw.lag) || 0)
      ) {
        stats.addedDependencies++
      }
    } else if (op === 'changeDependency') {
      const dep = deps.find(
        (item) => item.predecessorId === String(raw.from) && item.successorId === String(raw.to),
      )
      const type = String(raw.type ?? 'FS').toUpperCase()
      if (dep && ['FS', 'SS', 'FF', 'SF'].includes(type)) {
        dep.type = type
        dep.lagDays = marked(Math.round(Number(raw.lag) || 0), '工期修复调整搭接', true)
      }
    } else if (op === 'removeDependency') {
      const index = deps.findIndex(
        (dep) => dep.predecessorId === String(raw.from) && dep.successorId === String(raw.to),
      )
      // 不删任务的最后一条前置：没有前置的任务会被排到开工日，「缩短工期」实为把验收、修缺陷
      // 这类工作挪到开发之前（实测）。要放松约束请用 changeDependency 改成搭接。
      const lastPredecessor =
        index >= 0 && deps.filter((dep) => dep.successorId === String(raw.to)).length === 1
      if (index >= 0 && !lastPredecessor) deps.splice(index, 1)
    }
  }
  aggregate.tasks = tasks
  aggregate.dependencies = deps
}

/**
 * 关键路径守卫：单点修复补的依赖（dep-q）若让依赖最长链超过上限，就从链尾往前逐条剪掉链上的新增依赖，
 * 直到不超限或链上已没有新增依赖。实测：分支各自「补全前后约束」会把本可并行的工作串成一条
 * 131 个工作日的链（项目只有 61 个），资源平衡后延期 70 天。模型原有依赖与拆分产生的内部先后不剪。
 */
export function pruneChainExtendingDependencies(aggregate: JsonObject, limit: number): number {
  let pruned = 0
  for (let guard = 0; guard < 200; guard++) {
    const deps = depsOf(aggregate)
    const chain = longestChainWorkdays(tasksOf(aggregate), deps)
    if (!chain || chain.workdays <= limit) break
    let removed = false
    for (let index = chain.taskIds.length - 1; index > 0 && !removed; index--) {
      const from = chain.taskIds[index - 1]
      const to = chain.taskIds[index]
      const position = deps.findIndex(
        (dep) =>
          dep.predecessorId === from &&
          dep.successorId === to &&
          String(dep.id).startsWith('dep-q'),
      )
      if (position >= 0) {
        deps.splice(position, 1)
        aggregate.dependencies = deps
        removed = true
        pruned++
      }
    }
    if (!removed) break
  }
  return pruned
}

// ---------------------------------------------------------------------------
// 编排
// ---------------------------------------------------------------------------

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await run(items[index])
      }
    }),
  )
  return results
}

function parseJson(raw: string): JsonObject | null {
  const parsed = tryParseJson(raw)
  return parsed.ok && isObject(parsed.value) ? parsed.value : null
}

export interface QualityLoopResult {
  loop: ProjectDraftQualityLoop
  reviewItems: ProjectDraftReviewItem[]
}

/**
 * 运行质量闭环（原地修改 aggregate 的 tasks / dependencies）。
 * 任何模型调用失败只影响该分支本轮修复，不让整体生成失败。
 */
export async function runQualityLoop(args: {
  aggregate: JsonObject
  context: ConfirmedProjectContext
  call: QualityCall
  usage?: ContextUsageLog
  maxRounds?: number
  /** 每轮修复后回调（重新排期等确定性后处理）。 */
  afterRound?: () => void
  /** 项目可用工作日：补依赖不得让依赖最长链超过它（原本已超则不得再变长）。 */
  scheduleLimitWorkdays?: number
}): Promise<QualityLoopResult> {
  const { aggregate, context, call } = args
  const maxRounds = args.maxRounds ?? QUALITY_LOOP_MAX_ROUNDS
  const stats: ApplyStats = { repairedTasks: new Set(), addedDependencies: 0, addedTasks: 0 }
  const unresolved = new Map<string, { taskId: string | null; reason: string }>()
  let modelCalls = 0
  const issuesBefore = deterministicCritic(aggregate).length
  const baselineChain = longestChainWorkdays(tasksOf(aggregate), depsOf(aggregate))?.workdays ?? 0
  const chainLimit = Math.max(args.scheduleLimitWorkdays ?? 0, baselineChain)
  let prunedDependencies = 0
  let reviewerFindings = new Map<string, QualityIssue[]>()
  let rounds = 0

  for (let round = 1; round <= maxRounds; round++) {
    const info = wbsInfo(aggregate)
    // 模型批判只在第 1 轮做（执行者视角的漏项与依赖）；之后各轮只复查确定性问题与上轮未修完的意见。
    if (round === 1) {
      const findings = await mapWithConcurrency(
        info.rootOrder,
        BRANCH_CONCURRENCY,
        async (rootId) => {
          const view = branchView('quality.critic', aggregate, context, rootId, info, {})
          args.usage?.record(view.usage)
          try {
            modelCalls++
            const raw = await call({
              promptName: 'draft.quality.critic',
              sentence: '执行视角审查计划分支',
              prompt: { systemPrompt: CRITIC_SYSTEM, userPrompt: JSON.stringify(view.payload) },
            })
            const parsed = parseJson(raw)
            const list = Array.isArray(parsed?.findings) ? parsed.findings.filter(isObject) : []
            return [
              rootId,
              list.slice(0, 20).map((item): QualityIssue => ({
                kind: 'reviewer_finding',
                taskId: typeof item.taskId === 'string' ? item.taskId : null,
                rootId,
                detail: `${String(item.problem ?? '').slice(0, 200)}；建议：${String(item.suggestion ?? '').slice(0, 200)}`,
              })),
            ] as const
          } catch {
            return [rootId, [] as QualityIssue[]] as const
          }
        },
      )
      reviewerFindings = new Map(findings)
    }

    const deterministic = deterministicCritic(aggregate)
    const byRoot = new Map<string, QualityIssue[]>()
    for (const issue of [...deterministic, ...[...reviewerFindings.values()].flat()]) {
      if (!issue.rootId) continue
      byRoot.set(issue.rootId, [...(byRoot.get(issue.rootId) ?? []), issue])
    }
    if (byRoot.size === 0) break
    rounds = round

    await mapWithConcurrency(
      [...byRoot.entries()],
      BRANCH_CONCURRENCY,
      async ([rootId, issues]) => {
        const currentInfo = wbsInfo(aggregate)
        const view = branchView('quality.repair', aggregate, context, rootId, currentInfo, {
          scheduleBudget: {
            projectWorkdays: args.scheduleLimitWorkdays ?? null,
            currentCriticalPathWorkdays:
              longestChainWorkdays(tasksOf(aggregate), depsOf(aggregate))?.workdays ?? null,
          },
          issues: issues.slice(0, 40).map((issue) => ({
            taskId: issue.taskId,
            type: KIND_LABELS[issue.kind],
            detail: issue.detail,
          })),
        })
        args.usage?.record(view.usage)
        try {
          modelCalls++
          const raw = await call({
            promptName: 'draft.quality.repair',
            sentence: '单点修复计划分支',
            prompt: { systemPrompt: REPAIR_SYSTEM, userPrompt: JSON.stringify(view.payload) },
          })
          const parsed = parseJson(raw)
          if (!parsed) return
          const allowed = new Set(branchLeaves(aggregate, rootId, currentInfo).map(([id]) => id))
          applyRepairOps(aggregate, Array.isArray(parsed.ops) ? parsed.ops : [], allowed, stats)
          for (const item of Array.isArray(parsed.unresolved)
            ? parsed.unresolved.filter(isObject)
            : []) {
            const reason = String(item.reason ?? '')
              .trim()
              .slice(0, 300)
            if (!reason) continue
            const taskId = typeof item.taskId === 'string' ? item.taskId : null
            unresolved.set(`${taskId ?? rootId}:${reason.slice(0, 40)}`, { taskId, reason })
          }
        } catch {
          // 本分支本轮修复失败：问题留到下一轮或进入待确认清单。
        }
      },
    )
    // 审查意见只修一次；再出现的问题由确定性批判兜底。
    reviewerFindings = new Map()
    if (chainLimit > 0) prunedDependencies += pruneChainExtendingDependencies(aggregate, chainLimit)
    args.afterRound?.()
  }

  const remaining = deterministicCritic(aggregate)
  const taskNames = new Map(tasksOf(aggregate).map((task) => [String(task.id), text(task.name)]))
  const remainingByKind: Record<string, number> = {}
  for (const issue of remaining)
    remainingByKind[issue.kind] = (remainingByKind[issue.kind] ?? 0) + 1

  const reviewItems: ProjectDraftReviewItem[] = []
  for (const [kind, count] of Object.entries(remainingByKind)) {
    const sample = remaining.filter((issue) => issue.kind === kind)
    reviewItems.push({
      id: `qi-${kind}`,
      kind: 'unresolved_issue',
      severity: kind === 'owner_missing' || kind === 'too_long' ? 'medium' : 'low',
      title: `${KIND_LABELS[kind as QualityIssueKind]}（${count} 项，自动修复 ${rounds} 轮后仍存在）`,
      detail: sample
        .slice(0, 5)
        .map((issue) =>
          `${issue.taskId ? `「${taskNames.get(issue.taskId) ?? issue.taskId}」` : ''}${issue.detail}`.trim(),
        )
        .join('\n'),
      taskIds: sample
        .map((issue) => issue.taskId)
        .filter((id): id is string => !!id)
        .slice(0, 50),
      attemptedRepairs: rounds,
    })
  }
  let decisionIndex = 0
  // 各分支常把同一件事（如补贴标准、SSO 对接方）各报一遍：按前 12 个字去重，最多保留 8 条。
  const seenDecisions = new Set<string>()
  for (const item of unresolved.values()) {
    const key = item.reason.replace(/\s+/g, '').slice(0, 12)
    if (seenDecisions.has(key) || seenDecisions.size >= 8) continue
    seenDecisions.add(key)
    reviewItems.push({
      id: `qd-${++decisionIndex}`,
      kind: 'decision_needed',
      severity: 'medium',
      title: '需要你决定',
      detail: item.reason,
      taskIds: item.taskId ? [item.taskId] : undefined,
      attemptedRepairs: 0,
    })
  }

  return {
    loop: {
      rounds,
      issuesBefore,
      issuesAfter: remaining.length,
      repairedTasks: stats.repairedTasks.size,
      addedDependencies: Math.max(0, stats.addedDependencies - prunedDependencies),
      modelCalls,
      remainingByKind,
    },
    reviewItems,
  }
}

// ---------------------------------------------------------------------------
// 工期修复：排期晚于截止日时，按关键链与瓶颈角色做单点修复（只保留真正缩短工期的修改）
// ---------------------------------------------------------------------------

/** 程序排期后的工期评估（由生成管线提供：同一套开工日、工作日历、依赖与角色人数）。 */
export interface ScheduleEvaluation {
  /** 晚于截止日的工作日数（0 = 按期）。 */
  lateWorkdays: number
  projectWorkdays: number
  plannedEndDate: string | null
  deadline: string | null
  /** 纯依赖最长链（不含人手约束）。 */
  chainWorkdays: number
  chainTaskIds: string[]
  /** 各角色工作量（人天）与可用人天（人数 × 可用工作日）。 */
  roleLoads: Array<{ role: string; workload: number; capacity: number; headcount: number }>
}

const SCHEDULE_SYSTEM = [
  '你是资深项目经理，计划按依赖与团队人数排期后晚于截止日。你要在不删减交付范围的前提下，对少数任务做单点修复让计划按期。只返回 JSON。',
  '先看原因：chain.workdays 超过 projectWorkdays → 依赖链太长；某角色 workload 明显超过 capacity → 人手瓶颈。',
  '可用操作（ops）：',
  '{"op":"removeDependency","from":"task-1","to":"task-5"}  // 删除不是真实先后约束的依赖（后者并不需要前者的产出）',
  '{"op":"changeDependency","from":"task-1","to":"task-5","type":"SS","lag":2}  // 可以重叠进行：前者开始若干天后后者即可开始',
  '{"op":"update","taskId":"task-3","set":{"durationDays":3,"assigneeHint":"测试"}}  // 按真实工作量重估工期，或改派给有余量的角色（只能用 roleLoads 中的角色）',
  '要求：每条修改都要符合行业真实做法（如联调必须在开发完成后、验收必须在测试后）；不得为赶工期把工期压到不现实；',
  '改派只能改给具备该能力的角色。输出：{"ops":[...],"reasoning":"一句话说明主要做了什么","ifStillLate":"如仍无法按期，给用户的具体建议（加几人 / 砍哪部分范围 / 延到哪天）"}',
].join('\n')

/**
 * 工期修复循环（最多 maxRounds 轮）：每轮把关键链、瓶颈角色与截止日交给模型给出补丁，
 * 由程序应用后重新排期；只有「晚于截止日的工作日」真正减少才保留本轮修改，否则整体撤回。
 */
export async function runScheduleRepair(args: {
  aggregate: JsonObject
  context: ConfirmedProjectContext
  call: (input: {
    prompt: PromptSet
    promptName: 'draft.quality.schedule'
    sentence: string
  }) => Promise<string>
  evaluate: () => ScheduleEvaluation | null
  usage?: ContextUsageLog
  maxRounds?: number
}): Promise<{ rounds: number; lateBefore: number; lateAfter: number; advice: string | null }> {
  const first = args.evaluate()
  if (!first || first.lateWorkdays <= 0) {
    return {
      rounds: 0,
      lateBefore: first?.lateWorkdays ?? 0,
      lateAfter: first?.lateWorkdays ?? 0,
      advice: null,
    }
  }
  let current = first
  let advice: string | null = null
  let rounds = 0
  for (let round = 1; round <= (args.maxRounds ?? 3) && current.lateWorkdays > 0; round++) {
    rounds = round
    const chainIds = new Set(current.chainTaskIds)
    const overloaded = new Set(
      current.roleLoads.filter((load) => load.workload > load.capacity).map((load) => load.role),
    )
    // 注入：主干记忆 + 关键链任务 + 瓶颈角色的任务（索引行），不注入整份计划。
    const focusIds = new Set(chainIds)
    for (const task of tasksOf(args.aggregate)) {
      const roles = markedValue(task.assigneeRoleIds)
      const labels = Array.isArray(roles) ? roles.map(String) : [text(task.assigneeHint)]
      if (labels.some((role) => overloaded.has(role))) focusIds.add(String(task.id))
    }
    const view = memoryView('quality.schedule', [
      ['spine', () => buildSpine({ context: args.context, aggregate: args.aggregate })],
      [
        'schedule',
        () => ({
          projectWorkdays: current.projectWorkdays,
          plannedEndDate: current.plannedEndDate,
          deadline: current.deadline,
          lateWorkdays: current.lateWorkdays,
        }),
      ],
      ['chain', () => ({ workdays: current.chainWorkdays, taskIds: current.chainTaskIds })],
      ['roleLoads', () => current.roleLoads],
      [
        'focusTasks',
        (level) => taskIndex(args.aggregate, { onlyIds: focusIds, outputs: level === 0 ? 40 : 0 }),
      ],
      [
        'focusDependencies',
        () =>
          compactDependencies(args.aggregate).filter(
            ([from, to]) => focusIds.has(from) || focusIds.has(to),
          ),
      ],
    ])
    args.usage?.record(view.usage)
    const snapshot = JSON.parse(
      JSON.stringify({ tasks: args.aggregate.tasks, deps: args.aggregate.dependencies }),
    )
    try {
      const raw = await args.call({
        promptName: 'draft.quality.schedule',
        sentence: '工期修复：让计划按期',
        prompt: { systemPrompt: SCHEDULE_SYSTEM, userPrompt: JSON.stringify(view.payload) },
      })
      const parsed = parseJson(raw)
      if (!parsed) continue
      if (typeof parsed.ifStillLate === 'string' && parsed.ifStillLate.trim()) {
        advice = parsed.ifStillLate.trim().slice(0, 400)
      }
      const stats: ApplyStats = { repairedTasks: new Set(), addedDependencies: 0, addedTasks: 0 }
      const ops = (Array.isArray(parsed.ops) ? parsed.ops : []).filter(
        (op) =>
          isObject(op) &&
          ['removeDependency', 'changeDependency', 'update'].includes(String(op.op)),
      )
      applyRepairOps(args.aggregate, ops, new Set(), stats)
      const next = args.evaluate()
      if (next && next.lateWorkdays < current.lateWorkdays) {
        current = next
      } else {
        args.aggregate.tasks = snapshot.tasks
        args.aggregate.dependencies = snapshot.deps
      }
    } catch {
      args.aggregate.tasks = snapshot.tasks
      args.aggregate.dependencies = snapshot.deps
    }
  }
  return { rounds, lateBefore: first.lateWorkdays, lateAfter: current.lateWorkdays, advice }
}

// ---------------------------------------------------------------------------
// 文本里的任务编号换成任务名（用户看不懂「task-11/17/18」）
// ---------------------------------------------------------------------------

/** 这些键存的是引用 id，保持原样；其余字符串里的 task-N 一律换成「任务名」。 */
const ID_KEYS = new Set([
  'id',
  'wbsNodeId',
  'predecessorId',
  'successorId',
  'linkedTaskId',
  'linkedTaskIds',
  'criticalPathTaskIds',
  'assigneeRoleIds',
  'parentId',
  'outlineCode',
  'type',
  'status',
])
const TASK_REFERENCE = /task-(\d+)((?:\s*[/、,，]\s*(?:task-)?\d+)*)/giu
const WBS_REFERENCE = /wbs-(\d+(?:-\d+)*)/giu

/** 任务 id / WBS 节点 id → 名称（审查项、决策等草案外文本也用它换名）。 */
export function referenceNames(aggregate: JsonObject): Map<string, string> {
  const names = new Map(tasksOf(aggregate).map((task) => [String(task.id), text(task.name)]))
  const walk = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!isObject(node)) continue
      names.set(String(node.id), text(node.name))
      walk(node.children)
    }
  }
  walk(aggregate.wbs)
  return names
}

/** 把一段文本里的 task-N / wbs-N 换成「名称」；找不到的保留原样。 */
/**
 * 模型在审查意见里会引用输入结构的字段名（「spine 决策中」「confirmedAnswers 为二期再对接」「分支数据」）。
 * 这些是给模型看的内部结构，用户看不懂：换成对应的中文说法。
 */
const INTERNAL_TERMS: ReadonlyArray<[RegExp, string]> = [
  [/\bspine\b\s*/giu, '已确认信息'],
  [/\bconfirmedAnswers\b/gu, '已确认的问答'],
  [/\bconfirmedFacts\b/gu, '已确认的事实'],
  [/\bassumedFacts\b/gu, '假设'],
  [/\bteamRoster\b/gu, '团队名册'],
  [/\bnamedMembers\b/gu, '指定成员'],
  [/\bworkPackagePlan\b/gu, '工作包计划'],
  [/\borganizationHistory\b/gu, '过去的计划'],
  [/\bplanUnderstanding\b/gu, '项目理解'],
  [/本?分支数据/gu, '本部分计划'],
]

export function humanizeInternalTerms(value: string): string {
  return INTERNAL_TERMS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    value,
  )
}

export function humanizeReferenceText(value: string, names: ReadonlyMap<string, string>): string {
  return value
    .replace(TASK_REFERENCE, (whole, first: string, rest: string) => {
      const numbers = [first, ...(rest.match(/\d+/g) ?? [])]
      const labels = numbers.map((n) => names.get(`task-${n}`))
      return labels.some((label) => !label)
        ? whole
        : labels.map((label) => `「${label}」`).join('、')
    })
    .replace(WBS_REFERENCE, (whole, id: string) => {
      const label = names.get(`wbs-${id}`)
      return label ? `「${label}」` : whole
    })
    .replace(/\bcap-(\d+)\b/gu, (whole, id: string) => {
      const label = names.get(`cap-${id}`)
      return label ? `「${label}」` : whole
    })
}

/**
 * 模型在描述、可执行说明、风险与验收里常写「避免 task-11/17/18 因环境未就绪等待」。
 * 导入后这些编号毫无意义：统一换成「任务名」，找不到的编号保留原样。返回替换次数。
 */
export function humanizeTaskReferences(aggregate: JsonObject): number {
  const names = referenceNames(aggregate)
  let replaced = 0
  const rewrite = (value: string) => {
    const next = humanizeReferenceText(value, names)
    if (next !== value) replaced++
    return next
  }
  const walk = (node: unknown, key: string | null): unknown => {
    if (key !== null && ID_KEYS.has(key)) return node
    if (typeof node === 'string') return rewrite(node)
    if (Array.isArray(node)) return node.map((item) => walk(item, null))
    if (isObject(node)) {
      for (const [childKey, child] of Object.entries(node)) node[childKey] = walk(child, childKey)
      return node
    }
    return node
  }
  for (const field of [
    'tasks',
    'acceptanceCriteria',
    'riskHints',
    'milestoneHints',
    'governance',
  ]) {
    if (aggregate[field] !== undefined) aggregate[field] = walk(aggregate[field], null)
  }
  return replaced
}

// ---------------------------------------------------------------------------
// 任务工期按工作包工作量校准
// ---------------------------------------------------------------------------

/**
 * 按工作包预算校准任务工期：某工作包内任务工期合计超过其 effortDays 的 115% 时按比例缩短（保持任务间比例，
 * 每个任务至少 1 天），但最多缩到原合计的 60%——再多说明工作包估小了，保留原值由工期修复与待确认如实提示。
 * 实测：工作包按人天预算拆好后，分支生成的任务合计仍多出 50% 左右，质量闭环补的任务还会再加。
 */
export function calibrateTaskEffort(
  aggregate: JsonObject,
  effortOfNode: ReadonlyMap<string, number>,
): { packages: number; before: number; after: number } {
  const byNode = new Map<string, JsonObject[]>()
  for (const task of tasksOf(aggregate)) {
    const node = String(task.wbsNodeId)
    if (!effortOfNode.has(node)) continue
    byNode.set(node, [...(byNode.get(node) ?? []), task])
  }
  let packages = 0
  let before = 0
  let after = 0
  for (const [node, tasks] of byNode) {
    const budget = effortOfNode.get(node)!
    const days = tasks.map((task) => Math.max(1, Number(markedValue(task.durationDays)) || 1))
    const total = days.reduce((sum, value) => sum + value, 0)
    before += total
    if (total <= budget * 1.15) {
      after += total
      continue
    }
    const target = Math.max(budget, Math.ceil(total * 0.6), tasks.length)
    const ratio = target / total
    let sum = 0
    tasks.forEach((task, index) => {
      const next = Math.max(1, Math.round(days[index]! * ratio))
      sum += next
      if (next === days[index]) return
      task.durationDays = marked(next, `按工作包工作量校准（原 ${days[index]} 天）`, true)
    })
    after += sum
    packages++
  }
  return { packages, before, after }
}
