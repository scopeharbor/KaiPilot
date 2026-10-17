import type {
  AnalyzeProjectIntentResponse,
  ClarificationAnswer,
  ClarificationCard,
  ClarificationQuestionType,
} from '@aiproj/types'

/** 自适应澄清的问题卡片 id 前缀：剧场按卡片渲染，回答作为对话回复（adaptiveResponse）发回服务端。 */
export const ADAPTIVE_CARD_PREFIX = 'adaptive:'

const QUESTION_TYPE: Record<string, ClarificationQuestionType> = {
  single_choice: 'single_choice',
  multi_choice: 'multi_choice',
  date: 'date',
  number: 'number',
  money: 'number',
  short_text: 'text',
}

/**
 * 把自适应会话的当前问题（activeQuestion）转成剧场卡片。
 * 新版剧场只会渲染固定字段卡片：自适应会话返回 0 张卡片时，页面会误以为「全部答完」立刻重新分析，
 * 服务端判定问题计划过期（QUESTION_PLAN_STALE）——实测新版因此永远进不了自适应澄清。
 */
export function adaptiveQuestionCards(
  response: AnalyzeProjectIntentResponse,
): ClarificationCard[] | null {
  const session = response.adaptiveSession
  const question = session?.status === 'clarifying' ? session.conversation?.activeQuestion : null
  if (!session || !question) return null
  const card: ClarificationCard = {
    cardId: `${ADAPTIVE_CARD_PREFIX}${question.needId}:${session.round}`,
    // 字段只用于卡片内部键名；自适应回答不进 answers，而是作为对话回复发回。
    field: 'agentConstraint',
    category: 'critical',
    title: question.question,
    description: question.reason ?? '',
    impactScope: [],
    questionType: QUESTION_TYPE[question.answerKind] ?? 'text',
    quickOptions: (question.options ?? []).map((option) => ({
      label: option.label,
      value: option.value,
      description: option.description ?? '',
    })),
    customInput: {
      enabled: true,
      label: '直接回答',
      placeholder: '用自己的话回答，也可以 @ 组织成员',
      description: '可以补充细节，AI 会一并理解。',
    },
    defaultValue: null,
    confidence: 1,
    reasoning: question.reason ?? '',
    allowSkip: question.allowUnknown,
    isRequired: !question.allowUnknown,
    phase: 'agent',
    source: 'agent',
    suggestedValue: undefined,
  }
  return [card]
}

export function isAdaptiveCard(cardId: string | undefined): boolean {
  return typeof cardId === 'string' && cardId.startsWith(ADAPTIVE_CARD_PREFIX)
}

/** 回答转成对话回复文本：选项用可读的 label，自由输入原样。 */
export function adaptiveAnswerText(
  answer: ClarificationAnswer,
  card: ClarificationCard | null,
): string {
  if (answer.action === 'skip') return '暂时不确定，先按常见做法假设'
  const values = Array.isArray(answer.value) ? answer.value : [answer.value]
  return values
    .map(
      (value) =>
        card?.quickOptions.find((option) => option.value === value)?.label ?? String(value),
    )
    .join('、')
}
