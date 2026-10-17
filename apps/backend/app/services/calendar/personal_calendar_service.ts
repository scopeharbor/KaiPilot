/**
 * 个人工作日历（日历第 3 批）：休假与个人工作日，存在 users.preferences.personalCalendar，跨项目生效。
 *
 * 只有本人能改自己的；写入记审计（前后值）。排期侧（日历快速新建）按成员批量读取，避开不上班的日子。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import {
  EMPTY_PERSONAL_CALENDAR,
  normalizePersonalCalendar,
  type PersonalWorkingCalendar,
} from '@aiproj/types'
import User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { AuthContext } from '#types/auth'

const KEY = 'personalCalendar'

function readCalendar(preferences: unknown): PersonalWorkingCalendar {
  if (!preferences || typeof preferences !== 'object') return { ...EMPTY_PERSONAL_CALENDAR }
  return normalizePersonalCalendar((preferences as Record<string, unknown>)[KEY])
}

function parsePreferences(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

@inject()
export default class PersonalCalendarService {
  constructor(private audit: AuditService) {}

  get(user: User): PersonalWorkingCalendar {
    return readCalendar(parsePreferences(user.preferences))
  }

  async update(
    user: User,
    organizationId: number,
    raw: unknown,
    ctx: AuthContext = {},
  ): Promise<PersonalWorkingCalendar> {
    const next = normalizePersonalCalendar(raw)
    const fresh = await User.findOrFail(user.id)
    const preferences = parsePreferences(fresh.preferences)
    const before = readCalendar(preferences)
    fresh.preferences = { ...preferences, [KEY]: next } as typeof fresh.preferences
    await fresh.save()
    user.preferences = fresh.preferences
    await this.audit.log({
      event: AuditEvent.PERSONAL_CALENDAR_UPDATED,
      userId: user.id,
      organizationId,
      entityType: 'user',
      entityId: user.id,
      requestId: ctx.requestId ?? null,
      changes: {
        before: { workdays: before.workdays, leaves: before.leaves },
        after: { workdays: next.workdays, leaves: next.leaves },
      },
      metadata: { leaves: next.leaves.length, workdays: next.workdays },
    })
    return next
  }

  /** 批量读成员的个人工作日历（排期用）；没设的人不在结果里。 */
  static async forUsers(userIds: number[]): Promise<Map<number, PersonalWorkingCalendar>> {
    const result = new Map<number, PersonalWorkingCalendar>()
    if (userIds.length === 0) return result
    const rows = (await db
      .from('users')
      .whereIn('id', userIds)
      .select('id', 'preferences')) as Array<{
      id: number | string
      preferences: unknown
    }>
    for (const row of rows) {
      const calendar = readCalendar(parsePreferences(row.preferences))
      if (calendar.leaves.length > 0 || calendar.workdays) result.set(Number(row.id), calendar)
    }
    return result
  }
}
