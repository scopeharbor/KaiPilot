/**
 * v3-v2-5-compatibility-gate-rules —— V3 对 V2.5 GA 兼容治理门的确定性规则引擎。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块，零运行时依赖：不读文件、不访问网络，
 * 输入全部为内存数据（change 工件快照 + 兼容账本），输出为确定性 finding 序列。
 * 类型契约见 `v3-v2-5-compatibility-gate.ts`；账本数据见
 * `v3-v2-5-compatibility-gate-ledger.ts`（本模块只依赖其类型，不 import 数据）。
 *
 * # 检测原则（observation-and-inventory.md §4 / §5.3 / §5.5）
 * - 文本扫描一律大小写不敏感，中英文关键词均覆盖。
 * - 宁可 warning 不要误报 blocking：non-goal / 延期 / fixture / 已授权语境必须豁免。
 * - 句子级否定豁免：命中动词所在句（以 .。;；!！?？ 为界）含否定词时不违规
 *   （「No V2.5 feature reimplementation」「does not require /api/v2」）。
 * - 文档角色豁免：proposal Why、design Context/Non-Goals、spec Requirement/Scenario 等
 *   描述门禁检测对象或风险的元描述行（含 gate/门禁/finding/检测/MUST produce/
 *   WHEN a V3 change/accidentally 等信号）不产 blocking——描述违规形态 ≠ 实施违规。
 * - 空 codebase-memory 图谱结果一律不得当作「不存在」的证据（§3.2 已知图谱不完整）。
 *
 * # 低敏纪律（红线）
 * 所有 finding 的 summary 经 `sanitizeFindingSummary` 处理，evidenceRefs 只含
 * 「路径:行号」，绝不携带原始 prompt、模型输出、secret、token、Authorization 头、
 * provider 原始载荷、原始 XML 断言、完整日志、完整源码或跨租户数据。
 *
 * # 确定性
 * 同一账本 + 同一快照两次运行必须产出相同 ruleId/severity/subjectPath 序列：
 * 每个 detector 对每个（规则, 工件）至多产一条 finding（取首个命中行），
 * `makeFinding` 对 evidenceRefs 去重排序，`summarizeFindings` 稳定排序输出。
 */

import {
  COMPATIBILITY_SENSITIVE_KEYWORDS,
  type CompatibilityFinding,
  type CompatibilityLedger,
  type CompatibilityRuleFamily,
  type CompatibilityValidationResult,
  type CompatibilityFindingSeverity,
} from './v3-v2-5-compatibility-gate.js'

// =============================================================================
// 1. 输入类型与规则 ID
// =============================================================================

/** 一个待检 OpenSpec change 的内存快照（仓库相对路径 + 文本内容）。 */
export interface ChangeArtifactSnapshot {
  /** change 名，如 `v3-some-change`。 */
  changeName: string
  /** 工件清单；path 为仓库相对路径（如 `openspec/changes/x/proposal.md`）。 */
  artifacts: { path: string; content: string }[]
}

/**
 * 稳定规则 ID 常量（`CG-<族缩写>-<序号>`）。
 * 同一规则同一 subject 只产一条 finding；ID 一经发布不得更改含义。
 */
export const CG_RULE_IDS = {
  /** closed-ga-reopen：主张重开/重建已收口 V2.5 GA P0 且无当前缺陷证据。 */
  closedGaReopen: 'CG-GA-001',
  /** unsupported-regression-claim：声称已交付表面缺失/未交付且无缺陷证据。 */
  unsupportedRegressionClaim: 'CG-REG-001',
  /** historical-prd-mandate：把 V2.5 历史 PRD 文本当作当前 V3 mandate。 */
  historicalPrdMandate: 'CG-PRD-001',
  /** hidden-prerequisite：隐藏基础设施前提（/api/v2、容器化、微服务、强制外部组件）。 */
  hiddenPrerequisite: 'CG-PRE-001',
  /** source-priority：缺 V3 baseline 引用（warning）。 */
  sourcePriorityV3Baseline: 'CG-SRC-001',
  /** source-priority：缺 V2.5 历史 baseline/release map 引用（warning）。 */
  sourcePriorityV25Baseline: 'CG-SRC-002',
  /** source-priority：缺归档 spec/archive 引用（warning）。 */
  sourcePriorityArchiveSpec: 'CG-SRC-003',
  /** observation-evidence：把空图谱结果当作「不存在」结论依据（blocking）。 */
  graphAbsenceConclusion: 'CG-OBS-001',
  /** observation-evidence：讨论图谱空结果但未记录直接 source/OpenSpec fallback（warning）。 */
  graphMissingFallback: 'CG-OBS-002',
  /** external-action-boundary：未授权真实外部动作（blocking）。 */
  unauthorizedExternalAction: 'CG-EXT-001',
  /** ai-manual-confirmation：AI/命令流绕过人工确认边界（blocking）。 */
  aiConfirmationBypass: 'CG-AI-001',
} as const

export type CgRuleId = (typeof CG_RULE_IDS)[keyof typeof CG_RULE_IDS]

// =============================================================================
// 2. 文本扫描原语（大小写不敏感；行级命中 + 行级/工件级豁免）
// =============================================================================

/** 一行文本的命中记录。 */
interface LineHit {
  path: string
  line: number
  text: string
}

/** 按行遍历快照（跳过空行），保持输入顺序以保证确定性。 */
function* iterateLines(snapshot: ChangeArtifactSnapshot): Generator<LineHit> {
  for (const artifact of snapshot.artifacts) {
    const lines = artifact.content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index] ?? ''
      if (text.trim().length === 0) continue
      yield { path: artifact.path, line: index + 1, text }
    }
  }
}

/** 证据引用：仅「路径:行号」，低敏。 */
function toEvidenceRef(hit: LineHit): string {
  return `${hit.path}:${hit.line}`
}

/** 当前缺陷证据（issue/缺陷/bug 编号或测试失败引用）。 */
const DEFECT_EVIDENCE_PATTERN =
  /(issue\s*#?\d+|缺陷\s*#?\d*|bug\s*#?\d+|defect\s*#?\d*|测试失败|failing\s+test|test\s+failure|回归缺陷|GH-\d+|#\d{2,})/i

/** 判断工件内是否附有当前缺陷证据。 */
function hasDefectEvidence(artifactContent: string): boolean {
  return DEFECT_EVIDENCE_PATTERN.test(artifactContent)
}

/** 显式授权声明（排除「未授权/无授权」等否定形态）。 */
const AUTHORIZATION_GRANT_PATTERN =
  /(明确授权|用户授权|获得授权|经授权|已授权|authorized|with\s+authorization)/i
const AUTHORIZATION_DENY_PATTERN =
  /(未授权|无授权|未经授权|without\s+authorization|not\s+authorized)/i

/** 判断文本是否含有效授权声明（有授权措辞且非否定形态）。 */
function declaresAuthorization(text: string): boolean {
  if (AUTHORIZATION_DENY_PATTERN.test(text)) return false
  return AUTHORIZATION_GRANT_PATTERN.test(text)
}

/** non-goal / 延期 / fixture / 降级语境豁免词（命中即豁免，防止误报 blocking）。 */
const EXEMPTION_PATTERN =
  /(不做|不引入|不涉及|非目标|non[-\s]?goal|out[-\s]of[-\s]scope|超出范围|延期|推迟|defer|后续版本|fixture|mock|桩|stub|降级|fallback|回退|仅记录|仅作|历史证据|佐证)/i

/**
 * 判断命中行中目标动词是否被就近否定（如「不重开」「不得重建」「not reopen」）。
 * 只检查动词紧邻前缀：中文否定词后至多 2 字，英文否定词紧邻动词；
 * 避免「未完成需重建」中远处的「不」被误判为否定「重建」。
 */
function isNegatedVerb(line: string, verbMatch: RegExpMatchArray): boolean {
  const index = verbMatch.index ?? 0
  const prefix = line.slice(Math.max(0, index - 16), index)
  if (/(not|never|without|avoid|no)\s*$/i.test(prefix)) return true
  const cjkPrefix = line.slice(Math.max(0, index - 4), index)
  return /(不|勿|禁止|避免|不得|无需|无须)[^，。；、\s\n]{0,2}$/.test(cjkPrefix)
}

/** 句子边界字符（逗号不断开——枚举清单常与句首否定共用一句，如「No A, no B, no C」）。 */
const SENTENCE_BOUNDARY_CHARS = new Set(['.', '。', ';', '；', '!', '！', '?', '？'])

/** 提取命中点所在的句子片段（以 .。;；!！?？ 为边界）。 */
function sentenceAround(line: string, index: number): string {
  let start = 0
  let end = line.length
  for (let i = index - 1; i >= 0; i -= 1) {
    if (SENTENCE_BOUNDARY_CHARS.has(line[i]!)) {
      start = i + 1
      break
    }
  }
  for (let i = index; i < line.length; i += 1) {
    if (SENTENCE_BOUNDARY_CHARS.has(line[i]!)) {
      end = i
      break
    }
  }
  return line.slice(start, end)
}

/**
 * 句子级否定/豁免（中英）：命中动词所在句整体为否定陈述时不违规。
 * 覆盖「No V2.5 feature reimplementation」「does not require /api/v2」「不做容器化」等形态；
 * 不含裸「不/未」，避免「未完成需重建」「未交付」这类违规主张本身被误豁免。
 */
const SENTENCE_NEGATION_PATTERN =
  /(\bno\b|\bnot\b|\bnever\b|\bwithout\b|\bprohibited\b|\bforbidden\b|\bmust\s+not\b|\bdoes\s+not\b|\bdo\s+not\b|\bdon't\b|\bavoid(?:s|ed)?\b|不做|不需要|不引入|不涉及|不得|禁止|无需|无须|勿|非目标)/i

/** 判断命中点所在句是否为否定陈述。 */
function isSentenceNegated(line: string, matchIndex: number): boolean {
  return SENTENCE_NEGATION_PATTERN.test(sentenceAround(line, matchIndex))
}

/**
 * 元描述/文档角色信号：命中行在描述门禁的检测对象、风险或规范要求
 * （proposal Why、design Context/Goals/Non-Goals、spec Requirement/Scenario 等，
 * 如「a future V3 change can accidentally …」「WHEN a V3 change … THEN the gate MUST …」），
 * 而非 change 自己在实施违规。命中即不产 blocking（描述违规形态 ≠ 实施违规）。
 */
const GATE_META_PATTERN =
  /(compatibility\s+gate|门禁|规则引擎|规则族|findings?\b|detectors?|detects?|detection|校验|检测|拦截|fails?\s+(when|if|on)\b|MUST\s+(produce|block|detect|require|record|include)|when\s+a\s+v3\s+change|if\s+a\s+v3\s+change|(a|any)\s+(future\s+)?v3\s+changes?\s+(can|could|may|might|that)|accidentally|风险|\brisks?\b|防止|防范|guard\s+against|prevents?\s)/i

/** 判断命中行是否为门禁元描述/风险描述（文档角色豁免）。 */
function isGateMetaDescription(line: string): boolean {
  // 先剥掉 Markdown 强调/代码标记（`**WHEN**`、`` `/api/v2` ``），否则标记会切断关键词匹配。
  const normalized = line.replace(/[*`]/g, '')
  return GATE_META_PATTERN.test(normalized)
}

// =============================================================================
// 3. 低敏 sanitize（值级敏感检测与脱敏）
// =============================================================================

/** 敏感片段（起点、终点、redact 标签）。 */
interface SensitiveSpan {
  start: number
  end: number
  label: string
}

/** bearer token 形态（如 `Bearer eyJhbGciOi...`）。 */
const BEARER_TOKEN_PATTERN = /bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi
/** XML 断言形态（如 `<saml:Assertion ...>` / `<saml2:Response ...>`）。 */
const XML_ASSERTION_PATTERN = /<saml[A-Za-z0-9]*[^>\n]{0,300}>?/gi
/** 长 base64/hex 串启发式（连续 40+ 字符，疑似密钥/载荷）。 */
const LONG_PAYLOAD_PATTERN = /([A-Za-z0-9+/]{40,}={0,2}|[0-9a-fA-F]{40,})/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 收集文本中的全部敏感片段（关键词 + 形态启发式），按起点排序并去除重叠。 */
function collectSensitiveSpans(text: string): SensitiveSpan[] {
  const spans: SensitiveSpan[] = []
  const collect = (pattern: RegExp, label: string | ((match: string) => string)) => {
    pattern.lastIndex = 0
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const raw = match[0]
      if (raw.length === 0) break
      spans.push({
        start: match.index,
        end: match.index + raw.length,
        label: typeof label === 'string' ? label : label(raw),
      })
    }
  }
  collect(BEARER_TOKEN_PATTERN, 'bearer-token')
  collect(XML_ASSERTION_PATTERN, 'saml-assertion')
  collect(LONG_PAYLOAD_PATTERN, 'payload')
  for (const keyword of COMPATIBILITY_SENSITIVE_KEYWORDS) {
    collect(new RegExp(escapeRegExp(keyword), 'gi'), () => keyword)
  }
  // 起点升序、同起点长者优先；贪心去重叠，保证输出确定。
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: SensitiveSpan[] = []
  let cursor = -1
  for (const span of spans) {
    if (span.start < cursor) continue
    merged.push(span)
    cursor = span.end
  }
  return merged
}

/**
 * 值级敏感检测：文本是否含敏感关键词、bearer token 形态、XML 断言形态
 * 或长 base64/hex 串启发式命中。匹配一律大小写不敏感。
 */
export function containsSensitivePayload(text: string): boolean {
  return collectSensitiveSpans(text).length > 0
}

/**
 * 低敏脱敏：把命中片段替换为 `[REDACTED:<keyword>]`。
 * 单遍替换（先收集后重建），placeholder 自身不会被二次扫描。
 */
export function sanitizeFindingSummary(text: string): string {
  const spans = collectSensitiveSpans(text)
  if (spans.length === 0) return text
  let output = ''
  let cursor = 0
  for (const span of spans) {
    output += text.slice(cursor, span.start)
    output += `[REDACTED:${span.label}]`
    cursor = span.end
  }
  output += text.slice(cursor)
  return output
}

// =============================================================================
// 4. finding 工厂与结果组装
// =============================================================================

/** makeFinding 入参。 */
export interface MakeFindingInput {
  ruleId: string
  family: CompatibilityRuleFamily
  severity: CompatibilityFindingSeverity
  /** 被检对象路径（仓库相对路径或 change 名）。 */
  subjectPath: string
  evidenceRefs: string[]
  /** 原始摘要；工厂内强制过 sanitize。 */
  summary: string
}

/**
 * finding 工厂：summary 强制低敏脱敏、evidenceRefs 去重排序，
 * 保证同一输入两次运行产出等价 finding（确定性）。
 */
export function makeFinding(input: MakeFindingInput): CompatibilityFinding {
  return {
    ruleId: input.ruleId,
    family: input.family,
    severity: input.severity,
    subjectPath: input.subjectPath,
    evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
    summary: sanitizeFindingSummary(input.summary),
  }
}

/** 把 finding 序列组装为校验结果（稳定排序：severity 优先，再 ruleId/subjectPath）。 */
export function summarizeFindings(
  findings: CompatibilityFinding[],
  checkedSubjects: string[] = [],
): CompatibilityValidationResult {
  const severityRank: Record<CompatibilityFindingSeverity, number> = {
    blocking: 0,
    warning: 1,
    info: 2,
  }
  const sorted = [...findings].sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.subjectPath.localeCompare(b.subjectPath),
  )
  const blockingCount = sorted.filter((finding) => finding.severity === 'blocking').length
  const warningCount = sorted.filter((finding) => finding.severity === 'warning').length
  const infoCount = sorted.filter((finding) => finding.severity === 'info').length
  return {
    ok: blockingCount === 0,
    findings: sorted,
    blockingCount,
    warningCount,
    infoCount,
    checkedSubjects: [...new Set(checkedSubjects)].sort(),
  }
}

// =============================================================================
// 5. 检测器：闭版 GA 重开 / 无证据回归主张（3.1）
// =============================================================================

/** 重开/重建类主张动词。 */
const REOPEN_VERB_PATTERN = /(重开|重新实现|重建|重做|返工|reopen|re-?implement|rebuild|re-?build)/i
/** V2.5 GA 语境。 */
const GA_CONTEXT_PATTERN = /(v2\.?5|GA\s*P0|\bGA\b|已收口|闭版)/i
/** 「未交付/缺失」类回归主张。 */
const MISSING_CLAIM_PATTERN =
  /(未交付|未完成|尚未交付|没有交付|未实现|缺失|不存在|not\s+delivered|not\s+implemented|missing|incomplete)/i

/**
 * 检测闭版 GA 重开与无证据回归主张：
 * - CG-GA-001：主张重开/重建 V2.5 GA P0 且工件内无当前缺陷证据 → blocking。
 * - CG-REG-001：声称账本中 `verified-archived` 表面未交付/缺失且无缺陷证据 → blocking。
 * 历史证据引用（「根据 v2.5 release map 已交付…」）与否定形态（「不重开」）不违规。
 */
export function detectClosedGaReopen(
  snapshot: ChangeArtifactSnapshot,
  ledger: CompatibilityLedger,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = []
  const archivedSurfaces = ledger.surfaces.filter(
    (surface) => surface.status === 'verified-archived',
  )
  const artifactContents = new Map(
    snapshot.artifacts.map((artifact) => [artifact.path, artifact.content]),
  )
  const seenGa = new Set<string>()
  const seenReg = new Set<string>()

  for (const hit of iterateLines(snapshot)) {
    const content = artifactContents.get(hit.path) ?? ''

    // CG-GA-001：重开主张 + GA 语境 + 无缺陷证据。
    if (!seenGa.has(hit.path)) {
      const verbMatch = hit.text.match(REOPEN_VERB_PATTERN)
      if (
        verbMatch &&
        GA_CONTEXT_PATTERN.test(hit.text) &&
        !isNegatedVerb(hit.text, verbMatch) &&
        !isSentenceNegated(hit.text, verbMatch.index ?? 0) &&
        !isGateMetaDescription(hit.text) &&
        !EXEMPTION_PATTERN.test(hit.text) &&
        !hasDefectEvidence(content)
      ) {
        seenGa.add(hit.path)
        findings.push(
          makeFinding({
            ruleId: CG_RULE_IDS.closedGaReopen,
            family: 'closed-ga-reopen',
            severity: 'blocking',
            subjectPath: hit.path,
            evidenceRefs: [toEvidenceRef(hit)],
            summary:
              '检测到主张重开/重建已收口 V2.5 GA P0 的表述，且未附当前缺陷证据（issue/缺陷编号或测试失败引用）；V2.5 GA 已闭版，重开须由独立授权的 OpenSpec change 显式推进。',
          }),
        )
      }
    }

    // CG-REG-001：对 verified-archived 表面的「未交付/缺失」主张 + 无缺陷证据。
    const missingMatch = hit.text.match(MISSING_CLAIM_PATTERN)
    if (!seenReg.has(hit.path) && missingMatch) {
      const lowered = hit.text.toLowerCase()
      const claimed = archivedSurfaces.find(
        (surface) =>
          lowered.includes(surface.surfaceId.toLowerCase()) ||
          (surface.label.length >= 2 && hit.text.includes(surface.label)),
      )
      if (
        claimed &&
        !isSentenceNegated(hit.text, missingMatch.index ?? 0) &&
        !isGateMetaDescription(hit.text) &&
        !EXEMPTION_PATTERN.test(hit.text) &&
        !hasDefectEvidence(content)
      ) {
        seenReg.add(hit.path)
        findings.push(
          makeFinding({
            ruleId: CG_RULE_IDS.unsupportedRegressionClaim,
            family: 'unsupported-regression-claim',
            severity: 'blocking',
            subjectPath: hit.path,
            evidenceRefs: [toEvidenceRef(hit)],
            summary: `检测到主张已交付表面「${claimed.surfaceId}」（verified-archived）未交付/缺失的表述，且未附当前缺陷证据；该主张与 V2.5 收口记录冲突，须提供代码/测试/归档 spec/发布记录级别的缺陷证据。`,
          }),
        )
      }
    }
  }
  return findings
}

// =============================================================================
// 6. 检测器：历史 PRD 当当前 mandate（3.1/3.2）
// =============================================================================

/** V2.5 历史 PRD 路径/指代。 */
const HISTORICAL_PRD_PATTERN =
  /(docs\/v2-v3\/source-package|v2\.5[-_]?v3[-_]?prd|v2\.5[^\s，。；]{0,20}PRD)/i
/** mandate 语境（按/依据/遵循/要求实现）。 */
const MANDATE_PATTERN =
  /(按[^，。；\n]{0,12}(实现|执行|落地)|依据|根据|遵循|须按|必须按|要求[^，。；\n]{0,8}实现|as\s+(a\s+)?mandate|according\s+to|must\s+implement|implement\s+per)/i
/** 显式 V3 OpenSpec 采纳声明。 */
const ADOPTION_PATTERN =
  /(OpenSpec\s*change[^，。；\n]{0,12}采纳|显式采纳|经\s*V3\s*OpenSpec|adopted\s+by|explicitly\s+adopted)/i

/**
 * 检测把 V2.5 历史 PRD 文本当作当前 V3 mandate 的模式（CG-PRD-001，blocking）：
 * 引用 `docs/v2-v3/source-package` 下 PRD 并要求按其实现，且未声明经 V3 OpenSpec change 显式采纳。
 * 历史证据引用（「仅作历史证据」「已交付佐证」）不违规。
 */
export function detectHistoricalPrdMisuse(
  snapshot: ChangeArtifactSnapshot,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = []
  const seen = new Set<string>()
  for (const hit of iterateLines(snapshot)) {
    if (seen.has(hit.path)) continue
    if (!HISTORICAL_PRD_PATTERN.test(hit.text)) continue
    if (!MANDATE_PATTERN.test(hit.text)) continue
    if (ADOPTION_PATTERN.test(hit.text)) continue
    if (isGateMetaDescription(hit.text)) continue
    if (EXEMPTION_PATTERN.test(hit.text)) continue
    seen.add(hit.path)
    findings.push(
      makeFinding({
        ruleId: CG_RULE_IDS.historicalPrdMandate,
        family: 'historical-prd-mandate',
        severity: 'blocking',
        subjectPath: hit.path,
        evidenceRefs: [toEvidenceRef(hit)],
        summary:
          '检测到把 V2.5 历史 PRD 文本当作当前 V3 mandate 的表述；历史 PRD 仅为产品意图证据（source priority 第 4 级），构成 V3 实现要求须经独立 V3 OpenSpec change 显式采纳。',
      }),
    )
  }
  return findings
}

// =============================================================================
// 7. 检测器：隐藏基础设施前提（3.1）
// =============================================================================

/** 隐藏基础设施前提关键词与展示名。 */
const HIDDEN_PREREQUISITE_TERMS: { pattern: RegExp; label: string }[] = [
  { pattern: /\/api\/v2/i, label: '/api/v2' },
  { pattern: /(容器化|docker|container|kubernetes|\bk8s\b)/i, label: '容器化/Docker' },
  { pattern: /(微服务|microservice)/i, label: '微服务' },
  { pattern: /(postgresql|\bpg\b)/i, label: 'PostgreSQL' },
  { pattern: /\bredis\b/i, label: 'Redis' },
  { pattern: /\bkafka\b/i, label: 'Kafka' },
  { pattern: /(vector\s?db|vectordb|向量数据库)/i, label: 'VectorDB' },
  {
    pattern: /(websocket[^，。；\n]{0,12}微服务|websocket\s+microservice)/i,
    label: 'WebSocket 微服务',
  },
  { pattern: /\bnginx\b/i, label: 'Nginx' },
]

/** 前提语境（需要/依赖/前提/必须先）。 */
const PREREQUISITE_CONTEXT_PATTERN =
  /(需要|依赖|前提|必须先|须先|要求先|以[^，。；\n]{0,8}为前提|requires?|depends?\s+on|prerequisite|must\s+have)/i

/**
 * 检测隐藏基础设施前提（CG-PRE-001，blocking）：
 * 把 `/api/v2`、容器化/Docker、微服务、强制 PostgreSQL/Redis/Kafka/VectorDB、
 * WebSocket 微服务等当作实现前提（出现在「需要/依赖/前提/必须先」语境）。
 * 显式 non-goal/延期声明（「不做容器化」）、fallback/降级语境不违规。
 */
export function detectHiddenPrerequisites(
  snapshot: ChangeArtifactSnapshot,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = []
  const seen = new Set<string>()
  for (const hit of iterateLines(snapshot)) {
    if (seen.has(hit.path)) continue
    if (!PREREQUISITE_CONTEXT_PATTERN.test(hit.text)) continue
    if (EXEMPTION_PATTERN.test(hit.text)) continue
    if (isGateMetaDescription(hit.text)) continue
    const termMatch = HIDDEN_PREREQUISITE_TERMS.map((candidate) => ({
      candidate,
      match: hit.text.match(candidate.pattern),
    })).find((entry) => entry.match !== null)
    if (!termMatch || !termMatch.match) continue
    if (isSentenceNegated(hit.text, termMatch.match.index ?? 0)) continue
    const term = termMatch.candidate
    seen.add(hit.path)
    findings.push(
      makeFinding({
        ruleId: CG_RULE_IDS.hiddenPrerequisite,
        family: 'hidden-prerequisite',
        severity: 'blocking',
        subjectPath: hit.path,
        evidenceRefs: [toEvidenceRef(hit)],
        summary: `检测到把「${term.label}」当作实现前提的隐藏基础设施前提表述；SQLite + 本机 pnpm dev 单体为仓库事实，强制外部基础设施均已被裁决 rejected 或 deferred，引入须独立 change 证明必要性且保留本机 fallback。`,
      }),
    )
  }
  return findings
}

// =============================================================================
// 8. 检测器：source priority 与证据完整性（3.3，warning）
// =============================================================================

/** change 是否触及 V2.5 表面（启发式：任一工件提及 V2.5）。 */
function touchesV25Surfaces(snapshot: ChangeArtifactSnapshot): boolean {
  return snapshot.artifacts.some((artifact) => /v2\.?5/i.test(artifact.content))
}

const V3_BASELINE_REF_PATTERN = /(v3-development-baseline|V3\s*(开发)?基线|v3\s+baseline)/i
const V25_BASELINE_REF_PATTERN =
  /(v2\.5-development-baseline|v2\.5-release-map|v2\.5\s*(历史)?(baseline|基线)|v2\.5\s*release\s*map)/i
const ARCHIVE_SPEC_REF_PATTERN =
  /(openspec\/specs\/|openspec\/changes\/archive\/|归档\s*spec|已归档(能力)?规范|archived?\s+spec)/i

/**
 * 校验 source priority 证据完整性（CG-SRC-001/002/003，warning 非 blocking）：
 * 触及 V2.5 表面的 change，证据须同时含 V3 baseline 引用、V2.5 历史 baseline/release map
 * 引用、归档 spec/archive 引用三类；缺任意一类产一条 warning（subject 为 change 名）。
 */
export function checkSourcePriorityAndEvidence(
  snapshot: ChangeArtifactSnapshot,
): CompatibilityFinding[] {
  if (!touchesV25Surfaces(snapshot)) return []
  const allContent = snapshot.artifacts.map((artifact) => artifact.content).join('\n')
  const subjects = snapshot.artifacts.map((artifact) => artifact.path)
  const findings: CompatibilityFinding[] = []
  const checks: { ruleId: string; missing: string; pattern: RegExp }[] = [
    {
      ruleId: CG_RULE_IDS.sourcePriorityV3Baseline,
      missing: 'V3 baseline（docs/v2-v3/planning/v3-development-baseline.md）引用',
      pattern: V3_BASELINE_REF_PATTERN,
    },
    {
      ruleId: CG_RULE_IDS.sourcePriorityV25Baseline,
      missing: 'V2.5 历史 baseline/release map（v2.5-development-baseline / v2.5-release-map）引用',
      pattern: V25_BASELINE_REF_PATTERN,
    },
    {
      ruleId: CG_RULE_IDS.sourcePriorityArchiveSpec,
      missing: '归档 spec/archive（openspec/specs/ 或 openspec/changes/archive/）引用',
      pattern: ARCHIVE_SPEC_REF_PATTERN,
    },
  ]
  for (const check of checks) {
    if (check.pattern.test(allContent)) continue
    findings.push(
      makeFinding({
        ruleId: check.ruleId,
        family: 'source-priority',
        severity: 'warning',
        subjectPath: snapshot.changeName,
        evidenceRefs: subjects,
        summary: `change 触及 V2.5 表面但证据缺少${check.missing}；按 source priority（§4）应同时引用 V3 baseline、V2.5 历史裁决记录与归档 spec。`,
      }),
    )
  }
  return findings
}

// =============================================================================
// 9. 检测器：图谱空结果 fallback 纪律（3.3/3.4）
// =============================================================================

/** codebase-memory/图谱空结果论述。 */
const GRAPH_EMPTY_PATTERN =
  /(codebase[-\s]?memory|图谱|code\s*graph|知识图谱)[^。\n]{0,40}(空|无结果|未命中|0\s*条|漏索引|stale|empty|no\s+result|incomplete|missing)/i
/** 直接 source/OpenSpec fallback 说明。 */
const GRAPH_FALLBACK_PATTERN =
  /(fallback|回退|直接\s*(source|源码|阅读|检查)|direct\s+(source|file)|OpenSpec\s*(证据|fallback)|以直接)/i
/** 把空结果当作「不存在」的结论。 */
const ABSENCE_CONCLUSION_PATTERN =
  /(不存在|未实现|视为不存在|当作不存在|证明[^，。；\n]{0,6}(没有|不存在)|does\s+not\s+exist|not\s+implemented|proof\s+of\s+absence)/i

/**
 * 校验图谱空结果 fallback 纪律：
 * - CG-OBS-001：把空 codebase-memory/graph 结果当作「不存在」结论依据且无 fallback 说明 → blocking。
 * - CG-OBS-002：讨论图谱空结果但未记录直接 source/OpenSpec fallback 说明 → warning。
 * 已知图谱对近期 V3 文件存在可复现漏索引（§3.2），空结果一律不得当作不存在的证据。
 */
export function checkGraphFallbackDiscipline(
  snapshot: ChangeArtifactSnapshot,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = []
  const allContent = snapshot.artifacts.map((artifact) => artifact.content).join('\n')
  const hasFallback = GRAPH_FALLBACK_PATTERN.test(allContent)
  const seenBlocking = new Set<string>()
  const seenWarning = new Set<string>()

  for (const hit of iterateLines(snapshot)) {
    if (!GRAPH_EMPTY_PATTERN.test(hit.text)) continue
    const absence = ABSENCE_CONCLUSION_PATTERN.test(hit.text)
    if (absence && !hasFallback && !seenBlocking.has(hit.path)) {
      seenBlocking.add(hit.path)
      findings.push(
        makeFinding({
          ruleId: CG_RULE_IDS.graphAbsenceConclusion,
          family: 'observation-evidence',
          severity: 'blocking',
          subjectPath: hit.path,
          evidenceRefs: [toEvidenceRef(hit)],
          summary:
            '检测到把空 codebase-memory/图谱结果当作「不存在」结论依据的表述；空图谱结果不得作为不存在证据，须先取得直接 source/OpenSpec 证据并记录 fallback 说明。',
        }),
      )
    } else if (!absence && !hasFallback && !seenWarning.has(hit.path)) {
      seenWarning.add(hit.path)
      findings.push(
        makeFinding({
          ruleId: CG_RULE_IDS.graphMissingFallback,
          family: 'observation-evidence',
          severity: 'warning',
          subjectPath: hit.path,
          evidenceRefs: [toEvidenceRef(hit)],
          summary:
            '检测到 codebase-memory/图谱空结果论述但未记录直接 source/OpenSpec fallback 说明；按观察纪律应记录图谱时效性或 fallback 理由。',
        }),
      )
    }
  }
  return findings
}

// =============================================================================
// 10. 检测器：未授权真实外部动作（3.5）
// =============================================================================

/** 真实外部动作关键词与展示名。 */
const EXTERNAL_ACTION_TERMS: { pattern: RegExp; label: string }[] = [
  { pattern: /(oauth|token\s*交换|token\s*exchange)/i, label: '真实 OAuth/令牌交换' },
  { pattern: /\bwebhook\b/i, label: 'Webhook 回调/外发' },
  { pattern: /(web\s*push|推送通知)/i, label: 'Web Push' },
  { pattern: /(provider\s+smoke|真实\s*provider|real\s+provider)/i, label: 'provider smoke' },
  { pattern: /(模型评测|model\s+evaluation|真实模型|real\s+model)/i, label: '真实模型评测' },
  { pattern: /(写回|writeback|write[-\s]?back)/i, label: 'GitHub/GitLab 写回' },
  { pattern: /(npm\s*发布|npm\s+publish)/i, label: '公开 npm 发布' },
]

/** 真实/生产限定词。 */
const REAL_QUALIFIER_PATTERN = /(真实|real|生产|production|实际|live)/i
/** 外发动作动词。 */
const EXTERNAL_ACTION_VERB_PATTERN =
  /(执行|发起|发送|调用|交换|发布|写回|推送|smoke|评测|execute|run|send|publish|perform|deliver)/i

/**
 * 检测未授权真实外部动作（CG-EXT-001，blocking）：
 * 真实 OAuth/token 交换、Webhook 回调/外发、Web Push、provider smoke、真实模型评测、
 * GitHub/GitLab 写回、公开 npm 发布——且 change 上下文中无有效授权声明。
 * fixture/mock/显式 non-goal/延期表述（含「未授权停在 fixture 边界」类边界重申）不违规。
 */
export function detectUnauthorizedExternalActions(
  snapshot: ChangeArtifactSnapshot,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = []
  // 授权声明为 change 级上下文：任一工件含有效授权声明即视为已授权。
  const snapshotAuthorized = snapshot.artifacts.some((artifact) =>
    declaresAuthorization(artifact.content),
  )
  const seen = new Set<string>()
  for (const hit of iterateLines(snapshot)) {
    if (seen.has(hit.path)) continue
    const termEntry = EXTERNAL_ACTION_TERMS.map((candidate) => ({
      candidate,
      match: hit.text.match(candidate.pattern),
    })).find((entry) => entry.match !== null)
    if (!termEntry || !termEntry.match) continue
    const term = termEntry.candidate
    if (!REAL_QUALIFIER_PATTERN.test(hit.text) && !EXTERNAL_ACTION_VERB_PATTERN.test(hit.text)) {
      continue
    }
    if (EXEMPTION_PATTERN.test(hit.text)) continue
    if (isGateMetaDescription(hit.text)) continue
    if (isSentenceNegated(hit.text, termEntry.match.index ?? 0)) continue
    if (declaresAuthorization(hit.text)) continue
    if (snapshotAuthorized) continue
    seen.add(hit.path)
    findings.push(
      makeFinding({
        ruleId: CG_RULE_IDS.unauthorizedExternalAction,
        family: 'external-action-boundary',
        severity: 'blocking',
        subjectPath: hit.path,
        evidenceRefs: [toEvidenceRef(hit)],
        summary: `检测到未授权真实外部动作（${term.label}）的表述；真实外部动作须用户明确授权，未授权统一停在 fixture/mock 本地可验证边界。`,
      }),
    )
  }
  return findings
}

// =============================================================================
// 11. 检测器：AI 绕过人工确认（3.5/3.6）
// =============================================================================

/** AI/命令流输出来源词。 */
const AI_OUTPUT_SOURCE_PATTERN =
  /(AI\s*(输出|建议|生成)?|模型输出|命令面板|command\s+palette|修复输出|生成(的)?代码|外部集成数据|离线队列)/i
/** 「直接/自动转正式数据」动词。 */
const AUTO_WRITE_VERB_PATTERN =
  /(自动执行|自动应用|自动写入|自动落库|自动提交|直接写入|直接转|直接应用|直接落库|直接提交|直接合并|auto[-\s]?(apply|execute|write|commit))/i
/** 绕过确认表述。 */
const CONFIRMATION_BYPASS_PATTERN =
  /(无需|无须|跳过|绕过|bypass)[^，。；\n]{0,8}(人工|确认|审批|review|confirmation|approval)/i
/** 正式项目数据落点。 */
const FORMAL_DATA_TARGET_PATTERN = /(正式|落库|入库|formal|production\s+data|项目数据)/i
/** 必备人工边界保障（RBAC/租户隔离/预览差异/显式确认/审计）。 */
const SAFEGUARD_PATTERN =
  /(RBAC|租户隔离|组织隔离|预览|差异|diff|显式确认|人工确认|用户确认|审计|audit|manual\s+(review|confirmation))/i

/**
 * 检测 AI/命令流绕过人工确认（CG-AI-001，blocking）：
 * 把 AI 输出、命令面板输出、修复输出、生成代码、外部集成数据、离线队列状态
 * 直接/自动转为正式项目数据，或显式表述绕过人工确认——且工件未声明
 * RBAC/租户隔离/预览差异/显式确认/审计边界。「AI 建议经预览与显式确认后应用」不违规。
 */
export function detectAiConfirmationBypass(
  snapshot: ChangeArtifactSnapshot,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = []
  const artifactSafeguard = new Map(
    snapshot.artifacts.map((artifact) => [artifact.path, SAFEGUARD_PATTERN.test(artifact.content)]),
  )
  const seen = new Set<string>()
  for (const hit of iterateLines(snapshot)) {
    if (seen.has(hit.path)) continue
    const bypassClaim = CONFIRMATION_BYPASS_PATTERN.test(hit.text)
    const autoWrite =
      AI_OUTPUT_SOURCE_PATTERN.test(hit.text) &&
      AUTO_WRITE_VERB_PATTERN.test(hit.text) &&
      (FORMAL_DATA_TARGET_PATTERN.test(hit.text) || bypassClaim)
    if (!bypassClaim && !autoWrite) continue
    if (EXEMPTION_PATTERN.test(hit.text)) continue
    // 文档角色豁免（描述门禁检测对象 ≠ 实施违规）；注意不做句子级否定豁免——
    // 「无需人工确认」本身即是违规特征，不能因含否定词而豁免。
    if (isGateMetaDescription(hit.text)) continue
    // 行内保障未被否定（如「经预览差异与显式确认」）则豁免；「无需人工确认」不豁免。
    if (!bypassClaim && SAFEGUARD_PATTERN.test(hit.text)) continue
    if (!bypassClaim && artifactSafeguard.get(hit.path)) continue
    seen.add(hit.path)
    findings.push(
      makeFinding({
        ruleId: CG_RULE_IDS.aiConfirmationBypass,
        family: 'ai-manual-confirmation',
        severity: 'blocking',
        subjectPath: hit.path,
        evidenceRefs: [toEvidenceRef(hit)],
        summary:
          '检测到 AI/命令流输出绕过人工确认直接转为正式项目数据的表述；红线为 AI 只建议不自动执行，正式写入须经 RBAC、租户隔离、预览/差异、显式确认与审计。',
      }),
    )
  }
  return findings
}

// =============================================================================
// 12. 组合入口
// =============================================================================

/**
 * 运行全部兼容规则并组装确定性校验结果。
 * detector 执行顺序固定，finding 经 `summarizeFindings` 稳定排序，
 * 同一账本 + 同一快照两次运行产出相同 ruleId/severity/subjectPath 序列。
 */
export function evaluateChangeCompatibility(
  snapshot: ChangeArtifactSnapshot,
  ledger: CompatibilityLedger,
): CompatibilityValidationResult {
  const findings: CompatibilityFinding[] = [
    ...detectClosedGaReopen(snapshot, ledger),
    ...detectHistoricalPrdMisuse(snapshot),
    ...detectHiddenPrerequisites(snapshot),
    ...checkSourcePriorityAndEvidence(snapshot),
    ...checkGraphFallbackDiscipline(snapshot),
    ...detectUnauthorizedExternalActions(snapshot),
    ...detectAiConfirmationBypass(snapshot),
  ]
  const checkedSubjects = [snapshot.changeName, ...snapshot.artifacts.map((a) => a.path)]
  return summarizeFindings(findings, checkedSubjects)
}
