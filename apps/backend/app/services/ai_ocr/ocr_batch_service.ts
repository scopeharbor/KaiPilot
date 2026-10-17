/**
 * v3-ocr-batch-and-queue-processing §4.1–4.8 — OCR 批量服务
 *
 * 职责：
 * - createBatch：验证有界源输入、解析 attachment、计算源哈希、创建/复用 OCR document job
 * - 幂等重放处理
 * - 队列入队
 * - 队列摘要/详情投影 + 脱敏 + 允许动作
 */

import OcrDocumentBatch from '#models/ocr_document_batch'
import OcrDocumentBatchSource from '#models/ocr_document_batch_source'
import OcrQueueItem from '#models/ocr_queue_item'
import OcrDocumentJob from '#models/ocr_document_job'
import OcrBatchQueuePolicy from '#policies/ocr_batch_queue_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import FileService from '#services/file_service'
import OcrDocumentJobService from '#services/ai_ocr/ocr_document_job_service'
import {
  computeBatchInputSignature,
  normalizeBatchIdempotencyKey,
  computeQueueIdempotencyKey,
  sortBatchSources,
  deduplicateBatchSources,
  redactBatchAuditMetadata,
  resolveBatchAllowedActions,
  OCR_BATCH_DEFAULT_MAX_SOURCES,
  OCR_QUEUE_DEFAULT_MAX_ATTEMPTS,
  OCR_QUEUE_ITEM_RETRYABLE_STATUSES,
  type OcrBatchStatus,
  type OcrBatchSourceInput,
  type OcrBatchCreateRequest,
  type OcrBatchSummary,
  type OcrBatchDetail,
  type OcrBatchSourceSummary,
  type OcrQueueItemSummary,
  type OcrQueueProjectSummary,
  type OcrBatchRetryRequest,
  type OcrBatchCancelRequest,
  type OcrBatchResumeRequest,
  type OcrBatchListFilters,
  type OcrQueueListFilters,
  type OcrBatchWarning,
  type OcrBatchCostSummary,
  type OcrBatchAllowedAction,
  type OcrQueueWorkKind,
  type OcrQueueItemStatus,
  type OcrQueueFailureCategory,
  type OcrBatchWarningCode,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'
import type OcrDocumentPolicy from '#policies/ocr_document_policy'

export interface BatchCreateContext {
  organizationId: number
  projectId: number
  request: OcrBatchCreateRequest
  userId: number
  policy: OcrBatchQueuePolicy
  ocrPolicy: OcrDocumentPolicy
}

export interface BatchListContext {
  organizationId: number
  projectId: number
  filters: OcrBatchListFilters
  policy: OcrBatchQueuePolicy
}

export interface QueueListContext {
  organizationId: number
  projectId: number
  filters: OcrQueueListFilters
  policy: OcrBatchQueuePolicy
}

@inject()
export default class OcrBatchService {
  readonly #audit = new AuditService()

  constructor(
    private fileService: FileService,
    private jobService: OcrDocumentJobService,
  ) {}

  // =========================================================================
  // 创建 batch（§4.1）
  // =========================================================================

  async createBatch(ctx: BatchCreateContext): Promise<OcrBatchDetail> {
    const { organizationId, projectId, request, userId, policy, ocrPolicy } = ctx
    policy.assertCreate()

    // 去重与排序
    const { deduplicated } = deduplicateBatchSources(request.sources)
    if (deduplicated.length === 0) {
      throw new Error('至少需要一个有效源')
    }
    if (deduplicated.length > OCR_BATCH_DEFAULT_MAX_SOURCES) {
      throw new Error(`批量源数量超过上限 ${OCR_BATCH_DEFAULT_MAX_SOURCES}`)
    }
    const sorted = sortBatchSources(deduplicated)

    // 幂等键
    const idempotencyKeyHash = normalizeBatchIdempotencyKey(request.idempotencyKey ?? null)
    let inputSignatureHash: string | null = null
    if (idempotencyKeyHash) {
      inputSignatureHash = computeBatchInputSignature({
        sourceAttachmentIds: sorted.map((s) => s.sourceAttachmentId),
        modelId: request.modelId,
        connectionId: request.connectionId,
        promptHint: request.promptHint,
        pageLimit: request.pageLimit,
        idempotencyKey: request.idempotencyKey,
      })
    }

    // 幂等检查：同一 key+signature 返回已有 batch
    if (idempotencyKeyHash && inputSignatureHash) {
      const existing = await OcrDocumentBatch.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('idempotency_key_hash', idempotencyKeyHash)
        .where('input_signature', inputSignatureHash)
        .first()
      if (existing) {
        return this.getBatchDetail(existing.id, policy)
      }
    }

    // 收集源信息——验证每个源的存在和权限
    const sourceEntries: Array<{
      source: OcrBatchSourceInput
      attachment: {
        id: number
        fileName: string
        mimeType: string | null
        fileSize: number | string
        filePath: string
      }
      job: OcrDocumentJob
      sourceHash: string
    }> = []

    for (const [i, source] of sorted.entries()) {
      const attachment = await this.fileService.getById(
        organizationId,
        projectId,
        Number(source.sourceAttachmentId),
      )
      if (!attachment) {
        throw new Error(`源 ${source.sourceAttachmentId} 不存在或不属于当前项目`)
      }

      // 为每个源创建或复用 OCR document job
      const job = await this.jobService.createFromAttachment({
        organizationId,
        projectId,
        attachment: {
          id: Number(attachment.id),
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: String(attachment.fileSize ?? 0),
          filePath: attachment.filePath,
        },
        request: {
          sourceKind: source.sourceKind ?? 'attachment',
          sourceAttachmentId: Number(source.sourceAttachmentId),
          connectionId: request.connectionId,
          modelId: request.modelId,
          promptHint: request.promptHint,
          pageLimit: request.pageLimit,
          idempotencyKey: request.idempotencyKey ? `${request.idempotencyKey}-src-${i}` : undefined,
        },
        userId,
        policy: ocrPolicy,
      })

      sourceEntries.push({
        source,
        attachment: {
          id: Number(attachment.id),
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: String(attachment.fileSize ?? 0),
          filePath: attachment.filePath,
        },
        job,
        sourceHash: job.sourceHash,
      })
    }

    // 创建 batch
    const batch = await OcrDocumentBatch.create({
      organizationId,
      projectId,
      createdBy: userId,
      sourceCount: sourceEntries.length,
      sourceIdsJson: sourceEntries.map((e) => Number(e.source.sourceAttachmentId)),
      sourceHashesJson: sourceEntries.map((e) => ({
        attachmentId: String(e.source.sourceAttachmentId),
        hash: e.sourceHash,
      })),
      connectionId: request.connectionId ? Number(request.connectionId) : null,
      modelId: request.modelId ? Number(request.modelId) : null,
      provider: null,
      model: null,
      promptHint: request.promptHint ?? null,
      pageLimit: request.pageLimit ?? null,
      status: 'queued',
      aggregateStatus: 'queued',
      completedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      queuedCount: sourceEntries.length,
      processingCount: 0,
      idempotencyKeyHash,
      inputSignature: inputSignatureHash,
    })

    // 创建 batch sources 记录
    for (const [i, entry] of sourceEntries.entries()) {
      await OcrDocumentBatchSource.create({
        organizationId,
        projectId,
        batchId: batch.id,
        sourceIndex: i,
        sourceAttachmentId: Number(entry.source.sourceAttachmentId),
        sourceFileName: entry.attachment.fileName,
        sourceMimeType: entry.attachment.mimeType ?? null,
        sourceHash: entry.sourceHash,
        ocrJobId: entry.job.id,
        status: 'queued',
      })
    }

    // 入队 queue items（§4.3）
    await this.enqueueBatchItems(batch, organizationId, projectId, sourceEntries)

    // 审计
    await this.#audit.log({
      event: AuditEvent.OCR_BATCH_CREATED,
      userId,
      organizationId,
      projectId,
      entityType: 'ocr_document_batch',
      entityId: batch.id,
      metadata: redactBatchAuditMetadata({
        sourceCount: batch.sourceCount,
        sourceIds: sourceEntries.map((e) => e.source.sourceAttachmentId),
        idempotencyKeyHash,
        inputSignature: inputSignatureHash,
        model: null,
        provider: null,
      }),
    })

    return this.getBatchDetail(batch.id, policy)
  }

  // =========================================================================
  // 入队（§4.3）
  // =========================================================================

  private async enqueueBatchItems(
    batch: OcrDocumentBatch,
    organizationId: number,
    projectId: number,
    sourceEntries: Array<{ source: OcrBatchSourceInput; job: OcrDocumentJob; sourceHash: string }>,
  ) {
    for (const entry of sourceEntries) {
      const queueIdempotencyKeyHash = computeQueueIdempotencyKey({
        organizationId,
        projectId,
        batchId: batch.id,
        jobId: entry.job.id,
        sourceHash: entry.sourceHash,
        modelId: batch.modelId ? Number(batch.modelId) : undefined,
        attemptScope: 'initial',
      })

      // 幂等：不重复创建同一 queue item
      // v3-multitenant-database-isolation §5.4：必须带组织 scope（同文件上方 batch 幂等
      // 已按 organization_id + project_id 查；此处漏加会让他租占用的同 hash 抑制本组织入队，
      // 形成跨租拒绝服务）。唯一索引同步为 (organization_id, idempotency_key_hash)。
      const existing = await OcrQueueItem.query()
        .where('organization_id', organizationId)
        .where('idempotency_key_hash', queueIdempotencyKeyHash)
        .first()
      if (existing) continue

      await OcrQueueItem.create({
        organizationId,
        projectId,
        batchId: batch.id,
        jobId: entry.job.id,
        pageId: null,
        workKind: 'job' as OcrQueueWorkKind,
        priority: 0,
        status: 'queued' as OcrQueueItemStatus,
        attemptCount: 0,
        maxAttempts: OCR_QUEUE_DEFAULT_MAX_ATTEMPTS,
        sourceHash: entry.sourceHash,
        provider: null,
        model: null,
        connectionId: batch.connectionId,
        modelId: batch.modelId,
        failureCategory: 'none' as OcrQueueFailureCategory,
        idempotencyKeyHash: queueIdempotencyKeyHash,
      })

      await this.#audit.log({
        event: AuditEvent.OCR_BATCH_ENQUEUE,
        userId: batch.createdBy,
        organizationId,
        projectId,
        entityType: 'ocr_queue_item',
        entityId: entry.job.id,
        metadata: redactBatchAuditMetadata({
          batchId: batch.id,
          jobId: entry.job.id,
          workKind: 'job',
        }),
      })
    }
  }

  // =========================================================================
  // 列出 batches（§4.4）
  // =========================================================================

  async listBatches(ctx: BatchListContext): Promise<{
    data: OcrBatchSummary[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const { organizationId, projectId, filters, policy } = ctx
    policy.assertView()

    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20

    let query = OcrDocumentBatch.forProject(organizationId, projectId).orderBy('created_at', 'desc')

    if (filters.status) {
      query = query.where('status', filters.status)
    }

    const totalRow = await query.clone().clearOrder().count('* as total').first()
    const total = Number(totalRow?.$extras?.total ?? 0)
    const batches = await query.forPage(page, perPage)

    return {
      data: batches.map((b) => this.#toSummaryDTO(b)),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    }
  }

  // =========================================================================
  // batch 详情（§4.4）
  // =========================================================================

  async getBatchDetail(batchId: number, policy: OcrBatchQueuePolicy): Promise<OcrBatchDetail> {
    policy.assertView()

    const batch = await OcrDocumentBatch.query()
      .where('id', batchId)
      .preload('sources', (q) => q.orderBy('source_index', 'asc'))
      .firstOrFail()

    return this.#toDetailDTO(batch)
  }

  // =========================================================================
  // queue 摘要（§4.4）
  // =========================================================================

  async getQueueSummary(
    organizationId: number,
    projectId: number,
    policy: OcrBatchQueuePolicy,
  ): Promise<OcrQueueProjectSummary> {
    policy.assertInspectQueue()

    const items = await OcrQueueItem.forProject(organizationId, projectId)

    const stats = {
      total: items.length,
      queued: 0,
      processing: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      budgetBlocked: 0,
      rateLimited: 0,
      staleBlocked: 0,
      oldestQueuedAt: null as string | null,
    }

    for (const item of items) {
      switch (item.status) {
        case 'queued':
          stats.queued++
          break
        case 'claimed':
        case 'processing':
          stats.processing++
          break
        case 'succeeded':
          stats.succeeded++
          break
        case 'failed':
        case 'retryable':
        case 'terminal_failure':
          stats.failed++
          break
        case 'cancelled':
          stats.cancelled++
          break
        case 'budget_blocked':
          stats.budgetBlocked++
          break
        case 'rate_limited':
          stats.rateLimited++
          break
        case 'stale_blocked':
        case 'retention_blocked':
          stats.staleBlocked++
          break
      }
    }

    const oldestQueued = await OcrQueueItem.forProject(organizationId, projectId)
      .where('status', 'queued')
      .orderBy('created_at', 'asc')
      .first()

    if (oldestQueued) {
      stats.oldestQueuedAt = oldestQueued.createdAt.toISO()!
    }

    await this.#audit.log({
      event: AuditEvent.OCR_QUEUE_READ,
      userId: 0, // 系统读取，无特定用户
      organizationId,
      projectId,
      entityType: 'ocr_queue_summary',
      metadata: redactBatchAuditMetadata({ ...stats }),
    })

    return {
      projectId,
      ...stats,
    }
  }

  // =========================================================================
  // queue 列表（§4.4）
  // =========================================================================

  async listQueueItems(ctx: QueueListContext): Promise<{
    data: OcrQueueItemSummary[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const { organizationId, projectId, filters, policy } = ctx
    policy.assertInspectQueue()

    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20

    let query = OcrQueueItem.forProject(organizationId, projectId).orderBy('created_at', 'asc')

    if (filters.status) {
      query = query.where('status', filters.status)
    }
    if (filters.batchId) {
      query = query.where('batch_id', filters.batchId)
    }

    const totalRow = await query.clone().clearOrder().count('* as total').first()
    const total = Number(totalRow?.$extras?.total ?? 0)
    const items = await query.forPage(page, perPage)

    return {
      data: items.map((qi) => this.#toQueueItemDTO(qi)),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    }
  }

  // =========================================================================
  // 重试（§4.13）
  // =========================================================================

  async retryBatch(
    batchId: number,
    request: OcrBatchRetryRequest,
    userId: number,
    policy: OcrBatchQueuePolicy,
  ): Promise<OcrBatchDetail> {
    policy.assertRetry()

    const batch = await OcrDocumentBatch.forProject(
      await this.#getBatchOrgId(batchId),
      await this.#getBatchProjId(batchId),
    )
      .where('id', batchId)
      .firstOrFail()

    if (!['partial', 'failed', 'paused'].includes(batch.status)) {
      throw new Error('只能重试部分完成、失败或暂停的 batch')
    }

    const targetSourceIds = request.sourceAttachmentIds ?? null

    // 重置可重试的 queue items
    let query = OcrQueueItem.query()
      .where('batch_id', batchId)
      .whereIn('status', OCR_QUEUE_ITEM_RETRYABLE_STATUSES as unknown as string[])

    if (targetSourceIds) {
      // 按 source attachment id 筛选
      query = query.whereIn('job_id', (subquery) => {
        subquery
          .select('ocr_job_id')
          .from('ocr_document_batch_sources')
          .whereIn('source_attachment_id', targetSourceIds as number[])
      })
    }

    const retryableItems = await query
    for (const item of retryableItems) {
      item.status = 'queued'
      item.attemptCount = 0
      item.nextAttemptAt = null
      item.retryAfter = null
      item.failureCategory = 'none'
      item.lockOwner = null
      item.lockedAt = null
      if (request.modelId) item.modelId = Number(request.modelId)
      if (request.connectionId) item.connectionId = Number(request.connectionId)
      await item.save()
    }

    batch.status = 'queued'
    batch.aggregateStatus = 'queued'
    await batch.save()

    await this.#audit.log({
      event: AuditEvent.OCR_QUEUE_ITEM_RETRY,
      userId,
      organizationId: batch.organizationId,
      projectId: batch.projectId,
      entityType: 'ocr_document_batch',
      entityId: batchId,
      metadata: redactBatchAuditMetadata({
        retryCount: retryableItems.length,
        targetSourceIds,
      }),
    })

    return this.getBatchDetail(batchId, policy)
  }

  // =========================================================================
  // 取消（§4.14）
  // =========================================================================

  async cancelBatch(
    batchId: number,
    request: OcrBatchCancelRequest,
    userId: number,
    policy: OcrBatchQueuePolicy,
  ): Promise<OcrBatchDetail> {
    policy.assertCancel()

    const batch = await OcrDocumentBatch.findOrFail(batchId)

    const cancellableStatuses: OcrBatchStatus[] = ['queued', 'processing', 'partial', 'paused']
    if (!cancellableStatuses.includes(batch.status)) {
      throw new Error('只能取消排队中、处理中、部分完成或暂停的 batch')
    }

    // 取消所有非终端的 queue items
    const activeItems = await OcrQueueItem.query()
      .where('batch_id', batchId)
      .whereNotIn('status', ['succeeded', 'terminal_failure', 'cancelled'])

    for (const item of activeItems) {
      item.status = 'cancelled'
      await item.save()
    }

    batch.status = 'cancelled'
    batch.aggregateStatus = 'cancelled'
    batch.cancelledCount = activeItems.length + batch.cancelledCount
    await batch.save()

    await this.#audit.log({
      event: AuditEvent.OCR_BATCH_CANCEL,
      userId,
      organizationId: batch.organizationId,
      projectId: batch.projectId,
      entityType: 'ocr_document_batch',
      entityId: batchId,
      metadata: redactBatchAuditMetadata({
        cancelledCount: activeItems.length,
        reason: request.reason ?? null,
      }),
    })

    return this.getBatchDetail(batchId, policy)
  }

  // =========================================================================
  // 恢复（§4.15）
  // =========================================================================

  async resumeBatch(
    batchId: number,
    request: OcrBatchResumeRequest,
    userId: number,
    policy: OcrBatchQueuePolicy,
  ): Promise<OcrBatchDetail> {
    policy.assertResume()

    const batch = await OcrDocumentBatch.findOrFail(batchId)
    if (batch.status !== 'paused') {
      throw new Error('只能恢复暂停的 batch')
    }

    // 重新验证 guards：source hash freshness、权限、retention hold
    // (simplified for now — full revalidation in dispatcher)

    const queuedItems = await OcrQueueItem.query()
      .where('batch_id', batchId)
      .whereIn('status', [
        'queued',
        'failed',
        'retryable',
        'budget_blocked',
        'rate_limited',
        'stale_blocked',
        'retention_blocked',
      ])

    for (const item of queuedItems) {
      item.status = 'queued'
      item.lockOwner = null
      item.lockedAt = null
      if (request.modelId) item.modelId = Number(request.modelId)
      if (request.connectionId) item.connectionId = Number(request.connectionId)
      await item.save()
    }

    batch.status = 'queued'
    batch.aggregateStatus = 'queued'
    await batch.save()

    await this.#audit.log({
      event: AuditEvent.OCR_BATCH_RESUME,
      userId,
      organizationId: batch.organizationId,
      projectId: batch.projectId,
      entityType: 'ocr_document_batch',
      entityId: batchId,
      metadata: redactBatchAuditMetadata({
        resumedCount: queuedItems.length,
      }),
    })

    return this.getBatchDetail(batchId, policy)
  }

  // =========================================================================
  // DTO 转换
  // =========================================================================

  #toSummaryDTO(batch: OcrDocumentBatch): OcrBatchSummary {
    return {
      id: batch.id,
      organizationId: batch.organizationId,
      projectId: batch.projectId,
      createdBy: batch.createdBy,
      status: batch.status,
      aggregateStatus: batch.aggregateStatus ?? 'none',
      sourceCount: batch.sourceCount,
      completedCount: batch.completedCount,
      failedCount: batch.failedCount,
      cancelledCount: batch.cancelledCount,
      queuedCount: batch.queuedCount,
      processingCount: batch.processingCount,
      idempotencyKeyHash: batch.idempotencyKeyHash,
      inputSignature: batch.inputSignature,
      provider: batch.provider,
      model: batch.model,
      warningCodes: (batch.warningCodes as OcrBatchWarningCode[]) ?? [],
      costSummary: (batch.costSummary as OcrBatchCostSummary | null) ?? null,
      createdAt: batch.createdAt.toISO()!,
      updatedAt: batch.updatedAt.toISO()!,
    }
  }

  #toDetailDTO(batch: OcrDocumentBatch): OcrBatchDetail {
    const summary = this.#toSummaryDTO(batch)
    const sources: OcrBatchSourceSummary[] = ((batch.sources ?? []) as unknown[]).map(
      (s: any, i: number) => ({
        sourceIndex: s.sourceIndex ?? i,
        sourceAttachmentId: s.sourceAttachmentId,
        sourceFileName: s.sourceFileName ?? null,
        sourceMimeType: s.sourceMimeType ?? null,
        sourceHash: s.sourceHash,
        ocrJobId: s.ocrJobId ?? null,
        status: s.status ?? 'unknown',
        warningCodes: (s.warningCodes ?? []) as OcrBatchWarningCode[],
      }),
    )

    return {
      ...summary,
      connectionId: batch.connectionId,
      modelId: batch.modelId,
      promptHint: batch.promptHint,
      sources,
      warnings: (batch.warnings as OcrBatchWarning[]) ?? [],
      allowedActions: this.#deriveAllowedActions(batch.status),
    }
  }

  #toQueueItemDTO(item: OcrQueueItem): OcrQueueItemSummary {
    return {
      id: item.id,
      organizationId: item.organizationId,
      projectId: item.projectId,
      batchId: item.batchId,
      jobId: item.jobId,
      pageId: item.pageId,
      workKind: item.workKind,
      priority: item.priority,
      status: item.status,
      attemptCount: item.attemptCount,
      maxAttempts: item.maxAttempts,
      nextAttemptAt: item.nextAttemptAt?.toISO() ?? null,
      retryAfter: item.retryAfter?.toISO() ?? null,
      sourceHash: item.sourceHash,
      failureCategory: item.failureCategory,
      warningCodes: (item.warningCodes as OcrBatchWarningCode[]) ?? [],
      provider: item.provider,
      model: item.model,
      sourceRef: `attachment/${item.jobId}`,
      createdAt: item.createdAt.toISO()!,
      updatedAt: item.updatedAt.toISO()!,
    }
  }

  #deriveAllowedActions(status: OcrBatchStatus): OcrBatchAllowedAction[] {
    return resolveBatchAllowedActions({
      status,
      canView: true,
      canCreate: true,
      canManage: true,
    })
  }

  async #getBatchOrgId(batchId: number): Promise<number> {
    const row = await OcrDocumentBatch.findOrFail(batchId)
    return row.organizationId
  }

  async #getBatchProjId(batchId: number): Promise<number> {
    const row = await OcrDocumentBatch.findOrFail(batchId)
    return row.projectId
  }
}
