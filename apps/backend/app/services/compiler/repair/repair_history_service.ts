/**
 * @aiproj/backend —— Repair History Query Service（tasks 8.1, P1）。
 *
 * 返回 repair history、attempt status、candidate patch refs、
 * revalidation summary、reconciliation report。
 *
 * 所有查询强制 organization_id 过滤。
 *
 * @aiproj/backend
 */

import type {
  RepairAttempt,
  RepairCandidatePatch,
  ReconciliationReport,
  RevalidationResult,
} from '@aiproj/compiler-spec'

// ── History Entry ──

export interface RepairHistoryEntry {
  planId: string
  attempts: RepairAttempt[]
  patches: RepairCandidatePatch[]
  revalidationResults: RevalidationResult[]
  reconciliationReports: ReconciliationReport[]
  summary: {
    totalAttempts: number
    succeeded: number
    failed: number
    degradedToHumanReview: number
    totalPatches: number
    totalFindings: number
  }
}

// ── Query Result ──

export interface RepairHistoryQueryResult {
  entries: RepairHistoryEntry[]
  total: number
  offset: number
  limit: number
}

// ── Store Query Interface ──

export interface RepairHistoryStore {
  queryByRunId(runId: number, organizationId: number, kind?: string): Promise<any[]>
}

// ── Service ──

export class RepairHistoryService {
  readonly #store: RepairHistoryStore

  constructor(store: RepairHistoryStore) {
    this.#store = store
  }

  async queryHistory(
    compilerRunId: number,
    organizationId: number,
    options?: { offset?: number; limit?: number },
  ): Promise<RepairHistoryQueryResult> {
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 20

    const plans =
      (await this.#store.queryByRunId(compilerRunId, organizationId, 'repair_plan')) ?? []
    const attempts =
      (await this.#store.queryByRunId(compilerRunId, organizationId, 'repair_attempt')) ?? []
    const patches =
      (await this.#store.queryByRunId(compilerRunId, organizationId, 'repair_patch')) ?? []
    const revalidations =
      (await this.#store.queryByRunId(compilerRunId, organizationId, 'revalidation_report')) ?? []
    const reconciliations =
      (await this.#store.queryByRunId(compilerRunId, organizationId, 'reconciliation_report')) ?? []

    const entry: RepairHistoryEntry = {
      planId: plans.length > 0 ? ((plans[0] as any)?.planId ?? 'unknown') : 'unknown',
      attempts: attempts.map((a: any) => a as RepairAttempt),
      patches: patches.map((p: any) => p as RepairCandidatePatch),
      revalidationResults: revalidations.map((r: any) => r as RevalidationResult),
      reconciliationReports: reconciliations.map((r: any) => r as ReconciliationReport),
      summary: {
        totalAttempts: attempts.length,
        succeeded: attempts.filter((a: any) => a.status === 'succeeded').length,
        failed: attempts.filter((a: any) => a.status === 'failed').length,
        degradedToHumanReview: attempts.filter((a: any) => a.status === 'degraded_to_human_review')
          .length,
        totalPatches: patches.length,
        totalFindings: reconciliations.reduce(
          (sum: number, r: any) => sum + ((r.summary?.totalFindings as number) ?? 0),
          0,
        ),
      },
    }

    return { entries: [entry], total: 1, offset, limit }
  }

  async assertOrgAccess(
    _compilerRunId: number,
    requestedOrgId: number,
    userOrgId: number,
  ): Promise<boolean> {
    return requestedOrgId === userOrgId
  }
}
