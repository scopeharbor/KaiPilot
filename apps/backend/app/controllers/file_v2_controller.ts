import FilePolicy from '#policies/file_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import FileVersionService from '#services/file_v2/file_version_service'
import FileTagService from '#services/file_v2/file_tag_service'
import FileSearchService from '#services/file_v2/file_search_service'
import FileLinkService from '#services/file_v2/file_link_service'
import FileBatchService from '#services/file_v2/file_batch_service'
import TrashService from '#services/file_v2/trash_service'
import {
  uploadVersionValidator,
  createTagValidator,
  updateTagValidator,
  assignTagsValidator,
  batchActionValidator,
  batchTagValidator,
  listTrashValidator,
  trashValidator,
  searchFilesValidator,
  createLinkValidator,
} from '#validators/file_v2'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * V2 文件管理 Controller（v2-file-management-upgrade）。
 * 扩展既有文件库，提供版本、标签、搜索、实体关联、批量操作和回收站端点。
 */
@inject()
export default class FileV2Controller {
  constructor(
    private fileVersionService: FileVersionService,
    private fileTagService: FileTagService,
    private fileSearchService: FileSearchService,
    private fileLinkService: FileLinkService,
    private fileBatchService: FileBatchService,
    private trashService: TrashService,
    private policy: FilePolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  // ===== 版本端点 =====

  /**
   * POST /projects/:projectId/files/v2/attachments/:attachmentId/versions
   * 上传新版本。
   */
  async uploadVersion(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const attachmentId = Number(ctx.params.attachmentId)
    const input = await ctx.request.validateUsing(uploadVersionValidator)
    await this.assertManage(user, ctx, projectId)

    const file = ctx.request.file('file', {
      size: '10mb',
      extnames: ['pdf', 'md', 'txt', 'csv', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'webp'],
    })

    if (!file) {
      const { ValidationException } = await import('#exceptions/api_exception')
      throw new ValidationException('请上传文件')
    }

    // 上传到临时目录，再交由服务处理
    const { ensureDir, getTempDir, sanitizeFileName } = await import('#services/file_storage')
    const tempDir = getTempDir(projectId)
    await ensureDir(tempDir)
    const { safeName } = sanitizeFileName(file.clientName)
    const tempPath = `${tempDir}/${safeName}`
    await file.move(tempPath)

    const version = await this.fileVersionService.uploadVersion({
      attachmentId,
      projectId,
      tempFilePath: tempPath,
      fileName: file.clientName,
      mimeType: file.type ?? null,
      fileSize: file.size,
      userId: user.id,
      organizationId: ctx.tenant!.organizationId,
      changeNote: input.changeNote ?? null,
      requestId: ctx.request.id(),
    })

    return ctx.response.created({ data: version })
  }

  /**
   * GET /projects/:projectId/files/v2/attachments/:attachmentId/versions
   * 列出版本列表。
   */
  async listVersions(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const attachmentId = Number(ctx.params.attachmentId)
    await this.assertView(user, ctx, projectId)

    const result = await this.fileVersionService.listVersions(attachmentId, projectId)
    return ctx.response.ok({ data: result })
  }

  /**
   * GET /projects/:projectId/files/v2/versions/:versionId/download
   * 下载历史版本。
   */
  async downloadVersion(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const versionId = Number(ctx.params.versionId)
    await this.assertView(user, ctx, projectId)

    const { filePath, fileName, mimeType } = await this.fileVersionService.downloadVersion(
      versionId,
      projectId,
    )

    ctx.response.header('Content-Type', mimeType ?? 'application/octet-stream')
    ctx.response.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    )
    return ctx.response.download(filePath)
  }

  /**
   * POST /projects/:projectId/files/v2/attachments/:attachmentId/versions/rollback
   * 回滚到指定版本。
   */
  async rollbackVersion(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const attachmentId = Number(ctx.params.attachmentId)
    const targetVersionNo = Number(ctx.request.input('targetVersionNo'))
    await this.assertManage(user, ctx, projectId)

    const version = await this.fileVersionService.rollback({
      attachmentId,
      projectId,
      targetVersionNo,
      userId: user.id,
      organizationId: ctx.tenant!.organizationId,
      requestId: ctx.request.id(),
    })

    return ctx.response.ok({ data: version })
  }

  // ===== 标签端点 =====

  /**
   * GET /projects/:projectId/files/v2/tags
   * 列出项目标签。
   */
  async listTags(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.assertView(user, ctx, projectId)

    const tags = await this.fileTagService.listTags(projectId)
    return ctx.response.ok({ data: tags })
  }

  /**
   * POST /projects/:projectId/files/v2/tags
   * 创建标签。
   */
  async createTag(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(createTagValidator)
    await this.assertManage(user, ctx, projectId)

    const tag = await this.fileTagService.createTag(
      projectId,
      ctx.tenant!.organizationId,
      input.name,
      input.color ?? null,
      user.id,
    )

    return ctx.response.created({ data: tag })
  }

  /**
   * PATCH /projects/:projectId/files/v2/tags/:tagId
   * 更新标签。
   */
  async updateTag(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const tagId = Number(ctx.params.tagId)
    const input = await ctx.request.validateUsing(updateTagValidator)
    await this.assertManage(user, ctx, projectId)

    const tag = await this.fileTagService.updateTag(
      projectId,
      tagId,
      input.name ?? '',
      user.id,
      input.color ?? undefined,
    )

    return ctx.response.ok({ data: tag })
  }

  /**
   * DELETE /projects/:projectId/files/v2/tags/:tagId
   * 删除标签。
   */
  async deleteTag(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const tagId = Number(ctx.params.tagId)
    await this.assertManage(user, ctx, projectId)

    await this.fileTagService.deleteTag(projectId, tagId, user.id)
    return ctx.response.noContent()
  }

  /**
   * POST /projects/:projectId/files/v2/tags/assign
   * 分配标签。
   */
  async assignTags(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(assignTagsValidator)
    await this.assertManage(user, ctx, projectId)

    await this.fileTagService.assignTags(
      projectId,
      input.fileType,
      input.fileId,
      input.tagIds,
      user.id,
    )

    return ctx.response.ok({ message: '标签已分配' })
  }

  // ===== 实体关联端点 =====

  /**
   * POST /projects/:projectId/files/v2/links
   * 创建实体关联。
   */
  async createLink(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(createLinkValidator)
    await this.assertManage(user, ctx, projectId)

    const link = await this.fileLinkService.linkFile({
      projectId,
      organizationId: ctx.tenant!.organizationId,
      fileType: input.fileType,
      fileId: input.fileId,
      entityType: input.entityType,
      entityId: input.entityId,
      linkType: input.linkType ?? 'attachment',
      userId: user.id,
    })

    return ctx.response.created({ data: link })
  }

  /**
   * DELETE /projects/:projectId/files/v2/links/:linkId
   * 移除实体关联。
   */
  async deleteLink(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const linkId = Number(ctx.params.linkId)
    await this.assertManage(user, ctx, projectId)

    await this.fileLinkService.unlinkFile({
      projectId,
      linkId,
      organizationId: ctx.tenant!.organizationId,
      userId: user.id,
    })

    return ctx.response.noContent()
  }

  /**
   * GET /projects/:projectId/files/v2/entity/:entityType/:entityId
   * 获取实体关联的文件列表。
   */
  async listEntityFiles(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const entityType = ctx.params.entityType as string
    const entityId = Number(ctx.params.entityId)
    await this.assertView(user, ctx, projectId)

    const files = await this.fileLinkService.getEntityFiles(entityType, entityId, projectId)
    return ctx.response.ok({ data: files })
  }

  // ===== 搜索端点 =====

  /**
   * GET /projects/:projectId/files/v2/search
   * 搜索文件。
   */
  async search(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const filters = await ctx.request.validateUsing(searchFilesValidator)
    await this.assertView(user, ctx, projectId)

    const searchResult = await this.fileSearchService.search({
      projectId,
      query: filters.q,
      fileType: filters.fileType,
      mimeType: filters.mimeType,
      entityType: filters.entityType,
      uploadedBy: filters.uploadedBy,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      page: filters.page,
      perPage: filters.perPage,
    })

    // 审计搜索
    await this.audit.log({
      event: AuditEvent.FILE_SEARCH_PERFORMED,
      userId: user.id,
      organizationId: ctx.tenant!.organizationId,
      projectId,
      metadata: { query: filters.q, resultCount: searchResult.meta.total },
    })

    return ctx.response.ok(searchResult)
  }

  // ===== 回收站端点 =====

  /**
   * GET /projects/:projectId/files/v2/trash
   * 回收站列表。
   */
  async listTrash(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const filters = await ctx.request.validateUsing(listTrashValidator)
    await this.assertView(user, ctx, projectId)

    const result = await this.trashService.listTrash(projectId, ctx.tenant!.organizationId, filters)
    return ctx.response.ok(result)
  }

  /**
   * POST /projects/:projectId/files/v2/trash/:attachmentId
   * 移动到回收站。
   */
  async trash(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const attachmentId = Number(ctx.params.attachmentId)
    const input = await ctx.request.validateUsing(trashValidator)
    await this.assertManage(user, ctx, projectId)

    await this.trashService.trash(
      attachmentId,
      projectId,
      user.id,
      ctx.tenant!.organizationId,
      input.reason ?? null,
      ctx.request.id(),
    )

    return ctx.response.ok({ message: '已移入回收站' })
  }

  /**
   * POST /projects/:projectId/files/v2/trash/:attachmentId/restore
   * 从回收站恢复。
   */
  async restore(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const attachmentId = Number(ctx.params.attachmentId)
    await this.assertManage(user, ctx, projectId)

    await this.trashService.restore(
      attachmentId,
      projectId,
      user.id,
      ctx.tenant!.organizationId,
      ctx.request.id(),
    )

    return ctx.response.ok({ message: '已恢复' })
  }

  /**
   * DELETE /projects/:projectId/files/v2/trash/:attachmentId/permanent
   * 永久删除。
   */
  async permanentDelete(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const attachmentId = Number(ctx.params.attachmentId)
    await this.assertManage(user, ctx, projectId)

    await this.trashService.permanentDelete(
      attachmentId,
      projectId,
      user.id,
      ctx.tenant!.organizationId,
      ctx.request.id(),
    )

    return ctx.response.noContent()
  }

  // ===== 批量操作端点 =====

  /**
   * POST /projects/:projectId/files/v2/batch/delete
   * 批量删除。
   */
  async batchDelete(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(batchActionValidator)
    await this.assertManage(user, ctx, projectId)

    const result = await this.fileBatchService.batchDelete(
      input.items,
      projectId,
      user.id,
      ctx.tenant!.organizationId,
      ctx.request.id(),
    )

    return ctx.response.ok(result)
  }

  /**
   * POST /projects/:projectId/files/v2/batch/restore
   * 批量恢复。
   */
  async batchRestore(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(batchActionValidator)
    await this.assertManage(user, ctx, projectId)

    const result = await this.fileBatchService.batchRestore(
      input.items,
      projectId,
      user.id,
      ctx.tenant!.organizationId,
      ctx.request.id(),
    )

    return ctx.response.ok(result)
  }

  /**
   * DELETE /projects/:projectId/files/v2/batch/permanent
   * 批量永久删除。
   */
  async batchPermanentDelete(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(batchActionValidator)
    await this.assertManage(user, ctx, projectId)

    const result = await this.fileBatchService.batchPermanentDelete(
      input.items,
      projectId,
      user.id,
      ctx.tenant!.organizationId,
      ctx.request.id(),
    )

    return ctx.response.ok(result)
  }

  /**
   * POST /projects/:projectId/files/v2/batch/tag
   * 批量打标签。
   */
  async batchTag(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(batchTagValidator)
    await this.assertManage(user, ctx, projectId)

    const result = await this.fileBatchService.batchTag(
      input.items,
      projectId,
      input.tagIds,
      user.id,
      ctx.tenant!.organizationId,
    )

    return ctx.response.ok(result)
  }

  // ===== 权限辅助 =====

  private async assertView(user: User, ctx: HttpContext, projectId: number) {
    const allowed = await this.policy.view(user, ctx.tenant!.organizationId, projectId)
    if (!allowed) {
      const { PermissionDeniedException } = await import('#exceptions/api_exception')
      throw new PermissionDeniedException('无权查看文件')
    }
  }

  private async assertManage(user: User, ctx: HttpContext, projectId: number) {
    const allowed = await this.policy.manage(user, ctx.tenant!.organizationId, projectId)
    if (!allowed) {
      const { PermissionDeniedException } = await import('#exceptions/api_exception')
      throw new PermissionDeniedException('无权管理文件')
    }
  }
}
