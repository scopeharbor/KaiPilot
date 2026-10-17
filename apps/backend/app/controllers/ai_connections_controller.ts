import AiConnectionService from '#services/ai_connection_service'
import AiConnectionPolicy from '#policies/ai_connection_policy'
import User from '#models/user'
import {
  createConnectionValidator,
  testConnectionValidator,
  updateConnectionValidator,
} from '#validators/ai_connection'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * AI 连接控制器(ai-gateway-abstraction):REST `/api/v1/ai/connections/*`。
 *
 * 权限:list/show 复用 auth + 组织隔离(能 ai:trigger 即可见);store/update/destroy/test 需
 * `ai:connection:manage`。响应永不回明文 key(Service.toDto 保证)。
 */
@inject()
export default class AiConnectionsController {
  constructor(
    private connections: AiConnectionService,
    private policy: AiConnectionPolicy,
  ) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private async authorizeManage(user: User, organizationId: number) {
    const allowed = await this.policy.manage(user, organizationId)
    if (!allowed) throw new PermissionDeniedException('无权管理 AI 连接')
  }

  private auditCtx(ctx: HttpContext) {
    return { requestId: ctx.request.id() ?? null }
  }

  async index(ctx: HttpContext) {
    const organizationId = this.orgIdOf(ctx)
    const rows = await this.connections.list(organizationId)
    return ctx.response.ok({ data: rows.map((c) => this.connections.toDto(c)) })
  }

  async show(ctx: HttpContext) {
    const organizationId = this.orgIdOf(ctx)
    const conn = await this.connections.get(Number(ctx.params.id), organizationId)
    return ctx.response.ok({ data: this.connections.toDto(conn) })
  }

  async store(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    await this.authorizeManage(user, organizationId)
    const input = await ctx.request.validateUsing(createConnectionValidator)
    const conn = await this.connections.create(input, user.id, organizationId, this.auditCtx(ctx))
    return ctx.response.created({ data: this.connections.toDto(conn) })
  }

  async update(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    await this.authorizeManage(user, organizationId)
    const input = await ctx.request.validateUsing(updateConnectionValidator)
    const conn = await this.connections.update(
      Number(ctx.params.id),
      input,
      user.id,
      organizationId,
      this.auditCtx(ctx),
    )
    return ctx.response.ok({ data: this.connections.toDto(conn) })
  }

  async destroy(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    await this.authorizeManage(user, organizationId)
    await this.connections.delete(
      Number(ctx.params.id),
      user.id,
      organizationId,
      this.auditCtx(ctx),
    )
    return ctx.response.noContent()
  }

  async test(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    await this.authorizeManage(user, organizationId)
    const { modelName } = await ctx.request.validateUsing(testConnectionValidator)
    const result = await this.connections.testConnection(
      Number(ctx.params.id),
      organizationId,
      user.id,
      this.auditCtx(ctx),
      modelName ? { modelName } : {},
    )
    return ctx.response.ok({ data: result })
  }
}
