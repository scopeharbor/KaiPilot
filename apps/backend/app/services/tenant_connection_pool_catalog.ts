// @aiproj/backend — Tenant Connection Pool Catalog（v3-multitenant-connection-pool-management §2.3）。
//
// 连接资源目录（事实源）：每类高风险连接资源声明其 pool kind、全局/租户上限、
// queue limit、acquire/operation timeout、retry/circuit policy、fallback mode、
// system scope 例外、metrics label 策略与 fixture name。
//
// 未登记的高风险 provider/job/export/AI/Compiler 连接资源默认不可执行（fail closed）。
// 对应 spec「Connection Resource Catalog」requirement 与 design Decision 2。
//
// 与 TenantScopeRegistry 的关系：registry 治数据资源归属（organization_id 列），
// catalog 治连接资源预算（pool/lease）；两者正交，不重叠。
//
// env override（§2.5）：每个 entry 的 envOverridePrefix 用于从环境变量解析
// `<PREFIX>_TENANT_LIMIT` / `<PREFIX>_GLOBAL_LIMIT` / `<PREFIX>_QUEUE_LIMIT`，
// 解析失败时回落 catalog 默认值（不抛错，保持本机启动优先）。

import {
  type TcpmConnectionPoolCatalogEntry,
  type TcpmPoolKind,
} from '@aiproj/types/multitenant-connection-pool-management'

/** 默认重试策略（指数退避 + 抖动上限） */
const DEFAULT_RETRY_POLICY = {
  maxRetries: 2,
  initialBackoffMs: 100,
  backoffMultiplier: 2,
  maxBackoffMs: 1000,
} as const

/** 默认熔断策略 */
const DEFAULT_CIRCUIT_POLICY = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenProbeLimit: 1,
} as const

/**
 * 连接资源 catalog 事实源。
 * 覆盖 observation-and-inventory.md §4 的全部高风险资源：
 * database / cache / AI / OCR / KMS / DLP / watermark / compliance /
 * compiler run+artifact / export(report+ocr_privacy) / report job / integration webhook /
 * local-only 知识索引。
 *
 * 新增高风险连接资源时必须在此登记，否则 catalog 完整性测试（§2.4）失败。
 */
const CATALOG_ENTRIES: readonly TcpmConnectionPoolCatalogEntry[] = [
  {
    resourceKey: 'db:primary',
    poolKind: 'database',
    adapterName: 'lucid-sqlite-pool',
    globalLimit: 10,
    defaultTenantLimit: 5,
    queueLimit: 20,
    acquireTimeoutMs: 5000,
    operationTimeoutMs: 30000,
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'db-primary-fixture',
    envOverridePrefix: 'DB_POOL',
  },
  {
    resourceKey: 'cache:redis',
    poolKind: 'cache',
    adapterName: 'redis-cache-optional',
    globalLimit: 8,
    defaultTenantLimit: 4,
    queueLimit: 16,
    acquireTimeoutMs: 2000,
    operationTimeoutMs: 10000,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 1 },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY, failureThreshold: 3 },
    fallbackMode: 'degraded_local',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'minimal',
    fixtureName: 'cache-redis-fixture',
    envOverridePrefix: 'CACHE_POOL',
  },
  {
    resourceKey: 'ai:gateway',
    poolKind: 'provider',
    adapterName: 'ai-gateway-mock',
    globalLimit: 4,
    defaultTenantLimit: 2,
    queueLimit: 8,
    acquireTimeoutMs: 3000,
    operationTimeoutMs: 60000,
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'ai-gateway-fixture',
    envOverridePrefix: 'AI_POOL',
  },
  {
    resourceKey: 'ai:draft',
    poolKind: 'provider',
    adapterName: 'ai-draft-fixture',
    globalLimit: 4,
    defaultTenantLimit: 2,
    queueLimit: 8,
    acquireTimeoutMs: 3000,
    operationTimeoutMs: 60000,
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'ai-draft-fixture',
    envOverridePrefix: 'AI_POOL',
  },
  {
    resourceKey: 'ocr:provider',
    poolKind: 'provider',
    adapterName: 'ocr-fake',
    globalLimit: 4,
    defaultTenantLimit: 2,
    queueLimit: 8,
    acquireTimeoutMs: 3000,
    operationTimeoutMs: 60000,
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
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
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
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
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
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
    retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 1 },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
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
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'compliance-evaluator-fixture',
  },
  {
    resourceKey: 'compiler:run',
    poolKind: 'job',
    adapterName: 'compiler-run-fake',
    globalLimit: 3,
    defaultTenantLimit: 1,
    queueLimit: 6,
    acquireTimeoutMs: 10000,
    operationTimeoutMs: 120000,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 1 },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'compiler-run-fixture',
    envOverridePrefix: 'COMPILER_POOL',
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
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'compiler-artifact-fixture',
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
    retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 1 },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'export-report-fixture',
  },
  {
    resourceKey: 'export:ocr_privacy',
    poolKind: 'export',
    adapterName: 'ocr-privacy-export-fixture',
    globalLimit: 3,
    defaultTenantLimit: 1,
    queueLimit: 6,
    acquireTimeoutMs: 5000,
    operationTimeoutMs: 90000,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 1 },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'export-ocr-privacy-fixture',
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
    retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 1 },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'report-job-fixture',
  },
  {
    // 后台 worker 执行槽位（observation-and-inventory §4 `job:worker`）。
    // 与 compiler:run / report:job 分开计量：worker 在执行期重新 acquire 本资源，
    // 使「入队时的租户预算」与「执行时的并发预算」互不掩盖（§6.3）。
    resourceKey: 'job:worker',
    poolKind: 'job',
    adapterName: 'job-worker-fixture',
    globalLimit: 4,
    defaultTenantLimit: 2,
    queueLimit: 8,
    acquireTimeoutMs: 5000,
    operationTimeoutMs: 120000,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 1 },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'low_sensitive',
    fixtureName: 'job-worker-fixture',
    envOverridePrefix: 'JOB_POOL',
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
    retryPolicy: { ...DEFAULT_RETRY_POLICY },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'fail_closed',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'minimal',
    fixtureName: 'integration-webhook-fixture',
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
    retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 0 },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'degraded_local',
    systemScopeAllowed: false,
    metricsLabelPolicy: 'minimal',
    fixtureName: 'knowledge-index-fixture',
  },
  {
    // 连接健康诊断：唯一显式允许 system maintenance scope 的资源
    // （spec「Tenant Budget Resolution / System maintenance request」允许分支）。
    // 只读低敏聚合（活跃数/队列长度/circuit 状态），不读任何租户业务数据；
    // 放行时必须落低敏审计（wrapper `auditFromMetricsLabel`）。
    resourceKey: 'diagnostics:pool_health',
    poolKind: 'local-only',
    adapterName: 'pool-health-diagnostics',
    globalLimit: 2,
    defaultTenantLimit: 1,
    queueLimit: 0,
    acquireTimeoutMs: 1000,
    operationTimeoutMs: 5000,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 0 },
    circuitPolicy: { ...DEFAULT_CIRCUIT_POLICY },
    fallbackMode: 'degraded_local',
    systemScopeAllowed: true,
    metricsLabelPolicy: 'minimal',
    fixtureName: 'pool-health-diagnostics-fixture',
  },
]

/**
 * 解析 env override 的整数值；非法或缺失返回 null（调用方回落默认值）。
 * 不抛错——本机启动优先，非法 env 不阻塞启动（§2.5/§2.6）。
 *
 * 直接读 process.env（不依赖 Adonis Env 冻结缓存），便于测试隔离设置。
 */
function parseEnvInt(key: string): number | null {
  const raw = process.env[key]
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null
  return n
}

/**
 * 对单个 entry 应用 env override（tenant/global/queue limit）。
 * 返回应用了 override 的新 entry（不修改原 entry）。
 */
export function applyEnvOverrides(
  entry: TcpmConnectionPoolCatalogEntry,
): TcpmConnectionPoolCatalogEntry {
  const prefix = entry.envOverridePrefix
  if (!prefix) return entry
  const tenantLimit = parseEnvInt(`${prefix}_TENANT_LIMIT`)
  const globalLimit = parseEnvInt(`${prefix}_GLOBAL_LIMIT`)
  const queueLimit = parseEnvInt(`${prefix}_QUEUE_LIMIT`)
  return {
    ...entry,
    defaultTenantLimit:
      tenantLimit !== null && tenantLimit > 0 ? tenantLimit : entry.defaultTenantLimit,
    globalLimit: globalLimit !== null && globalLimit > 0 ? globalLimit : entry.globalLimit,
    queueLimit: queueLimit !== null ? queueLimit : entry.queueLimit,
  }
}

/**
 * TenantConnectionPoolCatalog —— 连接资源目录事实源。
 * 默认 fail closed：未登记的高风险资源不可执行。
 */
export default class TenantConnectionPoolCatalog {
  private static readonly entries = new Map<string, TcpmConnectionPoolCatalogEntry>(
    CATALOG_ENTRIES.map((e) => [e.resourceKey, e]),
  )

  /** 缓存已应用 env override 的 entry（首次访问时解析） */
  private static readonly resolved = new Map<string, TcpmConnectionPoolCatalogEntry>()

  /**
   * 校验整个 catalog 的声明完整性（供 §2.4 完整性测试与启动自检使用）：
   * - 每项必须有合法 poolKind、非空 resourceKey/adapterName/fixtureName
   * - globalLimit/defaultTenantLimit > 0（local-only 除外允许 0 queue）
   * - retry/circuit policy 字段合法
   * - 资源键唯一
   */
  static validate(): void {
    const seen = new Set<string>()
    for (const entry of CATALOG_ENTRIES) {
      if (seen.has(entry.resourceKey)) {
        throw new Error(`TenantConnectionPoolCatalog: 重复资源键 ${entry.resourceKey}`)
      }
      seen.add(entry.resourceKey)
      this.validateEntry(entry)
    }
  }

  static validateEntry(entry: TcpmConnectionPoolCatalogEntry): void {
    if (!entry.resourceKey || entry.resourceKey.length === 0) {
      throw new Error('TenantConnectionPoolCatalog: resourceKey 不能为空')
    }
    if (!entry.adapterName || entry.adapterName.length === 0) {
      throw new Error(`TenantConnectionPoolCatalog: ${entry.resourceKey} 缺少 adapterName`)
    }
    if (!entry.fixtureName || entry.fixtureName.length === 0) {
      throw new Error(`TenantConnectionPoolCatalog: ${entry.resourceKey} 缺少 fixtureName`)
    }
    if (!entry.globalLimit || entry.globalLimit <= 0) {
      throw new Error(`TenantConnectionPoolCatalog: ${entry.resourceKey} globalLimit 必须为正`)
    }
    if (!entry.defaultTenantLimit || entry.defaultTenantLimit <= 0) {
      throw new Error(
        `TenantConnectionPoolCatalog: ${entry.resourceKey} defaultTenantLimit 必须为正`,
      )
    }
    if (entry.queueLimit < 0) {
      throw new Error(`TenantConnectionPoolCatalog: ${entry.resourceKey} queueLimit 不能为负`)
    }
    if (entry.acquireTimeoutMs <= 0 || entry.operationTimeoutMs <= 0) {
      throw new Error(`TenantConnectionPoolCatalog: ${entry.resourceKey} timeout 必须为正`)
    }
    const { retryPolicy } = entry
    if (
      retryPolicy.maxRetries < 0 ||
      retryPolicy.initialBackoffMs <= 0 ||
      retryPolicy.backoffMultiplier <= 0 ||
      retryPolicy.maxBackoffMs <= 0
    ) {
      throw new Error(`TenantConnectionPoolCatalog: ${entry.resourceKey} retryPolicy 非法`)
    }
    const { circuitPolicy } = entry
    if (
      circuitPolicy.failureThreshold <= 0 ||
      circuitPolicy.resetTimeoutMs <= 0 ||
      circuitPolicy.halfOpenProbeLimit <= 0
    ) {
      throw new Error(`TenantConnectionPoolCatalog: ${entry.resourceKey} circuitPolicy 非法`)
    }
  }

  /**
   * 获取已应用 env override 的 entry；未注册抛错（fail closed）。
   */
  static get(resourceKey: string): TcpmConnectionPoolCatalogEntry {
    const cached = this.resolved.get(resourceKey)
    if (cached) return cached
    const base = this.entries.get(resourceKey)
    if (!base) {
      throw new Error(`TenantConnectionPoolCatalog: 未注册连接资源 ${resourceKey}`)
    }
    const applied = applyEnvOverrides(base)
    this.resolved.set(resourceKey, applied)
    return applied
  }

  /**
   * 获取原始 entry（不应用 env override；供测试验证默认值）。
   */
  static getBase(resourceKey: string): TcpmConnectionPoolCatalogEntry {
    const base = this.entries.get(resourceKey)
    if (!base) {
      throw new Error(`TenantConnectionPoolCatalog: 未注册连接资源 ${resourceKey}`)
    }
    return base
  }

  /**
   * 判断资源是否已登记。
   */
  static has(resourceKey: string): boolean {
    return this.entries.has(resourceKey)
  }

  /**
   * 列出全部 entry（已应用 env override；按注册顺序）。
   */
  static all(): TcpmConnectionPoolCatalogEntry[] {
    return CATALOG_ENTRIES.map((e) => this.get(e.resourceKey))
  }

  /**
   * 列出全部高风险 entry（排除 local-only）。
   */
  static highRiskEntries(): TcpmConnectionPoolCatalogEntry[] {
    return CATALOG_ENTRIES.filter((e) => e.poolKind !== 'local-only').map((e) =>
      this.get(e.resourceKey),
    )
  }

  /**
   * 按 pool kind 过滤。
   */
  static byPoolKind(kind: TcpmPoolKind): TcpmConnectionPoolCatalogEntry[] {
    return CATALOG_ENTRIES.filter((e) => e.poolKind === kind).map((e) => this.get(e.resourceKey))
  }

  /**
   * 清除 env override 缓存（测试隔离用）。
   */
  static resetResolvedCacheForTest(): void {
    this.resolved.clear()
  }
}
