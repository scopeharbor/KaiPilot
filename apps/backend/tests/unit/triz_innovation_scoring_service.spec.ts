import InnovationScoringService from '#services/triz_innovation/innovation_scoring_service'
import { test } from '@japa/runner'
import type {
  InnovationImpactSummary,
  InnovationOption,
  InnovationScheme,
  InnovationScore,
} from '@aiproj/types'

function impact(over: Partial<InnovationImpactSummary> = {}): InnovationImpactSummary {
  return {
    schedule: 'neutral',
    resource_load: 'neutral',
    risk: 'improves',
    scope_flexibility: 'neutral',
    quality_maintainability: 'neutral',
    change_complexity: 'worsens',
    ...over,
  }
}

function option(over: Partial<InnovationOption> = {}): InnovationOption {
  return {
    optionId: 'opt-1',
    origin: 'triz_analysis_path',
    sourceRefs: [
      {
        sourceType: 'contradiction',
        ref: 'pc:1:d-a',
        hash: 'tcd-a',
        severity: 'high',
        stale: false,
        title: 't',
      },
    ],
    selectedPathId: 'path-A',
    principleIds: ['segmentation'],
    name: 'o',
    description: 'd',
    applicability: ['c1', 'c2'],
    nonApplicability: [],
    hashes: {
      contradictionSignatures: ['tcd-a'],
      analysisContentHashes: [],
      selectedPathId: 'path-A',
    },
    warnings: [],
    impact: impact(),
    reviewState: 'pending',
    createdBy: 1,
    ...over,
  }
}

function scheme(
  options: InnovationOption[],
  over: Partial<InnovationScheme> = {},
): InnovationScheme {
  return {
    schemeId: 'sch-1',
    organizationId: 1,
    projectId: 10,
    name: '方案',
    note: null,
    options,
    scores: {},
    status: 'open',
    reviewState: 'pending',
    handoff: { status: 'none', draftSessionRef: null, handedOffAt: null, blockedReason: null },
    narrative: null,
    schemeHash: 'iw-sch-x',
    comparisonRef: null,
    schemaVersion: '1.0.0',
    createdBy: 1,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: null,
    reviewedAt: null,
    abandonedAt: null,
    ...over,
  }
}

test.group('V3 InnovationScoringService — determinism & no-what-if', () => {
  test('scoreOption：severity/confidence/适用性等分量均为确定性', ({ assert }) => {
    const svc = new InnovationScoringService()
    const a = svc.scoreOption(option())
    const b = svc.scoreOption(option())
    assert.deepEqual(a, b)
    assert.isAtLeast(a.total, 0)
    assert.isAtMost(a.total, 100)
    assert.equal(a.severity, 20) // high
    assert.equal(a.confidence, Math.round(0.7 * 15))
  })

  test('高严重度 option 得分高于低严重度', ({ assert }) => {
    const svc = new InnovationScoringService()
    const high = svc.scoreOption(
      option({
        sourceRefs: [
          {
            sourceType: 'contradiction',
            ref: 'k',
            hash: 'h',
            severity: 'critical',
            stale: false,
            title: 't',
          },
        ],
      }),
    )
    const low = svc.scoreOption(
      option({
        sourceRefs: [
          {
            sourceType: 'contradiction',
            ref: 'k',
            hash: 'h',
            severity: 'low',
            stale: false,
            title: 't',
          },
        ],
      }),
    )
    assert.isAbove(high.total, low.total)
  })

  test('stale 来源与 blocking warning 降低得分', ({ assert }) => {
    const svc = new InnovationScoringService()
    const clean = svc.scoreOption(option())
    const stale = svc.scoreOption(
      option({
        sourceRefs: [
          {
            sourceType: 'contradiction',
            ref: 'k',
            hash: 'h',
            severity: 'high',
            stale: true,
            title: 't',
          },
        ],
      }),
    )
    const blocked = svc.scoreOption(
      option({ warnings: [{ code: 'NEEDS_HUMAN_REVIEW', severity: 'blocking', message: 'm' }] }),
    )
    assert.isBelow(stale.total, clean.total)
    assert.isBelow(blocked.total, clean.total)
  })

  test('compareScheme 重复调用返回完全一致的排序、score 与 impact', ({ assert }) => {
    const svc = new InnovationScoringService()
    const s = scheme([
      option({
        optionId: 'a',
        sourceRefs: [
          {
            sourceType: 'contradiction',
            ref: 'k',
            hash: 'h',
            severity: 'medium',
            stale: false,
            title: 't',
          },
        ],
      }),
      option({
        optionId: 'b',
        sourceRefs: [
          {
            sourceType: 'contradiction',
            ref: 'k',
            hash: 'h',
            severity: 'critical',
            stale: false,
            title: 't',
          },
        ],
      }),
    ])
    const c1 = svc.compareScheme(s)
    const c2 = svc.compareScheme(s)
    assert.deepEqual(c1.cells, c2.cells)
    assert.deepEqual(c1.warnings, c2.warnings)
    // 严重度高的 b 排在前面
    assert.equal(c1.cells[0].optionId, 'b')
  })

  test('对比零模型成本：modelCostRecorded=true', ({ assert }) => {
    const svc = new InnovationScoringService()
    const c = svc.compareScheme(scheme([option()]))
    assert.isTrue(c.modelCostRecorded)
  })

  test('对比不创建仿真排程：cells 只含静态方向摘要，无数值基线', ({ assert }) => {
    const svc = new InnovationScoringService()
    const c = svc.compareScheme(scheme([option()]))
    const cell = c.cells[0]
    // 仅 6 个方向字段，无 baseline/simulatedSchedule/durationDelta 等
    assert.deepEqual(Object.keys(cell.impact).sort(), [
      'change_complexity',
      'quality_maintainability',
      'resource_load',
      'risk',
      'schedule',
      'scope_flexibility',
    ])
    assert.notProperty(cell, 'simulatedSchedule')
    assert.notProperty(cell, 'baselineDuration')
  })

  test('handoffEligible：blocking warning 或 stale 来源阻断', ({ assert }) => {
    const svc = new InnovationScoringService()
    const ok = svc.isHandoffEligible(option(), [])
    assert.isTrue(ok)
    const stale = svc.isHandoffEligible(
      option({
        sourceRefs: [
          {
            sourceType: 'contradiction',
            ref: 'k',
            hash: 'h',
            severity: 'high',
            stale: true,
            title: 't',
          },
        ],
      }),
      [],
    )
    assert.isFalse(stale)
    const blocked = svc.isHandoffEligible(option(), [
      { code: 'NEEDS_HUMAN_REVIEW', severity: 'blocking', message: 'm' },
    ])
    assert.isFalse(blocked)
  })

  test('comparisonRef 稳定：同方案同 ref；option 顺序变化不影响', ({ assert }) => {
    const svc = new InnovationScoringService()
    const a = scheme([option({ optionId: 'a' }), option({ optionId: 'b' })])
    const b = scheme([option({ optionId: 'b' }), option({ optionId: 'a' })])
    assert.equal(svc.comparisonRef(a), svc.comparisonRef(b))
  })

  test('评分服务零 DB/网络副作用（纯函数）', ({ assert }) => {
    const svc = new InnovationScoringService()
    const before: InnovationScore = svc.scoreOption(option())
    // 多次调用不抛、不变
    for (let i = 0; i < 50; i++) {
      const s = svc.scoreOption(option())
      assert.deepEqual(s, before)
    }
  })
})
