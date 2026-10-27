/**
 * v3-llm-wiki-memory-foundation —— 记忆维基共享契约：枚举、DTO、Markdown 编解码与确定性工具。
 *
 * 页面正文 = YAML frontmatter（仅扁平 key: value）+ Markdown。
 * - 主张：行内标记 `[^c:<key>]`，脚注定义 `[^c:<key>]: task#12, risk#3 | valid:2026-09-01.. | kind:rule`；
 * - 内部链接：`[[slug]]` 或 `[[slug|显示文字]]`；
 * - 确定性派生段：`<!-- derived:<generator-id> -->` … `<!-- /derived -->`。
 *
 * 本文件全部为纯函数，前后端共用（前端编辑器保存前校验、后端入库前校验、导出）。
 */

// ── 枚举 ────────────────────────────────────────────────────────────────

export const WIKI_SCOPE_KINDS = ['organization', 'department', 'project', 'user'] as const
export type WikiScopeKind = (typeof WIKI_SCOPE_KINDS)[number]

export const WIKI_PAGE_TYPES = [
  'index',
  'log',
  'overview',
  'entity',
  'concept',
  'process',
  'playbook',
  'reference-class',
  'lesson',
  'decision',
  'project-brief',
  'digest',
  'person',
  'answer',
] as const
export type WikiPageType = (typeof WIKI_PAGE_TYPES)[number]

/** 只有系统可写的页面类型（目录与操作日志）。 */
export const WIKI_SYSTEM_PAGE_TYPES: readonly WikiPageType[] = ['index', 'log']

export const WIKI_PAGE_TYPE_LABELS: Record<WikiPageType, string> = {
  index: '目录',
  log: '操作日志',
  overview: '概览',
  entity: '实体',
  concept: '概念与术语',
  process: '流程',
  playbook: '打法',
  'reference-class': '参照类',
  lesson: '教训',
  decision: '决策',
  'project-brief': '项目简报',
  digest: '周期摘要',
  person: '个人',
  answer: '归档回答',
}

export const WIKI_AUTHOR_KINDS = ['system', 'ai', 'human'] as const
export type WikiAuthorKind = (typeof WIKI_AUTHOR_KINDS)[number]

export const WIKI_EDIT_CLASSES = ['bookkeeping', 'knowledge'] as const
export type WikiEditClass = (typeof WIKI_EDIT_CLASSES)[number]

export const WIKI_REVISION_STATUSES = ['proposed', 'published', 'rejected', 'superseded'] as const
export type WikiRevisionStatus = (typeof WIKI_REVISION_STATUSES)[number]

export const WIKI_CLAIM_KINDS = ['derived', 'inference', 'preference', 'rule', 'decision'] as const
export type WikiClaimKind = (typeof WIKI_CLAIM_KINDS)[number]

export const WIKI_CLAIM_STATUSES = ['active', 'superseded', 'retracted'] as const
export type WikiClaimStatus = (typeof WIKI_CLAIM_STATUSES)[number]

export const WIKI_SOURCE_KINDS = [
  'task',
  'wbs_node',
  'milestone',
  'risk',
  'change_request',
  'comment',
  'document',
  'project',
  'knowledge_item',
  'wiki_page',
  'user_statement',
  'derived_query',
] as const
export type WikiSourceKind = (typeof WIKI_SOURCE_KINDS)[number]

export const WIKI_SOURCE_KIND_LABELS: Record<WikiSourceKind, string> = {
  task: '任务',
  wbs_node: 'WBS 节点',
  milestone: '里程碑',
  risk: '风险',
  change_request: '变更请求',
  comment: '评论',
  document: '文档',
  project: '项目',
  knowledge_item: '知识条目',
  wiki_page: '维基页面',
  user_statement: '本人陈述',
  derived_query: '确定性统计',
}

export const WIKI_LINT_FINDING_KINDS = [
  'broken_link',
  'orphan_page',
  'index_drift',
  'source_deleted',
  'stale_page',
  // v3-llm-wiki-lint-consolidation
  'retracted_claim',
  'contradiction',
] as const
export type WikiLintFindingKind = (typeof WIKI_LINT_FINDING_KINDS)[number]

/** 确定性体检产出的发现类型：只有这些会被「本轮未再出现即已解决」自动关闭。 */
export const WIKI_LINT_DETERMINISTIC_KINDS: readonly WikiLintFindingKind[] = [
  'broken_link',
  'orphan_page',
  'index_drift',
  'source_deleted',
  'stale_page',
  'retracted_claim',
]

export const WIKI_LINT_FINDING_STATUSES = ['open', 'fixed', 'dismissed'] as const
export type WikiLintFindingStatus = (typeof WIKI_LINT_FINDING_STATUSES)[number]

export const WIKI_LOG_OPS = [
  'publish',
  'reject',
  'rollback',
  'retract',
  'unretract',
  'lint',
  'export',
  'clear',
  'file_back',
] as const
export type WikiLogOp = (typeof WIKI_LOG_OPS)[number]

export const WIKI_SUMMARY_MAX_CHARS = 80
export const WIKI_MAX_CLAIMS_PER_PAGE = 300
export const WIKI_MAX_BODY_CHARS = 200_000
export const WIKI_MASKED_PLACEHOLDER = '（此条需更高权限）'
export const WIKI_SOURCE_DELETED_MARK = '（来源已删除）'
export const WIKI_DEFAULT_STALE_AFTER_DAYS = 90

// ── DTO ─────────────────────────────────────────────────────────────────

export interface WikiSettingsDto {
  enabled: boolean
  canManage: boolean
}

export interface WikiSpaceDto {
  id: number
  scopeKind: WikiScopeKind
  scopeRefId: number
  title: string
  canReview: boolean
  canPropose: boolean
  pageCount: number
  pendingProposalCount: number
}

export interface WikiPageSummaryDto {
  id: number
  spaceId: number
  slug: string
  title: string
  pageType: WikiPageType
  summaryLine: string
  status: 'active' | 'archived'
  publishedRevisionId: number | null
  hasPendingProposal: boolean
  updatedAt: string
}

export interface WikiSourceRefDto {
  kind: WikiSourceKind
  id: string
  version: string | null
  /** 读者可见时给出的低敏标签（如「任务 #12」）；不可见的主张整体遮蔽，不出现本对象。 */
  label: string
}

export interface WikiClaimDto {
  id: number
  claimKey: string
  statement: string
  claimKind: WikiClaimKind
  status: WikiClaimStatus
  validFrom: string | null
  validTo: string | null
  recordedAt: string
  supersededAt: string | null
  evidenceCount: number
  invalidReason: 'source_deleted' | null
  sources: WikiSourceRefDto[]
}

export interface WikiMaskedClaimDto {
  claimKey: string
  masked: true
}

export interface WikiPageViewDto {
  page: WikiPageSummaryDto
  revision: {
    id: number
    authorKind: WikiAuthorKind
    editClass: WikiEditClass
    createdAt: string
    reviewedAt: string | null
  } | null
  /** 已按读者权限遮蔽后的 Markdown 正文。 */
  body: string
  claims: Array<WikiClaimDto | WikiMaskedClaimDto>
  /** 是否存在被遮蔽内容（只给布尔值，不给条数与来源细节）。 */
  hasMaskedContent: boolean
  outgoingLinks: Array<{ slug: string; title: string | null; exists: boolean }>
  canReview: boolean
  canEdit: boolean
  sharedWithProjectIds: number[] | null
  asOf: string | null
}

export interface WikiRevisionDto {
  id: number
  pageId: number
  baseRevisionId: number | null
  authorKind: WikiAuthorKind
  authorUserId: number | null
  editClass: WikiEditClass
  status: WikiRevisionStatus
  changeSummary: string
  reviewedBy: number | null
  reviewedAt: string | null
  rejectReason: string | null
  createdAt: string
}

export interface WikiRevisionDetailDto extends WikiRevisionDto {
  body: string
  baseBody: string | null
  hasMaskedContent: boolean
}

export interface WikiReviewQueueItemDto {
  page: WikiPageSummaryDto
  proposals: WikiRevisionDto[]
}

export interface WikiLintFindingDto {
  id: number
  pageId: number | null
  findingKind: WikiLintFindingKind
  status: WikiLintFindingStatus
  detail: Record<string, string | number>
  createdAt: string
}

export interface WikiLogEntryDto {
  id: number
  op: WikiLogOp
  line: string
  createdAt: string
}

export interface WikiRetractionDto {
  id: number
  claimFingerprint: string
  reason: string
  createdAt: string
}

// ── Markdown 编解码 ──────────────────────────────────────────────────────

export type WikiFrontmatterValue = string | number | boolean
export type WikiFrontmatter = Record<string, WikiFrontmatterValue>

export interface WikiSourceRef {
  kind: WikiSourceKind
  id: string
  version: string | null
}

export interface WikiParsedClaim {
  key: string
  statement: string
  sources: WikiSourceRef[]
  validFrom: string | null
  validTo: string | null
  kind: WikiClaimKind
  derived: boolean
  generatorId: string | null
  /** 标记所在行（1 起，相对整份源文本）。 */
  line: number
}

export interface WikiParsedLink {
  slug: string
  text: string | null
  line: number
}

export interface WikiDerivedBlock {
  generatorId: string
  startLine: number
  endLine: number
  content: string
}

export interface WikiParsedDocument {
  frontmatter: WikiFrontmatter
  /** 去掉 frontmatter 后的正文。 */
  body: string
  /** 正文首行在源文本中的行号（1 起）。 */
  bodyStartLine: number
  headings: string[]
  claims: WikiParsedClaim[]
  links: WikiParsedLink[]
  derivedBlocks: WikiDerivedBlock[]
}

export interface WikiParseError {
  line: number
  message: string
}

export type WikiParseResult =
  { ok: true; doc: WikiParsedDocument } | { ok: false; errors: WikiParseError[] }

const FRONTMATTER_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const CLAIM_KEY_SRC = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}'
const CLAIM_DEF_RE = new RegExp(`^\\[\\^c:(${CLAIM_KEY_SRC})\\]:\\s*(.*)$`)
const CLAIM_MARKER_RE = new RegExp(`\\[\\^c:(${CLAIM_KEY_SRC})\\](?!:)`, 'g')
const SOURCE_TOKEN_RE = /^([a-z_]+)#([A-Za-z0-9._:-]{1,128})(?:@([A-Za-z0-9._:-]{1,64}))?$/
const LINK_RE = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g
const SLUG_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,99}$/u
const DERIVED_START_RE = /^<!--\s*derived:([a-z0-9][a-z0-9._-]{0,63})\s*-->$/
const DERIVED_END_RE = /^<!--\s*\/derived\s*-->$/
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const LIST_PREFIX_RE = /^\s*(?:[-*+]|\d+[.)])\s+/
const FENCE_RE = /^\s*(```|~~~)/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidWikiSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

export function isWikiSourceKind(kind: string): kind is WikiSourceKind {
  return (WIKI_SOURCE_KINDS as readonly string[]).includes(kind)
}

export function isWikiPageType(t: string): t is WikiPageType {
  return (WIKI_PAGE_TYPES as readonly string[]).includes(t)
}

function parseFrontmatterValue(raw: string): WikiFrontmatterValue {
  const v = raw.trim()
  if (v.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(v)
      if (typeof parsed === 'string') return parsed
    } catch {
      // 落到原样字符串
    }
    return v
  }
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v)
  return v
}

function splitFrontmatter(
  source: string,
): { frontmatterLines: string[]; bodyLines: string[]; bodyStartLine: number } | WikiParseError {
  const lines = source.split(/\r?\n/)
  if (lines[0] !== '---') return { frontmatterLines: [], bodyLines: lines, bodyStartLine: 1 }
  const end = lines.indexOf('---', 1)
  if (end < 0) return { line: 1, message: 'frontmatter 未闭合：缺少结束的 ---' }
  return {
    frontmatterLines: lines.slice(1, end),
    bodyLines: lines.slice(end + 1),
    bodyStartLine: end + 2,
  }
}

function parseSourceList(raw: string, line: number, errors: WikiParseError[]): WikiSourceRef[] {
  const out: WikiSourceRef[] = []
  for (const token of raw.split(',').map((t) => t.trim())) {
    if (!token) continue
    const m = SOURCE_TOKEN_RE.exec(token)
    const kind = m?.[1] ?? ''
    if (!m || !isWikiSourceKind(kind)) {
      errors.push({ line, message: `无法识别的来源「${token}」，格式应为 类型#ID，如 task#12` })
      continue
    }
    out.push({ kind, id: m[2] ?? '', version: m[3] ?? null })
  }
  return out
}

interface ClaimDefinition {
  sources: WikiSourceRef[]
  validFrom: string | null
  validTo: string | null
  kind: WikiClaimKind | null
  line: number
}

function parseClaimDefinition(content: string, line: number, errors: WikiParseError[]) {
  const [sourcePart, ...options] = content.split('|').map((p) => p.trim())
  const def: ClaimDefinition = {
    sources: parseSourceList(sourcePart ?? '', line, errors),
    validFrom: null,
    validTo: null,
    kind: null,
    line,
  }
  if (def.sources.length === 0) errors.push({ line, message: '主张至少需要一条来源引用' })
  for (const opt of options) {
    if (opt.startsWith('valid:')) {
      const [from, to] = opt.slice('valid:'.length).split('..')
      if (from && !DATE_RE.test(from))
        errors.push({ line, message: `有效期起点「${from}」不是 YYYY-MM-DD` })
      if (to && !DATE_RE.test(to))
        errors.push({ line, message: `有效期终点「${to}」不是 YYYY-MM-DD` })
      def.validFrom = from || null
      def.validTo = to || null
    } else if (opt.startsWith('kind:')) {
      const kind = opt.slice('kind:'.length)
      if (kind === 'derived' || !(WIKI_CLAIM_KINDS as readonly string[]).includes(kind)) {
        errors.push({ line, message: `主张类型「${kind}」不可用` })
      } else {
        def.kind = kind as WikiClaimKind
      }
    } else if (opt) {
      errors.push({ line, message: `无法识别的主张选项「${opt}」` })
    }
  }
  return def
}

/** 把一行正文还原为主张陈述（去掉标记、列表前缀、引用与标题符号）。 */
export function wikiStatementFromLine(line: string): string {
  return line
    .replace(CLAIM_MARKER_RE, '')
    .replace(LIST_PREFIX_RE, '')
    .replace(/^\s*>+\s*/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(LINK_RE, (_m, slug: string, text?: string) => (text ?? slug).trim())
    .replace(/\s+/g, ' ')
    .trim()
}

/** 解析维基 Markdown；全部错误一次性返回（含行号），便于编辑器定位。 */
export function parseWikiMarkdown(source: string): WikiParseResult {
  const errors: WikiParseError[] = []
  if (source.length > WIKI_MAX_BODY_CHARS) {
    return { ok: false, errors: [{ line: 1, message: `正文超过 ${WIKI_MAX_BODY_CHARS} 字上限` }] }
  }
  const split = splitFrontmatter(source)
  if ('message' in split) return { ok: false, errors: [split] }

  const frontmatter: WikiFrontmatter = {}
  split.frontmatterLines.forEach((raw, i) => {
    const line = i + 2
    if (!raw.trim() || raw.trim().startsWith('#')) return
    const idx = raw.indexOf(':')
    const key = idx > 0 ? raw.slice(0, idx).trim() : ''
    if (!FRONTMATTER_KEY.test(key)) {
      errors.push({ line, message: `frontmatter 行无法解析：「${raw}」` })
      return
    }
    if (key in frontmatter) errors.push({ line, message: `frontmatter 键「${key}」重复` })
    frontmatter[key] = parseFrontmatterValue(raw.slice(idx + 1))
  })

  const headings: string[] = []
  const links: WikiParsedLink[] = []
  const derivedBlocks: WikiDerivedBlock[] = []
  const definitions = new Map<string, ClaimDefinition>()
  const markers = new Map<
    string,
    { line: number; statement: string; derived: boolean; generatorId: string | null }
  >()

  let inFence = false
  let openBlock: { generatorId: string; startLine: number; content: string[] } | null = null

  split.bodyLines.forEach((raw, i) => {
    const line = split.bodyStartLine + i
    if (FENCE_RE.test(raw)) {
      inFence = !inFence
      if (openBlock) openBlock.content.push(raw)
      return
    }
    if (inFence) {
      if (openBlock) openBlock.content.push(raw)
      return
    }
    const trimmed = raw.trim()
    const start = DERIVED_START_RE.exec(trimmed)
    if (start) {
      if (openBlock) errors.push({ line, message: '派生段不能嵌套' })
      else openBlock = { generatorId: start[1] ?? '', startLine: line, content: [] }
      return
    }
    if (DERIVED_END_RE.test(trimmed)) {
      if (!openBlock) errors.push({ line, message: '派生段结束标记没有对应的开始标记' })
      else {
        derivedBlocks.push({
          generatorId: openBlock.generatorId,
          startLine: openBlock.startLine,
          endLine: line,
          content: openBlock.content.join('\n'),
        })
        openBlock = null
      }
      return
    }
    if (openBlock) openBlock.content.push(raw)

    const def = CLAIM_DEF_RE.exec(trimmed)
    if (def) {
      const defKey = def[1] ?? ''
      if (definitions.has(defKey)) errors.push({ line, message: `主张「${defKey}」的脚注定义重复` })
      else definitions.set(defKey, parseClaimDefinition(def[2] ?? '', line, errors))
      return
    }

    const heading = HEADING_RE.exec(trimmed)
    if (heading) headings.push(wikiStatementFromLine(heading[2] ?? ''))

    for (const m of raw.matchAll(LINK_RE)) {
      const slug = (m[1] ?? '').trim()
      if (!isValidWikiSlug(slug))
        errors.push({ line, message: `链接目标「${slug}」不是合法的页面标识` })
      else links.push({ slug, text: m[2]?.trim() ?? null, line })
    }

    const keysOnLine = [...raw.matchAll(CLAIM_MARKER_RE)].map((m) => m[1] ?? '')
    if (keysOnLine.length === 0) return
    const statement = wikiStatementFromLine(raw)
    if (!statement) errors.push({ line, message: '主张标记所在行没有陈述文字' })
    for (const key of keysOnLine) {
      if (markers.has(key)) {
        errors.push({ line, message: `主张「${key}」在多处被引用，每个主张只能出现一次` })
        continue
      }
      markers.set(key, {
        line,
        statement,
        derived: openBlock !== null,
        generatorId: openBlock?.generatorId ?? null,
      })
    }
  })

  if (inFence)
    errors.push({ line: split.bodyStartLine + split.bodyLines.length - 1, message: '代码块未闭合' })
  if (openBlock) {
    const block = openBlock as { startLine: number }
    errors.push({ line: block.startLine, message: '派生段未闭合：缺少 <!-- /derived -->' })
  }

  const claims: WikiParsedClaim[] = []
  for (const [key, marker] of markers) {
    const def = definitions.get(key)
    if (!def) {
      errors.push({ line: marker.line, message: `主张「${key}」缺少脚注定义（来源）` })
      continue
    }
    claims.push({
      key,
      statement: marker.statement,
      sources: def.sources,
      validFrom: def.validFrom,
      validTo: def.validTo,
      kind: marker.derived ? 'derived' : (def.kind ?? 'inference'),
      derived: marker.derived,
      generatorId: marker.generatorId,
      line: marker.line,
    })
  }
  for (const [key, def] of definitions) {
    if (!markers.has(key))
      errors.push({ line: def.line, message: `脚注「${key}」没有在正文中被引用` })
  }
  if (claims.length > WIKI_MAX_CLAIMS_PER_PAGE) {
    errors.push({ line: 1, message: `单页主张不能超过 ${WIKI_MAX_CLAIMS_PER_PAGE} 条` })
  }

  if (errors.length > 0) {
    errors.sort((a, b) => a.line - b.line)
    return { ok: false, errors }
  }
  claims.sort((a, b) => a.line - b.line)
  return {
    ok: true,
    doc: {
      frontmatter,
      body: split.bodyLines.join('\n'),
      bodyStartLine: split.bodyStartLine,
      headings,
      claims,
      links,
      derivedBlocks,
    },
  }
}

const FRONTMATTER_KEY_ORDER = ['type', 'title', 'summary']

function renderFrontmatterValue(v: WikiFrontmatterValue): string {
  if (typeof v !== 'string') return String(v)
  if (v === '' || /^[\s"'#]|[:#]|\s$/.test(v) || /^(true|false|-?\d+(\.\d+)?)$/.test(v)) {
    return JSON.stringify(v)
  }
  return v
}

/** 按固定键顺序生成 frontmatter + 正文；parse(render(x)) 与 x 等价。 */
export function renderWikiMarkdown(frontmatter: WikiFrontmatter, body: string): string {
  const keys = Object.keys(frontmatter).sort((a, b) => {
    const ia = FRONTMATTER_KEY_ORDER.indexOf(a)
    const ib = FRONTMATTER_KEY_ORDER.indexOf(b)
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    return a < b ? -1 : a > b ? 1 : 0
  })
  if (keys.length === 0) return body
  const head = keys.map((k) => `${k}: ${renderFrontmatterValue(frontmatter[k] ?? '')}`)
  return ['---', ...head, '---', body].join('\n')
}

// ── 确定性工具 ───────────────────────────────────────────────────────────

/** 截断到指定字符数（按 Unicode 码点计）。 */
export function truncateWikiSummary(text: string, max = WIKI_SUMMARY_MAX_CHARS): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`
}

/** 主张撤回指纹的规范化：全半角统一、去空白与标点、小写；数字与文字保留。 */
export function normalizeWikiClaimStatement(statement: string): string {
  return statement
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** 正文去掉派生段、脚注定义与格式符号后的「语义文本」，用于判定修订类别。 */
export function wikiSemanticText(doc: WikiParsedDocument): string {
  const derivedRanges = doc.derivedBlocks.map((b) => [b.startLine, b.endLine] as const)
  return doc.body
    .split('\n')
    .map((raw, i) => ({ raw, line: doc.bodyStartLine + i }))
    .filter(({ line }) => !derivedRanges.some(([s, e]) => line >= s && line <= e))
    .filter(({ raw }) => !CLAIM_DEF_RE.test(raw.trim()))
    .map(({ raw }) =>
      raw
        .replace(LINK_RE, (_m, slug: string, text?: string) => (text ?? slug).trim())
        .replace(CLAIM_MARKER_RE, '')
        .replace(LIST_PREFIX_RE, '')
        .replace(/[#*_`>~]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
}

function canonicalClaim(c: WikiParsedClaim): string {
  const sources = c.sources
    .map((s) => `${s.kind}#${s.id}@${s.version ?? ''}`)
    .sort()
    .join(',')
  return [c.statement, sources, c.validFrom ?? '', c.validTo ?? '', c.kind].join('\u0001')
}

export interface WikiClassifyContext {
  authorKind: WikiAuthorKind
  /** 已登记的确定性派生生成器 ID。 */
  registeredGenerators: ReadonlySet<string>
  /** 目录等系统页由系统整页生成。 */
  systemPage?: boolean
}

/**
 * 纯派生页：至少一个派生段且生成器都已登记；全部主张都在派生段内；
 * 派生段之外的非空行只能是标题或脚注定义（不含任何人写或 AI 写的正文）。
 */
export function isWikiPurelyDerivedDocument(
  doc: WikiParsedDocument,
  registeredGenerators: ReadonlySet<string>,
): boolean {
  if (doc.derivedBlocks.length === 0) return false
  if (!doc.derivedBlocks.every((b) => registeredGenerators.has(b.generatorId))) return false
  if (!doc.claims.every((c) => c.derived)) return false
  const ranges = doc.derivedBlocks.map((b) => [b.startLine, b.endLine] as const)
  return doc.body.split('\n').every((raw, i) => {
    const line = doc.bodyStartLine + i
    if (ranges.some(([s, e]) => line >= s && line <= e)) return true
    const t = raw.trim()
    return t === '' || /^#{1,6}\s+\S/.test(t) || CLAIM_DEF_RE.test(t)
  })
}

/**
 * 服务端判定修订类别（调用方声明不可信）。
 * 只有「推断主张与语义文本都不变」或「仅系统程序改了已登记生成器的派生段」才是簿记修改。
 */
export function classifyWikiRevision(
  base: WikiParsedDocument | null,
  next: WikiParsedDocument,
  ctx: WikiClassifyContext,
): WikiEditClass {
  if (ctx.systemPage) return ctx.authorKind === 'system' ? 'bookkeeping' : 'knowledge'
  // 新建页：只有系统作者新建的纯派生页（统计段全由已登记生成器产出）才是簿记（v3-llm-wiki-planning-dossier）
  if (!base)
    return ctx.authorKind === 'system' &&
      isWikiPurelyDerivedDocument(next, ctx.registeredGenerators)
      ? 'bookkeeping'
      : 'knowledge'
  for (const key of ['type', 'title', 'summary']) {
    if (base.frontmatter[key] !== next.frontmatter[key]) return 'knowledge'
  }
  const baseClaims = new Map(
    base.claims.filter((c) => !c.derived).map((c) => [c.key, canonicalClaim(c)]),
  )
  const nextClaims = new Map(
    next.claims.filter((c) => !c.derived).map((c) => [c.key, canonicalClaim(c)]),
  )
  if (baseClaims.size !== nextClaims.size) return 'knowledge'
  for (const [key, value] of nextClaims) {
    if (baseClaims.get(key) !== value) return 'knowledge'
  }
  if (wikiSemanticText(base) !== wikiSemanticText(next)) return 'knowledge'

  const baseBlocks = base.derivedBlocks.map((b) => `${b.generatorId}\u0001${b.content}`)
  const nextBlocks = next.derivedBlocks.map((b) => `${b.generatorId}\u0001${b.content}`)
  const sameBlocks =
    baseBlocks.length === nextBlocks.length && baseBlocks.every((b, i) => b === nextBlocks[i])
  if (sameBlocks) return 'bookkeeping'
  const sameGenerators =
    base.derivedBlocks.map((b) => b.generatorId).join(',') ===
    next.derivedBlocks.map((b) => b.generatorId).join(',')
  if (
    ctx.authorKind === 'system' &&
    sameGenerators &&
    next.derivedBlocks.every((b) => ctx.registeredGenerators.has(b.generatorId))
  ) {
    return 'bookkeeping'
  }
  return 'knowledge'
}

function claimKeysOnLine(raw: string): string[] {
  return [...raw.matchAll(CLAIM_MARKER_RE)].map((m) => m[1] ?? '')
}

/**
 * 按读者权限遮蔽：含被遮蔽主张的行整体替换为占位，其脚注定义删除。
 * 只依赖主张 key，不暴露来源细节。
 */
export function maskWikiBody(body: string, maskedKeys: ReadonlySet<string>): string {
  if (maskedKeys.size === 0) return body
  const out: string[] = []
  for (const raw of body.split('\n')) {
    const def = CLAIM_DEF_RE.exec(raw.trim())
    if (def && maskedKeys.has(def[1] ?? '')) continue
    if (claimKeysOnLine(raw).some((k) => maskedKeys.has(k))) {
      const prefix = /^(\s*(?:[-*+]|\d+[.)])\s+|\s*>+\s*)?/.exec(raw)?.[0] ?? ''
      out.push(`${prefix}${WIKI_MASKED_PLACEHOLDER}`)
      continue
    }
    out.push(raw)
  }
  return out.join('\n')
}

/** 从源文本中删去一条主张（标记所在行与脚注定义），用于撤回后的级联修订提议。 */
export function removeWikiClaim(source: string, key: string): string {
  return source
    .split('\n')
    .filter((raw) => {
      const def = CLAIM_DEF_RE.exec(raw.trim())
      if (def && def[1] === key) return false
      return !claimKeysOnLine(raw).includes(key)
    })
    .join('\n')
}

/** 把指向不存在页面的链接改为纯文字（断链清理；语义文本不变，属簿记修改）。 */
export function unlinkWikiSlugs(source: string, missing: ReadonlySet<string>): string {
  return source.replace(LINK_RE, (m, slug: string, text?: string) =>
    missing.has(slug.trim()) ? (text ?? slug).trim() : m,
  )
}

export interface WikiIndexEntry {
  slug: string
  title: string
  summaryLine: string
  pageType: WikiPageType
}

/** 确定性目录：按页面类型固定顺序分组，组内按标题码位排序，每页一行 ≤80 字摘要。 */
export function renderWikiIndex(entries: readonly WikiIndexEntry[]): string {
  const lines: string[] = ['# 目录', '']
  const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  for (const type of WIKI_PAGE_TYPES) {
    if (WIKI_SYSTEM_PAGE_TYPES.includes(type)) continue
    const group = entries
      .filter((e) => e.pageType === type)
      .sort((a, b) => byCode(a.title, b.title) || byCode(a.slug, b.slug))
    if (group.length === 0) continue
    lines.push(`## ${WIKI_PAGE_TYPE_LABELS[type]}`, '')
    for (const e of group) {
      const summary = truncateWikiSummary(e.summaryLine)
      lines.push(
        `- [[${e.slug}|${e.title.replace(/[[\]|]/g, ' ')}]]${summary ? ` — ${summary}` : ''}`,
      )
    }
    lines.push('')
  }
  if (lines.length === 2) lines.push('（暂无页面）', '')
  return lines.join('\n').replace(/\n+$/, '\n')
}

const LOG_OP_LABELS: Record<WikiLogOp, string> = {
  publish: 'publish',
  reject: 'reject',
  rollback: 'rollback',
  retract: 'retract',
  unretract: 'unretract',
  lint: 'lint',
  export: 'export',
  clear: 'clear',
  file_back: 'file-back',
}

/** 操作日志行（与 Karpathy 约定一致，统一前缀便于检索）。 */
export function renderWikiLogLine(date: Date, op: WikiLogOp, summary: string): string {
  const day = date.toISOString().slice(0, 10)
  return `## [${day}] ${LOG_OP_LABELS[op]} | ${summary.replace(/\s+/g, ' ').trim()}`
}

// ── 页面模板 ─────────────────────────────────────────────────────────────

export const WIKI_PAGE_TEMPLATES: Partial<Record<WikiPageType, string>> = {
  overview: [
    '---',
    'type: overview',
    'title: 概览',
    'summary: 一句话说明这是什么、为什么重要',
    '---',
    '## 我们做什么',
    '',
    '## 现状',
    '',
    '## 关键链接',
    '',
  ].join('\n'),
  concept: [
    '---',
    'type: concept',
    'title: 术语名称',
    'summary: 这个词在本组织的含义',
    '---',
    '## 定义',
    '',
    '## 在本组织怎么用',
    '',
    '## 容易混淆的说法',
    '',
  ].join('\n'),
  process: [
    '---',
    'type: process',
    'title: 流程名称',
    'summary: 这个流程解决什么问题',
    '---',
    '## 声明的流程（制度怎么写）',
    '',
    '## 实际的流程（数据怎么说）',
    '',
    '## 差异与解读',
    '',
  ].join('\n'),
  decision: [
    '---',
    'type: decision',
    'title: 决策标题',
    'summary: 一句话说明决定了什么',
    '---',
    '## 背景',
    '',
    '## 选项',
    '',
    '## 决定',
    '',
    '## 后果',
    '',
    '## 状态',
    '',
  ].join('\n'),
  'project-brief': [
    '---',
    'type: project-brief',
    'title: 项目简报',
    'summary: 新成员 5 分钟读懂本项目',
    '---',
    '## 目标与范围',
    '',
    '## 关键决策',
    '',
    '## 当前风险',
    '',
    '## 有问题找谁',
    '',
  ].join('\n'),
}
