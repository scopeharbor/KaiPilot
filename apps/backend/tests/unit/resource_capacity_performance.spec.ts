// v3-resource-capacity-forecasting-closed-loop §9.4 —— 大组织性能门。
// fixture：≥1000 项目 / ≥2000 facts/维度档 / 5 情景；门限来自
// observation-and-inventory.md §1.4（本机 SQLite、无缓存基线）：
//   baseline capture ≤5000ms；simulate 全部 5 情景 ≤3000ms；observation compare ≤5000ms。
// 失败判据：超阈值即 blocked finding，不允许以「机器慢」豁免。
import { describe, it, expect } from 'vitest'
import { rcclLargeOrg } from '@aiproj/types/resource-capacity-closed-loop-fixtures'
import {
  canonicalizePacket,
  compareObservation,
  simulateScenario,
} from '@aiproj/types/resource-capacity-closed-loop-pure'
import type { ResourceCapacityLoopOverlay } from '@aiproj/types/resource-capacity-closed-loop'

const BUDGET = {
  baselineCaptureMs: 5000,
  simulateAllMs: 3000,
  observeCompareMs: 5000,
}

describe('§9.4 大组织性能门', () => {
  const { packet, counts } = rcclLargeOrg({ projects: 1000 })

  it(`baseline capture（canonicalize+digest）≤ ${BUDGET.baselineCaptureMs}ms`, () => {
    // 用与 collector 相同的输入形状重放一次 canonicalize 以测捕获路径。
    const input = {
      scope: packet.scope,
      facts: packet.facts.map((f) => ({ ...f })),
      skillEntries: packet.skillEntries.map((s) => ({ ...s })),
      sources: packet.sources.map((s) => ({ ...s })),
      evidenceRefs: packet.evidenceRefs.map((e) => ({ ...e })),
    }
    const t0 = performance.now()
    const r = canonicalizePacket(input)
    const elapsed = performance.now() - t0
    expect(r.ok).toBe(true)
    expect(elapsed).toBeLessThanOrEqual(BUDGET.baselineCaptureMs)
    console.log(
      `[perf] baseline capture: ${elapsed.toFixed(0)}ms (facts=${counts.roleFacts + counts.projectFacts + counts.skillFacts}, projects=${counts.projects})`,
    )
  })

  it(`simulate 全部 5 情景 ≤ ${BUDGET.simulateAllMs}ms 且确定性`, () => {
    const overlaySets: ResourceCapacityLoopOverlay[][] = [
      [],
      [{ kind: 'project-scope', includeProjectIds: [], excludeProjectIds: [1] }],
      [
        {
          kind: 'capacity-delta',
          role: 'role-1',
          normalizedSkillKey: null,
          bucket: '2026-09-07',
          deltaHours: 40,
        },
      ],
      [
        {
          kind: 'capacity-delta',
          role: null,
          normalizedSkillKey: 'skill-1',
          bucket: '2026-09-07',
          deltaHours: -20,
        },
      ],
      [{ kind: 'project-scope', includeProjectIds: [2, 3], excludeProjectIds: [] }],
    ]
    const t0 = performance.now()
    const results = overlaySets.map((ov) => simulateScenario(packet, ov))
    const elapsed = performance.now() - t0
    expect(results.every((r) => r.ok)).toBe(true)
    expect(elapsed).toBeLessThanOrEqual(BUDGET.simulateAllMs)
    // 确定性：重复计算同情景结果一致。
    const again = simulateScenario(packet, overlaySets[2]!)
    expect(JSON.stringify(results[2]!.ok && results[2]!.value.rows)).toBe(
      JSON.stringify(again.ok && again.value.rows),
    )
    console.log(`[perf] simulate x5: ${elapsed.toFixed(0)}ms`)
  })

  it(`observation compare ≤ ${BUDGET.observeCompareMs}ms`, () => {
    const expectedRows = packet.facts.map((f) => ({
      dimension: f.dimension,
      dimensionKey: f.dimensionKey,
      bucket: f.bucket,
      gapHours: f.gapHours,
    }))
    const observedRows = packet.facts.map((f) => ({
      dimension: f.dimension,
      dimensionKey: f.dimensionKey,
      bucket: f.bucket,
      observedGapHours: Math.max(0, f.gapHours - 5),
      observedAllocatedHours: f.allocatedHours + 5,
      factState: 'visible' as const,
    }))
    const t0 = performance.now()
    const out = compareObservation({
      baselineScope: packet.scope,
      observationScope: { ...packet.scope },
      baselineMetricVersion: 'resource-capacity-loop@1',
      observationMetricVersion: 'resource-capacity-loop@1',
      expectedRows,
      observedRows,
    })
    const elapsed = performance.now() - t0
    expect(out.comparability.comparable).toBe(true)
    expect(elapsed).toBeLessThanOrEqual(BUDGET.observeCompareMs)
    console.log(`[perf] observation compare (${expectedRows.length} rows): ${elapsed.toFixed(0)}ms`)
  })
})
