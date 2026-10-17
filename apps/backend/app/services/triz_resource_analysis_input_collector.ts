import db from '@adonisjs/lucid/services/db'
import type {
  ResourceAnalysisCollectorInput,
  ResourceAnalysisCollectorOutput,
  ResourceInputWarning,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'

/**
 * TRIZ 资源分析输入收集器（v3-triz-resource-analyzer §4.1–§4.2）。
 *
 * 从项目事实、成员/资源摘要、任务/WBS、风险、文件/知识 refs、Compiler/TRIZ artifact、
 * 功能分析/IFR refs、Workbench/Decision 来源和用户补充草稿中组装只读分析输入。
 * 所有查询强制 organization_id + project_id 双隔离。
 * 模块缺失/无权限时给 warning 并脱敏，禁止跨组织/跨项目误读。
 * 收集过程不调用任何写操作。
 */
@inject()
export default class TrizResourceAnalysisInputCollector {
  async collect(input: ResourceAnalysisCollectorInput): Promise<ResourceAnalysisCollectorOutput> {
    const { organizationId, projectId, actorId, userContext, manualResourceDrafts } = input
    const warnings: ResourceInputWarning[] = []
    const sourceHashes: Record<string, string> = {}

    // ── 项目名称（同时作为组织隔离硬门：项目不属于本组织时不再读取任何下游来源）──
    let projectName = ''
    let projectVisible = false
    try {
      const proj = await db
        .from('projects')
        .where('id', projectId)
        .where('organization_id', organizationId)
        .select('name')
        .first()
      projectName = proj?.name ?? ''
      projectVisible = Boolean(proj)
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        source: 'projects',
        message: '项目数据读取失败',
      })
    }

    if (!projectVisible) {
      // 跨组织或不存在的项目：只回低敏 warning，不返回任何计数、标签或 hash
      return emptyOutput(organizationId, projectId, actorId, manualResourceDrafts, userContext, [
        {
          code: 'PERMISSION_RESTRICTED',
          source: null,
          message: '来源不可用或无访问权限',
        },
      ])
    }

    // ── 成员 ──
    let memberCount = 0
    try {
      // project_members 无 organization_id 列，组织隔离由上方的项目可见性硬门保证
      const members = await db
        .from('project_members')
        .where('project_id', projectId)
        .where('is_active', true)
        .count('* as total')
      memberCount = Number((members[0] as any)?.$extras?.total ?? (members[0] as any)?.total ?? 0)
      sourceHashes.members = `m${memberCount}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        source: 'project_members',
        message: '成员数据读取失败',
      })
    }

    // ── 任务 ──
    let taskTotal = 0
    try {
      const taskRows = await db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .count('* as total')
      taskTotal = Number((taskRows[0] as any)?.$extras?.total ?? (taskRows[0] as any)?.total ?? 0)
      sourceHashes.tasks = `t${taskTotal}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        source: 'tasks',
        message: '任务数据读取失败',
      })
    }

    // ── 正式资源摘要 ──
    let projectResourceCount = 0
    const projectResourceSummary: ResourceAnalysisCollectorOutput['projectResourceSummary'] = []
    let resourceUtilization: number | null = null
    let resourceOverloadCount = 0
    let resourceGapCount = 0
    try {
      const resources = await db
        .from('resources')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('id', 'name', 'resource_type')
      projectResourceCount = resources.length

      // 每个资源的分配总量（allocation_percent 是 0–100 的百分比，可叠加超过 100）
      const allocRows =
        resources.length > 0
          ? await db
              .from('resource_allocations')
              .whereIn(
                'resource_id',
                resources.map((r) => r.id),
              )
              .select('resource_id', 'allocation_percent')
          : []

      const allocationByResource = new Map<number, number>()
      for (const a of allocRows) {
        const rid = Number(a.resource_id)
        allocationByResource.set(
          rid,
          (allocationByResource.get(rid) ?? 0) + Number(a.allocation_percent ?? 0),
        )
      }

      let totalUtilization = 0
      for (const r of resources) {
        const rUtil = allocationByResource.get(Number(r.id)) ?? 0
        totalUtilization += rUtil
        const utilPct = rUtil / 100
        let state: any = 'unknown'
        if (utilPct > 1) state = 'overloaded'
        else if (utilPct >= 0.9) state = 'fully_utilized'
        else if (utilPct > 0) state = 'partially_utilized'
        else state = 'idle'
        if (state === 'overloaded') resourceOverloadCount += 1
        projectResourceSummary.push({
          resourceId: Number(r.id),
          label: String(r.name ?? ''),
          resourceKind: mapResourceTypeToKind(String(r.resource_type ?? '')),
          systemScope: 'internal_system' as const,
          utilizationState: state,
          availability: utilPct < 0.5 ? 'high' : utilPct > 0.9 ? 'low' : 'medium',
          hash: `r${r.id}-u${utilPct.toFixed(2)}`,
        })
      }

      if (resources.length > 0) {
        resourceUtilization = totalUtilization / (resources.length * 100)
        resourceGapCount = projectResourceSummary.filter(
          (r) => r.utilizationState === 'idle',
        ).length
      }

      sourceHashes.project_resources = `r${projectResourceCount}-u${resourceUtilization?.toFixed(2) ?? 'na'}-o${resourceOverloadCount}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        source: 'resources',
        message: '资源数据读取失败',
      })
    }

    // ── WBS ──
    let wbsNodeCount = 0
    try {
      const wbsRows = await db.from('wbs_nodes').where('project_id', projectId).count('* as total')
      wbsNodeCount = Number((wbsRows[0] as any)?.$extras?.total ?? (wbsRows[0] as any)?.total ?? 0)
    } catch {
      // WBS 模块可能不存在；不报阻断
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
      // probability/impact 是 1–5 整数评分，沿用 RiskLevelService 的 5×5 分区：score ≥ 10 为高风险
      highRiskCount = risks.filter(
        (r: any) => Number(r.probability ?? 0) * Number(r.impact ?? 0) >= 10,
      ).length
      sourceHashes.risks = `a${activeRiskCount}-h${highRiskCount}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        source: 'risks',
        message: '风险数据读取失败',
      })
    }

    // ── 文件/知识 refs（项目附件是项目域的文件事实来源）──
    let knowledgeRefCount = 0
    try {
      const files = await db.from('attachments').where('project_id', projectId).count('* as total')
      knowledgeRefCount = Number((files[0] as any)?.$extras?.total ?? (files[0] as any)?.total ?? 0)
      sourceHashes.knowledge = `k${knowledgeRefCount}`
    } catch {
      // 文件模块可能不存在
    }

    // ── Compiler TRIZ artifact ──
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

    // ── 功能分析/IFR refs ──
    const functionAnalysisRefs: Array<{ artifactId: number; shortSummary: string; hash: string }> =
      []
    const ifrRefs: Array<{ artifactId: number; shortSummary: string; hash: string }> = []
    try {
      const faRows = await db
        .from('triz_function_analysis_runs')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .select('id', 'issue_count', 'output_hash')
        .limit(10)
      for (const r of faRows) {
        functionAnalysisRefs.push({
          artifactId: Number(r.id),
          shortSummary: `功能分析运行 #${r.id}（问题候选 ${Number(r.issue_count ?? 0)}）`,
          hash: String(r.output_hash ?? `fa-${r.id}`),
        })
      }
    } catch {
      // 功能分析模块可能不存在
    }
    try {
      const ifrRows = await db
        .from('triz_ifr_visualizations')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .select('id', 'ifr_id', 'output_hash')
        .limit(10)
      for (const r of ifrRows) {
        ifrRefs.push({
          artifactId: Number(r.id),
          shortSummary: `IFR 审查会话 ${String(r.ifr_id ?? r.id)}`,
          hash: String(r.output_hash ?? `ifr-${r.id}`),
        })
      }
    } catch {
      // IFR 模块可能不存在
    }

    // ── Workbench/Decision 来源 ──
    const workbenchSourceSummaries: Array<{ schemeId: number; title: string; hash: string }> = []
    const decisionLogSummaries: Array<{ logId: number; title: string; hash: string }> = []
    try {
      const schemes = await db
        .from('triz_innovation_schemes')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .select('id', 'name', 'scheme_hash')
        .limit(20)
      for (const s of schemes) {
        workbenchSourceSummaries.push({
          schemeId: Number(s.id),
          title: String(s.name ?? `方案 #${s.id}`),
          hash: String(s.scheme_hash ?? `wb-${s.id}`),
        })
      }
    } catch {
      // Workbench 模块可能不存在
    }
    try {
      const logs = await db
        .from('triz_decision_logs')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .select('id', 'decision_type', 'reason_hash')
        .limit(20)
      for (const l of logs) {
        decisionLogSummaries.push({
          logId: Number(l.id),
          title: `决策记录 #${l.id}（${String(l.decision_type ?? 'unknown')}）`,
          hash: String(l.reason_hash ?? `dl-${l.id}`),
        })
      }
    } catch {
      // Decision log 模块可能不存在
    }

    if (projectResourceCount === 0 && (manualResourceDrafts?.length ?? 0) === 0) {
      warnings.push({
        code: 'INSUFFICIENT_RESOURCE_SOURCE',
        source: 'resources',
        message: '无可用的正式资源或用户补充资源草稿',
      })
    }

    return {
      organizationId,
      projectId,
      actorId,
      projectName,
      taskTotal,
      memberCount,
      projectResourceCount,
      projectResourceSummary,
      resourceUtilization,
      resourceOverloadCount,
      resourceGapCount,
      wbsNodeCount,
      activeRiskCount,
      highRiskCount,
      knowledgeRefCount,
      compilerTrizArtifactSummaries,
      functionAnalysisRefs,
      ifrRefs,
      workbenchSourceSummaries,
      decisionLogSummaries,
      manualResourceDrafts: manualResourceDrafts ?? [],
      userContext: userContext ?? null,
      warnings,
      sourceHashes,
      collectedAt: new Date().toISOString(),
    }
  }
}

/**
 * 组织隔离兜底输出：不暴露任何来源计数、标签或 hash，只保留用户自带草稿与低敏 warning。
 */
function emptyOutput(
  organizationId: number,
  projectId: number,
  actorId: number,
  manualResourceDrafts: ResourceAnalysisCollectorInput['manualResourceDrafts'],
  userContext: string | undefined,
  warnings: ResourceInputWarning[],
): ResourceAnalysisCollectorOutput {
  return {
    organizationId,
    projectId,
    actorId,
    projectName: '',
    taskTotal: 0,
    memberCount: 0,
    projectResourceCount: 0,
    projectResourceSummary: [],
    resourceUtilization: null,
    resourceOverloadCount: 0,
    resourceGapCount: 0,
    wbsNodeCount: 0,
    activeRiskCount: 0,
    highRiskCount: 0,
    knowledgeRefCount: 0,
    compilerTrizArtifactSummaries: [],
    functionAnalysisRefs: [],
    ifrRefs: [],
    workbenchSourceSummaries: [],
    decisionLogSummaries: [],
    manualResourceDrafts: manualResourceDrafts ?? [],
    userContext: userContext ?? null,
    warnings,
    sourceHashes: {},
    collectedAt: new Date().toISOString(),
  }
}

function mapResourceTypeToKind(type: string): any {
  const lower = type.toLowerCase()
  if (lower.includes('human') || lower.includes('person') || lower.includes('member'))
    return 'human'
  if (lower.includes('equipment') || lower.includes('hardware') || lower.includes('device'))
    return 'technical'
  if (lower.includes('software') || lower.includes('license')) return 'technical'
  if (lower.includes('budget') || lower.includes('financial') || lower.includes('money'))
    return 'financial'
  if (lower.includes('space') || lower.includes('room') || lower.includes('facility'))
    return 'space'
  if (lower.includes('material') || lower.includes('supply')) return 'material'
  if (lower.includes('info') || lower.includes('data') || lower.includes('knowledge'))
    return 'information'
  if (lower.includes('time') || lower.includes('schedule')) return 'time'
  return 'technical'
}
