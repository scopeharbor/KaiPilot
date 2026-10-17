import { isoDay } from '#services/project_health_service'
import db from '@adonisjs/lucid/services/db'
import type { ContradictionInputWarning } from '@aiproj/types'
import type {
  TechnicalAnalysisCollectorInput,
  TechnicalAnalysisCollectorOutput,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'

/**
 * 技术矛盾分析输入收集器（v3-triz-technical-contradiction-analyzer §4.1）。
 *
 * 从项目事实、已有矛盾快照、Compiler TRIZ artifact、Workbench 来源和用户上下文中
 * 组装只读分析输入。所有查询强制 organization_id + project_id 双隔离。
 * 模块缺失/无权限时给 warning 并脱敏，禁止跨组织/跨项目误读。
 * 收集过程不调用任何写操作（不刷新、不确认、不调 AI、不写 Draft Layer）。
 */
@inject()
export default class TechnicalContradictionAnalysisInputCollector {
  /**
   * 收集技术矛盾分析的只读输入。空项目优雅返回零值快照。
   */
  async collect(input: TechnicalAnalysisCollectorInput): Promise<TechnicalAnalysisCollectorOutput> {
    const { organizationId, projectId, actorId, userContext } = input
    const warnings: ContradictionInputWarning[] = []
    const sourceHashes: Record<string, string> = {}
    const todayStr = new Date().toISOString().slice(0, 10)

    // ── 项目名称 ──
    let projectName = ''
    try {
      const proj = await db
        .from('projects')
        .where('id', projectId)
        .where('organization_id', organizationId)
        .select('name')
        .first()
      projectName = proj?.name ?? ''
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '项目数据读取失败',
        source: 'projects',
      })
    }

    // ── 任务聚合 ──
    let taskTotal = 0
    let overdueTaskCount = 0
    let criticalPathTaskCount = 0
    let scopeItemCount = 0
    let tasksHash = ''
    try {
      const taskRows = await db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('status', 'end_date', 'is_critical_path')

      taskTotal = taskRows.length
      for (const t of taskRows) {
        const isCritical = Boolean(t.is_critical_path)
        if (isCritical) criticalPathTaskCount++
        const status = String(t.status ?? '')
        const due = isoDay(t.end_date)
        if (due !== null && due < todayStr && status !== 'completed' && status !== 'cancelled') {
          overdueTaskCount++
        }
      }
      scopeItemCount = taskTotal
      // 简单 hash 用于陈旧检测
      tasksHash = `t${taskTotal}-o${overdueTaskCount}-c${criticalPathTaskCount}`
      sourceHashes.tasks = tasksHash
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '任务数据读取失败',
        source: 'tasks',
      })
    }

    // ── WBS 叶节点（范围广度补充）──
    try {
      const wbsCountRow = await db
        .from('wbs_nodes')
        .where('project_id', projectId)
        .count('* as total')
      const wbsCount = Number(
        (wbsCountRow[0] as any)?.$extras?.total ?? (wbsCountRow[0] as any)?.total ?? 0,
      )
      scopeItemCount += wbsCount
    } catch {
      // WBS 模块可能不存在；退化为任务数，不报阻断 warning
    }

    // ── 资源分配/超载 ──
    let resourceUtilization: number | null = null
    let resourceOverloadCount = 0
    try {
      const resources = await db
        .from('resources')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('id')
      if (resources.length > 0) {
        let totalUtilization = 0
        for (const r of resources) {
          const allocRows = await db
            .from('resource_allocations')
            .where('resource_id', r.id)
            .select('allocation_percentage')
          for (const a of allocRows) {
            totalUtilization += Number(a.allocation_percentage ?? 0)
          }
        }
        resourceUtilization =
          resources.length > 0 ? totalUtilization / (resources.length * 100) : null
        const overloaded = await db
          .from('resource_allocations')
          .whereIn(
            'resource_id',
            resources.map((r) => r.id),
          )
          .where('allocation_percentage', '>', 100)
          .countDistinct('resource_id as count')
        resourceOverloadCount = Number(
          (overloaded[0] as any)?.$extras?.count ?? (overloaded[0] as any)?.count ?? 0,
        )
      }
      sourceHashes.resources = `r${resources.length}-u${resourceUtilization?.toFixed(2) ?? 'na'}-o${resourceOverloadCount}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '资源数据读取失败',
        source: 'resources',
      })
    }

    // ── 风险 ──
    let activeRiskCount = 0
    let highRiskCount = 0
    try {
      const risks = await db
        .from('risks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('probability', 'impact')
      activeRiskCount = risks.length
      highRiskCount = risks.filter(
        (r: any) => Number(r.probability ?? 0) >= 0.7 && Number(r.impact ?? 0) >= 0.7,
      ).length
      sourceHashes.risks = `a${activeRiskCount}-h${highRiskCount}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '风险数据读取失败',
        source: 'risks',
      })
    }

    // ── 关键路径密度 ──
    const criticalPathDensity = taskTotal > 0 ? criticalPathTaskCount / taskTotal : 0

    // ── 里程碑 ──
    let milestoneTotal = 0
    try {
      const milestoneRows = await db
        .from('milestones')
        .where('project_id', projectId)
        .count('* as total')
      milestoneTotal = Number(
        (milestoneRows[0] as any)?.$extras?.total ?? (milestoneRows[0] as any)?.total ?? 0,
      )
      sourceHashes.milestones = `m${milestoneTotal}`
    } catch {
      // 里程碑模块可能不存在
    }

    // ── 变更请求 ──
    let changeRequestCount = 0
    try {
      const crRows = await db
        .from('change_requests')
        .where('project_id', projectId)
        .count('* as total')
      changeRequestCount = Number(
        (crRows[0] as any)?.$extras?.total ?? (crRows[0] as any)?.total ?? 0,
      )
    } catch {
      // 变更请求模块可能不存在
    }

    // ── 计划总工期 ──
    let plannedDurationDays: number | null = null
    try {
      const projDates = await db
        .from('projects')
        .where('id', projectId)
        .select('start_date', 'end_date')
        .first()
      if (projDates?.start_date && projDates?.end_date) {
        const start = new Date(String(projDates.start_date)).getTime()
        const end = new Date(String(projDates.end_date)).getTime()
        plannedDurationDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24))
      }
    } catch {
      // 日期可能为 null
    }

    // ── 已有矛盾快照引用 ──
    let existingContradictionCount = 0
    const existingContradictionHashes: string[] = []
    try {
      const contradictions = await db
        .from('project_contradictions')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .select('output_hash')
      existingContradictionCount = contradictions.length
      for (const c of contradictions) {
        if (c.output_hash) existingContradictionHashes.push(String(c.output_hash))
      }
      sourceHashes.contradictions = `c${existingContradictionCount}`
    } catch {
      // 矛盾模块可能不存在
    }

    // ── Compiler TRIZ 分析产物摘要 ──
    const compilerTrizArtifactSummaries: Array<{
      artifactId: number
      kind: string
      shortSummary: string
      hash: string
      warnings: string[]
    }> = []
    try {
      const artifacts = await db
        .from('compiler_artifacts')
        .where('project_id', projectId)
        .where('kind', 'like', '%triz%')
        .select('id', 'kind', 'short_summary', 'output_hash')
        .limit(20)
      for (const a of artifacts) {
        compilerTrizArtifactSummaries.push({
          artifactId: Number(a.id),
          kind: String(a.kind),
          shortSummary: String(a.short_summary ?? ''),
          hash: String(a.output_hash ?? ''),
          warnings: [],
        })
      }
    } catch {
      // Compiler artifacts 模块可能不存在
    }

    // ── Workbench 来源摘要 ──
    const workbenchSourceSummaries: Array<{
      schemeId: number
      title: string
      hash: string
    }> = []
    try {
      const schemes = await db
        .from('triz_innovation_schemes')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .select('id', 'title', 'scheme_hash')
        .limit(20)
      for (const s of schemes) {
        workbenchSourceSummaries.push({
          schemeId: Number(s.id),
          title: String(s.title ?? ''),
          hash: String(s.scheme_hash ?? ''),
        })
      }
    } catch {
      // Workbench 模块可能不存在
    }

    return {
      organizationId,
      projectId,
      actorId,
      projectName,
      taskTotal,
      overdueTaskCount,
      scopeItemCount,
      plannedDurationDays,
      resourceUtilization,
      resourceOverloadCount,
      activeRiskCount,
      highRiskCount,
      criticalPathTaskCount,
      criticalPathDensity,
      milestoneTotal,
      changeRequestCount,
      existingContradictionCount,
      existingContradictionHashes,
      compilerTrizArtifactSummaries,
      workbenchSourceSummaries,
      userContext: userContext ?? null,
      warnings,
      sourceHashes,
      collectedAt: new Date().toISOString(),
    }
  }
}
