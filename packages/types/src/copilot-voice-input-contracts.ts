/**
 * v3-copilot-voice-input —— 音频输入共享契约。
 *
 * 定义 Copilot 回合中音频输入的共享类型、转写结果形状、拒绝原因枚举与禁存约束。
 * 本模块纯类型 + 确定性常量 + helpers，零运行时依赖。
 *
 * 禁存约束：本模块及其产出物不含转写全文、prompt、模型输出、token 与 secret。
 * ASR 错误率高于 OCR，所有行动项一律待确认，不做高置信度自动创建。
 */

// ===========================================================================
// 音频 MIME 类型（3.1）
// ===========================================================================

/** Copilot 附件支持的音频 MIME 类型。 */
export const COPILOT_VOICE_SUPPORTED_MIME_TYPES = [
  'audio/mpeg', // MP3
  'audio/wav', // WAV
  'audio/webm', // WebM (Opus)
  'audio/mp4', // M4A / AAC
  'audio/ogg', // OGG (Opus)
] as const

export type CopilotVoiceSupportedMimeType = (typeof COPILOT_VOICE_SUPPORTED_MIME_TYPES)[number]

/** 检查 MIME 类型是否受音频输入支持。 */
export function isCopilotVoiceSupportedMimeType(mimeType: string): boolean {
  return (COPILOT_VOICE_SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType)
}

// ===========================================================================
// 音频附件引用（3.1 / 2.1）
// ===========================================================================

/** 音频附件引用：客户端提交的结构化引用，指向已上传的音频附件。 */
export interface CopilotVoiceAttachmentReference {
  /** 附件 ID（由既有 FileService.upload 创建）。 */
  readonly attachmentId: number
  /** 附件 MIME 类型。 */
  readonly mimeType: CopilotVoiceSupportedMimeType
  /** 附件文件名。 */
  readonly fileName: string
  /** 音频时长（秒），可选（客户端可从 metadata 提取）。 */
  readonly durationSeconds?: number
  /** 可读标签（如 "项目周会录音"），前端展示用。 */
  readonly label?: string
}

// ===========================================================================
// 转写作业状态（5.3）
// ===========================================================================

/** 转写作业状态枚举。 */
export const COPILOT_VOICE_JOB_STATUSES = [
  'pending', // 已受理，等待转写
  'processing', // 转写中
  'completed', // 转写完成
  'failed', // 转写失败
] as const

export type CopilotVoiceJobStatus = (typeof COPILOT_VOICE_JOB_STATUSES)[number]

// ===========================================================================
// 转写结果形状（2.2）
// ===========================================================================

/**
 * 转写结果：回合响应中返回的低敏摘要。
 *
 * 设计决策（D4）：
 * - 不含转写全文（转写全文只存附件引用与有界摘要）
 * - 包含作业 ID、状态、有界摘要、候选行动项计数
 */
export interface CopilotVoiceTranscriptionResult {
  /** 转写作业 ID（供前端轮询或广播使用）。 */
  readonly jobId: number
  /** 作业状态。 */
  readonly status: CopilotVoiceJobStatus
  /**
   * 有界摘要：转写内容的简短概括（≤200 字符）。
   * 不含转写全文。
   */
  readonly boundedSummary?: string
  /** 识别出的候选行动项数量（仅 completed 状态）。 */
  readonly candidateCount?: number
}

// ===========================================================================
// 拒绝原因枚举（2.3）
// ===========================================================================

/** 音频输入拒绝原因：每种失败都有可读原因，不静默降级。 */
export const COPILOT_VOICE_REJECTION_REASONS = [
  'type_not_supported', // 文件类型不支持
  'size_exceeded', // 文件大小超限
  'authorization_not_enabled', // 授权门未开
  'budget_rejected', // 预算守卫拒绝
  'rate_limit_rejected', // 限流守卫拒绝
  'privacy_rejected', // 隐私分类拒绝
  'transcription_failed', // 转写失败
  'reference_forged', // 伪造引用
  'reference_cross_org', // 跨组织引用
  'review_unavailable', // 复核不可用
] as const

export type CopilotVoiceRejectionReason = (typeof COPILOT_VOICE_REJECTION_REASONS)[number]

/** 拒绝原因的中文可读映射。 */
export const COPILOT_VOICE_REJECTION_MESSAGES: Record<CopilotVoiceRejectionReason, string> = {
  type_not_supported: '音频文件类型不支持',
  size_exceeded: '音频文件大小超过限制',
  authorization_not_enabled: '语音转写功能未启用',
  budget_rejected: '语音转写预算不足',
  rate_limit_rejected: '语音转写请求过于频繁',
  privacy_rejected: '音频内容触发隐私策略',
  transcription_failed: '语音转写失败',
  reference_forged: '音频引用无效',
  reference_cross_org: '无权访问该音频',
  review_unavailable: '音频权限判定暂不可用',
}

// ===========================================================================
// 会话消息中的音频摘要（7.1 / 7.3）
// ===========================================================================

/**
 * 会话消息中音频处理的低敏摘要。
 *
 * 设计决策（D4）：
 * - 转写全文不进会话消息，只存附件引用与有界摘要
 * - 回合响应正文不含转写全文
 */
export interface CopilotVoiceTurnSummary {
  /** 音频附件总数。 */
  readonly totalCount: number
  /** 已受理数（成功提交转写作业）。 */
  readonly acceptedCount: number
  /** 被拒数（只返回计数，不返回被拒音频的存在与名称）。 */
  readonly rejectedCount: number
  /** 各音频的处理结果（按提交顺序）。 */
  readonly results: readonly CopilotVoiceProcessingResult[]
}

/** 单个音频的处理结果。 */
export interface CopilotVoiceProcessingResult {
  readonly status: 'pending' | 'rejected'
  /** 转写作业 ID（仅 pending 状态）。 */
  readonly jobId?: number
  /** 拒绝原因（仅 rejected 状态）。 */
  readonly rejectionReason?: CopilotVoiceRejectionReason
}

// ===========================================================================
// 禁存约束（2.4）
// ===========================================================================

/**
 * 音频契约禁存的键名类别。命中即视为不合规。
 * 与附件契约的禁存键同源纪律，额外禁止转写全文相关键。
 */
export const COPILOT_VOICE_FORBIDDEN_KEYS = [
  ...[
    'prompt',
    'prompts',
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
  ],
  // 音频/转写特有禁存键
  'transcript',
  'transcription',
  'transcribedText',
  'transcribed_text',
  'rawTranscript',
  'raw_transcript',
  'speakerId',
  'speaker_id',
  'diarization',
  'speakerLabels',
  'speaker_labels',
] as const

/**
 * 低敏校验：序列化后检查禁存键名与敏感样本。
 * 任一命中即不合规（2.5 负例测试用）。
 */
export function containsForbiddenVoicePayload(
  payload: unknown,
  sensitiveSamples: readonly string[] = [],
): boolean {
  const serialized = JSON.stringify(payload ?? null)
  for (const key of COPILOT_VOICE_FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key}":`)) return true
  }
  for (const sample of sensitiveSamples) {
    if (sample.length > 0 && serialized.includes(sample)) return true
  }
  return false
}

// ===========================================================================
// 隐私告知（4.5）
// ===========================================================================

/** 隐私告知文案：明确列出三件事。 */
export const COPILOT_VOICE_PRIVACY_NOTICE =
  '您即将上传的音频将被发送至外部语音识别服务进行转写，转写结果将按当前会话保留策略保存。请确认继续。' as const

// ===========================================================================
// 授权门（3.6）
// ===========================================================================

/** 组织级 ASR 授权开关的配置键。 */
export const COPILOT_VOICE_AUTHORIZATION_KEY = 'copilot_voice_recognition' as const

/** 组织级 ASR 授权开关的 RBAC 权限。 */
export const COPILOT_VOICE_AUTHORIZATION_PERMISSION = 'ai:voice_recognition:manage' as const

// ===========================================================================
// Provenance（6.5）
// ===========================================================================

/**
 * 候选行动项的来源溯源：可追溯到音频与其时间片段。
 */
export interface CopilotVoiceCandidateProvenance {
  /** 音频附件 ID。 */
  readonly attachmentId: number
  /** 音频文件名（低敏，只用于展示）。 */
  readonly fileName: string
  /** 时间片段起始（秒）。 */
  readonly startOffsetSeconds: number
  /** 时间片段结束（秒）。 */
  readonly endOffsetSeconds: number
  /** 转写作业 ID。 */
  readonly jobId: number
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/** 音频附件引用形状校验。 */
export function validateVoiceAttachmentReference(ref: unknown): {
  valid: boolean
  reason?: CopilotVoiceRejectionReason
} {
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
  if (typeof obj.mimeType !== 'string' || !isCopilotVoiceSupportedMimeType(obj.mimeType)) {
    return { valid: false, reason: 'type_not_supported' }
  }
  if (typeof obj.fileName !== 'string' || obj.fileName.length === 0) {
    return { valid: false, reason: 'reference_forged' }
  }
  return { valid: true }
}
