/**
 * v3-ai-model-drift-observability —— 模型漂移观测共享契约。
 *
 * 按 (连接, request_model) 维度检测 response_model 分布变化，
 * 在首次出现新取值时产生漂移事件，关联换版前后的质量/成本/延迟差异，
 * 独立统计 response_model 缺失率，不做自动响应、不做因果断言。
 *
 * 零新增采集原则：所有数据来自统一账本的 request_model / response_model 列。
 * 零运行时依赖原则：不导入 zod / adonisjs / Date.now() / Math.random()。
 *
 * @aiproj/types 零依赖约束
 */

import type { UnifiedAiInvocationAttempt } from './unified-ai-invocation-ledger.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §2.1–2.3 漂移事件与关联影响共享契约类型
// ═══════════════════════════════════════════════════════════════════════════════

// ── 漂移事件 ──────────────────────────────────────────────────────────────

/** 漂移事件：某个 (连接, request_model) 的 response_model 首次出现新取值时产生。 */
export interface DriftEvent {
  /** 事件唯一标识。 */
  eventId: string
  /** 组织归属（组织隔离）。 */
  organizationId: number
  /** 连接 ID。 */
  connectionId: number
  /** 请求的模型标识（如 gpt-4）。 */
  requestModel: string
  /** 新出现的 response_model 取值。 */
  newResponseModel: string
  /** 先前的 response_model 取值（首次记录时为 null）。 */
  previousResponseModel: string | null
  /** 首次出现时间（ISO 8601）。 */
  firstOccurrenceAt: string
  /** 关联影响（换版前后差异）。 */
  correlatedImpact: DriftCorrelatedImpact
  /** 创建时间（ISO 8601）。 */
  createdAt: string
}

// ── 关联影响 ──────────────────────────────────────────────────────────────

/** 单维度差异：换版前后的统计值变化（只呈现差异，不做因果断言）。 */
export interface DriftDimensionDelta {
  /** 换版前窗口的均值（样本不足时为 null）。 */
  beforeMean: number | null
  /** 换版后窗口的均值（样本不足时为 null）。 */
  afterMean: number | null
  /** 差异（afterMean - beforeMean），任一为 null 时为 null。 */
  delta: number | null
  /** 换版前窗口的样本数。 */
  beforeSampleCount: number
  /** 换版后窗口的样本数。 */
  afterSampleCount: number
  /** 样本是否充足（低于最小样本阈值时为 false）。 */
  sufficientSamples: boolean
}

/** 关联影响：质量评分、成本、延迟在换版前后的变化。 */
export interface DriftCorrelatedImpact {
  /** 质量评分差异。 */
  quality: DriftDimensionDelta
  /** 成本差异（估算值）。 */
  cost: DriftDimensionDelta
  /** 延迟差异（总耗时 ms）。 */
  latency: DriftDimensionDelta
  /** 关联窗口配置（换版前后各 N 天）。 */
  windowDays: number
}

// ── 漂移检测结果 ──────────────────────────────────────────────────────────

/** 漂移检测结果：同一账本快照的确定性输出。 */
export interface DriftDetectionResult {
  /** 检测到的漂移事件列表。 */
  events: DriftEvent[]
  /** 按 (连接, request_model) 维度的 response_model 分布。 */
  distribution: DriftModelDistribution[]
  /** 缺失率统计。 */
  missingRates: DriftMissingRate[]
  /** 检测时间戳（确定性：同一快照同时间戳）。 */
  detectedAt: string
  /** 账本行总数（用于审计）。 */
  ledgerRowCount: number
}

// ── response_model 分布 ───────────────────────────────────────────────────

/** 单个 (连接, request_model) 维度的 response_model 分布。 */
export interface DriftModelDistribution {
  /** 连接 ID。 */
  connectionId: number
  /** 请求的模型标识。 */
  requestModel: string
  /** response_model 取值 → 出现次数。 */
  responseModelCounts: Record<string, number>
  /** 总记录数（含 response_model 为 null 的）。 */
  totalRecords: number
  /** response_model 缺失数（null 或 unknown）。 */
  missingCount: number
}

// ── 缺失率 ────────────────────────────────────────────────────────────────

/** response_model 缺失率统计（按连接与 provider 维度）。 */
export interface DriftMissingRate {
  /** 连接 ID。 */
  connectionId: number
  /** Provider 名称。 */
  providerName: string
  /** 总记录数。 */
  totalRecords: number
  /** response_model 缺失数（null 或 'unknown'）。 */
  missingCount: number
  /** 缺失率（0-1）。 */
  missingRate: number
  /** 是否可观测（缺失率 1 = 完全不可观测）。 */
  observable: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2.4 禁存约束类型
// ═══════════════════════════════════════════════════════════════════════════════

/** 漂移事件与统计中禁止出现的字段类别。 */
export const DRIFT_FORBIDDEN_FIELD_CATEGORIES = [
  'prompt',
  'model_output',
  'token',
  'secret',
] as const

export type DriftForbiddenFieldCategory = (typeof DRIFT_FORBIDDEN_FIELD_CATEGORIES)[number]

// ═══════════════════════════════════════════════════════════════════════════════
// §3.1–3.8 检测纯函数
// ═══════════════════════════════════════════════════════════════════════════════

/** response_model 缺失判定：null 或 'unknown' 均视为缺失。 */
function isResponseModelMissing(model: string | null | undefined): boolean {
  return model === null || model === undefined || model === '' || model === 'unknown'
}

/**
 * §3.1 按 (连接, request_model) 维度统计 response_model 分布。
 * 纯函数，确定性，不依赖时钟与随机源。
 */
export function computeDriftDistribution(
  attempts: UnifiedAiInvocationAttempt[],
): DriftModelDistribution[] {
  const map = new Map<
    string,
    {
      connectionId: number
      requestModel: string
      responseModelCounts: Map<string, number>
      totalRecords: number
      missingCount: number
    }
  >()

  for (const attempt of attempts) {
    const connId = attempt.aiproj_connection_id ?? 0
    const reqModel = attempt.request_model
    const key = `${connId}::${reqModel}`

    let bucket = map.get(key)
    if (!bucket) {
      bucket = {
        connectionId: connId,
        requestModel: reqModel,
        responseModelCounts: new Map(),
        totalRecords: 0,
        missingCount: 0,
      }
      map.set(key, bucket)
    }

    bucket.totalRecords++
    if (isResponseModelMissing(attempt.response_model)) {
      bucket.missingCount++
    } else {
      const respModel = attempt.response_model!
      bucket.responseModelCounts.set(
        respModel,
        (bucket.responseModelCounts.get(respModel) ?? 0) + 1,
      )
    }
  }

  const distributions: DriftModelDistribution[] = []
  for (const bucket of map.values()) {
    const responseModelCounts: Record<string, number> = {}
    for (const [k, v] of bucket.responseModelCounts) {
      responseModelCounts[k] = v
    }
    distributions.push({
      connectionId: bucket.connectionId,
      requestModel: bucket.requestModel,
      responseModelCounts,
      totalRecords: bucket.totalRecords,
      missingCount: bucket.missingCount,
    })
  }

  return distributions.sort((a, b) =>
    a.connectionId !== b.connectionId
      ? a.connectionId - b.connectionId
      : a.requestModel.localeCompare(b.requestModel),
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3.3 漂移事件生成（首次出现即事件，不设阈值）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 生成漂移事件：对账本快照做确定性检测。
 *
 * - 按 (连接, request_model) 分组
 * - 每个维度内，按时间排序后找首次出现的 response_model 新取值
 * - 新取值首次出现即产生事件，不设持续次数阈值（D6）
 * - 确定性：同一快照产出同一事件集合（D3.7）
 */
export function detectDriftEvents(
  attempts: UnifiedAiInvocationAttempt[],
  organizationId: number,
): DriftEvent[] {
  // 按 (connectionId, requestModel) 分组
  const groups = new Map<string, UnifiedAiInvocationAttempt[]>()
  for (const attempt of attempts) {
    if (attempt.aiproj_organization_id !== organizationId) continue
    const connId = attempt.aiproj_connection_id ?? 0
    const key = `${connId}::${attempt.request_model}`
    const list = groups.get(key) ?? []
    list.push(attempt)
    groups.set(key, list)
  }

  const events: DriftEvent[] = []

  for (const [key, groupAttempts] of groups) {
    const sep = key.indexOf('::')
    const connIdStr = key.substring(0, sep)
    const requestModel = key.substring(sep + 2)
    const connectionId = Number(connIdStr)

    // 按时间排序（确定性：同时间按 attempt_number 排）
    const sorted = [...groupAttempts].sort((a, b) => {
      const cmp = a.occurred_at.localeCompare(b.occurred_at)
      return cmp !== 0 ? cmp : a.aiproj_attempt_number - b.aiproj_attempt_number
    })

    // 跟踪已知的 response_model 取值
    const seenResponseModels = new Set<string>()
    let lastSeenResponseModel: string | null = null
    let baselineEstablished = false

    for (const attempt of sorted) {
      const respModel = attempt.response_model
      if (isResponseModelMissing(respModel)) {
        // 缺失不产生漂移事件
        continue
      }

      const respModelStr = respModel!

      if (!baselineEstablished) {
        // 第一个非缺失值建立基线，不产生事件
        baselineEstablished = true
        lastSeenResponseModel = respModelStr
        seenResponseModels.add(respModelStr)
        continue
      }

      if (!seenResponseModels.has(respModelStr)) {
        // 首次出现新取值（与基线/前值不同） → 产生事件
        seenResponseModels.add(respModelStr)

        events.push({
          eventId: `drift:${connectionId}:${requestModel}:${respModelStr}:${attempt.occurred_at}`,
          organizationId,
          connectionId,
          requestModel,
          newResponseModel: respModelStr,
          previousResponseModel: lastSeenResponseModel,
          firstOccurrenceAt: attempt.occurred_at,
          correlatedImpact: {
            quality: {
              beforeMean: null,
              afterMean: null,
              delta: null,
              beforeSampleCount: 0,
              afterSampleCount: 0,
              sufficientSamples: false,
            },
            cost: {
              beforeMean: null,
              afterMean: null,
              delta: null,
              beforeSampleCount: 0,
              afterSampleCount: 0,
              sufficientSamples: false,
            },
            latency: {
              beforeMean: null,
              afterMean: null,
              delta: null,
              beforeSampleCount: 0,
              afterSampleCount: 0,
              sufficientSamples: false,
            },
            windowDays: 7,
          },
          createdAt: attempt.occurred_at,
        })
      }

      lastSeenResponseModel = respModelStr
    }
  }

  // 确定性排序：connectionId → requestModel → newResponseModel → firstOccurrenceAt
  return events.sort((a, b) => {
    if (a.connectionId !== b.connectionId) return a.connectionId - b.connectionId
    const cmp = a.requestModel.localeCompare(b.requestModel)
    if (cmp !== 0) return cmp
    const cmp2 = a.newResponseModel.localeCompare(b.newResponseModel)
    return cmp2 !== 0 ? cmp2 : a.firstOccurrenceAt.localeCompare(b.firstOccurrenceAt)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4.1–4.7 关联影响计算
// ═══════════════════════════════════════════════════════════════════════════════

/** 最小样本阈值：窗口内低于此值不报告差异。 */
export const DRIFT_MIN_SAMPLE_THRESHOLD = 5

/** 默认关联窗口天数（换版前后各七天）。 */
export const DRIFT_DEFAULT_WINDOW_DAYS = 7

/** 因果性表述禁止模式。 */
export const DRIFT_CAUSATION_FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /导致/i,
  /引起/i,
  /造成/i,
  /因为.*所以/i,
  /由于.*导致/i,
  /因果/i,
  /caused?\s+by/i,
  /resulted?\s+in/i,
  /due\s+to/i,
  /because\s+of/i,
  /led\s+to/i,
]

/**
 * 检查文本是否包含因果断言。
 * §4.4/4.5：只呈现差异、不做因果断言。
 */
export function containsCausalAssertion(text: string): boolean {
  return DRIFT_CAUSATION_FORBIDDEN_PATTERNS.some((p) => p.test(text))
}

/**
 * 计算窗口内均值（纯函数）。
 */
function computeMean(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((a, b) => a + b, 0)
  return sum / values.length
}

/**
 * §4.1–4.3 为漂移事件关联换版前后的质量/成本/延迟差异。
 *
 * @param allAttempts 账本全部记录
 * @param event 目标漂移事件
 * @param windowDays 关联窗口天数（默认 7）
 */
export function correlateDriftImpact(
  allAttempts: UnifiedAiInvocationAttempt[],
  event: DriftEvent,
  windowDays: number = DRIFT_DEFAULT_WINDOW_DAYS,
): DriftCorrelatedImpact {
  const windowMs = windowDays * 24 * 60 * 60 * 1000
  const firstOccurrenceMs = new Date(event.firstOccurrenceAt).getTime()
  const beforeStart = new Date(firstOccurrenceMs - windowMs).toISOString()
  const beforeEnd = new Date(firstOccurrenceMs).toISOString()
  const afterStart = event.firstOccurrenceAt
  const afterEnd = new Date(firstOccurrenceMs + windowMs).toISOString()

  // 筛选同维度记录
  const dimensionAttempts = allAttempts.filter(
    (a) =>
      a.aiproj_organization_id === event.organizationId &&
      a.aiproj_connection_id === event.connectionId &&
      a.request_model === event.requestModel &&
      !isResponseModelMissing(a.response_model),
  )

  const beforeAttempts = dimensionAttempts.filter(
    (a) => a.occurred_at >= beforeStart && a.occurred_at < beforeEnd,
  )
  const afterAttempts = dimensionAttempts.filter(
    (a) => a.occurred_at >= afterStart && a.occurred_at <= afterEnd,
  )

  // §4.6 关联窗口可配置，默认七天
  const makeDelta = (
    extractValue: (a: UnifiedAiInvocationAttempt) => number | null,
  ): DriftDimensionDelta => {
    const beforeValues = beforeAttempts.map(extractValue).filter((v): v is number => v !== null)
    const afterValues = afterAttempts.map(extractValue).filter((v): v is number => v !== null)

    const beforeMean = computeMean(beforeValues)
    const afterMean = computeMean(afterValues)
    const delta = beforeMean !== null && afterMean !== null ? afterMean - beforeMean : null

    return {
      beforeMean,
      afterMean,
      delta,
      beforeSampleCount: beforeValues.length,
      afterSampleCount: afterValues.length,
      sufficientSamples:
        beforeValues.length >= DRIFT_MIN_SAMPLE_THRESHOLD &&
        afterValues.length >= DRIFT_MIN_SAMPLE_THRESHOLD,
    }
  }

  // §4.1 质量评分：从账本状态推导简化质量分（succeeded=1, degraded=0.5, failed=0）
  // 注意：真正的质量评分来自在线评测，这里用账本状态做简化关联
  const qualityDelta = makeDelta((a) => {
    if (a.status === 'succeeded') return 1
    if (a.status === 'degraded') return 0.5
    if (a.status === 'failed') return 0
    return null
  })

  // §4.2 成本差异
  const costDelta = makeDelta((a) => a.aiproj_estimated_cost)

  // §4.3 延迟差异（总耗时 ms）
  const latencyDelta = makeDelta((a) => a.duration_ms)

  return {
    quality: qualityDelta,
    cost: costDelta,
    latency: latencyDelta,
    windowDays,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5.1–5.3 缺失率统计
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * §5.1 按连接与 provider 统计 response_model 缺失率。
 * 缺失 = null / undefined / '' / 'unknown'。
 */
export function computeDriftMissingRates(
  attempts: UnifiedAiInvocationAttempt[],
): DriftMissingRate[] {
  const map = new Map<
    string,
    { connectionId: number; providerName: string; total: number; missing: number }
  >()

  for (const attempt of attempts) {
    const connId = attempt.aiproj_connection_id ?? 0
    const provider = attempt.provider_name
    const key = `${connId}::${provider}`

    let bucket = map.get(key)
    if (!bucket) {
      bucket = { connectionId: connId, providerName: provider, total: 0, missing: 0 }
      map.set(key, bucket)
    }

    bucket.total++
    if (isResponseModelMissing(attempt.response_model)) {
      bucket.missing++
    }
  }

  const rates: DriftMissingRate[] = []
  for (const bucket of map.values()) {
    rates.push({
      connectionId: bucket.connectionId,
      providerName: bucket.providerName,
      totalRecords: bucket.total,
      missingCount: bucket.missing,
      missingRate: bucket.total > 0 ? bucket.missing / bucket.total : 0,
      observable: bucket.missing < bucket.total,
    })
  }

  return rates.sort((a, b) =>
    a.connectionId !== b.connectionId
      ? a.connectionId - b.connectionId
      : a.providerName.localeCompare(b.providerName),
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6.1–6.4 不自动响应约束
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 漂移检测路径的依赖声明：只读账本，无模型选型或降级依赖。
 * §6.1–6.3：检测到漂移不自动切换模型、不自动降级、不自动告警。
 */
export const DRIFT_DETECTION_DEPENDENCIES: readonly string[] = [
  'unified_ai_invocation_ledger', // 只读账本
]

/**
 * 漂移路径写操作声明：除事件记录外零域写。
 * §6.4：漂移检测路径不修改任何正式项目数据。
 */
export const DRIFT_DETECTION_WRITES: readonly string[] = [
  'drift_events', // 仅写入漂移事件记录本身
]

// ═══════════════════════════════════════════════════════════════════════════════
// §7.1–7.5 组织隔离与权限
// ═══════════════════════════════════════════════════════════════════════════════

/** 漂移查询所需的权限。 */
export const DRIFT_QUERY_PERMISSIONS = ['ai_drift_observability:read'] as const

export type DriftQueryPermission = (typeof DRIFT_QUERY_PERMISSIONS)[number]

/**
 * §7.1 组织隔离校验：事件与统计必须附加 organization_id。
 */
export function assertOrganizationIsolation(
  event: DriftEvent,
  requestOrganizationId: number,
): boolean {
  return event.organizationId === requestOrganizationId
}

/**
 * §7.5 事件保留期声明（实现归 v3-observability-data-retention）。
 * 默认保留 90 天。
 */
export const DRIFT_EVENT_RETENTION_DAYS = 90

// ═══════════════════════════════════════════════════════════════════════════════
// §2.4 禁存约束校验
// ═══════════════════════════════════════════════════════════════════════════════

/** 敏感字段名模式（禁止出现在漂移事件与统计中）。 */
const DRIFT_SENSITIVE_PATTERNS: ReadonlyArray<{
  category: DriftForbiddenFieldCategory
  pattern: RegExp
}> = [
  { category: 'prompt', pattern: /prompt/i },
  { category: 'model_output', pattern: /(completion|output|response)[-_]?text/i },
  { category: 'token', pattern: /token/i },
  { category: 'secret', pattern: /(secret|password|apiKey|api_key|authorization)/i },
]

/**
 * 检查漂移事件字段中是否包含敏感信息。
 * §2.4/2.5：事件与统计不含 prompt、模型输出、token 与 secret。
 * 同时检查键名和字符串值。
 */
export function driftEventContainsSensitiveFields(
  event: Record<string, unknown>,
): DriftForbiddenFieldCategory[] {
  const found = new Set<DriftForbiddenFieldCategory>()
  const checkString = (str: string): void => {
    for (const { category, pattern } of DRIFT_SENSITIVE_PATTERNS) {
      if (pattern.test(str)) found.add(category)
    }
  }
  const walk = (value: unknown, keyPrefix: string): void => {
    if (value === null || value === undefined) return
    if (typeof value === 'string') {
      checkString(keyPrefix)
      checkString(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, keyPrefix)
      return
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const fullKey = keyPrefix ? `${keyPrefix}.${k}` : k
        checkString(fullKey)
        walk(v, fullKey)
      }
    }
  }
  walk(event, '')
  return [...found]
}

// ═══════════════════════════════════════════════════════════════════════════════
// 完整检测流程（组合 §3 + §4 + §5）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 执行完整漂移检测流程（§3 + §4 + §5 组合）。
 *
 * - 计算 response_model 分布（§3.1）
 * - 生成漂移事件（§3.3）
 * - 关联影响（§4.1–4.3）
 * - 缺失率（§5.1）
 * - 确定性：同一快照产出同一结果集合（§3.7）
 */
export function runDriftDetection(
  attempts: UnifiedAiInvocationAttempt[],
  organizationId: number,
  windowDays: number = DRIFT_DEFAULT_WINDOW_DAYS,
  now: Date = new Date(),
): DriftDetectionResult {
  const distribution = computeDriftDistribution(attempts)
  const events = detectDriftEvents(attempts, organizationId)

  // 为每个事件关联影响
  const enrichedEvents = events.map((event) => ({
    ...event,
    correlatedImpact: correlateDriftImpact(attempts, event, windowDays),
  }))

  const missingRates = computeDriftMissingRates(
    attempts.filter((a) => a.aiproj_organization_id === organizationId),
  )

  return {
    events: enrichedEvents,
    distribution,
    missingRates,
    detectedAt: now.toISOString(),
    ledgerRowCount: attempts.length,
  }
}
