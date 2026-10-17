/**
 * v3-frontend-ai-usage-telemetry —— 测试：八类事件均能产生。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  trackCopilotPanelOpen,
  trackCopilotPanelClose,
  trackCopilotSessionTurn,
  trackCopilotFirstQuestionIntent,
  trackCopilotChipClick,
  trackCopilotActionClick,
  trackCopilotActionReject,
} from '../lib/telemetry/copilot-telemetry-integration'
import { getBuffer, clearBuffer } from '../lib/telemetry/telemetry-client'

describe('copilot-telemetry-integration', () => {
  beforeEach(() => {
    clearBuffer()
  })

  afterEach(() => {
    clearBuffer()
  })

  describe('3.4 八类事件均能产生', () => {
    it('面板打开事件', () => {
      trackCopilotPanelOpen({
        organizationId: 'org-001',
        sessionId: 'session-001',
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('panel_open')
    })

    it('面板关闭事件（已提交）', () => {
      trackCopilotPanelClose({
        organizationId: 'org-001',
        sessionId: 'session-001',
        hasSubmitted: true,
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('panel_close')
      expect((buffer[0] as { hasSubmitted: boolean }).hasSubmitted).toBe(true)
    })

    it('面板关闭事件（未提交，触发放弃）', () => {
      trackCopilotPanelClose({
        organizationId: 'org-001',
        sessionId: 'session-001',
        hasSubmitted: false,
      })

      const buffer = getBuffer()
      // 应该有两个事件：panel_close 和 abandonment
      expect(buffer).toHaveLength(2)
      expect(buffer[0]!.eventKind).toBe('panel_close')
      expect(buffer[1]!.eventKind).toBe('abandonment')
    })

    it('会话轮数事件', () => {
      trackCopilotSessionTurn({
        organizationId: 'org-001',
        sessionId: 'session-001',
        turnCount: 3,
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('session_turn')
      expect((buffer[0] as { turnCount: number }).turnCount).toBe(3)
    })

    it('首问意图类别事件', () => {
      trackCopilotFirstQuestionIntent({
        organizationId: 'org-001',
        sessionId: 'session-001',
        intentClass: 'query',
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('first_question_intent')
      expect((buffer[0] as { intentClass: string }).intentClass).toBe('query')
    })

    it('芯片点击事件', () => {
      trackCopilotChipClick({
        organizationId: 'org-001',
        sessionId: 'session-001',
        chipId: 'chip-001',
        chipSource: 'intent-catalog',
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('chip_click')
      expect((buffer[0] as { chipId: string }).chipId).toBe('chip-001')
      expect((buffer[0] as { chipSource: string }).chipSource).toBe('intent-catalog')
    })

    it('动作卡片点击事件', () => {
      trackCopilotActionClick({
        organizationId: 'org-001',
        sessionId: 'session-001',
        actionId: 'action-001',
        actionLabel: '创建任务',
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('action_click')
      expect((buffer[0] as { actionId: string }).actionId).toBe('action-001')
      expect((buffer[0] as { actionLabel: string }).actionLabel).toBe('创建任务')
    })

    it('动作卡片拒绝事件', () => {
      trackCopilotActionReject({
        organizationId: 'org-001',
        sessionId: 'session-001',
        actionId: 'action-001',
        actionLabel: '创建任务',
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('action_reject')
      expect((buffer[0] as { actionId: string }).actionId).toBe('action-001')
      expect((buffer[0] as { actionLabel: string }).actionLabel).toBe('创建任务')
    })
  })
})
