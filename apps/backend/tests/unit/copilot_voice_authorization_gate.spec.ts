/**
 * v3-copilot-voice-input §3.6 — ASR 授权门服务测试。
 *
 * 覆盖：
 * - 未授权时返回 authorization_not_enabled
 * - 已授权时返回 authorized: true
 * - RBAC 校验：无权限修改授权开关被拒
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖
vi.mock('#models/organization_setting', () => ({
  default: {
    query: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 1 }),
  },
}))

vi.mock('#services/rbac_service', () => ({
  default: vi.fn().mockImplementation(() => ({
    check: vi.fn().mockResolvedValue({ allowed: true }),
  })),
}))

vi.mock('@adonisjs/core/services/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import CopilotVoiceAuthorizationGate from '#services/copilot_turn/copilot_voice_authorization_gate'
import OrganizationSetting from '#models/organization_setting'

describe('CopilotVoiceAuthorizationGate', () => {
  let gate: CopilotVoiceAuthorizationGate
  let mockRbac: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockRbac = {
      check: vi.fn().mockResolvedValue({ allowed: true }),
    }
    gate = new CopilotVoiceAuthorizationGate(mockRbac)
  })

  describe('checkAuthorization', () => {
    it('returns unauthorized when no setting exists', async () => {
      // 模拟查询返回 null
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      }
      vi.mocked(OrganizationSetting.query).mockReturnValue(mockQuery as any)

      const result = await gate.checkAuthorization(1)

      expect(result.authorized).toBe(false)
      expect(result.rejectionReason).toBe('authorization_not_enabled')
      expect(result.message).toContain('未启用')
    })

    it('returns unauthorized when setting value is not "true"', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ value: 'false' }),
      }
      vi.mocked(OrganizationSetting.query).mockReturnValue(mockQuery as any)

      const result = await gate.checkAuthorization(1)

      expect(result.authorized).toBe(false)
      expect(result.rejectionReason).toBe('authorization_not_enabled')
    })

    it('returns authorized when setting value is "true"', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ value: 'true' }),
      }
      vi.mocked(OrganizationSetting.query).mockReturnValue(mockQuery as any)

      const result = await gate.checkAuthorization(1)

      expect(result.authorized).toBe(true)
      expect(result.message).toContain('已启用')
    })
  })

  describe('setAuthorization', () => {
    it('rejects when user lacks permission', async () => {
      mockRbac.check.mockResolvedValue({ allowed: false })
      gate = new CopilotVoiceAuthorizationGate(mockRbac)

      const result = await gate.setAuthorization({ id: 1 } as any, 1, true)

      expect(result.ok).toBe(false)
      expect(result.message).toContain('无权')
    })

    it('creates new setting when none exists', async () => {
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      }
      vi.mocked(OrganizationSetting.query).mockReturnValue(mockQuery as any)
      vi.mocked(OrganizationSetting.create).mockResolvedValue({ id: 1 } as any)

      const result = await gate.setAuthorization({ id: 1 } as any, 1, true)

      expect(result.ok).toBe(true)
      expect(result.message).toContain('已启用')
      expect(OrganizationSetting.create).toHaveBeenCalled()
    })

    it('updates existing setting', async () => {
      const mockSave = vi.fn().mockResolvedValue(true)
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ value: 'false', save: mockSave }),
      }
      vi.mocked(OrganizationSetting.query).mockReturnValue(mockQuery as any)

      const result = await gate.setAuthorization({ id: 1 } as any, 1, true)

      expect(result.ok).toBe(true)
      expect(mockSave).toHaveBeenCalled()
    })
  })
})
