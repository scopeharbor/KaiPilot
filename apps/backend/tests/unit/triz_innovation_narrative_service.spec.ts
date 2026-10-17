import InnovationNarrativeService, {
  containsFabricatedNumericImpact,
} from '#services/triz_innovation/innovation_narrative_service'
import InnovationScoringService from '#services/triz_innovation/innovation_scoring_service'
import { test } from '@japa/runner'
import type { InnovationOption, InnovationScheme } from '@aiproj/types'

const fakeAudit = { async log() {} }

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
        title: '工期与资源对立',
      },
    ],
    selectedPathId: 'path-A',
    principleIds: ['segmentation'],
    name: '分段交付',
    description: '拆分关键路径',
    applicability: ['关键路径密度高'],
    nonApplicability: [],
    hashes: {
      contradictionSignatures: ['tcd-a'],
      analysisContentHashes: [],
      selectedPathId: 'path-A',
    },
    warnings: [],
    impact: {
      schedule: 'improves',
      resource_load: 'neutral',
      risk: 'improves',
      scope_flexibility: 'neutral',
      quality_maintainability: 'neutral',
      change_complexity: 'worsens',
    },
    reviewState: 'pending',
    createdBy: 1,
    ...over,
  }
}

function scheme(options: InnovationOption[]): InnovationScheme {
  return {
    schemeId: 'sch-1',
    organizationId: 1,
    projectId: 10,
    name: '方案一',
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
  }
}

function env<T>(key: string, value: unknown | undefined, fn: () => Promise<T>): Promise<T> {
  const before = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = String(value)
  return fn().finally(() => {
    if (before === undefined) delete process.env[key]
    else process.env[key] = before
  })
}

test.group('V3 InnovationNarrativeService — fake default & fallback paths', () => {
  test('默认 fake provider：isFallback=false、零成本、可追溯 refs', async ({ assert }) => {
    const scoring = new InnovationScoringService()
    const svc = new InnovationNarrativeService(fakeAudit as any)
    const s = scheme([option()])
    const comparison = scoring.compareScheme(s)
    const n = await env('TRIZ_INNOVATION_REAL_MODEL', undefined, () =>
      svc.generateNarrative({ organizationId: 1, projectId: 10, userId: 1, scheme: s, comparison }),
    )
    assert.isFalse(n.isFallback)
    assert.equal(n.provider, 'fake')
    assert.isNotNull(n.cost)
    assert.equal(n.cost!.estimatedCost, 0)
    assert.equal(n.cost!.finishReason, 'completed')
    // refs 可追溯：referencedOptionIds 都在 scheme 内
    for (const id of n.referencedOptionIds) {
      assert.isTrue(s.options.some((o) => o.optionId === id))
    }
  })

  test('budget 阻断 → 降级 fallback，保留确定性 finishReason=budget_blocked', async ({
    assert,
  }) => {
    const scoring = new InnovationScoringService()
    const svc = new InnovationNarrativeService(fakeAudit as any)
    const s = scheme([option()])
    const comparison = scoring.compareScheme(s)
    const n = await env('TRIZ_INNOVATION_BUDGET_BLOCK', true, () =>
      svc.generateNarrative({ organizationId: 1, projectId: 10, userId: 1, scheme: s, comparison }),
    )
    assert.isTrue(n.isFallback)
    assert.equal(n.cost!.finishReason, 'budget_blocked')
    assert.equal(n.cost!.errorCategory, 'budget')
    assert.isNotNull(n.cost!.budgetDecisionRef)
  })

  test('AIGateway 失败（真实模型 seam 抛错）→ 降级 model_failure', async ({ assert }) => {
    const scoring = new InnovationScoringService()
    const svc = new InnovationNarrativeService(fakeAudit as any)
    const s = scheme([option()])
    const comparison = scoring.compareScheme(s)
    const n = await env('TRIZ_INNOVATION_REAL_MODEL', true, () =>
      svc.generateNarrative({ organizationId: 1, projectId: 10, userId: 1, scheme: s, comparison }),
    )
    assert.isTrue(n.isFallback)
    assert.equal(n.cost!.finishReason, 'model_failure')
    assert.equal(n.cost!.errorCategory, 'model')
  })

  test('编造数值化影响被检测 → validateImpactClaims 判负', async ({ assert }) => {
    assert.isTrue(containsFabricatedNumericImpact('预计缩短工期 30%'))
    assert.isTrue(containsFabricatedNumericImpact('资源负载降低 2.5 人天'))
    assert.isFalse(containsFabricatedNumericImpact('工期方向：改善（定性）'))
    assert.isFalse(containsFabricatedNumericImpact('不会自动重排计划'))
  })

  test('Context Packet 隐私：仅含 refs/hashes/codes/摘要，无正文/无敏感证据', ({ assert }) => {
    const scoring = new InnovationScoringService()
    const svc = new InnovationNarrativeService(fakeAudit as any)
    const s = scheme([option({ description: '极敏感的秘密证据正文不应泄露' })])
    const comparison = scoring.compareScheme(s)
    const packet = svc.buildContextPacket(s, comparison)
    assert.notInclude(packet.lowSensitivityFacts.join(' '), '极敏感的秘密证据正文')
    assert.isTrue(packet.sourceHashes.schemeHash.length > 0)
    assert.isAbove(packet.optionIds.length, 0)
    assert.notProperty(packet, 'prompt')
    assert.notProperty(packet, 'apiKey')
  })
})
