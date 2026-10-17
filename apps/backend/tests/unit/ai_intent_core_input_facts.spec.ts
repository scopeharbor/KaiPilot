import { describe, expect, it } from 'vitest'
import {
  applyCoreAnswers,
  checkCoreAnswer,
  inputCoreFacts,
  withCoreInformationNeeds,
  withInputFacts,
} from '#services/ai_intent/core_information_needs'
import type {
  ClarificationLedger,
  ConfirmedProjectContext,
  ProjectUnderstanding,
} from '@aiproj/types'

// 2026-09-27（周日）北京时间上午
const now = new Date('2026-09-27T02:00:00Z')

describe('原话里的开工日 / 工期 / 团队', () => {
  it('「前一天」「第二天」「每天」不是工期：没说截止就照常追问', () => {
    const facts = inputCoreFacts(
      '做一个食堂订餐 H5：员工前一天 16 点前预订第二天午餐，每天汇总一次。10 月 12 日开工。团队：前端 1 人、后端 1 人。',
      now,
    )
    expect(facts.duration.status).toBe('absent')
    expect(
      inputCoreFacts('10 月 12 日开工，周期约 3 个月，团队 3 人', now).duration.durationDays,
    ).toBe(90)
    expect(inputCoreFacts('下周开工，预计 两周 做完，团队 2 人', now).duration.durationDays).toBe(
      14,
    )
  })

  it('说清楚的：具体日期开工、N 个月周期、名册团队', () => {
    const facts = inputCoreFacts(
      '某城商行计划于 2026 年 10 月 12 日启动支付中台重构，周期约 6 个月。团队 25 人：架构师 2、后端开发 10。',
      now,
    )
    expect(facts.start).toMatchObject({ status: 'precise', value: '2026-10-12' })
    expect(facts.duration).toMatchObject({ status: 'precise', durationDays: 180 })
    expect(facts.team.status).toBe('precise')
  })

  it('「12 月 20 日年会当天要用」也是说清楚的截止日（浏览器实测曾被再问一遍工期）', () => {
    const facts = inputCoreFacts(
      '为公司年会做一个抽奖和节目投票的 H5 页面，12 月 20 日年会当天要用。',
      now,
    )
    expect(facts.duration).toMatchObject({ status: 'precise', deadline: '2026-12-20' })
  })

  it('截止日说清楚：「12 月 31 日前上线」', () => {
    const facts = inputCoreFacts('做一个会员小程序，12 月 31 日前上线', now)
    expect(facts.duration).toMatchObject({ status: 'precise', deadline: '2026-12-31' })
    expect(facts.start.status).toBe('absent')
  })

  it('模糊的：「下个月开始」「年底前」「一个小团队」', () => {
    const facts = inputCoreFacts('下个月开始做内部报销系统，年底前上线，我们是一个小团队', now)
    // 下个月第一个工作日（国庆后）
    expect(facts.start).toMatchObject({ status: 'vague', value: '2026-10-08' })
    expect(facts.duration).toMatchObject({ status: 'vague', deadline: '2026-12-31' })
    expect(facts.team.status).toBe('vague')
  })

  it('「11 月下旬举办」是模糊的截止，不是 11 个月的工期', () => {
    const facts = inputCoreFacts('组织一场 500 人参加的年度客户大会，希望在 11 月下旬举办', now)
    expect(facts.duration).toMatchObject({
      status: 'vague',
      deadline: '2026-11-30',
      durationDays: null,
    })
    // 「500 人参加」是规模不是团队
    expect(facts.team.status).toBe('absent')
  })

  it('什么都没说', () => {
    const facts = inputCoreFacts('我们想做一个公司内部的报销系统', now)
    expect(facts.start.status).toBe('absent')
    expect(facts.duration.status).toBe('absent')
    expect(facts.team.status).toBe('absent')
  })
})

describe('追问：说清楚的不问，模糊的确认，没说的照问', () => {
  const understanding = (needs: Array<{ id: string; topic: string; missingInformation: string }>) =>
    ({
      schemaVersion: '2.0',
      summaryForUser: '',
      inferredDomainLabel: '',
      likelyDeliverables: [],
      knownFacts: [],
      informationNeeds: needs.map((need) => ({
        ...need,
        decisionImpact: ['scope'],
        whyItMatters: '',
        priority: 'high',
        answerKind: 'short_text',
        confidence: 0.5,
        uncertainty: 0.5,
        userEffort: 'low',
        sensitivity: 'none',
      })),
      sufficientForPreliminaryDraft: true,
    }) as unknown as ProjectUnderstanding
  const ledger = {
    schemaVersion: '2.0',
    revision: 0,
    entries: [],
  } as unknown as ClarificationLedger

  it('原话全部说清楚：三个核心问题都不问，模型自己的同类问题也去掉', () => {
    const result = withCoreInformationNeeds({
      understanding: understanding([
        { id: 'm1', topic: '启动时间', missingInformation: '项目什么时候开始？' },
        { id: 'm2', topic: '团队', missingInformation: '团队有多少人？' },
        { id: 'm3', topic: '签到方式', missingInformation: '签到用什么方式？' },
      ]),
      ledger,
      rawInput:
        '10 月 12 日启动会议室预订小程序，周期 3 个月，团队 6 人：产品 1、前端 2、后端 2、测试 1。',
      now,
    })
    expect(result.informationNeeds.map((need) => need.id)).toEqual(['m3'])
    expect(result.sufficientForPreliminaryDraft).toBe(true)
  })

  it('模糊的开工日：确认问题的首个选项就是我们的理解', () => {
    const result = withCoreInformationNeeds({
      understanding: understanding([]),
      ledger,
      rawInput: '下个月开始做报销系统，周期 3 个月，团队 5 人',
      now,
    })
    expect(result.informationNeeds).toHaveLength(1)
    const need = result.informationNeeds[0]!
    expect(need.id).toBe('core.start_date')
    expect(need.missingInformation).toContain('下个月')
    expect(need.suggestedOptions?.[0]?.value).toBe('2026-10-08')
  })

  it('快捷选项落在假期时写明顺延，不让「下周一（10-08）」看起来像算错', () => {
    const result = withCoreInformationNeeds({
      understanding: understanding([]),
      ledger,
      rawInput: '做一个报销系统，周期 3 个月，团队 5 人',
      // 周一：下一个工作日是明天，下周一（10-05）落在国庆假期里
      now: new Date('2026-09-28T02:00:00Z'),
    })
    const labels = result.informationNeeds[0]!.suggestedOptions!.map((option) => option.label)
    expect(labels).toContain('下周一（10-05 是非工作日，顺延至 2026-10-08）')
  })
})

describe('原话说清楚的值直接写进计划', () => {
  it('回答了截止日：工期按开工日与截止日重算，覆盖意图解析猜的 300 天', () => {
    const context = {
      rawInput: '做一个食堂订餐 H5。10 月 12 日开工。团队：前端 1 人、后端 1 人、测试 1 人。',
      parsedIntent: { timeline: { startDate: null, deadline: null, durationDays: 300 } },
      resolvedFields: {},
      assumptions: {},
    } as unknown as ConfirmedProjectContext
    const ledger = {
      schemaVersion: '2.0',
      revision: 1,
      entries: [
        {
          needId: 'core.duration',
          topic: 'duration',
          status: 'answered',
          questionSummary: '工期',
          answer: '10 月 31 日前上线',
          revision: 1,
          updatedAt: now.toISOString(),
          source: 'direct',
          coverageSlots: [],
        },
      ],
    } as unknown as ClarificationLedger
    const timeline = applyCoreAnswers(context, ledger, now).parsedIntent.timeline
    expect(timeline).toMatchObject({
      startDate: '2026-10-12',
      deadline: '2026-10-31',
      durationDays: 20,
    })
  })

  it('开工日、工期、截止日、团队都来自原话，标为用户给出', () => {
    const context = {
      rawInput:
        '10 月 12 日启动会议室预订小程序，周期 3 个月，团队 6 人：产品 1、前端 2、后端 2、测试 1。',
      parsedIntent: { timeline: { startDate: null, deadline: null, durationDays: null } },
      resolvedFields: {},
      assumptions: {},
    } as unknown as ConfirmedProjectContext
    const next = withInputFacts(context, now)
    expect(next.parsedIntent.timeline).toEqual({
      startDate: '2026-10-12',
      durationDays: 90,
      deadline: '2027-01-09',
    })
    expect(next.resolvedFields.startDate?.marker.reason).toBe('用户在需求描述中给出')
    expect(next.resolvedFields.teamSize?.marker.source).toBe('explicit')
  })
})

describe('答题检查（规则层）', () => {
  it('新增的日期说法：大后天、这周几、N 天后、几号', () => {
    // now = 2026-09-27（周日）
    expect(inputCoreFacts('大后天开工', now).start).toMatchObject({ value: '2026-09-30' })
    expect(inputCoreFacts('3 天后开始', now).start).toMatchObject({ value: '2026-09-30' })
  })

  it('开工日：读得懂的日期通过，答非所问返回 null 交给模型', () => {
    expect(checkCoreAnswer('core.start_date', '下周三', now)).toBe('下周三')
    expect(checkCoreAnswer('core.start_date', '8 号', now)).toBe('8 号')
    expect(checkCoreAnswer('core.start_date', '我今天想吃汉堡', now)).toBeNull()
  })

  it('确认题里回「可以」等于选了「就按我们的理解」', () => {
    const options = [
      { id: 'as_understood', label: '就按 2026-10-08', value: '2026-10-08' },
      { id: 'next', label: '下一个工作日', value: '2026-09-28' },
    ]
    expect(checkCoreAnswer('core.start_date', '可以', now, options)).toBe('2026-10-08')
    expect(checkCoreAnswer('core.start_date', '下一个工作日', now, options)).toBe('2026-09-28')
  })

  it('工期与团队', () => {
    expect(checkCoreAnswer('core.duration', '大概三个月', now)).toBe('大概三个月')
    expect(checkCoreAnswer('core.duration', '越快越好', now)).toBeNull()
    expect(checkCoreAnswer('core.team', '后端 2 人、前端 1 人', now)).not.toBeNull()
    expect(checkCoreAnswer('core.team', '先按角色估算', now)).not.toBeNull()
    expect(checkCoreAnswer('core.team', '随便', now)).toBeNull()
  })
})
