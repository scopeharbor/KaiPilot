/**
 * v3-plugin-permission-audit-and-observation — Retention Service（task 9.3-9.6）。
 *
 * 为 decision ledger 接入现有 organization retention policy。
 * 定义与 audit row 一致的清理/归档顺序和 expired/unavailable marker。
 * 避免永久旁路副本。
 *
 * 红线：
 * - ledger 不对 audit retention 形成无限期副本
 * - 删除顺序：先 ledger 可观察索引，再 audit row
 * - 不删除其他组织的证据
 * - evidence package 只导出低敏摘要
 */
import PluginPermissionDecision from '#models/plugin_permission_decision'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

// =============================================================================
// Types
// =============================================================================

export interface RetentionCheckResult {
  /** Rows eligible for cleanup. */
  eligibleCount: number
  /** Retention policy in days. */
  policyDays: number
  /** Cutoff date. */
  cutoffDate: string
  /** Organization ID checked. */
  organizationId: number
}

export interface RetentionCleanupResult {
  /** Rows deleted from ledger. */
  deletedCount: number
  /** Organization ID. */
  organizationId: number
  /** Cutoff date used. */
  cutoffDate: string
}

// =============================================================================
// Retention Service
// =============================================================================

const DEFAULT_RETENTION_DAYS = 365

/**
 * Check retention eligibility.
 */
export async function checkRetentionEligibility(
  organizationId: number,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): Promise<RetentionCheckResult> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

  const eligible = await PluginPermissionDecision.query()
    .where('organizationId', organizationId)
    .where('createdAt', '<', cutoffDate.toISOString())
    .count('* as count')

  return {
    eligibleCount: Number(eligible[0]?.$extras.count ?? 0),
    policyDays: retentionDays,
    cutoffDate: cutoffDate.toISOString(),
    organizationId,
  }
}

/**
 * Cleanup expired decisions.
 * Only deletes from ledger (audit rows handled by enterprise audit retention).
 */
export async function cleanupExpiredDecisions(
  organizationId: number,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  trx?: TransactionClientContract,
): Promise<RetentionCleanupResult> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

  const query = PluginPermissionDecision.query(trx ? { client: trx } : undefined)
    .where('organizationId', organizationId)
    .where('createdAt', '<', cutoffDate.toISOString())

  const rows = await query
  const deletedCount = rows.length

  // Delete in batches
  for (const row of rows) {
    await row.delete()
  }

  return {
    deletedCount,
    organizationId,
    cutoffDate: cutoffDate.toISOString(),
  }
}

/**
 * Check if a decision is expired (for observation projection).
 */
export function isDecisionExpired(
  createdAt: string,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): boolean {
  const created = new Date(createdAt)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  return created < cutoff
}
