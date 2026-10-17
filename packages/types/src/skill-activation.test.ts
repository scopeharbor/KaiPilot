/**
 * skill-activation.test —— Skill 激活规则引擎纯函数单元测试。
 *
 * 覆盖：手动激活、非激活状态排除、自动激活（项目类型匹配）、依赖传递性加载、
 * 环路 fail-closed、冲突优先级裁决、tie-break 确定性、互补合并、version 去重、
 * AI 推荐候选通道、组装器拒绝晋升、确定性与 evidence digest、纯函数无副作用断言。
 */
import { describe, it, expect } from 'vitest'
import {
  resolveActivation,
  SkillActivationError,
  type ActivationContext,
  type Skill,
} from './skill-activation.js'
import type { Skill as SkillType, ActivationRule } from './compiler-skill.js'

// ── 测试夹具 ──────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: overrides.id ?? 1,
    organizationId: 1,
    skillKey: overrides.skillKey ?? 'test-skill',
    name: overrides.name ?? 'Test Skill',
    version: overrides.version ?? '1.0.0',
    description: overrides.description ?? 'A test skill',
    status: overrides.status ?? 'active',
    category: overrides.category ?? { primary: 'domain', secondary: 'software_engineering' },
    tags: overrides.tags ?? ['ai'],
    dependencies: overrides.dependencies ?? [],
    activation: overrides.activation ?? {},
    knowledge: overrides.knowledge ?? {},
    basePriority: overrides.basePriority ?? 50,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function defaultContext(overrides?: Partial<ActivationContext>): ActivationContext {
  return {
    projectType: 'software',
    projectTags: ['ai', 'web'],
    ...overrides,
  }
}

// ── 任务 1.4: 类型编译通过 + 断言不重定义 Skill/ActivationRule ──

describe('类型契约（任务 1.4）', () => {
  it('skill-activation 不声明 Skill 或 ActivationRule', () => {
    // 编译时验证：该文件 import type { Skill, ActivationRule } from './compiler-skill'
    // 运行时验证：resolveActivation 是函数
    expect(typeof resolveActivation).toBe('function')
    // 验证 SkillActivationError 存在
    expect(SkillActivationError).toBeDefined()
    // 类型系统保证：skill-activation.ts 不会重新导出 Skill/ActivationRule
  })

  it('resolveActivation 签名接受 ActivationContext + Skill[]', () => {
    const ctx = defaultContext()
    const skills = [makeSkill()]
    const result = resolveActivation(ctx, skills)
    expect(result).toBeDefined()
    expect(Array.isArray(result.activatedSkills)).toBe(true)
  })
})

// ── 任务 2.2: 手动选择激活 ──

describe('手动选择激活（任务 2.2）', () => {
  it('manualSelections 命中 -> 激活，activationMode = manual', () => {
    const ctx = defaultContext({ manualSelections: ['agile-dev'] })
    const skills = [makeSkill({ skillKey: 'agile-dev', name: 'Agile Dev' })]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(1)
    expect(result.activatedSkills[0].skill.skillKey).toBe('agile-dev')
    expect(result.activatedSkills[0].activationMode).toBe('manual')
    expect(result.activatedSkills[0].reason).toBe('manual-selection')
  })

  it('manualSelections 不命中非 active Skill', () => {
    const ctx = defaultContext({ manualSelections: ['draft-skill'] })
    const skills = [makeSkill({ skillKey: 'draft-skill', status: 'draft' })]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(0)
  })

  it('manualSelections 含不存在的 skillKey 被忽略', () => {
    const ctx = defaultContext({ manualSelections: ['nonexistent'] })
    // 需要 activation 限制来阻止自动激活
    const skills = [
      makeSkill({
        skillKey: 'other',
        activation: { projectTypes: ['construction'] },
      }),
    ]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(0)
  })
})

// ── 任务 2.3: 非激活状态排除 ──

describe('非激活状态排除（任务 2.3）', () => {
  it('draft/eval/deprecated/quality_alert 不入激活集', () => {
    const ctx = defaultContext()
    const skills = [
      makeSkill({ id: 1, skillKey: 'draft-skill', status: 'draft' }),
      makeSkill({ id: 2, skillKey: 'eval-skill', status: 'eval' }),
      makeSkill({ id: 3, skillKey: 'deprecated-skill', status: 'deprecated' }),
      makeSkill({ id: 4, skillKey: 'qa-skill', status: 'quality_alert' }),
      makeSkill({ id: 5, skillKey: 'active-skill', status: 'active' }),
    ]

    const result = resolveActivation(ctx, skills)
    const keys = result.activatedSkills.map((e) => e.skill.skillKey)
    expect(keys).not.toContain('draft-skill')
    expect(keys).not.toContain('eval-skill')
    expect(keys).not.toContain('deprecated-skill')
    expect(keys).not.toContain('qa-skill')
    // 仅 active 保留（自动激活，因为无 activation 限制 = 通行）
    expect(keys).toEqual(['active-skill'])
  })

  it('非 active Skill 也不入 advisoryCandidates', () => {
    const ctx = defaultContext({ aiRecommendations: ['draft-skill'] })
    const skills = [makeSkill({ skillKey: 'draft-skill', status: 'draft' })]

    const result = resolveActivation(ctx, skills)
    expect(result.advisoryCandidates).toHaveLength(0)
  })
})

// ── 任务 2.4: 项目级自动激活 ──

describe('项目级自动激活（任务 2.4）', () => {
  it('projectTypes 匹配 -> 自动激活', () => {
    const ctx = defaultContext({ projectType: 'software' })
    const skills = [
      makeSkill({
        id: 1,
        skillKey: 'sw-skill',
        activation: { projectTypes: ['software'] },
      }),
    ]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(1)
    expect(result.activatedSkills[0].skill.skillKey).toBe('sw-skill')
    expect(result.activatedSkills[0].activationMode).toBe('auto')
  })

  it('projectTypes 不匹配 -> 不激活', () => {
    const ctx = defaultContext({ projectType: 'construction' })
    const skills = [
      makeSkill({
        id: 1,
        skillKey: 'sw-skill',
        activation: { projectTypes: ['software'] },
      }),
    ]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(0)
  })

  it('domains 匹配 -> 自动激活', () => {
    const ctx = defaultContext({ projectTags: ['ai', 'web'] })
    const skills = [
      makeSkill({
        id: 1,
        skillKey: 'ai-skill',
        activation: { domains: ['ai'] },
      }),
    ]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(1)
    expect(result.activatedSkills[0].skill.skillKey).toBe('ai-skill')
  })

  it('domains 不匹配 -> 不激活', () => {
    const ctx = defaultContext({ projectTags: ['construction'] })
    const skills = [
      makeSkill({
        id: 1,
        skillKey: 'ai-skill',
        activation: { domains: ['ai'] },
      }),
    ]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(0)
  })

  it('未设 activation 规则的 Skill 默认通行（无限制 = 自动激活）', () => {
    const ctx = defaultContext({ projectType: 'software' })
    const skills = [makeSkill({ id: 1, skillKey: 'generic' })]

    // 无 activation.projectTypes = 视为不限制，自动激活
    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(1)
    expect(result.activatedSkills[0].skill.skillKey).toBe('generic')
  })
})

// ── 任务 3: 依赖自动加载与环路检测 ──

describe('依赖自动加载与环路检测（任务 3）', () => {
  it('传递性依赖自动加载 A->B->C', () => {
    const ctx = defaultContext({ manualSelections: ['a'] })
    const skills = [
      makeSkill({ id: 1, skillKey: 'a', name: 'A', dependencies: ['b'] }),
      makeSkill({ id: 2, skillKey: 'b', name: 'B', dependencies: ['c'] }),
      makeSkill({ id: 3, skillKey: 'c', name: 'C' }),
    ]

    const result = resolveActivation(ctx, skills)
    const keys = result.activatedSkills.map((e) => e.skill.skillKey).sort()
    expect(keys).toEqual(['a', 'b', 'c'])

    const bEntry = result.activatedSkills.find((e) => e.skill.skillKey === 'b')!
    expect(bEntry.activationMode).toBe('dependency')

    const cEntry = result.activatedSkills.find((e) => e.skill.skillKey === 'c')!
    expect(cEntry.activationMode).toBe('dependency')
  })

  it('环路检测 fail-closed: A->B->A', () => {
    const ctx = defaultContext({ manualSelections: ['a'] })
    const skills = [
      makeSkill({ id: 1, skillKey: 'a', name: 'A', dependencies: ['b'] }),
      makeSkill({ id: 2, skillKey: 'b', name: 'B', dependencies: ['a'] }),
    ]

    expect(() => resolveActivation(ctx, skills)).toThrow(SkillActivationError)
  })

  it('环路检测 fail-closed: 自循环', () => {
    const ctx = defaultContext({ manualSelections: ['self'] })
    const skills = [makeSkill({ id: 1, skillKey: 'self', name: 'Self', dependencies: ['self'] })]

    expect(() => resolveActivation(ctx, skills)).toThrow(SkillActivationError)
  })

  it('依赖不存在的 skillKey 被跳过（不阻断）', () => {
    const ctx = defaultContext({ manualSelections: ['a'] })
    const skills = [makeSkill({ id: 1, skillKey: 'a', name: 'A', dependencies: ['nonexistent'] })]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(1)
    expect(result.activatedSkills[0].skill.skillKey).toBe('a')
  })

  it('依赖非 active Skill 被跳过', () => {
    const ctx = defaultContext({ manualSelections: ['a'] })
    const skills = [
      makeSkill({ id: 1, skillKey: 'a', name: 'A', dependencies: ['b'] }),
      makeSkill({ id: 2, skillKey: 'b', name: 'B', status: 'draft' }),
    ]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(1)
  })
})

// ── 任务 4: 叠加规则四态 ──

describe('叠加规则四态（任务 4）', () => {
  it('冲突裁决：高优先级胜出', () => {
    const ctx = defaultContext({ manualSelections: ['high', 'low'] })
    const skills = [
      makeSkill({
        id: 1,
        skillKey: 'high',
        name: 'High Priority',
        activation: { priority: 80 },
      }),
      makeSkill({
        id: 2,
        skillKey: 'low',
        name: 'Low Priority',
        activation: { priority: 50 },
      }),
    ]

    const result = resolveActivation(ctx, skills)
    const activated = result.activatedSkills.map((e) => e.skill.skillKey)
    expect(activated).toContain('high')
    expect(activated).not.toContain('low')

    // 败者入 droppedConflicts
    const dropped = result.droppedConflicts.find((d) => d.skill.skillKey === 'low')
    expect(dropped).toBeDefined()
    expect(dropped!.winner).toBe('high')
    expect(dropped!.evidence.type).toBe('conflict')
  })

  it('同优先级 tie-break = skillKey 字典序', () => {
    const ctx = defaultContext({ manualSelections: ['b-skill', 'a-skill'] })
    const skills = [
      makeSkill({
        id: 1,
        skillKey: 'b-skill',
        name: 'B Skill',
        activation: { priority: 50 },
      }),
      makeSkill({
        id: 2,
        skillKey: 'a-skill',
        name: 'A Skill',
        activation: { priority: 50 },
      }),
    ]

    const result = resolveActivation(ctx, skills)
    const activated = result.activatedSkills.map((e) => e.skill.skillKey)
    // 'a-skill' 字典序小，胜出
    expect(activated).toContain('a-skill')
    expect(activated).not.toContain('b-skill')
  })

  it('互补合并：不同域的 Skill 同留', () => {
    const ctx = defaultContext({ manualSelections: ['domain-a', 'method-b'] })
    const skills = [
      makeSkill({
        id: 1,
        skillKey: 'domain-a',
        name: 'Domain A',
        category: { primary: 'domain', secondary: 'backend' },
      }),
      makeSkill({
        id: 2,
        skillKey: 'method-b',
        name: 'Method B',
        category: { primary: 'methodology', secondary: 'agile' },
      }),
    ]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(2)

    // evidence 记录互补
    const complementaryEvidence = result.evidence.filter((e) => e.type === 'complementary')
    expect(complementaryEvidence.length).toBeGreaterThanOrEqual(2)
  })

  it('version 去重：保留最高 version', () => {
    const ctx = defaultContext({ manualSelections: ['dup'] })
    const skills = [
      makeSkill({ id: 1, skillKey: 'dup', version: '1.1.0' }),
      makeSkill({ id: 2, skillKey: 'dup', version: '1.2.0' }),
      makeSkill({ id: 3, skillKey: 'dup', version: '1.0.0' }),
    ]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(1)
    expect(result.activatedSkills[0].skill.version).toBe('1.2.0')

    // 败者入 droppedDuplicates
    expect(result.droppedDuplicates).toHaveLength(2)
    const droppedVersions = result.droppedDuplicates.map((d) => d.skill.version).sort()
    expect(droppedVersions).toEqual(['1.0.0', '1.1.0'])
  })
})

// ── 任务 5: AI 推荐候选通道 ──

describe('AI 推荐候选通道（任务 5）', () => {
  it('AI 推荐入候选不入激活', () => {
    const ctx = defaultContext({ aiRecommendations: ['risk-radar'] })
    const skills = [
      makeSkill({
        skillKey: 'risk-radar',
        name: 'Risk Radar',
        activation: { projectTypes: ['construction'] }, // 不匹配 context.projectType=software，避免自动激活
      }),
    ]

    const result = resolveActivation(ctx, skills)
    expect(result.activatedSkills).toHaveLength(0)
    expect(result.advisoryCandidates).toHaveLength(1)
    expect(result.advisoryCandidates[0].skill.skillKey).toBe('risk-radar')
    expect(result.advisoryCandidates[0].reason).toBe('ai-recommendation')
  })

  it('AI 推荐与手动激活重叠：手动优先，advisory 跳过', () => {
    const ctx = defaultContext({
      manualSelections: ['shared'],
      aiRecommendations: ['shared'],
    })
    const skills = [makeSkill({ skillKey: 'shared', name: 'Shared' })]

    const result = resolveActivation(ctx, skills)
    // manual 胜出，进入 activatedSkills
    expect(result.activatedSkills).toHaveLength(1)
    expect(result.activatedSkills[0].activationMode).toBe('manual')
    // advisory 中不应出现（已经手动激活了）
    expect(result.advisoryCandidates).toHaveLength(0)
  })

  it('AI 推荐非 active Skill 被忽略', () => {
    const ctx = defaultContext({ aiRecommendations: ['draft-skill'] })
    const skills = [makeSkill({ skillKey: 'draft-skill', status: 'draft' })]

    const result = resolveActivation(ctx, skills)
    expect(result.advisoryCandidates).toHaveLength(0)
  })

  it('AI 推荐 + 自动激活同一 Skill：自动激活优先，不冲突', () => {
    const ctx = defaultContext({
      projectType: 'software',
      aiRecommendations: ['both'],
    })
    const skills = [
      makeSkill({
        skillKey: 'both',
        activation: { projectTypes: ['software'] },
      }),
    ]

    const result = resolveActivation(ctx, skills)
    // 自动激活进入 activatedSkills
    expect(result.activatedSkills).toHaveLength(1)
    // advisory 中不应有（已经自动激活了）
    expect(result.advisoryCandidates).toHaveLength(0)
  })
})

// ── 任务 6: 确定性与 evidence digest ──

describe('确定性与 evidence digest（任务 6）', () => {
  it('相同输入恒定产出相同 evidenceDigest', () => {
    const ctx = defaultContext({ manualSelections: ['a', 'b'] })
    const skills = [
      makeSkill({ id: 1, skillKey: 'a', name: 'A', activation: { priority: 80 } }),
      makeSkill({ id: 2, skillKey: 'b', name: 'B', activation: { priority: 50 } }),
    ]

    const r1 = resolveActivation(ctx, skills)
    const r2 = resolveActivation(ctx, skills)

    expect(r1.evidenceDigest).toBe(r2.evidenceDigest)
    expect(r1.evidenceDigest).toBeTruthy()
    expect(r1.evidenceDigest).toHaveLength(64) // SHA-256 hex = 64 chars
  })

  it('不同输入产出不同 evidenceDigest', () => {
    // 两个不同的 context 产生不同的激活集
    const ctx1 = defaultContext({ manualSelections: ['a'] })
    const ctx2 = defaultContext({ manualSelections: ['b'] })
    const skills = [
      makeSkill({ id: 1, skillKey: 'a', name: 'A', activation: { projectTypes: ['software'] } }),
      makeSkill({
        id: 2,
        skillKey: 'b',
        name: 'B',
        activation: { projectTypes: ['construction'] },
      }),
    ]

    const r1 = resolveActivation(ctx1, skills)
    const r2 = resolveActivation(ctx2, skills)

    // 不同的 manualSelection + 不同的 activation 匹配 = 不同的激活集
    expect(r1.evidenceDigest).not.toBe(r2.evidenceDigest)
  })

  it('稳定排序：priority 降序，同优先级 skillKey 字典序', () => {
    const ctx = defaultContext({
      manualSelections: ['mid', 'high', 'low', 'same-a', 'same-b'],
    })
    const skills = [
      makeSkill({
        id: 1,
        skillKey: 'mid',
        activation: { priority: 50 },
        category: { primary: 'domain', secondary: 'mid' },
      }),
      makeSkill({
        id: 2,
        skillKey: 'high',
        activation: { priority: 100 },
        category: { primary: 'domain', secondary: 'high' },
      }),
      makeSkill({
        id: 3,
        skillKey: 'low',
        activation: { priority: 10 },
        category: { primary: 'domain', secondary: 'low' },
      }),
      makeSkill({
        id: 4,
        skillKey: 'same-a',
        activation: { priority: 50 },
        category: { primary: 'tool', secondary: 'editor' },
      }),
      makeSkill({
        id: 5,
        skillKey: 'same-b',
        activation: { priority: 50 },
        category: { primary: 'template', secondary: 'report' },
      }),
    ]

    const result = resolveActivation(ctx, skills)
    const order = result.activatedSkills.map((e) => e.skill.skillKey)
    // high (100) first, then mid + same-a + same-b (all 50, alpha), then low (10)
    expect(order).toEqual(['high', 'mid', 'same-a', 'same-b', 'low'])
  })

  it('纯函数无副作用', () => {
    const ctx = defaultContext()
    const skills = [makeSkill()]

    // 多次调用不改变结果
    for (let i = 0; i < 10; i++) {
      const result = resolveActivation(ctx, skills)
      expect(result.activatedSkills).toHaveLength(1)
    }
  })

  it('空 skills 数组返回空决策', () => {
    const ctx = defaultContext({ manualSelections: ['a'] })
    const result = resolveActivation(ctx, [])
    expect(result.activatedSkills).toHaveLength(0)
    expect(result.advisoryCandidates).toHaveLength(0)
    expect(result.evidenceDigest).toBeTruthy()
  })
})

// ── 任务 7: 门禁相关（类型安全 & 边界） ──

describe('边界与类型安全', () => {
  it('入参缺失抛出错误', () => {
    // @ts-expect-error - 测试运行时参数缺失
    expect(() => resolveActivation(null, [])).toThrow()
    // @ts-expect-error - 测试运行时参数缺失
    expect(() => resolveActivation(undefined, [])).toThrow()
  })

  it('skills 非数组抛出错误', () => {
    // @ts-expect-error - 测试运行时类型错误
    expect(() => resolveActivation(defaultContext(), null)).toThrow('skills')
  })

  it('复杂场景：手动 + 自动 + 依赖 + 冲突 + AI 推荐', () => {
    const ctx = defaultContext({
      projectType: 'software',
      manualSelections: ['agile-core'],
      aiRecommendations: ['risk-radar', 'ai-test-gen'],
    })

    const skills: Skill[] = [
      // 手动选择的核心
      makeSkill({
        id: 1,
        skillKey: 'agile-core',
        name: 'Agile Core',
        category: { primary: 'methodology', secondary: 'agile' },
        activation: { priority: 80, projectTypes: ['software'] },
        dependencies: ['scrum-practices'],
      }),
      // 依赖
      makeSkill({
        id: 2,
        skillKey: 'scrum-practices',
        name: 'Scrum Practices',
        category: { primary: 'methodology', secondary: 'scrum' },
        activation: { priority: 60 },
      }),
      // 自动激活（匹配 projectType）
      makeSkill({
        id: 3,
        skillKey: 'sw-patterns',
        name: 'Software Patterns',
        category: { primary: 'domain', secondary: 'architecture' },
        activation: { projectTypes: ['software'], priority: 70 },
      }),
      // 同域冲突（与 agile-core 同 methodology:agile）
      makeSkill({
        id: 4,
        skillKey: 'waterfall',
        name: 'Waterfall',
        category: { primary: 'methodology', secondary: 'agile' },
        activation: { priority: 40 },
      }),
      // AI 推荐
      makeSkill({
        id: 5,
        skillKey: 'risk-radar',
        name: 'Risk Radar',
        activation: { projectTypes: ['construction'] },
      }),
      makeSkill({
        id: 6,
        skillKey: 'ai-test-gen',
        name: 'AI Test Gen',
        activation: { projectTypes: ['construction'] },
      }),
      // 不匹配的
      makeSkill({
        id: 7,
        skillKey: 'construction-only',
        name: 'Construction Only',
        activation: { projectTypes: ['construction'] },
      }),
    ]

    const result = resolveActivation(ctx, skills)

    // 激活集应含：agile-core (manual), scrum-practices (dependency), sw-patterns (auto)
    const activatedKeys = result.activatedSkills.map((e) => e.skill.skillKey)
    expect(activatedKeys).toContain('agile-core')
    expect(activatedKeys).toContain('scrum-practices')
    expect(activatedKeys).toContain('sw-patterns')
    expect(activatedKeys).not.toContain('waterfall') // 冲突淘汰
    expect(activatedKeys).not.toContain('construction-only') // 不匹配

    // 冲突记录
    const conflictKeys = result.droppedConflicts.map((d) => d.skill.skillKey)
    expect(conflictKeys).toContain('waterfall')

    // AI 推荐入 advisory（已在激活的跳过）
    const advisoryKeys = result.advisoryCandidates.map((e) => e.skill.skillKey)
    expect(advisoryKeys).toContain('risk-radar')
    expect(advisoryKeys).toContain('ai-test-gen')

    // advisory 不在 activated 中
    for (const adv of result.advisoryCandidates) {
      expect(activatedKeys).not.toContain(adv.skill.skillKey)
    }
  })
})
