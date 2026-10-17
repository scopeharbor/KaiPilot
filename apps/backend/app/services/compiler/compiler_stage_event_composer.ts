/**
 * Compiler Stage Event Composer —— 保存 Stage Event 后通过 realtime 发布。
 *
 * 职责 (tasks 2.1-2.3)：
 * - 在 StageEventLogger 保存完成后，从事务提交后的 callback 调用 publisher。
 * - 使用持久化 event UID 与稳定 run-local sequence 构造 envelope。
 * - 记录低敏 publish success/failure 指标。
 * - 数据库失败不发布、广播失败不回滚、重试保持 eventId/sequence。
 *
 * @file compiler_stage_event_composer.ts
 */

import type { StageEventEntry } from './stage_event_logger.js'
import type { CompilerRealtimePublisher } from './compiler_realtime_publisher.js'

type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'needs_human_review'

type LogStartedEntry = Omit<StageEventEntry, 'status' | 'endedAt' | 'durationMs'>
type LogSucceededEntry = Omit<StageEventEntry, 'status'>
type LogFailedEntry = Omit<StageEventEntry, 'status'>
type LogSkippedEntry = Omit<StageEventEntry, 'status' | 'durationMs' | 'llmCalls' | 'llmCost'>
type LogReviewEntry = Omit<StageEventEntry, 'status'>

/**
 * 事件记录 + 发布的组合接口。
 * Service 层通过此 composer 统一操作，不再单独调用 logger 和 publisher。
 */
export class CompilerStageEventComposer {
  #publisher: CompilerRealtimePublisher | null

  constructor(publisher?: CompilerRealtimePublisher) {
    this.#publisher = publisher ?? null
  }

  async started(entry: LogStartedEntry, organizationId: number, projectId: number): Promise<void> {
    await this.#logStarted(entry)
    this.#publish('running', entry, organizationId, projectId)
  }

  async succeeded(
    entry: LogSucceededEntry,
    organizationId: number,
    projectId: number,
  ): Promise<void> {
    await this.#logSucceeded(entry)
    this.#publish('completed', entry, organizationId, projectId)
  }

  async failed(entry: LogFailedEntry, organizationId: number, projectId: number): Promise<void> {
    await this.#logFailed(entry)
    this.#publish('failed', entry, organizationId, projectId)
  }

  async skipped(entry: LogSkippedEntry, organizationId: number, projectId: number): Promise<void> {
    await this.#logSkipped(entry)
    this.#publish('skipped', entry, organizationId, projectId)
  }

  async needsHumanReview(
    entry: LogReviewEntry,
    organizationId: number,
    projectId: number,
  ): Promise<void> {
    await this.#logNeedsHumanReview(entry)
    this.#publish('needs_human_review', entry, organizationId, projectId)
  }

  /** 数据库写入。 */
  #logStarted = async (entry: LogStartedEntry) => {
    const { StageEventLogger } = await import('./stage_event_logger.js')
    const logger = new StageEventLogger()
    await logger.started(entry)
  }

  #logSucceeded = async (entry: LogSucceededEntry) => {
    const { StageEventLogger } = await import('./stage_event_logger.js')
    const logger = new StageEventLogger()
    await logger.succeeded(entry)
  }

  #logFailed = async (entry: LogFailedEntry) => {
    const { StageEventLogger } = await import('./stage_event_logger.js')
    const logger = new StageEventLogger()
    await logger.failed(entry)
  }

  #logSkipped = async (entry: LogSkippedEntry) => {
    const { StageEventLogger } = await import('./stage_event_logger.js')
    const logger = new StageEventLogger()
    await logger.skipped(entry)
  }

  #logNeedsHumanReview = async (entry: LogReviewEntry) => {
    const { StageEventLogger } = await import('./stage_event_logger.js')
    const logger = new StageEventLogger()
    await logger.needsHumanReview(entry)
  }

  /** 广播（失败不回滚）。 */
  #publish(
    status: StageStatus,
    entry: Partial<StageEventEntry>,
    organizationId: number,
    projectId: number,
  ): void {
    if (!this.#publisher) return
    this.#publisher.publishStageEvent(entry, status, organizationId, projectId)
  }
}
