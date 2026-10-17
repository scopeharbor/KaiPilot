/**
 * v2-5-ai-draft-live-sse-transport / D2 —— DraftGenerationRunner。
 *
 * 进程内注册表，键为 draftUid。参照 AiM0StreamSessionService 的分离式模式。
 * start() 分离运行生成，每个事件先 appendEvent() 落库再通知 waiters。
 * 持久化是事实来源，注册表只做实时通知。
 *
 * 心跳定时器：静默期发心跳，生成结束即清理。
 * 客户端断开只移除 waiter、停止写 socket，不中止生成。
 */

import type { ProjectDraftStreamEvent } from '@aiproj/types'
import type AiProjectDraft from '#models/ai_project_draft'
import { resolveDraftGenerationBudget } from './generation_budget.ts'

/** 心跳间隔（静默期无事件时发送）。 */
const HEARTBEAT_INTERVAL_MS = 5_000

/** Runner TTL：生成最长运行时间（下限；放宽生成预算时自动延长，见 defaultRunnerTtlMs）。 */
const RUNNER_TTL_MS = 15 * 60 * 1_000

/** 放宽预算后留给最终事件落库与重连读尾的余量。 */
const RUNNER_TTL_SLACK_MS = 2 * 60 * 1_000

/** TTL 必须覆盖生成全程预算，否则 AI_DRAFT_TIME_BUDGET_SCALE 放宽后 runner 会在生成中途被清理。 */
function defaultRunnerTtlMs(): number {
  return Math.max(
    RUNNER_TTL_MS,
    resolveDraftGenerationBudget().maxGenerationWallMs + RUNNER_TTL_SLACK_MS,
  )
}

/** 最大并发 runner 数。 */
const MAX_RUNNERS = 20

/** 完成后的短暂保留期，供原连接与同时发生的重连读完尾部事件。 */
const COMPLETED_RETENTION_MS = 60_000

export interface DraftGenerationRunnerOptions {
  heartbeatIntervalMs?: number
  runnerTtlMs?: number
  completedRetentionMs?: number
  maxRunners?: number
}

export interface RunnerSession {
  draftUid: string
  session: AiProjectDraft
  version: number
  events: ProjectDraftStreamEvent[]
  complete: boolean
  failed: boolean
  expiresAt: number
  waiters: Set<() => void>
  heartbeatTimer: ReturnType<typeof setInterval> | null
  cleanupTimer: ReturnType<typeof setTimeout> | null
  lastActivityAt: number
  lastSequence: number
  /** 独立的心跳 sequence 计数器，与语义事件 sequence 分离。 */
  heartbeatSequence: number
}

export class DraftGenerationRunner {
  private runners = new Map<string, RunnerSession>()
  private readonly heartbeatIntervalMs: number
  private readonly runnerTtlOverrideMs: number | null
  private readonly completedRetentionMs: number
  private readonly runnerLimit: number

  constructor(options: DraftGenerationRunnerOptions = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
    this.runnerTtlOverrideMs = options.runnerTtlMs ?? null
    this.completedRetentionMs = options.completedRetentionMs ?? COMPLETED_RETENTION_MS
    this.runnerLimit = options.maxRunners ?? MAX_RUNNERS
  }

  /** 当前活跃 runner 数。 */
  get activeCount(): number {
    this.cleanup()
    return [...this.runners.values()].filter((runner) => !runner.complete).length
  }

  /** 测试与进程收口使用：清空所有 runner 并释放 timer/waiter。 */
  reset(): void {
    for (const draftUid of [...this.runners.keys()]) {
      this.cleanupRunner(draftUid)
    }
  }

  /** 最大并发上限。 */
  get maxRunners(): number {
    return this.runnerLimit
  }

  /** 注册新 runner。返回该 runner 是否成功注册（并发上限检查）。 */
  register(
    draftUid: string,
    session: AiProjectDraft,
    version: number,
    initialSequence = 0,
  ): boolean {
    this.cleanup()
    const existing = this.runners.get(draftUid)
    if (existing && !existing.complete) return false
    if (existing) this.cleanupRunner(draftUid)
    if (this.activeCount >= this.runnerLimit) return false

    const now = Date.now()
    const runnerTtlMs = this.runnerTtlOverrideMs ?? defaultRunnerTtlMs()
    const runner: RunnerSession = {
      draftUid,
      session,
      version,
      events: [],
      complete: false,
      failed: false,
      expiresAt: now + runnerTtlMs,
      waiters: new Set(),
      heartbeatTimer: null,
      cleanupTimer: null,
      lastActivityAt: now,
      lastSequence: initialSequence,
      heartbeatSequence: 0,
    }

    // §5.3: 心跳使用独立 sequence，持久化到有限回放窗口，不推进语义 sequence。
    runner.heartbeatTimer = setInterval(() => {
      const current = Date.now()
      if (current - runner.lastActivityAt < this.heartbeatIntervalMs) return
      runner.heartbeatSequence++
      const heartbeatEvent: ProjectDraftStreamEvent = {
        type: 'draft.heartbeat',
        draftId: draftUid,
        version,
        sequence: runner.heartbeatSequence,
        elapsedMs: current - now,
      }
      runner.events.push(heartbeatEvent)
      runner.lastActivityAt = current
      this.notifyWaiters(runner)
    }, this.heartbeatIntervalMs)
    runner.heartbeatTimer.unref?.()

    // TTL 到期自动清理（防止泄漏）
    runner.cleanupTimer = setTimeout(() => {
      this.cleanupRunner(draftUid)
    }, runnerTtlMs)
    runner.cleanupTimer.unref?.()

    this.runners.set(draftUid, runner)
    return true
  }

  /** 推送一条事件到 runner 的事件队列并通知 waiters。 */
  pushEvent(draftUid: string, event: ProjectDraftStreamEvent): void {
    const runner = this.runners.get(draftUid)
    if (!runner || runner.complete) return

    runner.events.push(event)
    runner.lastSequence = Math.max(runner.lastSequence, event.sequence)
    runner.lastActivityAt = Date.now()
    this.notifyWaiters(runner)
  }

  /** 标记生成完成并清理心跳。 */
  complete(draftUid: string): void {
    const runner = this.runners.get(draftUid)
    if (!runner) return
    runner.complete = true
    runner.expiresAt = Date.now() + this.completedRetentionMs
    this.stopHeartbeat(runner)
    this.scheduleCleanup(runner, this.completedRetentionMs)
    this.notifyWaiters(runner)
  }

  /** 标记生成失败并清理心跳。 */
  fail(draftUid: string): void {
    const runner = this.runners.get(draftUid)
    if (!runner) return
    runner.complete = true
    runner.failed = true
    runner.expiresAt = Date.now() + this.completedRetentionMs
    this.stopHeartbeat(runner)
    this.scheduleCleanup(runner, this.completedRetentionMs)
    this.notifyWaiters(runner)
  }

  /** 读取某个 draftUid 的 sequence > cursor 的事件。 */
  readEvents(draftUid: string, afterSeq: number): ProjectDraftStreamEvent[] {
    const runner = this.runners.get(draftUid)
    if (!runner) return []
    return runner.events.filter((event) => event.sequence > afterSeq)
  }

  /**
   * 按进程内队列 offset 读取实时事件。与持久化 sequence 分离，确保 heartbeat
   * 不推进 Last-Event-ID，且不会因 sequence 与最近语义事件相同而被过滤。
   */
  readBatch(
    draftUid: string,
    offset: number,
  ): { events: ProjectDraftStreamEvent[]; nextOffset: number } {
    const runner = this.runners.get(draftUid)
    if (!runner) return { events: [], nextOffset: offset }
    const safeOffset = Math.max(0, Math.min(offset, runner.events.length))
    return {
      events: runner.events.slice(safeOffset),
      nextOffset: runner.events.length,
    }
  }

  /** runner 是否仍在运行。 */
  isRunning(draftUid: string): boolean {
    const runner = this.runners.get(draftUid)
    return runner !== undefined && !runner.complete
  }

  /** 判断 draftUid 是否有活跃 runner。 */
  hasRunner(draftUid: string): boolean {
    return this.runners.has(draftUid)
  }

  /** 等待 runner 有新事件或结束（最多 timeoutMs）。 */
  async waitForChange(draftUid: string, timeoutMs = 15_000): Promise<void> {
    const runner = this.runners.get(draftUid)
    if (!runner || runner.complete) return
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        runner.waiters.delete(finish)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      runner.waiters.add(finish)
    })
  }

  /** 清理过期 runner（TTL 已到或早已完成）。 */
  cleanup(): void {
    const expired: string[] = []
    for (const [draftUid, runner] of this.runners) {
      if (Date.now() > runner.expiresAt) {
        expired.push(draftUid)
      }
    }
    for (const id of expired) {
      this.cleanupRunner(id)
    }
  }

  /** 完全清理一个 runner（移除定时器与 waiter）。 */
  cleanupRunner(draftUid: string): void {
    const runner = this.runners.get(draftUid)
    if (!runner) return

    this.stopHeartbeat(runner)
    if (runner.cleanupTimer) {
      clearTimeout(runner.cleanupTimer)
    }

    // 通知残余 waiter 结束等待
    for (const waiter of runner.waiters) {
      waiter()
    }
    runner.waiters.clear()

    this.runners.delete(draftUid)
  }

  private stopHeartbeat(runner: RunnerSession): void {
    if (runner.heartbeatTimer) {
      clearInterval(runner.heartbeatTimer)
      runner.heartbeatTimer = null
    }
  }

  private scheduleCleanup(runner: RunnerSession, delayMs: number): void {
    if (runner.cleanupTimer) clearTimeout(runner.cleanupTimer)
    runner.cleanupTimer = setTimeout(() => this.cleanupRunner(runner.draftUid), delayMs)
    runner.cleanupTimer.unref?.()
  }

  private notifyWaiters(runner: RunnerSession): void {
    for (const waiter of runner.waiters) {
      waiter()
    }
    runner.waiters.clear()
  }
}

/**
 * Controller 可能按请求实例化；共享 runner 必须是进程级单例，才能让独立的
 * `GET /:id/events` 请求 tail 到正在运行的生成任务。
 */
export const draftGenerationRunner = new DraftGenerationRunner()
