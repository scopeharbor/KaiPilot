import ResourcePolicy from '#policies/resource_policy'
import ResourceAllocationService from '#services/resource_allocation_service'
import { allocationDto } from '#types/dto'
import {
  createAllocationValidator,
  listAllocationsValidator,
  updateAllocationValidator,
} from '#validators/allocation'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

@inject()
export default class ResourceAllocationsController {
  constructor(
    private allocations: ResourceAllocationService,
    private policy: ResourcePolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private auditContext({ request }: HttpContext) {
    return {
      requestId: request.id() ?? null,
      ip: request.ip(),
      userAgent: request.header('user-agent') ?? '',
    }
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const resourceId = Number(ctx.params.resourceId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)

    const filters = await ctx.request.validateUsing(listAllocationsValidator, {
      data: ctx.request.qs(),
    })
    const { data, meta } = await this.allocations.listByResource(
      ctx.tenant!.organizationId,
      projectId,
      resourceId,
      filters,
    )
    return ctx.response.ok({ data: data.map(allocationDto), meta })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createAllocationValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const resourceId = Number(ctx.params.resourceId)
    await this.policy.authorizeManage(user, organizationId, projectId)

    const result = await this.allocations.createWithWarnings(
      organizationId,
      projectId,
      resourceId,
      input,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.created({
      data: allocationDto(result.data),
      warningSummary: result.warningSummary,
    })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateAllocationValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const allocationId = Number(ctx.params.id)
    await this.policy.authorizeManage(user, organizationId, projectId)

    const result = await this.allocations.updateWithWarnings(
      organizationId,
      projectId,
      allocationId,
      input,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({
      data: allocationDto(result.data),
      warningSummary: result.warningSummary,
    })
  }

  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const allocationId = Number(ctx.params.id)
    await this.policy.authorizeManage(user, organizationId, projectId)

    await this.allocations.delete(
      organizationId,
      projectId,
      allocationId,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.noContent()
  }
}
