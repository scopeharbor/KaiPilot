/**
 * v2-5-compiler-cache-management-api —— CompilerCacheService（切片 1/2/3）。
 *
 * 切片 1：只读盘点（storeKind + 组织范围条目计数 + 有限条低敏 key-hash + 生效 cachePolicyVersion
 *         + stage cache enabled 解析值），可按 stageId 细分。
 * 切片 2：只读失效预览（将被清除条目计数 + 低敏 key-hash refs + 与当前盘点差异，不删不执行）。
 * 切片 3：受控按范围失效（需显式确认 → invalidateByScope → 低敏审计）。
 *
 * 全部强制 organizationId 隔离（由 CacheStore 的 `org:<orgId>:` 命名空间前缀结构性保证）。
 *
 * 边界红线：
 * - 只**盘点与失效**缓存内容；不治理缓存策略选择（TTL/storeKind/cachePolicyVersion 设定归
 *   compiler-config-management-api），本服务只**读取**生效 cachePolicyVersion 用于低敏展示。
 * - 不改 StageCacheService 命中/重算/指纹语义（归 compiler-stage-cache-wiring）。
 * - 失效只清瞬时加速层：不删业务数据/artifact、不触发 Compiler run、不 apply artifact。
 */
import { resolveCacheStore } from '#services/cache/cache_factory'
import type { CacheStore } from '#services/cache/cache_store'
import { getEffectiveConfig } from '#services/compiler/compiler_config_service'
import { isCompilerStageCacheEnabledForOrg } from '#services/compiler/stage_cache_service'
import AuditService from '#services/audit_service'
import type {
  CacheInvalidationScope,
  CacheInventoryResponse,
  CacheInvalidationScopeRequest,
  CacheInvalidationPreviewResponse,
  CacheInvalidationRequest,
  CacheInvalidationResponse,
} from '@aiproj/types/compiler-cache-management'

/** cachePolicyVersion 折叠进指纹哈希、不在键前缀，失效降级为 organization 级的说明（design D6）。 */
const CACHE_POLICY_VERSION_DEGRADE_NOTE =
  'cachePolicyVersion 折叠进缓存指纹哈希、不在键前缀，无法纯前缀精确匹配，降级为 organization 级失效'
const SAFE_CACHE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/

function assertSafeCacheIdentifier(value: string, field: string) {
  if (!SAFE_CACHE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${field} 含非法字符，仅允许字母、数字、下划线、短横线和点`)
  }
}

/** 范围解析结果：keyPrefix + 是否降级 + 说明。 */
interface ScopeResolution {
  keyPrefix: string
  degraded: boolean
  note?: string
}

/**
 * 失效范围 → CacheStore keyPrefix 映射（design D6）。
 * - organization → `''`（整个 `org:<orgId>:` 命名空间）
 * - stage → `stage:<stageId>:`（必带 stageId，对齐 stage_cache_fingerprint 键格式）
 * - cachePolicyVersion → 折叠进指纹哈希、无前缀，降级为 organization 级（`''`）
 *
 * 受控枚举 + 显式映射结构性拒绝任意前缀/键匹配。
 */
function resolveScope(scope: CacheInvalidationScope, stageId?: string): ScopeResolution {
  switch (scope) {
    case 'organization':
      return { keyPrefix: '', degraded: false }
    case 'stage':
      if (!stageId || stageId.length === 0) {
        throw new Error('stage 范围必须提供 stageId')
      }
      assertSafeCacheIdentifier(stageId, 'stageId')
      return { keyPrefix: `stage:${stageId}:`, degraded: false }
    case 'cachePolicyVersion':
      return { keyPrefix: '', degraded: true, note: CACHE_POLICY_VERSION_DEGRADE_NOTE }
    default: {
      // 受控枚举兜底：未知范围一律拒绝（不接受任意键匹配）。
      const never: never = scope
      throw new Error(`未知失效范围: ${String(never)}`)
    }
  }
}

// =============================================================================
// 切片 1 —— 只读盘点
// =============================================================================

/**
 * 组织范围缓存盘点。
 * 经工厂解析当前生效 store 做盘点聚合，可按 stageId 细分；解析生效 cachePolicyVersion
 * 与 stage cache enabled。全部强制 organizationId 隔离，只返回低敏字段。
 */
export async function getCacheInventory(
  organizationId: number,
  stageId?: string,
  storeOverride?: CacheStore,
): Promise<CacheInventoryResponse> {
  const store = storeOverride ?? (await resolveCacheStore())
  if (stageId && stageId.length > 0) assertSafeCacheIdentifier(stageId, 'stageId')
  const keyPrefix = stageId && stageId.length > 0 ? `stage:${stageId}:` : ''
  const inv = await store.inventory(organizationId, keyPrefix)

  const config = await getEffectiveConfig(organizationId)
  const stageCacheEnabled = await isCompilerStageCacheEnabledForOrg(organizationId)

  return {
    organizationId,
    storeKind: inv.storeKind,
    count: inv.count,
    sampleKeyHashes: inv.sampleKeyHashes,
    cachePolicyVersion: config.cachePolicyVersion,
    stageCacheEnabled,
    ...(inv.degraded ? { degraded: true } : {}),
    ...(stageId && stageId.length > 0 ? { stageId } : {}),
  }
}

// =============================================================================
// 切片 2 —— 只读失效预览 / 差异
// =============================================================================

/**
 * 失效预览（只读，no-delete/no-execute）。
 * 复用 `inventory` 算「将被清除条目计数 + 低敏 key-hash refs」+ 与当前组织盘点的差异（剩余计数）。
 * 绝不删除任何条目、不触发任何 Compiler run。
 */
export async function previewCacheInvalidation(
  organizationId: number,
  req: CacheInvalidationScopeRequest,
  storeOverride?: CacheStore,
): Promise<CacheInvalidationPreviewResponse> {
  const scopeRes = resolveScope(req.scope, req.stageId)
  const store = storeOverride ?? (await resolveCacheStore())

  // 组织总盘点（用于差异：失效后剩余计数）。
  const totalInv = await store.inventory(organizationId, '')
  // 将被清除的范围盘点（org/cachePolicyVersion 降级为整组织，与 totalInv 同前缀可复用）。
  const affectedInv =
    scopeRes.keyPrefix === '' ? totalInv : await store.inventory(organizationId, scopeRes.keyPrefix)

  const remainingCount = Math.max(0, totalInv.count - affectedInv.count)
  const degraded = scopeRes.degraded || Boolean(affectedInv.degraded) || Boolean(totalInv.degraded)

  return {
    organizationId,
    scope: req.scope,
    affectedCount: affectedInv.count,
    sampleKeyHashes: affectedInv.sampleKeyHashes,
    remainingCount,
    ...(degraded ? { degraded: true } : {}),
    ...(scopeRes.note ? { note: scopeRes.note } : {}),
  }
}

// =============================================================================
// 切片 3 —— 受控失效写入
// =============================================================================

/**
 * 受控按范围失效（需显式确认）。
 * confirm=true → `invalidateByScope` 按范围清除 → 返回实际清除计数与低敏摘要 → 写低敏审计。
 * 只清瞬时加速层：不删业务数据、不触发 run、不 apply artifact。
 */
export async function invalidateCache(
  organizationId: number,
  userId: number,
  req: CacheInvalidationRequest,
  storeOverride?: CacheStore,
): Promise<CacheInvalidationResponse> {
  if (req.confirm !== true) {
    throw new Error('缓存失效必须显式确认（confirm=true）')
  }

  const scopeRes = resolveScope(req.scope, req.stageId)
  const store = storeOverride ?? (await resolveCacheStore())
  const result = await store.invalidateByScope(organizationId, scopeRes.keyPrefix)

  const degraded = scopeRes.degraded || Boolean(result.degraded)

  // 低敏审计：who/when/scope/清除计数/摘要，无缓存值正文/raw key。
  await new AuditService().log({
    event: 'AI_COMPILER_CACHE_INVALIDATED',
    userId,
    organizationId,
    metadata: {
      scope: req.scope,
      ...(req.stageId ? { stageId: req.stageId } : {}),
      removedCount: result.removedCount,
      storeKind: result.storeKind,
      degraded,
      action: 'invalidate',
    },
  })

  return {
    organizationId,
    scope: req.scope,
    removedCount: result.removedCount,
    ...(degraded ? { degraded: true } : {}),
    ...(scopeRes.note ? { note: scopeRes.note } : {}),
  }
}
