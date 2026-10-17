/**
 * 检查点 A（2026-09-28）：追问阶段一拿到开工日与工期 / 截止日，就用程序查日历提醒冲突。
 *
 * 不等到生成完才发现「截止日是国庆」「中间有 7 天长假」「截止日比开工日还早」——
 * 在记下这道题的同一轮就告诉用户，附在下一题的说明里；用户可以说「我想修改之前的回答」来改。
 */
import type { ClarificationLedger, ConfirmedProjectContext } from '@aiproj/types'
import { calendarNotices } from '#services/ai_planning/feasibility_service'
import { CORE_NEED_IDS, applyCoreAnswers, withInputFacts } from './core_information_needs.js'

const TIMING_NEEDS = new Set<string>([CORE_NEED_IDS.startDate, CORE_NEED_IDS.duration])

/** 原话 + 已答的核心题推出的开工日与截止日。 */
export function answeredTiming(rawInput: string, ledger: ClarificationLedger, now: Date) {
  const base = {
    rawInput,
    parsedIntent: { timeline: { startDate: null, deadline: null, durationDays: null } },
    resolvedFields: {},
    assumptions: {},
  } as unknown as ConfirmedProjectContext
  return applyCoreAnswers(withInputFacts(base, now), ledger, now).parsedIntent.timeline
}

/**
 * 这一轮刚答完开工日或工期时的日历提醒（没有就返回 null）。
 * 调休上班这类不影响判断的信息不在这里啰嗦，留给生成前的评估面板。
 */
export function timingCheckpoint(args: {
  rawInput: string
  ledger: ClarificationLedger
  answeredNeedIds: readonly string[]
  now: Date
}): string | null {
  if (!args.answeredNeedIds.some((id) => TIMING_NEEDS.has(id))) return null
  const timeline = answeredTiming(args.rawInput, args.ledger, args.now)
  if (!timeline.startDate || !timeline.deadline) return null
  let notices: string[]
  try {
    notices = calendarNotices({ startDate: timeline.startDate, deadline: timeline.deadline })
  } catch {
    return null
  }
  const important = notices.filter((notice) => !notice.startsWith('调休上班'))
  if (important.length === 0) return null
  return `📅 日历提醒：${important.join(' ')}如果时间说错了，回答「我想修改之前的回答」就能改。`
}
