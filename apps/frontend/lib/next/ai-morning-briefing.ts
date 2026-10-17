import type { Notification } from '@/lib/api/notifications'

export const MORNING_BRIEFING_RULE_ID = 'rule_morning_briefing'
export const MORNING_BRIEFING_TOOL_NAME = 'get_morning_briefing'

/**
 * 晨报式主动简报卡意图正则（v3-ui-next-batch3-global-convergence W2 · tasks 2.7）。
 *
 * 覆盖：今日简报 / 今日晨报 / 看一下晨报 / 有什么新通知 / 今日态势 / 晨报 / 态势简报 / 每日简报。
 */
export const MORNING_BRIEFING_PATTERN =
  /(?:今日简报|今日晨报|晨报|早报|今日态势|态势简报|每日简报|有什么新通知|看(?:一下)?晨报)/i

export interface MorningBriefingUrgentNotification {
  id: number
  title: string
  body?: string | null
  severity: string
  createdAt: string
  projectId?: number | null
  target?: { type: string; id: number } | null
}

export interface MorningBriefingTodayTasksSummary {
  dueTodayCount: number
  overdueCount: number
  totalFocusCount: number
}

export interface MorningBriefingData {
  urgentNotifications: MorningBriefingUrgentNotification[]
  todayTasksSummary: MorningBriefingTodayTasksSummary
  generatedAt: string
}

export interface BriefingTaskLike {
  id: number
  title: string
  dueDate?: string | null
  status?: string
  projectId?: number | null
}

/**
 * 意图判定函数：纯规则大白话匹配。
 */
export function matchMorningBriefingIntent(input: string): boolean {
  return MORNING_BRIEFING_PATTERN.test(input.trim())
}

/**
 * 意图解析构造结构：对齐 ParsedColleagueIntent。
 */
export function resolveMorningBriefingIntent(input: string) {
  if (!matchMorningBriefingIntent(input)) {
    return null
  }
  return {
    toolName: MORNING_BRIEFING_TOOL_NAME,
    parameters: {},
    intentSource: 'rule_preset' as const,
    confidence: 1,
    matchedRuleId: MORNING_BRIEFING_RULE_ID,
  }
}

/**
 * 客户端纯规则合成晨报简报（RL-01 零写请求、零不可信 LLM 幻觉）：
 * 1. 紧急通知关注：汇总待处理高优通知项（severity 为 warning 或 critical/error，未读）；
 * 2. 今日排程焦点：列出今日截止或逾期的关键任务数。
 */
export function generateMorningBriefing(
  notifications: readonly Notification[] = [],
  tasks: readonly BriefingTaskLike[] = [],
  now: Date = new Date(),
): MorningBriefingData {
  // 提取至多 2 条高危未读通知
  const urgentNotifications: MorningBriefingUrgentNotification[] = notifications
    .filter(
      (n) =>
        !n.readAt &&
        (n.severity === 'warning' || n.severity === 'critical' || n.severity === 'error'),
    )
    .slice(0, 2)
    .map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      severity: n.severity,
      createdAt: n.createdAt,
      projectId: n.projectId,
      target: n.target,
    }))

  // 今日 YYYY-MM-DD
  const todayStr = now.toISOString().slice(0, 10)
  let dueTodayCount = 0
  let overdueCount = 0

  for (const task of tasks) {
    if (!task.dueDate || task.status === 'completed' || task.status === 'cancelled') {
      continue
    }
    const dueStr = typeof task.dueDate === 'string' ? task.dueDate.slice(0, 10) : ''
    if (dueStr === todayStr) {
      dueTodayCount += 1
    } else if (dueStr < todayStr) {
      overdueCount += 1
    }
  }

  return {
    urgentNotifications,
    todayTasksSummary: {
      dueTodayCount,
      overdueCount,
      totalFocusCount: dueTodayCount + overdueCount,
    },
    generatedAt: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  }
}
