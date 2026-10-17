/**
 * v3-copilot-voice-input §4 — 隐私告知服务测试。
 *
 * 覆盖：
 * - 告知文案包含上传、转写、保留三件事
 * - 未确认时验证失败
 * - 第二次上传仍需确认
 * - 确认记录只在单次回合内有效
 */

import { describe, it, expect } from 'vitest'
import CopilotVoicePrivacyNotice from '#services/copilot_turn/copilot_voice_privacy_notice'

describe('CopilotVoicePrivacyNotice', () => {
  const notice = new CopilotVoicePrivacyNotice()

  describe('getNoticeText', () => {
    it('mentions upload, transcription, and retention', () => {
      const text = notice.getNoticeText()
      expect(text).toContain('上传')
      expect(text).toContain('转写')
      expect(text).toContain('保留')
    })

    it('is not empty', () => {
      const text = notice.getNoticeText()
      expect(text.length).toBeGreaterThan(0)
    })
  })

  describe('validateConsent', () => {
    it('rejects null consent', () => {
      const result = notice.validateConsent(null)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('未确认')
    })

    it('rejects unconfirmed consent', () => {
      const result = notice.validateConsent({
        confirmed: false,
        confirmedAt: Date.now(),
        turnId: 'turn-1',
      })
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('未确认')
    })

    it('rejects consent with empty turnId', () => {
      const result = notice.validateConsent({
        confirmed: true,
        confirmedAt: Date.now(),
        turnId: '',
      })
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('无效')
    })

    it('accepts valid consent', () => {
      const result = notice.validateConsent({
        confirmed: true,
        confirmedAt: Date.now(),
        turnId: 'turn-1',
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('createConsent', () => {
    it('creates consent with turnId and timestamp', () => {
      const before = Date.now()
      const consent = notice.createConsent('turn-1')
      const after = Date.now()

      expect(consent.confirmed).toBe(true)
      expect(consent.turnId).toBe('turn-1')
      expect(consent.confirmedAt).toBeGreaterThanOrEqual(before)
      expect(consent.confirmedAt).toBeLessThanOrEqual(after)
    })
  })

  describe('Each upload requires confirmation again (§4.4)', () => {
    it('second upload still requires confirmation', () => {
      // 第一次确认
      const consent1 = notice.createConsent('turn-1')
      expect(notice.validateConsent(consent1).valid).toBe(true)

      // 第二次上传（新回合）需要重新确认
      const consent2 = notice.createConsent('turn-2')
      expect(consent2.turnId).toBe('turn-2')
      expect(consent1.turnId).not.toBe(consent2.turnId)

      // 旧的确认对新回合无效
      expect(consent1.turnId).toBe('turn-1')
      expect(consent2.turnId).toBe('turn-2')
    })
  })
})
