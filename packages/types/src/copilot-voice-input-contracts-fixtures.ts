/**
 * v3-copilot-voice-input —— 音频输入契约 fixtures。
 *
 * 覆盖五态：授权未开、正常受理、类型不支持、隐私拒绝、转写失败。
 * 用于测试，不进生产代码。
 */

import type {
  CopilotVoiceAttachmentReference,
  CopilotVoiceProcessingResult,
  CopilotVoiceTurnSummary,
  CopilotVoiceRejectionReason,
  CopilotVoiceTranscriptionResult,
} from './copilot-voice-input-contracts.js'

// ===========================================================================
// 音频附件引用 fixtures
// ===========================================================================

/** MP3 音频附件引用（已受理）。 */
export function buildMp3AttachmentRef(
  overrides?: Partial<CopilotVoiceAttachmentReference>,
): CopilotVoiceAttachmentReference {
  return {
    attachmentId: 2001,
    mimeType: 'audio/mpeg',
    fileName: 'project-weekly-meeting.mp3',
    durationSeconds: 300,
    label: '项目周会录音',
    ...overrides,
  }
}

/** WAV 音频附件引用（已受理）。 */
export function buildWavAttachmentRef(
  overrides?: Partial<CopilotVoiceAttachmentReference>,
): CopilotVoiceAttachmentReference {
  return {
    attachmentId: 2002,
    mimeType: 'audio/wav',
    fileName: 'sprint-retro.wav',
    durationSeconds: 600,
    label: 'Sprint 回顾会',
    ...overrides,
  }
}

/** WebM 音频附件引用。 */
export function buildWebmAttachmentRef(
  overrides?: Partial<CopilotVoiceAttachmentReference>,
): CopilotVoiceAttachmentReference {
  return {
    attachmentId: 2003,
    mimeType: 'audio/webm',
    fileName: 'daily-standup.webm',
    durationSeconds: 120,
    label: '每日站会',
    ...overrides,
  }
}

/** 不支持的音频类型（video/mp4 不是音频）。 */
export function buildUnsupportedAudioRef(): CopilotVoiceAttachmentReference {
  return {
    attachmentId: 2004,
    mimeType: 'video/mp4' as any,
    fileName: 'meeting-recording.mp4',
  }
}

/** 伪造的音频引用（无效形状）。 */
export function buildForgedVoiceRef(): Record<string, unknown> {
  return { attachmentId: -1, mimeType: '', fileName: '' }
}

// ===========================================================================
// 转写结果 fixtures
// ===========================================================================

/** 转写作业已受理。 */
export function buildPendingTranscriptionResult(
  jobId: number = 3001,
): CopilotVoiceTranscriptionResult {
  return {
    jobId,
    status: 'pending',
  }
}

/** 转写作业处理中。 */
export function buildProcessingTranscriptionResult(
  jobId: number = 3002,
): CopilotVoiceTranscriptionResult {
  return {
    jobId,
    status: 'processing',
  }
}

/** 转写作业完成。 */
export function buildCompletedTranscriptionResult(
  jobId: number = 3003,
): CopilotVoiceTranscriptionResult {
  return {
    jobId,
    status: 'completed',
    boundedSummary: '讨论了 Q3 项目计划，确定了三个关键里程碑和负责人分配。',
    candidateCount: 4,
  }
}

/** 转写作业失败。 */
export function buildFailedTranscriptionResult(
  jobId: number = 3004,
): CopilotVoiceTranscriptionResult {
  return {
    jobId,
    status: 'failed',
  }
}

// ===========================================================================
// 处理结果 fixtures
// ===========================================================================

/** 已受理（等待转写）。 */
export function buildVoicePendingResult(jobId: number = 3001): CopilotVoiceProcessingResult {
  return { status: 'pending', jobId }
}

/** 被拒绝（各原因）。 */
export function buildVoiceRejectedResult(
  reason: CopilotVoiceRejectionReason = 'authorization_not_enabled',
): CopilotVoiceProcessingResult {
  return { status: 'rejected', rejectionReason: reason }
}

// ===========================================================================
// 回合响应音频摘要 fixtures
// ===========================================================================

/** 无音频的回合。 */
export function buildNoVoiceSummary(): undefined {
  return undefined
}

/** 单音频已受理的摘要。 */
export function buildSingleVoiceSummary(
  overrides?: Partial<CopilotVoiceTurnSummary>,
): CopilotVoiceTurnSummary {
  return {
    totalCount: 1,
    acceptedCount: 1,
    rejectedCount: 0,
    results: [buildVoicePendingResult()],
    ...overrides,
  }
}

/** 多音频混合状态的摘要。 */
export function buildMixedVoiceSummary(): CopilotVoiceTurnSummary {
  return {
    totalCount: 3,
    acceptedCount: 2,
    rejectedCount: 1,
    results: [
      buildVoicePendingResult(3001),
      buildVoicePendingResult(3002),
      buildVoiceRejectedResult('privacy_rejected'),
    ],
  }
}

/** 全部被拒的摘要。 */
export function buildAllRejectedVoiceSummary(): CopilotVoiceTurnSummary {
  return {
    totalCount: 2,
    acceptedCount: 0,
    rejectedCount: 2,
    results: [
      buildVoiceRejectedResult('authorization_not_enabled'),
      buildVoiceRejectedResult('budget_rejected'),
    ],
  }
}

// ===========================================================================
// 敏感样本（用于禁存约束负例测试）
// ===========================================================================

/** 转写全文样本（不应出现在任何契约字段中）。 */
export const SENSITIVE_TRANSCRIPT_SAMPLES = [
  '这是一段语音转写出的原始文本内容，包含会议讨论的完整记录',
  '张三说：我觉得这个方案可以，但是需要调整时间线',
  '密码是 admin123，大家记一下',
  'API Key: sk-transcript-abcdef123456',
]

/** 模型输出样本（不应出现在任何契约字段中）。 */
export const SENSITIVE_MODEL_OUTPUT_SAMPLES = [
  'System: You are a helpful meeting assistant',
  '请分析以下会议录音的内容',
]
