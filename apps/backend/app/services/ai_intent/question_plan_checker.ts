import {
  CLARIFICATION_FIELDS,
  CLARIFICATION_QUESTION_TYPES,
  type ClarificationCard,
  type ClarificationField,
  type QuestionPlanCoverage,
  type QuestionPlanReasonCode,
  type InformationNeed,
  type QuestionCardProposal,
} from '@aiproj/types'

const MAX_VISIBLE_PLAN_SIZE = 20
const SENSITIVE_TEXT_PATTERN =
  /(?:bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,}|authorization\s*:|\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,})/iu
const INTERNAL_OR_JARGON_PATTERN =
  /\b(?:factKey|agentRisk|scopeBoundary|stakeholder|resourceEnvelope|schema|needId)\b|核心痛点|范围边界|成功指标|利益相关方|资源包络|依赖闭环/iu
/**
 * 一句话里塞了两个问题。
 *
 * 顿号也算连接词：用户看到的「上线时间、可投入人员」正是这么来的——一道题问了两件事，
 * 而候选项只覆盖了其中一件，于是另一半只能靠「其他」手写。命中后会被重写成单一焦点，
 * 另一件事仍然是独立的信息需求，会在后面单独出题。
 * 只认顿号，不认「和 / 与」：后者经常出现在同一个名词短语内部（「研发和测试的范围」），
 * 按它切句会把一道好问题拦腰截断。
 */
const DOUBLE_QUESTION_PATTERN =
  /(?:[？?].+?[？?])|(?:以及|同时|并且|另外|、).*(?:多少|哪些|什么|谁|何时|是否|哪里|哪儿|多久|多长|如何|怎么)/u

/**
 * 顿号也可能只是在列举候选项（「用 Web、移动端还是桌面端」），
 * 那是一道好问题，按顿号切开反而会把它拦腰截断。出现选择连词时不当作复合问句。
 */
const OPTION_LIST_PATTERN = /[还還]是|或者|或/u

function hasMultiplePrimaryQuestions(question: string): boolean {
  if (!DOUBLE_QUESTION_PATTERN.test(question)) return false
  // 两个独立问号一定是两问，与是否有选择连词无关。
  if (/[？?].+?[？?]/u.test(question)) return true
  if (/以及|同时|并且|另外/u.test(question)) return true
  return !OPTION_LIST_PATTERN.test(question)
}

/** 判断一个片段本身是不是已经在提问；不是的话要补成完整问句而不是直接加问号。 */
const INTERROGATIVE_PATTERN =
  /(?:谁|什么|哪些|哪一|多少|多长|几|何时|什么时候|如何|是否|能否|要不要|程度)/u

export interface PlainLanguageRubric {
  relevance: number
  readability: number
  singleFocus: number
  answerability: number
  reasonClarity: number
  total: number
}

export interface QuestionProposalCheckResult {
  valid: boolean
  reasonCodes: QuestionPlanReasonCode[]
  rubric: PlainLanguageRubric
}

export class QuestionRewriteFailure extends Error {
  readonly code = 'QUESTION_REWRITE_FAILED'
}

export interface QuestionPlanCheckInput {
  cards: ClarificationCard[]
  requiredIds: string[]
  answeredFields: ClarificationField[]
  selectedPackIds: string[]
  packRequiredIds: Record<string, string[]>
}

export default class QuestionPlanChecker {
  check(input: QuestionPlanCheckInput): QuestionPlanCoverage {
    const reasonCodes = new Set<QuestionPlanReasonCode>()
    const rejectedIds = new Set<string>()
    const seenFields = new Set<ClarificationField>()
    const answeredFields = new Set(input.answeredFields)
    const allowedFields = new Set<ClarificationField>(CLARIFICATION_FIELDS)
    const allowedQuestionTypes = new Set(CLARIFICATION_QUESTION_TYPES)

    if (input.cards.length > MAX_VISIBLE_PLAN_SIZE) {
      reasonCodes.add('QUESTION_LIMIT_EXCEEDED')
      input.cards.slice(MAX_VISIBLE_PLAN_SIZE).forEach((card) => rejectedIds.add(card.cardId))
    }

    for (const card of input.cards) {
      if (!allowedFields.has(card.field) || !card.title.trim() || !card.description.trim()) {
        reasonCodes.add('UNANSWERABLE_QUESTION')
        rejectedIds.add(card.cardId)
      }
      if (!allowedQuestionTypes.has(card.questionType)) {
        reasonCodes.add('INVALID_QUESTION_TYPE')
        rejectedIds.add(card.cardId)
      }
      if (seenFields.has(card.field)) {
        reasonCodes.add('DUPLICATE_FIELD')
        rejectedIds.add(card.cardId)
      }
      if (answeredFields.has(card.field)) {
        reasonCodes.add('ANSWERED_FIELD_REPEATED')
        rejectedIds.add(card.cardId)
      }
      if (SENSITIVE_TEXT_PATTERN.test(`${card.title}\n${card.description}\n${card.reasoning}`)) {
        reasonCodes.add('SENSITIVE_TEXT_EXPOSED')
        rejectedIds.add(card.cardId)
      }
      seenFields.add(card.field)
    }

    const coveredIds = input.cards
      .filter((card) => !rejectedIds.has(card.cardId))
      .map((card) => card.cardId)
    const covered = new Set(coveredIds)
    const missingIds = input.requiredIds.filter((id) => !covered.has(id))
    if (missingIds.length > 0) reasonCodes.add('MISSING_REQUIRED_ID')

    for (const packId of input.selectedPackIds) {
      const packIds = input.packRequiredIds[packId] ?? []
      if (packIds.some((id) => !covered.has(id))) {
        reasonCodes.add('INCOMPLETE_TRIGGERED_PACK')
      }
    }

    return {
      valid: reasonCodes.size === 0,
      requiredIds: [...input.requiredIds],
      coveredIds,
      missingIds,
      rejectedIds: [...rejectedIds],
      reasonCodes: [...reasonCodes],
      selectedPackIds: [...input.selectedPackIds],
    }
  }

  checkProposal(input: {
    proposal: QuestionCardProposal
    need: InformationNeed
    answeredNeedIds?: string[]
    knownUnknownNeedIds?: string[]
  }): QuestionProposalCheckResult {
    const { proposal, need } = input
    const reasons = new Set<QuestionPlanReasonCode>()
    const text = `${proposal.question}\n${proposal.reason ?? ''}`
    if (proposal.needId !== need.id || proposal.answerKind !== need.answerKind) {
      reasons.add('SEMANTIC_DRIFT')
    }
    if (!proposal.question.trim() || !need.whyItMatters.trim()) reasons.add('UNANSWERABLE_QUESTION')
    if (INTERNAL_OR_JARGON_PATTERN.test(text)) reasons.add('INTERNAL_TERM_EXPOSED')
    if (hasMultiplePrimaryQuestions(proposal.question)) reasons.add('MULTIPLE_PRIMARY_QUESTIONS')
    if (SENSITIVE_TEXT_PATTERN.test(text)) reasons.add('SENSITIVE_TEXT_EXPOSED')
    if (input.answeredNeedIds?.includes(need.id)) reasons.add('ANSWERED_FIELD_REPEATED')
    if (input.knownUnknownNeedIds?.includes(need.id)) reasons.add('KNOWN_UNKNOWN_REPEATED')
    if (need.decisionImpact.length === 0 || !proposal.reason?.trim())
      reasons.add('IRRELEVANT_QUESTION')

    const options = proposal.options ?? []
    const normalized = options.map((option) => option.label.trim().toLocaleLowerCase())
    if (new Set(normalized).size !== normalized.length) reasons.add('OVERLAPPING_OPTIONS')
    if (options.length > 0 && !proposal.allowOther) reasons.add('MISSING_OTHER_PATH')
    if (need.priority !== 'blocking' && !proposal.allowUnknown) reasons.add('MISSING_UNKNOWN_PATH')

    const rubric: PlainLanguageRubric = {
      relevance: need.decisionImpact.length > 0 && proposal.reason?.trim() ? 5 : 1,
      readability: INTERNAL_OR_JARGON_PATTERN.test(text)
        ? 1
        : proposal.question.length <= 120
          ? 5
          : 3,
      singleFocus: hasMultiplePrimaryQuestions(proposal.question) ? 1 : 5,
      answerability:
        proposal.answerKind === 'short_text' ||
        options.length > 0 ||
        ['date', 'number', 'money'].includes(proposal.answerKind)
          ? 5
          : 2,
      reasonClarity: proposal.reason?.trim() ? 5 : 1,
      total: 0,
    }
    rubric.total =
      rubric.relevance +
      rubric.readability +
      rubric.singleFocus +
      rubric.answerability +
      rubric.reasonClarity
    return { valid: reasons.size === 0, reasonCodes: [...reasons], rubric }
  }

  rewriteProposal(
    proposal: QuestionCardProposal,
    need: InformationNeed,
    attempt: number,
  ): QuestionCardProposal {
    if (attempt >= 2) throw new QuestionRewriteFailure('问题连续两次未通过通俗语言校验')
    let question = proposal.question
      .replace(/核心痛点/gu, '最希望解决的实际问题')
      .replace(/范围边界/gu, '这次一定要做的事情')
      .replace(/成功指标/gu, '怎样才算成功')
      .replace(/利益相关方|stakeholder/giu, '需要参与或做决定的人')
      .replace(/资源包络/gu, '可用的人手、时间和预算')
      .replace(/\b(?:factKey|agentRisk|scopeBoundary|resourceEnvelope|schema|needId)\b/giu, '')
      .trim()
    const firstQuestion = question
      .split(/[？?]|以及|同时|并且|另外|、/u)
      .filter(Boolean)[0]
      ?.trim()
      .replace(/[，,。；;]+$/u, '')
    if (hasMultiplePrimaryQuestions(question) && firstQuestion) {
      // 顿号切出来的片段往往只是个名词短语（「关于上线时间」），直接加问号读起来不像人话。
      const missing = need.missingInformation.trim().replace(/[？?。；;，,]+$/u, '')
      // 截出的第一段常常只是名词（「报名」「单场培训」）：优先用信息需求本身的问法，
      // 但它自己也可能是同样的列举句（实测「报名、投票开始/截止和结果主要通过什么方式通知」），
      // 那就按主题问——不能再交回一句过不了检查的原文，否则整轮追问会卡死。
      const topic = /[\u3400-\u9fff]/u.test(need.topic) ? need.topic.trim() : firstQuestion
      question = INTERROGATIVE_PATTERN.test(firstQuestion)
        ? `${firstQuestion}？`
        : INTERROGATIVE_PATTERN.test(missing) && !hasMultiplePrimaryQuestions(`${missing}？`)
          ? `${missing}？`
          : (proposal.options?.length ?? 0) > 0
            ? `关于${topic}，你倾向哪种做法？`
            : `关于${topic}，目前可以确认到什么程度？`
    }
    const rewritten: QuestionCardProposal = {
      ...proposal,
      needId: need.id,
      answerKind: need.answerKind,
      question: question || `关于${need.missingInformation}，目前可以确认到什么程度？`,
      reason: proposal.reason?.trim() || need.whyItMatters,
      allowOther: (proposal.options?.length ?? 0) > 0 ? true : proposal.allowOther,
      allowUnknown: need.priority === 'blocking' ? proposal.allowUnknown : true,
    }
    const result = this.checkProposal({ proposal: rewritten, need })
    if (!result.valid && result.reasonCodes.includes('SEMANTIC_DRIFT')) {
      throw new QuestionRewriteFailure('问题重写改变了原始信息需求语义')
    }
    return rewritten
  }
}
