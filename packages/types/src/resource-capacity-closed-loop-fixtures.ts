// @aiproj/types —— 资源容量预测闭环测试夹具（§2.13）。
// 场景：normal / skill-gap / contention / stale / restricted / partial-apply / not-comparable，
// 各提供小组织（small）与大组织（large，≥1000 项目 / 100 资源 / 2000×3 facts）两档。
// 零运行时依赖；仅被测试与性能门消费。

import type {
  ResourceCapacityLoopCanonicalPacket,
  ResourceCapacityLoopPacketFact,
  ResourceCapacityLoopSourceSummary,
} from './resource-capacity-closed-loop.js'
import {
  canonicalizePacket,
  type CanonicalizePacketInput,
} from './resource-capacity-closed-loop-pure.js'

// ─── 基础 builder ───────────────────────────────────────────────────────────

export interface RcclFixtureSourceOverrides {
  factState?: ResourceCapacityLoopSourceSummary['factState']
  stale?: boolean
  truncated?: boolean
}

function rcclSources(over: RcclFixtureSourceOverrides = {}): ResourceCapacityLoopSourceSummary[] {
  return [
    {
      sourceId: 'organization-resource-pool',
      sourceVersion: '1',
      signature: 'sig-pool-fixture',
      required: true,
      freshness: { generatedAt: '2026-08-24T08:00:00Z', stale: over.stale ?? false },
      factState: over.factState ?? 'visible',
      warnings: [],
      truncated: over.truncated ?? false,
    },
    {
      sourceId: 'resource-demand-forecasting',
      sourceVersion: '1',
      signature: 'sig-forecast-fixture',
      required: true,
      freshness: { generatedAt: '2026-08-24T08:00:00Z', stale: false },
      factState: over.factState ?? 'visible',
      warnings: [],
      truncated: false,
    },
    {
      sourceId: 'resource-gap-analysis',
      sourceVersion: '1',
      signature: 'sig-gap-fixture',
      required: true,
      freshness: { generatedAt: '2026-08-24T08:00:00Z', stale: false },
      factState: over.factState ?? 'visible',
      warnings: [],
      truncated: false,
    },
    {
      sourceId: 'resource-contention-detection',
      sourceVersion: '1',
      signature: 'sig-contention-fixture',
      required: true,
      freshness: { generatedAt: '2026-08-24T08:00:00Z', stale: false },
      factState: over.factState ?? 'visible',
      warnings: [],
      truncated: false,
    },
    {
      sourceId: 'resource-skill-matrix',
      sourceVersion: '1',
      signature: 'sig-skill-fixture',
      required: false,
      freshness: { generatedAt: '2026-08-24T08:00:00Z', stale: false },
      factState: over.factState ?? 'visible',
      warnings: [],
      truncated: false,
    },
  ]
}

export interface RcclFixtureFactInput {
  dimension: ResourceCapacityLoopPacketFact['dimension']
  key: string
  bucket: string
  demandHours?: number
  allocatedHours?: number
  availableCapacityHours?: number
  remainingCapacityHours?: number
  gapHours?: number
  factState?: ResourceCapacityLoopPacketFact['factState']
}

function rcclRawFacts(inputs: readonly RcclFixtureFactInput[]) {
  return inputs.map((f) => ({
    dimension: f.dimension,
    dimensionKey: f.key,
    bucket: f.bucket,
    demandHours: f.demandHours ?? 0,
    allocatedHours: f.allocatedHours ?? 0,
    availableCapacityHours: f.availableCapacityHours ?? 0,
    remainingCapacityHours: f.remainingCapacityHours ?? 0,
    factState: f.factState ?? ('visible' as const),
  }))
}

/** 构造 canonical packet 夹具（经真实 canonicalizer，保证与生产路径一致）。 */
export function makeRcclPacket(
  facts: readonly RcclFixtureFactInput[],
  overrides: {
    granularity?: 'day' | 'week' | 'month'
    projectIds?: number[]
    sources?: ResourceCapacityLoopSourceSummary[]
  } = {},
): ResourceCapacityLoopCanonicalPacket {
  const input: CanonicalizePacketInput = {
    scope: {
      granularity: overrides.granularity ?? 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
      projectIds: overrides.projectIds ?? [1, 2, 3],
    },
    facts: rcclRawFacts(facts),
    skillEntries: [
      {
        normalizedSkillKey: 'react frontend',
        originalLabels: ['React', 'react.js'],
        proficiencyLevel: 4,
        coveredResourceCount: 12,
        factState: 'visible',
      },
      {
        normalizedSkillKey: 'node backend',
        originalLabels: ['NodeJS'],
        proficiencyLevel: null,
        coveredResourceCount: null,
        factState: 'visible',
      },
    ],
    sources: overrides.sources ?? rcclSources(),
    evidenceRefs: [
      { evidenceKey: 'ev-gap-1', sourceId: 'resource-gap-analysis', refHash: 'fnv1a:gap00001' },
    ],
  }
  const result = canonicalizePacket(input)
  if (!result.ok) throw new Error(`fixture packet canonicalize 失败：${result.reasonCode}`)
  return result.value
}

// ─── 七个命名场景（小组织）─────────────────────────────────────────────────

export const RCCL_FIXTURE_BUCKETS = ['2026-09-07', '2026-09-14', '2026-09-21'] as const

/** normal：需求全部被分配覆盖。 */
export function rcclSmallNormal(): ResourceCapacityLoopCanonicalPacket {
  return makeRcclPacket([
    {
      dimension: 'role',
      key: 'backend',
      bucket: RCCL_FIXTURE_BUCKETS[0],
      demandHours: 80,
      allocatedHours: 80,
      availableCapacityHours: 120,
      remainingCapacityHours: 40,
      gapHours: 0,
    },
    {
      dimension: 'role',
      key: 'frontend',
      bucket: RCCL_FIXTURE_BUCKETS[0],
      demandHours: 60,
      allocatedHours: 60,
      availableCapacityHours: 90,
      remainingCapacityHours: 30,
      gapHours: 0,
    },
  ])
}

/** skill-gap：react frontend 技能缺口 40h。 */
export function rcclSmallSkillGap(): ResourceCapacityLoopCanonicalPacket {
  return makeRcclPacket([
    {
      dimension: 'skill',
      key: 'react frontend',
      bucket: RCCL_FIXTURE_BUCKETS[0],
      demandHours: 100,
      allocatedHours: 60,
      availableCapacityHours: 70,
      remainingCapacityHours: 10,
      gapHours: 40,
    },
  ])
}

/** contention：角色桶存在分配冲突且剩余为负。 */
export function rcclSmallContention(): ResourceCapacityLoopCanonicalPacket {
  return makeRcclPacket([
    {
      dimension: 'role',
      key: 'backend',
      bucket: RCCL_FIXTURE_BUCKETS[0],
      demandHours: 80,
      allocatedHours: 130,
      availableCapacityHours: 120,
      remainingCapacityHours: -10,
      gapHours: 0,
    },
  ])
}

/** stale：来源整体过期。 */
export function rcclSmallStale(): ResourceCapacityLoopCanonicalPacket {
  return makeRcclPacket(
    [
      {
        dimension: 'role',
        key: 'backend',
        bucket: RCCL_FIXTURE_BUCKETS[0],
        demandHours: 40,
        allocatedHours: 10,
      },
    ],
    {
      sources: rcclSources({ stale: true }),
    },
  )
}

/** restricted：技能维度被脱敏。 */
export function rcclSmallRestricted(): ResourceCapacityLoopCanonicalPacket {
  return makeRcclPacket([
    {
      dimension: 'skill',
      key: 'react frontend',
      bucket: RCCL_FIXTURE_BUCKETS[0],
      demandHours: 50,
      allocatedHours: 20,
      factState: 'redacted',
    },
  ])
}

/** 大组织：≥1000 项目、100 资源、2000 role/2000 project/2000+ skill facts（性能门用）。 */
export function rcclLargeOrg(
  options: { projects?: number; resources?: number; buckets?: number } = {},
): {
  packet: ResourceCapacityLoopCanonicalPacket
  counts: {
    projects: number
    resources: number
    roleFacts: number
    projectFacts: number
    skillFacts: number
  }
} {
  const projectCount = options.projects ?? 1000
  const resourceCount = options.resources ?? 100
  const bucketCount = options.buckets ?? 3 // 2000+ per dimension via (key,bucket) 组合
  const roles = Array.from({ length: 40 }, (_, i) => `role-${i}`)
  const skills = Array.from({ length: 50 }, (_, i) => `skill-${i}`)
  const facts: RcclFixtureFactInput[] = []

  for (let r = 0; r < roles.length; r++) {
    for (let b = 0; b < bucketCount; b++) {
      facts.push({
        dimension: 'role',
        key: roles[r]!,
        bucket: RCCL_FIXTURE_BUCKETS[b % RCCL_FIXTURE_BUCKETS.length]!,
        demandHours: 40 + r,
        allocatedHours: 30 + r,
        availableCapacityHours: 45 + r,
        remainingCapacityHours: 15 + r,
        gapHours: Math.max(0, 10),
      })
    }
  }
  for (let p = 0; p < projectCount; p++) {
    for (let b = 0; b < 2; b++) {
      facts.push({
        dimension: 'project',
        key: String(p + 1),
        bucket: RCCL_FIXTURE_BUCKETS[b]!,
        demandHours: 8,
        allocatedHours: 6,
        availableCapacityHours: 10,
        remainingCapacityHours: 4,
        gapHours: 2,
      })
    }
  }
  for (let s = 0; s < skills.length; s++) {
    for (let b = 0; b < Math.ceil(2000 / skills.length); b++) {
      facts.push({
        dimension: 'skill',
        key: skills[s]!,
        bucket: RCCL_FIXTURE_BUCKETS[b % RCCL_FIXTURE_BUCKETS.length]!,
        demandHours: 20,
        allocatedHours: 12,
        availableCapacityHours: 18,
        remainingCapacityHours: 6,
        gapHours: 8,
      })
    }
  }

  const projectIds = Array.from({ length: projectCount }, (_, i) => i + 1)
  const packet = makeRcclPacket(facts, { projectIds })
  return {
    packet,
    counts: {
      projects: projectCount,
      resources: resourceCount,
      roleFacts: roles.length * bucketCount,
      projectFacts: projectCount * 2,
      skillFacts: skills.length * Math.ceil(2000 / skills.length),
    },
  }
}
