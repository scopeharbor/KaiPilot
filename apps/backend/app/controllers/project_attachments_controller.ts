import FileService from '#services/file_service'
import FilePolicy from '#policies/file_policy'
import { createAttachmentValidator, listAttachmentsValidator } from '#validators/file'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * 项目附件 Controller：附件上传、列表、下载、删除。
 * 只做 HTTP 解析和响应格式化。
 */
@inject()
export default class ProjectAttachmentsController {
  constructor(
    private fileService: FileService,
    private policy: FilePolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const filters = await ctx.request.validateUsing(listAttachmentsValidator, {
      data: ctx.request.qs(),
    })

    await this.assertView(user, ctx, projectId)

    const result = await this.fileService.list({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      entityType: filters.entityType,
      entityId: filters.entityId,
      search: filters.search,
      page: filters.page,
      perPage: filters.perPage,
    })

    return ctx.response.ok(result)
  }

  async store(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(createAttachmentValidator)

    await this.assertManage(user, ctx, projectId)

    const file = ctx.request.file('file', {
      size: '10mb',
      extnames: ['pdf', 'md', 'txt', 'csv', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'webp'],
    })

    if (!file) {
      const { ValidationException } = await import('#exceptions/api_exception')
      throw new ValidationException('请上传文件')
    }

    const attachment = await this.fileService.upload({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      file,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    return ctx.response.created({ data: attachment })
  }

  async download(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const attachmentId = Number(ctx.params.attachmentId)

    await this.assertView(user, ctx, projectId)

    const { filePath, fileName, mimeType } = await this.fileService.getDownloadPath({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      attachmentId,
    })

    // 记录下载审计
    await this.fileService.logDownload({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      attachmentId,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    ctx.response.header('Content-Type', mimeType ?? 'application/octet-stream')
    ctx.response.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    )
    return ctx.response.download(filePath)
  }

  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const attachmentId = Number(ctx.params.attachmentId)

    await this.assertManage(user, ctx, projectId)

    await this.fileService.delete({
      organizationId: ctx.tenant!.organizationId,
      projectId,
      attachmentId,
      userId: user.id,
      requestId: ctx.request.id(),
    })

    return ctx.response.noContent()
  }

  private async assertView(user: User, ctx: HttpContext, projectId: number) {
    const allowed = await this.policy.view(user, ctx.tenant!.organizationId, projectId)
    if (!allowed) {
      const { PermissionDeniedException } = await import('#exceptions/api_exception')
      throw new PermissionDeniedException('无权查看附件')
    }
  }

  private async assertManage(user: User, ctx: HttpContext, projectId: number) {
    const allowed = await this.policy.manage(user, ctx.tenant!.organizationId, projectId)
    if (!allowed) {
      const { PermissionDeniedException } = await import('#exceptions/api_exception')
      throw new PermissionDeniedException('无权管理附件')
    }
  }
}
