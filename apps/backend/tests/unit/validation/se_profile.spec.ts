/**
 * Soft Evaluator 维度注册表与 Evaluation Profile 单元测试（tasks 4.5）。
 *
 * 覆盖：
 * - 维度注册表 17 维
 * - 普通 Stage 跳过（profile enabledByDefault=false）
 * - WBS Gate 选择维度子集（非全量 17 维）
 * - 预算配置
 * - 维度权重计算
 */

import { describe, expect, it } from 'vitest'
import { SeDimensionRegistry } from '../../../app/services/compiler/validation/registry/se_dimension_registry.js'
import { EvaluationProfileService } from '../../../app/services/compiler/validation/registry/evaluation_profiles.js'

describe('SeDimensionRegistry', () => {
  it('包含 17 个维度', () => {
    const registry = new SeDimensionRegistry()
    expect(registry.dimensionCount).toBe(17)
  })

  it('包含 SE-WBS-01~SE-COMM-02', () => {
    const registry = new SeDimensionRegistry()
    const all = registry.getAllDimensions()
    expect(all.map((d) => d.dimensionId)).toContain('SE-WBS-01')
    expect(all.map((d) => d.dimensionId)).toContain('SE-COMM-02')
  })

  it('按分组获取维度', () => {
    const registry = new SeDimensionRegistry()
    const wbsDims = registry.getByGroup('wbs')
    expect(wbsDims).toHaveLength(3)
    const commDims = registry.getByGroup('communication')
    expect(commDims).toHaveLength(2)
  })
})

describe('EvaluationProfileService', () => {
  const dimensionRegistry = new SeDimensionRegistry()
  const profileService = new EvaluationProfileService(dimensionRegistry)

  it('包含 6 个默认 profile', () => {
    const profiles = profileService.getAllProfiles()
    expect(profiles).toHaveLength(6)
    const ids = profiles.map((p) => p.profileId)
    expect(ids).toContain('requirements_gate')
    expect(ids).toContain('blueprint_gate')
    expect(ids).toContain('wbs_gate')
    expect(ids).toContain('schedule_gate')
    expect(ids).toContain('resource_gate')
    expect(ids).toContain('global_sample')
  })

  it('普通 Stage 默认不触发 Soft Evaluator（enabledByDefault=false）', () => {
    const reqGate = profileService.getProfile('requirements_gate')
    expect(reqGate).toBeDefined()
    // requirements_gate 的 enabledByDefault 为 false → 默认跳过
    expect(reqGate!.enabledByDefault).toBe(false)

    // wbs_gate / blueprint_gate / schedule_gate 为 true → 关键关卡自动触发
    const wbsGate = profileService.getProfile('wbs_gate')
    expect(wbsGate!.enabledByDefault).toBe(true)
  })

  it('WBS Gate 只选择维度子集（非全量 17 维）', () => {
    const resolved = profileService.resolveDimensions('wbs_gate')
    // WBS gate profile 定义 9 个维度，非全量 17
    expect(resolved.dimensions.length).toBeLessThan(17)
    expect(resolved.dimensions.length).toBe(9)
    // 验证选择了 WBS 相关维度和交付物维度
    expect(resolved.dimensions.some((d) => d.dimensionId === 'SE-WBS-01')).toBe(true)
    expect(resolved.dimensions.some((d) => d.dimensionId === 'SE-DEL-01')).toBe(true)
    // 通信维度不应在 WBS gate 中
    expect(resolved.dimensions.some((d) => d.dimensionId === 'SE-COMM-01')).toBe(false)
  })

  it('预算配置正确', () => {
    const wbsGate = profileService.getProfile('wbs_gate')
    expect(wbsGate!.budgetTokens).toBe(80000)
    expect(wbsGate!.budgetCalls).toBe(9)

    const resourceGate = profileService.getProfile('resource_gate')
    expect(resourceGate!.budgetTokens).toBe(15000)
    expect(resourceGate!.budgetCalls).toBe(1)
  })

  it('维度权重计算：profile weightOverrides 优先', () => {
    const resolved = profileService.resolveDimensions('wbs_gate')
    const wbs01Weight = resolved.weights['SE-WBS-01']
    expect(wbs01Weight).toBe(0.2) // 来自 wbs_gate profile weightOverrides
  })

  it('global_sample 只选择部分维度', () => {
    const resolved = profileService.resolveDimensions('global_sample')
    expect(resolved.dimensions.length).toBe(7) // 7/17 维度
  })

  it('不存在的 profile 返回空', () => {
    const resolved = profileService.resolveDimensions('non_existent')
    expect(resolved.dimensions).toHaveLength(0)
  })
})
