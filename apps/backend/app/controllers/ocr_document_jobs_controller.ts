import OcrDocumentJobService from '#services/ai_ocr/ocr_document_job_service'
import OcrDocumentPolicy from '#policies/ocr_document_policy'
import FileService from '#services/file_service'
import {
  ocrDocumentJobCreateValidator,
  ocrDocumentJobListValidator,
  ocrDocumentJobRetryValidator,
  ocrDocumentConfirmationValidator,
} from '#validators/ocr_document'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class OcrDocumentJobsController {
  constructor(
    private service: OcrDocumentJobService,
    private fileService: FileService,
  ) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private projectIdOf(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private userIdOf(ctx: HttpContext): number {
    return Number(ctx.auth?.user?.id ?? 0)
  }

  private makePolicy(ctx: HttpContext): OcrDocumentPolicy {
    return new OcrDocumentPolicy(ctx)
  }

  /**
   * POST /api/v1/projects/:projectId/ocr/document-jobs
   * 从上传文件或已有附件创建 OCR 文档作业。
   */
  async create(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrDocumentJobCreateValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)

    let job
    let attachmentFile: { filePath: string; mimeType: string; fileName: string } | null = null

    if (input.sourceAttachmentId) {
      // 已有附件
      const attachment = await this.fileService.getById(orgId, projectId, input.sourceAttachmentId)
      if (!attachment) throw new ValidationException('附件不存在或不属于当前项目')

      attachmentFile = {
        filePath: attachment.filePath,
        mimeType: attachment.mimeType ?? 'application/octet-stream',
        fileName: attachment.fileName,
      }

      job = await this.service.createFromAttachment({
        organizationId: orgId,
        projectId,
        attachment: {
          id: Number(attachment.id),
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: String(attachment.fileSize ?? 0),
          filePath: attachment.filePath,
        },
        request: input,
        userId,
        policy,
      })
    } else {
      // 上传文件
      const file = ctx.request.file('file', { size: '20mb' })
      if (!file) throw new ValidationException('请上传文件')

      const attachment = await this.fileService.upload({
        organizationId: orgId,
        projectId,
        entityType: 'ocr_document',
        entityId: 0,
        file,
        userId,
        requestId: ctx.request.id(),
      })

      attachmentFile = {
        filePath: attachment.filePath,
        mimeType: attachment.mimeType ?? 'application/octet-stream',
        fileName: attachment.fileName,
      }

      job = await this.service.createFromUpload({
        organizationId: orgId,
        projectId,
        attachment: {
          id: Number(attachment.id),
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: String(attachment.fileSize ?? 0),
          filePath: attachment.filePath,
        },
        request: input,
        userId,
        policy,
      })

      // 使用 entityType 0 的附件更新正确的 entity 引用
    }

    // 异步触发处理（不阻塞上传响应）
    if (job.status === 'queued' && attachmentFile) {
      void this.service
        .processJob(
          job.id,
          attachmentFile.filePath,
          attachmentFile.mimeType,
          attachmentFile.fileName,
          userId,
        )
        .catch((err) => {
          console.error('OCR job processing failed:', err)
        })
    }

    const detail = await this.service.getJobDetail(job.id, policy)
    return ctx.response.status(201).send({ data: detail })
  }

  /**
   * GET /api/v1/projects/:projectId/ocr/document-jobs
   */
  async list(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrDocumentJobListValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const policy = this.makePolicy(ctx)

    const result = await this.service.listJobs({
      organizationId: orgId,
      projectId,
      policy,
      page: input.page,
      perPage: input.perPage,
      status: input.status,
      sort: input.sort,
    })

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /**
   * GET /api/v1/projects/:projectId/ocr/document-jobs/:id
   */
  async detail(ctx: HttpContext) {
    const policy = this.makePolicy(ctx)
    const jobId = Number(ctx.params.id)

    try {
      const detail = await this.service.getJobDetail(jobId, policy)
      return ctx.response.ok({ data: detail })
    } catch (err: any) {
      if (err.code === 'E_ROW_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'OCR 作业不存在' },
        })
      }
      throw err
    }
  }

  /**
   * GET /api/v1/projects/:projectId/ocr/document-jobs/:id/candidates
   */
  async candidates(ctx: HttpContext) {
    const policy = this.makePolicy(ctx)
    const jobId = Number(ctx.params.id)

    try {
      const candidates = await this.service.getCandidates(jobId, policy)
      return ctx.response.ok({ data: candidates })
    } catch (err: any) {
      if (err.code === 'E_ROW_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'OCR 作业不存在' },
        })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/projects/:projectId/ocr/document-jobs/:id/retry
   */
  async retry(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrDocumentJobRetryValidator)
    const policy = this.makePolicy(ctx)
    const projectId = this.projectIdOf(ctx)
    const orgId = this.orgIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const jobId = Number(ctx.params.id)

    try {
      const job = await this.service.retryJob(jobId, input, userId, policy)
      const detail = await this.service.getJobDetail(job.id, policy)

      // 解析真实文件路径
      let actualFilePath = `projects/${projectId}/${job.sourceAttachmentId}/${job.sourceFileName}`
      let actualMimeType = job.sourceMimeType ?? 'application/octet-stream'
      if (job.sourceAttachmentId) {
        try {
          const attachment = await this.fileService.getById(
            orgId,
            projectId,
            job.sourceAttachmentId,
          )
          if (attachment) {
            actualFilePath = attachment.filePath
            actualMimeType = attachment.mimeType ?? actualMimeType
          }
        } catch {
          // 使用 fallback 路径
        }
      }

      // 重新触发处理
      void this.service
        .processJob(job.id, actualFilePath, actualMimeType, job.sourceFileName ?? 'unknown', userId)
        .catch((err) => {
          console.error('OCR job retry processing failed:', err)
        })

      return ctx.response.ok({ data: detail })
    } catch (err: any) {
      if (err.code === 'E_ROW_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'OCR 作业不存在' },
        })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/projects/:projectId/ocr/document-jobs/:id/confirm
   */
  async confirm(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrDocumentConfirmationValidator)
    const policy = this.makePolicy(ctx)
    const userId = this.userIdOf(ctx)
    const jobId = Number(ctx.params.id)

    try {
      const extraction = await this.service.confirmJob(jobId, input, userId, policy)
      return ctx.response.ok({ data: extraction })
    } catch (err: any) {
      if (err.code === 'E_ROW_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'OCR 作业不存在' },
        })
      }
      if (err.message?.includes('确认条件不满足') || err.message?.includes('候选')) {
        return ctx.response
          .status(409)
          .send({ error: { code: 'VALIDATION_ERROR', message: err.message } })
      }
      throw err
    }
  }

  /**
   * GET /api/v1/projects/:projectId/ocr/document-jobs/:id/extractions
   */
  async extractions(ctx: HttpContext) {
    const policy = this.makePolicy(ctx)
    const jobId = Number(ctx.params.id)

    try {
      const extractions = await this.service.listExtractions(jobId, policy)
      return ctx.response.ok({ data: extractions })
    } catch (err: any) {
      if (err.code === 'E_ROW_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'OCR 作业不存在' },
        })
      }
      throw err
    }
  }
}
