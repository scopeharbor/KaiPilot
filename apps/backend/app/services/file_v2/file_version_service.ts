import Attachment from '#models/attachment'
import AttachmentVersion from '#models/attachment_version'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  ensureDir,
  fileExists,
  getAttachmentDir,
  isPathSafe,
  safeUnlink,
  sanitizeFileName,
} from '#services/file_storage'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { createHash } from 'node:crypto'
import { readFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 附件版本管理服务（V2 文件版本追踪 D2）。
 * 支持上传新版本、回滚、列表/查询/下载指定版本。
 * 所有版本以不可变快照存储，回滚不修改历史，而是从目标版本复制创建新版本。
 */
@inject()
export default class FileVersionService {
  constructor(private audit: AuditService) {}

  /**
   * 上传新版本：创建 AttachmentVersion 记录并更新 Attachment 指针。
   * 文件从临时目录复制到 projects/PROJECT_ID/ATTACHMENT_ID/versions/VERSION_NO/ 下。
   */
  async uploadVersion(params: {
    organizationId: number
    projectId: number
    attachmentId: number
    tempFilePath: string
    fileName: string
    mimeType: string | null
    fileSize: number
    userId: number
    changeNote?: string | null
    requestId?: string | null
  }): Promise<AttachmentVersion> {
    const {
      organizationId,
      projectId,
      attachmentId,
      tempFilePath,
      fileName,
      mimeType,
      fileSize,
      userId,
      changeNote,
      requestId,
    } = params

    // 查找附件并校验项目归属
    const attachment = await Attachment.query()
      .where('id', attachmentId)
      .where('project_id', projectId)
      .first()

    if (!attachment) {
      throw new ResourceNotFoundException('附件不存在')
    }

    // 计算下一个版本号
    const nextVersionNo = (attachment.currentVersion ?? 0) + 1

    // 计算文件 SHA-256
    const fileBuffer = await readFile(tempFilePath)
    const checksumSha256 = createHash('sha256').update(fileBuffer).digest('hex')

    // 生成安全文件名
    const { safeName } = sanitizeFileName(fileName)

    // 构建版本存储路径
    const versionDir = join(
      getAttachmentDir(projectId, attachmentId),
      'versions',
      String(nextVersionNo),
    )
    await ensureDir(versionDir)
    const versionPath = join(versionDir, safeName)

    // 复制文件到版本目录
    await copyFile(tempFilePath, versionPath)

    // 相对路径存储
    const storagePath = `projects/${projectId}/${attachmentId}/versions/${nextVersionNo}/${safeName}`

    // 创建版本记录
    const version = await AttachmentVersion.create({
      attachmentId,
      versionNo: nextVersionNo,
      storagePath,
      fileSize,
      mimeType,
      fileName,
      checksumSha256,
      changeNote: changeNote ?? null,
      createdBy: userId,
    })

    // 更新附件当前版本指针
    attachment.currentVersion = nextVersionNo
    attachment.fileName = fileName
    attachment.fileSize = fileSize
    attachment.mimeType = mimeType
    attachment.filePath = storagePath
    await attachment.save()

    // 审计：版本上传
    await this.audit.log({
      event: AuditEvent.ATTACHMENT_VERSION_UPLOADED,
      userId,
      organizationId,
      projectId,
      entityType: 'attachment',
      entityId: attachmentId,
      requestId,
      metadata: {
        attachmentId,
        versionNo: nextVersionNo,
        fileName,
        fileSize,
        mimeType,
      },
    })

    // 清理临时文件
    await safeUnlink(tempFilePath)

    return version
  }

  /**
   * 列出附件所有版本，按版本号降序排列。
   */
  async listVersions(
    attachmentId: number,
    projectId: number,
    page: number = 1,
    perPage: number = 50,
  ) {
    // 校验附件归属
    const attachment = await Attachment.query()
      .where('id', attachmentId)
      .where('project_id', projectId)
      .first()

    if (!attachment) {
      throw new ResourceNotFoundException('附件不存在')
    }

    const query = AttachmentVersion.query()
      .where('attachment_id', attachmentId)
      .orderBy('version_no', 'desc')

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
   * 获取指定版本的详情（不含 storagePath，模型序列化已排除敏感路径）。
   */
  async getVersion(versionId: number, projectId: number): Promise<AttachmentVersion> {
    const version = await AttachmentVersion.query()
      .where('id', versionId)
      .preload('attachment', (query) => {
        query.where('project_id', projectId)
      })
      .first()

    if (!version || !version.attachment) {
      throw new ResourceNotFoundException('版本不存在')
    }

    return version
  }

  /**
   * 下载版本：返回存储路径，校验组织和项目归属。
   */
  async downloadVersion(
    versionId: number,
    projectId: number,
  ): Promise<{ filePath: string; fileName: string; mimeType: string | null }> {
    const version = await this.getVersion(versionId, projectId)

    const uploadRoot = process.env.UPLOAD_ROOT ?? 'storage/uploads'
    const fullPath = `${uploadRoot}/${version.storagePath}`

    if (!isPathSafe(fullPath, uploadRoot)) {
      throw new ValidationException('非法文件路径')
    }

    const exists = await fileExists(fullPath)
    if (!exists) {
      throw new ResourceNotFoundException('版本文件不存在')
    }

    return {
      filePath: fullPath,
      fileName: version.fileName,
      mimeType: version.mimeType,
    }
  }

  /**
   * 回滚到指定版本：不修改历史，而是从目标版本复制文件创建新版本。
   * 新版本号 = currentVersion + 1，changeNote = "从版本 X 回滚"。
   */
  async rollback(params: {
    organizationId: number
    projectId: number
    attachmentId: number
    targetVersionNo: number
    userId: number
    requestId?: string | null
  }): Promise<AttachmentVersion> {
    const { organizationId, projectId, attachmentId, targetVersionNo, userId, requestId } = params

    // 查找附件并校验归属
    const attachment = await Attachment.query()
      .where('id', attachmentId)
      .where('project_id', projectId)
      .first()

    if (!attachment) {
      throw new ResourceNotFoundException('附件不存在')
    }

    // 查找目标版本
    const targetVersion = await AttachmentVersion.query()
      .where('attachment_id', attachmentId)
      .where('version_no', targetVersionNo)
      .first()

    if (!targetVersion) {
      throw new ResourceNotFoundException('目标版本不存在')
    }

    // 计算下一个版本号
    const nextVersionNo = (attachment.currentVersion ?? 0) + 1

    // 从目标版本读取文件
    const uploadRoot = process.env.UPLOAD_ROOT ?? 'storage/uploads'
    const sourcePath = `${uploadRoot}/${targetVersion.storagePath}`

    if (!isPathSafe(sourcePath, uploadRoot)) {
      throw new ValidationException('目标版本文件路径非法')
    }

    const sourceExists = await fileExists(sourcePath)
    if (!sourceExists) {
      throw new ResourceNotFoundException('目标版本文件不存在，无法回滚')
    }

    // 读取目标文件并计算 SHA-256
    const fileBuffer = await readFile(sourcePath)
    const checksumSha256 = createHash('sha256').update(fileBuffer).digest('hex')

    // 生成安全文件名
    const { safeName } = sanitizeFileName(targetVersion.fileName)

    // 构建版本存储路径
    const versionDir = join(
      getAttachmentDir(projectId, attachmentId),
      'versions',
      String(nextVersionNo),
    )
    await ensureDir(versionDir)
    const versionPath = join(versionDir, safeName)

    // 复制文件到新版本目录
    await copyFile(sourcePath, versionPath)

    // 相对路径
    const storagePath = `projects/${projectId}/${attachmentId}/versions/${nextVersionNo}/${safeName}`

    // 创建新版本记录（从目标版本复制元数据）
    const newVersion = await AttachmentVersion.create({
      attachmentId,
      versionNo: nextVersionNo,
      storagePath,
      fileSize: targetVersion.fileSize,
      mimeType: targetVersion.mimeType,
      fileName: targetVersion.fileName,
      checksumSha256,
      changeNote: `从版本 ${targetVersionNo} 回滚`,
      createdBy: userId,
    })

    // 更新附件当前版本指针
    attachment.currentVersion = nextVersionNo
    attachment.fileName = targetVersion.fileName
    attachment.fileSize = targetVersion.fileSize
    attachment.mimeType = targetVersion.mimeType
    attachment.filePath = storagePath
    await attachment.save()

    // 审计：版本回滚
    await this.audit.log({
      event: AuditEvent.ATTACHMENT_VERSION_ROLLED_BACK,
      userId,
      organizationId,
      projectId,
      entityType: 'attachment',
      entityId: attachmentId,
      requestId,
      metadata: {
        attachmentId,
        targetVersionNo,
        newVersionNo: nextVersionNo,
        fileName: targetVersion.fileName,
      },
    })

    return newVersion
  }
}
