// @aiproj/types — V3 Copilot 用量与额度只读视图共享契约
// v3-copilot-usage-and-quota-surface
//
// 纯类型 + 确定性纯函数，禁止依赖 AdonisJS、React、数据库客户端、
// HTTP 客户端、外部网络、容器、provider 凭证或真实模型 SDK。
//
// 设计约束：
// - 严格只读：不写缓存表、不写聚合快照、不改账本
// - 成本数字必须带 pricing snapshot 标识 + 估算/实际标记
// - 无权限维度缺席（不显示为 0）
// - 聚合在权限过滤之后进行（防总计-分项反推）
// - 禁存约束：不含 prompt、模型输出、token 明文与 secret

// ---------------------------------------------------------------------------
// 五维聚合维度
// ---------------------------------------------------------------------------

export const USAGE_DIMENSIONS = ['organization', 'project', 'user', 'capability', 'model'] as const
export type UsageDimension = (typeof USAGE_DIMENSIONS)[number]

// ---------------------------------------------------------------------------
// 成本条目形状（§2.2）：必须带 pricing snapshot 标识与估算/实际标记
// ---------------------------------------------------------------------------

export interface UsageCostEntry {
  /** 成本数值。 */
  value: number
  /** 货币代码（如 CNY、USD）。 */
  currency: string
  /** pricing snapshot 标识 — 必须存在，否则该条目不得呈现。 */
  pricingSnapshotId: string
  /** 估算或实际计费标记。 */
  costBasis: 'estimate' | 'billed'
}

// ---------------------------------------------------------------------------
// 时间窗形状（§2.5）：带时区标注
// ---------------------------------------------------------------------------

export interface UsageTimeWindow {
  /** 时间窗类型。 */
  type: 'monthly' | 'last_30_days' | 'custom' | 'last_24_hours' | 'last_7_days' | 'all'
  /** 窗口起始（ISO 8601）。 */
  start: string
  /** 窗口结束（ISO 8601）。 */
  end: string
  /** 使用的时区。 */
  timezone: string
  /** 是否回落到 UTC（组织未配置时区时为 true）。 */
  utcFallback: boolean
}

// ---------------------------------------------------------------------------
// Top-N 截断标注（§3.8）
// ---------------------------------------------------------------------------

export interface UsageTruncatedList<T> {
  /** 当前页数据。 */
  items: T[]
  /** 总数。 */
  total: number
  /** 是否被截断。 */
  truncated: boolean
  /** 未显示的条目数。 */
  omittedCount: number
}

// ---------------------------------------------------------------------------
// 额度余量形状（§4）
// ---------------------------------------------------------------------------

export interface UsageAllowanceEntry {
  /** 维度名称（如 rpm、tpm、cost、tokens）。 */
  dimension: string
  /** 是否未设限。 */
  isUnlimited: boolean
  /** 限额值（未设限时为 null）。 */
  limit: number | null
  /** 当前用量。 */
  used: number
  /** 剩余量（未设限时为 null）。 */
  remaining: number | null
  /** 窗口起始（ISO 8601）。 */
  windowStart: string
  /** 窗口结束（ISO 8601）。 */
  windowEnd: string
}

// ---------------------------------------------------------------------------
// 五维聚合结果
// ---------------------------------------------------------------------------

export interface UsageAggregationDimension {
  /** 维度类型。 */
  dimension: UsageDimension
  /** 维度值标识。 */
  key: string
  /** 维度显示名称。 */
  label: string
  /** 成本汇总。 */
  cost: UsageCostEntry | null
  /** 已入账成本的覆盖情况；未知成本不当作零。 */
  costCoverage?: UsageCostCoverage
  /** token 汇总。 */
  tokens: {
    prompt: number
    completion: number
    total: number
  }
  /** 调用次数。 */
  callCount: number
}

export interface UsageCostCoverage {
  pricedCalls: number
  unpricedCalls: number
  unconvertedCalls: number
}

// ---------------------------------------------------------------------------
// 用量视图响应（顶层）
// ---------------------------------------------------------------------------

export interface UsageSurfaceResponse {
  /** 组织 ID。 */
  organizationId: number
  /** 当前时间窗。 */
  window: UsageTimeWindow
  /** 五维聚合结果（仅包含当前 actor 有权限的维度）。 */
  dimensions: UsageAggregationDimension[]
  /** 总成本。 */
  totalCost: UsageCostEntry | null
  costCoverage?: UsageCostCoverage
  /** 总 token。 */
  totalTokens: {
    prompt: number
    completion: number
    total: number
  }
  /** 总调用次数。 */
  totalCallCount: number
  /** 额度余量（仅包含有配置的维度）。 */
  allowances: UsageAllowanceEntry[]
  /** Top N 截断标注。 */
  topModels: UsageTruncatedList<UsageAggregationDimension>
  /** 聚合时间（ISO 8601）。 */
  aggregatedAt: string
  /** 按调用结果计数（succeeded / failed / aborted / degraded …）；旧响应无此字段。 */
  statusCounts?: Record<string, number>
  /** 最近调用明细（最多 20 条，按时间倒序），便于核对每一次消耗；旧响应无此字段。 */
  recentCalls?: UsageRecentCall[]
}

/** 最近一次 AI 调用的低敏明细（不含提示词与输出内容）。 */
export interface UsageRecentCall {
  /** 调用当时入账的快照估算，按展示币种换算；未知时为空。 */
  cost?: UsageCostEntry | null
  occurredAt: string
  capability: string
  surface: string
  model: string
  status: string
  userLabel: string | null
  projectLabel: string | null
  totalTokens: number | null
  durationMs: number | null
  /** 本次成本是否来自同名/同族近似价；旧账本为空。 */
  pricingApproximate?: boolean | null
  /** 定价归属是连接模型精确命中，还是连接内模型名回落。 */
  pricingMatchedBy?: 'connection_model_id' | 'model_name' | null
}

// ---------------------------------------------------------------------------
// 五态 fixtures（§2.8）
// ---------------------------------------------------------------------------

/** 占位类型，fixture 在单独的 fixtures 文件中定义。 */
export type UsageSurfaceFixtureKind =
  'full_visibility' | 'partial_dimensions' | 'zero_usage' | 'missing_snapshot' | 'missing_timezone'

// ---------------------------------------------------------------------------
// 禁存约束检查（§2.6）
// ---------------------------------------------------------------------------

/** 视图契约中禁止出现的敏感字段名。 */
export const USAGE_SURFACE_FORBIDDEN_FIELDS = [
  'prompt',
  'promptText',
  'systemInstructions',
  'modelOutput',
  'outputText',
  'tokenText',
  'secret',
  'apiKey',
  'authorization',
  'password',
  'rawPayload',
  'contextPacketRef',
  'modelOutputRef',
] as const

/**
 * 检查对象是否包含禁存字段。
 * 返回命中的字段名列表（空数组 = 安全）。
 */
export function detectUsageSurfaceForbiddenFields(obj: Record<string, unknown>): string[] {
  const hits: string[] = []
  for (const key of USAGE_SURFACE_FORBIDDEN_FIELDS) {
    if (key in obj) {
      hits.push(key)
    }
  }
  return hits
}

/**
 * 确认成本条目带有必要的来源标注。
 * 缺少 pricingSnapshotId 或 costBasis 的条目不得呈现。
 */
export function isCostEntryValid(entry: Partial<UsageCostEntry>): entry is UsageCostEntry {
  return (
    typeof entry.value === 'number' &&
    typeof entry.currency === 'string' &&
    typeof entry.pricingSnapshotId === 'string' &&
    entry.pricingSnapshotId.length > 0 &&
    (entry.costBasis === 'estimate' || entry.costBasis === 'billed')
  )
}
