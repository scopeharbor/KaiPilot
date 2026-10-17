/**
 * v3-ocr-provider-observability-cost-controls §4.9 — OCR provider attempt 记录器。
 *
 * 低敏 attempt 事件写入：成功/失败/跳过/阻断状态 + 摘要聚合。
 * 不存 prompt/output body/API key/Authorization header/full extracted text。
 */

import type {
  OcrProviderAttemptEvent,
  OcrProviderAttemptStatus,
  OcrProviderErrorCategory,
  OcrProviderWarningCode,
  OcrCostStatus,
  OcrProviderObservabilitySummary,
  OcrProviderObservabilityEventItem,
  OcrProviderObservabilityFilters,
  OcrProviderObservabilityEventList,
} from '@aiproj/types'
import { buildOcrProviderObservabilitySummary } from '@aiproj/types'
import OcrProviderAttempt from '#models/ocr_provider_attempt'
import { DateTime } from 'luxon'

export interface AttemptRecordInput {
  organizationId: number
  projectId: number
  ocrJobId: number
  pageId?: number | null
  attemptNumber: number
  provider: string
  model: string
  connectionId?: number | null
  modelId?: number | null
  capabilityMode?: string | null
  status: OcrProviderAttemptStatus
  latencyMs?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  estimatedCost?: number | null
  currency?: string | null
  costStatus?: OcrCostStatus | null
  pricingSnapshotId?: string | null
  inputHash?: string | null
  outputRef?: string | null
  outputHash?: string | null
  budgetDecisionRef?: string | null
  rateLimitDecisionRef?: string | null
  errorCategory?: OcrProviderErrorCategory
  warningCodes?: OcrProviderWarningCode[]
  idempotencyKey: string
  occurredAt?: string
}

export default class OcrProviderAttemptRecorder {
  /**
   * 记录一次 attempt（幂等：idempotencyKey 去重）。
   */
  async record(input: AttemptRecordInput): Promise<string> {
    // v3-multitenant-database-isolation §5.4 / §6.2：幂等命中必须在组织 scope 内查找。
    // 无 scope 时命中他租行会走下面的"幂等更新"分支，直接改写他租 attempt 的
    // status/usage/cost（跨租写入）。唯一索引已同步改为
    // (organization_id, idempotency_key)，见迁移 1839300000002。
    const existing = await OcrProviderAttempt.query()
      .where('organization_id', input.organizationId)
      .where('idempotency_key', input.idempotencyKey)
      .first()

    if (existing) {
      // 幂等更新：只更新 status/usage/cost（如果之前是 skipped/queued）。
      if (existing.status === 'queued' || existing.status === 'skipped') {
        existing.status = input.status as any
        existing.latencyMs = input.latencyMs ?? null
        existing.inputTokens = input.inputTokens ?? null
        existing.outputTokens = input.outputTokens ?? null
        existing.totalTokens = input.totalTokens ?? null
        existing.estimatedCost = input.estimatedCost ?? null
        existing.errorCategory = (input.errorCategory as any) ?? 'none'
        if (input.warningCodes) existing.warningCodes = input.warningCodes as any
        await existing.save()
      }
      return `attempt:${existing.id}:${input.idempotencyKey}`
    }

    const attempt = await OcrProviderAttempt.create({
      organizationId: input.organizationId,
      projectId: input.projectId,
      ocrJobId: input.ocrJobId,
      pageId: input.pageId ?? null,
      attemptNumber: input.attemptNumber,
      provider: input.provider,
      model: input.model,
      connectionId: input.connectionId ?? null,
      modelId: input.modelId ?? null,
      capabilityMode: input.capabilityMode ?? null,
      status: input.status as any,
      latencyMs: input.latencyMs ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      cacheReadTokens: input.cacheReadTokens ?? null,
      cacheWriteTokens: input.cacheWriteTokens ?? null,
      estimatedCost: input.estimatedCost ?? null,
      currency: input.currency ?? null,
      costStatus: (input.costStatus as any) ?? null,
      pricingSnapshotId: input.pricingSnapshotId ?? null,
      inputHash: input.inputHash ?? null,
      outputRef: input.outputRef ?? null,
      outputHash: input.outputHash ?? null,
      budgetDecisionRef: input.budgetDecisionRef ?? null,
      rateLimitDecisionRef: input.rateLimitDecisionRef ?? null,
      errorCategory: (input.errorCategory as any) ?? 'none',
      warningCodes: (input.warningCodes as any) ?? null,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt ? DateTime.fromISO(input.occurredAt) : DateTime.now(),
    })

    return `attempt:${attempt.id}:${input.idempotencyKey}`
  }

  /**
   * 获取项目级 observability 摘要。
   */
  async getSummary(
    organizationId: number,
    projectId: number,
  ): Promise<OcrProviderObservabilitySummary> {
    const attempts = await OcrProviderAttempt.filterProject(organizationId, projectId).orderBy(
      'occurred_at',
      'desc',
    )

    const events: OcrProviderAttemptEvent[] = attempts.map((a) => this.#toEvent(a))
    return buildOcrProviderObservabilitySummary({
      projectId,
      events,
    })
  }

  /**
   * 获取 bounded 事件列表。
   */
  async listEvents(
    organizationId: number,
    projectId: number,
    filters: OcrProviderObservabilityFilters,
  ): Promise<OcrProviderObservabilityEventList> {
    const page = filters.page ?? 1
    const perPage = Math.min(filters.perPage ?? 20, 100)

    let query = OcrProviderAttempt.filterProject(organizationId, projectId).orderBy(
      'occurred_at',
      'desc',
    )

    if (filters.ocrJobId) {
      query = query.where('ocr_job_id', filters.ocrJobId)
    }
    if (filters.provider) {
      query = query.where('provider', filters.provider)
    }
    if (filters.model) {
      query = query.where('model', filters.model)
    }
    if (filters.status) {
      query = query.where('status', filters.status)
    }
    if (filters.errorCategory) {
      query = query.where('error_category', filters.errorCategory)
    }
    if (filters.timeWindowStart) {
      query = query.where('occurred_at', '>=', DateTime.fromISO(filters.timeWindowStart).toSQL()!)
    }
    if (filters.timeWindowEnd) {
      query = query.where('occurred_at', '<=', DateTime.fromISO(filters.timeWindowEnd).toSQL()!)
    }

    const totalRow = await query.clone().clearOrder().count('* as total').first()
    const total = Number(totalRow?.$extras?.total ?? 0)

    const items = await query.forPage(page, perPage)

    return {
      data: items.map((a) => this.#toItem(a)),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    }
  }

  #toEvent(a: OcrProviderAttempt): OcrProviderAttemptEvent {
    return {
      id: a.id,
      organizationId: a.organizationId,
      projectId: a.projectId,
      ocrJobId: a.ocrJobId,
      pageId: a.pageId,
      attemptNumber: a.attemptNumber,
      providerRef: {
        provider: a.provider,
        model: a.model,
        connectionId: a.connectionId,
        modelId: a.modelId,
        capabilityMode: a.capabilityMode,
      },
      capabilityMode: a.capabilityMode,
      status: a.status,
      latencyMs: a.latencyMs,
      usage: {
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        totalTokens: a.totalTokens,
        cacheReadTokens: a.cacheReadTokens,
        cacheWriteTokens: a.cacheWriteTokens,
        audioTokens: a.audioTokens,
        reasoningTokens: a.reasoningTokens,
        contextTokens: a.contextTokens,
      },
      costEstimate: {
        estimatedCost: a.estimatedCost ?? 0,
        currency: a.currency ?? 'USD',
        costStatus: a.costStatus ?? 'unavailable',
        pricingSnapshotId: a.pricingSnapshotId,
      },
      budgetDecisionRef: a.budgetDecisionRef,
      rateLimitDecisionRef: a.rateLimitDecisionRef,
      inputHash: a.inputHash,
      outputRef: a.outputRef,
      outputHash: a.outputHash,
      errorCategory: a.errorCategory,
      warningCodes: (a.warningCodes as OcrProviderWarningCode[]) ?? [],
      idempotencyKey: a.idempotencyKey,
      occurredAt: a.occurredAt.toISO()!,
    }
  }

  #toItem(a: OcrProviderAttempt): OcrProviderObservabilityEventItem {
    return {
      id: a.id,
      ocrJobId: a.ocrJobId,
      pageId: a.pageId,
      attemptNumber: a.attemptNumber,
      provider: a.provider,
      model: a.model,
      status: a.status,
      latencyMs: a.latencyMs,
      estimatedCost: a.estimatedCost,
      currency: a.currency,
      costStatus: a.costStatus ?? 'unavailable',
      errorCategory: a.errorCategory,
      warningCodes: (a.warningCodes as OcrProviderWarningCode[]) ?? [],
      occurredAt: a.occurredAt.toISO()!,
    }
  }
}
