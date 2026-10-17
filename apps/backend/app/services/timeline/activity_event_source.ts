/**
 * 活动事件数据源边界（task 2.9）。
 *
 * P0 仅实现 AuditDerivedActivityEventSource；
 * 未来 `activity_events` 表可实现同一接口，Service 层无需改 API DTO。
 */

import type { ActivityEvent, TimelineQueryFilters } from '#types/timeline_event'

export interface ActivityEventSourceQuery {
  organizationId: number
  projectId: number
  filters: TimelineQueryFilters
  /**
   * 多取一些候选，供服务端可见性过滤与聚合后仍能填满 perPage。
   */
  fetchLimit: number
  /**
   * 游标：occurredAt + stable id 降序分页。
   */
  cursorOccurredAt?: Date | null
  cursorId?: number | null
}

export interface ActivityEventSource {
  readonly kind: 'audit_derived' | 'activity_events'
  fetchCandidates(query: ActivityEventSourceQuery): Promise<ActivityEvent[]>
}

/**
 * 预留：未来 activity_events 持久化读模型实现此接口。
 * P0 不创建表、不写入。
 */
export interface ActivityEventPersistencePort {
  /** 是否已启用持久化读模型。 */
  isEnabled(): boolean
}
