// @aiproj/types — PMO AI 优先级推荐共享契约测试。
// v3-pmo-ai-priority-recommendations §2.4: candidate determinism, dedupe stability, warnings, fixtures.

import { describe, it, expect } from 'vitest'
import {
  computePmoCandidateDedupeKey,
  computePmoInputSignature,
  isPmoCandidateExpired,
  isPmoCandidateStale,
  isPmoReadOnlyAction,
  isPmoConversionSafe,
  pmoDimensionRedactedWarning,
  pmoSourceUnavailableWarning,
  makeVisiblePmoCandidate,
  makeRestrictedPmoCandidate,
  makeStalePmoCandidate,
  makeAiUnavailablePmoCandidate,
  makeDuplicatePmoCandidate,
  makeLargePortfolioPmoCandidates,
  PMO_RECOMMENDATION_WARNING_CODES,
  PMO_RECOMMENDATION_CANDIDATE_VERSION,
  PMO_RECOMMENDATION_MAX_CANDIDATES_PER_REFRESH,
} from './pmo-ai-priority-recommendations.js'

// ---------------------------------------------------------------------------
// 2.4.1 去重键稳定性
// ---------------------------------------------------------------------------

describe('PMO 候选去重键', () => {
  it('相同输入生成相同去重键', () => {
    const key1 = computePmoCandidateDedupeKey('priority_scoring', 1, 'abc123')
    const key2 = computePmoCandidateDedupeKey('priority_scoring', 1, 'abc123')
    expect(key1).toBe(key2)
  })

  it('不同候选类型生成不同去重键', () => {
    const key1 = computePmoCandidateDedupeKey('priority_scoring', 1, 'abc')
    const key2 = computePmoCandidateDedupeKey('portfolio_dashboard', 1, 'abc')
    expect(key1).not.toBe(key2)
  })

  it('不同项目 ID 生成不同去重键', () => {
    const key1 = computePmoCandidateDedupeKey('priority_scoring', 1, 'abc')
    const key2 = computePmoCandidateDedupeKey('priority_scoring', 2, 'abc')
    expect(key1).not.toBe(key2)
  })

  it('不同上下文哈希生成不同去重键', () => {
    const key1 = computePmoCandidateDedupeKey('priority_scoring', 1, 'abc')
    const key2 = computePmoCandidateDedupeKey('priority_scoring', 1, 'def')
    expect(key1).not.toBe(key2)
  })

  it('去重键包含版本前缀', () => {
    const key = computePmoCandidateDedupeKey('priority_scoring', 1, 'hash')
    expect(key).toContain(PMO_RECOMMENDATION_CANDIDATE_VERSION)
  })
})

// ---------------------------------------------------------------------------
// 2.4.2 输入签名稳定性
// ---------------------------------------------------------------------------

describe('PMO 输入签名', () => {
  it('相同输入生成相同签名', () => {
    const inputs = {
      sourceType: 'priority_scoring' as const,
      sourceId: 'src-1',
      projectId: 1,
      priorityScore: 85.5,
      signals: ['高优先级', '逾期风险'],
    }
    const sig1 = computePmoInputSignature(inputs)
    const sig2 = computePmoInputSignature(inputs)
    expect(sig1).toBe(sig2)
  })

  it('不同输入生成不同签名', () => {
    const a = computePmoInputSignature({
      sourceType: 'priority_scoring' as const,
      sourceId: 'src-1',
      projectId: 1,
      priorityScore: 85.5,
      signals: ['高优先级'],
    })
    const b = computePmoInputSignature({
      sourceType: 'priority_scoring' as const,
      sourceId: 'src-1',
      projectId: 1,
      priorityScore: 30.0,
      signals: ['高优先级'],
    })
    expect(a).not.toBe(b)
  })

  it('null 优先级评分可正常生成签名', () => {
    const sig = computePmoInputSignature({
      sourceType: 'priority_scoring' as const,
      sourceId: 'src-1',
      projectId: 1,
      priorityScore: null,
      signals: [],
    })
    expect(sig).toBeDefined()
    expect(sig).toContain('sig_')
    expect(sig).toContain('_1')
  })

  it('签名格式以 sig_ 开头并包含项目 ID', () => {
    const sig = computePmoInputSignature({
      sourceType: 'traffic_light' as const,
      sourceId: 'tl-42',
      projectId: 42,
      priorityScore: 50,
      signals: ['red', 'overdue'],
    })
    expect(sig).toMatch(/^sig_[a-z0-9]+_42$/)
  })
})

// ---------------------------------------------------------------------------
// 2.4.3 过期/新鲜度检测
// ---------------------------------------------------------------------------

describe('PMO 候选过期检测', () => {
  it('未设过期时间不判定为过期', () => {
    expect(isPmoCandidateExpired(new Date().toISOString(), null)).toBe(false)
  })

  it('已过期的候选判定为过期', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(isPmoCandidateExpired(new Date().toISOString(), past)).toBe(true)
  })

  it('未到期的候选不判定为过期', () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    expect(isPmoCandidateExpired(new Date().toISOString(), future)).toBe(false)
  })
})

describe('PMO 候选新鲜度检测', () => {
  it('无生成时间为 stale', () => {
    expect(isPmoCandidateStale(null)).toBe(true)
  })

  it('刚生成的不为 stale', () => {
    expect(isPmoCandidateStale(new Date().toISOString())).toBe(false)
  })

  it('超过阈值时间为 stale', () => {
    const old = new Date(Date.now() - 120 * 60 * 1000).toISOString() // 2 小时前
    expect(isPmoCandidateStale(old, 60)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2.4.4 No-auto-execute 守护
// ---------------------------------------------------------------------------

describe('PMO no-auto-execute 守护', () => {
  it('所有审查动作都是只读的', () => {
    const actions = [
      'accept',
      'dismiss',
      'snooze',
      'convert',
      'generate_ai_rationale',
      'regenerate_ai_rationale',
    ] as const
    for (const action of actions) {
      expect(isPmoReadOnlyAction(action)).toBe(true)
    }
  })

  it('所有转换目标都安全', () => {
    const targets = [
      'risk',
      'change_request',
      'resource_preview',
      'draft_layer',
      'project_priority_review',
    ] as const
    for (const target of targets) {
      expect(isPmoConversionSafe(target)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 2.4.5 Warning 构建
// ---------------------------------------------------------------------------

describe('PMO 警告构建', () => {
  it('维度脱敏 warning 包含正确 code', () => {
    const w = pmoDimensionRedactedWarning('risk')
    expect(w.code).toBe(PMO_RECOMMENDATION_WARNING_CODES.DIMENSION_REDACTED)
    expect(w.message).toContain('risk')
    expect(w.blocking).toBe(false)
  })

  it('来源不可用 warning 包含 source', () => {
    const w = pmoSourceUnavailableWarning('traffic_light')
    expect(w.code).toBe(PMO_RECOMMENDATION_WARNING_CODES.PRIORITY_SCORING_UNAVAILABLE)
    expect(w.source).toBe('traffic_light')
    expect(w.blocking).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2.4.6 Fixture builders
// ---------------------------------------------------------------------------

describe('PMO fixture builders', () => {
  it('makeVisiblePmoCandidate 生成有效候选', () => {
    const c = makeVisiblePmoCandidate(1)
    expect(c.candidateType).toBe('priority_scoring')
    expect(c.projectId).toBe(1)
    expect(c.priorityContext.scoringAvailable).toBe(true)
    expect(c.warnings).toHaveLength(0)
    expect(c.dedupeKey).toBeDefined()
    expect(c.inputSignature).toBeDefined()
  })

  it('makeVisiblePmoCandidate 支持 overrides', () => {
    const c = makeVisiblePmoCandidate(5, {
      title: '自定义标题',
      severity: 'critical',
    })
    expect(c.title).toBe('自定义标题')
    expect(c.severity).toBe('critical')
    expect(c.projectId).toBe(5)
  })

  it('makeRestrictedPmoCandidate 生成受限候选', () => {
    const c = makeRestrictedPmoCandidate(1)
    expect(c.priorityContext.priorityScore).toBeNull()
    expect(c.priorityContext.priorityLevel).toBe('unavailable')
    expect(c.priorityContext.scoringAvailable).toBe(false)
    expect(c.warnings.length).toBeGreaterThan(0)
    expect(c.targetRef.displayName).toBeNull()
  })

  it('makeStalePmoCandidate 生成过期候选', () => {
    const c = makeStalePmoCandidate(1)
    expect(c.sourceSignals[0].stale).toBe(true)
    expect(c.warnings.some((w) => w.code === 'CANDIDATE_STALE')).toBe(true)
  })

  it('makeAiUnavailablePmoCandidate 生成 AI 不可用候选', () => {
    const c = makeAiUnavailablePmoCandidate(1)
    expect(c.warnings.some((w) => w.code === 'AI_UNAVAILABLE')).toBe(true)
  })

  it('makeDuplicatePmoCandidate 生成相同去重键的候选', () => {
    const a = makeDuplicatePmoCandidate(1, 0)
    const b = makeDuplicatePmoCandidate(1, 1)
    expect(a.dedupeKey).toBe(b.dedupeKey)
    // 但标题不同（用于测试去重合并行为）
    expect(a.title).not.toBe(b.title)
  })

  it('makeLargePortfolioPmoCandidates 生成正确数量', () => {
    const candidates = makeLargePortfolioPmoCandidates(50)
    expect(candidates).toHaveLength(50)
    expect(candidates[0].projectId).toBe(1)
    expect(candidates[49].projectId).toBe(50)
  })

  it('makeLargePortfolioPmoCandidates 生成 1000 个不重复的去重键', () => {
    const candidates = makeLargePortfolioPmoCandidates(100)
    const keys = new Set(candidates.map((c) => c.dedupeKey))
    expect(keys.size).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// 2.4.7 优先级上下文完整性
// ---------------------------------------------------------------------------

describe('PMO 优先级上下文', () => {
  it('可见候选的优先级上下文完整', () => {
    const c = makeVisiblePmoCandidate(1)
    expect(c.priorityContext.priorityScore).toBeGreaterThan(0)
    expect(c.priorityContext.rank).toBe(2) // projectId=1 → rank=2
    expect(c.priorityContext.topDimensionContributors.length).toBeGreaterThan(0)
    expect(c.priorityContext.scoringAvailable).toBe(true)
  })

  it('受限候选的优先级上下文为 unavailable', () => {
    const c = makeRestrictedPmoCandidate(1)
    expect(c.priorityContext.priorityScore).toBeNull()
    expect(c.priorityContext.priorityLevel).toBe('unavailable')
    expect(c.priorityContext.rank).toBeNull()
  })

  it('AI 不可用不影响优先级评分', () => {
    const c = makeAiUnavailablePmoCandidate(1)
    // AI 不可用不等于评分不可用
    expect(c.priorityContext.scoringAvailable).toBe(true)
    expect(c.priorityContext.priorityScore).toBeGreaterThan(0)
    expect(c.warnings.some((w) => w.code === 'AI_UNAVAILABLE')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2.4.8 常量完整性
// ---------------------------------------------------------------------------

describe('PMO 常量', () => {
  it('最大候选数在合理范围', () => {
    expect(PMO_RECOMMENDATION_MAX_CANDIDATES_PER_REFRESH).toBe(500)
  })

  it('候选版本不为空', () => {
    expect(PMO_RECOMMENDATION_CANDIDATE_VERSION.length).toBeGreaterThan(0)
  })

  it('警告代码不重复', () => {
    const codes = Object.values(PMO_RECOMMENDATION_WARNING_CODES)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
