import {
  DAILY_GREETINGS,
  DAILY_GREETING_CONTENT_CHANGES,
  type DailyGreeting,
  type GreetingTimeSlot,
} from './daily-greeting-corpus'

const GREETING_LABELS: Record<GreetingTimeSlot, string> = {
  'late-night': '深夜好',
  morning: '早上好',
  noon: '中午好',
  afternoon: '下午好',
  evening: '晚上好',
}

export { DAILY_GREETINGS, DAILY_GREETING_CONTENT_CHANGES }
export type { DailyGreeting, GreetingTimeSlot }

export interface SelectDailyGreetingInput {
  date?: Date
  userKey?: string | null
}

export function getGreetingTimeSlot(date = new Date()): GreetingTimeSlot {
  const hour = date.getHours()
  if (hour < 6) return 'late-night'
  if (hour < 12) return 'morning'
  if (hour < 14) return 'noon'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

export function getGreetingLabel(date = new Date()): string {
  return GREETING_LABELS[getGreetingTimeSlot(date)]
}

export function selectDailyGreeting({
  date = new Date(),
  userKey,
}: SelectDailyGreetingInput = {}): DailyGreeting {
  const timeSlot = getGreetingTimeSlot(date)
  const scopedGreetings = DAILY_GREETINGS.filter((greeting) =>
    greeting.timeSlots.includes(timeSlot),
  )
  const pool = scopedGreetings.length > 0 ? scopedGreetings : DAILY_GREETINGS
  const hashKey = `${formatDateKey(date)}|${timeSlot}|${userKey ?? 'anonymous'}`
  const selectedGreeting = pool[stableHash(hashKey) % pool.length] ?? DAILY_GREETINGS[0]
  if (!selectedGreeting) {
    throw new Error('Daily greeting corpus must contain at least one greeting.')
  }
  return selectedGreeting
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
