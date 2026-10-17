import { describe, expect, test } from 'vitest'
import {
  DAILY_GREETINGS,
  DAILY_GREETING_CONTENT_CHANGES,
  getGreetingLabel,
  getGreetingTimeSlot,
  selectDailyGreeting,
} from '@/lib/daily-greetings'

describe('daily greetings', () => {
  test('保留去重后的用户文案并加入项目语境短句', () => {
    expect(DAILY_GREETINGS).toHaveLength(504)
    expect(new Set(DAILY_GREETINGS.map((greeting) => greeting.text)).size).toBe(
      DAILY_GREETINGS.length,
    )
    expect(DAILY_GREETING_CONTENT_CHANGES.removed).toHaveLength(2)
    expect(DAILY_GREETING_CONTENT_CHANGES.added).toHaveLength(6)
  })

  test('按本地小时返回基础时间问候', () => {
    expect(getGreetingTimeSlot(new Date(2026, 6, 11, 2))).toBe('late-night')
    expect(getGreetingLabel(new Date(2026, 6, 11, 2))).toBe('深夜好')
    expect(getGreetingLabel(new Date(2026, 6, 11, 9))).toBe('早上好')
    expect(getGreetingLabel(new Date(2026, 6, 11, 12))).toBe('中午好')
    expect(getGreetingLabel(new Date(2026, 6, 11, 15))).toBe('下午好')
    expect(getGreetingLabel(new Date(2026, 6, 11, 20))).toBe('晚上好')
  })

  test('同一用户同一天同一时段稳定选择同一句', () => {
    const input = { date: new Date(2026, 6, 11, 9), userKey: 'pm@example.com' }
    const first = selectDailyGreeting(input)
    const second = selectDailyGreeting(input)

    expect(second).toEqual(first)
    expect(first.timeSlots).toContain('morning')
  })

  test('不同日期会进入新的稳定选择', () => {
    const first = selectDailyGreeting({
      date: new Date(2026, 6, 11, 9),
      userKey: 'pm@example.com',
    })
    const second = selectDailyGreeting({
      date: new Date(2026, 6, 12, 9),
      userKey: 'pm@example.com',
    })

    expect(second.id).not.toBe(first.id)
  })
})
