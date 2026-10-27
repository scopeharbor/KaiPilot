/**
 * v3-llm-wiki-query-navigation —— 查阅共享契约：AI 同事维基工具输出、确定性上下文包、影子汇总与归档回答。
 *
 * 本文件为纯函数与 DTO，前后端共用：切词与打分（上下文包挑页）、章节提取（读某一节）、
 * 归档回答的清洗与成页（去掉伪造的主张标记与维基链接，正文永远可解析）。
 */
import {
  renderWikiMarkdown,
  truncateWikiSummary,
  type WikiClaimKind,
  type WikiPageType,
  type WikiScopeKind,
} from './llm-wiki-memory.js'

/** 每个维基工具结果附带的固定说明（实时数据优先）。 */
export const WIKI_QUERY_NOTICE =
  '维基内容是经审阅的经验与推断，不是项目证据；涉及日期、数字、状态时请用实时数据工具核对，冲突时以实时数据为准。'

export const WIKI_QUERY_INDEX_MAX_PAGES = 300
export const WIKI_QUERY_READ_MAX_CHARS = 8000
export const WIKI_QUERY_SEARCH_MAX = 20
export const WIKI_CONTEXT_PACK_DEFAULT_BYTES = 6000
export const WIKI_ANSWER_QUESTION_MAX = 1000
export const WIKI_ANSWER_TEXT_MAX = 12000
export const WIKI_ANSWER_TITLE_MAX = 80

// ── 工具输出 ─────────────────────────────────────────────────────────────

export interface WikiQueryPageRow {
  pageId: number
  slug: string
  title: string
  type: WikiPageType
  summary: string
}

export interface WikiQueryIndexDto {
  notice: string
  spaces: Array<{
    spaceId: number
    scopeKind: WikiScopeKind
    scopeRefId: number
    title: string
    pages: WikiQueryPageRow[]
  }>
  truncated: boolean
}

export interface WikiQueryClaim {
  key: string
  statement: string
  kind: WikiClaimKind
  sources: Array<{ kind: string; id: string; label: string }>
}

export interface WikiQueryReadDto {
  notice: string
  pageId: number
  spaceId: number
  scopeKind: WikiScopeKind
  scopeRefId: number
  title: string
  type: WikiPageType
  /** 页面是否有已发布版本（没有时 body 为空）。 */
  published: boolean
  section: string | null
  body: string
  truncated: boolean
  claims: WikiQueryClaim[]
  hasMaskedContent: boolean
  links: Array<{ slug: string; title: string }>
}

export interface WikiQuerySearchDto {
  notice: string
  results: Array<
    WikiQueryPageRow & { spaceId: number; scopeKind: WikiScopeKind; scopeRefId: number }
  >
}

/** 维基页面在新版界面中的地址（部门空间暂无独立页面时返回 null）。 */
export function wikiPageHref(
  scopeKind: WikiScopeKind,
  scopeRefId: number,
  pageId: number,
): string | null {
  if (scopeKind === 'organization') return `/next/wiki?page=${pageId}`
  if (scopeKind === 'project') return `/next/projects/${scopeRefId}/wiki?page=${pageId}`
  if (scopeKind === 'user') return `/next/me/wiki?page=${pageId}`
  return null
}

// ── 上下文包 ─────────────────────────────────────────────────────────────

export interface WikiContextPackPage {
  pageId: number
  spaceKind: WikiScopeKind
  title: string
  type: WikiPageType
  claims: Array<{ key: string; statement: string; kind: WikiClaimKind; sources: string[] }>
}

export interface WikiContextPackDto {
  pages: WikiContextPackPage[]
  bytes: number
  truncated: boolean
}

export interface WikiShadowSummaryDto {
  days: number
  turns: number
  turnsWithWiki: number
  avgClaims: number
  avgBytes: number
  truncatedTurns: number
}

// ── 切词与打分 ───────────────────────────────────────────────────────────

const CJK_RUN = /[㐀-鿿豈-﫿]+/g
const ASCII_WORD = /[a-z0-9]{2,}/g
const MAX_TERMS = 40

/** 问题切词：ASCII 词（≥2 字符）+ 中文二元组；去重保序，最多 40 个。 */
export function wikiQueryTerms(text: string): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []
  const seen = new Set<string>()
  const push = (t: string) => {
    if (out.length >= MAX_TERMS || seen.has(t)) return
    seen.add(t)
    out.push(t)
  }
  for (const word of lower.match(ASCII_WORD) ?? []) push(word)
  for (const run of lower.match(CJK_RUN) ?? []) {
    const chars = Array.from(run)
    for (let i = 0; i + 1 < chars.length; i++) push(chars[i]! + chars[i + 1]!)
  }
  return out
}

export interface WikiScoreInput {
  title: string
  summary: string
  headings: readonly string[]
  claims: readonly string[]
}

/** 页面与问题的确定性相关度：标题 ×3、摘要 ×2、小标题 ×2、主张 ×1（每个词每个字段只计一次）。 */
export function scoreWikiPageForQuery(
  terms: readonly string[],
  page: WikiScoreInput,
  opts: { projectBrief?: boolean } = {},
): number {
  if (terms.length === 0) return 0
  const title = page.title.toLowerCase()
  const summary = page.summary.toLowerCase()
  const headings = page.headings.join('\n').toLowerCase()
  const claims = page.claims.join('\n').toLowerCase()
  let score = 0
  for (const t of terms) {
    if (title.includes(t)) score += 3
    if (summary.includes(t)) score += 2
    if (headings.includes(t)) score += 2
    if (claims.includes(t)) score += 1
  }
  if (score > 0 && opts.projectBrief) score += 1
  return score
}

// ── 章节提取 ─────────────────────────────────────────────────────────────

const H_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/

/** 取出 `## heading` 一节（到下一个同级或更高级标题为止）；找不到返回 null。 */
export function extractWikiSection(body: string, heading: string): string | null {
  const want = heading.trim().replace(/^#+\s*/, '')
  if (!want) return null
  const lines = body.split('\n')
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = H_RE.exec(lines[i] ?? '')
    if (m && m[2]!.trim() === want) {
      start = i
      level = m[1]!.length
      break
    }
  }
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = H_RE.exec(lines[i] ?? '')
    if (m && m[1]!.length <= level) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n').trim()
}

// ── 归档回答 ─────────────────────────────────────────────────────────────

/** 去掉伪造的主张标记、脚注定义、维基链接与 HTML 注释（含派生段标记）。 */
export function sanitizeWikiAnswerText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !/^\s*\[\^[^\]]*\]:/.test(line))
    .join('\n')
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/\[\[|\]\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 归档回答页正文（frontmatter + 问题引用块 + 回答）。 */
export function buildWikiAnswerPage(input: {
  title: string
  question: string
  answer: string
}): string {
  const question = sanitizeWikiAnswerText(input.question)
  const answer = sanitizeWikiAnswerText(input.answer)
  const title = truncateWikiSummary(input.title, WIKI_ANSWER_TITLE_MAX) || '归档回答'
  const quoted = question
    .split('\n')
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n')
  return renderWikiMarkdown(
    { type: 'answer', title, summary: truncateWikiSummary(question) },
    `## 问题\n\n${quoted}\n\n## 回答\n\n${answer}\n`,
  )
}
