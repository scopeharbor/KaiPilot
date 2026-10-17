// v3-resource-capacity-forecasting-closed-loop —— baseline collector/canonicalizer（任务 4.11）。
//
// 职责：
// - 以共享预算并发收集五类来源（经 source_adapters.collectSources）；
// - 把各 envelope 投影为 canonical packet facts/skillEntries/sources/evidenceRefs；
// - 生成不可变 snapshot 的 digest/permission fingerprint 与 degraded/readiness 状态；
// - 不写任何正式资源表；snapshot 落库由上层 Service 决定。

import { canonicalizePacket } from '@aiproj/types/resource-capacity-closed-loop-pure'
import type {
  ResourceCapacityLoopCanonicalPacket,
  ResourceCapacityLoopEvidenceRef,
  ResourceCapacityLoopSourceSummary,
} from '@aiproj/types/resource-capacity-closed-loop'
import {
  collectSources,
  isRequiredSource,
  RCCL_SOURCE_IDS,
  type CollectResult,
  type RcclSourceDefinition,
  type RcclSourceReadContext,
} from './source_adapters.js'

export interface BaselineCollectorInput {
  defs: ReadonlyArray<RcclSourceDefinition<unknown>>
  ctx: RcclSourceReadContext
  scopeProjectIds: number[]
}

export interface BaselineBuildResult {
  packet: ResourceCapacityLoopCanonicalPacket | null
  readyForSimulation: boolean
  degradedSources: string[]
  failedRequiredSources: string[]
  collected: CollectResult
}

/**
 * 收集 + canonical 化。required 来源任一失败 → packet 为 null 且 readyForSimulation=false
 * （fail closed：不产出「看起来可用」的残缺基线）。
 */
export async function collectAndCanonicalize(
  input: BaselineCollectorInput,
): Promise<BaselineBuildResult> {
  const collected = await collectSources(input.defs, input.ctx)

  const failedRequired = collected.outcomes
    .filter((o) => !o.ok && o.required)
    .map((o) => o.sourceId)
  const degradedOptional = collected.outcomes
    .filter((o) => !o.ok && !o.required)
    .map((o) => o.sourceId)

  if (failedRequired.length > 0) {
    return {
      packet: null,
      readyForSimulation: false,
      degradedSources: degradedOptional,
      failedRequiredSources: failedRequired,
      collected,
    }
  }

  const facts: Array<Parameters<typeof canonicalizePacket>[0]['facts'][number]> = []
  const skillEntries: ResourceCapacityLoopCanonicalPacket['skillEntries'] = []
  const sources: ResourceCapacityLoopSourceSummary[] = []
  const evidenceRefs: ResourceCapacityLoopEvidenceRef[] = []
  let evidenceSeq = 0

  const pushEvidence = (sourceId: string, key: string, hash: string) => {
    evidenceSeq += 1
    evidenceRefs.push({ evidenceKey: `${sourceId}:${key}`, sourceId, refHash: hash })
    void evidenceSeq
  }

  for (const outcome of collected.outcomes) {
    if (!outcome.ok) continue
    const env = outcome.envelope

    if (env.sourceId === RCCL_SOURCE_IDS.RESOURCE_POOL) {
      for (const p of env.data as Array<{
        resourceId: number
        resourceName: string
        roleKey: string
        allocatedHours: number
        availableCapacityHours: number
        remainingCapacityHours: number
        requirementRefs: Array<{ requirementRefId: string; bucket: string; demandHours: number }>
      }>) {
        // 容量/分配行（role 维度）——demand 恒取 requirement 引用，绝不取 allocated。
        facts.push({
          dimension: 'role',
          dimensionKey: p.roleKey,
          bucket: input.ctx.windowStart,
          demandHours: p.requirementRefs.reduce((acc, r) => acc + r.demandHours, 0),
          allocatedHours: p.allocatedHours,
          availableCapacityHours: p.availableCapacityHours,
          remainingCapacityHours: p.remainingCapacityHours,
          factState: 'visible',
        })
        for (const r of p.requirementRefs) {
          pushEvidence(env.sourceId, `req:${r.requirementRefId}`, r.requirementRefId.slice(0, 32))
        }
      }
    } else if (env.sourceId === RCCL_SOURCE_IDS.SKILL_MATRIX) {
      for (const s of env.data as Array<{
        normalizedSkillKey: string
        originalLabels: string[]
        proficiencyLevel: number | null
        coveredResourceCount: number | null
        factState: string
      }>) {
        skillEntries.push({
          normalizedSkillKey: s.normalizedSkillKey,
          originalLabels: s.originalLabels,
          proficiencyLevel: s.proficiencyLevel,
          coveredResourceCount: s.coveredResourceCount,
          factState: s.factState as ResourceCapacityLoopSourceSummary['factState'],
        })
      }
    } else if (env.sourceId === RCCL_SOURCE_IDS.DEMAND_FORECASTING) {
      for (const b of env.data as Array<{
        dimension: 'role' | 'skill' | 'project'
        dimensionKey: string
        bucket: string
        demandHours: number
      }>) {
        facts.push({
          dimension: b.dimension,
          dimensionKey: b.dimensionKey,
          bucket: b.bucket,
          demandHours: b.demandHours,
          allocatedHours: 0,
          availableCapacityHours: 0,
          remainingCapacityHours: 0,
          factState: 'visible',
        })
      }
    } else if (env.sourceId === RCCL_SOURCE_IDS.GAP_ANALYSIS) {
      for (const g of env.data as Array<{
        gapId: string
        dimensionKey: string
        severity: string
        evidenceHashes: string[]
        redacted: boolean
      }>) {
        pushEvidence(RCCL_SOURCE_IDS.GAP_ANALYSIS, g.gapId, g.gapId.slice(0, 32))
        void g.severity
      }
    } else if (env.sourceId === RCCL_SOURCE_IDS.CONTENTION_DETECTION) {
      for (const c of env.data as Array<{ conflictId: string; evidenceHashes: string[] }>) {
        pushEvidence(RCCL_SOURCE_IDS.CONTENTION_DETECTION, c.conflictId, c.conflictId.slice(0, 32))
      }
    }
    void isRequiredSource
  }

  // 来源摘要（供 packet.sources 与 readiness 判定）。
  for (const outcome of collected.outcomes) {
    if (!outcome.ok) continue
    const env = outcome.envelope
    sources.push({
      sourceId: String(env.sourceId),
      sourceVersion: env.sourceVersion,
      signature: env.signature,
      required: isRequiredSource(String(env.sourceId)),
      freshness: env.freshness,
      factState: env.factState,
      warnings: env.warnings,
      truncated: env.truncated,
    })
  }

  const result = canonicalizePacket({
    scope: {
      granularity: input.ctx.granularity,
      windowStart: input.ctx.windowStart,
      windowEnd: input.ctx.windowEnd,
      projectIds: input.scopeProjectIds,
    },
    facts,
    skillEntries,
    sources,
    evidenceRefs,
  })

  if (!result.ok) {
    return {
      packet: null,
      readyForSimulation: false,
      degradedSources: degradedOptional,
      failedRequiredSources: [result.reasonCode],
      collected,
    }
  }

  return {
    packet: result.value,
    readyForSimulation: result.value.readyForSimulation,
    degradedSources: degradedOptional,
    failedRequiredSources: [],
    collected,
  }
}
