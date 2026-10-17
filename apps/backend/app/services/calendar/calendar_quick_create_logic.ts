/**
 * 日历快速新建的 AI 补全（日历第 2 批，2026-10-04）。
 *
 * 用户在日历上双击 / 点「+」/ 跨日拖曳选出日期，原地输入（也可以不输入），模型结合项目现况补全：
 * - 没输入：从 WBS 缺口（还没有任务的工作包）、临近里程碑与团队负载给 1–3 条建议；
 * - 输入了一部分：补全名称、起止日、工期、负责人（附理由）、工作包、优先级；
 * - 一句话里有几件事：拆成多行，按先后接排。
 *
 * 只产出建议，不落库（AI 只建议、不自动执行）：用户在小卡片上核对后按 Enter / 建立才走正式建任务接口。
 * 冲突提醒（负责人当期过载、非工作日、超出项目周期、晚于临近里程碑、和已有任务同名）由程序计算，不交给模型。
 * 模型不可用时退回规则补全，保证双击后总有一张能直接建的卡。
 */
import type { TaskPriority } from '#services/task_status_machine'
import {
  endFromStart,
  formatIsoDate,
  isWorkingDay,
  parseIsoDate,
  snapToWorkingDay,
  workingDayDuration,
  type WorkingCalendar,
} from '#services/gantt_working_calendar'
import { generateWithPlanningTools, type TextGateway } from '#services/ai_planning/planning_toolbox'

export const DAY_MS = 86_400_000
const PRIORITIES: readonly TaskPriority[] = ['lowest', 'low', 'medium', 'high', 'highest']
/** 负责人在所选日期内已有这么多件进行中的任务就提醒过载。 */
export const OVERLOAD_TASKS = 3

export type QuickCreateField = 'name' | 'dates' | 'assignee' | 'wbs' | 'priority'

export interface QuickCreateMember {
  id: number
  name: string
  role: string | null
  /** 所选日期窗口内（含前后一周）进行中的任务数。 */
  activeTasks: number
  /** 窗口内这个人不上班的日子（个人休假 / 个人工作日 / 项目资源例外，日历第 3 批）。 */
  offDays?: string[]
}

export interface QuickCreateContext {
  today: string
  projectName: string
  projectStart: string | null
  projectEnd: string | null
  /** 用户在日历上选的日期（拖曳时有 endDate）。 */
  window: { startDate: string; endDate: string | null }
  calendar: WorkingCalendar
  members: QuickCreateMember[]
  /** 可归属的工作包；没有子工作包（hasChildren=false）且 taskCount=0 即 WBS 缺口。 */
  workPackages: Array<{
    id: number
    code: string | null
    name: string
    taskCount: number
    hasChildren: boolean
  }>
  milestones: Array<{ id: number; name: string; plannedDate: string }>
  existingTaskNames: string[]
  /** 当前用户（没有成员可选时的负责人兜底）。 */
  currentUserId: number
}

export interface QuickCreateConflict {
  code:
    | 'overload'
    | 'assignee_off'
    | 'non_working'
    | 'outside_project'
    | 'after_milestone'
    | 'duplicate'
  message: string
}

export interface QuickCreateSuggestion {
  name: string
  startDate: string
  endDate: string
  durationDays: number
  assigneeId: number | null
  assigneeName: string | null
  assigneeReason: string | null
  wbsNodeId: number | null
  wbsNodeName: string | null
  priority: TaskPriority
  /** AI 补的字段（界面标 🤖）；用户自己给的不在里面。 */
  aiFields: QuickCreateField[]
  conflicts: QuickCreateConflict[]
}

export interface QuickCreateResult {
  tasks: QuickCreateSuggestion[]
  note: string | null
  source: 'ai' | 'rules'
}

/** 用户在卡片上改过之后重新算冲突用的最小输入。 */
export interface QuickCreateCheckInput {
  name: string
  startDate: string
  endDate: string
  assigneeId: number | null
}

export const isoOf = (value: unknown): string | null => {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// 冲突（程序计算）
// ---------------------------------------------------------------------------

export function quickCreateConflicts(
  task: QuickCreateCheckInput,
  context: QuickCreateContext,
): QuickCreateConflict[] {
  const conflicts: QuickCreateConflict[] = []
  const member = context.members.find((item) => item.id === task.assigneeId)
  if (member && member.activeTasks >= OVERLOAD_TASKS) {
    conflicts.push({
      code: 'overload',
      message: `${member.name} 这段时间已有 ${member.activeTasks} 件进行中的任务`,
    })
  }
  const off = member ? memberOffBetween(member, task.startDate, task.endDate) : []
  if (member && off.length > 0) {
    conflicts.push({
      code: 'assignee_off',
      message: `${member.name} ${off
        .slice(0, 3)
        .map((day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`)
        .join('、')}${off.length > 3 ? ` 等 ${off.length} 天` : ''} 休假或不上班`,
    })
  }
  if (ISO.test(task.startDate) && ISO.test(task.endDate)) {
    const start = parseIsoDate(task.startDate)
    const end = parseIsoDate(task.endDate)
    if (!isWorkingDay(context.calendar, start) || !isWorkingDay(context.calendar, end)) {
      conflicts.push({ code: 'non_working', message: '开始或截止落在非工作日' })
    }
    if (
      (context.projectStart && task.startDate < context.projectStart) ||
      (context.projectEnd && task.endDate > context.projectEnd)
    ) {
      conflicts.push({ code: 'outside_project', message: '超出项目周期' })
    }
    // 跨过了最近一个尚未完成的里程碑（开始在它之前、截止在它之后）
    const crossed = context.milestones.find(
      (item) => task.startDate <= item.plannedDate && task.endDate > item.plannedDate,
    )
    if (crossed) {
      conflicts.push({
        code: 'after_milestone',
        message: `截止晚于里程碑 ${crossed.name}（${crossed.plannedDate}）`,
      })
    }
  }
  const name = task.name.trim()
  if (name && context.existingTaskNames.some((item) => item.trim() === name)) {
    conflicts.push({ code: 'duplicate', message: '已有同名任务' })
  }
  return conflicts
}

/** 小卡片上可改负责人 / 工作包的候选（与补全用的同一份上下文）。 */
export function quickCreateOptions(context: QuickCreateContext) {
  return {
    members: context.members.map((item) => ({
      id: item.id,
      name: item.name,
      activeTasks: item.activeTasks,
    })),
    workPackages: context.workPackages.map((item) => ({ id: item.id, label: packageLabel(item) })),
  }
}

// ---------------------------------------------------------------------------
// 规则补全（模型不可用时的兜底，也给模型输出补缺）
// ---------------------------------------------------------------------------

/** 一句话里的几件事：按换行、分号、「然后 / 再」切开。 */
export function splitQuickCreateText(text: string): string[] {
  return text
    .split(/\n|；|;|，然后|，再|然后再/u)
    .map((item) => item.trim().replace(/^[\d一二三四五六七八九十]+[.、)）]\s*/u, ''))
    .filter((item) => item.length > 0)
    .slice(0, 8)
}

function rulePriority(text: string): TaskPriority {
  if (/紧急|马上|立刻|今天必须|阻塞|线上故障/u.test(text)) return 'highest'
  if (/尽快|优先|重要|关键/u.test(text)) return 'high'
  if (/有空|顺便|不急|低优先/u.test(text)) return 'low'
  return 'medium'
}

/** 这个人在 [from, to] 里不上班的日子。 */
export function memberOffBetween(member: QuickCreateMember, from: string, to: string): string[] {
  return (member.offDays ?? []).filter((day) => day >= from && day <= to)
}

/** 负载最轻的成员（同负载按名单顺序）；给了日期时优先这几天都上班的人。 */
function lightestMember(
  context: QuickCreateContext,
  dates?: { startDate: string; endDate: string },
): QuickCreateMember | null {
  const sorted = [...context.members].sort((a, b) => a.activeTasks - b.activeTasks || a.id - b.id)
  if (!dates) return sorted[0] ?? null
  return (
    sorted.find(
      (member) => memberOffBetween(member, dates.startDate, dates.endDate).length === 0,
    ) ??
    sorted[0] ??
    null
  )
}

function matchPackage(text: string, context: QuickCreateContext) {
  let best: { id: number; name: string; code: string | null; score: number } | null = null
  for (const item of context.workPackages) {
    const chars = [...new Set([...item.name])].filter((ch) => /[\p{L}\p{N}]/u.test(ch))
    const score = chars.filter((ch) => text.includes(ch)).length / Math.max(1, chars.length)
    if (score >= 0.5 && (!best || score > best.score)) best = { ...item, score }
  }
  return best
}

const packageLabel = (item: { code: string | null; name: string }) =>
  `${item.code ? `${item.code} ` : ''}${item.name}`

/** 起止日：用户给了范围就用；否则从开始日按工期排到截止（跳过非工作日）。 */
function scheduleFrom(
  context: QuickCreateContext,
  startDate: string,
  durationDays: number,
): { startDate: string; endDate: string; durationDays: number } {
  const start = snapToWorkingDay(context.calendar, parseIsoDate(startDate), 1)
  const days = Math.max(1, Math.round(durationDays))
  return {
    startDate: formatIsoDate(start),
    endDate: formatIsoDate(endFromStart(context.calendar, start, days)),
    durationDays: days,
  }
}

function userRange(context: QuickCreateContext) {
  const { startDate, endDate } = context.window
  if (!endDate || endDate === startDate) return null
  const [from, to] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate]
  return {
    startDate: from,
    endDate: to,
    durationDays: workingDayDuration(context.calendar, parseIsoDate(from), parseIsoDate(to)),
  }
}

/** 没输入时的建议：WBS 缺口优先，其次临近里程碑的收尾检查。 */
function ruleIdeas(context: QuickCreateContext): Array<{ name: string; wbsNodeId: number | null }> {
  const ideas: Array<{ name: string; wbsNodeId: number | null }> = []
  const gaps = context.workPackages.filter((pkg) => pkg.taskCount === 0 && !pkg.hasChildren)
  for (const item of gaps.slice(0, 2)) {
    ideas.push({ name: `启动${item.name}：拆出第一批任务`, wbsNodeId: item.id })
  }
  const upcoming = context.milestones.find((item) => item.plannedDate >= context.window.startDate)
  if (upcoming && ideas.length < 3) {
    ideas.push({ name: `${upcoming.name}前的验收检查`, wbsNodeId: null })
  }
  if (ideas.length === 0) ideas.push({ name: '新任务', wbsNodeId: null })
  return ideas.slice(0, 3)
}

export function ruleQuickCreate(context: QuickCreateContext, text: string): QuickCreateResult {
  const typed = text.trim()
  const range = userRange(context)
  const items = typed
    ? splitQuickCreateText(typed).map((name) => ({ name, wbsNodeId: null as number | null }))
    : ruleIdeas(context)
  let cursor = context.window.startDate
  const tasks = items.map((item, index) => {
    // 没输入时给的是几个备选（只会建其中一个）：都从选中的日期开始，不接排
    const alternatives = !typed
    const dates =
      range && (items.length === 1 || alternatives) ? range : scheduleFrom(context, cursor, 1)
    if (!alternatives) cursor = formatIsoDate(parseIsoDate(dates.endDate) + DAY_MS)
    const member = lightestMember(context, dates)
    const pkg = item.wbsNodeId
      ? (context.workPackages.find((p) => p.id === item.wbsNodeId) ?? null)
      : matchPackage(item.name, context)
    const aiFields: QuickCreateField[] = ['assignee', 'priority']
    if (!typed) aiFields.push('name')
    if (!range || (items.length > 1 && !alternatives) || (index > 0 && !alternatives))
      aiFields.push('dates')
    if (pkg) aiFields.push('wbs')
    return finalize(context, {
      name: item.name.slice(0, 60),
      ...dates,
      assigneeId: member?.id ?? context.currentUserId,
      assigneeReason: member ? `这段时间任务最少（${member.activeTasks} 件）` : null,
      wbsNodeId: pkg?.id ?? null,
      priority: rulePriority(item.name),
      aiFields,
    })
  })
  return {
    tasks,
    note: typed ? null : '按 WBS 缺口与临近里程碑给出的建议',
    source: 'rules',
  }
}

function finalize(
  context: QuickCreateContext,
  task: Omit<QuickCreateSuggestion, 'assigneeName' | 'wbsNodeName' | 'conflicts'>,
): QuickCreateSuggestion {
  const member = context.members.find((item) => item.id === task.assigneeId)
  const pkg = context.workPackages.find((item) => item.id === task.wbsNodeId)
  return {
    ...task,
    assigneeName: member?.name ?? null,
    wbsNodeName: pkg ? packageLabel(pkg) : null,
    conflicts: quickCreateConflicts(task, context),
  }
}

// ---------------------------------------------------------------------------
// 模型补全
// ---------------------------------------------------------------------------

const SYSTEM = [
  '你在帮项目成员在日历上快速建任务。用简体中文，只输出 JSON，不要多余文字。',
  '格式：{"tasks":[{"name":"…","startDate":"YYYY-MM-DD","durationDays":1,"assigneeId":1,',
  '"assigneeReason":"…","wbsNodeId":null,"priority":"medium"}],"note":null}',
  '规则：',
  '- request 为空：根据 workPackages 里 taskCount=0 且 hasChildren=false 的工作包（WBS 缺口）、临近的 milestones 与成员负载，',
  '  给 1–3 个备选（用户只会选其中一个），按推荐程度排，最该做的放第一个；',
  '- request 有内容：补全成任务；一句话里有几件事就拆成几条（最多 8 条），按先后排，后一条从前一条结束后的工作日开始；',
  '- name：「动词 + 对象 + 结果」，40 字以内；用户写得已经清楚就保持原意，只补齐；',
  '- startDate：不早于 window.startDate；window.endDate 有值且只有一条时，起止就用 window；',
  '- durationDays：整数工作日 1–10，按事情大小估；',
  '- assigneeId：只能从 members 里选；任务日期落在某人 offDays（休假 / 不上班）里就不要选他；优先角色合适、activeTasks 少的人；assigneeReason 一句话（15 字内）说明为什么是他；',
  '- wbsNodeId：只能从 workPackages 里选最相关的 id，都不相关填 null；',
  '- priority：lowest / low / medium / high / highest；没有明显紧急程度用 medium；临近里程碑的可以提高；',
  '- note：一句话说明（例如拆成了几条、为什么建议这些），没有就 null；',
  '- 不要编造项目里没有的人员、工作包或日期。',
].join('\n')

export function normalizeQuickCreate(
  raw: unknown,
  context: QuickCreateContext,
  text: string,
): QuickCreateResult | null {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = (Array.isArray(record.tasks) ? record.tasks : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .slice(0, 8)
  if (list.length === 0) return null

  const typed = text.trim()
  const range = userRange(context)
  const memberIds = new Set(context.members.map((item) => item.id))
  const packageIds = new Set(context.workPackages.map((item) => item.id))
  let cursor = context.window.startDate

  const tasks = list.map((item, index) => {
    const name =
      String(item.name ?? '')
        .trim()
        .slice(0, 60) ||
      (typed ? (splitQuickCreateText(typed)[index] ?? typed).slice(0, 60) : '新任务')
    let dates: { startDate: string; endDate: string; durationDays: number }
    let datesFromUser = false
    // 没输入时是几个备选：都从选中的日期 / 拖选范围开始，不接排
    const alternatives = !typed
    if (range && (list.length === 1 || alternatives)) {
      dates = range
      datesFromUser = true
    } else {
      const proposed = typeof item.startDate === 'string' ? item.startDate : ''
      const start = ISO.test(proposed) && proposed >= cursor ? proposed : cursor
      const duration = Number(item.durationDays)
      dates = scheduleFrom(
        context,
        start,
        Number.isFinite(duration) && duration > 0 ? Math.min(10, duration) : 1,
      )
    }
    if (!alternatives) cursor = formatIsoDate(parseIsoDate(dates.endDate) + DAY_MS)

    const assigneeId = Number(item.assigneeId)
    const fallback = lightestMember(context, dates)
    let pickedAssignee = memberIds.has(assigneeId) ? assigneeId : (fallback?.id ?? null)
    let reason =
      typeof item.assigneeReason === 'string' && item.assigneeReason.trim()
        ? item.assigneeReason.trim().slice(0, 40)
        : fallback && pickedAssignee === fallback.id
          ? `这段时间任务最少（${fallback.activeTasks} 件）`
          : null
    // 模型选的人这几天休假，而有别人上班：改派并说明（排期避开个人休假）
    const picked = context.members.find((member) => member.id === pickedAssignee)
    if (
      picked &&
      fallback &&
      fallback.id !== picked.id &&
      memberOffBetween(picked, dates.startDate, dates.endDate).length > 0 &&
      memberOffBetween(fallback, dates.startDate, dates.endDate).length === 0
    ) {
      pickedAssignee = fallback.id
      reason = `${picked.name} 这几天休假，改派给 ${fallback.name}`
    }
    const wbsNodeId = Number(item.wbsNodeId)
    const priority = PRIORITIES.includes(item.priority as TaskPriority)
      ? (item.priority as TaskPriority)
      : rulePriority(name)

    const aiFields: QuickCreateField[] = ['assignee', 'priority']
    // 名称：用户没打字，或模型改写过用户原话 → AI 补的
    const typedPart = typed ? (splitQuickCreateText(typed)[index] ?? '') : ''
    if (!typedPart || typedPart !== name) aiFields.push('name')
    if (!datesFromUser || (index > 0 && !alternatives)) aiFields.push('dates')
    if (packageIds.has(wbsNodeId)) aiFields.push('wbs')

    return finalize(context, {
      name,
      ...dates,
      assigneeId: pickedAssignee ?? context.currentUserId,
      assigneeReason: pickedAssignee ? reason : null,
      wbsNodeId: packageIds.has(wbsNodeId) ? wbsNodeId : null,
      priority,
      aiFields,
    })
  })

  return {
    tasks,
    note:
      typeof record.note === 'string' && record.note.trim()
        ? record.note.trim().slice(0, 200)
        : null,
    source: 'ai',
  }
}

export async function suggestQuickCreateWithAi(args: {
  gateway: TextGateway
  context: QuickCreateContext
  text: string
  now: Date
}): Promise<QuickCreateResult | null> {
  const { context } = args
  const userPrompt = JSON.stringify({
    today: context.today,
    request: args.text.trim().slice(0, 1_000),
    window: context.window,
    project: {
      name: context.projectName,
      start: context.projectStart,
      end: context.projectEnd,
    },
    members: context.members.slice(0, 40),
    workPackages: context.workPackages.slice(0, 80),
    milestones: context.milestones.slice(0, 20),
    existingTasks: context.existingTaskNames.slice(0, 60),
  })
  const result = await generateWithPlanningTools({
    gateway: args.gateway,
    systemPrompt: SYSTEM,
    userPrompt,
    sentence: '日历快速新建',
    promptName: 'calendar.quick_create',
    now: args.now,
    // 单轮：日期由程序按工作日历算，不需要模型调日期工具；少一轮往返，灰字建议出得快
    maxRounds: 1,
    maxOutputTokens: 4_000,
    temperature: 0.3,
  })
  return result.answer ? normalizeQuickCreate(result.answer, context, args.text) : null
}
