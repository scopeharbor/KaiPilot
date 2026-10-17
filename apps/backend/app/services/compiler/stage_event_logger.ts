/**
 * v2-context-compiler-artifact-store —— StageEventLogger（tasks 6.3）。
 * v2-5-compiler-stage-cache-wiring —— additive cacheSummary（design D4, tasks 4.1-4.2）。
 *
 * 每个 Stage 写 started/succeeded/failed/skipped/needs_human_review 事件。
 * 扩展：记录 artifact refs（contextPacketRef, inputRefs, outputRefs, modelOutputRef, validationFeedbackRefs）
 * 与成本摘要。禁止记录完整 Context Packet。
 * cacheSummary 只含 status/cacheKeyHash/cachePolicyVersion/storeKind/durationMs，
 * 随 artifact refs 一并序列化进 validationSummary JSON 列（additive，不改 DB schema）。
 */
import CompilerStageEvent from '#models/compiler_stage_event'
import { DateTime } from 'luxon'
import type { StageCacheSummary } from './stage_cache_service.js'

export interface StageEventEntry {
  compilerRunId: number
  organizationId: number
  stageId: string
  phase: string
  status: string
  startedAt?: DateTime
  endedAt?: DateTime
  durationMs?: number
  llmCalls: number
  llmCost: number
  error?: Record<string, unknown> | null

  // v2-context-compiler-artifact-store 扩展字段
  entityId?: string | null
  attemptNumber?: number | null
  modelMode?: string | null
  tokenBudget?: number | null
  contextPacketRef?: string | null
  inputArtifactRefs?: string[]
  outputArtifactRefs?: string[]
  modelOutputRef?: string | null
  validationFeedbackRefs?: string[]
  tokenCostSummary?: string | null

  // v2-5-compiler-stage-cache-wiring 扩展字段（低敏缓存摘要，仅 deterministic Stage 启用缓存时出现）
  cacheSummary?: StageCacheSummary
}

/**
 * StageEventLogger —— Compiler Stage 事件写入器。
 *
 * 每次写入记录 artifact refs 但不记录完整 payload（D6 审计要求）。
 */
export class StageEventLogger {
  /**
   * 记录 Stage 开始事件。
   */
  async started(entry: Omit<StageEventEntry, 'status' | 'endedAt' | 'durationMs'>): Promise<void> {
    await CompilerStageEvent.create(this.#buildRecord(entry, 'running'))
  }

  /**
   * 记录 Stage 成功事件。
   */
  async succeeded(entry: Omit<StageEventEntry, 'status'>): Promise<void> {
    await CompilerStageEvent.create(this.#buildRecord(entry, 'completed'))
  }

  /**
   * 记录 Stage 失败事件。
   */
  async failed(entry: Omit<StageEventEntry, 'status'>): Promise<void> {
    await CompilerStageEvent.create(this.#buildRecord(entry, 'failed'))
  }

  /**
   * 记录 Stage 被跳过事件。
   */
  async skipped(
    entry: Omit<StageEventEntry, 'status' | 'durationMs' | 'llmCalls' | 'llmCost'>,
  ): Promise<void> {
    await CompilerStageEvent.create({
      ...this.#buildRecord(entry, 'skipped'),
      durationMs: 0,
      llmCalls: 0,
      llmCost: 0,
    })
  }

  /**
   * 记录 Stage 需要人工审核事件。
   */
  async needsHumanReview(entry: Omit<StageEventEntry, 'status'>): Promise<void> {
    await CompilerStageEvent.create(this.#buildRecord(entry, 'needs_human_review'))
  }

  /**
   * 构建统一记录对象，包含 artifact refs 摘要。
   * 禁止记录完整 Context Packet payload（只记 ref）。
   */
  #buildRecord(entry: Partial<StageEventEntry>, status: string): Partial<CompilerStageEvent> {
    // 构建 artifact refs 摘要（JSON 字符串，含 refs 但不含 payload）
    const artifactRefs: Record<string, unknown> = {}
    if (entry.contextPacketRef) artifactRefs.contextPacketRef = entry.contextPacketRef
    if (entry.inputArtifactRefs?.length) artifactRefs.inputRefs = entry.inputArtifactRefs
    if (entry.outputArtifactRefs?.length) artifactRefs.outputRefs = entry.outputArtifactRefs
    if (entry.modelOutputRef) artifactRefs.modelOutputRef = entry.modelOutputRef
    if (entry.validationFeedbackRefs?.length)
      artifactRefs.validationFeedbackRefs = entry.validationFeedbackRefs
    // v2-5-compiler-stage-cache-wiring（tasks 4.2）：additive 低敏缓存摘要，
    // 只含 status/cacheKeyHash/cachePolicyVersion/storeKind/durationMs。
    if (entry.cacheSummary) artifactRefs.cacheSummary = entry.cacheSummary

    const validationSummary = entry.tokenCostSummary
      ? JSON.stringify({ ...artifactRefs, tokenCostSummary: entry.tokenCostSummary })
      : Object.keys(artifactRefs).length > 0
        ? JSON.stringify(artifactRefs)
        : null

    return {
      compilerRunId: entry.compilerRunId!,
      organizationId: entry.organizationId!,
      stageId: entry.stageId!,
      phase: entry.phase!,
      status,
      entityId: entry.entityId ?? null,
      attemptNumber: entry.attemptNumber ?? null,
      modelMode: entry.modelMode ?? null,
      tokenBudget: entry.tokenBudget ?? null,
      validationSummary,
      startedAt: entry.startedAt ?? DateTime.now(),
      endedAt: entry.endedAt ?? null,
      durationMs: entry.durationMs ?? null,
      llmCalls: entry.llmCalls ?? 0,
      llmCost: entry.llmCost ?? 0,
      error: entry.error ?? null,
    }
  }
}
