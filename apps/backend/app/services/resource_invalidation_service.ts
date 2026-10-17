import RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'
import { RealtimeEvents, type RealtimeEventEnvelope } from '#types/realtime_events'

export type ResourceInvalidationReason =
  | 'resource_changed'
  | 'resource_allocation_changed'
  | 'resource_requirement_changed'
  | 'resource_availability_changed'
  | 'working_calendar_changed'
  | 'resource_suggestion_applied'

export interface ResourceInvalidationInput {
  organizationId: number
  projectId: number
  actorUserId: number
  reason: ResourceInvalidationReason
  entityType: string
  entityId: number
  affectedQueries?: string[]
}

const DEFAULT_AFFECTED_QUERIES = [
  'resources',
  'resource-load',
  'resource-planning',
  'resource-conflicts',
  'resource-matches',
  'task-resource-requirements',
  'project-dashboard',
]

export default class ResourceInvalidationService {
  broadcast(input: ResourceInvalidationInput): RealtimeEventEnvelope {
    const event = this.buildEvent(input)
    new RealtimeBroadcaster().broadcastToProject(input.organizationId, input.projectId, event)
    return event
  }

  buildEvent(input: ResourceInvalidationInput): RealtimeEventEnvelope {
    return {
      type: RealtimeEvents.RESOURCE_INVALIDATED,
      projectId: input.projectId,
      entityId: input.entityId,
      actorId: input.actorUserId,
      occurredAt: new Date().toISOString(),
      metadata: {
        reason: input.reason,
        entityType: input.entityType,
        affectedQueries: input.affectedQueries ?? DEFAULT_AFFECTED_QUERIES,
      },
    }
  }
}
