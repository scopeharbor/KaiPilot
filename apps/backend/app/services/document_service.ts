import Document from '#models/document'
import AuditService, { AuditEvent } from '#services/audit_service'
import DocumentSearchIndexService from '#services/document_search_index_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'

/**
 * 文件夹/文档条目管理服务。
 * 支持创建、重命名、移动、软删除和搜索/筛选。
 */
@inject()
export default class DocumentService {
  constructor(
    private audit: AuditService,
    private searchIndex: DocumentSearchIndexService,
  ) {}

  /**
   * 列出项目文件库内容。
   */
  async list(params: {
    organizationId: number
    projectId: number
    parentId?: number | null
    search?: string
    documentType?: string
    page?: number
    perPage?: number
  }) {
    const { projectId, parentId, search, documentType, page = 1, perPage = 50 } = params

    const query = Document.query().where('project_id', projectId)

    if (parentId !== undefined) {
      if (parentId === null) {
        query.whereNull('parent_id')
      } else {
        query.where('parent_id', parentId)
      }
    }

    if (documentType) {
      query.where('document_type', documentType)
    }

    if (search) {
      query.where('name', 'like', `%${search}%`)
    }

    query.orderBy('document_type', 'asc').orderBy('name', 'asc')

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
   * 获取文件夹/文档详情。
   */

  async getById(_organizationId: number, projectId: number, documentId: number): Promise<Document> {
    const doc = await Document.query()
      .where('id', documentId)
      .where('project_id', projectId)
      .first()

    if (!doc) {
      throw new ResourceNotFoundException('文档不存在')
    }

    return doc
  }

  /**
   * 创建文件夹或文档条目。
   */
  async create(params: {
    organizationId: number
    projectId: number
    name: string
    documentType: 'folder' | 'document' | 'template'
    parentId?: number | null
    content?: string | null
    userId: number
    requestId?: string | null
  }): Promise<Document> {
    const { organizationId, projectId, name, documentType, parentId, content, userId, requestId } =
      params

    // 校验父文件夹存在性
    if (parentId) {
      await this.getById(organizationId, projectId, parentId)
    }

    const doc = await Document.create({
      projectId,
      name,
      documentType,
      parentId: parentId ?? null,
      content: content ?? null,
      createdBy: userId,
    })

    // 审计
    await this.audit.log({
      event:
        documentType === 'folder'
          ? AuditEvent.DOCUMENT_FOLDER_CREATED
          : AuditEvent.DOCUMENT_CREATED,
      userId,
      organizationId,
      projectId,
      entityType: 'document',
      entityId: doc.id,
      requestId,
      metadata: { name, documentType, parentId: parentId ?? null },
    })

    // 文档全文搜索索引同步：仅 document 类型，folder/template 不索引
    if (documentType === 'document') {
      this.searchIndex.upsertForDocument(doc.id, userId, requestId).catch(() => {
        // 索引写入失败不回滚文档创建
      })
    }

    return doc
  }

  /**
   * 重命名文件夹/文档。
   */
  async rename(params: {
    organizationId: number
    projectId: number
    documentId: number
    name: string
    userId: number
    requestId?: string | null
  }): Promise<Document> {
    const { organizationId, projectId, documentId, name, userId, requestId } = params

    const doc = await this.getById(organizationId, projectId, documentId)

    const beforeName = doc.name
    doc.name = name
    await doc.save()

    await this.audit.log({
      event: AuditEvent.DOCUMENT_UPDATED,
      userId,
      organizationId,
      projectId,
      entityType: 'document',
      entityId: documentId,
      requestId,
      changes: { before: { name: beforeName }, after: { name } },
    })

    // 文档全文搜索索引同步：更名也可能影响搜索投影
    if (doc.documentType === 'document') {
      this.searchIndex.upsertForDocument(doc.id, userId, requestId).catch(() => {})
    }

    return doc
  }

  /**
   * 移动文件夹/文档到新的父文件夹。
   */
  async move(params: {
    organizationId: number
    projectId: number
    documentId: number
    newParentId: number | null
    userId: number
    requestId?: string | null
  }): Promise<Document> {
    const { organizationId, projectId, documentId, newParentId, userId, requestId } = params

    const doc = await this.getById(organizationId, projectId, documentId)

    // 不能移动到自己的子文件夹下（防止循环）
    if (newParentId) {
      const isDescendant = await this.isDescendant(
        organizationId,
        projectId,
        documentId,
        newParentId,
      )
      if (isDescendant) {
        throw new ValidationException('不能将文件夹移动到自己的子文件夹下')
      }

      // 校验目标父文件夹存在
      await this.getById(organizationId, projectId, newParentId)
    }

    const beforeParentId = doc.parentId ? Number(doc.parentId) : null
    doc.parentId = newParentId ?? null
    await doc.save()

    await this.audit.log({
      event: AuditEvent.DOCUMENT_MOVED,
      userId,
      organizationId,
      projectId,
      entityType: 'document',
      entityId: documentId,
      requestId,
      changes: { before: { parentId: beforeParentId }, after: { parentId: newParentId } },
    })

    return doc
  }

  /**
   * 软删除文件夹/文档。
   */
  async delete(params: {
    organizationId: number
    projectId: number
    documentId: number
    userId: number
    requestId?: string | null
  }): Promise<void> {
    const { organizationId, projectId, documentId, userId, requestId } = params

    const doc = await this.getById(organizationId, projectId, documentId)

    // 使用 Luxon DateTime 设置软删除时间
    const { DateTime } = await import('luxon')
    doc.deletedAt = DateTime.now()
    await doc.save()

    await this.audit.log({
      event: AuditEvent.DOCUMENT_DELETED,
      userId,
      organizationId,
      projectId,
      entityType: 'document',
      entityId: documentId,
      requestId,
      metadata: { name: doc.name, documentType: doc.documentType },
    })

    // 文档全文搜索索引联动：软删除标记 orphaned
    if (doc.documentType === 'document') {
      this.searchIndex.removeForDocument(documentId, projectId).catch(() => {})
    }
  }

  /**
   * 检查 targetId 是否是 nodeId 的后代。
   */

  private async isDescendant(
    _organizationId: number,
    projectId: number,
    nodeId: number,
    targetId: number,
  ): Promise<boolean> {
    const visited = new Set<number>()
    let currentId = targetId

    while (currentId) {
      if (currentId === nodeId) return true
      if (visited.has(currentId)) break
      visited.add(currentId)

      const doc = await Document.query()
        .where('id', currentId)
        .where('project_id', projectId)
        .first()

      if (!doc || !doc.parentId) break
      currentId = Number(doc.parentId)
    }

    return false
  }
}
