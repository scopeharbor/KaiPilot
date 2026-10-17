import { describe, expect, it } from 'vitest'
import {
  OCR_PREVIEW_MAX_IMAGE_BYTES,
  OCR_PREVIEW_MAX_PROMPT_CHARS,
  OCR_SUPPORTED_IMAGE_MIME_TYPES,
  modelHasOcrCapability,
  normalizeOcrPromptHint,
  ocrMetadataContainsSensitiveFields,
  validateOcrDataUrl,
} from './ai-ocr.js'

describe('third-party OCR shared contract', () => {
  it('declares bounded supported image MIME types', () => {
    expect(OCR_SUPPORTED_IMAGE_MIME_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp'])
    expect(OCR_PREVIEW_MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024)
  })

  it('detects OCR-capable model capabilities', () => {
    expect(modelHasOcrCapability(['chat', 'structured_output'])).toBe(false)
    expect(modelHasOcrCapability(['vision'])).toBe(true)
    expect(modelHasOcrCapability(['ocr', 'vision'])).toBe(true)
  })

  it('validates safe data URLs without decoding image content', () => {
    const result = validateOcrDataUrl('data:image/png;base64,SGVsbG8=')

    expect(result).toEqual({
      ok: true,
      mimeType: 'image/png',
      sizeBytes: 5,
    })
  })

  it('rejects malformed, unsupported, missing, and oversized data URLs', () => {
    expect(validateOcrDataUrl(null).reason).toBe('missing')
    expect(validateOcrDataUrl('not-a-data-url').reason).toBe('malformed')
    expect(validateOcrDataUrl('data:text/plain;base64,SGVsbG8=').reason).toBe('unsupported_mime')
    expect(validateOcrDataUrl('data:image/png;base64,AAAA', 2)).toMatchObject({
      ok: false,
      reason: 'oversize',
      mimeType: 'image/png',
      sizeBytes: 3,
    })
  })

  it('normalizes prompt hints to a bounded optional string', () => {
    expect(normalizeOcrPromptHint('  只读中文  ')).toBe('只读中文')
    expect(normalizeOcrPromptHint('   ')).toBeNull()
    expect(normalizeOcrPromptHint('x'.repeat(OCR_PREVIEW_MAX_PROMPT_CHARS + 10))).toHaveLength(
      OCR_PREVIEW_MAX_PROMPT_CHARS,
    )
  })

  it('flags sensitive OCR metadata fields', () => {
    expect(
      ocrMetadataContainsSensitiveFields({
        provider: 'SiliconFlow',
        model: 'PaddlePaddle/PaddleOCR-VL-1.5',
        latencyMs: 64504,
      }).found,
    ).toBe(false)
    expect(ocrMetadataContainsSensitiveFields({ nested: { apiKey: 'secret' } })).toEqual({
      found: true,
      fieldPath: 'nested.apiKey',
    })
    expect(ocrMetadataContainsSensitiveFields({ request: { imageBase64: 'abc' } })).toEqual({
      found: true,
      fieldPath: 'request.imageBase64',
    })
  })
})
