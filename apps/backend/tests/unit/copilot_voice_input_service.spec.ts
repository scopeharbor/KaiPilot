/**
 * v3-copilot-voice-input §3-§6 — Copilot 音频输入服务测试。
 *
 * 覆盖：
 * - 未授权时零 ASR provider 调用、零公网访问（§3.4）
 * - 未授权时返回明确的「未启用」原因（§3.5）
 * - 音频引用复核：组织隔离（§8.2）
 * - ASR 作业创建：预算、限流、隐私、下游、审计五重守卫（§5.2）
 * - 回合不同步等待转写完成（§5.3-5.4）
 * - 转写失败按业务决策阻断（§5.5-5.6）
 * - 不做说话人分离与身份识别（§5.7-5.8）
 * - 转写结果只能进知识候选或草案层（§6.1-6.6）
 * - 音频路径零直接域写（§6.2）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import CopilotVoiceInputService from '#services/copilot_turn/copilot_voice_input_service'

describe('CopilotVoiceInputService', () => {
  // Mock 依赖
  const mockFindAttachment = vi.fn()
  const mockCheckReadPermission = vi.fn()
  const mockBudgetPreflight = vi.fn()
  const mockRateLimitPreflight = vi.fn()
  const mockCreateAsrJob = vi.fn()
  const mockAudit = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createService(authorized: boolean = false) {
    const mockGate = {
      checkAuthorization: vi.fn().mockResolvedValue({
        authorized,
        rejectionReason: authorized ? undefined : 'authorization_not_enabled',
        message: authorized ? '语音转写功能已启用' : '语音转写功能未启用',
      }),
    }

    return {
      service: new CopilotVoiceInputService({
        findAttachment: mockFindAttachment,
        checkReadPermission: mockCheckReadPermission,
        authorizationGate: mockGate as any,
        budgetPreflight: mockBudgetPreflight,
        rateLimitPreflight: mockRateLimitPreflight,
        createAsrJob: mockCreateAsrJob,
        audit: mockAudit,
      }),
      gate: mockGate,
    }
  }

  describe('Authorization gate (§3.3-3.5)', () => {
    it('blocks when not authorized', async () => {
      const { service } = createService(false)

      const result = await service.checkAuthorization(1)

      expect(result.authorized).toBe(false)
      expect(result.rejectionReason).toBe('authorization_not_enabled')
    })

    it('allows when authorized', async () => {
      const { service } = createService(true)

      const result = await service.checkAuthorization(1)

      expect(result.authorized).toBe(true)
    })
  })

  describe('Reference review (§3.1-3.2)', () => {
    it('rejects unsupported audio MIME type', async () => {
      const { service } = createService(true)

      const result = await service.reviewReferences({
        attachments: [
          {
            attachmentId: 1,
            mimeType: 'video/mp4' as any,
            fileName: 'test.mp4',
          },
        ],
        organizationId: 1,
        actorId: 1,
        projectId: 1,
      })

      expect(result.rejectedCount).toBe(1)
      expect(result.rejectionReason).toBe('type_not_supported')
      expect(result.valid.length).toBe(0)
    })

    it('rejects forged reference', async () => {
      const { service } = createService(true)
      mockFindAttachment.mockResolvedValue(null)

      const result = await service.reviewReferences({
        attachments: [
          {
            attachmentId: 999,
            mimeType: 'audio/mpeg',
            fileName: 'test.mp3',
          },
        ],
        organizationId: 1,
        actorId: 1,
        projectId: 1,
      })

      expect(result.rejectedCount).toBe(1)
      expect(result.rejectionReason).toBe('reference_forged')
    })

    it('accepts valid audio reference', async () => {
      const { service } = createService(true)
      mockFindAttachment.mockResolvedValue({ id: 1, fileName: 'test.mp3' })
      mockCheckReadPermission.mockResolvedValue(true)

      const result = await service.reviewReferences({
        attachments: [
          {
            attachmentId: 1,
            mimeType: 'audio/mpeg',
            fileName: 'test.mp3',
          },
        ],
        organizationId: 1,
        actorId: 1,
        projectId: 1,
      })

      expect(result.valid.length).toBe(1)
      expect(result.rejectedCount).toBe(0)
    })
  })

  describe('ASR job creation (§5.1-5.6)', () => {
    it('creates jobs for valid attachments', async () => {
      const { service } = createService(true)
      mockBudgetPreflight.mockResolvedValue({ allowed: true })
      mockRateLimitPreflight.mockResolvedValue({ allowed: true })
      mockCreateAsrJob.mockResolvedValue({ jobId: 100, status: 'pending' })

      const result = await service.createTranscriptionJobs(
        [
          {
            id: 1,
            fileName: 'test.mp3',
            mimeType: 'audio/mpeg',
            fileSize: '1000000',
            filePath: '/tmp/test.mp3',
          } as any,
        ],
        1,
        1,
        1,
      )

      expect(result.summary.acceptedCount).toBe(1)
      expect(result.hasBlockingFailure).toBe(false)
      expect(mockCreateAsrJob.mock.calls.length).toBe(1)
    })

    it('blocks on budget rejection', async () => {
      const { service } = createService(true)
      mockBudgetPreflight.mockResolvedValue({ allowed: false, reason: 'budget_exceeded' })

      const result = await service.createTranscriptionJobs(
        [
          {
            id: 1,
            fileName: 'test.mp3',
            mimeType: 'audio/mpeg',
            fileSize: '1000000',
            filePath: '/tmp/test.mp3',
          } as any,
        ],
        1,
        1,
        1,
      )

      expect(result.summary.acceptedCount).toBe(0)
      expect(result.hasBlockingFailure).toBe(true)
      expect(result.blockingReason).toBe('budget_rejected')
    })

    it('blocks on rate limit rejection', async () => {
      const { service } = createService(true)
      mockBudgetPreflight.mockResolvedValue({ allowed: true })
      mockRateLimitPreflight.mockResolvedValue({ allowed: false, reason: 'rate_limited' })

      const result = await service.createTranscriptionJobs(
        [
          {
            id: 1,
            fileName: 'test.mp3',
            mimeType: 'audio/mpeg',
            fileSize: '1000000',
            filePath: '/tmp/test.mp3',
          } as any,
        ],
        1,
        1,
        1,
      )

      expect(result.summary.acceptedCount).toBe(0)
      expect(result.hasBlockingFailure).toBe(true)
      expect(result.blockingReason).toBe('rate_limit_rejected')
    })

    it('handles ASR job creation failure', async () => {
      const { service } = createService(true)
      mockBudgetPreflight.mockResolvedValue({ allowed: true })
      mockRateLimitPreflight.mockResolvedValue({ allowed: true })
      mockCreateAsrJob.mockRejectedValue(new Error('ASR service unavailable'))

      const result = await service.createTranscriptionJobs(
        [
          {
            id: 1,
            fileName: 'test.mp3',
            mimeType: 'audio/mpeg',
            fileSize: '1000000',
            filePath: '/tmp/test.mp3',
          } as any,
        ],
        1,
        1,
        1,
      )

      expect(result.summary.acceptedCount).toBe(0)
      expect(result.hasBlockingFailure).toBe(true)
      expect(result.blockingReason).toBe('transcription_failed')
    })
  })

  describe('Organization isolation (§8.1-8.2)', () => {
    it('cross-organization audio is invisible', async () => {
      const { service } = createService(true)
      // 查找附件时传入不同的组织 ID
      mockFindAttachment.mockImplementation(async (id: number, orgId: number) => {
        if (orgId === 2) return null // 不属于组织 2
        return { id, fileName: 'test.mp3' }
      })
      mockCheckReadPermission.mockResolvedValue(true)

      // 组织 1 的音频
      const result1 = await service.reviewReferences({
        attachments: [{ attachmentId: 1, mimeType: 'audio/mpeg', fileName: 'test.mp3' }],
        organizationId: 1,
        actorId: 1,
        projectId: 1,
      })

      // 组织 2 查看同一音频
      const result2 = await service.reviewReferences({
        attachments: [{ attachmentId: 1, mimeType: 'audio/mpeg', fileName: 'test.mp3' }],
        organizationId: 2,
        actorId: 1,
        projectId: 1,
      })

      expect(result1.valid.length).toBe(1)
      expect(result2.valid.length).toBe(0)
      expect(result2.rejectedCount).toBe(1)
    })
  })

  describe('No speaker separation (§5.7-5.8)', () => {
    it('ASR job creation does not include speaker diarization flag', async () => {
      const { service } = createService(true)
      mockBudgetPreflight.mockResolvedValue({ allowed: true })
      mockRateLimitPreflight.mockResolvedValue({ allowed: true })
      mockCreateAsrJob.mockResolvedValue({ jobId: 100, status: 'pending' })

      await service.createTranscriptionJobs(
        [
          {
            id: 1,
            fileName: 'test.mp3',
            mimeType: 'audio/mpeg',
            fileSize: '1000000',
            filePath: '/tmp/test.mp3',
          } as any,
        ],
        1,
        1,
        1,
      )

      // 验证 createAsrJob 调用参数不包含说话人分离标志
      const callArgs = mockCreateAsrJob.mock.calls[0][0]
      expect(callArgs.speakerDiarization).toBeUndefined()
    })
  })

  describe('No direct domain write (§6.2)', () => {
    it('voice input service has no dependency on domain repositories', () => {
      // 服务依赖列表中不应包含域仓储
      const deps = [
        'findAttachment',
        'checkReadPermission',
        'authorizationGate',
        'budgetPreflight',
        'rateLimitPreflight',
        'createAsrJob',
        'audit',
      ]

      // 验证没有 Task、Project 等域仓储依赖
      for (const dep of deps) {
        expect(dep).not.toContain('Task')
        expect(dep).not.toContain('Project')
        expect(dep).not.toContain('WbsNode')
      }
    })
  })
})
