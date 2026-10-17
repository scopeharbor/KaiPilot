// @aiproj/backend — TenantNamespaceService（v3-multitenant-isolation-architecture §5.2）。
//
// spec「Derived artifacts, cache keys and signatures MUST be tenant namespaced」：
// 缓存键、预览签名、导出句柄、下载 token、artifact ref、source snapshot、
// idempotency key 与 ledger 分组 hash，在**持久化、比对或返回之前**必须带上
// tenant namespace 或 organization scope hash。
//
// 本 service 只做命名与校验，不碰存储；哈希与稳定序列化复用 `@aiproj/types` 的
// 共享实现（design Decision 4：派生值必须在 scope 之后计算，且含 scope hash）。
//
// 低敏保证：命名空间只含 scope hash（16 位十六进制，不可反推组织名）与调用方给的
// 低敏 kind/ref；构造前对 parts 做禁止 key 扫描，防止把 secret/prompt/模型输出
// /文件正文/绝对路径写进可被日志与响应携带的键里。
//
// 与既有 `app/services/cache/cache_store.ts` 的 `namespacedKey` 的关系：
// 后者是 CacheStore 自身的 `aiproj:cache:org:<id>:` 物理前缀（保证不同组织的
// 物理键不碰撞）；本 service 生成的是**逻辑键**，用于那些不经 CacheStore 的派生值
// （签名/句柄/幂等键），两者可叠加，互不替代。

import { PermissionDeniedException } from '#exceptions/api_exception'
import {
  detectMultitenantForbiddenKeysDeep,
  mtComputeOrganizationScopeHash,
  mtComputeScopeHash,
  mtFnv1aHash,
  mtStableSerialize,
  type MultitenantResourceType,
} from '@aiproj/types/multitenant-isolation-architecture'

/** 命名空间版本：语义变更时递增，旧派生值整体失效（design Risk 缓解：可接受的安全刷新）。 */
export const TENANT_NAMESPACE_VERSION = 'v1'

/** 命名空间前缀，与 CacheStore 的物理前缀区分。 */
export const TENANT_NAMESPACE_PREFIX = 'mtns'

/** 受本 service 管理的派生值种类。 */
export const TENANT_DERIVED_KINDS = [
  'cache',
  'preview_signature',
  'export_handle',
  'artifact_ref',
  'source_snapshot',
  'idempotency',
  'ledger_group',
] as const
export type TenantDerivedKind = (typeof TENANT_DERIVED_KINDS)[number]

export interface TenantNamespaceScope {
  organizationId: number
  projectId?: number | null
}

/** 导出句柄：内容可下载之前必须已绑定 scope、actor、source hash 与过期时间。 */
export interface TenantExportHandle {
  handle: string
  namespace: string
  organizationScopeHash: string
  actorScopeHash: string
  sourceHash: string
  resourceType: MultitenantResourceType
  expiresAt: string
}

/** 预览签名：确认阶段据此拒绝跨租户回放。 */
export interface TenantPreviewSignature {
  signature: string
  namespace: string
  sourceHash: string
  issuedAt: string
}

export default class TenantNamespaceService {
  /**
   * 租户命名空间：`mtns:v1:<scopeHash>`。
   * scopeHash 由 org（+可选 project）派生，两个组织的同一逻辑键因此天然隔离。
   */
  namespace(scope: TenantNamespaceScope): string {
    if (!Number.isFinite(scope.organizationId) || scope.organizationId <= 0) {
      // 无有效组织 scope 时不得生成任何派生值命名空间（fail closed）。
      throw new PermissionDeniedException('需要组织上下文')
    }
    const scopeHash = mtComputeScopeHash({
      organizationId: scope.organizationId,
      projectId: scope.projectId ?? null,
    })
    return `${TENANT_NAMESPACE_PREFIX}:${TENANT_NAMESPACE_VERSION}:${scopeHash}`
  }

  /**
   * 逻辑派生键：`<namespace>:<kind>:<label>:<partsDigest>`。
   * parts 先做稳定序列化再 hash，保证键顺序无关且可复现。
   */
  derivedKey(
    scope: TenantNamespaceScope,
    kind: TenantDerivedKind,
    label: string,
    parts: Record<string, unknown> = {},
  ): string {
    this.assertLowSensitiveParts(parts)
    const digest = mtFnv1aHash(mtStableSerialize(parts))
    return `${this.namespace(scope)}:${kind}:${label}:${digest}`
  }

  /** 缓存键（查询/看板/报表/AI 上下文摘要/DLP 决策/KMS 用量摘要等）。 */
  cacheKey(scope: TenantNamespaceScope, label: string, parts?: Record<string, unknown>): string {
    return this.derivedKey(scope, 'cache', label, parts)
  }

  /** 幂等键：额外绑定 actor，避免同组织不同 actor 相互吞掉重试。 */
  idempotencyKey(
    scope: TenantNamespaceScope,
    actorRef: string,
    operation: string,
    parts: Record<string, unknown> = {},
  ): string {
    return this.derivedKey(scope, 'idempotency', operation, {
      ...parts,
      actorRefHash: mtFnv1aHash(actorRef),
    })
  }

  /** artifact ref / source snapshot ref：持久化前绑定 scope。 */
  artifactRef(scope: TenantNamespaceScope, label: string, parts?: Record<string, unknown>): string {
    return this.derivedKey(scope, 'artifact_ref', label, parts)
  }

  sourceSnapshotRef(
    scope: TenantNamespaceScope,
    label: string,
    parts?: Record<string, unknown>,
  ): string {
    return this.derivedKey(scope, 'source_snapshot', label, parts)
  }

  /** ledger 分组 hash：跨组织不得落到同一分组。 */
  ledgerGroupHash(scope: TenantNamespaceScope, parts: Record<string, unknown> = {}): string {
    return this.derivedKey(scope, 'ledger_group', 'group', parts)
  }

  /**
   * 预览签名（§5.3 防回放）：签名内容由 scope hash + source hash + operation 派生，
   * 组织 O1 生成的签名在 O2 的 scope 下重算必然不同 → `assertPreviewSignature` 拒绝。
   *
   * sourceHash 必须由调用方在**租户过滤之后**计算（design Decision 4）；
   * 本 service 不代算，避免把未过滤的数据引进来。
   */
  buildPreviewSignature(
    scope: TenantNamespaceScope,
    operation: string,
    sourceHash: string,
    issuedAt: string,
  ): TenantPreviewSignature {
    const namespace = this.namespace(scope)
    return {
      signature: this.derivedKey(scope, 'preview_signature', operation, {
        sourceHash,
        issuedAt,
      }),
      namespace,
      sourceHash,
      issuedAt,
    }
  }

  /**
   * 确认阶段校验预览签名：在当前租户 scope 下重算并做定长比较。
   * 跨租户回放、source 变更、operation 不符一律统一拒绝（不区分原因，避免侧信道），
   * 且必须在执行目标动作之前调用——拒绝路径零副作用。
   */
  assertPreviewSignature(
    scope: TenantNamespaceScope,
    operation: string,
    sourceHash: string,
    issuedAt: string,
    submittedSignature: string,
  ): void {
    const expected = this.buildPreviewSignature(scope, operation, sourceHash, issuedAt).signature
    if (!this.constantTimeEquals(expected, submittedSignature)) {
      throw new PermissionDeniedException('预览签名已失效')
    }
  }

  /**
   * 导出句柄（§5.2 spec「Export handle is scoped」）：可下载内容产生之前，
   * 句柄已绑定租户 scope、actor scope hash、source hash 与过期时间。
   */
  buildExportHandle(params: {
    scope: TenantNamespaceScope
    actorRef: string
    resourceType: MultitenantResourceType
    sourceHash: string
    expiresAt: string
  }): TenantExportHandle {
    const namespace = this.namespace(params.scope)
    const actorScopeHash = mtFnv1aHash(`${namespace}:actor:${params.actorRef}`)
    return {
      handle: this.derivedKey(params.scope, 'export_handle', params.resourceType, {
        actorScopeHash,
        sourceHash: params.sourceHash,
        expiresAt: params.expiresAt,
      }),
      namespace,
      organizationScopeHash: mtComputeOrganizationScopeHash(params.scope.organizationId),
      actorScopeHash,
      sourceHash: params.sourceHash,
      resourceType: params.resourceType,
      expiresAt: params.expiresAt,
    }
  }

  /**
   * 消费导出句柄：命名空间必须属于当前 scope，且未过期。
   * 跨租户句柄与过期句柄同一拒绝语义。
   */
  assertExportHandle(
    scope: TenantNamespaceScope,
    handle: TenantExportHandle,
    now: Date = new Date(),
  ): void {
    const expectedNamespace = this.namespace(scope)
    if (!this.constantTimeEquals(expectedNamespace, handle.namespace)) {
      throw new PermissionDeniedException('导出句柄已失效')
    }
    if (!handle.handle.startsWith(`${expectedNamespace}:`)) {
      throw new PermissionDeniedException('导出句柄已失效')
    }
    const expiry = Date.parse(handle.expiresAt)
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
      throw new PermissionDeniedException('导出句柄已失效')
    }
  }

  /**
   * 通用命名空间归属校验：任何已持久化的派生值在被复用之前都必须过这一关。
   * 这是"旧 cross-tenant key 不得继续复用"的执行点（design Risk 缓解）。
   */
  assertInNamespace(scope: TenantNamespaceScope, value: string): void {
    if (!value.startsWith(`${this.namespace(scope)}:`)) {
      throw new PermissionDeniedException('派生值不属于当前租户范围')
    }
  }

  /** 判定版（不抛异常），供降级路径按 miss 处理。 */
  isInNamespace(scope: TenantNamespaceScope, value: string): boolean {
    try {
      this.assertInNamespace(scope, value)
      return true
    } catch {
      return false
    }
  }

  /**
   * 键构造输入的低敏校验：禁止把 secret/token/prompt/模型输出/文件正文/绝对路径
   * 等写进派生键（键会进日志、响应与审计元数据）。
   */
  private assertLowSensitiveParts(parts: Record<string, unknown>): void {
    if (detectMultitenantForbiddenKeysDeep(parts).length > 0) {
      throw new PermissionDeniedException('派生值输入包含禁止字段')
    }
  }

  /** 定长比较，避免用比较耗时区分前缀匹配程度。 */
  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i += 1) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return diff === 0
  }
}
