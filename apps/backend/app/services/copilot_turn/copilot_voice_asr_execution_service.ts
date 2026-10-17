/**
 * v3-copilot-voice-input §5.1 — ASR provider 执行编排服务。
 *
 * 在 ASR provider 调用前执行：capability 校验、预算 preflight、限流预检；
 * 调用后执行：postflight 记录、attempt 记录、审计。
 *
 * 设计决策（D1）：
 * - ASR 照搬 OCR 的 provider 执行范式，不新建一套
 * - 二者的结构完全同构：上传媒体、调外部 provider、得到文本、结果进待确认
 * - 复用意味着预算、限流、隐私、下游、审计五重守卫自动继承
 *
 * 关键差异（与 OCR）：
 * - OCR 是同步 page-level；ASR 是异步 job-level（回合不同步等待转写完成）
 * - ASR 不做说话人分离与身份识别（D6）
 */

import { resolveAdapter } from '#services/ai_m0/resolver'
import OcrBudgetGuard from '#services/ai_ocr/ocr_budget_guard'
import OcrRateLimitGuard from '#services/ai_ocr/ocr_rate_limit_guard'
import OcrProviderAttemptRecorder from '#services/ai_ocr/ocr_provider_attempt_recorder'
import OcrProviderCostEstimator from '#services/ai_ocr/ocr_provider_cost_estimator'
import AuditService, { AuditEvent } from '#services/audit_service'
import { OcrPermissionAuditResolver } from '#services/ai_ocr/ocr_permission_audit_resolver'
import { writeOcrBoundaryAudit } from '#services/ai_ocr/ocr_permission_audit_logger'
import {
  computeOcrProviderIdempotencyKey,
  computeOcrInputHash,
  computeOcrOutputHash,
  normalizeOcrErrorCategory,
  redactOcrProviderObservabilityMetadata,
  type OcrProviderWarningCode,
} from '@aiproj/types'

// ===========================================================================
// 结果类型
// ===========================================================================

export interface AsrExecutionResult {
  ok: boolean
  /** 转写文本（仅成功时）。 */
  transcriptText?: string
  /** 有界摘要（≤200 字符）。 */
  boundedSummary?: string
  attemptRef?: string
  errorCategory?: string
  errorMessage?: string
  warningCodes: OcrProviderWarningCode[]
  /** 是否因预算/限流被阻断（未调 provider）。 */
  blocked?: boolean
  blockReason?: string
}

export interface AsrProviderExecutionServiceOptions {
  budgetGuard?: OcrBudgetGuard
  rateLimitGuard?: OcrRateLimitGuard
  recorder?: OcrProviderAttemptRecorder
  costEstimator?: OcrProviderCostEstimator
  resolver?: OcrPermissionAuditResolver
}

// ===========================================================================
// 服务
// ===========================================================================

export default class CopilotVoiceAsrExecutionService {
  readonly #budgetGuard: OcrBudgetGuard
  readonly #rateLimitGuard: OcrRateLimitGuard
  readonly #recorder: OcrProviderAttemptRecorder
  readonly #costEstimator: OcrProviderCostEstimator
  readonly #resolver: OcrPermissionAuditResolver
  readonly #audit = new AuditService()

  constructor(options?: AsrProviderExecutionServiceOptions) {
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
      blockReason: 'asr_permission_blocked',
      errorMessage: 'ASR 权限/审计守卫阻止 provider 调用',
      warningCodes: [],
    }
  }

  /**
   * 执行单个 ASR 作业的 provider 调用（含 preflight/postflight/recording）。
   *
   * @returns AsrExecutionResult — 总是返回结果，预算/限流阻断时 blocked=true。
   *
   * 设计决策（D5.7）：
   * - 不做说话人分离与身份识别
   * - 转写产物为无归属文本流、不含说话人标识
   */
  async executeTranscription(input: {
    organizationId: number
    projectId: number
    jobId: number
    audioDataUrl: string
    audioMimeType: string
    userId: number
    connectionId?: number | null
    modelId?: number | null
  }): Promise<AsrExecutionResult> {
    const {
      organizationId,
      projectId,
      jobId,
      audioDataUrl,
      userId,
      connectionId: inputConnectionId,
      modelId: inputModelId,
    } = input

    const idempotencyKey = computeOcrProviderIdempotencyKey({
      organizationId,
      projectId,
      ocrJobId: jobId,
      pageId: null,
      attemptNumber: 1,
    })

    // 0. 权限守卫：被拒则阻断，不调用真实 provider/model
    const guard = await this.#guardProviderRun({
      organizationId,
      projectId,
      jobId,
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

    // 1. Resolve adapter（ASR 能力）
    const resolved = await resolveAdapter({
      connectionId: inputConnectionId ?? undefined,
      modelId: inputModelId ?? undefined,
      organizationId,
      requiredCapabilities: ['audio_input'],
    })

    if (resolved.unavailable || resolved.source !== 'user') {
      const warningCodes: OcrProviderWarningCode[] = ['PROVIDER_UNAVAILABLE']
      await this.#recordAttempt({
        organizationId,
        projectId,
        jobId,
        pageId: null,
        attemptNumber: 1,
        provider: resolved.provider,
        model: resolved.model,
        connectionId: resolved.connectionId ?? null,
        modelId: resolved.modelId ?? null,
        status: 'capability_mismatch',
        errorCategory: 'capability_mismatch',
        warningCodes,
        idempotencyKey,
        inputHash: computeOcrInputHash({ imageDataUrl: audioDataUrl, promptHint: null }),
      })
      return {
        ok: false,
        errorCategory: 'capability_mismatch',
        errorMessage: 'ASR 模型不可用或不具备语音识别能力',
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
    const estimatedTokens = Math.max(1, Math.ceil(1000 / 1024)) // 简化估算
    const budgetPreflight = await this.#budgetGuard.preflight({
      organizationId,
      projectId,
      ocrJobId: jobId,
      pageId: null,
      provider,
      model,
      capabilityMode: 'ocr', // 复用 OCR 预算模式
      estimatedTokens,
      estimatedCost: null,
      currency: 'USD',
    })

    if (!budgetPreflight.allowed) {
      const warningCodes: OcrProviderWarningCode[] = ['BUDGET_HARD_LIMIT_REACHED']
      await this.#recordAttempt({
        organizationId,
        projectId,
        jobId,
        pageId: null,
        attemptNumber: 1,
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
        inputHash: computeOcrInputHash({ imageDataUrl: audioDataUrl, promptHint: null }),
      })
      await this.#audit.log({
        event: AuditEvent.OCR_DOCUMENT_BUDGET_BLOCKED,
        userId,
        organizationId,
        projectId,
        entityType: 'voice_transcription_job',
        entityId: jobId,
        metadata: redactOcrProviderObservabilityMetadata({
          jobId,
          pageIndex: null,
          provider,
          model,
          budgetStatus: budgetPreflight.status,
        }),
      })
      return {
        ok: false,
        errorCategory: 'none',
        errorMessage: 'ASR 预算已达硬限制，调用被阻止',
        warningCodes,
        blocked: true,
        blockReason: 'budget_hard_blocked',
      }
    }

    // 3. Rate-limit preflight
    const rateLimitPreflight = await this.#rateLimitGuard.preflight({
      organizationId,
      projectId,
      ocrJobId: jobId,
      provider,
      model,
      estimatedTokens,
      rpmLimit: null,
      tpmLimit: null,
    })

    if (!rateLimitPreflight.allowed) {
      const warningCodes: OcrProviderWarningCode[] = ['RATE_LIMIT_BLOCKED']
      await this.#recordAttempt({
        organizationId,
        projectId,
        jobId,
        pageId: null,
        attemptNumber: 1,
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
        inputHash: computeOcrInputHash({ imageDataUrl: audioDataUrl, promptHint: null }),
      })
      await this.#audit.log({
        event: AuditEvent.OCR_DOCUMENT_RATE_LIMITED,
        userId,
        organizationId,
        projectId,
        entityType: 'voice_transcription_job',
        entityId: jobId,
        metadata: redactOcrProviderObservabilityMetadata({
          jobId,
          pageIndex: null,
          provider,
          model,
          rateLimitStatus: rateLimitPreflight.status,
        }),
      })
      return {
        ok: false,
        errorCategory: 'none',
        errorMessage: 'ASR 请求频率超限，调用被阻止',
        warningCodes,
        blocked: true,
        blockReason: 'rate_limited',
      }
    }

    // 4. Execute provider call（简化：实际调用 AIGateway 的 ASR 接口）
    const startedAt = performance.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)

    let providerResult: {
      ok: boolean
      extractedText?: string
      errorKind?: string
      errorMessage?: string
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    }
    try {
      // 实际调用 AIGateway 的 ASR 接口
      // 这里使用 OCR preview 作为占位，实际应调用 ASR 接口
      providerResult = await resolved.gateway.ocrPreview({
        imageDataUrl: audioDataUrl,
        promptHint: '请转写这段音频内容，不要添加说话人标识。',
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
        null,
        pricingSnapshotId,
      )

      await this.#recordAttempt({
        organizationId,
        projectId,
        jobId,
        pageId: null,
        attemptNumber: 1,
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
        inputHash: computeOcrInputHash({ imageDataUrl: audioDataUrl, promptHint: null }),
        outputRef: `voice_candidate:${jobId}`,
        outputHash: computeOcrOutputHash(providerResult.extractedText),
        errorCategory: 'none',
        warningCodes: budgetPreflight.warningCodes,
        idempotencyKey,
      })

      // Budget postflight
      await this.#budgetGuard.postflight({
        organizationId,
        projectId,
        ocrJobId: jobId,
        pageId: null,
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
        entityType: 'voice_transcription_job',
        entityId: jobId,
        metadata: redactOcrProviderObservabilityMetadata({
          jobId,
          pageIndex: null,
          provider,
          model,
          latencyMs,
          costStatus: costEstimate.costStatus,
        }),
      })

      // 生成有界摘要（≤200 字符）
      const boundedSummary = providerResult.extractedText.slice(0, 200)

      return {
        ok: true,
        transcriptText: providerResult.extractedText,
        boundedSummary,
        attemptRef: `attempt:${jobId}:${idempotencyKey}`,
        warningCodes: budgetPreflight.warningCodes,
      }
    }

    // Provider failed
    const errorCategory = normalizeOcrErrorCategory(providerResult.errorKind ?? 'AI_SERVICE_ERROR')
    const warningCodes: OcrProviderWarningCode[] = ['PROVIDER_DEGRADATION']

    await this.#recordAttempt({
      organizationId,
      projectId,
      jobId,
      pageId: null,
      attemptNumber: 1,
      provider,
      model,
      connectionId,
      modelId,
      status: 'failed',
      latencyMs,
      errorCategory,
      warningCodes,
      idempotencyKey,
      inputHash: computeOcrInputHash({ imageDataUrl: audioDataUrl, promptHint: null }),
    })

    await this.#audit.log({
      event: AuditEvent.OCR_DOCUMENT_PROVIDER_FAILURE,
      userId,
      organizationId,
      projectId,
      entityType: 'voice_transcription_job',
      entityId: jobId,
      metadata: redactOcrProviderObservabilityMetadata({
        jobId,
        pageIndex: null,
        errorKind: providerResult.errorKind ?? 'AI_SERVICE_ERROR',
        provider,
        model,
      }),
    })

    return {
      ok: false,
      errorCategory,
      errorMessage: providerResult.errorMessage ?? 'ASR provider 返回空结果',
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
      capabilityMode: 'ocr', // 大复用 OCR 记录模式
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
