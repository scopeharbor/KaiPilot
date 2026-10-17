import FileEntityLink from '#models/file_entity_link'
import Task from '#models/task'
import Milestone from '#models/milestone'
import Risk from '#models/risk'
import Document from '#models/document'
import ChangeRequest from '#models/change_request'
import Comment from '#models/comment'
import ReportVersion from '#models/report_version'
import CompilerArtifact from '#models/compiler_artifact'
import AuditService, { AuditEvent } from '#services/audit_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'

/**
 * 文件实体关联服务（V2 D5）。
 * 将附件/文档链接到项目实体（task/milestone/risk/document/change_request/comment/report_version/compiler_artifact），
 * 并校验实体在组织/项目内的存在性。
 */
@inject()
export default class FileLinkService {
  /** 允许关联的实体类型白名单。 */
  static readonly ENTITY_TYPE_WHITELIST = new Set([
    'task',
    'milestone',
    'risk',
    'document',
    'change_request',
    'comment',
    'report_version',
    'compiler_artifact',
  ])

  constructor(private audit: AuditService) {}

  /**
   * 关联文件到实体。
   * 校验 entityType 白名单、实体在组织/项目内的存在性。
   */
  async linkFile(params: {
    projectId: number
    organizationId: number
    fileType: string
    fileId: number
    entityType: string
    entityId: number
    linkType: string
    userId: number
    requestId?: string | null
  }): Promise<FileEntityLink> {
    const {
      projectId,
      organizationId,
      fileType,
      fileId,
      entityType,
      entityId,
      linkType,
      userId,
      requestId,
    } = params

    // 校验实体类型白名单
    if (!FileLinkService.ENTITY_TYPE_WHITELIST.has(entityType)) {
      throw new ValidationException(`不支持的实体类型: ${entityType}`)
    }

    // 校验实体存在于该项目/组织内
    await this.resolveEntity(entityType, entityId, organizationId, projectId)

    // 校验 linkType
    const allowedLinkTypes = new Set(['related', 'reference', 'attachment'])
    if (!allowedLinkTypes.has(linkType)) {
      throw new ValidationException(`不支持的关系类型: ${linkType}`)
    }

    // 检查是否已存在相同的关联（避免重复）
    const existing = await FileEntityLink.query()
      .where('file_type', fileType)
      .where('file_id', fileId)
      .where('entity_type', entityType)
      .where('entity_id', entityId)
      .first()

    if (existing) {
      // 如果已存在，更新 linkType 并返回
      existing.linkType = linkType
      await existing.save()
      return existing
    }

    const link = await FileEntityLink.create({
      fileType,
      fileId,
      entityType,
      entityId,
      linkType,
      organizationId,
      projectId,
      createdBy: userId,
    })

    // 审计：文件关联
    await this.audit.log({
      event: AuditEvent.FILE_ENTITY_LINKED,
      userId,
      organizationId,
      projectId,
      entityType,
      entityId,
      requestId,
      metadata: {
        fileType,
        fileId,
        linkType,
        linkId: link.id,
      },
    })

    return link
  }

  /**
   * 解除文件与实体的关联。
   */
  async unlinkFile(params: {
    projectId: number
    organizationId: number
    linkId: number
    userId: number
    requestId?: string | null
  }): Promise<void> {
    const { projectId, organizationId, linkId, userId, requestId } = params

    const link = await FileEntityLink.query()
      .where('id', linkId)
      .where('project_id', projectId)
      .first()

    if (!link) {
      throw new ResourceNotFoundException('关联记录不存在')
    }

    const { fileType, fileId, entityType, entityId } = link

    await link.delete()

    // 审计：文件解除关联
    await this.audit.log({
      event: AuditEvent.FILE_ENTITY_UNLINKED,
      userId,
      organizationId,
      projectId,
      entityType,
      entityId,
      requestId,
      metadata: {
        fileType,
        fileId,
        linkId,
      },
    })
  }

  /**
   * 获取文件的所有实体关联。
   */
  async getFileLinks(
    fileType: string,
    fileId: number,
    projectId: number,
  ): Promise<FileEntityLink[]> {
    const links = await FileEntityLink.query()
      .where('file_type', fileType)
      .where('file_id', fileId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    return links
  }

  /**
   * 获取关联到指定实体的所有文件链接。
   */
  async getEntityFiles(
    entityType: string,
    entityId: number,
    projectId: number,
  ): Promise<FileEntityLink[]> {
    const links = await FileEntityLink.query()
      .where('entity_type', entityType)
      .where('entity_id', entityId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    return links
  }

  /**
   * 校验实体在组织/项目内存在。
   * 不同类型使用对应的模型查询。
   */
  async resolveEntity(
    entityType: string,
    entityId: number,
    _organizationId: number,
    projectId: number,
  ): Promise<void> {
    let exists = false

    switch (entityType) {
      case 'task': {
        const record = await Task.query()
          .where('id', entityId)
          .where('project_id', projectId)
          .first()
        exists = !!record
        break
      }
      case 'milestone': {
        const record = await Milestone.query()
          .where('id', entityId)
          .where('project_id', projectId)
          .first()
        exists = !!record
        break
      }
      case 'risk': {
        const record = await Risk.query()
          .where('id', entityId)
          .where('project_id', projectId)
          .first()
        exists = !!record
        break
      }
      case 'document': {
        const record = await Document.query()
          .where('id', entityId)
          .where('project_id', projectId)
          .first()
        exists = !!record
        break
      }
      case 'change_request': {
        const record = await ChangeRequest.query()
          .where('id', entityId)
          .where('project_id', projectId)
          .first()
        exists = !!record
        break
      }
      case 'comment': {
        const record = await Comment.query()
          .where('id', entityId)
          .where('project_id', projectId)
          .first()
        exists = !!record
        break
      }
      case 'report_version': {
        const record = await ReportVersion.query()
          .where('id', entityId)
          .where('project_id', projectId)
          .first()
        exists = !!record
        break
      }
      case 'compiler_artifact': {
        const record = await CompilerArtifact.query()
          .where('id', entityId)
          .where('project_id', projectId)
          .first()
        exists = !!record
        break
      }
      default:
        throw new ValidationException(`不支持的实体类型: ${entityType}`)
    }

    if (!exists) {
      throw new ResourceNotFoundException(`关联的${entityType}不存在`)
    }
  }
}
