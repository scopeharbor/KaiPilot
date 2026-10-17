/**
 * AI 同事 ↔ 生成剧场联动：把剧场的追问转成对话里的问题、把对话里的回答写回剧场，
 * 以及全自动模式下的代答规则。纯函数（代答里需要模型的部分由调用方传入）。
 */
import type { ClarificationAnswer, ClarificationCard, ClarificationValue } from '@aiproj/types'
import { buildClarificationAnswer, useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

/** 剧场问题卡 → 对话里的问题文字。 */
export function theaterCardPrompt(card: ClarificationCard): string {
  const multi = card.questionType === 'multi_choice' ? '（可多选，用顿号分隔）' : ''
  return [`生成剧场在问：${card.title}${multi}`, card.description].filter(Boolean).join('\n')
}

/** 对话里给出的候选（剧场的快捷选项）。 */
export function theaterCardOptions(card: ClarificationCard): string[] {
  return card.quickOptions.map((option) =>
    option.recommended ? `${option.label}（推荐）` : option.label,
  )
}

const stripRecommended = (text: string) => text.replace(/（推荐）$/, '').trim()

/** 把对话里的一句回答换成剧场能收的答案（匹配快捷选项；数字 / 日期按题型解析；其余当自填）。 */
export function theaterAnswerFromText(
  card: ClarificationCard,
  rawText: string,
): ClarificationAnswer {
  const text = stripRecommended(rawText.trim())
  const options = card.quickOptions
  const matchOne = (fragment: string) =>
    options.find(
      (option) =>
        option.label === fragment ||
        String(option.value) === fragment ||
        (fragment.length >= 2 && option.label.includes(fragment)) ||
        (option.label.length >= 2 && fragment.includes(option.label)),
    )

  if (card.questionType === 'multi_choice') {
    const parts = text.split(/[、,，;；\s]+/).filter(Boolean)
    const values = [
      ...new Set(
        parts
          .map((part) => matchOne(part))
          .filter((option): option is NonNullable<typeof option> => Boolean(option))
          .map((option) => String(option.value)),
      ),
    ]
    return buildClarificationAnswer(card, 'answer', values.length > 0 ? values : [text])
  }

  const option = matchOne(text)
  if (option) return buildClarificationAnswer(card, 'answer', option.value)

  let value: ClarificationValue = text
  if (card.questionType === 'number') {
    const match = /-?\d+(?:\.\d+)?/.exec(text)
    if (match) value = Number(match[0])
  } else if (card.questionType === 'date') {
    const match = /\d{4}-\d{2}-\d{2}/.exec(text)
    if (match) value = match[0]
  }
  return buildClarificationAnswer(card, 'answer', value)
}

/**
 * 全自动代答（不需要模型的情况）：原话里解析到的值 → 推荐选项 → 默认值 → 第一个选项。
 * 都没有（如纯自填题）返回 null，由调用方请模型代答。
 */
export function ruleBasedAutoAnswer(card: ClarificationCard): ClarificationAnswer | null {
  if (card.suggestedValue !== undefined && card.suggestedValue !== null) {
    return buildClarificationAnswer(card, 'answer', card.suggestedValue)
  }
  const recommended = card.quickOptions.find((option) => option.recommended)
  if (recommended) {
    return buildClarificationAnswer(
      card,
      'answer',
      card.questionType === 'multi_choice' ? [String(recommended.value)] : recommended.value,
    )
  }
  if (card.defaultValue) return buildClarificationAnswer(card, 'default', card.defaultValue.value)
  const first = card.quickOptions[0]
  if (first) {
    return buildClarificationAnswer(
      card,
      'answer',
      card.questionType === 'multi_choice' ? [String(first.value)] : first.value,
    )
  }
  return null
}

/** 代答兜底：模型也给不出时，能跳过就跳过，否则写明按常见做法安排。 */
export function fallbackAutoAnswer(card: ClarificationCard): ClarificationAnswer {
  return card.allowSkip
    ? buildClarificationAnswer(card, 'skip', null)
    : buildClarificationAnswer(card, 'answer', '按行业常见做法安排（AI 代答，可在审查时修改）')
}

/** 答案在对话里怎么说（「已代答：团队规模 → 5 人」）。 */
export function describeTheaterAnswer(
  card: ClarificationCard,
  answer: ClarificationAnswer,
): string {
  if (answer.action === 'skip') return '跳过'
  const labelOf = (value: string | number) =>
    card.quickOptions.find((option) => String(option.value) === String(value))?.label ??
    String(value)
  const value = answer.value
  if (Array.isArray(value)) return value.map(labelOf).join('、')
  if (value === null) return '跳过'
  return answer.action === 'default' ? `${labelOf(value)}（默认值）` : labelOf(value)
}

/**
 * 剧场这一轮问题都答完了（不论在剧场还是在对话里答的）：回到分析，由服务端决定还要不要追问。
 * 剧场页面里的问题卡也会在答完时这样做；先置 analyzing 后它会看到状态而跳过，不会重复请求。
 */
export function finishTheaterRoundIfDone(): void {
  const draft = useAiProjectDraftStore.getState()
  if (draft.status === 'clarifying' && draft.cards.length === 0 && !draft.activeCard) draft.retry()
}

/** 剧场当前要回答的问题（与问题卡组件同口径：活动卡优先，其次待答队列第一张）。 */
export function currentTheaterCard(): ClarificationCard | null {
  const draft = useAiProjectDraftStore.getState()
  if (draft.status !== 'clarifying') return null
  return draft.activeCard ?? draft.cards[0] ?? null
}
