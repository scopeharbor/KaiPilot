import Attachment from '#models/attachment'
import AttachmentVersion from '#models/attachment_version'
import FileSearchEntry from '#models/file_search_entry'
import FileEntityLink from '#models/file_entity_link'
import AuditService, { AuditEvent } from '#services/audit_service'
import { safeUnlink } from '#services/file_storage'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import DatabaseTenantBoundary from '#services/database_tenant_boundary'
import { inject } from '@adonisjs/core'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

/**
 * 回收站管理服务（V2 回收站）。
 * 支持附件软删除、恢复、永久删除、列表查询和清空。
 * 物理文件在永久删除时清理，软删除保留文件。
 */
@inject()
export default class TrashService {
  /** 数据库层租户边界（v3-multitenant-database-isolation §6.5），无状态、无 DI 依赖。 */
  private boundary = new DatabaseTenantBoundary()

  constructor(private audit: AuditService) {}

  /**
   * 在组织 scope 内解析附件（含软删行）——`restore`/`permanentDelete` 必须重新
   * 校验租户归属（spec「Restore preserves tenant ownership」）。
   *
   * 原实现三个方法都只按 `project_id` 过滤，organizationId 仅用于写审计；
   * 组织层完全依赖 Controller 的 Policy，Service 被内部路径直接调用时无租户条件。
   * 跨组织与不存在统一 `RESOURCE_NOT_FOUND`，不泄露附件存在性与文件名。
   */
  private async scopedAttachmentOrFail(
    attachmentId: number,
    projectId: number,
    organizationId: number,
  ): Promise<Attachment> {
    const attachment = await this.boundary
      .scopedQuery(Attachment.query(), 'attachments', { organizationId }, 'restore')
      .where('id', attachmentId)
      .where('project_id', projectId)
      .first()
    if (!attachment) {
      throw new ResourceNotFoundException('附件不存在')
    }
    return attachment
  }

  /**
   * 软删除附件：标记 deletedAt、deletedBy、deleteReason。
   * 物理文件保留在磁盘上。
   */
  async trash(
    attachmentId: number,
    projectId: number,
    userId: number,
    organizationId: number,
    reason?: string | null,
    requestId?: string | null,
  ): Promise<Attachment> {
    const attachment = await this.scopedAttachmentOrFail(attachmentId, projectId, organizationId)

    if (attachment.isTrashed) {
      // 已在回收站中，直接返回
      return attachment
    }

    attachment.deletedAt = DateTime.now()
    attachment.deletedBy = userId
    attachment.deleteReason = reason ?? null
    await attachment.save()

    // 审计：文件移入回收站
    await this.audit.log({
      event: AuditEvent.FILE_TRASHED,
      userId,
      organizationId,
      projectId,
      entityType: 'attachment',
      entityId: attachmentId,
      requestId,
      metadata: {
        attachmentId,
        fileName: attachment.fileName,
        reason: reason ?? null,
      },
    })

    return attachment
  }

  /**
   * 从回收站恢复附件：清除软删除标记。
   */
  async restore(
    attachmentId: number,
    projectId: number,
    userId: number,
    organizationId: number,
    requestId?: string | null,
  ): Promise<Attachment> {
    const attachment = await this.scopedAttachmentOrFail(attachmentId, projectId, organizationId)

    if (!attachment.isTrashed) {
      // 不在回收站中，直接返回
      return attachment
    }

    attachment.deletedAt = null
    attachment.deletedBy = null
    attachment.deleteReason = null
    await attachment.save()

    // 审计：文件从回收站恢复
    await this.audit.log({
      event: AuditEvent.FILE_RESTORED,
      userId,
      organizationId,
      projectId,
      entityType: 'attachment',
      entityId: attachmentId,
      requestId,
      metadata: {
        attachmentId,
        fileName: attachment.fileName,
      },
    })

    return attachment
  }

  /**
   * 永久删除附件：删除所有版本文件、数据库记录和关联数据。
   * 物理文件删除失败仅记日志不阻塞流程。
   */
  async permanentDelete(
    attachmentId: number,
    projectId: number,
    userId: number,
    organizationId: number,
    requestId?: string | null,
  ): Promise<void> {
    const attachment = await this.scopedAttachmentOrFail(attachmentId, projectId, organizationId)

    const fileName = attachment.fileName

    // 删除所有版本文件
    const uploadRoot = process.env.UPLOAD_ROOT ?? 'storage/uploads'
    let cleanupWarning = false

    // 删除版本文件
    const versions = await AttachmentVersion.query().where('attachment_id', attachmentId)
    for (const version of versions) {
      const versionFilePath = `${uploadRoot}/${version.storagePath}`
      const deleted = await safeUnlink(versionFilePath)
      if (!deleted) {
        cleanupWarning = true
        logger.warn({ attachmentId, versionNo: version.versionNo }, '版本文件删除失败')
      }
    }

    // 删除附件主目录
    const mainFilePath = attachment.filePath ? `${uploadRoot}/${attachment.filePath}` : null
    if (mainFilePath) {
      await safeUnlink(mainFilePath)
    }

    // 尝试删除版本目录
    const versionBaseDir = join(
      uploadRoot,
      'projects',
      String(projectId),
      String(attachmentId),
      'versions',
    )
    try {
      await rm(versionBaseDir, { recursive: true, force: true })
    } catch {
      cleanupWarning = true
      logger.warn({ attachmentId, dir: versionBaseDir }, '版本目录删除失败')
    }

    // 尝试删除附件目录
    const attachmentDir = join(uploadRoot, 'projects', String(projectId), String(attachmentId))
    try {
      await rm(attachmentDir, { recursive: true, force: true })
    } catch {
      cleanupWarning = true
      logger.warn({ attachmentId, dir: attachmentDir }, '附件目录删除失败')
    }

    // 删除关联数据
    await FileEntityLink.query()
      .where('file_type', 'attachment')
      .where('file_id', attachmentId)
      .delete()

    await FileSearchEntry.query()
      .where('file_type', 'attachment')
      .where('file_id', attachmentId)
      .delete()

    // 删除版本记录
    await AttachmentVersion.query().where('attachment_id', attachmentId).delete()

    // 删除附件记录
    await attachment.delete()

    // 审计：文件永久删除
    await this.audit.log({
      event: AuditEvent.FILE_PERMANENTLY_DELETED,
      userId,
      organizationId,
      projectId,
      entityType: 'attachment',
      entityId: attachmentId,
      requestId,
      metadata: {
        attachmentId,
        fileName,
        cleanupWarning,
      },
    })
  }

  /**
   * 列出回收站中的附件（只返回 deleted_at IS NOT NULL 的记录）。
   */
  async listTrash(
    projectId: number,
    organizationId: number,
    filters: {
      search?: string
      mimeType?: string
      page?: number
      perPage?: number
    } = {},
  ) {
    const { search, mimeType, page = 1, perPage = 20 } = filters

    // v3-multitenant-database-isolation §6.5：回收站列表同样先 scope 再分页，
    // `meta.total` 因此在组织 scope 之后计算。
    const query = this.boundary
      .scopedQuery(Attachment.query(), 'attachments', { organizationId }, 'list')
      .where('project_id', projectId)
      .whereNotNull('deleted_at')
      .orderBy('deleted_at', 'desc')

    if (search) {
      query.where('file_name', 'like', `%${search}%`)
    }

    if (mimeType) {
      query.where('mime_type', mimeType)
    }

    const result = await query.paginate(page, perPage)
    const meta = result.getMeta()
    return {
      data: result.all(),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  /**
   * 清空回收站：永久删除早于指定日期的所有已删除附件。
   * 逐项执行，返回操作结果聚合。
   */
  async emptyTrash(
    projectId: number,
    userId: number,
    organizationId: number,
    olderThan?: string,
    requestId?: string | null,
  ): Promise<{ deletedCount: number; failedCount: number }> {
    // v3-multitenant-database-isolation §6.5：清空回收站是批量硬删除，
    // 必须先 scope 再枚举待删行（否则他租项目 ID 会导致跨租永久删除）。
    const query = this.boundary
      .scopedQuery(Attachment.query(), 'attachments', { organizationId }, 'batch')
      .where('project_id', projectId)
      .whereNotNull('deleted_at')

    if (olderThan) {
      query.where('deleted_at', '<', olderThan)
    }

    const trashedItems = await query

    let deletedCount = 0
    let failedCount = 0

    for (const item of trashedItems) {
      try {
        await this.permanentDelete(Number(item.id), projectId, userId, organizationId, requestId)
        deletedCount++
      } catch (error) {
        failedCount++
        logger.error({ attachmentId: item.id, err: error }, '清空回收站时删除失败')
      }
    }

    // 审计：清空回收站
    await this.audit.log({
      event: AuditEvent.FILE_BATCH_DELETED,
      userId,
      organizationId,
      projectId,
      entityType: 'trash',
      requestId,
      metadata: {
        action: 'empty_trash',
        deletedCount,
        failedCount,
        olderThan: olderThan ?? null,
      },
    })

    return { deletedCount, failedCount }
  }
}
