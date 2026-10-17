// @aiproj/backend — TenantLowSensitiveGateService（v3-multitenant-api §6.2/§6.3）。
//
// super admin 全局低敏治理的响应门：全局 API 只允许返回受控低敏聚合元数据 + 自审计。
// 纯函数，不依赖 HttpContext，可离线 unit test。
//
// 语义（spec：Global low-sensitive route is audited / Response metadata remains low-sensitive）：
//   - global-low-sensitive / system-maintenance 响应只允许在 allowedAggregateKeys 白名单 +
//     低敏 envelope 字段内取值；越界 key（隐藏计数/名称/完整内容/绝对路径）即拒绝。
//   - 路由必须被 surface 显式声明为 global opt-in，且本次 scope mode 在允许集内。
//   - 每次放行都产出低敏自审计：actor/scope/route/operation/reasonCode/requestId/timestamp。
import {
  mapBuildLowSensitiveAudit,
  mapHasForbiddenKeys,
  mapIsAllowedScopeMode,
  type ApiLowSensitiveAudit,
  type ApiOperationType,
  type ApiScopeMode,
  type ApiSurfaceDeclaration,
} from '@aiproj/types/multitenant-api-boundary'

/** 全局低敏响应允许出现的固定 envelope 字段（白名单基础集）。 */
const ALLOWED_ENVELOPE_KEYS = [
  'requestId',
  'tenantScopeHash',
  'cacheNamespace',
  'scopeMode',
  'decision',
  'reasonCode',
  'warnings',
  'degradedReason',
]

export interface TenantLowSensitiveGateInput {
  scopeMode: ApiScopeMode
  actorRef: string
  organizationId: number | null
  scopeHash: string
  route: string
  surface: Pick<ApiSurfaceDeclaration, 'allowedScopeModes' | 'isGlobalOptIn'> | null
  operation: ApiOperationType
  requestId: string
  /** 业务侧允许返回的低敏聚合 key（不允许业务详情）。 */
  allowedAggregateKeys: string[]
  /** 待放行的响应对象（顶层）。 */
  response: Record<string, unknown>
}

export interface TenantLowSensitiveGateResult {
  allowed: boolean
  audit: ApiLowSensitiveAudit
  violations: string[]
}

export default class TenantLowSensitiveGateService {
  static gate(input: TenantLowSensitiveGateInput): TenantLowSensitiveGateResult {
    const surface = input.surface
    let violations: string[] = []

    // 全局低敏 route 必须显式 opt-in 且本次 mode 被允许，否则拒绝（fail closed）。
    const allowedBySurface =
      surface?.isGlobalOptIn === true &&
      surface !== null &&
      mapIsAllowedScopeMode(surface, input.scopeMode)
    if (!allowedBySurface) {
      violations.push('global-low-sensitive route 未显式 opt-in 或 scope mode 不被允许')
    }

    const allowed = new Set([...ALLOWED_ENVELOPE_KEYS, ...input.allowedAggregateKeys])
    for (const key of Object.keys(input.response)) {
      if (!allowed.has(key)) violations.push('top-level key 不在低敏白名单: ' + key)
    }
    if (mapHasForbiddenKeys(input.response)) {
      violations.push('response 含 forbidden field')
    }

    const audit = mapBuildLowSensitiveAudit({
      actorRef: input.actorRef,
      organizationId: input.organizationId,
      scopeHash: input.scopeHash,
      route: input.route,
      operation: input.operation,
      reasonCode: violations.length === 0 ? 'OK' : 'GLOBAL_NOT_ALLOWED',
      scopeMode: input.scopeMode,
      requestId: input.requestId,
    })

    return {
      allowed: violations.length === 0,
      audit,
      violations,
    }
  }
}
