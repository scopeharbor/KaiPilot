/**
 * v3-ocr-provider-observability-cost-controls §5.1 — OCR provider 执行编排服务。
 *
 * 在 OCR provider 调用前执行：capability 校验、预算 preflight、限流预检；
 * 调用后执行：postflight 记录、attempt 记录、审计。
 *
 * AIGateway 保持适配器抽象，不感知 OCR job 状态/审计/RBAC。
 * 本服务是 OCR 侧的编排包装层。
 */

import { resolveAdapter } from '#services/ai_m0/resolver'
import OcrBudgetGuard from '#services/ai_ocr/ocr_budget_guard'
import OcrRateLimitGuard from '#services/ai_ocr/ocr_rate_limit_guard'
import OcrProviderAttemptRecorder from '#services/ai_ocr/ocr_provider_attempt_recorder'
import OcrProviderCostEstimator from '#services/ai_ocr/ocr_provider_cost_estimator'
import AuditService, { AuditEvent } from '#services/audit_service'
import { OcrPermissionAuditResolver } from './ocr_permission_audit_resolver.js'
import { writeOcrBoundaryAudit } from './ocr_permission_audit_logger.js'
import {
  computeOcrProviderIdempotencyKey,
  computeOcrInputHash,
  computeOcrOutputHash,
  normalizeOcrErrorCategory,
  redactOcrProviderObservabilityMetadata,
  type OcrProviderWarningCode,
} from '@aiproj/types'
import type OcrDocumentJob from '#models/ocr_document_job'
import type OcrDocumentPage from '#models/ocr_document_page'

export interface OcrExecutionResult {
  ok: boolean
  extractedText?: string
  attemptRef?: string
  errorCategory?: string
  errorMessage?: string
  warningCodes: OcrProviderWarningCode[]
  /** 是否因预算/限流被阻断（未调 provider） */
  blocked?: boolean
  blockReason?: string
}

export interface OcrProviderExecutionServiceOptions {
  budgetGuard?: OcrBudgetGuard
  rateLimitGuard?: OcrRateLimitGuard
  recorder?: OcrProviderAttemptRecorder
  costEstimator?: OcrProviderCostEstimator
  /** 可注入的授权解析器（默认真实解析器；测试可注入假适配器）。 */
  resolver?: OcrPermissionAuditResolver
}

export default class OcrProviderExecutionService {
  readonly #budgetGuard: OcrBudgetGuard
  readonly #rateLimitGuard: OcrRateLimitGuard
  readonly #recorder: OcrProviderAttemptRecorder
  readonly #costEstimator: OcrProviderCostEstimator
  readonly #resolver: OcrPermissionAuditResolver
  readonly #audit = new AuditService()

  constructor(options?: OcrProviderExecutionServiceOptions) {
    this.#budgetGuard = options?.budgetGuard ?? new OcrBudgetGuard()
    this.#rateLimitGuard = options?.rateLimitGuard ?? new OcrRateLimitGuard()
    this.#recorder = options?.recorder ?? new OcrProviderAttemptRecorder()
    this.#costEstimator = options?.costEstimator ?? new OcrProviderCostEstimator()
    this.#resolver = options?.resolver ?? new OcrPermissionAuditResolver()
  }

  /**
   * 权限守卫：在 provider 调用前解析 `provider_run` 决策。
   * 被拒（denied/stale/retention/privacy/metadata_only）→ 写低敏边界审计并返回阻断结果，
   * 绝不调用 provider/model。
   */
  async #guardProviderRun(input: {
    organizationId: number
    projectId: number
    jobId: number
    userId: number
  }): Promise<{
    ok: boolean
    blocked?: boolean
    blockReason?: string
    errorMessage?: string
    warningCodes: OcrProviderWarningCode[]
  } | null> {
    const snapshot = await this.#resolver.resolve({
      actorId: input.userId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      action: 'provider_run',
      sourceRef: { type: 'ocr_source', id: input.jobId, kind: 'job' },
      artifactRef: { type: 'ocr_artifact', id: null, kind: 'accepted_extraction' },
    })
    if (snapshot.result === 'allow' || snapshot.result === 'confirm_required') {
      return null
    }
    await writeOcrBoundaryAudit(this.#audit, snapshot)
    return {
      ok: false,
      blocked: true,
      blockReason: 'ocr_permission_blocked',
      errorMessage: 'OCR 权限/审计守卫阻止 provider 调用',
      warningCodes: [],
    }
  }

  /**
   * 执行单个 OCR 页面的 provider 调用（含 preflight/postflight/recording）。
   *
   * @returns OcrExecutionResult — 总是返回结果，预算/限流阻断时 blocked=true。
   */
  async executePage(input: {
    organizationId: number
    projectId: number
    job: OcrDocumentJob
    page: OcrDocumentPage
    attemptNumber: number
    imageDataUrl: string
    promptHint?: string | null
    userId: number
  }): Promise<OcrExecutionResult> {
    const {
      organizationId,
      projectId,
      job,
      page,
      attemptNumber,
      imageDataUrl,
      promptHint,
      userId,
    } = input

    const idempotencyKey = computeOcrProviderIdempotencyKey({
      organizationId,
      projectId,
      ocrJobId: job.id,
      pageId: page.id,
      attemptNumber,
    })

    // 0. 权限守卫：被拒则阻断，不调用真实 provider/model（§6.3）
    const guard = await this.#guardProviderRun({
      organizationId,
      projectId,
      jobId: job.id,
      userId,
    })
    if (guard) {
      return {
        ok: false,
        errorCategory: 'none',
        errorMessage: guard.errorMessage,
        warningCodes: guard.warningCodes,
        blocked: true,
        blockReason: guard.blockReason,
      }
    }

    // 1. Resolve adapter
    const resolved = await resolveAdapter({
      connectionId: job.connectionId ?? undefined,
      modelId: job.modelId ?? undefined,
      organizationId,
      requiredCapabilities: ['ocr', 'vision'],
    })

    if (resolved.unavailable || resolved.source !== 'user') {
      const warningCodes: OcrProviderWarningCode[] = ['PROVIDER_UNAVAILABLE']
      await this.#recordAttempt({
        organizationId,
        projectId,
        jobId: job.id,
        pageId: page.id,
        attemptNumber,
        provider: resolved.provider,
        model: resolved.model,
        connectionId: resolved.connectionId ?? null,
        modelId: resolved.modelId ?? null,
        status: 'capability_mismatch',
        errorCategory: 'capability_mismatch',
        warningCodes,
        idempotencyKey,
        inputHash: computeOcrInputHash({ imageDataUrl, promptHint }),
      })
      return {
        ok: false,
        errorCategory: 'capability_mismatch',
        errorMessage: 'OCR 模型不可用或不具备 OCR 能力',
        warningCodes,
        blocked: true,
        blockReason: 'model_unavailable',
      }
    }

    const provider = resolved.provider
    const model = resolved.model
    const connectionId = resolved.connectionId ?? null
    const modelId = resolved.modelId ?? null
    const pricingSnapshotId = resolved.pricingSnapshotId ?? null

    // 2. Budget preflight
    const estimatedTokens = Math.max(1, Math.ceil((page.normalizedBytes ?? 1000) / 1024))
    const budgetPreflight = await this.#budgetGuard.preflight({
      organizationId,
      projectId,
      ocrJobId: job.id,
      pageId: page.id,
      provider,
      model,
      capabilityMode: 'ocr',
      estimatedTokens,
      estimatedCost: null,
      currency: 'USD',
    })

    if (!budgetPreflight.allowed) {
      const warningCodes: OcrProviderWarningCode[] = ['BUDGET_HARD_LIMIT_REACHED']
      await this.#recordAttempt({
        organizationId,
        projectId,
        jobId: job.id,
        pageId: page.id,
        attemptNumber,
        provider,
        model,
        connectionId,
        modelId,
        status: 'budget_blocked',
        errorCategory: 'none',
        warningCodes,
        idempotencyKey,
        budgetDecisionRef: budgetPreflight.decisionId ?? null,
        estimatedCost: null,
        costStatus: null,
        inputHash: computeOcrInputHash({ imageDataUrl, promptHint }),
      })
      await this.#audit.log({
        event: AuditEvent.OCR_DOCUMENT_BUDGET_BLOCKED,
        userId,
        organizationId,
        projectId,
        entityType: 'ocr_document_page',
        entityId: page.id,
        metadata: redactOcrProviderObservabilityMetadata({
          jobId: job.id,
          pageIndex: page.pageIndex,
          provider,
          model,
          budgetStatus: budgetPreflight.status,
        }),
      })
      return {
        ok: false,
        errorCategory: 'none',
        errorMessage: 'OCR 预算已达硬限制，调用被阻止',
        warningCodes,
        blocked: true,
        blockReason: 'budget_hard_blocked',
      }
    }

    // 3. Rate-limit preflight
    const rateLimitPreflight = await this.#rateLimitGuard.preflight({
      organizationId,
      projectId,
      ocrJobId: job.id,
      provider,
      model,
      estimatedTokens,
      rpmLimit: resolved.throttle ? 100 : null, // 从 model config 读取
      tpmLimit: null,
    })

    if (!rateLimitPreflight.allowed) {
      const warningCodes: OcrProviderWarningCode[] = ['RATE_LIMIT_BLOCKED']
      await this.#recordAttempt({
        organizationId,
        projectId,
        jobId: job.id,
        pageId: page.id,
        attemptNumber,
        provider,
        model,
        connectionId,
        modelId,
        status: 'rate_limited',
        errorCategory: 'none',
        warningCodes,
        idempotencyKey,
        rateLimitDecisionRef: rateLimitPreflight.decisionId ?? null,
        estimatedCost: null,
        costStatus: null,
        inputHash: computeOcrInputHash({ imageDataUrl, promptHint }),
      })
      await this.#audit.log({
        event: AuditEvent.OCR_DOCUMENT_RATE_LIMITED,
        userId,
        organizationId,
        projectId,
        entityType: 'ocr_document_page',
        entityId: page.id,
        metadata: redactOcrProviderObservabilityMetadata({
          jobId: job.id,
          pageIndex: page.pageIndex,
          provider,
          model,
          rateLimitStatus: rateLimitPreflight.status,
        }),
      })
      return {
        ok: false,
        errorCategory: 'none',
        errorMessage: 'OCR 请求频率超限，调用被阻止',
        warningCodes,
        blocked: true,
        blockReason: 'rate_limited',
      }
    }

    // 4. Execute provider call
    const startedAt = performance.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)

    let providerResult
    try {
      providerResult = await resolved.gateway.ocrPreview({
        imageDataUrl,
        promptHint: promptHint ?? null,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt))

    // 5. Postflight recording
    if (providerResult.ok && providerResult.extractedText) {
      const usage = providerResult.usage
      const costEstimate = this.#costEstimator.estimate(
        usage
          ? {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            }
          : null,
        null, // pricing snapshot lookup deferred
        pricingSnapshotId,
      )

      await this.#recordAttempt({
        organizationId,
        projectId,
        jobId: job.id,
        pageId: page.id,
        attemptNumber,
        provider,
        model,
        connectionId,
        modelId,
        status: 'succeeded',
        latencyMs,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        estimatedCost: costEstimate.estimatedCost,
        currency: costEstimate.currency,
        costStatus: costEstimate.costStatus,
        pricingSnapshotId,
        inputHash: computeOcrInputHash({ imageDataUrl, promptHint }),
        outputRef: `candidate:${job.id}:${page.id}`,
        outputHash: computeOcrOutputHash(providerResult.extractedText),
        errorCategory: 'none',
        warningCodes: budgetPreflight.warningCodes,
        idempotencyKey,
      })

      // Budget postflight
      await this.#budgetGuard.postflight({
        organizationId,
        projectId,
        ocrJobId: job.id,
        pageId: page.id,
        provider,
        model,
        actualUsage: usage
          ? {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            }
          : null,
        actualCost: costEstimate.estimatedCost,
        currency: costEstimate.currency,
        idempotencyKey,
      })

      await this.#audit.log({
        event: AuditEvent.OCR_DOCUMENT_PROVIDER_ATTEMPT,
        userId,
        organizationId,
        projectId,
        entityType: 'ocr_document_page',
        entityId: page.id,
        metadata: redactOcrProviderObservabilityMetadata({
          jobId: job.id,
          pageIndex: page.pageIndex,
          provider,
          model,
          latencyMs,
          costStatus: costEstimate.costStatus,
        }),
      })

      return {
        ok: true,
        extractedText: providerResult.extractedText,
        attemptRef: `attempt:${page.id}:${idempotencyKey}`,
        warningCodes: budgetPreflight.warningCodes,
      }
    }

    // Provider failed
    const errorCategory = normalizeOcrErrorCategory(providerResult.errorKind)
    const warningCodes: OcrProviderWarningCode[] = ['PROVIDER_DEGRADATION']

    await this.#recordAttempt({
      organizationId,
      projectId,
      jobId: job.id,
      pageId: page.id,
      attemptNumber,
      provider,
      model,
      connectionId,
      modelId,
      status: 'failed',
      latencyMs,
      errorCategory,
      warningCodes,
      idempotencyKey,
      inputHash: computeOcrInputHash({ imageDataUrl, promptHint }),
    })

    await this.#audit.log({
      event: AuditEvent.OCR_DOCUMENT_PROVIDER_FAILURE,
      userId,
      organizationId,
      projectId,
      entityType: 'ocr_document_page',
      entityId: page.id,
      metadata: redactOcrProviderObservabilityMetadata({
        jobId: job.id,
        pageIndex: page.pageIndex,
        errorKind: providerResult.errorKind ?? 'AI_SERVICE_ERROR',
        provider,
        model,
      }),
    })

    return {
      ok: false,
      errorCategory,
      errorMessage: providerResult.errorMessage ?? 'OCR provider 返回空结果',
      warningCodes,
    }
  }

  async #recordAttempt(params: {
    organizationId: number
    projectId: number
    jobId: number
    pageId: number | null
    attemptNumber: number
    provider: string
    model: string
    connectionId: number | null
    modelId: number | null
    status: string
    latencyMs?: number | null
    inputTokens?: number | null
    outputTokens?: number | null
    totalTokens?: number | null
    estimatedCost?: number | null
    currency?: string | null
    costStatus?: string | null
    pricingSnapshotId?: string | null
    inputHash?: string | null
    outputRef?: string | null
    outputHash?: string | null
    budgetDecisionRef?: string | null
    rateLimitDecisionRef?: string | null
    errorCategory?: string
    warningCodes?: OcrProviderWarningCode[]
    idempotencyKey: string
  }): Promise<string> {
    return this.#recorder.record({
      organizationId: params.organizationId,
      projectId: params.projectId,
      ocrJobId: params.jobId,
      pageId: params.pageId,
      attemptNumber: params.attemptNumber,
      provider: params.provider,
      model: params.model,
      connectionId: params.connectionId,
      modelId: params.modelId,
      capabilityMode: 'ocr',
      status: params.status as any,
      latencyMs: params.latencyMs ?? null,
      inputTokens: params.inputTokens ?? null,
      outputTokens: params.outputTokens ?? null,
      totalTokens: params.totalTokens ?? null,
      estimatedCost: params.estimatedCost ?? null,
      currency: params.currency ?? null,
      costStatus: (params.costStatus as any) ?? null,
      pricingSnapshotId: params.pricingSnapshotId ?? null,
      inputHash: params.inputHash ?? null,
      outputRef: params.outputRef ?? null,
      outputHash: params.outputHash ?? null,
      budgetDecisionRef: params.budgetDecisionRef ?? null,
      rateLimitDecisionRef: params.rateLimitDecisionRef ?? null,
      errorCategory: (params.errorCategory as any) ?? 'none',
      warningCodes: params.warningCodes ?? [],
      idempotencyKey: params.idempotencyKey,
    })
  }
}
