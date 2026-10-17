/**
 * RealtimeBroadcaster — 服务端 → 客户端广播服务（design D5）。
 *
 * 职责：
 * - 向指定 project room 或 user room 推送精简事件封套
 * - 整体 try/catch 包裹，失败只记低敏日志、绝不抛给调用方
 * - 广播是尽力而为的旁路，不影响业务写操作
 * - 关闭 REALTIME_ENABLED 时自动降级为 no-op
 *
 * 使用方式（在 Service 事务提交成功后调用）：
 * ```ts
 * const realtime = new RealtimeBroadcaster()
 * realtime.broadcastToProject(orgId, projectId, {
 *   type: 'task:updated',
 *   projectId,
 *   entityId: task.id,
 *   actorId,
 *   occurredAt: new Date().toISOString(),
 * })
 * ```
 */

import logger from '@adonisjs/core/services/logger'
import { getSocketIo } from '#providers/socketio_provider'
import env from '#start/env'
import { SERVER_EVENT_NAME, type RealtimeEventEnvelope } from '#types/realtime_events'

export default class RealtimeBroadcaster {
  /**
   * 获取 io 单例。若 Socket.IO 未挂载（REALTIME_ENABLED=false 或未就绪），返回 null。
   */
  private get io() {
    return env.get('REALTIME_ENABLED', true) ? getSocketIo() : null
  }

  /**
   * 向项目频道广播事件。
   * 失败只记低敏日志，绝不向调用方抛错。
   *
   * @param organizationId 组织 ID
   * @param projectId 项目 ID
   * @param event 事件封套（精简 ids + 元信息，不含敏感字段）
   */
  broadcastToProject(
    organizationId: number,
    projectId: number,
    event: RealtimeEventEnvelope,
  ): void {
    this.safeBroadcast(`project:${organizationId}:${projectId}`, event)
  }

  /**
   * 向用户个人频道广播事件。
   * 失败只记低敏日志，绝不向调用方抛错。
   *
   * @param userId 用户 ID
   * @param event 事件封套（精简 ids + 元信息，不含敏感字段）
   */
  broadcastToUser(userId: number, event: RealtimeEventEnvelope): void {
    this.safeBroadcast(`user:${userId}`, event)
  }

  /**
   * 安全的广播封装：整体 try/catch，只记低敏日志。
   */
  private safeBroadcast(roomName: string, event: RealtimeEventEnvelope): void {
    try {
      const io = this.io
      if (!io) {
        // 实时通道未启用或未就绪，无需记录——这是设计预期
        return
      }

      io.to(roomName).emit(SERVER_EVENT_NAME, event)

      // 低敏日志：不打印 token、完整凭据或原始敏感异常正文
      logger.debug(
        {
          room: roomName,
          eventType: event.type,
          entityId: event.entityId,
          projectId: event.projectId,
        },
        '实时广播已投递',
      )
    } catch (error) {
      // 广播失败绝对不向调用方抛错（设计 D5：REST 仍是唯一事实来源）
      const message = error instanceof Error ? error.message : 'unknown'
      logger.warn(
        { room: roomName, eventType: event.type, error: message },
        '实时广播失败（旁路，不影响业务写入）',
      )
    }
  }
}
