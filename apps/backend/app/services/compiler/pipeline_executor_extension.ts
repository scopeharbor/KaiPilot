/**
 * PipelineExecutorExtension —— ContractBuilder / ManifestPlanner / LedgerService 与 PipelineExecutor 的集成层。
 *
 * 在 Foundation PipelineExecutor 的基础上添加：
 * - 运行初始化：Contract → Manifest → Ledger (4.1)
 * - Stage 前 readiness 判断：依赖未满足实体禁止启动 (4.2)
 * - Stage 后验证与 Ledger 更新：JSON/schema/Contract/reference (4.3)
 * - PDM 合并前 entity id 校验：必须存在于 Manifest (4.4)
 * - 所有写入使用幂等键 (4.5)
 *
 * @aiproj/backend compiler
 */

import type { GenerationContract, GenerationManifest } from '@aiproj/compiler-spec'
import { GenerationContractBuilder, type BlueprintInput } from './generation_contract_builder.js'
import {
  GenerationManifestPlanner,
  type EntityGenerationHint,
} from './generation_manifest_planner.js'
import { CompletenessLedgerService } from './completeness_ledger_service.js'

export interface InitResult {
  contract: GenerationContract
  manifest: GenerationManifest
  ledgerService: CompletenessLedgerService
}

export interface StageOutput {
  entityId: string
  payload: Record<string, unknown>
  stageId: string
}

export interface IdempotentWriteOptions {
  compilerRunId: number
  stageId: string
  entityId?: string
  contractVersion: number
  manifestVersion: number
  attemptNumber: number
  payload: Record<string, unknown>
}

/**
 * PipelineExecutorExtension —— 集成 Contract/Manifest/Ledger 的执行扩展。
 */
export class PipelineExecutorExtension {
  readonly contractBuilder: GenerationContractBuilder
  readonly manifestPlanner: GenerationManifestPlanner
  readonly ledgerService: CompletenessLedgerService

  constructor(options?: { defaultMaxRetries?: number }) {
    this.contractBuilder = new GenerationContractBuilder()
    this.manifestPlanner = new GenerationManifestPlanner({
      manifestVersion: 1,
      defaultMaxRetries: options?.defaultMaxRetries,
    })
    this.ledgerService = new CompletenessLedgerService(options)
  }

  // ── 4.1 运行初始化 ──

  /**
   * 从 Blueprint 输入初始化 Contract → Manifest → Ledger 全流程。
   */
  initializeRun(
    blueprintInput: BlueprintInput,
    hints: EntityGenerationHint[],
    runId: number,
  ): InitResult {
    const contract = this.contractBuilder.build(blueprintInput)
    const manifest = this.manifestPlanner.plan(contract, hints, runId)
    this.ledgerService.initialize(manifest, runId)
    return { contract, manifest, ledgerService: this.ledgerService }
  }

  /**
   * 从预先存在的 Contract/Manifest 恢复 Ledger。
   * 用于 Resume 场景。
   */
  initializeFromExisting(
    _contract: GenerationContract,
    manifest: GenerationManifest,
    runId: number,
  ): void {
    this.ledgerService.initialize(manifest, runId)
  }

  // ── 4.2 Stage 前 readiness 判断 ──

  /**
   * 检查实体是否可执行（依赖满足 + 状态为 ready）。
   *
   * @param entityIds 要检查的实体 ID 列表
   * @returns 每个实体是否 ready
   */
  areEntitiesReady(entityIds: string[]): Map<string, { ready: boolean; reason?: string }> {
    const results = new Map<string, { ready: boolean; reason?: string }>()

    for (const entityId of entityIds) {
      const entry = this.ledgerService.getEntry(entityId)
      if (!entry) {
        results.set(entityId, { ready: false, reason: 'Entity not found in Ledger' })
        continue
      }

      if (entry.status !== 'ready') {
        results.set(entityId, {
          ready: false,
          reason: `Status is ${entry.status}, expected ready`,
        })
        continue
      }

      results.set(entityId, { ready: true })
    }

    return results
  }

  /**
   * 将一批实体标记为 generating（开始执行前调用）。
   */
  markBatchGenerating(entityIds: string[]): void {
    for (const entityId of entityIds) {
      this.ledgerService.transitionTo(entityId, 'generating')
    }
  }

  // ── 4.3 Stage 后验证与 Ledger 更新 ──

  /**
   * Stage 执行后执行 JSON/schema/Contract 验证，并按结果更新 Ledger。
   *
   * @param stageOutput  Stage 输出
   * @param validateFn   自定义验证函数（返回 { valid, errors }）
   * @returns             验证是否通过
   */
  async validateAndUpdateLedger(
    stageOutput: StageOutput,
    validateFn: (output: Record<string, unknown>) => { valid: boolean; errors: string[] },
  ): Promise<boolean> {
    // 先标记 validating
    this.ledgerService.transitionTo(stageOutput.entityId, 'generated')
    this.ledgerService.transitionTo(stageOutput.entityId, 'validating')

    // 执行验证
    const validation = validateFn(stageOutput.payload)

    // 记录验证结果
    this.ledgerService.recordValidation(stageOutput.entityId, {
      validatorId: 'stage_post_validation',
      validatorType: 'json_schema',
      passed: validation.valid,
      errors: validation.errors.map((msg) => ({
        path: '',
        message: msg,
        code: 'POST_STAGE_VALIDATION_ERROR',
      })),
      warnings: [],
      validatedAt: new Date().toISOString(),
    })

    if (validation.valid) {
      this.ledgerService.transitionTo(stageOutput.entityId, 'validated')
      return true
    }

    // 验证失败 → 记入 attempt 并重试判断
    this.ledgerService.markFailed(stageOutput.entityId, validation.errors.join('; '))
    return false
  }

  // ── 4.4 PDM 合并前实体校验 ──

  /**
   * 校验一批实体 ID 是否全部存在于 Manifest。
   * 拒绝未知或重复实体。
   */
  validatePdmEntities(
    entityIds: string[],
    manifest: GenerationManifest,
  ): { valid: boolean; unknownIds: string[]; duplicateIds: string[] } {
    const manifestIds = new Set(manifest.entities.map((e) => e.entityId))
    const seen = new Set<string>()
    const unknownIds: string[] = []
    const duplicateIds: string[] = []

    for (const entityId of entityIds) {
      if (!manifestIds.has(entityId)) {
        unknownIds.push(entityId)
      } else if (seen.has(entityId)) {
        duplicateIds.push(entityId)
      }
      seen.add(entityId)
    }

    return {
      valid: unknownIds.length === 0 && duplicateIds.length === 0,
      unknownIds,
      duplicateIds,
    }
  }

  /**
   * PDM 合并完成后标记实体 committed_to_pdm。
   */
  markPdmCommitted(entityId: string, outputRef: string): void {
    this.ledgerService.markCommitted(entityId, outputRef)
  }

  // ── 4.5 幂等键写入集成 ──

  /**
   * 生成幂等性写入需要的键。
   */
  buildIdempotencyComponents(
    compilerRunId: number,
    stageId: string,
    entityId: string,
    contractVersion: number,
    manifestVersion: number,
    attemptNumber: number,
  ) {
    return { compilerRunId, stageId, entityId, contractVersion, manifestVersion, attemptNumber }
  }

  /**
   * 检查当前 Ledger 是否有阻塞项阻止运行可应用。
   */
  canBeApplied(): { allowed: boolean; blocking: string[] } {
    const hasHumanReview = this.ledgerService.hasNeedsHumanReviewBlocking()
    const blocking = this.ledgerService
      .getNeedsHumanReviewEntities()
      .map((e) => `${e.entityId}: ${e.label}`)

    return {
      allowed: !hasHumanReview,
      blocking,
    }
  }
}
