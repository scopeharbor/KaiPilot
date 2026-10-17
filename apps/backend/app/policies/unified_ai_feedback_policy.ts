/**
 * v3-unified-ai-feedback-ledger §7.7 — 反馈账本 RBAC 策略。
 *
 * 只读策略：view / downstream 需要当前组织成员身份。
 * 全部读路径附加 organization_id 过滤（组织隔离）。
 *
 * 注（v3-backend-type-debt-closure）：本文件原按 `ctx.bouncer.allows('org_member')` 编写——
 * `@adonisjs/bouncer` **不是本仓库依赖**（见 `rbac_policy.ts` 的说明：为避免仅为形式引入新依赖，
 * 本仓库统一采用「服务背书的 Policy 类」），因此原写法既无法编译也无法运行。
 * 现改为与 `DlpWatermarkPolicy` / `EnterpriseAuditPolicy` 一致的 `ctx.rbac` + `ctx.tenant` 判定。
 *
 * 反馈账本没有独立权限码（RBAC catalog 无 `ai_feedback:*`），只读聚合按**当前组织成员身份**
 * 判定：请求的 organizationId 必须与租户上下文一致，且请求已通过认证。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'

export default class UnifiedAiFeedbackPolicy {
  /**
   * 组织隔离：请求路径上的 organizationId 必须与当前租户上下文一致。
   * 不一致时视为不可见（由调用方转成非泄露错误）。
   */
  private isSameOrganization(ctx: HttpContext, organizationId: number): boolean {
    const tenantOrgId = ctx.tenant?.organizationId
    if (tenantOrgId === undefined || tenantOrgId === null) return false
    return Number(tenantOrgId) === Number(organizationId)
  }

  private isAuthenticated(ctx: HttpContext): boolean {
    return Boolean(ctx.auth?.user)
  }

  /** view —— 查看采纳率聚合与事件列表。 */
  async view(ctx: HttpContext, organizationId: number): Promise<boolean> {
    return this.isAuthenticated(ctx) && this.isSameOrganization(ctx, organizationId)
  }

  /** downstream —— 下游只读接口。 */
  async downstream(ctx: HttpContext, organizationId: number): Promise<boolean> {
    return this.view(ctx, organizationId)
  }

  async assertView(ctx: HttpContext, organizationId: number): Promise<void> {
    if (!(await this.view(ctx, organizationId))) {
      throw new PermissionDeniedException('无权查看反馈账本聚合')
    }
  }

  async assertDownstream(ctx: HttpContext, organizationId: number): Promise<void> {
    if (!(await this.downstream(ctx, organizationId))) {
      throw new PermissionDeniedException('无权访问反馈账本下游接口')
    }
  }
}
