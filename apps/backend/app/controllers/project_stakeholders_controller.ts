import type User from '#models/user'
import StakeholderPolicy from '#policies/stakeholder_policy'
import StakeholderService from '#services/stakeholder_service'
import type { QuadrantBucketKey, StakeholderQuadrantResponse } from '#services/stakeholder_service'
import {
  createStakeholderValidator,
  listStakeholdersValidator,
  updateStakeholderValidator,
} from '#validators/stakeholder'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * 利害关系人登记表控制器（v3-chart-gallery-data-foundation，design D5）。
 *
 * 纯 HTTP 解析 + 服务调用 + 响应格式化；?view=quadrant 返回权力-利益四象限
 * 聚合（design D3.3），其余为分页列表。
 */
@inject()
export default class ProjectStakeholdersController {
  constructor(
    private stakeholders: StakeholderService,
    private policy: StakeholderPolicy,
  ) {}

  private user(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  private static serializeQuadrants(view: StakeholderQuadrantResponse) {
    const bucketKeys: QuadrantBucketKey[] = [
      'manageClosely',
      'keepSatisfied',
      'keepInformed',
      'monitor',
    ]
    const quadrants = {} as Record<QuadrantBucketKey, Record<string, unknown>[]>
    for (const key of bucketKeys) {
      quadrants[key] = view.quadrants[key].map((stakeholder) => stakeholder.serialize())
    }
    return { summary: view.summary, quadrants }
  }

  /** GET /projects/:projectId/stakeholders[?view=quadrant] —— 列表或四象限聚合。 */
  async index(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)

    const query = await ctx.request.validateUsing(listStakeholdersValidator, {
      data: ctx.request.qs(),
    })
    if (query.view === 'quadrant') {
      const view = await this.stakeholders.getQuadrantView(organizationId, projectId)
      return ctx.response.ok({ data: ProjectStakeholdersController.serializeQuadrants(view) })
    }

    const { view, ...filters } = query
    void view
    const result = await this.stakeholders.list(organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  /** POST /projects/:projectId/stakeholders —— 登记干系人。 */
  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createStakeholderValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(actor, organizationId, projectId)

    const stakeholder = await this.stakeholders.create(organizationId, projectId, input, actor.id)
    return ctx.response.created({ data: stakeholder.serialize() })
  }

  /** GET /projects/:projectId/stakeholders/:id —— 干系人详情。 */
  async show(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const stakeholderId = Number(ctx.params.id)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)

    const stakeholder = await this.stakeholders.get(organizationId, projectId, stakeholderId)
    return ctx.response.ok({ data: stakeholder.serialize() })
  }

  /** PATCH /projects/:projectId/stakeholders/:id —— 更新评估与应对策略。 */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateStakeholderValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const stakeholderId = Number(ctx.params.id)
    await this.policy.authorizeManage(actor, organizationId, projectId)

    const stakeholder = await this.stakeholders.update(
      organizationId,
      projectId,
      stakeholderId,
      input,
      actor.id,
    )
    return ctx.response.ok({ data: stakeholder.serialize() })
  }

  /** DELETE /projects/:projectId/stakeholders/:id —— 软删除。 */
  async destroy(ctx: HttpContext) {
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const stakeholderId = Number(ctx.params.id)
    await this.policy.authorizeManage(actor, organizationId, projectId)

    await this.stakeholders.softDelete(organizationId, projectId, stakeholderId, actor.id)
    return ctx.response.noContent()
  }
}
