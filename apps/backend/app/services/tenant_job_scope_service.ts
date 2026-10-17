// @aiproj/backend — TenantJobScopeService（v3-multitenant-isolation-architecture §5.4）。
//
// spec「Async work MUST carry tenant scope and revalidate before side effects」：
// 后台作业、定时任务、流式生产者、批处理、导出构建、KMS rewrap、DLP 扫描、水印渲染、
// 合规证据打包与 Compiler run 续跑，必须携带低敏 `TenantScopeSnapshot`；执行时必须
// **在写入、provider 调用、artifact 生成、通知与 ledger 事件之前**重新校验：
// 组织归属、actor/服务账号权限、资源可见性与幂等性。
//
// 无租户 scope 的作业只允许是**显式登记**的 system-global 维护任务，且不得读租户业务数据。
//
// 本 service 只提供 build / serialize / parse / revalidate 与 system-global 门禁；
// 不代替各作业自身的 RBAC 判定，也不执行任何副作用（design Decision 5）。

import { PermissionDeniedException } from '#exceptions/api_exception'
import {
  buildTenantScopeSnapshot,
  detectMultitenantForbiddenKeysDeep,
  isMultitenantScopeMode,
  mtComputePermissionSnapshotHash,
  mtComputeOrganizationScopeHash,
  type MultitenantDecisionEnvelope,
  type MultitenantResourceType,
  type MultitenantScopeMode,
  type TenantContext,
  type TenantScopeSnapshot,
} from '@aiproj/types/multitenant-isolation-architecture'

/**
 * 显式登记的 system-global 维护任务白名单。
 *
 * 只有登记项允许在**没有** `TenantScopeSnapshot` 的情况下运行，且必须满足：
 * 不读租户业务数据，只返回低敏全局健康/计数。新增维护任务必须同步本表与
 * `tests/unit/tenant_job_scope_service.spec.ts`，否则默认拒绝（fail closed）。
 */
export const SYSTEM_GLOBAL_MAINTENANCE_JOBS: Readonly<Record<string, string>> = {
  // `app/commands/outgoing_webhook_run_due.ts`：按到期时间扫描投递队列。
  // 组织归属在每条投递记录上重新解析，命令本身不聚合跨租户业务数据。
  outgoing_webhook_run_due: '按到期时间驱动外发投递队列（逐条重解析组织归属）',
  // 缓存过期清理：只按 TTL 删除物理键，不读取值、不返回计数明细。
  cache_expiry_sweep: '缓存 TTL 清理（不读值、不返回租户维度计数）',
}

export interface TenantJobRevalidationInput {
  snapshot: TenantScopeSnapshot
  /**
   * 执行时**重新解析**出的 actor 组织成员关系。
   * null 表示已不再是任何组织成员（membership 过期/被移除）。
   */
  currentMembership: {
    organizationId: number
    roleVersion: number
    active: boolean
  } | null
  /**
   * 执行时重新解析出的目标资源归属组织。
   * - `undefined`：本作业不绑定具体资源，跳过归属复核
   * - `null`：资源已不存在或对当前 scope 不可见
   */
  currentResourceOwnerOrganizationId?: number | null
  /** 幂等键是否已被消费过（true = 重复执行，须拒绝以免重复副作用）。 */
  idempotencyConsumed?: boolean
}

export default class TenantJobScopeService {
  /**
   * 入队时构建低敏快照。
   * sourceRefs 必须已经是低敏引用（资源 hash 或低敏 id），此处强制扫描禁止字段。
   */
  buildSnapshot(params: {
    tenant: TenantContext
    roleVersion: number
    sourceRefs: string[]
    idempotencyKey: string
    requestId: string
    resourceType?: MultitenantResourceType | null
    issuedAt?: string
  }): TenantScopeSnapshot {
    const snapshot = buildTenantScopeSnapshot({
      actorRef: params.tenant.actorRef,
      organizationId: params.tenant.organizationId,
      projectId: params.tenant.projectId ?? null,
      scopeMode: params.tenant.scopeMode,
      sourceRefs: params.sourceRefs,
      permissionSnapshotHash: mtComputePermissionSnapshotHash({
        roleVersion: params.roleVersion,
        organizationId: params.tenant.organizationId,
        scopeMode: params.tenant.scopeMode,
      }),
      idempotencyKey: params.idempotencyKey,
      requestId: params.requestId,
      resourceType: params.resourceType ?? null,
      issuedAt: params.issuedAt,
    })
    this.assertLowSensitive(snapshot)
    return snapshot
  }

  /** 持久化形态：稳定 JSON 字符串，可直接存进作业 payload 列。 */
  serialize(snapshot: TenantScopeSnapshot): string {
    this.assertLowSensitive(snapshot)
    return JSON.stringify(snapshot)
  }

  /**
   * 从持久化形态还原。结构非法一律 fail closed——
   * 作业宁可不跑，也不能在缺失/损坏的 scope 下产生副作用。
   */
  parse(raw: unknown): TenantScopeSnapshot {
    let parsed: unknown = raw
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new PermissionDeniedException('作业租户快照无效')
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new PermissionDeniedException('作业租户快照无效')
    }
    const s = parsed as Record<string, unknown>
    const organizationId = Number(s.organizationId)
    const requiredStrings = [
      'actorRef',
      'organizationScopeHash',
      'permissionSnapshotHash',
      'idempotencyKey',
      'requestId',
      'issuedAt',
    ]
    const missing =
      !Number.isFinite(organizationId) ||
      organizationId <= 0 ||
      !Array.isArray(s.sourceRefs) ||
      !isMultitenantScopeMode(s.scopeMode) ||
      requiredStrings.some((k) => typeof s[k] !== 'string' || (s[k] as string).length === 0)
    if (missing) {
      throw new PermissionDeniedException('作业租户快照无效')
    }
    // scope hash 必须与 organizationId 自洽，防止篡改 organizationId 后继续复用快照。
    if (s.organizationScopeHash !== mtComputeOrganizationScopeHash(organizationId)) {
      throw new PermissionDeniedException('作业租户快照无效')
    }
    const snapshot = parsed as TenantScopeSnapshot
    this.assertLowSensitive(snapshot)
    return snapshot
  }

  /**
   * 执行前复核（**必须在任何副作用之前调用**）。
   *
   * 判定顺序按"最不泄露"排列，全部返回低敏 reason code，不携带资源名/计数：
   * 1. membership 缺失或失效 → STALE_MEMBERSHIP
   * 2. 当前组织与快照组织不一致（组织切换后旧作业）→ ORGANIZATION_MISMATCH
   * 3. 权限快照 hash 变化（roleVersion/scopeMode 变更）→ STALE_SCOPE
   * 4. 目标资源不可见 → RESOURCE_NOT_FOUND；归属已变更 → RESOURCE_OWNERSHIP_CHANGED
   * 5. 幂等键已消费 → REPLAY_ATTEMPT
   */
  revalidate(input: TenantJobRevalidationInput): MultitenantDecisionEnvelope {
    const { snapshot, currentMembership } = input

    if (!currentMembership || !currentMembership.active) {
      return { decision: 'deny', reasonCode: 'STALE_MEMBERSHIP' }
    }
    if (Number(currentMembership.organizationId) !== Number(snapshot.organizationId)) {
      return { decision: 'deny', reasonCode: 'ORGANIZATION_MISMATCH' }
    }

    const expectedPermissionHash = mtComputePermissionSnapshotHash({
      roleVersion: currentMembership.roleVersion,
      organizationId: snapshot.organizationId,
      scopeMode: snapshot.scopeMode as MultitenantScopeMode,
    })
    if (expectedPermissionHash !== snapshot.permissionSnapshotHash) {
      return { decision: 'deny', reasonCode: 'STALE_SCOPE' }
    }

    if (input.currentResourceOwnerOrganizationId !== undefined) {
      if (input.currentResourceOwnerOrganizationId === null) {
        return { decision: 'deny', reasonCode: 'RESOURCE_NOT_FOUND' }
      }
      if (Number(input.currentResourceOwnerOrganizationId) !== Number(snapshot.organizationId)) {
        return { decision: 'deny', reasonCode: 'RESOURCE_OWNERSHIP_CHANGED' }
      }
    }

    if (input.idempotencyConsumed) {
      return { decision: 'deny', reasonCode: 'REPLAY_ATTEMPT' }
    }

    return { decision: 'allow', reasonCode: 'OK' }
  }

  /** 抛出版：拒绝时统一 PERMISSION_DENIED，不把 reason code 写进 message。 */
  assertRevalidated(input: TenantJobRevalidationInput): MultitenantDecisionEnvelope {
    const verdict = this.revalidate(input)
    if (verdict.decision !== 'allow') {
      throw new PermissionDeniedException('作业租户范围已失效')
    }
    return verdict
  }

  /**
   * 无 scope 作业门禁：只有 `SYSTEM_GLOBAL_MAINTENANCE_JOBS` 登记项可运行。
   * 未登记的无 scope 作业一律拒绝（default-deny，与 registry 的全局门一致）。
   */
  assertSystemGlobalJob(jobName: string): void {
    if (!Object.prototype.hasOwnProperty.call(SYSTEM_GLOBAL_MAINTENANCE_JOBS, jobName)) {
      throw new PermissionDeniedException('作业缺少租户范围')
    }
  }

  /** 判定版，供调度器在不抛异常的情况下分流。 */
  isSystemGlobalJob(jobName: string): boolean {
    return Object.prototype.hasOwnProperty.call(SYSTEM_GLOBAL_MAINTENANCE_JOBS, jobName)
  }

  /** 快照低敏校验：禁止把 secret/prompt/模型输出/文件正文/绝对路径带进作业负载。 */
  private assertLowSensitive(snapshot: TenantScopeSnapshot): void {
    if (detectMultitenantForbiddenKeysDeep(snapshot).length > 0) {
      throw new PermissionDeniedException('作业租户快照包含禁止字段')
    }
  }
}
