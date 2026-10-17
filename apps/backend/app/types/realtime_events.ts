/**
 * 实时事件类型定义（design D5/D6）。
 *
 * 事件封套采用精简 ids + 元信息模式：负载只带 ids 与元信息，
 * 不带完整行数据。客户端收到后应调用 REST API 获取权威数据。
 * 这样既避免泄漏敏感字段，也迫使客户端向 REST 重取权威数据
 *（授权在 REST 再过一遍）。
 */

/**
 * 服务端 → 客户端事件封套。
 * 负载限定为 ids + 元信息，不包含敏感业务数据。
 */
export interface RealtimeEventEnvelope {
  /** 事件类型，如 'task:updated' / 'task:status_changed' */
  type: string
  /** 项目 ID */
  projectId: number
  /** 实体 ID（如任务 ID） */
  entityId: number
  /** 操作者用户 ID */
  actorId: number
  /** 事件发生时间（ISO 8601） */
  occurredAt: string
  /** 额外元信息（不含敏感字段） */
  metadata?: Record<string, unknown>
}

/**
 * 服务端 → 客户端推送的事件名称常量。
 */
export const RealtimeEvents = {
  /** 任务创建 */
  TASK_CREATED: 'task:created',
  /** 任务更新 */
  TASK_UPDATED: 'task:updated',
  /** 任务状态变更 */
  TASK_STATUS_CHANGED: 'task:status_changed',
  /** 任务删除 */
  TASK_DELETED: 'task:deleted',
  /** 任务恢复 */
  TASK_RESTORED: 'task:restored',
  /** 项目记忆 Timeline 新活动提示（仅作 query 失效旁路） */
  TIMELINE_ACTIVITY: 'timeline:activity',
  /** 资源相关视图与查询失效提示（只携带低敏 ids 与刷新范围） */
  RESOURCE_INVALIDATED: 'resource:invalidated',
  /** 风险相关视图与查询失效提示 */
  RISK_INVALIDATED: 'risk:invalidated',
  /** 通知到达提示（向用户 room 推送） */
  NOTIFICATION_ARRIVED: 'notification:arrived',
  /** 通知读取状态变更（向用户 room 推送） */
  NOTIFICATION_READ_STATUS_CHANGED: 'notification:read_status_changed',
  /** 通知批量处理完成（向用户 room 推送） */
  NOTIFICATION_BATCH_PROCESSED: 'notification:batch_processed',
  /** 通知隐藏状态变更（向用户 room 推送） */
  NOTIFICATION_HIDDEN_STATUS_CHANGED: 'notification:hidden_status_changed',
  /** 评论变更提示（向项目 room 推送） */
  COMMENT_INVALIDATED: 'comment:invalidated',
} as const

/**
 * 客户端 → 服务端控制消息名称常量。
 */
export const RealtimeClientMessages = {
  JOIN_PROJECT: 'join:project',
  LEAVE_PROJECT: 'leave:project',
} as const

/**
 * 服务端 → 客户端通用事件名称。
 */
export const SERVER_EVENT_NAME = 'realtime:event'
