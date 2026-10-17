import ChangeRequest from '#models/change_request'
import type {
  ChangeImpactInput,
  AnalysisScope,
  ChangeImpactDimension,
  ImpactEntityRef,
  MissingInput,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'

/**
 * 影响分析输入收集器（v2-change-management-impact-analysis D2, D5）。
 * 只读读取变更请求相关项目事实，输出结构化输入。
 */
@inject()
export default class ChangeImpactInputCollector {
  /**
   * 收集影响分析输入。从变更请求、关联任务、依赖、里程碑、资源、风险读取数据。
   */
  async collect(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    scope?: Partial<AnalysisScope>,
  ): Promise<ChangeImpactInput> {
    const cr = await this.findCrOrFail(organizationId, projectId, changeRequestId)
    const dimensions =
      scope?.dimensions ??
      (['scope', 'schedule', 'resource', 'risk', 'quality'] as ChangeImpactDimension[])
    const maxDepth = scope?.maxPropagationDepth ?? 5

    const missingInputs: MissingInput[] = []
    const warnings: { code: string; message: string; dimension?: ChangeImpactDimension }[] = []

    // 读取关联任务
    const relatedTaskIds = cr.relatedTaskIds as number[] | null
    const relatedDocumentIds = cr.relatedDocumentIds as number[] | null
    const relatedTasks: ImpactEntityRef[] = []
    try {
      const { default: Task } = await import('#models/task')
      if ((relatedTaskIds?.length ?? 0) > 0) {
        const taskRows = await Task.query()
          .where('project_id', projectId)
          .whereIn('id', relatedTaskIds!)
          .select(
            'id',
            'name',
            'start_date',
            'end_date',
            'status',
            'priority',
            'updated_at',
            'is_critical_path',
            'total_float',
            'milestone_id',
            'wbs_node_id',
          )
        for (const t of taskRows) {
          const row = t as unknown as {
            id: number
            name: string
            startDate?: { toISODate?: () => string | null } | null
            endDate?: { toISODate?: () => string | null } | null
            status?: string | null
            priority?: string | null
            updatedAt?: { toISO?: () => string | null } | null
            isCriticalPath?: boolean
            totalFloat?: number | null
            milestoneId?: number | bigint | null
            wbsNodeId?: number | bigint | null
          }
          relatedTasks.push({
            entityType: 'task',
            entityId: row.id,
            title: row.name,
            isVisible: true,
            startDate: row.startDate?.toISODate?.() ?? null,
            endDate: row.endDate?.toISODate?.() ?? null,
            status: row.status ?? null,
            priority: row.priority ?? null,
            updatedAt: row.updatedAt?.toISO?.() ?? null,
            isCriticalPath: Boolean(row.isCriticalPath),
            totalFloat: row.totalFloat ?? null,
            milestoneId:
              row.milestoneId === null || row.milestoneId === undefined
                ? null
                : Number(row.milestoneId),
            wbsNodeId:
              row.wbsNodeId === null || row.wbsNodeId === undefined ? null : Number(row.wbsNodeId),
          } as ImpactEntityRef)
        }
      }
    } catch {
      // 任务表可能不存在（V1 兼容）
    }
    if (relatedTaskIds && relatedTaskIds.length > 0 && relatedTasks.length === 0) {
      warnings.push({
        code: 'RELATED_TASKS_NOT_FOUND',
        message: '关联任务未找到或无权限查看',
        dimension: 'scope',
      })
    }
    if ((relatedTaskIds?.length ?? 0) === 0 && (relatedDocumentIds?.length ?? 0) === 0) {
      missingInputs.push({
        dimension: 'related_object',
        reason: '变更请求未关联任务、WBS、里程碑、交付物或文档',
        requiredData: 'relatedTaskIds 或 relatedDocumentIds',
      })
    }

    // 读取相关依赖
    const relatedDependencies: {
      id: number
      predecessorId: number
      successorId: number
      type: string
      lagDays: number
    }[] = []
    try {
      const dbModule = await import('@adonisjs/lucid/services/db')
      const db = dbModule.default
      const depRows = await db
        .from('task_dependencies')
        .join('tasks as pred', 'pred.id', 'task_dependencies.predecessor_id')
        .where('pred.project_id', projectId)
        .select(
          'task_dependencies.id',
          'task_dependencies.predecessor_id',
          'task_dependencies.successor_id',
          'task_dependencies.type',
          'task_dependencies.lag_days',
        )
      for (const d of depRows) {
        relatedDependencies.push({
          id: d.id,
          predecessorId: d.predecessor_id,
          successorId: d.successor_id,
          type: d.type ?? 'FS',
          lagDays: d.lag_days ?? 0,
        })
      }
    } catch {
      warnings.push({
        code: 'DEPENDENCY_READ_FAILED',
        message: '依赖数据读取失败',
        dimension: 'schedule',
      })
    }

    // 读取关联里程碑
    const relatedMilestones: ImpactEntityRef[] = []
    try {
      const { default: Milestone } = await import('#models/milestone')
      const relatedMilestoneIds = Array.from(
        new Set(
          relatedTasks
            .map((task) => (task as unknown as { milestoneId?: number | null }).milestoneId)
            .filter((id): id is number => typeof id === 'number'),
        ),
      )
      if (relatedMilestoneIds.length > 0) {
        const msRows = await Milestone.query()
          .where('project_id', projectId)
          .whereIn('id', relatedMilestoneIds)
          .select('id', 'title', 'status')
        for (const m of msRows) {
          const row = m as unknown as { id: number; title: string }
          relatedMilestones.push({
            entityType: 'milestone',
            entityId: row.id,
            title: row.title,
            isVisible: true,
          })
        }
      }
    } catch {
      warnings.push({
        code: 'MILESTONE_READ_FAILED',
        message: '里程碑数据读取失败',
        dimension: 'schedule',
      })
    }

    // 读取资源
    const relatedResources: {
      resourceId: number
      resourceName: string
      allocations: { taskId: number; loadPercent: number }[]
      capacity: number
      isVisible: boolean
    }[] = []
    try {
      const { default: Resource } = await import('#models/resource')
      const rRows = await Resource.query().where('project_id', projectId).select('id', 'name')
      for (const r of rRows) {
        const row = r as unknown as { id: number; name: string }
        const allocs: { taskId: number; loadPercent: number }[] = []
        try {
          const dbModule = await import('@adonisjs/lucid/services/db')
          const db = dbModule.default
          const allocRows = await db
            .from('resource_allocations')
            .where('resource_id', row.id)
            .select('task_id', 'load_percent')
          for (const a of allocRows) {
            allocs.push({ taskId: a.task_id, loadPercent: Number(a.load_percent ?? 100) })
          }
        } catch {
          // resource_allocations table may not exist
        }
        relatedResources.push({
          resourceId: row.id,
          resourceName: row.name,
          allocations: allocs,
          capacity: 100,
          isVisible: true,
        })
      }
    } catch {
      warnings.push({
        code: 'RESOURCE_MODULE_DISABLED',
        message: '资源管理模块未启用或数据不可用',
        dimension: 'resource',
      })
    }

    // 读取风险
    const relatedRisks: ImpactEntityRef[] = []
    try {
      const { default: Risk } = await import('#models/risk')
      const riskRows = await Risk.query()
        .where('project_id', projectId)
        .whereIn('status', ['identified', 'analyzing', 'mitigating'])
        .select('id', 'title')
      for (const r of riskRows) {
        const row = r as unknown as { id: number; title: string }
        relatedRisks.push({
          entityType: 'risk',
          entityId: row.id,
          title: row.title,
          isVisible: true,
        })
      }
    } catch {
      warnings.push({
        code: 'RISK_MODULE_DISABLED',
        message: '风险管理模块未启用或数据不可用',
        dimension: 'risk',
      })
    }

    return {
      changeRequest: {
        title: cr.title,
        description: cr.description,
        changeType: cr.changeType,
        priority: (cr as any).priority ?? 'medium',
        impactSummary: (cr as any).impactSummary ?? null,
        relatedTaskIds: cr.relatedTaskIds as number[] | null,
        relatedDocumentIds,
      },
      scope: {
        dimensions,
        maxPropagationDepth: maxDepth,
        includeEvidenceDetails: scope?.includeEvidenceDetails ?? false,
      },
      relatedTasks,
      relatedDependencies,
      relatedMilestones,
      relatedResources,
      relatedRisks,
      ruleVersion: '2.0.0',
      missingInputs,
      warnings,
    }
  }

  private async findCrOrFail(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
  ): Promise<ChangeRequest> {
    const cr = await ChangeRequest.query()
      .where('change_requests.id', changeRequestId)
      .where('change_requests.project_id', projectId)
      .join('projects', 'projects.id', 'change_requests.project_id')
      .where('projects.organization_id', organizationId)
      .whereNull('projects.deleted_at')
      .select('change_requests.*')
      .first()

    if (!cr) {
      const { ResourceNotFoundException } = await import('#exceptions/api_exception')
      throw new ResourceNotFoundException('变更请求不存在')
    }
    return cr
  }
}
