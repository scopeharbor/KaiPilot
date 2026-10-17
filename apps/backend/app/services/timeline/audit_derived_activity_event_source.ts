/**
 * 从 audit_logs 派生活动事件（P0 唯一数据源）。
 * 不依赖 activity_events 表。
 */

import AuditLog from '#models/audit_log'
import type {
  ActivityEventSource,
  ActivityEventSourceQuery,
} from '#services/timeline/activity_event_source'
import TimelineEventAdapter from '#services/timeline/timeline_event_adapter'
import type { ActivityEvent } from '#types/timeline_event'
import { DateTime } from 'luxon'

export default class AuditDerivedActivityEventSource implements ActivityEventSource {
  readonly kind = 'audit_derived' as const

  constructor(private adapter = new TimelineEventAdapter()) {}

  async fetchCandidates(query: ActivityEventSourceQuery): Promise<ActivityEvent[]> {
    const q = AuditLog.query()
      .where('organization_id', query.organizationId)
      .where('project_id', query.projectId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(query.fetchLimit)

    if (query.filters.from) {
      q.where('created_at', '>=', DateTime.fromJSDate(query.filters.from).toSQL()!)
    }
    if (query.filters.to) {
      q.where('created_at', '<=', DateTime.fromJSDate(query.filters.to).toSQL()!)
    }
    if (query.filters.actorId) {
      q.where('user_id', query.filters.actorId)
    }

    // 游标：occurredAt + id 降序，取更早的一批
    if (query.cursorOccurredAt && query.cursorId !== null && query.cursorId !== undefined) {
      const cursorIso = DateTime.fromJSDate(query.cursorOccurredAt).toSQL()!
      q.where((builder) => {
        builder.where('created_at', '<', cursorIso).orWhere((inner) => {
          inner.where('created_at', cursorIso).where('id', '<', query.cursorId!)
        })
      })
    }

    const logs = await q
    const events: ActivityEvent[] = []
    for (const log of logs) {
      const activity = this.adapter.toActivityEvent(log)
      if (activity) events.push(activity)
    }
    return events
  }
}
