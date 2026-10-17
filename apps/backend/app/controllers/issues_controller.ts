import type User from '#models/user'
import IssuePolicy from '#policies/issue_policy'
import IssueService from '#services/issue_service'
import {
  changeIssueStatusValidator,
  createIssueValidator,
  listIssuesValidator,
  updateIssueValidator,
} from '#validators/issue'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * 议题缺陷控制器（v3-chart-gallery-data-foundation，design D5）。
 *
 * 纯 HTTP 解析 + 服务调用 + 响应格式化；议题状态机/编号生成/跨租户 404
 * 由 IssueService 保证。
 */
@inject()
export default class IssuesController {
  constructor(
    private issues: IssueService,
    private policy: IssuePolicy,
  ) {}

  private user(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  /** GET /projects/:projectId/issues —— 分页列表（type/severity/priority/status/assigneeId 过滤）。 */
  async index(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)

    const filters = await ctx.request.validateUsing(listIssuesValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.issues.list(organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  /** POST /projects/:projectId/issues —— 登记议题（自动编号 ISS-NNN）。 */
  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createIssueValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeCreate(actor, organizationId, projectId)

    const issue = await this.issues.create(organizationId, projectId, input, actor.id)
    return ctx.response.created({ data: issue.serialize() })
  }

  /** GET /projects/:projectId/issues/:id —— 详情（含关联任务/报告人/处理人）。 */
  async show(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const issueId = Number(ctx.params.id)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)

    const issue = await this.issues.get(organizationId, projectId, issueId)
    return ctx.response.ok({ data: issue.serialize() })
  }

  /** PATCH /projects/:projectId/issues/:id —— 更新议题属性（不动状态机）。 */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateIssueValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const issueId = Number(ctx.params.id)
    await this.policy.authorizeUpdate(actor, organizationId, projectId)

    const issue = await this.issues.update(organizationId, projectId, issueId, input)
    return ctx.response.ok({ data: issue.serialize() })
  }

  /** PATCH /projects/:projectId/issues/:id/status —— 状态机流转（resolved 需根因/措施）。 */
  async changeStatus(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(changeIssueStatusValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const issueId = Number(ctx.params.id)
    await this.policy.authorizeChangeStatus(actor, organizationId, projectId)

    const issue = await this.issues.changeStatus(organizationId, projectId, issueId, input)
    return ctx.response.ok({ data: issue.serialize() })
  }

  /** DELETE /projects/:projectId/issues/:id —— 软删除。 */
  async destroy(ctx: HttpContext) {
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const issueId = Number(ctx.params.id)
    await this.policy.authorizeDelete(actor, organizationId, projectId)

    await this.issues.delete(organizationId, projectId, issueId)
    return ctx.response.noContent()
  }
}
