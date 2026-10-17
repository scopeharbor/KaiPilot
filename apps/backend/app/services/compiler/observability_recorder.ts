/**
 * @aiproj/backend —— CompilerObservabilityRecorder（tasks 2.1, 2.6）。
 *
 * 统一可观测事件写入器。基于既有 StageEventLogger 扩展，记录 Stage、Context、
 * Artifact、Validation、Repair、Draft handoff 等结构化观测事件。
 *
 * 事件写入：
 * - Stage 事件 → compiler_stage_events（复用既有模型）
 * - Cost/Budget/Policy 事件 → compiler_artifacts（kind=cost_event/budget_decision/budget_policy）
 * - 其他观测事件 → compiler_artifacts（kind=observability_event）
 *
 * 禁止记录完整 prompt、完整用户输入、完整模型输出、API Key。
 *
 * @aiproj/backend
 */

import CompilerStageEvent from '#models/compiler_stage_event'
import type { ArtifactKind } from '#models/compiler_artifact'
import { ArtifactStore, computeContentHash } from './artifact_store.js'
import { StageEventLogger, type StageEventEntry } from './stage_event_logger.js'
import {
  type ObservabilityEvent,
  type ModelCostEvent,
  type BudgetDecision,
} from '@aiproj/compiler-spec'

export interface ObservabilityRecordingOptions {
  /** 写入 stage_event 表的入口。 */
  stageEventLogger?: StageEventLogger
  /** Artifact 存储。 */
  artifactStore?: ArtifactStore
}

export type RecorderEventType =
  | 'stage_started'
  | 'stage_completed'
  | 'stage_failed'
  | 'stage_skipped'
  | 'stage_needs_review'
  | 'phase_started'
  | 'phase_completed'
  | 'context_packet_generated'
  | 'artifact_stored'
  | 'validation_triggered'
  | 'validation_completed'
  | 'repair_attempted'
  | 'repair_completed'
  | 'repair_failed'
  | 'draft_handoff'
  | 'budget_decision'
  | 'resume_event'
  | 'replay_event'

/**
 * CompilerObservabilityRecorder —— 统一可观测事件记录器。
 *
 * 职责：
 * 1. 将 Stage 生命周期事件写入 compiler_stage_events
 * 2. 将细粒度观测事件写入 compiler_artifacts（kind=observability_event）
 * 3. 为 CostRecorder 和 BudgetGuard 提供写入入口
 * 4. 确保敏感数据不写入事件
 */
export class CompilerObservabilityRecorder {
  readonly #stageEventLogger: StageEventLogger
  readonly #artifactStore: ArtifactStore

  constructor(options?: ObservabilityRecordingOptions) {
    this.#stageEventLogger = options?.stageEventLogger ?? new StageEventLogger()
    this.#artifactStore = options?.artifactStore ?? new ArtifactStore()
  }

  get stageEventLogger(): StageEventLogger {
    return this.#stageEventLogger
  }

  // ── Stage Events ──

  /** 记录 Stage 开始事件。 */
  async recordStageStarted(
    entry: Omit<StageEventEntry, 'status' | 'endedAt' | 'durationMs'>,
  ): Promise<void> {
    await this.#stageEventLogger.started(entry)
  }

  /** 记录 Stage 成功事件。 */
  async recordStageSucceeded(entry: Omit<StageEventEntry, 'status'>): Promise<void> {
    await this.#stageEventLogger.succeeded(entry)
  }

  /** 记录 Stage 失败事件。 */
  async recordStageFailed(entry: Omit<StageEventEntry, 'status'>): Promise<void> {
    await this.#stageEventLogger.failed(entry)
  }

  /** 记录 Stage 跳过事件。 */
  async recordStageSkipped(
    entry: Omit<StageEventEntry, 'status' | 'durationMs' | 'llmCalls' | 'llmCost'>,
  ): Promise<void> {
    await this.#stageEventLogger.skipped(entry)
  }

  /** 记录 Stage 需要人工复核。 */
  async recordStageNeedsReview(entry: Omit<StageEventEntry, 'status'>): Promise<void> {
    await this.#stageEventLogger.needsHumanReview(entry)
  }

  // ── Observability Artifact Events ──

  /**
   * 记录一次观测事件到 artifact。
   * 不记录完整 prompt/output/API Key（由调用方保证）。
   */
  async recordEvent(event: ObservabilityEvent): Promise<string> {
    const artifactId = `obs_${event.eventId}`
    const payload = this.#sanitizeObservabilityPayload(event)

    await this.#artifactStore.save({
      compilerRunId: event.compilerRunId,
      organizationId: event.organizationId,
      kind: 'observability_event' as ArtifactKind,
      stageId: event.stageId ?? null,
      artifactId,
      version: 1,
      contentHash: computeContentHash(payload),
      idempotencyKey: event.idempotencyKey ?? null,
      payload,
    })

    return artifactId
  }

  /**
   * 记录模型成本事件到 artifact。
   * 利用 ArtifactStore.save 内置的 idempotencyKey 去重。
   */
  async recordCostEvent(costEvent: ModelCostEvent): Promise<string> {
    const artifactId = costEvent.idempotencyKey
      ? `cost_${costEvent.idempotencyKey}`
      : `cost_${costEvent.stageId}_a${costEvent.attemptNumber}_${Date.now()}`
    const payload = this.#sanitizeCostPayload(costEvent)

    const artifact = await this.#artifactStore.save({
      compilerRunId: costEvent.compilerRunId,
      organizationId: costEvent.organizationId,
      kind: 'cost_event' as ArtifactKind,
      stageId: costEvent.stageId,
      artifactId,
      version: 1,
      contentHash: computeContentHash(payload),
      idempotencyKey: costEvent.idempotencyKey ?? null,
      payload,
    })

    return `artifact:cost_event:${artifact.artifactId ?? artifactId}:v${artifact.version}`
  }

  /**
   * 记录预算决策事件到 artifact。
   * 利用 ArtifactStore.save 内置的 idempotencyKey 去重。
   */
  async recordBudgetDecision(decision: BudgetDecision): Promise<string> {
    const artifactId = decision.idempotencyKey
      ? `bd_${decision.idempotencyKey}`
      : `bd_${decision.stageId ?? 'run'}_${Date.now()}`
    const payload = { ...decision } as Record<string, unknown>

    const artifact = await this.#artifactStore.save({
      compilerRunId: decision.compilerRunId,
      organizationId: decision.organizationId,
      kind: 'budget_decision' as ArtifactKind,
      stageId: decision.stageId ?? null,
      artifactId,
      version: 1,
      contentHash: computeContentHash(payload),
      idempotencyKey: decision.idempotencyKey ?? null,
      payload,
    })

    return `artifact:budget_decision:${artifact.artifactId ?? artifactId}:v${artifact.version}`
  }

  // ── Sanitization Helpers ──

  /**
   * 确保观测事件不含敏感正文。
   */
  #sanitizeObservabilityPayload(event: ObservabilityEvent): Record<string, unknown> {
    const safe = { ...event } as Record<string, unknown>
    // metadata 中可能含有敏感数据，只保留非正文字段
    if (safe.metadata && typeof safe.metadata === 'object') {
      const meta = safe.metadata as Record<string, unknown>
      const allowedKeys = ['ref', 'hash', 'tokenCount', 'errorCode']
      const filtered: Record<string, unknown> = {}
      for (const key of allowedKeys) {
        if (key in meta) filtered[key] = meta[key]
      }
      safe.metadata = filtered
    }
    return safe
  }

  /**
   * 确保成本事件不含敏感正文。
   */
  #sanitizeCostPayload(costEvent: ModelCostEvent): Record<string, unknown> {
    // ModelCostEvent schema 已禁止 prompt/output/API Key 字段
    // 仅做类型转换
    return { ...costEvent } as Record<string, unknown>
  }

  // ── Query Helpers ──

  /**
   * 查询某 run 的所有成本事件（组织隔离）。
   */
  async getCostEvents(compilerRunId: number, organizationId: number): Promise<ModelCostEvent[]> {
    const payloads = await this.#artifactStore.queryByRunId(
      compilerRunId,
      organizationId,
      'cost_event',
    )
    return payloads as unknown as ModelCostEvent[]
  }

  /**
   * 查询某 run 的所有预算决策（组织隔离）。
   */
  async getBudgetDecisions(
    compilerRunId: number,
    organizationId: number,
  ): Promise<BudgetDecision[]> {
    const payloads = await this.#artifactStore.queryByRunId(
      compilerRunId,
      organizationId,
      'budget_decision',
    )
    return payloads as unknown as BudgetDecision[]
  }

  /**
   * 查询某 run 的 Stage 事件。
   */
  async getStageEvents(
    compilerRunId: number,
    organizationId: number,
  ): Promise<CompilerStageEvent[]> {
    return CompilerStageEvent.query()
      .where('compiler_run_id', compilerRunId)
      .where('organization_id', organizationId)
      .orderBy('id', 'asc')
  }

  // ── TRIZ Analysis Observability ──

  /**
   * 记录确定性 TRIZ 分析 stage 事件（零模型调用/成本）。
   *
   * 用于跟踪分析阶段生命周期。不触发任何模型调用，不产生成本。
   * 只记录 ref/hash/summary 等低敏元数据，写入 entityId 和 tokenCostSummary 字段。
   */
  async recordTrizStageEvent(event: {
    compilerRunId: number
    organizationId: number
    projectId: number
    runId: string
    stageId: string
    phase: string
    status: 'started' | 'completed' | 'failed' | 'skipped' | 'needs_review'
    warningCount: number
    sourceContradictionCount: number
    resolutionPathCount: number
    contentHash?: string
  }): Promise<void> {
    const baseEntry = {
      compilerRunId: event.compilerRunId,
      organizationId: event.organizationId,
      stageId: event.stageId,
      phase: event.phase,
      llmCalls: 0,
      llmCost: 0,
      entityId: `triz_analysis:${event.runId}`,
      tokenBudget: null,
      modelMode: 'deterministic',
      tokenCostSummary: JSON.stringify({
        ref: `triz_analysis:${event.runId}`,
        hash: event.contentHash ?? null,
        warningCount: event.warningCount,
        sourceContradictionCount: event.sourceContradictionCount,
        resolutionPathCount: event.resolutionPathCount,
      }),
    }

    if (event.status === 'started') {
      await this.recordStageStarted(baseEntry)
    } else if (event.status === 'completed') {
      await this.recordStageSucceeded(baseEntry)
    } else if (event.status === 'failed') {
      await this.recordStageFailed(baseEntry)
    } else if (event.status === 'skipped') {
      await this.#recordTrizStageSkipped(baseEntry)
    } else if (event.status === 'needs_review') {
      await this.recordStageNeedsReview(baseEntry)
    }
  }

  /**
   * TRIZ stage skipped 需要额外的 omit（llmCalls, llmCost 不在 Omit 中）。
   */
  async #recordTrizStageSkipped(
    entry: Omit<StageEventEntry, 'status' | 'durationMs' | 'llmCalls' | 'llmCost'>,
  ): Promise<void> {
    await this.recordStageSkipped(entry)
  }

  /**
   * 记录 TRIZ 分析观测事件到 artifact（零成本、零模型调用）。
   */
  async recordTrizObservabilityEvent(event: {
    compilerRunId: number
    organizationId: number
    stageId: string
    eventId: string
    status: string
    warningCount: number
    sourceHash?: string
  }): Promise<string> {
    const artifactId = `triz_obs_${event.eventId}`

    await this.#artifactStore.save({
      compilerRunId: event.compilerRunId,
      organizationId: event.organizationId,
      kind: 'observability_event' as ArtifactKind,
      stageId: event.stageId,
      artifactId,
      version: 1,
      contentHash: computeContentHash({ status: event.status, warningCount: event.warningCount }),
      idempotencyKey: null,
      payload: {
        eventId: event.eventId,
        kind: 'triz_analysis_observability',
        status: event.status,
        warningCount: event.warningCount,
        sourceHash: event.sourceHash ?? null,
        llmCalls: 0,
        llmCost: 0,
        deterministic: true,
      },
    })

    return artifactId
  }
}
