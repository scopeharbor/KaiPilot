import DocumentService from '#services/document_service'
import DocumentMarkdownImportExportService from '#services/document_markdown_import_export_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import FilePolicy from '#policies/file_policy'
import {
  createDocumentValidator,
  documentContentParamsValidator,
  listFilesValidator,
  moveDocumentValidator,
  renameDocumentValidator,
} from '#validators/file'
import {
  markdownImportConfirmValidator,
  markdownImportPreviewValidator,
  markdownExportSingleParamsValidator,
  markdownExportTreeValidator,
} from '#validators/document_markdown'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * 项目文件库 Controller：文件夹/文档条目的 CRUD。
 * 只做 HTTP 解析和响应格式化。
 */
@inject()
export default class ProjectFilesController {
  constructor(
    private documentService: DocumentService,
    private policy: FilePolicy,
    private markdownService: DocumentMarkdownImportExportService,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const filters = await ctx.request.validateUsing(listFilesValidator, { data: ctx.request.qs() })

    await this.assertView(user, ctx, projectId)

    const result = await this.documentService.list({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      parentId: filters.parentId,
      search: filters.search,
      documentType: filters.documentType,
      page: filters.page,
      perPage: filters.perPage,
    })

    return ctx.response.ok(result)
  }

  async store(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(createDocumentValidator)

    await this.assertManage(user, ctx, projectId)

    const doc = await this.documentService.create({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      name: input.name,
      documentType: input.documentType ?? 'document',
      parentId: input.parentId,
      content: input.content,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    return ctx.response.created({ data: doc })
  }

  async rename(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const documentId = Number(ctx.params.documentId)
    const input = await ctx.request.validateUsing(renameDocumentValidator)

    await this.assertManage(user, ctx, projectId)

    const doc = await this.documentService.rename({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      documentId,
      name: input.name,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    return ctx.response.ok({ data: doc })
  }

  async move(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const documentId = Number(ctx.params.documentId)
    const input = await ctx.request.validateUsing(moveDocumentValidator)

    await this.assertManage(user, ctx, projectId)

    const doc = await this.documentService.move({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      documentId,
      newParentId: input.parentId,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    return ctx.response.ok({ data: doc })
  }

  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const documentId = Number(ctx.params.documentId)

    await this.assertManage(user, ctx, projectId)

    await this.documentService.delete({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      documentId,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    return ctx.response.noContent()
  }

  private async assertView(user: User, ctx: HttpContext, projectId: number) {
    const allowed = await this.policy.view(user, ctx.tenant!.organizationId, projectId)
    if (!allowed) {
      const { PermissionDeniedException } = await import('#exceptions/api_exception')
      throw new PermissionDeniedException('无权查看文件库')
    }
  }

  private async assertManage(user: User, ctx: HttpContext, projectId: number) {
    const allowed = await this.policy.manage(user, ctx.tenant!.organizationId, projectId)
    if (!allowed) {
      const { PermissionDeniedException } = await import('#exceptions/api_exception')
      throw new PermissionDeniedException('无权管理文件库')
    }
  }

  // ─── Markdown 导入/导出（v3-document-markdown-import-export §5）─────────────

  /** 导入预览：file:manage；只读，不落库。 */
  async markdownImportPreview(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(markdownImportPreviewValidator)

    await this.assertMarkdownImport(user, ctx, projectId)

    const preview = await this.markdownService.previewImport({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      mode: input.mode,
      content: input.content,
      originalFilename: input.originalFilename,
      parentId: input.parentId,
      targetDocumentId: input.targetDocumentId,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    return ctx.response.ok({ data: preview })
  }

  /** 导入确认：file:manage；显式确认 + 服务端重算哈希一致才写入。 */
  async markdownImportConfirm(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(markdownImportConfirmValidator)

    await this.assertMarkdownImport(user, ctx, projectId)

    const result = await this.markdownService.confirmImport({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      mode: input.mode,
      content: input.content,
      originalFilename: input.originalFilename,
      parentId: input.parentId,
      targetDocumentId: input.targetDocumentId,
      confirmed: input.confirmed,
      previewHash: input.previewHash,
      expectedSourceDocumentHash: input.expectedSourceDocumentHash,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    return ctx.response.created({ data: result })
  }

  /** 单文档导出：file:view；只读，附 Content-Disposition 下载头。 */
  async markdownExportSingle(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const params = await ctx.request.validateUsing(markdownExportSingleParamsValidator, {
      data: ctx.params,
    })

    await this.assertMarkdownExport(user, ctx, projectId)

    const result = await this.markdownService.exportSingle({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      documentId: params.documentId,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    ctx.response.header('Content-Disposition', attachmentDisposition(result.filename))
    return ctx.response.ok({ data: result })
  }

  /** 选中树导出：file:view；确定性 bundle + manifest。 */
  async markdownExportTree(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(markdownExportTreeValidator)

    await this.assertMarkdownExport(user, ctx, projectId)

    const result = await this.markdownService.exportTree({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      selectedIds: input.selectedIds,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    ctx.response.header('Content-Disposition', attachmentDisposition(result.filename))
    return ctx.response.ok({ data: result })
  }

  private async assertMarkdownImport(user: User, ctx: HttpContext, projectId: number) {
    const allowed = await this.policy.markdownImport(user, ctx.tenant!.organizationId, projectId)
    if (!allowed) {
      const { PermissionDeniedException } = await import('#exceptions/api_exception')
      throw new PermissionDeniedException('无权导入 Markdown')
    }
  }

  private async assertMarkdownExport(user: User, ctx: HttpContext, projectId: number) {
    const allowed = await this.policy.markdownExport(user, ctx.tenant!.organizationId, projectId)
    if (!allowed) {
      const { PermissionDeniedException } = await import('#exceptions/api_exception')
      throw new PermissionDeniedException('无权导出 Markdown')
    }
  }

  // ─── 文档正文只读（v3-document-code-block-support §D7）─────────────

  /**
   * 读取单文档正文与围栏代码块元数据。
   * 权限：file:view；仅 document_type=document 且有内容。
   * 隐藏/删除/跨组织/跨项目 → RESOURCE_NOT_FOUND（不泄漏存在性）。
   */
  async markdownContent(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const params = await ctx.request.validateUsing(documentContentParamsValidator, {
      data: ctx.params,
    })

    await this.assertDocumentRead(user, ctx, projectId)

    const result = await this.markdownService.getDocumentContent({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      documentId: params.documentId,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    return ctx.response.ok({ data: result })
  }

  /**
   * 记录公式 TeX 源码复制低敏审计事件（v3-document-formula-support §4.2）。
   * 只记 actorId/projectId/documentId/公式计数，不记公式正文。
   * 权限：复用 file:view。
   */
  async markdownFormulaCopied(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const documentId = Number(ctx.params.documentId)

    await this.assertDocumentRead(user, ctx, projectId)

    const { formulaInlineCount, formulaBlockCount } = ctx.request.body() as {
      formulaInlineCount?: number
      formulaBlockCount?: number
    }

    await this.audit.log({
      event: AuditEvent.DOCUMENT_FORMULA_COPIED,
      userId: user.id,
      organizationId: ctx.tenant!.organizationId,
      projectId,
      entityType: 'document',
      entityId: documentId,
      requestId: ctx.request.id(),
      metadata: {
        formulaInlineCount: formulaInlineCount ?? 0,
        formulaBlockCount: formulaBlockCount ?? 0,
      },
    })

    return ctx.response.noContent()
  }

  private async assertDocumentRead(user: User, ctx: HttpContext, projectId: number) {
    const allowed = await this.policy.view(user, ctx.tenant!.organizationId, projectId)
    if (!allowed) {
      const { PermissionDeniedException } = await import('#exceptions/api_exception')
      throw new PermissionDeniedException('无权查看文档内容')
    }
  }
}

/** ASCII fallback + RFC 5987 filename*（支持中文文件名，避免 ERR_INVALID_CHAR）。 */
function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
