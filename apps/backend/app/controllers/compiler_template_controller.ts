/**
 * v3-template-compiler-plugin-integration —— CompilerTemplateController（tasks 2.3）。
 *
 * 提供模板候选列表与详情预览，仅暴露当前组织 enabled 且 domain=compiler-project-start 的可用模板。
 */

import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import CompilerTemplateContributionResolver from '#services/compiler_template_contribution_resolver'
import CompilerPolicy from '#policies/compiler_policy'

@inject()
export default class CompilerTemplateController {
  constructor(
    private readonly resolver: CompilerTemplateContributionResolver,
    private readonly policy: CompilerPolicy,
  ) {}

  /** GET /api/v1/ai/compiler/templates —— 列出可用模板候选 */
  async list(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canRead(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const candidates = await this.resolver.listCandidates(tenant.organizationId)

    return response.ok({
      data: candidates,
      meta: { total: candidates.length },
    })
  }

  /** GET /api/v1/ai/compiler/templates/:templateId —— 模板详情与快照 */
  async getDetail(ctx: HttpContext) {
    const { response, authUser, tenant, params, request } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canRead(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const templateId = params.templateId as string
    if (!templateId || !/^ptpl_[a-z0-9_]+$/.test(templateId)) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid templateId format. Must match ^ptpl_[a-z0-9_]+$',
        },
      })
    }

    const detail = await this.resolver.getDetail(tenant.organizationId, templateId)
    if (!detail) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Template not found or not available' },
      })
    }

    // 可选：返回时附带 selectionDigest 的预览校验
    const qs = request.qs() as { selectionDigest?: string }
    if (qs.selectionDigest && qs.selectionDigest !== detail.selectionDigest) {
      return response.ok({
        data: detail,
        meta: { stale: true, message: 'Selection digest is stale; template has been updated.' },
      })
    }

    return response.ok({ data: detail })
  }
}
