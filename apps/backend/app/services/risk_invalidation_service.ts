/**
 * RiskInvalidationService — 风险写入后的缓存失效/活动事件广播（design D6 派生）。
 *
 * 职责：
 * - 风险创建/更新/删除/状态变更后，向项目房间广播失效事件
 * - 广播为尽力而为旁路，失败不影响业务写入
 * - 客户端收到后应调用 REST API 获取权威数据（授权在 REST 再过一遍）
 */

import RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'
import { RealtimeEvents, type RealtimeEventEnvelope } from '#types/realtime_events'

export type RiskInvalidationReason =
  | 'risk_created'
  | 'risk_updated'
  | 'risk_deleted'
  | 'risk_status_changed'
  | 'risk_review_completed'
  | 'risk_response_plan_changed'
  | 'risk_matrix_config_changed'

export interface RiskInvalidationInput {
  organizationId: number
  projectId: number
  actorUserId: number
  reason: RiskInvalidationReason
  entityType: string
  entityId: number
  affectedQueries?: string[]
}

const DEFAULT_AFFECTED_QUERIES = [
  'risks',
  'risk-summary',
  'risk-matrix',
  'risk-trend',
  'risk-review-queue',
  'risk-response-plans',
  'risk-candidates',
  'project-dashboard',
  'project-reports',
]

export default class RiskInvalidationService {
  broadcast(input: RiskInvalidationInput): RealtimeEventEnvelope {
    const event = this.buildEvent(input)
    new RealtimeBroadcaster().broadcastToProject(input.organizationId, input.projectId, event)
    return event
  }

  buildEvent(input: RiskInvalidationInput): RealtimeEventEnvelope {
    return {
      type: RealtimeEvents.RISK_INVALIDATED,
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
