import OcrDocumentJob from '#models/ocr_document_job'
import OcrDocumentPage from '#models/ocr_document_page'
import OcrDocumentCandidate from '#models/ocr_document_candidate'
import OcrDocumentExtraction from '#models/ocr_document_extraction'
import type OcrDocumentPolicy from '#policies/ocr_document_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  OcrDocumentInputNormalizer,
  type OcrDocumentInputNormalizerContract,
  type PdfNormalizerAdapterContract,
} from '#services/ai_ocr/ocr_document_input_normalizer'
import OcrProviderExecutionService from '#services/ai_ocr/ocr_provider_execution_service'
import {
  computeOcrDocSourceHash,
  computeCandidateTextHash,
  computeAcceptedExtractionHash,
  computeOcrDocInputSignature,
  normalizeOcrIdempotencyKey,
  buildCostSummary,
  checkConfirmationPreconditions,
  redactOcrAuditMetadata,
  type OcrDocumentJobStatus,
  type OcrDocumentSourceKind,
  type OcrDocumentJobSummary,
  type OcrDocumentJobDetail,
  type OcrDocumentPageResult,
  type OcrDocumentCandidate as OcrDocumentCandidateDTO,
  type OcrDocumentAcceptedExtraction,
  type OcrDocumentJobCreateRequest,
  type OcrDocumentJobRetryRequest,
  type OcrDocumentConfirmationRequest,
  type OcrDocumentWarning,
  type OcrDocumentWarningCode,
  type OcrDocumentProviderUsage,
  type OcrDocumentJobListMeta,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 服务接口
// ---------------------------------------------------------------------------

export default class OcrDocumentJobService {
  readonly #audit = new AuditService()
  readonly #normalizer: OcrDocumentInputNormalizerContract
  readonly #providerExecutor: OcrProviderExecutionService

  // options 带默认值（而非可选参数）：默认值使 constructor.length === 0，
  // @adonisjs/fold 才能以无参方式构造本服务（控制器/OcrBatchService 的 @inject()
  // 注入点依赖这一点；否则抛 "Cannot inject [class OcrDocumentJobService] ..."）。
  // 自定义注入仍可通过显式传 options 实现。同款写法见 draft_generation_runner.ts。
  constructor(
    options: {
      normalizer?: OcrDocumentInputNormalizerContract
      pdfAdapter?: PdfNormalizerAdapterContract
      providerExecutor?: OcrProviderExecutionService
    } = {},
  ) {
    this.#normalizer =
      options?.normalizer ?? new OcrDocumentInputNormalizer(options?.pdfAdapter ?? null)
    this.#providerExecutor = options?.providerExecutor ?? new OcrProviderExecutionService()
  }

  // =========================================================================
  // 创建
  // =========================================================================

  /**
   * 从上传文件创建 OCR 作业。
   * @param attachment 已由 FileService.upload 创建的 attachment 记录
   */
  async createFromUpload(params: {
    organizationId: number
    projectId: number
    attachment: {
      id: number
      fileName: string
      mimeType: string | null
      fileSize: number | string
      filePath: string
    }
    request: OcrDocumentJobCreateRequest
    userId: number
    policy: OcrDocumentPolicy
  }): Promise<OcrDocumentJob> {
    const { organizationId, projectId, attachment, request, userId, policy } = params

    policy.assertRun()

    const sourceHash = computeOcrDocSourceHash({
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType ?? null,
      fileSize: attachment.fileSize,
    })

    const idempotencyKeyHash = normalizeOcrIdempotencyKey(request.idempotencyKey ?? null)
    const inputSignature = computeOcrDocInputSignature({
      sourceKind: 'upload',
      sourceAttachmentId: attachment.id,
      modelId: request.modelId,
      promptHint: request.promptHint,
      pageLimit: request.pageLimit,
    })

    // 幂等检查
    if (idempotencyKeyHash) {
      const existing = await OcrDocumentJob.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('idempotency_key_hash', idempotencyKeyHash)
        .where('input_signature', inputSignature)
        .first()

      if (existing) return existing
    }

    const job = await OcrDocumentJob.create({
      organizationId,
      projectId,
      sourceAttachmentId: attachment.id,
      sourceKind: 'upload' as OcrDocumentSourceKind,
      sourceFileName: attachment.fileName,
      sourceMimeType: attachment.mimeType ?? null,
      sourceHash,
      status: 'queued' as OcrDocumentJobStatus,
      pageCount: 0,
      succeededPages: 0,
      failedPages: 0,
      idempotencyKeyHash,
      inputSignature,
      connectionId: request.connectionId ? Number(request.connectionId) : null,
      modelId: request.modelId ? Number(request.modelId) : null,
      promptHint: request.promptHint ?? null,
      createdBy: userId,
    })

    await this.#audit.log({
      event: AuditEvent.OCR_DOCUMENT_JOB_CREATED,
      userId,
      organizationId,
      projectId,
      entityType: 'ocr_document_job',
      entityId: job.id,
      metadata: redactOcrAuditMetadata({
        sourceKind: 'upload',
        sourceAttachmentId: attachment.id,
        sourceHash,
        idempotencyKeyHash,
        provider: null,
        model: null,
      }),
    })

    return job
  }

  /**
   * 从已有附件创建 OCR 作业。
   */
  async createFromAttachment(params: {
    organizationId: number
    projectId: number
    attachment: {
      id: number
      fileName: string
      mimeType: string | null
      fileSize: number | string
      filePath: string
    }
    request: OcrDocumentJobCreateRequest
    userId: number
    policy: OcrDocumentPolicy
  }): Promise<OcrDocumentJob> {
    return this.createFromUpload({
      ...params,
      request: { ...params.request, sourceKind: 'attachment' },
    })
  }

  // =========================================================================
  // 处理（归一化 + 逐页 OCR）
  // =========================================================================

  /**
   * 处理作业（归一化 + 逐页 OCR）。
   *
   * @param actualFilePath - 由 FileService 解析的真实存储路径（已脱敏日志），
   *   不再由 controller 拼接相对路径（design D6）。
   */
  async processJob(
    jobId: number,
    actualFilePath: string,
    mimeType: string,
    fileName: string,
    userId?: number,
  ): Promise<OcrDocumentJob> {
    const job = await OcrDocumentJob.findOrFail(jobId)
    if (job.status !== 'queued' && job.status !== 'normalizing') return job

    // 状态：开始处理
    job.status = 'normalizing'
    await job.save()

    // 归一化
    const normalization = await this.#normalizer.normalize(actualFilePath, mimeType, fileName)
    if (!normalization.ok) {
      job.status = 'failed'
      job.warnings = normalization.failure.warnings
      job.warningCodes = normalization.failure.warnings.map(
        (w) => w.code,
      ) as OcrDocumentWarningCode[]
      await job.save()

      await this.#audit.log({
        event: AuditEvent.OCR_DOCUMENT_PROVIDER_FAILURE,
        userId: userId ?? job.createdBy,
        organizationId: job.organizationId,
        projectId: job.projectId,
        entityType: 'ocr_document_job',
        entityId: job.id,
        metadata: redactOcrAuditMetadata({
          reason: normalization.failure.reason,
          message: normalization.failure.message,
          warningCodes: job.warningCodes,
        }),
      })
      return job
    }

    const { result: normResult } = normalization
    job.pageCount = normResult.totalPages
    job.status = 'processing'
    await job.save()

    // 创建页面记录（按 pageIndex 顺序）
    const pages: OcrDocumentPage[] = []
    for (const np of normResult.pages) {
      const page = await OcrDocumentPage.create({
        jobId: job.id,
        pageIndex: np.pageIndex,
        sourceHash: job.sourceHash,
        status: 'queued',
        mimeType: np.mimeType,
        normalizedBytes: np.sizeBytes,
        warnings: [],
      })
      pages.push(page)
    }

    // 创建被跳过页面的记录
    const skippedPages = normResult.skippedPages
    if (skippedPages > 0 && normResult.pages.length < normResult.totalPages) {
      // 跳过页的记录：在页面表中标记 skipped 状态
      for (let i = normResult.pages.length; i < normResult.totalPages; i++) {
        await OcrDocumentPage.create({
          jobId: job.id,
          pageIndex: i,
          sourceHash: job.sourceHash,
          status: 'skipped',
          mimeType: null,
          normalizedBytes: null,
          warnings: [
            {
              code: 'PAGE_OVERFLOW' as OcrDocumentWarningCode,
              message: `第 ${i + 1} 页因 pageLimit 被跳过`,
              pageIndex: i,
            },
          ],
        })
      }
    }

    // 逐页 OCR — 通过 OcrProviderExecutionService（design D5）
    let succeededPages = 0
    let failedPages = 0
    const allUsage: OcrDocumentProviderUsage[] = []
    const allWarnings: OcrDocumentWarning[] = []

    for (const page of pages) {
      const np = normResult.pages.find((p) => p.pageIndex === page.pageIndex)
      if (!np) {
        // 页面在归一化中被跳过
        page.status = 'skipped'
        await page.save()
        continue
      }

      page.status = 'processing'
      await page.save()

      const execResult = await this.#providerExecutor.executePage({
        organizationId: job.organizationId,
        projectId: job.projectId,
        job,
        page,
        attemptNumber: 1,
        imageDataUrl: np.dataUrl,
        promptHint: job.promptHint,
        userId: userId ?? job.createdBy,
      })

      if (!execResult.ok) {
        // Provider 失败或被阻断
        page.status = 'failed'
        const warning: OcrDocumentWarning = {
          code: execResult.blocked ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_DEGRADATION',
          message: execResult.errorMessage ?? 'OCR provider 返回空结果',
          pageIndex: page.pageIndex,
        }
        page.warnings = [warning]
        allWarnings.push(warning)
        failedPages++
        await page.save()
        continue
      }

      // Provider 成功
      const extractedText = execResult.extractedText!
      const textHash = computeCandidateTextHash(extractedText)

      const candidate = await OcrDocumentCandidate.create({
        jobId: job.id,
        pageId: page.id,
        status: 'ready',
        extractedText,
        textHash,
        confidenceScore: null,
        sourceHash: job.sourceHash,
        provider: job.provider ?? undefined,
        model: job.model ?? undefined,
        warnings: [],
        usage: null,
      })

      page.status = 'succeeded'
      page.candidateId = candidate.id
      page.candidateText = extractedText
      page.candidateHash = textHash
      page.provider = job.provider
      page.model = job.model
      succeededPages++
      await page.save()
    }

    // 汇总
    job.succeededPages = succeededPages
    job.failedPages = failedPages + skippedPages
    job.status = succeededPages > 0 ? 'reviewable' : 'failed'
    job.costSummary = allUsage.length > 0 ? buildCostSummary(allUsage) : null
    if (allWarnings.length > 0) {
      job.warnings = allWarnings
      job.warningCodes = [...new Set(allWarnings.map((w) => w.code))] as OcrDocumentWarningCode[]
    }
    await job.save()

    if (job.status === 'reviewable') {
      await this.#audit.log({
        event: AuditEvent.OCR_DOCUMENT_CANDIDATE_READY,
        userId: userId ?? job.createdBy,
        organizationId: job.organizationId,
        projectId: job.projectId,
        entityType: 'ocr_document_job',
        entityId: job.id,
        metadata: redactOcrAuditMetadata({
          succeededPages,
          failedPages,
          pageCount: normResult.totalPages,
          provider: job.provider,
          model: job.model,
        }),
      })
    }

    return job
  }

  // =========================================================================
  // 查询
  // =========================================================================

  async listJobs(params: {
    organizationId: number
    projectId: number
    policy: OcrDocumentPolicy
    page?: number
    perPage?: number
    status?: string
    sort?: string
  }): Promise<{ data: OcrDocumentJobSummary[]; meta: OcrDocumentJobListMeta }> {
    const { organizationId, projectId, policy } = params
    policy.assertView()

    const page = params.page ?? 1
    const perPage = params.perPage ?? 20

    let query = OcrDocumentJob.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    if (params.status) {
      query = query.where('status', params.status)
    }

    const totalRow = await query.clone().clearOrder().count('* as total').first()
    const total = Number(totalRow?.$extras?.total ?? 0)
    const jobs = await query.forPage(page, perPage)

    return {
      data: jobs.map((j) => this.#toSummaryDTO(j)),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    }
  }

  async getJobDetail(jobId: number, policy: OcrDocumentPolicy): Promise<OcrDocumentJobDetail> {
    policy.assertView()

    const job = await OcrDocumentJob.query()
      .where('id', jobId)
      .preload('pages', (q) => q.orderBy('page_index', 'asc'))
      .firstOrFail()

    return this.#toDetailDTO(job)
  }

  async getCandidates(
    jobId: number,
    policy: OcrDocumentPolicy,
  ): Promise<OcrDocumentCandidateDTO[]> {
    policy.assertView()

    const candidates = await OcrDocumentCandidate.query()
      .where('job_id', jobId)
      .orderBy('id', 'asc')

    return candidates.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      pageId: c.pageId,
      status: c.status,
      extractedText: c.extractedText ?? '',
      textHash: c.textHash ?? '',
      confidenceScore: c.confidenceScore,
      sourceHash: c.sourceHash,
      provider: c.provider,
      model: c.model,
      warnings: (c.warnings as OcrDocumentWarning[]) ?? [],
      usage: (c.usage as OcrDocumentProviderUsage) ?? null,
      createdAt: c.createdAt.toISO()!,
    }))
  }

  // =========================================================================
  // 重试
  // =========================================================================

  async retryJob(
    jobId: number,
    request: OcrDocumentJobRetryRequest,
    _userId: number,
    policy: OcrDocumentPolicy,
  ): Promise<OcrDocumentJob> {
    policy.assertRun()

    const job = await OcrDocumentJob.findOrFail(jobId)
    if (!['failed', 'reviewable'].includes(job.status)) {
      throw new Error('只能重试失败或已完成 review 的作业')
    }

    // 重置状态
    job.status = 'processing'
    if (request.connectionId) job.connectionId = Number(request.connectionId)
    if (request.modelId) job.modelId = Number(request.modelId)
    if (request.promptHint !== undefined) job.promptHint = request.promptHint
    job.succeededPages = 0
    job.failedPages = 0
    await job.save()

    // 重置页面状态（保留旧记录，新建 attempt）
    await OcrDocumentPage.query().where('job_id', job.id).update({
      status: 'pending',
      candidateId: null,
      candidateText: null,
      candidateHash: null,
      provider: null,
      model: null,
      usage: null,
    })

    return job
  }

  // =========================================================================
  // 确认
  // =========================================================================

  async confirmJob(
    jobId: number,
    request: OcrDocumentConfirmationRequest,
    userId: number,
    policy: OcrDocumentPolicy,
  ): Promise<OcrDocumentAcceptedExtraction> {
    policy.assertConfirm()

    const job = await OcrDocumentJob.findOrFail(jobId)

    // 校验每个候选
    for (const candidateId of request.candidateIds) {
      const candidate = await OcrDocumentCandidate.findOrFail(candidateId)
      if (candidate.jobId !== job.id) {
        throw new Error('候选不属于当前作业')
      }

      const currentSourceHash = job.sourceHash
      const preconditions = checkConfirmationPreconditions({
        candidateStatus: candidate.status,
        candidateSourceHash: candidate.sourceHash,
        currentSourceHash,
        candidateBelongsToJobProject: true,
      })

      if (!preconditions.allowed) {
        await this.#audit.log({
          event: AuditEvent.OCR_DOCUMENT_STALE_BLOCKED,
          userId,
          organizationId: job.organizationId,
          projectId: job.projectId,
          entityType: 'ocr_document_candidate',
          entityId: candidate.id,
          metadata: redactOcrAuditMetadata({
            reason: preconditions.reason,
            reasonCode: preconditions.reasonCode,
            candidateSourceHash: candidate.sourceHash,
            currentSourceHash,
          }),
        })
        throw new Error(preconditions.reason ?? '确认条件不满足')
      }
    }

    // 构建已接受提取
    const candidates = await OcrDocumentCandidate.query().whereIn(
      'id',
      request.candidateIds as number[],
    )
    const acceptedText =
      request.selectedText ??
      candidates
        .map((c) => c.extractedText)
        .filter(Boolean)
        .join('\n')
    const acceptedTextHash = computeCandidateTextHash(acceptedText)
    const pageRefs = request.pageRefs ?? [...new Set(candidates.map((c) => c.pageId))]
    const extractionHash = computeAcceptedExtractionHash({
      textHash: acceptedTextHash,
      sourceHash: job.sourceHash,
      pageRefs: pageRefs as number[],
      reviewerId: userId,
    })

    // 先置旧提取为 superseded
    const existingActive = await OcrDocumentExtraction.query()
      .where('job_id', job.id)
      .where('status', 'active')
      .first()

    if (existingActive) {
      existingActive.status = 'superseded'
      await existingActive.save()
    }

    const extraction = await OcrDocumentExtraction.create({
      jobId: job.id,
      sourceAttachmentId: job.sourceAttachmentId,
      acceptedText,
      acceptedTextHash,
      pageRefs: pageRefs as number[],
      sourceHash: job.sourceHash,
      reviewerId: userId,
      reviewNote: request.reviewNote ?? null,
      status: 'active',
      supersededById: null,
    })

    // 更新旧提取的 superseded_by 引用
    if (existingActive) {
      existingActive.supersededById = extraction.id
      await existingActive.save()
    }

    await this.#audit.log({
      event: AuditEvent.OCR_DOCUMENT_CONFIRMATION_SAVED,
      userId,
      organizationId: job.organizationId,
      projectId: job.projectId,
      entityType: 'ocr_document_extraction',
      entityId: extraction.id,
      metadata: redactOcrAuditMetadata({
        jobId: job.id,
        extractionId: extraction.id,
        textHash: acceptedTextHash,
        // 提取表没有 extraction_hash 列，确定性哈希作为低敏证据落在审计元数据里
        extractionHash,
        sourceHash: job.sourceHash,
        pageRefCount: pageRefs.length,
        supersedesId: existingActive?.id ?? null,
      }),
    })

    return this.#toExtractionDTO(extraction)
  }

  // =========================================================================
  // 已接受提取查询
  // =========================================================================

  async listExtractions(
    jobId: number,
    policy: OcrDocumentPolicy,
  ): Promise<OcrDocumentAcceptedExtraction[]> {
    policy.assertView()
    const extractions = await OcrDocumentExtraction.query()
      .where('job_id', jobId)
      .orderBy('created_at', 'desc')
    return extractions.map((e) => this.#toExtractionDTO(e))
  }

  // =========================================================================
  // DTO 转换
  // =========================================================================

  #toSummaryDTO(job: OcrDocumentJob): OcrDocumentJobSummary {
    return {
      id: job.id,
      organizationId: job.organizationId,
      projectId: job.projectId,
      sourceKind: job.sourceKind,
      sourceAttachmentId: job.sourceAttachmentId,
      sourceFileName: job.sourceFileName,
      sourceMimeType: job.sourceMimeType,
      sourceHash: job.sourceHash,
      status: job.status,
      pageCount: job.pageCount,
      succeededPages: job.succeededPages,
      failedPages: job.failedPages,
      provider: job.provider,
      model: job.model,
      warningCodes: (job.warningCodes as OcrDocumentWarningCode[]) ?? [],
      costSummary: (job.costSummary as any) ?? null,
      idempotencyKeyHash: job.idempotencyKeyHash,
      createdAt: job.createdAt.toISO()!,
      updatedAt: job.updatedAt.toISO()!,
    }
  }

  #toDetailDTO(job: OcrDocumentJob): OcrDocumentJobDetail {
    const summary = this.#toSummaryDTO(job)
    const pages: OcrDocumentPageResult[] = (job.pages ?? []).map((p) => ({
      id: p.id,
      jobId: p.jobId,
      pageIndex: p.pageIndex,
      sourceHash: p.sourceHash,
      status: p.status,
      mimeType: p.mimeType,
      normalizedBytes: p.normalizedBytes,
      warnings: (p.warnings as OcrDocumentWarning[]) ?? [],
      candidateId: p.candidateId,
      candidateText: p.candidateText,
      candidateHash: p.candidateHash,
      provider: p.provider,
      model: p.model,
      usage: (p.usage as OcrDocumentProviderUsage) ?? null,
      createdAt: p.createdAt.toISO()!,
      updatedAt: p.updatedAt.toISO()!,
    }))

    return {
      ...summary,
      connectionId: job.connectionId,
      modelId: job.modelId,
      promptHint: job.promptHint,
      inputSignature: job.inputSignature,
      pages,
      warnings: (job.warnings as OcrDocumentWarning[]) ?? [],
      acceptedExtractionId: null,
      acceptedExtractionStatus: null,
    }
  }

  #toExtractionDTO(e: OcrDocumentExtraction): OcrDocumentAcceptedExtraction {
    return {
      id: e.id,
      jobId: e.jobId,
      sourceAttachmentId: e.sourceAttachmentId,
      acceptedText: e.acceptedText,
      acceptedTextHash: e.acceptedTextHash,
      pageRefs: (e.pageRefs as number[]) ?? [],
      sourceHash: e.sourceHash,
      reviewerId: e.reviewerId,
      reviewNote: e.reviewNote,
      status: e.status,
      supersededById: e.supersededById,
      createdAt: e.createdAt.toISO()!,
      updatedAt: e.updatedAt.toISO()!,
    }
  }
}
