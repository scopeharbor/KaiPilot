/**
 * v3-llm-wiki-retrospective-lessons —— 结项复盘派生段、组织教训库晋升成文、教训召回打分。
 *
 * 复盘是本项目的描述性事实（确定性统计）；教训一律经审阅。渲染与解析成对（往返测试守护）。
 */
import type { ProjectType } from './ai-intent.js'
import {
  WIKI_DOSSIER_CLASS_LABELS,
  wikiMedian,
  type WikiDerivedBlockRender,
} from './llm-wiki-dossier.js'
import { fnv1a32Hex } from './llm-wiki-ingest.js'
import {
  normalizeWikiClaimStatement,
  parseWikiMarkdown,
  renderWikiMarkdown,
} from './llm-wiki-memory.js'

export const WIKI_RETROSPECTIVE_GENERATOR = 'project.retrospective'
export const WIKI_RETROSPECTIVE_SLUG = 'retrospective'
export const WIKI_RETROSPECTIVE_KEY_PREFIX = 'pr-'
export const WIKI_RETROSPECTIVE_FACTS_HEADING = '计划与实际（确定性派生，勿手改）'
export const WIKI_RETROSPECTIVE_LESSONS_HEADING = '教训（经审阅）'
/** 视为结项的项目状态。 */
export const WIKI_RETROSPECTIVE_CLOSED_STATUSES = ['completed', 'cancelled', 'archived'] as const
const TOP_LATE = 3
const TASK_NAME_MAX = 30

export const WIKI_LESSONS_SLUG = 'lessons'
export const WIKI_LESSON_KEY_PREFIX = 'lp-'
/** 召回最多返回条数。 */
export const WIKI_LESSON_RECALL_LIMIT = 5
/** 查询与教训至少重合这么多个二字组 / 词才算相关。 */
export const WIKI_LESSON_RECALL_MIN_OVERLAP = 2

const NUM = '(-?\\d+(?:\\.\\d+)?)'
const DATE = '(\\d{4}-\\d{2}-\\d{2})'

// ── 复盘统计 ─────────────────────────────────────────────────────────────

export interface WikiRetrospectiveInput {
  plannedStart: string | null
  plannedEnd: string | null
  actualEnd: string | null
  tasks: ReadonlyArray<{
    name: string
    completed: boolean
    plannedEnd: string | null
    actualEnd: string | null
  }>
  riskStatuses: readonly string[]
  changes: ReadonlyArray<{ submitted: boolean; approved: boolean }>
}

export interface WikiRetrospectiveStats {
  plannedStart: string | null
  plannedEnd: string | null
  actualEnd: string | null
  /** 实际 − 计划结束日（自然日）；缺日期为 null。 */
  scheduleSlipDays: number | null
  tasksTotal: number
  tasksCompleted: number
  /** 有计划与实际完成日的任务数。 */
  measured: number
  /** measured 中按期（含提前）完成的比例（整数百分比）；measured 为 0 时为 null。 */
  onTimeShare: number | null
  lateCount: number
  lateP50Days: number | null
  topLate: Array<{ name: string; days: number }>
  changesTotal: number
  changesApproved: number
  risksTotal: number
  risksClosed: number
}

const RISK_CLOSED = new Set(['resolved', 'accepted', 'closed'])

/** 日期字符串（取前 10 位）；无效返回 null。 */
function day(value: string | null): string | null {
  if (!value) return null
  const d = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? d : null
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** 任务名清洗：去掉主张标记、维基链接、引号与换行，截断。 */
export function cleanWikiRetrospectiveTaskName(name: string): string {
  const text = name
    .replace(/\[\^c:[^\]]*\]/g, '')
    .replace(/\[\[|\]\]/g, '')
    .replace(/[「」]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(text).slice(0, TASK_NAME_MAX).join('') || '未命名任务'
}

export function computeWikiRetrospective(
  input: WikiRetrospectiveInput,
): WikiRetrospectiveStats | null {
  if (input.tasks.length === 0) return null
  const plannedEnd = day(input.plannedEnd)
  const actualEnd = day(input.actualEnd)
  const late: Array<{ name: string; days: number }> = []
  let measured = 0
  let onTime = 0
  for (const t of input.tasks) {
    const p = day(t.plannedEnd)
    const a = day(t.actualEnd)
    if (!t.completed || !p || !a) continue
    measured++
    const slip = daysBetween(p, a)
    if (slip <= 0) onTime++
    else late.push({ name: cleanWikiRetrospectiveTaskName(t.name), days: slip })
  }
  late.sort((x, y) => y.days - x.days || x.name.localeCompare(y.name))
  return {
    plannedStart: day(input.plannedStart),
    plannedEnd,
    actualEnd,
    scheduleSlipDays: plannedEnd && actualEnd ? daysBetween(plannedEnd, actualEnd) : null,
    tasksTotal: input.tasks.length,
    tasksCompleted: input.tasks.filter((t) => t.completed).length,
    measured,
    onTimeShare: measured > 0 ? Math.round((onTime * 100) / measured) : null,
    lateCount: late.length,
    lateP50Days: late.length > 0 ? Math.round(wikiMedian(late.map((l) => l.days)) * 10) / 10 : null,
    topLate: late.slice(0, TOP_LATE),
    changesTotal: input.changes.filter((c) => c.submitted).length,
    changesApproved: input.changes.filter((c) => c.submitted && c.approved).length,
    risksTotal: input.riskStatuses.length,
    risksClosed: input.riskStatuses.filter((s) => RISK_CLOSED.has(s)).length,
  }
}

function scheduleLine(s: WikiRetrospectiveStats): string {
  const plan =
    s.plannedStart || s.plannedEnd
      ? `计划 ${s.plannedStart ?? '未定'} 至 ${s.plannedEnd ?? '未定'}`
      : '没有记录计划起止日'
  if (!s.actualEnd) return `${plan}；没有记录实际结束日。`
  if (s.scheduleSlipDays === null) return `${plan}；实际结束 ${s.actualEnd}。`
  const verdict =
    s.scheduleSlipDays > 0
      ? `比计划晚 ${s.scheduleSlipDays} 天`
      : s.scheduleSlipDays < 0
        ? `比计划提前 ${-s.scheduleSlipDays} 天`
        : '按期'
  return `${plan}；实际结束 ${s.actualEnd}，${verdict}。`
}

export function renderWikiRetrospectiveBlock(s: WikiRetrospectiveStats): WikiDerivedBlockRender {
  const g = WIKI_RETROSPECTIVE_GENERATOR
  const tasks =
    s.onTimeShare === null
      ? `- 任务 ${s.tasksTotal} 个，已完成 ${s.tasksCompleted} 个；没有同时记录计划与实际完成日的任务。[^c:pr-tasks]`
      : `- 任务 ${s.tasksTotal} 个，已完成 ${s.tasksCompleted} 个；有计划与实际完成日的 ${s.measured} 个中按期 ${s.onTimeShare}%。[^c:pr-tasks]`
  const late =
    s.lateCount === 0
      ? '- 没有延误的任务。[^c:pr-late]'
      : `- 延误的任务 ${s.lateCount} 个，延误天数中位数 ${s.lateP50Days} 天；延误最多：${s.topLate
          .map((t) => `「${t.name}」${t.days} 天`)
          .join('、')}。[^c:pr-late]`
  return {
    lines: [
      `- ${scheduleLine(s)}[^c:pr-schedule]`,
      tasks,
      late,
      `- 变更请求 ${s.changesTotal} 个，批准 ${s.changesApproved} 个。[^c:pr-changes]`,
      `- 登记风险 ${s.risksTotal} 个，结项时已处置或关闭 ${s.risksClosed} 个、仍未关闭 ${s.risksTotal - s.risksClosed} 个。[^c:pr-risks]`,
    ],
    defs: ['pr-schedule', 'pr-tasks', 'pr-late', 'pr-changes', 'pr-risks'].map(
      (k) => `[^c:${k}]: derived_query#${g}`,
    ),
  }
}

export function parseWikiRetrospectiveBlock(content: string): WikiRetrospectiveStats | null {
  const tasks = new RegExp(`任务 ${NUM} 个，已完成 ${NUM} 个`).exec(content)
  const changes = new RegExp(`变更请求 ${NUM} 个，批准 ${NUM} 个`).exec(content)
  const risks = new RegExp(`登记风险 ${NUM} 个，结项时已处置或关闭 ${NUM} 个`).exec(content)
  if (!tasks || !changes || !risks) return null
  const plan = new RegExp(
    `计划 (${'\\d{4}-\\d{2}-\\d{2}'}|未定) 至 (${'\\d{4}-\\d{2}-\\d{2}'}|未定)`,
  ).exec(content)
  const actual = new RegExp(`实际结束 ${DATE}`).exec(content)
  const slip = /比计划晚 (\d+) 天/.exec(content)
  const early = /比计划提前 (\d+) 天/.exec(content)
  const measured = new RegExp(`有计划与实际完成日的 ${NUM} 个中按期 ${NUM}%`).exec(content)
  const lateRow = new RegExp(
    `延误的任务 ${NUM} 个，延误天数中位数 ${NUM} 天；延误最多：([^\\n]*?)。\\[`,
  ).exec(content)
  const plannedStart = plan && plan[1] !== '未定' ? plan[1]! : null
  const plannedEnd = plan && plan[2] !== '未定' ? plan[2]! : null
  const actualEnd = actual ? actual[1]! : null
  return {
    plannedStart,
    plannedEnd,
    actualEnd,
    scheduleSlipDays:
      plannedEnd && actualEnd ? (slip ? Number(slip[1]) : early ? -Number(early[1]) : 0) : null,
    tasksTotal: Number(tasks[1]),
    tasksCompleted: Number(tasks[2]),
    measured: measured ? Number(measured[1]) : 0,
    onTimeShare: measured ? Number(measured[2]) : null,
    lateCount: lateRow ? Number(lateRow[1]) : 0,
    lateP50Days: lateRow ? Number(lateRow[2]) : null,
    topLate: lateRow
      ? [...lateRow[3]!.matchAll(/「([^」]*)」(\d+) 天/g)].map((m) => ({
          name: m[1]!,
          days: Number(m[2]),
        }))
      : [],
    changesTotal: Number(changes[1]),
    changesApproved: Number(changes[2]),
    risksTotal: Number(risks[1]),
    risksClosed: Number(risks[2]),
  }
}

export function wikiRetrospectivePageBody(block: WikiDerivedBlockRender): string {
  return renderWikiMarkdown(
    {
      type: 'lesson',
      title: '项目复盘',
      summary: '结项后的计划与实际对比（确定性统计）与经审阅的教训',
    },
    [
      `## ${WIKI_RETROSPECTIVE_FACTS_HEADING}`,
      '',
      `<!-- derived:${WIKI_RETROSPECTIVE_GENERATOR} -->`,
      ...block.lines,
      '<!-- /derived -->',
      '',
      `## ${WIKI_RETROSPECTIVE_LESSONS_HEADING}`,
      '',
      ...block.defs,
      '',
    ].join('\n'),
  )
}

// ── 组织教训库 ───────────────────────────────────────────────────────────

/** 教训库章节：项目类型标签；没有类型时为「全组织」。 */
export function wikiLessonSectionOf(projectType: ProjectType | null): string {
  return WIKI_DOSSIER_CLASS_LABELS[projectType ?? 'all']
}

export function wikiLessonsSkeleton(): string {
  return renderWikiMarkdown(
    {
      type: 'lesson',
      title: '组织教训库',
      summary: '各项目复盘晋升的教训，按项目类型归类（经组织审阅）',
    },
    '',
  )
}

const LESSON_SUFFIX = /（来自「[^」]*」复盘）[。.]?$/

/** 教训陈述去掉来源后缀与句末标点（键与去重按此计算）。 */
export function wikiLessonCore(statement: string): string {
  return statement
    .replace(LESSON_SUFFIX, '')
    .replace(/[。！？.!?]+$/, '')
    .trim()
}

const lessonKey = (statement: string) =>
  `${WIKI_LESSON_KEY_PREFIX}${fnv1a32Hex(normalizeWikiClaimStatement(wikiLessonCore(statement)))}`

/**
 * 把一条教训追加到教训库对应章节（缺失时补上章节），文字注明来源项目。已有同键或同陈述返回 null。
 */
export function planWikiLessonPromotion(args: {
  baseSource: string
  statement: string
  projectName: string
  section: string
  /** 晋升者用户 ID（来源记为其陈述）。 */
  promotedBy: number
}): string | null {
  const parsed = parseWikiMarkdown(args.baseSource)
  if (!parsed.ok) throw new Error('基线正文无法解析')
  const core = wikiLessonCore(args.statement)
  if (!core) return null
  const key = lessonKey(core)
  const normalized = normalizeWikiClaimStatement(core)
  if (
    parsed.doc.claims.some(
      (c) =>
        c.key === key || normalizeWikiClaimStatement(wikiLessonCore(c.statement)) === normalized,
    )
  )
    return null
  const project = cleanWikiRetrospectiveTaskName(args.projectName)
  const line = `- ${core}（来自「${project}」复盘）。[^c:${key}]`
  // 来源记为晋升者的陈述（全组织可读）；若引用 project#id，非项目成员读时会被遮蔽，教训库就失去了共享的意义
  const def = `[^c:${key}]: user_statement#${args.promotedBy} | kind:inference`

  const src = args.baseSource.replace(/\n+$/, '').split('\n')
  const heading = `## ${args.section}`
  let at = src.findIndex((l) => l.trim() === heading)
  if (at < 0) {
    // 新章节放在第一条脚注定义之前（没有定义则放末尾）
    const firstDef = src.findIndex((l) => /^\s*\[\^c:[^\]]+\]:/.test(l))
    const insert = firstDef < 0 ? src.length : firstDef
    src.splice(
      insert,
      0,
      ...(insert > 0 && src[insert - 1]?.trim() !== '' ? [''] : []),
      heading,
      '',
    )
    at = src.indexOf(heading, Math.max(0, insert - 1))
  }
  let insertAt = at + 1
  for (let i = at + 1; i < src.length; i++) {
    const l = src[i] ?? ''
    if (/^#{1,6}\s+/.test(l) || /^\s*\[\^c:[^\]]+\]:/.test(l)) break
    if (l.trim() !== '') insertAt = i + 1
  }
  src.splice(insertAt, 0, line)
  const head = src.join('\n').replace(/\n+$/, '')
  const endsWithDef = /^\s*\[\^c:[^\]]+\]:/.test(head.split('\n').pop() ?? '')
  return `${head}${endsWithDef ? '\n' : '\n\n'}${def}\n`.replace(/\n{3,}/g, '\n\n')
}

// ── 召回 ─────────────────────────────────────────────────────────────────

export interface WikiLessonCandidate {
  claimId: number
  statement: string
  section: string | null
}

export interface WikiLessonRecallItem {
  claimId: number
  statement: string
  section: string | null
  score: number
}

/** 中文二字组 + 英文 / 数字词（小写）。 */
export function wikiLessonTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const run of text.match(/[一-鿿]+/g) ?? []) {
    const chars = Array.from(run)
    for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i]! + chars[i + 1]!)
  }
  for (const w of text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) out.add(w)
  return out
}

/** 按关键词重合（≥ 阈值才计入）与章节（同类型或全组织 +1）打分，降序取前 limit；同分按原顺序。 */
export function recallWikiLessons(
  candidates: readonly WikiLessonCandidate[],
  args: { query: string; section: string | null; limit?: number },
): WikiLessonRecallItem[] {
  const query = wikiLessonTokens(args.query)
  if (query.size === 0) return []
  const general = WIKI_DOSSIER_CLASS_LABELS.all
  const scored = candidates
    .map((c, index) => {
      const tokens = wikiLessonTokens(wikiLessonCore(c.statement))
      let overlap = 0
      for (const t of tokens) if (query.has(t)) overlap++
      if (overlap < WIKI_LESSON_RECALL_MIN_OVERLAP) return null
      const bonus = c.section && (c.section === args.section || c.section === general) ? 1 : 0
      return { item: { ...c, score: overlap + bonus }, index }
    })
    .filter((x): x is { item: WikiLessonRecallItem; index: number } => x !== null)
  scored.sort((a, b) => b.item.score - a.item.score || a.index - b.index)
  return scored.slice(0, args.limit ?? WIKI_LESSON_RECALL_LIMIT).map((x) => x.item)
}

/** 草案上下文里的历史教训（来自组织教训库已发布可见的主张）。 */
export interface WikiLessonForDraft {
  statement: string
  section: string | null
}
