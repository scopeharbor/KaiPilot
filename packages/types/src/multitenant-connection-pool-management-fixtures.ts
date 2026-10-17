// @aiproj/types — V3 多租户连接池管理共享夹具。
// 提供两个组织的镜像 fixtures + 一套 catalog entry 样本 + lease/budget 构造器，
// 用于前后端共享的连接池契约测试与负例测试。纯数据，零运行时依赖。

import type {
  TcpmAcquireRequest,
  TcpmConnectionPoolCatalogEntry,
  TcpmTenantConnectionBudget,
  TcpmTenantConnectionLease,
} from './multitenant-connection-pool-management.js'
import { tcpmBuildLease, tcpmResolveBudget } from './multitenant-connection-pool-management.js'
import type { TenantContext } from './multitenant-isolation-architecture.js'
import {
  buildOrgAContext,
  buildOrgBContext,
  MT_ORG_A_ID,
  MT_ORG_B_ID,
} from './multitenant-isolation-architecture-fixtures.js'

export { MT_ORG_A_ID, MT_ORG_B_ID }

/** 默认重试策略（指数退避） */
export const TCPM_DEFAULT_RETRY_POLICY = {
  maxRetries: 2,
  initialBackoffMs: 100,
  backoffMultiplier: 2,
  maxBackoffMs: 1000,
} as const

/** 默认熔断策略 */
export const TCPM_DEFAULT_CIRCUIT_POLICY = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenProbeLimit: 1,
} as const

/**
 * 数据库 catalog entry（SQLite 本机 / PG 预留）。
 */
export const TCPM_DB_CATALOG_ENTRY: TcpmConnectionPoolCatalogEntry = {
  resourceKey: 'db:primary',
  poolKind: 'database',
  adapterName: 'lucid-sqlite-pool',
  globalLimit: 10,
  defaultTenantLimit: 5,
  queueLimit: 20,
  acquireTimeoutMs: 5000,
  operationTimeoutMs: 30000,
  retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY },
  circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
  fallbackMode: 'fail_closed',
  systemScopeAllowed: false,
  metricsLabelPolicy: 'low_sensitive',
  fixtureName: 'db-primary-fixture',
  envOverridePrefix: 'DB_POOL',
}

/**
 * AI gateway catalog entry（fixture/mock adapter）。
 */
export const TCPM_AI_CATALOG_ENTRY: TcpmConnectionPoolCatalogEntry = {
  resourceKey: 'ai:gateway',
  poolKind: 'provider',
  adapterName: 'ai-gateway-mock',
  globalLimit: 4,
  defaultTenantLimit: 2,
  queueLimit: 8,
  acquireTimeoutMs: 3000,
  operationTimeoutMs: 60000,
  retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY },
  circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
  fallbackMode: 'fail_closed',
  systemScopeAllowed: false,
  metricsLabelPolicy: 'low_sensitive',
  fixtureName: 'ai-gateway-fixture',
  envOverridePrefix: 'AI_POOL',
}

/**
 * Compiler run catalog entry（后台作业长流程）。
 */
export const TCPM_COMPILER_CATALOG_ENTRY: TcpmConnectionPoolCatalogEntry = {
  resourceKey: 'compiler:run',
  poolKind: 'job',
  adapterName: 'compiler-run-fake',
  globalLimit: 3,
  defaultTenantLimit: 1,
  queueLimit: 6,
  acquireTimeoutMs: 10000,
  operationTimeoutMs: 120000,
  retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY, maxRetries: 1 },
  circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
  fallbackMode: 'fail_closed',
  systemScopeAllowed: false,
  metricsLabelPolicy: 'low_sensitive',
  fixtureName: 'compiler-run-fixture',
  envOverridePrefix: 'COMPILER_POOL',
}

/**
 * 缓存 catalog entry（可选 Redis，no-Redis fallback）。
 */
export const TCPM_CACHE_CATALOG_ENTRY: TcpmConnectionPoolCatalogEntry = {
  resourceKey: 'cache:redis',
  poolKind: 'cache',
  adapterName: 'redis-cache-optional',
  globalLimit: 8,
  defaultTenantLimit: 4,
  queueLimit: 16,
  acquireTimeoutMs: 2000,
  operationTimeoutMs: 10000,
  retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY, maxRetries: 1 },
  circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY, failureThreshold: 3 },
  fallbackMode: 'degraded_local',
  systemScopeAllowed: false,
  metricsLabelPolicy: 'minimal',
  fixtureName: 'cache-redis-fixture',
  envOverridePrefix: 'CACHE_POOL',
}

/**
 * 完整 catalog entry 样本集合（覆盖所有 pool kind）。
 * 后端 catalog 实现以此为基础扩展；测试据此验证完整性。
 */
export const TCPM_SAMPLE_CATALOG_ENTRIES: readonly TcpmConnectionPoolCatalogEntry[] = [
  TCPM_DB_CATALOG_ENTRY,
  TCPM_AI_CATALOG_ENTRY,
  TCPM_COMPILER_CATALOG_ENTRY,
  TCPM_CACHE_CATALOG_ENTRY,
  {
    resourceKey: 'ocr:provider',
    poolKind: 'provider',
    adapterName: 'ocr-fake',
    globalLimit: 4,
    defaultTenantLimit: 2,
    queueLimit: 8,
    acquireTimeoutMs: 3000,
    operationTimeoutMs: 60000,
    retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'ocr-provider-fixture',
  },
  {
    resourceKey: 'kms:envelope',
    poolKind: 'provider',
    adapterName: 'kms-local-mock',
    globalLimit: 6,
    defaultTenantLimit: 3,
    queueLimit: 12,
    acquireTimeoutMs: 3000,
    operationTimeoutMs: 30000,
    retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'kms-envelope-fixture',
  },
  {
    resourceKey: 'dlp:engine',
    poolKind: 'provider',
    adapterName: 'dlp-fixture',
    globalLimit: 6,
    defaultTenantLimit: 3,
    queueLimit: 12,
    acquireTimeoutMs: 3000,
    operationTimeoutMs: 30000,
    retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'dlp-engine-fixture',
  },
  {
    resourceKey: 'watermark:renderer',
    poolKind: 'provider',
    adapterName: 'watermark-fixture',
    globalLimit: 4,
    defaultTenantLimit: 2,
    queueLimit: 8,
    acquireTimeoutMs: 2000,
    operationTimeoutMs: 15000,
    retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY, maxRetries: 1 },
    circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'watermark-renderer-fixture',
  },
  {
    resourceKey: 'compliance:evaluator',
    poolKind: 'provider',
    adapterName: 'compliance-fixture',
    globalLimit: 4,
    defaultTenantLimit: 2,
    queueLimit: 8,
    acquireTimeoutMs: 3000,
    operationTimeoutMs: 30000,
    retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'compliance-evaluator-fixture',
  },
  {
    resourceKey: 'export:report',
    poolKind: 'export',
    adapterName: 'report-export-fixture',
    globalLimit: 3,
    defaultTenantLimit: 1,
    queueLimit: 6,
    acquireTimeoutMs: 5000,
    operationTimeoutMs: 90000,
    retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY, maxRetries: 1 },
    circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'export-report-fixture',
  },
  {
    resourceKey: 'report:job',
    poolKind: 'job',
    adapterName: 'report-job-fixture',
    globalLimit: 3,
    defaultTenantLimit: 1,
    queueLimit: 6,
    acquireTimeoutMs: 5000,
    operationTimeoutMs: 90000,
    retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY, maxRetries: 1 },
    circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'report-job-fixture',
  },
  {
    resourceKey: 'integration:webhook',
    poolKind: 'provider',
    adapterName: 'webhook-fake',
    globalLimit: 4,
    defaultTenantLimit: 2,
    queueLimit: 8,
    acquireTimeoutMs: 3000,
    operationTimeoutMs: 30000,
    retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'minimal',
    fixtureName: 'integration-webhook-fixture',
  },
  {
    resourceKey: 'compiler:artifact',
    poolKind: 'job',
    adapterName: 'compiler-artifact-fixture',
    globalLimit: 4,
    defaultTenantLimit: 2,
    queueLimit: 8,
    acquireTimeoutMs: 3000,
    operationTimeoutMs: 30000,
    retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'compiler-artifact-fixture',
  },
  {
    resourceKey: 'tool:knowledge_index',
    poolKind: 'local-only',
    adapterName: 'sqlite-knowledge-index',
    globalLimit: 1,
    defaultTenantLimit: 1,
    queueLimit: 0,
    acquireTimeoutMs: 1000,
    operationTimeoutMs: 5000,
    retryPolicy: { ...TCPM_DEFAULT_RETRY_POLICY, maxRetries: 0 },
    circuitPolicy: { ...TCPM_DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'degraded_local',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'minimal',
    fixtureName: 'knowledge-index-fixture',
  },
]

/** 构造组织 A 的 acquire 请求 */
export function buildOrgAAcquireRequest(
  resourceKey: string,
  overrides?: Partial<TcpmAcquireRequest>,
): TcpmAcquireRequest {
  return {
    resourceKey,
    operationKind: 'read',
    tenant: buildOrgAContext(),
    requestId: 'req-org-a-001',
    idempotencyKey: 'idem-org-a-001',
    ...overrides,
  }
}

/** 构造组织 B 的 acquire 请求（镜像） */
export function buildOrgBAcquireRequest(
  resourceKey: string,
  overrides?: Partial<TcpmAcquireRequest>,
): TcpmAcquireRequest {
  return {
    resourceKey,
    operationKind: 'read',
    tenant: buildOrgBContext(),
    requestId: 'req-org-b-001',
    idempotencyKey: 'idem-org-b-001',
    ...overrides,
  }
}

/** 为组织 A 解析 budget */
export function buildOrgABudget(
  entry: TcpmConnectionPoolCatalogEntry,
  overrides?: Parameters<typeof tcpmResolveBudget>[2],
): TcpmTenantConnectionBudget {
  return tcpmResolveBudget(entry, buildOrgAContext(), overrides)
}

/** 为组织 B 解析 budget */
export function buildOrgBBudget(
  entry: TcpmConnectionPoolCatalogEntry,
  overrides?: Parameters<typeof tcpmResolveBudget>[2],
): TcpmTenantConnectionBudget {
  return tcpmResolveBudget(entry, buildOrgBContext(), overrides)
}

/** 构造一个已颁发的 lease（测试用） */
export function buildGrantedLease(params: {
  budget: TcpmTenantConnectionBudget
  leaseId?: string
  operationKind?: string
  requestId?: string
  grantedAt?: number
  deadlineMs?: number
  queueWaitMs?: number
}): TcpmTenantConnectionLease {
  return tcpmBuildLease({
    leaseId: params.leaseId ?? 'lease-001',
    budget: params.budget,
    operationKind: params.operationKind ?? 'read',
    requestId: params.requestId ?? 'req-001',
    deadlineMs: params.deadlineMs ?? params.budget.operationTimeoutMs,
    grantedAt: params.grantedAt ?? 1000,
    queueWaitMs: params.queueWaitMs ?? 0,
  })
}

/** 构造一个 super admin system scope 的租户上下文 */
export function buildSystemGlobalContext(overrides?: Partial<TenantContext>): TenantContext {
  return buildOrgAContext({
    scopeMode: 'system_global',
    isSuperAdmin: true,
    ...overrides,
  })
}
