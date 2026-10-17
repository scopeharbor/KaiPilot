import type { AiModelCapability } from './ai-connection.js'

export const OCR_PREVIEW_CONTRACT_VERSION = '1.0' as const

export const OCR_SUPPORTED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type OcrSupportedImageMimeType = (typeof OCR_SUPPORTED_IMAGE_MIME_TYPES)[number]

export const OCR_PREVIEW_MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const OCR_PREVIEW_MAX_PROMPT_CHARS = 500
export const OCR_PREVIEW_DEFAULT_TIMEOUT_MS = 120_000

export const OCR_PREVIEW_ERROR_KINDS = [
  'VALIDATION_ERROR',
  'AUTH_REQUIRED',
  'PERMISSION_DENIED',
  'RESOURCE_NOT_FOUND',
  'MODEL_CAPABILITY_MISMATCH',
  'MODEL_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_MALFORMED_RESPONSE',
  'AI_SERVICE_ERROR',
] as const
export type OcrPreviewErrorKind = (typeof OCR_PREVIEW_ERROR_KINDS)[number]

export interface OcrPreviewImageInput {
  /** `data:image/png;base64,...`; raw base64 uploads stay backend-internal for now. */
  dataUrl: string
  fileName?: string | null
}

export interface OcrPreviewRequest {
  contractVersion?: typeof OCR_PREVIEW_CONTRACT_VERSION
  connectionId: string | number
  modelId: string | number
  image: OcrPreviewImageInput
  promptHint?: string | null
}

export interface OcrProviderUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface OcrProviderMetadata {
  provider: string
  model: string
  baseUrl?: string | null
  latencyMs: number
  usage?: OcrProviderUsage
  usingRealAdapter: boolean
}

export interface OcrPreviewResult {
  contractVersion: typeof OCR_PREVIEW_CONTRACT_VERSION
  status: 'succeeded'
  extractedText: string
  image: {
    mimeType: OcrSupportedImageMimeType
    sizeBytes: number
  }
  provider: OcrProviderMetadata
  warnings: string[]
}

export interface OcrPreviewFailure {
  contractVersion: typeof OCR_PREVIEW_CONTRACT_VERSION
  status: 'failed'
  errorKind: OcrPreviewErrorKind
  message: string
  provider?: Partial<OcrProviderMetadata>
}

export type OcrPreviewResponse = OcrPreviewResult | OcrPreviewFailure

export interface OcrDataUrlValidationResult {
  ok: boolean
  mimeType?: OcrSupportedImageMimeType
  sizeBytes?: number
  reason?: 'missing' | 'malformed' | 'unsupported_mime' | 'oversize'
}

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i

export function isOcrImageMimeType(
  value: string | null | undefined,
): value is OcrSupportedImageMimeType {
  return OCR_SUPPORTED_IMAGE_MIME_TYPES.includes(value as OcrSupportedImageMimeType)
}

export function isOcrModelCapability(capability: AiModelCapability): boolean {
  return capability === 'ocr' || capability === 'vision'
}

export function modelHasOcrCapability(capabilities: readonly AiModelCapability[]): boolean {
  return capabilities.some(isOcrModelCapability)
}

export function normalizeOcrPromptHint(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, OCR_PREVIEW_MAX_PROMPT_CHARS)
}

export function validateOcrDataUrl(
  dataUrl: string | null | undefined,
  maxBytes = OCR_PREVIEW_MAX_IMAGE_BYTES,
): OcrDataUrlValidationResult {
  if (!dataUrl || typeof dataUrl !== 'string') return { ok: false, reason: 'missing' }
  const match = dataUrl.match(DATA_URL_PATTERN)
  if (!match) return { ok: false, reason: 'malformed' }
  const mimeType = (match[1] ?? '').toLowerCase()
  if (!isOcrImageMimeType(mimeType)) return { ok: false, reason: 'unsupported_mime' }
  const base64 = (match[2] ?? '').replace(/\s/g, '')
  if (!base64 || base64.length % 4 === 1) return { ok: false, reason: 'malformed' }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const sizeBytes = Math.floor((base64.length * 3) / 4) - padding
  if (sizeBytes > maxBytes) return { ok: false, reason: 'oversize', mimeType, sizeBytes }
  return { ok: true, mimeType, sizeBytes }
}

const SENSITIVE_OCR_FIELD_PATTERNS = [
  /api[-_]?key/i,
  /authorization/i,
  /token/i,
  /secret/i,
  /password/i,
  /prompt/i,
  /dataurl/i,
  /base64/i,
  /raw/i,
  /body/i,
  /image/i,
]

export function ocrMetadataContainsSensitiveFields(value: unknown): {
  found: boolean
  fieldPath?: string
} {
  return findSensitiveOcrField(value, [])
}

function findSensitiveOcrField(
  value: unknown,
  path: string[],
): {
  found: boolean
  fieldPath?: string
} {
  if (!value || typeof value !== 'object') return { found: false }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...path, key]
    if (SENSITIVE_OCR_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
      return { found: true, fieldPath: nextPath.join('.') }
    }
    const child = findSensitiveOcrField(nested, nextPath)
    if (child.found) return child
  }
  return { found: false }
}
