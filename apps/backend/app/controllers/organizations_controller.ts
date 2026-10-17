import OrganizationMemberService from '#services/organization_member_service'
import OrganizationService from '#services/organization_service'
import User from '#models/user'
import { organizationDto } from '#types/dto'
import { createOrganizationValidator, updateOrganizationValidator } from '#validators/organization'
import { transferOrgOwnerValidator } from '#validators/organization_member'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class OrganizationsController {
  constructor(
    private organizations: OrganizationService,
    private members: OrganizationMemberService,
  ) {}

  private auditContext({ request }: HttpContext) {
    return {
      requestId: request.id() ?? null,
      ip: request.ip(),
      userAgent: request.header('user-agent') ?? '',
    }
  }

  async index(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const rows = await this.organizations.listMine(user)
    return ctx.response.ok({
      data: rows.map(({ organization, role }) => organizationDto(organization, role)),
    })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createOrganizationValidator)
    const organization = await this.organizations.create(
      input,
      (ctx.auth.getUserOrFail() as User).id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: organizationDto(organization, 'owner') })
  }

  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organization = await this.organizations.get(
      Number(ctx.params.id),
      user,
      ctx.tenant?.organizationId,
    )
    return ctx.response.ok({ data: organizationDto(organization) })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateOrganizationValidator)
    const user = ctx.auth.getUserOrFail() as User
    const organization = await this.organizations.update(
      Number(ctx.params.id),
      input,
      user.id,
      ctx.tenant?.organizationId,
      user.isSuperAdmin,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: organizationDto(organization) })
  }

  async destroy(ctx: HttpContext) {
    await this.organizations.softDelete(
      Number(ctx.params.id),
      (ctx.auth.getUserOrFail() as User).id,
      this.auditContext(ctx),
    )
    return ctx.response.noContent()
  }

  async transfer(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(transferOrgOwnerValidator)
    const user = ctx.auth.getUserOrFail() as User
    const result = await this.members.transferOwner(
      Number(ctx.params.id),
      Number(input.memberId),
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({
      data: {
        organization: organizationDto(result.organization),
        previousOwnerId: result.previousOwnerId,
        newOwnerId: result.newOwnerId,
      },
    })
  }
}
