/**
 * v3-llm-wiki-ingest-pipeline —— 编入流程共享契约：主张级操作、章节白名单、确定性成文、反幻觉校验、运行记录 DTO。
 *
 * 模型只能返回主张级操作；正文由 applyWikiClaimOps 确定性生成（格式永远可解析），
 * 每个操作先经 validateWikiIngestOp 校验（来源白名单、数字溯源、注入防护、禁止类别、长度、目标存在）。
 * 本文件为纯函数，前后端共用。
 */
import { sanitizeMemoryContent } from './copilot-memory.js'
import {
  parseWikiMarkdown,
  removeWikiClaim,
  renderWikiMarkdown,
  type WikiPageType,
} from './llm-wiki-memory.js'

// ── 操作 ────────────────────────────────────────────────────────────────

export const WIKI_INGEST_OP_KINDS = ['inference', 'rule', 'decision'] as const
export type WikiIngestOpKind = (typeof WIKI_INGEST_OP_KINDS)[number]

export type WikiIngestOp =
  | {
      op: 'add'
      section: string
      statement: string
      sources: string[]
      kind?: WikiIngestOpKind
    }
  | {
      op: 'update'
      claimKey: string
      statement: string
      sources: string[]
      kind?: WikiIngestOpKind
    }
  | { op: 'retire'; claimKey: string }

export const WIKI_INGEST_MAX_OPS_PER_PAGE = 12
export const WIKI_INGEST_MAX_STATEMENT_CHARS = 200
export const WIKI_INGEST_MAX_EVENTS = 50
export const WIKI_INGEST_MAX_PAGES = 8

/** 各页面类型允许 AI 写入的章节。 */
export const WIKI_INGEST_SECTIONS: Partial<Record<WikiPageType, readonly string[]>> = {
  'project-brief': ['目标与范围', '关键决策', '当前风险', '近期进展'],
  digest: ['本周进展', '风险与问题', '决策与变更', '下周关注'],
  lesson: ['教训', '背景', '应对'],
  decision: ['背景', '决定', '后果', '状态'],
  process: ['实际的流程（数据怎么说）', '差异与解读'],
  concept: ['在本组织怎么用'],
  entity: ['现状', '关系'],
  overview: ['现状'],
}

export function wikiIngestSectionsFor(pageType: WikiPageType): readonly string[] {
  return WIKI_INGEST_SECTIONS[pageType] ?? ['近期进展']
}

// ── 运行记录 DTO ─────────────────────────────────────────────────────────

export const WIKI_INGEST_RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'no_events',
  'budget_exhausted',
  'model_unavailable',
  'failed',
] as const
export type WikiIngestRunStatus = (typeof WIKI_INGEST_RUN_STATUSES)[number]

export const WIKI_INGEST_RUN_STATUS_LABELS: Record<WikiIngestRunStatus, string> = {
  queued: '排队中',
  running: '编入中',
  succeeded: '已完成',
  no_events: '没有新动态',
  budget_exhausted: '今日编入预算已用完',
  model_unavailable: '没有可用的 AI 连接',
  failed: '失败',
}

/** 运行类别：项目编入 / 流程页 AI 解读（v3-llm-wiki-process-reality）。 */
export const WIKI_RUN_KINDS = [
  'ingest',
  'process_interpret',
  'contradiction_check',
  'retrospective_lessons',
  'answer_eval',
] as const
export type WikiRunKind = (typeof WIKI_RUN_KINDS)[number]

export interface WikiIngestRunDto {
  id: number
  spaceId: number
  runKind: WikiRunKind
  triggerKind: 'manual' | 'command'
  status: WikiIngestRunStatus
  eventsCount: number
  pagesTouched: number
  proposalsCreated: number
  opsAccepted: number
  opsRejected: number
  pagesFailed: number
  hasMore: boolean
  tokensUsed: number
  modelName: string | null
  errorCode: string | null
  createdAt: string
  finishedAt: string | null
}

// ── 确定性工具 ───────────────────────────────────────────────────────────

/** FNV-1a 32 位，前后端一致、无依赖。 */
export function fnv1a32Hex(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** ISO 8601 周（周一为一周开始）。 */
export function isoWeekOf(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

/** AI 自动建页的初始正文（无主张，只有章节骨架）。 */
export function wikiIngestPageSkeleton(
  pageType: WikiPageType,
  title: string,
  summary: string,
): string {
  const sections = wikiIngestSectionsFor(pageType)
  return renderWikiMarkdown(
    { type: pageType, title, summary },
    sections.flatMap((s) => [`## ${s}`, '']).join('\n'),
  )
}

const CLAIM_DEF_LINE = /^\s*\[\^c:([A-Za-z0-9][A-Za-z0-9._-]{0,63})\]:/
const HEADING_LINE = /^#{1,6}\s+/
const LIST_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+)/

function definitionLine(
  key: string,
  sources: string[],
  kind: WikiIngestOpKind | undefined,
): string {
  return `[^c:${key}]: ${sources.join(', ')} | kind:${kind ?? 'inference'}`
}

function cleanStatement(statement: string): string {
  return statement
    .replace(/\s+/g, ' ')
    .replace(/\[\^c:[^\]]*\]/g, '')
    .replace(/\[\[|\]\]/g, '')
    .trim()
}

/**
 * 把操作确定性地写成正文。新增：在章节末尾插入一行并在文末追加脚注（章节不存在则在脚注前追加）；
 * 修改：替换该主张所在行与脚注；作废：删除该主张。结果必须能被 parseWikiMarkdown 解析，否则抛错。
 */
export function applyWikiClaimOps(
  source: string,
  ops: readonly WikiIngestOp[],
): { source: string; applied: number } {
  let lines = source.split('\n')
  let applied = 0
  const usedKeys = new Set<string>()
  const parsed = parseWikiMarkdown(source)
  if (!parsed.ok) throw new Error('基线正文无法解析')
  for (const c of parsed.doc.claims) usedKeys.add(c.key)

  const trailingDefStart = () => {
    let i = lines.length
    while (i > 0) {
      const l = lines[i - 1] ?? ''
      if (l.trim() === '' || CLAIM_DEF_LINE.test(l)) i--
      else break
    }
    return i
  }

  for (const op of ops) {
    if (op.op === 'retire') {
      const next = removeWikiClaim(lines.join('\n'), op.claimKey)
      if (next !== lines.join('\n')) applied++
      lines = next.split('\n')
      continue
    }
    const statement = cleanStatement(op.statement)
    if (op.op === 'update') {
      const marker = `[^c:${op.claimKey}]`
      const idx = lines.findIndex((l) => l.includes(marker) && !CLAIM_DEF_LINE.test(l))
      const defIdx = lines.findIndex((l) => CLAIM_DEF_LINE.exec(l)?.[1] === op.claimKey)
      if (idx < 0 || defIdx < 0) continue
      const prefix = LIST_PREFIX.exec(lines[idx] ?? '')?.[1] ?? '- '
      lines[idx] = `${prefix}${statement}${marker}`
      lines[defIdx] = definitionLine(op.claimKey, op.sources, op.kind)
      applied++
      continue
    }
    // add
    let key = `ai-${fnv1a32Hex(statement)}`
    for (let n = 2; usedKeys.has(key); n++) key = `ai-${fnv1a32Hex(statement)}-${n}`
    usedKeys.add(key)
    const heading = `## ${op.section}`
    let sectionIdx = lines.findIndex((l) => l.trim() === heading)
    if (sectionIdx < 0) {
      const at = trailingDefStart()
      lines.splice(
        at,
        0,
        ...(at > 0 && (lines[at - 1] ?? '').trim() !== '' ? [''] : []),
        heading,
        '',
      )
      sectionIdx = lines.findIndex((l) => l.trim() === heading)
    }
    const defStart = trailingDefStart()
    let end = sectionIdx + 1
    while (end < lines.length && end < defStart && !HEADING_LINE.test(lines[end] ?? '')) end++
    let insertAt = sectionIdx + 1
    for (let i = sectionIdx + 1; i < end; i++) if ((lines[i] ?? '').trim() !== '') insertAt = i + 1
    lines.splice(insertAt, 0, `- ${statement}[^c:${key}]`)
    const tail = lines.join('\n').replace(/\n+$/, '')
    lines = tail.split('\n')
    if (!CLAIM_DEF_LINE.test(lines[lines.length - 1] ?? '')) lines.push('')
    lines.push(definitionLine(key, op.sources, op.kind))
    applied++
  }

  const result = lines.join('\n').replace(/\n{3,}/g, '\n\n')
  const check = parseWikiMarkdown(result)
  if (!check.ok) throw new Error(`成文后无法解析：${check.errors[0]?.message ?? ''}`)
  return { source: result, applied }
}

// ── 校验 ────────────────────────────────────────────────────────────────

export const WIKI_INGEST_REJECT_REASONS = [
  'no_sources',
  'unknown_source',
  'number_not_in_evidence',
  'instruction_like',
  'forbidden_content',
  'length',
  'unknown_claim',
  'bad_section',
] as const
export type WikiIngestRejectReason = (typeof WIKI_INGEST_REJECT_REASONS)[number]

const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /忽略|无视|不要理会|绕过/,
  /你现在是|扮演|假装你|作为一个?\s*(ai|AI|助手|模型)/,
  /system\s*prompt|系统提示/i,
  /调用(工具|函数|接口)|执行(以下|命令|脚本)/,
  /ignore\s+(all|any|previous|the above)|disregard|jailbreak|you are now/i,
  /(自动|直接)(发布|确认|批准|删除)/,
]

/** 是否像是写给模型的指令（编入、解读与矛盾体检共用）。 */
export function isWikiInstructionLike(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((re) => re.test(text))
}

export interface WikiIngestValidationContext {
  /** 本次原料：来源 key（kind#id）→ 原料文本（摘要 + 对象名 + 日期）。 */
  evidenceByRef: ReadonlyMap<string, string>
  /** 当前页面已有主张 key。 */
  existingClaimKeys: ReadonlySet<string>
  /** 该页面类型允许写入的章节。 */
  allowedSections: readonly string[]
}

export function validateWikiIngestOp(
  op: WikiIngestOp,
  ctx: WikiIngestValidationContext,
): { ok: true } | { ok: false; reason: WikiIngestRejectReason } {
  if (op.op === 'retire') {
    return ctx.existingClaimKeys.has(op.claimKey)
      ? { ok: true }
      : { ok: false, reason: 'unknown_claim' }
  }
  if (op.op === 'update' && !ctx.existingClaimKeys.has(op.claimKey))
    return { ok: false, reason: 'unknown_claim' }
  if (op.op === 'add' && !ctx.allowedSections.includes(op.section))
    return { ok: false, reason: 'bad_section' }
  const statement = cleanStatement(op.statement)
  const length = Array.from(statement).length
  if (length < 1 || length > WIKI_INGEST_MAX_STATEMENT_CHARS) return { ok: false, reason: 'length' }
  const sources = [...new Set(op.sources)]
  if (sources.length === 0) return { ok: false, reason: 'no_sources' }
  if (sources.some((s) => !ctx.evidenceByRef.has(s))) return { ok: false, reason: 'unknown_source' }
  if (isWikiInstructionLike(statement)) return { ok: false, reason: 'instruction_like' }
  if (!sanitizeMemoryContent(statement).ok) return { ok: false, reason: 'forbidden_content' }
  const evidence = sources.map((s) => ctx.evidenceByRef.get(s) ?? '').join('\n')
  for (const n of statement.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!evidence.includes(n)) return { ok: false, reason: 'number_not_in_evidence' }
  }
  return { ok: true }
}
