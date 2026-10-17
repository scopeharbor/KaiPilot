/**
 * 计划工具箱（2026-09-28）：模型算不准、但程序算得准的事——工作日、节假日、日期说法、团队产能。
 *
 * 模型在任何一次调用里都可以先「点名要算什么」，程序算好把结果交回，模型再接着回答（最多几轮）。
 * 这样模型不必背日历、也不必心算人日，只负责理解与判断；数字一律以程序为准。
 */
import { buildDraftCalendar, calendarPromptFacts } from '#services/ai_draft/cn_calendar'
import {
  formatIsoDate,
  isWorkingDay,
  parseIsoDate,
  shiftWorkingDays,
  snapToWorkingDay,
  type WorkingCalendar,
} from '#services/gantt_working_calendar'
import { findDates } from '#services/ai_intent/core_input_facts'
import { todayAnchor } from '#services/ai_intent/core_information_needs'
import type { GenerateOptions } from '#services/ai_m0/gateway'

const DAY_MS = 86_400_000
/**
 * 可投入系数：会议、沟通、请假、依赖等待吃掉约三成半时间。
 * 与生成管线的 CAPACITY_FACTOR（generation_service.ts）保持一致，否则评估说做得完、排出来却超期。
 */
export const FOCUS_FACTOR = 0.65
const WEEKDAYS = '日一二三四五六'

export interface TeamMember {
  role: string
  headcount: number
}

function calendarFor(fromIso: string, toIso: string): WorkingCalendar {
  return buildDraftCalendar({ startDate: fromIso, endDate: toIso }).calendar
}

function isoOrThrow(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} 要写成 YYYY-MM-DD`)
  }
  parseIsoDate(value)
  return value
}

/** 两个日期之间（含首尾）的工作日、放假与调休。 */
export function workdaysBetween(fromIso: string, toIso: string) {
  const from = parseIsoDate(fromIso)
  const to = parseIsoDate(toIso)
  if (to < from) throw new Error('结束日期不能早于开始日期')
  const draft = buildDraftCalendar({ startDate: fromIso, endDate: toIso })
  let workdays = 0
  for (let day = from; day <= to; day += DAY_MS) {
    if (isWorkingDay(draft.calendar, day)) workdays++
  }
  const facts = calendarPromptFacts(draft, fromIso, toIso)
  return {
    from: fromIso,
    to: toIso,
    calendarDays: Math.round((to - from) / DAY_MS) + 1,
    workdays,
    holidays: facts.holidays,
    makeupWorkdays: facts.makeupWorkdays,
  }
}

/** 从某天起数第 N 个工作日（当天是工作日就算第 1 天）。 */
export function addWorkdays(fromIso: string, workdays: number) {
  if (!Number.isInteger(workdays) || workdays < 1 || workdays > 2_000) {
    throw new Error('workdays 要是 1–2000 的整数')
  }
  const from = parseIsoDate(fromIso)
  const calendar = calendarFor(fromIso, formatIsoDate(from + workdays * 2 * DAY_MS + 60 * DAY_MS))
  const end = shiftWorkingDays(calendar, snapToWorkingDay(calendar, from), workdays - 1)
  return { from: fromIso, workdays, date: formatIsoDate(end) }
}

/** 某一天：星期几、是不是工作日、是什么节假日。 */
export function dateInfo(dateIso: string) {
  const day = parseIsoDate(dateIso)
  const draft = buildDraftCalendar({ startDate: dateIso, endDate: dateIso })
  const entry = draft.entries.find((item) => item.date === dateIso)
  return {
    date: dateIso,
    weekday: `星期${WEEKDAYS[new Date(day).getUTCDay()]}`,
    isWorkday: isWorkingDay(draft.calendar, day),
    note: entry ? `${entry.name}${entry.work ? '调休上班' : '放假'}` : null,
    previousWorkday: formatIsoDate(snapToWorkingDay(draft.calendar, day, -1)),
    nextWorkday: formatIsoDate(snapToWorkingDay(draft.calendar, day, 1)),
  }
}

/** 把「后天」「国庆后」「下周三」「11 月底」之类的说法解析成日期（今天按北京时间）。 */
export function resolveDateText(text: string, now: Date) {
  const today = todayAnchor(now)
  const calendar = calendarFor(formatIsoDate(today), formatIsoDate(today + 400 * DAY_MS))
  const hits = findDates(text, today, calendar)
  return {
    text,
    today: formatIsoDate(today),
    dates: hits.map((hit) => ({
      matched: hit.text,
      date: formatIsoDate(hit.ts),
      precise: hit.precise,
    })),
  }
}

/**
 * 日期对照表（今天起若干天）：每天标「本周 / 下周 / 下下周…」、星期几、上班还是放假。
 * 模型直接查表，不用推算「下下周五」「下周三是不是假期」（实测 DeepSeek 把下下周五算成下周五）。
 */
export function calendarTable(now: Date, days = 35): string[] {
  const today = todayAnchor(now)
  const calendar = calendarFor(formatIsoDate(today), formatIsoDate(today + (days + 30) * DAY_MS))
  const draft = buildDraftCalendar({
    startDate: formatIsoDate(today),
    endDate: formatIsoDate(today + days * DAY_MS),
  })
  const names = new Map(draft.entries.map((entry) => [entry.date, entry]))
  // 周一为一周的开始
  const mondayOf = (day: number) => day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS
  const thisMonday = mondayOf(today)
  const weekLabels = ['本周', '下周', '下下周', '第 4 周', '第 5 周', '第 6 周']
  const lines: string[] = []
  for (let offset = 0; offset < days; offset++) {
    const day = today + offset * DAY_MS
    const iso = formatIsoDate(day)
    const week = weekLabels[Math.round((mondayOf(day) - thisMonday) / (7 * DAY_MS))] ?? ''
    const entry = names.get(iso)
    const status = isWorkingDay(calendar, day)
      ? entry?.work
        ? `上班（${entry.name}调休）`
        : '上班'
      : entry
        ? `放假（${entry.name}）`
        : '休息'
    lines.push(
      `${iso} ${week}星期${WEEKDAYS[new Date(day).getUTCDay()]} ${status}${offset === 0 ? '（今天）' : ''}`,
    )
  }
  return lines
}

/** 团队在一段时间里的产能（人日，已按可投入系数折算）。 */
export function teamCapacity(team: readonly TeamMember[], fromIso: string, toIso: string) {
  const { workdays } = workdaysBetween(fromIso, toIso)
  const byRole = team
    .filter((member) => member.role && member.headcount > 0)
    .map((member) => ({
      role: member.role,
      headcount: member.headcount,
      personDays: Math.round(member.headcount * workdays * FOCUS_FACTOR * 10) / 10,
    }))
  return {
    from: fromIso,
    to: toIso,
    workdays,
    focusFactor: FOCUS_FACTOR,
    headcount: byRole.reduce((sum, item) => sum + item.headcount, 0),
    personDays: Math.round(byRole.reduce((sum, item) => sum + item.personDays, 0) * 10) / 10,
    byRole,
  }
}

// ---------------------------------------------------------------------------
// 给模型用：工具说明 + 调用执行 + 多轮循环
// ---------------------------------------------------------------------------

export const PLANNING_TOOLS_PROMPT = [
  '【计划工具箱】日期、工作日、节假日、人日这类数字不要自己心算，交给程序算。需要时只输出：',
  '{"tool_calls":[{"name":"工具名","args":{…}}]}（可一次点多个），程序会把结果放进「工具结果」再请你继续。',
  '可用工具：',
  '- workdays {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}：含首尾的工作日数、期间放假与调休（中国法定节假日）；',
  '- add_workdays {"from":"YYYY-MM-DD","workdays":N}：从 from 起数第 N 个工作日是哪天；',
  '- date_info {"date":"YYYY-MM-DD"}：星期几、是否工作日、节假日名、前后最近的工作日；',
  '- resolve_date {"text":"后天 / 国庆后 / 下周三 / 11 月底…"}：把说法解析成日期；',
  `- team_capacity {"team":[{"role":"后端开发","headcount":2}],"from":"…","to":"…"}：团队这段时间的产能（人日，已按 ${FOCUS_FACTOR} 可投入系数折算）。`,
  '算完、能回答了就按要求输出最终 JSON（不要再带 tool_calls）。',
].join('\n')

export interface ToolCall {
  name: string
  args: Record<string, unknown>
}

export function runPlanningTool(call: ToolCall, now: Date): unknown {
  try {
    const args = call.args ?? {}
    switch (call.name) {
      case 'workdays':
        return workdaysBetween(isoOrThrow(args.from, 'from'), isoOrThrow(args.to, 'to'))
      case 'add_workdays':
        return addWorkdays(isoOrThrow(args.from, 'from'), Number(args.workdays))
      case 'date_info':
        return dateInfo(isoOrThrow(args.date, 'date'))
      case 'resolve_date':
        return resolveDateText(String(args.text ?? '').slice(0, 200), now)
      case 'team_capacity': {
        const team = (Array.isArray(args.team) ? args.team : [])
          .filter(
            (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
          )
          .map((item) => ({
            role: String(item.role ?? ''),
            headcount: Number(item.headcount) || 0,
          }))
          .slice(0, 30)
        return teamCapacity(team, isoOrThrow(args.from, 'from'), isoOrThrow(args.to, 'to'))
      }
      default:
        return { error: `没有这个工具：${call.name}` }
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 取模型输出里的 JSON 对象。模型偶尔在一次回复里先写 tool_calls 再写最终答案（两个对象），
 * 或在 JSON 前后加说明文字：逐个找出顶层的完整对象，优先返回最后一个带最终答案的对象。
 */
export function extractJsonObject(rawText: string): Record<string, unknown> | null {
  const objects: Record<string, unknown>[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let index = 0; index < rawText.length; index++) {
    const char = rawText[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"' && depth > 0) inString = true
    else if (char === '{') {
      if (depth === 0) start = index
      depth++
    } else if (char === '}' && depth > 0) {
      depth--
      if (depth === 0) {
        try {
          const parsed = JSON.parse(rawText.slice(start, index + 1))
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
            objects.push(parsed)
        } catch {
          // 不完整或不是 JSON：跳过这一段
        }
      }
    }
  }
  if (objects.length === 0) return null
  const finals = objects.filter((object) => !('tool_calls' in object))
  return finals.at(-1) ?? objects.at(-1)!
}

function toolCallsOf(parsed: Record<string, unknown> | null): ToolCall[] {
  const calls = parsed?.tool_calls
  if (!Array.isArray(calls)) return []
  return calls
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: String(item.name ?? ''),
      args:
        typeof item.args === 'object' && item.args !== null
          ? (item.args as Record<string, unknown>)
          : {},
    }))
    .filter((call) => call.name)
    .slice(0, 6)
}

export interface TextGateway {
  generate(options: GenerateOptions): Promise<{ rawText: string; triggeredErrors: unknown[] }>
}

export interface ToolLoopResult {
  /** 最终 JSON（模型没给出可解析的最终答案时为 null）。 */
  answer: Record<string, unknown> | null
  rawText: string
  toolCalls: Array<ToolCall & { result: unknown }>
}

/**
 * 带工具的调用：模型先点名要算什么，程序算好附在「工具结果」里再问一次，直到给出最终 JSON。
 * 每一轮的原始输出都会经 onText 实时推出去（前端能看到模型在想什么、在算什么）。
 */
export async function generateWithPlanningTools(args: {
  gateway: TextGateway
  systemPrompt: string
  userPrompt: string
  sentence: string
  promptName: string
  now: Date
  maxRounds?: number
  maxOutputTokens?: number
  temperature?: number
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
  signal?: AbortSignal
}): Promise<ToolLoopResult> {
  const toolCalls: ToolLoopResult['toolCalls'] = []
  const systemPrompt = `${args.systemPrompt}\n\n${PLANNING_TOOLS_PROMPT}`
  const maxRounds = args.maxRounds ?? 4
  let rawText = ''
  for (let round = 0; round < maxRounds; round++) {
    const results =
      toolCalls.length > 0
        ? `\n\n【工具结果】（程序计算，以此为准）\n${toolCalls
            .map(
              (call) =>
                `${call.name} ${JSON.stringify(call.args)} → ${JSON.stringify(call.result)}`,
            )
            .join('\n')}`
        : ''
    const lastRound = round === maxRounds - 1
    const call = (maxOutputTokens: number) =>
      args.gateway.generate({
        sentence: args.sentence,
        promptName: args.promptName,
        promptSet: {
          systemPrompt,
          userPrompt: `${args.userPrompt}${results}${lastRound ? '\n\n（工具次数已用完，请直接给出最终 JSON。）' : ''}`,
        },
        strategy: 'prompt',
        temperature: args.temperature ?? 0.2,
        maxOutputTokens,
        ...(args.signal ? { signal: args.signal } : {}),
        ...(args.onText ? { onText: args.onText } : {}),
        ...(args.onReasoning ? { onReasoning: args.onReasoning } : {}),
      })
    const limit = args.maxOutputTokens ?? 4_000
    let generated = await call(limit)
    // 推理模型的思考内容也占输出额度（实测 DeepSeek 评估时思考 3,500 字就超了 3,000 的上限）：
    // 超限时把上限翻倍重试一次。
    if (generated.triggeredErrors.includes('token_limit_exceeded')) {
      args.onText?.('\n〔输出超出上限，放宽后重试〕\n')
      generated = await call(Math.min(limit * 2, 32_000))
    }
    if (generated.triggeredErrors.length > 0) {
      throw new Error(`模型调用失败：${JSON.stringify(generated.triggeredErrors[0]).slice(0, 200)}`)
    }
    rawText = generated.rawText
    const parsed = extractJsonObject(rawText)
    const calls = lastRound ? [] : toolCallsOf(parsed)
    if (calls.length === 0) {
      const answer = { ...parsed }
      delete answer.tool_calls
      return { answer: parsed ? answer : null, rawText, toolCalls }
    }
    args.onText?.('\n')
    for (const toolCall of calls) {
      const result = runPlanningTool(toolCall, args.now)
      toolCalls.push({ ...toolCall, result })
      args.onText?.(`〔程序计算 ${toolCall.name}：${JSON.stringify(result).slice(0, 160)}〕\n`)
    }
  }
  return { answer: null, rawText, toolCalls }
}

/**
 * 把文字里提到的某个日期换成另一个日期（2026-11-16 与「11 月 16 日」两种写法，保留原来的空格习惯）。
 * 只换与 from 完全相同的日期，其它日期不动。用于截止日改了以后同步章程 / 项目理解里的文字。
 */
export function replaceDateMentions(text: string, from: string, to: string): string {
  if (from === to) return text
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const chinese = new RegExp(
    `(${fy}\\s*年\\s*)?(?<!\\d)${fm}\\s*月\\s*${fd}\\s*(日|号)(?!\\d)`,
    'g',
  )
  return text
    .split(from)
    .join(to)
    .replace(chinese, (match: string, year: string | undefined, suffix: string) => {
      const gap = /\s/.test(match) ? ' ' : ''
      const day = `${tm}${gap}月${gap}${td}${gap}${suffix}`
      return year || fy !== ty ? `${ty}${gap}年${gap}${day}` : day
    })
}

/** 递归替换任意 JSON 值里的字符串。 */
export function replaceDateMentionsDeep<T>(value: T, from: string, to: string): T {
  if (typeof value === 'string') return replaceDateMentions(value, from, to) as T
  if (Array.isArray(value)) return value.map((item) => replaceDateMentionsDeep(item, from, to)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceDateMentionsDeep(item, from, to)]),
    ) as T
  }
  return value
}
