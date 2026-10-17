import { describe, expect, it } from 'vitest'
import { classifyProjectHealth, isoDay } from '#services/project_health_service'

describe('项目健康度（读取期派生）', () => {
  const base = {
    taskTotal: 10,
    overdue: 0,
    blocked: 0,
    latestTaskEnd: '2026-11-10',
    projectEnd: '2026-11-12',
  }

  it('没有任务才是未评估；按期、无逾期受阻为健康', () => {
    expect(classifyProjectHealth({ ...base, taskTotal: 0 })).toBe('unknown')
    expect(classifyProjectHealth(base)).toBe('healthy')
  })

  it('有逾期 / 受阻，或计划完工晚于截止日，为有风险', () => {
    expect(classifyProjectHealth({ ...base, overdue: 1 })).toBe('at_risk')
    expect(classifyProjectHealth({ ...base, blocked: 1 })).toBe('at_risk')
    expect(classifyProjectHealth({ ...base, latestTaskEnd: '2026-11-13' })).toBe('at_risk')
  })

  it('逾期或受阻占 25% 以上为严重', () => {
    expect(classifyProjectHealth({ ...base, overdue: 3 })).toBe('critical')
  })

  it('日期列：PG 返回的本地零点 Date 按本地年月日取，不退一天也不变成「Mon Oct 12」', () => {
    expect(isoDay(new Date(2026, 9, 12))).toBe('2026-10-12')
    expect(isoDay('2026-10-12T00:00:00.000Z')).toBe('2026-10-12')
    expect(isoDay(null)).toBeNull()
    expect(isoDay('not a date')).toBeNull()
  })
})
