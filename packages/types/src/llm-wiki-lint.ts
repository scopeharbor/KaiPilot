/**
 * v3-llm-wiki-lint-consolidation —— AI 矛盾体检的输出解析与确定性校验。
 *
 * 模型只能报告「两条送检主张互相矛盾 + 一句理由」；任何偏差都在这里拦下，结果只写成体检发现、不改页面。
 */
import { sanitizeMemoryContent } from './copilot-memory.js'
import { isWikiInstructionLike } from './llm-wiki-ingest.js'

/** 一次最多送检的主张数。 */
export const WIKI_CONTRADICTION_MAX_CLAIMS = 150
/** 一次最多记录的矛盾数（多出的计为拦下）。 */
export const WIKI_CONTRADICTION_MAX_RESULTS = 10
export const WIKI_CONTRADICTION_REASON_MAX_CHARS = 120
/** 发现详情里保存的陈述截断长度。 */
export const WIKI_CONTRADICTION_STATEMENT_MAX_CHARS = 200

/** 送检主张的引用：`c<主张 id>`。 */
export const wikiContradictionRef = (claimId: number) => `c${claimId}`

export interface WikiContradiction {
  /** 两条主张 id，a < b。 */
  a: number
  b: number
  reason: string
}

export interface WikiContradictionParseResult {
  summary: string
  conflicts: WikiContradiction[]
  /** 被拦下的条目数（引用不合法、自相矛盾、重复、理由不合规、超量）。 */
  rejected: number
}

const REF = /^c(\d{1,12})$/

function cleanReason(reason: string): string {
  return reason
    .replace(/\[\^c:[^\]]*\]/g, '')
    .replace(/\[\[|\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 解析模型输出 `{"summary": string, "conflicts": [{"a": "c12", "b": "c34", "reason": "…"}]}`（容忍 ```json 围栏）。
 * JSON 无效或结构不符返回 null；逐条校验不合规的计入 rejected。
 */
export function parseWikiContradictionOutput(
  raw: string,
  knownRefs: ReadonlySet<string>,
): WikiContradictionParseResult | null {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const obj = json as Record<string, unknown>
  if (!Array.isArray(obj.conflicts)) return null
  if (obj.summary !== undefined && typeof obj.summary !== 'string') return null
  const summary = cleanReason(typeof obj.summary === 'string' ? obj.summary : '').slice(0, 300)

  const conflicts: WikiContradiction[] = []
  const seen = new Set<string>()
  let rejected = 0
  for (const item of obj.conflicts as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      rejected++
      continue
    }
    const { a, b, reason } = item as Record<string, unknown>
    const ma = typeof a === 'string' && knownRefs.has(a) ? REF.exec(a) : null
    const mb = typeof b === 'string' && knownRefs.has(b) ? REF.exec(b) : null
    const text = typeof reason === 'string' ? cleanReason(reason) : ''
    const length = Array.from(text).length
    if (
      !ma ||
      !mb ||
      a === b ||
      length < 1 ||
      length > WIKI_CONTRADICTION_REASON_MAX_CHARS ||
      isWikiInstructionLike(text) ||
      !sanitizeMemoryContent(text).ok
    ) {
      rejected++
      continue
    }
    const [lo, hi] = [Number(ma[1]), Number(mb[1])].sort((x, y) => x - y) as [number, number]
    const key = `${lo}:${hi}`
    if (seen.has(key) || conflicts.length >= WIKI_CONTRADICTION_MAX_RESULTS) {
      rejected++
      continue
    }
    seen.add(key)
    conflicts.push({ a: lo, b: hi, reason: text })
  }
  return { summary, conflicts, rejected }
}

/** 矛盾发现的去重键。 */
export const wikiContradictionDedupeKey = (a: number, b: number) =>
  `contradiction:${Math.min(a, b)}:${Math.max(a, b)}`
