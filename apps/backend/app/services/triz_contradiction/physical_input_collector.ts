import { isoDay } from '#services/project_health_service'
import db from '@adonisjs/lucid/services/db'
import type { ContradictionInputWarning } from '@aiproj/types'
import { inject } from '@adonisjs/core'
import type { PhysicalAnalysisCollectorOutput } from '@aiproj/types'

/**
 * 物理矛盾分析输入收集器（v3-triz-physical-contradiction-analyzer §4.1）。
 *
 * 从任务、资源、风险、范围、矛盾快照、Compiler 分析产物、Workbench 来源与用户上下文
 * 只读收集低敏输入。模块不可用 / 权限不足时给 warning 并脱敏；不调用任何写操作。
 *
 * 组织隔离：tasks/wbs_nodes/resources/milestones 这类表没有自己的 organization_id
 * （按 TenantScopeRegistry 它们是项目派生资源），组织归属只能经项目父级判定。
 * 因此这里先用 (id, organization_id) 定位项目，定位不到就整体短路返回空输入——
 * 否则传一个不属于本组织的 projectId 仍能读到该项目的任务与资源（红线 3 破口）。
 */
@inject()
export default class PhysicalContradictionAnalysisInputCollector {
  async collect(
    organizationId: number,
    projectId: number,
    actorId: number,
    userContext?: string,
  ): Promise<PhysicalAnalysisCollectorOutput> {
    const warnings: ContradictionInputWarning[] = []
    const sourceHashes: Record<string, string> = {}
    const nowStr = new Date().toISOString()
    const todayStr = nowStr.slice(0, 10)

    // ── 项目基础信息（同时是组织归属的判定点）──
    let projectName = ''
    let plannedDurationDays: number | null = null
    let projectResolved = false
    try {
      const project = await db
        .from('projects')
        .where('id', projectId)
        .where('organization_id', organizationId)
        .whereNull('deleted_at')
        .select('name', 'start_date', 'end_date')
        .first()
      if (project) {
        projectResolved = true
        projectName = String(project.name ?? '')
        if (project.start_date && project.end_date) {
          const start = new Date(isoDay(project.start_date) ?? '').getTime()
          const end = new Date(isoDay(project.end_date) ?? '').getTime()
          if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
            plannedDurationDays = Math.round((end - start) / (1000 * 60 * 60 * 24))
          }
        }
      }
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '项目数据读取失败',
        source: 'projects',
      })
    }

    // 组织归属判定失败即短路：不可访问的项目不得被读出任何派生数据，
    // 且返回形状与「项目存在但无数据」一致，不暴露项目是否存在。
    if (!projectResolved) {
      return this.emptyOutput(organizationId, projectId, actorId, userContext, nowStr, warnings)
    }

    // ── 任务聚合 ──
    let taskCount = 0
    let overdueTaskCount = 0
    let criticalPathTaskCount = 0
    let scopeItemCount = 0
    try {
      const taskRows = await db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('status', 'end_date', 'is_critical_path')

      taskCount = taskRows.length
      for (const t of taskRows) {
        if (t.is_critical_path) criticalPathTaskCount++
        const due = isoDay(t.end_date)
        const status = String(t.status ?? '')
        if (due !== null && due < todayStr && status !== 'completed' && status !== 'cancelled') {
          overdueTaskCount++
        }
      }
      scopeItemCount = taskCount
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '任务数据读取失败，范围维度降级',
        source: 'tasks',
      })
    }

    // WBS 范围补充
    try {
      const wbsRow = await db.from('wbs_nodes').where('project_id', projectId).count('* as total')
      scopeItemCount += Number((wbsRow[0] as any)?.$extras?.total ?? (wbsRow[0] as any)?.total ?? 0)
    } catch {
      // WBS 可选
    }

    sourceHashes['tasks'] = `${taskCount}:${overdueTaskCount}:${criticalPathTaskCount}`

    // ── 资源 ──
    let resourceUtilization: number | null = null
    let resourceOverloadCount = 0
    try {
      const resources = await db
        .from('resources')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('id')
      if (resources.length > 0) {
        let totalUtil = 0
        for (const r of resources) {
          const allocRows = await db
            .from('resource_allocations')
            .where('resource_id', r.id)
            .select('allocation_percent')
          const sum = allocRows.reduce(
            (acc: number, a: any) => acc + Number(a.allocation_percent ?? 0),
            0,
          )
          totalUtil += Math.min(sum, 100) / 100
          if (sum > 100) resourceOverloadCount++
        }
        resourceUtilization = totalUtil / resources.length
      }
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '资源模块不可用，资源维度降级',
        source: 'resources',
      })
    }
    sourceHashes['resource'] = `${resourceUtilization?.toFixed(4)}:${resourceOverloadCount}`

    // ── 风险 ──
    let activeRiskCount = 0
    let highRiskCount = 0
    try {
      const riskRows = await db
        .from('risks')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .whereIn('status', ['identified', 'analyzing', 'mitigating'])
        .select('score')
      activeRiskCount = riskRows.length
      for (const r of riskRows) {
        if (Number((r as any).score ?? 0) >= 10) highRiskCount++
      }
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '风险模块不可用，风险维度降级',
        source: 'risks',
      })
    }
    sourceHashes['risks'] = `${activeRiskCount}:${highRiskCount}`

    // ── 里程碑 ──
    let milestoneCount = 0
    try {
      const msRow = await db.from('milestones').where('project_id', projectId).count('* as total')
      milestoneCount = Number((msRow[0] as any)?.$extras?.total ?? (msRow[0] as any)?.total ?? 0)
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '里程碑数据读取失败',
        source: 'milestones',
      })
    }

    // ── 变更请求 ──
    let changeRequestCount = 0
    try {
      const crRow = await db
        .from('change_requests')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .whereNull('deleted_at')
        .count('* as total')
      changeRequestCount = Number(
        (crRow[0] as any)?.$extras?.total ?? (crRow[0] as any)?.total ?? 0,
      )
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '变更请求数据读取失败',
        source: 'change_requests',
      })
    }

    const criticalPathDensity = taskCount > 0 ? criticalPathTaskCount / taskCount : 0

    // ── 已有矛盾快照 ──
    let existingContradictionCount = 0
    const existingContradictionHashes: string[] = []
    try {
      const contradictions = await db
        .from('project_contradictions')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .where('status', '!=', 'dismissed')
        .select('output_hash')
      existingContradictionCount = contradictions.length
      for (const c of contradictions) {
        if (c.output_hash) existingContradictionHashes.push(String(c.output_hash))
      }
    } catch {
      // 矛盾表可能不存在
    }

    // ── 治理复杂度估算 ──
    let governanceComplexity: 'low' | 'medium' | 'high' | null = null
    try {
      if (milestoneCount > 8 || changeRequestCount > 10) {
        governanceComplexity = 'high'
      } else if (milestoneCount > 3 || changeRequestCount > 3) {
        governanceComplexity = 'medium'
      } else {
        governanceComplexity = 'low'
      }
    } catch {
      // 非阻断
    }

    // ── 信息完整度 ──
    let informationCompletenessScore: number | null = null
    try {
      // 估算：有描述的任务占比
      if (taskCount > 0) {
        const described = await db
          .from('tasks')
          .where('project_id', projectId)
          .whereNull('deleted_at')
          .whereNotNull('description')
          .where('description', '!=', '')
          .count('* as total')
        const count = Number(
          (described[0] as any)?.$extras?.total ?? (described[0] as any)?.total ?? 0,
        )
        informationCompletenessScore = Math.min(1, count / taskCount)
      }
    } catch {
      // 非阻断
    }

    // ── Compiler TRIZ 分析产物 ──
    const compilerTrizArtifactSummaries: PhysicalAnalysisCollectorOutput['compilerTrizArtifactSummaries'] =
      []
    try {
      const artifacts = await db
        .from('compiler_artifacts')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .whereIn('kind', [
          'triz_contradiction_analysis',
          'triz_matrix_analysis',
          'triz_physical_analysis',
        ])
        .select('id', 'kind', 'short_summary', 'output_hash')
        .limit(10)
      for (const a of artifacts) {
        compilerTrizArtifactSummaries.push({
          artifactId: Number(a.id),
          kind: String(a.kind ?? ''),
          shortSummary: String(a.short_summary ?? ''),
          hash: String(a.output_hash ?? ''),
          warnings: [],
        })
      }
    } catch {
      // Compiler 工件表可能不存在
    }

    // ── Workbench 来源 ──
    const workbenchSourceSummaries: PhysicalAnalysisCollectorOutput['workbenchSourceSummaries'] = []
    try {
      const schemes = await db
        .from('triz_innovation_schemes')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .where('status', '!=', 'abandoned')
        .select('id', 'title', 'output_hash')
        .limit(10)
      for (const s of schemes) {
        workbenchSourceSummaries.push({
          schemeId: Number(s.id),
          title: String(s.title ?? ''),
          hash: String(s.output_hash ?? ''),
        })
      }
    } catch {
      // Workbench 表可能不存在
    }

    return {
      organizationId,
      projectId,
      actorId,
      projectName,
      taskCount,
      overdueTaskCount,
      scopeItemCount,
      plannedDurationDays,
      resourceUtilization,
      resourceOverloadCount,
      activeRiskCount,
      highRiskCount,
      criticalPathDensity,
      milestoneCount,
      changeRequestCount,
      existingContradictionCount,
      existingContradictionHashes,
      governanceComplexity,
      informationCompletenessScore,
      compilerTrizArtifactSummaries,
      workbenchSourceSummaries,
      userContext: userContext ?? null,
      warnings,
      sourceHashes,
      collectedAt: nowStr,
    }
  }

  /**
   * 组织归属判定失败时的空输入。所有计数归零、所有列表为空，
   * 与「项目存在但完全没有数据」不可区分——不泄露项目是否存在。
   */
  private emptyOutput(
    organizationId: number,
    projectId: number,
    actorId: number,
    userContext: string | undefined,
    nowStr: string,
    warnings: ContradictionInputWarning[],
  ): PhysicalAnalysisCollectorOutput {
    return {
      organizationId,
      projectId,
      actorId,
      projectName: '',
      taskCount: 0,
      overdueTaskCount: 0,
      scopeItemCount: 0,
      plannedDurationDays: null,
      resourceUtilization: null,
      resourceOverloadCount: 0,
      activeRiskCount: 0,
      highRiskCount: 0,
      criticalPathDensity: 0,
      milestoneCount: 0,
      changeRequestCount: 0,
      existingContradictionCount: 0,
      existingContradictionHashes: [],
      governanceComplexity: null,
      informationCompletenessScore: 0,
      compilerTrizArtifactSummaries: [],
      workbenchSourceSummaries: [],
      userContext: userContext ?? null,
      warnings,
      sourceHashes: {},
      collectedAt: nowStr,
    }
  }
}
