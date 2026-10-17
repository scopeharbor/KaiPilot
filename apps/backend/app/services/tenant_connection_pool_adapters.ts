// @aiproj/backend — TenantConnectionPoolAdapters（v3-multitenant-connection-pool-management §5）。
//
// 高风险 adapter 的统一 lease 保护入口（design Decision 4 + spec「Adapter Enforcement Boundary」）。
//
// 每类 catalog 声明的高风险连接资源（AI/OCR/KMS/DLP/watermark/compliance/Compiler/
// export/report/integration/cache）都提供一个 fixture-first adapter 函数：在副作用前
// 经 withTenantConnectionLease acquire lease，向 fixture 传递 lease context，并在
// success/throw/timeout/abort/retry-exhaustion 时 finally release。
//
// 关键约束：
// - fixture-first：默认不触发真实外部 provider（spec「Local-First Fallback / Fixture provider」）。
//   AI adapter 只产 fixture 草案，保留反幻觉与人工确认门（design 红线 A4），不自动 apply。
// - 不泄露：adapter 返回值与 metrics/audit 只含低敏字段，不含 token/连接串/完整 prompt/payload。
// - 可枚举：AdapterRegistry 把 resourceKey 映射到 adapter，enforcement 测试据此检测绕过
//   （spec「Wrapper bypass」scenario：绕过 lease 的路径必须失败并指出 resourceKey）。
// - 不重写既有业务 service：本模块是连接资源治理的 adapter 边界；既有 service（AIGateway/
//   DlpDecisionService/Compiler 等）的 lease 接入由各自 change/后续推进，本 change 只确立
//   边界契约与可验证 fixture。生产 service 可按需迁移到这些 adapter 入口。

import {
  withTenantConnectionLease,
  withDatabaseLease,
  getDefaultPoolManager,
  type LeaseAcquireParams,
} from '#services/tenant_connection_pool_wrapper'
import type TenantConnectionPoolManager from '#services/tenant_connection_pool_manager'
import TenantConnectionPoolCatalog from '#services/tenant_connection_pool_catalog'
import { getEffectiveImplementation } from '#services/redis/redis_availability'
import TenantNamespaceService from '#services/tenant_namespace_service'
import type { TcpmTenantConnectionLease } from '@aiproj/types/multitenant-connection-pool-management'
import type { TenantContext } from '@aiproj/types/multitenant-isolation-architecture'

// ──────────────────────────────────────────────
// 公共参数与结果类型
// ──────────────────────────────────────────────

/**
 * adapter 调用参数（所有 fixture adapter 共用）。
 * tenant / requestId / idempotencyKey 用于 acquire lease；operationKind 进低敏 metrics。
 */
export interface AdapterCallParams {
  tenant: TenantContext
  requestId: string
  idempotencyKey?: string | null
  /** 操作 deadline（毫秒），可选 */
  deadlineMs?: number
  /** abort signal，可选 */
  abortSignal?: AbortSignal | null
  /** 是否 system maintenance scope（默认 false，多数资源 catalog 禁止） */
  isSystemScope?: boolean
}

/**
 * 低敏 adapter 结果：只含操作摘要，不含 token/payload/prompt 原文。
 * secretRedacted 标记调用方传入的敏感输入已被丢弃。
 */
export interface AdapterFixtureResult {
  /** catalog resourceKey（低敏） */
  resourceKey: string
  /** 操作类型（低敏 label） */
  operationKind: string
  /** lease id（内部值，不进 metrics） */
  leaseId: string
  /** 是否使用 fixture（true = 未触发真实外部 provider） */
  fixtureUsed: boolean
  /** 丢弃的敏感字段计数（用于断言不泄露） */
  secretInputsRedacted: number
  /** 操作摘要（低敏，不含业务原文） */
  summary: string
}

/**
 * 构造 LeaseAcquireParams 的公共转换。
 */
function toLeaseParams(
  resourceKey: string,
  operationKind: string,
  params: AdapterCallParams,
): LeaseAcquireParams {
  return {
    resourceKey,
    operationKind,
    tenant: params.tenant,
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey ?? null,
    deadlineMs: params.deadlineMs,
    abortSignal: params.abortSignal ?? null,
    isSystemScope: params.isSystemScope ?? false,
  }
}

/**
 * 统计并丢弃敏感输入（spec「Forbidden labels」：adapter 不得保留 token/payload/prompt 原文）。
 * 返回丢弃计数，供结果断言。
 */
function redactSecretInputs(secretFields: Array<unknown>): number {
  // 不保留任何敏感字段原文；仅返回计数用于低敏断言。
  let count = 0
  for (const field of secretFields) {
    if (field !== undefined && field !== null && field !== '') count++
  }
  return count
}

// ──────────────────────────────────────────────
// 各类高风险 fixture adapter（§5.1–5.8）
// ──────────────────────────────────────────────

/**
 * Database fixture adapter（§4.3/§5，resourceKey='db:primary'）。
 *
 * 委托 §4 的 withDatabaseLease：在物理 DB 访问外层套逻辑 lease，保持既有 TenantScope
 * 组织隔离行为不变。fixture 路径不实际查库，只验证 acquire/release lifecycle；
 * 真实 scoped query/transaction 由调用方在 lease 回调内用 TenantScopeService helper 执行。
 *
 * 登记进 registry 使 enforcement boundary（spec「Wrapper bypass」）统一覆盖 database 资源。
 */
export async function callDatabaseFixture(
  params: AdapterCallParams,
  secretInputs?: { sql?: string; connectionString?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.sql, secretInputs?.connectionString])
  return withDatabaseLease(
    toLeaseParams('db:primary', 'read', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'db:primary',
      operationKind: 'read',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary:
        'db-primary-fixture: lease guarded (scoped query/transaction via TenantScope helper)',
    }),
    manager,
  )
}

/**
 * AI gateway fixture adapter（§5.1，resourceKey='ai:gateway'）。
 *
 * 默认 fixture 路径：不触发真实模型，返回确定性占位结果。
 * 保留反幻觉与人工确认门：本 adapter 只产 fixture，不自动 apply 任何 AI 结果落库
 * （design 红线 A4：AI 只建议不自动执行）。
 *
 * @param params lease 参数
 * @param secretInputs 调用方传入的敏感输入（prompt/apiKey/连接串等），将被丢弃
 * @param manager 可选，默认单例
 */
export async function callAiGatewayFixture(
  params: AdapterCallParams,
  secretInputs?: { prompt?: string; apiKey?: string; connectionStr?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([
    secretInputs?.prompt,
    secretInputs?.apiKey,
    secretInputs?.connectionStr,
  ])
  return withTenantConnectionLease(
    toLeaseParams('ai:gateway', 'generate', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'ai:gateway',
      operationKind: 'generate',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'ai-gateway-fixture: deterministic placeholder, no real provider call',
    }),
    manager,
  )
}

/**
 * AI draft fixture adapter（§5.1，resourceKey='ai:draft'）。
 * 产确定性草案 fixture，不经真实模型；反幻觉校验与人工确认由调用方/上层保留，本 adapter 不 apply。
 */
export async function callAiDraftFixture(
  params: AdapterCallParams,
  secretInputs?: { prompt?: string; apiKey?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.prompt, secretInputs?.apiKey])
  return withTenantConnectionLease(
    toLeaseParams('ai:draft', 'draft', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'ai:draft',
      operationKind: 'draft',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'ai-draft-fixture: deterministic draft, no real model call, no auto-commit',
    }),
    manager,
  )
}

/**
 * OCR provider fixture adapter（§5.3，resourceKey='ocr:provider'）。
 */
export async function callOcrProviderFixture(
  params: AdapterCallParams,
  secretInputs?: { imageData?: string; apiKey?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.imageData, secretInputs?.apiKey])
  return withTenantConnectionLease(
    toLeaseParams('ocr:provider', 'ocr', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'ocr:provider',
      operationKind: 'ocr',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'ocr-provider-fixture: deterministic extraction, no real provider call',
    }),
    manager,
  )
}

/**
 * KMS envelope fixture adapter（§5.3，resourceKey='kms:envelope'）。
 * 使用 mock KMS provider 语义，不触碰真实密钥。
 */
export async function callKmsEnvelopeFixture(
  params: AdapterCallParams,
  secretInputs?: { plaintext?: string; dek?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.plaintext, secretInputs?.dek])
  return withTenantConnectionLease(
    toLeaseParams('kms:envelope', 'envelope', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'kms:envelope',
      operationKind: 'envelope',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'kms-envelope-fixture: mock wrap/unwrap, no real key material',
    }),
    manager,
  )
}

/**
 * DLP engine fixture adapter（§5.3，resourceKey='dlp:engine'）。
 * 纯本地决策 fixture，无外部 provider。
 */
export async function callDlpEngineFixture(
  params: AdapterCallParams,
  secretInputs?: { text?: string; payload?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.text, secretInputs?.payload])
  return withTenantConnectionLease(
    toLeaseParams('dlp:engine', 'decide', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'dlp:engine',
      operationKind: 'decide',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'dlp-engine-fixture: local policy decision, no external call',
    }),
    manager,
  )
}

/**
 * Watermark renderer fixture adapter（§5.3，resourceKey='watermark:renderer'）。
 */
export async function callWatermarkRendererFixture(
  params: AdapterCallParams,
  secretInputs?: { payload?: string; document?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.payload, secretInputs?.document])
  return withTenantConnectionLease(
    toLeaseParams('watermark:renderer', 'render', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'watermark:renderer',
      operationKind: 'render',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'watermark-renderer-fixture: deterministic hash, no real document render',
    }),
    manager,
  )
}

/**
 * Compliance evaluator fixture adapter（§5.3，resourceKey='compliance:evaluator'）。
 */
export async function callComplianceEvaluatorFixture(
  params: AdapterCallParams,
  secretInputs?: { evidencePayload?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.evidencePayload])
  return withTenantConnectionLease(
    toLeaseParams('compliance:evaluator', 'evaluate', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'compliance:evaluator',
      operationKind: 'evaluate',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'compliance-evaluator-fixture: fixture evidence, no real provider call',
    }),
    manager,
  )
}

/**
 * Integration webhook fixture adapter（§5.3，resourceKey='integration:webhook'）。
 * 外部边界：fixture 不外发，保留授权门。
 */
export async function callIntegrationWebhookFixture(
  params: AdapterCallParams,
  secretInputs?: { outboundPayload?: string; signingSecret?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.outboundPayload, secretInputs?.signingSecret])
  return withTenantConnectionLease(
    toLeaseParams('integration:webhook', 'webhook', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'integration:webhook',
      operationKind: 'webhook',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'integration-webhook-fixture: no external delivery (authorization gate)',
    }),
    manager,
  )
}

/**
 * Compiler run fixture adapter（§5.5，resourceKey='compiler:run'）。
 * 长流程入口：lease 覆盖 run 生命周期，fixture 不执行真实编译副作用。
 */
export async function callCompilerRunFixture(
  params: AdapterCallParams,
  secretInputs?: { manifest?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.manifest])
  return withTenantConnectionLease(
    toLeaseParams('compiler:run', 'run', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'compiler:run',
      operationKind: 'run',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'compiler-run-fixture: staged fixture, no real compile side effect',
    }),
    manager,
  )
}

/**
 * Compiler artifact fixture adapter（§5.5，resourceKey='compiler:artifact'）。
 */
export async function callCompilerArtifactFixture(
  params: AdapterCallParams,
  secretInputs?: { artifact?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.artifact])
  return withTenantConnectionLease(
    toLeaseParams('compiler:artifact', 'artifact', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'compiler:artifact',
      operationKind: 'artifact',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'compiler-artifact-fixture: stage cache fixture, no real artifact write',
    }),
    manager,
  )
}

/**
 * Export report fixture adapter（§5.5，resourceKey='export:report'）。
 * 长流程游标入口。
 */
export async function callExportReportFixture(
  params: AdapterCallParams,
  secretInputs?: { document?: string; sql?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.document, secretInputs?.sql])
  return withTenantConnectionLease(
    toLeaseParams('export:report', 'export', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'export:report',
      operationKind: 'export',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'export-report-fixture: render fixture, no real export cursor',
    }),
    manager,
  )
}

/**
 * Export OCR privacy fixture adapter（§5.5，resourceKey='export:ocr_privacy'）。
 */
export async function callExportOcrPrivacyFixture(
  params: AdapterCallParams,
  secretInputs?: { extractions?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.extractions])
  return withTenantConnectionLease(
    toLeaseParams('export:ocr_privacy', 'export', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'export:ocr_privacy',
      operationKind: 'export',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'export-ocr-privacy-fixture: privacy export fixture, no real copy',
    }),
    manager,
  )
}

/**
 * Report job fixture adapter（§5.5，resourceKey='report:job'）。
 */
export async function callReportJobFixture(
  params: AdapterCallParams,
  secretInputs?: { reportPayload?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.reportPayload])
  return withTenantConnectionLease(
    toLeaseParams('report:job', 'report', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'report:job',
      operationKind: 'report',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'report-job-fixture: job fixture, no real report side effect',
    }),
    manager,
  )
}

/**
 * Job worker fixture adapter（§5.5/§6.3，resourceKey='job:worker'）。
 *
 * worker 执行期重新 acquire 的执行槽位：与入队时的业务资源（compiler:run / report:job /
 * export:*）分开计量，避免「入队预算」掩盖「执行并发预算」。
 */
export async function callJobWorkerFixture(
  params: AdapterCallParams,
  secretInputs?: { jobPayload?: string },
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<AdapterFixtureResult> {
  const redacted = redactSecretInputs([secretInputs?.jobPayload])
  return withTenantConnectionLease(
    toLeaseParams('job:worker', 'job', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'job:worker',
      operationKind: 'job',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: redacted,
      summary: 'job-worker-fixture: execution slot lease, no real job side effect',
    }),
    manager,
  )
}

/**
 * 连接健康诊断（spec「System maintenance request」允许分支，
 * resourceKey='diagnostics:pool_health'，catalog systemScopeAllowed=true）。
 *
 * 唯一允许 system maintenance scope 的资源：只返回低敏聚合（活跃数、队列长度、
 * circuit 状态），不读任何租户业务数据，也不暴露单个租户的活跃/排队明细（侧信道）。
 * 放行时由 wrapper 的 `auditFromMetricsLabel` 落 `pool_system_scope_granted` 低敏审计。
 */
export async function readPoolHealthDiagnostics(
  params: AdapterCallParams,
  resourceKeys: readonly string[],
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<{
  resourceKey: string
  leaseId: string
  /** 低敏聚合：每个资源的全局活跃数/队列长度/circuit 状态，不含租户维度拆分 */
  snapshots: Array<{ resourceKey: string; active: number; queued: number; circuitState: string }>
}> {
  return withTenantConnectionLease(
    { ...toLeaseParams('diagnostics:pool_health', 'diagnose', params), isSystemScope: true },
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'diagnostics:pool_health',
      leaseId: lease.leaseId,
      snapshots: resourceKeys.map((key) => ({
        resourceKey: key,
        active: manager.activeCount(key),
        queued: manager.queueLength(key),
        circuitState: manager.circuitState(key),
      })),
    }),
    manager,
  )
}

/**
 * Cache fixture adapter（§5.7，resourceKey='cache:redis'）。
 * 可选 Redis 路径：catalog fallbackMode='degraded_local'，Redis 不可用时 lease 仍正常颁发
 * （degraded），保持 no-Redis fallback 可运行。
 *
 * @param params lease 参数
 * @param redisAvailable Redis 是否可达（由调用方从 redis_availability 注入）
 * @param manager 可选
 */
export async function callCacheFixture(
  params: AdapterCallParams,
  /** Redis 是否可达；缺省时从 `redis_availability` 的运行期判定读取（§5.7 真实接入）。 */
  redisAvailable: boolean = getEffectiveImplementation() === 'redis',
  manager: TenantConnectionPoolManager = getDefaultPoolManager(),
): Promise<
  AdapterFixtureResult & { degraded: boolean; degradedReason?: string; namespace: string }
> {
  // 租户命名空间在降级路径同样保留：Redis 不可用改的是存储实现，不是隔离边界。
  const namespace = new TenantNamespaceService().namespace({
    organizationId: params.tenant.organizationId,
    projectId: params.tenant.projectId ?? null,
  })
  return withTenantConnectionLease(
    toLeaseParams('cache:redis', 'cache', params),
    async (lease: TcpmTenantConnectionLease) => ({
      resourceKey: 'cache:redis',
      operationKind: 'cache',
      leaseId: lease.leaseId,
      fixtureUsed: true,
      secretInputsRedacted: 0,
      summary: redisAvailable
        ? 'cache-fixture: redis path (lease granted)'
        : 'cache-fixture: degraded_local (redis unavailable, in-process fallback)',
      // lease.degraded 由 manager 按 catalog fallbackMode 决定；此处反映运行期 Redis 可达性
      degraded: !redisAvailable,
      degradedReason: redisAvailable ? undefined : 'redis_unavailable',
      namespace,
    }),
    manager,
  )
}

// ──────────────────────────────────────────────
// Adapter Registry（enforcement 测试枚举与绕过检测，spec「Wrapper bypass」）
// ──────────────────────────────────────────────

/**
 * 已登记的 fixture adapter 描述。每个高风险 resourceKey 必须有对应 adapter，
 * 否则 enforcement 测试失败并指出缺失的 resourceKey。
 */
export interface RegisteredAdapter {
  resourceKey: string
  /** 该 adapter 覆盖的 catalog pool kind */
  poolKind: string
  /**
   * adapter 函数（经 lease 保护）。
   *
   * 第二个形参在 registry 视角固定为 `never`：各 adapter 的第二参（敏感输入 / Redis 可达性）
   * 语义各异，registry 只用于 lease lifecycle 与绕过检测，不允许经 registry 透传敏感输入。
   */
  call: (
    params: AdapterCallParams,
    secretInputs?: never,
    manager?: TenantConnectionPoolManager,
  ) => Promise<AdapterFixtureResult>
  /** 标注该 adapter 是否 fixture-first（默认 true） */
  fixtureFirst: boolean
}

/**
 * 高风险 adapter 注册表：resourceKey → adapter。
 * enforcement 测试据此断言每个高风险 catalog entry 都有 adapter（无绕过）。
 */
export const ADAPTER_REGISTRY: readonly RegisteredAdapter[] = [
  {
    resourceKey: 'db:primary',
    poolKind: 'database',
    call: callDatabaseFixture,
    fixtureFirst: true,
  },
  {
    resourceKey: 'ai:gateway',
    poolKind: 'provider',
    call: callAiGatewayFixture,
    fixtureFirst: true,
  },
  { resourceKey: 'ai:draft', poolKind: 'provider', call: callAiDraftFixture, fixtureFirst: true },
  {
    resourceKey: 'ocr:provider',
    poolKind: 'provider',
    call: callOcrProviderFixture,
    fixtureFirst: true,
  },
  {
    resourceKey: 'kms:envelope',
    poolKind: 'provider',
    call: callKmsEnvelopeFixture,
    fixtureFirst: true,
  },
  {
    resourceKey: 'dlp:engine',
    poolKind: 'provider',
    call: callDlpEngineFixture,
    fixtureFirst: true,
  },
  {
    resourceKey: 'watermark:renderer',
    poolKind: 'provider',
    call: callWatermarkRendererFixture,
    fixtureFirst: true,
  },
  {
    resourceKey: 'compliance:evaluator',
    poolKind: 'provider',
    call: callComplianceEvaluatorFixture,
    fixtureFirst: true,
  },
  {
    resourceKey: 'integration:webhook',
    poolKind: 'provider',
    call: callIntegrationWebhookFixture,
    fixtureFirst: true,
  },
  {
    resourceKey: 'compiler:run',
    poolKind: 'job',
    call: callCompilerRunFixture,
    fixtureFirst: true,
  },
  {
    resourceKey: 'compiler:artifact',
    poolKind: 'job',
    call: callCompilerArtifactFixture,
    fixtureFirst: true,
  },
  {
    resourceKey: 'export:report',
    poolKind: 'export',
    call: callExportReportFixture,
    fixtureFirst: true,
  },
  {
    resourceKey: 'export:ocr_privacy',
    poolKind: 'export',
    call: callExportOcrPrivacyFixture,
    fixtureFirst: true,
  },
  { resourceKey: 'report:job', poolKind: 'job', call: callReportJobFixture, fixtureFirst: true },
  { resourceKey: 'job:worker', poolKind: 'job', call: callJobWorkerFixture, fixtureFirst: true },
  { resourceKey: 'cache:redis', poolKind: 'cache', call: callCacheFixture, fixtureFirst: true },
]

/**
 * 校验 adapter registry 覆盖全部高风险 catalog entry（enforcement boundary）。
 * 返回缺失的 resourceKey 列表（空 = 全覆盖）。
 *
 * 对应 spec「Wrapper bypass」scenario：高风险资源无对应 adapter 时，此函数返回非空，
 * 测试据此失败并指出缺失的 resourceKey。
 */
export function findUncoveredHighRiskResources(): string[] {
  const highRisk = TenantConnectionPoolCatalog.highRiskEntries()
  const registered = new Set(ADAPTER_REGISTRY.map((a) => a.resourceKey))
  return highRisk.filter((entry) => !registered.has(entry.resourceKey)).map((e) => e.resourceKey)
}

/**
 * 按 resourceKey 取已登记 adapter（不存在返回 undefined）。
 */
export function getAdapter(resourceKey: string): RegisteredAdapter | undefined {
  return ADAPTER_REGISTRY.find((a) => a.resourceKey === resourceKey)
}
