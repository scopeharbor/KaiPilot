import AuditService, { AuditEvent } from '#services/audit_service'
import RbacPolicy from '#policies/rbac_policy'
import RbacService from '#services/rbac_service'
import ProjectMember from '#models/project_member'
import { ROUTE_PERMISSION_RULES, SYSTEM_ADMIN, type RoutePermissionRule } from '#rbac'
import type { RbacRequestContext } from '#types/auth'
import {
  AuthRequiredException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * RBAC middleware：按「路由名 / 路由模板 + HTTP 方法 → 所需权限」查表并调用判定服务。
 *
 * - 未在 ROUTE_PERMISSION_RULES 注册的路由默认放行（认证由 auth/silent_auth middleware 保障）；
 * - 匹配到规则但请求未认证 -> AUTH_REQUIRED（401），禁止放行至控制器返回 403；
 * - 已认证但权限不足抛 PERMISSION_DENIED（403）并异步写审计（D5）；
 * - 跨组织资源统一返回 404 RESOURCE_NOT_FOUND（由 tenant_middleware 与业务层保证）。
 */
@inject()
export default class RbacMiddleware {
  constructor(
    private rbacPolicy: RbacPolicy,
    private rbacService: RbacService,
    private audit: AuditService,
  ) {}

  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.authUser
    const tenant = ctx.tenant

    // 必须在「未登记路由直接放行」之前挂载：Policy 层的权限判定不依赖
    // ROUTE_PERMISSION_RULES，若放到 rule 分支之后，未登记路由上的
    // ctx.rbac 会是 undefined，Policy 的 `?? false` 便恒判无权。
    await this.attachRbacContext(ctx)

    const method = ctx.request.method()
    const routeName = ctx.route?.name
    const routePattern = ctx.route?.pattern

    const rule = ROUTE_PERMISSION_RULES.find((r: RoutePermissionRule) => {
      if (r.method !== method) return false
      if (r.routeName && routeName) return r.routeName === routeName
      if (r.routePattern && routePattern) return r.routePattern === routePattern
      return false
    })

    // 未在规则表注册的路由不要求 RBAC 判定，放行（认证由 auth/silent_auth middleware 保障）。
    if (!rule) {
      return next()
    }

    // 匹配到权限规则但请求未认证 -> 401 AUTH_REQUIRED（禁止放行至控制器返回 403）。
    if (!user) {
      throw new AuthRequiredException('需要认证')
    }

    // 系统管理员拥有全局域权限，不要求先选择组织。
    if (user.isSuperAdmin) {
      return next()
    }

    if (!tenant) {
      await this.auditDenied(ctx, user.id, rule.permission, 'no_tenant')
      throw new PermissionDeniedException('需要组织上下文')
    }

    const projectId =
      ctx.request.param('projectId') ??
      (routePattern?.includes('/projects/:id') ? ctx.request.param('id') : undefined)

    const check = await this.rbacPolicy.authorize(user, rule.permission, {
      organizationId: tenant.organizationId,
      projectId: projectId ? Number(projectId) : undefined,
    })

    if (!check.allowed) {
      // 项目 scope：跨组织/不存在项目统一 404（design D7，不泄露存在性）；
      // 同组织非成员才返回 403。
      if (projectId) {
        const exists = await this.rbacService.projectExistsInOrg(
          Number(projectId),
          tenant.organizationId,
        )
        if (!exists) {
          throw new ResourceNotFoundException('项目不存在')
        }
      }
      await this.auditDenied(ctx, user.id, rule.permission, check.reason, tenant.organizationId)
      throw new PermissionDeniedException('权限不足')
    }

    return next()
  }

  /**
   * 解析当前请求的有效权限集并挂到 `ctx.rbac`，供 Policy 层同步判定。
   *
   * scope 取自 `ctx.tenant`：组织级路由只看组织权限；路由带项目 scope 时
   * `resolveUserPermissions` 会与项目级权限取交集（在组织有权、在该项目无权 → 拒）。
   *
   * 未认证或未选组织时仍然挂一个空权限集，而不是留 undefined：两者对 Policy
   * 的判定结果都是拒绝，但挂上之后能从 `ctx.rbac.organizationId` 看出是
   * 「没选组织」还是「选了组织但没这个权限」，排查时不必猜中间件有没有跑。
   */
  private async attachRbacContext(ctx: HttpContext): Promise<void> {
    const user = ctx.authUser
    const organizationId = ctx.tenant?.organizationId ?? null
    const projectId = ctx.tenant?.projectId ?? null

    const permissions: ReadonlySet<string> = user
      ? new Set<string>(
          await this.rbacService.resolveUserPermissions(
            user,
            organizationId,
            projectId ?? undefined,
          ),
        )
      : new Set<string>()

    const rbac: RbacRequestContext = {
      permissions,
      organizationId,
      projectId,
      isSuperAdmin: Boolean(user?.isSuperAdmin),
      hasPermission: (permission: string) =>
        permissions.has(SYSTEM_ADMIN) || permissions.has(permission),
    }

    ctx.rbac = rbac

    // 项目级路由同步挂载项目成员身份（F20）：OCR/文档类 Policy 的 isProjectMember()
    // 是同步判定、无法自行查库，此前全链路无人挂载 ctx.projectMember 导致恒 403。
    // 角色名取项目角色（projectRoleId → project_roles.name），无角色行时记 'member'。
    ctx.projectMember = null
    if (user && projectId !== null) {
      const membership = await ProjectMember.query()
        .where('project_id', projectId)
        .where('user_id', user.id)
        .where('is_active', true)
        .preload('projectRole')
        .first()
      ctx.projectMember = membership ? { role: membership.projectRole?.name ?? 'member' } : null
    }
  }

  private async auditDenied(
    ctx: HttpContext,
    userId: number,
    permission: string,
    reason?: string,
    organizationId?: number,
  ) {
    await this.audit.log({
      event: AuditEvent.PERMISSION_DENIED,
      severity: 'warning',
      userId,
      organizationId: organizationId ?? null,
      requestId: ctx.request.id() ?? null,
      metadata: { permission, reason, route: ctx.route?.pattern, method: ctx.request.method() },
    })
  }
}
