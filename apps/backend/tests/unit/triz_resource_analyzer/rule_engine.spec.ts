import { test } from '@japa/runner'
import TrizResourceOpportunityRuleEngine from '#services/triz_resource_opportunity_rule_engine'
import {
  makeResourceAnalysisCollectorOutput,
  compareResourceOpportunity,
  RESOURCE_RULESET_VERSION,
  type ManualResourceDraft,
  type ResourceAnalysisCollectorOutput,
} from '@aiproj/types'

// ===========================================================================
// TRIZ 资源机会规则引擎测试（v3-triz-resource-analyzer §4.5）
//
// 规则引擎是纯确定性逻辑：不碰数据库、不调 AI、不写任何正式数据。
// 本套件对 9 条规则 RO-001~RO-009 逐条断言，并覆盖确定性排序与 advisory-only 行为。
// ===========================================================================

const engine = new TrizResourceOpportunityRuleEngine()

function draft(overrides: Partial<ManualResourceDraft> = {}): ManualResourceDraft {
  return {
    label: '合作方闲置测试机',
    resourceKind: 'technical',
    systemScope: 'external_environment',
    origin: 'user_supplied',
    availability: 'high',
    utilizationState: 'idle',
    capacity: '2 台',
    costRating: 'low',
    description: '合作方提供的闲置测试设备',
    ...overrides,
  }
}

function typesOf(input: ResourceAnalysisCollectorOutput): string[] {
  return engine.evaluate(input).opportunities.map((o) => o.opportunityType)
}

test.group('TrizResourceOpportunityRuleEngine — 资源快照', () => {
  test('正式资源摘要逐条转成资源快照并带来源 ref', ({ assert }) => {
    const { resources } = engine.evaluate(makeResourceAnalysisCollectorOutput())

    const registry = resources.filter((r) => r.origin === 'project_registry')
    assert.isAtLeast(registry.length, 3)
    for (const r of registry) {
      assert.match(r.resourceKey, /^res-/)
      assert.isAtLeast(r.sourceRefs.length, 1)
      assert.isString(r.sourceRefs[0]!.hash)
    }
  })

  test('用户补充草稿转成 user_supplied 资源快照', ({ assert }) => {
    const { resources } = engine.evaluate(
      makeResourceAnalysisCollectorOutput({ manualResourceDrafts: [draft()] }),
    )

    const manual = resources.filter((r) => r.origin === 'user_supplied')
    assert.lengthOf(manual, 1)
    assert.equal(manual[0]!.label, '合作方闲置测试机')
    assert.equal(manual[0]!.costRating, 'low')
  })

  test('资源 key 对同一输入稳定复现', ({ assert }) => {
    const input = makeResourceAnalysisCollectorOutput({ manualResourceDrafts: [draft()] })
    const first = engine.evaluate(input).resources.map((r) => r.resourceKey)
    const second = engine.evaluate(input).resources.map((r) => r.resourceKey)
    assert.deepEqual(first, second)
  })

  test('规则版本与共享契约一致', ({ assert }) => {
    assert.equal(engine.ruleVersion, RESOURCE_RULESET_VERSION)
  })
})

test.group('TrizResourceOpportunityRuleEngine — 9 条机会规则', () => {
  test('RO-001 闲置/低利用资源产出 idle_capacity', ({ assert }) => {
    // 默认夹具含 idle 的测试服务器与 partially_utilized 的云存储额度
    assert.include(typesOf(makeResourceAnalysisCollectorOutput()), 'idle_capacity')
  })

  test('RO-002 高成本饱和资源 + 低成本资源产出 substitute_resource', ({ assert }) => {
    // 项目团队为 high cost；活跃风险带来 low cost 的信息资源
    const input = makeResourceAnalysisCollectorOutput({
      resourceUtilization: 0.95,
      activeRiskCount: 3,
    })
    assert.include(typesOf(input), 'substitute_resource')
  })

  test('RO-003 已有 TRIZ 产物产出 reuse_existing_asset', ({ assert }) => {
    const input = makeResourceAnalysisCollectorOutput({
      functionAnalysisRefs: [{ artifactId: 1, shortSummary: '功能分析', hash: 'fa1' }],
    })
    assert.include(typesOf(input), 'reuse_existing_asset')
  })

  test('RO-004 用户补充资源产出 external_low_cost_resource', ({ assert }) => {
    const input = makeResourceAnalysisCollectorOutput({ manualResourceDrafts: [draft()] })
    assert.include(typesOf(input), 'external_low_cost_resource')
  })

  test('RO-005 任务多而知识引用少产出 information_gap', ({ assert }) => {
    const input = makeResourceAnalysisCollectorOutput({ taskTotal: 30, knowledgeRefCount: 1 })
    assert.include(typesOf(input), 'information_gap')

    // 知识引用充足时不再产出
    const rich = makeResourceAnalysisCollectorOutput({ taskTotal: 30, knowledgeRefCount: 8 })
    assert.notInclude(typesOf(rich), 'information_gap')
  })

  test('RO-006 大项目 + 技术资源产出 automation_opportunity', ({ assert }) => {
    const input = makeResourceAnalysisCollectorOutput({ taskTotal: 40 })
    assert.include(typesOf(input), 'automation_opportunity')

    const small = makeResourceAnalysisCollectorOutput({ taskTotal: 5 })
    assert.notInclude(typesOf(small), 'automation_opportunity')
  })

  test('RO-007 超载计数产出 overload_relief', ({ assert }) => {
    const input = makeResourceAnalysisCollectorOutput({ resourceOverloadCount: 2 })
    assert.include(typesOf(input), 'overload_relief')

    const balanced = makeResourceAnalysisCollectorOutput({ resourceOverloadCount: 0 })
    assert.notInclude(typesOf(balanced), 'overload_relief')
  })

  test('RO-008 超系统低利用技术资源产出 environmental_resource', ({ assert }) => {
    // 默认夹具的「云存储额度」是 supersystem + partially_utilized
    assert.include(typesOf(makeResourceAnalysisCollectorOutput()), 'environmental_resource')
  })

  test('RO-009 高风险项产出 constraint_as_resource', ({ assert }) => {
    const input = makeResourceAnalysisCollectorOutput({ highRiskCount: 3, activeRiskCount: 5 })
    assert.include(typesOf(input), 'constraint_as_resource')

    const noRisk = makeResourceAnalysisCollectorOutput({ highRiskCount: 0, activeRiskCount: 0 })
    assert.notInclude(typesOf(noRisk), 'constraint_as_resource')
  })

  test('9 种机会类型在满载输入下全部可达', ({ assert }) => {
    const full = makeResourceAnalysisCollectorOutput({
      taskTotal: 40,
      knowledgeRefCount: 1,
      resourceOverloadCount: 2,
      highRiskCount: 3,
      activeRiskCount: 6,
      resourceUtilization: 0.95,
      functionAnalysisRefs: [{ artifactId: 1, shortSummary: '功能分析', hash: 'fa1' }],
      ifrRefs: [{ artifactId: 2, shortSummary: 'IFR', hash: 'ifr1' }],
      manualResourceDrafts: [draft()],
    })

    const produced = new Set(typesOf(full))
    for (const expected of [
      'idle_capacity',
      'substitute_resource',
      'reuse_existing_asset',
      'external_low_cost_resource',
      'information_gap',
      'automation_opportunity',
      'overload_relief',
      'environmental_resource',
      'constraint_as_resource',
    ]) {
      assert.isTrue(produced.has(expected), `缺少机会类型 ${expected}`)
    }
  })
})

test.group('TrizResourceOpportunityRuleEngine — 确定性与 advisory 边界', () => {
  test('相同输入两次运行产出相同候选 key 序列', ({ assert }) => {
    const input = makeResourceAnalysisCollectorOutput({
      taskTotal: 40,
      knowledgeRefCount: 1,
      resourceOverloadCount: 2,
      highRiskCount: 3,
      manualResourceDrafts: [draft()],
    })
    const first = engine.evaluate(input).opportunities.map((o) => o.opportunityKey)
    const second = engine.evaluate(input).opportunities.map((o) => o.opportunityKey)
    assert.deepEqual(first, second)
  })

  test('候选按共享比较器稳定排序（严重度优先）', ({ assert }) => {
    const input = makeResourceAnalysisCollectorOutput({
      taskTotal: 40,
      knowledgeRefCount: 1,
      resourceOverloadCount: 2,
      highRiskCount: 3,
      manualResourceDrafts: [draft()],
    })
    const opportunities = engine.evaluate(input).opportunities

    const resorted = [...opportunities].sort(compareResourceOpportunity)
    assert.deepEqual(
      opportunities.map((o) => o.opportunityKey),
      resorted.map((o) => o.opportunityKey),
    )
  })

  test('候选一律为 unreviewed 且不携带审查人/AI 引用', ({ assert }) => {
    const { opportunities } = engine.evaluate(
      makeResourceAnalysisCollectorOutput({ resourceOverloadCount: 1, highRiskCount: 1 }),
    )
    assert.isAtLeast(opportunities.length, 1)
    for (const opp of opportunities) {
      assert.equal(opp.status, 'unreviewed')
      assert.isNull(opp.reviewedBy)
      assert.isNull(opp.reviewedAt)
      assert.isNull(opp.aiExplanationRef)
      assert.isNumber(opp.impactScore)
      assert.isAbove(opp.impactScore, 0)
    }
  })

  test('建议动作只用审查导向措辞，不含自动执行文案', ({ assert }) => {
    const { opportunities } = engine.evaluate(
      makeResourceAnalysisCollectorOutput({
        taskTotal: 40,
        knowledgeRefCount: 1,
        resourceOverloadCount: 2,
        highRiskCount: 3,
        manualResourceDrafts: [draft()],
      }),
    )
    const banned = ['自动应用', '一键优化', '自动分配', '自动导出计划', '一键执行']
    for (const opp of opportunities) {
      for (const action of opp.suggestedActions) {
        for (const word of banned) {
          assert.notInclude(action, word)
        }
      }
    }
  })

  test('规则引擎不修改传入的收集输出（无副作用）', ({ assert }) => {
    const input = makeResourceAnalysisCollectorOutput({ manualResourceDrafts: [draft()] })
    const before = JSON.stringify(input)
    engine.evaluate(input)
    assert.equal(JSON.stringify(input), before)
  })

  test('无任何来源时不产出机会而非编造机会', ({ assert }) => {
    const empty = makeResourceAnalysisCollectorOutput({
      projectResourceSummary: [],
      projectResourceCount: 0,
      memberCount: 0,
      taskTotal: 0,
      activeRiskCount: 0,
      highRiskCount: 0,
      resourceOverloadCount: 0,
      knowledgeRefCount: 0,
      manualResourceDrafts: [],
    })
    const { resources, opportunities } = engine.evaluate(empty)
    assert.lengthOf(resources, 0)
    assert.lengthOf(opportunities, 0)
  })

  test('500 资源大夹具在本地预算内完成（<1s）', ({ assert }) => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      resourceId: i + 1,
      label: `资源-${i}`,
      resourceKind: (i % 2 === 0 ? 'technical' : 'human') as 'technical' | 'human',
      systemScope: 'internal_system' as const,
      utilizationState: (i % 3 === 0 ? 'idle' : 'partially_utilized') as
        'idle' | 'partially_utilized',
      availability: 'high' as const,
      hash: `h${i}`,
    }))
    const input = makeResourceAnalysisCollectorOutput({
      projectResourceSummary: many,
      projectResourceCount: many.length,
      taskTotal: 400,
      resourceOverloadCount: 3,
      highRiskCount: 2,
    })

    const started = performance.now()
    const { resources, opportunities } = engine.evaluate(input)
    const elapsed = performance.now() - started

    assert.isAtLeast(resources.length, 500)
    assert.isAtLeast(opportunities.length, 1)
    assert.isBelow(elapsed, 1000)
  })
})
