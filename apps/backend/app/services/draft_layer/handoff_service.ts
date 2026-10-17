/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerHandoffService（task 3.1-3.5）。
 *
 * 从服务端 compiler artifacts 读取并校验 PDM、Contract/Manifest/Ledger 摘要和 hash，
 * 验证可应用状态，创建 Draft Layer session。
 * 禁止客户端提交完整 PDM JSON。
 */
import { inject } from '@adonisjs/core'
import DraftLayerSession from '#models/draft_layer_session'
import { ArtifactStore } from '#services/compiler/artifact_store'
import { CompilerRunService } from '#services/compiler/compiler_run_service'
import type { CompletenessLedger } from '@aiproj/compiler-spec'
import type { DraftLayerPdmHandoff, DraftLayerSessionSummary } from '@aiproj/types'
import { computeContentHash } from '#services/compiler/artifact_store'

export class HandoffValidationError extends Error {
  constructor(
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'HandoffValidationError'
  }
}

export type HandoffResult = {
  session: DraftLayerSession
  handoff: DraftLayerPdmHandoff
}

@inject()
export class DraftLayerHandoffService {
  constructor(
    readonly artifactStore: ArtifactStore,
    readonly compilerRunService: CompilerRunService,
  ) {}

  /**
   * 从可应用的 Compiler Run 创建 Draft Layer session。
   * 1. 校验 Compiler Run 存在且属于同一组织
   * 2. 校验 PDM artifact 存在且 hash 可验证
   * 3. 校验 Ledger 无 blocking needs_human_review
   * 4. 读取 Contract/Manifest/Ledger 摘要
   * 5. 创建 session 并保存 handoff 摘要
   */
  async createFromCompilerRun(
    organizationId: number,
    userId: number,
    compilerRunId: number,
  ): Promise<HandoffResult> {
    // 1. 校验 Compiler Run
    const run = await this.compilerRunService.getRun(organizationId, compilerRunId)
    if (!run) {
      throw new HandoffValidationError('Compiler Run 不存在或不属于当前组织')
    }

    // 2. 读取 PDM artifact
    const pdmArtifact = await this.artifactStore.latest(compilerRunId, 'pdm')
    if (!pdmArtifact) {
      throw new HandoffValidationError('PDM artifact 不存在，编译尚未完成')
    }

    const pdmHash = pdmArtifact.contentHash ?? computeContentHash(pdmArtifact.payload)

    // 3. 校验 Ledger
    const ledger = await this.compilerRunService.getLatestLedger(organizationId, compilerRunId)
    if (ledger) {
      const hasBlocking = this.hasBlockingHumanReview(ledger)
      if (hasBlocking) {
        throw new HandoffValidationError('Ledger 存在阻塞应用项，需要人工处理', {
          details: { blockingItems: this.getBlockingItems(ledger) },
        })
      }
    }

    // 4. 读取摘要
    const contract = await this.artifactStore.latest(compilerRunId, 'contract')
    const manifest = await this.artifactStore.latest(compilerRunId, 'manifest')
    const ledgerArtifact = await this.artifactStore.latest(compilerRunId, 'ledger')

    const handoff: DraftLayerPdmHandoff = {
      compilerRunId,
      pdmArtifactId: pdmArtifact.artifactId ?? `pdm:v${pdmArtifact.version}`,
      pdmHash,
      ledgerSummary: {
        totalEntities: ledger?.entries?.length ?? 0,
        completedEntities:
          ledger?.entries?.filter((e: any) => e.status === 'completed').length ?? 0,
        needsHumanReview: ledger ? this.hasBlockingHumanReview(ledger) : false,
        blockingItems: ledger ? this.getBlockingItems(ledger) : [],
        hasBlockingHumanReview: ledger ? this.hasBlockingHumanReview(ledger) : false,
      },
      status: 'ready_to_handoff',
    }

    // 5. 创建 session
    const session = await DraftLayerSession.create({
      organizationId,
      createdByUserId: userId,
      sourceType: 'v2_compiler_pdm',
      compilerRunId,
      pdmArtifactId: pdmArtifact.artifactId ?? null,
      pdmHash,
      status: 'active',
      version: 1,
      summary: {
        compilerRunStatus: run.status,
        ledgerStatus: ledger ? 'passed' : 'unknown',
        pdmEntityCount: this.estimateEntityCount(pdmArtifact.payload),
        totalChanges: 0,
        acceptedChanges: 0,
        rejectedChanges: 0,
        pendingChanges: 0,
        unresolvedConflicts: 0,
        dryRunStatus: null,
        applyStatus: null,
      } as DraftLayerSessionSummary,
      metadata: {
        contractArtifactId: contract?.artifactId ?? null,
        manifestArtifactId: manifest?.artifactId ?? null,
        ledgerArtifactId: ledgerArtifact?.artifactId ?? null,
      },
      expiresAt: null,
    })

    return { session, handoff }
  }

  /**
   * 检查 Ledger 中是否存在 blocking 的 needs_human_review 项。
   */
  private hasBlockingHumanReview(ledger: CompletenessLedger): boolean {
    if (!ledger.entries) return false
    return ledger.entries.some(
      (entry: any) => entry.status === 'needs_human_review' && (entry as any).blocking !== false,
    )
  }

  /**
   * 获取 blocking 的 needs_human_review 项的摘要。
   */
  private getBlockingItems(ledger: CompletenessLedger): string[] {
    if (!ledger.entries) return []
    return ledger.entries
      .filter(
        (entry: any) => entry.status === 'needs_human_review' && (entry as any).blocking !== false,
      )
      .map((entry: any) => entry.description ?? entry.entityId ?? 'Unknown')
  }

  /**
   * 估算 PDM 中实体数量。
   */
  private estimateEntityCount(payload: unknown): number {
    if (!payload || typeof payload !== 'object') return 0
    const p = payload as Record<string, unknown>
    let count = 0
    if (Array.isArray(p.workstreams)) count += p.workstreams.length
    if (Array.isArray(p.workPackages)) count += p.workPackages.length
    if (Array.isArray(p.tasks)) count += p.tasks.length
    if (Array.isArray(p.milestones)) count += p.milestones.length
    return count
  }
}
