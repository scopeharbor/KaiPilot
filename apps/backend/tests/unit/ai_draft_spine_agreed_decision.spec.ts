import { describe, expect, it } from 'vitest'
import type { ConfirmedProjectContext } from '@aiproj/types'
import { buildSpine } from '#services/ai_draft/draft_memory'

function context(
  decision?: ConfirmedProjectContext['feasibilityDecision'],
): ConfirmedProjectContext {
  return {
    rawInput: '公司内部食堂订餐 H5，老板要 10 月底上线',
    parsedIntent: {
      projectType: 'software',
      projectName: '食堂订餐',
      objectives: [],
      deliverables: [],
      timeline: { startDate: '2026-10-12', deadline: '2026-11-16', durationDays: 36 },
      constraints: [],
      entities: [],
      overallConfidence: 0.9,
    },
    resolvedFields: {},
    assumptions: {},
    ...(decision ? { feasibilityDecision: decision } : {}),
  } as unknown as ConfirmedProjectContext
}

describe('主干记忆：生成前协商的决定', () => {
  it('有协商决定时注入 agreedDecision，写明优先于原话与问答里更早的截止日', () => {
    const spine = buildSpine({
      context: context({
        kind: 'custom',
        summary: '截止日改为 2026-11-16；第二期再做：工资卡扣款集成',
        deadline: '2026-11-16',
        decidedAt: '2026-09-28T00:00:00.000Z',
      }),
      aggregate: {},
    })
    const agreed = spine.agreedDecision as { decision: string; rule: string }
    expect(agreed.decision).toContain('2026-11-16')
    expect(agreed.rule).toMatch(/更早提到的上线日、截止日已作废/)
    expect((spine.schedule as { endDate: string }).endDate).toBe('2026-11-16')
  })

  it('照原计划或没有协商时不注入', () => {
    expect(buildSpine({ context: context(), aggregate: {} }).agreedDecision).toBeUndefined()
    const asIs = buildSpine({
      context: context({ kind: 'as_is', summary: '照原计划生成', decidedAt: '2026-09-28' }),
      aggregate: {},
    })
    expect(asIs.agreedDecision).toBeUndefined()
  })
})
