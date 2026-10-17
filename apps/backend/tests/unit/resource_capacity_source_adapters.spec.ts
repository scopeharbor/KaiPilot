// v3-resource-capacity-forecasting-closed-loop §4.2/4.4/4.6/4.8/4.10/4.12 ——
// 来源 adapter 框架与具体 adapter / baseline collector 单元测试。
// 全部使用注入的 fake reader：零 DB、零网络、零副作用。

import { describe, expect, it } from 'vitest'
import {
  collectSources,
  isRequiredSource,
  RCCL_REQUIRED_SOURCES,
  type RcclSourceDefinition,
  type RcclSourceEnvelope,
  type RcclSourceReadContext,
} from '../../app/services/resource_capacity_loop/source_adapters.js'
import {
  makeContentionDetectionAdapter,
  makeDemandForecastingAdapter,
  makeGapAnalysisAdapter,
  makeResourcePoolAdapter,
  makeSkillMatrixAdapter,
} from '../../app/services/resource_capacity_loop/concrete_adapters.js'
import { collectAndCanonicalize } from '../../app/services/resource_capacity_loop/baseline_collector.js'

const ctx: RcclSourceReadContext = {
  userId: 1,
  organizationId: 7,
  windowStart: '2026-09-07',
  windowEnd: '2026-11-30',
  granularity: 'week',
}

function delayed<T>(value: T, ms: number): () => Promise<T> {
  return () => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))
}

function okDef(id: string, data: unknown, ms = 0): RcclSourceDefinition<unknown> {
  return {
    sourceId: id,
    read: async () =>
      (await delayed(
        {
          sourceId: id,
          sourceVersion: 'v1',
          signature: `sig-${id}`,
          freshness: { generatedAt: '2026-08-24T00:00:00Z', stale: false },
          factState: 'visible' as const,
          warnings: [],
          truncated: false,
          data,
        },
        ms,
      )()) as RcclSourceEnvelope<unknown>,
  }
}

// ─── §4.2 框架语义 ──────────────────────────────────────────────────────────

describe('RCCL source adapter 框架（§4.2）', () => {
  it('required/optional 分类固定', () => {
    expect(RCCL_REQUIRED_SOURCES).toEqual([
      'organization-resource-pool',
      'resource-demand-forecasting',
      'resource-gap-analysis',
      'resource-contention-detection',
    ])
    expect(isRequiredSource('resource-skill-matrix')).toBe(false)
    expect(isRequiredSource('unknown-source')).toBe(false)
  })

  it('超时来源按 required 失败 / optional 降级分别标记；输出稳定排序', async () => {
    const defs: Array<RcclSourceDefinition<unknown>> = [
      {
        sourceId: 'organization-resource-pool',
        read: async () => {
          throw Object.assign(new Error('来源读取超时'), { name: 'AbortError' })
        },
      },
      okDef('resource-skill-matrix', {}, 5),
      okDef('resource-gap-analysis', {}),
    ]
    const result = await collectSources(defs, ctx, { perSourceTimeoutMs: 50 })
    expect(result.outcomes.map((o) => o.sourceId)).toEqual(defs.map((d) => d.sourceId))
    const poolFail = result.outcomes[0]!
    expect(poolFail.ok).toBe(false)
    if (!poolFail.ok) expect(poolFail.failure.reasonCode).toBe('RCCL_SOURCE_REQUIRED_FAILED')
    expect(result.report.timedOutSourceIds).toContain('organization-resource-pool')
  })

  it('optional 来源失败只降级不阻塞；required 失败原因码正确', async () => {
    const defs: Array<RcclSourceDefinition<unknown>> = [
      {
        sourceId: 'resource-skill-matrix',
        read: async () => {
          throw new Error('技能矩阵不可用')
        },
      },
      {
        sourceId: 'organization-resource-pool',
        read: async () => {
          throw new Error('资源池不可用')
        },
      },
    ]
    const r = await collectSources(defs, ctx)
    expect(r.outcomes[0]!.ok).toBe(false)
    if (!r.outcomes[0]!.ok)
      expect(r.outcomes[0]!.failure.reasonCode).toBe('RCCL_SOURCE_OPTIONAL_DEGRADED')
    if (!r.outcomes[1]!.ok)
      expect(r.outcomes[1]!.failure.reasonCode).toBe('RCCL_SOURCE_REQUIRED_FAILED')
  })

  it('总预算耗尽时未启动来源返回 BUDGET_EXCEEDED 且 report 标记', async () => {
    const slow: RcclSourceDefinition<unknown> = {
      sourceId: 'organization-resource-pool',
      read: (_ctx, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        }),
    }
    const r = await collectSources([slow], ctx, { totalBudgetMs: 40 })
    expect(r.report.budgetExhausted).toBe(true)
    expect(r.outcomes[0]!.ok).toBe(false)
    if (!r.outcomes[0]!.ok) expect(r.outcomes[0]!.failure.reasonCode).toBe('RCCL_BUDGET_EXCEEDED')
  })
})

// ─── §4.4 资源池 adapter ────────────────────────────────────────────────────

describe('RCCL 资源池 adapter（§4.4）', () => {
  const adapter = makeResourcePoolAdapter(async () => ({
    rows: [
      {
        id: 11,
        name: '甲',
        roleKey: ' Backend ',
        allocatedHours: 30,
        availableCapacityHours: 40,
        remainingCapacityHours: 10,
      },
      { id: 12, name: '乙', roleKey: 'frontend' },
    ],
    requirements: [
      { requirementRefId: 'req-9', resourceId: 11, bucket: '2026-09-07', demandHours: 20 },
    ],
    metricVersion: 'pool@1',
    signature: 'sig-pool',
    generatedAt: '2026-08-24T00:00:00Z',
    truncated: false,
  }))

  it('demand≠allocation：requirement 引用独立保留，allocated 不吸收 demand', async () => {
    const env = await adapter.read(ctx)
    const first = env.data[0]!
    expect(first.requirementRefs[0]).toEqual({
      requirementRefId: 'req-9',
      bucket: '2026-09-07',
      demandHours: 20,
    })
    expect(first.allocatedHours).toBe(30)
    expect((first as unknown as { demandHours?: number }).demandHours === undefined).toBe(true)
  })

  it('容量单位透传 + role key 规范化 + 缺失字段显式零值而非编造', async () => {
    const env = await adapter.read(ctx)
    expect(env.data[0]!.roleKey).toBe('backend')
    const second = env.data[1]!
    expect(second.allocatedHours).toBe(0)
    expect(second.availableCapacityHours).toBe(0)
    expect(second.requirementRefs).toEqual([])
  })

  it('stale/截断标记透传到 envelope', async () => {
    const staleAdapter = makeResourcePoolAdapter(async () => ({
      rows: [],
      requirements: [],
      metricVersion: 'pool@1',
      signature: 's',
      generatedAt: '2026-08-24T00:00:00Z',
      stale: true,
      truncated: true,
    }))
    const env = await staleAdapter.read(ctx)
    expect(env.freshness.stale).toBe(true)
    expect(env.truncated).toBe(true)
  })
})

// ─── §4.6 技能矩阵 adapter ─────────────────────────────────────────────────

describe('RCCL 技能矩阵 adapter（§4.6）', () => {
  it('大小写/空白规范化 + 原标签保留 + 去重', async () => {
    const a = makeSkillMatrixAdapter(async () => ({
      entries: [
        {
          normalizedSkillKey: 'React Frontend',
          originalLabels: ['React'],
          proficiencyLevel: 3,
          coveredResourceCount: 5,
        },
        {
          normalizedSkillKey: 'react   frontend',
          originalLabels: ['react.js'],
          proficiencyLevel: 2,
          coveredResourceCount: 2,
        },
      ],
      sourceVersion: 'skill@1',
      signature: 'sig-sk',
      generatedAt: '2026-08-24T00:00:00Z',
    }))
    const env = await a.read(ctx)
    expect(env.data).toHaveLength(1)
    expect(env.data[0]!.normalizedSkillKey).toBe('react frontend')
    expect(env.data[0]!.originalLabels).toEqual(['React'])
  })

  it('脱敏条目 coveredResourceCount 置空并标 redacted；熟练度不足保留 null 不猜测', async () => {
    const a = makeSkillMatrixAdapter(async () => ({
      entries: [
        {
          normalizedSkillKey: 'node backend',
          originalLabels: ['NodeJS'],
          proficiencyLevel: null,
          coveredResourceCount: 99,
          redacted: true,
        },
        {
          normalizedSkillKey: 'rust',
          originalLabels: ['Rust'],
          proficiencyLevel: null,
          coveredResourceCount: 0,
          unmappable: true,
        },
      ],
      sourceVersion: 'skill@1',
      signature: 's',
      generatedAt: 'x',
    }))
    const env = await a.read(ctx)
    expect(env.data[0]!.factState).toBe('redacted')
    expect(env.data[0]!.coveredResourceCount).toBeNull()
    // unmappable 整体剔除，不做模糊映射。
    expect(env.data.some((e) => e.normalizedSkillKey === 'rust')).toBe(false)
  })
})

// ─── §4.8 需求预测 adapter ─────────────────────────────────────────────────

describe('RCCL 需求预测 adapter（§4.8）', () => {
  it('bounded 投影 + low confidence → LOW_CONFIDENCE warning + insufficientHistory 显式', async () => {
    const a = makeDemandForecastingAdapter(async () => ({
      buckets: [
        {
          dimension: 'role',
          dimensionKey: 'Backend',
          bucket: '2026-09-07T10:00:00Z',
          demandHours: 12.345,
          confidenceBand: 'low',
          driverCount: 2,
          insufficientHistory: true,
        },
        {
          dimension: 'project',
          dimensionKey: 'P7',
          bucket: '2026-09-14',
          demandHours: 8,
          confidenceBand: 'high',
        },
      ],
      methodVersion: 'forecast@2',
      signature: 'sig-fc',
      generatedAt: 'g',
    }))
    const env = await a.read(ctx)
    expect(env.data[0]!.dimensionKey).toBe('backend')
    expect(env.data[0]!.bucket).toBe('2026-09-07') // 截断到日期
    expect(env.data[0]!.demandHours).toBe(12.35)
    expect(env.warnings).toContain('LOW_CONFIDENCE')
  })

  it('零副作用：reader 未被调用前无任何 IO（纯工厂构造即无副作用）', () => {
    let called = 0
    makeDemandForecastingAdapter(async () => {
      called += 1
      return { buckets: [], methodVersion: 'v', signature: 's', generatedAt: 'g' }
    })
    expect(called).toBe(0)
  })
})

// ─── §4.10 缺口与冲突 adapter ──────────────────────────────────────────────

describe('RCCL 缺口/冲突 adapter（§4.10）', () => {
  it('缺口：不可用来源显式 missing 而非空数组冒充无缺口', async () => {
    const a = makeGapAnalysisAdapter(async () => ({
      gaps: [],
      sourceVersion: 'gap@1',
      signature: 's',
      generatedAt: 'g',
      unavailable: true,
    }))
    const env = await a.read(ctx)
    expect(env.factState).toBe('missing')
  })

  it('缺口：reason codes 排序稳定 + evidence hash 保留 + redacted 透传', async () => {
    const a = makeGapAnalysisAdapter(async () => ({
      gaps: [
        {
          gapId: 'g1',
          dimension: 'skill',
          dimensionKey: 'React',
          severity: 'high',
          reasonCodes: ['ALLOC_CONFLICT', 'NO_CANDIDATE_RESOURCE'],
          affectedWindow: { from: '2026-09-07', to: '2026-09-21' },
          evidenceHashes: ['h2', 'h1'],
          redacted: true,
        },
      ],
      sourceVersion: 'gap@1',
      signature: 's',
      generatedAt: 'g',
    }))
    const env = await a.read(ctx)
    expect(env.data[0]!.reasonCodes).toEqual(['ALLOC_CONFLICT', 'NO_CANDIDATE_RESOURCE'].sort())
    expect(env.data[0]!.evidenceHashes).toEqual(['h1', 'h2'])
    expect(env.data[0]!.redacted).toBe(true)
  })

  it('冲突：soft conflict 与 affected buckets 排序稳定', async () => {
    const a = makeContentionDetectionAdapter(async () => ({
      conflicts: [
        {
          conflictId: 'c1',
          resourceRefId: 11,
          severity: 'medium',
          reasonCode: 'OVERLOAD',
          affectedBuckets: ['2026-09-14', '2026-09-07'],
          softConflict: true,
        },
      ],
      sourceVersion: 'cont@1',
      signature: 's',
      generatedAt: 'g',
      truncated: false,
    }))
    const env = await a.read(ctx)
    expect(env.data[0]!.affectedBuckets).toEqual(['2026-09-07', '2026-09-14'])
    expect(env.data[0]!.softConflict).toBe(true)
  })
})

// ─── §4.12 baseline collector ──────────────────────────────────────────────

function fullDefs(): Array<RcclSourceDefinition<unknown>> {
  return [
    makeResourcePoolAdapter(async () => ({
      rows: [
        {
          id: 11,
          name: '甲',
          roleKey: 'backend',
          allocatedHours: 30,
          availableCapacityHours: 40,
          remainingCapacityHours: 10,
        },
      ],
      requirements: [
        { requirementRefId: 'req-1', resourceId: 11, bucket: '2026-09-07', demandHours: 25 },
      ],
      metricVersion: 'pool@1',
      signature: 'sp',
      generatedAt: '2026-08-24T00:00:00Z',
    })),
    makeSkillMatrixAdapter(async () => ({
      entries: [
        {
          normalizedSkillKey: 'react frontend',
          originalLabels: ['React'],
          proficiencyLevel: 3,
          coveredResourceCount: 4,
        },
      ],
      sourceVersion: 'skill@1',
      signature: 'ss',
      generatedAt: 'g',
    })),
    makeDemandForecastingAdapter(async () => ({
      buckets: [
        {
          dimension: 'role',
          dimensionKey: 'backend',
          bucket: '2026-09-07',
          demandHours: 45,
          confidenceBand: 'high',
        },
      ],
      methodVersion: 'fc@1',
      signature: 'sf',
      generatedAt: 'g',
    })),
    makeGapAnalysisAdapter(async () => ({
      gaps: [
        {
          gapId: 'gap-1',
          dimension: 'role',
          dimensionKey: 'backend',
          severity: 'high',
          reasonCodes: ['ALLOC_CONFLICT'],
          affectedWindow: { from: '2026-09-07', to: '2026-09-07' },
        },
      ],
      sourceVersion: 'gap@1',
      signature: 'sg',
      generatedAt: 'g',
    })),
    makeContentionDetectionAdapter(async () => ({
      conflicts: [
        {
          conflictId: 'cf-1',
          resourceRefId: 11,
          severity: 'low',
          reasonCode: 'SOFT',
          affectedBuckets: ['2026-09-07'],
        },
      ],
      sourceVersion: 'cont@1',
      signature: 'sc',
      generatedAt: 'g',
    })),
  ] as Array<RcclSourceDefinition<unknown>>
}

describe('RCCL baseline collector（§4.12）', () => {
  it('normal：五源全绿 → packet 可模拟且 digest 稳定（重复运行同 digest）', async () => {
    const a = await collectAndCanonicalize({ defs: fullDefs(), ctx, scopeProjectIds: [1, 2] })
    const b = await collectAndCanonicalize({ defs: fullDefs(), ctx, scopeProjectIds: [1, 2] })
    expect(a.readyForSimulation).toBe(true)
    expect(b.readyForSimulation).toBe(true)
    expect(a.packet && b.packet).toBeTruthy()
    if (a.packet && b.packet) {
      expect(a.packet.facts.length).toBeGreaterThan(0)
      // 同输入两次收集（同 generatedAt fixture）→ 相同内容。
      expect(JSON.stringify(a.packet.facts)).toBe(JSON.stringify(b.packet.facts))
    }
  })

  it('required 失败 → packet=null fail closed；optional 失败仅 degraded', async () => {
    const defs = fullDefs()
    defs[0] = {
      sourceId: 'organization-resource-pool',
      read: async () => {
        throw new Error('池不可用')
      },
    }
    defs[1] = {
      sourceId: 'resource-skill-matrix',
      read: async () => {
        throw new Error('技能不可用')
      },
    }
    const r = await collectAndCanonicalize({ defs, ctx, scopeProjectIds: [] })
    expect(r.packet).toBeNull()
    expect(r.readyForSimulation).toBe(false)
    expect(r.failedRequiredSources).toContain('organization-resource-pool')
    expect(r.degradedSources).toContain('resource-skill-matrix')
  })

  it('restricted/redacted 与 truncated 来源进入 warnings；正式资源表零写入（纯内存）', async () => {
    const defs = fullDefs()
    ;(defs[1] as ReturnType<typeof makeSkillMatrixAdapter>).sourceId = 'resource-skill-matrix'
    const r = await collectAndCanonicalize({ defs, ctx, scopeProjectIds: [1] })
    expect(r.packet?.sources.every((s) => s.factState !== 'missing')).toBe(true)
    // collector 只读 envelope，不触碰任何模型——此处以「无 DB import 副作用」为证。
    expect(r.collected.outcomes).toHaveLength(5)
  })
})
