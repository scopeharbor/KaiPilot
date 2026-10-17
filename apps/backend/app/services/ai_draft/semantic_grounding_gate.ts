import type {
  DraftValidationIssue,
  ProjectDraft,
  ProjectDraftGroundingManifest,
} from '@aiproj/types'

const SYNONYMS: Record<string, string[]> = {
  工单: ['工单', '服务请求', '支持请求', 'ticket'],
  运营: ['运营', '业务团队', '后台团队'],
  员工: ['员工', '内部用户', '组织成员'],
  时效: ['sla', '时效', '响应时间', '处理时间'],
  升级: ['升级', '上报', 'escalation'],
  看板: ['看板', '仪表板', 'dashboard', '数据概览'],
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

/**
 * 语料上限只防御异常输入。曾经的 2 万字上限按「章程 → WBS → 任务 → …」顺序截断：
 * 行业级草案（数十万字）连 WBS 都读不完，写在验收、资源、风险、里程碑里的事实全被误判为遗漏。
 */
const MAX_CORPUS_CHARS = 2_000_000

function draftCorpus(draft: ProjectDraft): string {
  const values: string[] = []
  let length = 0
  const walk = (value: unknown) => {
    if (length > MAX_CORPUS_CHARS) return
    if (typeof value === 'string') {
      values.push(value)
      length += value.length + 1
    } else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(draft)
  return normalize(values.join('。'))
}

function factPreview(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}…` : value
}

function chineseBigramCoverage(corpus: string, fact: string): number {
  const runs = fact.match(/[\u3400-\u9fff]{2,}/g) ?? []
  const bigrams = new Set<string>()
  for (const run of runs) {
    for (let index = 0; index < run.length - 1; index++) {
      bigrams.add(run.slice(index, index + 2))
    }
  }
  if (bigrams.size === 0) return 0
  const matched = [...bigrams].filter((bigram) => corpus.includes(bigram)).length
  return matched / bigrams.size
}

const CN_FULL_DATE = /(\d{4})年(\d{1,2})月(\d{1,2})日/g
const CN_YEAR_MONTH = /(\d{4})年(\d{1,2})月/g

function pad2(value: string): string {
  return value.padStart(2, '0')
}

function numericAnchors(fact: string): string[] {
  return [
    ...new Set(fact.match(/(?:p\d+|\d+(?:\.\d+)?(?:%|人|名|秒|毫秒|ms|天|日|月|年)?)/gi) ?? []),
  ]
}

function covered(corpus: string, fact: string): boolean {
  const normalizedFact = normalize(fact)
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedFact)) return corpus.includes(normalizedFact)
  if (/^\d+(?:\.\d+)?$/.test(normalizedFact)) {
    return corpus.includes(`${normalizedFact}人`) || corpus.includes(`人数${normalizedFact}`)
  }
  if (normalizedFact.length >= 2 && corpus.includes(normalizedFact)) return true

  // 数字事实优先：不能因为同一句里的“SLA/工单”等词被覆盖，就把丢失的 99%、
  // P95 或 2 秒阈值判为已覆盖。
  // 中文日期与 ISO 日期等价：草案里日期字段一律写 `2026-10-12`，
  // 事实原文「2026年10月12日」「2027年4月中旬」不能因为没出现「10月」字样就判遗漏。
  const dateAnchors: string[][] = []
  const withoutDates = normalizedFact
    .replace(CN_FULL_DATE, (text, year: string, month: string, day: string) => {
      dateAnchors.push([text, `${year}-${pad2(month)}-${pad2(day)}`])
      return ' '
    })
    .replace(CN_YEAR_MONTH, (text, year: string, month: string) => {
      dateAnchors.push([text, `${year}-${pad2(month)}`])
      return ' '
    })
  const anchors = numericAnchors(withoutDates)
  if (anchors.length > 0 || dateAnchors.length > 0) {
    const allNumbersPresent = anchors.every((anchor) => corpus.includes(normalize(anchor)))
    const allDatesPresent = dateAnchors.every((forms) =>
      forms.some((form) => corpus.includes(normalize(form))),
    )
    if (!allNumbersPresent || !allDatesPresent) return false
    return chineseBigramCoverage(corpus, normalizedFact) >= 0.2
  }

  for (const [key, variants] of Object.entries(SYNONYMS)) {
    if (!variants.some((variant) => normalizedFact.includes(normalize(variant)))) continue
    if (variants.some((variant) => corpus.includes(normalize(variant)))) return true
    if (corpus.includes(normalize(key))) return true
  }

  // 真实模型经常把一条已确认事实拆到章程、任务与验收条件中。对于包含量化阈值的
  // 长句，所有数字锚点必须仍存在；普通长句则以中文二元词覆盖率容忍合理改写，
  // 同时避免要求整句逐字连续出现造成假阻断。
  return normalizedFact.length >= 8 && chineseBigramCoverage(corpus, normalizedFact) >= 0.4
}

export interface SemanticGroundingResult {
  valid: boolean
  blocking: DraftValidationIssue[]
  warning: DraftValidationIssue[]
  coveredFactIds: string[]
  missingFactIds: string[]
}

/** 阻断领域替换、关键事实遗漏和明显的无依据领域扩张。 */
export function validateSemanticGrounding(
  draft: ProjectDraft,
  manifest: ProjectDraftGroundingManifest,
): SemanticGroundingResult {
  const corpus = draftCorpus(draft)
  const coveredFactIds: string[] = []
  const missingFactIds: string[] = []
  const blocking: DraftValidationIssue[] = []
  const warning: DraftValidationIssue[] = []

  for (const fact of manifest.facts) {
    if (fact.category === 'domain') continue
    if (covered(corpus, fact.normalizedValue)) coveredFactIds.push(fact.id)
    else if (fact.required) missingFactIds.push(fact.id)
  }

  if (missingFactIds.length > 0) {
    const missing = new Set(missingFactIds)
    const previews = manifest.facts
      .filter((fact) => missing.has(fact.id))
      .map((fact) => `「${factPreview(fact.normalizedValue)}」`)
    blocking.push({
      ruleId: 'HL-001',
      severity: 'blocking',
      message: `草案遗漏 ${missingFactIds.length} 项已确认关键事实：${previews.join('、')}。`,
      path: 'groundingManifest',
      autoFixable: false,
      dimension: 'factualAccuracy',
      failed: true,
    })
  }

  const manifestCorpus = normalize(
    manifest.facts
      .filter((fact) => fact.category !== 'out_of_scope')
      .map((fact) => fact.normalizedValue)
      .join('。'),
  )
  const ticketDomain = /工单|服务请求|ticket/.test(manifestCorpus)
  let positiveCorpus = corpus
  for (const fact of manifest.facts.filter((item) => item.category === 'out_of_scope')) {
    const excluded = normalize(fact.normalizedValue)
    positiveCorpus = positiveCorpus
      .replaceAll(`不包含${excluded}`, '')
      .replaceAll(`不包括${excluded}`, '')
      .replaceAll(`排除${excluded}`, '')
  }
  const unsupportedOa = /请假|报销|印章|审批流|hr系统/.test(positiveCorpus)
  if (ticketDomain && unsupportedOa && !/请假|报销|审批/.test(manifestCorpus)) {
    blocking.push({
      ruleId: 'HL-010',
      severity: 'blocking',
      message: '草案把已确认的工单领域替换成了未获依据的 OA 审批领域。',
      path: 'charter.scope',
      autoFixable: false,
      dimension: 'assumptionClarity',
      failed: true,
    })
  }

  for (const fact of manifest.facts.filter((item) => item.category === 'out_of_scope')) {
    const excluded = normalize(fact.normalizedValue)
    if (excluded.length >= 2 && positiveCorpus.includes(excluded)) {
      blocking.push({
        ruleId: 'HL-010',
        severity: 'blocking',
        message: '草案扩张到了用户明确排除的范围。',
        path: 'charter.scope',
        autoFixable: false,
        dimension: 'assumptionClarity',
        failed: true,
      })
      break
    }
  }

  const confirmedDates = manifest.facts.filter((fact) => fact.category === 'date' && fact.required)
  for (const fact of confirmedDates) {
    if (!covered(corpus, fact.normalizedValue)) {
      blocking.push({
        ruleId: 'HL-003',
        severity: 'blocking',
        message: '草案日期与已确认时间窗口不一致。',
        path: 'charter',
        autoFixable: false,
        dimension: 'logicalConsistency',
        failed: true,
      })
      break
    }
  }

  return {
    valid: blocking.length === 0,
    blocking,
    warning,
    coveredFactIds,
    missingFactIds,
  }
}
