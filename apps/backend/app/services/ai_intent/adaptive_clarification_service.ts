import { createHash, randomUUID } from 'node:crypto'
import {
  ADAPTIVE_CLARIFICATION_LIMITS,
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  repairProjectUnderstandingShape,
  validateProjectUnderstanding,
  type AdaptiveClarificationSession,
  type AdaptiveValidationIssue,
  type ClarificationCoverageEntry,
  type ClarificationCoverageSlot,
  type ClarificationConversationState,
  type ClarificationConversationTurn,
  type ClarificationLedger,
  type ClarificationLedgerEntry,
  type ClassifiedClarificationIntent,
  type InformationNeed,
  type InformationNeedOption,
  type KnownUnknown,
  type MultiIntentUserResponse,
  type ProjectUnderstanding,
  type QuestionCardProposal,
} from '@aiproj/types'
import type { AIGateway, GenerateOptions, GenerateResult } from '../ai_m0/gateway.js'
import {
  absorbAdditionalAnswers,
  assessNeedAgainstLedger,
  buildCoverageMatrix,
  coveredSlots,
  detectCoverageSlots,
  liveEntries,
  openCoreSlots,
  slotsForNeed,
  textSimilarity,
} from './clarification_coverage.js'
import InformationNeedSelector, { type RankedInformationNeed } from './information_need_selector.js'
import PlainQuestionComposer from './plain_question_composer.js'
import {
  CORE_NEED_IDS,
  checkCoreAnswer,
  coreAnswerExpectation,
  upcomingCalendarFacts,
  todayAnchor,
  withCoreInformationNeeds,
} from './core_information_needs.js'
import { requirementTextForPrompt } from './requirement_brief_service.js'
import { timingCheckpoint } from './timing_checkpoint.js'
import { calendarTable, generateWithPlanningTools } from '#services/ai_planning/planning_toolbox'
import { QuestionRewriteFailure } from './question_plan_checker.js'

interface QuestionGateway {
  generate(options: GenerateOptions): Promise<GenerateResult>
}

const SECRET_PATTERN =
  /(?:bearer\s+)?sk-[a-z0-9_-]{8,}|authorization\s*[:=]\s*[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b1[3-9]\d{9}\b/giu

function redact(value: unknown, max = 1_200): string {
  return String(value ?? '')
    .replace(SECRET_PATTERN, '[REDACTED]')
    .slice(0, max)
}

function extractObject(rawText: string): unknown {
  const start = rawText.indexOf('{')
  const end = rawText.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(rawText.slice(start, end + 1))
  } catch {
    return null
  }
}

function turn(
  role: ClarificationConversationTurn['role'],
  kind: ClarificationConversationTurn['kind'],
  text: string,
  now: string,
): ClarificationConversationTurn {
  return {
    id: createHash('sha256').update(`${role}:${kind}:${text}:${now}`).digest('hex').slice(0, 16),
    role,
    kind,
    text: redact(text, 1_000),
    createdAt: now,
  }
}

function normalizeAnswer(value: unknown): string | number | string[] | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) return redact(value.trim(), 600)
  if (Array.isArray(value)) {
    const values = value
      .map((item) => redact(item, 160))
      .filter(Boolean)
      .slice(0, 12)
    return values.length > 0 ? values : undefined
  }
  return undefined
}

/** 按 answerKind 给一句「可以照着写」的示例回答，只示范格式，不含任何未确认事实。 */
const ANSWER_KIND_EXAMPLES: Record<InformationNeed['answerKind'], string> = {
  single_choice: '例如：选第一个就好',
  multi_choice: '例如：前两项都要，其余暂时不要',
  date: '例如：大概今年底；或 2026-12-31',
  number: '例如：大约 500；或 300 到 800 之间',
  money: '例如：大概 50 万；或先按 30 万上限估',
  short_text: '例如：先按公司现在的做法办，细节以后再补',
}

/**
 * 「我不明白」的回应。原实现把 missingInformation 原样回抛，等于没有解释；
 * 这里改成：先说清楚这题只要一个大概答案，再给格式示例，并说明可以直接说不知道。
 */
function explainInPlainWords(
  need: InformationNeed,
  conversation: ClarificationConversationState,
): string {
  const parts = [
    `这题不用给准确数字或正式条文，一个大概方向就够，之后还能改。${ANSWER_KIND_EXAMPLES[need.answerKind]}。`,
  ]
  const options = conversation.activeQuestion.options ?? []
  if (options.length > 0) {
    parts.push(`也可以直接选上面的选项：${options.map((option) => option.label).join('、')}。`)
  } else {
    parts.push('直接用自己的话写一句就行，不必使用专业术语。')
  }
  parts.push(
    '如果这件事现在真的还没定，就回一句「还不确定」，我会把它记成待决定事项，不会替你编一个答案。',
  )
  return parts.join('')
}

/**
 * 「请给我建议」的回应。必须给出一个可以一键采用的具体值，否则用户仍然卡住。
 * 有候选项就取第一个；没有候选项时不编造事实，而是提议记为待决定事项——
 * 两种情况都只是建议值，仍需用户显式确认才会写入 ledger。
 */
function buildRecommendation(need: InformationNeed): {
  text: string
  proposedAnswer: string
} {
  const option = need.suggestedOptions?.[0]
  if (option) {
    return {
      proposedAnswer: option.value,
      text: `根据目前资料，建议先用「${option.label}」。这只是建议，确认后才会写进你的计划；不合适可以直接改。`,
    }
  }
  return {
    proposedAnswer: '这件事现在还不确定，请先记为待决定事项',
    text: '目前的资料不足以让我替你定这一项，我也不会替你编一个答案。建议先把它记成待决定事项：计划照常往下走，这一项会明确标成假设与风险，等你有结论再回来改。',
  }
}

/**
 * 意图关键词。界面经 cc-loader 以繁体呈现，用户往往也用繁体作答，而分类器原先只写
 * 简体字面量——繁体输入会整段落到 answer 兜底里。这里统一用字符类同时覆盖两种字形。
 * 均不带 g 标志，避免 lastIndex 状态在多次 test 之间串味。
 */
const ASK_WHY_PATTERN = /[为為]什[么麼]|[为為]何|[干幹]嘛要[问問]|[问問][这這][个個]有什[么麼]用/u
const ASK_MEANING_PATTERN = /什[么麼]意思|不明白|[没沒]看懂|怎[么麼]理解/u
const REQUEST_RECOMMENDATION_PATTERN = /建[议議]|推[荐薦]|你[觉覺]得.*[选選]|[该該]怎[么麼][选選]/u
const REQUEST_OPTIONS_PATTERN =
  /[选選][项項]|[选選][择擇][题題]|[给給]我[几幾][个個][选選]|列[几幾][个個]|有哪些可[选選]|[给給]我[选選]/u
const UNKNOWN_PATTERN = /不知道|不[确確]定|[还還][没沒][决決]定|尚未[决決]定|待定/u
/**
 * 「改上一题的答案」的触发词。
 *
 * 原实现把裸的 `改成` / `应该是` 也算进来。这两个短语在正常作答里极其常见
 * （「到岗统计应该是按打卡记录」「周期改成 8 周」），于是普通答案被判成修改指令，
 * 再配上「找不到目标就取最后一条」的兜底，答案被写到**上一条** ledger 条目上：
 * 界面里「到岗统计」的答案挂到了「8 周周期」下面，当前这题又始终没关闭，
 * 于是同一个问题被反复重问。现在只认明确指向「之前那一次回答」的说法。
 */
const EDIT_ANSWER_PATTERN = new RegExp(
  [
    '(?:[刚剛]才|之前|上(?:一)?[题題]|前面|上次|先前)[^。；;]{0,16}(?:[错錯]|改成|改[为為]|更正|重填|不[对對])',
    '我(?:要|想)?(?:修改|更正|改)(?:一下)?(?:之前|前面|上[一]?[题題]|[刚剛]才)',
    '(?:[说說]|填|答|回答)[错錯]了',
    '更正[：:]',
  ].join('|'),
  'u',
)

function positiveEnvInt(key: string, fallback: number): number {
  const parsed = Number(process.env[key])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * 单次模型请求的上限，以及一整轮澄清（含全部重试）的总上限。
 *
 * 全局 AI_M0_REQUEST_TIMEOUT_MS 默认放宽到 50 分钟，好让不输出思考 token、但仍在
 * 正常推理的端点跑完。可澄清是**逐轮交互**：供应商 500 过载时，一次挂死的请求会
 * 再乘上重试次数更没边。这里给澄清链路单独设一个总时限——超时就带着已确认答案退回
 * 守卫态，用户点一次「重试这一步」即可，一条答案都不会丢。
 */
const CLARIFICATION_ATTEMPT_TIMEOUT_MS = positiveEnvInt(
  'AI_ADAPTIVE_CLARIFICATION_ATTEMPT_TIMEOUT_MS',
  20 * 60_000,
)
const CLARIFICATION_ROUND_TIMEOUT_MS = positiveEnvInt(
  'AI_ADAPTIVE_CLARIFICATION_ROUND_TIMEOUT_MS',
  25 * 60_000,
)

/**
 * 传输类故障（供应商 500 过载、超时、断流）的独立重试预算。
 *
 * 原来这类故障和结构错误共用同一个 maxRepairAttempts：一次 500 过载会消耗一次
 * 「修复机会」，下一次请求还要背上更长的修复提示词——等得更久，却修不了任何东西。
 */
const MAX_TRANSPORT_RETRIES = 2
const TRANSPORT_BACKOFF_BASE_MS = 800
const TRANSPORT_BACKOFF_MAX_MS = 4_000

/** 校验结果里代表「整个对象」的路径。 */
const ROOT_PATH = '$'

/** 只能靠重写结构外壳解决的错误码。 */
const ROOT_ONLY_CODES = new Set(['INVALID_ROOT', 'NOT_SERIALIZABLE'])

/**
 * 按实际错在哪里给修复指令，而不是每次都甩同一句「完整重写 JSON」。
 * 顶层结构坏掉时让模型只重写外壳、保留内容，比重新分析一遍项目快得多，也稳得多。
 */
function buildRepairInstruction(issues: AdaptiveValidationIssue[]): string {
  if (issues.length === 0) {
    return '完整重写 JSON。不得使用 null 占位；没有值的可选字段直接省略。'
  }
  const codes = new Set(issues.map((issue) => issue.code))
  if ([...codes].every((code) => ROOT_ONLY_CODES.has(code))) {
    return '只重写最外层的结构外壳：把 invalidOutput 里已有的内容原样放进一个合法 JSON 对象。不要新增、删除或改写任何字段的内容，也不要重新分析项目。'
  }
  const fieldIssues = issues.filter((issue) => issue.path !== ROOT_PATH)
  if (fieldIssues.length === issues.length) {
    const listed = fieldIssues
      .slice(0, 8)
      .map((issue) => `${issue.path} 收到 ${issue.received ?? '空值'}`)
      .join('；')
    return `只修下面这些字段，其余内容原样保留：${listed}。不得使用 null 占位；没有值的可选字段直接省略。`
  }
  return '完整重写 JSON。不得使用 null 占位；没有值的可选字段直接省略。所有数组成员必须是完整对象。'
}

/** 把定位信息拼进错误消息，让界面上的提示能说清是哪一项触发的。 */
function formatIssueSuffix(issues: AdaptiveValidationIssue[]): string {
  const located = issues.filter((issue) => issue.received !== undefined).slice(0, 3)
  if (located.length === 0) return ''
  return `（触发内容：${located.map((issue) => `${issue.path}=${issue.received}`).join('；')}）`
}

/** 关键槽位齐了以后，至少还要这么多条确认答案才认为可以直接生成草案。 */
const MIN_CONFIRMED_FOR_DRAFT = 3

/**
 * 问到这么多条就一定开放生成入口，剩余项转成假设与待决定事项。
 * 没有这条硬上限，模型每轮新造一个「高优先级」需求就能把用户无限期扣在问答里。
 */
const MAX_QUESTIONS_BEFORE_DRAFT = 12
/**
 * 自动收尾前，模型至少可以问几道「提升质量」的问题（核心三问之外，按价值排序）。
 * 用户要求：只要追问能让计划更好，模型自己想问的也要问；实测原话写清楚开工日 / 工期 / 团队时，
 * 模型列了 16 项待确认（签到方式、审批规则…）却一题没问就直接就绪。用户随时可以提前生成。
 */
const MODEL_QUALITY_QUESTIONS = 3

/** 覆盖矩阵槽位的中文名，用于告诉用户「还差哪个主题」。 */
const COVERAGE_SLOT_LABELS: Record<ClarificationCoverageSlot, string> = {
  scope: '项目范围',
  deliverable: '交付物',
  schedule: '时间与日期',
  resource: '人力与预算',
  role: '角色与分工',
  platform: '平台与形态',
  integration: '系统对接',
  permission: '权限与审批',
  notification: '通知与提醒',
  acceptance: '验收标准',
  data: '数据与口径',
  risk: '风险与约束',
}

function coverageSlotLabel(slot: ClarificationCoverageSlot): string {
  return COVERAGE_SLOT_LABELS[slot]
}

/**
 * 重定向到历史条目所需的最低相似度。达不到就落在当前这道题上——
 * 「猜一个最近的条目」比「记在当前题上」错得更离谱，也更难被用户发现。
 */
const EDIT_TARGET_MIN_SIMILARITY = 0.34
const ADD_CONTEXT_PATTERN = /但|不[过過]|另外|[补補]充|已知|目前.+(?:最多|至少|只能|可以)/u
/** 首句就是这几类求助之一时不记为答案。直接由上面四条派生，避免两处漏改。 */
const FIRST_CLAUSE_FOLLOW_UP_PATTERN = new RegExp(
  [
    ASK_WHY_PATTERN,
    ASK_MEANING_PATTERN,
    REQUEST_RECOMMENDATION_PATTERN,
    REQUEST_OPTIONS_PATTERN,
    /你[觉覺]得|怎[么麼][选選]/u,
  ]
    .map((pattern) => pattern.source)
    .join('|'),
  'u',
)

/**
 * 按需补选项时的条数上限。schema 硬上限是 maxOptions=8，但一屏摆 8 个选项等于
 * 把「选择题」又变回阅读理解——这里与出题时的 2..4 保持一致。
 */
const PROPOSED_OPTIONS_LIMIT = Math.min(4, ADAPTIVE_CLARIFICATION_LIMITS.maxOptions)

/**
 * 把答案里的选项 value 换回用户看到的 label。
 *
 * 选项按钮提交的是模型定义的 `value`，模型常给 `travel`、`daily_office_transport`
 * 这类机器键；照原样落进 ledger，用户在「已确认」列表里只能看到一串英文标识符。
 * 自由输入不受影响：任何一段都对不上选项时按原文返回，绝不改写用户自己写的话。
 */
function humanizeOptionAnswer(
  answer: string | number | string[] | undefined,
  options: InformationNeedOption[] | undefined,
): string | number | string[] | undefined {
  if (answer === undefined || typeof answer === 'number') return answer
  if (!options?.length) return answer
  const byValue = new Map(
    options.map((option) => [option.value.trim().toLocaleLowerCase(), option.label.trim()]),
  )
  const mapOne = (part: string): string => byValue.get(part.trim().toLocaleLowerCase()) ?? part
  if (Array.isArray(answer)) return answer.map(mapOne)
  const parts = answer.split(/[、,，]/u).map((part) => part.trim())
  // 只有确实命中过选项才重组，避免把普通句子里的逗号改写成顿号。
  if (!parts.some((part) => byValue.has(part.toLocaleLowerCase()))) return answer
  return parts.filter(Boolean).map(mapOne).join('、')
}

/**
 * 把内部失败原因翻译成用户看得懂的一句话。
 *
 * 原实现直接把 `error.message` 甩到界面上，于是用户看到的是
 * 「项目理解连续校验失败：malformed_json」——`malformed_json` 还是所有未识别
 * SDK 异常的兜底桶，既不准确也无从下手。技术细节保留在括号里供排查。
 */
function describeGuardFailure(error: unknown, fallback: string): string {
  const detail = error instanceof Error ? error.message : ''
  if (!detail) return fallback
  const lower = detail.toLocaleLowerCase()
  let plain = ''
  // 供应商过载排在最前：它最常见，而且和「模型吐了坏 JSON」是完全不同的处置方式
  // （前者等一会儿或换模型，后者改提示词），混在一起说会把用户引到错误的方向。
  if (
    lower.includes('overload') ||
    lower.includes('过载') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    /(?<!\d)(?:429|500|502|503|529)(?!\d)/u.test(lower)
  ) {
    plain =
      '模型服务这会儿在排队或过载，系统已经自动退避重试过仍然没排上。稍等一下再点「重试这一步」通常就好；一直这样的话，可以在设置里换一个模型或连接。'
  } else if (lower.includes('round_timeout')) {
    plain =
      '这一轮等模型的时间到上限了，系统主动停下来，没有让你继续干等。已确认的答案全部保留，点「重试这一步」就能接着往下走。'
  } else if (lower.includes('invalid_root')) {
    plain =
      '模型这次没有按 JSON 对象返回（最外层结构不对）。系统已经让它只重写结构外壳、保留内容，仍然没成功。重试一次通常就能过。'
  } else if (lower.includes('sensitive_value_exposed')) {
    plain =
      '模型返回里出现了疑似密钥或密码的内容，系统已经拒绝采用，也没有把它写进任何记录。下面括号里是触发这条拦截的片段（已脱敏）。'
  } else if (lower.includes('invalid_sensitivity')) {
    plain =
      '模型给某道问题标注的敏感度取值不在允许范围内（只允许 none/low/high）。下面括号里写明了是哪一条、收到的是什么值。'
  } else if (lower.includes('sse_interrupted')) {
    plain = '模型连接中断或超时了，这次没能把结果取回来。通常重试一次就好。'
  } else if (lower.includes('token_limit_exceeded') || lower.includes('truncated')) {
    plain = '模型这次输出被截断了，没有形成完整结果。重试一次通常就能过。'
  } else if (lower.includes('model_refusal_or_empty')) {
    plain = '模型这次没有给出内容。可以重试，或者把项目描述写得更具体一点。'
  } else if (lower.includes('malformed_json')) {
    plain =
      '模型这次的返回不完整或格式不对，系统已经拒绝采用（不会拿半成品当结果）。重试一次通常就能过。'
  } else if (lower.includes('校验失败') || lower.includes('无法安全发布')) {
    plain = '模型返回的内容没通过安全校验，系统已经拒绝采用。重试一次通常就能过。'
  }
  if (!plain) return detail
  return `${plain}（技术原因：${detail}）`
}

/**
 * 把模型返回的候选项收敛成可发布的形状：去空、去重、限长、限量。
 *
 * 这里**不再**因为候选项含数字就丢弃。候选项是需要用户点选确认的建议值，不是被
 * 断言的事实；配合恒开的「其他」自由输入，含人数/金额的档次反而比抽象说法更好选。
 * 反幻觉的边界仍在原处：选项不会自动落库，仍需用户显式确认（ADR 红线）。
 */
function normalizeProposedOptions(parsed: unknown, needId: string): InformationNeedOption[] {
  if (!parsed || typeof parsed !== 'object') return []
  const raw = (parsed as { options?: unknown }).options
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const options: InformationNeedOption[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const label = redact(record.label, 40).trim()
    const value = redact(record.value ?? record.label, 120).trim()
    if (!label || !value) continue
    const key = value.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const description = redact(record.description, 80).trim()
    options.push({
      id: `${needId}:option:${options.length + 1}`,
      label,
      value,
      ...(description ? { description } : {}),
    })
    if (options.length >= PROPOSED_OPTIONS_LIMIT) break
  }
  return options.length >= 2 ? options : []
}

function topicMatchesKnownFact(
  need: InformationNeed,
  understanding: ProjectUnderstanding,
): boolean {
  const needle = `${need.topic} ${need.missingInformation}`.toLocaleLowerCase()
  return understanding.knownFacts.some((fact) => {
    const topic = fact.topic.trim().toLocaleLowerCase()
    return (
      topic.length >= 2 &&
      (needle.includes(topic) || topic.includes(need.topic.toLocaleLowerCase()))
    )
  })
}

/** bigram 覆盖率：目标短语有多大比例出现在用户这句话里。用于「这句话在说哪一条」。 */
function phraseCoverage(haystack: string, needle: string): number {
  const target = needle.replace(/[sp{P}p{S}]+/gu, '')
  if (target.length < 2) return 0
  const source = haystack.replace(/[sp{P}p{S}]+/gu, '')
  let hits = 0
  let total = 0
  for (let index = 0; index < target.length - 1; index += 1) {
    total += 1
    if (source.includes(target.slice(index, index + 2))) hits += 1
  }
  return total === 0 ? 0 : hits / total
}

/**
 * 找出这句「修改」到底要改哪一条历史回答。
 *
 * 只有当用户确实指向了某条已确认答案（说出它的主题、问题原文或原答案）时才重定向；
 * 指不明白就返回 undefined，让答案落在当前这道题上。原实现在匹配不到时直接取
 * 「最后一条」，于是任何含「改成 / 应该是」的普通答案都会覆盖上一题的条目——
 * 用户看到的「到岗统计的答案挂在 8 周周期下面」正是这么产生的。
 */
function resolveEditTarget(
  editIntent: ClassifiedClarificationIntent,
  ledger: ClarificationLedger,
): { entry: ClarificationLedgerEntry; named: boolean } | undefined {
  const entries = liveEntries(ledger)
  if (entries.length === 0) return undefined
  if (editIntent.targetNeedId) {
    const explicit = entries.find((entry) => entry.needId === editIntent.targetNeedId)
    if (explicit) return { entry: explicit, named: true }
  }
  let best: ClarificationLedgerEntry | undefined
  let bestScore = 0
  for (const entry of entries) {
    const answerText = Array.isArray(entry.answer)
      ? entry.answer.join(' ')
      : String(entry.answer ?? '')
    const score = Math.max(
      phraseCoverage(editIntent.text, entry.topic),
      phraseCoverage(editIntent.text, entry.questionSummary),
      textSimilarity(editIntent.text, entry.topic),
      answerText.length >= 2 && editIntent.text.includes(answerText) ? 0.8 : 0,
    )
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }
  if (best && bestScore >= EDIT_TARGET_MIN_SIMILARITY) return { entry: best, named: true }
  // 没点名要改哪一题。触发词本身已经要求明确回指（「刚才…说错了」「我想修改之前的回答」），
  // 所以落到最近一条已确认答案上是合理的默认——但必须**说出来**：
  // 猜错时用户能立刻看见并纠正，而不是像原来那样悄悄写到别的题上。
  return { entry: entries[entries.length - 1]!, named: false }
}

export default class AdaptiveClarificationService {
  constructor(
    private readonly selector = new InformationNeedSelector(),
    private readonly composer = new PlainQuestionComposer(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  classifyResponse(text: string): MultiIntentUserResponse {
    const value = redact(text.trim(), 1_000)
    const intents: ClassifiedClarificationIntent[] = []
    const answerPart = value.split(/[。；;？?]/u)[0]?.trim() ?? ''
    // unknown 只看**第一个逗号之前**那一小段。原实现在整段话上匹配「不确定」，
    // 于是「大概 5 个人，具体分工还不确定」被整条记成「待决定」——
    // 用户明明给了 5 个人，这个数字连同后面的补充一起被丢掉了。
    const leadClause = answerPart.split(/[，,]/u)[0]?.trim() ?? ''
    if (ASK_WHY_PATTERN.test(value)) {
      intents.push({ intent: 'ask_why', text: value, confidence: 0.98 })
    }
    if (ASK_MEANING_PATTERN.test(value)) {
      intents.push({ intent: 'ask_meaning', text: value, confidence: 0.98 })
    }
    if (REQUEST_RECOMMENDATION_PATTERN.test(value)) {
      intents.push({ intent: 'request_recommendation', text: value, confidence: 0.96 })
    }
    if (REQUEST_OPTIONS_PATTERN.test(value)) {
      intents.push({ intent: 'request_options', text: value, confidence: 0.95 })
    }
    if (UNKNOWN_PATTERN.test(leadClause)) {
      intents.push({ intent: 'unknown', text: value, confidence: 0.98 })
    }
    if (EDIT_ANSWER_PATTERN.test(value)) {
      const replacement =
        value
          .split(/改成|改[为為]|[应應][该該]是|更正[为為]|：|:/u)
          .pop()
          ?.trim() || value
      intents.push({
        intent: 'edit_answer',
        text: value,
        extractedValue: replacement,
        confidence: 0.85,
      })
    }
    if (ADD_CONTEXT_PATTERN.test(value)) {
      intents.push({ intent: 'add_context', text: value, confidence: 0.78 })
    }
    const followUpOnly = intents.some((item) =>
      ['ask_why', 'ask_meaning', 'request_recommendation', 'request_options'].includes(item.intent),
    )
    const firstClauseIsFollowUp = FIRST_CLAUSE_FOLLOW_UP_PATTERN.test(answerPart)
    // 原实现只在命中已知关键词时才不记为答案，其余任何自由文本都会被兜底成 answer——
    // 用户向 AI 提问（「这题要怎么办？」「可以给我选项吗」）会被原样写进 ledger。
    // 首句本身就是问句时一律不作答，改走解释路径。
    const firstClauseIsQuestion =
      /^[^。；;]*?[？?]/u.test(value) || /[吗嗎呢][？?]?$/u.test(answerPart)
    if (
      !intents.some((item) => item.intent === 'unknown') &&
      !intents.some((item) => item.intent === 'edit_answer') &&
      answerPart &&
      !firstClauseIsQuestion &&
      (!followUpOnly || !firstClauseIsFollowUp)
    ) {
      const numeric = /^\s*(\d+(?:\.\d+)?)\s*(?:人|个|個|万|萬|元|天|周|週|月)?\s*$/u.exec(
        answerPart,
      )
      intents.unshift({
        intent: 'answer',
        text: answerPart,
        extractedValue: numeric ? Number(numeric[1]) : answerPart,
        confidence: followUpOnly ? 0.75 : 0.9,
      })
    }
    // 是问句但没命中任何已知关键词：当作「没听懂这题」，回一段白话解释，
    // 比兜底成 add_context 的「已保留这段背景」更贴近用户真正想要的东西。
    if (intents.length === 0 && firstClauseIsQuestion) {
      intents.push({ intent: 'ask_meaning', text: value, confidence: 0.6 })
    }
    if (intents.length === 0) {
      intents.push({ intent: 'add_context', text: value, confidence: 0.65 })
    }
    return { text: value, intents }
  }

  async start(input: {
    gateway: AIGateway | QuestionGateway
    rawInput: string
    /** 上次起草时用户给出的团队（跨生成记忆），追问团队时作为「沿用上次」选项。 */
    lastTeam?: string | null
    /** 长需求的整理稿（超过 8,000 字时）：交给模型读它，判断开工日 / 工期 / 团队仍用原文。 */
    requirementBrief?: string | null
  }): Promise<AdaptiveClarificationSession> {
    const ledger: ClarificationLedger = {
      schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
      revision: 0,
      entries: [],
    }
    let understanding: ProjectUnderstanding
    try {
      understanding = await this.analyzeUnderstanding({
        gateway: input.gateway,
        rawInput: requirementTextForPrompt(input.rawInput, input.requirementBrief),
        ledger,
        knownUnknowns: [],
        previous: null,
      })
    } catch (error) {
      return {
        schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
        sessionId: randomUUID(),
        round: 1,
        understanding: {
          schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
          summaryForUser: redact(input.rawInput, 600),
          inferredDomainLabel: '待人工确认的项目',
          likelyDeliverables: [],
          knownFacts: [],
          informationNeeds: [],
          sufficientForPreliminaryDraft: false,
        },
        ledger,
        knownUnknowns: [],
        conversation: null,
        status: 'needs_human_review',
        guardReason: describeGuardFailure(error, '项目理解无法安全通过校验'),
      }
    }
    return this.projectSession({
      rawInput: input.rawInput,
      lastTeam: input.lastTeam ?? null,
      sessionId: randomUUID(),
      round: 1,
      understanding,
      ledger,
      knownUnknowns: [],
      previousConversation: null,
    })
  }

  async continue(input: {
    gateway: AIGateway | QuestionGateway
    rawInput: string
    /** 上次起草时用户给出的团队（跨生成记忆），追问团队时作为「沿用上次」选项。 */
    lastTeam?: string | null
    /** 长需求的整理稿（超过 8,000 字时）：交给模型读它，判断开工日 / 工期 / 团队仍用原文。 */
    requirementBrief?: string | null
    session: AdaptiveClarificationSession
    responseText: string
  }): Promise<AdaptiveClarificationSession> {
    if (input.session.round >= ADAPTIVE_CLARIFICATION_LIMITS.maxSessionRounds) {
      return {
        ...input.session,
        status: 'needs_human_review',
        guardReason: '已达到澄清安全轮次上限，请先人工检查现有答案。',
        conversation: input.session.conversation
          ? { ...input.session.conversation, status: 'needs_human_review' }
          : null,
      }
    }
    const conversation = input.session.conversation
    if (!conversation || input.session.status !== 'clarifying') return input.session
    const now = this.now().toISOString()
    const classified = this.classifyResponse(input.responseText)
    const userTurn = turn('user', 'follow_up', classified.text, now)
    const intents = classified.intents
    const answerIntent = intents.find(
      (item) => item.intent === 'answer' || item.intent === 'edit_answer',
    )
    const unknownIntent = intents.find((item) => item.intent === 'unknown')
    const need = input.session.understanding.informationNeeds.find(
      (item) => item.id === conversation.activeNeedId,
    )
    if (!need) {
      return {
        ...input.session,
        status: 'needs_human_review',
        guardReason: '当前问题与理解版本不一致，请人工检查后重试。',
      }
    }

    const helpTurns: ClarificationConversationTurn[] = []
    if (intents.some((item) => item.intent === 'ask_why')) {
      helpTurns.push(turn('assistant', 'explanation', need.whyItMatters, now))
    }
    if (intents.some((item) => item.intent === 'ask_meaning')) {
      // 「我不明白」必须换一种说法，不能把同一句 missingInformation 原样回抛——
      // 那对看不懂原问题的人等于没有回答。这里改成「拆成几件小事 + 给一个可照着写
      // 的示例」，示例按 answerKind 取，不引入任何未确认事实。
      helpTurns.push(turn('assistant', 'explanation', explainInPlainWords(need, conversation), now))
    }
    // 「给我选项」：模型当轮没给 suggestedOptions 时，为当前这题补候选项。
    // 只补选项、不推进到下一题，也不代替用户作答。
    let refreshedQuestion = conversation.activeQuestion
    if (intents.some((item) => item.intent === 'request_options')) {
      const generated = await this.proposeOptions({
        gateway: input.gateway,
        need,
        question: conversation.activeQuestion,
        rawInput: requirementTextForPrompt(input.rawInput, input.requirementBrief),
        ledger: input.session.ledger,
      })
      if (generated.length > 0) {
        refreshedQuestion = { ...conversation.activeQuestion, options: generated, allowOther: true }
        helpTurns.push(
          turn(
            'assistant',
            'explanation',
            `给你几个常见方向做参考：${generated.map((option) => option.label).join('、')}。选一个就行，都不合适就用「其他」自己写；选项只是快捷方式，不是我替你定的答案。`,
            now,
          ),
        )
      } else {
        helpTurns.push(
          turn(
            'assistant',
            'explanation',
            '这题我没法给出可靠的候选项——硬凑会变成替你编答案。直接用自己的话写一句就行，写得粗一点也没关系。',
            now,
          ),
        )
      }
    }

    let proposedAnswer: string | undefined
    if (intents.some((item) => item.intent === 'request_recommendation')) {
      // 「请给我建议」必须给出一个可以一键采用的具体答案，否则用户仍然卡在原地。
      // 有候选项就用第一个；没有候选项时不编造事实，而是提议先记为待决定事项。
      const recommendation = buildRecommendation({
        ...need,
        suggestedOptions: need.suggestedOptions ?? refreshedQuestion.options,
      })
      proposedAnswer = recommendation.proposedAnswer
      helpTurns.push(turn('assistant', 'recommendation', recommendation.text, now))
    }

    if (!answerIntent && !unknownIntent) {
      // 只有「补充背景」是本轮唯一实质意图时才回这句。否则「请给我建议」这类
      // 按钮文案里的「但…」会同时命中 add_context，让回应自相矛盾地多一段套话。
      if (helpTurns.length === 0 && intents.some((item) => item.intent === 'add_context')) {
        helpTurns.push(
          turn(
            'assistant',
            'confirmation',
            '我已经把这段背景保留在本题对话中。它还没有明确回答当前问题，所以我先不跳到下一题。',
            now,
          ),
        )
      }
      return {
        ...input.session,
        conversation: {
          ...conversation,
          activeQuestion: refreshedQuestion,
          status: proposedAnswer !== undefined ? 'awaiting_confirmation' : 'awaiting_response',
          // proposedAnswer 只是待确认的建议值；落库仍要用户显式确认（ADR 红线：AI 只建议、不自动执行）。
          ...(proposedAnswer !== undefined ? { proposedAnswer } : { proposedAnswer: undefined }),
          turns: [...conversation.turns, userTurn, ...helpTurns].slice(
            -ADAPTIVE_CLARIFICATION_LIMITS.maxTurnsPerNeed,
          ),
        },
      }
    }

    const editIntent = intents.find((item) => item.intent === 'edit_answer')
    // 只有当这句话真的指向某条历史回答时才改写它；指不明白就落在当前这道题上。
    // 旧的「找不到就取最后一条」兜底是答案错配的直接来源。
    const editTarget = editIntent ? resolveEditTarget(editIntent, input.session.ledger) : undefined
    const targetEntry = editTarget?.entry
    const targetNeedId = targetEntry?.needId ?? need.id
    const targetTopic = targetEntry?.topic ?? need.topic
    // 落点靠推断时明确告知，别让用户在「已确认」列表里自己发现答案挂错了题。
    const editNoticeTurns: ClarificationConversationTurn[] =
      editTarget && !editTarget.named
        ? [
            turn(
              'assistant',
              'confirmation',
              `你没有指明要改哪一题，我按最近一次回答处理，改的是「${targetEntry!.questionSummary}」。如果要改的是别的那一题，直接说出那题的主题即可。`,
              now,
            ),
          ]
        : []
    const nextRevision = input.session.ledger.revision + 1
    const otherEntries = input.session.ledger.entries.map((entry) =>
      entry.needId === targetNeedId ? { ...entry, status: 'superseded' as const } : entry,
    )
    let entry: ClarificationLedgerEntry
    let knownUnknowns = input.session.knownUnknowns.filter((item) => item.needId !== targetNeedId)
    if (unknownIntent) {
      const knownUnknown: KnownUnknown = {
        needId: targetNeedId,
        topic: targetTopic,
        impact: need.whyItMatters,
        recordedAt: now,
      }
      knownUnknowns = [...knownUnknowns, knownUnknown]
      entry = {
        needId: targetNeedId,
        topic: targetTopic,
        status: 'known_unknown',
        questionSummary: targetEntry?.questionSummary ?? conversation.activeQuestion.question,
        knownUnknown,
        revision: nextRevision,
        updatedAt: now,
        source: 'direct',
        coverageSlots: targetEntry ? (targetEntry.coverageSlots ?? []) : slotsForNeed(need),
      }
    } else {
      // 选项按钮提交的是模型定的 value（常常是 travel、daily_office_transport 这种
      // 机器键）。直接落库，用户在「已确认」里就只能看到一串英文标识符，模型下一轮
      // 拿到的也是同样一串。这里换回用户真正点的那个 label 再落库。
      let answer = humanizeOptionAnswer(
        normalizeAnswer(answerIntent?.extractedValue ?? answerIntent?.text),
        conversation.activeQuestion.options,
      )
      // 答题检查：规则读得懂就直接通过；读不懂（繁体、英文、错别字、抽象说法）交给模型判断与规整；
      // 答非所问时不记录，重问这一题并说明原因。改的是别的题（edit）不检查。
      if (answer !== undefined && !editIntent) {
        const checked = await this.checkAnswer({
          gateway: input.gateway,
          need,
          question: conversation.activeQuestion,
          answer: Array.isArray(answer) ? answer.join('、') : String(answer),
        })
        if (checked.kind === 'reask') {
          return {
            ...input.session,
            conversation: {
              ...conversation,
              activeQuestion: {
                ...conversation.activeQuestion,
                reason: `${checked.notice}\n${need.whyItMatters}`,
              },
              status: 'awaiting_response',
              proposedAnswer: undefined,
              turns: [
                ...conversation.turns,
                userTurn,
                turn('assistant', 'explanation', checked.notice, now),
              ].slice(-ADAPTIVE_CLARIFICATION_LIMITS.maxTurnsPerNeed),
            },
          }
        }
        if (checked.normalized !== null) answer = checked.normalized
      }
      if (answer === undefined) {
        return {
          ...input.session,
          conversation: {
            ...conversation,
            status: 'awaiting_response',
            turns: [
              ...conversation.turns,
              userTurn,
              turn('assistant', 'explanation', '我还没看出明确答案，可以换一种说法再告诉我。', now),
            ].slice(-ADAPTIVE_CLARIFICATION_LIMITS.maxTurnsPerNeed),
          },
        }
      }
      const answerText = Array.isArray(answer) ? answer.join(' ') : String(answer)
      entry = {
        needId: targetNeedId,
        topic: targetTopic,
        status: 'answered',
        questionSummary: targetEntry?.questionSummary ?? conversation.activeQuestion.question,
        answer,
        revision: nextRevision,
        updatedAt: now,
        source: 'direct',
        // 改的是历史条目时，槽位要跟着**那一题**走，不能记成当前这道题的主题，
        // 否则覆盖矩阵会把答案算到错误的槽位上。
        coverageSlots: [
          ...new Set([
            ...(targetEntry ? (targetEntry.coverageSlots ?? []) : slotsForNeed(need)),
            ...detectCoverageSlots(`${targetTopic} ${answerText}`),
          ]),
        ],
      }
    }

    // 同一段话里往往同时回答了好几件事（「12 月 31 日上线，人手大概 5 个」）。
    // 只记当前这道题，剩下的信息就等于没说过，下一轮又会被重新追问。
    const closedNeedIds = new Set([
      targetNeedId,
      need.id,
      ...input.session.ledger.entries.map((item) => item.needId),
    ])
    const absorbed = unknownIntent
      ? []
      : absorbAdditionalAnswers({
          text: classified.text,
          needs: input.session.understanding.informationNeeds,
          excludeNeedIds: [...closedNeedIds],
        })
    const absorbedEntries: ClarificationLedgerEntry[] = absorbed.map((item, index) => ({
      needId: item.need.id,
      topic: item.need.topic,
      status: 'answered' as const,
      questionSummary: item.need.missingInformation,
      answer: item.answer,
      revision: nextRevision + index + 1,
      updatedAt: now,
      // 标成 absorbed：界面会说明这是从哪句话读到的，用户一眼就能发现读错并改掉。
      source: 'absorbed' as const,
      coverageSlots: item.slots,
    }))
    const absorbTurns: ClarificationConversationTurn[] = absorbedEntries.length
      ? [
          turn(
            'assistant',
            'confirmation',
            `你这段话里还回答了：${absorbedEntries
              .map((item) => `${item.questionSummary}=${String(item.answer)}`)
              .join(
                '；',
              )}。这些我一并记下了，就不再单独问一遍；如果理解错了，说一句「我想修改之前的回答」就能改。`,
            now,
          ),
        ]
      : []

    const ledger: ClarificationLedger = {
      ...input.session.ledger,
      revision: nextRevision + absorbedEntries.length,
      entries: [
        ...otherEntries.filter(
          (item) =>
            item.needId !== targetNeedId &&
            !absorbedEntries.some((added) => added.needId === item.needId),
        ),
        entry,
        ...absorbedEntries,
      ],
    }
    let understanding: ProjectUnderstanding
    try {
      understanding = await this.analyzeUnderstanding({
        gateway: input.gateway,
        rawInput: requirementTextForPrompt(input.rawInput, input.requirementBrief),
        ledger,
        knownUnknowns,
        previous: input.session.understanding,
      })
    } catch (error) {
      return {
        ...input.session,
        round: input.session.round + 1,
        ledger,
        knownUnknowns,
        status: 'needs_human_review',
        guardReason: describeGuardFailure(error, '项目理解无法安全通过校验'),
        conversation: {
          ...conversation,
          status: 'needs_human_review',
          turns: [
            ...conversation.turns,
            userTurn,
            ...helpTurns,
            ...editNoticeTurns,
            ...absorbTurns,
          ].slice(-ADAPTIVE_CLARIFICATION_LIMITS.maxTurnsPerNeed),
        },
      }
    }
    const next = this.projectSession({
      rawInput: input.rawInput,
      lastTeam: input.lastTeam ?? null,
      sessionId: input.session.sessionId,
      round: input.session.round + 1,
      understanding,
      ledger,
      knownUnknowns,
      previousConversation: conversation,
    })
    // 检查点 A：刚答完开工日 / 工期，就查日历（假期占用、截止日落在假期、截止日早于开工日）。
    const calendarNote = timingCheckpoint({
      rawInput: input.rawInput,
      ledger,
      answeredNeedIds: [targetNeedId, ...absorbedEntries.map((item) => item.needId)],
      now: this.now(),
    })
    const calendarTurns = calendarNote ? [turn('assistant', 'explanation', calendarNote, now)] : []
    // 追问到此结束时没有下一题可附，单独带回去让就绪页显示。
    if (calendarNote) next.calendarNote = calendarNote
    if (calendarNote && next.conversation?.activeQuestion) {
      next.conversation.activeQuestion = {
        ...next.conversation.activeQuestion,
        reason: `${calendarNote}\n${next.conversation.activeQuestion.reason ?? ''}`.trim(),
      }
    }
    const carriedTurns = [...helpTurns, ...editNoticeTurns, ...absorbTurns, ...calendarTurns]
    if (carriedTurns.length > 0 && next.conversation) {
      next.conversation.turns = [userTurn, ...carriedTurns, ...next.conversation.turns].slice(
        -ADAPTIVE_CLARIFICATION_LIMITS.maxTurnsPerNeed,
      )
    }
    return next
  }

  /**
   * 从 needs_human_review 守卫态里重跑这一步。
   *
   * 守卫态之前是个死胡同：`continue()` 头一句就因为 status !== 'clarifying' 原样返回，
   * 于是带着同一个 token 怎么点都还是那句报错，只能刷新页面重头再来。这里用会话
   * 已有的 ledger / knownUnknowns 重新生成理解——已确认的答案一条都不丢。
   */
  async retryGuarded(input: {
    gateway: AIGateway | QuestionGateway
    rawInput: string
    /** 上次起草时用户给出的团队（跨生成记忆），追问团队时作为「沿用上次」选项。 */
    lastTeam?: string | null
    /** 长需求的整理稿（超过 8,000 字时）：交给模型读它，判断开工日 / 工期 / 团队仍用原文。 */
    requirementBrief?: string | null
    session: AdaptiveClarificationSession
  }): Promise<AdaptiveClarificationSession> {
    if (input.session.status !== 'needs_human_review') return input.session
    if (input.session.round >= ADAPTIVE_CLARIFICATION_LIMITS.maxSessionRounds) return input.session
    try {
      const understanding = await this.analyzeUnderstanding({
        gateway: input.gateway,
        rawInput: requirementTextForPrompt(input.rawInput, input.requirementBrief),
        ledger: input.session.ledger,
        knownUnknowns: input.session.knownUnknowns,
        previous: input.session.understanding.informationNeeds.length
          ? input.session.understanding
          : null,
      })
      return this.projectSession({
        rawInput: input.rawInput,
        lastTeam: input.lastTeam ?? null,
        sessionId: input.session.sessionId,
        round: input.session.round + 1,
        understanding,
        ledger: input.session.ledger,
        knownUnknowns: input.session.knownUnknowns,
        previousConversation: null,
      })
    } catch (error) {
      return {
        ...input.session,
        round: input.session.round + 1,
        guardReason: describeGuardFailure(error, '项目理解无法安全通过校验'),
      }
    }
  }

  /**
   * 用户点「先生成初步草案」。
   *
   * 原实现只要还有任何 blocking/high 需求就一律打回 needs_human_review。可模型每一轮
   * 都会新造 high 需求，于是这个入口**永远**打不开——用户看到的「一直说资料够了、
   * 却既继续追问又不给生成入口」就是这条判断造成的。
   *
   * 现在只有真正 blocking 的需求才拦；其余未确认项在用户显式点击这一步时转成
   * 「明确尚未决定事项」，随草案一起标为假设与风险（prompt_builder 会读它），
   * 而不是无限期地把人扣在问答里。草案本身仍要经人工审查才能转正式项目。
   */
  requestPreliminaryDraft(session: AdaptiveClarificationSession): AdaptiveClarificationSession {
    if (session.status === 'needs_human_review') return session
    const readiness = this.evaluateDraftReadiness(session)
    if (!readiness.canGenerate) {
      return {
        ...session,
        status: 'needs_human_review',
        guardReason: readiness.reason,
        conversation: session.conversation
          ? { ...session.conversation, status: 'needs_human_review' }
          : null,
      }
    }
    const ranked = readiness.ranked
    const now = this.now().toISOString()
    const alreadyDeferred = new Set(session.knownUnknowns.map((item) => item.needId))
    const deferred: KnownUnknown[] = ranked
      .filter((item) => !alreadyDeferred.has(item.need.id))
      .slice(0, 10)
      .map((item) => ({
        needId: item.need.id,
        topic: item.need.topic,
        impact: item.need.whyItMatters,
        recordedAt: now,
      }))
    return {
      ...session,
      status: 'ready',
      knownUnknowns: [...session.knownUnknowns, ...deferred],
      conversation: null,
    }
  }

  /**
   * 回答是否在答这道题（2026-09-28）。
   * 1. 点的是选项：直接通过；
   * 2. 开工日 / 工期 / 团队：规则读得懂就通过（快、确定）；
   * 3. 其余情况交给模型：用户可能写繁体、英文、错别字、同音字或很抽象的说法，模型按本意理解并规整成简体中文；
   *    判定答非所问就重问。模型判断失败时照常记录（不因检查本身出错卡住用户）。
   */
  async checkAnswer(input: {
    gateway: AIGateway | QuestionGateway
    need: InformationNeed
    question: QuestionCardProposal
    answer: string
  }): Promise<{ kind: 'accept'; normalized: string | null } | { kind: 'reask'; notice: string }> {
    const answer = input.answer.trim()
    const options = input.question.options ?? []
    if (
      options.some(
        (option) => option.label.trim() === answer || String(option.value).trim() === answer,
      )
    ) {
      return { kind: 'accept', normalized: null }
    }
    const now = this.now()
    const isCore = (Object.values(CORE_NEED_IDS) as string[]).includes(input.need.id)
    if (isCore) {
      const ruled = checkCoreAnswer(input.need.id, answer, now, options)
      if (ruled !== null) return { kind: 'accept', normalized: ruled === answer ? null : ruled }
    }
    const expectation = coreAnswerExpectation(input.need.id)
    // 判断偶尔解析失败（模型输出不是合法 JSON）：重试一次。
    const judged =
      (await this.judgeAnswer({ ...input, answer, now })) ??
      (await this.judgeAnswer({ ...input, answer, now }))
    const quoted = answer.length > 40 ? `${answer.slice(0, 40)}…` : answer
    const defaultNotice = `你刚才的回答「${quoted}」看起来不是在回答这一题。我想请你回答：${expectation ?? input.question.question}`
    if (judged?.verdict === 'off_topic') {
      return { kind: 'reask', notice: judged.notice || defaultNotice }
    }
    if (isCore) {
      // 核心题必须落成程序读得懂的日期 / 时长 / 人数，否则排不了计划。
      // 模型已判定答到：只核对规整结果程序读不读得懂（不再要求「只剩虚词」）。
      const again = judged?.normalized
        ? checkCoreAnswer(input.need.id, judged.normalized, now, options, false)
        : null
      if (again !== null) return { kind: 'accept', normalized: again }
      // 核心题程序读不懂、模型也判断失败：放行只会被悄悄换成默认值，不如直接说明需要什么。
      return {
        kind: 'reask',
        notice:
          judged?.notice ||
          `我还没能从「${quoted}」里读出${expectation ? '需要的信息' : '答案'}。请告诉我${expectation ?? input.question.question}`,
      }
    }
    return { kind: 'accept', normalized: judged?.normalized || null }
  }

  private async judgeAnswer(input: {
    gateway: AIGateway | QuestionGateway
    need: InformationNeed
    question: QuestionCardProposal
    answer: string
    now: Date
  }): Promise<{
    verdict: 'answered' | 'off_topic' | 'unsure'
    normalized: string | null
    notice: string | null
  } | null> {
    const today = new Date(todayAnchor(input.now))
    const weekday = '日一二三四五六'[today.getUTCDay()]
    const systemPrompt = [
      '你在检查用户对一道澄清问题的回答。只输出 JSON：{"verdict":"answered|off_topic|unsure","normalized":"…","notice":"…"}。',
      '用户可能用简体、繁体、英文或其他语言作答，可能有错别字、同音字、输入法选错字——一律按本意理解，不因写法挑错。',
      'verdict：answered = 回答了这题（哪怕只答一部分、说得模糊、或给了条件，如「等预算批下来就开工」）；off_topic = 和这题无关（如问开工日期却说想吃汉堡）；unsure = 看不出来。',
      'normalized：把回答规整成简体中文，纠正错别字、繁体转简体、外语译成中文，不增加用户没说的内容。',
      `问日期时尽量写成 YYYY-MM-DD（今天是 ${today.toISOString().slice(0, 10)}，星期${weekday}；「后天」= 今天 + 2 天）；问时长写成「N 天 / 周 / 个月」；问团队写成「角色 人数」列表。实在给不出具体值就保留规整后的原意。`,
      `「国庆后」「收假后」「春节后」这类说法按下面的中国法定假日推算为假期结束后的第一个工作日：${upcomingCalendarFacts(input.now).join('；') || '（无）'}。`,
      `日期对照表（程序生成，以此为准；「下周三」「下下周五」直接查表，不要自己推算星期；查到的那天放假就如实写「YYYY-MM-DD（放假，顺延到 YYYY-MM-DD）」）：\n${calendarTable(input.now).join('\n')}`,
      'notice：只有 off_topic、或问日期 / 时长 / 团队却给不出具体值时才写，一句话、用简体中文：先说刚才的回答为什么还不能用，再通俗地说明需要什么（可以举一个例子）。其余情况留空字符串。',
    ].join('\n')
    const userPrompt = JSON.stringify({
      question: input.question.question,
      whyItMatters: input.need.whyItMatters,
      options: (input.question.options ?? []).map((option) => option.label),
      answer: redact(input.answer, 1_000),
    })
    try {
      // 带计划工具箱：「国庆后第三个工作日」「下下周五」这类要算的，模型可以先让程序算准再规整；
      // 不需要算时和普通调用一样只有一次。
      const generated = await generateWithPlanningTools({
        gateway: input.gateway,
        systemPrompt,
        userPrompt,
        sentence: '检查回答是否对题',
        promptName: 'intent.answer_check',
        now: input.now,
        temperature: 0,
        maxRounds: 3,
        // 推理模型的思考过程也算在输出额度里
        maxOutputTokens: 2_000,
        signal: AbortSignal.timeout(45_000),
      })
      const parsed = generated.answer
      if (!parsed || typeof parsed !== 'object') return null
      const verdict =
        parsed.verdict === 'off_topic' || parsed.verdict === 'answered' ? parsed.verdict : 'unsure'
      const normalized =
        typeof parsed.normalized === 'string' ? parsed.normalized.trim().slice(0, 1_000) : ''
      const notice = typeof parsed.notice === 'string' ? parsed.notice.trim().slice(0, 300) : ''
      return { verdict, normalized: normalized || null, notice: notice || null }
    } catch {
      return null
    }
  }

  private async analyzeUnderstanding(input: {
    gateway: AIGateway | QuestionGateway
    rawInput: string
    ledger: ClarificationLedger
    knownUnknowns: KnownUnknown[]
    previous: ProjectUnderstanding | null
  }): Promise<ProjectUnderstanding> {
    const confirmed = liveEntries(input.ledger).filter((entry) => entry.status === 'answered')
    const matrix = buildCoverageMatrix(input.ledger)
    const covered = coveredSlots(matrix)
    const stillOpen = matrix.filter((item) => item.status === 'open').map((item) => item.slot)
    const userPrompt = JSON.stringify({
      originalIntent: redact(input.rawInput, 24_000),
      confirmedAnswers: confirmed.slice(-30).map((entry) => ({
        needId: entry.needId,
        topic: entry.topic,
        answer: redact(entry.answer),
      })),
      knownUnknowns: input.knownUnknowns.slice(-20).map((item) => ({
        needId: item.needId,
        topic: item.topic,
        impact: redact(item.impact),
      })),
      previousQuestionSummary: input.ledger.entries
        .slice(-30)
        .map((entry) => ({ needId: entry.needId, question: redact(entry.questionSummary, 240) })),
      previousSummary: input.previous ? redact(input.previous.summaryForUser, 600) : null,
      // 覆盖矩阵直接进提示词：模型每一轮都是重新生成 needs，只靠 needId 去重挡不住
      // 「换个 id 再问一遍同一件事」。把「哪些主题已经问清楚了」写明白，从源头减少重复。
      coverage: {
        alreadyCovered: covered.map(coverageSlotLabel),
        stillOpen: stillOpen.map(coverageSlotLabel),
        confirmedCount: confirmed.length,
      },
    })
    const systemPrompt = [
      '你负责理解任意类型的项目，并找出会实质改变计划的信息缺口。不要使用固定行业问卷。',
      '只输出一个 JSON 对象，不要输出 Markdown、工具调用或额外字段。',
      `schemaVersion 必须是 ${ADAPTIVE_CLARIFICATION_SCHEMA_VERSION}。`,
      '顶层字段仅允许 schemaVersion,summaryForUser,inferredDomainLabel,intendedOutcome,likelyDeliverables,knownFacts,informationNeeds,sufficientForPreliminaryDraft。',
      'informationNeeds 每项仅允许 id,topic,missingInformation,decisionImpact,whyItMatters,priority,answerKind,suggestedOptions,dependsOn,confidence,uncertainty,userEffort,sensitivity。',
      'knownFacts 每项必须且只能包含 id,topic,value,evidence,confidence,source；source 只能是 initial_intent、confirmed_answer 或 user_context。没有 known fact 时返回空数组。',
      'priority=blocking|high|useful|optional；answerKind=single_choice|multi_choice|date|number|money|short_text。',
      'decisionImpact 只能使用 scope,deliverable,schedule,resource,dependency,risk,acceptance。',
      '每个 informationNeed 都必须提供 0..1 的 confidence 与 uncertainty、userEffort=low|medium|high、sensitivity=none|low|high。',
      'suggestedOptions 每项必须且只能包含 id,label,value，可选 description；没有选项时省略该字段，不要返回 null。dependsOn 同理。',
      // P2：原先只有选择题被要求给选项，于是日期/人数/金额题永远只能靠「其他」手写。
      '每一个 informationNeed 都要给 2..4 个 suggestedOptions，包括 date、number、money、short_text 类型——给常见的时间点、人数档、金额区间或做法，让用户点一下就能作答。',
      '选项必须覆盖这道题问的全部内容：一个选项就是这道题的一个完整答案，不能只答一半。',
      '一个 informationNeed 只能问一件事。需要同时确认上线时间和人手时，拆成两条独立的 informationNeed，不要合并成一句话提问。',
      'suggestedOptions 可以带常见的参考档次（人数、金额区间、时长等），优先给区间而不是精确单点；但不要编造具体公司名、系统名、人名或内部流程名。',
      '所有数组不得包含 null；所有必填字符串不得为空；任何可选字段没有值时直接省略，禁止用 null 占位。',
      '不要再次提出 confirmedAnswers 或 knownUnknowns 已覆盖的信息；不要索取密码、API key、Authorization 或不必要个人信息。',
      // 收敛约束：这三条直接对应「资料够了却还在追问、生成入口不开」。
      'coverage.alreadyCovered 里的主题已经问清楚了：除非要问的是同一主题下明显更细、且此前从未问过的缺口，否则不要再为它出题；同一主题绝不重复提问。',
      '只有会实质改变计划的缺口才配 blocking 或 high；「知道了更好」一律用 useful 或 optional。',
      '当 originalIntent 加上 confirmedAnswers 已经足以排出一版粗略计划时，sufficientForPreliminaryDraft 必须为 true，并且不要再输出 blocking/high 需求。',
      'topic/id 供存储使用；missingInformation 与 whyItMatters 使用普通人能懂的简体中文。',
    ].join('\n')

    const startedAt = Date.now()
    const deadline = startedAt + CLARIFICATION_ROUND_TIMEOUT_MS
    let schemaAttempts = 0
    let transportAttempts = 0
    let lastIssues: AdaptiveValidationIssue[] = []
    let lastErrors: string[] = []
    let lastInvalidOutput = ''
    // 结构修复与传输故障各有各的预算：把 500 过载算进「修复次数」，
    // 只会让每次重试都带上越来越长的修复提示词，等待更久、还修不了任何东西。
    while (
      schemaAttempts <= ADAPTIVE_CLARIFICATION_LIMITS.maxRepairAttempts &&
      transportAttempts <= MAX_TRANSPORT_RETRIES
    ) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        lastErrors = [
          ...lastErrors,
          `round_timeout(超过 ${CLARIFICATION_ROUND_TIMEOUT_MS} 毫秒仍未取回可用结果)`,
        ]
        break
      }
      const repairing = schemaAttempts > 0 && lastIssues.length > 0
      const generated = await input.gateway.generate({
        signal: AbortSignal.timeout(Math.min(CLARIFICATION_ATTEMPT_TIMEOUT_MS, remaining)),
        sentence: repairing ? '修复结构化项目理解输出' : '分析项目理解与信息缺口',
        promptSet: {
          systemPrompt,
          userPrompt: repairing
            ? JSON.stringify({
                originalRequest: JSON.parse(userPrompt),
                invalidOutput: lastInvalidOutput,
                validationErrors: lastErrors,
                validationDetails: lastIssues.slice(0, 20),
                repairInstruction: buildRepairInstruction(lastIssues),
              })
            : userPrompt,
        },
        strategy: 'prompt',
        temperature: 0.1,
        // 出题时要求每题都带 2..4 个候选项，输出比原先长；容量不足会被截断，
        // 截断后 JSON 一定解析不出来，白白烧掉几轮重试。
      })
      if (generated.triggeredErrors.length > 0) {
        lastErrors = generated.triggeredErrorMessages?.length
          ? generated.triggeredErrors.map(
              (kind, index) => `${kind}(${generated.triggeredErrorMessages![index] ?? '无详情'})`,
            )
          : generated.triggeredErrors
        // 模型仍然吐出了可用文本时（例如尾部截断），先按结构问题走本地修复，
        // 不要因为一条错误事件就把整段输出丢掉。
        if (!generated.rawText.trim()) {
          transportAttempts += 1
          if (transportAttempts > MAX_TRANSPORT_RETRIES) break
          await this.backoff(transportAttempts, deadline)
          continue
        }
      }
      const extracted = extractObject(generated.rawText)
      // 先在本地把机械性形状问题修好：null 占位、decisionImpact 写成字符串、
      // 缺 confidence/sensitivity、选项缺 value ——这些全都不需要再问一次模型。
      const repaired = repairProjectUnderstandingShape(extracted ?? generated.rawText)
      const validation = validateProjectUnderstanding(repaired)
      if (!validation.success || !validation.data) {
        lastErrors = validation.errors
        lastIssues = validation.details ?? []
        lastInvalidOutput = redact(generated.rawText, 8_000)
        schemaAttempts += 1
        continue
      }
      return this.filterCoveredNeeds(validation.data, input.ledger)
    }
    throw new QuestionRewriteFailure(
      `项目理解连续校验失败：${[...new Set(lastErrors)].join(',')}${formatIssueSuffix(lastIssues)}`,
    )
  }

  /** 传输类故障（过载、超时、断流）的退避。指数退避，封顶避免把用户晾太久。 */
  private async backoff(attempt: number, deadline: number): Promise<void> {
    const delay = Math.min(
      TRANSPORT_BACKOFF_MAX_MS,
      TRANSPORT_BACKOFF_BASE_MS * 2 ** (attempt - 1),
      Math.max(0, deadline - Date.now()),
    )
    if (delay <= 0) return
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  /**
   * 丢掉「已经问过」的需求。
   *
   * 原实现只按 needId 去重。可 needId 是模型每轮重新生成的，换个 id 就是一条新需求，
   * 于是同一个主题可以被无限重问——用户报的「重复追问相同信息」有一半出在这里。
   * 现在按主题相似度与覆盖矩阵判定，同时保留「同主题下更细的缺口」。
   */
  private filterCoveredNeeds(
    understanding: ProjectUnderstanding,
    ledger: ClarificationLedger,
  ): ProjectUnderstanding {
    const closed = new Set(ledger.entries.map((entry) => entry.needId))
    const informationNeeds = understanding.informationNeeds.filter((need) => {
      if (closed.has(need.id)) return false
      if (topicMatchesKnownFact(need, understanding)) return false
      return assessNeedAgainstLedger(need, ledger).verdict !== 'repeat'
    })
    return { ...understanding, informationNeeds }
  }

  /**
   * 「我不了解这道题」的真实解释，流式输出。
   *
   * 原来的 explainInPlainWords 是本地模板，措辞永远一样、也答不了追问——用户看两次
   * 就知道是套话。这里改为真正过一次模型，并带上本题的上下文与之前的追问，
   * 让用户可以就这道题一直问下去。
   *
   * 边界：只解释、不作答。这条链路完全不碰 ledger，也不会推进到下一题，
   * 所以无论用户问什么都不可能被记成答案。
   */
  async *explainQuestion(input: {
    gateway: AIGateway
    need: InformationNeed
    question: QuestionCardProposal
    rawInput: string
    ledger: ClarificationLedger
    /** 本题此前的解释对话，用于支持追问。 */
    history: { role: 'user' | 'assistant'; text: string }[]
    /** 用户这次想问的；为空表示「先整体解释一下这道题」。 */
    userQuestion: string
    signal?: AbortSignal
  }): AsyncGenerator<string> {
    const systemPrompt = [
      '你在帮一个不熟悉项目管理术语的人理解「当前这一道澄清问题」。',
      '用简体中文、口语化地解释：这题到底在问什么、为什么会影响计划、可以从哪几个角度回答。',
      '可以举例说明一个像样的回答长什么样，但要明确标成「举例」，不要说成用户的实际情况。',
      '不知道的事就说不知道，绝不编造用户公司的制度、系统、金额或日期。',
      '不要替用户作答，也不要催他作答；他随时可以用自己的话回答，或者说还不确定。',
      '直接输出解释正文，不要用 JSON、不要加标题、不要重复问题原文。控制在 300 字以内。',
    ].join('\n')
    const userPrompt = JSON.stringify({
      question: redact(input.question.question, 400),
      whyItMatters: redact(input.need.whyItMatters, 400),
      answerKind: input.need.answerKind,
      options: (input.question.options ?? []).map((option) => redact(option.label, 60)),
      projectIntent: redact(input.rawInput, 8_000),
      alreadyAnswered: input.ledger.entries
        .filter((entry) => entry.status === 'answered')
        .slice(-8)
        .map((entry) => ({ topic: entry.topic, answer: redact(entry.answer, 120) })),
      previousExchanges: input.history.slice(-8).map((item) => ({
        role: item.role,
        text: redact(item.text, 600),
      })),
      userQuestion: input.userQuestion.trim()
        ? redact(input.userQuestion, 600)
        : '我不了解这道题，请先整体解释一下。',
    })

    for await (const chunk of input.gateway.stream({
      sentence: '解释当前澄清问题',
      promptSet: { systemPrompt, userPrompt },
      strategy: 'prompt',
      temperature: 0.3,
      ...(input.signal ? { signal: input.signal } : {}),
    })) {
      if (chunk.kind === 'text' && chunk.text) yield chunk.text
      if (chunk.kind === 'error') {
        throw new Error(chunk.errorMessage || '模型解释失败')
      }
    }
  }

  /**
   * 为当前这道题补候选项（对应 request_options 意图）。
   * 对所有 answerKind 都生成：人数、金额、日期这类问题给常见参考档次反而最好选，
   * 且「其他」恒开、候选项必须用户点选才生效，不构成被断言的事实。
   */
  private async proposeOptions(input: {
    gateway: AIGateway | QuestionGateway
    need: InformationNeed
    question: QuestionCardProposal
    rawInput: string
    ledger: ClarificationLedger
  }): Promise<InformationNeedOption[]> {
    const systemPrompt = [
      '你要为一道项目澄清问题补几个候选答案，帮不熟悉这个领域的人快速作答。',
      '只输出一个 JSON 对象：{"options":[{"id":"...","label":"...","value":"...","description":"..."}]}。不要输出 Markdown、工具调用或额外字段。',
      `最少 2 个、最多 ${PROPOSED_OPTIONS_LIMIT} 个，彼此互斥并覆盖常见情况。`,
      '候选项可以带具体档次（人数、金额区间、时长等），但必须是该类项目里常见的参考档，并优先给区间而不是精确单点；用户随时可以用「其他」写自己的答案。',
      '不要编造只有用户才知道的专有事实：具体公司名、系统名、人名、内部流程名一律不要出现。',
      '除档次型选项外，也可以给「沿用现有做法」「需要在系统里可配置」「先不处理，之后再定」这类做法型选项。',
      'label 与 value 用普通人能懂的简体中文；label 不超过 20 字；description 可选、不超过 40 字，说明选它意味着什么。',
      'id 用简短英文小写加下划线。',
    ].join('\n')
    const userPrompt = JSON.stringify({
      question: redact(input.question.question, 400),
      whyItMatters: redact(input.need.whyItMatters, 400),
      answerKind: input.need.answerKind,
      originalIntent: redact(input.rawInput, 8_000),
      confirmedAnswers: input.ledger.entries
        .filter((entry) => entry.status === 'answered')
        .slice(-10)
        .map((entry) => ({ topic: entry.topic, answer: redact(entry.answer, 160) })),
    })

    try {
      const generated = await input.gateway.generate({
        sentence: '为当前澄清问题补充候选项',
        promptSet: { systemPrompt, userPrompt },
        strategy: 'prompt',
        temperature: 0.2,
      })
      if (generated.triggeredErrors.length > 0) return []
      const parsed = extractObject(generated.rawText)
      return normalizeProposedOptions(parsed, input.need.id)
    } catch {
      // 补选项是锦上添花：模型不可用时保持原样，不要让整轮澄清失败。
      return []
    }
  }

  /**
   * 「现在能不能去生成初步草案」的唯一判据。
   *
   * 界面上的入口按钮和服务端的 requestPreliminaryDraft 必须用同一个函数，
   * 否则会出现「按钮亮着但点了被拒」或者反过来的情况。
   */
  private evaluateDraftReadiness(input: {
    understanding: ProjectUnderstanding
    ledger: ClarificationLedger
    knownUnknowns: KnownUnknown[]
  }): {
    ranked: RankedInformationNeed[]
    unresolvedHigh: RankedInformationNeed[]
    unresolvedBlocking: RankedInformationNeed[]
    coverage: ClarificationCoverageEntry[]
    openCore: ClarificationCoverageSlot[]
    confirmedCount: number
    reachedQuestionCap: boolean
    canGenerate: boolean
    /** 已确认的资料足够、可以直接收尾去生成草案，不必再问下去。 */
    shouldFinish: boolean
    reason: string
  } {
    const ranked = this.selector.rank({
      needs: input.understanding.informationNeeds,
      ledger: input.ledger,
      knownUnknowns: input.knownUnknowns,
    })
    // 用 effectivePriority，不用模型给的 priority：主题已经答过、只是问得更细的需求
    // 会被降级，不再有资格挡住生成入口。否则模型每轮新造一个 high 就能无限拖住用户。
    const unresolvedHigh = ranked.filter((item) =>
      ['blocking', 'high'].includes(item.effectivePriority),
    )
    const coverage = buildCoverageMatrix(input.ledger)
    const openCore = openCoreSlots(coverage)
    const confirmedCount = liveEntries(input.ledger).length
    const coreCovered = openCore.length === 0 && confirmedCount >= MIN_CONFIRMED_FOR_DRAFT
    const reachedQuestionCap = confirmedCount >= MAX_QUESTIONS_BEFORE_DRAFT
    // 四条独立依据，任何一条成立就放行：
    // 1. 没有还没覆盖过的高优先级缺口；
    // 2. 模型自己判断资料够了——它说了这句话就必须给出口，不能只说不放行；
    // 3. 关键槽位齐了；
    // 4. 已经问满上限，再问只是拖时间。
    const unresolvedBlocking = ranked.filter((item) => item.effectivePriority === 'blocking')
    // blocking 是「不确认就排不出计划」，任何情况下都要拦住；
    // high 及以下只影响精细度，不该把生成入口永久关死。
    const canGenerate =
      unresolvedBlocking.length === 0 &&
      (unresolvedHigh.length === 0 ||
        input.understanding.sufficientForPreliminaryDraft ||
        coreCovered ||
        reachedQuestionCap)
    // 自动收尾：不是「能生成」就停，而是「已确认的资料确实够了」才停。
    // 判据全部来自 ledger 里的确认事实（关键槽位齐了 / 问满上限），
    // 只有模型的一句 sufficient 需要配合「没有未覆盖的高优先级缺口」才算数——
    // 否则模型一边说够了一边源源不断造新需求，用户永远走不到生成那一步。
    // 模型自己的问题：已答几道、还有几道值得问（useful 及以上）。
    const modelAnswered = liveEntries(input.ledger).filter(
      (entry) => !entry.needId.startsWith('core.'),
    ).length
    const askableModel = ranked.filter(
      (item) =>
        !item.need.id.startsWith('core.') &&
        ['blocking', 'high', 'useful'].includes(item.effectivePriority),
    ).length
    const qualityQuestionsDone =
      modelAnswered >= Math.min(MODEL_QUALITY_QUESTIONS, modelAnswered + askableModel)
    const shouldFinish =
      unresolvedBlocking.length === 0 &&
      (reachedQuestionCap ||
        (qualityQuestionsDone &&
          ((unresolvedHigh.length === 0 && input.understanding.sufficientForPreliminaryDraft) ||
            coreCovered)))
    const reason = canGenerate
      ? reachedQuestionCap && unresolvedHigh.length > 0
        ? '已确认的资料够开工了。继续问只会拖时间，剩下的会明确列为假设与待决定事项。'
        : '关键资料已确认；尚未决定的内容会明确列为假设、待决定事项或风险，并继续经过人工审查。'
      : unresolvedBlocking.length > 0
        ? `还有 ${unresolvedBlocking.length} 项不确认就排不出计划的信息（${unresolvedBlocking
            .slice(0, 3)
            .map((item) => item.need.topic)
            .join('、')}）。可以先回答，或对每一项选「还不确定」把它记成待决定事项后再生成。`
        : `还差 ${unresolvedHigh.length} 项会显著改变计划的信息${
            openCore.length > 0 ? `（${openCore.map(coverageSlotLabel).join('、')}）` : ''
          }。可以先回答，或者对每一项选「还不确定」把它记成待决定事项后再生成。`
    return {
      ranked,
      unresolvedHigh,
      unresolvedBlocking,
      coverage,
      openCore,
      confirmedCount,
      reachedQuestionCap,
      canGenerate,
      shouldFinish,
      reason,
    }
  }

  private projectSession(input: {
    sessionId: string
    round: number
    understanding: ProjectUnderstanding
    ledger: ClarificationLedger
    knownUnknowns: KnownUnknown[]
    previousConversation: ClarificationConversationState | null
    /** 原始需求：判断核心问题（开始日期 / 工期 / 团队）是否已在原话里给出。 */
    rawInput: string
    lastTeam?: string | null
  }): AdaptiveClarificationSession {
    // 模型决定问什么之外，确定性补上生成前必问的核心信息（见 core_information_needs.ts）
    const understanding = withCoreInformationNeeds({
      understanding: input.understanding,
      ledger: input.ledger,
      rawInput: input.rawInput,
      now: this.now(),
      lastTeam: input.lastTeam ?? null,
    })
    input = { ...input, understanding }
    const readiness = this.evaluateDraftReadiness(input)
    const { ranked, coverage, confirmedCount } = readiness
    // 核心问题之间按自然顺序问：先开工日、再工期、再团队（排序器按信息价值打分，
    // 实测会先问工期再问开工日，用户体验像是在倒着排）。
    const coreOrder: string[] = [
      CORE_NEED_IDS.startDate,
      CORE_NEED_IDS.duration,
      CORE_NEED_IDS.team,
    ]
    const top = ranked[0]?.need ?? null
    const active =
      top && coreOrder.includes(top.id)
        ? (coreOrder
            .map((id) => ranked.find((item) => item.need.id === id)?.need)
            .find((need) => need !== undefined) ?? top)
        : top
    // 资料够了就直接收尾进入草案生成，而不是「嘴上说够了、还继续追问」。
    if (!active || readiness.shouldFinish) {
      return {
        schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
        sessionId: input.sessionId,
        round: input.round,
        understanding: input.understanding,
        ledger: input.ledger,
        knownUnknowns: input.knownUnknowns,
        conversation: null,
        status: 'ready',
      }
    }
    // 某一题的措辞实在过不了检查时换下一题问，而不是让整轮追问停在「需人工检查」：
    // 实测一道列举式问句连续改写失败后会话卡死，前端只能反复重新请求。
    const candidates = [
      active,
      ...ranked.map((item) => item.need).filter((need) => need !== active),
    ]
    let composed: { need: InformationNeed; question: QuestionCardProposal } | null = null
    let composeError: unknown = null
    for (const candidate of candidates) {
      try {
        composed = { need: candidate, question: this.composer.compose(candidate) }
        break
      } catch (error) {
        composeError ??= error
      }
    }
    if (!composed && readiness.canGenerate) {
      return {
        schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
        sessionId: input.sessionId,
        round: input.round,
        understanding: input.understanding,
        ledger: input.ledger,
        knownUnknowns: input.knownUnknowns,
        conversation: null,
        status: 'ready',
      }
    }
    try {
      if (!composed) throw composeError
      const activeQuestion = composed.question
      const activeNeed = composed.need
      const now = this.now().toISOString()
      const dynamicReason = input.previousConversation
        ? `根据刚才的回答，当前还有约 ${ranked.length} 个会影响计划的信息需要确认。`
        : '问题会根据你的回答调整，不承诺固定总数。'
      const conversation: ClarificationConversationState = {
        schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
        activeNeedId: activeNeed.id,
        activeQuestion,
        status: 'awaiting_response',
        turns: [turn('assistant', 'question', activeQuestion.question, now)],
        understandingRevision: input.round,
        ledgerRevision: input.ledger.revision,
        completedCount: confirmedCount,
        remainingEstimate: ranked.length,
        // 左侧「澄清进度」直接渲染这三个数，三项之和恒等于 remainingEstimate。
        // 原先左侧数的是固定字段 cards（自适应链路里恒为空数组），所以永远显示 0/0/0，
        // 而右侧显示的是这里的 remainingEstimate——两边根本不是同一个来源。
        remainingBreakdown: {
          critical: ranked.filter((item) => ['blocking', 'high'].includes(item.effectivePriority))
            .length,
          recommended: ranked.filter((item) => item.effectivePriority === 'useful').length,
          optional: ranked.filter((item) => item.effectivePriority === 'optional').length,
        },
        coverage,
        remainingEstimateReason: dynamicReason,
        canGeneratePreliminaryDraft: readiness.canGenerate,
        preliminaryDraftReason: readiness.reason,
        currentUnderstanding: input.understanding.summaryForUser,
      }
      return {
        schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
        sessionId: input.sessionId,
        round: input.round,
        understanding: input.understanding,
        ledger: input.ledger,
        knownUnknowns: input.knownUnknowns,
        conversation,
        status: 'clarifying',
      }
    } catch (error) {
      return {
        schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
        sessionId: input.sessionId,
        round: input.round,
        understanding: input.understanding,
        ledger: input.ledger,
        knownUnknowns: input.knownUnknowns,
        conversation: null,
        status: 'needs_human_review',
        guardReason: describeGuardFailure(error, '问题无法安全发布'),
      }
    }
  }
}
