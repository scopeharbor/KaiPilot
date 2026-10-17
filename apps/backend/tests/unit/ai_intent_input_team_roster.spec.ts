import { describe, expect, it } from 'vitest'
import { inputCoreFacts } from '#services/ai_intent/core_information_needs'

describe('原话里的团队', () => {
  it('角色名册整段记下并合计，不只取第一个「1 人」', () => {
    const facts = inputCoreFacts(
      '做一个食堂订餐 H5，还要对接 OA 单点登录。10 月 12 日开工。团队：前端 1 人、后端 1 人、测试 1 人。',
      new Date('2026-09-28T08:00:00Z'),
    )
    expect(facts.team).toEqual({
      status: 'precise',
      quote: '前端 1 人、后端 1 人、测试 1 人（共 3 人）',
    })
  })

  it('只说人数时照旧', () => {
    expect(inputCoreFacts('团队 5 人，下月开工', new Date('2026-09-28T08:00:00Z')).team).toEqual({
      status: 'precise',
      quote: '5 人',
    })
  })
})
