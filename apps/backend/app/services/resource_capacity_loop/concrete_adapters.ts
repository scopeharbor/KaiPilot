// v3-resource-capacity-forecasting-closed-loop —— 具体来源 adapter（任务 4.3/4.5/4.7/4.9）。
//
// 每个 adapter 都是「读取函数 + 有界投影」的工厂：测试注入 fake reader（零 DB/零网络），
// 生产由闭环 Service 注入调用既有领域 Service 的默认 reader。
// adapter 不重算来源业务结论，只做形状裁剪、freshness/warning 透传与 demand≠allocation 分离。

import type { ResourceCapacityLoopWarningCode } from '@aiproj/types/resource-capacity-closed-loop'
import { RESOURCE_CAPACITY_LOOP_WARNING_CODES } from '@aiproj/types/resource-capacity-closed-loop'
import type { RcclSourceEnvelope, RcclSourceReadContext } from './source_adapters.js'

type FactState = RcclSourceEnvelope<unknown>['factState']

interface EnvelopeMeta {
  sourceVersion: string
  signature: string
  generatedAt?: string
  stale?: boolean
  factState?: FactState
  warnings?: ResourceCapacityLoopWarningCode[]
  truncated?: boolean
}

function envelope<T>(sourceId: string, meta: EnvelopeMeta, data: T): RcclSourceEnvelope<T> {
  return {
    sourceId,
    sourceVersion: meta.sourceVersion,
    signature: meta.signature,
    freshness: {
      generatedAt: meta.generatedAt ?? new Date().toISOString(),
      stale: meta.stale ?? false,
    },
    factState: meta.factState ?? ((meta.stale ?? false) ? 'stale' : 'visible'),
    warnings: meta.warnings ?? [],
    truncated: meta.truncated ?? false,
    data,
  }
}

// ─── A1 组织资源池（required）───────────────────────────────────────────────

/** 资源池容量行投影：demand 与 allocation 恒为独立字段。 */
export interface ResourcePoolFactProjection {
  resourceId: number
  resourceName: string
  roleKey: string
  allocatedHours: number
  availableCapacityHours: number
  remainingCapacityHours: number
  /** 需求侧引用（requirements），绝不与 allocation 混写。 */
  requirementRefs: Array<{ requirementRefId: string; bucket: string; demandHours: number }>
}

export function makeResourcePoolAdapter(
  reader: (ctx: RcclSourceReadContext) => Promise<{
    rows: Array<{
      id: number
      name: string
      roleKey?: string | null
      allocatedHours?: number | null
      availableCapacityHours?: number | null
      remainingCapacityHours?: number | null
    }>
    requirements: Array<{
      requirementRefId: string
      resourceId: number
      bucket: string
      demandHours: number
    }>
    metricVersion: string
    signature: string
    generatedAt: string
    stale?: boolean
    truncated?: boolean
    warnings?: ResourceCapacityLoopWarningCode[]
  }>,
) {
  return {
    sourceId: 'organization-resource-pool' as const,
    read: async (
      ctx: RcclSourceReadContext,
    ): Promise<RcclSourceEnvelope<ResourcePoolFactProjection[]>> => {
      const raw = await reader(ctx)
      const byResource = new Map(raw.requirements.map((r) => [r.resourceId, r]))
      const projections = raw.rows.map((r) => ({
        resourceId: Number(r.id),
        resourceName: String(r.name),
        roleKey: String(r.roleKey ?? '')
          .trim()
          .toLowerCase(),
        allocatedHours: Number(r.allocatedHours ?? 0),
        availableCapacityHours: Number(r.availableCapacityHours ?? 0),
        remainingCapacityHours: Number(r.remainingCapacityHours ?? 0),
        // 同资源的 requirement 引用原样保留——不并入 allocated，也不补零伪造。
        requirementRefs: byResource.get(Number(r.id))
          ? [
              {
                requirementRefId: byResource.get(Number(r.id))!.requirementRefId,
                bucket: byResource.get(Number(r.id))!.bucket,
                demandHours: byResource.get(Number(r.id))!.demandHours,
              },
            ]
          : [],
      }))
      return envelope(
        'organization-resource-pool',
        {
          sourceVersion: raw.metricVersion,
          signature: raw.signature,
          generatedAt: raw.generatedAt,
          stale: raw.stale,
          truncated: raw.truncated,
          warnings: raw.warnings,
        },
        projections,
      )
    },
  }
}

// ─── B1 技能矩阵（optional-degradable）──────────────────────────────────────

export interface SkillMatrixProjection {
  normalizedSkillKey: string
  originalLabels: string[]
  proficiencyLevel: number | null
  coveredResourceCount: number | null
  /** 低基数脱敏后不可展示时显式 redacted。 */
  factState: 'visible' | 'redacted' | 'missing' | 'stale'
}

export function makeSkillMatrixAdapter(
  reader: (ctx: RcclSourceReadContext) => Promise<{
    entries: Array<{
      normalizedSkillKey: string
      originalLabels: string[]
      proficiencyLevel: number | null
      coveredResourceCount: number | null
      redacted?: boolean
      unmappable?: boolean
    }>
    sourceVersion: string
    signature: string
    generatedAt: string
    stale?: boolean
  }>,
) {
  return {
    sourceId: 'resource-skill-matrix' as const,
    read: async (
      ctx: RcclSourceReadContext,
    ): Promise<RcclSourceEnvelope<SkillMatrixProjection[]>> => {
      const raw = await reader(ctx)
      const seen = new Set<string>()
      const projections: SkillMatrixProjection[] = []
      for (const e of raw.entries) {
        const key = e.normalizedSkillKey.trim().replace(/\s+/g, ' ').toLowerCase()
        if (!key || seen.has(key) || e.unmappable) continue
        seen.add(key)
        projections.push({
          normalizedSkillKey: key,
          originalLabels: [...e.originalLabels],
          proficiencyLevel: e.proficiencyLevel ?? null, // 熟练度不足不猜测，保留 null
          coveredResourceCount: e.redacted ? null : (e.coveredResourceCount ?? null),
          factState: e.redacted ? 'redacted' : 'visible',
        })
      }
      return envelope(
        'resource-skill-matrix',
        {
          sourceVersion: raw.sourceVersion,
          signature: raw.signature,
          generatedAt: raw.generatedAt,
          stale: raw.stale,
          warnings: raw.stale ? [RESOURCE_CAPACITY_LOOP_WARNING_CODES.SOURCE_STALE] : [],
        },
        projections,
      )
    },
  }
}

// ─── A2 需求预测（required）─────────────────────────────────────────────────

export interface DemandForecastProjection {
  dimension: 'role' | 'skill' | 'project'
  dimensionKey: string
  bucket: string
  demandHours: number
  confidenceBand: 'high' | 'medium' | 'low'
  methodVersion: string
  driverCount: number
  insufficientHistory: boolean
}

export function makeDemandForecastingAdapter(
  reader: (ctx: RcclSourceReadContext) => Promise<{
    buckets: Array<{
      dimension: 'role' | 'skill' | 'project'
      dimensionKey: string
      bucket: string
      demandHours: number
      confidenceBand: 'high' | 'medium' | 'low'
      driverCount?: number
      insufficientHistory?: boolean
    }>
    methodVersion: string
    signature: string
    generatedAt: string
    stale?: boolean
    truncated?: boolean
    warnings?: ResourceCapacityLoopWarningCode[]
  }>,
) {
  return {
    sourceId: 'resource-demand-forecasting' as const,
    read: async (
      ctx: RcclSourceReadContext,
    ): Promise<RcclSourceEnvelope<DemandForecastProjection[]>> => {
      const raw = await reader(ctx)
      const warnings: ResourceCapacityLoopWarningCode[] = [...(raw.warnings ?? [])]
      const projections = raw.buckets.map((b) => {
        if (b.confidenceBand === 'low') {
          warnings.push(RESOURCE_CAPACITY_LOOP_WARNING_CODES.LOW_CONFIDENCE)
        }
        return {
          dimension: b.dimension,
          dimensionKey: String(b.dimensionKey).trim().toLowerCase(),
          bucket: b.bucket.slice(0, 10),
          demandHours: Math.round(b.demandHours * 100) / 100,
          confidenceBand: b.confidenceBand,
          methodVersion: raw.methodVersion,
          driverCount: b.driverCount ?? 0,
          insufficientHistory: b.insufficientHistory ?? false,
        }
      })
      if (projections.some((p) => p.insufficientHistory)) {
        warnings.push(RESOURCE_CAPACITY_LOOP_WARNING_CODES.LOW_CONFIDENCE)
      }
      return envelope(
        'resource-demand-forecasting',
        {
          sourceVersion: raw.methodVersion,
          signature: raw.signature,
          generatedAt: raw.generatedAt,
          stale: raw.stale,
          truncated: raw.truncated,
          warnings: [...new Set(warnings)],
        },
        projections,
      )
    },
  }
}

// ─── A3/A4 统一缺口与资源冲突（required）────────────────────────────────────

export interface GapProjection {
  gapId: string
  dimension: 'role' | 'skill' | 'project'
  dimensionKey: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  reasonCodes: string[]
  affectedWindow: { from: string; to: string }
  evidenceHashes: string[]
  redacted: boolean
}

export function makeGapAnalysisAdapter(
  reader: (ctx: RcclSourceReadContext) => Promise<{
    gaps: Array<{
      gapId: string
      dimension: 'role' | 'skill' | 'project'
      dimensionKey: string
      severity: 'critical' | 'high' | 'medium' | 'low'
      reasonCodes: string[]
      affectedWindow: { from: string; to: string }
      evidenceHashes?: string[]
      redacted?: boolean
    }>
    sourceVersion: string
    signature: string
    generatedAt: string
    stale?: boolean
    unavailable?: boolean
  }>,
) {
  return {
    sourceId: 'resource-gap-analysis' as const,
    read: async (ctx: RcclSourceReadContext): Promise<RcclSourceEnvelope<GapProjection[]>> => {
      const raw = await reader(ctx)
      if (raw.unavailable) {
        // 来源不可用时显式 missing，不产出空数组冒充「无缺口」。
        return envelope(
          'resource-gap-analysis',
          {
            sourceVersion: raw.sourceVersion,
            signature: raw.signature,
            generatedAt: raw.generatedAt,
            factState: 'missing',
          },
          [],
        )
      }
      const projections = raw.gaps.map((g) => ({
        gapId: g.gapId,
        dimension: g.dimension,
        dimensionKey: g.dimensionKey.trim().toLowerCase(),
        severity: g.severity,
        reasonCodes: [...g.reasonCodes].sort(),
        affectedWindow: g.affectedWindow,
        evidenceHashes: [...(g.evidenceHashes ?? [])].sort(),
        redacted: g.redacted ?? false,
      }))
      return envelope(
        'resource-gap-analysis',
        {
          sourceVersion: raw.sourceVersion,
          signature: raw.signature,
          generatedAt: raw.generatedAt,
          stale: raw.stale,
          warnings: raw.stale ? [RESOURCE_CAPACITY_LOOP_WARNING_CODES.SOURCE_STALE] : [],
        },
        projections,
      )
    },
  }
}

export interface ContentionProjection {
  conflictId: string
  resourceRefId: number
  severity: 'critical' | 'high' | 'medium' | 'low'
  reasonCode: string
  affectedBuckets: string[]
  softConflict: boolean
  evidenceHashes: string[]
}

export function makeContentionDetectionAdapter(
  reader: (ctx: RcclSourceReadContext) => Promise<{
    conflicts: Array<{
      conflictId: string
      resourceRefId: number
      severity: 'critical' | 'high' | 'medium' | 'low'
      reasonCode: string
      affectedBuckets: string[]
      softConflict?: boolean
      evidenceHashes?: string[]
    }>
    sourceVersion: string
    signature: string
    generatedAt: string
    stale?: boolean
    truncated?: boolean
  }>,
) {
  return {
    sourceId: 'resource-contention-detection' as const,
    read: async (
      ctx: RcclSourceReadContext,
    ): Promise<RcclSourceEnvelope<ContentionProjection[]>> => {
      const raw = await reader(ctx)
      const projections = raw.conflicts.map((c) => ({
        conflictId: c.conflictId,
        resourceRefId: Number(c.resourceRefId),
        severity: c.severity,
        reasonCode: c.reasonCode,
        affectedBuckets: [...c.affectedBuckets].sort(),
        softConflict: c.softConflict ?? false,
        evidenceHashes: [...(c.evidenceHashes ?? [])].sort(),
      }))
      return envelope(
        'resource-contention-detection',
        {
          sourceVersion: raw.sourceVersion,
          signature: raw.signature,
          generatedAt: raw.generatedAt,
          stale: raw.stale,
          truncated: raw.truncated,
          warnings: raw.stale ? [RESOURCE_CAPACITY_LOOP_WARNING_CODES.SOURCE_STALE] : [],
        },
        projections,
      )
    },
  }
}
