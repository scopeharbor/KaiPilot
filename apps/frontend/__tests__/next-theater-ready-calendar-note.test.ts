/**
 * 检查点 A 的落点（2026-09-28）：追问在答完时间那一题就结束时，日历提醒改在就绪页显示。
 */
import { describe, expect, test } from 'vitest'
import type { AdaptiveClarificationSession } from '@aiproj/types'
import { lastCalendarNote } from '@/components/next/theater/TheaterReadyView'

const NOTE =
  '📅 日历提醒：截止日 2026-10-31 是周六，按前一个工作日 2026-10-30 交付计算。如果时间说错了，回答「我想修改之前的回答」就能改。'

function session(status: AdaptiveClarificationSession['status'], calendarNote?: string | null) {
  return { status, calendarNote, conversation: null } as unknown as AdaptiveClarificationSession
}

describe('就绪页的日历提醒', () => {
  test('追问结束时显示提醒，改成就绪页能用的修改入口', () => {
    expect(lastCalendarNote(session('ready', NOTE))).toBe(
      '截止日 2026-10-31 是周六，按前一个工作日 2026-10-30 交付计算。如果时间说错了，可以点下方「重新调整回答」修改。',
    )
  })

  test('还在追问或没有提醒时不显示', () => {
    expect(lastCalendarNote(session('clarifying', NOTE))).toBeNull()
    expect(lastCalendarNote(session('ready', null))).toBeNull()
    expect(lastCalendarNote(null)).toBeNull()
  })
})
