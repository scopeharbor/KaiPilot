/**
 * v3-copilot-voice-input —— 音频输入契约测试。
 *
 * 覆盖：禁存约束（2.4/2.5）、拒绝原因枚举、转写结果形状、辅助函数。
 */

// vitest 的 include 匹配 src/**/*.test.ts：本文件若从 'node:test' 取 describe/it，
// vitest 收集得到文件却找不到任何 suite，直接报 "No test suite found" 并让整包测试变红
// （断言一条也不执行）。改用 vitest 的 describe/it，断言仍用 node:assert/strict。
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  COPILOT_VOICE_SUPPORTED_MIME_TYPES,
  isCopilotVoiceSupportedMimeType,
  COPILOT_VOICE_REJECTION_REASONS,
  COPILOT_VOICE_REJECTION_MESSAGES,
  COPILOT_VOICE_PRIVACY_NOTICE,
  COPILOT_VOICE_FORBIDDEN_KEYS,
  containsForbiddenVoicePayload,
  validateVoiceAttachmentReference,
  COPILOT_VOICE_JOB_STATUSES,
} from './copilot-voice-input-contracts.js'
import {
  buildMp3AttachmentRef,
  buildWavAttachmentRef,
  buildWebmAttachmentRef,
  buildUnsupportedAudioRef,
  buildForgedVoiceRef,
  buildPendingTranscriptionResult,
  buildCompletedTranscriptionResult,
  buildFailedTranscriptionResult,
  buildVoicePendingResult,
  buildVoiceRejectedResult,
  buildSingleVoiceSummary,
  buildMixedVoiceSummary,
  buildAllRejectedVoiceSummary,
  SENSITIVE_TRANSCRIPT_SAMPLES,
  SENSITIVE_MODEL_OUTPUT_SAMPLES,
} from './copilot-voice-input-contracts-fixtures.js'

describe('CopilotVoiceInputContracts', () => {
  // =========================================================================
  // 2.1 音频 MIME 类型
  // =========================================================================
  describe('Audio MIME types', () => {
    it('supports the five declared audio MIME types', () => {
      assert.equal(COPILOT_VOICE_SUPPORTED_MIME_TYPES.length, 5)
      assert.ok(isCopilotVoiceSupportedMimeType('audio/mpeg'))
      assert.ok(isCopilotVoiceSupportedMimeType('audio/wav'))
      assert.ok(isCopilotVoiceSupportedMimeType('audio/webm'))
      assert.ok(isCopilotVoiceSupportedMimeType('audio/mp4'))
      assert.ok(isCopilotVoiceSupportedMimeType('audio/ogg'))
    })

    it('rejects non-audio MIME types', () => {
      assert.ok(!isCopilotVoiceSupportedMimeType('video/mp4'))
      assert.ok(!isCopilotVoiceSupportedMimeType('image/png'))
      assert.ok(!isCopilotVoiceSupportedMimeType('application/pdf'))
      assert.ok(!isCopilotVoiceSupportedMimeType(''))
    })
  })

  // =========================================================================
  // 2.2 转写结果形状
  // =========================================================================
  describe('Transcription result shape', () => {
    it('pending result has jobId and status only', () => {
      const result = buildPendingTranscriptionResult(3001)
      assert.equal(result.jobId, 3001)
      assert.equal(result.status, 'pending')
      assert.equal(result.boundedSummary, undefined)
      assert.equal(result.candidateCount, undefined)
    })

    it('completed result has boundedSummary and candidateCount', () => {
      const result = buildCompletedTranscriptionResult(3003)
      assert.equal(result.status, 'completed')
      assert.ok(typeof result.boundedSummary === 'string')
      assert.ok(result.boundedSummary!.length <= 200)
      assert.ok(typeof result.candidateCount === 'number')
      assert.ok(result.candidateCount! >= 0)
    })

    it('failed result has no summary or count', () => {
      const result = buildFailedTranscriptionResult(3004)
      assert.equal(result.status, 'failed')
      assert.equal(result.boundedSummary, undefined)
      assert.equal(result.candidateCount, undefined)
    })

    it('job statuses are a closed set of four values', () => {
      assert.equal(COPILOT_VOICE_JOB_STATUSES.length, 4)
      assert.ok(COPILOT_VOICE_JOB_STATUSES.includes('pending'))
      assert.ok(COPILOT_VOICE_JOB_STATUSES.includes('processing'))
      assert.ok(COPILOT_VOICE_JOB_STATUSES.includes('completed'))
      assert.ok(COPILOT_VOICE_JOB_STATUSES.includes('failed'))
    })
  })

  // =========================================================================
  // 2.3 拒绝原因枚举
  // =========================================================================
  describe('Rejection reasons', () => {
    it('has exactly the declared reasons', () => {
      assert.equal(COPILOT_VOICE_REJECTION_REASONS.length, 10)
    })

    it('every reason has a Chinese message', () => {
      for (const reason of COPILOT_VOICE_REJECTION_REASONS) {
        assert.ok(
          typeof COPILOT_VOICE_REJECTION_MESSAGES[reason] === 'string' &&
            COPILOT_VOICE_REJECTION_MESSAGES[reason].length > 0,
          `Missing message for reason: ${reason}`,
        )
      }
    })

    it('includes authorization_not_enabled for the gate', () => {
      assert.ok(COPILOT_VOICE_REJECTION_REASONS.includes('authorization_not_enabled'))
    })
  })

  // =========================================================================
  // 2.4 禁存约束 — 键名检测
  // =========================================================================
  describe('Forbidden keys', () => {
    it('forbids transcript-related keys', () => {
      assert.ok((COPILOT_VOICE_FORBIDDEN_KEYS as readonly string[]).includes('transcript'))
      assert.ok((COPILOT_VOICE_FORBIDDEN_KEYS as readonly string[]).includes('transcription'))
      assert.ok((COPILOT_VOICE_FORBIDDEN_KEYS as readonly string[]).includes('transcribedText'))
      assert.ok((COPILOT_VOICE_FORBIDDEN_KEYS as readonly string[]).includes('rawTranscript'))
    })

    it('forbids speaker-related keys', () => {
      assert.ok((COPILOT_VOICE_FORBIDDEN_KEYS as readonly string[]).includes('speakerId'))
      assert.ok((COPILOT_VOICE_FORBIDDEN_KEYS as readonly string[]).includes('diarization'))
      assert.ok((COPILOT_VOICE_FORBIDDEN_KEYS as readonly string[]).includes('speakerLabels'))
    })

    it('forbids prompt and model output keys', () => {
      assert.ok((COPILOT_VOICE_FORBIDDEN_KEYS as readonly string[]).includes('prompt'))
      assert.ok((COPILOT_VOICE_FORBIDDEN_KEYS as readonly string[]).includes('modelOutput'))
      assert.ok((COPILOT_VOICE_FORBIDDEN_KEYS as readonly string[]).includes('secret'))
    })

    it('detects forbidden keys in nested objects', () => {
      const payload = {
        job: { transcript: 'this should not be here', status: 'completed' },
      }
      assert.ok(containsForbiddenVoicePayload(payload))
    })

    it('passes for clean payloads', () => {
      const payload = {
        jobId: 3001,
        status: 'completed',
        boundedSummary: '讨论了项目计划',
        candidateCount: 3,
      }
      assert.ok(!containsForbiddenVoicePayload(payload))
    })
  })

  // =========================================================================
  // 2.5 禁存约束 — 负例测试（转写全文与敏感样本）
  // =========================================================================
  describe('Forbidden payload detection with sensitive samples', () => {
    it('rejects payloads containing transcript samples', () => {
      for (const sample of SENSITIVE_TRANSCRIPT_SAMPLES) {
        const payload = { boundedSummary: sample }
        assert.ok(
          containsForbiddenVoicePayload(payload, [sample]),
          `Should reject sample: ${sample.slice(0, 30)}...`,
        )
      }
    })

    it('rejects payloads containing model output samples', () => {
      for (const sample of SENSITIVE_MODEL_OUTPUT_SAMPLES) {
        const payload = { note: sample }
        assert.ok(
          containsForbiddenVoicePayload(payload, [sample]),
          `Should reject sample: ${sample.slice(0, 30)}...`,
        )
      }
    })

    it('passes clean summary without sensitive samples', () => {
      const payload = {
        boundedSummary: '讨论了 Q3 项目计划',
        candidateCount: 2,
      }
      assert.ok(!containsForbiddenVoicePayload(payload, SENSITIVE_TRANSCRIPT_SAMPLES))
    })
  })

  // =========================================================================
  // 2.6 Fixtures — 五态覆盖
  // =========================================================================
  describe('Fixtures — five states', () => {
    it('buildPendingTranscriptionResult creates valid pending state', () => {
      const result = buildPendingTranscriptionResult()
      assert.equal(result.status, 'pending')
      assert.ok(typeof result.jobId === 'number')
    })

    it('buildCompletedTranscriptionResult creates valid completed state', () => {
      const result = buildCompletedTranscriptionResult()
      assert.equal(result.status, 'completed')
      assert.ok(result.boundedSummary!.length > 0)
      assert.ok(result.candidateCount! > 0)
    })

    it('buildFailedTranscriptionResult creates valid failed state', () => {
      const result = buildFailedTranscriptionResult()
      assert.equal(result.status, 'failed')
    })

    it('buildVoiceRejectedResult creates rejected state with reason', () => {
      const result = buildVoiceRejectedResult('budget_rejected')
      assert.equal(result.status, 'rejected')
      assert.equal(result.rejectionReason, 'budget_rejected')
    })

    it('buildVoicePendingResult creates pending state with jobId', () => {
      const result = buildVoicePendingResult(3001)
      assert.equal(result.status, 'pending')
      assert.equal(result.jobId, 3001)
    })
  })

  // =========================================================================
  // 音频引用校验
  // =========================================================================
  describe('Voice attachment reference validation', () => {
    it('accepts valid MP3 reference', () => {
      const ref = buildMp3AttachmentRef()
      const validation = validateVoiceAttachmentReference(ref)
      assert.ok(validation.valid)
    })

    it('accepts valid WAV reference', () => {
      const ref = buildWavAttachmentRef()
      const validation = validateVoiceAttachmentReference(ref)
      assert.ok(validation.valid)
    })

    it('accepts valid WebM reference', () => {
      const ref = buildWebmAttachmentRef()
      const validation = validateVoiceAttachmentReference(ref)
      assert.ok(validation.valid)
    })

    it('rejects unsupported audio type', () => {
      const ref = buildUnsupportedAudioRef()
      const validation = validateVoiceAttachmentReference(ref)
      assert.ok(!validation.valid)
      assert.equal(validation.reason, 'type_not_supported')
    })

    it('rejects forged reference', () => {
      const ref = buildForgedVoiceRef()
      const validation = validateVoiceAttachmentReference(ref)
      assert.ok(!validation.valid)
      assert.equal(validation.reason, 'reference_forged')
    })

    it('rejects null reference', () => {
      const validation = validateVoiceAttachmentReference(null)
      assert.ok(!validation.valid)
      assert.equal(validation.reason, 'reference_forged')
    })
  })

  // =========================================================================
  // 会话消息摘要
  // =========================================================================
  describe('Turn summary', () => {
    it('single accepted summary has correct counts', () => {
      const summary = buildSingleVoiceSummary()
      assert.equal(summary.totalCount, 1)
      assert.equal(summary.acceptedCount, 1)
      assert.equal(summary.rejectedCount, 0)
    })

    it('mixed summary has correct counts', () => {
      const summary = buildMixedVoiceSummary()
      assert.equal(summary.totalCount, 3)
      assert.equal(summary.acceptedCount, 2)
      assert.equal(summary.rejectedCount, 1)
    })

    it('all rejected summary has zero accepted', () => {
      const summary = buildAllRejectedVoiceSummary()
      assert.equal(summary.acceptedCount, 0)
      assert.equal(summary.rejectedCount, 2)
    })
  })

  // =========================================================================
  // 隐私告知
  // =========================================================================
  describe('Privacy notice', () => {
    it('mentions upload, transcription, and retention', () => {
      assert.ok(COPILOT_VOICE_PRIVACY_NOTICE.includes('上传'))
      assert.ok(COPILOT_VOICE_PRIVACY_NOTICE.includes('转写'))
      assert.ok(COPILOT_VOICE_PRIVACY_NOTICE.includes('保留'))
    })

    it('is not empty', () => {
      assert.ok(COPILOT_VOICE_PRIVACY_NOTICE.length > 0)
    })
  })
})
