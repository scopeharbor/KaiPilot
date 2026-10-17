import MilestonePolicy from '#policies/milestone_policy'
import MilestoneService from '#services/milestone_service'
import { milestoneDto } from '#types/dto'
import {
  createMilestoneValidator,
  listMilestonesValidator,
  updateMilestoneValidator,
} from '#validators/milestone_validators'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * 里程碑控制器（milestone-management）。
 *
 * 嵌套 index/store（`/projects/:projectId/milestones`）：跨组织 404 + milestone:view/create
 * 由 rbac 中间件在路由层守卫。扁平 show/update/destroy（`/milestones/:id`，无 projectId）：
 * 组织隔离经 `findInOrgOrFail`（跨组织 404）、写/查权限经 `MilestonePolicy`（项目归属 + RBAC）。
 */
@inject()
export default class MilestonesController {
  constructor(
    private milestones: MilestoneService,
    private policy: MilestonePolicy,
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
    const projectId = Number(ctx.params.projectId)
    const filters = await ctx.request.validateUsing(listMilestonesValidator, {
      data: ctx.request.qs(),
    })
    const { data, meta } = await this.milestones.list(
      ctx.tenant!.organizationId,
      projectId,
      filters,
    )
    return ctx.response.ok({ data: data.map(milestoneDto), meta })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createMilestoneValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const milestone = await this.milestones.create(
      organizationId,
      projectId,
      {
        name: input.name,
        description: input.description,
        status: input.status,
        plannedDate: input.plannedDate,
        displayOrder: input.displayOrder,
      },
      user.id,
      this.auditContext(ctx),
    )
    const view = await this.milestones.viewOf(projectId, milestone)
    return ctx.response.created({ data: milestoneDto(view) })
  }

  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const milestone = await this.milestones.findInOrgOrFail(organizationId, Number(ctx.params.id))
    const projectId = Number(milestone.projectId)
    await this.policy.authorizeView(user, organizationId, projectId)
    const view = await this.milestones.viewOf(projectId, milestone)
    return ctx.response.ok({ data: milestoneDto(view) })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateMilestoneValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const milestoneId = Number(ctx.params.id)
    const existing = await this.milestones.findInOrgOrFail(organizationId, milestoneId)
    const projectId = Number(existing.projectId)
    await this.policy.authorizeUpdate(user, organizationId, projectId)

    const milestone = await this.milestones.update(
      organizationId,
      projectId,
      milestoneId,
      {
        name: input.name,
        description: input.description,
        status: input.status,
        plannedDate: input.plannedDate,
        displayOrder: input.displayOrder,
      },
      user.id,
      this.auditContext(ctx),
    )
    const view = await this.milestones.viewOf(projectId, milestone)
    return ctx.response.ok({ data: milestoneDto(view) })
  }

  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const milestoneId = Number(ctx.params.id)
    const existing = await this.milestones.findInOrgOrFail(organizationId, milestoneId)
    const projectId = Number(existing.projectId)
    await this.policy.authorizeDelete(user, organizationId, projectId)

    await this.milestones.delete(
      organizationId,
      projectId,
      milestoneId,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.noContent()
  }
}
