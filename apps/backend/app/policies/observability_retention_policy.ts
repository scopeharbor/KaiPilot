/**
 * 观测数据保留治理 RBAC 策略。
 *
 * - view_retention：查看保留状态
 * - manage_retention：管理保留策略
 * - export_retention：导出观察数据
 * - manage_cleanup：执行清理作业
 *
 * 全部方法改走既有权限求值路径，不再使用 `user.role === 'admin'` 这类字符串判定。
 * 组织隔离：请求的 organizationId 必须与租户上下文一致。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'
import RbacService from '#services/rbac_service'
import {
  OCR_RETENTION_VIEW,
  OCR_RETENTION_MANAGE,
  OCR_RETENTION_CLEANUP,
  AI_QUALITY_COST_CONSOLE_EXPORT,
} from '#start/rbac/permissions'

export default class ObservabilityRetentionPolicy {
  #rbac: RbacService

  constructor(rbac: RbacService = new RbacService()) {
    this.#rbac = rbac
  }

  /** 检查用户是否可查看保留策略。 */
  async viewRetentionPolicy(ctx: HttpContext): Promise<boolean> {
    return this.#allows(ctx, OCR_RETENTION_VIEW)
  }

  /** 检查用户是否可管理保留策略（更新策略）。 */
  async manageRetentionPolicy(ctx: HttpContext): Promise<boolean> {
    return this.#allows(ctx, OCR_RETENTION_MANAGE)
  }

  /** 检查用户是否可导出观察数据。 */
  async exportRetentionPolicy(ctx: HttpContext): Promise<boolean> {
    return this.#allows(ctx, AI_QUALITY_COST_CONSOLE_EXPORT)
  }

  /** 检查用户是否可执行清理作业。 */
  async manageCleanup(ctx: HttpContext): Promise<boolean> {
    return this.#allows(ctx, OCR_RETENTION_CLEANUP)
  }

  async #allows(ctx: HttpContext, permission: string): Promise<boolean> {
    const user = ctx.auth.user
    if (!user) return false

    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      return false
    }

    const result = await this.#rbac.check(user, permission as any, organizationId, undefined)
    return result.allowed
  }

  /** 断言 view；失败时抛出权限异常（不泄露）。 */
  async assertView(ctx: HttpContext): Promise<void> {
    if (!(await this.viewRetentionPolicy(ctx))) {
      throw new PermissionDeniedException('无权查看保留策略')
    }
  }

  /** 断言 manage；失败时抛出权限异常（不泄露）。 */
  async assertManage(ctx: HttpContext): Promise<void> {
    if (!(await this.manageRetentionPolicy(ctx))) {
      throw new PermissionDeniedException('无权管理保留策略')
    }
  }
}
