/**
 * DocumentSearchController（v3-document-full-text-search §8.2）
 *
 * 项目文档搜索索引管理端点：
 * - GET status：查看索引覆盖率
 * - POST reindex：触发索引重建
 */
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import DocumentSearchIndexService from '#services/document_search_index_service'
import DocumentSearchPolicy from '#policies/document_search_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import { documentSearchReindexValidator } from '#validators/document_search'
import type User from '#models/user'

@inject()
export default class DocumentSearchController {
  constructor(
    private searchIndex: DocumentSearchIndexService,
    private policy: DocumentSearchPolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  /**
   * GET /api/v1/projects/:projectId/document-search/status
   */
  async status(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId

    // 权限检查
    const canView = await this.policy.view(user, organizationId)
    if (!canView) {
      await this.audit.log({
        event: AuditEvent.DOCUMENT_SEARCH_REINDEX_DENIED,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'document_search',
        entityId: projectId,
        requestId: ctx.request.id(),
        metadata: { reason: 'permission_denied', action: 'status' },
      })
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无权查看文档搜索索引状态' },
      })
    }

    const data = await this.searchIndex.getStatus(projectId, organizationId)
    return ctx.response.ok({ data })
  }

  /**
   * POST /api/v1/projects/:projectId/document-search/reindex
   */
  async reindex(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId

    // 权限检查
    const canManage = await this.policy.manage(user, organizationId)
    if (!canManage) {
      await this.audit.log({
        event: AuditEvent.DOCUMENT_SEARCH_REINDEX_DENIED,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'document_search',
        entityId: projectId,
        requestId: ctx.request.id(),
        metadata: { reason: 'permission_denied', action: 'reindex' },
      })
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无权触发文档搜索索引重建' },
      })
    }

    const payload = await ctx.request.validateUsing(documentSearchReindexValidator, {
      data: { ...ctx.request.body(), projectId },
    })

    const result = await this.searchIndex.reindexProject(projectId, organizationId, {
      full: payload.full ?? false,
    })

    // 审计
    await this.audit.log({
      event: AuditEvent.DOCUMENT_SEARCH_INDEX_REBUILT,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'document_search',
      entityId: projectId,
      requestId: ctx.request.id(),
      metadata: {
        ...result,
        full: payload.full ?? false,
      },
    })

    return ctx.response.ok({ data: result })
  }
}
