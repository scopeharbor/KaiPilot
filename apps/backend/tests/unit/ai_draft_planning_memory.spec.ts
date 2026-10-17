import { test } from '@japa/runner'
import type { ProjectDraft, ProjectUnderstanding } from '@aiproj/types'
import {
  EMPTY_PLANNING_MEMORY,
  explicitRoster,
  planningDurationFactor,
  planningMemoryFacts,
} from '../../app/services/ai_draft/planning_memory.js'
import { withCoreInformationNeeds } from '../../app/services/ai_intent/core_information_needs.js'

const marker = (source: string) => ({ confidence: 1, source, reason: '', needsConfirmation: false })

function draftWithTeam(entries: Array<[string, number, string]>): ProjectDraft {
  return {
    resourceHints: entries.map(([role, headcount, source], index) => ({
      id: `r-${index}`,
      role: { value: role, marker: marker(source) },
      headcount: { value: headcount, marker: marker(source) },
      allocationNote: { value: '', marker: marker(source) },
    })),
  } as unknown as ProjectDraft
}

test.group('ai_draft planning memory', () => {
  test('没有历史时不产出任何记忆，也不校准', ({ assert }) => {
    assert.deepEqual(planningMemoryFacts(EMPTY_PLANNING_MEMORY), [])
    assert.isNull(planningDurationFactor(EMPTY_PLANNING_MEMORY))
  })

  test('上次团队只取用户明确给出的，不含 AI 估算的与成员代号', ({ assert }) => {
    const draft = draftWithTeam([
      ['产品经理', 1, 'explicit'],
      ['前端', 2, 'explicit'],
      ['成员#16', 1, 'explicit'],
      ['运维', 1, 'inferred'],
    ])
    assert.deepEqual(explicitRoster(draft), [
      { role: '产品经理', headcount: 1 },
      { role: '前端', headcount: 2 },
    ])
    assert.deepEqual(explicitRoster(draftWithTeam([['测试', 2, 'inferred']])), [])
  })

  test('执行数据优先于转正调整；记忆写成给模型看的句子', ({ assert }) => {
    const memory = {
      ...EMPTY_PLANNING_MEMORY,
      removedTasks: ['每日站会'],
      addedTasks: ['微信小程序提审'],
      editDurationFactor: { factor: 0.9, samples: 12 },
      executionFactor: { factor: 1.3, samples: 20 },
      preferredPhases: ['需求', '开发', '上线'],
    }
    const facts = planningMemoryFacts(memory)
    assert.lengthOf(facts, 5)
    assert.match(facts[0]!, /删掉过.*每日站会/)
    assert.match(facts[1]!, /补上过.*微信小程序提审/)
    assert.deepInclude(planningDurationFactor(memory), { factor: 1.3 })
    assert.deepInclude(planningDurationFactor({ ...memory, executionFactor: null }), {
      factor: 0.9,
    })
  })
})

test.group('core team need remembers last team', () => {
  const understanding = {
    informationNeeds: [],
    sufficientForPreliminaryDraft: true,
  } as unknown as ProjectUnderstanding
  const ledger = { schemaVersion: '1', revision: 0, entries: [] } as never

  test('有上次团队时，团队问题的第一个选项是「沿用上次的团队」', ({ assert }) => {
    const result = withCoreInformationNeeds({
      understanding,
      ledger,
      rawInput: '做一个会议室预订小程序',
      now: new Date('2026-09-27T08:00:00Z'),
      lastTeam: '产品经理 1 人、前端 2 人',
    })
    const team = result.informationNeeds.find((need) => need.id === 'core.team')!
    assert.equal(team.suggestedOptions?.[0]?.id, 'last_team')
    assert.equal(team.suggestedOptions?.[0]?.value, '产品经理 1 人、前端 2 人')
  })

  test('没有上次团队时不出现该选项', ({ assert }) => {
    const result = withCoreInformationNeeds({
      understanding,
      ledger,
      rawInput: '做一个会议室预订小程序',
      now: new Date('2026-09-27T08:00:00Z'),
    })
    const team = result.informationNeeds.find((need) => need.id === 'core.team')!
    assert.notInclude(
      (team.suggestedOptions ?? []).map((option) => option.id),
      'last_team',
    )
  })
})
