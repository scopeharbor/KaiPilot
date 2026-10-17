import { describe, expect, it } from 'vitest'
import type { ConfirmedProjectContext, FeasibilityCapabilityEstimate } from '@aiproj/types'
import {
  addWorkdays,
  extractJsonObject,
  dateInfo,
  generateWithPlanningTools,
  resolveDateText,
  runPlanningTool,
  teamCapacity,
  workdaysBetween,
  type TextGateway,
} from '#services/ai_planning/planning_toolbox'
import {
  applyFeasibilityDecision,
  buildAssessment,
  calendarNotices,
  chooseDeferrals,
  priceProposal,
  scaleTeam,
} from '#services/ai_planning/feasibility_service'
import { contextTeamRoster } from '#services/ai_draft/resource_plan'
import { timingCheckpoint } from '#services/ai_intent/timing_checkpoint'

// 2026-09-28（周一）北京时间上午
const now = new Date('2026-09-28T02:00:00Z')

describe('计划工具箱', () => {
  it('工作日：国庆 10-01~10-07 放假，10-10 调休上班', () => {
    const result = workdaysBetween('2026-09-28', '2026-10-16')
    expect(result.calendarDays).toBe(19)
    expect(result.holidays.join()).toContain('国庆')
    // 9/28-30 三天 + 10/8-9 + 10/12-16 五天 + 调休 10/10（若有）
    expect(result.workdays).toBeGreaterThanOrEqual(10)
    expect(result.workdays).toBeLessThanOrEqual(11)
  })

  it('第 N 个工作日跳过假期；某天是不是工作日', () => {
    expect(addWorkdays('2026-09-30', 2).date).toBe('2026-10-08')
    const info = dateInfo('2026-10-03')
    expect(info.isWorkday).toBe(false)
    expect(info.note).toContain('国庆')
    expect(info.nextWorkday).toBe('2026-10-08')
    expect(dateInfo('2026-09-28').weekday).toBe('星期一')
  })

  it('日期说法解析：后天、11 月底', () => {
    const result = resolveDateText('后天开工，11 月底上线', now)
    expect(result.dates.map((d) => d.date)).toContain('2026-09-30')
    expect(result.dates.map((d) => d.date)).toContain('2026-11-30')
  })

  it('团队产能按可投入系数折算；工具调用出错返回说明而不是抛异常', () => {
    const capacity = teamCapacity(
      [
        { role: '后端开发', headcount: 2 },
        { role: '前端开发', headcount: 1 },
      ],
      '2026-11-02',
      '2026-11-06',
    )
    expect(capacity.workdays).toBe(5)
    expect(capacity.headcount).toBe(3)
    expect(capacity.personDays).toBeCloseTo(3 * 5 * capacity.focusFactor, 0)
    expect(runPlanningTool({ name: 'workdays', args: { from: '明天' } }, now)).toHaveProperty(
      'error',
    )
    expect(runPlanningTool({ name: 'rm_rf', args: {} }, now)).toEqual({
      error: '没有这个工具：rm_rf',
    })
  })

  it('模型点名调用工具 → 程序算好 → 模型据此给最终答案', async () => {
    const prompts: string[] = []
    const replies = [
      '{"tool_calls":[{"name":"add_workdays","args":{"from":"2026-09-30","workdays":2}}]}',
      '{"answer":"2026-10-08"}',
    ]
    const gateway: TextGateway = {
      generate: async (options) => {
        prompts.push(options.promptSet!.userPrompt)
        return { rawText: replies.shift()!, triggeredErrors: [] }
      },
    }
    const streamed: string[] = []
    const result = await generateWithPlanningTools({
      gateway,
      systemPrompt: '算日期',
      userPrompt: '9 月 30 日起第 2 个工作日是哪天？',
      sentence: 't',
      promptName: 't',
      now,
      onText: (text) => streamed.push(text),
    })
    expect(result.answer).toEqual({ answer: '2026-10-08' })
    expect(result.toolCalls[0]!.result).toMatchObject({ date: '2026-10-08' })
    expect(prompts[1]).toContain('【工具结果】')
    expect(streamed.join('')).toContain('程序计算 add_workdays')
  })
})

const estimates: FeasibilityCapabilityEstimate[] = [
  {
    capabilityId: 'cap-1',
    name: '报名',
    low: 20,
    high: 30,
    deferrable: false,
    priority: 1,
    reason: '',
  },
  {
    capabilityId: 'cap-2',
    name: '积分',
    low: 15,
    high: 25,
    deferrable: false,
    priority: 2,
    reason: '',
  },
  {
    capabilityId: 'cap-3',
    name: '兑换商城',
    low: 20,
    high: 30,
    deferrable: true,
    priority: 4,
    reason: '',
  },
  {
    capabilityId: 'cap-4',
    name: '数据看板',
    low: 10,
    high: 14,
    deferrable: true,
    priority: 3,
    reason: '',
  },
  {
    capabilityId: 'overall',
    name: '整体联调、测试与上线',
    low: 8,
    high: 12,
    deferrable: false,
    priority: 1,
    reason: '',
  },
]
const dependsOn = new Map<string, string[]>([
  ['cap-2', ['cap-1']],
  ['cap-3', ['cap-2']],
  ['cap-4', ['cap-3']],
])

describe('可行性评估（程序计算部分）', () => {
  it('超期：给出推迟、加人、放第二期、照原计划四个方案，数字由程序算', () => {
    const assessment = buildAssessment({
      frame: {
        startDate: '2026-11-02',
        deadline: '2026-11-27',
        team: [
          { role: '后端开发', headcount: 2 },
          { role: '前端开发', headcount: 1 },
        ],
        teamSource: 'user',
        historyFactor: null,
      },
      estimates,
      dependsOn,
      contradictions: [],
    })
    expect(assessment.verdict).toBe('over')
    expect(assessment.effortPersonDays.expected).toBe(92)
    expect(assessment.options.map((option) => option.kind)).toEqual([
      'extend',
      'add_people',
      'defer',
      'as_is',
    ])
    const defer = assessment.options.find((option) => option.kind === 'defer')!
    // 看板依赖商城：先放最不核心的看板，再放商城
    expect(defer.decision.deferredCapabilityIds).toEqual(['cap-4', 'cap-3'])
    const extend = assessment.options.find((option) => option.kind === 'extend')!
    expect(extend.decision.deadline! > '2026-11-27').toBe(true)
    expect(assessment.options.filter((option) => option.recommended)).toHaveLength(1)
  })

  it('被保留的能力依赖的，不能放第二期', () => {
    const deferred = chooseDeferrals(estimates, dependsOn, 55, null)
    // 看板（cap-4）先放，之后商城（cap-3）不再被依赖才能放
    expect(deferred[0]).toBe('cap-4')
    expect(deferred).toContain('cap-3')
    expect(deferred).not.toContain('cap-2')
  })

  it('做得比截止日早很多：建议提前或保持原截止日当缓冲', () => {
    const assessment = buildAssessment({
      frame: {
        startDate: '2026-11-02',
        deadline: '2027-03-31',
        team: [{ role: '后端开发', headcount: 4 }],
        teamSource: 'user',
        historyFactor: null,
      },
      estimates,
      dependsOn,
      contradictions: [],
    })
    expect(assessment.verdict).toBe('early')
    expect(assessment.options[0]!.kind).toBe('finish_early')
    expect(assessment.options.find((option) => option.recommended)!.kind).toBe('as_is')
  })

  it('日历提醒：截止日落在国庆、期间有长假', () => {
    const notices = calendarNotices({ startDate: '2026-09-14', deadline: '2026-10-05' })
    expect(notices.join('\n')).toContain('截止日 2026-10-05')
    expect(notices.join('\n')).toContain('2026-09-30')
    expect(notices.join('\n')).toContain('国庆')
  })

  it('加人按比例分配，每个角色不少于原人数', () => {
    const team = scaleTeam(
      [
        { role: '后端开发', headcount: 2 },
        { role: '前端开发', headcount: 1 },
      ],
      5,
    )
    expect(team.reduce((sum, member) => sum + member.headcount, 0)).toBe(5)
    expect(team.find((member) => member.role === '后端开发')!.headcount).toBeGreaterThanOrEqual(3)
  })
})

function context(): ConfirmedProjectContext {
  return {
    rawInput: '社区志愿者小程序，后端 2 人、前端 1 人',
    parsedIntent: {
      projectName: '志愿者小程序',
      constraints: [],
      timeline: { startDate: '2026-11-02', deadline: '2026-11-27', durationDays: 26 },
    },
    resolvedFields: {},
    assumptions: {},
    planUnderstanding: {
      capabilities: [
        { id: 'cap-1', name: '报名', purpose: '', deliverables: [], dependsOn: [] },
        { id: 'cap-3', name: '兑换商城', purpose: '', deliverables: [], dependsOn: ['cap-1'] },
        { id: 'cap-4', name: '数据看板', purpose: '', deliverables: [], dependsOn: ['cap-3'] },
      ],
      constraints: [],
    },
  } as unknown as ConfirmedProjectContext
}

describe('用户确认的决定由程序套用', () => {
  it('推迟 + 加人 + 放第二期：截止日、团队、能力范围都改到位', () => {
    const next = applyFeasibilityDecision({
      ...context(),
      feasibilityDecision: {
        kind: 'custom',
        summary: 'x',
        deadline: '2026-12-11',
        team: [
          { role: '后端开发', headcount: 3 },
          { role: '前端开发', headcount: 2 },
        ],
        deferredCapabilityIds: ['cap-3', 'cap-4'],
        decidedAt: now.toISOString(),
      },
    })
    expect(next.parsedIntent.timeline.deadline).toBe('2026-12-11')
    expect(next.parsedIntent.timeline.durationDays).toBe(40)
    expect(next.planUnderstanding!.capabilities.map((c) => c.id)).toEqual(['cap-1'])
    expect(next.planUnderstanding!.constraints.at(-1)).toContain('第二期再做')
    expect(contextTeamRoster(next)).toEqual([
      { role: '后端开发', headcount: 3 },
      { role: '前端开发', headcount: 2 },
    ])
  })

  it('截止日改了：项目理解里提到旧截止日的文字一并换掉，用户自己的回答不改', () => {
    const base = context()
    const oldDeadline = base.parsedIntent.timeline.deadline!
    const next = applyFeasibilityDecision({
      ...base,
      planUnderstanding: {
        ...base.planUnderstanding!,
        capabilities: base.planUnderstanding!.capabilities.map((capability, index) =>
          index === 0 ? { ...capability, purpose: `保障 ${oldDeadline} 前上线` } : capability,
        ),
        answeredQuestions: [{ question: '什么时候上线？', answer: `${oldDeadline} 前` }],
      } as never,
      feasibilityDecision: {
        kind: 'extend',
        summary: 'x',
        deadline: '2026-12-11',
        decidedAt: now.toISOString(),
      },
    })
    expect(next.planUnderstanding!.capabilities[0]!.purpose).toBe('保障 2026-12-11 前上线')
    expect(next.planUnderstanding!.answeredQuestions![0]!.answer).toBe(`${oldDeadline} 前`)
  })

  it('照原计划不改任何东西', () => {
    const base = context()
    expect(
      applyFeasibilityDecision({
        ...base,
        feasibilityDecision: { kind: 'as_is', summary: 'x', decidedAt: now.toISOString() },
      }).parsedIntent,
    ).toBe(base.parsedIntent)
  })

  it('模型在对话里提的方案：非法字段丢弃，数字由程序重算', () => {
    const assessment = buildAssessment({
      frame: {
        startDate: '2026-11-02',
        deadline: '2026-11-27',
        team: [
          { role: '后端开发', headcount: 2 },
          { role: '前端开发', headcount: 1 },
        ],
        teamSource: 'user',
        historyFactor: null,
      },
      estimates,
      dependsOn,
      contradictions: [],
    })
    const option = priceProposal(
      {
        kind: 'custom',
        deadline: '2026-12-31',
        deferredCapabilityIds: ['cap-4', 'cap-99', 'overall'],
      },
      assessment,
    )!
    expect(option.decision.deferredCapabilityIds).toEqual(['cap-4'])
    expect(option.label).toContain('截止日改为 2026-12-31')
    expect(option.detail).toMatch(/^程序核算：工作量约 \d+(\.\d)? 人日/)
    expect(priceProposal({ kind: 'extend', deadline: '明年' }, assessment)).toBeNull()
  })
})

describe('检查点 A：追问阶段的日历提醒', () => {
  const ledger = (answers: Array<[string, string]>) =>
    ({
      schemaVersion: '2.0',
      revision: answers.length,
      entries: answers.map(([needId, answer], index) => ({
        needId,
        topic: needId,
        status: 'answered',
        questionSummary: needId,
        answer,
        revision: index + 1,
        updatedAt: now.toISOString(),
        source: 'direct',
        coverageSlots: [],
      })),
    }) as never

  it('答完开工日与截止日：截止日落在国庆假期、期间有长假就提醒', () => {
    const note = timingCheckpoint({
      rawInput: '做一个报名小程序',
      ledger: ledger([
        ['core.start_date', '2026-09-14'],
        ['core.duration', '2026-10-05 前完成'],
      ]),
      answeredNeedIds: ['core.duration'],
      now,
    })
    expect(note).toContain('日历提醒')
    expect(note).toContain('国庆')
    expect(note).toContain('我想修改之前的回答')
  })

  it('这一轮答的不是时间题、或时间还不全，不提醒', () => {
    expect(
      timingCheckpoint({
        rawInput: '做一个报名小程序',
        ledger: ledger([['core.team', '后端 2 人']]),
        answeredNeedIds: ['core.team'],
        now,
      }),
    ).toBeNull()
    expect(
      timingCheckpoint({
        rawInput: '做一个报名小程序',
        ledger: ledger([['core.start_date', '2026-11-02']]),
        answeredNeedIds: ['core.start_date'],
        now,
      }),
    ).toBeNull()
  })
})

describe('模型输出里的 JSON', () => {
  it('同时写了 tool_calls 与最终答案时取最终答案；前后有说明文字、字符串里有花括号也能取', () => {
    expect(
      extractJsonObject(
        '先算一下 {"tool_calls":[{"name":"date_info","args":{"date":"2026-10-01"}}]} 然后 {"verdict":"answered","normalized":"a}b"}',
      ),
    ).toEqual({ verdict: 'answered', normalized: 'a}b' })
    expect(extractJsonObject('{"tool_calls":[]}')).toEqual({ tool_calls: [] })
    expect(extractJsonObject('没有 JSON')).toBeNull()
    expect(extractJsonObject('{"a":1')).toBeNull()
  })
})
