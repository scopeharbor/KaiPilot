// v3-multitenant-api §7.1/§7.2 —— 前端租户 cache namespace 与 query key 派生（纯函数）。
//
// 前端不把本地 organizationId 当安全事实源：租户 cache namespace 只能从**服务端下发的**
// 低敏 decision metadata 派生（ApiDecisionMetadata.cacheNamespace / tenantScopeHash）。
// 本模块：
//   - tenantCacheScope：把服务端 envelope metadata 折算成租户 cache scope；
//     含 forbidden fields（secret/prompt/model_output…）的"伪低敏"metadata 一律判为 null（fail closed）。
//   - tenantQueryKey：把租户 scope 前缀并入 TanStack query key，跨租户不复用缓存。
//   - purgeTenantScopedCaches：组织切换/derivation 变更时按租户 hash 前缀清理租户派生缓存。
import {
  mapHasForbiddenKeys,
  type ApiDecisionMetadata,
} from '@aiproj/types/multitenant-api-boundary'

/** 从服务端 decision metadata 折算出的低敏租户 cache scope。 */
export interface TenantCacheScope {
  cacheNamespace: string
  tenantScopeHash: string
  scopeMode: string
}

/** 极简 QueryClient 形状（仅测试/工具需要，运行时跳过真实实现）。 */
export interface TenantQueryClientLike {
  removeQueries(filter: { queryKey: unknown[] }): unknown
}

export function tenantCacheScope(meta: unknown): TenantCacheScope | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Partial<ApiDecisionMetadata>
  if (!m.cacheNamespace || !m.tenantScopeHash) return null
  if (mapHasForbiddenKeys(m)) return null
  return {
    cacheNamespace: m.cacheNamespace,
    tenantScopeHash: m.tenantScopeHash,
    scopeMode: m.scopeMode ?? 'tenant',
  }
}

/** 把租户 cache scope 前缀并入 query key（跨租户不复用缓存、防 stale 渲染）。 */
export function tenantQueryKey(scope: TenantCacheScope | null, ...parts: unknown[]): unknown[] {
  return scope ? [scope.tenantScopeHash, scope.cacheNamespace, ...parts] : ['no-tenant', ...parts]
}

/**
 * 组织切换/derivation 失效时清理本租户派生的 query cache、preview/export/job/stream handle
 * 的租户 key。以 tenant scope hash 为根前缀移除。
 */
export function purgeTenantScopedCaches(
  queryClient: TenantQueryClientLike,
  tenantScopeHash: string,
): void {
  queryClient.removeQueries({ queryKey: [tenantScopeHash] })
}
