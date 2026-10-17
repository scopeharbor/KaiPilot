import db from '@adonisjs/lucid/services/db'
import type { ContradictionInputWarning } from '@aiproj/types'
import type {
  FunctionAnalysisCollectorInput,
  FunctionAnalysisCollectorOutput,
  ManualComponentDraft,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'

/**
 * TRIZ 功能分析图输入收集器（v3-triz-function-analysis-diagram §4.1）。
 *
 * 从项目事实、WBS、任务、依赖、资源、风险、矛盾引用、Compiler TRIZ artifact、
 * Workbench 来源和用户手工补充组件中组装只读分析输入。
 * 所有查询强制 organization_id + project_id 双隔离。
 * 模块缺失/无权限时给 warning 并降级，禁止跨组织/跨项目误读。
 * 收集过程不调用任何写操作。
 */
@inject()
export default class FunctionAnalysisInputCollector {
  /**
   * 收集功能分析图的只读输入。空项目优雅返回零值快照。
   */
  async collect(input: FunctionAnalysisCollectorInput): Promise<FunctionAnalysisCollectorOutput> {
    const { organizationId, projectId, actorId, userContext, manualComponents } = input
    const warnings: ContradictionInputWarning[] = []
    const sourceHashes: Record<string, string> = {}

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

    // ── 任务组件 ──
    const taskComponents: FunctionAnalysisCollectorOutput['taskComponents'] = []
    try {
      const taskRows = await db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('id', 'title')
      for (const t of taskRows) {
        const hash = `task-${t.id}`
        taskComponents.push({
          taskId: Number(t.id),
          title: String(t.title ?? `任务 #${t.id}`),
          hash,
        })
      }
      sourceHashes.tasks = `tc${taskComponents.length}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '任务数据读取失败',
        source: 'tasks',
      })
    }

    // ── WBS 组件计数 ──
    let wbsComponentCount = 0
    try {
      const wbsCountRow = await db
        .from('wbs_nodes')
        .where('project_id', projectId)
        .count('* as total')
      wbsComponentCount = Number(
        (wbsCountRow[0] as any)?.$extras?.total ?? (wbsCountRow[0] as any)?.total ?? 0,
      )
    } catch {
      // WBS 模块可能不存在
    }

    // ── 依赖关系摘要 ──
    const dependencySummary: FunctionAnalysisCollectorOutput['dependencySummary'] = []
    try {
      const deps = await db
        .from('task_dependencies')
        .whereIn(
          'predecessor_task_id',
          taskComponents.map((t) => t.taskId),
        )
        .select('predecessor_task_id', 'successor_task_id', 'dependency_type')
        .limit(100)
      for (const d of deps) {
        const hash = `dep-${d.predecessor_task_id}-${d.successor_task_id}`
        dependencySummary.push({
          fromTaskId: Number(d.predecessor_task_id),
          toTaskId: Number(d.successor_task_id),
          type: String(d.dependency_type ?? 'finish_to_start'),
          hash,
        })
      }
      sourceHashes.dependencies = `dep${dependencySummary.length}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '依赖数据读取失败',
        source: 'task_dependencies',
      })
    }

    // ── 资源摘要 ──
    const resourceSummary: FunctionAnalysisCollectorOutput['resourceSummary'] = []
    try {
      const resources = await db
        .from('resources')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('id', 'name')
        .limit(50)
      for (const r of resources) {
        resourceSummary.push({
          resourceId: Number(r.id),
          name: String(r.name ?? `资源 #${r.id}`),
          hash: `res-${r.id}`,
        })
      }
      sourceHashes.resources = `res${resourceSummary.length}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '资源数据读取失败',
        source: 'resources',
      })
    }

    // ── 风险摘要 ──
    const riskSummary: FunctionAnalysisCollectorOutput['riskSummary'] = []
    try {
      const risks = await db
        .from('risks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('id', 'title', 'probability', 'impact')
        .limit(50)
      for (const r of risks) {
        riskSummary.push({
          riskId: Number(r.id),
          title: String(r.title ?? `风险 #${r.id}`),
          probability: Number(r.probability ?? 0),
          impact: Number(r.impact ?? 0),
          hash: `risk-${r.id}`,
        })
      }
      sourceHashes.risks = `risk${riskSummary.length}`
    } catch {
      warnings.push({
        code: 'DATA_SOURCE_UNAVAILABLE',
        message: '风险数据读取失败',
        source: 'risks',
      })
    }

    // ── 矛盾引用 ──
    const contradictionRefs: FunctionAnalysisCollectorOutput['contradictionRefs'] = []
    try {
      const contradictions = await db
        .from('project_contradictions')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .select('id', 'contradiction_type')
        .limit(20)
      for (const c of contradictions) {
        contradictionRefs.push({
          contradictionId: Number(c.id),
          type: String(c.contradiction_type ?? 'unknown'),
          hash: `contra-${c.id}`,
        })
      }
      sourceHashes.contradictions = `contra${contradictionRefs.length}`
    } catch {
      // 矛盾模块可能不存在
    }

    // ── Compiler TRIZ artifact 引用 ──
    const compilerArtifactRefs: FunctionAnalysisCollectorOutput['compilerArtifactRefs'] = []
    try {
      const artifacts = await db
        .from('compiler_artifacts')
        .where('project_id', projectId)
        .where('kind', 'like', '%triz%')
        .select('id', 'kind', 'short_summary', 'output_hash')
        .limit(20)
      for (const a of artifacts) {
        compilerArtifactRefs.push({
          artifactId: Number(a.id),
          kind: String(a.kind),
          shortSummary: String(a.short_summary ?? ''),
          hash: String(a.output_hash ?? `art-${a.id}`),
        })
      }
    } catch {
      // Compiler artifacts 模块可能不存在
    }

    // ── Workbench 来源 ──
    const workbenchRefs: FunctionAnalysisCollectorOutput['workbenchRefs'] = []
    try {
      const schemes = await db
        .from('triz_innovation_schemes')
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .select('id', 'title', 'scheme_hash')
        .limit(20)
      for (const s of schemes) {
        workbenchRefs.push({
          schemeId: Number(s.id),
          title: String(s.title ?? ''),
          hash: String(s.scheme_hash ?? `wb-${s.id}`),
        })
      }
    } catch {
      // Workbench 模块可能不存在
    }

    // ── 用户手工补充组件 ──
    const safeManualComponents: ManualComponentDraft[] = (manualComponents ?? []).map((m) => ({
      name: m.name,
      description: m.description,
      relatesTo: m.relatesTo ?? [],
      functionType: m.functionType ?? 'useful',
      strength: m.strength,
    }))

    return {
      organizationId,
      projectId,
      actorId,
      projectName,
      taskComponents,
      wbsComponentCount,
      dependencySummary,
      resourceSummary,
      riskSummary,
      contradictionRefs,
      compilerArtifactRefs,
      workbenchRefs,
      manualComponents: safeManualComponents,
      userContext: userContext ?? null,
      warnings,
      sourceHashes,
      collectedAt: new Date().toISOString(),
    }
  }
}
