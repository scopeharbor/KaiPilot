/**
 * v3-copilot-memory-user-and-project —— CopilotMemoryController
 *
 * 端点：查看、确认、编辑、失效、删除、导出记忆条目。
 * 组织隔离全路径；用户记忆仅本人与组织审计权限可读。
 * 审计：所有生命周期转换写入低敏审计事件。
 *
 * ⚠️ 当前状态（v3-backend-type-debt-closure 核准结论）：
 * **记忆数据访问层尚未实现**——`app/services/copilot_memory/` 只有纯 helper
 * （审计事件构造、权限判定、导出脱敏），全仓库没有任何 `CopilotMemoryEntry.query()`。
 * 原实现的每个端点都返回硬编码结果，其中 confirm/ignore/update/invalidate/destroy
 * 返回 `{confirmed:true}` 之类的**假成功**：用户点了确认得到成功回执，实际什么都没发生。
 *
 * 因此本轮把全部端点改为**显式不可用（503）**而不是假成功——一个"看起来成功但没落库"
 * 的确认，比一个明确失败危险得多。真实数据层接线归 v3-copilot-memory-user-and-project。
 *
 * 同时修复：原 `requireAuth` 用 `(user as any).organizationId ?? 1`，
 * 在缺组织上下文时**静默落到组织 1**——若端点接线，将造成跨租户读写。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'

/** 记忆存储层未接线时的统一错误码。 */
const MEMORY_STORE_UNAVAILABLE = {
  code: 'MEMORY_STORE_UNAVAILABLE',
  message: '记忆存储层尚未接入，本次未读取也未修改任何记忆数据。',
} as const

@inject()
export default class CopilotMemoryController {
  /** GET /api/v1/ai/memory —— 查看记忆条目（按 scope 分组）。 */
  async index(ctx: HttpContext) {
    this.requireAuth(ctx)
    return this.storeUnavailable(ctx)
  }

  /** GET /api/v1/ai/memory/:id —— 查看单条记忆详情。 */
  async show(ctx: HttpContext) {
    this.requireAuth(ctx)
    return this.storeUnavailable(ctx)
  }

  /** POST /api/v1/ai/memory/:id/confirm —— 确认候选记忆。 */
  async confirm(ctx: HttpContext) {
    this.requireAuth(ctx)
    return this.storeUnavailable(ctx)
  }

  /** POST /api/v1/ai/memory/:id/ignore —— 忽略候选记忆。 */
  async ignore(ctx: HttpContext) {
    this.requireAuth(ctx)
    return this.storeUnavailable(ctx)
  }

  /** PATCH /api/v1/ai/memory/:id —— 编辑记忆条目。 */
  async update(ctx: HttpContext) {
    this.requireAuth(ctx)
    return this.storeUnavailable(ctx)
  }

  /** POST /api/v1/ai/memory/:id/invalidate —— 失效记忆条目。 */
  async invalidate(ctx: HttpContext) {
    this.requireAuth(ctx)
    return this.storeUnavailable(ctx)
  }

  /** DELETE /api/v1/ai/memory/:id —— 删除记忆条目（不可恢复）。 */
  async destroy(ctx: HttpContext) {
    this.requireAuth(ctx)
    return this.storeUnavailable(ctx)
  }

  /** GET /api/v1/ai/memory/export —— 导出低敏结构化格式。 */
  async export(ctx: HttpContext) {
    this.requireAuth(ctx)
    return this.storeUnavailable(ctx)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * 认证 + 组织上下文。
   *
   * 组织取自请求级租户上下文；缺失时 fail closed，**不得**回落到任何默认组织。
   */
  private requireAuth(ctx: HttpContext): { user: User; organizationId: number } {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant?.organizationId
    if (!organizationId) {
      throw new PermissionDeniedException('缺少组织上下文')
    }
    return { user, organizationId: Number(organizationId) }
  }

  /** 存储层未接线：显式 503，不返回空数据也不返回假成功。 */
  private storeUnavailable(ctx: HttpContext) {
    return ctx.response.serviceUnavailable({ error: MEMORY_STORE_UNAVAILABLE })
  }
}
