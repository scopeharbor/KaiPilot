/**
 * v3-chart-gallery-data-foundation —— RequirementService（W2.3 / W2.4）。
 *
 * 需求实体领域服务 + RTM 需求追踪矩阵只读聚合。
 *
 * - CRUD 全程强制 `organization_id` 隔离；跨租户/查无一律 ResourceNotFoundException（404，RL-05）
 * - code 项目内唯一（REQ-NNN 风格，缺省自动按序生成；含软删除占用，保证唯一约束安全）
 * - bindTask/unbindTask 校验任务必须隶属于当前项目（任务无 organization_id，租户边界由项目承载）
 * - delete 为软删除并物理清理 requirement_tasks 绑定
 * - getRtmMatrix 单次 LEFT JOIN 联表（requirements → requirement_tasks → tasks → users）输出平铺矩阵
 * - Service 层不含 HTTP；权限门禁由 W5 Policy 层执行
 */
import db from '@adonisjs/lucid/services/db'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import Requirement from '#models/requirement'
import RequirementTask from '#models/requirement_task'
import Task from '#models/task'
import type {
  AcceptanceCriterion,
  AcceptanceCriterionStatus,
  RequirementCategory,
  RequirementPriority,
  RequirementStatus,
} from '#models/requirement'
import { DateTime } from 'luxon'

const REQUIREMENT_CODE_PREFIX = 'REQ-'
const CODE_PAD = 3

const CATEGORIES: readonly RequirementCategory[] = [
  'business',
  'user',
  'functional',
  'non_functional',
  'other',
]
const PRIORITIES: readonly RequirementPriority[] = ['lowest', 'low', 'medium', 'high', 'highest']
const STATUSES: readonly RequirementStatus[] = [
  'draft',
  'approved',
  'in_progress',
  'completed',
  'cancelled',
]
const CRITERION_STATUSES: readonly AcceptanceCriterionStatus[] = ['pending', 'passed', 'failed']

/** 创建需求载荷。 */
export interface CreateRequirementInput {
  /** 项目内业务编号（如 REQ-001）；缺省自动生成。 */
  code?: string | null
  title: string
  description?: string | null
  category?: RequirementCategory
  priority?: RequirementPriority
  status?: RequirementStatus
  /** 结构化验收条目；缺省为空数组。 */
  acceptanceCriteria?: AcceptanceCriterion[]
}

/** 编辑载荷：全部可选，仅覆盖传入字段。 */
export interface UpdateRequirementInput {
  code?: string | null
  title?: string
  description?: string | null
  category?: RequirementCategory
  priority?: RequirementPriority
  status?: RequirementStatus
  acceptanceCriteria?: AcceptanceCriterion[]
}

/** 列表过滤与分页。 */
export interface RequirementListFilters {
  category?: RequirementCategory
  priority?: RequirementPriority
  status?: RequirementStatus
  page?: number
  perPage?: number
}

/** RTM 矩阵中的关联任务行。 */
export interface RtmLinkedTask {
  id: number
  name: string
  status: string
  assigneeName: string | null
  progressPercent: number
}

/** RTM 矩阵单行（平铺展开的需求 × 任务）。 */
export interface RtmMatrixEntry {
  requirementId: number
  code: string
  title: string
  category: string
  priority: string
  status: string
  acceptanceCriteria: AcceptanceCriterion[]
  criteriaPassRate: number
  linkedTasks: RtmLinkedTask[]
}

/** RTM 矩阵聚合结果。 */
export interface RtmMatrixResult {
  projectId: number
  totalRequirements: number
  coveragePercent: number
  matrix: RtmMatrixEntry[]
}

export default class RequirementService {
  /** 需求分页列表，支持 category/priority/status 过滤，默认按业务编号升序。 */
  async list(
    organizationId: number,
    projectId: number,
    filters: RequirementListFilters = {},
  ): Promise<{
    data: Requirement[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)

    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20
    const query = Requirement.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')

    if (filters.category) query.where('category', filters.category)
    if (filters.priority) query.where('priority', filters.priority)
    if (filters.status) query.where('status', filters.status)
    query.orderBy('code', 'asc').orderBy('id', 'asc')

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

  /** 创建需求（含结构化验收准则）；code 缺省自动生成 REQ-NNN。 */
  async create(
    organizationId: number,
    projectId: number,
    input: CreateRequirementInput,
    actorUserId: number,
  ): Promise<Requirement> {
    await this.projectOrFail(organizationId, projectId)

    const category = input.category ?? 'functional'
    const priority = input.priority ?? 'medium'
    const status = input.status ?? 'draft'
    this.assertEnum(category, CATEGORIES, '无效的需求分类')
    this.assertEnum(priority, PRIORITIES, '无效的需求优先级')
    this.assertEnum(status, STATUSES, '无效的需求状态')

    const criteria = input.acceptanceCriteria ?? []
    this.validateCriteria(criteria)

    const code = input.code?.trim() ? input.code.trim() : await this.generateCode(projectId)
    const duplicate = await db
      .from('requirements')
      .where('project_id', projectId)
      .where('code', code)
      .first()
    if (duplicate) throw new ValidationException('需求编号已存在，请更换编号')

    return Requirement.create({
      organizationId,
      projectId,
      code,
      title: input.title,
      description: input.description ?? null,
      category,
      priority,
      status,
      acceptanceCriteria: criteria,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })
  }

  /** 需求详情（含已绑定的有效任务清单，软删除任务自动剔除）。 */
  async get(
    organizationId: number,
    projectId: number,
    requirementId: number,
  ): Promise<Requirement> {
    const requirement = await Requirement.query()
      .where('id', requirementId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .preload('requirementTasks', (query) => {
        query.orderBy('id', 'asc').preload('task', (taskQuery) => {
          taskQuery.preload('assignee')
        })
      })
      .first()
    if (!requirement) throw new ResourceNotFoundException('需求不存在')
    return requirement
  }

  /** 更新需求内容（或整表替换验收准则）。 */
  async update(
    organizationId: number,
    projectId: number,
    requirementId: number,
    input: UpdateRequirementInput,
    actorUserId: number,
  ): Promise<Requirement> {
    const requirement = await this.requirementOrFail(organizationId, projectId, requirementId)

    if (input.category !== undefined) {
      this.assertEnum(input.category, CATEGORIES, '无效的需求分类')
    }
    if (input.priority !== undefined) {
      this.assertEnum(input.priority, PRIORITIES, '无效的需求优先级')
    }
    if (input.status !== undefined) {
      this.assertEnum(input.status, STATUSES, '无效的需求状态')
    }
    if (input.acceptanceCriteria !== undefined) {
      this.validateCriteria(input.acceptanceCriteria)
    }
    if (input.code !== undefined) {
      const code = input.code?.trim() ? input.code.trim() : null
      if (code) {
        const duplicate = await db
          .from('requirements')
          .where('project_id', projectId)
          .where('code', code)
          .whereNot('id', requirementId)
          .first()
        if (duplicate) throw new ValidationException('需求编号已存在，请更换编号')
      }
    }

    requirement.merge({
      ...(input.code !== undefined && {
        code: input.code?.trim() ? input.code.trim() : requirement.code,
      }),
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description ?? null }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.acceptanceCriteria !== undefined && {
        acceptanceCriteria: input.acceptanceCriteria,
      }),
      updatedBy: actorUserId,
    })
    await requirement.save()
    return requirement
  }

  /** 单项验收准则状态流转（如 pending → passed），按准则 id 定位。 */
  async updateCriterionStatus(
    organizationId: number,
    projectId: number,
    requirementId: number,
    criterionId: string,
    status: AcceptanceCriterionStatus,
    actorUserId: number,
  ): Promise<Requirement> {
    this.assertEnum(status, CRITERION_STATUSES, '无效的验收准则状态')
    const requirement = await this.requirementOrFail(organizationId, projectId, requirementId)

    const criteria = Array.isArray(requirement.acceptanceCriteria)
      ? requirement.acceptanceCriteria
      : []
    const criterion = criteria.find((item) => item.id === criterionId)
    if (!criterion) throw new ValidationException('验收准则不存在')

    criterion.status = status
    requirement.acceptanceCriteria = criteria
    requirement.updatedBy = actorUserId
    await requirement.save()
    return requirement
  }

  /** 软删除需求并物理清理其 requirement_tasks 绑定记录。 */
  async delete(
    organizationId: number,
    projectId: number,
    requirementId: number,
    actorUserId: number,
  ): Promise<void> {
    const requirement = await this.requirementOrFail(organizationId, projectId, requirementId)

    await db.transaction(async (trx) => {
      await RequirementTask.query({ client: trx })
        .where('organization_id', organizationId)
        .where('requirement_id', requirementId)
        .delete()
      requirement.deletedAt = DateTime.now()
      requirement.updatedBy = actorUserId
      await requirement.useTransaction(trx).save()
    })
  }

  /** 绑定交付任务：任务必须隶属于当前项目（即当前租户），重复绑定幂等返回既有关联。 */
  async bindTask(
    organizationId: number,
    projectId: number,
    requirementId: number,
    taskId: number,
  ): Promise<RequirementTask> {
    await this.requirementOrFail(organizationId, projectId, requirementId)
    await this.taskInProjectOrFail(projectId, taskId)

    const existing = await RequirementTask.query()
      .where('organization_id', organizationId)
      .where('requirement_id', requirementId)
      .where('task_id', taskId)
      .first()
    if (existing) return existing

    return RequirementTask.create({
      organizationId,
      requirementId,
      taskId,
    })
  }

  /** 解除任务绑定；关联不存在 → 404。 */
  async unbindTask(
    organizationId: number,
    projectId: number,
    requirementId: number,
    taskId: number,
  ): Promise<void> {
    await this.requirementOrFail(organizationId, projectId, requirementId)

    const link = await RequirementTask.query()
      .where('organization_id', organizationId)
      .where('requirement_id', requirementId)
      .where('task_id', taskId)
      .first()
    if (!link) throw new ResourceNotFoundException('需求任务关联不存在')

    await link.delete()
  }

  /**
   * RTM 需求追踪矩阵只读聚合。
   * 单次 LEFT JOIN（requirements → requirement_tasks → tasks[未删] → users[负责人]），
   * 平铺输出各需求的验收准则、通过率与关联任务清单；需求无关联任务时仍占一行。
   */
  async getRtmMatrix(organizationId: number, projectId: number): Promise<RtmMatrixResult> {
    await this.projectOrFail(organizationId, projectId)

    const rows = await db
      .from('requirements as r')
      .where('r.organization_id', organizationId)
      .where('r.project_id', projectId)
      .whereNull('r.deleted_at')
      .leftJoin('requirement_tasks as rt', 'rt.requirement_id', 'r.id')
      .leftJoin('tasks as t', (join) => {
        join.on('t.id', '=', 'rt.task_id').andOnNull('t.deleted_at')
      })
      .leftJoin('users as u', 'u.id', '=', 't.assignee_id')
      .select(
        'r.id as requirement_id',
        'r.code',
        'r.title',
        'r.category',
        'r.priority',
        'r.status',
        'r.acceptance_criteria',
        't.id as task_id',
        't.name as task_name',
        't.status as task_status',
        't.progress_percent as task_progress_percent',
        'u.full_name as assignee_name',
      )
      .orderBy('r.code', 'asc')
      .orderBy('t.id', 'asc')

    const rowMap = new Map<number, RtmMatrixEntry>()
    for (const row of rows) {
      const requirementId = Number(row.requirement_id)
      let entry = rowMap.get(requirementId)
      if (!entry) {
        entry = {
          requirementId,
          code: row.code,
          title: row.title,
          category: row.category,
          priority: row.priority,
          status: row.status,
          acceptanceCriteria: this.parseCriteria(row.acceptance_criteria),
          criteriaPassRate: 0,
          linkedTasks: [],
        }
        entry.criteriaPassRate = this.computePassRate(entry.acceptanceCriteria)
        rowMap.set(requirementId, entry)
      }
      if (row.task_id !== null && row.task_id !== undefined) {
        entry.linkedTasks.push({
          id: Number(row.task_id),
          name: row.task_name,
          status: row.task_status,
          assigneeName: row.assignee_name ?? null,
          progressPercent: Number(row.task_progress_percent) || 0,
        })
      }
    }

    const matrix = Array.from(rowMap.values())
    const totalRequirements = matrix.length
    const covered = matrix.filter((entry) => entry.linkedTasks.length > 0).length
    return {
      projectId,
      totalRequirements,
      coveragePercent:
        totalRequirements === 0 ? 0 : Math.round((covered / totalRequirements) * 100),
      matrix,
    }
  }

  private computePassRate(criteria: AcceptanceCriterion[]): number {
    if (criteria.length === 0) return 0
    const passed = criteria.filter((item) => item.status === 'passed').length
    return Math.round((passed / criteria.length) * 100)
  }

  private parseCriteria(raw: unknown): AcceptanceCriterion[] {
    if (typeof raw !== 'string' || raw === '') return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as AcceptanceCriterion[]) : []
    } catch {
      return []
    }
  }

  /** 生成项目内下一个 REQ-NNN 编号（统计含软删除行，避免唯一约束冲突）。 */
  private async generateCode(projectId: number): Promise<string> {
    const rows = await db
      .from('requirements')
      .where('project_id', projectId)
      .whereLike('code', `${REQUIREMENT_CODE_PREFIX}%`)
      .select('code')
    let maxSeq = 0
    for (const row of rows) {
      const seq = Number.parseInt(String(row.code).slice(REQUIREMENT_CODE_PREFIX.length), 10)
      if (Number.isInteger(seq) && seq > maxSeq) maxSeq = seq
    }
    return `${REQUIREMENT_CODE_PREFIX}${String(maxSeq + 1).padStart(CODE_PAD, '0')}`
  }

  private validateCriteria(criteria: AcceptanceCriterion[]): void {
    if (!Array.isArray(criteria)) throw new ValidationException('验收准则格式不正确，应为数组')
    for (const item of criteria) {
      if (
        !item ||
        typeof item.id !== 'string' ||
        !item.id.trim() ||
        typeof item.statement !== 'string' ||
        !item.statement.trim()
      ) {
        throw new ValidationException('验收准则条目必须包含非空的 id 与 statement')
      }
      if (!CRITERION_STATUSES.includes(item.status)) {
        throw new ValidationException('验收准则状态无效')
      }
    }
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

  private async requirementOrFail(
    organizationId: number,
    projectId: number,
    requirementId: number,
  ): Promise<Requirement> {
    const requirement = await Requirement.query()
      .where('id', requirementId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!requirement) throw new ResourceNotFoundException('需求不存在')
    return requirement
  }

  /** 任务必须属于当前项目：任务无 organization_id 列，跨租户任务因 project 不匹配而不可见（404）。 */
  private async taskInProjectOrFail(projectId: number, taskId: number): Promise<Task> {
    const task = await Task.query().where('id', taskId).where('project_id', projectId).first()
    if (!task) throw new ResourceNotFoundException('任务不存在')
    return task
  }
}
