import {
  CLARIFICATION_COVERAGE_SLOTS,
  CLARIFICATION_CORE_COVERAGE_SLOTS,
  type ClarificationCoverageEntry,
  type ClarificationCoverageSlot,
  type ClarificationCoverageStatus,
  type ClarificationLedger,
  type ClarificationLedgerEntry,
  type InformationNeed,
  type InformationNeedAnswerKind,
  type InformationNeedDecisionArea,
} from '@aiproj/types'

/**
 * 需求覆盖矩阵。
 *
 * 之前判断「这题问过没有」只看 needId 是否出现在 ledger 里。可是每一轮理解都是模型
 * 重新生成的，id 每轮都不一样——同一个主题换个 id 就能无限重问，这正是用户看到的
 * 「已经答过还一直追问、生成入口永远不开」。
 *
 * 这里改成按**用户看得见的主题**建立覆盖矩阵：每条已确认答案落到若干槽位，
 * 新需求也落到若干槽位，于是「同主题已答」「关键主题齐了」都变成可判定的事实。
 */

/** 槽位关键词。简繁并列，因为界面经 cc-loader 呈现繁体，用户也常用繁体作答。 */
const SLOT_LEXICON: Record<ClarificationCoverageSlot, RegExp> = {
  scope: /范围|範圍|边界|邊界|做什[么麼]|功能|需求清[单單]|模[块塊]|模組|包含哪些|不做/u,
  deliverable: /交付|[产產]出|成果|文[档檔]|[报報]表|[输輸]出|deliverable/iu,
  schedule:
    /[时時][间間]|日期|上线|上線|截止|期限|[周週]期|工期|里程碑|多久|多[长長][时時][间間]|何[时時]|什[么麼][时時]候|deadline|排期|工[时時]/iu,
  resource:
    /人[员員]|人手|人力|[团團][队隊]|投入|到[岗崗]|配置|[预預]算|成本|[资資]源|[几幾][个個]人|多少人|工位|外包|headcount|budget/iu,
  role: /角色|[职職][责責]|[岗崗]位|分工|[谁誰][负負][责責]|[负負][责責]人|[权權][责責]|owner|stakeholder/iu,
  platform:
    /平台|端上|移[动動]端|桌面|网页|網頁|浏[览覽]器|瀏覽器|小程序|公众号|公眾號|微信|钉钉|釘釘|飞书|飛書|ios|android|web|app|saas|部署在/iu,
  integration:
    /[对對]接|集成|整合|接口|介面|同步|[导導]入|[导導]出|第三方|外部系[统統]|已有系[统統]|api|sso|webhook|erp|crm/iu,
  permission:
    /[权權]限|[审審]批|授[权權]|可[见見]性|可見性|管理[员員]|登[录錄]|[帐賬][号號]|账号|租[户戶]|保密|rbac|permission/iu,
  notification:
    /通知|提醒|消息|推送|[邮郵]件|短信|簡訊|告警|播[报報]|催[办辦]|订阅|訂閱|notification|alert/iu,
  acceptance:
    /[验驗]收|[标標][准準]|成功|达标|達標|指[标標]|合格|通[过過][条條]件|完成的定[义義]|checklist|kpi|sla/iu,
  data: /数据|數據|[统統][计計]|口径|口徑|字段|[栏欄]位|[记記][录錄]|台[账賬]|台账|明[细細]|指[标標]口[径徑]|报表口径|dashboard/iu,
  risk: /风险|風險|合规|合規|安全|隐私|隱私|依[赖賴]|[约約]束|限制|法[规規]|审计|審計|risk|compliance/iu,
}

/** decisionImpact（7 个取值）到槽位的兜底映射，用于文本里没有明显关键词的需求。 */
const DECISION_AREA_TO_SLOT: Record<InformationNeedDecisionArea, ClarificationCoverageSlot> = {
  scope: 'scope',
  deliverable: 'deliverable',
  schedule: 'schedule',
  resource: 'resource',
  dependency: 'integration',
  risk: 'risk',
  acceptance: 'acceptance',
}

/**
 * 判定「同一主题」的相似度阈值。
 * 命中即视为重复提问，直接丢弃该需求，不再出题。
 */
const REPEAT_SIMILARITY = 0.6

/** 问法本身已经几乎一模一样时，不再要求 topic 也对得上。 */
const NEAR_IDENTICAL_QUESTION = 0.8

/** 自由文本吸收时，子句与候选需求的最低匹配分。 */
const ABSORB_MIN_SCORE = 0.55

/** 一轮最多额外吸收几条答案。超过说明匹配过于宽松，宁可少记也不要错记。 */
const ABSORB_LIMIT = 3

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim()
}

/** 中文没有空格，按空白/标点切词在中文上恒等于「整句一个词」，所以必须用字符二元组。 */
function bigrams(value: string): Set<string> {
  const set = new Set<string>()
  if (value.length === 0) return set
  if (value.length === 1) {
    set.add(value)
    return set
  }
  for (let index = 0; index < value.length - 1; index += 1) {
    set.add(value.slice(index, index + 2))
  }
  return set
}

function dice(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const item of left) if (right.has(item)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

function latinTokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((item) => item.length >= 2),
  )
}

/**
 * 中英混排都能用的文本相似度：取「字符二元组 Dice」与「拉丁词重合率」的较大者。
 * 原实现只有后者，在纯中文上恒为 0——所以旧的去重阈值 0.86 从来没生效过。
 */
export function textSimilarity(left: string, right: string): number {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  if (a === b) return 1
  const diceScore = dice(bigrams(a), bigrams(b))
  const leftTokens = latinTokens(left)
  const rightTokens = latinTokens(right)
  let tokenScore = 0
  if (leftTokens.size > 0 && rightTokens.size > 0) {
    let shared = 0
    for (const item of leftTokens) if (rightTokens.has(item)) shared += 1
    tokenScore = shared / Math.max(leftTokens.size, rightTokens.size)
  }
  return Math.max(diceScore, tokenScore)
}

/** 一段文字命中哪些主题槽位。命中多个是正常的：「到岗统计口径」既是人力也是数据。 */
export function detectCoverageSlots(text: string): ClarificationCoverageSlot[] {
  if (!text.trim()) return []
  return CLARIFICATION_COVERAGE_SLOTS.filter((slot) => SLOT_LEXICON[slot].test(text))
}

export function slotsForNeed(need: InformationNeed): ClarificationCoverageSlot[] {
  const fromText = detectCoverageSlots(`${need.topic} ${need.missingInformation}`)
  if (fromText.length > 0) return fromText
  // 文本里没有可识别关键词时退回决策影响面，至少不会落到「无槽位」。
  return [...new Set(need.decisionImpact.map((area) => DECISION_AREA_TO_SLOT[area]))]
}

export function slotsForEntry(entry: ClarificationLedgerEntry): ClarificationCoverageSlot[] {
  if (entry.coverageSlots?.length) return entry.coverageSlots
  const answerText = Array.isArray(entry.answer)
    ? entry.answer.join(' ')
    : String(entry.answer ?? '')
  return detectCoverageSlots(`${entry.topic} ${entry.questionSummary} ${answerText}`)
}

/** ledger 里状态未被取代的条目——superseded 是历史版本，不参与覆盖判定。 */
export function liveEntries(ledger: ClarificationLedger): ClarificationLedgerEntry[] {
  return ledger.entries.filter((entry) => entry.status !== 'superseded')
}

export function buildCoverageMatrix(ledger: ClarificationLedger): ClarificationCoverageEntry[] {
  const status = new Map<ClarificationCoverageSlot, ClarificationCoverageStatus>()
  for (const entry of liveEntries(ledger)) {
    const slots = slotsForEntry(entry)
    const value: ClarificationCoverageStatus =
      entry.status === 'known_unknown' ? 'deferred' : 'covered'
    for (const slot of slots) {
      // covered 优先于 deferred：同一槽位只要有一条真答案就算问清楚了。
      if (value === 'covered' || !status.has(slot)) status.set(slot, value)
    }
  }
  return CLARIFICATION_COVERAGE_SLOTS.map((slot) => ({
    slot,
    status: status.get(slot) ?? 'open',
  }))
}

export function coveredSlots(matrix: ClarificationCoverageEntry[]): ClarificationCoverageSlot[] {
  return matrix.filter((item) => item.status !== 'open').map((item) => item.slot)
}

export function openCoreSlots(matrix: ClarificationCoverageEntry[]): ClarificationCoverageSlot[] {
  const byslot = new Map(matrix.map((item) => [item.slot, item.status]))
  return CLARIFICATION_CORE_COVERAGE_SLOTS.filter((slot) => (byslot.get(slot) ?? 'open') === 'open')
}

export type NeedCoverageVerdict = 'repeat' | 'finer' | 'new'

export interface NeedCoverageAssessment {
  verdict: NeedCoverageVerdict
  similarity: number
  matchedEntry: ClarificationLedgerEntry | null
  slots: ClarificationCoverageSlot[]
}

/**
 * 把一条新需求放到已确认答案上比对。
 *
 * - `repeat`：和某条已确认答案问的是同一件事 → 直接丢弃，绝不重问。
 * - `finer`：主题已经覆盖，但问的是更细的缺口 → 保留，但降级为非阻断，
 *   免得模型靠不断细化把生成入口永远挡住。
 * - `new`：全新主题 → 原样保留。
 */
export function assessNeedAgainstLedger(
  need: InformationNeed,
  ledger: ClarificationLedger,
): NeedCoverageAssessment {
  const slots = slotsForNeed(need)
  const entries = liveEntries(ledger)
  let best: ClarificationLedgerEntry | null = null
  let bestSimilarity = 0
  for (const entry of entries) {
    const topicSimilarity = textSimilarity(need.topic, entry.topic)
    const questionSimilarity = textSimilarity(need.missingInformation, entry.questionSummary)
    // 判「重复」要求主题**和**问法同时贴近，或者问法本身几乎一模一样。
    // 只取两者最大值会误伤：模型常给 schedule.launch_date / schedule.launch_window
    // 这种 id 式 topic，字面相似度高达 0.9，实际问的却是两件事。
    const similarity = Math.max(
      Math.min(topicSimilarity, questionSimilarity),
      questionSimilarity >= NEAR_IDENTICAL_QUESTION ? questionSimilarity : 0,
    )
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity
      best = entry
    }
  }
  if (bestSimilarity >= REPEAT_SIMILARITY) {
    return { verdict: 'repeat', similarity: bestSimilarity, matchedEntry: best, slots }
  }
  const covered = new Set(coveredSlots(buildCoverageMatrix(ledger)))
  const slotAlreadyCovered = slots.length > 0 && slots.every((slot) => covered.has(slot))
  return {
    verdict: slotAlreadyCovered ? 'finer' : 'new',
    similarity: bestSimilarity,
    matchedEntry: slotAlreadyCovered ? best : null,
    slots,
  }
}

/** 各 answerKind 认可的「具体值」信号。没有具体值的子句不吸收，避免把闲聊记成答案。 */
const VALUE_PATTERNS: Record<InformationNeedAnswerKind, RegExp | null> = {
  date: /\d{4}\s*[-/年]|\d{1,2}\s*[-/月]\s*\d{1,2}|\d{1,2}\s*月|年底|年初|月底|月初|季度|下周|下[个個]月|本月|明年|q[1-4]/iu,
  number: /\d/u,
  money: /\d+\s*(?:万|萬|亿|億|元|块|塊|k|w)/iu,
  single_choice: null,
  multi_choice: null,
  short_text: null,
}

export interface AbsorbedAnswer {
  need: InformationNeed
  answer: string
  clause: string
  slots: ClarificationCoverageSlot[]
}

/**
 * 从同一段自由文本里额外读出别的题的答案。
 *
 * 用户在第 3 题里同时写了上线日期和人员配置，系统只吸收了日期、后面又重新追问人员——
 * 因为一轮只把首个子句记给当前这道题，剩下的直接丢掉了。这里把整段话按子句切开，
 * 给每个子句找一道**它自己点了名**的题。
 *
 * 严格的三重门槛，宁可少吸收也不要错记：
 * 1. 子句必须自带主题关键词（自己点名要回答哪个主题）；
 * 2. 该主题必须与候选需求的槽位相交；
 * 3. 该子句必须含有与 answerKind 匹配的具体值。
 */
export function absorbAdditionalAnswers(input: {
  text: string
  needs: InformationNeed[]
  excludeNeedIds: string[]
  limit?: number
}): AbsorbedAnswer[] {
  const excluded = new Set(input.excludeNeedIds)
  const candidates = input.needs.filter((need) => !excluded.has(need.id))
  if (candidates.length === 0) return []
  const clauses = input.text
    .split(/[。；;\n，,]+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 3)
  if (clauses.length < 2) return []

  const used = new Set<string>()
  const absorbed: AbsorbedAnswer[] = []
  for (const clause of clauses) {
    if (absorbed.length >= (input.limit ?? ABSORB_LIMIT)) break
    // 子句本身是提问就跳过——那是求助，不是答案。
    if (/[？?]$/u.test(clause) || /^(?:为什么|為什麼|什么意思|什麼意思)/u.test(clause)) continue
    const clauseSlots = detectCoverageSlots(clause)
    if (clauseSlots.length === 0) continue
    let bestNeed: InformationNeed | null = null
    let bestScore = 0
    for (const need of candidates) {
      if (used.has(need.id)) continue
      const needSlots = slotsForNeed(need)
      const shared = clauseSlots.filter((slot) => needSlots.includes(slot))
      if (shared.length === 0) continue
      const valuePattern = VALUE_PATTERNS[need.answerKind]
      if (valuePattern && !valuePattern.test(clause)) continue
      const score =
        textSimilarity(clause, `${need.topic}${need.missingInformation}`) +
        shared.length / Math.max(clauseSlots.length, needSlots.length)
      if (score > bestScore) {
        bestScore = score
        bestNeed = need
      }
    }
    if (!bestNeed || bestScore < ABSORB_MIN_SCORE) continue
    used.add(bestNeed.id)
    absorbed.push({
      need: bestNeed,
      answer: clause,
      clause,
      slots: detectCoverageSlots(`${bestNeed.topic} ${clause}`),
    })
  }
  return absorbed
}
