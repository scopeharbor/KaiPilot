/**
 * v3-ocr-provider-observability-cost-controls — OCR provider observability 权限策略。
 *
 * 只读策略：检查用户是否有 `ocr_provider_observability:view` 权限。
 * 判定链复用 RbacService（与 rbac_middleware 同一条），超管放行在其内部处理。
 */

import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'
import RbacService from '#services/rbac_service'
import { OCR_PROVIDER_OBSERVABILITY_VIEW } from '#start/rbac/permissions'

export default class OcrProviderObservabilityPolicy {
  #rbac: RbacService

  constructor(rbac: RbacService = new RbacService()) {
    this.#rbac = rbac
  }

  /**
   * 检查用户是否有查看 OCR provider observability 的权限。
   */
  async view(ctx: HttpContext): Promise<true> {
    const user = ctx.auth.user
    if (!user) throw new PermissionDeniedException('未认证')

    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      throw new PermissionDeniedException('缺少组织上下文')
    }

    const projectIdParam = ctx.request.param('projectId')
    const projectId = projectIdParam ? Number(projectIdParam) : undefined

    const result = await this.#rbac.check(
      user,
      OCR_PROVIDER_OBSERVABILITY_VIEW,
      organizationId,
      projectId,
    )
    if (!result.allowed) {
      throw new PermissionDeniedException('无权查看 OCR provider 观测数据')
    }

    return true
  }
}
