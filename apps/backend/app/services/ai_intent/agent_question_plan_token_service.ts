import crypto from 'node:crypto'
import env from '#start/env'
import { ValidationException } from '../../exceptions/api_exception.js'
import {
  CLARIFICATION_FIELDS,
  type ClarificationAnswers,
  type ClarificationCard,
  type ClarificationField,
} from '@aiproj/types'

const TOKEN_VERSION = 1 as const
const TOKEN_TTL_MS = 8 * 60 * 60 * 1_000
const MAX_AGENT_CARDS = 5
const MAX_TOKEN_BYTES = 32_000
const AGENT_FIELD_SET = new Set<ClarificationField>(
  CLARIFICATION_FIELDS.filter((field) => field.startsWith('agent')),
)

interface AgentQuestionPlanTokenPayload {
  v: typeof TOKEN_VERSION
  organizationId: number
  userId: number
  rawInputHash: string
  baseAnswersDigest: string
  baseAnswerCount: number
  selectedPackIds: string[]
  cards: ClarificationCard[]
  issuedAt: number
  expiresAt: number
}

interface AgentPlanScope {
  organizationId: number
  userId: number
  rawInput: string
  answers: ClarificationAnswers
}

export interface IssuedAgentQuestionPlan {
  token: string
  questionPlanRevision: string
}

export interface ConsumedAgentQuestionPlan {
  cards: ClarificationCard[]
  questionPlanRevision: string
  selectedPackIds: string[]
  baseAnswerCount: number
  answeredAgentCount: number
  totalAgentCount: number
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function baseAnswers(answers: ClarificationAnswers): ClarificationAnswers {
  return Object.fromEntries(
    Object.entries(answers).filter(
      ([field, answer]) => !field.startsWith('agent') && answer?.source !== 'agent',
    ),
  ) as ClarificationAnswers
}

function agentAnswers(answers: ClarificationAnswers): ClarificationAnswers {
  return Object.fromEntries(
    Object.entries(answers).filter(
      ([field, answer]) => field.startsWith('agent') || answer?.source === 'agent',
    ),
  ) as ClarificationAnswers
}

/**
 * Issues and verifies a bounded, server-signed Agent question snapshot.
 *
 * The browser may persist this opaque value, but cannot add/replace cards, move it across
 * tenants/users, or reuse it after changing any fixed/conditional answer. This gives the
 * stateless analyze endpoint a recoverable multi-card batch without storing prompt/answer text.
 */
export default class AgentQuestionPlanTokenService {
  constructor(
    private readonly secret = String(env.get('APP_KEY')),
    private readonly now: () => number = () => Date.now(),
  ) {}

  issue(
    input: AgentPlanScope & { selectedPackIds: string[]; cards: ClarificationCard[] },
  ): IssuedAgentQuestionPlan {
    const cards = input.cards.slice(0, MAX_AGENT_CARDS)
    if (cards.length === 0 || cards.some((card) => !this.isValidAgentCard(card))) {
      throw new ValidationException('Agent 问题计划无效')
    }
    const issuedAt = this.now()
    const payload: AgentQuestionPlanTokenPayload = {
      v: TOKEN_VERSION,
      organizationId: input.organizationId,
      userId: input.userId,
      rawInputHash: digest(input.rawInput),
      baseAnswersDigest: digest(baseAnswers(input.answers)),
      baseAnswerCount: Object.keys(baseAnswers(input.answers)).length,
      selectedPackIds: [...new Set(input.selectedPackIds)].slice(0, 8),
      cards,
      issuedAt,
      expiresAt: issuedAt + TOKEN_TTL_MS,
    }
    const token = this.sign(payload)
    return {
      token,
      questionPlanRevision: this.revision(payload, input.answers),
    }
  }

  consume(
    token: string,
    input: AgentPlanScope & { questionPlanRevision: string | undefined },
  ): ConsumedAgentQuestionPlan {
    const payload = this.verify(token)
    if (
      payload.organizationId !== input.organizationId ||
      payload.userId !== input.userId ||
      payload.rawInputHash !== digest(input.rawInput) ||
      payload.baseAnswersDigest !== digest(baseAnswers(input.answers))
    ) {
      throw this.stale()
    }

    this.assertAgentAnswers(payload, input.answers)
    this.assertRevision(payload, input.answers, input.questionPlanRevision)

    const answered = agentAnswers(input.answers)
    const cards = payload.cards.filter((card) => answered[card.field] === undefined)
    return {
      cards,
      questionPlanRevision: this.revision(payload, input.answers),
      selectedPackIds: payload.selectedPackIds,
      baseAnswerCount: payload.baseAnswerCount,
      answeredAgentCount: Object.keys(answered).length,
      totalAgentCount: payload.cards.length,
    }
  }

  private assertRevision(
    payload: AgentQuestionPlanTokenPayload,
    answers: ClarificationAnswers,
    submitted: string | undefined,
  ): void {
    if (!submitted) throw this.stale()

    // A retry/refresh may replay the current state without adding an answer.
    if (submitted === this.revision(payload, answers)) return

    // A normal submit adds exactly one currently visible Agent answer. Reconstruct the
    // preceding state from each signed card candidate and accept only its exact revision.
    const candidates = Object.keys(agentAnswers(answers)) as ClarificationField[]
    const matchesPreviousState = candidates.some((field) => {
      const previous = { ...answers }
      delete previous[field]
      return submitted === this.revision(payload, previous)
    })
    if (!matchesPreviousState) throw this.stale()
  }

  private assertAgentAnswers(
    payload: AgentQuestionPlanTokenPayload,
    answers: ClarificationAnswers,
  ): void {
    const cardsByField = new Map(payload.cards.map((card) => [card.field, card]))
    for (const [field, answer] of Object.entries(agentAnswers(answers))) {
      const card = cardsByField.get(field as ClarificationField)
      if (
        !card ||
        !answer ||
        answer.field !== field ||
        answer.source !== 'agent' ||
        answer.cardId !== card.cardId
      ) {
        throw this.stale()
      }
    }
  }

  private revision(payload: AgentQuestionPlanTokenPayload, answers: ClarificationAnswers): string {
    const answered = agentAnswers(answers)
    const remainingCardIds = payload.cards
      .filter((card) => answered[card.field] === undefined)
      .map((card) => card.cardId)
    return digest({
      version: payload.v,
      rawInputHash: payload.rawInputHash,
      baseAnswersDigest: payload.baseAnswersDigest,
      planCardIds: payload.cards.map((card) => card.cardId),
      answeredAgentDigest: digest(answered),
      remainingCardIds,
    }).slice(0, 24)
  }

  private sign(payload: AgentQuestionPlanTokenPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const signature = crypto.createHmac('sha256', this.secret).update(encoded).digest('base64url')
    const token = `${encoded}.${signature}`
    if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
      throw new ValidationException('Agent 问题计划超过大小上限')
    }
    return token
  }

  private verify(token: string): AgentQuestionPlanTokenPayload {
    if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) throw this.stale()
    const [encoded, signature, extra] = token.split('.')
    if (!encoded || !signature || extra) throw this.stale()
    const expected = crypto.createHmac('sha256', this.secret).update(encoded).digest('base64url')
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw this.stale()
    }

    try {
      const payload = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as AgentQuestionPlanTokenPayload
      if (
        payload.v !== TOKEN_VERSION ||
        !Number.isInteger(payload.organizationId) ||
        !Number.isInteger(payload.userId) ||
        !/^[a-f0-9]{64}$/u.test(payload.rawInputHash) ||
        !/^[a-f0-9]{64}$/u.test(payload.baseAnswersDigest) ||
        !Number.isInteger(payload.baseAnswerCount) ||
        !Array.isArray(payload.selectedPackIds) ||
        payload.selectedPackIds.length > 8 ||
        !Array.isArray(payload.cards) ||
        payload.cards.length === 0 ||
        payload.cards.length > MAX_AGENT_CARDS ||
        payload.cards.some((card) => !this.isValidAgentCard(card)) ||
        !Number.isFinite(payload.issuedAt) ||
        !Number.isFinite(payload.expiresAt) ||
        payload.expiresAt <= this.now()
      ) {
        throw this.stale()
      }
      return payload
    } catch (error) {
      if (error instanceof ValidationException) throw error
      throw this.stale()
    }
  }

  private isValidAgentCard(card: ClarificationCard): boolean {
    return (
      Boolean(card) &&
      AGENT_FIELD_SET.has(card.field) &&
      card.phase === 'agent' &&
      card.source === 'agent' &&
      typeof card.cardId === 'string' &&
      card.cardId.length <= 160 &&
      typeof card.title === 'string' &&
      card.title.length <= 120 &&
      typeof card.description === 'string' &&
      card.description.length <= 240 &&
      ['single_choice', 'multi_choice', 'text'].includes(card.questionType)
    )
  }

  private stale(): ValidationException {
    return new ValidationException('QUESTION_PLAN_STALE：问题计划已更新，请重新载入当前问题')
  }
}
