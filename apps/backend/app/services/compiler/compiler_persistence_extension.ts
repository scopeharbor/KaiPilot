/**
 * CompilerPersistenceExtension —— Contract/Manifest/Ledger/PDM 版本化快照与扩展 Stage 事件。
 *
 * - 6.1: 保存 Contract、Manifest、Ledger 与 PDM 的版本化 JSON 快照
 * - 6.2: 扩展 stage event，包含 entity_id、attempt_number、model_mode、token_budget、validation_summary
 * - 6.3: 所有查询自动附加 organization_id
 * - 6.4: 按 compiler run 查询 Ledger completeness（P1，供预览 UI 使用）
 *
 * @aiproj/backend compiler
 */

import type {
  CompletenessLedger,
  GenerationContract,
  GenerationManifest,
} from '@aiproj/compiler-spec'
import { DateTime } from 'luxon'
import CompilerArtifact from '#models/compiler_artifact'
import CompilerStageEvent from '#models/compiler_stage_event'

export type CompilerSnapshotKind = 'contract' | 'manifest' | 'ledger' | 'pdm'

/**
 * CompilerPersistenceExtension —— Compiler 产物快照与事件扩展。
 */
export class CompilerPersistenceExtension {
  // ── 6.1 版本化快照写入 ──

  /**
   * 保存 Contract 快照。
   */
  async saveContractSnapshot(
    compilerRunId: number,
    organizationId: number,
    contract: GenerationContract,
    version: number,
  ): Promise<void> {
    await CompilerArtifact.create({
      compilerRunId,
      organizationId,
      kind: 'contract',
      stageId: null,
      version,
      payload: contract as unknown as Record<string, unknown>,
    })
  }

  /**
   * 保存 Manifest 快照。
   */
  async saveManifestSnapshot(
    compilerRunId: number,
    organizationId: number,
    manifest: GenerationManifest,
    version: number,
  ): Promise<void> {
    await CompilerArtifact.create({
      compilerRunId,
      organizationId,
      kind: 'manifest',
      stageId: null,
      version,
      payload: manifest as unknown as Record<string, unknown>,
    })
  }

  /**
   * 保存 Ledger 快照。
   */
  async saveLedgerSnapshot(
    compilerRunId: number,
    organizationId: number,
    ledger: CompletenessLedger,
    version: number,
  ): Promise<void> {
    await CompilerArtifact.create({
      compilerRunId,
      organizationId,
      kind: 'ledger',
      stageId: null,
      version,
      payload: ledger as unknown as Record<string, unknown>,
    })
  }

  /**
   * 保存 PDM 快照。
   */
  async savePdmSnapshot(
    compilerRunId: number,
    organizationId: number,
    pdm: Record<string, unknown>,
    version: number,
  ): Promise<void> {
    await CompilerArtifact.create({
      compilerRunId,
      organizationId,
      kind: 'pdm',
      stageId: null,
      version,
      payload: pdm,
    })
  }

  // ── 6.1 快照读取 ──

  /**
   * 读取最新 Contract 快照。
   */
  async loadLatestContract(compilerRunId: number): Promise<GenerationContract | null> {
    const artifact = await CompilerArtifact.query()
      .where('compiler_run_id', compilerRunId)
      .where('kind', 'contract')
      .orderBy('version', 'desc')
      .first()
    return (artifact?.payload as unknown as GenerationContract) ?? null
  }

  /**
   * 读取最新 Manifest 快照。
   */
  async loadLatestManifest(compilerRunId: number): Promise<GenerationManifest | null> {
    const artifact = await CompilerArtifact.query()
      .where('compiler_run_id', compilerRunId)
      .where('kind', 'manifest')
      .orderBy('version', 'desc')
      .first()
    return (artifact?.payload as unknown as GenerationManifest) ?? null
  }

  /**
   * 读取最新 Ledger 快照。
   */
  async loadLatestLedger(compilerRunId: number): Promise<CompletenessLedger | null> {
    const artifact = await CompilerArtifact.query()
      .where('compiler_run_id', compilerRunId)
      .where('kind', 'ledger')
      .orderBy('version', 'desc')
      .first()
    return (artifact?.payload as unknown as CompletenessLedger) ?? null
  }

  /**
   * 读取最新 PDM 快照。
   */
  async loadLatestPdm(compilerRunId: number): Promise<Record<string, unknown> | null> {
    const artifact = await CompilerArtifact.query()
      .where('compiler_run_id', compilerRunId)
      .where('kind', 'pdm')
      .orderBy('version', 'desc')
      .first()
    return artifact?.payload ?? null
  }

  // ── 6.2 扩展 Stage 事件 ──

  /**
   * 扩展 Stage 事件，记录实体级执行信息。
   */
  async recordStageEventWithEntity(params: {
    compilerRunId: number
    organizationId: number
    stageId: string
    phase: string
    status: string
    entityId?: string
    attemptNumber?: number
    modelMode?: string
    tokenBudget?: number
    validationSummary?: string
    error?: Record<string, unknown> | null
    startedAt?: string
    endedAt?: string
    durationMs?: number
    llmCalls?: number
    llmCost?: number
  }): Promise<void> {
    await CompilerStageEvent.create({
      compilerRunId: params.compilerRunId,
      organizationId: params.organizationId,
      stageId: params.stageId,
      phase: params.phase,
      status: params.status,
      entityId: params.entityId ?? null,
      attemptNumber: params.attemptNumber ?? null,
      modelMode: params.modelMode ?? null,
      tokenBudget: params.tokenBudget ?? null,
      validationSummary: params.validationSummary ?? null,
      startedAt: params.startedAt ? DateTime.fromISO(params.startedAt) : DateTime.now(),
      endedAt: params.endedAt ? DateTime.fromISO(params.endedAt) : undefined,
      durationMs: params.durationMs,
      llmCalls: params.llmCalls ?? 0,
      llmCost: params.llmCost ?? 0,
      error: params.error,
    })
  }

  // ── 6.3 组织隔离 ──

  /**
   * 按 organization_id 查询 Contract 快照。
   * 跨组织访问返回 null。
   */
  async loadContractWithOrgFilter(
    organizationId: number,
    compilerRunId: number,
  ): Promise<GenerationContract | null> {
    const artifact = await CompilerArtifact.query()
      .where('organization_id', organizationId)
      .where('compiler_run_id', compilerRunId)
      .where('kind', 'contract')
      .orderBy('version', 'desc')
      .first()
    return (artifact?.payload as unknown as GenerationContract) ?? null
  }

  /**
   * 按 organization_id 查询 Ledger 快照。
   */
  async loadLedgerWithOrgFilter(
    organizationId: number,
    compilerRunId: number,
  ): Promise<CompletenessLedger | null> {
    const artifact = await CompilerArtifact.query()
      .where('organization_id', organizationId)
      .where('compiler_run_id', compilerRunId)
      .where('kind', 'ledger')
      .orderBy('version', 'desc')
      .first()
    return (artifact?.payload as unknown as CompletenessLedger) ?? null
  }

  // ── 6.4 Ledger Completeness 查询（P1）──

  /**
   * 按 compiler run 查询 Ledger completeness 摘要。
   * 供后续预览 UI 使用。
   */
  async getCompletenessSummary(
    organizationId: number,
    compilerRunId: number,
  ): Promise<{
    overallCompleteness: number
    blockingItems: number
    needsHumanReview: number
    failedRetryable: number
  } | null> {
    const ledger = await this.loadLedgerWithOrgFilter(organizationId, compilerRunId)
    if (!ledger) return null

    return {
      overallCompleteness: ledger.summary.overallCompleteness,
      blockingItems: ledger.summary.blockingItems.length,
      needsHumanReview: ledger.summary.needsHumanReviewCount,
      failedRetryable: ledger.summary.failedRetryableCount,
    }
  }
}
