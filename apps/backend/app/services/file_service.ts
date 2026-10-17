import Attachment from '#models/attachment'
import Task from '#models/task'
import AuditService, { AuditEvent } from '#services/audit_service'
import NotificationService from '#services/notification_service'
import {
  ALLOWED_ENTITY_TYPES,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  ensureDir,
  fileExists,
  getAttachmentDir,
  getTempDir,
  isPathSafe,
  moveToFinal,
  safeUnlink,
  sanitizeFileName,
} from '#services/file_storage'
import { ValidationException, ResourceNotFoundException } from '#exceptions/api_exception'
import DatabaseTenantBoundary from '#services/database_tenant_boundary'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import { extname } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'

/**
 * 文件上传/下载/删除服务（sec 文件能力）。
 * 职责：上传校验、事务写入元数据、物理文件移动、删除补偿、审计。
 */
@inject()
export default class FileService {
  /**
   * 数据库层租户边界（v3-multitenant-database-isolation §5.3）。
   * 无状态、无 DI 依赖，直接实例化以免改动构造函数签名。
   */
  private boundary = new DatabaseTenantBoundary()

  constructor(
    private audit: AuditService,
    private notifications: NotificationService,
  ) {}

  /**
   * 上传附件：校验 → 临时文件 → 事务写入 → 移动最终目录。
   */
  async upload(params: {
    organizationId: number
    projectId: number
    entityType: string
    entityId: number
    file: MultipartFile
    userId: number
    requestId?: string | null
  }): Promise<Attachment> {
    const { organizationId, projectId, entityType, entityId, file, userId, requestId } = params

    // 校验实体类型白名单
    if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
      throw new ValidationException(`不支持的实体类型: ${entityType}`)
    }

    // 校验文件大小
    if (file.size > MAX_FILE_SIZE) {
      throw new ValidationException(`文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`)
    }

    // 校验扩展名
    const ext = extname(file.clientName).toLowerCase().replace('.', '')
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new ValidationException(`不支持的文件类型: .${ext}`)
    }

    // 校验 MIME 类型（file.type 为主类型如 image、file.subtype 为子类型如 png，
    // 需拼接为完整 MIME（如 image/png）再与白名单比对）
    const mimeType = file.type && file.subtype ? `${file.type}/${file.subtype}` : null
    if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new ValidationException(`不支持的文件格式: ${mimeType}`)
    }

    // 安全文件名
    const { displayName, safeName } = sanitizeFileName(file.clientName)

    // 写入临时目录
    const tempDir = getTempDir(projectId)
    await ensureDir(tempDir)
    const tempPath = `${tempDir}/${safeName}`
    await file.move(tempPath, { overwrite: false })

    // 事务写入元数据 + 移动文件
    let attachment: Attachment | null = null
    try {
      attachment = await Attachment.create({
        entityType,
        entityId,
        projectId,
        uploadedBy: userId,
        fileName: displayName,
        filePath: '', // 先写空，事务后再更新
        fileSize: file.size,
        mimeType,
        storageProvider: 'local',
      })

      // 移动到最终目录
      const finalDir = getAttachmentDir(projectId, attachment.id)
      await ensureDir(finalDir)
      const finalPath = `${finalDir}/${safeName}`
      await moveToFinal(tempPath, finalPath)

      // 更新文件路径（使用相对路径）
      attachment.filePath = `projects/${projectId}/${attachment.id}/${safeName}`
      await attachment.save()

      // 审计：附件上传
      await this.audit.log({
        event: AuditEvent.ATTACHMENT_UPLOADED,
        userId,
        organizationId,
        projectId,
        entityType,
        entityId,
        requestId,
        metadata: {
          attachmentId: attachment.id,
          fileName: displayName,
          fileSize: file.size,
          mimeType,
        },
      })

      // 附件上传通知（task 3.4）：任务附件上传后通知任务负责人（不通知上传者本人）
      if (entityType === 'task') {
        const task = await Task.query().where('id', entityId).where('project_id', projectId).first()
        if (task && task.assigneeId !== null && Number(task.assigneeId) !== userId) {
          await this.notifications.createForUser({
            organizationId,
            recipientId: Number(task.assigneeId),
            type: 'attachment_added',
            title: `任务新增附件：「${displayName}」`,
            body: `任务「${task.name}」新增了附件「${displayName}」。`,
            severity: 'info',
            projectId,
            targetType: 'task',
            targetId: entityId,
            idempotencyKey: `attachment:${attachment.id}:notified:${task.assigneeId}`,
            metadata: { attachmentId: attachment.id, fileName: displayName },
          })
        }
      }

      return attachment
    } catch (error) {
      // 清理临时文件
      await safeUnlink(tempPath)
      // 如果记录已创建但文件移动失败，删除记录
      if (attachment && attachment.id) {
        try {
          await attachment.delete()
        } catch {
          logger.error({ attachmentId: attachment.id }, 'failed to cleanup attachment record')
        }
      }
      throw error
    }
  }

  /**
   * 列出项目附件。
   */
  async list(params: {
    organizationId: number
    projectId: number
    entityType?: string
    entityId?: number
    search?: string
    page?: number
    perPage?: number
  }) {
    const {
      organizationId,
      projectId,
      entityType,
      entityId,
      search,
      page = 1,
      perPage = 20,
    } = params

    // v3-multitenant-database-isolation §5.3：原实现 `void organizationId`，只按
    // project_id 过滤，把组织归属完全托付给 Policy 层（RbacService.check 会校验
    // projectExistsInOrg）。数据库层自身缺少保障，被后台作业或其它 Service 直接调用时
    // 无任何租户条件。现在经 catalog 父级链（attachments → projects.organization_id）
    // 在查询上叠加组织 scope，`meta.total` 也因此在 scope 之后计算。
    const query = this.boundary
      .scopedQuery(Attachment.query(), 'attachments', { organizationId }, 'list')
      .where('project_id', projectId)
      .preload('uploader')

    if (entityType) {
      query.where('entity_type', entityType)
    }
    if (entityId) {
      query.where('entity_id', entityId)
    }
    if (search) {
      query.where('file_name', 'like', `%${search}%`)
    }

    query.orderBy('created_at', 'desc')

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
   * 获取附件详情。
   */

  async getById(
    organizationId: number,
    projectId: number,
    attachmentId: number,
  ): Promise<Attachment> {
    // v3-multitenant-database-isolation §5.3：详情同样经组织 scope 解析，
    // 跨组织与不存在返回同一个 RESOURCE_NOT_FOUND（不泄露附件存在性与文件名）。
    const attachment = await this.boundary
      .scopedQuery(Attachment.query(), 'attachments', { organizationId }, 'read')
      .where('id', attachmentId)
      .where('project_id', projectId)
      .preload('uploader')
      .first()

    if (!attachment) {
      throw new ResourceNotFoundException('附件不存在')
    }

    return attachment
  }

  /**
   * 删除附件：删除元数据 + 物理文件。
   */
  async delete(params: {
    organizationId: number
    projectId: number
    attachmentId: number
    userId: number
    requestId?: string | null
  }): Promise<void> {
    const { organizationId, projectId, attachmentId, userId, requestId } = params

    const attachment = await this.getById(organizationId, projectId, attachmentId)

    // 记录删除前元数据用于审计
    const beforeMetadata = {
      id: attachment.id,
      fileName: attachment.fileName,
      fileSize: Number(attachment.fileSize),
      mimeType: attachment.mimeType,
      entityType: attachment.entityType,
      entityId: Number(attachment.entityId),
    }

    // 删除物理文件
    const uploadRoot = process.env.UPLOAD_ROOT ?? 'storage/uploads'
    const fullPath = `${uploadRoot}/${attachment.filePath}`
    const fileDeleted = await safeUnlink(fullPath)

    // 删除数据库记录
    await attachment.delete()

    // 审计
    await this.audit.log({
      event: AuditEvent.ATTACHMENT_DELETED,
      userId,
      organizationId,
      projectId,
      entityType: attachment.entityType,
      entityId: Number(attachment.entityId),
      requestId,
      metadata: {
        attachmentId,
        ...beforeMetadata,
        physicalFileDeleted: fileDeleted,
      },
    })

    if (!fileDeleted) {
      logger.warn({ attachmentId, filePath: attachment.filePath }, '物理文件删除失败，需后台清理')
    }
  }

  /**
   * 下载附件：返回文件路径用于流式返回。
   */
  async getDownloadPath(params: {
    organizationId: number
    projectId: number
    attachmentId: number
  }): Promise<{ filePath: string; fileName: string; mimeType: string | null }> {
    const { organizationId, projectId, attachmentId } = params

    const attachment = await this.getById(organizationId, projectId, attachmentId)

    const uploadRoot = process.env.UPLOAD_ROOT ?? 'storage/uploads'
    const fullPath = `${uploadRoot}/${attachment.filePath}`

    if (!isPathSafe(fullPath, uploadRoot)) {
      throw new ValidationException('非法文件路径')
    }

    const exists = await fileExists(fullPath)
    if (!exists) {
      throw new ResourceNotFoundException('附件文件不存在')
    }

    return {
      filePath: fullPath,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    }
  }

  /**
   * 记录下载审计。
   */
  async logDownload(params: {
    organizationId: number
    projectId: number
    attachmentId: number
    userId: number
    requestId?: string | null
  }): Promise<void> {
    await this.audit.log({
      event: AuditEvent.ATTACHMENT_DOWNLOADED,
      userId: params.userId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityType: 'attachment',
      entityId: params.attachmentId,
      requestId: params.requestId,
    })
  }
}
