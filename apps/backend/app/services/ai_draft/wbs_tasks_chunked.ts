/**
 * wbs_tasks 阶段的「骨架 + 分支并行」生成（大型项目专用）。
 *
 * 背景（实测）：25 人 × 27 周的项目要求 100+ 个任务，单次请求要一口气输出 WBS + 全部任务
 * （约 8 万字符）。nekoapi 上的 gpt-5.6-luna 首 token 前推理 11 分钟、随后长流两次在
 * 1.9 万 / 0.9 万字符处中断（模型本身上限 128k token，中断来自长连接而非模型）。
 * 拆成「1 次 WBS 骨架 + 按一级分支并行生成任务」后，每次请求体量小、时长短，
 * 单个分支失败只重跑该分支，并行也大幅缩短墙钟。
 *
 * 对外仍是一个 wbs_tasks 阶段：返回与单次路径同形的 `{"wbs":[...],"tasks":[...]}` 文本，
 * 交给调用方既有的解析 / 阶段校验 / grounding 修复流程，checkpoint 与 UI 不感知拆分。
 */

import type { PromptSet } from '../ai_m0/prompts.ts'
import { tryParseJson } from '../ai_m0/recovery.ts'
import type { DraftGranularityTarget } from './granularity_guide.ts'
import type { TeamRosterEntry } from './resource_plan.ts'
import { WORK_CALENDAR_RULE, type calendarPromptFacts } from './cn_calendar.ts'
import {
  DRAFT_ID_CONVENTION_GUIDE,
  DRAFT_MARKER_CONTRACT_GUIDE,
  DRAFT_MODULE_STRUCTURE_GUIDES,
  DRAFT_TASK_EXECUTION_GUIDE,
  DRAFT_TASK_STATUS_GUIDE,
} from './stage_schema_guide.ts'

/** 目标任务数达到该值才启用拆分；小项目单次请求更省、更一致。 */
export const CHUNKED_WBS_TASKS_MIN_TASKS = 40
/** 每批最多覆盖的可执行叶节点数（每叶 2–4 个任务 → 每批约 16–32 个任务）。 */
const MAX_LEAVES_PER_CHUNK = 8
/** 分支并行度：兼顾墙钟与 provider 限流。 */
const CHUNK_CONCURRENCY = 4
/** 子请求失败（断流 / 静默截断导致解析失败 / 叶节点未覆盖）时的重试次数。 */
const CHUNK_RETRIES = 2

export type ChunkCall = (args: {
  prompt: PromptSet
  /** 低敏任务句，用于审计与限流。 */
  sentence: string
  /** 子请求输出上限：2026-09-26 起不指定，由模型自身最大输出决定。 */
  maxOutputTokens?: number
  onChunk: (chunk: string) => void
  /** 本子请求的尝试序号（1 起）；重试不携带上次输出（干净上下文）。 */
  attempt: number
  /** 低敏 prompt 类别，用于账本统计。 */
  promptName: 'draft.wbs_tasks.skeleton' | 'draft.wbs_tasks.branch'
}) => Promise<string>

/**
 * 跨尝试缓存（同一阶段内由调用方持有）：修复轮次复用已成功的骨架与批次，
 * 只重跑错误落在其中的批次——整段重做既翻倍消耗输出预算，又多一次被中转层截断的机会。
 */
export interface ChunkedWbsTasksCache {
  wbs: unknown[] | null
  batches: JsonObject[][] | null
}

export function createChunkedWbsTasksCache(): ChunkedWbsTasksCache {
  return { wbs: null, batches: null }
}

export interface ChunkedWbsTasksArgs {
  /** 已按阶段 contextScope 裁剪的 grounding 事实。 */
  groundingFacts: unknown[]
  /** 前置产物（含 charter）。 */
  priorArtifacts: Record<string, unknown>
  target: DraftGranularityTarget
  /** 上一次合并结果的阶段校验失败明细（路径基于合并后的 tasks 下标）；首轮为空。 */
  repairErrors: ReadonlyArray<{ path: string; message: string }>
  cache: ChunkedWbsTasksCache
  call: ChunkCall
  /** 实时输出：骨架逐 chunk 转发；分支完成后整段转发，避免并行交错。 */
  onChunk: (chunk: string) => void
  /** 用户确认的团队构成（角色 + 人数）；为空表示未给出。 */
  teamRoster?: readonly TeamRosterEntry[]
  /** 项目期间的法定节假日、调休与封网窗口摘要；缺失表示日期未定。 */
  workCalendar?: ReturnType<typeof calendarPromptFacts> | null
  /** 行业必备阶段门（骨架必须覆盖）。 */
  requiredStageGates?: readonly string[]
  /** 项目主干记忆（今天、问题、成功画面、起止、团队…），每个子请求都带。 */
  spine?: Record<string, unknown>
  /** 理解层能力地图：骨架的一级分支按它划分，分支任务据此理解本分支要交付什么。 */
  capabilityMap?: ReadonlyArray<{
    id: string
    name: string
    purpose: string
    deliverables: string[]
  }>
  /** 拆解层已由程序构建好的 WBS（能力 → 工作包）：给出时跳过模型骨架调用。 */
  presetWbs?: unknown[]
  /** 叶节点（工作包）的交付物、完成判定与粗估工作量，分支任务据此拆解。 */
  leafDetails?: Record<
    string,
    {
      deliverable: string
      doneDefinition: string
      effortDays: number
      roleEffort?: Record<string, number>
    }
  >
}

interface WbsLeaf {
  id: string
  outlineCode: string
  name: string
  rootId: string
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function markedValue(value: unknown): string {
  return isObject(value) && typeof value.value === 'string' ? value.value : ''
}

function commonSystemPrompt(stageLine: string): string {
  return [
    `你正在执行项目草案阶段 wbs_tasks 的子步骤：${stageLine}。只可使用给定事实与项目主干记忆（spine）；不得调用或假设任何工具。`,
    '仅返回 JSON，不要 Markdown、解释或额外字段。不得声称已创建或修改正式项目。',
    DRAFT_MARKER_CONTRACT_GUIDE,
    DRAFT_ID_CONVENTION_GUIDE,
  ].join('\n')
}

function repairBlock(lines: string[]): string {
  return lines.length > 0
    ? `\n【上次整体校验失败明细，本次必须修正】\n${lines.slice(0, 20).join('\n')}`
    : ''
}

const TASK_PATH = /^tasks\[(\d+)\]/

/** 把合并后路径 tasks[i].x 改写成任务名，子请求才看得懂指的是哪条任务。 */
function describeError(error: { path: string; message: string }, merged: JsonObject[]): string {
  const match = TASK_PATH.exec(error.path)
  const task = match ? merged[Number(match[1])] : undefined
  const where = task
    ? `任务「${markedValue(task.name)}」${error.path.slice(match![0].length)}`
    : error.path
  return `- ${where}: ${error.message.slice(0, 120)}`
}

/** 行业阶段门：骨架必须含对应阶段（名称里带上阶段关键词，便于系统核对）。 */
export function stageGateRule(gates: readonly string[]): string {
  if (gates.length === 0) return ''
  return (
    `【行业必备阶段】WBS 必须覆盖以下阶段门（可作为一级节点或其下的二级节点，名称包含对应关键词）：${gates.join('、')}。` +
    '缺少任一阶段门会被系统判为不合格并要求重写。'
  )
}

function skeletonPrompt(args: ChunkedWbsTasksArgs, repairLines: string[]): PromptSet {
  const { target } = args
  return {
    systemPrompt: [
      commonSystemPrompt('WBS 骨架'),
      '【本步输出】只输出 {"wbs": [...]} 一个 JSON 对象，不要输出 tasks 或其他顶层键。',
      DRAFT_MODULE_STRUCTURE_GUIDES.wbs,
      `【颗粒度要求】团队约 ${target.teamSize} 人、周期约 ${target.weeks} 周：WBS 至少 ${target.minWbsDepth} 层、至少 ${target.minLeafNodes} 个可执行叶节点；` +
        '一级节点按交付阶段或核心工作流划分，每个核心子系统/模块独立成二级分支，并分别拆出设计、开发、联调、测试等叶节点；' +
        '覆盖启动、方案、建设、合规/安全、测试/演练、上线切换与收尾复盘；叶节点 description 写清交付物（20–60 字）。',
      '【内容要求】非叶节点 description 写 10–30 字概括该分支的范围与边界（下游按分支生成任务时依赖它区分职责）；叶节点 description 写 20–60 字交付物。',
      '【元数据精简】marker.reason 只是依据标注，不超过 8 字（如"来自已确认事实"）；把篇幅留给 name/description 等业务内容。',
      '【扁平输出（覆盖上方 children 嵌套说明）】wbs 输出为一层扁平数组，按大纲先序排列（父节点在前、子节点紧随其后）：' +
        '每个节点的 children 一律为空数组 []，用 parentId 表示父子关系（一级节点 parentId 为 null），outlineCode 与层级一致；' +
        '系统会按 parentId 组装成树。不要嵌套 children——深层嵌套极易漏写括号导致整份骨架作废。isLeaf 由系统按父子关系重算。',
      args.capabilityMap && args.capabilityMap.length > 0
        ? '【能力地图】一级节点以 capabilityMap 为主线：每项能力对应一个一级分支（名称可精炼），再加项目管理、质量保障、上线切换等横向分支；能力的 deliverables 要落到叶节点。'
        : '',
      stageGateRule(args.requiredStageGates ?? []),
      repairBlock(repairLines),
    ].join('\n'),
    userPrompt: JSON.stringify({
      stage: 'wbs_tasks',
      step: 'wbs_skeleton',
      requiredOutputFields: ['wbs'],
      ...(args.spine ? { spine: args.spine } : {}),
      ...(args.capabilityMap ? { capabilityMap: args.capabilityMap } : {}),
      groundingFacts: args.groundingFacts,
      charter: args.priorArtifacts.charter,
    }),
  }
}

/** 负责人规则：有名册时只用名册角色名，并按人数控制同一时段的并发。 */
function assigneeRule(roster: readonly TeamRosterEntry[]): string {
  if (roster.length === 0) {
    return '【负责人】assigneeHint 写团队角色（如「后端开发组」「测试组」「DBA」），不要写具体人名，便于并行排期。'
  }
  return (
    '【负责人】assigneeHint 与 assigneeRoleIds 只能使用 teamRoster 中的角色名（原文照写，不加「组」等后缀），不要写具体人名；' +
    '名册没有的项目管理工作写「项目经理」。同一角色在同一时段并行的任务数不得超过其人数（如 DBA 2 人则同时最多 2 个 DBA 任务），' +
    '人数少的角色的任务按先后排开；系统会按人数做资源平衡，超出部分会被顺延。'
  )
}

function branchPrompt(
  args: ChunkedWbsTasksArgs,
  leaves: WbsLeaf[],
  outline: Array<{ outlineCode: string; name: string }>,
  rootName: string,
  repairLines: string[],
): PromptSet {
  const minTasks = leaves.length * 2
  const maxTasks = leaves.length * 4
  return {
    systemPrompt: [
      commonSystemPrompt(`为 WBS 分支「${rootName}」的 ${leaves.length} 个叶节点生成任务`),
      '【本步输出】只输出 {"tasks": [...]} 一个 JSON 对象，不要输出 wbs 或其他顶层键。',
      DRAFT_MODULE_STRUCTURE_GUIDES.tasks,
      DRAFT_TASK_STATUS_GUIDE,
      (args.leafDetails
        ? '【本批范围】只为 targetLeaves 中的工作包生成任务：每个工作包 1–4 个任务（任务数 ≈ effortDays ÷ 3），任务工期合计不超过该工作包的 effortDays；'
        : `【本批范围】只为 targetLeaves 中的叶节点生成任务：每个叶节点 2–4 个任务，本批合计 ${minTasks}–${maxTasks} 个；`) +
        'wbsNodeId 只能取 targetLeaves 中的 id；任务 id 用 "task-1"、"task-2"… 本批内连续编号（系统合并时统一重排）。',
      '【颗粒度】计划层任务工期 1–5 个工作日（测评、试运行、观察期等等待型任务最多 15 个工作日）；' +
        '任务 description 写 40–120 字：具体产出物 + 完成判定标准（可量化的写数值）。',
      DRAFT_TASK_EXECUTION_GUIDE,
      '【紧凑格式】任务字段直接写普通值（系统自动补标注），不要写 startDate/endDate——日期由系统按依赖、工作日历与团队人数统一排定：' +
        '{"id":"task-1","wbsNodeId":"wbs-3","name":"…","description":"…","status":"not_started","durationDays":3,"assigneeHint":"角色","estimate":{"optimisticDays":2,"pessimisticDays":5},"execution":{…}}。' +
        '同一叶节点内的任务按执行先后排列。',
      args.leafDetails
        ? '【工作包】每个 targetLeaf 是一个工作包：它的任务要恰好完成 deliverable、满足 doneDefinition，任务工期合计接近 effortDays；最后一个任务的产出就是该交付物。有 roleEffort 时按它分派负责人（各角色任务工期合计接近其人天）。'
        : '',
      assigneeRule(args.teamRoster ?? []),
      args.workCalendar ? WORK_CALENDAR_RULE : '',
      repairBlock(repairLines),
    ].join('\n'),
    userPrompt: JSON.stringify({
      stage: 'wbs_tasks',
      step: 'branch_tasks',
      requiredOutputFields: ['tasks'],
      ...(args.spine ? { spine: args.spine } : {}),
      ...(branchCapability(args, rootName) ? { capability: branchCapability(args, rootName) } : {}),
      groundingFacts: args.groundingFacts,
      wbsOutline: outline,
      targetLeaves: leaves.map(({ id, outlineCode, name }) => ({
        id,
        outlineCode,
        name,
        ...(args.leafDetails?.[id] ?? {}),
      })),
      ...(args.teamRoster && args.teamRoster.length > 0 ? { teamRoster: args.teamRoster } : {}),
      ...(args.workCalendar ? { workCalendar: args.workCalendar } : {}),
    }),
  }
}

/** 本分支对应的能力（按名称相互包含匹配）；匹配不到返回 null。 */
function branchCapability(args: ChunkedWbsTasksArgs, rootName: string) {
  const name = rootName.replace(/\s+/g, '')
  return (
    args.capabilityMap?.find((capability) => {
      const cap = capability.name.replace(/\s+/g, '')
      return cap.length >= 2 && (name.includes(cap) || cap.includes(name))
    }) ?? null
  )
}

/** 展开 WBS（兼容 children 嵌套与 parentId 扁平两种形态），返回大纲与可执行叶节点。 */
export function collectWbsLeaves(wbs: unknown[]): {
  outline: Array<{ outlineCode: string; name: string }>
  leaves: WbsLeaf[]
  rootNames: Map<string, string>
} {
  const nodes = new Map<string, JsonObject>()
  const walk = (list: unknown[]) => {
    for (const node of list) {
      if (!isObject(node) || typeof node.id !== 'string') continue
      nodes.set(node.id, node)
      if (Array.isArray(node.children)) walk(node.children)
    }
  }
  walk(wbs)

  const rootOf = (id: string): string => {
    let current = nodes.get(id)
    const seen = new Set<string>()
    while (current && typeof current.parentId === 'string' && nodes.has(current.parentId)) {
      if (seen.has(current.parentId)) break
      seen.add(current.parentId)
      current = nodes.get(current.parentId)
    }
    return typeof current?.id === 'string' ? current.id : id
  }

  const outline: Array<{ outlineCode: string; name: string }> = []
  const leaves: WbsLeaf[] = []
  const rootNames = new Map<string, string>()
  for (const [id, node] of nodes) {
    const outlineCode = typeof node.outlineCode === 'string' ? node.outlineCode : ''
    const name = markedValue(node.name)
    outline.push({ outlineCode, name })
    const root = rootOf(id)
    if (root === id) rootNames.set(id, name)
    const hasChildren = Array.isArray(node.children) && node.children.length > 0
    const isChildOfSomeone = [...nodes.values()].some((other) => other.parentId === id)
    if (node.isLeaf === true && node.isNote !== true && !hasChildren && !isChildOfSomeone) {
      leaves.push({ id, outlineCode, name, rootId: root })
    }
  }
  return { outline, leaves, rootNames }
}

/**
 * 按真实父子关系重算 isLeaf（原地修改）：模型常把有子节点的分组标成 isLeaf:true，
 * 这类节点分不到任务，却会被阶段校验要求「可执行叶节点至少映射 1 个任务」而整批失败。
 */
export function normalizeWbsLeafFlags(wbs: unknown[]): boolean {
  const nodes: JsonObject[] = []
  const walk = (list: unknown[]) => {
    for (const node of list) {
      if (!isObject(node)) continue
      if (!Array.isArray(node.children)) node.children = []
      nodes.push(node)
      walk(node.children as unknown[])
    }
  }
  walk(wbs)
  const parentIds = new Set(
    nodes.map((node) => node.parentId).filter((id): id is string => typeof id === 'string'),
  )
  let changed = false
  for (const node of nodes) {
    const isLeaf =
      (node.children as unknown[]).length === 0 && !parentIds.has(String(node.id ?? ''))
    if (node.isLeaf !== isLeaf) {
      node.isLeaf = isLeaf
      changed = true
    }
  }
  return changed
}

/** 按一级分支分组，再切成每批不超过 MAX_LEAVES_PER_CHUNK 个叶节点。 */
export function planLeafChunks(leaves: WbsLeaf[]): WbsLeaf[][] {
  const byRoot = new Map<string, WbsLeaf[]>()
  for (const leaf of leaves) byRoot.set(leaf.rootId, [...(byRoot.get(leaf.rootId) ?? []), leaf])
  const chunks: WbsLeaf[][] = []
  for (const group of byRoot.values()) {
    for (let index = 0; index < group.length; index += MAX_LEAVES_PER_CHUNK) {
      chunks.push(group.slice(index, index + MAX_LEAVES_PER_CHUNK))
    }
  }
  return chunks
}

/**
 * 逐元素抢救 `{"key":[ {...}, {...} ...` 形态：只在「所有元素都完整、仅末尾缺闭合括号」时接受。
 * 元素写到一半（真实截断）返回 null 交给重试——质量优先，不接受丢了尾部内容的产物。
 */
export function salvageTopLevelArray(raw: string, key: string): unknown[] | null {
  const head = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(raw)
  if (!head) return null
  const items: unknown[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let start = -1
  for (let index = head.index + head[0].length; index < raw.length; index++) {
    const char = raw[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') {
      if (depth === 0) start = index
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          items.push(JSON.parse(raw.slice(start, index + 1)))
        } catch {
          return null
        }
        start = -1
      }
    } else if (char === ']' && depth === 0) {
      return items
    }
  }
  // 数组未闭合：只有停在元素之间（depth 0、不在字符串内）才算「内容完整、仅缺括号」。
  return depth === 0 && !inString && items.length > 0 ? items : null
}

function parseObject(raw: string, key: 'wbs' | 'tasks'): unknown[] {
  const parsed = tryParseJson(raw)
  if (parsed.ok && isObject(parsed.value) && Array.isArray(parsed.value[key])) {
    return parsed.value[key] as unknown[]
  }
  const salvaged = salvageTopLevelArray(raw, key)
  if (salvaged) return salvaged
  throw new Error(`chunk_${key}_parse_failed`)
}

/** 扁平节点按 parentId 组装成树（原地复用节点对象）；已是嵌套形态时原样返回。 */
export function nestFlatWbs(wbs: unknown[]): unknown[] {
  const nodes = wbs.filter(isObject)
  const alreadyNested = nodes.some((node) => Array.isArray(node.children) && node.children.length)
  if (alreadyNested) return wbs
  const byId = new Map<string, JsonObject>()
  for (const node of nodes) {
    node.children = []
    if (typeof node.id === 'string') byId.set(node.id, node)
  }
  const roots: JsonObject[] = []
  for (const node of nodes) {
    const parent = typeof node.parentId === 'string' ? byId.get(node.parentId) : undefined
    if (parent && parent !== node) (parent.children as JsonObject[]).push(node)
    else {
      node.parentId = null
      roots.push(node)
    }
  }
  return roots
}

async function withRetry<T>(run: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
    try {
      return await run(attempt + 1)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** 合并批次并统一重排为 task-1…task-N（依赖在后续阶段才生成，重排安全）。 */
function mergeBatches(batches: JsonObject[][]): JsonObject[] {
  let sequence = 0
  return batches.flat().map((task) => ({ ...task, id: `task-${++sequence}` }))
}

/**
 * 修复轮次要重跑的批次：错误路径 tasks[i] 按上次合并顺序映射回批次；
 * 定位不到具体任务的错误（如整体数量不足）重跑全部批次，但仍复用骨架。
 */
function batchesToRedo(
  batches: JsonObject[][],
  errors: ReadonlyArray<{ path: string }>,
): Set<number> {
  const owner: number[] = []
  batches.forEach((batch, index) => batch.forEach(() => owner.push(index)))
  const redo = new Set<number>()
  let unattributed = false
  for (const error of errors) {
    const match = TASK_PATH.exec(error.path)
    const batch = match ? owner[Number(match[1])] : undefined
    if (batch === undefined) unattributed = true
    else redo.add(batch)
  }
  if (unattributed || redo.size === 0) return new Set(batches.map((_, index) => index))
  return redo
}

/** 生成 WBS 骨架后按分支并行生成任务，合并为单次路径同形的 JSON 文本。 */
export async function generateWbsTasksChunked(args: ChunkedWbsTasksArgs): Promise<string> {
  const { cache } = args
  const previousMerged = cache.batches ? mergeBatches(cache.batches) : []
  const repairLines = args.repairErrors.map((error) => describeError(error, previousMerged))
  // 只有 WBS 结构性错误才重跑骨架；marker 等元数据问题由归一化确定性修补，不值得整份重写。
  const wbsInvalid =
    !args.presetWbs &&
    args.repairErrors.some(
      (error) => error.path.startsWith('wbs') && !error.path.includes('.marker'),
    )
  if (!cache.wbs && args.presetWbs) {
    cache.wbs = args.presetWbs
    cache.batches = null
  }

  if (!cache.wbs || wbsInvalid) {
    cache.wbs = await withRetry(async (attempt) => {
      const raw = await args.call({
        attempt,
        promptName: 'draft.wbs_tasks.skeleton',
        prompt: skeletonPrompt(args, wbsInvalid ? repairLines : []),
        sentence: '生成项目草案阶段：wbs_tasks（WBS 骨架）',
        onChunk: args.onChunk,
      })
      const skeleton = nestFlatWbs(parseObject(raw, 'wbs'))
      normalizeWbsLeafFlags(skeleton)
      return skeleton
    })
    cache.batches = null
  }
  const wbs = cache.wbs

  const { outline, leaves, rootNames } = collectWbsLeaves(wbs)
  if (leaves.length === 0) {
    cache.wbs = null
    throw new Error('chunk_wbs_no_leaves')
  }
  const chunks = planLeafChunks(leaves)
  const reusable = cache.batches && cache.batches.length === chunks.length ? cache.batches : null
  const redo = reusable
    ? batchesToRedo(reusable, args.repairErrors)
    : new Set(chunks.map((_, index) => index))

  const batches = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, (chunk, index) => {
    if (reusable && !redo.has(index)) return Promise.resolve(reusable[index])
    return withRetry(async (attempt) => {
      const raw = await args.call({
        attempt,
        promptName: 'draft.wbs_tasks.branch',
        prompt: branchPrompt(
          args,
          chunk,
          outline,
          rootNames.get(chunk[0].rootId) ?? '',
          reusable ? repairLines : [],
        ),
        sentence: `生成项目草案阶段：wbs_tasks（任务批次 ${index + 1}/${chunks.length}）`,
        // 分支并行输出会交错，先缓冲，整批完成后再转发给实时输出面板。
        onChunk: () => undefined,
      })
      const tasks = parseObject(raw, 'tasks').filter(isObject)
      const allowed = new Set(chunk.map((leaf) => leaf.id))
      const scoped = tasks.filter(
        (task) => typeof task.wbsNodeId === 'string' && allowed.has(task.wbsNodeId),
      )
      const covered = new Set(scoped.map((task) => task.wbsNodeId))
      if (chunk.some((leaf) => !covered.has(leaf.id))) throw new Error('chunk_leaf_uncovered')
      args.onChunk(`\n${JSON.stringify({ tasks: scoped })}`)
      return scoped
    })
  })

  cache.batches = batches
  return JSON.stringify({ wbs, tasks: mergeBatches(batches) })
}
