import ApiException, {
  PermissionDeniedException,
  ResourceNotFoundException,
} from '#exceptions/api_exception'
import AiModelCatalogService from '#services/ai_model_catalog_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import { parseOcrImagePayload } from './payload.ts'
import {
  OCR_PREVIEW_CONTRACT_VERSION,
  OCR_PREVIEW_DEFAULT_TIMEOUT_MS,
  normalizeOcrPromptHint,
  type OcrPreviewRequest,
  type OcrPreviewResult,
} from '@aiproj/types'

export default class OcrPreviewService {
  readonly #catalog = new AiModelCatalogService()

  async preview(input: OcrPreviewRequest, organizationId: number): Promise<OcrPreviewResult> {
    if (!organizationId) throw new PermissionDeniedException('缺少组织上下文')
    const image = parseOcrImagePayload(input.image?.dataUrl)
    const resolved = await resolveAdapter({
      connectionId: input.connectionId,
      modelId: input.modelId,
      organizationId,
      requiredCapabilities: ['ocr', 'vision'],
    })

    if (resolved.unavailable || resolved.source !== 'user') {
      throw new ResourceNotFoundException('OCR 模型不可用或不具备 OCR 能力')
    }

    const estimatedTokens = Math.max(1, Math.ceil(image.sizeBytes / 1024))
    if (resolved.throttle) await resolved.throttle(estimatedTokens)

    const startedAt = performance.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), OCR_PREVIEW_DEFAULT_TIMEOUT_MS)
    const providerResult = await resolved.gateway
      .ocrPreview({
        imageDataUrl: image.dataUrl,
        promptHint: normalizeOcrPromptHint(input.promptHint),
        signal: controller.signal,
      })
      .finally(() => clearTimeout(timeout))
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt))

    await this.#recordUsageSafe({
      organizationId,
      connectionId: resolved.connectionId ?? null,
      connectionModelId: resolved.modelId ?? null,
      provider: resolved.provider,
      model: resolved.model,
      catalogProviderId: resolved.catalogProviderId ?? null,
      catalogModelId: resolved.catalogModelId ?? null,
      pricingSnapshotId: resolved.pricingSnapshotId ?? null,
      usage: providerResult.usage
        ? {
            inputTokens: providerResult.usage.inputTokens,
            outputTokens: providerResult.usage.outputTokens,
            totalTokens: providerResult.usage.totalTokens,
          }
        : null,
      contextLimits: resolved.contextLimits ?? null,
      latencyMs,
      errorCategory: providerResult.ok ? 'none' : (providerResult.errorKind ?? 'AI_SERVICE_ERROR'),
    })

    if (!providerResult.ok || !providerResult.extractedText) {
      throw new ApiException(providerResult.errorMessage ?? 'OCR 供应商调用失败', {
        status: providerResult.errorKind === 'AUTH_REQUIRED' ? 401 : 502,
        code: providerResult.errorKind ?? 'AI_SERVICE_ERROR',
      })
    }

    return {
      contractVersion: OCR_PREVIEW_CONTRACT_VERSION,
      status: 'succeeded',
      extractedText: providerResult.extractedText,
      image: {
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
      },
      provider: {
        provider: resolved.provider,
        model: resolved.model,
        latencyMs,
        usage: providerResult.usage,
        usingRealAdapter: resolved.usingRealAdapter,
      },
      warnings: [],
    }
  }

  async #recordUsageSafe(input: Parameters<AiModelCatalogService['recordUsageSnapshot']>[0]) {
    try {
      await this.#catalog.recordUsageSnapshot(input)
    } catch {
      // Usage snapshot must never expose or block the OCR result path.
    }
  }
}
