// @aiproj/types — 推荐共享契约单元测试
// v2-ai-smart-recommendations

import { describe, it, expect } from 'vitest'
import {
  RECOMMENDATION_SOURCES,
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_TRANSITIONS,
  RECOMMENDATION_SEVERITIES,
  RECOMMENDATION_SEVERITY_ORDER,
  recommendationSeverityScore,
  RECOMMENDATION_VISIBILITY,
  type RecommendationStatus,
} from './recommendation.js'

describe('recommendation types', () => {
  // -----------------------------------------------------------------------
  // 来源常量
  // -----------------------------------------------------------------------

  it('RECOMMENDATION_SOURCES 包含所有预期来源', () => {
    expect(RECOMMENDATION_SOURCES).toContain('resource')
    expect(RECOMMENDATION_SOURCES).toContain('risk')
    expect(RECOMMENDATION_SOURCES).toContain('change_impact')
    expect(RECOMMENDATION_SOURCES).toContain('dashboard')
    expect(RECOMMENDATION_SOURCES).toContain('report')
    expect(RECOMMENDATION_SOURCES).toContain('health_diagnosis')
    expect(RECOMMENDATION_SOURCES).toContain('prediction')
    expect(RECOMMENDATION_SOURCES).toContain('weekly_report')
    expect(RECOMMENDATION_SOURCES).toContain('monthly_report')
    expect(RECOMMENDATION_SOURCES).toContain('manual')
  })

  it('RECOMMENDATION_SOURCES 没有重复值', () => {
    expect(new Set(RECOMMENDATION_SOURCES).size).toBe(RECOMMENDATION_SOURCES.length)
  })

  // -----------------------------------------------------------------------
  // 状态常量
  // -----------------------------------------------------------------------

  it('RECOMMENDATION_STATUSES 包含所有预期状态', () => {
    expect(RECOMMENDATION_STATUSES).toContain('new')
    expect(RECOMMENDATION_STATUSES).toContain('reviewing')
    expect(RECOMMENDATION_STATUSES).toContain('accepted')
    expect(RECOMMENDATION_STATUSES).toContain('dismissed')
    expect(RECOMMENDATION_STATUSES).toContain('snoozed')
    expect(RECOMMENDATION_STATUSES).toContain('converted')
    expect(RECOMMENDATION_STATUSES).toContain('expired')
  })

  it('RECOMMENDATION_STATUSES 没有重复值', () => {
    expect(new Set(RECOMMENDATION_STATUSES).size).toBe(RECOMMENDATION_STATUSES.length)
  })

  // -----------------------------------------------------------------------
  // 状态流转
  // -----------------------------------------------------------------------

  it('RECOMMENDATION_TRANSITIONS 定义所有状态的合法流转', () => {
    for (const status of RECOMMENDATION_STATUSES) {
      expect(RECOMMENDATION_TRANSITIONS[status as RecommendationStatus]).toBeDefined()
      expect(Array.isArray(RECOMMENDATION_TRANSITIONS[status as RecommendationStatus])).toBe(true)
    }
  })

  it('所有 target status 都是合法状态', () => {
    for (const status of RECOMMENDATION_STATUSES) {
      const targets = RECOMMENDATION_TRANSITIONS[status as RecommendationStatus]
      for (const target of targets) {
        expect(RECOMMENDATION_STATUSES).toContain(target)
      }
    }
  })

  it('new 可流转到 reviewing/accepted/dismissed/snoozed/expired', () => {
    expect(RECOMMENDATION_TRANSITIONS['new']).toEqual(
      expect.arrayContaining(['reviewing', 'accepted', 'dismissed', 'snoozed', 'expired']),
    )
  })

  it('converted 只能流转到 expired', () => {
    expect(RECOMMENDATION_TRANSITIONS['converted']).toEqual(['expired'])
  })

  it('expired 可重新激活到 new', () => {
    expect(RECOMMENDATION_TRANSITIONS['expired']).toContain('new')
  })

  // -----------------------------------------------------------------------
  // 严重度排序
  // -----------------------------------------------------------------------

  it('RECOMMENDATION_SEVERITIES 包含所有预期严重度', () => {
    expect(RECOMMENDATION_SEVERITIES).toContain('critical')
    expect(RECOMMENDATION_SEVERITIES).toContain('high')
    expect(RECOMMENDATION_SEVERITIES).toContain('medium')
    expect(RECOMMENDATION_SEVERITIES).toContain('low')
    expect(RECOMMENDATION_SEVERITIES).toContain('info')
  })

  it('RECOMMENDATION_SEVERITY_ORDER 从 critical 到 info 降序', () => {
    expect(RECOMMENDATION_SEVERITY_ORDER).toEqual(['critical', 'high', 'medium', 'low', 'info'])
  })

  it('recommendationSeverityScore 按严重度返回到正分', () => {
    expect(recommendationSeverityScore('critical')).toBe(5)
    expect(recommendationSeverityScore('high')).toBe(4)
    expect(recommendationSeverityScore('medium')).toBe(3)
    expect(recommendationSeverityScore('low')).toBe(2)
    expect(recommendationSeverityScore('info')).toBe(1)
  })

  // -----------------------------------------------------------------------
  // 可见性
  // -----------------------------------------------------------------------

  it('RECOMMENDATION_VISIBILITY 包含所有预期值', () => {
    expect(RECOMMENDATION_VISIBILITY).toContain('full')
    expect(RECOMMENDATION_VISIBILITY).toContain('summary_only')
    expect(RECOMMENDATION_VISIBILITY).toContain('forbidden')
  })

  // -----------------------------------------------------------------------
  // 排序稳定性验证（同分同顺序）
  // -----------------------------------------------------------------------

  it('相同严重度多次调用返回相同分数', () => {
    const severities = ['critical', 'high', 'medium', 'low', 'info'] as const
    const results1 = severities.map((s) => recommendationSeverityScore(s))
    const results2 = severities.map((s) => recommendationSeverityScore(s))
    expect(results1).toEqual(results2)
  })
})
