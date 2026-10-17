import { describe, expect, it } from 'vitest'
import type { ConfirmedProjectContext } from '@aiproj/types'
import {
  computeDraftGranularity,
  contextTeamSize,
  draftGranularityGuide,
} from '#services/ai_draft/granularity_guide'

function context(overrides: Partial<ConfirmedProjectContext> = {}): ConfirmedProjectContext {
  return {
    schemaVersion: '1.0',
    rawInput: '测试项目',
    parsedIntent: {
      schemaVersion: '1.0',
      projectType: 'software',
      projectName: '测试项目',
      objectives: [],
      deliverables: [],
      timeline: { startDate: null, deadline: null, durationDays: null },
      constraints: [],
      entities: [],
      overallConfidence: 0.8,
    },
    resolvedFields: {},
    assumptions: {},
    unresolvedCriticalFields: [],
    unansweredOptionalFields: [],
    ...overrides,
  } as ConfirmedProjectContext
}

describe('computeDraftGranularity', () => {
  it('25 人 × 6 个月的大型项目要求上百个工作包级任务与 3 层 WBS', () => {
    const target = computeDraftGranularity({
      teamSize: 25,
      startDate: '2026-10-12',
      endDate: '2027-04-15',
    })
    expect(target.weeks).toBe(27)
    expect(target.minTasks).toBeGreaterThanOrEqual(100)
    expect(target.maxTasks).toBeGreaterThan(target.minTasks)
    expect(target.minWbsDepth).toBe(3)
    expect(target.minLeafNodes).toBeGreaterThanOrEqual(25)
  })

  it('小项目保持下限，不被放大', () => {
    const target = computeDraftGranularity({
      teamSize: 3,
      startDate: '2026-10-01',
      endDate: '2026-11-15',
    })
    expect(target.minTasks).toBe(12)
    expect(target.minWbsDepth).toBe(2)
  })

  it('超大项目任务数封顶，避免超出单阶段输出预算', () => {
    const target = computeDraftGranularity({
      teamSize: 200,
      startDate: '2026-01-01',
      endDate: '2027-12-31',
    })
    expect(target.minTasks).toBeLessThanOrEqual(160)
    expect(target.maxTasks).toBeLessThanOrEqual(200)
  })

  it('缺人数或日期时按 5 人 / 12 周估算', () => {
    const target = computeDraftGranularity({ teamSize: null, startDate: null, endDate: null })
    expect(target.teamSize).toBe(5)
    expect(target.weeks).toBe(12)
    expect(target.minTasks).toBe(12)
  })

  it('指引文本写明具体数量区间与单任务工期上限', () => {
    const guide = draftGranularityGuide(
      computeDraftGranularity({ teamSize: 25, startDate: '2026-10-12', endDate: '2027-04-15' }),
    )
    expect(guide).toContain('25 人')
    expect(guide).toMatch(/tasks 输出 \d+–\d+ 个/)
    expect(guide).toContain('3–10 个工作日')
  })
})

describe('contextTeamSize', () => {
  it('优先用户确认值，其次解析实体，最后组织人数推断', () => {
    const marker = { confidence: 1, source: 'user', reason: '确认', needsConfirmation: false }
    expect(
      contextTeamSize(
        context({
          resolvedFields: { teamSize: { value: 25, marker } } as never,
          assumptions: { teamSize: { value: 3, marker } } as never,
        }),
      ),
    ).toBe(25)

    const parsed = context()
    parsed.parsedIntent.entities = [
      { type: 'team_size', value: 18, text: '18 人', start: 0, end: 4, confidence: 0.9 } as never,
    ]
    parsed.assumptions = { teamSize: { value: 3, marker } } as never
    expect(contextTeamSize(parsed)).toBe(18)

    expect(
      contextTeamSize(
        context({ assumptions: { teamSize: { value: '10 人以上', marker } } as never }),
      ),
    ).toBe(10)
    expect(contextTeamSize(context())).toBeNull()
  })
})
