import type { HttpContext } from '@adonisjs/core/http'
import { AuthRequiredException, PermissionDeniedException } from '#exceptions/api_exception'
import RbacService from '#services/rbac_service'
import {
  TRIZ_ASSISTANT_VIEW,
  TRIZ_ASSISTANT_MANAGE,
  AI_TRIGGER,
  type Permission,
} from '#start/rbac/permissions'

/**
 * AI-TRIZ 助手 Policy（v3-ai-triz-assistant §3.6）。
 *
 * view: 查看助手运行/消息（MEMBER+）
 * submit: 提交消息/创建运行（需要 view + manage）
 * aiNarrate: 请求 AI 增强叙述（需要 manage + ai:trigger）
 * feedback: 记录反馈（需要 view）
 * preview: 创建 handoff preview（需要 view + manage）
 *
 * 判定链复用 RbacService（与 rbac_middleware 同一条）；超管放行与项目级
 * 授权由 RbacService 内部处理，跨组织隔离由 Controller 的 organization_id 过滤保证。
 */
export default class TrizAssistantPolicy {
  #rbac: RbacService

  constructor(rbac: RbacService = new RbacService()) {
    this.#rbac = rbac
  }

  async view(ctx: HttpContext): Promise<void> {
    await this.#authorize(ctx, [TRIZ_ASSISTANT_VIEW])
  }

  async submit(ctx: HttpContext): Promise<void> {
    await this.#authorize(ctx, [TRIZ_ASSISTANT_VIEW, TRIZ_ASSISTANT_MANAGE])
  }

  async aiNarrate(ctx: HttpContext): Promise<void> {
    await this.#authorize(ctx, [TRIZ_ASSISTANT_MANAGE, AI_TRIGGER])
  }

  async feedback(ctx: HttpContext): Promise<void> {
    await this.#authorize(ctx, [TRIZ_ASSISTANT_VIEW])
  }

  async preview(ctx: HttpContext): Promise<void> {
    await this.#authorize(ctx, [TRIZ_ASSISTANT_VIEW, TRIZ_ASSISTANT_MANAGE])
  }

  /**
   * 非抛出式判定：调用方需要把「能否触发 AI」作为能力位传给 Service 时用。
   * 与 aiNarrate 走同一条 RbacService 判定链，只是不抛异常。
   */
  async canTriggerAi(ctx: HttpContext): Promise<boolean> {
    const user = ctx.auth.user
    const organizationId = ctx.tenant?.organizationId
    if (!user || organizationId === null || organizationId === undefined) return false

    const projectIdParam = ctx.request.param('projectId')
    const projectId = projectIdParam ? Number(projectIdParam) : undefined
    const result = await this.#rbac.check(user, AI_TRIGGER, organizationId, projectId)
    return result.allowed
  }

  async #authorize(ctx: HttpContext, permissions: Permission[]): Promise<void> {
    const user = await ctx.auth.authenticate()
    if (!user) throw new AuthRequiredException('需要认证')

    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      throw new PermissionDeniedException('缺少组织上下文')
    }

    const projectIdParam = ctx.request.param('projectId')
    const projectId = projectIdParam ? Number(projectIdParam) : undefined

    for (const permission of permissions) {
      const result = await this.#rbac.check(user, permission, organizationId, projectId)
      if (!result.allowed) {
        throw new PermissionDeniedException(`缺少 AI-TRIZ 助手所需权限：${permission}`)
      }
    }
  }
}
