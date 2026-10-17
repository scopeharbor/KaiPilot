import { ResourceNotFoundException } from '#exceptions/api_exception'
import GanttBaseline, { type GanttBaselineSnapshot } from '#models/gantt_baseline'
import Milestone from '#models/milestone'
import Project from '#models/project'
import Task from '#models/task'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

@inject()
export default class GanttBaselineService {
  constructor(private audit: AuditService) {}

  async get(organizationId: number, projectId: number): Promise<GanttBaseline | null> {
    await this.projectOrFail(organizationId, projectId)
    return GanttBaseline.query().where('project_id', projectId).first()
  }

  async save(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<GanttBaseline> {
    return db.transaction(async (trx) => {
      await this.projectOrFail(organizationId, projectId, trx)
      const [tasks, milestones] = await Promise.all([
        Task.query({ client: trx })
          .where('project_id', projectId)
          .whereNull('deleted_at')
          .orderBy('id'),
        Milestone.query({ client: trx }).where('project_id', projectId).orderBy('id'),
      ])
      const snapshot: GanttBaselineSnapshot = {
        tasks: tasks.map((task) => ({
          id: task.id,
          startDate: task.startDate?.toISODate() ?? null,
          endDate: task.endDate?.toISODate() ?? null,
          // W1.5：打基线时将任务成本估算固化为不可篡改的基线成本（EVM 数据源）
          baselineCostCents: task.costEstimateCents ?? 0,
        })),
        milestones: milestones.map((milestone) => ({
          id: milestone.id,
          plannedDate: milestone.plannedDate?.toISODate() ?? null,
        })),
        savedAt: DateTime.utc().toISO()!,
        totalBaselineCostCents: tasks.reduce((sum, task) => sum + (task.costEstimateCents ?? 0), 0),
      }
      const baseline = await GanttBaseline.updateOrCreate(
        { projectId },
        { snapshot, createdBy: actorUserId },
        { client: trx },
      )
      await this.audit.log({
        event: AuditEvent.GANTT_BASELINE_SAVED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'project',
        entityId: projectId,
        requestId: ctx.requestId ?? null,
        metadata: { taskCount: tasks.length, milestoneCount: milestones.length },
        client: trx,
        strict: true,
      })
      return baseline
    })
  }

  private async projectOrFail(
    organizationId: number,
    projectId: number,
    client?: TransactionClientContract,
  ): Promise<Project> {
    let query = Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
    if (client) query = query.useTransaction(client)
    const project = await query.first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }
}
