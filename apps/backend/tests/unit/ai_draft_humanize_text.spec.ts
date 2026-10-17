import { describe, expect, it } from 'vitest'
import { humanizeInternalTerms, humanizeReferenceText } from '#services/ai_draft/quality_loop'

describe('审查意见去掉内部术语', () => {
  it('输入结构的字段名换成用户能懂的说法', () => {
    expect(humanizeInternalTerms('spine中该问题记录为“二期再对接”')).toBe(
      '已确认信息中该问题记录为“二期再对接”',
    )
    expect(humanizeInternalTerms('培训规则确认人未指定（confirmedAnswers为二期再对接）')).toBe(
      '培训规则确认人未指定（已确认的问答为二期再对接）',
    )
    expect(humanizeInternalTerms('任务ID未在分支数据中提供')).toBe('任务ID未在本部分计划中提供')
  })

  it('不误伤正常的英文技术词', () => {
    expect(humanizeInternalTerms('数据库 schema 变更需评审')).toBe('数据库 schema 变更需评审')
  })

  it('能力编号换成能力名，找不到的保留原样', () => {
    const names = new Map([['cap-4', '微信小程序员工端基础与微信接入']])
    expect(humanizeReferenceText('cap-4 总工期超出预算；cap-9 待补', names)).toBe(
      '「微信小程序员工端基础与微信接入」 总工期超出预算；cap-9 待补',
    )
  })
})
