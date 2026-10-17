/**
 * TimelineEventAdapter：审计记录 → 低敏 Timeline DTO / ActivityEvent。
 */

import type AuditLog from '#models/audit_log'
import {
  buildAggregatedSummary,
  resolveTimelineMapping,
  TASK_UPDATED_IMPORTANT_FIELDS,
  type TimelineEventMapping,
} from '#services/timeline/timeline_event_mapping'
import type {
  ActivityEvent,
  TimelineActor,
  TimelineAggregatedTarget,
  TimelineEvent,
  TimelineTargetRef,
} from '#types/timeline_event'

export interface AuditLogLike {
  id: number
  organizationId: number | null | bigint
  projectId: number | null | bigint
  userId: number | null | bigint
  entityType: string | null
  entityId: number | null | bigint
  metadata: Record<string, unknown> | null
  createdAt: { toJSDate(): Date } | Date
  /** 可选：部分测试用 plain Date */
}

function toNumber(value: number | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return Number(value)
}

function createdAtDate(log: AuditLogLike): Date {
  const raw = log.createdAt
  if (raw instanceof Date) return raw
  return raw.toJSDate()
}

function extractEventCode(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  return typeof metadata.event === 'string' ? metadata.event : null
}

function extractObjectLabel(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  for (const key of ['name', 'taskName', 'title', 'label', 'fileName']) {
    const v = metadata[key]
    if (typeof v === 'string' && v.trim()) {
      // 截断，避免超长名称
      return v.trim().slice(0, 80)
    }
  }
  return null
}

function extractChangedFields(metadata: Record<string, unknown> | null): string[] {
  if (!metadata) return []
  const changed = metadata.changed
  if (!Array.isArray(changed)) return []
  return changed.filter((f): f is string => typeof f === 'string')
}

function buildTargetHref(
  objectType: string,
  objectId: number | null,
  projectId: number,
): string | null {
  if (objectId === null) return null
  switch (objectType) {
    case 'task':
      return `/projects/${projectId}/list?taskId=${objectId}`
    case 'milestone':
      return `/projects/${projectId}/milestones?milestoneId=${objectId}`
    case 'risk':
      return `/projects/${projectId}/risks?riskId=${objectId}`
    case 'change_request':
      return `/projects/${projectId}/changes?changeRequestId=${objectId}`
    case 'document':
    case 'attachment':
      return `/projects/${projectId}/files`
    case 'diagram':
      return `/projects/${projectId}/diagrams`
    case 'report':
      return `/projects/${projectId}/reports`
    case 'comment':
      return `/projects/${projectId}/list`
    case 'ai_draft':
    case 'draft_layer':
      return `/projects/${projectId}/ai`
    case 'project':
      return `/projects/${projectId}`
    default:
      return `/projects/${projectId}/timeline`
  }
}

export default class TimelineEventAdapter {
  /**
   * 将单条审计记录转为 ActivityEvent；不可映射时返回 null。
   */
  toActivityEvent(log: AuditLogLike | AuditLog): ActivityEvent | null {
    const eventCode = extractEventCode(log.metadata)
    const mapping = resolveTimelineMapping(eventCode)
    if (!mapping) return null
    if (mapping.visibility === 'hidden') return null
    if (mapping.includeWhen && !mapping.includeWhen(log.metadata)) return null

    const organizationId = toNumber(log.organizationId)
    const projectId = toNumber(log.projectId)
    if (organizationId === null || projectId === null) return null

    const objectLabel = extractObjectLabel(log.metadata)
    const changedFields = extractChangedFields(log.metadata)
    const summary = mapping.summaryBuilder({
      objectLabel,
      changedFields,
    })

    // 双重保险：摘要不得等于原始 event code
    const safeSummary =
      eventCode && summary === eventCode ? mapping.summaryBuilder({ objectLabel: null }) : summary

    const objectId = toNumber(log.entityId)
    const actorId = toNumber(log.userId)
    const assigneeId = typeof log.metadata?.assigneeId === 'number' ? log.metadata.assigneeId : null

    return {
      id: `audit:${log.id}`,
      organizationId,
      projectId,
      source: 'audit_log',
      sourceId: log.id,
      eventType: mapping.eventType,
      verb: mapping.verb,
      category: mapping.category,
      importance: mapping.importance,
      visibility: mapping.visibility,
      occurredAt: createdAtDate(log),
      actorId,
      objectType: mapping.objectType,
      objectId,
      summaryTemplate: safeSummary,
      objectLabel,
      metadataSnapshot: {
        assigneeId,
        changedFields:
          mapping.eventType === 'TASK_UPDATED'
            ? changedFields.filter((f) => TASK_UPDATED_IMPORTANT_FIELDS.has(f))
            : changedFields,
        relatedUserIds: [actorId, assigneeId].filter((id): id is number => id !== null),
      },
      isKeyEvent: mapping.isKeyEvent,
    }
  }

  /**
   * ActivityEvent → 对外 TimelineEvent DTO（应用可见性后的最终形态）。
   */
  toTimelineEvent(
    activity: ActivityEvent,
    options: {
      actorDisplayName: string
      targetAccessible: boolean
      redactObjectLabel?: boolean
    },
  ): TimelineEvent {
    const objectLabel = options.redactObjectLabel ? null : activity.objectLabel
    const mapping = resolveTimelineMapping(activity.eventType)
    const summary = options.redactObjectLabel
      ? (mapping?.summaryBuilder({ objectLabel: null }) ?? '项目活动')
      : activity.summaryTemplate

    const actor: TimelineActor = {
      id: activity.actorId,
      displayName: options.actorDisplayName,
    }

    const targetRef: TimelineTargetRef | null =
      activity.objectId !== null
        ? {
            type: activity.objectType,
            id: options.targetAccessible ? activity.objectId : null,
            label: options.targetAccessible ? objectLabel : null,
            href: options.targetAccessible
              ? buildTargetHref(activity.objectType, activity.objectId, activity.projectId)
              : null,
            accessible: options.targetAccessible,
          }
        : null

    return {
      id: activity.id,
      organizationId: activity.organizationId,
      projectId: activity.projectId,
      eventType: activity.eventType,
      verb: activity.verb,
      category: activity.category,
      importance: activity.importance,
      visibility: activity.visibility,
      occurredAt: activity.occurredAt.toISOString(),
      actor,
      objectType: activity.objectType,
      objectId: options.targetAccessible ? activity.objectId : null,
      summary,
      secondaryText: mapping?.secondaryBuilder?.({ objectLabel }) ?? null,
      targetRef,
      evidenceRef: {
        kind: 'audit_log',
        id: activity.sourceId,
      },
      isKeyEvent: activity.isKeyEvent,
      isAggregated: false,
      aggregatedCount: null,
      aggregatedTargets: null,
    }
  }

  /**
   * 将一组低重要性同类事件合并为聚合 TimelineEvent。
   */
  toAggregatedTimelineEvent(
    group: ActivityEvent[],
    options: { actorDisplayName: string },
  ): TimelineEvent {
    const head = group[0]!
    const targets: TimelineAggregatedTarget[] = group.slice(0, 10).map((e) => ({
      type: e.objectType,
      id: e.objectId,
      label: e.objectLabel,
    }))

    return {
      id: `agg:${head.sourceId}:${group.length}`,
      organizationId: head.organizationId,
      projectId: head.projectId,
      eventType: head.eventType,
      verb: head.verb,
      category: head.category,
      importance: head.importance,
      visibility: head.visibility,
      occurredAt: head.occurredAt.toISOString(),
      actor: {
        id: head.actorId,
        displayName: options.actorDisplayName,
      },
      objectType: head.objectType,
      objectId: null,
      summary: buildAggregatedSummary(head.verb, head.objectType, group.length),
      secondaryText: null,
      targetRef: null,
      evidenceRef: {
        kind: 'audit_log',
        id: head.sourceId,
      },
      isKeyEvent: false,
      isAggregated: true,
      aggregatedCount: group.length,
      aggregatedTargets: targets,
    }
  }

  /** 供测试：暴露 mapping 解析。 */
  getMapping(eventCode: string): TimelineEventMapping | null {
    return resolveTimelineMapping(eventCode)
  }
}
