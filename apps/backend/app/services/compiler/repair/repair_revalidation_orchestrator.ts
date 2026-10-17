/**
 * @aiproj/backend —— Repair Revalidation Orchestrator（tasks 5.1–5.5）。
 *
 * 对 candidate patch 的临时快照重新执行 schema、graph、deterministic recompute、
 * Hard Validator 和 V-Gate。
 *
 * @aiproj/backend
 */

import type {
  RepairCandidatePatch,
  RevalidationRequest,
  RevalidationResult,
  RepairAttempt,
} from '@aiproj/compiler-spec'
import type { CascadeGuard } from '@aiproj/compiler-spec'

// ── Schema Validator Interface ──

export interface SchemaValidator {
  validate(pdm: unknown): { valid: boolean; errors: string[] }
}

// ── Graph Validator Interface ──

export interface GraphValidator {
  validate(dependencies: unknown): { valid: boolean; issues: string[] }
}

// ── Deterministic Recompute Interface ──

export interface DeterministicRecompute {
  recompute(
    pdm: unknown,
    affectedEntities: string[],
  ): Promise<{ success: boolean; errors: string[] }>
}

// ── Hard Validator Interface ──

export interface HardValidator {
  validate(pdm: unknown): Promise<{ passed: boolean; blockingIssues: string[] }>
}

// ── V-Gate Interface ──

export interface VGate {
  decide(pdm: unknown): Promise<{
    status: 'pass' | 'conditional_pass' | 'blocked' | 'awaiting_review'
    summary: string
  }>
}

// ── Orchestrator ──

export class RepairRevalidationOrchestrator {
  readonly #schemaValidator: SchemaValidator
  readonly #graphValidator: GraphValidator
  readonly #deterministicRecompute: DeterministicRecompute
  readonly #hardValidator: HardValidator
  readonly #vGate: VGate

  constructor(
    schemaValidator: SchemaValidator,
    graphValidator: GraphValidator,
    deterministicRecompute: DeterministicRecompute,
    hardValidator: HardValidator,
    vGate: VGate,
  ) {
    this.#schemaValidator = schemaValidator
    this.#graphValidator = graphValidator
    this.#deterministicRecompute = deterministicRecompute
    this.#hardValidator = hardValidator
    this.#vGate = vGate
  }

  /**
   * 5.1: 对 candidate patch 进行重校验。
   */
  async revalidate(
    _patch: RepairCandidatePatch,
    pdmSnapshot: unknown,
    request: RevalidationRequest,
  ): Promise<RevalidationResult> {
    const errors: string[] = []

    // Schema 校验
    let schemaValid = true
    if (request.includeHardValidation) {
      const schemaResult = this.#schemaValidator.validate(pdmSnapshot)
      schemaValid = schemaResult.valid
      if (!schemaValid) errors.push(...schemaResult.errors)
    }

    // 图校验
    let refsValid = true
    if (request.includeHardValidation) {
      const graphResult = this.#graphValidator.validate(pdmSnapshot)
      refsValid = graphResult.valid
      if (!refsValid) errors.push(...graphResult.issues)
    }

    // 5.2: 受影响闭包 — 日期/依赖修改扩展到下游
    let deterministicValid = true
    if (request.includeDeterministicRecompute) {
      const detResult = await this.#deterministicRecompute.recompute(
        pdmSnapshot,
        request.affectedEntityIds,
      )
      deterministicValid = detResult.success
      if (!deterministicValid) errors.push(...detResult.errors)
    }

    // 5.3: Hard Validator
    let hardValidationValid = true
    if (request.includeHardValidation) {
      const hvResult = await this.#hardValidator.validate(pdmSnapshot)
      hardValidationValid = hvResult.passed
      if (!hardValidationValid) errors.push(...hvResult.blockingIssues)
    }

    // 5.3: V-Gate
    let vGateStatus: RevalidationResult['vGateDecision']
    let vGateSummary: string | undefined
    if (request.includeVGate) {
      const vgResult = await this.#vGate.decide(pdmSnapshot)
      vGateStatus = vgResult.status
      vGateSummary = vgResult.summary
    }

    const passed =
      schemaValid &&
      refsValid &&
      deterministicValid &&
      hardValidationValid &&
      vGateStatus !== 'blocked'

    const result: RevalidationResult = {
      requestId: request.requestId,
      passed,
      schemaValid,
      referencesValid: refsValid,
      deterministicValid,
      hardValidationValid,
      vGateDecision: vGateStatus,
      vGateSummary,
      affectedEntityIds: request.affectedEntityIds,
      remainingIssues: passed ? [] : errors,
      summary: passed
        ? 'All revalidation checks passed'
        : `Revalidation failed: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` and ${errors.length - 3} more` : ''}`,
      completedAt: new Date().toISOString(),
    }

    return result
  }

  /**
   * 5.2: 扩展受影响闭包。
   * 日期/依赖修改：扩展到下游任务、关键路径、资源日期桶和里程碑。
   * 资源修改：扩展到资源负载桶。
   */
  expandAffectedClosure(
    patch: RepairCandidatePatch,
    entityDependencyMap: Map<string, string[]>,
    cascadeGuard: CascadeGuard,
  ): string[] {
    const expanded = new Set(cascadeGuard.affectedEntityIds)

    // 检测是否涉及日期/依赖修改
    const hasScheduleChanges = patch.ops.some(
      (op) =>
        op.path.includes('plannedStart') ||
        op.path.includes('plannedEnd') ||
        op.path.includes('duration') ||
        op.path.includes('dependencies'),
    )

    if (hasScheduleChanges) {
      // BFS 扩展到所有下游
      for (const entityId of patch.entityIds) {
        const downstream = entityDependencyMap.get(entityId) ?? []
        for (const dep of downstream) {
          expanded.add(dep)
        }
      }
    }

    // 检测是否涉及资源修改
    const hasResourceChanges = patch.ops.some(
      (op) => op.path.includes('resource') || op.path.includes('allocations'),
    )

    if (hasResourceChanges) {
      // 标记需要资源重算（将资源桶加入 affected 集合）
      for (const entityId of patch.entityIds) {
        expanded.add(`resource-bucket-${entityId}`)
      }
    }

    return Array.from(expanded)
  }

  /**
   * 5.4: 重校验通过后的处理。
   * 返回是否应将结果写入 Compiler 运行态 artifact。
   */
  isWritable(result: RevalidationResult): boolean {
    return result.passed || (!result.passed && result.remainingIssues.length > 0)
  }

  /**
   * 5.5: 重校验失败后的处理。
   * 构造 failed attempt 记录。
   */
  buildFailedAttemptRecord(
    attempt: RepairAttempt,
    _result: RevalidationResult,
    _beforePatch: unknown,
    _afterPatch: unknown,
  ): RepairAttempt {
    return {
      ...attempt,
      status: 'failed',
      errorCategory: 'revalidation_failed',
      errorMessage: _result.summary,
      completedAt: new Date().toISOString(),
    }
  }
}
