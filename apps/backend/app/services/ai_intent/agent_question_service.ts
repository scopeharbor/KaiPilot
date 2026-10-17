import { createHash } from 'node:crypto'
import type {
  ClarificationAnswers,
  ClarificationCard,
  ClarificationCustomInput,
  ClarificationField,
  ClarificationQuestionType,
  ConfirmedProjectContext,
  QuestionPlanCoverage,
} from '@aiproj/types'
import type { AIGateway, GenerateOptions, GenerateResult } from '../ai_m0/gateway.js'
import { CARD_CATALOG, makeCardId } from './catalog.js'
import QuestionPlanChecker from './question_plan_checker.js'

const AGENT_FIELDS = [
  'agentRisk',
  'agentDependency',
  'agentAcceptance',
  'agentStakeholder',
  'agentConstraint',
] as const satisfies readonly ClarificationField[]

type AgentField = (typeof AGENT_FIELDS)[number]

interface AgentQuestionCandidate {
  field: AgentField
  title: string
  description: string
  questionType: Extract<ClarificationQuestionType, 'single_choice' | 'multi_choice' | 'text'>
  reasoning: string
  quickOptions?: Array<{
    label: string
    value: string
    description: string
    recommended?: boolean
  }>
}

interface AgentQuestionPayload {
  questions?: AgentQuestionCandidate[]
}

export interface AgentQuestionPlan {
  cards: ClarificationCard[]
  coverage: QuestionPlanCoverage
  questionPlanRevision: string
}

interface QuestionGateway {
  generate(options: GenerateOptions): Promise<GenerateResult>
}

const SECRET_PATTERN = /(?:bearer\s+)?sk-[a-z0-9_-]{8,}|authorization\s*:[^\s]+/giu
const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu
const PHONE_PATTERN = /\b1[3-9]\d{9}\b/gu

function safeText(value: unknown): string {
  const serialized = Array.isArray(value) ? value.join('、') : String(value ?? '')
  return serialized
    .replace(SECRET_PATTERN, '[REDACTED_SECRET]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .slice(0, 240)
}

function extractPayload(rawText: string): AgentQuestionPayload | null {
  const start = rawText.indexOf('{')
  const end = rawText.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(rawText.slice(start, end + 1)) as AgentQuestionPayload
  } catch {
    return null
  }
}

function customInput(questionType: ClarificationQuestionType): ClarificationCustomInput {
  return {
    enabled: true,
    label: '自定义输入',
    placeholder:
      questionType === 'multi_choice' ? '可以输入多个答案，用逗号分隔' : '请输入真实情况',
    description: '如果建议选项不符合实际，可以直接补充。',
  }
}

export default class AgentQuestionService {
  constructor(private readonly checker = new QuestionPlanChecker()) {}

  async propose(input: {
    gateway: AIGateway | QuestionGateway
    context: ConfirmedProjectContext
    answers: ClarificationAnswers
    selectedPackIds: string[]
    /** Legacy signed-batch size only; it is not a lifetime limit for adaptive sessions. */
    compatibilityBatchLimit?: number
  }): Promise<AgentQuestionPlan> {
    const answeredAgentFields = Object.values(input.answers)
      .filter((answer) => answer?.source === 'agent')
      .map((answer) => answer!.field)
    const remainingBudget = Math.max(
      0,
      Math.min(input.compatibilityBatchLimit ?? AGENT_FIELDS.length, AGENT_FIELDS.length) -
        answeredAgentFields.length,
    )
    if (remainingBudget === 0) return this.emptyPlan(input, answeredAgentFields)

    const resolvedSummary = Object.entries(input.context.resolvedFields)
      .slice(0, 20)
      .map(([field, marked]) => ({ field, value: safeText(marked?.value) }))
    const assumptionSummary = Object.entries(input.context.assumptions)
      .slice(0, 10)
      .map(([field, marked]) => ({ field, value: safeText(marked?.value) }))
    const allowedFields = AGENT_FIELDS.filter(
      (field) => input.answers[field] === undefined && !answeredAgentFields.includes(field),
    )
    if (allowedFields.length === 0) return this.emptyPlan(input, answeredAgentFields)

    const promptSet = {
      systemPrompt: [
        '你是项目澄清 Agent。固定核心问题和条件专业卡片已经完成。',
        '只在仍会实质影响 WBS、依赖、风险或验收时提出补充问题；没有必要问题就返回空数组。',
        `最多返回 ${Math.min(remainingBudget, 5)} 个问题，只能使用允许 field：${allowedFields.join(', ')}。`,
        '输出严格 JSON：{"questions":[{"field":"agentRisk","title":"...","description":"...","questionType":"single_choice|multi_choice|text","reasoning":"...","quickOptions":[{"label":"...","value":"...","description":"..."}]}]}。',
        '不要索取 API key、Authorization、密码、个人联系方式或生产敏感原文。',
      ].join('\n'),
      userPrompt: JSON.stringify({
        confirmedFacts: resolvedSummary,
        assumptions: assumptionSummary,
        selectedPackIds: input.selectedPackIds,
        answeredFields: Object.keys(input.answers),
      }),
    }

    let generated: GenerateResult
    try {
      generated = await input.gateway.generate({
        sentence: '基于已确认项目事实提出必要的最后一轮澄清问题',
        promptSet,
        strategy: 'prompt',
        temperature: 0.1,
        requestTimeoutMs: 600_000,
      })
    } catch {
      return this.emptyPlan(input, answeredAgentFields)
    }
    if (generated.triggeredErrors.length > 0) return this.emptyPlan(input, answeredAgentFields)

    const payload = extractPayload(generated.rawText)
    const candidates = Array.isArray(payload?.questions) ? payload.questions : []
    const cards: ClarificationCard[] = []
    const used = new Set<ClarificationField>()
    for (const candidate of candidates.slice(0, Math.min(remainingBudget, 5))) {
      if (!allowedFields.includes(candidate.field) || used.has(candidate.field)) continue
      if (
        !candidate.title?.trim() ||
        !candidate.description?.trim() ||
        !candidate.reasoning?.trim()
      ) {
        continue
      }
      if (!['single_choice', 'multi_choice', 'text'].includes(candidate.questionType)) continue
      const definition = CARD_CATALOG[candidate.field]
      const quickOptions = (candidate.quickOptions ?? [])
        .slice(0, 5)
        .filter((option) => option.label?.trim() && option.description?.trim())
        .map((option) => ({
          label: safeText(option.label).slice(0, 40),
          value: safeText(option.value).slice(0, 120),
          description: safeText(option.description).slice(0, 160),
          recommended: Boolean(option.recommended),
        }))
      cards.push({
        ...definition,
        cardId: makeCardId(candidate.field, 'recommended'),
        category: 'recommended',
        title: safeText(candidate.title).slice(0, 120),
        description: safeText(candidate.description).slice(0, 240),
        questionType: candidate.questionType,
        quickOptions,
        customInput: customInput(candidate.questionType),
        defaultValue: null,
        confidence: 0.6,
        reasoning: safeText(candidate.reasoning).slice(0, 200),
        allowSkip: true,
        isRequired: false,
        phase: 'agent',
        source: 'agent',
        packId: null,
        triggerEvidence: ['固定核心与条件卡片完成后仍存在质量缺口'],
        suggestedValue: null,
      })
      used.add(candidate.field)
    }

    const coverage = this.checker.check({
      cards,
      requiredIds: cards.map((card) => card.cardId),
      answeredFields: Object.keys(input.answers) as ClarificationField[],
      selectedPackIds: input.selectedPackIds,
      packRequiredIds: {},
    })
    const safeCards = coverage.valid ? cards : []
    return {
      cards: safeCards,
      coverage: coverage.valid
        ? coverage
        : this.checker.check({
            cards: [],
            requiredIds: [],
            answeredFields: Object.keys(input.answers) as ClarificationField[],
            selectedPackIds: input.selectedPackIds,
            packRequiredIds: {},
          }),
      questionPlanRevision: this.revision(input.context, input.answers, safeCards),
    }
  }

  private emptyPlan(
    input: Pick<
      Parameters<AgentQuestionService['propose']>[0],
      'context' | 'answers' | 'selectedPackIds'
    >,
    _answeredAgentFields: ClarificationField[],
  ): AgentQuestionPlan {
    const coverage = this.checker.check({
      cards: [],
      requiredIds: [],
      answeredFields: Object.keys(input.answers) as ClarificationField[],
      selectedPackIds: input.selectedPackIds,
      packRequiredIds: {},
    })
    return {
      cards: [],
      coverage,
      questionPlanRevision: this.revision(input.context, input.answers, []),
    }
  }

  private revision(
    context: ConfirmedProjectContext,
    answers: ClarificationAnswers,
    cards: ClarificationCard[],
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          schemaVersion: context.schemaVersion,
          answeredFields: Object.keys(answers).sort(),
          cardIds: cards.map((card) => card.cardId),
        }),
      )
      .digest('hex')
      .slice(0, 24)
  }
}
