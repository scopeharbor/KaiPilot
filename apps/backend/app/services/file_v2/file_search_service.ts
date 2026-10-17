import FileSearchEntry from '#models/file_search_entry'
import AuditService, { AuditEvent } from '#services/audit_service'
import { inject } from '@adonisjs/core'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

/**
 * 文件搜索索引服务（V2 D4）。
 * 维护 file_search_entries 表的轻量搜索索引，支持 SQLite LIKE 搜索。
 * 可提取纯文本文件（markdown/plain text/CSV max 100KB）的内容片段。
 */
@inject()
export default class FileSearchService {
  constructor(private audit: AuditService) {}

  /** 文本提取最大字节数。 */
  private static readonly MAX_EXTRACT_SIZE = 100 * 1024 // 100KB

  /** 支持文本提取的 MIME 类型。 */
  private static readonly EXTRACTABLE_MIME_TYPES = new Set([
    'text/markdown',
    'text/plain',
    'text/csv',
  ])

  /**
   * 搜索文件索引。
   * 支持文件名、MIME 类型、上传者、标签、实体引用、内容摘要的 LIKE 搜索，
   * 配合 fileType、mimeType、entityType、uploadedBy、dateRange 过滤器。
   */
  async search(params: {
    projectId: number
    query?: string
    fileType?: string
    mimeType?: string
    entityType?: string
    uploadedBy?: number
    dateFrom?: string
    dateTo?: string
    page?: number
    perPage?: number
  }) {
    const {
      projectId,
      query,
      fileType,
      mimeType,
      entityType,
      uploadedBy,
      dateFrom,
      dateTo,
      page = 1,
      perPage = 20,
    } = params

    const q = FileSearchEntry.query().where('project_id', projectId)

    // 全文搜索
    if (query && query.trim().length > 0) {
      const like = `%${query.trim()}%`
      q.where((builder) => {
        builder
          .where('file_name', 'like', like)
          .orWhere('mime_type', 'like', like)
          .orWhere('uploader_name', 'like', like)
          .orWhere('tags_text', 'like', like)
          .orWhere('entity_refs', 'like', like)
          .orWhere('content_snippet', 'like', like)
      })
    }

    // 过滤器
    if (fileType) {
      q.where('file_type', fileType)
    }
    if (mimeType) {
      q.where('mime_type', mimeType)
    }
    if (entityType) {
      // 通过实体引用模糊搜索（entity_refs 包含 "entityType:X" 模式）
      // 更精确的实体类型过滤通过 file_entity_links 表实现
      // 此处放宽为 LIKE 搜索
      q.where('entity_refs', 'like', `%${entityType}%`)
    }
    if (uploadedBy) {
      q.where('uploader_name', 'like', `%${String(uploadedBy)}%`)
    }
    if (dateFrom) {
      q.where('created_at', '>=', dateFrom)
    }
    if (dateTo) {
      q.where('created_at', '<=', dateTo)
    }

    q.orderBy('updated_at', 'desc')

    const result = await q.paginate(page, perPage)
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
   * 创建或更新搜索索引条目（upsert 模式）。
   * 同一 fileType + fileId 在项目内唯一。
   */
  async upsertSearchEntry(
    fileType: string,
    fileId: number,
    data: {
      projectId: number
      organizationId: number
      fileName: string
      mimeType: string | null
      uploaderName: string | null
      tagsText: string | null
      entityRefs: string | null
      contentSnippet: string | null
    },
  ): Promise<FileSearchEntry> {
    const existing = await FileSearchEntry.query()
      .where('file_type', fileType)
      .where('file_id', fileId)
      .where('project_id', data.projectId)
      .first()

    if (existing) {
      existing.fileName = data.fileName
      existing.mimeType = data.mimeType
      existing.uploaderName = data.uploaderName
      existing.tagsText = data.tagsText
      existing.entityRefs = data.entityRefs
      existing.contentSnippet = data.contentSnippet
      await existing.save()
      return existing
    }

    return FileSearchEntry.create({
      fileType,
      fileId,
      projectId: data.projectId,
      organizationId: data.organizationId,
      fileName: data.fileName,
      mimeType: data.mimeType,
      uploaderName: data.uploaderName,
      tagsText: data.tagsText,
      entityRefs: data.entityRefs,
      contentSnippet: data.contentSnippet,
    })
  }

  /**
   * 删除搜索索引条目。
   */
  async deleteSearchEntry(fileType: string, fileId: number, projectId: number): Promise<void> {
    const entry = await FileSearchEntry.query()
      .where('file_type', fileType)
      .where('file_id', fileId)
      .where('project_id', projectId)
      .first()

    if (entry) {
      await entry.delete()
    }
  }

  /**
   * 从文件中提取纯文本内容用于搜索索引。
   * 仅支持 markdown、plain text、csv（max 100KB），其他类型返回 null。
   */
  async extractTextContent(filePath: string, mimeType: string | null): Promise<string | null> {
    if (!mimeType || !FileSearchService.EXTRACTABLE_MIME_TYPES.has(mimeType)) {
      return null
    }

    const ext = extname(filePath).toLowerCase()
    const supportedExts = new Set(['.md', '.txt', '.csv'])
    if (!supportedExts.has(ext)) {
      return null
    }

    try {
      const fileStat = await stat(filePath)
      if (fileStat.size > FileSearchService.MAX_EXTRACT_SIZE) {
        return null
      }

      const content = await readFile(filePath, 'utf-8')
      // 截取前 2000 字符作为搜索片段
      return content.slice(0, 2000)
    } catch {
      return null
    }
  }

  /**
   * 从实体链接记录构建可搜索的实体引用文本。
   * 格式：entityType:entityId, entityType:entityId, ...
   */
  async buildEntityRefs(
    entityLinks: Array<{ entityType: string; entityId: number }>,
  ): Promise<string | null> {
    if (entityLinks.length === 0) return null

    return entityLinks.map((link) => `${link.entityType}:${link.entityId}`).join(', ')
  }

  /**
   * 记录搜索审计（低敏感 metadata）。
   */
  async logSearch(params: {
    organizationId: number
    projectId: number
    query: string
    userId: number
    resultCount: number
    requestId?: string | null
  }): Promise<void> {
    const { organizationId, projectId, query, userId, resultCount, requestId } = params

    await this.audit.log({
      event: AuditEvent.FILE_SEARCH_PERFORMED,
      userId,
      organizationId,
      projectId,
      entityType: 'file_search',
      requestId,
      metadata: {
        query: query.slice(0, 200),
        resultCount,
      },
    })
  }
}
