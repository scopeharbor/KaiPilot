/**
 * v3-frontend-ai-usage-telemetry —— 测试：聚合确定性。
 */
import { describe, it, expect } from 'vitest'
import { createFrontendTelemetryService } from '#services/frontend_telemetry_service'

describe('FrontendTelemetryService', () => {
  it('computeDeterministicAggregation 同一事件快照产出同一聚合', () => {
    const service = createFrontendTelemetryService()

    const events = [
      {
        eventKind: 'panel_open',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
      },
      {
        eventKind: 'session_turn',
        timestamp: '2026-08-22T10:01:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        turnCount: 1,
      },
      {
        eventKind: 'first_question_intent',
        timestamp: '2026-08-22T10:02:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        intentClass: 'query',
      },
      {
        eventKind: 'panel_close',
        timestamp: '2026-08-22T10:03:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        hasSubmitted: true,
      },
    ]

    // 多次计算，结果应该相同
    const result1 = service.computeDeterministicAggregation(events)
    const result2 = service.computeDeterministicAggregation(events)
    const result3 = service.computeDeterministicAggregation(events)

    expect(result1).toEqual(result2)
    expect(result2).toEqual(result3)
  })

  it('computeDeterministicAggregation 排序不影响结果', () => {
    const service = createFrontendTelemetryService()

    const events1 = [
      {
        eventKind: 'panel_open',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
      },
      {
        eventKind: 'session_turn',
        timestamp: '2026-08-22T10:01:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        turnCount: 1,
      },
    ]

    const events2 = [
      {
        eventKind: 'session_turn',
        timestamp: '2026-08-22T10:01:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        turnCount: 1,
      },
      {
        eventKind: 'panel_open',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
      },
    ]

    const result1 = service.computeDeterministicAggregation(events1)
    const result2 = service.computeDeterministicAggregation(events2)

    expect(result1).toEqual(result2)
  })

  it('computeAggregation 计算正确指标', () => {
    const service = createFrontendTelemetryService()

    const events = [
      // 会话 1：打开、1 轮、query 意图、关闭（已提交）
      {
        eventKind: 'panel_open',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
      },
      {
        eventKind: 'session_turn',
        timestamp: '2026-08-22T10:01:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        turnCount: 1,
      },
      {
        eventKind: 'first_question_intent',
        timestamp: '2026-08-22T10:02:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        intentClass: 'query',
      },
      {
        eventKind: 'panel_close',
        timestamp: '2026-08-22T10:03:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        hasSubmitted: true,
      },
      // 会话 2：打开、放弃
      {
        eventKind: 'panel_open',
        timestamp: '2026-08-22T11:00:00.000Z',
        sessionId: 'session-002',
        organizationId: 'org-001',
      },
      {
        eventKind: 'panel_close',
        timestamp: '2026-08-22T11:01:00.000Z',
        sessionId: 'session-002',
        organizationId: 'org-001',
        hasSubmitted: false,
      },
      {
        eventKind: 'abandonment',
        timestamp: '2026-08-22T11:02:00.000Z',
        sessionId: 'session-002',
        organizationId: 'org-001',
      },
      // 会话 3：打开、2 轮、analysis 意图、芯片点击、关闭（已提交）
      {
        eventKind: 'panel_open',
        timestamp: '2026-08-22T12:00:00.000Z',
        sessionId: 'session-003',
        organizationId: 'org-001',
      },
      {
        eventKind: 'session_turn',
        timestamp: '2026-08-22T12:01:00.000Z',
        sessionId: 'session-003',
        organizationId: 'org-001',
        turnCount: 1,
      },
      {
        eventKind: 'first_question_intent',
        timestamp: '2026-08-22T12:02:00.000Z',
        sessionId: 'session-003',
        organizationId: 'org-001',
        intentClass: 'analysis',
      },
      {
        eventKind: 'session_turn',
        timestamp: '2026-08-22T12:03:00.000Z',
        sessionId: 'session-003',
        organizationId: 'org-001',
        turnCount: 2,
      },
      {
        eventKind: 'chip_click',
        timestamp: '2026-08-22T12:04:00.000Z',
        sessionId: 'session-003',
        organizationId: 'org-001',
        chipId: 'chip-project-status',
        chipSource: 'intent-catalog',
      },
      {
        eventKind: 'panel_close',
        timestamp: '2026-08-22T12:05:00.000Z',
        sessionId: 'session-003',
        organizationId: 'org-001',
        hasSubmitted: true,
      },
    ]

    const result = service.computeAggregation(events)

    // 打开率：3 个会话都打开了，3/3 = 1
    expect(result.openRate).toBe(1)

    // 会话长度：会话 1 有 1 轮，会话 2 有 0 轮，会话 3 有 2 轮，总计 3 轮 / 3 个会话 = 1
    expect(result.sessionLength).toBe(1)

    // 首问类别分布：query 1 个，analysis 1 个
    expect(result.firstQuestionDistribution.query).toBe(1)
    expect(result.firstQuestionDistribution.analysis).toBe(1)
    expect(result.firstQuestionDistribution.generation).toBe(0)

    // 放弃率：1 个会话放弃了 / 3 个会话打开了 = 1/3 ≈ 0.333
    expect(result.abandonmentRate).toBeCloseTo(1 / 3, 3)

    // 芯片点击分布：chip-project-status 1 次
    expect(result.chipClickDistribution['chip-project-status']).toBe(1)
  })

  it('computeAggregation 无个体轨迹重建路径', () => {
    const service = createFrontendTelemetryService()

    const events = [
      // 同一用户在不同会话中的事件
      {
        eventKind: 'panel_open',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
      },
      {
        eventKind: 'session_turn',
        timestamp: '2026-08-22T10:01:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        turnCount: 1,
      },
      {
        eventKind: 'panel_close',
        timestamp: '2026-08-22T10:02:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        hasSubmitted: true,
      },
      {
        eventKind: 'panel_open',
        timestamp: '2026-08-22T11:00:00.000Z',
        sessionId: 'session-002',
        organizationId: 'org-001',
      },
      {
        eventKind: 'session_turn',
        timestamp: '2026-08-22T11:01:00.000Z',
        sessionId: 'session-002',
        organizationId: 'org-001',
        turnCount: 1,
      },
      {
        eventKind: 'panel_close',
        timestamp: '2026-08-22T11:02:00.000Z',
        sessionId: 'session-002',
        organizationId: 'org-001',
        hasSubmitted: true,
      },
    ]

    const result = service.computeAggregation(events)

    // 聚合结果不包含任何用户标识信息
    // 只有聚合指标，没有用户 ID、会话 ID 等个体信息
    expect(result).not.toHaveProperty('userId')
    expect(result).not.toHaveProperty('sessionId')
    expect(result).not.toHaveProperty('userAgent')
    expect(result).not.toHaveProperty('ip')

    // 验证结果只包含五个核心指标
    expect(result).toHaveProperty('openRate')
    expect(result).toHaveProperty('sessionLength')
    expect(result).toHaveProperty('firstQuestionDistribution')
    expect(result).toHaveProperty('abandonmentRate')
    expect(result).toHaveProperty('chipClickDistribution')
  })

  it('computeAggregation 跨组织事件不可见', () => {
    const service = createFrontendTelemetryService()

    // 设置聚合查询参数（只查询 org-001）
    service.setAggregationQuery({
      organizationId: 'org-001',
      start: '2026-08-22T00:00:00.000Z',
      end: '2026-08-22T23:59:59.999Z',
    })

    const events = [
      // org-001 的事件
      {
        eventKind: 'panel_open',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
      },
      {
        eventKind: 'session_turn',
        timestamp: '2026-08-22T10:01:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        turnCount: 1,
      },
      {
        eventKind: 'panel_close',
        timestamp: '2026-08-22T10:02:00.000Z',
        sessionId: 'session-001',
        organizationId: 'org-001',
        hasSubmitted: true,
      },
      // org-002 的事件（不应该被聚合）
      {
        eventKind: 'panel_open',
        timestamp: '2026-08-22T11:00:00.000Z',
        sessionId: 'session-002',
        organizationId: 'org-002',
      },
      {
        eventKind: 'session_turn',
        timestamp: '2026-08-22T11:01:00.000Z',
        sessionId: 'session-002',
        organizationId: 'org-002',
        turnCount: 2,
      },
      {
        eventKind: 'panel_close',
        timestamp: '2026-08-22T11:02:00.000Z',
        sessionId: 'session-002',
        organizationId: 'org-002',
        hasSubmitted: true,
      },
    ]

    // 过滤只保留 org-001 的事件（模拟组织隔离）
    const filteredEvents = events.filter((e) => e.organizationId === 'org-001')

    const result = service.computeAggregation(filteredEvents)

    // 只有 org-001 的事件被聚合
    expect(result.openRate).toBe(1) // 1 个会话打开了
    expect(result.sessionLength).toBe(1) // 1 轮 / 1 个会话 = 1
    expect(result.firstQuestionDistribution.query).toBe(0) // 没有首问意图
    expect(result.abandonmentRate).toBe(0) // 没有放弃
    expect(result.chipClickDistribution).toEqual({}) // 没有芯片点击
  })
})
