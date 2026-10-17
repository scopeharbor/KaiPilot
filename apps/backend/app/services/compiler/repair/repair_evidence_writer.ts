/**
 * @aiproj/backend —— Repair Evidence Writer（tasks 6.1–6.2）。
 *
 * 写入 repair plan、attempt、candidate patch、revalidation report、
 * reconciliation report 到 Compiler artifact，并写入 Ledger attempt history。
 *
 * @aiproj/backend
 */

import type {
  RepairPlan,
  RepairAttempt,
  RepairCandidatePatch,
  RevalidationResult,
  ReconciliationReport,
} from '@aiproj/compiler-spec'

// ── Artifact Store Interface ──

export interface ArtifactStoreWriter {
  save(
    kind: string,
    payload: unknown,
    opts?: {
      idempotencyKey?: string
      stageId?: string
      compilerRunId?: number
      organizationId?: number
    },
  ): Promise<{ ref: string }>
}

// ── Ledger Writer Interface ──

export interface LedgerWriter {
  recordAttemptHistory(entry: {
    attemptNumber: number
    strategy: string
    status: string
    issueIds: string[]
    patchRef?: string
    revalidationSummary?: string
    requiresHumanReview: boolean
  }): Promise<void>
}

// ── Evidence Writer ──

export class RepairEvidenceWriter {
  readonly #artifactStore: ArtifactStoreWriter
  readonly #ledger: LedgerWriter
  readonly #compilerRunId: number
  readonly #organizationId: number

  constructor(
    artifactStore: ArtifactStoreWriter,
    ledger: LedgerWriter,
    compilerRunId: number,
    organizationId: number = 0,
  ) {
    this.#artifactStore = artifactStore
    this.#ledger = ledger
    this.#compilerRunId = compilerRunId
    this.#organizationId = organizationId
  }

  /**
   * 6.1: 写入 Repair Plan 到 artifact。
   */
  async writeRepairPlan(plan: RepairPlan): Promise<string> {
    const result = await this.#artifactStore.save('repair_plan', plan, {
      compilerRunId: this.#compilerRunId,
      organizationId: this.#organizationId,
      idempotencyKey: `repair-plan-${plan.planId}`,
    })
    return result.ref
  }

  /**
   * 6.1: 写入 Repair Attempt 到 artifact。
   */
  async writeRepairAttempt(attempt: RepairAttempt): Promise<string> {
    const result = await this.#artifactStore.save('repair_attempt', attempt, {
      compilerRunId: this.#compilerRunId,
      organizationId: this.#organizationId,
      stageId: attempt.stageId,
      idempotencyKey: attempt.idempotencyKey,
    })
    return result.ref
  }

  /**
   * 6.1: 写入 Candidate Patch 到 artifact。
   */
  async writeCandidatePatch(patch: RepairCandidatePatch): Promise<string> {
    const result = await this.#artifactStore.save('repair_patch', patch, {
      compilerRunId: this.#compilerRunId,
      organizationId: this.#organizationId,
      idempotencyKey: patch.idempotencyKey,
    })
    return result.ref
  }

  /**
   * 6.1: 写入 Revalidation Report 到 artifact。
   */
  async writeRevalidationReport(result: RevalidationResult): Promise<string> {
    const ref = await this.#artifactStore.save('revalidation_report', result, {
      compilerRunId: this.#compilerRunId,
      organizationId: this.#organizationId,
    })
    return ref.ref
  }

  /**
   * 6.1: 写入 Reconciliation Report 到 artifact。
   */
  async writeReconciliationReport(report: ReconciliationReport): Promise<string> {
    const ref = await this.#artifactStore.save('reconciliation_report', report, {
      compilerRunId: this.#compilerRunId,
      organizationId: this.#organizationId,
    })
    return ref.ref
  }

  /**
   * 6.2: 写入 Ledger attempt history。
   */
  async writeLedgerHistory(
    attempt: RepairAttempt,
    patchRef?: string,
    revalidationSummary?: string,
  ): Promise<void> {
    await this.#ledger.recordAttemptHistory({
      attemptNumber: attempt.attemptNumber,
      strategy: attempt.strategy,
      status: attempt.status,
      issueIds: [attempt.issueId],
      patchRef,
      revalidationSummary,
      requiresHumanReview: attempt.status === 'degraded_to_human_review',
    })
  }
}
