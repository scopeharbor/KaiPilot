/**
 * v3-frontend-ai-usage-telemetry —— 测试：无第三方分析依赖且无非自家域的外发。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initTelemetryClient,
  trackPanelOpen,
  trackPanelClose,
  trackSessionTurn,
  trackFirstQuestionIntent,
  trackAbandonment,
  trackChipClick,
  trackActionClick,
  trackActionReject,
  getBuffer,
  clearBuffer,
} from '../lib/telemetry/telemetry-client'

describe('telemetry-client', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    // Mock fetch
    fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)
    clearBuffer()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    clearBuffer()
  })

  describe('3.2 无第三方分析依赖且无非自家域的外发', () => {
    it('所有请求都发往自家后端 /api/v1/frontend-telemetry', async () => {
      initTelemetryClient()

      trackPanelOpen({
        organizationId: 'org-001',
        sessionId: 'session-001',
      })

      // 触发发送（使用假时间前进 30 秒）
      vi.advanceTimersByTime(30000)
      await vi.runAllTimersAsync()

      // 验证 fetch 被调用
      expect(fetchSpy).toHaveBeenCalled()

      // 验证请求 URL 是自家后端
      const firstCall = fetchSpy.mock.calls[0]
      expect(firstCall).toBeDefined()
      const [url] = firstCall as unknown[]
      expect(url).toBe('/api/v1/frontend-telemetry')
    })

    it('不引入任何第三方分析 SDK', () => {
      // 验证没有全局分析对象
      expect((window as unknown as Record<string, unknown>).gtag).toBeUndefined()
      expect((window as unknown as Record<string, unknown>).analytics).toBeUndefined()
      expect((window as unknown as Record<string, unknown>).mixpanel).toBeUndefined()
      expect((window as unknown as Record<string, unknown>).amplitude).toBeUndefined()
      expect((window as unknown as Record<string, unknown>).posthog).toBeUndefined()
      expect((window as unknown as Record<string, unknown>).hotjar).toBeUndefined()
      expect((window as unknown as Record<string, unknown>).heap).toBeUndefined()
      expect((window as unknown as Record<string, unknown>).fullstory).toBeUndefined()
      expect((window as unknown as Record<string, unknown>).logrocket).toBeUndefined()
    })
  })

  describe('事件记录', () => {
    it('记录面板打开事件', () => {
      initTelemetryClient()

      trackPanelOpen({
        organizationId: 'org-001',
        sessionId: 'session-001',
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('panel_open')
      expect(buffer[0]!.organizationId).toBe('org-001')
      expect(buffer[0]!.sessionId).toBe('session-001')
    })

    it('记录面板关闭事件', () => {
      initTelemetryClient()

      trackPanelClose({
        organizationId: 'org-001',
        sessionId: 'session-001',
        hasSubmitted: true,
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('panel_close')
      expect((buffer[0] as { hasSubmitted: boolean }).hasSubmitted).toBe(true)
    })

    it('记录会话轮数事件', () => {
      initTelemetryClient()

      trackSessionTurn({
        organizationId: 'org-001',
        sessionId: 'session-001',
        turnCount: 3,
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('session_turn')
      expect((buffer[0] as { turnCount: number }).turnCount).toBe(3)
    })

    it('记录首问意图类别事件', () => {
      initTelemetryClient()

      trackFirstQuestionIntent({
        organizationId: 'org-001',
        sessionId: 'session-001',
        intentClass: 'query',
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('first_question_intent')
      expect((buffer[0] as { intentClass: string }).intentClass).toBe('query')
    })

    it('记录放弃事件', () => {
      initTelemetryClient()

      trackAbandonment({
        organizationId: 'org-001',
        sessionId: 'session-001',
      })

      const buffer = getBuffer()
      expect(buffer).toHaveLength(1)
      expect(buffer[0]!.eventKind).toBe('abandonment')
    })

    it('记录芯片点击事件', () => {
      initTelemetryClient()

      trackChipClick({
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

    it('记录动作卡片点击事件', () => {
      initTelemetryClient()

      trackActionClick({
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

    it('记录动作卡片拒绝事件', () => {
      initTelemetryClient()

      trackActionReject({
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

  describe('3.5 批量发送', () => {
    it('单次交互不触发即时请求', () => {
      initTelemetryClient()

      trackPanelOpen({
        organizationId: 'org-001',
        sessionId: 'session-001',
      })

      // 立即检查，不应该有请求
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('3.7 发送失败静默丢弃', () => {
    it('发送失败时交互完全不受影响', async () => {
      // Mock fetch 失败
      fetchSpy.mockRejectedValue(new Error('Network error'))

      initTelemetryClient()

      trackPanelOpen({
        organizationId: 'org-001',
        sessionId: 'session-001',
      })

      // 触发发送（使用假时间前进 30 秒）
      vi.advanceTimersByTime(30000)
      await vi.runAllTimersAsync()

      // 验证 fetch 被调用但失败
      expect(fetchSpy).toHaveBeenCalled()

      // 验证缓冲区已清空（事件被丢弃）
      expect(getBuffer()).toHaveLength(0)
    })
  })
})
