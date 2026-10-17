/**
 * 真实模型评测：追问「答题检查」（ace ai:eval-answer-check --connection=4 [--model=ID] [--org=1]）。
 *
 * 用真实模型跑一批回答（简体 / 繁体 / 英文 / 错别字 / 同音字 / 抽象说法 / 答非所问），
 * 对照预期打印每条的判定与规整结果、耗时和准确率。只调用模型、不写业务数据
 * （调用账本照常记录，与正常使用一致）。
 */
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import type { InformationNeed, QuestionCardProposal } from '@aiproj/types'
import AdaptiveClarificationService from '#services/ai_intent/adaptive_clarification_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import { dateInfo } from '#services/ai_planning/planning_toolbox'

interface Case {
  need: InformationNeed
  question: QuestionCardProposal
  answer: string
  expect: 'accept' | 'reask'
  /** accept 时规整结果应包含的片段（可选）。 */
  mustContain?: RegExp
  /** accept 时规整结果必须包含的具体日期（按今天由程序算出，核对模型有没有算错）。 */
  expectDate?: (now: Date) => string
}

/** 那天放假时，写原日期或顺延后的工作日都算对。 */
function orNextWorkday(date: string): string[] {
  return [date, dateInfo(date).nextWorkday]
}

const DAY = 86_400_000
function today(now: Date): number {
  const shanghai = new Date(now.getTime() + 8 * 3_600_000)
  return Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate())
}
const iso = (ts: number) => new Date(ts).toISOString().slice(0, 10)
/** 第 weeks 周（0 = 本周）的星期 weekday（1 = 周一 … 7 = 周日），周一为一周的开始。 */
function weekday(now: Date, weeks: number, day: number): string {
  const t = today(now)
  const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY
  return iso(monday + (weeks * 7 + day - 1) * DAY)
}

function need(
  id: string,
  topic: string,
  question: string,
  options: string[] = [],
): {
  need: InformationNeed
  question: QuestionCardProposal
} {
  const suggestedOptions = options.map((label, index) => ({
    id: `o${index + 1}`,
    label,
    value: label,
  }))
  return {
    need: {
      id,
      topic,
      missingInformation: question,
      decisionImpact: ['schedule'],
      whyItMatters: '这会影响计划的排法。',
      priority: 'high',
      answerKind: options.length > 0 ? 'single_choice' : 'short_text',
      confidence: 1,
      uncertainty: 1,
      userEffort: 'low',
      sensitivity: 'none',
      ...(suggestedOptions.length > 0 ? { suggestedOptions } : {}),
    },
    question: {
      needId: id,
      question,
      reason: '这会影响计划的排法。',
      answerKind: options.length > 0 ? 'single_choice' : 'short_text',
      ...(suggestedOptions.length > 0 ? { options: suggestedOptions } : {}),
      allowOther: true,
      allowUnknown: true,
    },
  }
}

const start = need('core.start_date', 'start_date', '项目从哪一天开始？', [
  '下一个工作日',
  '下个月初',
])
const duration = need('core.duration', 'duration', '整个项目预计做多久，或者必须在哪一天前完成？', [
  '1 个月左右',
  '3 个月左右',
])
const team = need('core.team', 'team_composition', '这个项目由哪些人来做？', ['先按角色估算'])
const fields = need('scope.fields', '报名表单字段', '报名需要收集哪些信息？')
const voting = need('scope.voting', '投票规则', '投票是单选还是多选？', ['单选', '多选'])

const DATE = /\d{4}-\d{2}-\d{2}/
const CASES: Case[] = [
  { ...start, answer: '我今天想吃汉堡', expect: 'reask' },
  {
    ...start,
    answer: '下週三開工',
    expect: 'accept',
    mustContain: DATE,
    expectDate: (n) => weekday(n, 1, 3),
  },
  {
    ...start,
    answer: 'next Monday',
    expect: 'accept',
    mustContain: DATE,
    expectDate: (n) => weekday(n, 1, 1),
  },
  { ...start, answer: '等國慶收假就開始', expect: 'accept', mustContain: DATE },
  {
    ...start,
    answer: '大後天',
    expect: 'accept',
    mustContain: DATE,
    expectDate: (n) => iso(today(n) + 3 * DAY),
  },
  { ...start, answer: '10月8号开吧', expect: 'accept' },
  { ...start, answer: '下舟一开工', expect: 'accept', mustContain: DATE },
  { ...start, answer: 'Oct 12', expect: 'accept', mustContain: DATE },
  { ...start, answer: '看老板心情', expect: 'reask' },
  // 需要算的说法：模型可以调用计划工具箱让程序算准
  { ...start, answer: '国庆后第三个工作日开工', expect: 'accept', mustContain: DATE },
  {
    ...start,
    answer: '下下周五',
    expect: 'accept',
    mustContain: DATE,
    expectDate: (n) => weekday(n, 2, 5),
  },
  { ...duration, answer: '三個月左右', expect: 'accept' },
  { ...duration, answer: 'about 6 weeks', expect: 'accept' },
  { ...duration, answer: '越快越好', expect: 'reask' },
  { ...duration, answer: '年底前上現', expect: 'accept' },
  { ...duration, answer: '我喜欢蓝色', expect: 'reask' },
  { ...team, answer: '後端兩個人，前端一個，測試一個', expect: 'accept' },
  { ...team, answer: '2 backend devs and 1 QA', expect: 'accept' },
  { ...team, answer: '今天天气真好', expect: 'reask' },
  { ...team, answer: '先按角色估', expect: 'accept' },
  { ...fields, answer: '姓名、部門、手機號', expect: 'accept' },
  { ...fields, answer: '我昨天看了电影', expect: 'reask' },
  { ...fields, answer: '看情况吧，可能要加个紧急联系人', expect: 'accept' },
  { ...fields, answer: 'Name and employee ID', expect: 'accept' },
  { ...voting, answer: '每人投一票', expect: 'accept' },
  { ...voting, answer: '周末去爬山', expect: 'reask' },
  { ...voting, answer: '多选吧，最多三個', expect: 'accept' },
]

export default class EvalAnswerCheck extends BaseCommand {
  static commandName = 'ai:eval-answer-check'
  static description = '真实模型评测：追问答题检查（繁体 / 英文 / 错别字 / 答非所问）'
  static options: CommandOptions = { startApp: true, staysAlive: false }

  @flags.number({ description: 'AI 连接 ID', required: true })
  declare connection: number

  @flags.number({ description: '模型 ID（缺省用连接的默认模型）' })
  declare model?: number

  @flags.number({ description: '组织 ID', default: 1 })
  declare org: number

  @flags.boolean({ description: '失败用例额外打印模型原始判定' })
  declare debug?: boolean

  async run() {
    const resolved = await resolveAdapter({
      connectionId: this.connection,
      ...(this.model ? { modelId: this.model } : {}),
      organizationId: this.org,
      requiredCapabilities: ['chat'],
    })
    const service = new AdaptiveClarificationService()
    let correct = 0
    const ONLY = process.env.EVAL_ONLY
    for (const item of ONLY ? CASES.filter((c) => c.answer.includes(ONLY)) : CASES) {
      const started = Date.now()
      const result = await service.checkAnswer({
        gateway: resolved.gateway,
        need: item.need,
        question: item.question,
        answer: item.answer,
      })
      const ms = Date.now() - started
      const normalized = result.kind === 'accept' ? result.normalized : null
      const ok =
        result.kind === item.expect &&
        (!item.mustContain ||
          item.expect !== 'accept' ||
          item.mustContain.test(normalized ?? item.answer)) &&
        (!item.expectDate ||
          orNextWorkday(item.expectDate(new Date())).some((date) =>
            (normalized ?? item.answer).includes(date),
          ))
      if (ok) correct++
      if (!ok && this.debug) {
        const raw = await (
          service as unknown as { judgeAnswer: (input: unknown) => Promise<unknown> }
        ).judgeAnswer({
          gateway: resolved.gateway,
          need: item.need,
          question: item.question,
          answer: item.answer,
          now: new Date(),
        })
        this.logger.info(`   模型原始判定：${JSON.stringify(raw)}`)
      }
      this.logger.info(
        `${ok ? '✓' : '✗'} [${item.need.id}] 「${item.answer}」 → ${result.kind}` +
          (result.kind === 'accept'
            ? `（规整：${normalized ?? '原样'}）`
            : `（提示：${result.notice}）`) +
          ` ${ms}ms`,
      )
    }
    this.logger.info(`准确率 ${correct}/${CASES.length}`)
  }
}
