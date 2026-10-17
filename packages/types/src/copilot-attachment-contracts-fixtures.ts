/**
 * v3-copilot-attachment-and-ocr-input —— 附件引用契约 fixtures。
 *
 * 覆盖七态：图片受理、PDF 受理、类型不支持、预算拒绝、限流拒绝、隐私拒绝、伪造引用。
 * 用于测试，不进生产代码。
 */

import type {
  CopilotAttachmentReference,
  CopilotAttachmentProcessingResult,
  CopilotAttachmentTurnSummary,
  CopilotAttachmentRejectionReason,
} from './copilot-attachment-contracts.js'

// ===========================================================================
// 附件引用 fixtures
// ===========================================================================

/** 图片附件引用（已受理）。 */
export function buildImageAttachmentRef(
  overrides?: Partial<CopilotAttachmentReference>,
): CopilotAttachmentReference {
  return {
    attachmentId: 1001,
    mimeType: 'image/png',
    fileName: 'meeting-whiteboard.png',
    label: '会议白板照片',
    ...overrides,
  }
}

/** PDF 附件引用（已受理）。 */
export function buildPdfAttachmentRef(
  overrides?: Partial<CopilotAttachmentReference>,
): CopilotAttachmentReference {
  return {
    attachmentId: 1002,
    mimeType: 'application/pdf',
    fileName: 'requirements-v2.pdf',
    label: '甲方需求文档',
    ...overrides,
  }
}

/** 伪造的附件引用（无效形状）。 */
export function buildForgedAttachmentRef(): Record<string, unknown> {
  return { attachmentId: -1, mimeType: '', fileName: '' }
}

/** 跨组织附件引用（有效形状，但组织归属不同）。 */
export function buildCrossOrgAttachmentRef(): CopilotAttachmentReference {
  return {
    attachmentId: 9999,
    mimeType: 'image/jpeg',
    fileName: 'other-org-photo.jpg',
    label: '其他组织的照片',
  }
}

// ===========================================================================
// 处理结果 fixtures
// ===========================================================================

/** 已受理（等待识别）。 */
export function buildPendingResult(): CopilotAttachmentProcessingResult {
  return { status: 'pending' }
}

/** 已识别完成（知识候选去处）。 */
export function buildRecognizedKnowledgeCandidateResult(
  candidateCount: number = 3,
  jobId: number = 5001,
): CopilotAttachmentProcessingResult {
  return {
    status: 'recognized',
    destination: 'knowledge_candidate',
    candidateCount,
    jobId,
  }
}

/** 已识别完成（草案层去处）。 */
export function buildRecognizedDraftLayerResult(
  candidateCount: number = 2,
  jobId: number = 5002,
): CopilotAttachmentProcessingResult {
  return {
    status: 'recognized',
    destination: 'draft_layer',
    candidateCount,
    jobId,
  }
}

/** 被拒绝（各原因）。 */
export function buildRejectedResult(
  reason: CopilotAttachmentRejectionReason = 'type_not_supported',
): CopilotAttachmentProcessingResult {
  return { status: 'rejected', rejectionReason: reason }
}

// ===========================================================================
// 回合响应附件摘要 fixtures
// ===========================================================================

/** 无附件的回合（undefined attachmentSummary）。 */
export function buildNoAttachmentSummary(): undefined {
  return undefined
}

/** 单附件已识别的摘要。 */
export function buildSingleAttachmentSummary(
  overrides?: Partial<CopilotAttachmentTurnSummary>,
): CopilotAttachmentTurnSummary {
  return {
    totalCount: 1,
    recognizedCount: 1,
    rejectedCount: 0,
    results: [buildRecognizedKnowledgeCandidateResult()],
    ...overrides,
  }
}

/** 多附件混合状态的摘要。 */
export function buildMixedAttachmentSummary(): CopilotAttachmentTurnSummary {
  return {
    totalCount: 3,
    recognizedCount: 2,
    rejectedCount: 1,
    results: [
      buildRecognizedKnowledgeCandidateResult(3, 5001),
      buildRecognizedDraftLayerResult(1, 5002),
      buildRejectedResult('privacy_rejected'),
    ],
  }
}

/** 全部被拒的摘要。 */
export function buildAllRejectedSummary(): CopilotAttachmentTurnSummary {
  return {
    totalCount: 2,
    recognizedCount: 0,
    rejectedCount: 2,
    results: [buildRejectedResult('budget_rejected'), buildRejectedResult('rate_limit_rejected')],
  }
}

// ===========================================================================
// 敏感样本（用于禁存约束负例测试）
// ===========================================================================

/** OCR 原文样本（不应出现在任何契约字段中）。 */
export const SENSITIVE_OCR_SAMPLES = [
  '这是一段OCR识别出的原始文本',
  '会议纪要：2024年Q3营收目标上调至5000万',
  '密码：P@ssw0rd123',
  'API Key: sk-1234567890abcdef',
]

/** Prompt 样本（不应出现在任何契约字段中）。 */
export const SENSITIVE_PROMPT_SAMPLES = [
  '请分析以下文档的内容',
  'System: You are a helpful assistant',
]
