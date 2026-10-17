/**
 * OcrDocumentSearchIndexController — OCR 搜索索引 API 控制器（v3-ocr-document-search-indexing §7.2）
 *
 * 端点全部挂载在 /api/v1/projects/:projectId/ocr/search-index 下。
 * 所有操作需项目成员 + 相应 RBAC 权限。
 */

import { OcrDocumentSearchIndexService } from '#services/ai_ocr/ocr_document_search_index_service'
import OcrDocumentSearchIndexPolicy from '#policies/ocr_document_search_index_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import { buildOcrSearchIndexAuditMetadata } from '@aiproj/types'
import {
  ocrSearchIndexListValidator,
  ocrSearchIndexPreviewValidator,
  ocrSearchIndexExecuteValidator,
  ocrSearchIndexReindexValidator,
  ocrSearchIndexUnindexPreviewValidator,
  ocrSearchIndexUnindexExecuteValidator,
} from '#validators/ocr_search_index'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class OcrDocumentSearchIndexController {
  constructor(
    private indexService: OcrDocumentSearchIndexService,
    private audit: AuditService,
  ) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = (ctx as any).tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private projectIdOf(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private userIdOf(ctx: HttpContext): number {
    const user = (ctx as any).auth?.user
    return user ? Number(user.id) : 0
  }

  private makePolicy(ctx: HttpContext): OcrDocumentSearchIndexPolicy {
    return new OcrDocumentSearchIndexPolicy(ctx)
  }

  /** GET /api/v1/projects/:projectId/ocr/search-index */
  async list(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    policy.assertView()

    const query = await ctx.request.validateUsing(ocrSearchIndexListValidator)
    const result = await this.indexService.listStatus(orgId, projectId, query)

    await this.audit.log({
      event: AuditEvent.OCR_SEARCH_INDEX_VIEW,
      userId,
      organizationId: orgId,
      projectId,
      entityType: 'ocr_search_index',
      metadata: buildOcrSearchIndexAuditMetadata({
        organizationId: orgId,
        projectId,
        sourceKinds: query.sourceKind ? [query.sourceKind] : undefined,
        sourceIds: query.sourceId ? [query.sourceId] : undefined,
        extractionIds: query.extractionId ? [query.extractionId] : undefined,
      }),
    })

    return ctx.response.ok(result)
  }

  /** POST /api/v1/projects/:projectId/ocr/search-index/preview */
  async preview(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    policy.assertPreview()

    const body = await ctx.request.validateUsing(ocrSearchIndexPreviewValidator)
    const result = await this.indexService.previewIndexing(
      orgId,
      projectId,
      body.extractionIds,
      body.sourceKind,
      body.sourceId,
      userId,
    )

    await this.audit.log({
      event: AuditEvent.OCR_SEARCH_INDEX_PREVIEW,
      userId,
      organizationId: orgId,
      projectId,
      entityType: 'ocr_search_index',
      metadata: buildOcrSearchIndexAuditMetadata({
        organizationId: orgId,
        projectId,
        sourceKinds: body.sourceKind ? [body.sourceKind] : undefined,
        sourceIds: body.sourceId ? [body.sourceId] : undefined,
        extractionIds: body.extractionIds,
        previewHash: result.data.previewHash,
      }),
    })

    return ctx.response.ok(result)
  }

  /** POST /api/v1/projects/:projectId/ocr/search-index/execute */
  async execute(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    policy.assertExecute()

    const body = await ctx.request.validateUsing(ocrSearchIndexExecuteValidator)
    try {
      const result = await this.indexService.executeIndexing(orgId, projectId, body, userId)
      return ctx.response.ok(result)
    } catch (err) {
      if (err instanceof Error && err.message === 'STALE_PREVIEW') {
        throw new ValidationException('预览已过期，请重新预览')
      }
      throw err
    }
  }

  /** POST /api/v1/projects/:projectId/ocr/search-index/reindex-preview */
  async reindexPreview(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    policy.assertReindex()

    const body = await ctx.request.validateUsing(ocrSearchIndexReindexValidator)
    const result = await this.indexService.previewReindex(orgId, projectId, body, userId)

    await this.audit.log({
      event: AuditEvent.OCR_SEARCH_INDEX_REINDEX_PREVIEW,
      userId,
      organizationId: orgId,
      projectId,
      entityType: 'ocr_search_index',
      metadata: buildOcrSearchIndexAuditMetadata({
        organizationId: orgId,
        projectId,
        sourceKinds: body.sourceKind ? [body.sourceKind] : undefined,
        sourceIds: body.sourceId ? [body.sourceId] : undefined,
        extractionIds: body.extractionIds,
        previewHash: result.data.previewHash,
      }),
    })

    return ctx.response.ok(result)
  }

  /** POST /api/v1/projects/:projectId/ocr/search-index/reindex-execute */
  async reindexExecute(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    policy.assertReindex()

    const body = await ctx.request.validateUsing(ocrSearchIndexExecuteValidator)
    try {
      const result = await this.indexService.executeReindex(orgId, projectId, body, userId)
      return ctx.response.ok(result)
    } catch (err) {
      if (err instanceof Error && err.message === 'STALE_PREVIEW') {
        throw new ValidationException('预览已过期，请重新预览')
      }
      throw err
    }
  }

  /** POST /api/v1/projects/:projectId/ocr/search-index/unindex-preview */
  async unindexPreview(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    policy.assertUnindex()

    const body = await ctx.request.validateUsing(ocrSearchIndexUnindexPreviewValidator)
    const result = await this.indexService.previewUnindex(orgId, projectId, body.entryIds)

    await this.audit.log({
      event: AuditEvent.OCR_SEARCH_INDEX_UNINDEX_PREVIEW,
      userId,
      organizationId: orgId,
      projectId,
      entityType: 'ocr_search_index',
      metadata: buildOcrSearchIndexAuditMetadata({
        organizationId: orgId,
        projectId,
        entryIds: body.entryIds,
        previewHash: result.data.previewHash,
      }),
    })

    return ctx.response.ok(result)
  }

  /** POST /api/v1/projects/:projectId/ocr/search-index/unindex-execute */
  async unindexExecute(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    policy.assertUnindex()

    const body = await ctx.request.validateUsing(ocrSearchIndexUnindexExecuteValidator)
    try {
      const result = await this.indexService.executeUnindex(
        orgId,
        projectId,
        body.entryIds,
        body.previewHash,
        body.idempotencyKey,
        body.note ?? null,
        userId,
      )
      return ctx.response.ok(result)
    } catch (err) {
      if (err instanceof Error && err.message === 'STALE_PREVIEW') {
        throw new ValidationException('预览已过期，请重新预览')
      }
      throw err
    }
  }
}
