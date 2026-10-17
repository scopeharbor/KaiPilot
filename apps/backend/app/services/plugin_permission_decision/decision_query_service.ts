/**
 * v3-plugin-permission-audit-and-observation — Decision Query Service（task 7.3-7.4）。
 *
 * 只读查询服务：返回低敏 event list、{ data, meta }、有界聚合和 evidence availability。
 * 查询始终从 server-owned organization scope 开始。
 *
 * 红线：
 * - 无条件附加 organization_id scope
 * - 不接受客户端覆盖 scope
 * - 不修改授权/grant/安装态/审计记录/业务数据
 * - storage IDs 不出 DTO
 */
import type {
  PluginPermissionDecisionMode,
  PluginPermissionDecisionOperation,
  PluginPermissionDecisionOutcome,
  PluginPermissionReasonCode,
  PluginPermissionDecisionAggregate,
} from '@aiproj/types'
import PluginPermissionDecision from '#models/plugin_permission_decision'

// =============================================================================
// Types
// =============================================================================

export interface DecisionQueryFilter {
  /** Filter by mode. */
  mode?: PluginPermissionDecisionMode
  /** Filter by operation. */
  operation?: PluginPermissionDecisionOperation
  /** Filter by outcome. */
  outcome?: PluginPermissionDecisionOutcome
  /** Filter by reason code. */
  reasonCode?: PluginPermissionReasonCode
  /** Created after (ISO timestamp). */
  createdAfter?: string
  /** Created before (ISO timestamp). */
  createdBefore?: string
  /** Page number (1-based). */
  page?: number
  /** Page size (max 100). */
  perPage?: number
}

export interface DecisionQueryResult {
  /** Decision events (low-sensitive). */
  data: DecisionEventDTO[]
  /** Pagination meta. */
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export interface DecisionEventDTO {
  /** Decision id. */
  decisionId: string
  /** Decision mode. */
  mode: string
  /** Decision operation. */
  operation: string
  /** Final outcome. */
  outcome: string
  /** Primary reason code. */
  primaryReason: string
  /** Reason codes (sorted by priority). */
  reasonCodes: string[]
  /** Plugin ref hash (low-sensitive). */
  pluginRefHash: string | null
  /** Actor ref hash (low-sensitive). */
  actorRefHash: string
  /** Correlation ref. */
  correlationRef: string | null
  /** Created timestamp. */
  createdAt: string
}

export interface DecisionAggregateResult {
  /** Aggregation by operation. */
  byOperation: PluginPermissionDecisionAggregate[]
  /** Aggregation by outcome. */
  byOutcome: PluginPermissionDecisionAggregate[]
  /** Aggregation by reason. */
  byReason: PluginPermissionDecisionAggregate[]
}

// =============================================================================
// Query Service
// =============================================================================

const MAX_PER_PAGE = 100
const DEFAULT_PER_PAGE = 20

/**
 * Query decisions with organization isolation.
 */
export async function queryDecisions(
  organizationId: number,
  filter: DecisionQueryFilter,
): Promise<DecisionQueryResult> {
  const page = Math.max(1, filter.page ?? 1)
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, filter.perPage ?? DEFAULT_PER_PAGE))

  let query = PluginPermissionDecision.query().where('organizationId', organizationId)

  // Apply filters
  if (filter.mode) {
    query = query.where('mode', filter.mode)
  }
  if (filter.operation) {
    query = query.where('operation', filter.operation)
  }
  if (filter.outcome) {
    query = query.where('outcome', filter.outcome)
  }
  if (filter.reasonCode) {
    query = query.where('primaryReason', filter.reasonCode)
  }
  if (filter.createdAfter) {
    query = query.where('createdAt', '>=', filter.createdAfter)
  }
  if (filter.createdBefore) {
    query = query.where('createdAt', '<=', filter.createdBefore)
  }

  // Paginate
  const result = await query
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .paginate(page, perPage)

  // Map to DTO (low-sensitive)
  const data: DecisionEventDTO[] = result.all().map((row) => ({
    decisionId: row.decisionId,
    mode: row.mode,
    operation: row.operation,
    outcome: row.outcome,
    primaryReason: row.primaryReason,
    reasonCodes: row.reasonCodes ?? [],
    pluginRefHash: row.pluginRefHash,
    actorRefHash: row.actorRefHash,
    correlationRef: row.correlationRef,
    createdAt: row.createdAt.toISO()!,
  }))

  return {
    data,
    meta: {
      total: result.total,
      page: result.currentPage,
      perPage: result.perPage,
      totalPages: result.lastPage,
    },
  }
}

/**
 * Aggregate decisions by operation/outcome/reason.
 */
export async function aggregateDecisions(
  organizationId: number,
  filter: DecisionQueryFilter,
): Promise<DecisionAggregateResult> {
  let baseQuery = PluginPermissionDecision.query().where('organizationId', organizationId)

  if (filter.createdAfter) {
    baseQuery = baseQuery.where('createdAt', '>=', filter.createdAfter)
  }
  if (filter.createdBefore) {
    baseQuery = baseQuery.where('createdAt', '<=', filter.createdBefore)
  }

  // Aggregate by operation
  const byOperation = await aggregateByField(baseQuery, 'operation')

  // Aggregate by outcome
  const byOutcome = await aggregateByField(baseQuery, 'outcome')

  // Aggregate by reason
  const byReason = await aggregateByField(baseQuery, 'primaryReason')

  return { byOperation, byOutcome, byReason }
}

async function aggregateByField(
  query: ReturnType<typeof PluginPermissionDecision.query>,
  field: string,
): Promise<PluginPermissionDecisionAggregate[]> {
  // Lucid 聚合查询行：select 别名列落在 $extras 上。
  interface AggregateRow {
    $extras: { key?: unknown; count?: unknown }
  }
  const toCount = (row: AggregateRow | undefined): number => Number(row?.$extras.count ?? 0)

  // SQLite-compatible aggregation
  const rows = (await query.select(`${field} as key`).count('* as count')) as AggregateRow[]

  // Group by key and count allowed/denied
  const grouped: Record<string, { count: number; allowed: number; denied: number }> = {}

  for (const row of rows) {
    // Lucid 版本差异：别名列可能落在 $extras，也可能直接挂在行对象上——两处都兼容。
    const key = String(
      row.$extras.key ?? (row as unknown as Record<string, unknown>).key ?? 'unknown',
    )
    if (!grouped[key]) {
      grouped[key] = { count: 0, allowed: 0, denied: 0 }
    }
    grouped[key].count += 1
  }

  // Re-query with outcome breakdown
  for (const key of Object.keys(grouped)) {
    const allowed = (await query
      .where(field, key)
      .where('outcome', 'allowed')
      .count('* as count')) as AggregateRow[]
    const denied = (await query
      .where(field, key)
      .where('outcome', 'denied')
      .count('* as count')) as AggregateRow[]
    grouped[key].allowed = toCount(allowed[0])
    grouped[key].denied = toCount(denied[0])
  }

  return Object.entries(grouped).map(([key, value]) => ({
    key,
    count: value.count,
    allowed: value.allowed,
    denied: value.denied,
  }))
}
