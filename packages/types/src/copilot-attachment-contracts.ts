/**
 * v3-copilot-attachment-and-ocr-input —— 附件引用契约。
 *
 * 定义 Copilot 回合中附件引用的共享类型、处理状态、去处枚举与拒绝原因。
 * 本模块纯类型 + 确定性常量 + helpers，零运行时依赖。
 *
 * 禁存约束：本模块及其产出物不含 OCR 原文、prompt、模型输出、token 与 secret。
 */

// ===========================================================================
// 附件引用类型（2.1）
// ===========================================================================

/** 附件引用：客户端提交的结构化引用，指向已上传的附件。 */
export interface CopilotAttachmentReference {
  /** 附件 ID（由既有 FileService.upload 创建）。 */
  readonly attachmentId: number
  /** 附件 MIME 类型（冗余携带，便于前端展示，不参与服务端判定）。 */
  readonly mimeType: string
  /** 附件文件名（冗余携带，便于前端展示，不参与服务端判定）。 */
  readonly fileName: string
  /** 可读标签（如 "会议白板照片"），前端展示用。 */
  readonly label?: string
}

/** 附件引用是否合规的校验结果。 */
export interface CopilotAttachmentRefValidation {
  readonly valid: boolean
  readonly reason?: CopilotAttachmentRejectionReason
}

// ===========================================================================
// 附件处理状态枚举（2.3）
// ===========================================================================

/** 附件处理状态：从提交到最终去处的生命周期。 */
export const COPILOT_ATTACHMENT_STATUSES = [
  'pending', // 已受理，等待处理
  'recognized', // 已识别完成
  'rejected', // 被拒绝（类型不支持/超大小/上传失败/预算/限流/隐私/识别失败）
] as const
export type CopilotAttachmentStatus = (typeof COPILOT_ATTACHMENT_STATUSES)[number]

/** 附件去处：识别结果的唯一两个去处，都需确认。 */
export const COPILOT_ATTACHMENT_DESTINATIONS = [
  'knowledge_candidate', // 知识候选待确认
  'draft_layer', // 草案层待确认
] as const
export type CopilotAttachmentDestination = (typeof COPILOT_ATTACHMENT_DESTINATIONS)[number]

/** 附件处理结果：状态 + 去处（仅 recognized 状态有去处）。 */
export interface CopilotAttachmentProcessingResult {
  readonly status: CopilotAttachmentStatus
  readonly destination?: CopilotAttachmentDestination
  /** 识别出的候选数量（仅 recognized 状态）。 */
  readonly candidateCount?: number
  /** OCR 作业 ID（供前端轮询或广播使用）。 */
  readonly jobId?: number
  /**
   * 拒绝原因（仅 rejected 状态必填）。
   *
   * spec REQ「每类失败都必须给出可读原因」：没有原因的 rejected 等于静默失败，
   * 用户会以为助手看过了附件。
   */
  readonly rejectionReason?: CopilotAttachmentRejectionReason
}

// ===========================================================================
// 拒绝原因枚举（2.4）
// ===========================================================================

/** 附件拒绝原因：每种失败都有可读原因，不静默降级。 */
export const COPILOT_ATTACHMENT_REJECTION_REASONS = [
  'type_not_supported', // 文件类型不支持
  'size_exceeded', // 文件大小超限
  'upload_failed', // 上传失败
  'budget_rejected', // 预算守卫拒绝
  'rate_limit_rejected', // 限流守卫拒绝
  'privacy_rejected', // 隐私分类拒绝
  'recognition_failed', // 识别失败
  'reference_forged', // 伪造引用
  'reference_cross_org', // 跨组织引用
  'review_unavailable', // 复核不可用
] as const
export type CopilotAttachmentRejectionReason = (typeof COPILOT_ATTACHMENT_REJECTION_REASONS)[number]

/** 拒绝原因的中文可读映射。 */
export const COPILOT_ATTACHMENT_REJECTION_MESSAGES: Record<
  CopilotAttachmentRejectionReason,
  string
> = {
  type_not_supported: '文件类型不支持',
  size_exceeded: '文件大小超过限制',
  upload_failed: '文件上传失败',
  budget_rejected: 'OCR 预算不足',
  rate_limit_rejected: 'OCR 请求过于频繁',
  privacy_rejected: '内容触发隐私策略',
  recognition_failed: '文档识别失败',
  reference_forged: '附件引用无效',
  reference_cross_org: '无权访问该附件',
  review_unavailable: '附件权限判定暂不可用',
}

// ===========================================================================
// 回合响应中的附件摘要（2.3 / 7.3）
// ===========================================================================

/** 回合响应中附件处理的低敏摘要：不含 OCR 原文。 */
export interface CopilotAttachmentTurnSummary {
  /** 附件总数。 */
  readonly totalCount: number
  /** 已识别数。 */
  readonly recognizedCount: number
  /** 被拒数（只返回计数，不返回被拒附件的存在与名称）。 */
  readonly rejectedCount: number
  /** 各附件的处理结果（按提交顺序）。 */
  readonly results: readonly CopilotAttachmentProcessingResult[]
}

// ===========================================================================
// 禁存约束（2.5 / 2.6）
// ===========================================================================

/**
 * 附件契约禁存的键名类别。命中即视为不合规。
 * 与回合契约的禁存键同源纪律。
 */
export const COPILOT_ATTACHMENT_FORBIDDEN_KEYS = [
  'prompt',
  'prompts',
  'rawText',
  'raw_text',
  'ocrText',
  'ocr_text',
  'recognizedText',
  'recognized_text',
  'modelOutput',
  'model_output',
  'completion',
  'completions',
  'apiKey',
  'api_key',
  'token',
  'tokens',
  'secret',
  'systemInstructions',
  'system_instructions',
] as const

/**
 * 低敏校验：序列化后检查禁存键名与敏感样本。
 * 任一命中即不合规（2.6 负例测试用）。
 */
export function containsForbiddenAttachmentPayload(
  payload: unknown,
  sensitiveSamples: readonly string[] = [],
): boolean {
  const serialized = JSON.stringify(payload ?? null)
  for (const key of COPILOT_ATTACHMENT_FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key}":`)) return true
  }
  for (const sample of sensitiveSamples) {
    if (sample.length > 0 && serialized.includes(sample)) return true
  }
  return false
}

// ===========================================================================
// 附件引用校验（2.1 / 2.2）
// ===========================================================================

/** 单回合附件引用数上界（复用既有 OCR 批量作业上限）。 */
export const COPILOT_TURN_MAX_ATTACHMENT_REFS = 5

/**
 * 校验附件引用形状。
 * 确定性纯函数：同输入同输出，不依赖时钟与随机源。
 */
export function validateAttachmentReference(ref: unknown): CopilotAttachmentRefValidation {
  if (!ref || typeof ref !== 'object') {
    return { valid: false, reason: 'reference_forged' }
  }
  const obj = ref as Record<string, unknown>
  if (
    typeof obj.attachmentId !== 'number' ||
    !Number.isFinite(obj.attachmentId) ||
    obj.attachmentId <= 0
  ) {
    return { valid: false, reason: 'reference_forged' }
  }
  if (typeof obj.mimeType !== 'string' || obj.mimeType.length === 0) {
    return { valid: false, reason: 'reference_forged' }
  }
  if (typeof obj.fileName !== 'string' || obj.fileName.length === 0) {
    return { valid: false, reason: 'reference_forged' }
  }
  return { valid: true }
}

/**
 * 校验附件引用列表。
 * 返回合规引用与被拒引用（含原因）。
 */
export function validateAttachmentReferences(refs: readonly unknown[]): {
  valid: CopilotAttachmentReference[]
  rejected: Array<{ ref: unknown; reason: CopilotAttachmentRejectionReason }>
} {
  const valid: CopilotAttachmentReference[] = []
  const rejected: Array<{ ref: unknown; reason: CopilotAttachmentRejectionReason }> = []

  if (refs.length > COPILOT_TURN_MAX_ATTACHMENT_REFS) {
    // 超出上界：全部拒绝
    for (const ref of refs) {
      rejected.push({ ref, reason: 'reference_forged' })
    }
    return { valid, rejected }
  }

  for (const ref of refs) {
    const validation = validateAttachmentReference(ref)
    if (validation.valid) {
      valid.push(ref as CopilotAttachmentReference)
    } else {
      rejected.push({ ref, reason: validation.reason! })
    }
  }

  return { valid, rejected }
}

// ===========================================================================
// OCR MIME 类型子集（用于 Copilot 附件）
// ===========================================================================

/** Copilot 附件支持的 MIME 类型（图片 + PDF + 音频）。 */
export const COPILOT_ATTACHMENT_SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  // v3-copilot-voice-input: 音频类型走同一附件通道
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
] as const

/**
 * 检查 MIME 类型是否受 Copilot 附件支持。
 */
export function isCopilotAttachmentSupportedMimeType(mimeType: string): boolean {
  return (COPILOT_ATTACHMENT_SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType)
}
