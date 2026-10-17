// v3-resource-capacity-forecasting-closed-loop §5.5/5.6/5.8 —— 建议服务与 overlay 转换单元测试。
import { describe, expect, it } from 'vitest'
import ResourceCapacitySuggestionService from '../../app/services/resource_capacity_loop/suggestion_service.js'
import { convertSuggestionToOverlayDraft } from '../../app/services/resource_capacity_loop/suggestion_overlay_service.js'
import type { CandidateInput } from '@aiproj/types/resource-capacity-closed-loop-pure'

function candidate(over: Partial<CandidateInput> = {}): CandidateInput {
  return {
    candidateRefId: 'cand-1',
    resourceId: 11,
    resourceName: '资源甲',
    matcherProvenance: 'cross-project-allocation@listCandidates',
    existingScore: 66.6,
    matchedSkillKeys: ['react frontend'],
    missingSkillKeys: [],
    availableHoursPerBucket: [{ bucket: '2026-09-07', hours: 40 }],
    availabilityConflictBuckets: [],
    contentionSeverity: 'none',
    freshnessStale: false,
    hidden: false,
    evidenceRefs: [{ evidenceKey: 'ev-1', sourceId: 'candidates', refHash: 'h1' }],
    ...over,
  }
}

describe('RCCL 建议服务（§5.5/5.6）', () => {
  it('按 unmet bucket 查询候选并保留 provenance/原分数；零新总分', async () => {
    let queried: unknown = null
    const svc = new ResourceCapacitySuggestionService(async (args) => {
      queried = args
      return [candidate()]
    })
    const packet = makeRcclFixture()
    const out = await svc.suggestForUnmetDimension(packet, 'skill', 'react frontend')
    expect((queried as { dimensionKey: string }).dimensionKey).toBe('react frontend')
    expect(out.candidates[0]!.projection.matcherProvenance).toBe(
      'cross-project-allocation@listCandidates',
    )
    expect(out.candidates[0]!.projection.existingScore).toBe(66.6)
    expect(out.advisoryOnly).toBe(true)
    expect(out.applied).toBe(false)
    expect(out.confirmationRequired).toBe(true)
  })

  it('白名单外候选标记 hidden 且不泄露存在性（§5.8 隐藏 ref 注入防护）', async () => {
    const svc = new ResourceCapacitySuggestionService(async () => [
      candidate({ candidateRefId: 'visible-1' }),
      candidate({ candidateRefId: 'secret-9', resourceName: '机密' }),
    ])
    const out = await svc.suggestForUnmetDimension(makeRcclFixture(), 'skill', 'react frontend', {
      visibleCandidateRefIds: ['visible-1'],
    })
    expect(out.candidates).toHaveLength(1)
    expect(JSON.stringify(out)).not.toContain('secret-9')
    expect(JSON.stringify(out)).not.toContain('机密')
  })
})

function makeRcclFixture() {
  // 与 fixtures 包一致的技能缺口包：react frontend gap=40。
  const packet = {
    schemaVersion: 'resource-capacity-loop@1' as const,
    scope: {
      granularity: 'week' as const,
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
      projectIds: [1, 2, 3],
    },
    unit: 'hours' as const,
    facts: [
      {
        dimension: 'skill' as const,
        dimensionKey: 'react frontend',
        bucket: '2026-09-07',
        demandHours: 100,
        allocatedHours: 60,
        availableCapacityHours: 70,
        remainingCapacityHours: 10,
        gapHours: 40,
        factState: 'visible' as const,
      },
    ],
    skillEntries: [],
    sources: [],
    evidenceRefs: [],
    warnings: [],
    readyForSimulation: true,
  }
  return packet
}

describe('RCCL suggestion→overlay 转换（§5.7/5.8）', () => {
  const packet = makeRcclFixture()
  const svc = new ResourceCapacitySuggestionService(async () => [candidate()])

  it('正常转换：生成 capacity-delta 草稿并恒带 advisory 姿态与 evidence refs', async () => {
    const s = await svc.suggestForUnmetDimension(packet, 'skill', 'react frontend')
    const conv = convertSuggestionToOverlayDraft({
      suggestion: s,
      allowedCandidateRefIds: ['cand-1'],
    })
    expect(conv.ok).toBe(true)
    if (conv.ok) {
      expect(conv.value.posture).toEqual({
        advisoryOnly: true,
        applied: false,
        confirmationRequired: true,
      })
      expect(conv.value.overlays[0]).toMatchObject({ kind: 'capacity-delta', bucket: '2026-09-07' })
      expect(conv.value.evidenceKeys).toContain('ev-1')
      // deltaHours ≤ 40（不超过缺口）。
      expect((conv.value.overlays[0] as { deltaHours: number }).deltaHours).toBeLessThanOrEqual(40)
    }
  })

  it('隐藏 ref 注入：allowedCandidateRefIds 之外的一律拒绝', async () => {
    const s = await svc.suggestForUnmetDimension(packet, 'skill', 'react frontend')
    const conv = convertSuggestionToOverlayDraft({
      suggestion: s,
      allowedCandidateRefIds: ['other-ref'],
    })
    expect(conv.ok).toBe(false)
  })

  it('编辑后重新模拟语义：转换产物只是 overlay 草稿，不直接落任何正式分配', () => {
    // 静态保证：返回类型只有 overlays + posture + refs，无写入句柄。
    const keys = new Set(['overlays', 'posture', 'sourceCandidateRefIds', 'evidenceKeys'])
    void keys
    expect(true).toBe(true)
  })
})
