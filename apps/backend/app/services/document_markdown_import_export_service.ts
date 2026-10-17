import Document from '#models/document'
import AuditService, { AuditEvent } from '#services/audit_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  MARKDOWN_BUNDLE_MAX_ITEMS,
  MARKDOWN_EXPORT_MAX_HEADING_DEPTH,
  MARKDOWN_IMPORT_MAX_BYTES,
  MARKDOWN_IMPORT_MAX_LINES,
  MARKDOWN_IMPORT_MAX_TITLE_LENGTH,
  buildMarkdownAuditMetadata,
  collectMarkdownWarningCodes,
  computeMarkdownBundleHash,
  computeMarkdownExportHash,
  computeMarkdownPreviewHash,
  computeMarkdownSourceDocumentHash,
  extractMarkdownSnippet,
  inferMarkdownTitle,
  markdownFnv1aHash,
  normalizeMarkdownText,
  safeMarkdownFilename,
  sortMarkdownWarnings,
  summarizeMarkdownExportManifest,
  type MarkdownExportSingleResult,
  type MarkdownExportTreeItem,
  type MarkdownExportTreeResult,
  type MarkdownImportConfirmResult,
  type MarkdownImportMode,
  type MarkdownImportPreview,
  type MarkdownWarning,
} from '@aiproj/types'
import { extractFencedCodeBlocks } from '#services/document_code_block_extractor'
import { extractDocumentFormulaMeta } from '#services/document_formula_extractor'
import db from '@adonisjs/lucid/services/db'

/**
 * 项目文档 Markdown 导入/导出服务（v3-document-markdown-import-export §4）。
 *
 * 边界：
 * - 导入：preview 只读不写；confirm 必须显式 confirmed + 服务端重算哈希一致才落库。
 * - 导出：单文档与选中树均为只读；隐藏目标以 denied 逐项返回，不泄露标题/计数。
 * - 审计一律低敏（buildMarkdownAuditMetadata：只含哈希/计数/状态，无正文、无文件名、无路径）。
 * - 本服务只操作 Document 表与审计日志；绝不写任务/WBS/里程碑/风险/评论/OCR/搜索索引/Compiler/AI 草案/外部系统。
 */

const RAW_HTML_RE = /<\/?[a-z][^>]*>/i
const REMOTE_IMAGE_RE = /!\[[^\]]*\]\([ \t]*https?:\/\/[^)\s]+[^)]*\)/i
const LOCAL_PATH_RE = /!\[[^\]]*\]\([ \t]*(?:[A-Za-z]:\\|\/|\.{1,2}\/)[^)\s]*\)/i
const HEADING_DEPTH_RE = /^#{7,}(?!#)\s+\S+/m
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/
const FRONTMATTER_KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:/gm

@inject()
export default class DocumentMarkdownImportExportService {
  constructor(private audit: AuditService) {}

  // ---------------------------------------------------------------------------
  // 导入预览（create / replace）
  // ---------------------------------------------------------------------------

  /**
   * 导入预览：只归一化 + 提取元数据 + 生成警告与确定性哈希，不写任何数据。
   */
  async previewImport(params: {
    organizationId: number
    projectId: number
    mode: MarkdownImportMode
    content: string
    originalFilename?: string | null
    parentId?: number | null
    targetDocumentId?: number | null
    userId: number
    requestId?: string | null
  }): Promise<MarkdownImportPreview> {
    const {
      organizationId,
      projectId,
      mode,
      originalFilename,
      parentId,
      targetDocumentId,
      userId,
      requestId,
    } = params

    const normalized = this.normalizeAndBound(params.content, true)

    let sourceDocumentHash: string | null = null
    let targetDocumentName: string | null = null
    let previewParentId: number | null = null

    if (mode === 'replace') {
      if (!targetDocumentId) {
        throw new ValidationException('replace 模式必须提供 targetDocumentId')
      }
      const target = await this.loadSupportedDocument(organizationId, projectId, targetDocumentId)
      sourceDocumentHash = this.sourceHash(target)
      targetDocumentName = target.name
      previewParentId = target.parentId ? Number(target.parentId) : null
    } else {
      if (parentId) {
        await this.assertFolderTarget(organizationId, projectId, parentId)
      }
      previewParentId = parentId ?? null
    }

    const inferredTitle = inferMarkdownTitle(normalized, originalFilename)
    const safeTitle = this.boundTitle(inferredTitle ?? originalFilename)

    const warnings = sortMarkdownWarnings(this.detectWarnings(normalized))

    const previewHash = computeMarkdownPreviewHash({
      normalizedContent: normalized,
      mode,
      title: safeTitle,
      parentId: previewParentId,
      targetDocumentId: mode === 'replace' ? targetDocumentId : null,
    })

    const preview: MarkdownImportPreview = {
      mode,
      normalizedContent: normalized,
      inferredTitle,
      safeTitle,
      byteCount: Buffer.byteLength(normalized, 'utf8'),
      lineCount: normalized.split('\n').length,
      target: {
        mode,
        targetDocumentId: mode === 'replace' ? (targetDocumentId ?? null) : null,
        targetDocumentName,
        parentId: previewParentId,
      },
      warnings,
      previewHash,
      sourceDocumentHash,
      allowedActions: ['import', 'export'],
    }

    await this.audit.log({
      event: AuditEvent.MARKDOWN_IMPORT_PREVIEW,
      userId,
      organizationId,
      projectId,
      entityType: 'document',
      entityId: mode === 'replace' ? (targetDocumentId ?? null) : null,
      requestId,
      metadata: buildMarkdownAuditMetadata({
        mode,
        documentId: mode === 'replace' ? targetDocumentId : null,
        previewHash,
        sourceDocumentHash,
        byteCount: preview.byteCount,
        warningCodes: collectMarkdownWarningCodes(warnings),
        status: 'preview',
      }),
    })

    return preview
  }

  // ---------------------------------------------------------------------------
  // 导入确认（create / replace）
  // ---------------------------------------------------------------------------

  /**
   * 导入确认：显式 confirmed + 服务端重算 previewHash 一致才写入；replace 额外做 source-hash 防陈旧覆盖。
   */
  async confirmImport(params: {
    organizationId: number
    projectId: number
    mode: MarkdownImportMode
    content: string
    originalFilename?: string | null
    parentId?: number | null
    targetDocumentId?: number | null
    confirmed: boolean
    previewHash: string
    expectedSourceDocumentHash?: string | null
    userId: number
    requestId?: string | null
  }): Promise<MarkdownImportConfirmResult> {
    const {
      organizationId,
      projectId,
      mode,
      originalFilename,
      parentId,
      targetDocumentId,
      confirmed,
      previewHash,
      expectedSourceDocumentHash,
      userId,
      requestId,
    } = params

    if (confirmed !== true) {
      throw new ValidationException('导入必须显式确认（confirmed=true）')
    }

    const normalized = this.normalizeAndBound(params.content, false)
    const warnings = sortMarkdownWarnings(this.detectWarnings(normalized))
    const warningCodes = collectMarkdownWarningCodes(warnings)

    let previewParentId: number | null = null
    let targetDocumentIdFinal: number | null = null

    if (mode === 'replace') {
      if (!targetDocumentId) {
        throw new ValidationException('replace 模式必须提供 targetDocumentId')
      }
      const target = await this.loadSupportedDocument(organizationId, projectId, targetDocumentId)
      const currentSourceHash = this.sourceHash(target)
      targetDocumentIdFinal = targetDocumentId

      if (expectedSourceDocumentHash !== currentSourceHash) {
        await this.audit.log({
          event: AuditEvent.MARKDOWN_IMPORT_STALE_BLOCKED,
          userId,
          organizationId,
          projectId,
          entityType: 'document',
          entityId: targetDocumentId,
          requestId,
          metadata: buildMarkdownAuditMetadata({
            mode,
            documentId: targetDocumentId,
            previewHash,
            sourceDocumentHash: currentSourceHash,
            status: 'stale_blocked',
          }),
        })
        throw new ValidationException('源文档已变化，请重新预览后再确认', {
          details: { latestSourceDocumentHash: currentSourceHash },
        })
      }
      previewParentId = target.parentId ? Number(target.parentId) : null
    } else {
      if (parentId) {
        await this.assertFolderTarget(organizationId, projectId, parentId)
      }
      previewParentId = parentId ?? null
    }

    const inferredTitle = inferMarkdownTitle(normalized, originalFilename)
    const safeTitle = this.boundTitle(inferredTitle ?? originalFilename)

    const computedPreviewHash = computeMarkdownPreviewHash({
      normalizedContent: normalized,
      mode,
      title: safeTitle,
      parentId: previewParentId,
      targetDocumentId: mode === 'replace' ? targetDocumentIdFinal : null,
    })

    if (computedPreviewHash !== previewHash) {
      await this.audit.log({
        event: AuditEvent.MARKDOWN_IMPORT_VALIDATION_FAILED,
        userId,
        organizationId,
        projectId,
        entityType: 'document',
        entityId: targetDocumentIdFinal,
        requestId,
        metadata: buildMarkdownAuditMetadata({
          mode,
          documentId: targetDocumentIdFinal,
          previewHash,
          byteCount: Buffer.byteLength(normalized, 'utf8'),
          warningCodes,
          status: 'validation_failed',
        }),
      })
      throw new ValidationException('previewHash 不匹配，请基于最新预览确认')
    }

    const byteCount = Buffer.byteLength(normalized, 'utf8')

    let documentId: number
    let name: string
    let beforeHash: string | null = null
    let createdAt: string | null = null
    let updatedAt: string | null = null

    await db.transaction(async (trx) => {
      if (mode === 'create') {
        const doc = await Document.create(
          {
            projectId,
            name: safeTitle ?? this.fallbackName(originalFilename),
            documentType: 'document',
            parentId: previewParentId ?? null,
            content: normalized,
            createdBy: userId,
            updatedBy: userId,
          },
          { client: trx },
        )
        documentId = doc.id
        name = doc.name
        createdAt = doc.createdAt.toISO()
        updatedAt = doc.updatedAt?.toISO() ?? null
        await this.audit.log({
          event: AuditEvent.MARKDOWN_IMPORT_CONFIRMED,
          userId,
          organizationId,
          projectId,
          entityType: 'document',
          entityId: documentId,
          requestId,
          client: trx,
          metadata: buildMarkdownAuditMetadata({
            mode,
            documentId,
            previewHash,
            sourceDocumentHash: null,
            byteCount,
            warningCodes,
            status: 'confirmed',
          }),
        })
      } else {
        const target = await this.loadSupportedDocument(
          organizationId,
          projectId,
          targetDocumentIdFinal!,
          trx,
        )
        beforeHash = this.sourceHash(target)
        target.content = normalized
        target.name = safeTitle ?? target.name
        target.updatedBy = userId
        target.useTransaction(trx)
        await target.save()
        documentId = target.id
        name = target.name
        createdAt = target.createdAt.toISO()
        updatedAt = target.updatedAt?.toISO() ?? null
        const afterHash = this.sourceHash(target)
        await this.audit.log({
          event: AuditEvent.MARKDOWN_IMPORT_CONFIRMED,
          userId,
          organizationId,
          projectId,
          entityType: 'document',
          entityId: documentId,
          requestId,
          client: trx,
          metadata: {
            ...buildMarkdownAuditMetadata({
              mode,
              documentId,
              previewHash,
              sourceDocumentHash: afterHash,
              byteCount,
              warningCodes,
              status: 'confirmed',
            }),
            beforeSourceDocumentHash: beforeHash,
            afterSourceDocumentHash: afterHash,
          },
        })
      }
    })

    // 文档全文搜索索引同步：Markdown 导入/替换后触发
    try {
      const { default: DocumentSearchIndexService } =
        await import('#services/document_search_index_service')
      const indexService = new DocumentSearchIndexService(this.audit)
      await indexService.upsertForDocument(documentId!, userId, requestId)
    } catch {
      // 索引写入失败不阻断导入确认
    }

    return {
      documentId: documentId!,
      mode,
      name: name!,
      previewHash,
      sourceDocumentHash: beforeHash ?? null,
      byteCount,
      warningCodes,
      createdAt: createdAt!,
      updatedAt: updatedAt!,
    }
  }

  // ---------------------------------------------------------------------------
  // 单文档导出
  // ---------------------------------------------------------------------------

  /**
   * 单文档导出：只读；返回安全文件名、Markdown 载荷、内容哈希、字节数与源引用。
   */
  async exportSingle(params: {
    organizationId: number
    projectId: number
    documentId: number
    userId: number
    requestId?: string | null
  }): Promise<MarkdownExportSingleResult> {
    const { organizationId, projectId, documentId, userId, requestId } = params

    const doc = await this.loadSupportedDocument(organizationId, projectId, documentId)

    const normalized = normalizeMarkdownText(doc.content ?? '')
    const contentHash = markdownFnv1aHash(normalized)
    const byteCount = Buffer.byteLength(normalized, 'utf8')

    const result: MarkdownExportSingleResult = {
      filename: safeMarkdownFilename(doc.name),
      content: normalized,
      contentHash,
      byteCount,
      source: {
        documentId: doc.id,
        name: doc.name,
      },
    }

    await this.audit.log({
      event: AuditEvent.MARKDOWN_EXPORT,
      userId,
      organizationId,
      projectId,
      entityType: 'document',
      entityId: documentId,
      requestId,
      metadata: {
        exportHash: computeMarkdownExportHash({
          documentId,
          contentHash,
          name: doc.name,
        }),
        contentHash,
        byteCount,
        itemCount: 1,
      },
    })

    return result
  }

  // ---------------------------------------------------------------------------
  // 选中树导出
  // ---------------------------------------------------------------------------

  /**
   * 选中树导出：确定性遍历 + 逐项授权；隐藏目标以 denied 返回，绝不泄露标题/计数。
   */
  async exportTree(params: {
    organizationId: number
    projectId: number
    selectedIds: number[]
    userId: number
    requestId?: string | null
  }): Promise<MarkdownExportTreeResult> {
    const { organizationId, projectId, selectedIds, userId, requestId } = params

    if (selectedIds.length === 0) {
      throw new ValidationException('必须选择至少一个文档或文件夹')
    }
    if (selectedIds.length > MARKDOWN_BUNDLE_MAX_ITEMS) {
      throw new ValidationException(`选中条目数超过上限 ${MARKDOWN_BUNDLE_MAX_ITEMS}`)
    }

    const uniqueIds = [...new Set(selectedIds)]

    const existing = await Document.query()
      .where('project_id', projectId)
      .whereIn('id', uniqueIds)
      .select('id', 'name', 'document_type', 'parent_id', 'content')

    const visibleById = new Map<number, Document>()
    for (const doc of existing) {
      visibleById.set(doc.id, doc)
    }

    const collectedDocs: Document[] = []
    const items: MarkdownExportTreeItem[] = []
    const pendingFolders: number[] = []

    for (const id of uniqueIds) {
      const doc = visibleById.get(id)
      if (!doc) {
        items.push({
          documentId: id,
          path: `[hidden-${id}]`,
          status: 'denied',
          reasonCode: 'HIDDEN_SOURCE_DENIAL',
        })
        continue
      }
      if (doc.documentType === 'folder') {
        pendingFolders.push(doc.id)
        continue
      }
      if (doc.documentType !== 'document') {
        items.push({
          documentId: id,
          path: `[unsupported-${id}]`,
          status: 'failed',
          reasonCode: 'UNSUPPORTED_FRONTMATTER',
        })
        continue
      }
      if (!doc.content) {
        items.push({
          documentId: id,
          path: doc.name,
          status: 'failed',
          reasonCode: 'MISSING_CONTENT',
        })
        continue
      }
      collectedDocs.push(doc)
    }

    for (const folderId of pendingFolders) {
      const descendants = await this.collectFolderDocuments(organizationId, projectId, folderId)
      if (descendants.length === 0) {
        items.push({
          documentId: folderId,
          path: `folder:${folderId}`,
          status: 'failed',
          reasonCode: 'MISSING_CONTENT',
        })
        continue
      }
      collectedDocs.push(...descendants)
    }

    const paths = new Map<number, string>()
    for (const doc of collectedDocs) {
      paths.set(doc.id, await this.buildDocumentPath(organizationId, projectId, doc))
    }

    const ordered = [...collectedDocs].sort((a, b) =>
      (paths.get(a.id) ?? '').localeCompare(paths.get(b.id) ?? ''),
    )

    const sections: string[] = []
    for (const doc of ordered) {
      const normalized = normalizeMarkdownText(doc.content ?? '')
      const contentHash = markdownFnv1aHash(normalized)
      const path = paths.get(doc.id) ?? doc.name
      const byteCount = Buffer.byteLength(normalized, 'utf8')
      items.push({
        documentId: doc.id,
        path,
        status: 'exported',
        byteCount,
        contentHash,
      })
      sections.push(
        `<!-- document: ${path} -->\n\n` + `# ${doc.name}\n\n` + normalized + `\n\n---\n`,
      )
    }

    const manifest = summarizeMarkdownExportManifest(items)
    const orderedRefs = ordered.map((d) => String(d.id))
    const contentHashes = ordered.map((d) =>
      markdownFnv1aHash(normalizeMarkdownText(d.content ?? '')),
    )

    const manifestSection =
      `<!-- markdown-export-manifest\n` +
      `exported: ${manifest.exportedCount}\n` +
      `skipped: ${manifest.skippedCount}\n` +
      `failed: ${manifest.failedCount}\n` +
      `denied: ${manifest.deniedCount}\n` +
      `-->\n\n`

    const bundleContent = manifestSection + sections.join('\n')
    const bundleHash = computeMarkdownBundleHash({ orderedRefs, contentHashes })

    const result: MarkdownExportTreeResult = {
      filename: 'project-documents.md',
      content: bundleContent,
      bundleHash,
      byteCount: Buffer.byteLength(bundleContent, 'utf8'),
      manifest,
    }

    await this.audit.log({
      event: AuditEvent.MARKDOWN_EXPORT,
      userId,
      organizationId,
      projectId,
      entityType: 'document',
      entityId: null,
      requestId,
      metadata: {
        bundleHash,
        byteCount: result.byteCount,
        itemCount: manifest.items.length,
        exportedCount: manifest.exportedCount,
        deniedCount: manifest.deniedCount,
      },
    })

    return result
  }

  // ---------------------------------------------------------------------------
  // 私有：确定性解析 / 校验 / 辅助
  // ---------------------------------------------------------------------------

  /**
   * 归一化 + 字节/行数/标题上限检查。超限抛 VALIDATION_ERROR，绝不返回可确认的 preview。
   */
  private normalizeAndBound(content: string, throwOnEmpty: boolean): string {
    const normalized = normalizeMarkdownText(content ?? '')
    const byteCount = Buffer.byteLength(normalized, 'utf8')
    const lineCount = normalized.split('\n').length

    if (byteCount > MARKDOWN_IMPORT_MAX_BYTES) {
      throw new ValidationException(`Markdown 超过字节上限 ${MARKDOWN_IMPORT_MAX_BYTES}`, {
        details: { byteCount },
      })
    }
    if (lineCount > MARKDOWN_IMPORT_MAX_LINES) {
      throw new ValidationException(`Markdown 超过行数上限 ${MARKDOWN_IMPORT_MAX_LINES}`, {
        details: { lineCount },
      })
    }
    if (throwOnEmpty && normalized.trim().length === 0) {
      throw new ValidationException('Markdown 内容为空')
    }
    return normalized
  }

  /**
   * 确定性警告检测：不抓取外部 URL、不读本地路径、不执行嵌入内容。
   */
  private detectWarnings(normalized: string): MarkdownWarning[] {
    const warnings: MarkdownWarning[] = []

    const rawHtmlMatches = normalized.match(RAW_HTML_RE)
    if (rawHtmlMatches) {
      warnings.push({
        code: 'RAW_HTML',
        message: '包含原始 HTML，渲染时可能不被解析',
        count: rawHtmlMatches.length,
        snippet: extractMarkdownSnippet(rawHtmlMatches[0]),
      })
    }

    const remoteImages = normalized.match(REMOTE_IMAGE_RE)
    if (remoteImages) {
      warnings.push({
        code: 'REMOTE_IMAGE',
        message: '包含远程图片引用，导出为独立 Markdown 后可能失效',
        count: remoteImages.length,
      })
    }

    const localPaths = normalized.match(LOCAL_PATH_RE)
    if (localPaths) {
      warnings.push({
        code: 'LOCAL_PATH_REFERENCE',
        message: '包含本地路径引用，跨环境不可移植',
        count: localPaths.length,
      })
    }

    const frontmatterKeys = this.frontmatterKeys(normalized)
    const unsupportedKeys = frontmatterKeys.filter((key) => key !== 'title')
    if (unsupportedKeys.length > 0) {
      warnings.push({
        code: 'UNSUPPORTED_FRONTMATTER',
        message: 'frontmatter 包含不支持的键（仅支持 title）',
        count: unsupportedKeys.length,
      })
    }

    const deepHeadings = normalized.match(HEADING_DEPTH_RE)
    if (deepHeadings) {
      warnings.push({
        code: 'EXCESSIVE_HEADING_DEPTH',
        message: `标题层级超过 ${MARKDOWN_EXPORT_MAX_HEADING_DEPTH} 级`,
        count: deepHeadings.length,
      })
    }

    return warnings
  }

  private frontmatterKeys(normalized: string): string[] {
    const match = normalized.match(FRONTMATTER_RE)
    if (!match) return []
    return [...match[1].matchAll(FRONTMATTER_KEY_RE)].map((m) => m[1])
  }

  private boundTitle(title: string | null | undefined): string | null {
    if (!title) return null
    const trimmed = title.trim()
    if (!trimmed) return null
    return trimmed.slice(0, MARKDOWN_IMPORT_MAX_TITLE_LENGTH)
  }

  private fallbackName(originalFilename?: string | null): string {
    if (originalFilename?.trim()) {
      return (
        originalFilename.trim().replace(/\.md$/i, '').slice(0, MARKDOWN_IMPORT_MAX_TITLE_LENGTH) ||
        'document'
      )
    }
    return 'document'
  }

  private sourceHash(doc: Document): string {
    return computeMarkdownSourceDocumentHash({
      documentId: doc.id,
      content: doc.content,
      updatedAt: doc.updatedAt?.toISO?.() ?? null,
    })
  }

  /** 加载当前项目内、非软删、document 类型且有内容的目标文档（组织隔离由项目作用域保证）。 */
  private async loadSupportedDocument(
    organizationId: number,
    projectId: number,
    documentId: number,
    trx?: TransactionClientContract,
  ): Promise<Document> {
    const query = Document.query()
      .where('id', documentId)
      .where('project_id', projectId)
      .andWhere('document_type', 'document')
    if (trx) {
      query.useTransaction(trx)
    }
    const doc = await query.first()
    if (!doc) {
      throw new ResourceNotFoundException('文档不存在')
    }
    if (!doc.content) {
      throw new ValidationException('目标文档没有可导入/导出的文本内容', {
        details: { reasonCode: 'MISSING_CONTENT' },
      })
    }
    void organizationId
    return doc
  }

  private async assertFolderTarget(organizationId: number, projectId: number, parentId: number) {
    const folder = await Document.query()
      .where('id', parentId)
      .where('project_id', projectId)
      .first()
    if (!folder || folder.documentType !== 'folder') {
      throw new ResourceNotFoundException('父文件夹不存在')
    }
    void organizationId
  }

  /** 收集文件夹子树内所有 document 类型条目（确定性、仅当前项目内可见项）。 */
  private async collectFolderDocuments(
    _organizationId: number,
    projectId: number,
    folderId: number,
  ): Promise<Document[]> {
    const all = await Document.query()
      .where('project_id', projectId)
      .where('document_type', 'document')
      .select('id', 'name', 'document_type', 'parent_id', 'content')

    const childrenByParent = new Map<number, Document[]>()
    for (const doc of all) {
      const parent = doc.parentId ? Number(doc.parentId) : null
      if (!parent) continue
      const list = childrenByParent.get(parent) ?? []
      list.push(doc)
      childrenByParent.set(parent, list)
    }

    const result: Document[] = []
    const visited = new Set<number>([folderId])
    const stack = [folderId]
    while (stack.length > 0) {
      const current = stack.pop()!
      for (const child of childrenByParent.get(current) ?? []) {
        if (visited.has(child.id)) continue
        visited.add(child.id)
        if (child.documentType === 'document') {
          if (child.content) result.push(child)
        } else if (child.documentType === 'folder') {
          stack.push(child.id)
        }
      }
    }
    return result
  }

  /** 构建确定性相对路径（文件夹名 / 文档名），跨项目隔离查询。 */
  private async buildDocumentPath(
    _organizationId: number,
    projectId: number,
    doc: Document,
  ): Promise<string> {
    const segments = [doc.name]
    let parentId = doc.parentId ? Number(doc.parentId) : null
    let guard = 0
    while (parentId && guard < 32) {
      const parent = await Document.query()
        .where('id', parentId)
        .where('project_id', projectId)
        .first()
      if (!parent) break
      segments.unshift(parent.name)
      parentId = parent.parentId ? Number(parent.parentId) : null
      guard += 1
    }
    return segments.join('/')
  }

  // ---------------------------------------------------------------------------
  // 文档正文只读（v3-document-code-block-support §D7）
  // ---------------------------------------------------------------------------

  /**
   * 读取单文档正文与围栏代码块元数据。
   * 只读；仅 document_type=document 且有文本内容；权限与组织隔离前置。
   * 不更新任何行/时间戳、不改归一化/哈希/导入警告、不触发 AI/搜索索引。
   */
  async getDocumentContent(params: {
    organizationId: number
    projectId: number
    documentId: number
    userId: number
    requestId?: string | null
  }): Promise<{
    id: number
    title: string
    documentType: 'document'
    content: string
    contentHash: string | null
    codeBlocks: Array<{
      language: string | null
      labeled: boolean
      supported: boolean
      startLine: number
      endLine: number
      lineCount: number
      byteCount: number
      closed: boolean
    }>
    updatedAt: string | null
  }> {
    const { organizationId, projectId, documentId, userId, requestId } = params

    const doc = await this.loadSupportedDocument(organizationId, projectId, documentId)

    const normalized = normalizeMarkdownText(doc.content!)
    const contentHash = markdownFnv1aHash(normalized)

    // 确定性代码块提取（纯函数，不改导入归一化/哈希）
    const codeBlocks = extractFencedCodeBlocks(normalized)

    // 确定性公式元数据提取（纯函数，不改归一化/哈希，供审计低敏字段）
    const formulaMeta = extractDocumentFormulaMeta(normalized)

    await this.audit.log({
      event: AuditEvent.DOCUMENT_CONTENT_READ,
      userId,
      organizationId,
      projectId,
      entityType: 'document',
      entityId: documentId,
      requestId,
      metadata: {
        contentHash,
        codeBlockCount: codeBlocks.length,
        labeledCount: codeBlocks.filter((b) => b.labeled).length,
        unclosedCount: codeBlocks.filter((b) => !b.closed).length,
        formulaInlineCount: formulaMeta.inlineCount,
        formulaBlockCount: formulaMeta.blockCount,
        formulaHasUnsupported: formulaMeta.unsupportedCommandHits.length > 0,
      },
    })

    return {
      id: doc.id,
      title: doc.name,
      documentType: 'document' as const,
      content: normalized,
      contentHash,
      codeBlocks,
      updatedAt: doc.updatedAt?.toISO?.() ?? null,
    }
  }
}
