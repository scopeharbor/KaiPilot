// @aiproj/backend — TenantApiBoundaryMiddleware（v3-multitenant-api §3.5）。
//
// 把 tenant-bound API lifecycle 接入中间件栈：在 tenant_middleware（解析出
// ctx.tenant / ctx.tenantDecision）与 rbac_middleware（挂 ctx.rbac）之后，对
// **已登记**的 tenant-scoped route 统一执行 API surface registry 覆盖 + 客户端
// hint 一致性 + scope mode 允许项，成功时挂低敏 `ctx.tenantApiBoundary`，失败时
// 抛非泄露错误（由 TenantApiBoundaryService.handleNonLeaking 映射）。
//
// **Legacy 兼容（design Decision 6 / inventory gap）**：
// 本中间件只对 TenantApiSurfaceRegistry 登记的 surface 生效。未登记（历史 V1/V2
// 长尾、显式 public/system 例外）路由直接 next() 放行，由既有
// ctx.tenant / RBAC / TenantScopeService 兜底——这样不会破坏约 3500 行 legacy
// route，也不会在本 change 把全部长尾硬切掉。新增 V3 tenant-scoped route 必须
// 先登记进 registry（否则 coverage 测试拦截；见 tenant_api_surface_registry 与
// §3.3 registry coverage test）。
//
// 顺序遵循 design Decision 2：auth -> effective tenant -> route/resource ownership
// -> request hint consistency -> API registry -> RBAC/Policy（rbac_middleware 已先跑）
// -> Service handoff。本中间件在 rbac 之后、Controller 之前执行，只负 API 专属的
// registry/一致性/低敏 metadata 三层，业务归属由 Controller/Service 继续落库校验。

import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import TenantApiBoundaryService, {
  type TenantBoundaryHints,
  type TenantBoundaryInput,
} from '#services/tenant_api_boundary_service'
import TenantApiSurfaceRegistry from '#services/tenant_api_surface_registry'
import { mapComputeScope, type ApiOperationType } from '@aiproj/types/multitenant-api-boundary'

/** 服务端已解析租户 -> 低敏 scope hash（未解析无具体组织时为 ''，由 boundary 判 MISSING_TENANT）。 */
function computeServerScopeHash(ctx: HttpContext, organizationId: number | null): string {
  if (organizationId === null) return ''
  return mapComputeScope({ organizationId, projectId: ctx.tenant?.projectId ?? null })
}

/** 从 route 参数解析客户端组织 hint（仅一致性输入，不作事实源）。 */
function readRouteOrg(ctx: HttpContext): number | string | null {
  const org = ctx.params.organizationId
  if (org === undefined || org === null) return null
  return Number(org) || (org as string)
}

/** 从 body 解析客户端组织 hint。 */
function readBodyOrg(ctx: HttpContext): number | string | null {
  const body = ctx.request.body()
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const rec = body as Record<string, unknown>
  const v = rec.organizationId ?? rec.organization_id
  return v === undefined || v === null ? null : Number(v) || (v as string)
}

/** 从 query 解析客户端组织 hint。 */
function readQueryOrg(ctx: HttpContext): number | string | null {
  const v = ctx.request.input('organizationId') ?? ctx.request.input('organization_id')
  return v === undefined || v === null || v === '' ? null : Number(v) || (v as string)
}

/** 从 surface 声明挑选该请求最贴切的操作（审计/scope 顺序断言用）。 */
function pickOperation(declared: readonly ApiOperationType[], method: string): ApiOperationType {
  const priority: ApiOperationType[] = [
    'sse',
    'preview',
    'confirm',
    'export',
    'download',
    'job_resume',
    'job',
    'batch',
    'create',
    'update',
    'delete',
    'detail',
    'list',
    'admin',
  ]
  for (const op of priority) {
    if (declared.includes(op)) return op
  }
  // 无显式声明退化：按 HTTP 方法推断（安全面仍需 surface 已登记）。
  switch (method.toUpperCase()) {
    case 'GET':
      return 'list'
    case 'POST':
      return 'create'
    case 'PATCH':
    case 'PUT':
      return 'update'
    case 'DELETE':
      return 'delete'
    default:
      return 'detail'
  }
}

@inject()
export default class TenantApiBoundaryMiddleware {
  constructor(private boundary: TenantApiBoundaryService) {}

  async handle(ctx: HttpContext, next: NextFn) {
    const method = ctx.request.method()
    const routePattern = ctx.route?.pattern ?? ''

    // 只对已登记 surface 生效；未登记（legacy/inventory gap）直接放行，保护兼容。
    const surface = TenantApiSurfaceRegistry.lookup(method, routePattern)
    if (!surface) {
      return next()
    }

    const decision = ctx.tenantDecision
    const serverOrganizationId = decision?.organizationId ?? ctx.tenant?.organizationId ?? null
    const scopeMode =
      decision?.scopeMode ??
      (ctx.tenant?.scopeMode === 'system_global' ? 'system_global' : 'tenant')
    const scopeHash =
      serverOrganizationId !== null ? computeServerScopeHash(ctx, serverOrganizationId) : ''
    const operation = pickOperation(surface.operations ?? [], method)

    const hints = this.buildHints(ctx)

    const input: TenantBoundaryInput = {
      requestId: ctx.request.id() ?? 'unknown',
      method,
      routePattern,
      serverOrganizationId,
      scopeMode: scopeMode as 'tenant' | 'global-low-sensitive' | 'system-maintenance',
      scopeHash,
      operation,
      hints,
      surface,
    }

    const outcome = this.boundary.resolveBoundary(input)
    if (!outcome.resolution.allowed) {
      this.boundary.handleNonLeaking(outcome.resolution)
      return // unreachable；handleNonLeaking 抛
    }

    // 允许：挂低敏 decision metadata，供 Controller/前端/SDK 派生 cache namespace 与 handle。
    if (outcome.metadata) {
      ctx.tenantApiBoundary = outcome.metadata
    }

    return next()
  }

  private buildHints(ctx: HttpContext): TenantBoundaryHints {
    const hints: TenantBoundaryHints = {}
    const routeOrg = readRouteOrg(ctx)
    if (routeOrg !== null) hints.routeOrganizationId = routeOrg
    const bodyOrg = readBodyOrg(ctx)
    if (bodyOrg !== null) hints.bodyOrganizationId = bodyOrg
    const queryOrg = readQueryOrg(ctx)
    if (queryOrg !== null) hints.queryOrganizationId = queryOrg
    return hints
  }
}
