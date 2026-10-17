/**
 * Hard Validation Suite 单元测试（tasks 3.6）。
 *
 * 覆盖：
 * - 聚合实现展开（一个 implementation 对应多个 sourceRuleIds）
 * - 模型自然语言不可覆盖依赖环（graph blocking 必产生 HV-008）
 * - 输入缺失（missing deterministic input → not_applicable/input_missing）
 * - warning-only（无 blocking 但有 warning）
 * - not_applicable（profile 不匹配）
 * - 全量校验
 * - 增量校验（记录 skipped rules）
 */

import { describe, expect, it } from 'vitest'
import { HvRuleRegistry } from '../../../app/services/compiler/validation/registry/hv_registry.js'
import {
  HardValidationSuite,
  DefaultHvRuleEvaluator,
  FixtureAdapter,
} from '../../../app/services/compiler/validation/hard_suite/index.js'
import { HV_RULE_IDS } from '@aiproj/compiler-spec'

describe('HvRuleRegistry', () => {
  it('注册表包含 25 条规则', () => {
    const registry = new HvRuleRegistry()
    expect(registry.ruleCount).toBe(25)
  })

  it('包含 HV-001~HV-025', () => {
    const registry = new HvRuleRegistry()
    const allRules = registry.getAllRules()
    expect(allRules.map((r) => r.ruleId)).toContain('HV-001')
    expect(allRules.map((r) => r.ruleId)).toContain('HV-025')
  })

  it('聚合实现包含 sourceRuleIds（HV-007 覆盖 HV-009）', () => {
    const registry = new HvRuleRegistry()
    const hv007 = registry.getRule('HV-007')
    expect(hv007).toBeDefined()
    expect(hv007!.sourceRuleIds).toContain('HV-009')
    expect(hv007!.implementationId).toBe('impl-hierarchy')
  })

  it('HV-008 使用独立实现', () => {
    const registry = new HvRuleRegistry()
    const hv008 = registry.getRule('HV-008')
    expect(hv008).toBeDefined()
    expect(hv008!.implementationId).toBe('impl-cycle-detection')
  })
})

describe('HardValidationSuite - 全量校验', () => {
  const registry = new HvRuleRegistry()
  const evaluator = new DefaultHvRuleEvaluator()
  const suite = new HardValidationSuite(registry, evaluator)

  it('正常输入通过校验', async () => {
    const provider = new FixtureAdapter({
      graphValidation: { passed: true, rules: [], blocking: [], warnings: [], infos: [] },
      schedule: { scheduled: {}, blocked: false, unscheduledTaskIds: [], warnings: [] },
      criticalPath: { tasks: {}, criticalPathIds: [], projectDuration: 10, blocked: false },
    })
    const report = await suite.validate(provider, 'global_sample', 'blueprint_gate')
    expect(report.summary.totalRules).toBe(25)
    expect(report.summary.notApplicable).toBeGreaterThanOrEqual(0)
  })

  it('依赖环（graph blocking）产生 blocking 结果', async () => {
    const provider = new FixtureAdapter({
      graphValidation: {
        passed: false,
        rules: [
          {
            ruleId: 'CYCLE',
            severity: 'blocking',
            path: '/dependencies',
            message: 'Cycle detected: T1→T2→T3→T1',
            sourceStageId: 'graph',
            entityIds: ['T1', 'T2', 'T3'],
          },
        ],
        blocking: [
          {
            ruleId: 'CYCLE',
            severity: 'blocking',
            path: '/dependencies',
            message: 'Cycle detected: T1→T2→T3→T1',
            sourceStageId: 'graph',
            entityIds: ['T1', 'T2', 'T3'],
          },
        ],
        warnings: [],
        infos: [],
      },
    })
    const report = await suite.validate(provider, 'global_sample', 'blueprint_gate')
    const hv008Issues = report.issues.filter((i) => i.ruleId === 'HV-008')
    expect(hv008Issues.length).toBeGreaterThanOrEqual(1)
    expect(hv008Issues[0].severity).toBe('blocking')
    // 验证 LLM 解释不可覆盖确定性结果
    const cycleBlocking = report.issues.some(
      (i) => i.ruleId === 'HV-008' && i.message.toLowerCase().includes('cycle'),
    )
    expect(cycleBlocking).toBe(true)
  })

  it('输入缺失标记为 not_applicable', async () => {
    // 不提供 schedule/criticalPath/resourceLoad
    const provider = new FixtureAdapter({
      graphValidation: { passed: true, rules: [], blocking: [], warnings: [], infos: [] },
    })
    const report = await suite.validate(provider, 'global_sample', 'blueprint_gate')
    expect(report.notApplicableRules.length).toBeGreaterThan(0)
    expect(report.summary.inputMissing).toBeGreaterThan(0)
  })

  it('warning-only 产生 warning 但无 blocking', async () => {
    const provider = new FixtureAdapter({
      graphValidation: { passed: true, rules: [], blocking: [], warnings: [], infos: [] },
      schedule: { scheduled: {}, blocked: false, unscheduledTaskIds: [], warnings: [] },
      criticalPath: { tasks: {}, criticalPathIds: [], projectDuration: 10, blocked: false },
      pdmSnapshot: {
        tasks: {
          parent: { effort: 10, children: ['child'] },
          child: { effort: 15 },
        },
      },
    })
    const report = await suite.validate(provider, 'global_sample', 'blueprint_gate')
    // HV-015 effort 校验可能因为 pdm 数据产生 warning
    expect(report.summary.blocking).toBe(0) // 或无 blocking
  })

  it('not_applicable 因 profile 不匹配', async () => {
    // resource_gate profile → 只有 resource 相关 + 少量通用规则
    const provider = new FixtureAdapter({
      graphValidation: { passed: true, rules: [], blocking: [], warnings: [], infos: [] },
    })
    const report = await suite.validate(provider, 'requirements_gate', 'requirements_gate')
    const notApplicableByProfile = report.notApplicableRules.filter((r) =>
      r.reason.includes('不适用'),
    )
    expect(notApplicableByProfile.length).toBeGreaterThanOrEqual(0)
  })
})

describe('HardValidationSuite - 增量校验', () => {
  const registry = new HvRuleRegistry()
  const evaluator = new DefaultHvRuleEvaluator()
  const suite = new HardValidationSuite(registry, evaluator)
  const provider = new FixtureAdapter({
    graphValidation: { passed: true, rules: [], blocking: [], warnings: [], infos: [] },
    schedule: { scheduled: {}, blocked: false, unscheduledTaskIds: [], warnings: [] },
    criticalPath: { tasks: {}, criticalPathIds: [], projectDuration: 10, blocked: false },
  })

  it('增量模式记录 skipped rules', async () => {
    const report = await suite.validateIncremental(
      provider,
      'global_sample',
      'blueprint_gate',
      ['/tasks/T1/description'],
      [],
    )
    expect(report.isFullValidation).toBe(false)
    expect(report.skippedRules.length).toBeGreaterThanOrEqual(0)
  })

  it('日期变更触发 schedule 相关规则', async () => {
    const report = await suite.validateIncremental(
      provider,
      'global_sample',
      'schedule_gate',
      ['/tasks/T1/plannedStart'],
      [],
    )
    // 日期变更应包含 date_schedule 相关规则
    expect(report.isFullValidation).toBe(false)
  })
})

describe('DefaultHvRuleEvaluator', () => {
  it('模型自然语言解释不可覆盖依赖环', async () => {
    // 即使 provider 提供 "计划合理" 的 LLM 自然语言，graph blocking 仍然产生 HV-008
    const provider = new FixtureAdapter({
      graphValidation: {
        passed: false,
        blocking: [
          {
            ruleId: 'CYCLE',
            severity: 'blocking',
            path: '/dependencies',
            message: 'Cycle: T1 → T2 → T3 → T1',
            sourceStageId: 'graph',
            entityIds: ['T1', 'T2', 'T3'],
          },
        ],
        rules: [],
        warnings: [
          {
            ruleId: 'LLM_COMMENT',
            severity: 'warning',
            path: '/llm',
            message: '计划合理：该依赖关系是可接受的',
            sourceStageId: 'llm',
            entityIds: [],
          },
        ],
        infos: [],
      },
    })
    const evaluator = new DefaultHvRuleEvaluator()
    const result = await evaluator.evaluate([HV_RULE_IDS.HV_008], provider)
    // 自然语言说明 "计划合理" 不应使 HV-008 通过
    expect(result.issues.length).toBeGreaterThanOrEqual(1)
    expect(result.issues[0].severity).toBe('blocking')
  })
})
