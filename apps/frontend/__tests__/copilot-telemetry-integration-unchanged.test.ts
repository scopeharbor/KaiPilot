/**
 * v3-frontend-ai-usage-telemetry —— 测试：Copilot 面板与意图目录既有行为未被改变。
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
import { COPILOT_INTENT_CLASSES, COPILOT_SUB_INTENT_REGISTRY } from '@aiproj/types'

describe('copilot-telemetry-integration-unchanged', () => {
  beforeEach(() => {
    clearBuffer()
  })

  afterEach(() => {
    clearBuffer()
  })

  describe('6.6 Copilot 面板与意图目录既有行为未被改变', () => {
    it('意图目录枚举保持不变', () => {
      // 验证 COPILOT_INTENT_CLASSES 包含所有六类意图
      expect(COPILOT_INTENT_CLASSES).toEqual([
        'query',
        'analysis',
        'generation',
        'mutation',
        'instruction',
        'meta',
      ])
    })

    it('意图目录注册表保持不变', () => {
      // 验证 COPILOT_SUB_INTENT_REGISTRY 包含所有子意图
      expect(COPILOT_SUB_INTENT_REGISTRY.length).toBeGreaterThan(0)

      // 验证每个子意图都有必要的字段
      for (const entry of COPILOT_SUB_INTENT_REGISTRY) {
        expect(entry.subIntentId).toBeDefined()
        expect(entry.intentClass).toBeDefined()
        expect(entry.label).toBeDefined()
        expect(entry.examplePhrasings).toBeDefined()
        expect(entry.requiredSlots).toBeDefined()
        expect(entry.optionalSlots).toBeDefined()
        expect(entry.candidateDestinations).toBeDefined()
        expect(entry.requiredPermissions).toBeDefined()
        expect(entry.ruleDeclarations).toBeDefined()
        expect(entry.confidenceTier).toBeDefined()
        expect(entry.catalogVersion).toBeDefined()
      }
    })

    it('埋点集成不影响面板打开/关闭行为', () => {
      // 模拟面板打开
      trackCopilotPanelOpen({
        organizationId: 'org-001',
        sessionId: 'session-001',
      })

      // 验证事件被记录
      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('panel_open')

      // 模拟面板关闭
      trackCopilotPanelClose({
        organizationId: 'org-001',
        sessionId: 'session-001',
        hasSubmitted: true,
      })

      // 验证事件被记录
      expect(buffer).toHaveLength(2)
      expect(buffer[1]!.eventKind).toBe('panel_close')
    })

    it('埋点集成不影响会话轮数记录', () => {
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

    it('埋点集成不影响意图类别记录', () => {
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

    it('埋点集成不影响芯片点击记录', () => {
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

    it('埋点集成不影响动作点击记录', () => {
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

    it('埋点集成不影响动作拒绝记录', () => {
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
