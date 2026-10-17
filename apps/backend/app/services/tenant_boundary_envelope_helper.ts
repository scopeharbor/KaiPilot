// @aiproj/backend — TenantBoundaryEnvelopeHelper（v3-multitenant-api §4.1 / §6.4）。
//
// 把 tenant-bound API 边界的低敏 decision metadata 安全合并进成功响应 envelope，
// **不改变既有 `{ data, meta }` 与 `{ error }` 顶层形状**（spec：Response metadata
// remains low-sensitive）。Controller 在组装 list/detail 响应时调用，把服务端已挂的
// `ctx.tenantApiBoundary`（由 tenant_api_boundary_middleware 产出）派生为 low-sensitive
// 字段追加。
//
// 只允许透传低敏字段（requestId/tenantScopeHash/cacheNamespace/scopeMode/reasonCode/
// warnings），绝不透传权限 allowlist、隐藏资源名/计数/source hash/来源/raw provider。
// 未挂载 boundary metadata 时返回原 envelope 不变（legacy 兼容），保持接口最小侵入。

import type { ApiDecisionMetadata } from '@aiproj/types/multitenant-api-boundary'

/** list envelope 的 meta 形状（服务端分页字段 + 可选低敏 tenant 块）。 */
export interface TenantListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
  tenant?: TenantBoundaryEnvelope
}

/** 成功响应可选携带的低敏 tenant 块（只含低敏字段）。 */
export interface TenantBoundaryEnvelope {
  requestId: string
  tenantScopeHash: string
  cacheNamespace: string
  scopeMode: string
  reasonCode: string
  warnings: string[]
}

/** 从 boundary decision metadata 派生低敏响应块；无 boundary 返回 null。 */
export function lowSensitiveTenantBlock(
  boundary?: ApiDecisionMetadata | null,
): TenantBoundaryEnvelope | null {
  if (!boundary) return null
  return {
    requestId: boundary.requestId,
    tenantScopeHash: boundary.tenantScopeHash,
    cacheNamespace: boundary.cacheNamespace,
    scopeMode: boundary.scopeMode,
    reasonCode: boundary.reasonCode,
    warnings: boundary.warnings ?? [],
  }
}

/** 给 list envelope 追加 low-sensitive tenant meta；无 boundary 时原样返回。 */
export function withTenantBoundaryListMeta<T>(
  boundary: ApiDecisionMetadata | null | undefined,
  envelope: { data: T[]; meta: TenantListMeta },
): { data: T[]; meta: TenantListMeta } {
  const block = lowSensitiveTenantBlock(boundary)
  if (!block) return envelope
  return { data: envelope.data, meta: { ...envelope.meta, tenant: block } }
}

/** 给 detail envelope 追加 low-sensitive tenant meta；无 boundary 时原样返回。 */
export function withTenantBoundaryDetailMeta<T extends { data: unknown }>(
  boundary: ApiDecisionMetadata | null | undefined,
  envelope: T,
): T & { tenantApiBoundary?: TenantBoundaryEnvelope } {
  const block = lowSensitiveTenantBlock(boundary)
  if (!block) return envelope
  return { ...envelope, tenantApiBoundary: block }
}
