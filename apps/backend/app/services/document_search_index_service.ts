/**
 * DocumentSearchIndexService（v3-document-full-text-search §5）
 *
 * 管理 document_search_entries 索引表——从 documents 表派生的有界可搜索投影。
 *
 * 职责：
 * - upsertForDocument：读取文档 → 计算投影 → 幂等写入索引
 * - removeForDocument：文档软删除时标记 orphaned
 * - reindexProject：全量/增量重建项目索引
 * - getStatus：索引覆盖率统计
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import Document from '#models/document'
import DocumentSearchEntry from '#models/document_search_entry'
import AuditService, { AuditEvent } from '#services/audit_service'
import logger from '@adonisjs/core/services/logger'
import {
  buildDocumentSearchableProjection,
  DOCUMENT_SEARCH_CONTENT_BOUND,
  type DocumentSearchWarningCode,
} from '@aiproj/types'
import db from '@adonisjs/lucid/services/db'

@inject()
export default class DocumentSearchIndexService {
  constructor(private audit: AuditService) {}

  /**
   * 由 projectId 反查组织 ID。
   *
   * `documents` 表没有 organization_id 列，组织归属只能经 `projects` 派生。
   * 原实现直接写死 `organizationId: 0` 并注释「由 trigger 补充」——库里并没有
   * 这样的 trigger，结果是全部索引行的 organization_id 都是 0，组织隔离在搜索
   * 索引层完全失效。
   */
  private async resolveOrganizationId(projectId: number): Promise<number> {
    const row = await db.from('projects').where('id', projectId).select('organization_id').first()
    return row ? Number(row.organization_id) : 0
  }

  /**
   * 为单个文档 upsert 搜索索引。
   *
   * - 跳过 folder/template/软删除文档
   * - 按 content_hash 幂等：无变化跳过
   * - 索引写入失败不回滚源文档保存
   */
  async upsertForDocument(
    documentId: number,
    userId?: number,
    requestId?: string | null,
  ): Promise<{
    indexed: boolean
    skipped: boolean
    truncated: boolean
    warning?: DocumentSearchWarningCode
  }> {
    try {
      const doc = await Document.query()
        .where('id', documentId)
        .where('document_type', 'document')
        .whereNull('deleted_at')
        .first()

      if (!doc) {
        return { indexed: false, skipped: true, truncated: false }
      }

      return await this.upsertFromDocument(doc, userId, requestId)
    } catch (error) {
      logger.error({ error, documentId }, '[DocumentSearchIndexService.upsertForDocument] 失败')
      try {
        await this.audit.log({
          event: AuditEvent.DOCUMENT_SEARCH_INDEX_WARN,
          userId: userId ?? 0,
          organizationId: 0,
          projectId: 0,
          entityType: 'document_search_entry',
          entityId: documentId,
          requestId,
          metadata: {
            warningCode: 'INDEX_WRITE_FAILED' as DocumentSearchWarningCode,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      } catch {
        // 审计失败不抛出
      }
      return { indexed: false, skipped: true, truncated: false, warning: 'INDEX_WRITE_FAILED' }
    }
  }

  /**
   * 从已加载的 Document 对象 upsert 索引。
   */
  private async upsertFromDocument(
    doc: Document,
    userId?: number,
    requestId?: string | null,
  ): Promise<{
    indexed: boolean
    skipped: boolean
    truncated: boolean
    warning?: DocumentSearchWarningCode
  }> {
    const projection = buildDocumentSearchableProjection(
      { name: doc.name, content: doc.content },
      DOCUMENT_SEARCH_CONTENT_BOUND,
    )

    // 检查现有索引
    const existing = await DocumentSearchEntry.query()
      .where('document_id', doc.id)
      .where('project_id', Number(doc.projectId))
      .first()

    if (existing && existing.contentHash === projection.contentHash) {
      return { indexed: false, skipped: true, truncated: projection.truncated }
    }

    const now = DateTime.now()
    const organizationId = await this.resolveOrganizationId(Number(doc.projectId))

    if (existing) {
      // 更新
      // 一并回填组织归属：历史行可能是 organizationId=0 的旧数据。
      existing.organizationId = organizationId
      existing.title = projection.title
      existing.contentHash = projection.contentHash
      existing.contentText = projection.searchableText
      existing.contentLength = projection.searchableText.length
      existing.truncated = projection.truncated
      existing.version = (existing.version ?? 0) + 1
      existing.lifecycle = 'active'
      existing.deletedAt = null
      existing.indexedAt = now
      await existing.save()
    } else {
      // 新建
      await DocumentSearchEntry.create({
        organizationId,
        // schema 里 projectId 是 `bigint | number | null`，索引表列是 number。
        projectId: doc.projectId === null ? undefined : Number(doc.projectId),
        documentId: doc.id,
        title: projection.title,
        contentHash: projection.contentHash,
        contentText: projection.searchableText,
        contentLength: projection.searchableText.length,
        truncated: projection.truncated,
        version: 1,
        lifecycle: 'active',
        deletedAt: null,
        indexedAt: now,
      })
    }

    if (projection.truncated) {
      try {
        await this.audit.log({
          event: AuditEvent.DOCUMENT_SEARCH_INDEX_WARN,
          userId: userId ?? 0,
          organizationId,
          projectId: Number(doc.projectId),
          entityType: 'document_search_entry',
          entityId: doc.id,
          requestId,
          metadata: {
            warningCode: 'CONTENT_TRUNCATED' as DocumentSearchWarningCode,
            contentLength: projection.searchableText.length,
          },
        })
      } catch {
        // 审计失败不抛出
      }
    }

    return { indexed: true, skipped: false, truncated: projection.truncated }
  }

  /**
   * 文档软删除时标记索引 orphaned。
   */
  async removeForDocument(documentId: number, projectId: number): Promise<void> {
    try {
      const entry = await DocumentSearchEntry.query()
        .where('document_id', documentId)
        .where('project_id', projectId)
        .first()

      if (!entry) return

      entry.lifecycle = 'orphaned'
      entry.deletedAt = DateTime.now()
      entry.contentText = null
      await entry.save()
    } catch (error) {
      logger.error(
        { error, documentId, projectId },
        '[DocumentSearchIndexService.removeForDocument] 失败',
      )
    }
  }

  /**
   * 项目级索引重建。
   */
  async reindexProject(
    projectId: number,
    organizationId: number,
    options: { full?: boolean } = {},
  ): Promise<{
    runId: string
    indexed: number
    skipped: number
    removed: number
    truncated: number
    warnings: DocumentSearchWarningCode[]
  }> {
    const runId = `reindex-${projectId}-${DateTime.now().toUnixInteger()}`
    let indexed = 0
    let skipped = 0
    let removed = 0
    let truncated = 0
    const warnings: DocumentSearchWarningCode[] = []

    // 组织归属校验：projectId 由调用方传入，若不属于当前组织必须直接空转，
    // 否则跨组织重建索引就成了一条越权写入路径。
    const ownerOrgId = await this.resolveOrganizationId(projectId)
    if (ownerOrgId !== Number(organizationId)) {
      return { runId, indexed, skipped, removed, truncated, warnings }
    }

    // 全量模式：先清孤儿
    if (options.full) {
      const orphaned = await DocumentSearchEntry.query()
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .where('lifecycle', 'orphaned')
      for (const o of orphaned) {
        await o.delete()
        removed++
      }
    }

    // 获取项目全部非软删除文档（仅 type='document'）
    const docs = await Document.query()
      .where('project_id', projectId)
      .where('document_type', 'document')
      .whereNull('deleted_at')

    for (const doc of docs) {
      const result = await this.upsertFromDocument(doc)
      if (result.indexed) indexed++
      if (result.skipped) skipped++
      if (result.truncated) truncated++
      if (result.warning) warnings.push(result.warning)
    }

    return { runId, indexed, skipped, removed, truncated, warnings }
  }

  /**
   * 获取项目索引状态。
   */
  async getStatus(
    projectId: number,
    organizationId: number,
  ): Promise<{
    totalIndexable: number
    indexed: number
    staleOrMissing: number
    truncated: number
    lastIndexedAt: string | null
  }> {
    // 组织归属校验：跨组织读取索引统计同样是越权，直接返回空统计。
    const ownerOrgId = await this.resolveOrganizationId(projectId)
    if (ownerOrgId !== Number(organizationId)) {
      return {
        totalIndexable: 0,
        indexed: 0,
        staleOrMissing: 0,
        truncated: 0,
        lastIndexedAt: null,
      }
    }

    // 可索引文档总数
    const totalIndexable = await Document.query()
      .where('project_id', projectId)
      .where('document_type', 'document')
      .whereNull('deleted_at')
      .count('* as total')

    // 已索引数
    const indexed = await DocumentSearchEntry.query()
      .where('project_id', projectId)
      .where('organization_id', organizationId)
      .where('lifecycle', 'active')
      .count('* as total')

    // 截断数
    const truncated = await DocumentSearchEntry.query()
      .where('project_id', projectId)
      .where('organization_id', organizationId)
      .where('lifecycle', 'active')
      .where('truncated', true)
      .count('* as total')

    // 最后索引时间
    const lastEntry = await DocumentSearchEntry.query()
      .where('project_id', projectId)
      .where('organization_id', organizationId)
      .orderBy('indexed_at', 'desc')
      .first()

    const totalIdx = Number(indexed[0].$extras.total)
    const totalIndexableNum = Number(totalIndexable[0].$extras.total)

    return {
      totalIndexable: totalIndexableNum,
      indexed: totalIdx,
      staleOrMissing: Math.max(0, totalIndexableNum - totalIdx),
      truncated: Number(truncated[0].$extras.total),
      lastIndexedAt: lastEntry?.indexedAt?.toISO() ?? null,
    }
  }
}
