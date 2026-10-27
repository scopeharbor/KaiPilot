/**
 * v3-llm-wiki-planning-dossier —— 计划档案（参照类 / 打法）派生段的确定性渲染与解析、页面骨架与派生段替换。
 *
 * 派生段由系统生成器写、按簿记自动刷新；刷新只替换派生段，人写的「解读」原样保留。
 * 渲染与解析成对（往返测试守护）；正文不含日期，统计不变时正文不变。
 */
import { PROJECT_TYPES, type ProjectType } from './ai-intent.js'
import { renderWikiMarkdown, type WikiPageType } from './llm-wiki-memory.js'

export const WIKI_REFERENCE_CLASS_GENERATOR = 'reference-class.task-durations'
export const WIKI_PLAYBOOK_GENERATOR = 'playbook.draft-edits'

export const WIKI_DOSSIER_CLASSES = ['all', ...PROJECT_TYPES] as const
export type WikiDossierClass = (typeof WIKI_DOSSIER_CLASSES)[number]

export const WIKI_DOSSIER_CLASS_LABELS: Record<WikiDossierClass, string> = {
  all: '全组织',
  software: '软件类',
  event: '活动类',
  research: '研究类',
  product: '产品类',
  general: '通用类',
}

/** 参照类至少要这么多个已完成任务样本（与 planning_memory 的执行校准门槛一致）。 */
export const WIKI_REFERENCE_CLASS_MIN_SAMPLES = 8
const NAME_MAX = 40
const LIST_MAX = 8

export type WikiDossierKind = 'reference-class' | 'playbook'

export interface WikiReferenceClassStats {
  samples: number
  plannedMedianDays: number
  actualP50Days: number
  actualP80Days: number
  /** 实际 ÷ 计划的中位数（>1 表示计划偏乐观）。 */
  bias: number
}

export interface WikiPlaybookStats {
  drafts: number
  removed: string[]
  added: string[]
  phases: string[]
}

export interface WikiDossierRefreshSummary {
  created: number
  updated: number
  unchanged: number
  skipped: number
}

// ── 统计 ────────────────────────────────────────────────────────────────

const round = (n: number, digits: number) => {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/** 最近秩分位数（确定性，无插值）。 */
export function wikiPercentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)))
  return sorted[rank - 1]!
}

export function wikiMedian(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function computeWikiReferenceClass(
  samples: ReadonlyArray<{ plannedDays: number; actualDays: number }>,
): WikiReferenceClassStats | null {
  const valid = samples.filter(
    (s) =>
      Number.isFinite(s.plannedDays) &&
      Number.isFinite(s.actualDays) &&
      s.plannedDays > 0 &&
      s.actualDays > 0,
  )
  if (valid.length < WIKI_REFERENCE_CLASS_MIN_SAMPLES) return null
  const actual = valid.map((s) => s.actualDays)
  return {
    samples: valid.length,
    plannedMedianDays: round(wikiMedian(valid.map((s) => s.plannedDays)), 1),
    actualP50Days: round(wikiMedian(actual), 1),
    actualP80Days: round(wikiPercentile(actual, 0.8), 1),
    bias: round(wikiMedian(valid.map((s) => s.actualDays / s.plannedDays)), 2),
  }
}

// ── 渲染与解析 ───────────────────────────────────────────────────────────

export interface WikiDerivedBlockRender {
  /** 派生段内的行（不含起止标记）。 */
  lines: string[]
  /** 文末脚注定义行。 */
  defs: string[]
}

const fmt = (n: number) => String(round(n, 2))

function def(key: string, generator: string) {
  return `[^c:${key}]: derived_query#${generator}`
}

export function renderWikiReferenceClassBlock(
  stats: WikiReferenceClassStats,
): WikiDerivedBlockRender {
  const g = WIKI_REFERENCE_CLASS_GENERATOR
  return {
    lines: [
      `- 样本：已完成任务 ${stats.samples} 个。[^c:rc-samples]`,
      `- 计划工期中位数 ${fmt(stats.plannedMedianDays)} 天；实际用时中位数 ${fmt(stats.actualP50Days)} 个工作日，P80 ${fmt(stats.actualP80Days)} 个工作日。[^c:rc-actual]`,
      `- 实际 ÷ 计划的中位偏差 ${fmt(stats.bias)}（大于 1 表示计划偏乐观）。[^c:rc-bias]`,
    ],
    defs: [def('rc-samples', g), def('rc-actual', g), def('rc-bias', g)],
  }
}

const NUM = '(\\d+(?:\\.\\d+)?)'

export function parseWikiReferenceClassBlock(content: string): WikiReferenceClassStats | null {
  const samples = new RegExp(`已完成任务 ${NUM} 个`).exec(content)
  const actual = new RegExp(
    `计划工期中位数 ${NUM} 天；实际用时中位数 ${NUM} 个工作日，P80 ${NUM} 个工作日`,
  ).exec(content)
  const bias = new RegExp(`中位偏差 ${NUM}`).exec(content)
  if (!samples || !actual || !bias) return null
  return {
    samples: Number(samples[1]),
    plannedMedianDays: Number(actual[1]),
    actualP50Days: Number(actual[2]),
    actualP80Days: Number(actual[3]),
    bias: Number(bias[1]),
  }
}

/** 任务 / 阶段名清洗：去掉方括号与换行，顿号换成斜杠（列表用顿号分隔），限长。 */
export function cleanWikiDossierName(name: string): string {
  return Array.from(
    name
      .replace(/[[\]\r\n]/g, '')
      .replace(/、/g, '/')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, NAME_MAX)
    .join('')
}

function cleanList(names: readonly string[]): string[] {
  const out: string[] = []
  for (const n of names) {
    const c = cleanWikiDossierName(n)
    if (c && !out.includes(c)) out.push(c)
    if (out.length >= LIST_MAX) break
  }
  return out
}

const PLAYBOOK_LINES = [
  ['removed', 'pb-removed', '草案里常被删掉的任务'],
  ['added', 'pb-added', '用户常自己补上的任务'],
  ['phases', 'pb-phases', '常用的一级阶段'],
] as const

export function wikiPlaybookHasContent(stats: WikiPlaybookStats): boolean {
  return PLAYBOOK_LINES.some(([field]) => cleanList(stats[field]).length > 0)
}

export function renderWikiPlaybookBlock(stats: WikiPlaybookStats): WikiDerivedBlockRender {
  const g = WIKI_PLAYBOOK_GENERATOR
  const lines = [`- 对比了 ${stats.drafts} 份已转正草案。[^c:pb-drafts]`]
  const defs = [def('pb-drafts', g)]
  for (const [field, key, label] of PLAYBOOK_LINES) {
    const list = cleanList(stats[field])
    if (list.length === 0) continue
    lines.push(`- ${label}：${list.join('、')}。[^c:${key}]`)
    defs.push(def(key, g))
  }
  return { lines, defs }
}

export function parseWikiPlaybookBlock(content: string): WikiPlaybookStats | null {
  const drafts = new RegExp(`对比了 ${NUM} 份已转正草案`).exec(content)
  if (!drafts) return null
  const listOf = (label: string) => {
    const m = new RegExp(`${label}：(.+?)。\\[\\^c:`).exec(content)
    return m ? m[1]!.split('、').filter(Boolean) : []
  }
  return {
    drafts: Number(drafts[1]),
    removed: listOf('草案里常被删掉的任务'),
    added: listOf('用户常自己补上的任务'),
    phases: listOf('常用的一级阶段'),
  }
}

// ── 页面 ────────────────────────────────────────────────────────────────

export function wikiDossierSlug(kind: WikiDossierKind, cls: WikiDossierClass): string {
  return `${kind}-${cls}`
}

export function wikiDossierTitle(kind: WikiDossierKind, cls: WikiDossierClass): string {
  const label = WIKI_DOSSIER_CLASS_LABELS[cls]
  return kind === 'reference-class'
    ? `${label}${cls === 'all' ? '' : '项目'}任务工期参照类`
    : `${label}${cls === 'all' ? '' : '项目'}打法：草案常改之处`
}

const SECTION: Record<WikiDossierKind, string> = {
  'reference-class': '实际工期分布（确定性派生，勿手改）',
  playbook: '草案常改之处（确定性派生，勿手改）',
}
const GENERATOR: Record<WikiDossierKind, string> = {
  'reference-class': WIKI_REFERENCE_CLASS_GENERATOR,
  playbook: WIKI_PLAYBOOK_GENERATOR,
}
export const WIKI_DOSSIER_INTERPRETATION_HEADING = '解读（人工补充，经审阅）'

/** 新建档案页的完整正文（纯派生：派生段 + 标题 + 脚注定义）。 */
export function wikiDossierPageBody(
  kind: WikiDossierKind,
  cls: WikiDossierClass,
  block: WikiDerivedBlockRender,
): string {
  const label = WIKI_DOSSIER_CLASS_LABELS[cls]
  const summary =
    kind === 'reference-class'
      ? `${label}已完成任务的实际用时分布与计划偏差（确定性统计）`
      : `${label}已转正草案中用户常删、常补的任务与常用阶段（确定性统计）`
  return renderWikiMarkdown(
    {
      type: kind satisfies WikiPageType,
      title: wikiDossierTitle(kind, cls),
      summary,
    },
    [
      `## ${SECTION[kind]}`,
      '',
      `<!-- derived:${GENERATOR[kind]} -->`,
      ...block.lines,
      '<!-- /derived -->',
      '',
      `## ${WIKI_DOSSIER_INTERPRETATION_HEADING}`,
      '',
      ...block.defs,
      '',
    ].join('\n'),
  )
}

/**
 * 只替换某生成器的派生段，并重建以 keyPrefix 开头的脚注定义；其余内容原样保留。
 * 找不到该派生段时返回 null。
 */
export function replaceWikiDerivedBlock(
  source: string,
  generatorId: string,
  block: WikiDerivedBlockRender,
  keyPrefix: string,
): string | null {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => l.trim() === `<!-- derived:${generatorId} -->`)
  if (start < 0) return null
  let end = -1
  for (let i = start + 1; i < lines.length; i++) {
    if (/^<!--\s*\/derived\s*-->$/.test((lines[i] ?? '').trim())) {
      end = i
      break
    }
  }
  if (end < 0) return null
  const defRe = new RegExp(
    `^\\s*\\[\\^c:${keyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\]]*\\]:`,
  )
  const kept = [...lines.slice(0, start + 1), ...block.lines, ...lines.slice(end)].filter(
    (l) => !defRe.test(l),
  )
  while (kept.length > 0 && (kept[kept.length - 1] ?? '').trim() === '') kept.pop()
  return `${[...kept, '', ...block.defs].join('\n')}\n`
}

/** 计划体检里的参照类摘要（草案上下文传入）。 */
export interface WikiReferenceClassForDraft {
  label: string
  samples: number
  p50Days: number
  p80Days: number
}

export function isWikiDossierClass(value: unknown): value is WikiDossierClass {
  return typeof value === 'string' && (WIKI_DOSSIER_CLASSES as readonly string[]).includes(value)
}

export function wikiDossierClassFor(projectType: ProjectType | null | undefined): WikiDossierClass {
  return projectType && isWikiDossierClass(projectType) ? projectType : 'all'
}
