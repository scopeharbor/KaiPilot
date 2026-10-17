/**
 * Compiler Realtime Publisher —— Stage Event 保存后通过 realtime 广播低敏 envelope。
 *
 * 职责：
 * - 只从事务提交后的 callback 中调用，不在 Model hook 中发布。
 * - 使用持久化 event UID 构造 envelope。
 * - 记录 publish success/failure 指标（低敏计数）。
 * - 广播失败不回滚数据库，重试保持 eventId/sequence。
 *
 * @file compiler_realtime_publisher.ts
 */

import type { StageEventEntry } from './stage_event_logger.js'
import { mapStageEventToEnvelope } from './compiler_realtime_mapper.js'
import type RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'

type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'needs_human_review'

export class CompilerRealtimePublisher {
  #broadcaster: RealtimeBroadcaster

  constructor(broadcaster: RealtimeBroadcaster) {
    this.#broadcaster = broadcaster
  }

  /**
   * 在 Stage Event 持久化后发布低敏 envelope。
   * 广播失败不会抛出异常，只记低敏日志。
   */
  publishStageEvent(
    entry: Partial<StageEventEntry>,
    status: StageStatus,
    organizationId: number,
    projectId: number,
  ): void {
    try {
      const envelope = mapStageEventToEnvelope(entry, status)

      this.#broadcaster.broadcastToProject(organizationId, projectId, {
        type: 'compiler:progress',
        projectId,
        envelope,
        timestamp: new Date().toISOString(),
      } as any)
    } catch (error) {
      // 广播失败只记低敏日志，不向调用方抛错
      console.error('CompilerRealtimePublisher: 广播失败', (error as Error).message)
    }
  }

  /**
   * 批量发布多条 Stage Event（用于 replay）。
   */
  publishBatch(
    entries: Array<{ entry: Partial<StageEventEntry>; status: StageStatus }>,
    organizationId: number,
    projectId: number,
  ): void {
    for (const { entry, status } of entries) {
      this.publishStageEvent(entry, status, organizationId, projectId)
    }
  }
}
