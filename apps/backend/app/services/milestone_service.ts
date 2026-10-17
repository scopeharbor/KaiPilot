import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Milestone from '#models/milestone'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import AuditService, { AuditEvent } from '#services/audit_service'
import NotificationService from '#services/notification_service'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

/** 里程碑五状态生命周期（对齐 milestones 表 CHECK 约束与 spec）。 */
export type MilestoneStatus = 'not_started' | 'planned' | 'at_risk' | 'achieved' | 'missed'

const MILESTONE_STATUSES: readonly MilestoneStatus[] = [
  'not_started',
  'planned',
  'at_risk',
  'achieved',
  'missed',
]

export function isMilestoneStatus(value: unknown): value is MilestoneStatus {
  return typeof value === 'string' && (MILESTONE_STATUSES as readonly string[]).includes(value)
}

export interface CreateMilestoneInput {
  name: string
  description?: string | null
  status?: string
  plannedDate?: string | null
  displayOrder?: number
}

export interface UpdateMilestoneInput extends Partial<CreateMilestoneInput> {}

export interface MilestoneListFilters {
  status?: string
  sort?: string
  page?: number
  perPage?: number
}

/** 读取时叠加的展示态：`status` 为推导后的展示态，`storedStatus` 为持久化的人工态。 */
export interface MilestoneView {
  milestone: Milestone
  displayStatus: MilestoneStatus
  storedStatus: MilestoneStatus
  /** 展示态是否为系统推导的建议态（display ≠ stored）。 */
  derived: boolean
}

export interface DeriveContext {
  /** 今日 'YYYY-MM-DD'（UTC）。 */
  today: string
  /** 项目预测完工日 'YYYY-MM-DD'；无则不产生 at_risk。 */
  projectPredictedEnd?: string | null
}

/**
 * 纯函数：由持久化状态 + 目标日期 + 项目排程上下文推导「展示态」（design D2）。
 *
 * 规则（不覆盖人工确认、只叠加建议态）：
 * - `achieved` 恒人工、恒 sticky：一旦确认达成，不被 at_risk/missed 改写。
 * - 目标日期早于今日且未达成 → `missed`（逾期提示）。
 * - 目标日期未过但项目预测完工晚于目标 → `at_risk`（风险提示）。
 * - 其余情况返回持久化状态本身。
 *
 * 该函数不产生 `achieved`（禁止自动置达成，task 2.3）；仅产生 missed/at_risk 或回落原态。
 */
export function deriveMilestoneDisplayStatus(
  storedStatus: MilestoneStatus,
  plannedDate: string | null,
  ctx: DeriveContext,
): MilestoneStatus {
  if (storedStatus === 'achieved') return 'achieved'
  if (!plannedDate) return storedStatus
  if (plannedDate < ctx.today) return 'missed'
  if (ctx.projectPredictedEnd && ctx.projectPredictedEnd > plannedDate) return 'at_risk'
  return storedStatus
}

@inject()
export default class MilestoneService {
  constructor(
    private audit: AuditService,
    private notifications: NotificationService,
  ) {}

  // ---------------- 创建 ----------------

  async create(
    organizationId: number,
    projectId: number,
    input: CreateMilestoneInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Milestone> {
    await this.projectOrFail(organizationId, projectId)
    const status = this.normalizeStatus(input.status) ?? 'not_started'

    const milestone = await db.transaction(async (trx) => {
      const displayOrder = input.displayOrder ?? (await this.nextDisplayOrder(projectId, trx))
      const created = await Milestone.create(
        {
          projectId,
          name: input.name,
          description: input.description ?? null,
          status,
          plannedDate: input.plannedDate ? DateTime.fromISO(input.plannedDate) : null,
          displayOrder,
          autoCalculated: false,
        },
        { client: trx },
      )
      await this.audit.log({
        event: AuditEvent.MILESTONE_CREATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'milestone',
        entityId: created.id,
        requestId: ctx.requestId ?? null,
        metadata: { name: created.name, status },
        client: trx,
        strict: true,
      })
      // 显式以 achieved 创建也是人工确认路径，单独记 MILESTONE_ACHIEVED 便于检索。
      if (status === 'achieved') {
        await this.audit.log({
          event: AuditEvent.MILESTONE_ACHIEVED,
          userId: actorUserId,
          organizationId,
          projectId,
          entityType: 'milestone',
          entityId: created.id,
          requestId: ctx.requestId ?? null,
          client: trx,
          strict: true,
        })
      }
      return created
    })
    return milestone
  }

  // ---------------- 列表 ----------------

  async list(
    organizationId: number,
    projectId: number,
    filters: MilestoneListFilters = {},
  ): Promise<{
    data: MilestoneView[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)

    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 50))

    let query = Milestone.query().where('project_id', projectId)
    if (filters.status) query = query.where('status', filters.status)

    // 稳定排序：display_order → planned_date → id（design 2.1）。
    query = query
      .orderBy('display_order', 'asc')
      .orderBy('planned_date', 'asc')
      .orderBy('id', 'asc')

    const paginator = await query.paginate(page, perPage)
    const rows = paginator.all()

    const derive = await this.deriveContext(projectId)
    const data = rows.map((m) => this.toView(m, derive))

    const meta = paginator.getMeta()
    return {
      data,
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  /**
   * 甘特 model 用：取项目全部里程碑（含推导展示态），不分页。list 与甘特共用推导，口径一致（design D2）。
   */
  async listForProject(organizationId: number, projectId: number): Promise<MilestoneView[]> {
    await this.projectOrFail(organizationId, projectId)
    const rows = await Milestone.query()
      .where('project_id', projectId)
      .orderBy('display_order', 'asc')
      .orderBy('planned_date', 'asc')
      .orderBy('id', 'asc')
    const derive = await this.deriveContext(projectId)
    return rows.map((m) => this.toView(m, derive))
  }

  // ---------------- 详情 ----------------

  /**
   * 按 id 取里程碑并校验组织归属：跨组织/不存在均 404（不泄露存在性）。
   * 供扁平路由 `/milestones/:id`（无 projectId）解析归属与项目 id。
   */
  async findInOrgOrFail(
    organizationId: number,
    milestoneId: number,
    client?: TransactionClientContract,
  ): Promise<Milestone> {
    let query = Milestone.query()
      .where('milestones.id', milestoneId)
      .join('projects', 'projects.id', 'milestones.project_id')
      .where('projects.organization_id', organizationId)
      .whereNull('projects.deleted_at')
      .select('milestones.*')
    if (client) query = query.useTransaction(client)
    const milestone = await query.first()
    if (!milestone) {
      throw new ResourceNotFoundException('里程碑不存在')
    }
    return milestone
  }

  async viewOf(projectId: number, milestone: Milestone): Promise<MilestoneView> {
    const derive = await this.deriveContext(projectId)
    return this.toView(milestone, derive)
  }

  // ---------------- 编辑 ----------------

  async update(
    organizationId: number,
    projectId: number,
    milestoneId: number,
    input: UpdateMilestoneInput,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<Milestone> {
    return this.inTransaction(client, async (trx) => {
      const milestone = await this.getMutable(organizationId, projectId, milestoneId, trx)
      const previousStatus = milestone.status as MilestoneStatus

      let nextStatus: MilestoneStatus | undefined
      if (input.status !== undefined) {
        const normalized = this.normalizeStatus(input.status)
        if (!normalized) throw new ValidationException('无效的里程碑状态')
        nextStatus = normalized
        milestone.status = normalized
        // 人工写入的状态一律标记为非推导态（守卫 task 2.3：achieved 只来自此显式路径）。
        milestone.autoCalculated = false
      }
      if (input.name !== undefined) milestone.name = input.name
      if (input.description !== undefined) milestone.description = input.description
      if (input.plannedDate !== undefined) {
        milestone.plannedDate = input.plannedDate ? DateTime.fromISO(input.plannedDate) : null
      }
      if (input.displayOrder !== undefined) milestone.displayOrder = input.displayOrder

      milestone.useTransaction(trx)
      await milestone.save()

      await this.audit.log({
        event: AuditEvent.MILESTONE_UPDATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'milestone',
        entityId: milestone.id,
        requestId: ctx.requestId ?? null,
        changes: { before: { status: previousStatus }, after: { status: milestone.status } },
        metadata: { changed: Object.keys(input) },
        client: trx,
        strict: true,
      })

      // 状态确认为 achieved（此前非 achieved）→ 追加 MILESTONE_ACHIEVED（显式确认审计）。
      if (nextStatus === 'achieved' && previousStatus !== 'achieved') {
        await this.audit.log({
          event: AuditEvent.MILESTONE_ACHIEVED,
          userId: actorUserId,
          organizationId,
          projectId,
          entityType: 'milestone',
          entityId: milestone.id,
          requestId: ctx.requestId ?? null,
          client: trx,
          strict: true,
        })
      }

      return milestone
    })
  }

  // ---------------- 删除 ----------------

  async delete(
    organizationId: number,
    projectId: number,
    milestoneId: number,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<void> {
    await this.inTransaction(client, async (trx) => {
      const milestone = await this.getMutable(organizationId, projectId, milestoneId, trx)
      milestone.useTransaction(trx)
      await milestone.delete()
      await this.audit.log({
        event: AuditEvent.MILESTONE_DELETED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'milestone',
        entityId: milestoneId,
        requestId: ctx.requestId ?? null,
        client: trx,
        strict: true,
      })
    })
  }

  // ---------------- 通知检查 ----------------

  /**
   * 检查项目的所有里程碑，对逾期（missed）和临近（at_risk）的里程碑发送通知。
   * 使用幂等键避免重复通知。
   *
   * TIP：此方法需由定时任务定期调用；当前 P1 无调度基础设施，可手动触发或
   * 在里程碑创建/更新时附带调用。
   */
  async checkAndNotify(organizationId: number, projectId: number): Promise<{ notified: number }> {
    const derive = await this.deriveContext(projectId)
    const rows = await Milestone.query()
      .where('project_id', projectId)
      .orderBy('display_order', 'asc')

    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')

    let notified = 0
    for (const m of rows) {
      const stored = m.status as MilestoneStatus
      const plannedDate = m.plannedDate ? m.plannedDate.toISODate() : null
      const display = deriveMilestoneDisplayStatus(stored, plannedDate, derive)

      if (display === 'missed' && stored !== 'achieved') {
        await this.notifyMilestoneOverdue(organizationId, project, m)
        notified++
      } else if (display === 'at_risk' && stored !== 'achieved') {
        await this.notifyMilestoneApproaching(organizationId, project, m)
        notified++
      }
    }
    return { notified }
  }

  private async notifyMilestoneOverdue(
    organizationId: number,
    project: Project,
    milestone: Milestone,
  ): Promise<void> {
    const members = await ProjectMember.query()
      .where('project_id', project.id)
      .where('is_active', true)

    for (const member of members) {
      await this.notifications.createForUser({
        organizationId,
        recipientId: Number(member.userId),
        type: 'milestone_overdue',
        title: `里程碑已逾期：「${milestone.name}」`,
        body: `项目「${project.name}」的里程碑「${milestone.name}」已过计划日期，请及时关注。`,
        severity: 'warning',
        projectId: project.id,
        targetType: 'milestone',
        targetId: milestone.id,
        actionUrl: `/projects/${project.id}?milestone=${milestone.id}`,
        idempotencyKey: `milestone:${milestone.id}:overdue:${DateTime.now().toISODate()}`,
        metadata: { milestoneName: milestone.name, projectName: project.name },
      })
    }
  }

  private async notifyMilestoneApproaching(
    organizationId: number,
    project: Project,
    milestone: Milestone,
  ): Promise<void> {
    const members = await ProjectMember.query()
      .where('project_id', project.id)
      .where('is_active', true)

    for (const member of members) {
      await this.notifications.createForUser({
        organizationId,
        recipientId: Number(member.userId),
        type: 'milestone_due',
        title: `里程碑即将到期：「${milestone.name}」`,
        body: `项目「${project.name}」的里程碑「${milestone.name}」即将到期，预计工期可能不足。`,
        severity: 'warning',
        projectId: project.id,
        targetType: 'milestone',
        targetId: milestone.id,
        actionUrl: `/projects/${project.id}?milestone=${milestone.id}`,
        idempotencyKey: `milestone:${milestone.id}:due:${DateTime.now().toISODate()}`,
        metadata: { milestoneName: milestone.name, projectName: project.name },
      })
    }
  }

  // ---------------- 内部辅助 ----------------

  private toView(milestone: Milestone, derive: DeriveContext): MilestoneView {
    const stored = milestone.status as MilestoneStatus
    const plannedDate = milestone.plannedDate ? milestone.plannedDate.toISODate() : null
    const displayStatus = deriveMilestoneDisplayStatus(stored, plannedDate, derive)
    return {
      milestone,
      displayStatus,
      storedStatus: stored,
      derived: displayStatus !== stored,
    }
  }

  private normalizeStatus(value: string | undefined): MilestoneStatus | null {
    if (value === undefined) return null
    return isMilestoneStatus(value) ? value : null
  }

  private async nextDisplayOrder(
    projectId: number,
    client: TransactionClientContract,
  ): Promise<number> {
    const row = await client
      .from('milestones')
      .where('project_id', projectId)
      .max('display_order as maxOrder')
      .first()
    const max = Number(row?.maxOrder ?? -1)
    return Number.isFinite(max) ? max + 1 : 0
  }

  /**
   * 推导上下文：今日 + 项目预测完工日（V1 用未完成任务的最晚 end_date 作为轻量代理，
   * 复用既有任务日期而不引入定时任务；关键路径精确预测归后续增强）。
   */
  private async deriveContext(projectId: number): Promise<DeriveContext> {
    const today = DateTime.now().toISODate()!
    const row = await db
      .from('tasks')
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .whereNotIn('status', ['completed', 'cancelled'])
      .whereNotNull('end_date')
      .max('end_date as maxEnd')
      .first()
    const raw = row?.maxEnd as string | Date | null | undefined
    let projectPredictedEnd: string | null = null
    if (raw) {
      projectPredictedEnd =
        raw instanceof Date ? DateTime.fromJSDate(raw).toISODate() : String(raw).slice(0, 10)
    }
    return { today, projectPredictedEnd }
  }

  private async getMutable(
    organizationId: number,
    projectId: number,
    milestoneId: number,
    client: TransactionClientContract,
  ): Promise<Milestone> {
    await this.projectOrFail(organizationId, projectId, client)
    const milestone = await Milestone.query({ client })
      .where('id', milestoneId)
      .where('project_id', projectId)
      .first()
    if (!milestone) {
      throw new ResourceNotFoundException('里程碑不存在')
    }
    return milestone
  }

  private async inTransaction<T>(
    client: TransactionClientContract | undefined,
    operation: (transaction: TransactionClientContract) => Promise<T>,
  ): Promise<T> {
    return client ? operation(client) : db.transaction(operation)
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
    if (!project) {
      throw new ResourceNotFoundException('项目不存在')
    }
    return project
  }
}
