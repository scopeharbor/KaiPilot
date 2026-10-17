/**
 * v3-copilot-usage-and-quota-surface §3–§5 — 用量与额度只读聚合服务。
 *
 * 聚合维度：组织 / 项目 / 用户 / 能力面 / 模型。
 * 关键裁决：
 * - 聚合在权限过滤之后进行（D2，防总计-分项反推）
 * - 无权限维度缺席而非显示为 0（D3，非泄露）
 * - 成本数字必须带 pricing snapshot 标识（D4，来源可追溯）
 * - 额度余量取既有只读查询（D6，不另算）
 * - 时间窗以组织时区解释（D7）
 * - 本 change 严格只读（D5）
 *
 * @aiproj/backend
 */

import type {
  UsageSurfaceResponse,
  UsageAggregationDimension,
  UsageCostEntry,
  UsageAllowanceEntry,
  UsageTruncatedList,
  UsageTimeWindow,
  UsageDimension,
} from '@aiproj/types'

import { isCostEntryValid } from '@aiproj/types'
import type RateLimitQueryService from '#services/rate_limiting/rate_limit_query_service'
import { type BudgetStatusService } from '#services/ai_budget/budget_status_service'
import type { UsageRecentCall } from '@aiproj/types'
import { DateTime } from 'luxon'
import UnifiedAiInvocationLedger from '#models/unified_ai_invocation_ledger'
import Organization from '#models/organization'

/** 账本字段读取：模型属性为 usageInputTokens/providerName/requestModel；兼容旧的简写字段。 */
const promptTokensOf = (r: any): number => Number(r.usageInputTokens ?? r.promptTokens ?? 0) || 0
const completionTokensOf = (r: any): number =>
  Number(r.usageOutputTokens ?? r.completionTokens ?? 0) || 0
const totalTokensOf = (r: any): number =>
  Number(r.totalTokens ?? 0) || promptTokensOf(r) + completionTokensOf(r)
const modelKeyOf = (r: any): string =>
  `${r.providerName ?? r.provider ?? 'unknown'}/${r.responseModel ?? r.requestModel ?? r.model ?? 'unknown'}`

/** 能力面中文名（未登记的原样显示）。 */
const CAPABILITY_LABELS: Record<string, string> = {
  project_draft: 'AI 生成项目',
  chat: 'AI 同事对话',
  copilot: 'AI 同事',
  compiler: '编译器',
  ocr: '文字识别',
  evaluation: '评测',
  web_search: '网页搜索',
}

/** 时间窗类型（controller 解析 window 参数后传入）。 */
export type UsageWindowType = 'monthly' | 'last_30_days' | 'last_24_hours' | 'last_7_days' | 'all'

// ---------------------------------------------------------------------------
// 权限维度（由 Policy 层注入）
// ---------------------------------------------------------------------------

export interface UsagePermissionDimensions {
  /** 当前 actor 有权查看的维度集合。 */
  allowedDimensions: Set<UsageDimension>
  /** 当前 actor 有权查看的项目 ID 集合（null = 有权查看全部项目）。 */
  allowedProjectIds: Set<number> | null
  /** 当前 actor 有权查看的用户 ID 集合（null = 有权查看全部用户）。 */
  allowedUserIds: Set<number> | null
  /** 当前 actor 有权查看的能力面集合（null = 有权查看全部能力面）。 */
  allowedCapabilities: Set<string> | null
}

// ---------------------------------------------------------------------------
// 聚合查询参数
// ---------------------------------------------------------------------------

export interface UsageAggregationQuery {
  organizationId: number
  windowStart: Date
  windowEnd: Date
  permissions: UsagePermissionDimensions
  topN?: number
  /** 时间窗类型：monthly（默认）/ last_30_days / last_24_hours / last_7_days / all。 */
  windowType?: UsageWindowType
}

// ---------------------------------------------------------------------------
// 用量聚合服务
// ---------------------------------------------------------------------------

export class UsageSurfaceService {
  readonly #rateLimitQuery: RateLimitQueryService
  readonly #budgetStatus: BudgetStatusService
  readonly #displayCurrency: string
  readonly #convertCost: ((value: number, from: string) => number | null) | null

  constructor(options: {
    rateLimitQuery: RateLimitQueryService
    budgetStatus: BudgetStatusService
    displayCurrency?: string
    convertCost?: (value: number, from: string) => number | null
  }) {
    this.#rateLimitQuery = options.rateLimitQuery
    this.#budgetStatus = options.budgetStatus
    this.#displayCurrency = options.displayCurrency ?? 'USD'
    this.#convertCost = options.convertCost ?? null
  }

  /**
   * 获取用量与额度只读视图。
   * 聚合在权限过滤之后进行——每个维度先按权限过滤，再聚合。
   */
  async getUsageSurface(query: UsageAggregationQuery): Promise<UsageSurfaceResponse> {
    const { organizationId, windowStart, windowEnd, permissions } = query
    const topN = query.topN ?? 10
    const windowType = query.windowType ?? 'monthly'

    // ── §5：时间窗 ──
    const window = await this.#resolveTimeWindow(organizationId, windowStart, windowEnd, windowType)

    // ── §3：五维聚合（在权限过滤之后） ──
    const dimensions = await this.#aggregateWithPermissionFilter(
      organizationId,
      window,
      permissions,
    )

    // ── 总计 ──
    // 取组织维度（= 窗口内全部调用）；五个维度是同一批调用的不同切面，相加会重复计数。
    const orgDimension = dimensions.find((d) => d.dimension === 'organization')
    const baseline = orgDimension ?? dimensions.find((d) => d.dimension === 'model') ?? null
    const totalCost = baseline ? baseline.cost : this.#computeTotalCost(dimensions)
    const totalTokens = baseline ? { ...baseline.tokens } : { prompt: 0, completion: 0, total: 0 }
    const totalCallCount = baseline ? baseline.callCount : 0
    const { statusCounts, recentCalls } = this.#lastRows
      ? this.#summarizeRows(this.#lastRows, this.#lastLabels)
      : { statusCounts: {}, recentCalls: [] }

    // ── §4：额度余量 ──
    const allowances = await this.#queryAllowances(organizationId)

    // ── Top N ──
    const topModels = this.#buildTopN(dimensions, topN)

    return {
      organizationId,
      window,
      dimensions,
      totalCost,
      costCoverage: baseline?.costCoverage,
      totalTokens,
      totalCallCount,
      allowances,
      topModels,
      aggregatedAt: new Date().toISOString(),
      statusCounts,
      recentCalls,
    }
  }

  /** 最近一次聚合读到的原始行与名称映射（供状态计数与明细复用，避免二次查询）。 */
  #lastRows: any[] | null = null
  #lastLabels: { projects: Map<number, string>; users: Map<number, string> } = {
    projects: new Map(),
    users: new Map(),
  }

  #summarizeRows(
    rows: any[],
    labels: { projects: Map<number, string>; users: Map<number, string> },
  ): { statusCounts: Record<string, number>; recentCalls: UsageRecentCall[] } {
    const statusCounts: Record<string, number> = {}
    for (const r of rows) {
      const status = String(r.status ?? 'unknown')
      statusCounts[status] = (statusCounts[status] ?? 0) + 1
    }
    const time = (r: any): number => {
      const v = r.occurredAt
      if (!v) return 0
      if (typeof v.toMillis === 'function') return v.toMillis()
      return new Date(v).getTime()
    }
    const recentCalls = [...rows]
      .sort((a, b) => time(b) - time(a))
      .slice(0, 20)
      .map((r): UsageRecentCall => ({
        occurredAt: new Date(time(r)).toISOString(),
        capability: CAPABILITY_LABELS[r.capability] ?? String(r.capability ?? 'unknown'),
        surface: String(r.surface ?? ''),
        model: modelKeyOf(r),
        status: String(r.status ?? 'unknown'),
        userLabel: r.userId ? (labels.users.get(Number(r.userId)) ?? `用户 ${r.userId}`) : null,
        projectLabel: r.projectId
          ? (labels.projects.get(Number(r.projectId)) ?? `项目 ${r.projectId}`)
          : null,
        totalTokens: totalTokensOf(r) || null,
        durationMs: r.durationMs ?? null,
        pricingApproximate: r.pricingApproximate ?? null,
        pricingMatchedBy: r.pricingMatchedBy ?? null,
        cost: this.#extractCostEntry(r),
      }))
    return { statusCounts, recentCalls }
  }

  /** 项目名 / 用户名映射（仅本组织范围；查询失败回落为编号，不影响聚合）。 */
  async #resolveLabels(
    organizationId: number,
    rows: any[],
  ): Promise<{ projects: Map<number, string>; users: Map<number, string> }> {
    const projects = new Map<number, string>()
    const users = new Map<number, string>()
    const projectIds = [...new Set(rows.map((r) => Number(r.projectId)).filter((id) => id > 0))]
    const userIds = [...new Set(rows.map((r) => Number(r.userId)).filter((id) => id > 0))]
    try {
      // 用到时才加载模型：名称只是展示增强，不让聚合服务在无 ORM 的单测环境里强依赖模型启动
      const [{ default: Project }, { default: User }] = await Promise.all([
        import('#models/project'),
        import('#models/user'),
      ])
      if (projectIds.length > 0) {
        const found = await Project.query()
          .where('organization_id', organizationId)
          .whereIn('id', projectIds)
          .select('id', 'name')
        for (const p of found) projects.set(Number(p.id), p.name)
      }
      if (userIds.length > 0) {
        const found = await User.query().whereIn('id', userIds).select('id', 'full_name', 'email')
        for (const u of found) users.set(Number(u.id), u.fullName || u.email)
      }
    } catch {
      // 名称只是展示增强
    }
    return { projects, users }
  }

  // ---------------------------------------------------------------------------
  // §3.1–3.2：五维聚合（在权限过滤之后）
  // ---------------------------------------------------------------------------

  async #aggregateWithPermissionFilter(
    organizationId: number,
    window: UsageTimeWindow,
    permissions: UsagePermissionDimensions,
  ): Promise<UsageAggregationDimension[]> {
    // 从账本查询窗口内数据
    const rows = await UnifiedAiInvocationLedger.query()
      .where('organization_id', organizationId)
      // 以 SQL 时间串比较：JS Date 在 SQLite 上会绑定成毫秒数，与存储的时间串比较永远不命中
      .where('occurred_at', '>=', DateTime.fromISO(window.start).toUTC().toSQL()!)
      .where('occurred_at', '<=', DateTime.fromISO(window.end).toUTC().toSQL()!)
      .select('*')

    const labels = await this.#resolveLabels(organizationId, rows)
    this.#lastRows = rows
    this.#lastLabels = labels

    const dimensions: UsageAggregationDimension[] = []

    // ── 组织维度 ──
    if (permissions.allowedDimensions.has('organization')) {
      dimensions.push(this.#aggregateOrganizationDimension(organizationId, rows))
    }

    // ── 项目维度（过滤后聚合） ──
    if (permissions.allowedDimensions.has('project')) {
      const projectRows =
        permissions.allowedProjectIds === null
          ? rows
          : rows.filter((r: any) => permissions.allowedProjectIds!.has(r.projectId))
      const byProject = this.#groupBy(projectRows, 'projectId')
      for (const [projectId, projectGroupRows] of byProject) {
        dimensions.push(
          this.#aggregateDimension(
            'project',
            String(projectId),
            projectId === 'null'
              ? '未关联项目'
              : (labels.projects.get(Number(projectId)) ?? `项目 ${projectId}`),
            projectGroupRows,
          ),
        )
      }
    }

    // ── 用户维度（过滤后聚合） ──
    if (permissions.allowedDimensions.has('user')) {
      const userRows =
        permissions.allowedUserIds === null
          ? rows
          : rows.filter((r: any) => permissions.allowedUserIds!.has(r.userId))
      const byUser = this.#groupBy(userRows, 'userId')
      for (const [userId, userGroupRows] of byUser) {
        dimensions.push(
          this.#aggregateDimension(
            'user',
            String(userId),
            userId === 'null' ? '系统' : (labels.users.get(Number(userId)) ?? `用户 ${userId}`),
            userGroupRows,
          ),
        )
      }
    }

    // ── 能力面维度（过滤后聚合） ──
    if (permissions.allowedDimensions.has('capability')) {
      const capRows =
        permissions.allowedCapabilities === null
          ? rows
          : rows.filter((r: any) => permissions.allowedCapabilities!.has(r.capability))
      const byCapability = this.#groupBy(capRows, 'capability')
      for (const [capability, capGroupRows] of byCapability) {
        dimensions.push(
          this.#aggregateDimension(
            'capability',
            capability,
            CAPABILITY_LABELS[capability] ?? capability,
            capGroupRows,
          ),
        )
      }
    }

    // ── 模型维度 ──
    if (permissions.allowedDimensions.has('model')) {
      const byModel = this.#groupBy(rows, modelKeyOf)
      for (const [modelKey, modelRows] of byModel) {
        dimensions.push(this.#aggregateDimension('model', modelKey, modelKey, modelRows))
      }
    }

    return dimensions
  }

  // ---------------------------------------------------------------------------
  // §3.4：无权限维度缺席（不显示为 0）
  // ---------------------------------------------------------------------------

  // 维度在 allowedDimensions 中才被添加——缺席通过 Set.has 检查实现

  // ---------------------------------------------------------------------------
  // §3.6：组织隔离
  // ---------------------------------------------------------------------------

  // 所有查询已附加 organization_id（见 #aggregateWithPermissionFilter）

  // ---------------------------------------------------------------------------
  // §3.8：Top N 截断标注
  // ---------------------------------------------------------------------------

  #buildTopN(
    dimensions: UsageAggregationDimension[],
    topN: number,
  ): UsageTruncatedList<UsageAggregationDimension> {
    const modelDimensions = dimensions.filter((d) => d.dimension === 'model')
    // 以调用次数为主序：此前只按 cost 排序，未登记定价的模型 cost 为 null（当 0 处理），
    // 会永远排在已定价模型之后，模型数超过 topN 时被静默截掉——用量最大的中转模型反而看不见。
    const sorted = modelDimensions.sort(
      (a, b) => b.callCount - a.callCount || (b.cost?.value ?? 0) - (a.cost?.value ?? 0),
    )
    const items = sorted.slice(0, topN)
    const omittedCount = Math.max(0, sorted.length - topN)

    return {
      items,
      total: sorted.length,
      truncated: omittedCount > 0,
      omittedCount,
    }
  }

  // ---------------------------------------------------------------------------
  // §4：额度余量
  // ---------------------------------------------------------------------------

  async #queryAllowances(organizationId: number): Promise<UsageAllowanceEntry[]> {
    const allowances: UsageAllowanceEntry[] = []

    // 限流余量（取既有 rate_limit_query_service）
    try {
      const rlStatus = await this.#rateLimitQuery.getStatus({ organizationId })
      for (const dim of rlStatus.dimensions) {
        allowances.push({
          dimension: dim.dimension,
          isUnlimited: dim.isUnlimited,
          limit: dim.limit,
          used: dim.currentCount,
          remaining: dim.remaining,
          windowStart: dim.windowStart,
          windowEnd: dim.windowEnd,
        })
      }
    } catch {
      // 限流服务不可用时，不添加限流余量条目
    }

    // 预算余量（取既有 budget_status_service）
    try {
      const budgetStatus = await this.#budgetStatus.getStatus({ organizationId })
      if (budgetStatus.remaining) {
        allowances.push({
          dimension: 'cost',
          isUnlimited: budgetStatus.remaining.cost === null,
          limit: budgetStatus.limits?.hardCost ?? null,
          used: budgetStatus.accumulated.cost,
          remaining: budgetStatus.remaining.cost,
          windowStart: budgetStatus.window.start,
          windowEnd: budgetStatus.window.end,
        })
        allowances.push({
          dimension: 'tokens',
          isUnlimited: budgetStatus.remaining.tokens === null,
          limit: budgetStatus.limits?.hardTokens ?? null,
          used: budgetStatus.accumulated.tokens,
          remaining: budgetStatus.remaining.tokens,
          windowStart: budgetStatus.window.start,
          windowEnd: budgetStatus.window.end,
        })
      }
    } catch {
      // 预算服务不可用时，不添加预算余量条目
    }

    return allowances
  }

  // ---------------------------------------------------------------------------
  // §5：时间窗与时区
  // ---------------------------------------------------------------------------

  async #resolveTimeWindow(
    organizationId: number,
    start: Date,
    end: Date,
    type: UsageWindowType = 'monthly',
  ): Promise<UsageTimeWindow> {
    let timezone = 'UTC'
    let utcFallback = true

    // 尝试读取组织时区
    try {
      const org = await Organization.query().where('id', organizationId).first()
      if (org && (org as any).timezone) {
        timezone = (org as any).timezone
        utcFallback = false
      }
    } catch {
      // 组织不存在或无时区，回落 UTC
    }

    return {
      type,
      start: start.toISOString(),
      end: end.toISOString(),
      timezone,
      utcFallback,
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  #groupBy(rows: any[], key: string | ((r: any) => string)): Map<string, any[]> {
    const map = new Map<string, any[]>()
    for (const row of rows) {
      const k = typeof key === 'function' ? key(row) : String(row[key])
      const existing = map.get(k)
      if (existing) {
        existing.push(row)
      } else {
        map.set(k, [row])
      }
    }
    return map
  }

  #aggregateOrganizationDimension(organizationId: number, rows: any[]): UsageAggregationDimension {
    return this.#aggregateDimension(
      'organization',
      String(organizationId),
      `组织 ${organizationId}`,
      rows,
    )
  }

  #aggregateDimension(
    dimension: UsageDimension,
    key: string,
    label: string,
    rows: any[],
  ): UsageAggregationDimension {
    // 成本聚合（带 pricing snapshot 标识）
    let cost: UsageCostEntry | null = null
    const costEntries = rows
      .map((r: any) => this.#extractCostEntry(r))
      .filter((e): e is UsageCostEntry => e !== null)
    const costBearingRows = rows.filter((row: any) => this.#recordedCostEntry(row) !== null).length

    const currencies = new Set(costEntries.map((entry) => entry.currency))
    if (costEntries.length > 0 && costEntries.length === costBearingRows && currencies.size === 1) {
      const totalValue = costEntries.reduce((sum, e) => sum + e.value, 0)
      cost = {
        value: Math.round(totalValue * 1_000_000) / 1_000_000,
        currency: costEntries[0]!.currency,
        pricingSnapshotId: costEntries[0]!.pricingSnapshotId,
        costBasis: costEntries[0]!.costBasis,
      }
    }

    // Token 聚合
    const tokens = {
      prompt: rows.reduce((sum: number, r: any) => sum + promptTokensOf(r), 0),
      completion: rows.reduce((sum: number, r: any) => sum + completionTokensOf(r), 0),
      total: rows.reduce((sum: number, r: any) => sum + totalTokensOf(r), 0),
    }

    return {
      dimension,
      key,
      label,
      cost,
      costCoverage: {
        pricedCalls: costBearingRows,
        unpricedCalls: rows.length - costBearingRows,
        unconvertedCalls: costBearingRows - costEntries.length,
      },
      tokens,
      callCount: rows.length,
    }
  }

  /**
   * 从账本行提取成本条目。
   * 只有带 pricing_snapshot_id 的行才产出有效成本条目（§2.3）。
   */
  #extractCostEntry(row: any): UsageCostEntry | null {
    const source = this.#recordedCostEntry(row)
    if (!source) return null
    if (!this.#convertCost) return source
    const converted = this.#convertCost(source.value, source.currency)
    if (converted === null || !Number.isFinite(converted) || converted < 0) return null
    return { ...source, value: converted, currency: this.#displayCurrency }
  }

  #recordedCostEntry(row: any): UsageCostEntry | null {
    // PG numeric/decimal 默认返回字符串，SQLite 返回 number。先守住空值边界再归一，
    // 否则有效成本被 number 类型检查丢弃，或 null 经 Number() 伪装成免费调用。
    const raw = row.estimatedCost
    if (typeof raw !== 'number' && typeof raw !== 'string') return null
    if (typeof raw === 'string' && !raw.trim()) return null
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) return null
    const entry: Partial<UsageCostEntry> = {
      value,
      currency: row.currency,
      pricingSnapshotId: row.pricingSnapshotId ?? '',
      costBasis: 'estimate',
    }
    if (!isCostEntryValid(entry)) return null
    if (!entry.currency.trim()) return null
    return entry
  }

  #computeTotalCost(dimensions: UsageAggregationDimension[]): UsageCostEntry | null {
    const validCosts = dimensions.filter((d) => d.cost !== null).map((d) => d.cost!)

    if (validCosts.length === 0) return null

    const currencies = new Set(validCosts.map((cost) => cost.currency))
    if (currencies.size !== 1) return null
    const totalValue = validCosts.reduce((sum, c) => sum + c.value, 0)
    return {
      value: Math.round(totalValue * 1_000_000) / 1_000_000,
      currency: validCosts[0]!.currency,
      pricingSnapshotId: validCosts[0]!.pricingSnapshotId,
      costBasis: validCosts[0]!.costBasis,
    }
  }
}
