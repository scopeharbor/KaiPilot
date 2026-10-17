// TRIZ 知识包检索纯函数（v3-triz-contradiction-copilot 任务 1.2）。
//
// 三条确定性检索路径：
// 1. 按原则编号：searchPrincipleByNumber / searchParameterByNumber；
// 2. 按关键词：searchByKeyword（覆盖 40 原则、39 参数、14 对矛盾映射与 3 个经典推演）；
// 3. 按参数对（改善 × 恶化）：searchByParameterPair。
//
// 纯函数语义：无网络、无模型调用、无缓存与时间依赖；同一输入两次调用结果完全一致
// （可按值深比较），未知编号一律返回中性空结果而不是抛错。
// 本模块不写库、不做权限判定、不接受任何作用域参数：授权与组织隔离由核心编排层在进入
// 本模块之前完成，知识面只回答「TRIZ 语汇里有哪些可选原则与映射」。
//
// 素材来源与逐条溯源见 ./knowledge/index.ts。

import {
  TRIZ_KNOWLEDGE_PACK_VERSION,
  TRIZ_PARAMETERS,
  TRIZ_PM_CLASSIC_SCENARIOS,
  TRIZ_PM_CONTRAIDCTION_PAIRS,
  TRIZ_PRINCIPLES,
  TRIZ_RESEARCH_DOC_PATHS,
} from './knowledge/index.js'
import type {
  TrizParameterEntry,
  TrizPmClassicScenario,
  TrizPmContradictionPair,
  TrizPrincipleEntry,
} from './knowledge/index.js'

/** 参数对命中的一条映射：或来自 14 对 PM 矛盾映射，或来自 §3.3 经典推演。 */
export interface TrizParameterPairMapping {
  /** 映射类别：pm-pair = 14 对清单；classic-scenario = §3.3 经典推演 */
  kind: 'pm-pair' | 'classic-scenario'
  /** 稳定标识（PM-01…PM-14 / CLASSIC-1…CLASSIC-3） */
  id: string
  /** 场景标题 */
  title: string
  /** 场景描述（矛盾映射为场景，经典推演为管理冲突） */
  scenario: string
  /** 该映射的改善参数编号集合 */
  improvingParameterNumbers: readonly number[]
  /** 该映射的恶化参数编号集合 */
  worseningParameterNumbers: readonly number[]
  /** 推荐原则编号集合，按素材给出的顺序 */
  principleNumbers: readonly number[]
  /** 推荐原则的知识包全量条目，顺序与 principleNumbers 一致 */
  principles: readonly TrizPrincipleEntry[]
  /** 场景解法要点 */
  recommendations: readonly string[]
  /** 来源章节标注 */
  source: string
}

/** 按参数对检索的结果。未识别的参数（或两侧都识别到但无命中映射）返回中性空结果。 */
export interface TrizParameterPairSearchResult {
  /** 改善参数条目；编号不在 1–39 范围内时为 null */
  improving: TrizParameterEntry | null
  /** 恶化参数条目；编号不在 1–39 范围内时为 null */
  worsening: TrizParameterEntry | null
  /** 是否命中至少一条映射 */
  matched: boolean
  /** 命中的映射，顺序固定：先 §3.3 经典推演（按 id），再 14 对清单（按 id） */
  mappings: readonly TrizParameterPairMapping[]
}

/** 按关键词检索的结果：每个集合内部按命中强度降序、同分按编号 / 标识升序。 */
export interface TrizKeywordSearchResult {
  /** 归一化后的关键词（trim + 小写）；空关键词返回各集合全空 */
  keyword: string
  principles: readonly TrizPrincipleEntry[]
  parameters: readonly TrizParameterEntry[]
  pairs: readonly TrizPmContradictionPair[]
  classicScenarios: readonly TrizPmClassicScenario[]
}

/** 知识包元信息：版本、条数与来源文档，供分析记录与审计引用。 */
export interface TrizKnowledgePackMetadata {
  version: string
  principleCount: number
  parameterCount: number
  pairCount: number
  classicScenarioCount: number
  researchDocs: readonly string[]
}

interface WeightedField<T> {
  readonly key: keyof T
  readonly weight: number
}

/** 命中强度权重：呈现名 / 标题权重最高，释义与实例最低。 */
const PRINCIPLE_FIELDS: readonly WeightedField<TrizPrincipleEntry>[] = [
  { key: 'displayName', weight: 4 },
  { key: 'nameZh', weight: 3 },
  { key: 'nameEn', weight: 3 },
  { key: 'nameRu', weight: 2 },
  { key: 'definition', weight: 2 },
  { key: 'softwareExamples', weight: 1 },
  { key: 'pmInterpretation', weight: 1 },
]

const PARAMETER_FIELDS: readonly WeightedField<TrizParameterEntry>[] = [
  { key: 'displayName', weight: 4 },
  { key: 'nameZh', weight: 3 },
  { key: 'nameEn', weight: 3 },
  { key: 'pmMeaning', weight: 2 },
  { key: 'category', weight: 1 },
]

const PAIR_FIELDS: readonly WeightedField<TrizPmContradictionPair>[] = [
  { key: 'title', weight: 4 },
  { key: 'scenario', weight: 3 },
  { key: 'solutions', weight: 1 },
]

const CLASSIC_SCENARIO_FIELDS: readonly WeightedField<TrizPmClassicScenario>[] = [
  { key: 'title', weight: 4 },
  { key: 'conflict', weight: 3 },
  { key: 'solutions', weight: 1 },
]

const PRINCIPLE_BY_NUMBER: ReadonlyMap<number, TrizPrincipleEntry> = new Map(
  TRIZ_PRINCIPLES.map((entry) => [entry.number, entry]),
)

const PARAMETER_BY_NUMBER: ReadonlyMap<number, TrizParameterEntry> = new Map(
  TRIZ_PARAMETERS.map((entry) => [entry.number, entry]),
)

/** 归一化关键词：去首尾空白 + 小写（ASCII 大小写不敏感，中文按原样包含匹配）。 */
function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase()
}

function fieldText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(' ')
  return ''
}

function scoreEntry<T>(entry: T, keyword: string, fields: readonly WeightedField<T>[]): number {
  let score = 0
  for (const { key, weight } of fields) {
    if (fieldText(entry[key]).toLowerCase().includes(keyword)) score += weight
  }
  return score
}

function rankByKeyword<T>(
  entries: readonly T[],
  keyword: string,
  fields: readonly WeightedField<T>[],
  tiebreak: (entry: T) => string,
): T[] {
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, keyword, fields) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || tiebreak(a.entry).localeCompare(tiebreak(b.entry)))
    .map((row) => row.entry)
}

/** 按编号取原则；编号不在 1–40 范围内（含非整数）返回 null，不抛错。 */
export function searchPrincipleByNumber(number: number): TrizPrincipleEntry | null {
  if (!Number.isInteger(number)) return null
  return PRINCIPLE_BY_NUMBER.get(number) ?? null
}

/** 按编号取参数；编号不在 1–39 范围内（含非整数）返回 null，不抛错。 */
export function searchParameterByNumber(number: number): TrizParameterEntry | null {
  if (!Number.isInteger(number)) return null
  return PARAMETER_BY_NUMBER.get(number) ?? null
}

/**
 * 按关键词检索知识包（原则 / 参数 / 矛盾映射 / 经典推演四类）。
 * 空关键词或纯空白返回各集合全空的中性结果，不抛错。
 */
export function searchByKeyword(keyword: string): TrizKeywordSearchResult {
  const normalized = normalizeKeyword(keyword)
  if (normalized.length === 0) {
    return { keyword: normalized, principles: [], parameters: [], pairs: [], classicScenarios: [] }
  }

  return {
    keyword: normalized,
    principles: rankByKeyword(TRIZ_PRINCIPLES, normalized, PRINCIPLE_FIELDS, (entry) =>
      String(entry.number).padStart(2, '0'),
    ),
    parameters: rankByKeyword(TRIZ_PARAMETERS, normalized, PARAMETER_FIELDS, (entry) =>
      String(entry.number).padStart(2, '0'),
    ),
    pairs: rankByKeyword(TRIZ_PM_CONTRAIDCTION_PAIRS, normalized, PAIR_FIELDS, (entry) => entry.id),
    classicScenarios: rankByKeyword(
      TRIZ_PM_CLASSIC_SCENARIOS,
      normalized,
      CLASSIC_SCENARIO_FIELDS,
      (entry) => entry.id,
    ),
  }
}

/**
 * 按参数对（改善 × 恶化）检索推荐原则与场景解法。
 *
 * 命中口径：映射自报的改善集合包含改善参数编号，且恶化集合包含恶化参数编号。
 * 未识别的编号不参与匹配；两侧任一无命中映射时返回 matched=false 与空 mappings。
 */
export function searchByParameterPair(
  improvingNumber: number,
  worseningNumber: number,
): TrizParameterPairSearchResult {
  const improving = searchParameterByNumber(improvingNumber)
  const worsening = searchParameterByNumber(worseningNumber)
  const mappings: TrizParameterPairMapping[] = []

  for (const scenario of TRIZ_PM_CLASSIC_SCENARIOS) {
    if (
      scenario.improvingParameterNumbers.includes(improvingNumber) &&
      scenario.worseningParameterNumbers.includes(worseningNumber)
    ) {
      mappings.push({
        kind: 'classic-scenario',
        id: scenario.id,
        title: scenario.title,
        scenario: scenario.conflict,
        improvingParameterNumbers: scenario.improvingParameterNumbers,
        worseningParameterNumbers: scenario.worseningParameterNumbers,
        principleNumbers: scenario.principleNumbers,
        principles: expandPrinciples(scenario.principleNumbers),
        recommendations: scenario.solutions,
        source: scenario.source,
      })
    }
  }

  for (const pair of TRIZ_PM_CONTRAIDCTION_PAIRS) {
    if (
      pair.improvingParameterNumbers.includes(improvingNumber) &&
      pair.worseningParameterNumbers.includes(worseningNumber)
    ) {
      mappings.push({
        kind: 'pm-pair',
        id: pair.id,
        title: pair.title,
        scenario: pair.scenario,
        improvingParameterNumbers: pair.improvingParameterNumbers,
        worseningParameterNumbers: pair.worseningParameterNumbers,
        principleNumbers: pair.principleNumbers,
        principles: expandPrinciples(pair.principleNumbers),
        recommendations: pair.solutions,
        source: pair.source,
      })
    }
  }

  return { improving, worsening, matched: mappings.length > 0, mappings }
}

/** 知识包元信息（版本 / 条数 / 来源文档）。 */
export function getKnowledgePackMetadata(): TrizKnowledgePackMetadata {
  return {
    version: TRIZ_KNOWLEDGE_PACK_VERSION,
    principleCount: TRIZ_PRINCIPLES.length,
    parameterCount: TRIZ_PARAMETERS.length,
    pairCount: TRIZ_PM_CONTRAIDCTION_PAIRS.length,
    classicScenarioCount: TRIZ_PM_CLASSIC_SCENARIOS.length,
    researchDocs: [TRIZ_RESEARCH_DOC_PATHS.fundamentals, TRIZ_RESEARCH_DOC_PATHS.applicationAiPm],
  }
}

/** 把原则编号展开为知识包条目，保持编号顺序；目录外编号（理论不应出现）被跳过。 */
function expandPrinciples(numbers: readonly number[]): TrizPrincipleEntry[] {
  const expanded: TrizPrincipleEntry[] = []
  for (const number of numbers) {
    const entry = PRINCIPLE_BY_NUMBER.get(number)
    if (entry) expanded.push(entry)
  }
  return expanded
}
