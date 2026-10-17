import OrganizationMemberService from '#services/organization_member_service'
import TenantOwnershipResolverService from '#services/tenant_ownership_resolver_service'
import User from '#models/user'
import { memberDto } from '#types/dto'
import {
  inviteMemberValidator,
  updateRoleValidator,
  createOrganizationAccountValidator,
} from '#validators/organization_member'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class OrganizationMembersController {
  constructor(
    private members: OrganizationMemberService,
    private ownership: TenantOwnershipResolverService,
  ) {}

  private auditContext({ request }: HttpContext) {
    return {
      requestId: request.id() ?? null,
      ip: request.ip(),
      userAgent: request.header('user-agent') ?? '',
    }
  }

  /**
   * 组织归属前置校验（v3-multitenant-tenant-identification §5.3）。
   *
   * 本控制器的路由是 `/organizations/:id/members*`——参数名是 `:id` 而**不是**
   * `:organizationId`，因此 `TenantMiddleware.assertRouteAndBodyConsistency`
   * （它只看 `ctx.params.organizationId`）对这条路由完全不生效。在补上这道校验之前，
   * 四个方法都直接把 `ctx.params.id` 当组织 ID 用，任何已认证用户都能对**任意组织**
   * 读成员名单、邀请成员、改角色、移除成员：RBAC 只按 actor 的当前租户判定他有没有
   * `org:manage`，从不核对 `:id` 是不是那个租户。
   *
   * 这里要求 `:id` 必须等于服务端解析出的有效租户组织，不等一律 404（不区分
   * "组织不存在"与"越权"，避免泄露组织存在性）。
   */
  private async assertOrganizationScope(ctx: HttpContext) {
    await this.ownership.assertRouteResourceOwnership({
      resourceType: 'organization',
      resourceId: Number(ctx.params.id),
      effectiveOrganizationId: ctx.tenant?.organizationId ?? null,
      decision: ctx.tenantDecision ?? null,
      userId: ctx.authUser?.id ?? null,
      requestId: ctx.request.id() ?? 'unknown',
    })
  }

  async index(ctx: HttpContext) {
    await this.assertOrganizationScope(ctx)
    const members = await this.members.list(Number(ctx.params.id))
    return ctx.response.ok({ data: members.map(memberDto) })
  }

  async invite(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(inviteMemberValidator)
    await this.assertOrganizationScope(ctx)
    const member = await this.members.invite(
      Number(ctx.params.id),
      input,
      (ctx.auth.getUserOrFail() as User).id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: memberDto(member) })
  }

  async createAccount(ctx: HttpContext) {
    await this.assertOrganizationScope(ctx)
    const input = await ctx.request.validateUsing(createOrganizationAccountValidator)
    const member = await this.members.createAccount(
      Number(ctx.params.id),
      input,
      (ctx.auth.getUserOrFail() as User).id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: memberDto(member) })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateRoleValidator)
    await this.assertOrganizationScope(ctx)
    const member = await this.members.updateRole(
      Number(ctx.params.id),
      Number(ctx.params.memberId),
      input.role,
      (ctx.auth.getUserOrFail() as User).id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: memberDto(member) })
  }

  async destroy(ctx: HttpContext) {
    await this.assertOrganizationScope(ctx)
    await this.members.remove(
      Number(ctx.params.id),
      Number(ctx.params.memberId),
      (ctx.auth.getUserOrFail() as User).id,
      this.auditContext(ctx),
    )
    return ctx.response.noContent()
  }
}
