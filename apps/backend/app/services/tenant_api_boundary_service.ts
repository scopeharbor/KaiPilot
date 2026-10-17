// @aiproj/backend — TenantApiBoundaryService（v3-multitenant-api §3.4/§3.6）。
//
// tenant-bound request lifecycle 集中执行点（design Decision 2）：
//   auth/effective tenant -> route/resource ownership -> request hint consistency ->
//   API surface registry lookup -> RBAC/Policy handoff -> Service handoff。
//
// 本服务不替代 TenantScopeService（它负责"具体组织 scope 的解析与写入学派"），而是
// 在请求进入业务前做 **API 专属**的租户一致性 + registry 覆盖 + 非泄露错误映射：
//   - route/body/query 的 organizationId 只作一致性输入，不一致统一 RESOURCE_NOT_FOUND；
//   - registry 覆盖未知的 tenant-scoped route -> REGISTRY_GAP（新增 V3 route 漏登记即失败）；
//   - super admin 的 tenant-private 业务必须落到具体组织 scope（global 须显式 opt-in）；
//   - 拒绝/降级响应只回低敏 decision metadata（不泄露隐藏租户详情）。
//
// 纯函数 resolveBoundary() 不依赖 HttpContext，可在 unit suite 离线驱动；
// controllers/handlers 从 ctx 提取服务端已解析事实后调用，allowed=false 时再 handleNonLeaking。

import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import {
  mapAssertOrgConsistency,
  mapBuildDecisionEnvelope,
  type ApiBoundaryResolution,
  type ApiDecisionMetadata,
  type ApiOperationType,
  type ApiScopeMode,
  type ApiSurfaceDeclaration,
  type MapReasonCode,
  type MapWarningCode,
} from '@aiproj/types/multitenant-api-boundary'
import TenantApiSurfaceRegistry from './tenant_api_surface_registry.js'

/** 客户端提供的租户一致 hint（只作一致性输入，不作事实源）。 */
export interface TenantBoundaryHints {
  routeOrganizationId?: number | string | null
  bodyOrganizationId?: number | string | null
  queryOrganizationId?: number | string | null
}

/** resolveBoundary 的输入（全部为服务端已解析的低敏事实）。 */
export interface TenantBoundaryInput {
  requestId: string
  method: string
  routePattern: string
  /** 服务端解析出的具体组织（null = 无具体组织）。 */
  serverOrganizationId: number | null
  /** 已解析的租户 scope mode。 */
  scopeMode: ApiScopeMode
  scopeHash: string
  operation: ApiOperationType
  /** 客户端组织 hint（route/body/query）。 */
  hints?: Partial<TenantBoundaryHints>
  /** 可选：upstream 已查到的 surface（缺省自动按 method+pattern 查 registry）。 */
  surface?: ApiSurfaceDeclaration | null
}

/** resolve 结果信封。 */
export interface TenantBoundaryOutcome {
  resolution: ApiBoundaryResolution
  metadata?: ApiDecisionMetadata | null
}

export default class TenantApiBoundaryService {
  /**
   * 纯函数解析：registry 覆盖 + 具体组织 scope + hint 一致性 + scope mode 允许项。
   * 拒绝时返回 allowed=false + reasonCode/warning（不抛）；消费方随后 handleNonLeaking。
   */
  resolveBoundary(input: TenantBoundaryInput): TenantBoundaryOutcome {
    const surface =
      input.surface ?? TenantApiSurfaceRegistry.lookup(input.method, input.routePattern)

    const organizationId = input.serverOrganizationId
    const scopeHint = this.pickScopeHint(input.hints)

    // 1) 无具体组织：仅显式 global opt-in 路由可放行（super admin 全局低敏）。
    if (organizationId === null || organizationId === undefined) {
      if (surface?.isGlobalOptIn === true) {
        return this.allow(input, 'OK')
      }
      return this.deny(input, 'MISSING_TENANT', 'API_GLOBAL_LOW_SENSITIVE_ONLY')
    }

    // 2) tenant-scoped route 必须已登记（缺登记 -> REGISTRY_GAP 覆盖门禁）。
    if (!surface) {
      return this.deny(input, 'REGISTRY_GAP', 'API_REGISTRY_GAP')
    }

    // 3) scope hint 一致性：route/body/query 不允许扩大 scope。
    if (scopeHint !== null) {
      const cons = mapAssertOrgConsistency({
        serverOrganizationId: organizationId,
        clientOrganizationId: scopeHint.value,
        origin: scopeHint.origin,
      })
      if (!cons.allowed) {
        return this.deny(input, cons.reasonCode, cons.warning ?? 'API_CROSS_TENANT_BLOCKED')
      }
    }

    // 4) scope mode 允许项：业务路由必须落在 surface 声明的 mode 内。
    if (!surface.allowedScopeModes.includes(input.scopeMode)) {
      return this.deny(input, 'GLOBAL_NOT_ALLOWED', 'API_GLOBAL_LOW_SENSITIVE_ONLY')
    }

    return this.allow(input, 'OK')
  }

  /**
   * 把拒绝/降级 resolution 映射为非泄露 HTTP 错误：
   * 跨租户/隐藏资源一律 RESOURCE_NOT_FOUND（不泄露隐藏租户名/计数/hash/来源）；
   * 缺组织上下文/GLOBAL_NOT_ALLOWED -> PERMISSION_DENIED。
   */
  handleNonLeaking(resolution: ApiBoundaryResolution): never {
    const reason = resolution.reasonCode
    if (
      reason === 'MISSING_TENANT' ||
      reason === 'GLOBAL_NOT_ALLOWED' ||
      reason === 'PERMISSION_DENIED'
    ) {
      throw new PermissionDeniedException('需要组织上下文')
    }
    if (reason === 'REGISTRY_GAP') {
      throw new PermissionDeniedException('接口未登记租户边界')
    }
    throw new ResourceNotFoundException('资源不存在')
  }

  private deny(
    input: TenantBoundaryInput,
    reasonCode: MapReasonCode,
    warning?: MapWarningCode,
  ): TenantBoundaryOutcome {
    const metadata = mapBuildDecisionEnvelope({
      requestId: input.requestId,
      scopeHash: input.scopeHash,
      scopeMode: input.scopeMode,
      decision: 'deny',
      reasonCode,
      warnings: warning ? [warning] : [],
    })
    return {
      resolution: {
        allowed: false,
        decision: 'deny',
        reasonCode,
        warnings: warning ? [warning] : [],
        scopeMode: input.scopeMode,
        scopeHash: input.scopeHash,
        cacheNamespace: metadata.cacheNamespace,
        apiScope: metadata,
      },
      metadata,
    }
  }

  private allow(input: TenantBoundaryInput, reasonCode: MapReasonCode): TenantBoundaryOutcome {
    const metadata = mapBuildDecisionEnvelope({
      requestId: input.requestId,
      scopeHash: input.scopeHash,
      scopeMode: input.scopeMode,
      decision: 'allow',
      reasonCode,
    })
    return {
      resolution: {
        allowed: true,
        decision: 'allow',
        reasonCode,
        warnings: [],
        scopeMode: input.scopeMode,
        scopeHash: input.scopeHash,
        cacheNamespace: metadata.cacheNamespace,
        apiScope: metadata,
      },
      metadata,
    }
  }

  private pickScopeHint(hints?: TenantBoundaryHints): {
    value: number | string | null
    origin: 'route' | 'query' | 'body'
  } | null {
    if (!hints) return null
    if (hints.routeOrganizationId !== undefined && hints.routeOrganizationId !== null) {
      return { value: hints.routeOrganizationId, origin: 'route' }
    }
    if (hints.bodyOrganizationId !== undefined && hints.bodyOrganizationId !== null) {
      return { value: hints.bodyOrganizationId, origin: 'body' }
    }
    if (hints.queryOrganizationId !== undefined && hints.queryOrganizationId !== null) {
      return { value: hints.queryOrganizationId, origin: 'query' }
    }
    return null
  }
}
