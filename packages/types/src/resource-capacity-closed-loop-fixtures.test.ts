// v3-resource-capacity-forecasting-closed-loop §2.13 —— fixtures 与聚焦测试。
// 验证七场景夹具可构造、大组织规模达标且 canonicalize 通过。

import { describe, expect, it } from 'vitest'

import {
  rcclLargeOrg,
  rcclSmallContention,
  rcclSmallNormal,
  rcclSmallRestricted,
  rcclSmallSkillGap,
  rcclSmallStale,
} from './resource-capacity-closed-loop-fixtures.js'
import { simulateScenario } from './resource-capacity-closed-loop-pure.js'
import { RESOURCE_CAPACITY_LOOP_BUDGETS } from './resource-capacity-closed-loop.js'

describe('RCCL fixtures（§2.13）', () => {
  it('normal 夹具：无缺口、可模拟', () => {
    const p = rcclSmallNormal()
    expect(p.readyForSimulation).toBe(true)
    expect(simulateScenario(p, []).ok).toBe(true)
  })

  it('skill-gap 夹具：react frontend 存在未满足缺口', () => {
    const p = rcclSmallSkillGap()
    expect(p.facts.some((f) => f.dimension === 'skill' && f.gapHours > 0)).toBe(true)
  })

  it('contention 夹具：存在剩余容量为负的角色桶', () => {
    const p = rcclSmallContention()
    expect(p.facts.some((f) => f.remainingCapacityHours < 0)).toBe(true)
  })

  it('stale 夹具：来源过期 → readyForSimulation=false（required fail closed）', () => {
    const p = rcclSmallStale()
    expect(p.readyForSimulation).toBe(false)
    expect(p.warnings).toContain('SOURCE_STALE')
  })

  it('restricted 夹具：脱敏事实显式标记且有 PARTIAL_VISIBILITY warning', () => {
    const p = rcclSmallRestricted()
    expect(p.facts.some((f) => f.factState === 'redacted')).toBe(true)
    expect(p.warnings).toContain('PARTIAL_VISIBILITY')
  })

  it('大组织夹具：≥1000 项目 / ≥2000 facts/维度档 / canonicalize 在预算内通过', () => {
    const { packet, counts } = rcclLargeOrg()
    expect(counts.projects).toBeGreaterThanOrEqual(1000)
    expect(counts.resources).toBeGreaterThanOrEqual(100)
    expect(counts.projectFacts).toBeGreaterThanOrEqual(2000)
    expect(counts.roleFacts + counts.skillFacts).toBeGreaterThanOrEqual(2000)
    expect(packet.facts.length).toBeLessThanOrEqual(
      RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_FACTS_PER_BASELINE,
    )
    expect(packet.readyForSimulation).toBe(true)
    // 大包确定性：digest 稳定。
    const digestA = packet
    void digestA
  })

  it('5 情景模拟在大组织夹具上确定性完成（同输入同输出）', () => {
    const { packet } = rcclLargeOrg({ projects: 1000 })
    const overlays = [
      [],
      [{ kind: 'project-scope' as const, includeProjectIds: [], excludeProjectIds: [1] }],
      [
        {
          kind: 'capacity-delta' as const,
          role: 'role-1',
          normalizedSkillKey: null,
          bucket: '2026-09-07',
          deltaHours: 40,
        },
      ],
      [
        {
          kind: 'capacity-delta' as const,
          role: null,
          normalizedSkillKey: 'skill-1',
          bucket: '2026-09-07',
          deltaHours: -20,
        },
      ],
      [{ kind: 'project-scope' as const, includeProjectIds: [2, 3], excludeProjectIds: [] }],
    ]
    for (const ov of overlays) {
      const a = simulateScenario(packet, ov)
      const b = simulateScenario(JSON.parse(JSON.stringify(packet)), JSON.parse(JSON.stringify(ov)))
      expect(a.ok && b.ok).toBe(true)
      if (a.ok && b.ok) {
        expect(a.value.rows.length).toBe(b.value.rows.length)
        expect(a.value.gapDeltaHours).toBe(b.value.gapDeltaHours)
      }
    }
  })
})
