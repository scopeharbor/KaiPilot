/**
 * v3-plugin-permission-audit-and-observation — Observation Adapter（task 8.1-8.4）。
 *
 * 将已持久化的权限决策投影为有预算的 Observation evidence。
 * 复用既有 create/validate/budget/cursor helpers。
 * 不读取 raw audit JSON 或源码全文。
 *
 * 红线：
 * - Observation 是 ledger 的只读派生
 * - adapter 失败只使观察面 degraded，不更改授权
 * - 大结果只提供 resource handle，不内嵌完整日志
 * - 不输出原始 tenant/user/project id
 */
import type {
  PluginPermissionObservationInput,
  PluginPermissionObservationOutput,
  PluginPermissionFinding,
  PluginPermissionCausalPath,
  PluginPermissionRuntimeSignal,
  PluginPermissionResourceHandle,
  PluginPermissionObservationStatus,
} from '@aiproj/types'
import { pdDomainSeparatedHash, pdFnv1aHash } from '@aiproj/types'
import PluginPermissionDecision from '#models/plugin_permission_decision'

// =============================================================================
// Types
// =============================================================================

interface ObservationAggregate {
  totalDecisions: number
  allowedCount: number
  deniedCount: number
  byOperation: Record<string, { total: number; allowed: number; denied: number }>
  byReason: Record<string, number>
}

// =============================================================================
// Observation Adapter
// =============================================================================

const DEFAULT_BUDGET_CAP = 50

/**
 * Compile scoped aggregate into observation manifest.
 */
export async function compileObservation(
  input: PluginPermissionObservationInput,
): Promise<PluginPermissionObservationOutput> {
  try {
    // ── Step 1: Query aggregate from ledger ──
    const orgId = parseOrgScope(input.organizationScope)
    const aggregate = await queryAggregate(orgId, input)

    // ── Step 2: Build findings ──
    const findings = buildFindings(aggregate, input)

    // ── Step 3: Build causal paths ──
    const causalPaths = buildCausalPaths(aggregate)

    // ── Step 4: Build runtime signals ──
    const signals = buildRuntimeSignals(aggregate)

    // ── Step 5: Apply budget cap ──
    const budgetCap = input.budgetCap ?? DEFAULT_BUDGET_CAP
    const cappedFindings = findings.slice(0, budgetCap)
    const omittedCount = Math.max(0, findings.length - budgetCap)

    // ── Step 6: Build resource handle ──
    const resourceHandle = buildResourceHandle(input)

    // ── Step 7: Determine status ──
    const status: PluginPermissionObservationStatus =
      aggregate.totalDecisions === 0
        ? 'healthy'
        : aggregate.deniedCount / aggregate.totalDecisions > 0.5
          ? 'degraded'
          : 'healthy'

    return {
      status,
      organizationScope: input.organizationScope,
      projectScope: input.projectScope,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      totalDecisions: aggregate.totalDecisions,
      allowedCount: aggregate.allowedCount,
      deniedCount: aggregate.deniedCount,
      deniedRate:
        aggregate.totalDecisions > 0 ? aggregate.deniedCount / aggregate.totalDecisions : 0,
      findings: cappedFindings,
      omittedFindingsCount: omittedCount,
      nextCursor: omittedCount > 0 ? generateCursor(input) : null,
      causalPaths,
      signals,
      resourceHandle,
    }
  } catch (error) {
    // Observation failure → degraded, NOT authorization change
    return buildDegradedOutput(input)
  }
}

// =============================================================================
// Aggregate Query
// =============================================================================

function parseOrgScope(scope: string): number {
  // "org:123" → 123
  const match = scope.match(/^org:(\d+)$/)
  return match ? Number(match[1]) : 0
}

async function queryAggregate(
  orgId: number,
  input: PluginPermissionObservationInput,
): Promise<ObservationAggregate> {
  let query = PluginPermissionDecision.query()
    .where('organizationId', orgId)
    .where('createdAt', '>=', input.windowStart)
    .where('createdAt', '<=', input.windowEnd)

  if (input.pluginId) {
    query = query.where('pluginRefHash', pdDomainSeparatedHash('plugin', input.pluginId))
  }
  if (input.operation) {
    query = query.where('operation', input.operation)
  }

  const rows = await query

  const aggregate: ObservationAggregate = {
    totalDecisions: rows.length,
    allowedCount: rows.filter((r) => r.outcome === 'allowed').length,
    deniedCount: rows.filter((r) => r.outcome === 'denied').length,
    byOperation: {},
    byReason: {},
  }

  for (const row of rows) {
    if (!aggregate.byOperation[row.operation]) {
      aggregate.byOperation[row.operation] = { total: 0, allowed: 0, denied: 0 }
    }
    aggregate.byOperation[row.operation].total++
    if (row.outcome === 'allowed') {
      aggregate.byOperation[row.operation].allowed++
    } else {
      aggregate.byOperation[row.operation].denied++
    }

    aggregate.byReason[row.primaryReason] = (aggregate.byReason[row.primaryReason] ?? 0) + 1
  }

  return aggregate
}

// =============================================================================
// Finding Builder
// =============================================================================

function buildFindings(
  aggregate: ObservationAggregate,
  input: PluginPermissionObservationInput,
): PluginPermissionFinding[] {
  const findings: PluginPermissionFinding[] = []

  // High deny rate finding
  if (aggregate.totalDecisions > 0) {
    const denyRate = aggregate.deniedCount / aggregate.totalDecisions
    if (denyRate > 0.3) {
      findings.push({
        findingId: pdFnv1aHash(`high-deny-rate:${input.organizationScope}:${input.windowStart}`),
        status: 'fail',
        category: 'denial-rate',
        message: `高拒绝率: ${(denyRate * 100).toFixed(1)}% (${aggregate.deniedCount}/${aggregate.totalDecisions})`,
        relatedDecisionIds: [],
      })
    }
  }

  // Most common denial reason
  const topReason = Object.entries(aggregate.byReason).sort(([, a], [, b]) => b - a)[0]
  if (topReason) {
    findings.push({
      findingId: pdFnv1aHash(`top-reason:${topReason[0]}:${input.windowStart}`),
      status: 'warn',
      category: 'common-denial',
      message: `最常见拒绝原因: ${topReason[0]} (${topReason[1]} 次)`,
      relatedDecisionIds: [],
    })
  }

  return findings
}

// =============================================================================
// Causal Path Builder
// =============================================================================

function buildCausalPaths(aggregate: ObservationAggregate): PluginPermissionCausalPath[] {
  const paths: PluginPermissionCausalPath[] = []

  if (aggregate.byReason['audit-unavailable']) {
    paths.push({
      pathId: pdFnv1aHash(`audit-gap:${aggregate.totalDecisions}`),
      triggerCategory: 'audit-unavailable',
      description: '审计系统不可用导致授权被拒绝',
      decisionIds: [],
      severity: 'blocking',
    })
  }

  if (aggregate.byReason['cross-tenant-denied']) {
    paths.push({
      pathId: pdFnv1aHash(`cross-tenant:${aggregate.totalDecisions}`),
      triggerCategory: 'cross-tenant-denial',
      description: '跨租户访问被拒绝',
      decisionIds: [],
      severity: 'blocking',
    })
  }

  return paths
}

// =============================================================================
// Runtime Signal Builder
// =============================================================================

function buildRuntimeSignals(aggregate: ObservationAggregate): PluginPermissionRuntimeSignal[] {
  const signals: PluginPermissionRuntimeSignal[] = []

  if (aggregate.totalDecisions > 0) {
    signals.push({
      signalName: 'deny-rate',
      value: aggregate.deniedCount / aggregate.totalDecisions,
      unit: 'ratio',
      threshold: 0.5,
      breached: aggregate.deniedCount / aggregate.totalDecisions > 0.5,
    })
  }

  signals.push({
    signalName: 'total-decisions',
    value: aggregate.totalDecisions,
    unit: 'count',
    breached: false,
  })

  return signals
}

// =============================================================================
// Resource Handle Builder
// =============================================================================

function buildResourceHandle(
  input: PluginPermissionObservationInput,
): PluginPermissionResourceHandle {
  return {
    handleKind: 'observation-query',
    handleValue: pdDomainSeparatedHash(
      'handle',
      `${input.organizationScope}:${input.windowStart}:${input.windowEnd}`,
    ),
    ttlSeconds: 3600,
    createdAt: new Date().toISOString(),
  }
}

function generateCursor(input: PluginPermissionObservationInput): string {
  return pdFnv1aHash(`${input.organizationScope}:${input.windowEnd}:${input.budgetCap}`)
}

// =============================================================================
// Degraded Output Builder
// =============================================================================

function buildDegradedOutput(
  input: PluginPermissionObservationInput,
): PluginPermissionObservationOutput {
  return {
    status: 'unavailable',
    organizationScope: input.organizationScope,
    projectScope: input.projectScope,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    totalDecisions: 0,
    allowedCount: 0,
    deniedCount: 0,
    deniedRate: 0,
    findings: [
      {
        findingId: pdFnv1aHash(`observation-unavailable:${input.organizationScope}`),
        status: 'skip',
        category: 'observation-unavailable',
        message: 'Observation 投影不可用',
        relatedDecisionIds: [],
      },
    ],
    omittedFindingsCount: 0,
    nextCursor: null,
    causalPaths: [],
    signals: [],
    resourceHandle: buildResourceHandle(input),
  }
}
