import { inject } from '@adonisjs/core'
import DocumentIntelligencePolicy from '#policies/document_intelligence_policy'
import DocumentIntelligenceWorkbenchService from '#services/document_intelligence/workbench_service'
import { DefaultDocumentIntelligenceReadAdapters } from '#services/document_intelligence/default_read_adapters'
import {
  assertOnlyAllowedQueryKeys,
  documentIntelligenceListQueryValidator,
  documentIntelligenceParamsValidator,
  documentIntelligenceSourceParamsValidator,
} from '#validators/document_intelligence'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * 文档智能工作台 Controller（v3-document-intelligence-workbench §3.17）。
 *
 * 职责严格限定：认证 → 参数解析与校验 → Policy → Service → 响应格式化。
 * 零业务逻辑、零写入；统一 `{ data, meta }` / `{ error }` envelope；
 * 错误响应不泄露跨租/隐藏源细节。
 *
 * 路由：
 * - GET /api/v1/projects/:projectId/document-intelligence/sources
 * - GET /api/v1/projects/:projectId/document-intelligence/sources/:sourceKind/:sourceId
 */
@inject()
export default class DocumentIntelligenceController {
  #service: DocumentIntelligenceWorkbenchService

  constructor() {
    // 只读聚合器只依赖 read ports；命令面注入由 read_ports 的静态/运行时守卫拒绝。
    this.#service = new DocumentIntelligenceWorkbenchService(
      new DefaultDocumentIntelligenceReadAdapters(),
    )
  }

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  /**
   * GET /api/v1/projects/:projectId/document-intelligence/sources
   */
  async sources(ctx: HttpContext) {
    await documentIntelligenceParamsValidator.validate({
      projectId: ctx.params.projectId,
    })
    const policy = new DocumentIntelligencePolicy(ctx)
    policy.assertView()

    const rawQs = ctx.request.qs() as Record<string, unknown>
    try {
      assertOnlyAllowedQueryKeys(rawQs)
    } catch (error) {
      throw new ValidationException((error as Error).message)
    }
    const query = await documentIntelligenceListQueryValidator.validate(rawQs)
    const result = await this.#service.listSources({
      organizationId: this.orgIdOf(ctx),
      projectId: Number(ctx.params.projectId),
      query: {
        attention: query.attention ?? null,
        sourceKind: query.sourceKind ?? null,
        capability: query.capability ?? null,
        status: query.status ?? null,
        sort: query.sort ?? 'updated_at',
        direction: query.direction ?? 'desc',
        page: query.page ?? 1,
        perPage: query.perPage ?? 20,
        search: query.search ?? null,
      },
      access: policy.resolveAccess(),
    })

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /**
   * GET /api/v1/projects/:projectId/document-intelligence/sources/:sourceKind/:sourceId
   */
  async sourceDetail(ctx: HttpContext) {
    const params = await documentIntelligenceSourceParamsValidator.validate({
      projectId: ctx.params.projectId,
      sourceKind: ctx.params.sourceKind,
      sourceId: ctx.params.sourceId,
    })
    const policy = new DocumentIntelligencePolicy(ctx)
    policy.assertView()

    const result = await this.#service.getSourceDetail({
      organizationId: this.orgIdOf(ctx),
      projectId: params.projectId,
      sourceKind: params.sourceKind,
      sourceId: params.sourceId,
      access: policy.resolveAccess(),
    })

    if (!result.found) {
      // 跨项目/已删除/不存在统一 404，不泄露存在性差异
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '来源不存在' },
      })
    }

    return ctx.response.ok({ data: result.data })
  }
}
