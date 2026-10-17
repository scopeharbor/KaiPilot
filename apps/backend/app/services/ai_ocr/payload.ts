import {
  OCR_PREVIEW_MAX_IMAGE_BYTES,
  type OcrSupportedImageMimeType,
  validateOcrDataUrl,
} from '@aiproj/types'
import { ValidationException } from '#exceptions/api_exception'

export interface ParsedOcrImagePayload {
  dataUrl: string
  mimeType: OcrSupportedImageMimeType
  sizeBytes: number
}

export function parseOcrImagePayload(
  dataUrl: string | null | undefined,
  maxBytes = OCR_PREVIEW_MAX_IMAGE_BYTES,
): ParsedOcrImagePayload {
  const validation = validateOcrDataUrl(dataUrl, maxBytes)
  if (!validation.ok || !validation.mimeType || typeof validation.sizeBytes !== 'number') {
    throw new ValidationException('OCR 图片无效', {
      details: { reason: validation.reason ?? 'malformed' },
    })
  }
  return {
    dataUrl: dataUrl!,
    mimeType: validation.mimeType,
    sizeBytes: validation.sizeBytes,
  }
}
