import db from '@adonisjs/lucid/services/db'
import type { PmSourceRef, PmSourceKind, PhaseWarning } from '@aiproj/types'
import { buildSourceMappingKey, simpleHash8 } from '@aiproj/types'
import { inject } from '@adonisjs/core'

/**
 * TRIZ-PM 阶段整合输入收集器（v3-triz-pm-phase-integration §4.1–§4.8）。
 *
 * 从项目事实、任务/WBS/里程碑/依赖/风险/资源/变更摘要、Compiler/TRIZ artifact、
 * Workbench/Decision/Draft/Clarification refs、用户补充信号中组装只读分析输入。
 * 所有查询强制 organization_id + project_id 双隔离。
 * 模块缺失/无权限时给 warning 并脱敏，禁止跨组织/跨项目误读。
 */
export interface PmPhaseCollectorOutput {
  organizationId: number
  projectId: number
  actorId: number
  sourceRefs: PmSourceRef[]
  sourceHashes: Record<string, string>
  warnings: PhaseWarning[]
}

@inject()
export default class TrizPmPhaseInputCollector {
  async collect(
    organizationId: number,
    projectId: number,
    actorId: number,
    userNotes?: string,
    scopeFilter?: PmSourceKind[],
  ): Promise<PmPhaseCollectorOutput> {
    const warnings: PhaseWarning[] = []
    const sourceRefs: PmSourceRef[] = []
    const sourceHashes: Record<string, string> = {}
    const filter = scopeFilter ? new Set(scopeFilter) : null

    const addRef = (ref: PmSourceRef) => {
      const key = buildSourceMappingKey(ref.sourceKind, ref.sourceId)
      sourceRefs.push(ref)
      sourceHashes[key] = ref.sourceHash
    }

    const addWarning = (
      code: PhaseWarning['code'],
      message: string,
      severity: PhaseWarning['severity'] = 'medium',
      sourceKind?: PmSourceKind,
    ) => {
      warnings.push({ code, message, severity, sourceKind })
    }

    // ── 项目元数据/状态硬门 ──
    let projectVisible = false
    try {
      const proj = await db
        .from('projects')
        .where('id', projectId)
        .where('organization_id', organizationId)
        .select('name', 'status', 'created_at')
        .first()
      if (proj) {
        projectVisible = true
        const hash = simpleHash8(JSON.stringify(proj))
        addRef({
          sourceKind: 'project_metadata',
          sourceId: `proj-${projectId}`,
          title: String(proj.name ?? ''),
          sourceHash: hash,
          hasNavigation: true,
          sourceTimestamp: proj.created_at,
          statusLabel: String(proj.status ?? ''),
        })
        addRef({
          sourceKind: 'project_status',
          sourceId: `proj-status-${projectId}`,
          title: `项目状态: ${proj.status}`,
          sourceHash: simpleHash8(`status:${proj.status}`),
          hasNavigation: true,
          statusLabel: String(proj.status ?? ''),
        })
      }
    } catch {
      addWarning('SOURCE_UNAVAILABLE', '项目数据读取失败', 'high')
    }

    if (!projectVisible) {
      return {
        organizationId,
        projectId,
        actorId,
        sourceRefs: [],
        sourceHashes: {},
        warnings: [
          {
            code: 'SOURCE_PERMISSION_DENIED',
            message: '项目不可用或无访问权限',
            severity: 'high',
          },
        ],
      }
    }

    // ── 任务摘要 ──
    if (!filter || filter.has('task_summary')) {
      try {
        const tasks = await db.from('tasks').where('project_id', projectId).select('id', 'status')
        const total = tasks.length
        const completed = tasks.filter((t) => t.status === 'completed').length
        const hash = simpleHash8(`tasks:${total}:${completed}`)
        addRef({
          sourceKind: 'task_summary',
          sourceId: `tasks-${projectId}`,
          title: `任务: ${completed}/${total} 已完成`,
          sourceHash: hash,
          hasNavigation: true,
          statusLabel: `${completed}/${total}`,
        })
      } catch {
        addWarning('SOURCE_UNAVAILABLE', '任务数据读取失败', 'medium', 'task_summary')
      }
    }

    // ── WBS 摘要 ──
    if (!filter || filter.has('wbs_summary')) {
      try {
        const wbsNodes = await db
          .from('wbs_nodes')
          .where('project_id', projectId)
          .select('id', 'depth', 'name')
        const total = wbsNodes.length
        const maxDepth = wbsNodes.reduce((m, n) => Math.max(m, Number(n.depth) || 0), 0)
        const hash = simpleHash8(`wbs:${total}:${maxDepth}`)
        addRef({
          sourceKind: 'wbs_summary',
          sourceId: `wbs-${projectId}`,
          title: `WBS: ${total} 节点, 最大深度 ${maxDepth}`,
          sourceHash: hash,
          hasNavigation: true,
          statusLabel: `${total}`,
        })
      } catch {
        addWarning('SOURCE_UNAVAILABLE', 'WBS 数据读取失败', 'medium', 'wbs_summary')
      }
    }

    // ── 里程碑摘要 ──
    if (!filter || filter.has('milestone_summary')) {
      try {
        const milestones = await db
          .from('milestones')
          .where('project_id', projectId)
          .select('id', 'status')
        const total = milestones.length
        const completed = milestones.filter((m) => m.status === 'completed').length
        addRef({
          sourceKind: 'milestone_summary',
          sourceId: `milestones-${projectId}`,
          title: `里程碑: ${completed}/${total}`,
          sourceHash: simpleHash8(`milestones:${total}:${completed}`),
          hasNavigation: true,
          statusLabel: `${completed}/${total}`,
        })
      } catch {
        addWarning('SOURCE_UNAVAILABLE', '里程碑数据读取失败', 'medium', 'milestone_summary')
      }
    }

    // ── 依赖摘要 ──
    if (!filter || filter.has('dependency_summary')) {
      try {
        const deps = await db
          .from('task_dependencies')
          .join('tasks', 'tasks.id', 'task_dependencies.dependent_task_id')
          .where('tasks.project_id', projectId)
          .select('task_dependencies.id')
        const total = deps.length
        addRef({
          sourceKind: 'dependency_summary',
          sourceId: `deps-${projectId}`,
          title: `任务依赖: ${total} 条`,
          sourceHash: simpleHash8(`deps:${total}`),
          hasNavigation: true,
          statusLabel: `${total}`,
        })
      } catch {
        addWarning('SOURCE_UNAVAILABLE', '依赖数据读取失败', 'medium', 'dependency_summary')
      }
    }

    // ── 风险摘要 ──
    if (!filter || filter.has('risk_summary')) {
      try {
        const risks = await db
          .from('risks')
          .where('project_id', projectId)
          .where('organization_id', organizationId)
          .select('id', 'status', 'severity')
        const total = risks.length
        const openRisks = risks.filter((r) => r.status !== 'closed')
        const highSeverity = risks.filter((r) => Number(r.severity) >= 4).length
        addRef({
          sourceKind: 'risk_summary',
          sourceId: `risks-${projectId}`,
          title: `风险: ${total} 个, 高严重度 ${highSeverity}`,
          sourceHash: simpleHash8(`risks:${total}:${openRisks.length}:${highSeverity}`),
          hasNavigation: true,
          statusLabel: `${total}`,
        })
      } catch {
        addWarning('SOURCE_UNAVAILABLE', '风险数据读取失败', 'medium', 'risk_summary')
      }
    }

    // ── 资源摘要 ──
    if (!filter || filter.has('resource_summary')) {
      try {
        const allocs = await db
          .from('resource_allocations')
          .join('tasks', 'tasks.id', 'resource_allocations.task_id')
          .where('tasks.project_id', projectId)
          .select('resource_allocations.id')
        const total = allocs.length
        addRef({
          sourceKind: 'resource_summary',
          sourceId: `resources-${projectId}`,
          title: `资源分配: ${total} 项`,
          sourceHash: simpleHash8(`resources:${total}`),
          hasNavigation: true,
          statusLabel: `${total}`,
        })
      } catch {
        addWarning('SOURCE_UNAVAILABLE', '资源数据读取失败', 'medium', 'resource_summary')
      }
    }

    // ── 变更请求摘要 ──
    if (!filter || filter.has('change_request_summary')) {
      try {
        const crs = await db
          .from('change_requests')
          .where('project_id', projectId)
          .select('id', 'status')
        const total = crs.length
        const open = crs.filter((c) => c.status !== 'closed').length
        addRef({
          sourceKind: 'change_request_summary',
          sourceId: `changes-${projectId}`,
          title: `变更请求: ${open}/${total} 待处理`,
          sourceHash: simpleHash8(`changes:${total}:${open}`),
          hasNavigation: true,
          statusLabel: `${open}/${total}`,
        })
      } catch {
        addWarning('SOURCE_UNAVAILABLE', '变更请求数据读取失败', 'medium', 'change_request_summary')
      }
    }

    // ── 矛盾 refs ──
    if (!filter || filter.has('contradiction_ref')) {
      try {
        const contras = await db
          .from('contradictions')
          .where('project_id', projectId)
          .select('id', 'title', 'type', 'status')
        for (const c of contras) {
          addRef({
            sourceKind: 'contradiction_ref',
            sourceId: `contra-${c.id}`,
            title: String(c.title ?? `矛盾 #${c.id}`),
            sourceHash: simpleHash8(`contra:${c.id}:${c.status}`),
            hasNavigation: true,
            statusLabel: String(c.status ?? ''),
          })
        }
      } catch {
        addWarning('SOURCE_UNAVAILABLE', '矛盾数据读取失败', 'medium', 'contradiction_ref')
      }
    }

    // ── 用户备注 ──
    if (userNotes) {
      addRef({
        sourceKind: 'user_phase_notes',
        sourceId: `user-notes-${actorId}`,
        title: '用户阶段备注',
        sourceHash: simpleHash8(userNotes),
        hasNavigation: false,
      })
    }

    // ── Guarded adapter for unavailable TRIZ sources ──
    // evolution_trend_ref, workbench_ref, decision_ref, draft_readiness_ref,
    // clarification_ref, matrix_ref, technical_analyzer_ref, physical_analyzer_ref,
    // ifr_ref, function_analysis_ref, resource_analysis_ref
    // These are guarded — try each and warn on unavailable
    const guardedSources: Array<{
      kind: PmSourceKind
      table: string | null
      label: string
    }> = [
      {
        kind: 'evolution_trend_ref',
        table: 'triz_evolution_trend_analysis_runs',
        label: '进化趋势',
      },
      { kind: 'ifr_ref', table: 'triz_ifr_analysis_runs', label: 'IFR' },
      { kind: 'function_analysis_ref', table: 'triz_function_analysis_runs', label: '功能分析' },
      { kind: 'resource_analysis_ref', table: 'triz_resource_analysis_runs', label: '资源分析' },
      { kind: 'workbench_ref', table: 'triz_innovation_schemes', label: '创新工作台' },
      { kind: 'decision_ref', table: 'triz_decision_logs', label: '决策日志' },
      { kind: 'matrix_ref', table: null, label: '矛盾矩阵' },
      {
        kind: 'technical_analyzer_ref',
        table: 'triz_technical_contradiction_analysis_runs',
        label: '技术矛盾分析',
      },
      {
        kind: 'physical_analyzer_ref',
        table: 'triz_physical_contradiction_analysis_runs',
        label: '物理矛盾分析',
      },
      { kind: 'draft_readiness_ref', table: null, label: 'Draft 就绪' },
      { kind: 'clarification_ref', table: 'triz_clarification_cards', label: '澄清卡片' },
    ]

    for (const gs of guardedSources) {
      if (filter && !filter.has(gs.kind)) continue
      try {
        if (gs.table) {
          const count = await db
            .from(gs.table)
            .where('project_id', projectId)
            .count('* as total')
            .first()
          const total = Number(count?.total ?? 0)
          if (total > 0) {
            addRef({
              sourceKind: gs.kind,
              sourceId: `${gs.kind}-${projectId}`,
              title: `${gs.label}: ${total} 项`,
              sourceHash: simpleHash8(`${gs.kind}:${projectId}:${total}`),
              hasNavigation: true,
              statusLabel: `${total}`,
            })
          }
        } else {
          // 无独立表：标记为 guarded adapter fallback
          addWarning(
            'GUARDED_ADAPTER_FALLBACK',
            `${gs.label} 适配器暂不可用，数据待后续补全`,
            'low',
            gs.kind,
          )
        }
      } catch {
        addWarning(
          'GUARDED_ADAPTER_FALLBACK',
          `${gs.label} 数据读取失败，模块可能尚未部署`,
          'low',
          gs.kind,
        )
      }
    }

    return { organizationId, projectId, actorId, sourceRefs, sourceHashes, warnings }
  }
}
