/**
 * v3-ocr-batch-and-queue-processing §5.1 — OCR 批量/队列 Controller
 *
 * 端点：
 * - POST   /api/v1/projects/:projectId/ocr/batches            — 创建 batch
 * - GET    /api/v1/projects/:projectId/ocr/batches            — 列出 batches
 * - GET    /api/v1/projects/:projectId/ocr/batches/:id         — batch 详情
 * - GET    /api/v1/projects/:projectId/ocr/queue/summary       — queue 摘要
 * - GET    /api/v1/projects/:projectId/ocr/queue               — 列出 queue items
 * - POST   /api/v1/projects/:projectId/ocr/batches/:id/retry   — 重试
 * - POST   /api/v1/projects/:projectId/ocr/batches/:id/cancel  — 取消
 * - POST   /api/v1/projects/:projectId/ocr/batches/:id/resume  — 恢复
 */

import OcrBatchService from '#services/ai_ocr/ocr_batch_service'
import OcrBatchQueuePolicy from '#policies/ocr_batch_queue_policy'
import OcrDocumentPolicy from '#policies/ocr_document_policy'
import OcrQueueDispatcher from '#services/ai_ocr/ocr_queue_dispatcher'
import {
  ocrBatchCreateValidator,
  ocrBatchListValidator,
  ocrQueueListValidator,
  ocrBatchRetryValidator,
  ocrBatchCancelValidator,
  ocrBatchResumeValidator,
} from '#validators/ocr_batch_queue'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { OcrBatchListFilters, OcrQueueListFilters } from '@aiproj/types'

@inject()
export default class OcrBatchQueueController {
  constructor(
    private batchService: OcrBatchService,
    private dispatcher: OcrQueueDispatcher,
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

  private makePolicy(ctx: HttpContext): OcrBatchQueuePolicy {
    return new OcrBatchQueuePolicy(ctx)
  }

  private makeOcrPolicy(ctx: HttpContext): OcrDocumentPolicy {
    return new OcrDocumentPolicy(ctx)
  }

  /**
   * POST /api/v1/projects/:projectId/ocr/batches
   */
  async create(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrBatchCreateValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    const ocrPolicy = this.makeOcrPolicy(ctx)

    const result = await this.batchService.createBatch({
      organizationId: orgId,
      projectId,
      request: input,
      userId,
      policy,
      ocrPolicy,
    })

    // 可选有界 drain 触发
    void this.dispatcher.drain(orgId, projectId).catch((err) => {
      console.error('OCR queue drain failed:', err)
    })

    return ctx.response.status(201).send({ data: result })
  }

  /**
   * GET /api/v1/projects/:projectId/ocr/batches
   */
  async list(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrBatchListValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const policy = this.makePolicy(ctx)

    const result = await this.batchService.listBatches({
      organizationId: orgId,
      projectId,
      filters: input as OcrBatchListFilters,
      policy,
    })

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /**
   * GET /api/v1/projects/:projectId/ocr/batches/:id
   */
  async detail(ctx: HttpContext) {
    const policy = this.makePolicy(ctx)
    const batchId = Number(ctx.params.id)

    try {
      const detail = await this.batchService.getBatchDetail(batchId, policy)
      return ctx.response.ok({ data: detail })
    } catch (err: any) {
      if (err.code === 'E_ROW_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'OCR batch 不存在' },
        })
      }
      throw err
    }
  }

  /**
   * GET /api/v1/projects/:projectId/ocr/queue/summary
   */
  async queueSummary(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const policy = this.makePolicy(ctx)

    const summary = await this.batchService.getQueueSummary(orgId, projectId, policy)
    return ctx.response.ok({ data: summary })
  }

  /**
   * GET /api/v1/projects/:projectId/ocr/queue
   */
  async queueList(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrQueueListValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const policy = this.makePolicy(ctx)

    const result = await this.batchService.listQueueItems({
      organizationId: orgId,
      projectId,
      filters: input as OcrQueueListFilters,
      policy,
    })

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /**
   * POST /api/v1/projects/:projectId/ocr/batches/:id/retry
   */
  async retry(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrBatchRetryValidator)
    const policy = this.makePolicy(ctx)
    const userId = this.userIdOf(ctx)
    const batchId = Number(ctx.params.id)

    try {
      const result = await this.batchService.retryBatch(batchId, input, userId, policy)

      // Trigger drain after retry
      void this.dispatcher.drain(result.organizationId, result.projectId).catch((err) => {
        console.error('OCR queue drain after retry failed:', err)
      })

      return ctx.response.ok({ data: result })
    } catch (err: any) {
      if (err.code === 'E_ROW_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'OCR batch 不存在' },
        })
      }
      if (err.message?.includes('只能重试')) {
        return ctx.response
          .status(409)
          .send({ error: { code: 'VALIDATION_ERROR', message: err.message } })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/projects/:projectId/ocr/batches/:id/cancel
   */
  async cancel(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrBatchCancelValidator)
    const policy = this.makePolicy(ctx)
    const userId = this.userIdOf(ctx)
    const batchId = Number(ctx.params.id)

    try {
      const result = await this.batchService.cancelBatch(batchId, input, userId, policy)
      return ctx.response.ok({ data: result })
    } catch (err: any) {
      if (err.code === 'E_ROW_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'OCR batch 不存在' },
        })
      }
      if (err.message?.includes('只能取消')) {
        return ctx.response
          .status(409)
          .send({ error: { code: 'VALIDATION_ERROR', message: err.message } })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/projects/:projectId/ocr/batches/:id/resume
   */
  async resume(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrBatchResumeValidator)
    const policy = this.makePolicy(ctx)
    const userId = this.userIdOf(ctx)
    const batchId = Number(ctx.params.id)

    try {
      const result = await this.batchService.resumeBatch(batchId, input, userId, policy)

      // Trigger drain after resume
      void this.dispatcher.drain(result.organizationId, result.projectId).catch((err) => {
        console.error('OCR queue drain after resume failed:', err)
      })

      return ctx.response.ok({ data: result })
    } catch (err: any) {
      if (err.code === 'E_ROW_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'OCR batch 不存在' },
        })
      }
      if (err.message?.includes('只能恢复')) {
        return ctx.response
          .status(409)
          .send({ error: { code: 'VALIDATION_ERROR', message: err.message } })
      }
      throw err
    }
  }

  /**
   * POST /api/v1/projects/:projectId/ocr/queue/drain (optional bounded drain trigger)
   */
  async drain(ctx: HttpContext) {
    const policy = this.makePolicy(ctx)
    policy.assertCreate() // 需要 manage 权限

    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)

    const result = await this.dispatcher.drain(orgId, projectId)
    return ctx.response.ok({ data: result })
  }
}
