/**
 * compiler-skill.test —— Skill Registry 共享契约与纯函数引擎测试。
 *
 * 覆盖：状态机合法/非法转移、终态、幂等；匹配过滤/排序/分界/守卫。
 */
import { describe, it, expect } from 'vitest'
import {
  isSkillLifecycleStatus,
  SKILL_LIFECYCLE_STATUSES,
  validateSkillLifecycleTransition,
  matchSkills,
  type Skill,
  type SkillMatchQuery,
} from './compiler-skill.js'

// ── 测试夹具 ──────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 1,
    organizationId: 1,
    skillKey: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A test skill',
    status: 'draft',
    category: { primary: 'domain', secondary: 'software_engineering' },
    tags: ['ai', 'compiler'],
    dependencies: [],
    activation: {},
    knowledge: {},
    basePriority: 100,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

// ── isSkillLifecycleStatus ───────────────────────────────────────

describe('isSkillLifecycleStatus', () => {
  it('returns true for valid statuses', () => {
    for (const status of SKILL_LIFECYCLE_STATUSES) {
      expect(isSkillLifecycleStatus(status)).toBe(true)
    }
  })

  it('returns false for invalid statuses', () => {
    expect(isSkillLifecycleStatus('unknown')).toBe(false)
    expect(isSkillLifecycleStatus('')).toBe(false)
    expect(isSkillLifecycleStatus('active_extra')).toBe(false)
  })
})

// ── validateSkillLifecycleTransition ─────────────────────────────

describe('validateSkillLifecycleTransition', () => {
  // 合法转移
  it('allows draft→eval', () => {
    const result = validateSkillLifecycleTransition('draft', 'eval')
    expect(result.valid).toBe(true)
    expect(result.reasonCode).toBe('SKILL_TRANSITION_GRANTED')
    expect(result.resultingStatus).toBe('eval')
  })

  it('allows eval→active', () => {
    const result = validateSkillLifecycleTransition('eval', 'active')
    expect(result.valid).toBe(true)
    expect(result.resultingStatus).toBe('active')
  })

  it('allows eval→draft', () => {
    const result = validateSkillLifecycleTransition('eval', 'draft')
    expect(result.valid).toBe(true)
    expect(result.resultingStatus).toBe('draft')
  })

  it('allows active→deprecated', () => {
    const result = validateSkillLifecycleTransition('active', 'deprecated')
    expect(result.valid).toBe(true)
    expect(result.resultingStatus).toBe('deprecated')
  })

  it('allows active→quality_alert', () => {
    const result = validateSkillLifecycleTransition('active', 'quality_alert')
    expect(result.valid).toBe(true)
    expect(result.resultingStatus).toBe('quality_alert')
  })

  it('allows quality_alert→active', () => {
    const result = validateSkillLifecycleTransition('quality_alert', 'active')
    expect(result.valid).toBe(true)
    expect(result.resultingStatus).toBe('active')
  })

  it('allows quality_alert→deprecated', () => {
    const result = validateSkillLifecycleTransition('quality_alert', 'deprecated')
    expect(result.valid).toBe(true)
    expect(result.resultingStatus).toBe('deprecated')
  })

  // 跳级拒绝
  it('rejects draft→active (eval gate)', () => {
    const result = validateSkillLifecycleTransition('draft', 'active')
    expect(result.valid).toBe(false)
    expect(result.reasonCode).toBe('SKILL_EVAL_GATE_REQUIRED')
    expect(result.resultingStatus).toBeUndefined()
  })

  // 非法转移
  it('rejects active→draft', () => {
    const result = validateSkillLifecycleTransition('active', 'draft')
    expect(result.valid).toBe(false)
    expect(result.reasonCode).toBe('SKILL_TRANSITION_INVALID')
  })

  it('rejects active→eval', () => {
    const result = validateSkillLifecycleTransition('active', 'eval')
    expect(result.valid).toBe(false)
    expect(result.reasonCode).toBe('SKILL_TRANSITION_INVALID')
  })

  it('rejects deprecated→active (terminal state)', () => {
    const result = validateSkillLifecycleTransition('deprecated', 'active')
    expect(result.valid).toBe(false)
    expect(result.reasonCode).toBe('SKILL_TERMINAL_STATE')
  })

  it('rejects deprecated→any (terminal state)', () => {
    const result = validateSkillLifecycleTransition('deprecated', 'draft')
    expect(result.valid).toBe(false)
    expect(result.reasonCode).toBe('SKILL_TERMINAL_STATE')
  })

  it('rejects quality_alert→eval', () => {
    const result = validateSkillLifecycleTransition('quality_alert', 'eval')
    expect(result.valid).toBe(false)
    expect(result.reasonCode).toBe('SKILL_TRANSITION_INVALID')
  })

  // 幂等
  it('rejects self-transition for draft→draft', () => {
    const result = validateSkillLifecycleTransition('draft', 'draft')
    expect(result.valid).toBe(false)
    expect(result.reasonCode).toBe('SKILL_TRANSITION_INVALID')
  })

  it('rejects self-transition for active→active', () => {
    const result = validateSkillLifecycleTransition('active', 'active')
    expect(result.valid).toBe(false)
  })
})

// ── matchSkills ─────────────────────────────────────────────────

describe('matchSkills', () => {
  // 仅返回 active
  it('only returns active skills', () => {
    const skills = [
      makeSkill({ id: 1, skillKey: 'draft-skill', status: 'draft' }),
      makeSkill({ id: 2, skillKey: 'active-skill', status: 'active' }),
    ]
    const results = matchSkills(skills, {})
    expect(results).toHaveLength(1)
    expect(results[0].skill.skillKey).toBe('active-skill')
  })

  it('returns empty array when no active skills', () => {
    const skills = [
      makeSkill({ status: 'draft' }),
      makeSkill({ status: 'eval' }),
      makeSkill({ status: 'deprecated' }),
    ]
    const results = matchSkills(skills, {})
    expect(results).toHaveLength(0)
  })

  // activation 过滤
  it('filters by stage', () => {
    const skills = [
      makeSkill({ id: 1, skillKey: 'stage-a', activation: { stages: ['intent_parsing'] } }),
      makeSkill({ id: 2, skillKey: 'stage-b', activation: { stages: ['code_generation'] } }),
    ].map((s) => ({ ...s, status: 'active' as const }))

    const results = matchSkills(skills, { stageId: 'intent_parsing' })
    expect(results).toHaveLength(1)
    expect(results[0].skill.skillKey).toBe('stage-a')
  })

  it('filters by project type', () => {
    const skills = [
      makeSkill({ id: 1, skillKey: 'type-a', activation: { projectTypes: ['software'] } }),
      makeSkill({ id: 2, skillKey: 'type-b', activation: { projectTypes: ['construction'] } }),
    ].map((s) => ({ ...s, status: 'active' as const }))

    const results = matchSkills(skills, { projectType: 'software' })
    expect(results).toHaveLength(1)
    expect(results[0].skill.skillKey).toBe('type-a')
  })

  it('filters by domain (intersection)', () => {
    const skills = [
      makeSkill({ id: 1, skillKey: 'domain-a', activation: { domains: ['ai', 'nlp'] } }),
      makeSkill({ id: 2, skillKey: 'domain-b', activation: { domains: ['construction'] } }),
    ].map((s) => ({ ...s, status: 'active' as const }))

    const results = matchSkills(skills, { domains: ['ai'] })
    expect(results).toHaveLength(1)
    expect(results[0].skill.skillKey).toBe('domain-a')
  })

  it('filters by complexity range', () => {
    const skills = [
      makeSkill({ id: 1, skillKey: 'simple', activation: { complexityRange: { max: 50 } } }),
      makeSkill({ id: 2, skillKey: 'complex', activation: { complexityRange: { min: 51 } } }),
    ].map((s) => ({ ...s, status: 'active' as const }))

    const results = matchSkills(skills, { complexity: 30 })
    expect(results).toHaveLength(1)
    expect(results[0].skill.skillKey).toBe('simple')
  })

  it('rejects skill when complexity is below min', () => {
    const skills = [
      makeSkill({ id: 1, skillKey: 'big-only', activation: { complexityRange: { min: 80 } } }),
    ].map((s) => ({ ...s, status: 'active' as const }))

    const results = matchSkills(skills, { complexity: 30 })
    expect(results).toHaveLength(0)
  })

  // 排序
  it('sorts by basePriority descending', () => {
    const skills = [
      makeSkill({ id: 1, skillKey: 'low', basePriority: 50 }),
      makeSkill({ id: 2, skillKey: 'high', basePriority: 200 }),
      makeSkill({ id: 3, skillKey: 'mid', basePriority: 100 }),
    ].map((s) => ({ ...s, status: 'active' as const }))

    const results = matchSkills(skills, {})
    expect(results).toHaveLength(3)
    expect(results[0].skill.skillKey).toBe('high')
    expect(results[1].skill.skillKey).toBe('mid')
    expect(results[2].skill.skillKey).toBe('low')
  })

  it('sorts by version descending when same priority', () => {
    const skills = [
      makeSkill({ id: 1, skillKey: 'v1', basePriority: 100, version: '1.0.0' }),
      makeSkill({ id: 2, skillKey: 'v2', basePriority: 100, version: '2.0.0' }),
    ].map((s) => ({ ...s, status: 'active' as const }))

    const results = matchSkills(skills, {})
    expect(results).toHaveLength(2)
    expect(results[0].skill.skillKey).toBe('v2')
    expect(results[1].skill.skillKey).toBe('v1')
  })

  // limit
  it('respects limit option', () => {
    const skills = Array.from({ length: 5 }, (_, i) =>
      makeSkill({ id: i, skillKey: `skill-${i}`, basePriority: 100 - i }),
    ).map((s) => ({ ...s, status: 'active' as const }))

    const results = matchSkills(skills, {}, { limit: 3 })
    expect(results).toHaveLength(3)
  })

  // 确定性
  it('produces deterministic results with same input', () => {
    const skills = [
      makeSkill({ id: 1, skillKey: 'a', basePriority: 50 }),
      makeSkill({ id: 2, skillKey: 'b', basePriority: 100 }),
      makeSkill({ id: 3, skillKey: 'c', basePriority: 75 }),
    ].map((s) => ({ ...s, status: 'active' as const }))

    const r1 = matchSkills(skills, {})
    const r2 = matchSkills(skills, {})
    expect(r1.map((r) => r.skill.id)).toEqual(r2.map((r) => r.skill.id))
    expect(r1.map((r) => r.score)).toEqual(r2.map((r) => r.score))
  })

  // 匹配维度报告
  it('reports matched dimensions', () => {
    const skill = makeSkill({
      id: 1,
      skillKey: 'matched',
      activation: {
        stages: ['intent_parsing'],
        projectTypes: ['software'],
        domains: ['ai'],
        complexityRange: { min: 10, max: 100 },
      },
      basePriority: 100,
      status: 'active',
    })

    const results = matchSkills([skill], {
      stageId: 'intent_parsing',
      projectType: 'software',
      domains: ['ai'],
      complexity: 50,
    })

    expect(results).toHaveLength(1)
    expect(results[0].matchedDimensions.stage).toBe(true)
    expect(results[0].matchedDimensions.projectType).toBe(true)
    expect(results[0].matchedDimensions.domain).toBe(true)
    expect(results[0].matchedDimensions.complexity).toBe(true)
  })

  // recency boost
  it('applies recency boost for recently updated skills', () => {
    const now = '2026-07-24T00:00:00.000Z'
    const recent = makeSkill({
      id: 1,
      skillKey: 'recent',
      updatedAt: '2026-07-23T00:00:00.000Z',
    })
    const old = makeSkill({
      id: 2,
      skillKey: 'old',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    ;[recent, old].forEach((s) => (s.status = 'active' as const))

    const results = matchSkills([recent, old], {}, { referenceTime: now })
    // 同分，但 recent 有 recency boost，应排在前面
    expect(results[0].skill.skillKey).toBe('recent')
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })

  // 空输入
  it('returns empty array for empty input', () => {
    const results = matchSkills([], {})
    expect(results).toEqual([])
  })
})
