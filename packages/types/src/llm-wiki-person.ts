/**
 * v3-llm-wiki-person-space —— 个人空间：估算校准派生段、偏好导入成文、授权给我的列表 DTO。
 *
 * 个人内容只供本人自我校准：只用「你」，不含任何他人数据、排名或比较。渲染与解析成对（往返测试守护）。
 */
import { sanitizeMemoryContent } from './copilot-memory.js'
import {
  wikiMedian,
  wikiPercentile,
  type WikiDerivedBlockRender,
  type WikiDossierRefreshSummary,
} from './llm-wiki-dossier.js'
import { fnv1a32Hex } from './llm-wiki-ingest.js'
import {
  normalizeWikiClaimStatement,
  parseWikiMarkdown,
  renderWikiMarkdown,
  type WikiPageSummaryDto,
} from './llm-wiki-memory.js'

export const WIKI_PERSON_ESTIMATE_GENERATOR = 'person.estimate-calibration'
export const WIKI_PERSON_ESTIMATE_SLUG = 'estimate-calibration'
export const WIKI_PERSON_ESTIMATE_KEY_PREFIX = 'pe-'
/** 本人负责并已完成的任务至少这么多个才产出估算校准。 */
export const WIKI_PERSON_ESTIMATE_MIN_SAMPLES = 5
/** 只看本人最近这么多个已完成任务。 */
export const WIKI_PERSON_ESTIMATE_RECENT_LIMIT = 100

export const WIKI_PERSON_ESTIMATE_HEADING = '我的估算习惯（确定性派生，勿手改）'
export const WIKI_PERSON_NOTES_HEADING = '我的说明（本人补充）'

export const WIKI_PERSON_PREFERENCES_SLUG = 'preferences'
export const WIKI_PERSON_PREFERENCES_HEADING = '偏好'
/** 一次最多导入的记忆条目数。 */
export const WIKI_PERSON_IMPORT_MAX = 50
const PREFERENCE_MAX_CHARS = 200

/**
 * 个人空间禁止推断的敏感类别（健康、宗教、政治、家庭与亲密关系等；设计 §11），
 * 在既有 sanitizer（凭据、证件号等）之外额外拦截。宁可多拦。
 */
export const WIKI_PERSON_SENSITIVE_PATTERN =
  /健康|疾病|生病|病情|病史|怀孕|备孕|宗教|信仰|政治|党派|婚姻|离婚|恋爱|家庭|家人|孩子|子女|性取向|残疾|心理咨询|抑郁/

const round = (n: number, digits: number) => {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
const fmt = (n: number) => String(round(n, 2))
const NUM = '(\\d+(?:\\.\\d+)?)'

// ── 估算校准 ─────────────────────────────────────────────────────────────

export interface WikiPersonEstimateStats {
  samples: number
  plannedMedianDays: number
  actualP50Days: number
  actualP80Days: number
  /** 实际 ÷ 计划的中位数（>1 表示估得偏乐观）。 */
  bias: number
  /** 实际 ≤ 计划的样本比例（整数百分比）。 */
  onTimeShare: number
}

export function computeWikiPersonEstimate(
  samples: ReadonlyArray<{ plannedDays: number; actualDays: number }>,
): WikiPersonEstimateStats | null {
  const valid = samples.filter(
    (s) =>
      Number.isFinite(s.plannedDays) &&
      Number.isFinite(s.actualDays) &&
      s.plannedDays > 0 &&
      s.actualDays > 0,
  )
  if (valid.length < WIKI_PERSON_ESTIMATE_MIN_SAMPLES) return null
  const actual = valid.map((s) => s.actualDays)
  return {
    samples: valid.length,
    plannedMedianDays: round(wikiMedian(valid.map((s) => s.plannedDays)), 1),
    actualP50Days: round(wikiMedian(actual), 1),
    actualP80Days: round(wikiPercentile(actual, 0.8), 1),
    bias: round(wikiMedian(valid.map((s) => s.actualDays / s.plannedDays)), 2),
    onTimeShare: Math.round(
      (valid.filter((s) => s.actualDays <= s.plannedDays).length * 100) / valid.length,
    ),
  }
}

export function renderWikiPersonEstimateBlock(
  stats: WikiPersonEstimateStats,
): WikiDerivedBlockRender {
  const g = WIKI_PERSON_ESTIMATE_GENERATOR
  return {
    lines: [
      `- 样本：你负责并已完成的任务 ${stats.samples} 个（最近 ${WIKI_PERSON_ESTIMATE_RECENT_LIMIT} 个以内）。[^c:pe-samples]`,
      `- 你的计划工期中位数 ${fmt(stats.plannedMedianDays)} 天；实际用时中位数 ${fmt(stats.actualP50Days)} 个工作日，P80 ${fmt(stats.actualP80Days)} 个工作日。[^c:pe-actual]`,
      `- 实际 ÷ 计划的中位数 ${fmt(stats.bias)}（大于 1 表示估得偏乐观）；按时或提前完成的占 ${stats.onTimeShare}%。[^c:pe-bias]`,
    ],
    defs: ['pe-samples', 'pe-actual', 'pe-bias'].map((k) => `[^c:${k}]: derived_query#${g}`),
  }
}

export function parseWikiPersonEstimateBlock(content: string): WikiPersonEstimateStats | null {
  const samples = new RegExp(`你负责并已完成的任务 ${NUM} 个`).exec(content)
  const actual = new RegExp(
    `你的计划工期中位数 ${NUM} 天；实际用时中位数 ${NUM} 个工作日，P80 ${NUM} 个工作日`,
  ).exec(content)
  const bias = new RegExp(`实际 ÷ 计划的中位数 ${NUM}.*?按时或提前完成的占 ${NUM}%`).exec(content)
  if (!samples || !actual || !bias) return null
  return {
    samples: Number(samples[1]),
    plannedMedianDays: Number(actual[1]),
    actualP50Days: Number(actual[2]),
    actualP80Days: Number(actual[3]),
    bias: Number(bias[1]),
    onTimeShare: Number(bias[2]),
  }
}

export function wikiPersonEstimatePageBody(block: WikiDerivedBlockRender): string {
  return renderWikiMarkdown(
    {
      type: 'person',
      title: '我的估算校准',
      summary: '只供本人自我校准，不用于考核或排名（确定性统计）',
    },
    [
      `## ${WIKI_PERSON_ESTIMATE_HEADING}`,
      '',
      `<!-- derived:${WIKI_PERSON_ESTIMATE_GENERATOR} -->`,
      ...block.lines,
      '<!-- /derived -->',
      '',
      `## ${WIKI_PERSON_NOTES_HEADING}`,
      '',
      ...block.defs,
      '',
    ].join('\n'),
  )
}

export type WikiPersonEstimateRefreshSummary = WikiDossierRefreshSummary

// ── 偏好导入 ─────────────────────────────────────────────────────────────

export function wikiPersonPreferencesSkeleton(): string {
  return renderWikiMarkdown(
    {
      type: 'person',
      title: '我的工作偏好',
      summary: '只影响给我本人的输出（例如周报格式、语气），由本人确认',
    },
    [`## ${WIKI_PERSON_PREFERENCES_HEADING}`, ''].join('\n'),
  )
}

/** 记忆摘要清洗为一句偏好陈述：去掉主张标记、维基链接与换行，限长；不合规返回 null。 */
export function cleanWikiPreferenceStatement(summary: string): string | null {
  const text = summary
    .replace(/\[\^c:[^\]]*\]/g, '')
    .replace(/\[\[|\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || Array.from(text).length > PREFERENCE_MAX_CHARS) return null
  if (!sanitizeMemoryContent(text).ok || WIKI_PERSON_SENSITIVE_PATTERN.test(text)) return null
  return /[。！？.!?]$/.test(text) ? text : `${text}。`
}

export interface WikiPreferenceImportPlan {
  /** 成文后的完整正文；没有可导入的条目时为 null。 */
  body: string | null
  imported: string[]
  skipped: number
}

/**
 * 在当前正文的「偏好」章节追加偏好主张（kind:preference，来源为本人陈述）。
 * 不合规、已撤回（isRetracted）、页面已有与本批重复的说法跳过；键由陈述决定（同一说法同一键）。
 */
export function planWikiPreferenceImport(args: {
  baseSource: string
  summaries: readonly string[]
  userId: number
  /** 撤回墓碑判定（后端按指纹查）。 */
  isRetracted: (statement: string) => boolean
}): WikiPreferenceImportPlan {
  const parsed = parseWikiMarkdown(args.baseSource)
  if (!parsed.ok) throw new Error('基线正文无法解析')
  const seen = new Set(parsed.doc.claims.map((c) => normalizeWikiClaimStatement(c.statement)))
  const usedKeys = new Set(parsed.doc.claims.map((c) => c.key))
  const imported: string[] = []
  const lines: string[] = []
  const defs: string[] = []
  let skipped = 0
  for (const summary of args.summaries) {
    const statement = cleanWikiPreferenceStatement(summary)
    const normalized = statement ? normalizeWikiClaimStatement(statement) : ''
    if (!statement || seen.has(normalized) || args.isRetracted(statement)) {
      skipped++
      continue
    }
    seen.add(normalized)
    let key = `mem-${fnv1a32Hex(normalized)}`
    for (let n = 2; usedKeys.has(key); n++) key = `mem-${fnv1a32Hex(normalized)}-${n}`
    usedKeys.add(key)
    imported.push(statement)
    lines.push(`- ${statement}[^c:${key}]`)
    defs.push(`[^c:${key}]: user_statement#${args.userId} | kind:preference`)
  }
  if (imported.length === 0) return { body: null, imported, skipped }

  const src = args.baseSource.split('\n')
  const heading = `## ${WIKI_PERSON_PREFERENCES_HEADING}`
  let at = src.findIndex((l) => l.trim() === heading)
  if (at < 0) {
    src.push('', heading, '')
    at = src.length - 2
  }
  // 插在本章节最后一个非空的非定义行之后
  let insertAt = at + 1
  for (let i = at + 1; i < src.length; i++) {
    const l = src[i] ?? ''
    if (/^#{1,6}\s+/.test(l) || /^\s*\[\^c:[^\]]+\]:/.test(l)) break
    if (l.trim() !== '') insertAt = i + 1
  }
  src.splice(insertAt, 0, ...lines)
  const head = src.join('\n').replace(/\n+$/, '')
  const endsWithDef = /^\s*\[\^c:[^\]]+\]:/.test(head.split('\n').pop() ?? '')
  const body = `${head}${endsWithDef ? '\n' : '\n\n'}${defs.join('\n')}\n`.replace(
    /\n{3,}/g,
    '\n\n',
  )
  return { body, imported, skipped }
}

// ── 授权给我的个人页 ─────────────────────────────────────────────────────

export interface WikiSharedWithMeDto {
  page: WikiPageSummaryDto
  /** 页面所属成员的显示名。 */
  ownerName: string
  /** 调用者担任项目经理、且被授权的项目。 */
  projectIds: number[]
}
