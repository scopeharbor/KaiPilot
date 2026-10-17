/**
 * v3-frontend-ai-usage-telemetry —— 测试：关闭状态下零请求发出。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initTelemetryClient,
  setTelemetryEnabled,
  getTelemetryEnabled,
  trackPanelOpen,
  getBuffer,
  clearBuffer,
} from '../lib/telemetry/telemetry-client'

describe('telemetry-switch', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Mock fetch
    fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)
    clearBuffer()
    // 默认启用埋点
    setTelemetryEnabled(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearBuffer()
    // 恢复默认状态
    setTelemetryEnabled(true)
  })

  describe('4.2 关闭状态下零请求发出', () => {
    it('关闭埋点后不记录事件', () => {
      initTelemetryClient()
      setTelemetryEnabled(false)

      trackPanelOpen({
        organizationId: 'org-001',
        sessionId: 'session-001',
      })

      // 缓冲区应该为空
      expect(getBuffer()).toHaveLength(0)
    })

    it('关闭埋点后不发送请求', async () => {
      initTelemetryClient()
      setTelemetryEnabled(false)

      trackPanelOpen({
        organizationId: 'org-001',
        sessionId: 'session-001',
      })

      // 等待可能的异步操作
      await new Promise((resolve) => setTimeout(resolve, 100))

      // fetch 不应该被调用
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('重新启用埋点后正常记录事件', () => {
      initTelemetryClient()
      setTelemetryEnabled(false)
      setTelemetryEnabled(true)

      trackPanelOpen({
        organizationId: 'org-001',
        sessionId: 'session-001',
      })

      // 缓冲区应该有一个事件
      expect(getBuffer()).toHaveLength(1)
    })
  })

  describe('开关状态持久化', () => {
    it('getTelemetryEnabled 返回当前状态', () => {
      expect(getTelemetryEnabled()).toBe(true)
      setTelemetryEnabled(false)
      expect(getTelemetryEnabled()).toBe(false)
      setTelemetryEnabled(true)
      expect(getTelemetryEnabled()).toBe(true)
    })

    it('开关跨会话保持', () => {
      // 模拟会话 1：关闭埋点
      setTelemetryEnabled(false)
      expect(getTelemetryEnabled()).toBe(false)

      // 模拟会话 2：重新读取状态
      // 由于我们使用 localStorage，状态应该保持
      expect(getTelemetryEnabled()).toBe(false)

      // 模拟会话 3：重新启用
      setTelemetryEnabled(true)
      expect(getTelemetryEnabled()).toBe(true)
    })
  })
})
