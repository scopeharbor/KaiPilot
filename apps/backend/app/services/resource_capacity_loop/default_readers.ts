// v3-resource-capacity-forecasting-closed-loop —— 生产默认 readers（任务 4.3/4.5/4.7/4.9 接线）。
//
// 把既有领域 Service 的授权输出映射为 adapter reader 形状：
// - 全部经 Service 公开方法（其内部已走组织/项目/资源可见性过滤），不直接查表；
// - user/access 上下文由闭环 Service 层经既有 Policy 构造后传入；
// - 本文件不做业务重算，只做字段映射与有界截断。

import type OrganizationResourcePoolService from '#services/organization_resource_pool_service'
import type ResourceDemandForecastingService from '#services/resource_demand_forecasting_service'
import type ResourceSkillMatrixService from '#services/resource_skill_matrix_service'
import type ResourceGapAnalysisService from '#services/resource_gap_analysis_service'
import type ResourceContentionDetectionService from '#services/resource_contention_detection_service'
import type { RcclSourceReadContext } from './source_adapters.js'

/**
 * 说明：各 Service 方法的完整入参（User 实体、access context、normalized query）
 * 由闭环 baseline Service 在调用点组装（见 Phase 5/7）。此处 reader 以
 * 「已解析的调用器」注入，避免本文件直接依赖 Lucid User 模型造成循环加载。
 */
export interface DefaultReaderDeps {
  resourcePool: Pick<OrganizationResourcePoolService, 'getCapacityMatrix'>
  demandForecasting: Pick<ResourceDemandForecastingService, 'getGapAnalysis'>
  skillMatrix: Pick<ResourceSkillMatrixService, 'getMatrix'>
  gapAnalysis: Pick<ResourceGapAnalysisService, 'getSummary'>
  contention: Pick<ResourceContentionDetectionService, 'listItems'>
}

/** 有界截断工具：超过 max 条即标记 truncated。 */
function bounded<T>(items: T[], max: number): { items: T[]; truncated: boolean } {
  return { items: items.slice(0, max), truncated: items.length > max }
}

/** 组装资源池 reader：容量矩阵行 + requirement 引用分离透传。 */
export function makeDefaultResourcePoolReader(deps: DefaultReaderDeps) {
  return async (ctx: RcclSourceReadContext) => {
    const svc = deps.resourcePool
    const matrix = await (
      svc as unknown as {
        getCapacityMatrix: (
          userId: number,
          organizationId: number,
        ) => Promise<{
          rows: Array<{
            resourceId: number
            resourceName: string | null
            role: string | null
            totalAllocatedHours: number
            totalCapacityHours: number
            totalRemainingHours: number
            redacted: boolean
          }>
        }>
      }
    ).getCapacityMatrix(ctx.userId, ctx.organizationId)

    const { items } = bounded(matrix.rows, RESOURCE_POOL_MAX_ROWS)
    return {
      rows: items.map((r) => ({
        id: r.resourceId,
        name: r.resourceName ?? '',
        roleKey: r.role,
        allocatedHours: r.totalAllocatedHours,
        availableCapacityHours: r.totalCapacityHours,
        remainingCapacityHours: r.totalRemainingHours,
      })),
      // requirement 引用由需求预测来源承担；资源池侧恒空数组保持形状稳定。
      requirements: [],
      metricVersion: 'organization-resource-pool@1',
      signature: `pool:${ctx.organizationId}:${ctx.windowStart}:${ctx.windowEnd}`,
      generatedAt: new Date().toISOString(),
    }
  }
}

const RESOURCE_POOL_MAX_ROWS = 500

/** 需求预测默认 reader：消费 getGapAnalysis 的 role/skill/project buckets。 */
export function makeDefaultDemandForecastingReader(deps: DefaultReaderDeps) {
  return async (ctx: RcclSourceReadContext) => {
    const analysis = await (
      deps.demandForecasting as unknown as {
        getGapAnalysis: (organizationId: number) => Promise<{
          gaps?: Array<{ dimension?: string; key?: string; bucket?: string; hours?: number }>
          warnings?: string[]
        }>
      }
    ).getGapAnalysis(ctx.organizationId)

    const buckets = (analysis.gaps ?? []).map((g) => ({
      dimension: (g.dimension === 'skill' || g.dimension === 'project' ? g.dimension : 'role') as
        'role' | 'skill' | 'project',
      dimensionKey: String(g.key ?? ''),
      bucket: String(g.bucket ?? ctx.windowStart).slice(0, 10),
      demandHours: Number(g.hours ?? 0),
      confidenceBand: 'medium' as const,
    }))
    const boundedBuckets = bounded(buckets, 2000)
    return {
      buckets: boundedBuckets.items,
      methodVersion: 'resource-demand-forecasting@1',
      signature: `fc:${ctx.organizationId}:${ctx.windowStart}:${ctx.windowEnd}`,
      generatedAt: new Date().toISOString(),
      truncated: boundedBuckets.truncated,
    }
  }
}

/** 技能矩阵默认 reader：复用规范化 key 与覆盖计数（脱敏条目 redacted 透传）。 */
export function makeDefaultSkillMatrixReader(deps: DefaultReaderDeps) {
  return async (ctx: RcclSourceReadContext) => {
    const matrix = await (
      deps.skillMatrix as unknown as {
        getMatrix: (organizationId: number) => Promise<{
          rows?: Array<{
            normalizedSkillKey?: string
            skill?: string | null
            originalLabels?: string[]
            proficiencyLevel?: number | null
            coveredResourceCount?: number | null
            redacted?: boolean
          }>
        }>
      }
    ).getMatrix(ctx.organizationId)

    const entries = (matrix.rows ?? []).map((r) => ({
      normalizedSkillKey: String(r.normalizedSkillKey ?? r.skill ?? ''),
      originalLabels: [String(r.skill ?? '')].filter(Boolean),
      proficiencyLevel: r.proficiencyLevel ?? null,
      coveredResourceCount: r.coveredResourceCount ?? null,
      redacted: r.redacted ?? false,
    }))
    const b = bounded(entries, 1000)
    return {
      entries: b.items,
      sourceVersion: 'resource-skill-matrix@1',
      signature: `skill:${ctx.organizationId}`,
      generatedAt: new Date().toISOString(),
      truncated: b.truncated,
    }
  }
}

/** 统一缺口默认 reader。 */
export function makeDefaultGapAnalysisReader(deps: DefaultReaderDeps) {
  return async (ctx: RcclSourceReadContext) => {
    const all = await (
      deps.gapAnalysis as unknown as {
        getSummary: (organizationId: number) => Promise<
          Array<{
            id?: string
            gapId?: string
            dimension?: string
            key?: string
            severity?: string
            reasonCodes?: string[]
            windowFrom?: string
            windowTo?: string
            evidenceHashes?: string[]
          }>
        >
      }
    ).getSummary(ctx.organizationId)

    const gaps = (all ?? []).slice(0, 2000).map((g) => ({
      gapId: String(g.gapId ?? g.id ?? ''),
      dimension: (g.dimension === 'skill' || g.dimension === 'project' ? g.dimension : 'role') as
        'role' | 'skill' | 'project',
      dimensionKey: String(g.key ?? ''),
      severity: (['critical', 'high', 'medium', 'low'].includes(String(g.severity))
        ? g.severity
        : 'low') as 'critical' | 'high' | 'medium' | 'low',
      reasonCodes: g.reasonCodes ?? [],
      affectedWindow: {
        from: String(g.windowFrom ?? ctx.windowStart).slice(0, 10),
        to: String(g.windowTo ?? ctx.windowEnd).slice(0, 10),
      },
    }))
    return {
      gaps,
      sourceVersion: 'resource-gap-analysis@1',
      signature: `gap:${ctx.organizationId}`,
      generatedAt: new Date().toISOString(),
    }
  }
}

/** 资源冲突默认 reader。 */
export function makeDefaultContentionReader(deps: DefaultReaderDeps) {
  return async (ctx: RcclSourceReadContext) => {
    const items = await (
      deps.contention as unknown as {
        listItems: (organizationId: number) => Promise<
          Array<{
            id?: string
            conflictId?: string
            resourceId?: number
            severity?: string
            reasonCode?: string
            buckets?: string[]
            softConflict?: boolean
          }>
        >
      }
    ).listItems(ctx.organizationId)

    const conflicts = (items ?? []).slice(0, 2000).map((c) => ({
      conflictId: String(c.conflictId ?? c.id ?? ''),
      resourceRefId: Number(c.resourceId ?? 0),
      severity: (['critical', 'high', 'medium', 'low'].includes(String(c.severity))
        ? c.severity
        : 'low') as 'critical' | 'high' | 'medium' | 'low',
      reasonCode: String(c.reasonCode ?? 'UNKNOWN'),
      affectedBuckets: c.buckets ?? [],
      softConflict: c.softConflict ?? false,
    }))
    return {
      conflicts,
      sourceVersion: 'resource-contention-detection@1',
      signature: `cont:${ctx.organizationId}`,
      generatedAt: new Date().toISOString(),
    }
  }
}
