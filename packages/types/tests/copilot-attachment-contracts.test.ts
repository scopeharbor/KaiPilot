/**
 * v3-copilot-attachment-and-ocr-input —— 附件引用契约测试。
 *
 * 覆盖：
 * - 2.5 禁存约束：契约不含 OCR 原文、prompt、模型输出、token 与 secret
 * - 2.6 负例测试：敏感样本不出现在任一契约字段
 * - 2.7 fixtures 覆盖七态
 * - 形状校验：引用数上界、伪造引用拒绝
 */

import { describe, it, expect } from 'vitest'
import {
  containsForbiddenAttachmentPayload,
  validateAttachmentReference,
  validateAttachmentReferences,
  COPILOT_TURN_MAX_ATTACHMENT_REFS,
  COPILOT_ATTACHMENT_FORBIDDEN_KEYS,
  COPILOT_ATTACHMENT_REJECTION_REASONS,
  COPILOT_ATTACHMENT_STATUSES,
  COPILOT_ATTACHMENT_DESTINATIONS,
  type CopilotAttachmentReference,
  type CopilotAttachmentTurnSummary,
} from '../src/copilot-attachment-contracts.js'
import {
  buildImageAttachmentRef,
  buildPdfAttachmentRef,
  buildForgedAttachmentRef,
  buildPendingResult,
  buildRecognizedKnowledgeCandidateResult,
  buildRejectedResult,
  buildSingleAttachmentSummary,
  buildMixedAttachmentSummary,
  buildAllRejectedSummary,
  SENSITIVE_OCR_SAMPLES,
  SENSITIVE_PROMPT_SAMPLES,
} from '../src/copilot-attachment-contracts-fixtures.js'

describe('copilot-attachment-contracts', () => {
  // =========================================================================
  // 2.5 / 2.6 禁存约束
  // =========================================================================

  describe('禁存约束 (2.5 / 2.6)', () => {
    it('附件引用契约不含禁存键名', () => {
      const ref = buildImageAttachmentRef()
      expect(containsForbiddenAttachmentPayload(ref)).toBe(false)
    })

    it('处理结果契约不含禁存键名', () => {
      const result = buildRecognizedKnowledgeCandidateResult()
      expect(containsForbiddenAttachmentPayload(result)).toBe(false)
    })

    it('回合摘要契约不含禁存键名', () => {
      const summary = buildMixedAttachmentSummary()
      expect(containsForbiddenAttachmentPayload(summary)).toBe(false)
    })

    it('OCR 原文样本不出现在附件引用中', () => {
      const ref = buildImageAttachmentRef()
      expect(containsForbiddenAttachmentPayload(ref, SENSITIVE_OCR_SAMPLES)).toBe(false)
    })

    it('OCR 原文样本不出现在处理结果中', () => {
      const result = buildRecognizedKnowledgeCandidateResult()
      expect(containsForbiddenAttachmentPayload(result, SENSITIVE_OCR_SAMPLES)).toBe(false)
    })

    it('OCR 原文样本不出现在回合摘要中', () => {
      const summary = buildMixedAttachmentSummary()
      expect(containsForbiddenAttachmentPayload(summary, SENSITIVE_OCR_SAMPLES)).toBe(false)
    })

    it('Prompt 样本不出现在任何契约字段中', () => {
      const ref = buildImageAttachmentRef()
      const result = buildRecognizedKnowledgeCandidateResult()
      const summary = buildSingleAttachmentSummary()
      expect(containsForbiddenAttachmentPayload(ref, SENSITIVE_PROMPT_SAMPLES)).toBe(false)
      expect(containsForbiddenAttachmentPayload(result, SENSITIVE_PROMPT_SAMPLES)).toBe(false)
      expect(containsForbiddenAttachmentPayload(summary, SENSITIVE_PROMPT_SAMPLES)).toBe(false)
    })

    it('禁存键名列表覆盖所有约定的敏感类别', () => {
      expect(COPILOT_ATTACHMENT_FORBIDDEN_KEYS).toContain('prompt')
      expect(COPILOT_ATTACHMENT_FORBIDDEN_KEYS).toContain('rawText')
      expect(COPILOT_ATTACHMENT_FORBIDDEN_KEYS).toContain('ocrText')
      expect(COPILOT_ATTACHMENT_FORBIDDEN_KEYS).toContain('modelOutput')
      expect(COPILOT_ATTACHMENT_FORBIDDEN_KEYS).toContain('token')
      expect(COPILOT_ATTACHMENT_FORBIDDEN_KEYS).toContain('secret')
      expect(COPILOT_ATTACHMENT_FORBIDDEN_KEYS).toContain('apiKey')
    })

    it('伪造的包含禁存键的载荷被检测', () => {
      const forged = { prompt: 'test', attachmentId: 1 }
      expect(containsForbiddenAttachmentPayload(forged)).toBe(true)
    })

    it('伪造的包含 OCR 原文的载荷被检测', () => {
      const forged = { rawText: '这是一段OCR识别出的原始文本', attachmentId: 1 }
      expect(containsForbiddenAttachmentPayload(forged, SENSITIVE_OCR_SAMPLES)).toBe(true)
    })
  })

  // =========================================================================
  // 2.7 fixtures 七态覆盖
  // =========================================================================

  describe('fixtures 七态覆盖 (2.7)', () => {
    it('图片受理引用形状合规', () => {
      const ref = buildImageAttachmentRef()
      expect(ref.attachmentId).toBeGreaterThan(0)
      expect(ref.mimeType).toBe('image/png')
      expect(ref.fileName).toBeTruthy()
    })

    it('PDF 受理引用形状合规', () => {
      const ref = buildPdfAttachmentRef()
      expect(ref.attachmentId).toBeGreaterThan(0)
      expect(ref.mimeType).toBe('application/pdf')
      expect(ref.fileName).toBeTruthy()
    })

    it('伪造引用被形状校验拒绝', () => {
      const forged = buildForgedAttachmentRef()
      const result = validateAttachmentReference(forged)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('reference_forged')
    })

    it('已受理处理结果形状合规', () => {
      const result = buildPendingResult()
      expect(result.status).toBe('pending')
    })

    it('已识别（知识候选）处理结果形状合规', () => {
      const result = buildRecognizedKnowledgeCandidateResult(3, 5001)
      expect(result.status).toBe('recognized')
      expect(result.destination).toBe('knowledge_candidate')
      expect(result.candidateCount).toBe(3)
      expect(result.jobId).toBe(5001)
    })

    it('被拒处理结果形状合规', () => {
      const result = buildRejectedResult('budget_rejected')
      expect(result.status).toBe('rejected')
    })

    it('混合摘要覆盖多态', () => {
      const summary = buildMixedAttachmentSummary()
      expect(summary.totalCount).toBe(3)
      expect(summary.recognizedCount).toBe(2)
      expect(summary.rejectedCount).toBe(1)
      expect(summary.results).toHaveLength(3)
    })
  })

  // =========================================================================
  // 形状校验
  // =========================================================================

  describe('形状校验', () => {
    it('有效引用通过校验', () => {
      const ref = buildImageAttachmentRef()
      const result = validateAttachmentReference(ref)
      expect(result.valid).toBe(true)
    })

    it('null 引用被拒绝', () => {
      const result = validateAttachmentReference(null)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('reference_forged')
    })

    it('缺少 attachmentId 被拒绝', () => {
      const result = validateAttachmentReference({ mimeType: 'image/png', fileName: 'test.png' })
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('reference_forged')
    })

    it('负数 attachmentId 被拒绝', () => {
      const result = validateAttachmentReference({
        attachmentId: -1,
        mimeType: 'image/png',
        fileName: 'test.png',
      })
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('reference_forged')
    })

    it('空 mimeType 被拒绝', () => {
      const result = validateAttachmentReference({
        attachmentId: 1,
        mimeType: '',
        fileName: 'test.png',
      })
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('reference_forged')
    })

    it('空 fileName 被拒绝', () => {
      const result = validateAttachmentReference({
        attachmentId: 1,
        mimeType: 'image/png',
        fileName: '',
      })
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('reference_forged')
    })

    it('超出上界的引用列表全部拒绝', () => {
      const refs = Array.from({ length: COPILOT_TURN_MAX_ATTACHMENT_REFS + 1 }, (_, i) =>
        buildImageAttachmentRef({ attachmentId: i + 1 }),
      )
      const { valid, rejected } = validateAttachmentReferences(refs)
      expect(valid).toHaveLength(0)
      expect(rejected).toHaveLength(COPILOT_TURN_MAX_ATTACHMENT_REFS + 1)
    })

    it('空引用列表返回空结果', () => {
      const { valid, rejected } = validateAttachmentReferences([])
      expect(valid).toHaveLength(0)
      expect(rejected).toHaveLength(0)
    })
  })

  // =========================================================================
  // 枚举完整性
  // =========================================================================

  describe('枚举完整性', () => {
    it('所有处理状态都有定义', () => {
      expect(COPILOT_ATTACHMENT_STATUSES).toContain('pending')
      expect(COPILOT_ATTACHMENT_STATUSES).toContain('recognized')
      expect(COPILOT_ATTACHMENT_STATUSES).toContain('rejected')
    })

    it('所有去处都有定义', () => {
      expect(COPILOT_ATTACHMENT_DESTINATIONS).toContain('knowledge_candidate')
      expect(COPILOT_ATTACHMENT_DESTINATIONS).toContain('draft_layer')
    })

    it('所有拒绝原因都有定义', () => {
      expect(COPILOT_ATTACHMENT_REJECTION_REASONS).toContain('type_not_supported')
      expect(COPILOT_ATTACHMENT_REJECTION_REASONS).toContain('size_exceeded')
      expect(COPILOT_ATTACHMENT_REJECTION_REASONS).toContain('upload_failed')
      expect(COPILOT_ATTACHMENT_REJECTION_REASONS).toContain('budget_rejected')
      expect(COPILOT_ATTACHMENT_REJECTION_REASONS).toContain('rate_limit_rejected')
      expect(COPILOT_ATTACHMENT_REJECTION_REASONS).toContain('privacy_rejected')
      expect(COPILOT_ATTACHMENT_REJECTION_REASONS).toContain('recognition_failed')
      expect(COPILOT_ATTACHMENT_REJECTION_REASONS).toContain('reference_forged')
      expect(COPILOT_ATTACHMENT_REJECTION_REASONS).toContain('reference_cross_org')
      expect(COPILOT_ATTACHMENT_REJECTION_REASONS).toContain('review_unavailable')
    })
  })
})
