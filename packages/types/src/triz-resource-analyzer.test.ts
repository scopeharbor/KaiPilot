// @aiproj/types — V3 TRIZ 资源分析器共享契约测试
// v3-triz-resource-analyzer / §2.5–§2.7

import { describe, test, expect } from 'vitest'
import {
  RESOURCE_ANALYSIS_RUN_STATUSES,
  RESOURCE_OPPORTUNITY_STATUSES,
  RESOURCE_KINDS,
  SYSTEM_SCOPES,
  RESOURCE_ORIGINS,
  UTILIZATION_STATES,
  AVAILABILITY_LEVELS,
  OPPORTUNITY_TYPES,
  RESOURCE_WARNING_CODES,
  OPPORTUNITY_SEVERITIES,
  RESOURCE_RULESET_VERSION,
  RESOURCE_TAXONOMY_VERSION,
  RESOURCE_SORT_FIELDS,
  computeResourceKey,
  computeResourceOpportunityKey,
  computeResourceAnalysisInputSignature,
  computeResourceAnalysisIdempotencyKey,
  computeResourceOpportunitiesOutputHash,
  computeResourceSnapshotsOutputHash,
  compareResourceOpportunity,
  compareResourceSnapshot,
  resourceSeverityToScore,
  computeResourceOpportunityImpactScore,
  summarizeResourceWarnings,
  isResourceOpportunityStale,
  isResourceAnalysisRunStale,
  availabilityToScore,
  utilizationToOpportunityScore,
  makeResourceAnalysisCollectorOutput,
  makeResourceSnapshotFixture,
  makeResourceOpportunityFixture,
  makeResourceAnalysisRunFixture,
} from './triz-resource-analyzer.js'
import type {
  ResourceSnapshot,
  ResourceOpportunityCandidate,
  ResourceWarningCode,
} from './triz-resource-analyzer.js'

// ---------------------------------------------------------------------------
// 常量目录
// ---------------------------------------------------------------------------

describe('常量目录', () => {
  test('RESOURCE_ANALYSIS_RUN_STATUSES 包含所有必需状态', () => {
    expect(RESOURCE_ANALYSIS_RUN_STATUSES).toContain('queued')
    expect(RESOURCE_ANALYSIS_RUN_STATUSES).toContain('completed')
    expect(RESOURCE_ANALYSIS_RUN_STATUSES).toContain('completed_with_warnings')
    expect(RESOURCE_ANALYSIS_RUN_STATUSES).toContain('failed')
    expect(RESOURCE_ANALYSIS_RUN_STATUSES).toContain('stale')
    expect(RESOURCE_ANALYSIS_RUN_STATUSES).toContain('archived')
    expect(RESOURCE_ANALYSIS_RUN_STATUSES).toHaveLength(6)
  })

  test('RESOURCE_OPPORTUNITY_STATUSES 包含所有审查状态', () => {
    expect(RESOURCE_OPPORTUNITY_STATUSES).toContain('unreviewed')
    expect(RESOURCE_OPPORTUNITY_STATUSES).toContain('reviewed')
    expect(RESOURCE_OPPORTUNITY_STATUSES).toContain('previewed')
    expect(RESOURCE_OPPORTUNITY_STATUSES).toContain('blocked_stale')
    expect(RESOURCE_OPPORTUNITY_STATUSES).toContain('dismissed')
  })

  test('RESOURCE_KINDS 覆盖全部 TRIZ 资源种类', () => {
    expect(RESOURCE_KINDS).toHaveLength(10)
    expect(RESOURCE_KINDS).toContain('human')
    expect(RESOURCE_KINDS).toContain('material')
    expect(RESOURCE_KINDS).toContain('field')
    expect(RESOURCE_KINDS).toContain('information')
    expect(RESOURCE_KINDS).toContain('functional')
  })

  test('SYSTEM_SCOPES 包含四个作用域', () => {
    expect(SYSTEM_SCOPES).toHaveLength(4)
    expect(SYSTEM_SCOPES).toContain('internal_system')
    expect(SYSTEM_SCOPES).toContain('subsystem')
    expect(SYSTEM_SCOPES).toContain('supersystem')
    expect(SYSTEM_SCOPES).toContain('external_environment')
  })

  test('RESOURCE_ORIGINS 包含所有来源', () => {
    expect(RESOURCE_ORIGINS).toHaveLength(11)
    expect(RESOURCE_ORIGINS).toContain('project_registry')
    expect(RESOURCE_ORIGINS).toContain('user_supplied')
  })

  test('OPPORTUNITY_TYPES 覆盖 spec 要求的 9 种机会类型', () => {
    expect(OPPORTUNITY_TYPES).toHaveLength(9)
    expect(OPPORTUNITY_TYPES).toContain('idle_capacity')
    expect(OPPORTUNITY_TYPES).toContain('substitute_resource')
    expect(OPPORTUNITY_TYPES).toContain('reuse_existing_asset')
    expect(OPPORTUNITY_TYPES).toContain('external_low_cost_resource')
    expect(OPPORTUNITY_TYPES).toContain('information_gap')
    expect(OPPORTUNITY_TYPES).toContain('automation_opportunity')
    expect(OPPORTUNITY_TYPES).toContain('overload_relief')
    expect(OPPORTUNITY_TYPES).toContain('environmental_resource')
    expect(OPPORTUNITY_TYPES).toContain('constraint_as_resource')
  })

  test('RESOURCE_WARNING_CODES 包含 10 项', () => {
    expect(RESOURCE_WARNING_CODES).toHaveLength(10)
    expect(RESOURCE_WARNING_CODES).toContain('DATA_SOURCE_UNAVAILABLE')
    expect(RESOURCE_WARNING_CODES).toContain('INSUFFICIENT_RESOURCE_SOURCE')
    expect(RESOURCE_WARNING_CODES).toContain('HANDOFF_BLOCKED_STALE')
  })

  test('版本常量不为空', () => {
    expect(RESOURCE_RULESET_VERSION).toBe('1.0.0')
    expect(RESOURCE_TAXONOMY_VERSION).toBe('1.0.0')
  })

  test('RESOURCE_SORT_FIELDS 包含必要字段', () => {
    expect(RESOURCE_SORT_FIELDS).toHaveLength(5)
    expect(RESOURCE_SORT_FIELDS).toContain('createdAt')
    expect(RESOURCE_SORT_FIELDS).toContain('severity')
    expect(RESOURCE_SORT_FIELDS).toContain('impactScore')
  })
})

// ---------------------------------------------------------------------------
// 确定性纯函数
// ---------------------------------------------------------------------------

describe('确定性纯函数', () => {
  describe('computeResourceKey', () => {
    test('同输入同输出', () => {
      const k1 = computeResourceKey('human', 'project_registry', '张三')
      const k2 = computeResourceKey('human', 'project_registry', '张三')
      expect(k1).toBe(k2)
      expect(k1).toMatch(/^res-/)
    })

    test('不同输入不同输出', () => {
      const k1 = computeResourceKey('human', 'project_registry', '张三')
      const k2 = computeResourceKey('technical', 'project_registry', '服务器')
      expect(k1).not.toBe(k2)
    })

    test('不同标签产生不同 key', () => {
      const k1 = computeResourceKey('human', 'project_registry', 'A')
      const k2 = computeResourceKey('human', 'project_registry', 'B')
      expect(k1).not.toBe(k2)
    })
  })

  describe('computeResourceOpportunityKey', () => {
    test('同输入同输出', () => {
      const k1 = computeResourceOpportunityKey('idle_capacity', 'RO-001', ['res-a', 'res-b'])
      const k2 = computeResourceOpportunityKey('idle_capacity', 'RO-001', ['res-a', 'res-b'])
      expect(k1).toBe(k2)
      expect(k1).toMatch(/^rop-/)
    })

    test('资源 key 顺序无关', () => {
      const k1 = computeResourceOpportunityKey('idle_capacity', 'RO-001', ['res-b', 'res-a'])
      const k2 = computeResourceOpportunityKey('idle_capacity', 'RO-001', ['res-a', 'res-b'])
      expect(k1).toBe(k2)
    })

    test('不同机会类型不同输出', () => {
      const k1 = computeResourceOpportunityKey('idle_capacity', 'RO-001', ['res-a'])
      const k2 = computeResourceOpportunityKey('substitute_resource', 'RO-001', ['res-a'])
      expect(k1).not.toBe(k2)
    })
  })

  describe('computeResourceAnalysisInputSignature', () => {
    test('同输入同输出', () => {
      const c1 = makeResourceAnalysisCollectorOutput()
      const c2 = makeResourceAnalysisCollectorOutput()
      expect(computeResourceAnalysisInputSignature(c1)).toBe(
        computeResourceAnalysisInputSignature(c2),
      )
    })

    test('前缀为 tra-', () => {
      const collected = makeResourceAnalysisCollectorOutput()
      const sig = computeResourceAnalysisInputSignature(collected)
      expect(sig).toMatch(/^tra-/)
    })

    test('不同 projectId 产生不同签名', () => {
      const c1 = makeResourceAnalysisCollectorOutput({ projectId: 1 })
      const c2 = makeResourceAnalysisCollectorOutput({ projectId: 2 })
      expect(computeResourceAnalysisInputSignature(c1)).not.toBe(
        computeResourceAnalysisInputSignature(c2),
      )
    })

    test('不同资源利用率产生不同签名', () => {
      const c1 = makeResourceAnalysisCollectorOutput({ resourceUtilization: 0.5 })
      const c2 = makeResourceAnalysisCollectorOutput({ resourceUtilization: 0.8 })
      expect(computeResourceAnalysisInputSignature(c1)).not.toBe(
        computeResourceAnalysisInputSignature(c2),
      )
    })

    test('userContext 差异影响签名', () => {
      const c1 = makeResourceAnalysisCollectorOutput({ userContext: 'A' })
      const c2 = makeResourceAnalysisCollectorOutput({ userContext: 'B' })
      expect(computeResourceAnalysisInputSignature(c1)).not.toBe(
        computeResourceAnalysisInputSignature(c2),
      )
    })
  })

  describe('computeResourceAnalysisIdempotencyKey', () => {
    test('同参数同输出', () => {
      const sig = 'tra-abc'
      const k1 = computeResourceAnalysisIdempotencyKey(1, 2, 3, sig)
      const k2 = computeResourceAnalysisIdempotencyKey(1, 2, 3, sig)
      expect(k1).toBe(k2)
      expect(k1).toMatch(/^tra-idem-/)
    })

    test('不同 org 不同输出', () => {
      const sig = 'tra-abc'
      const k1 = computeResourceAnalysisIdempotencyKey(1, 2, 3, sig)
      const k2 = computeResourceAnalysisIdempotencyKey(9, 2, 3, sig)
      expect(k1).not.toBe(k2)
    })

    test('用户提供的 key 覆盖推导', () => {
      const sig = 'tra-abc'
      const k1 = computeResourceAnalysisIdempotencyKey(1, 2, 3, sig)
      const k2 = computeResourceAnalysisIdempotencyKey(1, 2, 3, sig, 'my-custom-key')
      expect(k1).not.toBe(k2)
    })

    test('用户提供的 key 稳定', () => {
      const sig = 'tra-abc'
      const k1 = computeResourceAnalysisIdempotencyKey(1, 2, 3, sig, 'custom')
      const k2 = computeResourceAnalysisIdempotencyKey(1, 2, 3, sig, 'custom')
      expect(k1).toBe(k2)
    })
  })

  describe('computeResourceOpportunitiesOutputHash', () => {
    test('相同机会列表产生相同 hash', () => {
      const h1 = computeResourceOpportunitiesOutputHash([
        { opportunityKey: 'rop-a' },
        { opportunityKey: 'rop-b' },
      ])
      const h2 = computeResourceOpportunitiesOutputHash([
        { opportunityKey: 'rop-a' },
        { opportunityKey: 'rop-b' },
      ])
      expect(h1).toBe(h2)
    })

    test('空数组也有 hash', () => {
      const h = computeResourceOpportunitiesOutputHash([])
      expect(h).toMatch(/^tro-/)
    })

    test('排序无关', () => {
      const h1 = computeResourceOpportunitiesOutputHash([
        { opportunityKey: 'rop-b' },
        { opportunityKey: 'rop-a' },
      ])
      const h2 = computeResourceOpportunitiesOutputHash([
        { opportunityKey: 'rop-a' },
        { opportunityKey: 'rop-b' },
      ])
      expect(h1).toBe(h2)
    })
  })

  describe('computeResourceSnapshotsOutputHash', () => {
    test('相同资源列表相同 hash', () => {
      const h1 = computeResourceSnapshotsOutputHash([
        { resourceKey: 'res-a' },
        { resourceKey: 'res-b' },
      ])
      const h2 = computeResourceSnapshotsOutputHash([
        { resourceKey: 'res-a' },
        { resourceKey: 'res-b' },
      ])
      expect(h1).toBe(h2)
    })

    test('空数组也有 hash', () => {
      const h = computeResourceSnapshotsOutputHash([])
      expect(h).toMatch(/^trs-/)
    })
  })

  describe('compareResourceOpportunity', () => {
    test('按严重度排序（critical > high > medium > low）', () => {
      const critical = makeResourceOpportunityFixture({ opportunityKey: 'c', severity: 'critical' })
      const high = makeResourceOpportunityFixture({ opportunityKey: 'h', severity: 'high' })
      expect(compareResourceOpportunity(critical, high)).toBeLessThan(0)
      expect(compareResourceOpportunity(high, critical)).toBeGreaterThan(0)
    })

    test('同严重度按置信度', () => {
      const a = makeResourceOpportunityFixture({ severity: 'high', confidence: 0.9 })
      const b = makeResourceOpportunityFixture({ severity: 'high', confidence: 0.7 })
      expect(compareResourceOpportunity(a, b)).toBeLessThan(0)
    })

    test('同严重度+置信度按 impactScore', () => {
      const a = makeResourceOpportunityFixture({
        severity: 'high',
        confidence: 0.8,
        impactScore: 0.9,
      })
      const b = makeResourceOpportunityFixture({
        severity: 'high',
        confidence: 0.8,
        impactScore: 0.5,
      })
      expect(compareResourceOpportunity(a, b)).toBeLessThan(0)
    })

    test('全部相同按 opportunityKey 排序', () => {
      const a = makeResourceOpportunityFixture({ opportunityKey: 'rop-a' })
      const b = makeResourceOpportunityFixture({ opportunityKey: 'rop-b' })
      const result = compareResourceOpportunity(a, b)
      // a key < b key → a first
      expect(result).toBeLessThan(0)
    })
  })

  describe('compareResourceSnapshot', () => {
    test('按种类排序', () => {
      const a = makeResourceSnapshotFixture({ resourceKind: 'human', resourceKey: 'r1' })
      const b = makeResourceSnapshotFixture({ resourceKind: 'technical', resourceKey: 'r2' })
      expect(compareResourceSnapshot(a, b)).toBeLessThan(0)
    })

    test('同种类按作用域', () => {
      const a = makeResourceSnapshotFixture({
        resourceKind: 'human',
        systemScope: 'internal_system',
      })
      const b = makeResourceSnapshotFixture({ resourceKind: 'human', systemScope: 'supersystem' })
      expect(compareResourceSnapshot(a, b)).toBeLessThan(0)
    })

    test('全部相同按 resourceKey', () => {
      const a = makeResourceSnapshotFixture({
        resourceKind: 'human',
        systemScope: 'internal_system',
        origin: 'project_registry',
        resourceKey: 'res-a',
      })
      const b = makeResourceSnapshotFixture({
        resourceKind: 'human',
        systemScope: 'internal_system',
        origin: 'project_registry',
        resourceKey: 'res-b',
      })
      expect(compareResourceSnapshot(a, b)).toBeLessThan(0)
    })
  })

  describe('resourceSeverityToScore', () => {
    test('critical = 1.0', () => {
      expect(resourceSeverityToScore('critical')).toBeCloseTo(1.0)
    })
    test('high = 0.75', () => {
      expect(resourceSeverityToScore('high')).toBeCloseTo(0.75)
    })
    test('medium = 0.5', () => {
      expect(resourceSeverityToScore('medium')).toBeCloseTo(0.5)
    })
    test('low = 0.25', () => {
      expect(resourceSeverityToScore('low')).toBeCloseTo(0.25)
    })
  })

  describe('computeResourceOpportunityImpactScore', () => {
    test('范围在 0-1', () => {
      const score = computeResourceOpportunityImpactScore('high', 0.8, 3)
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThanOrEqual(1)
    })

    test('critical + 高置信 + 多资源 = 高分', () => {
      const score = computeResourceOpportunityImpactScore('critical', 1.0, 10)
      expect(score).toBeGreaterThan(0.9)
    })

    test('low + 低置信 + 少资源 = 低分', () => {
      const score = computeResourceOpportunityImpactScore('low', 0.2, 1)
      expect(score).toBeLessThan(0.4)
    })
  })

  describe('summarizeResourceWarnings', () => {
    test('空警告返回空字符串', () => {
      expect(summarizeResourceWarnings([])).toBe('')
    })

    test('单个警告返回标签', () => {
      const summary = summarizeResourceWarnings(['DATA_SOURCE_UNAVAILABLE'])
      expect(summary).toBe('数据来源不可用')
    })

    test('多个警告用全角分号连接', () => {
      const summary = summarizeResourceWarnings([
        'DATA_SOURCE_UNAVAILABLE',
        'AI_EXPLANATION_FALLBACK',
      ])
      expect(summary).toContain('；')
      expect(summary).toContain('数据来源不可用')
      expect(summary).toContain('AI 解释已降级')
    })

    test('未知 warning 用原始 code', () => {
      const summary = summarizeResourceWarnings(['UNKNOWN_CODE' as ResourceWarningCode])
      expect(summary).toBe('UNKNOWN_CODE')
    })
  })

  describe('isResourceOpportunityStale', () => {
    test('hash 匹配不 stale', () => {
      const stale = isResourceOpportunityStale({ src1: 'abc' }, { src1: 'abc' })
      expect(stale).toBe(false)
    })

    test('hash 不匹配 stale', () => {
      const stale = isResourceOpportunityStale({ src1: 'abc' }, { src1: 'def' })
      expect(stale).toBe(true)
    })

    test('当前缺失 key 不算 stale', () => {
      const stale = isResourceOpportunityStale({ src1: 'abc', src2: 'def' }, { src1: 'abc' })
      expect(stale).toBe(false)
    })

    test('新来源不影响 stale', () => {
      const stale = isResourceOpportunityStale({ src1: 'abc' }, { src1: 'abc', src2: 'new' })
      expect(stale).toBe(false)
    })
  })

  describe('isResourceAnalysisRunStale', () => {
    test('代理到 isResourceOpportunityStale', () => {
      expect(isResourceAnalysisRunStale({ s: 'a' }, { s: 'a' })).toBe(false)
      expect(isResourceAnalysisRunStale({ s: 'a' }, { s: 'b' })).toBe(true)
    })
  })

  describe('availabilityToScore', () => {
    test('high = 1.0', () => expect(availabilityToScore('high')).toBeCloseTo(1.0))
    test('medium = 0.6', () => expect(availabilityToScore('medium')).toBeCloseTo(0.6))
    test('low = 0.3', () => expect(availabilityToScore('low')).toBeCloseTo(0.3))
    test('none = 0.0', () => expect(availabilityToScore('none')).toBeCloseTo(0.0))
    test('unknown = 0.2', () => expect(availabilityToScore('unknown')).toBeCloseTo(0.2))
  })

  describe('utilizationToOpportunityScore', () => {
    test('idle = 1.0（最大机会）', () =>
      expect(utilizationToOpportunityScore('idle')).toBeCloseTo(1.0))
    test('partially_utilized = 0.7', () =>
      expect(utilizationToOpportunityScore('partially_utilized')).toBeCloseTo(0.7))
    test('fully_utilized = 0.1', () =>
      expect(utilizationToOpportunityScore('fully_utilized')).toBeCloseTo(0.1))
    test('overloaded = 0.4', () =>
      expect(utilizationToOpportunityScore('overloaded')).toBeCloseTo(0.4))
  })
})

// ---------------------------------------------------------------------------
// 夹具构造器
// ---------------------------------------------------------------------------

describe('夹具构造器', () => {
  test('makeResourceAnalysisCollectorOutput 返回合法对象', () => {
    const out = makeResourceAnalysisCollectorOutput()
    expect(out.organizationId).toBe(1)
    expect(out.projectName).toBeTruthy()
    expect(out.sourceHashes).toBeDefined()
  })

  test('makeResourceAnalysisCollectorOutput 支持 overrides', () => {
    const out = makeResourceAnalysisCollectorOutput({ projectId: 99, taskTotal: 100 })
    expect(out.projectId).toBe(99)
    expect(out.taskTotal).toBe(100)
    // 非 overrides 字段保持默认
    expect(out.organizationId).toBe(1)
  })

  test('makeResourceSnapshotFixture 返回合法快照', () => {
    const snap = makeResourceSnapshotFixture()
    expect(snap.resourceKey).toMatch(/^res-/)
    expect(RESOURCE_KINDS).toContain(snap.resourceKind)
    expect(snap.sourceRefs).toHaveLength(1)
  })

  test('makeResourceSnapshotFixture 支持 overrides', () => {
    const snap = makeResourceSnapshotFixture({
      resourceKind: 'financial',
      capacity: '¥50000',
    })
    expect(snap.resourceKind).toBe('financial')
    expect(snap.capacity).toBe('¥50000')
  })

  test('makeResourceOpportunityFixture 返回合法候选', () => {
    const opp = makeResourceOpportunityFixture()
    expect(opp.opportunityKey).toMatch(/^rop-/)
    expect(OPPORTUNITY_TYPES).toContain(opp.opportunityType)
    expect(opp.status).toBe('unreviewed')
    expect(opp.suggestedActions).toHaveLength(3)
  })

  test('makeResourceOpportunityFixture 支持 overrides', () => {
    const opp = makeResourceOpportunityFixture({
      opportunityType: 'substitute_resource',
      severity: 'critical',
      status: 'reviewed',
    })
    expect(opp.opportunityType).toBe('substitute_resource')
    expect(opp.severity).toBe('critical')
    expect(opp.status).toBe('reviewed')
  })

  test('makeResourceAnalysisRunFixture 返回合法运行', () => {
    const run = makeResourceAnalysisRunFixture()
    expect(run.id).toBe(1)
    expect(run.organizationId).toBe(1)
    expect(run.status).toBe('completed_with_warnings')
    expect(run.resourceCount).toBe(10)
    expect(run.opportunityCount).toBe(3)
    expect(run.ruleVersion).toBe(RESOURCE_RULESET_VERSION)
    expect(run.taxonomyVersion).toBe(RESOURCE_TAXONOMY_VERSION)
  })

  test('makeResourceAnalysisRunFixture 支持 overrides', () => {
    const run = makeResourceAnalysisRunFixture({ status: 'stale', resourceCount: 5 })
    expect(run.status).toBe('stale')
    expect(run.resourceCount).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// 夹具脱敏（hidden sources 不泄露）
// ---------------------------------------------------------------------------

describe('夹具脱敏', () => {
  test('hidden source（PERMISSION_RESTRICTED）不泄露来源详情', () => {
    const opp = makeResourceOpportunityFixture({
      warningCodes: ['PERMISSION_RESTRICTED'],
    })
    // 警告存在但 sourceRefs 不包含敏感路径
    expect(opp.warningCodes).toContain('PERMISSION_RESTRICTED')
    for (const ref of opp.resourceRefs) {
      expect(ref.lowSensitiveTitle).toBeTruthy()
      // 不会泄露敏感 token/secret
      expect(ref.lowSensitiveTitle).not.toMatch(/token|secret|password|Authorization/i)
    }
  })

  test('hidden source ref 的 entityId 可为 null', () => {
    const snap = makeResourceSnapshotFixture({
      sourceRefs: [
        {
          origin: 'project_registry',
          entityType: 'resource',
          entityId: null,
          lowSensitiveTitle: '已脱敏资源',
          hash: 'redacted-hash',
        },
      ],
    })
    expect(snap.sourceRefs[0].entityId).toBeNull()
    expect(snap.sourceRefs[0].lowSensitiveTitle).toBe('已脱敏资源')
  })
})

// ---------------------------------------------------------------------------
// 大 fixture 性能探针 (§2.7 P1)
// ---------------------------------------------------------------------------

describe('大 fixture 性能', () => {
  test('500 个资源快照 hash 在 500ms 内完成', () => {
    const resources: Pick<ResourceSnapshot, 'resourceKey'>[] = []
    for (let i = 0; i < 500; i++) {
      resources.push({
        resourceKey: computeResourceKey('technical', 'project_registry', `设备-${i}`),
      })
    }
    const start = performance.now()
    const hash = computeResourceSnapshotsOutputHash(resources)
    const duration = performance.now() - start
    expect(hash).toMatch(/^trs-/)
    expect(duration).toBeLessThan(500)
  })

  test('1000 个机会候选 hash 在 500ms 内完成', () => {
    const opps: Pick<ResourceOpportunityCandidate, 'opportunityKey'>[] = []
    for (let i = 0; i < 1000; i++) {
      opps.push({
        opportunityKey: computeResourceOpportunityKey('idle_capacity', `RO-${(i % 9) + 1}`, [
          `res-${i}`,
          `res-${i + 1}`,
        ]),
      })
    }
    const start = performance.now()
    const hash = computeResourceOpportunitiesOutputHash(opps)
    const duration = performance.now() - start
    expect(hash).toMatch(/^tro-/)
    expect(duration).toBeLessThan(500)
  })

  test('500 个机会候选排序确定性', () => {
    const opps: ResourceOpportunityCandidate[] = []
    for (let i = 0; i < 500; i++) {
      opps.push(
        makeResourceOpportunityFixture({
          opportunityKey: `rop-${i}`,
          severity:
            i % 4 === 0 ? 'critical' : i % 4 === 1 ? 'high' : i % 4 === 2 ? 'medium' : 'low',
          confidence: 0.5 + (i % 10) * 0.05,
          impactScore: 0.3 + (i % 7) * 0.1,
        }),
      )
    }
    const sorted1 = [...opps].sort(compareResourceOpportunity)
    const sorted2 = [...opps].sort(compareResourceOpportunity)
    expect(sorted1.map((o) => o.opportunityKey)).toEqual(sorted2.map((o) => o.opportunityKey))
  })

  test('1000 个机会候选的性能上限', () => {
    const opps: ResourceOpportunityCandidate[] = []
    for (let i = 0; i < 1000; i++) {
      opps.push(
        makeResourceOpportunityFixture({
          opportunityKey: `rop-${i}`,
          severity: i % 4 === 0 ? 'high' : 'medium',
          confidence: 0.5 + (i % 20) * 0.025,
          impactScore: 0.3 + (i % 10) * 0.07,
        }),
      )
    }
    const start = performance.now()
    const sorted = [...opps].sort(compareResourceOpportunity)
    const duration = performance.now() - start
    expect(sorted).toHaveLength(1000)
    // 1000 候选排序应在 200ms 内
    expect(duration).toBeLessThan(200)
  })
})
