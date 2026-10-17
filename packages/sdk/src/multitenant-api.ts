// v3-multitenant-api §7.5 —— SDK 多租户 bound 助手（纯函数，零运行时外部依赖）。
//
// 前端/SDK 不把本地 organizationId 当安全事实源（design Decision 4 / spec：
// Client-provided organization scope MUST be consistency hint only）。本模块：
//   - refuseUnsafeTenantOverride：mutation/preview/export/job/AI 请求发出前，若调用方传入的
//     客户端组织 override 与服务器下发的 tenant scope hash 不一致，则拒绝（返回结构化错误）。
//   - scopedIdempotencyKey：用服务器下发的 tenant scope hash 派生租户 scoped 幂等键，跨租户不可复用。
//   - readTenantDecisionMetadata：解析低敏 response envelope，拒绝含 secret/prompt/modelOutput/
//     provider payload 等 forbidden fields 的"伪低敏"metadata（fail closed）。
import {
  mapComputeIdempotencyScope,
  mapHasForbiddenKeys,
  mapValidateUnsafeOverride,
  type ApiDecisionMetadata,
  type ApiOperationType,
  type ApiResourceType,
} from '@aiproj/types/multitenant-api-boundary'

/** SDK 组织 override 预检结果。 */
export type TenantOverrideResult =
  | { ok: true }
  | {
      ok: false
      code: 'UNSAFE_TENANT_OVERRIDE'
      reasonCode: 'UNSAFE_TENANT_OVERRIDE'
      serverScopeHash: string
    }

/**
 * SDK 预检：客户端组织 override 若与服务器 scope hash 冲突则拒绝。
 * 用于 mutation/preview/export/job/AI 请求发出前拦截不安全 override。
 */
export function refuseUnsafeTenantOverride(input: {
  clientOrganizationId: number | string | null
  serverScopeHash: string
}): TenantOverrideResult {
  const r = mapValidateUnsafeOverride({
    clientOrganizationId: input.clientOrganizationId,
    serverScopeHash: input.serverScopeHash,
  })
  if (!r.allowed) {
    return {
      ok: false,
      code: 'UNSAFE_TENANT_OVERRIDE',
      reasonCode: 'UNSAFE_TENANT_OVERRIDE',
      serverScopeHash: input.serverScopeHash,
    }
  }
  return { ok: true }
}

/**
 * 派生租户作用域幂等键：服务器下发的 tenant scope hash + 调用方 reference 组合，
 * 保证同一租户内可去重、跨租户不可复用。
 */
export function scopedIdempotencyKey(input: {
  tenantScopeHash: string
  operation: ApiOperationType
  resourceType: ApiResourceType
  reference: string
}): string {
  const scope = mapComputeIdempotencyScope({
    organizationId: 0,
    operation: input.operation,
    resourceType: input.resourceType,
  })
  return input.tenantScopeHash + ':' + scope + ':' + hashRef(input.reference)
}

/**
 * 解析低敏 decision metadata：若含 forbidden fields（secret/password/token/prompt/
 * model_output/provider_payload/full content…）则拒绝，防 SDK 把非低敏内容当安全 metadata 回传。
 */
export function readTenantDecisionMetadata(input: ApiDecisionMetadata): {
  ok: boolean
  reason?: string
  decisionMetadata?: ApiDecisionMetadata
} {
  if (mapHasForbiddenKeys(input)) {
    return { ok: false, reason: 'tenant decision metadata contains forbidden fields' }
  }
  return { ok: true, decisionMetadata: input }
}

/** 稳定 reference hash（FNV-1a，纯 JS）。 */
function hashRef(reference: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < reference.length; i++) {
    h ^= reference.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
