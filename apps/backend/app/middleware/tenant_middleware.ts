import { inject } from '@adonisjs/core'
import {
  PermissionDeniedException,
  ResourceNotFoundException,
  TenantResolutionUnavailableException,
} from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import TenantResolutionService from '#services/tenant_resolution_service'
import TenantIdentificationAuditService from '#services/tenant_identification_audit_service'
import type {
  EffectiveTenantContext,
  TenantResolutionReason,
} from '@aiproj/types/multitenant-tenant-identification'

/**
 * 「租户选择意图」路由白名单（v3-multitenant-tenant-identification §4.1）。
 *
 * 这些路由的 body `organizationId` 语义是**目标组织意图**，不是"我断言自己属于该组织"。
 * 全局的 body 一致性校验（`assertRouteAndBodyConsistency`）对它们必须让路——否则
 * 组织切换请求会被自己的当前租户上下文拦成 404，永远切不过去。
 *
 * 让路 ≠ 放行：目标组织的成员/所有权由 `OrganizationSelectionService` 经
 * `TenantResolutionService` 重新查库校验，非成员一律 404（与本中间件同一非泄露语义）。
 * 因此这里放宽的只是"body 与当前 scope 必须相等"这条一致性断言，安全事实源没有变。
 *
 * 用 route pattern 而非 route name 匹配：pattern 是 URL 契约的一部分，改它必然是
 * 有意的 API 变更；route name 可能被重命名而无人注意到白名单失配。
 */
export const TENANT_SELECTION_INTENT_PATTERNS: readonly string[] = [
  '/api/v1/account/organization-selection',
]

/**
 * 从路由参数解析可选项目 scope（module-level 纯函数，供单元测试直接驱动）。
 * 仅限明确的项目级路由形态：`:projectId` 参数，或模式含 `/projects/:id` 的 `:id`。
 * 其它资源的 `:id` 不误判为项目 scope。
 */
export function resolveTenantProjectId(ctx: HttpContext): number | null {
  const named = ctx.params.projectId
  if (named !== undefined && named !== null) {
    return Number(named) || null
  }
  const pattern = ctx.route?.pattern ?? ''
  if (pattern.includes('/projects/:id') && ctx.params.id !== undefined) {
    return Number(ctx.params.id) || null
  }
  return null
}

/**
 * Tenant middleware：调用 TenantResolutionService 从服务端可信状态解析有效租户决定，
 * 挂载 `ctx.tenantDecision`（识别层低敏决定，v3-multitenant-tenant-identification §3.3），
 * 并派生兼容的 `ctx.tenant`（organizationId/projectId/scopeMode/actorRef/isSuperAdmin）。
 *
 * 解析优先级（design Decision 2，固定且 fail closed）：已验证认证态 → JWT org →
 * 服务端 membership/owner 校验 → membership freshness（roleVersion + member.updatedAt +
 * org 软删除状态）。客户端 body/query 的 organizationId 仅作一致性校验，不作事实源。
 *
 * 错误语义（非泄露，spec「Ambiguous tenant inputs MUST fail closed」）：
 *   - **解析不出租户（未认证，或已认证但尚未选组织）→ 放行且 `ctx.tenant` 留空。**
 *     本中间件是全局中间件，登录/注册/健康检查也经过它，在此拦截会把登录接口自己挡掉；
 *     fail closed 由下游各自负责（auth_middleware 按路由要求认证、
 *     `TenantScopeService.requireTenant`/Policy/`RbacMiddleware` 要求租户）。详见 failClosed()。
 *   - JWT 声明了组织但服务端否掉（组织不存在/已软删除/非成员且非 owner）→
 *     RESOURCE_NOT_FOUND（404），三者不区分，不泄露隐藏组织名/资源名/计数。
 *   - roleVersion / membership 过期 → 放行给 `auth_middleware` 判定（它返回 401「须刷新 token」）。
 *   - 路由/body organizationId 与服务端解析不一致 → RESOURCE_NOT_FOUND（404）。
 *   - super admin 无 org → global-low-sensitive 决定（放行低敏全局；业务写入仍须具体 org，§6）。
 *
 * 既有调用方 `ctx.tenant.organizationId` 完全兼容（super admin 的 scopeMode 仍为 system_global）。
 */
@inject()
export default class TenantMiddleware {
  constructor(
    private resolutionService: TenantResolutionService,
    private identificationAudit: TenantIdentificationAuditService,
  ) {}

  async handle(ctx: HttpContext, next: NextFn) {
    const payload = ctx.authPayload
    const user = ctx.authUser

    // 调用识别层解析服务（不抛异常，结果编码进 reason + ok）。
    const { context, ok } = await this.resolutionService.resolve({
      payload,
      user,
      projectId: resolveTenantProjectId(ctx),
    })

    // 始终挂载低敏决定（即使失败，后续审计/观测可读 reason；低敏不含隐藏数据）。
    ctx.tenantDecision = context

    if (ok) {
      // 有效决定：派生兼容 ctx.tenant。
      ctx.tenant = this.deriveLegacyTenant(context)

      // 非 super admin 的 tenant 模式：额外校验路由/body 一致性（super admin 保留跨组织语义）。
      if (!context.isSuperAdmin && context.organizationId !== null) {
        await this.assertRouteAndBodyConsistency(ctx, context)
      }
    } else {
      // 失败决定：据 reason 做 fail closed 映射。
      this.failClosed(ctx, context)
    }

    return next()
  }

  /**
   * 从 effective tenant decision 派生兼容的旧 TenantContext。
   * scopeMode 归一化：tenant → organization_scoped（或 project_scoped）；global → system_global。
   */
  private deriveLegacyTenant(context: EffectiveTenantContext) {
    // super admin 恒为 system_global：识别层给 super admin + 具体 org 的决定是
    // scopeMode='tenant'，但旧 `ctx.tenant` 契约里 super admin 一律 system_global，
    // 下游（TenantScopeService / TenantJobScopeService）按这个值判定全局能力，
    // 直接透传 'tenant' 会把 super admin 降级成普通组织 scope。
    const scopeMode = context.isSuperAdmin
      ? 'system_global'
      : context.scopeMode === 'tenant'
        ? typeof context.projectId === 'number'
          ? 'project_scoped'
          : 'organization_scoped'
        : 'system_global'
    return {
      organizationId: context.organizationId as number,
      projectId: context.projectId ?? null,
      scopeMode: scopeMode as 'organization_scoped' | 'project_scoped' | 'system_global',
      actorRef: context.actorRef,
      isSuperAdmin: context.isSuperAdmin,
    }
  }

  /**
   * 失败决定 → 非泄露 HTTP 错误。
   *
   * **本中间件是全局中间件**（`start/kernel.ts` 的 router middleware 栈），登录、注册、
   * 健康检查等公开路由同样会经过它。因此「解析不出租户」本身不能在这里拦：
   * 一旦拦了，`POST /api/v1/auth/login` 自己就先 401，客户端永远拿不到 token。
   *
   * 中间件的既有契约是「能解析就挂 `ctx.tenant`，解析不出就留空并放行」，
   * 由下游各自 fail closed：认证由 `auth_middleware` 按路由把关；需要租户的代码路径由
   * `TenantScopeService.requireTenant` / Policy / `RbacMiddleware` 各自拒绝。
   * 这里只保留一类拦截——**JWT 已声明组织、但服务端否掉了它**（组织不存在/已软删除/
   * 请求者非成员且非 owner）：这与旧实现一致，统一 404 且不区分三者，不泄露存在性。
   */
  private failClosed(ctx: HttpContext, context: EffectiveTenantContext): void {
    const reason = context.resolutionReason

    // resolver 依赖故障（§3.5）：服务端拿不到可信租户事实 → degraded 503。
    // **必须排在 super admin 分支之前**：否则 resolver 故障时 super admin 会被下面那段
    // 放行成 `system_global`（且 organizationId 落成 0，正是 isolation-architecture
    // 核准时定性过的隐式全局通道），等于用一次 DB 抖动换来跨租户全局视图。
    // 这里既不读 body/query 的 organizationId，也不挂 `ctx.tenant`，
    // 下游因此无法误用一个未经服务端校验的组织。
    if (reason === 'RESOLVER_FAILED') {
      throw new TenantResolutionUnavailableException('租户上下文暂不可用，请稍后重试')
    }

    // super admin 的失败仅见于组织缺失/删除，放行为 global，保留既有跨组织诊断能力
    // （业务写入仍须具体 org，见 §6 与 TenantScopeRegistry 的默认拒绝）。
    if (context.isSuperAdmin) {
      ctx.tenant = {
        organizationId: (context.organizationId ?? 0) as number,
        projectId: null,
        scopeMode: 'system_global',
        actorRef: context.actorRef,
        isSuperAdmin: true,
      }
      return
    }

    // 无可解析的租户：未认证，或已认证但尚未选择组织。两者都放行，`ctx.tenant` 留空。
    if (reason === 'NO_ACTIVE_ORGANIZATION') {
      return
    }

    // JWT 声明了组织但服务端否掉：组织不存在 / 已软删除 / 非成员且非 owner。
    // 三者统一 404，不区分（区分即泄露组织存在性）。
    if (
      reason === 'ORGANIZATION_MISSING' ||
      reason === 'ORGANIZATION_DELETED' ||
      reason === 'NOT_A_MEMBER' ||
      reason === 'MEMBERSHIP_REMOVED'
    ) {
      throw new ResourceNotFoundException('组织不存在')
    }

    // roleVersion / membership 过期：**不在这里拦**，但仍要把 `ctx.tenant` 挂上。
    // RBAC D9 的即时失效由 `auth_middleware` 判定（核对 token 内 roleVersion 与 DB
    // 当前值），语义是「token 已失效，去刷新」→ **401**。而 `RbacMiddleware` 在全局栈里
    // 紧跟本中间件、跑在按路由的 `auth` 之前，它遇到 `ctx.tenant` 为空会先抛 403
    // （`需要组织上下文`），把那个 401 抢掉——调用方就分不清「该刷新 token」与「权限不足」。
    // 挂上 `ctx.tenant` 本身不授予任何权限：请求随后就被 `auth_middleware` 401 掉，
    // 到不了 Controller。这与旧实现一致（旧版压根不看 roleVersion，照常挂 ctx.tenant）。
    if (reason === 'ROLE_STALE' || reason === 'MEMBERSHIP_STALE') {
      if (context.organizationId !== null) {
        ctx.tenant = this.deriveLegacyTenant(context)
      }
      return
    }

    // 兜底：已认证且带组织，但出现上面未枚举的失败原因 → 拒绝（fail closed）。
    throw new PermissionDeniedException('需要组织上下文')
  }

  /**
   * 路由参数 organizationId 与 body organizationId 必须与服务端解析的组织一致。
   * 任何不一致统一抛 404（非泄露错误，不区分"组织不存在"与"越权"）。
   */
  private async assertRouteAndBodyConsistency(
    ctx: HttpContext,
    context: EffectiveTenantContext,
  ): Promise<void> {
    // 租户选择意图路由：body organizationId 是"想切到哪"，不是"我属于哪"。
    // 目标组织的成员校验由 OrganizationSelectionService 重新查库完成。
    if (TENANT_SELECTION_INTENT_PATTERNS.includes(ctx.route?.pattern ?? '')) {
      return
    }

    const organizationId = context.organizationId as number
    const routeOrg = ctx.params.organizationId
    if (routeOrg !== undefined && routeOrg !== null && Number(routeOrg) !== organizationId) {
      await this.auditAmbiguous(ctx, context, 'ROUTE_ORGANIZATION_MISMATCH')
      throw new ResourceNotFoundException('组织不存在')
    }

    const body = ctx.request.body()
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const bodyOrg =
        (body as Record<string, unknown>).organizationId ??
        (body as Record<string, unknown>).organization_id
      if (bodyOrg !== undefined && bodyOrg !== null && Number(bodyOrg) !== organizationId) {
        await this.auditAmbiguous(ctx, context, 'BODY_ORGANIZATION_MISMATCH')
        throw new ResourceNotFoundException('组织不存在')
      }
    }
  }

  /**
   * 歧义租户输入的低敏审计（§9.1 的 ambiguous 类）。
   *
   * spec「Ambiguous tenant inputs MUST fail closed」要求这类冲突可复核。记录的是
   * **actor 自己**的组织与 scope hash，绝不记录请求里声称的那个组织——那是"隐藏目标"，
   * 写进审计等于在审计里留下跨租存在性证据。
   */
  private async auditAmbiguous(
    ctx: HttpContext,
    context: EffectiveTenantContext,
    reason: TenantResolutionReason,
  ): Promise<void> {
    await this.identificationAudit.recordAmbiguous({
      actorRef: context.actorRef,
      userId: ctx.authUser?.id ?? null,
      organizationId: context.organizationId,
      projectId: context.projectId ?? null,
      scopeMode: context.scopeMode,
      selectionSource: 'consistency_hint',
      resolutionReason: reason,
      scopeHash: context.scopeHash,
      operation: `tenant.consistency.${ctx.request.method().toLowerCase()}`,
      requestId: ctx.request.id() ?? 'unknown',
    })
  }
}
