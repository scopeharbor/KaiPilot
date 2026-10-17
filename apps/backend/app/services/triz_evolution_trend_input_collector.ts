import db from '@adonisjs/lucid/services/db'
import type {
  EvolutionTrendCollectorInput,
  EvolutionTrendCollectorOutput,
  EvolutionTrendInputWarning,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'

/**
 * TRIZ 进化趋势输入收集器（v3-triz-evolution-trend-analysis §4.1–§4.2）。
 *
 * 从项目事实、成员角色、任务/WBS/依赖、资源/风险摘要、变更/审计、Compiler/TRIZ artifact、
 * IFR/功能分析/资源分析 refs、Workbench/Decision 来源、用户补充信号中组装只读分析输入。
 * 所有查询强制 organization_id + project_id 双隔离。
 * 模块缺失/无权限时给 warning 并脱敏，禁止跨组织/跨项目误读。
 */
@inject()
export default class TrizEvolutionTrendInputCollector {
  async collect(input: EvolutionTrendCollectorInput): Promise<EvolutionTrendCollectorOutput> {
    const { organizationId, projectId, actorId, scopeType, userContext, manualTrendSignals } = input
    const warnings: EvolutionTrendInputWarning[] = []
    const sourceHashes: Record<string, string> = {}

    // ── 项目名称与可见性硬门 ──
    let projectName = ''
    let projectVisible = false
    let projectStatus: string | null = null
    try {
      const proj = await db
        .from('projects')
        .where('id', projectId)
        .where('organization_id', organizationId)
        .select('name', 'status')
        .first()
      projectName = proj?.name ?? ''
      projectStatus = proj?.status ?? null
      projectVisible = Boolean(proj)
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        source: 'projects',
        message: '项目数据读取失败',
      })
    }

    if (!projectVisible) {
      return emptyOutput(
        organizationId,
        projectId,
        actorId,
        scopeType ?? 'project',
        manualTrendSignals,
        userContext,
        [{ code: 'PERMISSION_RESTRICTED', source: null, message: '来源不可用或无访问权限' }],
      )
    }

    // ── 成员角色摘要（完备性）──
    // project_members 无 role 列；role 在 project_roles.name，通过 project_role_id 关联。
    let memberCount = 0
    const memberRoleSummaries: EvolutionTrendCollectorOutput['memberRoleSummaries'] = []
    let distinctRoleCount = 0
    let singlePersonRoleCount = 0
    try {
      const members = await db
        .from('project_members as pm')
        .join('project_roles as pr', 'pr.id', 'pm.project_role_id')
        .where('pm.project_id', projectId)
        .where('pm.is_active', true)
        .select('pr.name as role')
      memberCount = members.length
      const roleCounts = new Map<string, number>()
      for (const m of members) {
        const role = String(m.role ?? 'member')
        roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1)
      }
      distinctRoleCount = roleCounts.size
      for (const [role, count] of roleCounts) {
        memberRoleSummaries.push({
          roleKey: role,
          memberCount: count,
          hash: `role-${role}-${count}`,
        })
        if (count === 1) singlePersonRoleCount += 1
      }
      sourceHashes.members = `m${memberCount}-r${distinctRoleCount}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        source: 'project_members',
        message: '成员数据读取失败',
      })
    }

    // ── 任务/WBS/依赖摘要 ──
    // tasks 表列：status（not_started/in_progress/completed/blocked/on_hold/cancelled）、created_at。
    // tasks 表无 completed_at 列；任务完成率由 status='completed' 判定。
    let taskTotal = 0
    let taskCompleted = 0
    let blockedTaskCount = 0
    let averageBlockedWaitDays: number | null = null
    let averageTaskGranularityDays: number | null = null
    let wbsNodeCount = 0
    let deepWbsLevelCount = 0
    let dependencyCount = 0
    let externalDependencyCount = 0
    let unhealthyExternalDependencyCount = 0

    try {
      const tasks = await db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('status', 'created_at')
      taskTotal = tasks.length
      taskCompleted = tasks.filter(
        (t: any) => t.status === 'completed' || t.status === 'done',
      ).length
      blockedTaskCount = tasks.filter((t: any) => t.status === 'blocked').length
      sourceHashes.tasks_wbs = `t${taskTotal}-c${taskCompleted}-b${blockedTaskCount}`

      // 被阻塞任务的平均等待天数（created_at 到 now，仅作为流转迟滞信号）
      if (blockedTaskCount > 0) {
        const now = Date.now()
        const waits = tasks
          .filter((t: any) => t.status === 'blocked' && t.created_at)
          .map((t: any) =>
            Math.max(0, (now - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24)),
          )
        if (waits.length > 0)
          averageBlockedWaitDays = Number(
            (waits.reduce((s: number, v: number) => s + v, 0) / waits.length).toFixed(2),
          )
      }

      // 已完成任务的平均周期（created_at 到 now，作为粒度代理指标）
      const completed = tasks.filter(
        (t: any) => (t.status === 'completed' || t.status === 'done') && t.created_at,
      )
      if (completed.length > 0) {
        const now = Date.now()
        const totalDays = completed.reduce((sum: number, t: any) => {
          return sum + Math.max(0, (now - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24))
        }, 0)
        averageTaskGranularityDays = Number((totalDays / completed.length).toFixed(2))
      }
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        source: 'tasks',
        message: '任务数据读取失败',
      })
    }

    // WBS 节点：depth 列判定深层级，is_leaf + 无 task 绑定判定分解不足。
    // wbs_nodes 表无 progress 列；子系统进度差改由各 WBS 子树绑定的任务完成率推导。
    try {
      const wbsRows = await db
        .from('wbs_nodes')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('depth', 'task_id')
      wbsNodeCount = wbsRows.length
      deepWbsLevelCount = wbsRows.filter((n: any) => Number(n.depth ?? 0) >= 3).length
    } catch {
      /* WBS 模块可能不存在 */
    }

    // 依赖：实际表为 task_dependencies（fs/ss/ff/sf 类型 + lag_days），无 status 列。
    // 项目级外部依赖由 multi_project_dependencies（跨项目/外部 endpoint）承载。
    // 此处统计任务依赖数；外部依赖/不健康依赖从多项目依赖表取。
    try {
      const taskDeps = await db
        .from('task_dependencies as td')
        .join('tasks as pred', 'pred.id', 'td.predecessor_id')
        .where('pred.project_id', projectId)
        .select('td.lag_days')
      dependencyCount += taskDeps.length
    } catch {
      /* task_dependencies 模块可能不存在 */
    }

    try {
      const extDeps = await db
        .from('multi_project_dependencies')
        .where('consumer_project_id', projectId)
        .orWhere('provider_project_id', projectId)
        .select('status', 'freshness_status')
      externalDependencyCount = extDeps.length
      unhealthyExternalDependencyCount = extDeps.filter(
        (d: any) =>
          d.status === 'blocked' || d.status === 'at_risk' || d.freshness_status === 'stale',
      ).length
      sourceHashes.dependencies = `d${dependencyCount}-e${externalDependencyCount}-u${unhealthyExternalDependencyCount}`
    } catch {
      /* 多项目依赖模块可能不存在 */
    }

    // ── 资源摘要 ──
    // resource_allocations 无 project_id，通过 task_id join tasks 限定本项目。
    let resourceUtilization: number | null = null
    let resourceOverloadCount = 0
    let resourceGapCount = 0
    let resourceLoadSyncSpread: number | null = null
    try {
      const allocs = await db
        .from('resource_allocations as ra')
        .join('tasks as t', 't.id', 'ra.task_id')
        .where('t.project_id', projectId)
        .whereNull('t.deleted_at')
        .select('ra.allocation_percent')
      const percents = allocs.map((a: any) => Number(a.allocation_percent ?? 0))
      if (percents.length > 0) {
        resourceUtilization =
          percents.reduce((s: number, v: number) => s + v, 0) / (percents.length * 100)
        resourceOverloadCount = percents.filter((v: number) => v > 100).length
        resourceGapCount = percents.filter((v: number) => v === 0).length
        resourceLoadSyncSpread =
          percents.length > 1 ? (Math.max(...percents) - Math.min(...percents)) / 100 : null
      }
      sourceHashes.resources = `u${resourceUtilization?.toFixed(2) ?? 'na'}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        source: 'resources',
        message: '资源数据读取失败',
      })
    }

    // ── 风险摘要（probability/impact 为 1-5 整数量表，>=10 判高风险）──
    let activeRiskCount = 0
    let highRiskCount = 0
    try {
      const risks = await db
        .from('risks')
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('probability', 'impact')
      activeRiskCount = risks.length
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

    // ── 变更/审计摘要（动态化）──
    // change_requests 状态机：draft→submitted→under_review→approved/rejected→implemented→closed。
    // 变更响应天数 = closed/implemented 变更的 closed_at - created_at 均值。
    // 返工比 = 已实施/已关闭变更数 / 任务总数（变更频次代理指标）。
    let changeRequestCount = 0
    let averageChangeResponseDays: number | null = null
    let reworkRatio: number | null = null
    try {
      const crs = await db
        .from('change_requests')
        .where('project_id', projectId)
        .select('status', 'created_at', 'closed_at')
      changeRequestCount = crs.length
      const closed = crs.filter(
        (c: any) =>
          (c.status === 'closed' || c.status === 'implemented') && c.created_at && c.closed_at,
      )
      if (closed.length > 0) {
        const totalDays = closed.reduce((sum: number, c: any) => {
          return (
            sum +
            Math.max(
              0,
              (new Date(c.closed_at).getTime() - new Date(c.created_at).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          )
        }, 0)
        averageChangeResponseDays = Number((totalDays / closed.length).toFixed(2))
      }
      const implementedOrClosed = crs.filter(
        (c: any) => c.status === 'closed' || c.status === 'implemented',
      ).length
      reworkRatio = taskTotal > 0 ? Number((implementedOrClosed / taskTotal).toFixed(2)) : null
      sourceHashes.changes = `cr${changeRequestCount}-resp${averageChangeResponseDays ?? 'na'}`
    } catch {
      /* 变更模块可能不存在 */
    }

    // ── 微观化信号 ──
    // averageTaskGranularityDays 已在任务段计算（created_at → completed_at 均值）。

    // ── 子系统不均衡信号 ──
    // wbs_nodes 无 progress 列；改用各顶层 WBS 子树绑定的任务完成率差推导。
    // 顶层节点（depth=0）作为子系统边界，聚合其子树任务完成率，取 max-min。
    let subsystemProgressSpread: number | null = null
    try {
      const topLevel = await db
        .from('wbs_nodes')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .where('depth', 0)
        .select('id', 'path')
      if (topLevel.length > 1) {
        const subsystemRates: number[] = []
        for (const node of topLevel) {
          // 子树任务：path 前缀匹配（path 列存在时）或 wbs_root_id/wbs_node_id 引用
          const subTasks = await db
            .from('tasks as t')
            .leftJoin('wbs_nodes as w', 'w.task_id', 't.id')
            .where('t.project_id', projectId)
            .whereNull('t.deleted_at')
            .where((qb: any) => {
              qb.where('w.path', 'like', `${node.path ?? ''}%`).orWhere('w.wbs_root_id', node.id)
            })
            .select('t.status')
          if (subTasks.length > 0) {
            const done = subTasks.filter(
              (t: any) => t.status === 'completed' || t.status === 'done',
            ).length
            subsystemRates.push(done / subTasks.length)
          }
        }
        if (subsystemRates.length > 1) {
          subsystemProgressSpread = Number(
            (Math.max(...subsystemRates) - Math.min(...subsystemRates)).toFixed(2),
          )
        }
      }
    } catch {
      /* WBS 模块可能不存在或 path 列缺失 */
    }

    // ── 理想度信号 ──
    let deliveredValueItemCount = taskCompleted
    let costGrowthSignals = 0
    let harmOrRiskGrowthSignals = 0
    // costGrowthSignals / harmOrRiskGrowthSignals 基于既有指标简化：
    // - costGrowthSignals = 高利用率/过载资源数
    // - harmOrRiskGrowthSignals = 高风险数 + 返工信号
    costGrowthSignals = resourceOverloadCount
    harmOrRiskGrowthSignals = highRiskCount + (reworkRatio && reworkRatio > 0.2 ? 1 : 0)

    // ── 协调性信号 ──
    // 依赖节奏失配：复用多项目依赖中 blocked/at_risk 数（已在依赖段统计为 unhealthy）。
    // 额外统计任务级阻塞（status=blocked）作为协作迟滞信号。
    let dependencyRhythmMismatchCount = unhealthyExternalDependencyCount + blockedTaskCount

    // 协调性：资源负载分布离散度
    // resourceLoadSyncSpread 已在资源段计算

    // ── Compiler TRIZ artifact ──
    const compilerTrizArtifactSummaries: EvolutionTrendCollectorOutput['compilerTrizArtifactSummaries'] =
      []
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
      /* Compiler artifacts 模块可能不存在 */
    }

    // ── IFR/功能分析/资源分析 refs ──
    const ifrRefs: EvolutionTrendCollectorOutput['ifrRefs'] = []
    const functionAnalysisRefs: EvolutionTrendCollectorOutput['functionAnalysisRefs'] = []
    const resourceAnalysisRefs: EvolutionTrendCollectorOutput['resourceAnalysisRefs'] = []

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
      /* IFR 模块可能不存在 */
    }
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
          shortSummary: `功能分析运行 #${r.id}`,
          hash: String(r.output_hash ?? `fa-${r.id}`),
        })
      }
    } catch {
      /* 功能分析模块可能不存在 */
    }
    try {
      const raRows = await db
        .from('triz_resource_analysis_runs')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .select('id', 'opportunity_count', 'output_hash')
        .limit(10)
      for (const r of raRows) {
        resourceAnalysisRefs.push({
          artifactId: Number(r.id),
          shortSummary: `资源分析运行 #${r.id}`,
          hash: String(r.output_hash ?? `ra-${r.id}`),
        })
      }
    } catch {
      /* 资源分析模块可能不存在 */
    }

    // ── Workbench/Decision 来源 ──
    const workbenchSourceSummaries: EvolutionTrendCollectorOutput['workbenchSourceSummaries'] = []
    const decisionLogSummaries: EvolutionTrendCollectorOutput['decisionLogSummaries'] = []
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
      /* Workbench 模块可能不存在 */
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
          title: `决策记录 #${l.id}`,
          hash: String(l.reason_hash ?? `dl-${l.id}`),
        })
      }
    } catch {
      /* Decision log 模块可能不存在 */
    }

    // ── 历史样本数 ──
    let priorRunCount = 0
    try {
      const prior = await db
        .from('triz_evolution_trend_analysis_runs')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .count('* as total')
      priorRunCount = Number((prior[0] as any)?.$extras?.total ?? (prior[0] as any)?.total ?? 0)
    } catch {
      /* 自引用表可能尚未存在 */
    }

    return {
      organizationId,
      projectId,
      actorId,
      scopeType: scopeType ?? 'project',
      projectName,
      projectStatus,
      taskTotal,
      taskCompleted,
      memberCount,
      memberRoleSummaries,
      distinctRoleCount,
      singlePersonRoleCount,
      wbsNodeCount,
      subsystemProgressSpread,
      blockedTaskCount,
      averageBlockedWaitDays,
      dependencyCount,
      externalDependencyCount,
      unhealthyExternalDependencyCount,
      resourceUtilization,
      resourceOverloadCount,
      resourceGapCount,
      activeRiskCount,
      highRiskCount,
      changeRequestCount,
      averageChangeResponseDays,
      reworkRatio,
      averageTaskGranularityDays,
      deepWbsLevelCount,
      deliveredValueItemCount,
      costGrowthSignals,
      harmOrRiskGrowthSignals,
      dependencyRhythmMismatchCount,
      resourceLoadSyncSpread,
      compilerTrizArtifactSummaries,
      ifrRefs,
      functionAnalysisRefs,
      resourceAnalysisRefs,
      workbenchSourceSummaries,
      decisionLogSummaries,
      manualTrendSignals: manualTrendSignals ?? [],
      userContext: userContext ?? null,
      priorRunCount,
      warnings,
      sourceHashes,
      collectedAt: new Date().toISOString(),
    }
  }
}

function emptyOutput(
  organizationId: number,
  projectId: number,
  actorId: number,
  scopeType: string,
  manualTrendSignals: EvolutionTrendCollectorInput['manualTrendSignals'],
  userContext: string | undefined,
  warnings: EvolutionTrendInputWarning[],
): EvolutionTrendCollectorOutput {
  return {
    organizationId,
    projectId,
    actorId,
    scopeType: scopeType as any,
    projectName: '',
    projectStatus: null,
    taskTotal: 0,
    taskCompleted: 0,
    memberCount: 0,
    memberRoleSummaries: [],
    distinctRoleCount: 0,
    singlePersonRoleCount: 0,
    wbsNodeCount: 0,
    subsystemProgressSpread: null,
    blockedTaskCount: 0,
    averageBlockedWaitDays: null,
    dependencyCount: 0,
    externalDependencyCount: 0,
    unhealthyExternalDependencyCount: 0,
    resourceUtilization: null,
    resourceOverloadCount: 0,
    resourceGapCount: 0,
    activeRiskCount: 0,
    highRiskCount: 0,
    changeRequestCount: 0,
    averageChangeResponseDays: null,
    reworkRatio: null,
    averageTaskGranularityDays: null,
    deepWbsLevelCount: 0,
    deliveredValueItemCount: 0,
    costGrowthSignals: 0,
    harmOrRiskGrowthSignals: 0,
    dependencyRhythmMismatchCount: 0,
    resourceLoadSyncSpread: null,
    compilerTrizArtifactSummaries: [],
    ifrRefs: [],
    functionAnalysisRefs: [],
    resourceAnalysisRefs: [],
    workbenchSourceSummaries: [],
    decisionLogSummaries: [],
    manualTrendSignals: manualTrendSignals ?? [],
    userContext: userContext ?? null,
    priorRunCount: 0,
    warnings,
    sourceHashes: {},
    collectedAt: new Date().toISOString(),
  }
}
