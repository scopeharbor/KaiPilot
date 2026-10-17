// @aiproj/backend — TenantJobPoolService（v3-multitenant-connection-pool-management §6.1-§6.4）。
//
// spec「Background Job Lease Snapshot」：
// - 入队：作业元数据必须携带低敏租户 scope snapshot、request id、幂等键、
//   pool resource keys 与权限快照 hash。
// - 执行：worker 恢复/重试时必须先校验快照，再重新获取所需 lease，
//   快照 stale / revoked / 跨租户时 fail closed，且**不得**产生任何副作用。
//
// 与既有能力的分工：
// - `TenantJobScopeService`（v3-multitenant-isolation-architecture）负责快照本身的
//   build / serialize / parse / revalidate 与 system-global 门禁；本服务复用它，不重写。
// - `TenantConnectionPoolCatalog` 负责预算事实源；未登记的 resourceKey 一律 fail closed。
// - `withTenantConnectionLease` 负责 acquire→执行→finally release。
//
// 本服务只做「作业维度的连接治理」：不代替作业自身的 RBAC 判定，也不执行业务副作用。

import { PermissionDeniedException } from '#exceptions/api_exception'
import TenantJobScopeService, {
  type TenantJobRevalidationInput,
} from '#services/tenant_job_scope_service'
import TenantConnectionPoolCatalog from '#services/tenant_connection_pool_catalog'
import { withTenantConnectionLease } from '#services/tenant_connection_pool_wrapper'
import type TenantConnectionPoolManager from '#services/tenant_connection_pool_manager'
import {
  tcpmBuildJobPoolMetadata,
  type TcpmJobPoolMetadata,
  type TcpmTenantConnectionLease,
} from '@aiproj/types/multitenant-connection-pool-management'
import {
  detectMultitenantForbiddenKeysDeep,
  type MultitenantResourceType,
  type TenantContext,
  type TenantScopeSnapshot,
} from '@aiproj/types/multitenant-isolation-architecture'

/**
 * worker 执行槽位资源键：所有受治理作业在执行期都必须先拿到它，
 * 再叠加各自声明的业务资源 lease（catalog `job:worker`）。
 */
export const JOB_WORKER_RESOURCE_KEY = 'job:worker'

export interface JobPoolScheduleInput {
  /** 服务端解析出的租户上下文（非客户端 body/query） */
  tenant: TenantContext
  /** 入队时的角色版本，用于权限快照 hash */
  roleVersion: number
  /** 低敏来源引用（资源 hash 或低敏 id） */
  sourceRefs: string[]
  idempotencyKey: string
  requestId: string
  resourceType?: MultitenantResourceType | null
  /** 该作业执行时需要获取 lease 的连接资源键（必须已在 catalog 登记） */
  poolResourceKeys: string[]
  issuedAt?: string
}

export interface JobPoolExecutionInput<T> {
  /** 持久化的作业连接池元数据（已 parse） */
  metadata: TcpmJobPoolMetadata
  /** 执行时重新解析出的成员关系/资源归属/幂等状态 */
  revalidation: Omit<TenantJobRevalidationInput, 'snapshot'>
  /** 低敏操作类型（进 metrics label） */
  operationKind: string
  /** 取消信号（worker 取消/超时） */
  abortSignal?: AbortSignal | null
  /** 在全部 lease 保护下执行的作业副作用 */
  run: (ctx: { leases: TcpmTenantConnectionLease[] }) => Promise<T>
  /** 可选 manager 注入（测试用 fake clock/metrics） */
  manager?: TenantConnectionPoolManager
}

export default class TenantJobPoolService {
  readonly #scopeService: TenantJobScopeService

  constructor(scopeService: TenantJobScopeService = new TenantJobScopeService()) {
    this.#scopeService = scopeService
  }

  // ── 入队（§6.1）──

  /**
   * 构建作业连接池元数据（入队时调用）。
   *
   * 未登记的 resourceKey 直接拒绝：作业不能在执行期才发现自己要用的连接资源
   * 没有预算声明（spec「Connection Resource Catalog / Missing catalog entry」）。
   */
  buildMetadata(input: JobPoolScheduleInput): TcpmJobPoolMetadata {
    this.#assertRegisteredResourceKeys(input.poolResourceKeys)

    const scopeSnapshot: TenantScopeSnapshot = this.#scopeService.buildSnapshot({
      tenant: input.tenant,
      roleVersion: input.roleVersion,
      sourceRefs: input.sourceRefs,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
      resourceType: input.resourceType ?? null,
      issuedAt: input.issuedAt,
    })

    const metadata = tcpmBuildJobPoolMetadata({
      scopeSnapshot,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      // worker 槽位始终隐含在内，调用方无需重复声明
      poolResourceKeys: this.#withWorkerSlot(input.poolResourceKeys),
      roleVersion: input.roleVersion,
      organizationId: input.tenant.organizationId,
      scopeMode: input.tenant.scopeMode,
    })

    this.#assertLowSensitive(metadata)
    return metadata
  }

  /** 持久化形态：稳定 JSON，可直接存进作业 payload 列。 */
  serialize(metadata: TcpmJobPoolMetadata): string {
    this.#assertLowSensitive(metadata)
    return JSON.stringify(metadata)
  }

  /**
   * 从持久化形态还原。结构非法一律 fail closed——
   * 作业宁可不跑，也不能在缺失/损坏的连接治理元数据下产生副作用。
   */
  parse(raw: unknown): TcpmJobPoolMetadata {
    let parsed: unknown = raw
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new PermissionDeniedException('作业连接元数据无效')
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new PermissionDeniedException('作业连接元数据无效')
    }
    const m = parsed as Record<string, unknown>
    const stringFields = ['requestId', 'idempotencyKey', 'permissionSnapshotHash']
    if (stringFields.some((k) => typeof m[k] !== 'string' || (m[k] as string).length === 0)) {
      throw new PermissionDeniedException('作业连接元数据无效')
    }
    if (!Array.isArray(m.poolResourceKeys) || m.poolResourceKeys.length === 0) {
      throw new PermissionDeniedException('作业连接元数据无效')
    }
    // snapshot 结构与 organizationId/scopeHash 自洽性交给既有 job scope service 校验
    const scopeSnapshot = this.#scopeService.parse(m.scopeSnapshot)
    const poolResourceKeys = m.poolResourceKeys as unknown[]
    if (poolResourceKeys.some((k) => typeof k !== 'string')) {
      throw new PermissionDeniedException('作业连接元数据无效')
    }
    this.#assertRegisteredResourceKeys(poolResourceKeys as string[])

    // 权限快照 hash 必须与快照内的一致，防止只改元数据绕过 revalidate
    if (m.permissionSnapshotHash !== scopeSnapshot.permissionSnapshotHash) {
      throw new PermissionDeniedException('作业连接元数据无效')
    }

    const metadata: TcpmJobPoolMetadata = {
      scopeSnapshot,
      requestId: m.requestId as string,
      idempotencyKey: m.idempotencyKey as string,
      poolResourceKeys: poolResourceKeys as string[],
      permissionSnapshotHash: m.permissionSnapshotHash as string,
    }
    this.#assertLowSensitive(metadata)
    return metadata
  }

  // ── 执行（§6.3）──

  /**
   * worker 执行入口：**先复核快照，再获取全部 lease，最后才执行副作用**。
   *
   * 顺序不可颠倒——stale/revoked/跨租户的作业必须在拿到任何连接资源之前就被拒绝，
   * 否则失效作业仍会占用他租的连接预算（spec「Job execution resumes」）。
   *
   * 所有 lease 在嵌套 wrapper 的 finally 中释放：成功、抛错、取消、超时、重试耗尽
   * 都不会泄漏 lease。
   */
  async runWithLeases<T>(input: JobPoolExecutionInput<T>): Promise<T> {
    const { metadata } = input

    // 1. 快照复核（副作用与 lease 之前）
    this.#scopeService.assertRevalidated({
      snapshot: metadata.scopeSnapshot,
      ...input.revalidation,
    })

    // 2. 资源键仍须在 catalog 中（部署间 catalog 收缩时 fail closed）
    this.#assertRegisteredResourceKeys(metadata.poolResourceKeys)

    // 3. 从快照还原租户上下文（不信任任何运行期传入的 organization id）
    const tenant: TenantContext = {
      organizationId: metadata.scopeSnapshot.organizationId,
      projectId: metadata.scopeSnapshot.projectId ?? null,
      scopeMode: metadata.scopeSnapshot.scopeMode,
      actorRef: metadata.scopeSnapshot.actorRef,
      isSuperAdmin: false,
    }

    // 4. 逐个获取 lease（worker 槽位在最外层），全部就绪后执行
    const ordered = this.#withWorkerSlot(metadata.poolResourceKeys)
    return this.#acquireChain(ordered, [], tenant, input)
  }

  async #acquireChain<T>(
    remaining: string[],
    acquired: TcpmTenantConnectionLease[],
    tenant: TenantContext,
    input: JobPoolExecutionInput<T>,
  ): Promise<T> {
    const [head, ...rest] = remaining
    if (head === undefined) {
      return input.run({ leases: acquired })
    }
    return withTenantConnectionLease(
      {
        resourceKey: head,
        operationKind: input.operationKind,
        tenant,
        requestId: input.metadata.requestId,
        idempotencyKey: input.metadata.idempotencyKey,
        abortSignal: input.abortSignal ?? null,
      },
      (lease) => this.#acquireChain(rest, [...acquired, lease], tenant, input),
      input.manager,
    )
  }

  // ── 内部校验 ──

  /** worker 槽位置顶且去重，保持 acquire 顺序稳定（避免不同作业互相死锁）。 */
  #withWorkerSlot(keys: readonly string[]): string[] {
    const rest = [...new Set(keys.filter((k) => k !== JOB_WORKER_RESOURCE_KEY))].sort()
    return [JOB_WORKER_RESOURCE_KEY, ...rest]
  }

  #assertRegisteredResourceKeys(keys: readonly string[]): void {
    for (const key of keys) {
      if (!TenantConnectionPoolCatalog.has(key)) {
        // 不把未登记的键回显进 message（避免探测 catalog 内容）
        throw new PermissionDeniedException('作业声明了未登记的连接资源')
      }
    }
  }

  /** 低敏校验：禁止把 JWT/secret/provider payload/完整身份信息带进作业元数据。 */
  #assertLowSensitive(metadata: TcpmJobPoolMetadata): void {
    if (detectMultitenantForbiddenKeysDeep(metadata).length > 0) {
      throw new PermissionDeniedException('作业连接元数据包含禁止字段')
    }
  }
}
