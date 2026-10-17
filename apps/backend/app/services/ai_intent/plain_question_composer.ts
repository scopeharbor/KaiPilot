import type { InformationNeed, InformationNeedOption, QuestionCardProposal } from '@aiproj/types'
import QuestionPlanChecker, { QuestionRewriteFailure } from './question_plan_checker.js'

function asQuestion(value: string): string {
  const text = value.trim().replace(/[。；;]+$/u, '')
  if (/[？?]$/u.test(text)) return text.replace(/\?$/u, '？')
  if (/(?:谁|什么|哪些|哪一|多少|多长|几|何时|什么时候|如何|是否|能否|要不要)/u.test(text)) {
    return `${text}？`
  }
  return `关于${text}，目前可以确认到什么程度？`
}

/**
 * 模型没给候选项时的通用兜底档位。
 *
 * 这些是**区间**，不是事实：不涉及任何具体公司、系统、金额或日期，选中后仍然是用户
 * 自己确认的答案，「其他」也始终开着。原先只有选择题才有候选项，于是日期、人数、
 * 金额这类问题一个选项都没有，用户每次都得手写——这正是「必须靠『其他』补充」的来源。
 */
const FALLBACK_OPTIONS: Partial<Record<InformationNeed['answerKind'], InformationNeedOption[]>> = {
  date: [
    { id: 'within_month', label: '一个月内', value: '一个月内' },
    { id: 'within_quarter', label: '一个季度内', value: '一个季度内' },
    { id: 'within_half_year', label: '半年内', value: '半年内' },
    { id: 'this_year', label: '今年内', value: '今年内' },
  ],
  number: [
    { id: 'lte_5', label: '5 以内', value: '5 以内' },
    { id: 'between_6_20', label: '6 到 20', value: '6 到 20' },
    { id: 'between_21_100', label: '21 到 100', value: '21 到 100' },
    { id: 'gt_100', label: '100 以上', value: '100 以上' },
  ],
  money: [
    { id: 'lte_10w', label: '10 万以内', value: '10 万以内' },
    { id: 'between_10_50w', label: '10 万到 50 万', value: '10 万到 50 万' },
    { id: 'between_50_200w', label: '50 万到 200 万', value: '50 万到 200 万' },
    { id: 'gt_200w', label: '200 万以上', value: '200 万以上' },
  ],
}

function fallbackOptions(need: InformationNeed): InformationNeedOption[] | undefined {
  const preset = FALLBACK_OPTIONS[need.answerKind]
  if (!preset) return undefined
  return preset.map((option) => ({ ...option, id: `${need.id}:fallback:${option.id}` }))
}

export default class PlainQuestionComposer {
  constructor(private readonly checker = new QuestionPlanChecker()) {}

  compose(need: InformationNeed): QuestionCardProposal {
    const modelOptions = need.suggestedOptions?.map((option, index) => ({
      id: option.id || `${need.id}:option:${index + 1}`,
      label: option.label,
      value: option.value,
      ...(option.description ? { description: option.description } : {}),
    }))
    // 模型给的档位永远优先；只有它一个都没给时才用通用区间兜底。
    const options = modelOptions?.length ? modelOptions : fallbackOptions(need)
    const proposal: QuestionCardProposal = {
      needId: need.id,
      question: asQuestion(need.missingInformation),
      reason: need.whyItMatters,
      answerKind: need.answerKind,
      ...(options?.length ? { options } : {}),
      // 恒为 true：任何一题都必须能用自己的话作答。原先只有「模型给了选项」才开放
      // 「其他」，于是没选项的题目反而既没得选、也没有明确的自由输入入口。
      allowOther: true,
      allowUnknown: need.priority !== 'blocking',
      unknownImpact: need.whyItMatters,
    }
    let current = proposal
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = this.checker.checkProposal({ proposal: current, need })
      if (result.valid) return current
      current = this.checker.rewriteProposal(current, need, attempt)
    }
    const final = this.checker.checkProposal({ proposal: current, need })
    if (!final.valid) {
      throw new QuestionRewriteFailure(`问题无法安全发布：${final.reasonCodes.join(',')}`)
    }
    return current
  }
}
