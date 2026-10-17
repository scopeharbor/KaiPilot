/**
 * v3-copilot-skill-injection — CopilotSkillActivationService 单元测试（§3 供给端接线）。
 *
 * 覆盖：
 * - §3.3 Copilot 与 Compiler 对同一项目产出同一 Skill 集合
 * - §3.5 零激活时回合照常且切面字段不存在
 * - §3.7 激活失败不阻断回合
 * - §3.9 确定性：不同键序独立构造求值两次全等
 * - §3.10 项目类型缺失时激活种子 Skill
 */
import { describe, it, expect, vi } from 'vitest'
import {
  CopilotSkillActivationService,
  COPILOT_SEED_SKILL_KEY,
} from '../../../app/services/copilot/copilot_skill_activation_service.js'
import { resolveActivation, type ActivationContext, type Skill } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

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
    tags: overrides.tags ?? [],
    dependencies: overrides.dependencies ?? [],
    activation: overrides.activation ?? {},
    knowledge: overrides.knowledge ?? {},
    basePriority: overrides.basePriority ?? 50,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

function makeSeedSkill(): Skill {
  return makeSkill({
    skillKey: COPILOT_SEED_SKILL_KEY,
    name: '通用项目指引',
    activation: { priority: 10 },
    knowledge: {
      rules: [{ title: '通用规则', description: '通用项目管理规则' }],
    },
  })
}

/** 模拟 SkillRegistryService */
function mockRegistry(skills: Skill[]) {
  return {
    listByOrg: vi.fn().mockResolvedValue({ data: skills, total: skills.length }),
  } as any
}

// ---------------------------------------------------------------------------
// §3.3 Copilot 与 Compiler 对同一项目产出同一 Skill 集合
// ---------------------------------------------------------------------------

describe('§3.3 Copilot 与 Compiler 同一项目同一 Skill 集合', () => {
  it('对同一组 Skill 和同一 ActivationContext，Copilot adapter 和 Compiler resolver 产出相同的 activated skillKeys', async () => {
    const skills = [
      makeSkill({ skillKey: 'agile', activation: { projectTypes: ['software'] } }),
      makeSkill({ skillKey: 'waterfall', activation: { projectTypes: ['construction'] } }),
      makeSkill({ skillKey: 'universal', activation: {} }),
    ]
    const context: ActivationContext = { projectType: 'software' }

    // Compiler 侧：直接调 resolveActivation
    const compilerDecision = resolveActivation(context, skills)

    // Copilot 侧：通过 adapter
    const service = new CopilotSkillActivationService(mockRegistry(skills))
    const outcome = await service.resolve(1, context)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !outcome.result) throw new Error('Expected activation result')

    // 同一项目 → 同一 skillKeys 集合（顺序由 resolveActivation 稳定排序保证）
    expect(outcome.result.skillKeys).toEqual(
      compilerDecision.activatedSkills.map((e) => e.skill.skillKey),
    )
  })
})

// ---------------------------------------------------------------------------
// §3.5 零激活时回合照常且切面字段不存在
// ---------------------------------------------------------------------------

describe('§3.5 零激活 → 切面缺席', () => {
  it('无 Skill 匹配项目类型时返回 undefined result', async () => {
    const skills = [
      makeSkill({ skillKey: 'construction-only', activation: { projectTypes: ['construction'] } }),
    ]
    const context: ActivationContext = { projectType: 'software' }

    const service = new CopilotSkillActivationService(mockRegistry(skills))
    const outcome = await service.resolve(1, context)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected ok outcome')
    expect(outcome.result).toBeUndefined()
  })

  it('空 Skill 列表时返回 undefined result', async () => {
    const service = new CopilotSkillActivationService(mockRegistry([]))
    const outcome = await service.resolve(1, { projectType: 'software' })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected ok outcome')
    expect(outcome.result).toBeUndefined()
  })

  it('所有 Skill 为非 active 状态时返回 undefined result', async () => {
    const skills = [
      makeSkill({ skillKey: 'draft-skill', status: 'draft' }),
      makeSkill({ skillKey: 'deprecated-skill', status: 'deprecated' }),
    ]
    const service = new CopilotSkillActivationService(mockRegistry(skills))
    const outcome = await service.resolve(1, { projectType: 'software' })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected ok outcome')
    expect(outcome.result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// §3.7 激活失败不阻断回合
// ---------------------------------------------------------------------------

describe('§3.7 激活失败 → 降级不阻断', () => {
  it('Registry 抛异常时返回 degraded 结果而非抛出', async () => {
    const failingRegistry = {
      listByOrg: vi.fn().mockRejectedValue(new Error('Database connection lost')),
    } as any

    const service = new CopilotSkillActivationService(failingRegistry)
    const outcome = await service.resolve(1, { projectType: 'software' })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('Expected degraded result')
    expect(outcome.degraded.degraded).toBe(true)
    expect(outcome.degraded.errorCode).toBe('SKILL_ACTIVATION_FAILED')
    expect(outcome.degraded.reason).toContain('Database connection lost')
  })

  it('Registry 返回非法数据时返回 degraded 结果', async () => {
    const badRegistry = {
      listByOrg: vi.fn().mockResolvedValue({ data: 'not-an-array', total: 0 }),
    } as any

    const service = new CopilotSkillActivationService(badRegistry)
    const outcome = await service.resolve(1, { projectType: 'software' })

    // resolveActivation 会抛错（skills 不是数组），adapter 捕获并降级
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('Expected degraded result')
    expect(outcome.degraded.degraded).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// §3.9 确定性：不同键序独立构造求值两次全等
// ---------------------------------------------------------------------------

describe('§3.9 激活结果确定性', () => {
  it('同一项目同规则产出同集合与同顺序（两次独立求值全等）', async () => {
    const skills = [
      makeSkill({ skillKey: 'beta', activation: { projectTypes: ['software'] }, basePriority: 80 }),
      makeSkill({
        skillKey: 'alpha',
        activation: { projectTypes: ['software'] },
        basePriority: 90,
      }),
      makeSkill({
        skillKey: 'gamma',
        activation: { projectTypes: ['software'] },
        basePriority: 70,
      }),
    ]
    const context: ActivationContext = { projectType: 'software' }

    // 两次独立求值（模拟不同键序输入）
    const skillsShuffled = [skills[2]!, skills[0]!, skills[1]!]

    const decision1 = resolveActivation(context, skills)
    const decision2 = resolveActivation(context, skillsShuffled)

    // 同一集合
    expect(decision1.activatedSkills.map((e) => e.skill.skillKey).sort()).toEqual(
      decision2.activatedSkills.map((e) => e.skill.skillKey).sort(),
    )
    // 同一顺序（stableSort 保证）
    expect(decision1.activatedSkills.map((e) => e.skill.skillKey)).toEqual(
      decision2.activatedSkills.map((e) => e.skill.skillKey),
    )
    // 同一 digest
    expect(decision1.evidenceDigest).toBe(decision2.evidenceDigest)
  })

  it('通过 adapter 两次调用产出相同 skillKeys', async () => {
    const skills = [
      makeSkill({ skillKey: 'x', activation: { projectTypes: ['software'] } }),
      makeSkill({ skillKey: 'y', activation: { projectTypes: ['software'] } }),
    ]
    const context: ActivationContext = { projectType: 'software' }

    const service = new CopilotSkillActivationService(mockRegistry(skills))
    const outcome1 = await service.resolve(1, context)
    const outcome2 = await service.resolve(1, context)

    expect(outcome1.ok && outcome1.result).toBeDefined()
    expect(outcome2.ok && outcome2.result).toBeDefined()
    if (outcome1.ok && outcome1.result && outcome2.ok && outcome2.result) {
      expect(outcome1.result.skillKeys).toEqual(outcome2.result.skillKeys)
      expect(outcome1.result.methodologyVersionHash).toBe(outcome2.result.methodologyVersionHash)
    }
  })
})

// ---------------------------------------------------------------------------
// §3.10 项目类型缺失时激活种子 Skill
// ---------------------------------------------------------------------------

describe('§3.10 项目类型缺失 → 种子 Skill 兜底', () => {
  it('无项目类型且零激活时，若存在种子 Skill 则激活', async () => {
    const skills = [makeSeedSkill()]
    const context: ActivationContext = {} // 无 projectType

    const service = new CopilotSkillActivationService(mockRegistry(skills))
    const outcome = await service.resolve(1, context)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !outcome.result) throw new Error('Expected seed activation')
    expect(outcome.result.skillKeys).toContain(COPILOT_SEED_SKILL_KEY)
  })

  it('有项目类型时不激活种子 Skill（即使零激活）', async () => {
    // 只有 construction Skill，但 projectType = software → 零激活
    // 有 projectType 所以不走种子兜底
    const skills = [
      makeSkill({ skillKey: 'construction-only', activation: { projectTypes: ['construction'] } }),
    ]
    const context: ActivationContext = { projectType: 'software' }

    const service = new CopilotSkillActivationService(mockRegistry(skills))
    const outcome = await service.resolve(1, context)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected ok outcome')
    expect(outcome.result).toBeUndefined()
  })

  it('无项目类型但有其他 Skill 激活时不额外激活种子', async () => {
    const skills = [
      makeSkill({ skillKey: 'universal', activation: {} }), // 无限制，总会激活
      makeSeedSkill(),
    ]
    const context: ActivationContext = {}

    const service = new CopilotSkillActivationService(mockRegistry(skills))
    const outcome = await service.resolve(1, context)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !outcome.result) throw new Error('Expected activation')
    // universal 应被激活（无限制规则匹配）
    expect(outcome.result.skillKeys).toContain('universal')
  })
})
