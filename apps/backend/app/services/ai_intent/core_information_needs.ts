/**
 * 生成前必问的核心信息（2026-09-27）。
 *
 * 背景（真实演练）：自适应澄清完全由模型决定问什么，只问了「第一版多久上线」，没问开始日期、
 * 团队规模与人员；生成时模型自己编了一个早于今天的开始日期（2026-06-01），还按项目类型臆测了
 * 一整套角色组。这里用确定性规则给模型的追问兜底：
 * - 开始日期：必问（blocking）；快捷选项以「今天」为锚点给出下一个工作日 / 下周一 / 下月初；
 * - 工期或截止日：必问（blocking），原话里已给出则跳过；
 * - 团队：必问但可以选择「先按角色估算」（high）；也可以直接给人数或 @ 组织成员。
 * 原话或既有回答已覆盖的项不再追问；回答在进入生成前解析成结构化字段（resolvedFields / timeline）。
 */

import type {
  ClarificationLedger,
  ConfirmedProjectContext,
  InformationNeed,
  ProjectUnderstanding,
} from '@aiproj/types'
import { formatIsoDate, shiftWorkingDays, snapToWorkingDay } from '#services/gantt_working_calendar'
import { buildDraftCalendar, calendarPromptFacts } from '#services/ai_draft/cn_calendar'
import { extractCoreFactsFromInput, findDates, type InputCoreFacts } from './core_input_facts.js'

export const CORE_NEED_IDS = {
  startDate: 'core.start_date',
  duration: 'core.duration',
  team: 'core.team',
} as const

const DAY_MS = 86_400_000

/** 以北京时间为准的「今天」零点（UTC 时间戳）。 */
export function todayAnchor(now: Date): number {
  const shanghai = new Date(now.getTime() + 8 * 3_600_000)
  return Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate())
}

// ---------------------------------------------------------------------------
// 覆盖判断：原话或既有回答已给出就不追问
// ---------------------------------------------------------------------------

const EXPLICIT_DATE_RE =
  /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})|(\d{1,2})月(\d{1,2})[日号]|下(个)?(周|星期|礼拜)[一二三四五六日天]|(下|本|这)(个)?月(初|底|\d{1,2}[日号])|明天|后天|下个工作日/
const START_WORD_RE = /(开始|启动|开工|kick\s*-?off|从.{0,8}起|起算)/i
const DURATION_RE =
  /(\d+(\.\d+)?|[一二两三四五六七八九十半]+)\s*(个)?\s*(天|日|工作日|周|星期|礼拜|个月|月|季度|年)|(截止|上线|交付|完成|deadline)[^，。]{0,12}(\d{4}[-/.年]\d{1,2}|\d{1,2}月)/i
const HEADCOUNT_RE =
  /(\d+|[一二两三四五六七八九十]+)\s*(个)?\s*(人|名|位|个人)(?!民币|次|参与|参加|出席|报名|规模|以上的?用户)/
const ROLE_ROSTER_RE = /(架构师|开发|测试|产品|设计|运维|DBA|项目经理|PM|前端|后端)\s*\d+/i
const MENTION_RE = /@[\p{L}\p{N}_.-]+/u

function ledgerAnswered(ledger: ClarificationLedger, needId: string): boolean {
  return ledger.entries.some(
    (entry) =>
      entry.needId === needId && (entry.status === 'answered' || entry.status === 'known_unknown'),
  )
}

export function rawInputHasStartDate(rawInput: string): boolean {
  // 只有「开始/启动」附近出现具体日期才算给了开始日期（「10 月上线」是截止日，不是开始日）
  const match = EXPLICIT_DATE_RE.exec(rawInput)
  if (!match) return false
  const around = rawInput.slice(Math.max(0, match.index - 12), match.index + match[0].length + 12)
  return START_WORD_RE.test(around)
}

/** 日期表达（「11 月下旬」「11 月 27 日」「2027-01-31」）不是工期，判断工期前先去掉。 */
const DATE_EXPRESSIONS = [
  /\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*[日号]?/g,
  /\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g,
  /\d{1,2}\s*月\s*(上旬|中旬|下旬|底|初|中|份)/g,
]
const DEADLINE_WITH_DATE_RE =
  /(截止|上线|交付|完成|deadline|之前|以前|前完成)[^，。]{0,12}(\d{4}[-/.年]\d{1,2}|\d{1,2}\s*月)|(\d{4}[-/.年]\d{1,2}|\d{1,2}\s*月)[^，。]{0,8}(截止|上线|交付|完成|之前|以前)/i

export function rawInputHasDuration(rawInput: string): boolean {
  if (DEADLINE_WITH_DATE_RE.test(rawInput)) return true
  const withoutDates = DATE_EXPRESSIONS.reduce((text, re) => text.replace(re, ' '), rawInput)
  return DURATION_RE.test(withoutDates)
}

export function rawInputHasTeam(rawInput: string): boolean {
  return HEADCOUNT_RE.test(rawInput) || ROLE_ROSTER_RE.test(rawInput) || MENTION_RE.test(rawInput)
}

// ---------------------------------------------------------------------------
// 需求构造
// ---------------------------------------------------------------------------

/** 含法定节假日与调休的中国工作日历（快捷选项与回答解析都不能落在长假里，如国庆 10 月 1 日）。 */
function cnCalendar(today: number) {
  return buildDraftCalendar({ startDate: formatIsoDate(today), endDate: null }).calendar
}

function startDateNeed(today: number): InformationNeed {
  const calendar = cnCalendar(today)
  const nextWorkday = shiftWorkingDays(calendar, today + DAY_MS, 0)
  const weekday = new Date(today).getUTCDay()
  const rawMonday = today + ((8 - weekday) % 7 || 7) * DAY_MS
  const nextMonday = snapToWorkingDay(calendar, rawMonday)
  const rawFirst = (() => {
    const d = new Date(today)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
  })()
  const firstOfNextMonth = snapToWorkingDay(calendar, rawFirst)
  // 那天本身不是工作日（周末或法定假日）时写明顺延，免得「下周一（2026-10-08）」看起来像日期算错。
  const label = (prefix: string, ts: number, raw = ts) =>
    raw === ts
      ? `${prefix}（${formatIsoDate(ts)}）`
      : `${prefix}（${formatIsoDate(raw).slice(5)} 是非工作日，顺延至 ${formatIsoDate(ts)}）`
  const seen = new Set<string>()
  const options = [
    { id: 'next_workday', label: label('下一个工作日', nextWorkday), ts: nextWorkday },
    { id: 'next_monday', label: label('下周一', nextMonday, rawMonday), ts: nextMonday },
    {
      id: 'next_month',
      label: label('下个月初', firstOfNextMonth, rawFirst),
      ts: firstOfNextMonth,
    },
  ]
    .filter((option) => {
      const iso = formatIsoDate(option.ts)
      if (seen.has(iso)) return false
      seen.add(iso)
      return true
    })
    .map((option) => ({ id: option.id, label: option.label, value: formatIsoDate(option.ts) }))
  return {
    id: CORE_NEED_IDS.startDate,
    topic: 'project_start_date',
    missingInformation: '项目从哪一天开始？',
    decisionImpact: ['schedule'],
    whyItMatters: `所有任务日期都从开始日推算。今天是 ${formatIsoDate(today)}，不确认的话计划可能落在过去或错过窗口。`,
    priority: 'blocking',
    answerKind: 'date',
    suggestedOptions: options,
    confidence: 1,
    uncertainty: 1,
    userEffort: 'low',
    sensitivity: 'none',
  }
}

function durationNeed(): InformationNeed {
  return {
    id: CORE_NEED_IDS.duration,
    topic: 'project_duration',
    missingInformation: '整个项目预计做多久，或者必须在哪一天前完成？',
    decisionImpact: ['schedule', 'resource'],
    whyItMatters: '工期决定任务能拆多细、需要多少人并行；有硬性截止日时计划要倒排。',
    priority: 'blocking',
    answerKind: 'short_text',
    suggestedOptions: [
      { id: 'm1', label: '1 个月左右', value: '1 个月' },
      { id: 'm3', label: '3 个月左右', value: '3 个月' },
      { id: 'm6', label: '6 个月左右', value: '6 个月' },
    ],
    confidence: 1,
    uncertainty: 1,
    userEffort: 'low',
    sensitivity: 'none',
  }
}

function teamNeed(lastTeam: string | null = null): InformationNeed {
  // 跨生成记忆：上次起草时用户明确给出的团队，放在第一个选项，一键沿用。
  const lastTeamOption = lastTeam
    ? [
        {
          id: 'last_team',
          label: `沿用上次的团队：${lastTeam}`,
          value: lastTeam,
          description: '上次起草时你给出的团队构成',
        },
      ]
    : []
  return {
    id: CORE_NEED_IDS.team,
    topic: 'team_composition',
    missingInformation: '这个项目由哪些人来做？',
    decisionImpact: ['resource', 'schedule'],
    whyItMatters:
      '任务数量、并行程度和工期都取决于实际能投入的人。可以直接 @ 组织里的成员；还没定人也可以先告诉我人数，或让我先按角色估算（会标成假设，导入前再分配真人）。',
    priority: 'high',
    answerKind: 'single_choice',
    suggestedOptions: [
      ...lastTeamOption,
      {
        id: 'members',
        label: '从组织成员里选（@ 成员）',
        value: 'members',
        description: '在回答里 @ 成员，例如「@张三 @李四」',
      },
      {
        id: 'headcount',
        label: '只告诉人数',
        value: 'headcount',
        description: '例如「8 人：后端 3、前端 2、测试 2、产品 1」',
      },
      {
        id: 'role_estimate',
        label: '先按角色估算',
        value: '先按角色估算',
        description: 'AI 按项目类型估算角色和人数，标记为假设；导入前再分配真人',
      },
    ],
    confidence: 1,
    uncertainty: 1,
    userEffort: 'medium',
    sensitivity: 'low',
  }
}

/**
 * 在模型给出的信息需求前面补上缺失的核心问题（已覆盖的不补；与模型自己提的同类问题去重）。
 */
/** 原话里的开工日 / 工期 / 团队（清楚 / 模糊 / 没说），追问与写入计划共用。 */
export function inputCoreFacts(rawInput: string, now: Date): InputCoreFacts {
  const today = todayAnchor(now)
  return extractCoreFactsFromInput(rawInput, now, cnCalendar(today), todayAnchor)
}

/** 原话说得模糊的开工日：带上我们的理解让用户一键确认。 */
function confirmStartNeed(fact: InputCoreFacts['start'], today: number): InformationNeed {
  const base = startDateNeed(today)
  return {
    ...base,
    missingInformation: `你说「${fact.quote}」开始，开工日按 ${fact.value} 排，可以吗？`,
    whyItMatters: `「${fact.quote}」不是具体日期；所有任务日期都从开工日推算，这里先按 ${fact.value}（工作日）理解，不对可以改。`,
    suggestedOptions: [
      { id: 'as_understood', label: `就按 ${fact.value}`, value: fact.value! },
      ...(base.suggestedOptions ?? []).filter((option) => option.value !== fact.value),
    ],
  }
}

/** 原话说得模糊的截止 / 工期：同样先给出理解。 */
function confirmDurationNeed(fact: InputCoreFacts['duration']): InformationNeed {
  const base = durationNeed()
  if (!fact.deadline) {
    return {
      ...base,
      missingInformation: `你说「${fact.quote}」，具体希望多久完成，或最晚哪一天？`,
    }
  }
  return {
    ...base,
    missingInformation: `你说「${fact.quote}」，截止日按 ${fact.deadline} 排，可以吗？`,
    whyItMatters: `「${fact.quote}」是一个时段而不是具体日期；计划要按截止日倒排，这里先按 ${fact.deadline} 理解，不对可以改。`,
    suggestedOptions: [
      { id: 'as_understood', label: `截止 ${fact.deadline}`, value: fact.deadline },
      ...(base.suggestedOptions ?? []),
    ],
  }
}

function confirmTeamNeed(fact: InputCoreFacts['team']): InformationNeed {
  return {
    ...teamNeed(),
    missingInformation: `你说「${fact.quote}」，大概几个人、分别是什么角色？`,
  }
}

/**
 * 核心信息兜底（2026-09-27 重新设计）：用户原话里说清楚的不再追问；说得模糊的追问确认（首个选项就是我们的理解）；
 * 没说的照常追问。三个主题里模型自己提的同类问题一律去掉——要么原话已说清，要么由这里统一问。
 */
export function withCoreInformationNeeds(input: {
  understanding: ProjectUnderstanding
  ledger: ClarificationLedger
  rawInput: string
  now: Date
  /** 上次起草时用户给出的团队（跨生成记忆）。 */
  lastTeam?: string | null
}): ProjectUnderstanding {
  const { understanding, ledger, rawInput } = input
  const today = todayAnchor(input.now)
  const facts = inputCoreFacts(rawInput, input.now)
  const core: InformationNeed[] = []

  if (!ledgerAnswered(ledger, CORE_NEED_IDS.startDate) && facts.start.status !== 'precise') {
    core.push(
      facts.start.status === 'vague' ? confirmStartNeed(facts.start, today) : startDateNeed(today),
    )
  }
  if (!ledgerAnswered(ledger, CORE_NEED_IDS.duration) && facts.duration.status !== 'precise') {
    core.push(
      facts.duration.status === 'vague' ? confirmDurationNeed(facts.duration) : durationNeed(),
    )
  }
  if (!ledgerAnswered(ledger, CORE_NEED_IDS.team) && facts.team.status !== 'precise') {
    core.push(
      facts.team.status === 'vague'
        ? confirmTeamNeed(facts.team)
        : teamNeed(input.lastTeam ?? null),
    )
  }

  const coreTopics: RegExp[] = [
    /(开始日期|开工|启动时间|何时开始|什么时候开始|starts*date)/i,
    // 只认项目整体的工期 / 截止；「业务最多可以暂停多久」「盘点周期」这类不是项目工期。
    /(工期|项目周期|(?:项目|整体|要|需要|大概)(?:做|干)?多久(?:完成|上线|做完|交付)?|多久(?:完成|上线|做完|交付)|截止日|截止时间|最晚.{0,4}完成|上线时间|交付时间|完成时间|deadline|duration|timeline)/i,
    /(团队|人员配置|项目成员|成员构成|人力|人手|投入.{0,4}人|多少人(?:来)?(?:做|参与|负责|开发)|staff|headcount)/i,
  ]
  const coreIds = new Set(Object.values(CORE_NEED_IDS) as string[])
  const modelNeeds = understanding.informationNeeds.filter((need) => {
    if (coreIds.has(need.id)) return false
    const text = `${need.topic} ${need.missingInformation}`
    return !coreTopics.some((re) => re.test(text))
  })
  return {
    ...understanding,
    informationNeeds: [...core, ...modelNeeds],
    sufficientForPreliminaryDraft:
      core.length > 0 ? false : understanding.sufficientForPreliminaryDraft,
  }
}

// ---------------------------------------------------------------------------
// 回答 → 结构化字段
// ---------------------------------------------------------------------------

const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  半: 0.5,
}

function cnNumber(text: string): number | null {
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  if (text === '十') return 10
  if (text.length === 2 && text[0] === '十') return 10 + (CN_DIGITS[text[1]!] ?? 0)
  if (text.length === 2 && text[1] === '十') return (CN_DIGITS[text[0]!] ?? 0) * 10
  return CN_DIGITS[text] ?? null
}

/** 解析开始日期回答（ISO / 中文日期 / 相对日期），失败返回 null。 */
export function parseStartDateAnswer(answer: string, now: Date): string | null {
  // 「10 月 12 日」这类带空格的写法很常见（实测漏解析后退回兜底开工日）。
  const text = answer.replace(/\s+/g, '')
  const today = todayAnchor(now)
  const calendar = cnCalendar(today)
  const iso = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(text)
  if (iso) return formatIsoDate(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])))
  const md = /(\d{1,2})月(\d{1,2})[日号]?/.exec(text)
  if (md) {
    const year = new Date(today).getUTCFullYear()
    let ts = Date.UTC(year, Number(md[1]) - 1, Number(md[2]))
    if (ts < today) ts = Date.UTC(year + 1, Number(md[1]) - 1, Number(md[2]))
    return formatIsoDate(ts)
  }
  if (/下(一)?个工作日|明天/.test(text))
    return formatIsoDate(shiftWorkingDays(calendar, today + DAY_MS, 0))
  if (/后天/.test(text)) return formatIsoDate(today + 2 * DAY_MS)
  if (/下(个)?(周|星期|礼拜)一/.test(text)) {
    const weekday = new Date(today).getUTCDay()
    return formatIsoDate(today + ((8 - weekday) % 7 || 7) * DAY_MS)
  }
  if (/下(个)?月(初)?/.test(text)) {
    const d = new Date(today)
    return formatIsoDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  }
  if (/今天|马上|立即|现在/.test(text)) return formatIsoDate(today)
  return null
}

/** 解析工期回答为天数（取区间上限：「3 到 4 个月」→ 约 4 个月），失败返回 null。 */
/** 工期题的回答是一个日期（「到 11 月 27 日」「2027-01-31 前」）时，它就是截止日。 */
export function parseDeadlineAnswer(answer: string, now: Date): string | null {
  const text = answer.replace(/\s+/g, '')
  if (!/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{1,2}月\d{1,2}[日号]?/.test(text)) return null
  return parseStartDateAnswer(text, now)
}

export function parseDurationAnswer(answer: string): number | null {
  const unitDays: Array<[RegExp, number]> = [
    [/年/, 365],
    [/季度/, 91],
    [/个?月/, 30],
    [/(周|星期|礼拜)/, 7],
    [/(天|日|工作日)/, 1],
  ]
  const matches = [
    ...answer.matchAll(
      /(\d+(?:\.\d+)?|[一二两三四五六七八九十半]+)\s*(?:个)?\s*(年|季度|个月|月|周|星期|礼拜|工作日|天|日)?/g,
    ),
  ]
  let best: number | null = null
  let lastUnit: number | null = null
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!
    const value = cnNumber(match[1]!)
    if (value === null || value <= 0) continue
    const unitText = match[2]
    const unit: number | null = unitText
      ? (unitDays.find(([re]) => re.test(unitText))?.[1] ?? null)
      : lastUnit
    if (unit === null) continue
    lastUnit = unit
    const days = Math.round(value * unit)
    if (best === null || days > best) best = days
  }
  return best
}

export interface CoreAnswerFacts {
  startDate: string | null
  durationDays: number | null
  /** 工期题直接给了截止日期。 */
  deadline: string | null
  /** 团队回答原文（人数 / 角色名册 / @成员），供名册解析与颗粒度估算。 */
  teamText: string | null
  /** 用户选择「先按角色估算」。 */
  roleEstimate: boolean
  /** 回答里 @ 到的成员标识（不含 @）。 */
  mentions: string[]
}

function answerText(ledger: ClarificationLedger, needId: string): string | null {
  const entry = [...ledger.entries]
    .reverse()
    .find((item) => item.needId === needId && item.status === 'answered')
  if (!entry || entry.answer === undefined) return null
  return Array.isArray(entry.answer) ? entry.answer.join('、') : String(entry.answer)
}

export function coreAnswerFacts(ledger: ClarificationLedger, now: Date): CoreAnswerFacts {
  const start = answerText(ledger, CORE_NEED_IDS.startDate)
  const duration = answerText(ledger, CORE_NEED_IDS.duration)
  const team = answerText(ledger, CORE_NEED_IDS.team)
  return {
    startDate: start ? parseStartDateAnswer(start, now) : null,
    deadline: duration ? parseDeadlineAnswer(duration, now) : null,
    durationDays:
      duration && !parseDeadlineAnswer(duration, now) ? parseDurationAnswer(duration) : null,
    teamText: team && !/^(members|headcount)$/.test(team.trim()) ? team : null,
    roleEstimate: !!team && /按角色估算|role_estimate/.test(team),
    mentions: team ? [...team.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].map((m) => m[1]!) : [],
  }
}

/**
 * 把核心回答写入生成上下文：开始日期 → resolvedFields.startDate + timeline.startDate；
 * 工期 → timeline.durationDays / deadline；团队 → resolvedFields.teamSize（原文，名册解析与人数估算都读它）。
 * 已有更明确的字段时不覆盖。
 */
export function applyCoreAnswers(
  context: ConfirmedProjectContext,
  ledger: ClarificationLedger | undefined,
  now: Date,
): ConfirmedProjectContext {
  if (!ledger) return withFallbackStartDate(withInputFacts(context, now), now)
  const facts = coreAnswerFacts(ledger, now)
  const resolvedFields = { ...context.resolvedFields }
  const timeline = { ...context.parsedIntent.timeline }
  const marker = (reason: string) => ({
    confidence: 1,
    source: 'explicit' as const,
    reason,
    needsConfirmation: false,
  })
  if (facts.startDate && !resolvedFields.startDate) {
    resolvedFields.startDate = {
      value: facts.startDate,
      marker: marker('用户在澄清中确认的开始日期'),
    }
  }
  if (facts.startDate && !timeline.startDate) timeline.startDate = facts.startDate
  if (facts.durationDays && !timeline.durationDays) timeline.durationDays = facts.durationDays
  const start = timeline.startDate ?? facts.startDate
  if (facts.deadline && !timeline.deadline) {
    timeline.deadline = facts.deadline
    if (start && !timeline.durationDays) {
      const days =
        Math.round(
          (Date.parse(`${facts.deadline}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS,
        ) + 1
      if (days > 0) timeline.durationDays = days
    }
  }
  if (start && timeline.durationDays && !timeline.deadline) {
    const startTs = Date.parse(`${start}T00:00:00Z`)
    if (Number.isFinite(startTs)) {
      timeline.deadline = formatIsoDate(startTs + (timeline.durationDays - 1) * DAY_MS)
    }
  }
  if (facts.teamText && !resolvedFields.teamSize) {
    resolvedFields.teamSize = {
      value: facts.teamText,
      marker: facts.roleEstimate
        ? {
            confidence: 0.4,
            source: 'default',
            reason: '用户选择先按角色估算，人数为 AI 假设',
            needsConfirmation: true,
          }
        : marker('用户在澄清中确认的团队'),
    }
  }
  return withConsistentDuration(
    withFallbackStartDate(
      withInputFacts(
        {
          ...context,
          resolvedFields,
          parsedIntent: { ...context.parsedIntent, timeline },
        },
        now,
      ),
      now,
    ),
  )
}

/**
 * 开工日与截止日都已知时，工期按两者算（日历天，含首尾），覆盖意图解析猜的工期——
 * 实测规则解析把「10 月 12 日开工」读成工期 300 天，回答了「10 月 31 日前上线」后就绪页仍显示 300 天。
 */
function withConsistentDuration(context: ConfirmedProjectContext): ConfirmedProjectContext {
  const { startDate, deadline } = context.parsedIntent.timeline
  if (!startDate || !deadline) return context
  const days =
    Math.round(
      (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS,
    ) + 1
  if (!Number.isFinite(days) || days < 1 || days === context.parsedIntent.timeline.durationDays) {
    return context
  }
  return {
    ...context,
    parsedIntent: {
      ...context.parsedIntent,
      timeline: { ...context.parsedIntent.timeline, durationDays: days },
    },
  }
}

/**
 * 用户原话里说清楚的开工日 / 工期 / 截止 / 团队直接写进计划（来源：用户在描述中给出）。
 * 已有更明确的值（澄清回答、意图解析）时不覆盖。
 */
export function withInputFacts(
  context: ConfirmedProjectContext,
  now: Date,
): ConfirmedProjectContext {
  const facts = inputCoreFacts(context.rawInput, now)
  const resolvedFields = { ...context.resolvedFields }
  const timeline = { ...context.parsedIntent.timeline }
  const marker = {
    confidence: 1,
    source: 'explicit' as const,
    reason: '用户在需求描述中给出',
    needsConfirmation: false,
  }
  if (facts.start.status === 'precise' && facts.start.value && !timeline.startDate) {
    timeline.startDate = facts.start.value
    if (!resolvedFields.startDate) resolvedFields.startDate = { value: facts.start.value, marker }
  }
  if (facts.duration.status === 'precise') {
    if (facts.duration.deadline && !timeline.deadline) timeline.deadline = facts.duration.deadline
    if (facts.duration.durationDays && !timeline.durationDays) {
      timeline.durationDays = facts.duration.durationDays
    }
  }
  const start = timeline.startDate
  if (start && timeline.durationDays && !timeline.deadline) {
    timeline.deadline = formatIsoDate(
      Date.parse(`${start}T00:00:00Z`) + (timeline.durationDays - 1) * DAY_MS,
    )
  }
  if (start && timeline.deadline && !timeline.durationDays) {
    const days =
      Math.round(
        (Date.parse(`${timeline.deadline}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS,
      ) + 1
    if (days > 0) timeline.durationDays = days
  }
  if (facts.team.status === 'precise' && facts.team.quote && !resolvedFields.teamSize) {
    resolvedFields.teamSize = { value: facts.team.quote, marker }
  }
  return { ...context, resolvedFields, parsedIntent: { ...context.parsedIntent, timeline } }
}

/**
 * 开工日兜底：用户跳过或答「不确定」时，按今天之后的下一个工作日假设开工，并标为待确认。
 * 绝不让模型自己编开工日（实测会编出早于今天的日期）。工期已知时同步推出截止日。
 */
export function withFallbackStartDate(
  context: ConfirmedProjectContext,
  now: Date,
): ConfirmedProjectContext {
  if (context.parsedIntent.timeline.startDate) return context
  const today = todayAnchor(now)
  // 用含法定节假日与调休的中国工作日历，避免兜底开工日落在长假里。
  const calendar = buildDraftCalendar({ startDate: formatIsoDate(today), endDate: null }).calendar
  const start = formatIsoDate(shiftWorkingDays(calendar, today, 1))
  const timeline = { ...context.parsedIntent.timeline, startDate: start }
  if (timeline.durationDays && !timeline.deadline) {
    timeline.deadline = formatIsoDate(
      Date.parse(`${start}T00:00:00Z`) + (timeline.durationDays - 1) * DAY_MS,
    )
  }
  return {
    ...context,
    assumptions: {
      ...context.assumptions,
      startDate: {
        value: start,
        marker: {
          confidence: 0.4,
          source: 'default',
          reason: '未确认开工日，按今天之后的下一个工作日假设',
          needsConfirmation: true,
        },
      },
    },
    parsedIntent: { ...context.parsedIntent, timeline },
  }
}

// ---------------------------------------------------------------------------
// 答题检查（规则层）：开工日 / 工期 / 团队三题的回答能不能被程序读懂
// ---------------------------------------------------------------------------

const AFFIRMATIVE_RE =
  /^(是|是的|对|对的|可以|好|好的|行|没问题|确认|同意|嗯|就这样|按这个)[。！!，,.]?$/u
const TEAM_WORD_RE =
  /(产品|前端|后端|测试|开发|设计|运维|架构|项目经理|PM|DBA|实施|运营|UI|UX|按角色估算|沿用上次|成员#\d+|@)/i

/**
 * 核心题的回答是否读得懂：读得懂返回用于落库的答案（选项、「可以」等会换成对应取值），读不懂返回 null。
 * 读不懂不代表答非所问（「等国庆收假就开工」程序读不懂但答了），交给模型再判断。
 */
export function checkCoreAnswer(
  needId: string,
  answer: string,
  now: Date,
  options: ReadonlyArray<{ id?: string; label: string; value?: unknown }> = [],
  /** strict：直接信任用户原话时要求「整句基本就是答案」；模型已判定答到、只核对规整结果读不读得懂时用 false。 */
  strict = true,
): string | null {
  const text = answer.trim()
  if (!text) return null
  const option = options.find(
    (item) => item.label.trim() === text || String(item.value ?? '').trim() === text,
  )
  if (option) return String(option.value ?? option.label)
  if (AFFIRMATIVE_RE.test(text)) {
    const understood = options.find((item) => item.id === 'as_understood')
    return understood ? String(understood.value ?? understood.label) : null
  }
  const today = todayAnchor(now)
  // 只在「整句基本就是答案」时放行：去掉识别出的日期 / 时长 / 人数与口头虚词后不能剩下别的内容。
  // 否则「我今天想吃汉堡」会因为含「今天」被当成日期；剩下内容的一律交给模型判断。
  const dates = findDates(text, today, cnCalendar(today))
  let rest = text
  for (const hit of [...dates].sort((x, y) => y.index - x.index)) {
    rest = rest.slice(0, hit.index) + rest.slice(hit.index + hit.length)
  }
  if (needId === CORE_NEED_IDS.startDate) {
    rest = rest.replace(START_ANSWER_RE, '')
    const readable = dates.length > 0 || parseStartDateAnswer(text, now) !== null
    return readable && (!strict || onlyFiller(rest)) ? text : null
  }
  if (needId === CORE_NEED_IDS.duration) {
    rest = rest.replace(DURATION_ANSWER_RE, '')
    const readable = dates.length > 0 || parseDurationAnswer(text) !== null
    return readable && (!strict || onlyFiller(rest)) ? text : null
  }
  if (needId === CORE_NEED_IDS.team) {
    rest = rest.replace(TEAM_ANSWER_RE, '')
    const readable = HEADCOUNT_RE.test(text) || ROLE_ROSTER_RE.test(text) || TEAM_WORD_RE.test(text)
    return readable && (!strict || onlyFiller(rest)) ? text : null
  }
  return text
}

const START_ANSWER_RE =
  /(\d{4}\s*[-/.年]\s*)?\d{1,2}\s*[-/.月]\s*\d{1,2}\s*[日号]?|下(一)?个工作日|下(个)?(周|星期|礼拜)[一二三四五六日天]?|下(个)?月(初)?|马上|立即|现在/gu
const DURATION_ANSWER_RE =
  /(\d+(\.\d+)?|[一二两三四五六七八九十半]+)\s*(个)?\s*(年|季度|个月|月|周|星期|礼拜|工作日|天|日)|到|至|~|-/gu
const TEAM_ANSWER_RE =
  /(\d+|[一二两三四五六七八九十]+)\s*(个)?\s*(人|名|位)|产品(经理)?|前端|后端|测试|开发|设计(师)?|运维|架构(师)?|项目经理|PM|DBA|实施|运营|UI|UX|工程师|按角色估算|沿用上次的?团队|成员#\d+|@[\p{L}\p{N}_.-]+|\d+|[一二两三四五六七八九十]/giu
const FILLER_RE =
  /[\s，,。.、；;：:！!？?（）()]|大概|大约|约|差不多|左右|估计|预计|应该|可能|就|吧|呢|啊|的|了|从|起|开始|开工|启动|前|之前|以前|以内|内|完成|上线|交付|截止|最晚|项目|在|要|需要|共|一共|总共|和|跟|还有|另外|以及|加上|各|每个|分别|人手|团队|负责|做|是|先|暂时|暂|目前|现在/gu

function onlyFiller(rest: string): boolean {
  return rest.replace(FILLER_RE, '').length === 0
}

/** 核心题各自期待的回答，用于「答非所问」时的提示。 */
/** 给模型的日历事实：今天起半年内的法定假日与调休（程序算好，模型不必猜「国庆收假」是哪天）。 */
export function upcomingCalendarFacts(now: Date): string[] {
  const today = todayAnchor(now)
  const from = formatIsoDate(today)
  const to = formatIsoDate(today + 183 * 86_400_000)
  const facts = calendarPromptFacts(buildDraftCalendar({ startDate: from, endDate: to }), from, to)
  return [...facts.holidays, ...facts.makeupWorkdays]
}

export function coreAnswerExpectation(needId: string): string | null {
  if (needId === CORE_NEED_IDS.startDate)
    return '项目哪天开始，例如「10 月 8 日」「下周一」「下个月初」'
  if (needId === CORE_NEED_IDS.duration)
    return '要做多久或最晚哪天完成，例如「3 个月」「12 月 20 日前上线」'
  if (needId === CORE_NEED_IDS.team)
    return '由哪些人来做，例如「后端 2 人、前端 1 人、测试 1 人」，或 @ 组织成员，或「先按角色估算」'
  return null
}
