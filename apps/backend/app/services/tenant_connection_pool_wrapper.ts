// @aiproj/backend — TenantConnectionPoolWrapper（v3-multitenant-connection-pool-management §4）。
//
// withTenantConnectionLease：高风险操作的统一 lease wrapper（design Decision 4）。
// 在副作用前 acquire lease，向回调传递 lease context，并在 success/throw/timeout/
// abort/retry-exhaustion 时在 finally 中 release；禁止 adapter 绕过 wrapper 直接执行。
//
// 数据库 lease helper（§4.3/§4.4）：在 TenantScopeService 的 scoped read/write/transaction
// 外层套 lease，保持既有组织隔离行为与 SQLite/PG 物理池配置不变。
//
// 与 TenantConnectionPoolManager 的关系：wrapper 是 manager 的便捷调用层，
// 把 acquire→执行→release(success/fail) 的样板封装成单一 withLease 调用。

import TenantConnectionPoolManager, {
  ConnectionPoolCircuitOpenException,
  ConnectionPoolDegradedException,
  ConnectionPoolExhaustedException,
  ConnectionPoolSystemScopeDeniedException,
  ConnectionPoolTimeoutException,
  type PoolClock,
  type PoolScheduler,
  type TenantConnectionPoolManagerOptions,
} from '#services/tenant_connection_pool_manager'
import {
  type TcpmAcquireRequest,
  type TcpmAcquireResult,
  type TcpmPoolMetricsLabel,
  type TcpmTenantConnectionLease,
} from '@aiproj/types/multitenant-connection-pool-management'
import type { TenantContext } from '@aiproj/types/multitenant-isolation-architecture'

/**
 * 单例 pool manager 实例（进程内共享）。
 * 生产环境由容器/provider 注入；测试可调用 resetPoolManager 替换。
 */
let defaultManager: TenantConnectionPoolManager | null = null

/** 默认 manager 选项（可由 provider 覆盖注入 metrics sink）。 */
let defaultManagerOptions: TenantConnectionPoolManagerOptions = {}

/**
 * 配置默认 manager（由 provider 在启动时调用，注入 metrics sink 等）。
 */
export function configurePoolManager(options: TenantConnectionPoolManagerOptions): void {
  defaultManagerOptions = options
  defaultManager = null // 重置以便下次 getDefaultPoolManager 重建
}

/**
 * 获取默认 pool manager 单例。
 */
export function getDefaultPoolManager(): TenantConnectionPoolManager {
  if (!defaultManager) {
    defaultManager = new TenantConnectionPoolManager(defaultManagerOptions)
  }
  return defaultManager
}

/**
 * 重置默认 manager（测试隔离用）。
 */
export function resetPoolManager(): void {
  defaultManager = null
}

/**
 * 为测试注入自定义 manager（含 fake clock/scheduler/metrics 收集）。
 */
export function setPoolManagerForTest(manager: TenantConnectionPoolManager): void {
  defaultManager = manager
}

// ──────────────────────────────────────────────
// withTenantConnectionLease wrapper（§4.1/§4.2）
// ──────────────────────────────────────────────

/**
 * 构造 acquire 请求的便捷参数。
 */
export interface LeaseAcquireParams {
  /** catalog 资源键 */
  resourceKey: string
  /** 操作类型（低敏 label） */
  operationKind: string
  /** 租户上下文（服务端解析） */
  tenant: TenantContext
  /** request id */
  requestId: string
  /** 幂等键（可选） */
  idempotencyKey?: string | null
  /** 操作 deadline 毫秒（可选） */
  deadlineMs?: number
  /** abort signal（可选） */
  abortSignal?: AbortSignal | null
  /** 是否 system maintenance scope */
  isSystemScope?: boolean
}

/**
 * 从服务端已解析的 organizationId 构造 lease 用 TenantContext（§5.5 真实入口接入）。
 *
 * 仅用于**已经**在服务端确定组织归属的长流程入口（Compiler run、导出、报表作业）：
 * 这些入口的 organizationId 来自 Controller/Policy 校验后的值或作业租户快照，
 * 不是客户端 body/query 的 hint（spec「Tenant Budget Resolution / Tenant scoped request」）。
 *
 * scopeMode 固定 `organization_scoped`，isSuperAdmin 固定 false：连接预算按组织计量，
 * 不因 super admin 而放宽（super admin 的全局诊断走 `diagnostics:pool_health`）。
 */
export function poolTenantContextFor(params: {
  organizationId: number
  projectId?: number | null
  /** 低敏 actor 引用，如 `user:123`；缺省用 `service`。 */
  actorRef?: string | null
}): TenantContext {
  return {
    organizationId: params.organizationId,
    projectId: params.projectId ?? null,
    scopeMode: 'organization_scoped',
    actorRef: params.actorRef ?? 'service',
    isSuperAdmin: false,
  }
}

/**
 * withTenantConnectionLease：在 lease 保护下执行副作用。
 *
 * 流程：
 * 1. acquire lease（排队/超时/拒绝/circuit-open 由 result.decision 表达）
 * 2. 若非 granted → 不执行 fn，按 decision 抛对应异常或返回 result
 * 3. granted → 执行 fn(lease)，finally 中 release(success = !thrown)
 *
 * fn 抛错 → release(success=false) 累计 circuit 失败，再抛原错误（非泄露）。
 * fn 成功 → release(success=true)。
 *
 * @param params acquire 参数
 * @param fn 在 lease 保护下执行的副作用回调
 * @param manager 可选，默认用单例
 * @returns fn 的返回值
 */
export async function withTenantConnectionLease<T>(
  params: LeaseAcquireParams,
  fn: (lease: TcpmTenantConnectionLease) => Promise<T> | T,
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<T> {
  const request: TcpmAcquireRequest = {
    resourceKey: params.resourceKey,
    operationKind: params.operationKind,
    tenant: params.tenant,
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey ?? null,
    deadlineMs: params.deadlineMs,
    abortSignal: params.abortSignal ?? null,
    isSystemScope: params.isSystemScope,
  }

  const result: TcpmAcquireResult = await manager.acquire(request)

  if (result.decision !== 'granted' || !result.lease) {
    // 非 granted：抛对应非泄露异常（由 §6.5 API 层映射）
    throwPoolDecisionError(result)
  }

  const lease = result.lease
  let success = true
  try {
    return await fn(lease)
  } catch (err) {
    // 只标记失败，不在此处 reportFailure：release(success=false) 已累计 circuit 失败，
    // 两处都记会让熔断在 failureThreshold 的一半就触发（真实 bug，核准时修复）。
    success = false
    throw err
  } finally {
    manager.release(lease, { success })
  }
}

/**
 * acquire 结果非 granted 时抛对应异常（§4.1 wrapper 内部 + §6.5 API 层共用）。
 */
function throwPoolDecisionError(result: TcpmAcquireResult): never {
  switch (result.errorCode) {
    case 'CONNECTION_POOL_EXHAUSTED':
      throw new ConnectionPoolExhaustedException()
    case 'CONNECTION_POOL_TIMEOUT':
      throw new ConnectionPoolTimeoutException()
    case 'CONNECTION_POOL_CIRCUIT_OPEN':
      throw new ConnectionPoolCircuitOpenException()
    case 'CONNECTION_POOL_SYSTEM_SCOPE_DENIED':
      throw new ConnectionPoolSystemScopeDeniedException(result.lease?.resourceKey ?? 'unknown')
    case 'CONNECTION_POOL_DEGRADED':
      throw new ConnectionPoolDegradedException()
    default:
      // rejected 无具体 errorCode 时按 exhausted 处理
      throw new ConnectionPoolExhaustedException()
  }
}

// ──────────────────────────────────────────────
// 数据库 lease helper（§4.3/§4.4）
// ──────────────────────────────────────────────

/**
 * 在数据库 lease 保护下执行查询/事务/聚合/导出游标。
 *
 * 保持既有 TenantScopeService 的组织隔离行为：调用方仍需用 scopedQuery 等 helper
 * 附加 organization_id 过滤；本 helper 仅在物理 DB 访问外层套逻辑 lease。
 *
 * @param params lease 参数（resourceKey 通常为 'db:primary'）
 * @param fn 数据库操作回调（内部应使用 TenantScopeService 的 scoped helper）
 */
export async function withDatabaseLease<T>(
  params: Omit<LeaseAcquireParams, 'resourceKey'>,
  fn: (lease: TcpmTenantConnectionLease) => Promise<T> | T,
  manager?: TenantConnectionPoolManager,
): Promise<T> {
  return withTenantConnectionLease({ ...params, resourceKey: 'db:primary' }, fn, manager)
}

/**
 * 在指定 resource lease 保护下执行导出/报表长流程游标。
 * resourceKey 由调用方按 catalog 指定（export:report / report:job / export:ocr_privacy）。
 */
export async function withExportLease<T>(
  resourceKey: string,
  params: Omit<LeaseAcquireParams, 'resourceKey'>,
  fn: (lease: TcpmTenantConnectionLease) => Promise<T> | T,
  manager?: TenantConnectionPoolManager,
): Promise<T> {
  return withTenantConnectionLease({ ...params, resourceKey }, fn, manager)
}

// ──────────────────────────────────────────────
// 低敏 metrics/audit 接入（§4.5/§4.6）
// ──────────────────────────────────────────────

/**
 * 连接池审计事件类型（低敏）。
 * 复用既有 AuditService 的低敏元数据格式，不改 audit_log schema。
 */
export type PoolAuditEventType =
  | 'pool_degraded'
  | 'pool_circuit_open'
  | 'pool_system_scope_denied'
  | 'pool_system_scope_granted'
  | 'pool_queue_rejected'

/**
 * 低敏 pool 审计事件（落 audit_logs，不含组织名/邮箱/token/payload）。
 */
export interface PoolAuditEvent {
  eventType: PoolAuditEventType
  scopeHash: string
  poolKind: string
  resourceKey: string
  operationKind: string
  requestId: string
  actorRef: string
  /** 低敏 reason code（如 circuit_open/redis_unavailable） */
  reason?: string
}

/**
 * 审计发射回调类型（由 provider 注入 AuditService 适配器）。
 */
export type PoolAuditEmitter = (event: PoolAuditEvent) => void

let auditEmitter: PoolAuditEmitter | null = null

/**
 * 配置 pool 审计发射器（由 provider 注入）。
 */
export function configurePoolAudit(emitter: PoolAuditEmitter): void {
  auditEmitter = emitter
}

/**
 * 发射低敏 pool 审计事件。
 * 仅在 degraded/circuit_open/system_scope_denied/queue_rejected 时落审计（§4.5）。
 */
export function emitPoolAuditEvent(event: PoolAuditEvent): void {
  if (!auditEmitter) return
  auditEmitter(event)
}

/**
 * 从 metrics label 派生低敏审计事件。
 * 仅对非正常决策（timeout/rejected/degraded/circuit_open）落审计。
 */
export function auditFromMetricsLabel(label: TcpmPoolMetricsLabel): void {
  // system maintenance 放行也必须自审计（spec「System maintenance request」），
  // 因此 granted 只在非 system scope 时跳过。
  if (label.decision === 'granted' && label.isSystemScope === true) {
    emitPoolAuditEvent({
      eventType: 'pool_system_scope_granted',
      scopeHash: label.scopeHash,
      poolKind: label.poolKind,
      resourceKey: label.resourceKey,
      operationKind: label.operationKind,
      requestId: label.requestId,
      actorRef: label.actorRef,
      reason: 'system_scope_allowed',
    })
    return
  }
  if (
    label.decision === 'granted' ||
    label.decision === 'released' ||
    label.decision === 'queued'
  ) {
    return
  }
  const eventType: PoolAuditEventType | null =
    label.errorCode === 'CONNECTION_POOL_SYSTEM_SCOPE_DENIED'
      ? 'pool_system_scope_denied'
      : label.decision === 'degraded'
        ? 'pool_degraded'
        : label.decision === 'circuit_open'
          ? 'pool_circuit_open'
          : label.decision === 'rejected'
            ? 'pool_queue_rejected'
            : null
  if (!eventType) return
  emitPoolAuditEvent({
    eventType,
    scopeHash: label.scopeHash,
    poolKind: label.poolKind,
    resourceKey: label.resourceKey,
    operationKind: label.operationKind,
    requestId: label.requestId,
    actorRef: label.actorRef,
    reason: label.degradedReason ?? undefined,
  })
}

export type { PoolClock, PoolScheduler }
