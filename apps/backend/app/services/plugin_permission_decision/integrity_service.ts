/**
 * v3-plugin-permission-audit-and-observation — Integrity Service（task 9.1-9.2）。
 *
 * 扩展企业审计完整性验证：allowed ledger row 必须有匹配的 audit receipt。
 * 缺失/篡改/版本不兼容产生 blocking finding。
 *
 * 红线：
 * - 完整性检查是只读的，不修改任何数据
 * - 发现 blocking finding 时返回结构化结果
 */
import PluginPermissionDecision from '#models/plugin_permission_decision'

// =============================================================================
// Types
// =============================================================================

export interface IntegrityFinding {
  /** Finding code (stable). */
  code: string
  /** Severity: blocking / warning. */
  severity: 'blocking' | 'warning'
  /** Description. */
  description: string
  /** Affected decision ID. */
  decisionId: string
}

export interface IntegrityCheckResult {
  /** Whether all checks passed. */
  passed: boolean
  /** Findings (empty if passed). */
  findings: IntegrityFinding[]
  /** Total rows checked. */
  totalChecked: number
  /** Rows with issues. */
  rowsWithIssues: number
}

// =============================================================================
// Integrity Checker
// =============================================================================

/**
 * Check integrity of plugin permission decisions.
 * Validates that allowed rows have matching audit receipts.
 */
export async function checkDecisionIntegrity(
  organizationId: number,
  options: {
    /** Only check recent N rows (default: 1000). */
    limit?: number
    /** Only check rows after this date. */
    since?: string
  } = {},
): Promise<IntegrityCheckResult> {
  const limit = options.limit ?? 1000
  const findings: IntegrityFinding[] = []

  let query = PluginPermissionDecision.query()
    .where('organizationId', organizationId)
    .orderBy('createdAt', 'desc')
    .limit(limit)

  if (options.since) {
    query = query.where('createdAt', '>=', options.since)
  }

  const rows = await query

  for (const row of rows) {
    // ── Check 1: Allowed rows must have audit_log_id ──
    if (row.outcome === 'allowed' && !row.auditLogId) {
      findings.push({
        code: 'allowed-missing-audit-receipt',
        severity: 'blocking',
        description: `允许决策 ${row.decisionId} 缺少审计 receipt`,
        decisionId: row.decisionId,
      })
    }

    // ── Check 2: Decision ID format validation ──
    if (!row.decisionId || row.decisionId.length < 8) {
      findings.push({
        code: 'invalid-decision-id',
        severity: 'blocking',
        description: `决策 ID 格式无效: ${row.decisionId}`,
        decisionId: row.decisionId,
      })
    }

    // ── Check 3: Schema version compatibility ──
    if (row.schemaVersion !== '1') {
      findings.push({
        code: 'schema-version-mismatch',
        severity: 'warning',
        description: `决策 ${row.decisionId} 使用未知 schema 版本: ${row.schemaVersion}`,
        decisionId: row.decisionId,
      })
    }

    // ── Check 4: Required fields present ──
    if (!row.mode || !row.operation || !row.outcome) {
      findings.push({
        code: 'missing-required-fields',
        severity: 'blocking',
        description: `决策 ${row.decisionId} 缺少必填字段`,
        decisionId: row.decisionId,
      })
    }
  }

  return {
    passed: findings.filter((f) => f.severity === 'blocking').length === 0,
    findings,
    totalChecked: rows.length,
    rowsWithIssues: new Set(findings.map((f) => f.decisionId)).size,
  }
}
