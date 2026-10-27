/**
 * 跨生成的规划记忆：从本组织已有数据里推出「上次怎么做的、用户改过什么、实际执行偏差多大」。
 *
 * 不另建存储——全部来自已落库的事实：
 *   - 草案原始版本（ai_project_draft_versions, origin=generated）里的团队与任务；
 *   - 转正后的正式任务（tasks）：与 AI 原稿对比得出用户删掉 / 补上 / 改工期的习惯；
 *   - 已完成任务的实际起止日期：计划与实际的偏差，用于校准工期估算；
 *   - 同类已转正项目的 WBS 一级分支名：阶段划分偏好。
 *
 * 所有查询都按 organization_id 隔离；只读，不写任何记录。样本不足的信号不产出，避免拿一两条数据左右计划。
 */
import type { DateTime } from 'luxon'
import AiProjectDraft from '#models/ai_project_draft'
import AiProjectDraftVersion from '#models/ai_project_draft_version'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import type { ProjectDraft, ProjectType } from '@aiproj/types'

export interface PlanningMemoryTeam {
  roster: Array<{ role: string; headcount: number }>
  draftUid: string
}

export interface PlanningMemory {
  /** 最近一次由该用户明确给出的团队构成（用于追问团队时作为「沿用上次」选项）。 */
  lastTeam: PlanningMemoryTeam | null
  /** 对比过的已转正草案份数。 */
  confirmedDrafts: number
  /** AI 生成过、转正时被删掉的任务名（近期优先，去重）。 */
  removedTasks: string[]
  /** AI 没生成、用户自己在项目里补上的任务名。 */
  addedTasks: string[]
  /** 用户转正时对 AI 工期的整体调整（正式任务工期 ÷ AI 估算）。 */
  editDurationFactor: { factor: number; samples: number } | null
  /** 已完成任务的实际工作日 ÷ 计划工期（中位数，已限幅）。 */
  executionFactor: { factor: number; samples: number } | null
  /** 同类已转正项目常用的一级阶段名。 */
  preferredPhases: string[]
}

export const EMPTY_PLANNING_MEMORY: PlanningMemory = {
  lastTeam: null,
  confirmedDrafts: 0,
  removedTasks: [],
  addedTasks: [],
  editDurationFactor: null,
  executionFactor: null,
  preferredPhases: [],
}

/** 执行校准至少要这么多个已完成任务样本；太少的数据只会带来噪声。 */
export const MIN_EXECUTION_SAMPLES = 8
/** 转正工期调整至少要这么多个可对比任务。 */
export const MIN_EDIT_SAMPLES = 10
/** 校准系数上下限：记忆只做温和修正，不允许把计划拉长或压缩到面目全非。 */
export const FACTOR_BOUNDS = { min: 0.8, max: 1.5 } as const

const RECENT_DRAFTS = 10
const NAME_LIMIT = 8
const DAY = 86_400_000

export async function recallPlanningMemory(args: {
  organizationId: number
  userId: number
  projectType: ProjectType | null
}): Promise<PlanningMemory> {
  const [lastTeam, edits, executionFactor] = await Promise.all([
    recallLastTeam(args.organizationId, args.userId),
    recallEdits(args.organizationId, args.projectType),
    recallExecutionFactor(args.organizationId),
  ])
  return { lastTeam, ...edits, executionFactor }
}

async function latestGeneratedDrafts(draftIds: number[]): Promise<Map<number, ProjectDraft>> {
  if (draftIds.length === 0) return new Map()
  const versions = await AiProjectDraftVersion.query()
    .whereIn('draft_id', draftIds)
    .where('origin', 'generated')
    .orderBy('version', 'desc')
  const out = new Map<number, ProjectDraft>()
  for (const version of versions) {
    if (!out.has(version.draftId) && version.draft) out.set(version.draftId, version.draft)
  }
  return out
}

async function recallLastTeam(organizationId: number, userId: number) {
  const sessions = await AiProjectDraft.query()
    .where('organization_id', organizationId)
    .where('user_id', userId)
    .orderBy('id', 'desc')
    .limit(RECENT_DRAFTS)
  const drafts = await latestGeneratedDrafts(sessions.map((session) => session.id))
  for (const session of sessions) {
    const roster = explicitRoster(drafts.get(session.id))
    if (roster.length > 0) return { roster, draftUid: session.draftUid }
  }
  return null
}

/** 只取用户明确给出的团队（marker.source=explicit），AI 估算的团队不算「上次的团队」。 */
export function explicitRoster(draft: ProjectDraft | undefined) {
  const hints = Array.isArray(draft?.resourceHints) ? draft.resourceHints : []
  return hints
    .filter(
      (hint) =>
        hint?.headcount?.marker?.source === 'explicit' || hint?.role?.marker?.source === 'explicit',
    )
    .map((hint) => ({
      role: String(hint.role?.value ?? '').trim(),
      headcount: Math.max(1, Math.round(Number(hint.headcount?.value) || 1)),
    }))
    .filter((entry) => entry.role && !/^成员#\d+$/u.test(entry.role))
}

/** 同类已转正草案 vs 正式项目的删补任务、工期调整与阶段偏好（计划档案打法页复用）。 */
export async function recallEdits(organizationId: number, projectType: ProjectType | null) {
  const query = AiProjectDraft.query()
    .where('organization_id', organizationId)
    .whereNotNull('project_id')
    .orderBy('id', 'desc')
    .limit(RECENT_DRAFTS)
  if (projectType) query.where('project_type', projectType)
  const sessions = await query
  const empty = {
    confirmedDrafts: 0,
    removedTasks: [] as string[],
    addedTasks: [] as string[],
    editDurationFactor: null,
    preferredPhases: [] as string[],
  }
  if (sessions.length === 0) return empty

  const drafts = await latestGeneratedDrafts(sessions.map((session) => session.id))
  const projectIds = sessions.map((session) => session.projectId!).filter(Boolean)
  const tasks = await Task.query()
    .whereIn('project_id', projectIds)
    .whereNull('deleted_at')
    .select('project_id', 'name', 'duration_days', 'ai_metadata')
  const phases = await WbsNode.query()
    .whereIn('project_id', projectIds)
    .whereNull('parent_id')
    .whereNull('deleted_at')
    .select('name')

  const removed: string[] = []
  const added: string[] = []
  const ratios: number[] = []
  for (const session of sessions) {
    const draft = drafts.get(session.id)
    if (!draft) continue
    const projectTasks = tasks.filter((task) => task.projectId === session.projectId)
    // 导入时每个任务都在 ai_metadata 里记了来源草案任务 id：优先按它对应（用户改名也认得出），名字只作兜底。
    const byDraftTask = new Map(
      projectTasks
        .map((task) => [draftTaskIdOf(task.aiMetadata), task] as const)
        .filter(([id]) => id !== null),
    )
    const byName = new Map(projectTasks.map((task) => [normalizeName(task.name), task]))
    const matched = new Set<Task>()
    const aiNames = new Set<string>()
    for (const aiTask of Array.isArray(draft.tasks) ? draft.tasks : []) {
      const name = String(aiTask?.name?.value ?? '').trim()
      if (!name) continue
      aiNames.add(normalizeName(name))
      const match = byDraftTask.get(String(aiTask.id)) ?? byName.get(normalizeName(name))
      if (match) matched.add(match)
      if (!match) {
        removed.push(name)
        continue
      }
      const aiDays = Number(aiTask?.durationDays?.value)
      const finalDays = Number(match.durationDays)
      if (aiDays > 0 && finalDays > 0) ratios.push(finalDays / aiDays)
    }
    for (const task of projectTasks) {
      if (!matched.has(task) && !aiNames.has(normalizeName(task.name))) added.push(task.name)
    }
  }
  const editFactor =
    ratios.length >= MIN_EDIT_SAMPLES
      ? { factor: clampFactor(sum(ratios) / ratios.length), samples: ratios.length }
      : null
  return {
    confirmedDrafts: sessions.length,
    removedTasks: uniqueNames(removed),
    addedTasks: uniqueNames(added),
    editDurationFactor: editFactor && Math.abs(editFactor.factor - 1) >= 0.05 ? editFactor : null,
    preferredPhases: uniqueNames(phases.map((node) => node.name)),
  }
}

/**
 * 已完成任务的计划工期与实际工作日（最近 500 个）；projectType 给出时只取来自该类型草案的项目。
 * 计划档案参照类页复用（v3-llm-wiki-planning-dossier）。
 */
export async function collectExecutionSamples(
  organizationId: number,
  projectType: ProjectType | null = null,
  /**
   * v3-llm-wiki-person-space：只取某人负责的任务、限制条数（个人估算校准用）；
   * v3-llm-wiki-eval-gate：只取某日之前完成的任务、只取某项目（计划回测用）。缺省时行为不变。
   */
  opts: {
    assigneeId?: number
    limit?: number
    completedBefore?: DateTime
    projectId?: number
  } = {},
): Promise<Array<{ plannedDays: number; actualDays: number }>> {
  const query = Task.query()
    .join('projects', 'projects.id', 'tasks.project_id')
    .where('projects.organization_id', organizationId)
    .whereNull('tasks.deleted_at')
    .whereNotNull('tasks.actual_start_date')
    .whereNotNull('tasks.actual_end_date')
    .where('tasks.duration_days', '>', 0)
  if (projectType) {
    query.whereIn(
      'tasks.project_id',
      AiProjectDraft.query()
        .where('organization_id', organizationId)
        .where('project_type', projectType)
        .whereNotNull('project_id')
        .select('project_id'),
    )
  }
  if (opts.assigneeId !== undefined)
    query.where('tasks.assignee_id', opts.assigneeId).where('tasks.assignee_type', 'user')
  if (opts.completedBefore)
    query.where('tasks.actual_end_date', '<', opts.completedBefore.toISODate()!)
  if (opts.projectId !== undefined) query.where('tasks.project_id', opts.projectId)
  const rows = await query
    .orderBy('tasks.id', 'desc')
    .limit(opts.limit ?? 500)
    .select('tasks.duration_days', 'tasks.actual_start_date', 'tasks.actual_end_date')
  return rows
    .map((task) => {
      const start = task.actualStartDate?.toMillis()
      const end = task.actualEndDate?.toMillis()
      if (!start || !end || end < start) return null
      return { plannedDays: Number(task.durationDays), actualDays: weekdaysBetween(start, end) }
    })
    .filter(
      (s): s is { plannedDays: number; actualDays: number } =>
        s !== null &&
        Number.isFinite(s.actualDays / s.plannedDays) &&
        s.actualDays / s.plannedDays > 0,
    )
}

async function recallExecutionFactor(organizationId: number) {
  return executionFactorFromSamples(await collectExecutionSamples(organizationId))
}

/** 执行偏差系数：样本 ≥8、中位实际 ÷ 计划夹在 0.8–1.5，偏差不足 5% 视为无（计划回测复用同一规则）。 */
export function executionFactorFromSamples(
  samples: ReadonlyArray<{ plannedDays: number; actualDays: number }>,
): { factor: number; samples: number } | null {
  const ratios = samples.map((s) => s.actualDays / s.plannedDays)
  if (ratios.length < MIN_EXECUTION_SAMPLES) return null
  const factor = clampFactor(median(ratios))
  return Math.abs(factor - 1) >= 0.05 ? { factor, samples: ratios.length } : null
}

/** 给模型看的记忆摘要（每条一句，空则不注入）。 */
export function planningMemoryFacts(memory: PlanningMemory): string[] {
  const facts: string[] = []
  if (memory.removedTasks.length > 0) {
    facts.push(
      `用户过去转正同类计划时删掉过这些 AI 生成的任务（没有明确理由就不要默认加入）：${memory.removedTasks.join('、')}`,
    )
  }
  if (memory.addedTasks.length > 0) {
    facts.push(
      `用户过去在项目里自己补上过这些任务（AI 当时漏了，这次判断是否同样需要）：${memory.addedTasks.join('、')}`,
    )
  }
  if (memory.editDurationFactor) {
    facts.push(
      `用户转正时把任务工期整体调为 AI 估算的 ${memory.editDurationFactor.factor.toFixed(2)} 倍（${memory.editDurationFactor.samples} 个任务）`,
    )
  }
  if (memory.executionFactor) {
    facts.push(
      `本组织已完成任务的实际用时约为计划的 ${memory.executionFactor.factor.toFixed(2)} 倍（${memory.executionFactor.samples} 个样本），估算工作量时考虑这一偏差`,
    )
  }
  if (memory.preferredPhases.length > 0) {
    facts.push(`同类已转正项目常用的一级阶段：${memory.preferredPhases.join('、')}`)
  }
  return facts
}

/** 校准系数：执行数据优先，其次转正调整；都没有则为 1。 */
export function planningDurationFactor(
  memory: PlanningMemory,
): { factor: number; basis: string } | null {
  if (memory.executionFactor) {
    return {
      factor: memory.executionFactor.factor,
      basis: `本组织 ${memory.executionFactor.samples} 个已完成任务的实际用时约为计划的 ${memory.executionFactor.factor.toFixed(2)} 倍`,
    }
  }
  if (memory.editDurationFactor) {
    return {
      factor: memory.editDurationFactor.factor,
      basis: `用户转正时把 ${memory.editDurationFactor.samples} 个任务的工期调为 AI 估算的 ${memory.editDurationFactor.factor.toFixed(2)} 倍`,
    }
  }
  return null
}

function draftTaskIdOf(metadata: unknown): string | null {
  const value = typeof metadata === 'string' ? safeJson(metadata) : metadata
  const id =
    value && typeof value === 'object' ? (value as { draftTaskId?: unknown }).draftTaskId : null
  return typeof id === 'string' && id ? id : null
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function normalizeName(name: string) {
  return name.replace(/[\s（）()【】[\]「」:：，,。.、]/gu, '').toLowerCase()
}

function uniqueNames(names: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const key = normalizeName(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(name.trim().slice(0, 40))
    if (out.length >= NAME_LIMIT) break
  }
  return out
}

/** 校准系数限幅（计划档案读取复用）。 */
export function clampFactor(value: number) {
  return Math.round(Math.min(FACTOR_BOUNDS.max, Math.max(FACTOR_BOUNDS.min, value)) * 100) / 100
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** 起止都算在内的工作日数（只剔周末；节假日对偏差比值影响很小）。 */
function weekdaysBetween(startMs: number, endMs: number) {
  let count = 0
  for (let t = startMs; t <= endMs; t += DAY) {
    const day = new Date(t).getUTCDay()
    if (day !== 0 && day !== 6) count++
  }
  return Math.max(1, count)
}

/** 追问团队用：上次起草时用户给出的团队，格式化成可直接作为回答的一句话（如「产品经理 1 人、前端 2 人」）。 */
export async function recallLastTeamText(
  organizationId: number,
  userId: number,
): Promise<string | null> {
  const team = await recallLastTeam(organizationId, userId)
  if (!team) return null
  return team.roster.map((entry) => `${entry.role} ${entry.headcount} 人`).join('、')
}
