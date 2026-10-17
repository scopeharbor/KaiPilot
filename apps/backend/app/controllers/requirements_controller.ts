import type User from '#models/user'
import RequirementPolicy from '#policies/requirement_policy'
import RequirementService from '#services/requirement_service'
import type { UpdateRequirementInput } from '#services/requirement_service'
import {
  bindTaskValidator,
  createRequirementValidator,
  listRequirementsValidator,
  updateRequirementValidator,
} from '#validators/requirement'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * 需求控制器（v3-chart-gallery-data-foundation，design D5）。
 *
 * 纯 HTTP 解析 + 服务调用 + 响应格式化；需求 CRUD/验收准则/RTM 聚合与
 * 跨租户 404 由 RequirementService 保证。
 */
@inject()
export default class RequirementsController {
  constructor(
    private requirements: RequirementService,
    private policy: RequirementPolicy,
  ) {}

  private user(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  /** GET /projects/:projectId/requirements —— 分页列表（category/priority/status 过滤）。 */
  async index(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)

    const filters = await ctx.request.validateUsing(listRequirementsValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.requirements.list(organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  /** POST /projects/:projectId/requirements —— 创建需求。 */
  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createRequirementValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeCreate(actor, organizationId, projectId)

    const requirement = await this.requirements.create(organizationId, projectId, input, actor.id)
    return ctx.response.created({ data: requirement.serialize() })
  }

  /** GET /projects/:projectId/requirements/rtm-matrix —— RTM 追溯矩阵只读聚合。 */
  async rtmMatrix(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)

    const matrix = await this.requirements.getRtmMatrix(organizationId, projectId)
    return ctx.response.ok({ data: matrix })
  }

  /** GET /projects/:projectId/requirements/:id —— 详情（含已绑定任务）。 */
  async show(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const requirementId = Number(ctx.params.id)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)

    const requirement = await this.requirements.get(organizationId, projectId, requirementId)
    return ctx.response.ok({ data: requirement.serialize() })
  }

  /** PATCH /projects/:projectId/requirements/:id —— 更新内容/整表替换验收准则/单项状态流转。 */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateRequirementValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const requirementId = Number(ctx.params.id)
    await this.policy.authorizeUpdate(actor, organizationId, projectId)

    const serviceInput: UpdateRequirementInput = { ...input }
    delete (serviceInput as Partial<{ criterionUpdates?: unknown }>).criterionUpdates

    let requirement = await this.requirements.update(
      organizationId,
      projectId,
      requirementId,
      serviceInput,
      actor.id,
    )
    for (const update of input.criterionUpdates ?? []) {
      requirement = await this.requirements.updateCriterionStatus(
        organizationId,
        projectId,
        requirementId,
        update.id,
        update.status,
        actor.id,
      )
    }
    return ctx.response.ok({ data: requirement.serialize() })
  }

  /** DELETE /projects/:projectId/requirements/:id —— 软删除（绑定记录级联清理）。 */
  async destroy(ctx: HttpContext) {
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const requirementId = Number(ctx.params.id)
    await this.policy.authorizeDelete(actor, organizationId, projectId)

    await this.requirements.delete(organizationId, projectId, requirementId, actor.id)
    return ctx.response.noContent()
  }

  /** POST /projects/:projectId/requirements/:id/tasks —— 绑定交付任务（须属当前项目）。 */
  async bindTask(ctx: HttpContext) {
    const { taskId } = await ctx.request.validateUsing(bindTaskValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const requirementId = Number(ctx.params.id)
    await this.policy.authorizeUpdate(actor, organizationId, projectId)

    const link = await this.requirements.bindTask(organizationId, projectId, requirementId, taskId)
    return ctx.response.created({ data: link.serialize() })
  }

  /** DELETE /projects/:projectId/requirements/:id/tasks/:taskId —— 解绑任务。 */
  async unbindTask(ctx: HttpContext) {
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const requirementId = Number(ctx.params.id)
    const taskId = Number(ctx.params.taskId)
    await this.policy.authorizeUpdate(actor, organizationId, projectId)

    await this.requirements.unbindTask(organizationId, projectId, requirementId, taskId)
    return ctx.response.noContent()
  }
}
