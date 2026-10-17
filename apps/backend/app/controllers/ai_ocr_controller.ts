import OcrPreviewService from '#services/ai_ocr/ocr_preview_service'
import { ocrPreviewValidator } from '#validators/ai_ocr'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { OCR_PREVIEW_CONTRACT_VERSION, type OcrPreviewRequest } from '@aiproj/types'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class AiOcrController {
  constructor(private ocr: OcrPreviewService) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  async preview(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrPreviewValidator)
    const request: OcrPreviewRequest = {
      ...input,
      contractVersion: OCR_PREVIEW_CONTRACT_VERSION,
    }
    const data = await this.ocr.preview(request, this.orgIdOf(ctx))
    return ctx.response.ok({ data })
  }
}
