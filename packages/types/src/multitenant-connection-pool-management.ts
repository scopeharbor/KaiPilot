// @aiproj/types — V3 多租户连接池管理共享契约（v3-multitenant-connection-pool-management）。
//
// 纯函数 + 类型，零运行时外部依赖，前后端共享。
//
// 本模块定义连接资源治理的统一契约：连接资源 catalog entry、租户连接 budget、
// lease lifecycle、pool decision、retry/circuit/fallback 策略与低敏 metrics label。
//
// 设计原则（design.md Decision 1/2/5）：
// - 逻辑租户 lease 叠加在物理 pool 之上，不为每个租户创建物理连接池。
// - 连接资源 catalog 是预算事实源；未登记的高风险资源默认不可执行（fail closed）。
// - 观测低敏化：metrics/audit 只记录 scope hash、pool kind、resource key、operation kind、
//   decision、queue wait、duration、timeout、retry count、circuit state、degraded reason、
//   request id 与低敏 actor ref；禁止组织名称/邮箱/token/连接串/完整 SQL/完整 prompt/完整输出。
//
// 与 `multitenant-isolation-architecture` 的关系：本模块复用其 `TenantContext`/
// `TenantScopeSnapshot`/`mtComputeScopeHash`/`MULTITENANT_FORBIDDEN_KEYS`，不重定义隔离语义。
// 连接池 catalog 与 TenantScopeRegistry 正交：registry 治数据资源归属，catalog 治连接资源预算。
//
// 命名约定：通用 hash 复用 `multitenant-isolation-architecture` 的 `mt*` 前缀函数；
// 本模块新增的类型/常量使用 `TCPM_*` / `Tcpm*` 前缀避免 barrel export 冲突。

import {
  mtComputeScopeHash,
  mtComputePermissionSnapshotHash,
} from './multitenant-isolation-architecture.js'
import type {
  MultitenantScopeMode,
  TenantContext,
  TenantScopeSnapshot,
} from './multitenant-isolation-architecture.js'

// ──────────────────────────────────────────────
// 1. 枚举与常量
// ──────────────────────────────────────────────

/**
 * 连接池类型：标识一类连接资源的物理形态。
 * - `database`：Lucid/Knex 物理连接池（SQLite/PG 共享）
 * - `cache`：Redis 或可选缓存连接
 * - `provider`：外部 provider adapter（AI/OCR/KMS/DLP/watermark/compliance/integration）
 * - `job`：后台作业 / 长流程 worker（Compiler run/report job/rewrap）
 * - `export`：导出/报表长流程游标
 * - `local-only`：低风险本机工具，不强制 lease（如知识索引）
 */
export const TCPM_POOL_KINDS = [
  'database',
  'cache',
  'provider',
  'job',
  'export',
  'local-only',
] as const
export type TcpmPoolKind = (typeof TCPM_POOL_KINDS)[number]

/**
 * lease lifecycle 决策：连接池管理器在 acquire/queue/release 各阶段产出的判定。
 * 对应 spec「Lease Lifecycle」与「Fairness And Exhaustion Control」requirement。
 */
export const TCPM_POOL_DECISIONS = [
  'granted',
  'queued',
  'released',
  'timeout',
  'rejected',
  'degraded',
  'circuit_open',
  'cancelled',
] as const
export type TcpmPoolDecision = (typeof TCPM_POOL_DECISIONS)[number]

/**
 * lease 终态：lease 进入这些状态后不再占用活跃配额。
 */
export const TCPM_TERMINAL_DECISIONS: readonly TcpmPoolDecision[] = [
  'released',
  'timeout',
  'rejected',
  'circuit_open',
  'cancelled',
]

/**
 * 降级原因：catalog fallback mode 触发降级时的低敏 reason code。
 */
export const TCPM_DEGRADED_REASONS = [
  'fallback_local',
  'provider_unavailable',
  'circuit_open',
  'redis_unavailable',
  'quota_denied',
  'fixture_only',
] as const
export type TcpmDegradedReason = (typeof TCPM_DEGRADED_REASONS)[number]

/**
 * 熔断状态：每个 pool/resource 的 circuit breaker 当前状态。
 */
export const TCPM_CIRCUIT_STATES = ['closed', 'open', 'half_open'] as const
export type TcpmCircuitState = (typeof TCPM_CIRCUIT_STATES)[number]

/**
 * fallback mode：catalog entry 声明的资源不可用时的降级行为。
 * - `fail_closed`：拒绝操作（默认，高风险资源）
 * - `degraded_local`：降级到本机/fixture 路径（如 no-Redis → 内存 limiter）
 * - `unavailable`：标记不可用，API 返回 503 语义
 */
export const TCPM_FALLBACK_MODES = ['fail_closed', 'degraded_local', 'unavailable'] as const
export type TcpmFallbackMode = (typeof TCPM_FALLBACK_MODES)[number]

/**
 * metrics label 策略：catalog entry 声明该资源允许记录的 label 维度。
 * - `low_sensitive`：仅 scope hash + pool kind + resource key + operation kind + decision
 * - `minimal`：仅 pool kind + decision（最保守，用于外部边界）
 */
export const TCPM_METRICS_LABEL_POLICIES = ['low_sensitive', 'minimal'] as const
export type TcpmMetricsLabelPolicy = (typeof TCPM_METRICS_LABEL_POLICIES)[number]

/**
 * 连接池观测禁止出现的字段键集合（大小写不敏感）。
 * 连接健康本身也是多租户侧信道：禁止组织名称、邮箱、token、Authorization、
 * 连接串、完整 SQL、完整 prompt、完整模型输出、完整 payload。
 */
export const TCPM_FORBIDDEN_POOL_LABELS: readonly string[] = [
  'organizationName',
  'organization_name',
  'projectName',
  'project_name',
  'userEmail',
  'user_email',
  'email',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'apiKey',
  'api_key',
  'secret',
  'authorization',
  'connectionString',
  'connection_string',
  'connStr',
  'password',
  'fullSql',
  'full_sql',
  'sql',
  'prompt',
  'promptText',
  'prompt_text',
  'modelOutput',
  'model_output',
  'fullPayload',
  'full_payload',
  'rawPayload',
  'raw_payload',
  'providerPayload',
  'provider_payload',
  'errorMessage',
  'error_message',
  'stackTrace',
  'stack_trace',
  'stack',
  // 其他租户的活跃数/队列细节（侧信道）
  'otherTenantActive',
  'other_tenant_active',
  'otherTenantQueued',
  'other_tenant_queued',
  'globalActiveCount',
  'global_active_count',
]

// ──────────────────────────────────────────────
// 2. 核心契约类型
// ──────────────────────────────────────────────

/**
 * 重试策略：catalog entry 声明的连接资源重试参数。
 * 采用指数退避 + 抖动上限，避免雪崩。
 */
export interface TcpmRetryPolicy {
  /** 最大重试次数（0 = 不重试） */
  maxRetries: number
  /** 初始退避毫秒 */
  initialBackoffMs: number
  /** 退避倍率 */
  backoffMultiplier: number
  /** 最大退避毫秒上限 */
  maxBackoffMs: number
}

/**
 * 熔断策略：连续失败触发熔断的阈值与恢复时间。
 */
export interface TcpmCircuitPolicy {
  /** 触发熔断的连续失败次数 */
  failureThreshold: number
  /** 熔断后多久尝试半开（毫秒） */
  resetTimeoutMs: number
  /** 半开状态下允许的探测请求数 */
  halfOpenProbeLimit: number
}

/**
 * 连接资源 catalog entry：每类高风险连接资源的预算与策略事实源。
 * 对应 spec「Connection Resource Catalog」requirement。
 */
export interface TcpmConnectionPoolCatalogEntry {
  /** 资源键（全局唯一，如 `db:primary`/`ai:gateway`/`compiler:run`） */
  resourceKey: string
  /** 池类型 */
  poolKind: TcpmPoolKind
  /** adapter 名称（供测试与日志低敏标识，不含密钥） */
  adapterName: string
  /** 全局活跃 lease 上限（所有租户共享） */
  globalLimit: number
  /** 单租户活跃 lease 上限 */
  defaultTenantLimit: number
  /** 单租户排队等待上限（超出即 reject） */
  queueLimit: number
  /** acquire 超时毫秒（排队等待超过此值即 timeout） */
  acquireTimeoutMs: number
  /** 单次操作超时毫秒 */
  operationTimeoutMs: number
  /** 重试策略 */
  retryPolicy: TcpmRetryPolicy
  /** 熔断策略 */
  circuitPolicy: TcpmCircuitPolicy
  /** 不可用时降级行为 */
  fallbackMode: TcpmFallbackMode
  /** 是否允许 system maintenance scope（默认 false） */
  systemScopeAllowed: boolean
  /** metrics label 策略 */
  metricsLabelPolicy: TcpmMetricsLabelPolicy
  /** 测试 fixture 名称（catalog 完整性测试据此验证 fixture 存在） */
  fixtureName: string
  /** 环境变量覆盖前缀（如 `DB_POOL`/`AI_POOL`），用于 env override 解析 */
  envOverridePrefix?: string
}

/**
 * 租户连接 budget：从 catalog entry + 当前租户 scope 解析出的有效预算。
 * 对应 spec「Tenant Budget Resolution」requirement。
 */
export interface TcpmTenantConnectionBudget {
  resourceKey: string
  poolKind: TcpmPoolKind
  /** 解析出的租户活跃上限（catalog defaultTenantLimit，可被 env 覆盖） */
  tenantLimit: number
  /** 全局活跃上限 */
  globalLimit: number
  /** 排队上限 */
  queueLimit: number
  /** acquire 超时 */
  acquireTimeoutMs: number
  /** 操作超时 */
  operationTimeoutMs: number
  /** 当前租户 scope hash（低敏） */
  scopeHash: string
  /** 当前租户 organization id（内部值，不进 metrics label） */
  organizationId: number
  /** 可选 project id */
  projectId?: number | null
  /** scope mode */
  scopeMode: MultitenantScopeMode
  /** 是否 system maintenance scope */
  isSystemScope: boolean
  /** 重试策略 */
  retryPolicy: TcpmRetryPolicy
  /** 熔断策略 */
  circuitPolicy: TcpmCircuitPolicy
  /** fallback mode */
  fallbackMode: TcpmFallbackMode
}

/**
 * 租户连接 lease：一次 acquire 成功后颁发的租约句柄。
 * 绑定 pool/resource/scope，必须在 finally 中 release。
 */
export interface TcpmTenantConnectionLease {
  /** lease 唯一 id（内部生成，不进 metrics label） */
  leaseId: string
  /** 资源键 */
  resourceKey: string
  /** 池类型 */
  poolKind: TcpmPoolKind
  /** scope hash（低敏，进 metrics） */
  scopeHash: string
  /** organization id（内部值） */
  organizationId: number
  /** project id（可选） */
  projectId?: number | null
  /** 操作类型（低敏，进 metrics） */
  operationKind: string
  /** request id（低敏） */
  requestId: string
  /** 幂等键（低敏） */
  idempotencyKey?: string | null
  /** 颁发时间戳（毫秒，内部值） */
  grantedAt: number
  /** 操作 deadline（毫秒，内部值） */
  deadlineMs: number
  /** 是否降级颁发（如 fallback_local） */
  degraded: boolean
  /** 降级原因（degraded=true 时有值） */
  degradedReason?: TcpmDegradedReason
  /** 排队等待毫秒（granted 前的等待） */
  queueWaitMs: number
}

/**
 * acquire 请求参数：调用方向 pool manager 申请 lease 时提供。
 */
export interface TcpmAcquireRequest {
  /** 资源键（必须在 catalog 中登记） */
  resourceKey: string
  /** 操作类型（低敏 label，如 `read`/`write`/`export`/`ai_context`） */
  operationKind: string
  /** 租户上下文（来自服务端解析，非客户端 body） */
  tenant: TenantContext
  /** request id */
  requestId: string
  /** 幂等键（可选） */
  idempotencyKey?: string | null
  /** 操作 deadline 毫秒（可选，默认取 catalog operationTimeoutMs） */
  deadlineMs?: number
  /** abort signal（可选，用于取消） */
  abortSignal?: AbortSignal | null
  /** 是否 system maintenance scope（须 catalog 允许） */
  isSystemScope?: boolean
}

/**
 * acquire 结果：pool manager 返回的判定信封。
 * - `decision='granted'` → `lease` 有值，调用方在 finally 中 release
 * - `decision='queued'` → 内部排队状态（同步 API 不返回此值；异步 API 可返回）
 * - 其余终态 → `lease` 为 null，调用方按 decision 处理错误
 */
export interface TcpmAcquireResult {
  decision: TcpmPoolDecision
  lease: TcpmTenantConnectionLease | null
  /** 排队等待毫秒（granted/timeout 时有值） */
  queueWaitMs: number
  /** 降级原因（degraded/timeout/rejected 时有值） */
  degradedReason?: TcpmDegradedReason
  /** 非泄露错误码（供 API 映射） */
  errorCode?: TcpmPoolErrorCode
}

/**
 * 连接池错误码：映射到 API 错误 code（非泄露）。
 */
export const TCPM_POOL_ERROR_CODES = [
  'CONNECTION_POOL_EXHAUSTED',
  'CONNECTION_POOL_TIMEOUT',
  'CONNECTION_POOL_DEGRADED',
  'CONNECTION_POOL_CIRCUIT_OPEN',
  'CONNECTION_POOL_RESOURCE_NOT_REGISTERED',
  'CONNECTION_POOL_SYSTEM_SCOPE_DENIED',
] as const
export type TcpmPoolErrorCode = (typeof TCPM_POOL_ERROR_CODES)[number]

/**
 * 低敏 metrics label：连接池观测事件记录的字段集合。
 * 对应 spec「Low-Sensitive Pool Observability」requirement。
 * 严禁包含 TCPM_FORBIDDEN_POOL_LABELS 中的任何键。
 */
export interface TcpmPoolMetricsLabel {
  scopeHash: string
  poolKind: TcpmPoolKind
  resourceKey: string
  operationKind: string
  decision: TcpmPoolDecision
  queueWaitMs: number
  durationMs: number
  timeoutMs: number
  retryCount: number
  circuitState: TcpmCircuitState
  degradedReason?: TcpmDegradedReason | null
  requestId: string
  actorRef: string
  /**
   * 非泄露错误码（低敏枚举，仅终态决策有值）。
   * 用于把 rejected 细分为 exhausted / system-scope-denied 等审计事件类别，
   * 本身不含 provider 细节、连接串或租户业务数据。
   */
  errorCode?: TcpmPoolErrorCode | null
  /**
   * 是否为 system maintenance scope 请求（低敏布尔）。
   * spec「System maintenance request」要求放行时落低敏审计，据此标记。
   */
  isSystemScope?: boolean
}

/**
 * 后台作业连接池元数据：持久化到 job 记录的低敏 lease snapshot。
 * 对应 spec「Background Job Lease Snapshot」requirement。
 */
export interface TcpmJobPoolMetadata {
  /** 低敏租户 scope snapshot（复用 isolation-architecture） */
  scopeSnapshot: TenantScopeSnapshot
  /** request id */
  requestId: string
  /** 幂等键 */
  idempotencyKey: string
  /** 该作业需要获取 lease 的 pool resource keys */
  poolResourceKeys: string[]
  /** 权限快照 hash（复用 isolation-architecture） */
  permissionSnapshotHash: string
}

// ──────────────────────────────────────────────
// 3. 类型守卫
// ──────────────────────────────────────────────

export function isTcpmPoolKind(v: unknown): v is TcpmPoolKind {
  return TCPM_POOL_KINDS.includes(v as TcpmPoolKind)
}

export function isTcpmPoolDecision(v: unknown): v is TcpmPoolDecision {
  return TCPM_POOL_DECISIONS.includes(v as TcpmPoolDecision)
}

export function isTcpmDegradedReason(v: unknown): v is TcpmDegradedReason {
  return TCPM_DEGRADED_REASONS.includes(v as TcpmDegradedReason)
}

export function isTcpmCircuitState(v: unknown): v is TcpmCircuitState {
  return TCPM_CIRCUIT_STATES.includes(v as TcpmCircuitState)
}

export function isTcpmFallbackMode(v: unknown): v is TcpmFallbackMode {
  return TCPM_FALLBACK_MODES.includes(v as TcpmFallbackMode)
}

export function isTcpmMetricsLabelPolicy(v: unknown): v is TcpmMetricsLabelPolicy {
  return TCPM_METRICS_LABEL_POLICIES.includes(v as TcpmMetricsLabelPolicy)
}

export function isTcpmPoolErrorCode(v: unknown): v is TcpmPoolErrorCode {
  return TCPM_POOL_ERROR_CODES.includes(v as TcpmPoolErrorCode)
}

// ──────────────────────────────────────────────
// 4. 低敏脱敏与 label 校验
// ──────────────────────────────────────────────

/**
 * 检测对象（含嵌套）中是否包含连接池禁止 label。
 * 返回所有匹配的禁止 key 路径列表。
 */
export function tcpmDetectForbiddenPoolLabels(obj: unknown): string[] {
  const found: string[] = []
  function walk(value: unknown, path: string): void {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if (typeof value !== 'object') return
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const full = path ? `${path}.${key}` : key
      if (TCPM_FORBIDDEN_POOL_LABELS.includes(key)) found.push(full)
      walk(val, full)
    }
  }
  walk(obj, '')
  return found
}

/**
 * 判断对象中是否有连接池禁止 label。
 */
export function tcpmHasForbiddenPoolLabels(obj: unknown): boolean {
  return tcpmDetectForbiddenPoolLabels(obj).length > 0
}

/**
 * 从对象中递归删除连接池禁止 label，返回新对象。
 */
export function tcpmRedactForbiddenPoolLabels<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) {
    return obj.map((item) => tcpmRedactForbiddenPoolLabels(item)) as unknown as T
  }
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (TCPM_FORBIDDEN_POOL_LABELS.includes(key)) continue
    result[key] = tcpmRedactForbiddenPoolLabels(val)
  }
  return result as T
}

/**
 * 校验一个 metrics label 对象是否只含低敏字段。
 * 返回违规字段路径列表（空 = 合法）。
 */
export function tcpmValidateMetricsLabel(label: TcpmPoolMetricsLabel): string[] {
  return tcpmDetectForbiddenPoolLabels(label)
}

// ──────────────────────────────────────────────
// 5. budget 解析与 lease 构造（纯函数）
// ──────────────────────────────────────────────

/**
 * 从 catalog entry + 租户上下文解析有效连接预算。
 * 对应 spec「Tenant Budget Resolution」scenario: Tenant scoped request。
 *
 * budget 只来自 catalog + 服务端解析的 tenant context；
 * 不信任 request body/query/UI 的 organization id（由调用方保证）。
 */
export function tcpmResolveBudget(
  entry: TcpmConnectionPoolCatalogEntry,
  tenant: TenantContext,
  overrides?: {
    tenantLimit?: number
    globalLimit?: number
    queueLimit?: number
    acquireTimeoutMs?: number
    operationTimeoutMs?: number
  },
): TcpmTenantConnectionBudget {
  const scopeHash = mtComputeScopeHash({
    organizationId: tenant.organizationId,
    projectId: tenant.projectId ?? null,
  })
  return {
    resourceKey: entry.resourceKey,
    poolKind: entry.poolKind,
    tenantLimit: overrides?.tenantLimit ?? entry.defaultTenantLimit,
    globalLimit: overrides?.globalLimit ?? entry.globalLimit,
    queueLimit: overrides?.queueLimit ?? entry.queueLimit,
    acquireTimeoutMs: overrides?.acquireTimeoutMs ?? entry.acquireTimeoutMs,
    operationTimeoutMs: overrides?.operationTimeoutMs ?? entry.operationTimeoutMs,
    scopeHash,
    organizationId: tenant.organizationId,
    projectId: tenant.projectId ?? null,
    scopeMode: tenant.scopeMode,
    isSystemScope: tenant.scopeMode === 'system_global',
    retryPolicy: entry.retryPolicy,
    circuitPolicy: entry.circuitPolicy,
    fallbackMode: entry.fallbackMode,
  }
}

/**
 * 构造 lease（pool manager 内部 acquire 成功后调用）。
 */
export function tcpmBuildLease(params: {
  leaseId: string
  budget: TcpmTenantConnectionBudget
  operationKind: string
  requestId: string
  idempotencyKey?: string | null
  deadlineMs: number
  grantedAt: number
  queueWaitMs: number
  degraded?: boolean
  degradedReason?: TcpmDegradedReason
}): TcpmTenantConnectionLease {
  return {
    leaseId: params.leaseId,
    resourceKey: params.budget.resourceKey,
    poolKind: params.budget.poolKind,
    scopeHash: params.budget.scopeHash,
    organizationId: params.budget.organizationId,
    projectId: params.budget.projectId,
    operationKind: params.operationKind,
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey ?? null,
    grantedAt: params.grantedAt,
    deadlineMs: params.deadlineMs,
    degraded: params.degraded ?? false,
    degradedReason: params.degradedReason,
    queueWaitMs: params.queueWaitMs,
  }
}

/**
 * 构造低敏 metrics label（从 lease + 决策信息）。
 * 已剔除 organizationId/projectId 等内部值，只保留低敏字段。
 */
export function tcpmBuildMetricsLabel(params: {
  lease: TcpmTenantConnectionLease | null
  budget: TcpmTenantConnectionBudget
  decision: TcpmPoolDecision
  durationMs: number
  retryCount: number
  circuitState: TcpmCircuitState
  queueWaitMs: number
  timeoutMs: number
  actorRef: string
  /** 非终态决策可省略；终态决策带上低敏错误码供审计分类。 */
  errorCode?: TcpmPoolErrorCode | null
  /** lease 为 null 的拒绝路径可显式传入 operationKind/requestId。 */
  operationKind?: string
  requestId?: string
  degradedReason?: TcpmDegradedReason | null
  /** 显式覆盖 system scope 标记（request.isSystemScope 与 scopeMode 取或）。 */
  isSystemScope?: boolean
}): TcpmPoolMetricsLabel {
  return {
    scopeHash: params.budget.scopeHash,
    poolKind: params.budget.poolKind,
    resourceKey: params.budget.resourceKey,
    operationKind: params.lease?.operationKind ?? params.operationKind ?? 'unknown',
    decision: params.decision,
    queueWaitMs: params.queueWaitMs,
    durationMs: params.durationMs,
    timeoutMs: params.timeoutMs,
    retryCount: params.retryCount,
    circuitState: params.circuitState,
    degradedReason: params.lease?.degradedReason ?? params.degradedReason ?? null,
    requestId: params.lease?.requestId ?? params.requestId ?? '',
    actorRef: params.actorRef,
    errorCode: params.errorCode ?? null,
    isSystemScope: params.isSystemScope ?? params.budget.isSystemScope,
  }
}

/**
 * 构造后台作业连接池元数据。
 * 对应 spec「Background Job Lease Snapshot」scenario: Job starts from tenant request。
 */
export function tcpmBuildJobPoolMetadata(params: {
  scopeSnapshot: TenantScopeSnapshot
  requestId: string
  idempotencyKey: string
  poolResourceKeys: string[]
  roleVersion: number
  organizationId: number
  scopeMode: MultitenantScopeMode
}): TcpmJobPoolMetadata {
  return {
    scopeSnapshot: params.scopeSnapshot,
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey,
    poolResourceKeys: [...params.poolResourceKeys],
    permissionSnapshotHash: mtComputePermissionSnapshotHash({
      roleVersion: params.roleVersion,
      organizationId: params.organizationId,
      scopeMode: params.scopeMode,
    }),
  }
}
