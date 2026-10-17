import { test } from '@japa/runner'
import { DRAFT_EVAL_CASES } from '#services/ai_draft/eval/cases'
import {
  buildEvalContext,
  compareDraftEvalReports,
  formatDraftEvalMarkdown,
  type DraftEvalMetrics,
  type DraftEvalReport,
} from '#services/ai_draft/eval/draft_eval_runner'
import { contextTeamRoster } from '#services/ai_draft/resource_plan'
import { buildDraftCalendar } from '#services/ai_draft/cn_calendar'
import { stageGateTemplate } from '#services/ai_draft/plan_insights'

function metrics(overrides: Partial<DraftEvalMetrics> = {}): DraftEvalMetrics {
  return {
    caseId: 'bank-payment-clearing',
    status: 'completed',
    reasonCode: null,
    blocking: 0,
    warning: 1,
    blockingRules: [],
    factCoverage: 1,
    durationDeviationDays: 3,
    retries: 1,
    attemptFailures: 1,
    repetitionLoops: 0,
    tasks: 150,
    wbsNodes: 80,
    stageGateCoverage: 1,
    traceabilityCoverage: 0.9,
    onTimeProbability: 0.7,
    capacityUtilization: 0.8,
    elapsedMs: 780_000,
    ...overrides,
  }
}

function report(cases: DraftEvalMetrics[]): DraftEvalReport {
  return {
    version: '1.0',
    mode: 'real',
    model: 'gpt-5.6-luna',
    startedAt: '2026-09-25T00:00:00Z',
    cases,
  }
}

test.group('AI 草案回归评测集', () => {
  test('7 个行业案例：每个都能解析出团队名册、截止日与行业阶段门', ({ assert }) => {
    assert.lengthOf(DRAFT_EVAL_CASES, 7)
    for (const evalCase of DRAFT_EVAL_CASES) {
      const context = buildEvalContext(evalCase.rawInput)
      assert.isAtLeast(contextTeamRoster(context).length, 4, `${evalCase.id} 名册`)
      assert.isNotNull(context.parsedIntent.timeline.startDate, `${evalCase.id} 开始日`)
      assert.isAtLeast(
        stageGateTemplate(evalCase.rawInput).gates.length,
        8,
        `${evalCase.id} 阶段门`,
      )
    }
  })

  test('带封网约束的案例都能解析出封网窗口', ({ assert }) => {
    for (const id of [
      'bank-payment-clearing',
      'insurance-claims-core',
      'hospital-his-migration',
      'ecommerce-oms',
    ]) {
      const evalCase = DRAFT_EVAL_CASES.find((item) => item.id === id)!
      const context = buildEvalContext(evalCase.rawInput)
      const calendar = buildDraftCalendar({
        startDate: context.parsedIntent.timeline.startDate,
        endDate: evalCase.deadline,
        rawInput: evalCase.rawInput,
      })
      assert.isAbove(calendar.freezeWindows.length, 0, id)
    }
  })

  test('与基线比较：只报告明确变差的指标，容差内波动不算', ({ assert }) => {
    const baseline = report([metrics()])
    assert.deepEqual(
      compareDraftEvalReports(
        baseline,
        report([metrics({ durationDeviationDays: 8, retries: 2 })]),
      ),
      [],
    )
    const worse = compareDraftEvalReports(
      baseline,
      report([
        metrics({
          blocking: 2,
          blockingRules: ['HL-008'],
          factCoverage: 0.8,
          durationDeviationDays: 30,
          retries: 4,
          repetitionLoops: 1,
          stageGateCoverage: 0.7,
        }),
      ]),
    )
    assert.sameMembers(
      worse.map((item) => item.metric),
      [
        'blocking',
        'factCoverage',
        'durationDeviationDays',
        'retries',
        'repetitionLoops',
        'stageGateCoverage',
      ],
    )
    const failed = compareDraftEvalReports(
      baseline,
      report([metrics({ status: 'failed', reasonCode: 'GENERATION_BUDGET_EXHAUSTED' })]),
    )
    assert.equal(failed[0].metric, 'status')
  })

  test('Markdown 报告含每个案例一行与退化清单', ({ assert }) => {
    const markdown = formatDraftEvalMarkdown(report([metrics()]), [
      {
        caseId: 'bank-payment-clearing',
        metric: 'blocking',
        baseline: 0,
        current: 2,
        detail: '阻断数增加：HL-008',
      },
    ])
    assert.include(markdown, '| bank-payment-clearing | 完成 |')
    assert.include(markdown, '相对基线的退化')
  })
})
