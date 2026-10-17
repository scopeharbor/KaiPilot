/**
 * v3-plugin-runtime-health-diagnostics —— 插件运行时健康与诊断共享契约
 * （纯类型 + 常量 + 类型守卫 + 确定性 hash/序列化 + 低敏投影 + 聚合纯函数，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块。
 * 测试见 `plugin-runtime-health-diagnostics.test.ts`，fixtures 见
 * `plugin-runtime-health-diagnostics-fixtures.ts`。
 *
 * 语义要点（对应 specs/plugin-runtime-health-diagnostics/spec.md）
 * - D1 封闭状态与原因词表：healthy/degraded/unhealthy/unknown + crash/timeout/配额/权限/兼容/隔离/circuit/stale/unknown
 * - D2 宿主执行边界产生事件 + 恢复/熔断：连续失败 open，half-open 探测，成功恢复保留计数
 * - D3 插件失败隔离且不绕过权限：fallback 仅省略贡献或受控降级
 * - D4 诊断读取组织隔离且低敏：分页快照+有界事件摘要，不返回 stack/raw payload/secret/跨租标识
 *
 * 红线：不持久化 stack、原始参数/结果、secret、跨租标识、自由文本状态；未知原因归 unknown。
 */

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** 健康状态（封闭集，每组织/installation/contribution 一份快照） */
export const PLUGIN_RUNTIME_HEALTH_STATUSES = [
  'healthy',
  'degraded',
  'unhealthy',
  'unknown',
] as const
export type PluginRuntimeHealthStatus = (typeof PLUGIN_RUNTIME_HEALTH_STATUSES)[number]

/** 诊断原因（封闭词表，覆盖 spec 要求） */
export const PLUGIN_RUNTIME_HEALTH_REASON_CODES = [
  'crash',
  'timeout',
  'cpu_quota',
  'memory_quota',
  'call_quota',
  'permission_denied',
  'incompatible',
  'isolation_failed',
  'circuit_open',
  'stale',
  'unknown',
  'tool_error',
  'host_degraded',
  'rate_limited',
] as const
export type PluginRuntimeHealthReasonCode = (typeof PLUGIN_RUNTIME_HEALTH_REASON_CODES)[number]

/** 执行结果（宿主 wrapper 记录的有界 outcome） */
export const PLUGIN_RUNTIME_HEALTH_OUTCOMES = [
  'success',
  'crash',
  'timeout',
  'quota_exceeded',
  'permission_denied',
  'incompatible',
  'isolation_failed',
  'host_degraded',
  'unknown',
] as const
export type PluginRuntimeHealthOutcome = (typeof PLUGIN_RUNTIME_HEALTH_OUTCOMES)[number]

/** 配额种类 */
export const PLUGIN_RUNTIME_HEALTH_QUOTA_KINDS = ['cpu', 'memory', 'call', 'none'] as const
export type PluginRuntimeHealthQuotaKind = (typeof PLUGIN_RUNTIME_HEALTH_QUOTA_KINDS)[number]

/** 熔断状态 */
export const PLUGIN_RUNTIME_HEALTH_CIRCUIT_STATES = ['closed', 'open', 'half_open'] as const
export type PluginRuntimeHealthCircuitState = (typeof PLUGIN_RUNTIME_HEALTH_CIRCUIT_STATES)[number]

/** 延迟桶（桶化，避免精确 timing 泄露） */
export const PLUGIN_RUNTIME_HEALTH_DURATION_BUCKETS = [
  'lt_100ms',
  '100_500ms',
  '500_1000ms',
  '1_5s',
  'gt_5s',
] as const
export type PluginRuntimeHealthDurationBucket =
  (typeof PLUGIN_RUNTIME_HEALTH_DURATION_BUCKETS)[number]

/** 警告码（低敏） */
export const PLUGIN_RUNTIME_HEALTH_WARNING_CODES = [
  'HEALTH_STALE',
  'HEALTH_DEGRADED',
  'HEALTH_UNHEALTHY',
  'CIRCUIT_OPEN',
  'CIRCUIT_HALF_OPEN',
  'QUOTA_NEAR_LIMIT',
  'QUOTA_EXCEEDED',
  'RECOVERY_OBSERVED',
  'UNKNOWN_REASON_NORMALIZED',
] as const
export type PluginRuntimeHealthWarningCode = (typeof PLUGIN_RUNTIME_HEALTH_WARNING_CODES)[number]

/** 审计动作 */
export const PLUGIN_RUNTIME_HEALTH_AUDIT_ACTIONS = [
  'health.snapshot.queried',
  'health.events.queried',
  'health.probe.triggered',
  'health.recovery.observed',
] as const
export type PluginRuntimeHealthAuditAction = (typeof PLUGIN_RUNTIME_HEALTH_AUDIT_ACTIONS)[number]

/** 权限动作（用于 Policy） */
export const PLUGIN_RUNTIME_HEALTH_PERMISSION_ACTIONS = [
  'viewHealth',
  'viewHealthEvents',
  'triggerProbe',
] as const
export type PluginRuntimeHealthPermissionAction =
  (typeof PLUGIN_RUNTIME_HEALTH_PERMISSION_ACTIONS)[number]

/** Schema 版本 */
export const PLUGIN_RUNTIME_HEALTH_SCHEMA_VERSION = '1' as const
export type PluginRuntimeHealthSchemaVersion = typeof PLUGIN_RUNTIME_HEALTH_SCHEMA_VERSION

/** 熔断/恢复阈值常量 */
export const PLUGIN_RUNTIME_HEALTH_CIRCUIT_OPEN_THRESHOLD = 5
export const PLUGIN_RUNTIME_HEALTH_CIRCUIT_HALF_OPEN_TIMEOUT_MS = 60_000
export const PLUGIN_RUNTIME_HEALTH_STALE_MS = 5 * 60 * 1000 // 5 分钟视为 stale
export const PLUGIN_RUNTIME_HEALTH_EVENT_RETENTION_LIMIT = 1000
export const PLUGIN_RUNTIME_HEALTH_EVENT_WINDOW_DAYS = 7

/** 低敏字段黑名单（事件投影不得包含） */
export const PLUGIN_RUNTIME_HEALTH_SENSITIVE_KEYS = [
  /stack/i,
  /secret/i,
  /token/i,
  /password/i,
  /authorization/i,
  /payload/i,
  /raw/i,
  /body/i,
  /privatekey/i,
] as const

// =============================================================================
// 2. DTO / 持久化类型
// =============================================================================

/** 健康事件（append-only，有界低敏信号） */
export interface PluginRuntimeHealthEvent {
  id: number | string
  organizationId: number
  installationId: number
  pluginId: string
  pluginVersion?: string | null
  contributionKey?: string | null
  seamKey?: string | null
  outcome: PluginRuntimeHealthOutcome
  reasonCode: PluginRuntimeHealthReasonCode
  quotaKind: PluginRuntimeHealthQuotaKind
  durationBucket: PluginRuntimeHealthDurationBucket
  latencyMs?: number | null
  circuitState: PluginRuntimeHealthCircuitState
  invocationId: string
  occurredAt: string // ISO
  rowVersion?: number
}

/** 健康快照（当前态，按组织/installation/contribution 聚合） */
export interface PluginRuntimeHealthSnapshot {
  id: number | string
  organizationId: number
  installationId: number
  pluginId: string
  contributionKey?: string | null
  status: PluginRuntimeHealthStatus
  reasonCode: PluginRuntimeHealthReasonCode
  circuitState: PluginRuntimeHealthCircuitState
  firstSeenAt: string
  lastSeenAt: string
  lastSuccessAt?: string | null
  lastFailureAt?: string | null
  recoveredAt?: string | null
  totalSuccess: number
  totalCrash: number
  totalTimeout: number
  totalQuota: number
  totalPermissionDenied: number
  totalIncompatible: number
  totalIsolationFailed: number
  consecutiveFailures: number
  isStale: boolean
  warningCodes: PluginRuntimeHealthWarningCode[]
  rowVersion: number
  updatedAt: string
}

/** 只读诊断摘要（分页快照列表项，脱敏） */
export interface PluginRuntimeHealthSnapshotListItem {
  installationId: number
  pluginId: string
  contributionKey?: string | null
  status: PluginRuntimeHealthStatus
  reasonCode: PluginRuntimeHealthReasonCode
  circuitState: PluginRuntimeHealthCircuitState
  lastSeenAt: string
  lastSuccessAt?: string | null
  consecutiveFailures: number
  isStale: boolean
  warningCodes: PluginRuntimeHealthWarningCode[]
}

/** 有界事件摘要（脱敏，不含 stack/raw） */
export interface PluginRuntimeHealthEventSummary {
  id: number | string
  installationId: number
  pluginId: string
  contributionKey?: string | null
  outcome: PluginRuntimeHealthOutcome
  reasonCode: PluginRuntimeHealthReasonCode
  durationBucket: PluginRuntimeHealthDurationBucket
  circuitState: PluginRuntimeHealthCircuitState
  occurredAt: string
}

/** 查询 filter（组织隔离由 service 强制注入 orgId） */
export interface PluginRuntimeHealthQueryFilter {
  pluginId?: string | null
  contributionKey?: string | null
  status?: PluginRuntimeHealthStatus | null
  reasonCode?: PluginRuntimeHealthReasonCode | null
  circuitState?: PluginRuntimeHealthCircuitState | null
  isStale?: boolean | null
  page?: number
  perPage?: number
  sort?: string | null
}

/** 摘要聚合指标 */
export interface PluginRuntimeHealthAggregate {
  totalSnapshots: number
  healthy: number
  degraded: number
  unhealthy: number
  unknown: number
  stale: number
  circuitOpen: number
  circuitHalfOpen: number
}

/** 低敏诊断详情（含警告与恢复信息，无 payload/stack） */
export interface PluginRuntimeHealthDiagnosisDetail {
  snapshot: PluginRuntimeHealthSnapshotListItem
  recentEvents: PluginRuntimeHealthEventSummary[]
  aggregate: PluginRuntimeHealthAggregate
  warnings: PluginRuntimeHealthWarningCode[]
  stale: boolean
  canProbe: boolean
}

/** 熔断探针输入 */
export interface PluginRuntimeHealthProbeInput {
  organizationId: number
  installationId: number
  contributionKey?: string | null
}

/** 熔断探针结果 */
export interface PluginRuntimeHealthProbeResult {
  probed: boolean
  previousCircuit: PluginRuntimeHealthCircuitState
  currentCircuit: PluginRuntimeHealthCircuitState
  status: PluginRuntimeHealthStatus
  reasonCode: PluginRuntimeHealthReasonCode
  message: string
}

// =============================================================================
// 3. 类型守卫
// =============================================================================

export function isPluginRuntimeHealthStatus(v: unknown): v is PluginRuntimeHealthStatus {
  return typeof v === 'string' && (PLUGIN_RUNTIME_HEALTH_STATUSES as readonly string[]).includes(v)
}

export function isPluginRuntimeHealthReasonCode(v: unknown): v is PluginRuntimeHealthReasonCode {
  return (
    typeof v === 'string' && (PLUGIN_RUNTIME_HEALTH_REASON_CODES as readonly string[]).includes(v)
  )
}

export function isPluginRuntimeHealthOutcome(v: unknown): v is PluginRuntimeHealthOutcome {
  return typeof v === 'string' && (PLUGIN_RUNTIME_HEALTH_OUTCOMES as readonly string[]).includes(v)
}

export function isPluginRuntimeHealthQuotaKind(v: unknown): v is PluginRuntimeHealthQuotaKind {
  return (
    typeof v === 'string' && (PLUGIN_RUNTIME_HEALTH_QUOTA_KINDS as readonly string[]).includes(v)
  )
}

export function isPluginRuntimeHealthCircuitState(
  v: unknown,
): v is PluginRuntimeHealthCircuitState {
  return (
    typeof v === 'string' && (PLUGIN_RUNTIME_HEALTH_CIRCUIT_STATES as readonly string[]).includes(v)
  )
}

export function isPluginRuntimeHealthDurationBucket(
  v: unknown,
): v is PluginRuntimeHealthDurationBucket {
  return (
    typeof v === 'string' &&
    (PLUGIN_RUNTIME_HEALTH_DURATION_BUCKETS as readonly string[]).includes(v)
  )
}

export function isPluginRuntimeHealthWarningCode(v: unknown): v is PluginRuntimeHealthWarningCode {
  return (
    typeof v === 'string' && (PLUGIN_RUNTIME_HEALTH_WARNING_CODES as readonly string[]).includes(v)
  )
}

// =============================================================================
// 4. 纯函数：封闭映射与归一化
// =============================================================================

/**
 * 未登记原因归一化为 unknown/tool_error（不持久化自由文本）
 */
export function normalizeHealthReasonCode(
  raw: string | null | undefined,
): PluginRuntimeHealthReasonCode {
  if (!raw || typeof raw !== 'string') return 'unknown'
  const lower = raw.toLowerCase().trim()
  if ((PLUGIN_RUNTIME_HEALTH_REASON_CODES as readonly string[]).includes(lower)) {
    return lower as PluginRuntimeHealthReasonCode
  }
  // 模糊归一化：兼容旧 reason
  if (lower.includes('crash') || lower.includes('exception') || lower.includes('error'))
    return 'crash'
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout'
  if (lower.includes('cpu')) return 'cpu_quota'
  if (lower.includes('memory') || lower.includes('mem')) return 'memory_quota'
  if (lower.includes('quota') || lower.includes('limit')) return 'call_quota'
  if (lower.includes('permission') || lower.includes('denied')) return 'permission_denied'
  if (lower.includes('incompat')) return 'incompatible'
  if (lower.includes('isolation')) return 'isolation_failed'
  if (lower.includes('circuit')) return 'circuit_open'
  if (lower.includes('stale')) return 'stale'
  return 'unknown'
}

/**
 * outcome → reasonCode 映射（封闭）
 */
export function mapOutcomeToReasonCode(
  outcome: PluginRuntimeHealthOutcome,
  quotaKind: PluginRuntimeHealthQuotaKind = 'none',
): PluginRuntimeHealthReasonCode {
  switch (outcome) {
    case 'crash':
      return 'crash'
    case 'timeout':
      return 'timeout'
    case 'quota_exceeded':
      if (quotaKind === 'cpu') return 'cpu_quota'
      if (quotaKind === 'memory') return 'memory_quota'
      return 'call_quota'
    case 'permission_denied':
      return 'permission_denied'
    case 'incompatible':
      return 'incompatible'
    case 'isolation_failed':
      return 'isolation_failed'
    case 'host_degraded':
      return 'host_degraded'
    case 'success':
      return 'unknown'
    default:
      return 'unknown'
  }
}

/**
 * 延迟桶化（避免精确 timing 泄露）
 */
export function bucketDuration(
  latencyMs: number | null | undefined,
): PluginRuntimeHealthDurationBucket {
  if (latencyMs == null || latencyMs < 0) return 'lt_100ms'
  if (latencyMs < 100) return 'lt_100ms'
  if (latencyMs < 500) return '100_500ms'
  if (latencyMs < 1000) return '500_1000ms'
  if (latencyMs < 5000) return '1_5s'
  return 'gt_5s'
}

/**
 * 检查快照是否 stale（超过阈值未更新）
 */
export function isStaleSnapshot(
  lastSeenAt: string,
  nowIso?: string,
  thresholdMs: number = PLUGIN_RUNTIME_HEALTH_STALE_MS,
): boolean {
  const last = new Date(lastSeenAt).getTime()
  const now = nowIso ? new Date(nowIso).getTime() : Date.now()
  if (Number.isNaN(last) || Number.isNaN(now)) return true
  return now - last > thresholdMs
}

/**
 * 计算健康状态（纯函数，封闭状态机）
 * - 连续失败 >= 阈值 → unhealthy
 * - 有失败但未达阈值 → degraded
 * - 仅成功 → healthy
 * - 无数据或 reason unknown 且无成功 → unknown
 */
export function computeHealthStatus(input: {
  totalSuccess: number
  totalCrash: number
  totalTimeout: number
  totalQuota: number
  consecutiveFailures: number
  lastFailureAt?: string | null
  lastSuccessAt?: string | null
  circuitState: PluginRuntimeHealthCircuitState
}): PluginRuntimeHealthStatus {
  if (input.circuitState === 'open') return 'unhealthy'
  if (input.consecutiveFailures >= PLUGIN_RUNTIME_HEALTH_CIRCUIT_OPEN_THRESHOLD) return 'unhealthy'
  if (input.consecutiveFailures > 0) return 'degraded'
  if (input.totalSuccess > 0 && input.consecutiveFailures === 0) return 'healthy'
  if (
    input.totalCrash === 0 &&
    input.totalTimeout === 0 &&
    input.totalQuota === 0 &&
    input.totalSuccess === 0
  )
    return 'unknown'
  return 'degraded'
}

/**
 * 计算熔断状态转换（保守 circuit）
 */
export function computeCircuitState(input: {
  previous: PluginRuntimeHealthCircuitState
  consecutiveFailures: number
  lastSeenAt: string
  nowIso?: string
  halfOpenTimeoutMs?: number
}): PluginRuntimeHealthCircuitState {
  const now = input.nowIso ? new Date(input.nowIso).getTime() : Date.now()
  const last = new Date(input.lastSeenAt).getTime()
  const elapsed = Number.isNaN(now) || Number.isNaN(last) ? 0 : now - last
  const halfOpenTimeout =
    input.halfOpenTimeoutMs ?? PLUGIN_RUNTIME_HEALTH_CIRCUIT_HALF_OPEN_TIMEOUT_MS

  if (input.previous === 'open') {
    if (elapsed >= halfOpenTimeout) return 'half_open'
    return 'open'
  }
  if (input.previous === 'half_open') {
    // half_open 需外部探针结果决定，此处保持 half_open
    return 'half_open'
  }
  // closed
  if (input.consecutiveFailures >= PLUGIN_RUNTIME_HEALTH_CIRCUIT_OPEN_THRESHOLD) return 'open'
  return 'closed'
}

/**
 * 事件 → 快照聚合（幂等：invocationId 已去重前置）
 */
export function aggregateHealthSnapshot(
  previous: PluginRuntimeHealthSnapshot | null,
  event: PluginRuntimeHealthEvent,
  nowIso?: string,
): PluginRuntimeHealthSnapshot {
  const now = nowIso ?? new Date().toISOString()
  const prev = previous
    ? previous
    : {
        id: `snap:${event.organizationId}:${event.installationId}:${event.contributionKey ?? 'na'}` as
          string | number,
        organizationId: event.organizationId,
        installationId: event.installationId,
        pluginId: event.pluginId,
        contributionKey: event.contributionKey ?? null,
        status: 'unknown' as PluginRuntimeHealthStatus,
        reasonCode: 'unknown' as PluginRuntimeHealthReasonCode,
        circuitState: 'closed' as PluginRuntimeHealthCircuitState,
        firstSeenAt: event.occurredAt,
        lastSeenAt: event.occurredAt,
        lastSuccessAt: null as string | null,
        lastFailureAt: null as string | null,
        recoveredAt: null as string | null,
        totalSuccess: 0,
        totalCrash: 0,
        totalTimeout: 0,
        totalQuota: 0,
        totalPermissionDenied: 0,
        totalIncompatible: 0,
        totalIsolationFailed: 0,
        consecutiveFailures: 0,
        isStale: false,
        warningCodes: [] as PluginRuntimeHealthWarningCode[],
        rowVersion: 0,
        updatedAt: now,
      }

  let totalSuccess = prev.totalSuccess
  let totalCrash = prev.totalCrash
  let totalTimeout = prev.totalTimeout
  let totalQuota = prev.totalQuota
  let totalPermissionDenied = prev.totalPermissionDenied
  let totalIncompatible = prev.totalIncompatible
  let totalIsolationFailed = prev.totalIsolationFailed
  let consecutiveFailures = prev.consecutiveFailures
  let lastSuccessAt = prev.lastSuccessAt
  let lastFailureAt = prev.lastFailureAt
  let recoveredAt = prev.recoveredAt

  const reasonCode = normalizeHealthReasonCode(event.reasonCode)

  switch (event.outcome) {
    case 'success': {
      totalSuccess += 1
      consecutiveFailures = 0
      lastSuccessAt = event.occurredAt
      if (prev.status === 'unhealthy' || prev.status === 'degraded') {
        recoveredAt = event.occurredAt
      }
      break
    }
    case 'crash': {
      totalCrash += 1
      consecutiveFailures += 1
      lastFailureAt = event.occurredAt
      break
    }
    case 'timeout': {
      totalTimeout += 1
      consecutiveFailures += 1
      lastFailureAt = event.occurredAt
      break
    }
    case 'quota_exceeded': {
      totalQuota += 1
      consecutiveFailures += 1
      lastFailureAt = event.occurredAt
      break
    }
    case 'permission_denied': {
      totalPermissionDenied += 1
      // permission_denied 不计入熔断，只记计数
      lastFailureAt = event.occurredAt
      break
    }
    case 'incompatible': {
      totalIncompatible += 1
      lastFailureAt = event.occurredAt
      break
    }
    case 'isolation_failed': {
      totalIsolationFailed += 1
      consecutiveFailures += 1
      lastFailureAt = event.occurredAt
      break
    }
    case 'host_degraded':
    case 'unknown': {
      consecutiveFailures += 1
      lastFailureAt = event.occurredAt
      break
    }
  }

  // circuit 仅对 crash/timeout/quota/isolation 敏感，permission/incompatible 不 open
  const nextCircuit = computeCircuitState({
    previous: prev.circuitState,
    consecutiveFailures,
    lastSeenAt: event.occurredAt,
    nowIso: now,
  })

  // 如果是 permission/incompatible，且当前 circuit 为 open/half_open，保持原 circuit 但不自动 open
  let finalCircuit = nextCircuit
  if (
    (event.outcome === 'permission_denied' || event.outcome === 'incompatible') &&
    prev.circuitState !== 'closed' &&
    nextCircuit === 'closed'
  ) {
    finalCircuit = prev.circuitState
  }

  const status = computeHealthStatus({
    totalSuccess,
    totalCrash,
    totalTimeout,
    totalQuota,
    consecutiveFailures,
    lastFailureAt,
    lastSuccessAt,
    circuitState: finalCircuit,
  })

  const isStaleFlag = isStaleSnapshot(event.occurredAt, now)
  const warningCodes: PluginRuntimeHealthWarningCode[] = []
  if (isStaleFlag) warningCodes.push('HEALTH_STALE')
  if (status === 'degraded') warningCodes.push('HEALTH_DEGRADED')
  if (status === 'unhealthy') warningCodes.push('HEALTH_UNHEALTHY')
  if (finalCircuit === 'open') warningCodes.push('CIRCUIT_OPEN')
  if (finalCircuit === 'half_open') warningCodes.push('CIRCUIT_HALF_OPEN')
  if (recoveredAt) warningCodes.push('RECOVERY_OBSERVED')
  if (reasonCode === 'unknown') warningCodes.push('UNKNOWN_REASON_NORMALIZED')

  const statusReason: PluginRuntimeHealthReasonCode =
    event.outcome === 'success' ? (recoveredAt ? prev.reasonCode : 'unknown') : reasonCode

  // stale 覆盖 reason
  const finalReason: PluginRuntimeHealthReasonCode = isStaleFlag ? 'stale' : statusReason

  return {
    id: prev.id,
    organizationId: event.organizationId,
    installationId: event.installationId,
    pluginId: event.pluginId,
    contributionKey: event.contributionKey ?? null,
    status,
    reasonCode: finalReason,
    circuitState: finalCircuit,
    firstSeenAt: prev.firstSeenAt,
    lastSeenAt: event.occurredAt,
    lastSuccessAt,
    lastFailureAt,
    recoveredAt,
    totalSuccess,
    totalCrash,
    totalTimeout,
    totalQuota,
    totalPermissionDenied,
    totalIncompatible,
    totalIsolationFailed,
    consecutiveFailures,
    isStale: isStaleFlag,
    warningCodes,
    rowVersion: (prev.rowVersion ?? 0) + 1,
    updatedAt: now,
  }
}

// =============================================================================
// 5. 纯函数：Digest / Redaction / Pagination Helpers
// =============================================================================

/** FNV-1a 32-bit */
export function healthFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function healthStableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => healthStableSerialize(v)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + healthStableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

export function healthDomainSeparatedHash(domain: string, input: string): string {
  return healthFnv1aHash(`${domain}:${input}`)
}

/** 计算调用幂等 key（基于 org/installation/invocationId） */
export function computeHealthInvocationKey(input: {
  organizationId: number
  installationId: number
  invocationId: string
}): string {
  return healthDomainSeparatedHash(
    'health-invocation',
    healthStableSerialize({
      org: input.organizationId,
      inst: input.installationId,
      inv: input.invocationId,
    }),
  )
}

/** 计算快照摘要 hash（用于 optimistic concurrency / 预览比对） */
export function computeHealthSnapshotDigest(snapshot: PluginRuntimeHealthSnapshot): string {
  return healthDomainSeparatedHash(
    'health-snapshot',
    healthStableSerialize({
      status: snapshot.status,
      reason: snapshot.reasonCode,
      circuit: snapshot.circuitState,
      succ: snapshot.totalSuccess,
      crash: snapshot.totalCrash,
      tout: snapshot.totalTimeout,
      quota: snapshot.totalQuota,
      consec: snapshot.consecutiveFailures,
      lastSeen: snapshot.lastSeenAt,
      rv: snapshot.rowVersion,
    }),
  )
}

/** 脱敏：过滤敏感 keys，不返回 raw payload/stack */
export function redactHealthMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (PLUGIN_RUNTIME_HEALTH_SENSITIVE_KEYS.some((p) => p.test(key))) continue
    safe[key] = value
  }
  return safe
}

/** 将事件投影为低敏摘要（去除 latencyMs 精度以外的敏感上下文） */
export function toHealthEventSummary(
  event: PluginRuntimeHealthEvent,
): PluginRuntimeHealthEventSummary {
  return {
    id: event.id,
    installationId: event.installationId,
    pluginId: event.pluginId,
    contributionKey: event.contributionKey ?? null,
    outcome: event.outcome,
    reasonCode: normalizeHealthReasonCode(event.reasonCode),
    durationBucket: event.durationBucket,
    circuitState: event.circuitState,
    occurredAt: event.occurredAt,
  }
}

/** 将快照投影为低敏列表项 */
export function toHealthSnapshotListItem(
  snapshot: PluginRuntimeHealthSnapshot,
): PluginRuntimeHealthSnapshotListItem {
  return {
    installationId: snapshot.installationId,
    pluginId: snapshot.pluginId,
    contributionKey: snapshot.contributionKey ?? null,
    status: snapshot.status,
    reasonCode: snapshot.reasonCode,
    circuitState: snapshot.circuitState,
    lastSeenAt: snapshot.lastSeenAt,
    lastSuccessAt: snapshot.lastSuccessAt ?? null,
    consecutiveFailures: snapshot.consecutiveFailures,
    isStale: snapshot.isStale,
    warningCodes: [...snapshot.warningCodes],
  }
}

/**
 * 批量聚合摘要（用于 organization 级 dash）
 */
export function aggregateHealthSummaries(
  snapshots: PluginRuntimeHealthSnapshot[],
): PluginRuntimeHealthAggregate {
  let healthy = 0
  let degraded = 0
  let unhealthy = 0
  let unknown = 0
  let stale = 0
  let circuitOpen = 0
  let circuitHalfOpen = 0
  for (const s of snapshots) {
    switch (s.status) {
      case 'healthy':
        healthy++
        break
      case 'degraded':
        degraded++
        break
      case 'unhealthy':
        unhealthy++
        break
      case 'unknown':
        unknown++
        break
    }
    if (s.isStale) stale++
    if (s.circuitState === 'open') circuitOpen++
    if (s.circuitState === 'half_open') circuitHalfOpen++
  }
  return {
    totalSnapshots: snapshots.length,
    healthy,
    degraded,
    unhealthy,
    unknown,
    stale,
    circuitOpen,
    circuitHalfOpen,
  }
}

/** 排序快照（默认按 lastSeenAt 倒序） */
export function sortHealthSnapshots(
  snapshots: PluginRuntimeHealthSnapshot[],
  sort: string | null | undefined = '-lastSeenAt',
): PluginRuntimeHealthSnapshot[] {
  const copy = [...snapshots]
  const field = (sort ?? '-lastSeenAt').replace(/^[+-]/, '')
  const dir = (sort ?? '-lastSeenAt').startsWith('-') ? -1 : 1
  copy.sort((a, b) => {
    let va: string | number = ''
    let vb: string | number = ''
    switch (field) {
      case 'lastSeenAt':
        va = a.lastSeenAt
        vb = b.lastSeenAt
        break
      case 'pluginId':
        va = a.pluginId
        vb = b.pluginId
        break
      case 'status':
        va = a.status
        vb = b.status
        break
      default:
        va = a.lastSeenAt
        vb = b.lastSeenAt
    }
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })
  return copy
}

/** 分页辅助 */
export function paginateHealthSnapshots(
  snapshots: PluginRuntimeHealthSnapshot[],
  page: number = 1,
  perPage: number = 20,
): {
  data: PluginRuntimeHealthSnapshotListItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
} {
  const total = snapshots.length
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const start = (page - 1) * perPage
  const slice = snapshots.slice(start, start + perPage)
  return {
    data: slice.map(toHealthSnapshotListItem),
    meta: { total, page, perPage, totalPages },
  }
}

/**
 * 验证快照查询参数（归一化 + 非法过滤）
 */
export function validateHealthQueryFilter(raw: unknown): {
  valid: boolean
  filter: PluginRuntimeHealthQueryFilter
  errors: string[]
} {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      filter: {},
      errors: ['filter must be an object'],
    }
  }
  const obj = raw as Record<string, unknown>
  const filter: PluginRuntimeHealthQueryFilter = {}

  if (obj.pluginId != null) {
    if (typeof obj.pluginId !== 'string') errors.push('pluginId must be string')
    else filter.pluginId = obj.pluginId
  }
  if (obj.contributionKey != null) {
    if (typeof obj.contributionKey !== 'string') errors.push('contributionKey must be string')
    else filter.contributionKey = obj.contributionKey
  }
  if (obj.status != null) {
    if (!isPluginRuntimeHealthStatus(obj.status)) errors.push(`invalid status: ${obj.status}`)
    else filter.status = obj.status as PluginRuntimeHealthStatus
  }
  if (obj.reasonCode != null) {
    if (!isPluginRuntimeHealthReasonCode(obj.reasonCode))
      errors.push(`invalid reasonCode: ${obj.reasonCode}`)
    else filter.reasonCode = obj.reasonCode as PluginRuntimeHealthReasonCode
  }
  if (obj.circuitState != null) {
    if (!isPluginRuntimeHealthCircuitState(obj.circuitState))
      errors.push(`invalid circuitState: ${obj.circuitState}`)
    else filter.circuitState = obj.circuitState as PluginRuntimeHealthCircuitState
  }
  if (obj.isStale != null) {
    if (typeof obj.isStale !== 'boolean') errors.push('isStale must be boolean')
    else filter.isStale = obj.isStale as boolean
  }
  if (obj.page != null) {
    const p = Number(obj.page)
    if (!Number.isInteger(p) || p < 1) errors.push('page must be >=1')
    else filter.page = p
  }
  if (obj.perPage != null) {
    const pp = Number(obj.perPage)
    if (!Number.isInteger(pp) || pp < 1 || pp > 100) errors.push('perPage must be 1..100')
    else filter.perPage = pp
  }
  if (obj.sort != null) {
    if (typeof obj.sort !== 'string') errors.push('sort must be string')
    else filter.sort = obj.sort
  }
  return { valid: errors.length === 0, filter, errors }
}

/**
 * 探针决策：是否允许 half_open 探测（仅宿主可触发）
 */
export function canProbeCircuit(snapshot: PluginRuntimeHealthSnapshot, nowIso?: string): boolean {
  if (snapshot.circuitState !== 'half_open') return false
  // half_open 允许一次探测
  void nowIso
  return true
}

/**
 * 应用探针结果到快照（成功恢复，失败重 open）
 */
export function applyProbeResult(
  snapshot: PluginRuntimeHealthSnapshot,
  outcome: PluginRuntimeHealthOutcome,
  nowIso?: string,
): PluginRuntimeHealthSnapshot {
  const now = nowIso ?? new Date().toISOString()
  if (snapshot.circuitState !== 'half_open') return snapshot
  if (outcome === 'success') {
    // 恢复：closed，保留计数但 consecutive 清零
    return {
      ...snapshot,
      status: 'healthy',
      reasonCode: 'unknown',
      circuitState: 'closed',
      lastSuccessAt: now,
      lastSeenAt: now,
      recoveredAt: now,
      consecutiveFailures: 0,
      isStale: false,
      warningCodes: ['RECOVERY_OBSERVED'],
      rowVersion: snapshot.rowVersion + 1,
      updatedAt: now,
    }
  }
  // 探测失败 → 重回 open
  const reason = mapOutcomeToReasonCode(outcome, 'none')
  return {
    ...snapshot,
    status: 'unhealthy',
    reasonCode: reason,
    circuitState: 'open',
    lastFailureAt: now,
    lastSeenAt: now,
    consecutiveFailures: snapshot.consecutiveFailures + 1,
    isStale: false,
    warningCodes: ['CIRCUIT_OPEN'],
    rowVersion: snapshot.rowVersion + 1,
    updatedAt: now,
  }
}

// =============================================================================
// 6. 辅助：低敏审计 payload
// =============================================================================

export interface PluginRuntimeHealthAuditPayload {
  organizationId: number
  installationId?: number | null
  pluginId?: string | null
  contributionKey?: string | null
  action: PluginRuntimeHealthAuditAction
  status?: PluginRuntimeHealthStatus | null
  reasonCode?: PluginRuntimeHealthReasonCode | null
  circuitState?: PluginRuntimeHealthCircuitState | null
  actorRef?: string | null
  occurredAt: string
}

export function buildHealthAuditPayload(input: {
  organizationId: number
  installationId?: number | null
  pluginId?: string | null
  contributionKey?: string | null
  action: PluginRuntimeHealthAuditAction
  status?: PluginRuntimeHealthStatus | null
  reasonCode?: PluginRuntimeHealthReasonCode | null
  circuitState?: PluginRuntimeHealthCircuitState | null
  actorRef?: string | null
}): PluginRuntimeHealthAuditPayload {
  return {
    organizationId: input.organizationId,
    installationId: input.installationId ?? null,
    pluginId: input.pluginId ?? null,
    contributionKey: input.contributionKey ?? null,
    action: input.action,
    status: input.status ?? null,
    reasonCode: input.reasonCode ?? null,
    circuitState: input.circuitState ?? null,
    actorRef: input.actorRef ?? null,
    occurredAt: new Date().toISOString(),
  }
}
