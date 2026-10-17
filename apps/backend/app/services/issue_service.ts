/**
 * v3-chart-gallery-data-foundation —— IssueService（W2.6）。
 *
 * 议题与缺陷追踪领域服务。
 *
 * - CRUD 全程强制 `organization_id` 隔离；跨租户/查无一律 ResourceNotFoundException（404，RL-05）
 * - code 项目内唯一（ISS-NNN 风格，登记时自动按序生成；含软删除占用，保证唯一约束安全）
 * - 状态机：open → in_progress → resolved → closed（closed/rejected 均可重开回 open）：
 *   open | in_progress → rejected；进入 resolved 必须回填 rootCause 与 resolution 并打 resolved_at
 * - 关联任务（relatedTaskId）校验必须隶属于当前项目（任务无 organization_id，租户边界由项目承载）
 * - Service 层不含 HTTP；权限门禁由 W5 Policy 层执行
 */
import db from '@adonisjs/lucid/services/db'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Issue from '#models/issue'
import Project from '#models/project'
import Task from '#models/task'
import type { IssuePriority, IssueSeverity, IssueStatus, IssueType } from '#models/issue'
import { DateTime } from 'luxon'

const ISSUE_CODE_PREFIX = 'ISS-'
const CODE_PAD = 3

const TYPES: readonly IssueType[] = ['bug', 'blocker', 'technical', 'process', 'other']
const SEVERITIES: readonly IssueSeverity[] = ['critical', 'major', 'minor', 'trivial']
const PRIORITIES: readonly IssuePriority[] = ['urgent', 'high', 'medium', 'low']
const STATUSES: readonly IssueStatus[] = ['open', 'in_progress', 'resolved', 'closed', 'rejected']

/** 状态机合法流转表（重开统一回到 open，并在重开时清除 resolved_at/closed_at 时间戳）。 */
const ALLOWED_TRANSITIONS: Record<IssueStatus, readonly IssueStatus[]> = {
  open: ['in_progress', 'rejected'],
  in_progress: ['open', 'resolved', 'rejected'],
  resolved: ['closed', 'open'],
  closed: ['open'],
  rejected: ['open'],
}

/** 登记议题载荷。 */
export interface CreateIssueInput {
  title: string
  description?: string | null
  type?: IssueType
  severity?: IssueSeverity
  priority?: IssuePriority
  relatedTaskId?: number | null
  assigneeId?: number | null
}

/** 编辑载荷：全部可选，仅覆盖传入字段；状态与时间戳不受 update 影响。 */
export interface UpdateIssueInput {
  title?: string
  description?: string | null
  type?: IssueType
  severity?: IssueSeverity
  priority?: IssuePriority
  relatedTaskId?: number | null
  assigneeId?: number | null
  rootCause?: string | null
  resolution?: string | null
}

/** 状态流转载荷：进入 resolved 时 rootCause 与 resolution 必填。 */
export interface ChangeIssueStatusInput {
  status: IssueStatus
  rootCause?: string | null
  resolution?: string | null
}

/** 列表过滤与分页。 */
export interface IssueListFilters {
  type?: IssueType
  severity?: IssueSeverity
  priority?: IssuePriority
  status?: IssueStatus
  assigneeId?: number
  page?: number
  perPage?: number
}

export default class IssueService {
  /** 议题分页列表，支持 type/severity/priority/status/assigneeId 过滤，默认按登记时间倒序。 */
  async list(
    organizationId: number,
    projectId: number,
    filters: IssueListFilters = {},
  ): Promise<{
    data: Issue[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)

    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20
    const query = Issue.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')

    if (filters.type) query.where('type', filters.type)
    if (filters.severity) query.where('severity', filters.severity)
    if (filters.priority) query.where('priority', filters.priority)
    if (filters.status) query.where('status', filters.status)
    if (filters.assigneeId) query.where('assignee_id', filters.assigneeId)
    query.orderBy('created_at', 'desc').orderBy('id', 'desc')

    const result = await query.paginate(page, perPage)
    return {
      data: result.all(),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /** 登记议题：自动生成项目内递增业务编号（ISS-NNN），初始状态 open。 */
  async create(
    organizationId: number,
    projectId: number,
    input: CreateIssueInput,
    reporterUserId: number,
  ): Promise<Issue> {
    await this.projectOrFail(organizationId, projectId)

    const type = input.type ?? 'bug'
    const severity = input.severity ?? 'minor'
    const priority = input.priority ?? 'medium'
    this.assertEnum(type, TYPES, '无效的议题类型')
    this.assertEnum(severity, SEVERITIES, '无效的议题严重度')
    this.assertEnum(priority, PRIORITIES, '无效的议题优先级')

    if (input.relatedTaskId !== undefined && input.relatedTaskId !== null) {
      await this.taskInProjectOrFail(projectId, input.relatedTaskId)
    }

    const code = await this.generateCode(projectId)

    return Issue.create({
      organizationId,
      projectId,
      relatedTaskId: input.relatedTaskId ?? null,
      reportedBy: reporterUserId,
      assigneeId: input.assigneeId ?? null,
      code,
      title: input.title,
      description: input.description ?? null,
      type,
      severity,
      priority,
      status: 'open',
      rootCause: null,
      resolution: null,
      resolvedAt: null,
      closedAt: null,
    })
  }

  /** 议题详情（含关联任务与人员关系）。 */
  async get(organizationId: number, projectId: number, issueId: number): Promise<Issue> {
    const issue = await Issue.query()
      .where('id', issueId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .preload('relatedTask')
      .preload('reporter')
      .preload('assignee')
      .first()
    if (!issue) throw new ResourceNotFoundException('议题不存在')
    return issue
  }

  /** 更新议题属性；状态与闭环时间戳只能经 changeStatus 流转。 */
  async update(
    organizationId: number,
    projectId: number,
    issueId: number,
    input: UpdateIssueInput,
  ): Promise<Issue> {
    const issue = await this.issueOrFail(organizationId, projectId, issueId)

    if (input.type !== undefined) this.assertEnum(input.type, TYPES, '无效的议题类型')
    if (input.severity !== undefined) {
      this.assertEnum(input.severity, SEVERITIES, '无效的议题严重度')
    }
    if (input.priority !== undefined) {
      this.assertEnum(input.priority, PRIORITIES, '无效的议题优先级')
    }
    if (input.relatedTaskId !== undefined && input.relatedTaskId !== null) {
      await this.taskInProjectOrFail(projectId, input.relatedTaskId)
    }

    issue.merge({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description ?? null }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.severity !== undefined && { severity: input.severity }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.relatedTaskId !== undefined && {
        relatedTaskId: input.relatedTaskId ?? null,
      }),
      ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId ?? null }),
      ...(input.rootCause !== undefined && { rootCause: input.rootCause ?? null }),
      ...(input.resolution !== undefined && { resolution: input.resolution ?? null }),
    })
    await issue.save()
    return issue
  }

  /**
   * 议题状态机流转。
   * - 非法流转 → ValidationException（422）
   * - 进入 resolved 必须携带非空 rootCause 与 resolution，自动打 resolved_at
   * - 进入 closed 打 closed_at；重开回 open 时清除闭环时间戳
   */
  async changeStatus(
    organizationId: number,
    projectId: number,
    issueId: number,
    input: ChangeIssueStatusInput,
  ): Promise<Issue> {
    const issue = await this.issueOrFail(organizationId, projectId, issueId)
    const fromStatus = issue.status

    if (!STATUSES.includes(input.status)) throw new ValidationException('无效的议题状态')
    const allowed = ALLOWED_TRANSITIONS[fromStatus]
    if (!allowed.includes(input.status)) {
      throw new ValidationException(`不允许从 "${fromStatus}" 转换到 "${input.status}"`)
    }

    const rootCause = input.rootCause?.trim() ?? null
    const resolution = input.resolution?.trim() ?? null
    if (input.status === 'resolved') {
      const effectiveRootCause = rootCause ?? issue.rootCause
      const effectiveResolution = resolution ?? issue.resolution
      if (!effectiveRootCause || !effectiveResolution) {
        throw new ValidationException(
          '标记解决时必须填写根本原因（rootCause）与解决措施（resolution）',
        )
      }
      issue.rootCause = effectiveRootCause
      issue.resolution = effectiveResolution
      issue.resolvedAt = DateTime.now()
    } else {
      if (rootCause !== null) issue.rootCause = rootCause
      if (resolution !== null) issue.resolution = resolution
    }

    if (input.status === 'closed') {
      issue.closedAt = DateTime.now()
    }
    // 重开：清除闭环时间戳，重新进入处理队列
    if (input.status === 'open' && (fromStatus === 'resolved' || fromStatus === 'closed')) {
      issue.resolvedAt = null
      issue.closedAt = null
    }

    issue.status = input.status
    await issue.save()
    return issue
  }

  /** 软删除议题。 */
  async delete(organizationId: number, projectId: number, issueId: number): Promise<void> {
    const issue = await this.issueOrFail(organizationId, projectId, issueId)
    issue.deletedAt = DateTime.now()
    await issue.save()
  }

  /** 生成项目内下一个 ISS-NNN 编号（统计含软删除行，避免唯一约束冲突）。 */
  private async generateCode(projectId: number): Promise<string> {
    const rows = await db
      .from('issues')
      .where('project_id', projectId)
      .whereLike('code', `${ISSUE_CODE_PREFIX}%`)
      .select('code')
    let maxSeq = 0
    for (const row of rows) {
      const seq = Number.parseInt(String(row.code).slice(ISSUE_CODE_PREFIX.length), 10)
      if (Number.isInteger(seq) && seq > maxSeq) maxSeq = seq
    }
    return `${ISSUE_CODE_PREFIX}${String(maxSeq + 1).padStart(CODE_PAD, '0')}`
  }

  private assertEnum<T extends string>(value: T, allowed: readonly T[], message: string): void {
    if (!allowed.includes(value)) throw new ValidationException(message)
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private async issueOrFail(
    organizationId: number,
    projectId: number,
    issueId: number,
  ): Promise<Issue> {
    const issue = await Issue.query()
      .where('id', issueId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!issue) throw new ResourceNotFoundException('议题不存在')
    return issue
  }

  /** 任务必须属于当前项目：任务无 organization_id 列，跨租户任务因 project 不匹配而不可见（404）。 */
  private async taskInProjectOrFail(projectId: number, taskId: number): Promise<Task> {
    const task = await Task.query().where('id', taskId).where('project_id', projectId).first()
    if (!task) throw new ResourceNotFoundException('任务不存在')
    return task
  }
}
