/**
 * 从用户原话里读出开工日 / 工期（截止日）/ 团队（2026-09-27 重新设计）。
 *
 * 用户要求：提示词里已经说清楚的，就不要再问；只有说得模糊时才追问（而且要带上「我是这样理解的」让用户一键确认）。
 * 每一项分三种：
 * - precise：说清楚了 → 不追问，直接写进计划（来源：用户在描述中给出）；
 * - vague：说了但不精确（「下个月开始」「年底前」「11 月下旬」「一个小团队」）→ 追问确认，首个选项就是我们的理解；
 * - absent：没说 → 照常追问。
 */

import type { WorkingCalendar } from '#services/gantt_working_calendar'
import { parseTeamRoster } from '#services/ai_draft/resource_plan'
import {
  formatIsoDate,
  isWorkingDay,
  shiftWorkingDays,
  snapToWorkingDay,
} from '#services/gantt_working_calendar'

const DAY_MS = 86_400_000

export type CoreFactStatus = 'precise' | 'vague' | 'absent'

export interface InputDateFact {
  status: CoreFactStatus
  /** 我们对这句话的理解（ISO 日期）；absent 时为 null。 */
  value: string | null
  /** 原话片段，用于追问时引用（「你说『年底前』……」）。 */
  quote: string | null
}

export interface InputDurationFact {
  status: CoreFactStatus
  durationDays: number | null
  deadline: string | null
  quote: string | null
}

export interface InputTeamFact {
  status: CoreFactStatus
  quote: string | null
}

export interface InputCoreFacts {
  start: InputDateFact
  duration: InputDurationFact
  team: InputTeamFact
}

const START_WORD = /(开始|启动|开工|动工|开干|kick\s*-?off|立项|起算)/i
// 「12 月 20 日年会当天要用」「元旦开业」也是截止：那天必须能用（实测漏认后又被问一遍工期）。
const DEADLINE_WORD =
  /(前|之前|以前|截止|上线|交付|完成|完工|验收|结项|举办|召开|落地|要用|使用|启用|用上|开业|开幕|当天)/
const CN_NUM: Record<string, number> = {
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

function num(text: string): number | null {
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  if (text === '十') return 10
  if (text.length === 2 && text[0] === '十') return 10 + (CN_NUM[text[1]!] ?? 0)
  if (text.length === 2 && text[1] === '十') return (CN_NUM[text[0]!] ?? 0) * 10
  return CN_NUM[text] ?? null
}

function utc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day)
}

function lastDayOfMonth(year: number, month: number): number {
  return Date.UTC(year, month, 0)
}

/** 「11 月」之类不带年份：取今天之后最近的那个月。 */
function yearFor(month: number, today: number): number {
  const now = new Date(today)
  const year = now.getUTCFullYear()
  return month < now.getUTCMonth() + 1 ? year + 1 : year
}

export interface DateHit {
  ts: number
  precise: boolean
  index: number
  length: number
  text: string
}

/**
 * 找出原话里所有的时间表达（精确日期 + 模糊时段），模糊时段给出「按惯例的理解」：
 * 月初 → 该月第一个工作日；下旬 / 月底 → 该月最后一天；年底 → 12-31；上半年 → 06-30；Q1 → 03-31 …
 */
export function findDates(text: string, today: number, calendar: WorkingCalendar): DateHit[] {
  const hits: DateHit[] = []
  const push = (match: RegExpExecArray, ts: number, precise: boolean) =>
    hits.push({ ts, precise, index: match.index, length: match[0].length, text: match[0] })
  const scan = (re: RegExp, handle: (m: RegExpExecArray) => void) => {
    for (const match of text.matchAll(re)) handle(match as RegExpExecArray)
  }
  scan(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?/g, (m) =>
    push(m, utc(Number(m[1]), Number(m[2]), Number(m[3])), true),
  )
  scan(/(?<![\d年/-])(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g, (m) => {
    const month = Number(m[1])
    push(m, utc(yearFor(month, today), month, Number(m[2])), true)
  })
  scan(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(上旬|中旬|下旬|初|底|末|中)/g, (m) => {
    const month = Number(m[2])
    const year = m[1] ? Number(m[1]) : yearFor(month, today)
    const part = m[3]!
    const ts =
      part === '上旬' || part === '初'
        ? snapToWorkingDay(calendar, utc(year, month, 1), 1)
        : part === '中旬' || part === '中'
          ? utc(year, month, 15)
          : lastDayOfMonth(year, month)
    push(m, ts, false)
  })
  scan(/(今年|明年)?\s*(年底|年末|年终)/g, (m) => {
    const base = new Date(today).getUTCFullYear() + (m[1] === '明年' ? 1 : 0)
    push(m, utc(base, 12, 31), false)
  })
  scan(/(今年|明年)?\s*(上半年|下半年)/g, (m) => {
    const base = new Date(today).getUTCFullYear() + (m[1] === '明年' ? 1 : 0)
    push(m, m[2] === '上半年' ? utc(base, 6, 30) : utc(base, 12, 31), false)
  })
  scan(/(?:(今年|明年)\s*)?(?:Q|q|第)\s*([1-4一二三四])\s*(?:季度)?/g, (m) => {
    const quarter = num(m[2]!) ?? Number(m[2])
    const base = new Date(today).getUTCFullYear() + (m[1] === '明年' ? 1 : 0)
    push(m, lastDayOfMonth(base, quarter * 3), false)
  })
  scan(/下(个)?月(初)?/g, (m) => {
    const now = new Date(today)
    push(
      m,
      snapToWorkingDay(calendar, Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1), 1),
      false,
    )
  })
  scan(/下(个)?(周|星期|礼拜)([一二三四五])?/g, (m) => {
    const weekday = new Date(today).getUTCDay()
    const target = m[3] ? (num(m[3]) ?? 1) : 1
    const toMonday = (8 - weekday) % 7 || 7
    push(m, snapToWorkingDay(calendar, today + (toMonday + target - 1) * DAY_MS, 1), Boolean(m[3]))
  })
  // 「大后天」要先于「后天」匹配，否则被当成后天。
  scan(/(大后天|明天|后天|今天|即日)/g, (m) => {
    const offset = m[1] === '明天' ? 1 : m[1] === '大后天' ? 3 : m[1] === '后天' ? 2 : 0
    push(m, today + offset * DAY_MS, true)
  })
  // 「这周三」「本周五」「周四」（不带「下」）：本周那天，已过就算下周。
  scan(/(?<![下每])(?:(这|本)(?:个)?)?(周|星期|礼拜)([一二三四五六日天])/g, (m) => {
    const weekday = new Date(today).getUTCDay()
    const target = m[3] === '日' || m[3] === '天' ? 7 : (num(m[3]!) ?? 1)
    const current = weekday === 0 ? 7 : weekday
    const offset = target >= current ? target - current : target - current + 7
    push(m, today + offset * DAY_MS, true)
  })
  // 「3 天后」「两周之后」「一个月以后」：从今天起算。
  scan(/(\d+|[一二两三四五六七八九十]+)\s*(天|周|星期|个月|月)\s*(?:后|以后|之后)/g, (m) => {
    const count = num(m[1]!) ?? Number(m[1])
    const unit = m[2] === '天' ? 1 : m[2] === '周' || m[2] === '星期' ? 7 : 30
    if (Number.isFinite(count) && count > 0) push(m, today + count * unit * DAY_MS, m[2] === '天')
  })
  // 只说「8 号」：本月那天，已过就算下个月。
  scan(/(?<![\d月/-])(\d{1,2})\s*[号](?![码])/g, (m) => {
    const day = Number(m[1])
    if (day < 1 || day > 31) return
    const now = new Date(today)
    let ts = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day)
    if (ts < today) ts = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day)
    push(m, ts, true)
  })
  return hits.sort((a, b) => a.index - b.index)
}

/** 时间表达前后 10 字内是否有指定用词（判断是开工还是截止）。 */
function near(text: string, hit: DateHit, word: RegExp): boolean {
  const around = text.slice(Math.max(0, hit.index - 10), hit.index + hit.length + 10)
  return word.test(around)
}

// 「前一天 16 点前预订」「第二天」「每天」「当天」「上个月」不是工期（实测「前一天」被读成工期 1 天，
// 系统以为工期已知就不再追问截止日）：数字前是这些字时跳过。
const DURATION_RE =
  /(约|大约|大概|预计|周期|工期|为期|用|需要|计划)?\s*(?<![前后第每当隔头这那上下同本]\s*)(\d+(?:\.\d+)?|[一二两三四五六七八九十半]+)\s*(?:个)?\s*(工作日|天|日|周|星期|礼拜|个月|月|季度|年)(?!\s*[日号底初末中上下旬])/g
const UNIT_DAYS: Record<string, number> = {
  工作日: 1.4,
  天: 1,
  日: 1,
  周: 7,
  星期: 7,
  礼拜: 7,
  个月: 30,
  月: 30,
  季度: 91,
  年: 365,
}
const VAGUE_DURATION = /(尽快|越快越好|抓紧|时间不多|很急|不着急|慢慢来|看情况)/
const VAGUE_TEAM = /(几个人|几名|小团队|少量人手|我们团队|我们组|一些人|人手不多|人不多|现有团队)/
const HEADCOUNT =
  /(\d+|[一二两三四五六七八九十]+)\s*(?:个)?\s*(?:人|名|位)(?!民币|次|参与|参加|出席|报名|规模|以上的?用户)/
const ROLE_COUNT =
  /(架构|开发|测试|产品|设计|运维|DBA|项目经理|PM|前端|后端|实施|顾问|工程师|运营|市场)[^\d，。,;；]{0,6}\d+\s*(?:人|名|位)?/i
const MENTION = /(?:@|成员#)[\p{L}\p{N}_.-]+/u

export function extractCoreFactsFromInput(
  rawInput: string,
  now: Date,
  calendar: WorkingCalendar,
  todayAnchor: (now: Date) => number,
): InputCoreFacts {
  const today = todayAnchor(now)
  const hits = findDates(rawInput, today, calendar)

  // —— 开工日：「开始 / 启动」附近的时间表达
  const startHit = hits.find((hit) => near(rawInput, hit, START_WORD))
  const start: InputDateFact = startHit
    ? {
        status: startHit.precise ? 'precise' : 'vague',
        value: formatIsoDate(
          isWorkingDay(calendar, startHit.ts)
            ? startHit.ts
            : snapToWorkingDay(calendar, startHit.ts, 1),
        ),
        quote: startHit.text,
      }
    : /(尽快开始|马上开始|立即开始|随时开始)/.test(rawInput)
      ? {
          status: 'vague',
          value: formatIsoDate(shiftWorkingDays(calendar, today, 1)),
          quote: rawInput.match(/(尽快开始|马上开始|立即开始|随时开始)/)![0],
        }
      : { status: 'absent', value: null, quote: null }

  // —— 工期 / 截止：先看截止类时间表达（不能是开工那个），再看「N 个月」这类时长
  const deadlineHit = hits.find(
    (hit) => hit !== startHit && hit.ts > today && near(rawInput, hit, DEADLINE_WORD),
  )
  let duration: InputDurationFact = {
    status: 'absent',
    durationDays: null,
    deadline: null,
    quote: null,
  }
  if (deadlineHit) {
    duration = {
      status: deadlineHit.precise ? 'precise' : 'vague',
      durationDays: null,
      deadline: formatIsoDate(deadlineHit.ts),
      quote: deadlineHit.text,
    }
  } else {
    // 去掉已识别的日期片段，避免「11 月 27 日」被读成 11 个月 / 27 天
    let rest = rawInput
    for (const hit of hits) rest = rest.replace(hit.text, ' ')
    const match = [...rest.matchAll(DURATION_RE)][0]
    if (match) {
      const value = num(match[2]!)
      const unit = UNIT_DAYS[match[3]!]
      if (value && unit) {
        duration = {
          status: 'precise',
          durationDays: Math.round(value * unit),
          deadline: null,
          quote: match[0].trim(),
        }
      }
    } else if (VAGUE_DURATION.test(rawInput)) {
      duration = {
        status: 'vague',
        durationDays: null,
        deadline: null,
        quote: rawInput.match(VAGUE_DURATION)![0],
      }
    }
  }

  // —— 团队：人数 / 角色名册 / @成员 = 清楚；「几个人」「小团队」= 模糊
  // 名册（「前端 1 人、后端 1 人、测试 1 人」）要整段记下并合计，不能只取第一个「1 人」
  // （实测就绪页显示「团队 1 人」）。
  const roster = parseTeamRoster(rawInput)
  const team: InputTeamFact =
    roster.length >= 2
      ? {
          status: 'precise',
          quote: `${roster.map((entry) => `${entry.role} ${entry.headcount} 人`).join('、')}（共 ${roster.reduce((sum, entry) => sum + entry.headcount, 0)} 人）`,
        }
      : HEADCOUNT.test(rawInput) || ROLE_COUNT.test(rawInput) || MENTION.test(rawInput)
        ? {
            status: 'precise',
            quote: (rawInput.match(HEADCOUNT) ??
              rawInput.match(ROLE_COUNT) ??
              rawInput.match(MENTION))![0],
          }
        : VAGUE_TEAM.test(rawInput)
          ? { status: 'vague', quote: rawInput.match(VAGUE_TEAM)![0] }
          : { status: 'absent', quote: null }

  return { start, duration, team }
}
