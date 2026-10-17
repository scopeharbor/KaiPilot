/**
 * 草案资源计划的确定性后处理：团队名册 → 角色归一 → 资源建议对齐 → 资源平衡。
 *
 * 背景（实测，gpt-5.6-luna，25 人 / 6 个月项目）：
 * - 用户给出「架构师 2、后端开发 10、…、DBA 2」，但意图解析只取总人数，资源阶段写成 DBA 1 人；
 * - 任务按 WBS 分支分批并行生成，各批看不到彼此的人员占用，DBA、项目经理同日多任务；
 * - 模型只能近似满足容量约束，200 个任务的容量平衡必须由算法兜底。
 *
 * 资源平衡采用串行进度生成法（serial SGS）：按依赖拓扑逐个放置任务，优先级为模型原计划开始日、
 * 其次后续最长路径；任务只顺延不提前（保留模型的阶段先后意图），在满足依赖与各角色人数的
 * 最早工作日开工。平衡后仍晚于章程截止日时，不掩盖：输出延期天数与补员建议，写入风险。
 */

import type { ConfirmedProjectContext } from '@aiproj/types'
import {
  createWorkingCalendar,
  formatIsoDate,
  isWorkingDay,
  parseIsoDate,
  snapToWorkingDay,
  type WorkingCalendar,
} from '#services/gantt_working_calendar'
import { deriveGanttPreview } from './schedule_salvage.ts'
import { isProductionChangeTask, type ChangeFreezeWindow } from './cn_calendar.ts'

type JsonObject = Record<string, unknown>

export interface TeamRosterEntry {
  role: string
  headcount: number
  /** user = 用户给出；ai = 理解层按角色估算的建议团队（标 AI 假设，可按工期调人数）。 */
  source?: 'user' | 'ai'
}

export interface ResourcePlanReport {
  rosterRoles: number
  canonicalizedTasks: number
  adjustedHints: string[]
  addedHints: string[]
  shiftedTasks: number
  leveled: boolean
  skippedReason: string | null
  plannedEndDate: string | null
  deadline: string | null
  deadlineExceededWorkdays: number
  staffingSuggestions: Array<{ role: string; extra: number }>
  /** 按工期估算过人数的角色（仅团队为 AI 假设时）。 */
  sizedRoles?: string[]
}

export interface ResourcePlanResult {
  changed: boolean
  tasks: unknown[]
  resourceHints: unknown[]
  riskHints: unknown[]
  milestoneHints: unknown[]
  ganttPreview: unknown
  report: ResourcePlanReport
}

export interface ResourcePlanOptions {
  /**
   * 已确认的项目开工日（YYYY-MM-DD）。给出时排期整体以它为锚：模型给的日期只保留相对先后
   * （相对模型最早开工日的工作日偏移），绝对日期一律由程序按工作日历、依赖与角色容量重算。
   * 实测模型会编造开工日（今天 9 月却排在 6 月），仅靠顺延无法纠正到未来。
   */
  projectStart?: string | null
  /**
   * 团队是 AI 假设（用户选「先按角色估算」或未给团队）时，按截止日估算各角色所需人数；
   * 用户确认过的名册不传此项。
   */
  sizeToDeadline?: { maxPerRole: number; maxTotal: number }
  /**
   * 压缩重排（审查页协商后重排用）：原计划日期只决定先后优先级，不再是「不得早于」的下限；
   * 加人、减范围、改截止日后任务可以往前挪。持续性任务（项目管理、例会等）先按 1 天参与排期，
   * 排完再拉伸到实际工作的最后一天，免得模型写的整段工期把完工日撑住。
   */
  compress?: boolean
}

const DAY_MS = 86_400_000
const MAX_HORIZON_WORKDAYS = 2_000

/** 角色族：同一族的不同写法（id、英文缩写、带「组」后缀）归并到名册中的同一角色。 */
const ROLE_FAMILIES: Array<{ name: string; pattern: RegExp }> = [
  { name: '项目经理', pattern: /项目经理|项目管理|项目负责人|^pm$|^pm[-_]|[-_]pm$|pmo/iu },
  { name: '架构师', pattern: /架构|architect/iu },
  { name: '移动端开发', pattern: /移动端|小程序|ios|android|app开发/iu },
  { name: '前端开发', pattern: /前端|frontend|front-end|\bfe\b|^fe[-_]/iu },
  { name: '后端开发', pattern: /后端|服务端|backend|back-end|\bbe\b|^be[-_]|java|golang/iu },
  { name: '测试', pattern: /测试|qa|test|质量保证/iu },
  { name: 'DBA', pattern: /dba|数据库/iu },
  { name: '安全', pattern: /安全|security|^sec[-_]|[-_]sec$|^sec$/iu },
  { name: '运维', pattern: /运维|ops|sre|部署|基础设施|infra/iu },
  { name: '产品经理', pattern: /产品|product|需求分析/iu },
]

/** 名册外、以「组/部门/方」等表示的协作方：人数未知，按排期并发估计并标记待确认。 */
const EXTERNAL_TEAM_PATTERN =
  /团队|小组|组$|部门|中心|委员会|办公室|方$|供应商|乙方|外包|服务商|行方/u
const ROLE_SEPARATOR = /[、,，/;；]+/u
const ROSTER_STOP_WORDS =
  /团队|项目周期|预算|周期|工期|约|共|总|合计|万|元|个月|月|天|周|年|日|tps|可用性|等保/iu

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

function markedValue(value: unknown): unknown {
  return isObject(value) ? value.value : undefined
}

/**
 * 从原始输入与已确认团队字段里解析「角色 + 人数」名册，如「架构师 2、后端开发 10、DBA 2 人」。
 * 至少解析出 2 个角色才视为名册，避免把「预算 800」「约 6 个月」之类误当成角色。
 */
export function parseTeamRoster(text: string, minEntries = 2): TeamRosterEntry[] {
  const entries = new Map<string, TeamRosterEntry>()
  const segments = text.normalize('NFKC').split(/[、,，;；。:：\n()（）]+/u)
  for (const raw of segments) {
    // 「另外后端 2 人」「还有测试 1 人」：连接词不是角色名（实测解析出「另外后端」角色）。
    const segment = raw
      .trim()
      .replace(/^(另外|还有|以及|再加上|再加|加上|其中|外加|由|和|及)\s*/u, '')
    // 「成员#16 负责架构」：输入框 @ 的成员承担某角色，记为该角色 1 人。
    const member = /^成员#\d+\s*(?:负责|担任|做|作为)?\s*([\p{Script=Han}A-Za-z]{1,8})$/u.exec(
      segment,
    )
    if (member) {
      const label = member[1]!
      const role = familyOf(label) ?? label
      const key = normalizeKey(role)
      if (!ROSTER_STOP_WORDS.test(role) && !entries.has(key))
        entries.set(key, { role, headcount: 1 })
      continue
    }
    // 数字紧贴英文字母（「H5」「5G」「MP4」）是产品名，不是人数（实测「订餐 H5」被读成角色 H × 5 人）。
    const roleFirst =
      /^([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z ]{0,11}?)\s*[x×*]?\s*(?<![A-Za-z])(\d{1,3})\s*(?:人|名|位)?$/u.exec(
        segment,
      )
    const countFirst =
      /^(\d{1,3})\s*(?:人|名|位)\s*([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z ]{0,11})$/u.exec(
        segment,
      )
    const role = (roleFirst?.[1] ?? countFirst?.[2])?.trim()
    const count = Number(roleFirst?.[2] ?? countFirst?.[1])
    if (!role || !Number.isInteger(count) || count < 1 || count > 200) continue
    if (ROSTER_STOP_WORDS.test(role)) continue
    const key = normalizeKey(role)
    if (!entries.has(key)) entries.set(key, { role, headcount: count })
  }
  return entries.size >= minEntries ? [...entries.values()] : []
}

/** 确认上下文中的团队名册：原始输入 + 已确认 / 假设的团队字段。 */
export function contextTeamRoster(context: ConfirmedProjectContext): TeamRosterEntry[] {
  // 用户在「能否如期完成」协商里确认过的团队（生成前或审查页）优先于原话与追问回答。
  const decided = context.feasibilityDecision?.team ?? []
  if (decided.length > 0) {
    return decided
      .filter((member) => member.role && member.headcount > 0)
      .map((member) => ({ role: member.role, headcount: member.headcount }))
  }
  const parts = [
    context.rawInput,
    context.resolvedFields?.teamSize?.value,
    context.assumptions?.teamSize?.value,
  ]
  const text = parts.filter((part) => typeof part === 'string').join('\n')
  const roster = parseTeamRoster(text)
  if (roster.length > 0) return roster
  // 团队题的回答本身就在说团队：只有一个角色（「市场部 4 人」）也是名册。
  const answer = context.resolvedFields?.teamSize?.value
  const fromAnswer = typeof answer === 'string' ? parseTeamRoster(answer, 1) : []
  if (fromAnswer.length > 0) return fromAnswer
  // 用户没给团队（或选「先按角色估算」）：用理解层建议的团队，标为 AI 假设。
  const suggested = context.planUnderstanding?.suggestedTeam ?? []
  return suggested
    .filter((item) => item.role && item.headcount > 0)
    .map((item) => ({ role: item.role, headcount: item.headcount, source: 'ai' as const }))
}

/** 名册人数的标注：用户给出 = 确认；理解层建议 = AI 假设，需确认。 */
function rosterMarker(entry: TeamRosterEntry): JsonObject {
  return entry.source === 'ai'
    ? {
        confidence: 0.5,
        source: 'inferred',
        reason: '按角色估算的建议团队',
        needsConfirmation: true,
      }
    : { confidence: 1, source: 'explicit', reason: '用户确认的团队构成', needsConfirmation: false }
}

function familyOf(label: string): string | null {
  const key = normalizeKey(label)
  return ROLE_FAMILIES.find((family) => family.pattern.test(key))?.name ?? null
}

/** 负责人标签 → 名册角色名；名册外按角色族归并（如 pm / 项目管理组 → 项目经理），否则保留原文。 */
export function canonicalRole(label: string, roster: readonly TeamRosterEntry[]): string {
  const key = normalizeKey(label)
  if (!key) return label
  for (const entry of roster) {
    const rosterKey = normalizeKey(entry.role)
    if (key === rosterKey || key.includes(rosterKey) || rosterKey.includes(key)) return entry.role
  }
  const family = familyOf(label)
  if (family) {
    const rosterMatch = roster.find((entry) => familyOf(entry.role) === family)
    return rosterMatch ? rosterMatch.role : family
  }
  return label.trim()
}

function taskRoleLabels(task: JsonObject): string[] {
  const ids = markedValue(task.assigneeRoleIds)
  if (Array.isArray(ids) && ids.some((id) => typeof id === 'string' && id.trim())) {
    return ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  }
  const hint = markedValue(task.assigneeHint)
  return typeof hint === 'string'
    ? hint
        .split(ROLE_SEPARATOR)
        .map((part) => part.trim())
        .filter(Boolean)
    : []
}

function parseDay(value: unknown): number | null {
  if (typeof value !== 'string') return null
  try {
    return parseIsoDate(value)
  } catch {
    return null
  }
}

interface WorkdayIndex {
  days: number[]
  indexOf: Map<number, number>
}

function buildWorkdayIndex(calendar: WorkingCalendar, from: number): WorkdayIndex {
  const days: number[] = []
  const indexOf = new Map<number, number>()
  let current = snapToWorkingDay(calendar, from, 1)
  while (days.length < MAX_HORIZON_WORKDAYS) {
    if (isWorkingDay(calendar, current)) {
      indexOf.set(current, days.length)
      days.push(current)
    }
    current += DAY_MS
  }
  return { days, indexOf }
}

function toIndex(index: WorkdayIndex, calendar: WorkingCalendar, day: number): number {
  const snapped = snapToWorkingDay(calendar, day, 1)
  return index.indexOf.get(snapped) ?? 0
}

interface LevelTask {
  id: string
  position: number
  roles: string[]
  duration: number
  /** 同时投入人数：一个任务每天占用各角色容量的份数（缺省 1）。 */
  headcount: number
  release: number
  originalStart: number
  originalEnd: number
  tail: number
  /** 投产类任务：不得与封网窗口重叠。 */
  production: boolean
}

/** 任务的同时投入人数（草案可选字段 headcount，缺失/非法按 1；模型写的是普通数字）。 */
function taskHeadcount(task: JsonObject): number {
  const raw = isObject(task.headcount) ? markedValue(task.headcount) : task.headcount
  const value = Number(raw)
  return Number.isFinite(value) && value >= 1 ? Math.min(50, Math.round(value)) : 1
}

interface LevelOutcome {
  starts: Map<string, number>
  ends: Map<string, number>
  cycle: boolean
}

/** 串行进度生成法：依赖可行 + 各角色同日并发 ≤ 人数，任务只顺延不提前。 */
function serialSchedule(
  tasks: LevelTask[],
  dependencies: JsonObject[],
  capacity: Map<string, number>,
  frozen: ReadonlySet<number> = new Set(),
): LevelOutcome {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const incoming = new Map<string, JsonObject[]>(tasks.map((task) => [task.id, []]))
  const successors = new Map<string, string[]>(tasks.map((task) => [task.id, []]))
  const indegree = new Map<string, number>(tasks.map((task) => [task.id, 0]))
  for (const dependency of dependencies) {
    const from = String(dependency.predecessorId)
    const to = String(dependency.successorId)
    if (!byId.has(from) || !byId.has(to) || from === to) continue
    incoming.get(to)!.push(dependency)
    successors.get(from)!.push(to)
    indegree.set(to, indegree.get(to)! + 1)
  }

  // 后续最长路径（含自身工期）：原计划开始日相同时，先放后面链条更长的任务。
  const order: string[] = []
  const pending = new Map(indegree)
  const queue = tasks.filter((task) => pending.get(task.id) === 0).map((task) => task.id)
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of successors.get(id)!) {
      pending.set(next, pending.get(next)! - 1)
      if (pending.get(next) === 0) queue.push(next)
    }
  }
  if (order.length !== tasks.length) return { starts: new Map(), ends: new Map(), cycle: true }
  for (const id of [...order].reverse()) {
    const task = byId.get(id)!
    const longest = Math.max(0, ...successors.get(id)!.map((next) => byId.get(next)!.tail))
    task.tail = task.duration + longest
  }

  const usage = new Map<string, Int32Array>()
  const usageFor = (role: string) => {
    let row = usage.get(role)
    if (!row) {
      row = new Int32Array(MAX_HORIZON_WORKDAYS + 64)
      usage.set(role, row)
    }
    return row
  }
  const fits = (task: LevelTask, start: number) => {
    if (task.production) {
      for (let day = start; day < start + task.duration; day++) if (frozen.has(day)) return false
    }
    for (const role of task.roles) {
      const cap = capacity.get(role)
      if (cap === undefined) continue
      // 投入人数超过角色现有人数时按满员占用（补员建议由并发峰值单独给出），避免任务永远排不进来。
      const need = Math.min(task.headcount, cap)
      const row = usageFor(role)
      for (let day = start; day < start + task.duration; day++) {
        if (row[day] + need > cap) return false
      }
    }
    return true
  }

  const starts = new Map<string, number>()
  const ends = new Map<string, number>()
  const remaining = new Map(indegree)
  const eligible = new Set(tasks.filter((task) => remaining.get(task.id) === 0).map((t) => t.id))
  const horizon = MAX_HORIZON_WORKDAYS - 1
  while (eligible.size > 0) {
    let pick: LevelTask | null = null
    for (const id of eligible) {
      const candidate = byId.get(id)!
      if (
        pick === null ||
        candidate.release < pick.release ||
        (candidate.release === pick.release && candidate.tail > pick.tail) ||
        (candidate.release === pick.release &&
          candidate.tail === pick.tail &&
          candidate.position < pick.position)
      ) {
        pick = candidate
      }
    }
    const task = pick!
    eligible.delete(task.id)

    let earliest = task.release
    for (const dependency of incoming.get(task.id)!) {
      const predecessor = String(dependency.predecessorId)
      const lag = Math.round(Number(markedValue(dependency.lagDays)) || 0)
      const predStart = starts.get(predecessor)!
      const predEnd = ends.get(predecessor)!
      switch (dependency.type) {
        case 'SS':
          earliest = Math.max(earliest, predStart + lag)
          break
        case 'FF':
          earliest = Math.max(earliest, predEnd + lag - task.duration + 1)
          break
        case 'SF':
          earliest = Math.max(earliest, predStart + lag - task.duration + 1)
          break
        default:
          earliest = Math.max(earliest, predEnd + 1 + lag)
      }
    }
    let start = Math.max(0, earliest)
    while (start + task.duration - 1 < horizon && !fits(task, start)) start++
    for (const role of task.roles) {
      const cap = capacity.get(role)
      if (cap === undefined) continue
      const row = usageFor(role)
      const need = Math.min(task.headcount, cap)
      for (let day = start; day < start + task.duration; day++) row[day] += need
    }
    starts.set(task.id, start)
    ends.set(task.id, start + task.duration - 1)

    for (const next of successors.get(task.id)!) {
      remaining.set(next, remaining.get(next)! - 1)
      if (remaining.get(next) === 0) eligible.add(next)
    }
  }
  return { starts, ends, cycle: false }
}

/** 原计划（未平衡）下各角色的并发峰值（计入任务投入人数），用来估算按期完成需补几人。 */
function peakConcurrency(tasks: LevelTask[]): Map<string, number> {
  const perRole = new Map<string, Map<number, number>>()
  for (const task of tasks) {
    for (const role of task.roles) {
      const days = perRole.get(role) ?? new Map<number, number>()
      for (let day = task.originalStart; day <= task.originalEnd; day++) {
        days.set(day, (days.get(day) ?? 0) + task.headcount)
      }
      perRole.set(role, days)
    }
  }
  return new Map(
    [...perRole.entries()].map(([role, days]) => [role, Math.max(0, ...days.values())]),
  )
}

function withMarker(field: unknown, value: unknown, reason: string): JsonObject {
  const marker = isObject(field) && isObject(field.marker) ? field.marker : {}
  return {
    value,
    marker: {
      confidence: typeof marker.confidence === 'number' ? marker.confidence : 0.7,
      source: 'inferred',
      reason,
      needsConfirmation: true,
    },
  }
}

/**
 * 对草案做资源计划后处理。只在内容确有变化时返回 changed=true；
 * 名册为空时仍做角色归一、资源建议补齐与平衡（容量取模型给出的资源建议）。
 */
export function planDraftResources(
  draft: JsonObject,
  roster: readonly TeamRosterEntry[],
  calendar: WorkingCalendar = createWorkingCalendar(),
  freezeWindows: readonly ChangeFreezeWindow[] = [],
  options: ResourcePlanOptions = {},
): ResourcePlanResult {
  const tasks = (Array.isArray(draft.tasks) ? draft.tasks : []).filter(isObject)
  const dependencies = (Array.isArray(draft.dependencies) ? draft.dependencies : []).filter(
    isObject,
  )
  const hints = (Array.isArray(draft.resourceHints) ? draft.resourceHints : []).filter(isObject)
  const report: ResourcePlanReport = {
    rosterRoles: roster.length,
    canonicalizedTasks: 0,
    adjustedHints: [],
    addedHints: [],
    shiftedTasks: 0,
    leveled: false,
    skippedReason: null,
    plannedEndDate: null,
    deadline: null,
    deadlineExceededWorkdays: 0,
    staffingSuggestions: [],
  }
  let changed = false
  /** 开工锚点重排时，把模型给的其它日期（未关联任务的里程碑）按同一工作日偏移平移。 */
  let rebaseDay: ((day: number) => number) | null = null

  // 1) 任务负责人归一到名册角色名（assigneeRoleIds 是容量裁决与平衡的稳定键）。
  const nextTasks: JsonObject[] = tasks.map((task) => {
    const labels = taskRoleLabels(task)
    if (labels.length === 0) return task
    const roles = [...new Set(labels.map((label) => canonicalRole(label, roster)))]
    const current = markedValue(task.assigneeRoleIds)
    if (Array.isArray(current) && JSON.stringify(current) === JSON.stringify(roles)) return task
    report.canonicalizedTasks++
    changed = true
    const marker = isObject(task.assigneeRoleIds) && isObject(task.assigneeRoleIds.marker)
    return {
      ...task,
      assigneeRoleIds: {
        value: roles,
        marker: marker
          ? (task.assigneeRoleIds as JsonObject).marker
          : {
              confidence: 0.8,
              source: 'inferred',
              reason: '按团队名册归一负责人角色',
              needsConfirmation: false,
            },
      },
    }
  })

  // 2) 资源建议对齐名册：名册角色人数以用户确认为准；同一角色的多条建议合并，避免容量被重复累加。
  const rosterByRole = new Map(roster.map((entry) => [entry.role, entry]))
  const nextHints: JsonObject[] = []
  const hintByRole = new Map<string, JsonObject>()
  for (const hint of hints) {
    const label = markedValue(hint.role)
    if (typeof label !== 'string' || !label.trim()) continue
    const role = canonicalRole(label, roster)
    if (hintByRole.has(role)) {
      report.adjustedHints.push(`${label}→合并到${role}`)
      changed = true
      continue
    }
    let next: JsonObject = hint
    if (role !== label) {
      next = { ...next, role: { ...(hint.role as JsonObject), value: role } }
      changed = true
    }
    const confirmed = rosterByRole.get(role)
    const headcountMarker =
      isObject(hint.headcount) && isObject(hint.headcount.marker) ? hint.headcount.marker : null
    if (
      confirmed &&
      (markedValue(hint.headcount) !== confirmed.headcount ||
        headcountMarker?.reason !== rosterMarker(confirmed).reason)
    ) {
      report.adjustedHints.push(
        `${role} ${String(markedValue(hint.headcount))}→${confirmed.headcount}`,
      )
      next = {
        ...next,
        headcount: { value: confirmed.headcount, marker: rosterMarker(confirmed) },
      }
      changed = true
    }
    hintByRole.set(role, next)
    nextHints.push(next)
  }
  for (const entry of roster) {
    if (hintByRole.has(entry.role)) continue
    const hint: JsonObject = {
      id: `resource-roster-${nextHints.length + 1}`,
      role: { value: entry.role, marker: rosterMarker(entry) },
      headcount: { value: entry.headcount, marker: rosterMarker(entry) },
      allocationNote: {
        value:
          entry.source === 'ai'
            ? `按角色估算建议配置 ${entry.headcount} 人（AI 假设，请确认实际可投入人数）。`
            : `按已确认团队构成配置 ${entry.headcount} 人，全程投入。`,
        marker: {
          confidence: 0.8,
          source: 'inferred',
          reason: '按名册补齐',
          needsConfirmation: false,
        },
      },
    }
    hintByRole.set(entry.role, hint)
    nextHints.push(hint)
    report.addedHints.push(entry.role)
    changed = true
  }

  // 3) 构造平衡输入（日期无效的任务不参与平衡、不占用容量）。
  const datedTasks = nextTasks
    .map((task, position) => ({
      task,
      position,
      start: parseDay(markedValue(task.startDate)),
      end: parseDay(markedValue(task.endDate)),
    }))
    .filter(
      (item): item is { task: JsonObject; position: number; start: number; end: number } =>
        item.start !== null && item.end !== null && item.end >= item.start,
    )

  // 名册外角色：项目经理族按 1 人（真实约束）；协作方按原计划并发峰值估计，均标记待确认。
  const roleList = (task: JsonObject) => {
    const value = markedValue(task.assigneeRoleIds)
    return Array.isArray(value) ? (value as string[]) : []
  }
  const anchor = parseDay(options.projectStart ?? null)
  if (datedTasks.length === 0 && anchor === null) {
    report.skippedReason = 'no_dated_tasks'
    return finish()
  }
  const modelFirstDay =
    datedTasks.length > 0 ? Math.min(...datedTasks.map((item) => item.start)) : anchor!
  const firstDay = anchor ?? modelFirstDay
  const index = buildWorkdayIndex(calendar, firstDay)
  // 有开工锚点时：模型日期只作相对先后（相对模型最早开工日的工作日偏移），无日期的任务从第 0 天可排。
  const modelIndex = anchor === null ? index : buildWorkdayIndex(calendar, modelFirstDay)
  if (anchor !== null && modelFirstDay !== anchor) {
    rebaseDay = (day) => index.days[toIndex(modelIndex, calendar, Math.max(day, modelFirstDay))]
  }
  const datedIds = new Set(datedTasks.map((item) => item.position))
  const planItems =
    anchor === null
      ? datedTasks
      : [
          ...datedTasks,
          ...nextTasks
            .map((task, position) => ({ task, position, start: null, end: null }))
            .filter((item) => !datedIds.has(item.position)),
        ]
  const levelTasks: LevelTask[] = planItems.map((item) => {
    if (item.start === null || item.end === null) {
      const planned = Number(markedValue(item.task.durationDays))
      const name = markedValue(item.task.name)
      return {
        id: String(item.task.id),
        position: item.position,
        roles: isOngoingTask(markedValue(item.task.name)) ? [] : roleList(item.task),
        duration:
          options.compress && isOngoingTask(name)
            ? 1
            : Number.isFinite(planned) && planned >= 1
              ? Math.round(planned)
              : 1,
        headcount: taskHeadcount(item.task),
        production: typeof name === 'string' && isProductionChangeTask(name),
        release: 0,
        originalStart: -1,
        originalEnd: -1,
        tail: 0,
      }
    }
    const originalStart = toIndex(modelIndex, calendar, item.start)
    const originalEnd = Math.max(originalStart, toIndex(modelIndex, calendar, item.end))
    const span = originalEnd - originalStart + 1
    // 工期以模型给出的工作日数为准（它按「只排除周末」算日期，跨春节等假期时日期跨度会失真）；
    // 工期缺失或明显离谱时退回日期跨度。
    const planned = Number(markedValue(item.task.durationDays))
    // 有开工锚点时日期可能只是占位（同一天），工期完全以模型估算为准。
    const plannedOk =
      Number.isFinite(planned) &&
      planned >= 1 &&
      (anchor !== null ? planned <= 250 : planned <= span * 3)
    const name = markedValue(item.task.name)
    const duration =
      options.compress && isOngoingTask(name) ? 1 : plannedOk ? Math.round(planned) : span
    return {
      id: String(item.task.id),
      position: item.position,
      roles: isOngoingTask(markedValue(item.task.name)) ? [] : roleList(item.task),
      duration,
      headcount: taskHeadcount(item.task),
      production: typeof name === 'string' && isProductionChangeTask(name),
      release: options.compress ? 0 : originalStart,
      originalStart,
      originalEnd,
      tail: 0,
    }
  })
  const peaks = peakConcurrency(levelTasks)
  for (const [role, peak] of peaks) {
    if (hintByRole.has(role)) continue
    const isManager = familyOf(role) === '项目经理'
    // 负责人写成成员代号：这是用户 @ 的一个具体的人，不是一个可以按并发估人数的角色。
    const isMember = /^成员#\d+$/u.test(role)
    const external = !isManager && !isMember && EXTERNAL_TEAM_PATTERN.test(role)
    const headcount = isManager || isMember ? 1 : Math.max(1, peak)
    const hint: JsonObject = {
      id: `resource-inferred-${nextHints.length + 1}`,
      role: {
        value: role,
        marker: {
          confidence: 0.6,
          source: 'inferred',
          reason: '名册外角色',
          needsConfirmation: true,
        },
      },
      headcount: {
        value: headcount,
        marker: {
          confidence: 0.5,
          source: 'inferred',
          reason: isManager ? '名册未含，按 1 人估计' : '名册未含，按排期并发估计',
          needsConfirmation: true,
        },
      },
      allocationNote: {
        value: external
          ? `名册外协作方，按排期同时段最多 ${headcount} 项工作估计投入，请确认对方可投入人数。`
          : `已确认团队构成中未包含该角色，按 ${headcount} 人估计，请确认是否额外配置。`,
        marker: {
          confidence: 0.5,
          source: 'inferred',
          reason: '名册外角色',
          needsConfirmation: true,
        },
      },
    }
    hintByRole.set(role, hint)
    nextHints.push(hint)
    report.addedHints.push(role)
    changed = true
  }

  const capacity = new Map<string, number>()
  for (const [role, hint] of hintByRole) {
    const value = Number(markedValue(hint.headcount))
    if (Number.isInteger(value) && value > 0) capacity.set(role, value)
  }

  const frozen = new Set<number>()
  for (const window of freezeWindows) {
    const from = parseDay(window.start)
    const to = parseDay(window.end)
    if (from === null || to === null) continue
    index.days.forEach((day, position) => {
      if (day >= from && day <= to) frozen.add(position)
    })
  }
  let outcome = justifiedSchedule(levelTasks, dependencies, capacity, frozen)
  if (outcome.cycle) {
    report.skippedReason = 'dependency_cycle'
    return finish()
  }
  if (options.sizeToDeadline) {
    const sized = sizeTeamToDeadline({
      levelTasks,
      dependencies,
      capacity,
      frozen,
      outcome,
      deadlineIndex: deadlineIndexFor(draft, index, calendar),
      limits: options.sizeToDeadline,
    })
    outcome = sized.outcome
    for (const [role, headcount] of sized.raised) {
      const hint = hintByRole.get(role)
      if (!hint) continue
      const before = markedValue(hint.headcount)
      const next: JsonObject = {
        ...hint,
        headcount: {
          value: headcount,
          marker: {
            confidence: 0.5,
            source: 'inferred',
            reason: '按角色估算：为在截止日前完成所需的人数',
            needsConfirmation: true,
          },
        },
      }
      hintByRole.set(role, next)
      const position = nextHints.indexOf(hint)
      if (position >= 0) nextHints[position] = next
      report.adjustedHints.push(`${role} ${String(before)}→${headcount}（按工期估算）`)
      changed = true
    }
    report.sizedRoles = [...sized.raised.keys()]
  }
  if (options.compress) {
    // 持续性任务拉伸到实际工作的最后一天（至少保持自身 1 天）。
    const ongoingIds = new Set(
      nextTasks
        .filter((task) => isOngoingTask(markedValue(task.name)))
        .map((task) => String(task.id)),
    )
    const realEnds = levelTasks
      .filter((task) => !ongoingIds.has(task.id))
      .map((task) => outcome.ends.get(task.id) ?? 0)
    const realLast = realEnds.length > 0 ? Math.max(...realEnds) : 0
    for (const id of ongoingIds) {
      const start = outcome.starts.get(id)
      if (start !== undefined) outcome.ends.set(id, Math.max(start, realLast))
    }
  }
  report.leveled = true
  const levelById = new Map(levelTasks.map((task) => [task.id, task]))
  for (let position = 0; position < nextTasks.length; position++) {
    const task = nextTasks[position]
    const id = String(task.id)
    const start = outcome.starts.get(id)
    const end = outcome.ends.get(id)
    const original = levelById.get(id)
    if (start === undefined || end === undefined || !original) continue
    const nextStart = formatIsoDate(index.days[start])
    const nextEnd = formatIsoDate(index.days[end])
    if (nextStart === markedValue(task.startDate) && nextEnd === markedValue(task.endDate)) continue
    const shift = start - original.originalStart
    const reason =
      anchor !== null && modelFirstDay !== anchor
        ? '按确认的开工日与工作日历重排'
        : original.originalStart < 0
          ? '按依赖与工作日历排定'
          : shift > 0
            ? original.production && frozen.size > 0
              ? `资源平衡 / 避开封网顺延 ${shift} 个工作日`
              : `资源平衡顺延 ${shift} 个工作日`
            : '按工作日历（含法定节假日）重算完成日'
    nextTasks[position] = {
      ...task,
      startDate: withMarker(task.startDate, nextStart, reason),
      endDate: withMarker(task.endDate, nextEnd, reason),
    }
    report.shiftedTasks++
    changed = true
  }

  const lastEnd = Math.max(...levelTasks.map((task) => outcome.ends.get(task.id) ?? 0))
  report.plannedEndDate = formatIsoDate(index.days[lastEnd])
  const charter = isObject(draft.charter) ? draft.charter : {}
  const deadlineDay = parseDay(markedValue(charter.endDate))
  if (deadlineDay !== null) {
    report.deadline = formatIsoDate(deadlineDay)
    const deadlineIndex = toIndex(index, calendar, snapToWorkingDay(calendar, deadlineDay, -1))
    report.deadlineExceededWorkdays = Math.max(0, lastEnd - deadlineIndex)
  }
  if (report.deadlineExceededWorkdays > 0) {
    for (const [role, peak] of peaks) {
      const cap = capacity.get(role)
      if (cap !== undefined && peak > cap)
        report.staffingSuggestions.push({ role, extra: peak - cap })
    }
    report.staffingSuggestions.sort((a, b) => b.extra - a.extra)
  }
  return finish()

  function finish(): ResourcePlanResult {
    const taskDates = new Map(
      nextTasks.map((task) => [String(task.id), parseDay(markedValue(task.endDate))]),
    )
    let nextMilestones = (
      Array.isArray(draft.milestoneHints) ? draft.milestoneHints : []
    ) as unknown[]
    let nextRisks = (Array.isArray(draft.riskHints) ? draft.riskHints : []) as unknown[]
    let ganttPreview = draft.ganttPreview
    if (report.shiftedTasks > 0) {
      // 里程碑不能早于其关联任务的完成日。
      nextMilestones = nextMilestones.map((milestone) => {
        if (!isObject(milestone) || !Array.isArray(milestone.linkedTaskIds)) return milestone
        const target = parseDay(markedValue(milestone.targetDate))
        const linkedEnds = milestone.linkedTaskIds
          .map((id) => taskDates.get(String(id)) ?? null)
          .filter((day): day is number => day !== null)
        if (target === null) return milestone
        if (linkedEnds.length === 0) {
          if (!rebaseDay) return milestone
          return {
            ...milestone,
            targetDate: withMarker(
              milestone.targetDate,
              formatIsoDate(rebaseDay(target)),
              '按确认的开工日重排',
            ),
          }
        }
        const latest = Math.max(...linkedEnds)
        // 重排后里程碑直接对齐关联任务的最晚完成日（可能提前也可能顺延）；否则只顺延不提前。
        if (latest <= target && !rebaseDay) return milestone
        if (latest === target) return milestone
        return {
          ...milestone,
          targetDate: withMarker(
            milestone.targetDate,
            formatIsoDate(latest),
            rebaseDay ? '按确认的开工日与关联任务完成日重排' : '随资源平衡后的关联任务顺延',
          ),
        }
      })
      ganttPreview =
        deriveGanttPreview(nextTasks, dependencies, Array.isArray(draft.wbs) ? draft.wbs : []) ??
        draft.ganttPreview
    }
    if (report.deadlineExceededWorkdays > 0) {
      const staffing = report.staffingSuggestions
        .slice(0, 4)
        .map((item) => `${item.role}增加 ${item.extra} 人`)
        .join('、')
      nextRisks = [
        ...nextRisks.filter((risk) => !(isObject(risk) && risk.id === 'risk-resource-leveling')),
        {
          id: 'risk-resource-leveling',
          description: {
            value: `${report.sizedRoles?.length || !roster.length ? '按 AI 估算的团队人数' : '按已确认团队人数'}做资源平衡后，计划完工日为 ${report.plannedEndDate}，晚于目标截止日 ${report.deadline} 约 ${report.deadlineExceededWorkdays} 个工作日。`,
            marker: {
              confidence: 0.9,
              source: 'inferred',
              reason: '资源平衡推导',
              needsConfirmation: true,
            },
          },
          level: {
            value: 'high',
            marker: {
              confidence: 0.9,
              source: 'inferred',
              reason: '资源平衡推导',
              needsConfirmation: true,
            },
          },
          mitigation: {
            value: staffing
              ? `建议${staffing}，或压缩范围、分批上线后再评估截止日。`
              : '建议压缩范围、分批上线，或与业务方确认截止日弹性。',
            marker: {
              confidence: 0.7,
              source: 'inferred',
              reason: '资源平衡推导',
              needsConfirmation: true,
            },
          },
        },
      ]
      changed = true
    }
    return {
      changed,
      tasks: nextTasks,
      resourceHints: nextHints,
      riskHints: nextRisks,
      milestoneHints: nextMilestones,
      ganttPreview,
      report,
    }
  }
}

/** 章程截止日在工作日索引中的位置（取不晚于截止日的最后一个工作日）；无截止日返回 null。 */
function deadlineIndexFor(
  draft: JsonObject,
  index: WorkdayIndex,
  calendar: WorkingCalendar,
): number | null {
  const charter = isObject(draft.charter) ? draft.charter : {}
  const deadline = parseDay(markedValue(charter.endDate))
  if (deadline === null) return null
  return toIndex(index, calendar, snapToWorkingDay(calendar, deadline, -1))
}

/**
 * 按角色估算团队时的人数估算：平衡后仍晚于截止日，就给最吃紧的角色（人天 ÷ 人数 最大）加 1 人，
 * 重新平衡，直到按期或加人不再缩短工期（纯依赖链本身超长时加人无效，不能无限加）。
 * 只用于团队是 AI 假设的场景；用户确认过的名册人数不改。
 */
function sizeTeamToDeadline(args: {
  levelTasks: LevelTask[]
  dependencies: JsonObject[]
  capacity: Map<string, number>
  frozen: ReadonlySet<number>
  outcome: LevelOutcome
  deadlineIndex: number | null
  limits: { maxPerRole: number; maxTotal: number }
}): { outcome: LevelOutcome; raised: Map<string, number> } {
  const raised = new Map<string, number>()
  let { outcome } = args
  if (args.deadlineIndex === null) return { outcome, raised }
  const endOf = (result: LevelOutcome) => Math.max(0, ...result.ends.values())
  const workload = new Map<string, number>()
  for (const task of args.levelTasks) {
    for (const role of task.roles) {
      // 项目经理只有 1 人是真实约束，不按工期往上加。
      if (args.capacity.has(role) && familyOf(role) !== '项目经理') {
        workload.set(role, (workload.get(role) ?? 0) + task.duration * task.headcount)
      }
    }
  }
  // 人数上限不超过「工作量 ÷ 可用工作日」的 2 倍（再多的人也排不开活）。
  const available = Math.max(1, args.deadlineIndex + 1)
  const roleCap = (role: string) =>
    Math.min(
      args.limits.maxPerRole,
      Math.max(1, Math.ceil(((workload.get(role) ?? 0) / available) * 2)),
    )
  let stalled = 0
  for (let iteration = 0; iteration < 40 && endOf(outcome) > args.deadlineIndex; iteration++) {
    const total = [...args.capacity.values()].reduce((sum, value) => sum + value, 0)
    if (total >= args.limits.maxTotal) break
    const candidates = [...workload.entries()]
      .filter(([role]) => (args.capacity.get(role) ?? 0) < roleCap(role))
      .sort((a, b) => b[1] / args.capacity.get(b[0])! - a[1] / args.capacity.get(a[0])!)
    const role = candidates[0]?.[0]
    if (!role) break
    const before = endOf(outcome)
    const previous = args.capacity.get(role)!
    args.capacity.set(role, previous + 1)
    const next = justifiedSchedule(args.levelTasks, args.dependencies, args.capacity, args.frozen)
    if (next.cycle || endOf(next) >= before) {
      // 加这个人不缩短工期：撤回，并且不再考虑这个角色（瓶颈不在它）。
      args.capacity.set(role, previous)
      workload.delete(role)
      stalled++
      if (stalled >= 3 || workload.size === 0) break
      continue
    }
    stalled = 0
    outcome = next
    raised.set(role, previous + 1)
  }
  return { outcome, raised }
}

/**
 * 持续性管理工作（例会、周报、进度 / 风险跟踪、干系人沟通、变更管理……）：
 * 实际是每周几小时、贯穿全程的工作，不应按全职占满负责人（实测单个项目经理 / 产品经理因此成为全项目瓶颈，
 * 最终排期比理论最短多出 40–70%）。平衡时它们不占角色容量，日期与依赖照常。
 */
const ONGOING_TASK =
  /(例会|周会|站会|周报|月报|进度跟踪|进度监控|进度管控|风险跟踪|风险监控|风险管理|问题跟踪|干系人沟通|沟通协调|日常协调|持续协调|变更管理|变更控制|项目管控|项目监控|全程跟踪|贯穿全程|持续跟踪)/u

export function isOngoingTask(name: unknown): boolean {
  return typeof name === 'string' && ONGOING_TASK.test(name)
}

type DependencyKind = 'FS' | 'SS' | 'FF' | 'SF'

function kindOf(dependency: JsonObject): DependencyKind {
  const type = String(dependency.type ?? 'FS').toUpperCase()
  return type === 'SS' || type === 'FF' || type === 'SF' ? type : 'FS'
}

/**
 * 双向对齐（double justification）：在串行进度生成的结果上，先按完工日倒序把任务尽量右移（不超过当前总工期），
 * 再按右移后的开始日正序尽量左移。资源受限排期的经典改进，通常能消掉单趟贪心留下的空档。
 * 只在总工期真的缩短时采用。
 */
function justify(
  tasks: LevelTask[],
  dependencies: JsonObject[],
  capacity: Map<string, number>,
  frozen: ReadonlySet<number>,
  outcome: LevelOutcome,
): LevelOutcome {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const incoming = new Map<string, JsonObject[]>(tasks.map((task) => [task.id, []]))
  const outgoing = new Map<string, JsonObject[]>(tasks.map((task) => [task.id, []]))
  for (const dependency of dependencies) {
    const from = String(dependency.predecessorId)
    const to = String(dependency.successorId)
    if (!byId.has(from) || !byId.has(to) || from === to) continue
    incoming.get(to)!.push(dependency)
    outgoing.get(from)!.push(dependency)
  }
  const lagOf = (dependency: JsonObject) => Math.round(Number(markedValue(dependency.lagDays)) || 0)
  const makeGrid = () => {
    const usage = new Map<string, Int32Array>()
    const row = (role: string) => {
      let line = usage.get(role)
      if (!line) {
        line = new Int32Array(MAX_HORIZON_WORKDAYS + 64)
        usage.set(role, line)
      }
      return line
    }
    const fits = (task: LevelTask, start: number) => {
      if (start < 0 || start + task.duration > MAX_HORIZON_WORKDAYS) return false
      if (task.production) {
        for (let day = start; day < start + task.duration; day++) if (frozen.has(day)) return false
      }
      for (const role of task.roles) {
        const cap = capacity.get(role)
        if (cap === undefined) continue
        const need = Math.min(task.headcount, cap)
        const line = row(role)
        for (let day = start; day < start + task.duration; day++)
          if (line[day]! + need > cap) return false
      }
      return true
    }
    const occupy = (task: LevelTask, start: number) => {
      for (const role of task.roles) {
        const cap = capacity.get(role)
        if (cap === undefined) continue
        const line = row(role)
        for (let day = start; day < start + task.duration; day++)
          line[day]! += Math.min(task.headcount, cap)
      }
    }
    return { fits, occupy }
  }
  const makespan = (ends: Map<string, number>) => Math.max(0, ...ends.values())

  let best = outcome
  for (let round = 0; round < 3; round++) {
    const limit = makespan(best.ends)
    // —— 右移：按完工日倒序，每个任务尽量晚（受后继与总工期约束）
    const lateStart = new Map<string, number>()
    const backward = makeGrid()
    const byEndDesc = [...tasks].sort((a, b) => best.ends.get(b.id)! - best.ends.get(a.id)!)
    for (const task of byEndDesc) {
      let latest = limit - task.duration + 1
      for (const dependency of outgoing.get(task.id)!) {
        const successor = byId.get(String(dependency.successorId))!
        const succStart = lateStart.get(successor.id)
        if (succStart === undefined) continue
        const succEnd = succStart + successor.duration - 1
        const lag = lagOf(dependency)
        switch (kindOf(dependency)) {
          case 'SS':
            latest = Math.min(latest, succStart - lag)
            break
          case 'FF':
            latest = Math.min(latest, succEnd - lag - task.duration + 1)
            break
          case 'SF':
            latest = Math.min(latest, succEnd - lag)
            break
          default:
            latest = Math.min(latest, succStart - lag - task.duration)
        }
      }
      let start = latest
      while (start > 0 && !backward.fits(task, start)) start--
      backward.occupy(task, Math.max(0, start))
      lateStart.set(task.id, Math.max(0, start))
    }
    // —— 左移：按右移后的开始日正序，每个任务尽量早（受前置约束）
    const forward = makeGrid()
    const starts = new Map<string, number>()
    const ends = new Map<string, number>()
    const byStart = [...tasks].sort((a, b) => lateStart.get(a.id)! - lateStart.get(b.id)!)
    for (const task of byStart) {
      let earliest = 0
      for (const dependency of incoming.get(task.id)!) {
        const predecessor = String(dependency.predecessorId)
        const predStart = starts.get(predecessor)
        const predEnd = ends.get(predecessor)
        if (predStart === undefined || predEnd === undefined) continue
        const lag = lagOf(dependency)
        switch (kindOf(dependency)) {
          case 'SS':
            earliest = Math.max(earliest, predStart + lag)
            break
          case 'FF':
            earliest = Math.max(earliest, predEnd + lag - task.duration + 1)
            break
          case 'SF':
            earliest = Math.max(earliest, predStart + lag - task.duration + 1)
            break
          default:
            earliest = Math.max(earliest, predEnd + 1 + lag)
        }
      }
      let start = Math.max(0, earliest)
      while (start + task.duration < MAX_HORIZON_WORKDAYS && !forward.fits(task, start)) start++
      forward.occupy(task, start)
      starts.set(task.id, start)
      ends.set(task.id, start + task.duration - 1)
    }
    // 左移按正序放置：若某任务的前置在它之后才放（右移顺序与依赖冲突），结果不可信，放弃本轮。
    const valid = tasks.every((task) =>
      incoming.get(task.id)!.every((dependency) => {
        const predecessor = String(dependency.predecessorId)
        const predEnd = ends.get(predecessor)!
        const predStart = starts.get(predecessor)!
        const lag = lagOf(dependency)
        switch (kindOf(dependency)) {
          case 'SS':
            return starts.get(task.id)! >= predStart + lag
          case 'FF':
            return ends.get(task.id)! >= predEnd + lag
          case 'SF':
            return ends.get(task.id)! >= predStart + lag
          default:
            return starts.get(task.id)! >= predEnd + 1 + lag
        }
      }),
    )
    if (!valid || makespan(ends) >= makespan(best.ends)) break
    best = { starts, ends, cycle: false }
  }
  return best
}

/** 串行进度生成 + 双向对齐：平衡与按工期估人数都用它。 */
function justifiedSchedule(
  tasks: LevelTask[],
  dependencies: JsonObject[],
  capacity: Map<string, number>,
  frozen: ReadonlySet<number> = new Set(),
): LevelOutcome {
  const outcome = serialSchedule(tasks, dependencies, capacity, frozen)
  return outcome.cycle ? outcome : justify(tasks, dependencies, capacity, frozen, outcome)
}
