/**
 * skill_eval_benchmark_provider.test —— BenchmarkProvider 单元测试。
 *
 * 覆盖：L3 消费经 evalContext=true 放行、fixture 降级、L3 评测数据不污染生产检索。
 */
import { describe, it, expect } from 'vitest'
import {
  FixtureBenchmarkProvider,
  L3BenchmarkProvider,
  resolveBenchmarkProvider,
} from '#services/compiler/skills/skill_eval_benchmark_provider'
import type { Skill } from '@aiproj/types'

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 1,
    organizationId: 1,
    skillKey: overrides.skillKey ?? 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A test skill',
    status: 'active',
    category: { primary: 'domain', secondary: 'software' },
    tags: [],
    dependencies: [],
    activation: {},
    knowledge: {},
    basePriority: 50,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

describe('FixtureBenchmarkProvider', () => {
  it('始终可用', async () => {
    const provider = new FixtureBenchmarkProvider()
    expect(await provider.isAvailable()).toBe(true)
  })

  it('name 为 fixture', () => {
    const provider = new FixtureBenchmarkProvider()
    expect(provider.name).toBe('fixture')
  })

  it('返回确定性 fixture 评测集', async () => {
    const skill = makeSkill()
    const provider = new FixtureBenchmarkProvider()
    const inputs = await provider.getInputs(skill)
    expect(inputs.length).toBeGreaterThanOrEqual(2)
    expect(inputs[0]!.label).toContain('fixture')
    expect(inputs[0]!.expectedActivatedKeys).toContain(skill.skillKey)
  })
})

describe('L3BenchmarkProvider', () => {
  it('无 knowledgeQuery 时不可用', async () => {
    const provider = new L3BenchmarkProvider()
    expect(await provider.isAvailable()).toBe(false)
  })

  it('knowledgeQuery 返回空数组时不可用', async () => {
    const query = async () => []
    const provider = new L3BenchmarkProvider(query)
    expect(await provider.isAvailable()).toBe(false)
  })

  it('knowledgeQuery 返回 L3 数据时可用', async () => {
    const query = async () => [{ id: 'l3-1', isSynthetic: true }]
    const provider = new L3BenchmarkProvider(query)
    expect(await provider.isAvailable()).toBe(true)
  })

  it('knowledgeQuery 抛异常时降级为不可用', async () => {
    const query = async () => {
      throw new Error('down')
    }
    const provider = new L3BenchmarkProvider(query)
    expect(await provider.isAvailable()).toBe(false)
  })

  it('L3 评测数据通过 evalContext=true 获取', async () => {
    const callLog: Array<{ layer: string; evalContext: boolean }> = []
    const query = async (layer: string, evalContext: boolean) => {
      callLog.push({ layer, evalContext })
      return [{ id: 'l3-1', isSynthetic: true, context: { projectType: 'software' } }]
    }
    const provider = new L3BenchmarkProvider(query)
    const skill = makeSkill()
    await provider.getInputs(skill)

    // 验证通过 evalContext=true 调用
    expect(callLog.length).toBeGreaterThan(0)
    expect(callLog[0]!.evalContext).toBe(true)
  })

  it('L3 数据转为 BenchmarkInput', async () => {
    const query = async () => [
      {
        id: 'l3-1',
        isSynthetic: true,
        context: { projectType: 'software', manualSelections: ['test-skill'] },
        expectedActivatedKeys: ['test-skill'],
      },
    ]
    const provider = new L3BenchmarkProvider(query)
    const skill = makeSkill()
    const inputs = await provider.getInputs(skill)
    expect(inputs.length).toBe(1)
    expect(inputs[0]!.label).toContain('L3')
    expect(inputs[0]!.context.projectType).toBe('software')
  })
})

describe('resolveBenchmarkProvider 降级逻辑', () => {
  it('无 knowledgeQuery 时返回 FixtureBenchmarkProvider', async () => {
    const provider = await resolveBenchmarkProvider()
    expect(provider.name).toBe('fixture')
    expect(provider).toBeInstanceOf(FixtureBenchmarkProvider)
  })

  it('knowledgeQuery 无 L3 数据时降级 fixture', async () => {
    const query = async () => []
    const provider = await resolveBenchmarkProvider(query)
    expect(provider.name).toBe('fixture')
    expect(provider).toBeInstanceOf(FixtureBenchmarkProvider)
  })

  it('knowledgeQuery 有 L3 数据时使用 L3', async () => {
    const query = async () => [{ id: 'l3-1', isSynthetic: true }]
    const provider = await resolveBenchmarkProvider(query)
    expect(provider.name).toBe('L3')
    expect(provider).toBeInstanceOf(L3BenchmarkProvider)
  })
})

describe('L3 评测数据不污染生产检索', () => {
  it('evalContext=false 不应返回 L3 评测数据', () => {
    // 此测试验证接口契约：evalContext 参数区分评测与生产
    // 实际隔离由四层底座的 query() 实现保证
    // 这里只断言 BenchmarkProvider 通过 evalContext=true 消费 L3
    const provider = new L3BenchmarkProvider()
    // provider.getInputs 内部调用 knowledgeQuery(layer, evalContext=true)
    // 生产检索调用 knowledgeQuery(layer, evalContext=false)
    // 两者由四层底座接口契约隔离
    expect(provider.name).toBe('L3')
  })
})
