// @aiproj/backend — TenantDegradedModeService（v3-multitenant-isolation-architecture §5.6）。
//
// 可选缓存不可用、邻域 adapter 未 apply 或 registry 条目降级时的**安全降级**路径。
//
// 唯一不变量：降级只允许损失性能与新鲜度，**不允许损失隔离**。
// 具体表现为三条硬规则：
// 1. 缓存读到的值若不属于当前租户命名空间，一律按 miss 处理并丢弃（不返回、不复用）；
// 2. 缓存层任何异常都降级为「重新在 scope 内计算」，绝不回退到未界定范围的数据源；
// 3. 邻域 adapter 不可用时返回 `unavailable`/`degrade` 低敏信封，绝不放行到无 scope 分支。
//
// 本机 SQLite + 无 Redis 是默认开发路径：缓存缺失走内存实现或直接重算，全程可用。

import {
  buildMultitenantWarning,
  type MultitenantDecisionEnvelope,
  type MultitenantResourceType,
} from '@aiproj/types/multitenant-isolation-architecture'
import TenantScopeRegistry from './tenant_scope_registry.js'
import TenantNamespaceService, { type TenantNamespaceScope } from './tenant_namespace_service.js'

/** 共享契约 `buildMultitenantWarning` 的返回形状（该模块未导出具名类型）。 */
export type TenantWarning = ReturnType<typeof buildMultitenantWarning>

/** 最小缓存接口（与 `app/services/cache/cache_store.ts` 的 CacheStore 子集兼容）。 */
export interface TenantCacheLike {
  get(organizationId: number, key: string): Promise<string | null>
  set(organizationId: number, key: string, value: string, ttlSeconds: number): Promise<void>
}

/** 缓存包裹结果：值 + 生成时所属命名空间（用于消费前归属复核）。 */
interface NamespacedEnvelope {
  ns: string
  v: unknown
}

export interface TenantCacheOutcome<T> {
  value: T
  /** 'hit' = 命中且命名空间校验通过；其余均已在 scope 内重算。 */
  source: 'hit' | 'miss' | 'degraded'
  warning: TenantWarning | null
}

export default class TenantDegradedModeService {
  constructor(private namespaces: TenantNamespaceService = new TenantNamespaceService()) {}

  /**
   * 租户安全的 read-through 缓存。
   *
   * 命中值会先做命名空间归属复核：不属于当前 scope（旧 key、跨租户残留、格式漂移）
   * 一律丢弃并重算，绝不返回。缓存读写异常降级为重算并附低敏 warning。
   */
  async cacheOrCompute<T>(params: {
    scope: TenantNamespaceScope
    label: string
    parts?: Record<string, unknown>
    ttlSeconds: number
    cache: TenantCacheLike | null
    /** 必须是**已在租户 scope 内**完成过滤的计算（design Decision 4）。 */
    compute: () => Promise<T>
  }): Promise<TenantCacheOutcome<T>> {
    const key = this.namespaces.cacheKey(params.scope, params.label, params.parts)
    const ns = this.namespaces.namespace(params.scope)

    if (!params.cache) {
      // 可选缓存未配置：本机默认路径，直接重算，不算异常。
      return { value: await params.compute(), source: 'miss', warning: null }
    }

    let raw: string | null = null
    try {
      raw = await params.cache.get(params.scope.organizationId, key)
    } catch {
      return {
        value: await params.compute(),
        source: 'degraded',
        warning: this.adapterWarning(),
      }
    }

    if (raw !== null) {
      const envelope = this.parseEnvelope(raw)
      // 命名空间不符即视为 miss——这是"旧 cross-tenant key 不得复用"的执行点。
      if (envelope && envelope.ns === ns) {
        return { value: envelope.v as T, source: 'hit', warning: null }
      }
    }

    const value = await params.compute()
    try {
      await params.cache.set(
        params.scope.organizationId,
        key,
        JSON.stringify({ ns, v: value } satisfies NamespacedEnvelope),
        params.ttlSeconds,
      )
    } catch {
      // 写失败不影响正确性，只损失下次命中。
      return { value, source: 'degraded', warning: this.adapterWarning() }
    }
    return { value, source: 'miss', warning: null }
  }

  /**
   * registry 降级状态查询（§4.6 的运行时对应物）。
   * `degraded`/`unsupported` 资源返回低敏 warning，调用方据此收敛能力而非放宽 scope。
   */
  resolveRegistryDegradation(resourceType: MultitenantResourceType): TenantWarning | null {
    const status = TenantScopeRegistry.statusOf(resourceType)
    if (status === 'registered') return null
    return status === 'unsupported'
      ? buildMultitenantWarning({
          code: 'UNSUPPORTED_TENANT_RESOURCE',
          reasonCode: 'UNSUPPORTED_RESOURCE',
          // 只说明能力状态，不带资源名/计数/归属组织。
          message: '该资源类型暂不支持租户范围访问',
        })
      : buildMultitenantWarning({
          code: 'DEGRADED_ADAPTER_MODULE',
          reasonCode: 'DEGRADED_RESOURCE',
          message: '该资源类型的租户范围能力当前为降级状态',
        })
  }

  /**
   * 邻域 adapter（AI/OCR/KMS/Webhook/连接池等）不可用时的统一处理。
   *
   * 关键点：`unsupported` 资源**先于**执行被拒（不得因 adapter 恰好可用就放行），
   * adapter 异常返回 `unavailable` 信封而不是抛到无 scope 的兜底分支。
   */
  async runWithAdapterFallback<T>(params: {
    resourceType: MultitenantResourceType
    run: () => Promise<T>
  }): Promise<{ envelope: MultitenantDecisionEnvelope; value: T | null }> {
    if (TenantScopeRegistry.statusOf(params.resourceType) === 'unsupported') {
      return {
        envelope: { decision: 'deny', reasonCode: 'UNSUPPORTED_RESOURCE' },
        value: null,
      }
    }
    try {
      const value = await params.run()
      const degraded = TenantScopeRegistry.statusOf(params.resourceType) === 'degraded'
      return {
        envelope: {
          decision: degraded ? 'degrade' : 'allow',
          reasonCode: degraded ? 'DEGRADED_RESOURCE' : 'OK',
        },
        value,
      }
    } catch {
      return {
        envelope: { decision: 'unavailable', reasonCode: 'DEGRADED_RESOURCE' },
        value: null,
      }
    }
  }

  private adapterWarning(): TenantWarning {
    return buildMultitenantWarning({
      code: 'DEGRADED_ADAPTER_MODULE',
      reasonCode: 'DEGRADED_RESOURCE',
      message: '可选缓存不可用，已在租户范围内重新计算',
    })
  }

  private parseEnvelope(raw: string): NamespacedEnvelope | null {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object') return null
      const e = parsed as Record<string, unknown>
      return typeof e.ns === 'string' ? { ns: e.ns, v: e.v } : null
    } catch {
      return null
    }
  }
}
