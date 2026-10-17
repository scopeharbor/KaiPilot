import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import TenantScope from '#services/tenant_scope'
import { PROJECT_ROLE_TEMPLATES } from '#services/project_role_templates'
import RbacService from '#services/rbac_service'
import NotificationService from '#services/notification_service'
import ResourceInvalidationService from '#services/resource_invalidation_service'
import type { AuthContext } from '#types/auth'
import {
  PROJECT_INVESTMENT_TYPE_VALUES,
  PROJECT_PORTFOLIO_FACT_SOURCE_VALUES,
  makeLowSensitiveProjectFactAuditSummary,
  validateBoundedProjectCustomFields,
  type ProjectInvestmentType,
  type ProjectPortfolioFactSource,
} from '@aiproj/types'
import {
  WORKING_CALENDAR_SETTINGS_VERSION,
  findDuplicateDate,
  normalizeWorkingCalendarSettings,
  type WorkingCalendarSettingsInput,
  type WorkingCalendarSettings,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export interface CreateProjectInput {
  name: string
  code?: string
  description?: string | null
  category?: string | null
  status?: string
  priority?: string
  startDate?: string | null
  endDate?: string | null
  budgetCents?: number
  currency?: string
  settings?: Record<string, unknown> | null
  // v3-database-schema-expansion §4.2 —— V3 组合事实
  projectManagerId?: number | null
  departmentKey?: string | null
  departmentName?: string | null
  businessLine?: string | null
  investmentType?: ProjectInvestmentType | null
  strategyTheme?: string | null
  programKey?: string | null
  forecastCostCents?: number | null
  forecastEndDate?: string | null
  // 有界校验由服务内 assertBoundedCustomFields（validateBoundedProjectCustomFields）强制；
  // 输入声明为 unknown，避免控制器侧提前归一化把 root array 静默转 null 绕过校验。
  customFields?: unknown
  portfolioFactSource?: ProjectPortfolioFactSource | null
}

export interface UpdateProjectInput {
  name?: string
  code?: string
  description?: string | null
  category?: string | null
  status?: string
  priority?: string
  startDate?: string | null
  endDate?: string | null
  budgetCents?: number
  currency?: string
  settings?: Record<string, unknown> | null
  // v3-database-schema-expansion §4.2 —— V3 组合事实（全部选填）
  projectManagerId?: number | null
  departmentKey?: string | null
  departmentName?: string | null
  businessLine?: string | null
  investmentType?: ProjectInvestmentType | null
  strategyTheme?: string | null
  programKey?: string | null
  forecastCostCents?: number | null
  forecastEndDate?: string | null
  // 同 CreateProjectInput.customFields：输入 unknown，服务内有界校验强制。
  customFields?: unknown
  portfolioFactSource?: ProjectPortfolioFactSource | null
}

export interface ProjectListFilters {
  status?: string
  priority?: string
  search?: string
  sort?: string
  page?: number
  perPage?: number
  includeArchived?: boolean
}

export interface ProjectStats {
  memberCount: number
  taskCount: number
  milestoneCount: number
}

export type WorkingCalendarUpdateInput = WorkingCalendarSettingsInput

const VALID_STATUSES = [
  'draft',
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
  'archived',
]

const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['planning', 'active', 'archived', 'cancelled'],
  planning: ['active', 'on_hold', 'archived', 'cancelled'],
  active: ['on_hold', 'completed', 'archived', 'cancelled'],
  on_hold: ['active', 'archived', 'cancelled'],
  completed: ['active', 'archived'],
  cancelled: ['active', 'archived'],
  archived: ['active'],
}

@inject()
export default class ProjectService {
  private resourceInvalidation = new ResourceInvalidationService()

  constructor(
    private audit: AuditService,
    private rbac: RbacService,
    private notifications: NotificationService,
  ) {}

  /**
   * 在当前组织内创建项目，事务内克隆 5 个系统角色并把创建者登记为 Project Owner。
   */
  async create(
    input: CreateProjectInput,
    organizationId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Project> {
    if (input.code) {
      await this.assertCodeUniqueInOrg(input.code, organizationId)
    }

    // v3-database-schema-expansion §4.3 —— create 默认 manager 为创建者；
    // 若显式提供 projectManagerId 必须等于创建者（事务完成前无其他项目成员存在）。
    if (input.projectManagerId !== undefined && input.projectManagerId !== null) {
      const provided = this.normalizeManagerIdInput(input.projectManagerId)
      if (provided !== null && provided !== Number(actorUserId)) {
        throw new ValidationException('项目创建时经理必须为创建者', {
          status: 422,
          code: 'VALIDATION_ERROR',
          details: { field: 'projectManagerId' },
        })
      }
    }

    // §4.1 二次校验：investment_type / portfolio_fact_source / custom_fields（vine 只做枚举与形状）
    this.assertV3Classification(input)
    this.assertBoundedCustomFields(input.customFields)

    const project = await db.transaction(async (trx) => {
      const created = await Project.create(
        {
          organizationId,
          name: input.name,
          code: input.code ?? null,
          description: input.description ?? null,
          category: input.category ?? null,
          status: this.coerceStatus(input.status) ?? 'draft',
          priority: this.coercePriority(input.priority) ?? 'medium',
          startDate: input.startDate ? DateTime.fromISO(input.startDate) : null,
          endDate: input.endDate ? DateTime.fromISO(input.endDate) : null,
          budgetCents: input.budgetCents ?? null,
          currency: input.currency ?? 'CNY',
          settings: input.settings ?? null,
          createdBy: actorUserId,
          // V3 组合事实（§4.2 持久化）
          projectManagerId: Number(actorUserId),
          departmentKey: input.departmentKey ?? null,
          departmentName: input.departmentName ?? null,
          businessLine: input.businessLine ?? null,
          investmentType: input.investmentType ?? null,
          strategyTheme: input.strategyTheme ?? null,
          programKey: input.programKey ?? null,
          forecastCostCents: input.forecastCostCents ?? null,
          forecastEndDate: input.forecastEndDate ? DateTime.fromISO(input.forecastEndDate) : null,
          // assertBoundedCustomFields 已在入口校验通过（root array/可执行键等已拒绝），
          // 此处按校验后语义收窄为对象或 null。
          customFields: this.boundedCustomFieldsOrNull(input.customFields),
          portfolioFactSource: input.portfolioFactSource ?? null,
          portfolioFactUpdatedAt: input.portfolioFactSource ? DateTime.now() : null,
        },
        { client: trx },
      )

      const roleRecords: ProjectRole[] = []
      for (const template of PROJECT_ROLE_TEMPLATES) {
        const role = await ProjectRole.create(
          {
            projectId: created.id,
            name: template.name,
            description: template.description,
            permissions: [...template.permissions],
            isSystem: true,
          },
          { client: trx },
        )
        roleRecords.push(role)
      }

      const ownerRole = roleRecords.find((r) => r.name === 'Project Owner')
      await ProjectMember.create(
        {
          projectId: created.id,
          userId: actorUserId,
          projectRoleId: ownerRole!.id,
          isActive: true,
        },
        { client: trx },
      )

      return created
    })

    await this.audit.log({
      event: AuditEvent.PROJECT_CREATED,
      userId: actorUserId,
      organizationId,
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      requestId: ctx.requestId ?? null,
    })

    return project
  }

  /**
   * 列表：组织隔离 + 可见性 + 聚合 + 筛选分页。
   */
  async list(
    organizationId: number,
    user: User,
    filters: ProjectListFilters = {},
  ): Promise<{
    data: Project[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20))

    const isOrgAdmin = await this.rbac.isOrgAdmin(user, organizationId)

    let query = TenantScope.forOrganization(Project.query(), organizationId)

    if (!isOrgAdmin && !user.isSuperAdmin) {
      query = query.where((builder) => {
        builder
          .whereHas('members', (membersQuery) => {
            membersQuery.where('user_id', user.id).where('is_active', true)
          })
          .orWhere('created_by', user.id)
      })
    }

    if (!filters.includeArchived && filters.status !== 'archived') {
      query = query.where('status', '!=', 'archived')
    }

    if (filters.status) {
      query = query.where('status', filters.status)
    }

    if (filters.priority) {
      query = query.where('priority', filters.priority)
    }

    if (filters.search) {
      const keyword = `%${filters.search.replace(/[%_]/g, '\\$&')}%`
      query = query.where((builder) => {
        builder.whereILike('name', keyword).orWhereILike('code', keyword)
      })
    }

    const sortField = this.parseSortField(filters.sort ?? '-createdAt')
    query = query.orderBy(sortField.column, sortField.direction)

    const paginator = await query.paginate(page, perPage)
    const meta = paginator.getMeta()
    const rows = paginator.all()
    await this.attachListAggregates(rows)

    return {
      data: rows,
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  /**
   * 获取单项目详情（含 stats 聚合）。
   * 调用方应已通过 RBAC 校验项目 scope 成员权限；本层仅做 org 隔离与 404。
   */
  async get(
    organizationId: number,
    projectId: number,
  ): Promise<{ project: Project; stats: ProjectStats }> {
    const project = await TenantScope.forOrganization(Project.query(), organizationId)
      .where('id', projectId)
      .preload('members')
      .preload('roles')
      .first()

    if (!project) {
      throw new ResourceNotFoundException('项目不存在')
    }

    const stats = await this.computeStats(projectId)
    return { project, stats }
  }

  /**
   * 编辑项目。
   */
  async update(
    organizationId: number,
    projectId: number,
    input: UpdateProjectInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Project> {
    const { project } = await this.get(organizationId, projectId)
    this.assertNotArchived(project)

    if (input.code !== undefined && input.code !== project.code) {
      await this.assertCodeUniqueInOrg(input.code, organizationId, projectId)
      project.code = input.code
    }

    if (input.name !== undefined) project.name = input.name
    if (input.description !== undefined) project.description = input.description
    if (input.category !== undefined) project.category = input.category

    if (input.status !== undefined) {
      const next = this.coerceStatus(input.status)
      if (!next) throw new ValidationException('无效的项目状态')
      this.assertValidStatusTransition(project.status, next)
      project.status = next
    }

    if (input.priority !== undefined) {
      project.priority = this.coercePriority(input.priority) ?? project.priority
    }

    if (input.startDate !== undefined) {
      project.startDate = input.startDate ? DateTime.fromISO(input.startDate) : null
    }
    if (input.endDate !== undefined) {
      project.endDate = input.endDate ? DateTime.fromISO(input.endDate) : null
    }
    if (input.budgetCents !== undefined) project.budgetCents = input.budgetCents
    if (input.currency !== undefined) project.currency = input.currency
    if (input.settings !== undefined) project.settings = input.settings

    // v3-database-schema-expansion §4.2/§4.4 —— V3 组合事实持久化 + manager 成员校验
    const v3Changed: string[] = []
    if (input.projectManagerId !== undefined) {
      const nextManager = this.normalizeManagerIdInput(input.projectManagerId)
      if (nextManager === null) {
        project.projectManagerId = null
        v3Changed.push('projectManagerId')
      } else {
        // §4.4：更新时校验 manager 属当前组织且为该项目活跃成员（非泄露）
        await this.assertManagerAssignable(organizationId, projectId, nextManager)
        project.projectManagerId = nextManager
        v3Changed.push('projectManagerId')
      }
    }
    if (input.departmentKey !== undefined) {
      project.departmentKey = input.departmentKey
      v3Changed.push('departmentKey')
    }
    if (input.departmentName !== undefined) {
      project.departmentName = input.departmentName
      v3Changed.push('departmentName')
    }
    if (input.businessLine !== undefined) {
      project.businessLine = input.businessLine
      v3Changed.push('businessLine')
    }
    if (input.investmentType !== undefined) {
      this.assertInvestmentType(input.investmentType)
      project.investmentType = (input.investmentType as ProjectInvestmentType | null) ?? null
      v3Changed.push('investmentType')
    }
    if (input.strategyTheme !== undefined) {
      project.strategyTheme = input.strategyTheme
      v3Changed.push('strategyTheme')
    }
    if (input.programKey !== undefined) {
      project.programKey = input.programKey
      v3Changed.push('programKey')
    }
    if (input.forecastCostCents !== undefined) {
      // §4.5：未知值保持 null，不转 0（null vs zero 语义由契约层保证）
      project.forecastCostCents = input.forecastCostCents
      v3Changed.push('forecastCostCents')
    }
    if (input.forecastEndDate !== undefined) {
      project.forecastEndDate = input.forecastEndDate
        ? DateTime.fromISO(input.forecastEndDate)
        : null
      v3Changed.push('forecastEndDate')
    }
    if (input.customFields !== undefined) {
      this.assertBoundedCustomFields(input.customFields)
      project.customFields = this.boundedCustomFieldsOrNull(input.customFields)
      // custom_fields 不进入低敏审计 changed 列表（design Decision 5 / spec「omit full custom fields」）
    }
    if (input.portfolioFactSource !== undefined) {
      this.assertPortfolioFactSource(input.portfolioFactSource)
      project.portfolioFactSource =
        (input.portfolioFactSource as ProjectPortfolioFactSource | null) ?? null
      project.portfolioFactUpdatedAt = DateTime.now()
      v3Changed.push('portfolioFactSource')
    }

    project.updatedBy = actorUserId
    await project.save()

    // §4.7 低敏审计：changed 字段名 + source/freshness 摘要，不含 custom_fields 全量值
    const factSummary = makeLowSensitiveProjectFactAuditSummary({
      investmentType: project.investmentType as ProjectInvestmentType | null,
      portfolioFactSource: project.portfolioFactSource as ProjectPortfolioFactSource | null,
      portfolioFactUpdatedAt: project.portfolioFactUpdatedAt?.toISO() ?? null,
      changedKeys: v3Changed,
    })

    await this.audit.log({
      event: AuditEvent.PROJECT_UPDATED,
      userId: actorUserId,
      organizationId,
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      requestId: ctx.requestId ?? null,
      metadata: {
        changed: [
          ...Object.keys(input).filter((k) => k !== 'customFields'),
          ...v3Changed.filter((k) => k !== 'customFields'),
        ].filter((v, i, arr) => arr.indexOf(v) === i),
        v3Facts: {
          changed: factSummary.changed,
          investmentType: factSummary.investmentType ?? null,
          portfolioFactSource: factSummary.portfolioFactSource ?? null,
          portfolioFactUpdatedAt: factSummary.portfolioFactUpdatedAt ?? null,
        },
      },
    })

    return project
  }

  async getWorkingCalendar(
    organizationId: number,
    projectId: number,
  ): Promise<WorkingCalendarSettings> {
    const { project } = await this.get(organizationId, projectId)
    return this.extractWorkingCalendar(project.settings)
  }

  async updateWorkingCalendar(
    organizationId: number,
    projectId: number,
    input: WorkingCalendarUpdateInput,
    actorUserId: number,
    ctx: AuthContext = {},
    rawKeys: string[] = Object.keys(input),
  ): Promise<WorkingCalendarSettings> {
    const { project } = await this.get(organizationId, projectId)
    this.assertNotArchived(project)
    this.assertWorkingCalendarInput(input, rawKeys)

    const before = this.extractWorkingCalendar(project.settings)
    const next = normalizeWorkingCalendarSettings(input)
    const settings = {
      ...(project.settings ?? {}),
      workingCalendar: next,
    }

    project.settings = settings
    project.updatedBy = actorUserId
    await project.save()

    await this.audit.log({
      event: AuditEvent.PROJECT_WORKING_CALENDAR_UPDATED,
      userId: actorUserId,
      organizationId,
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      requestId: ctx.requestId ?? null,
      changes: {
        before: this.calendarAuditSummary(before),
        after: this.calendarAuditSummary(next),
      },
      metadata: {
        workdays: next.workdays,
        holidayCount: next.holidays.length,
        extraWorkdayCount: next.extraWorkdays.length,
      },
    })

    this.resourceInvalidation.broadcast({
      organizationId,
      projectId,
      actorUserId,
      reason: 'working_calendar_changed',
      entityType: 'project',
      entityId: project.id,
      affectedQueries: [
        'resource-load',
        'resource-planning',
        'resource-conflicts',
        'resource-matches',
        'task-resource-requirements',
        'project-dashboard',
      ],
    })

    return next
  }

  /**
   * 默认软删除；force=true 时硬删除级联。
   */
  async delete(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    force = false,
    ctx: AuthContext = {},
  ): Promise<void> {
    const { project } = await this.get(organizationId, projectId)

    if (force) {
      await project.delete()
    } else {
      await db
        .from('projects')
        .where('id', project.id)
        .where('organization_id', organizationId)
        .whereNull('deleted_at')
        .update({ deleted_at: DateTime.now().toSQL() })
    }

    await this.audit.log({
      event: AuditEvent.PROJECT_DELETED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'project',
      entityId: projectId,
      requestId: ctx.requestId ?? null,
      metadata: { force },
    })
  }

  /**
   * 归档项目。
   */
  async archive(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Project> {
    const { project } = await this.get(organizationId, projectId)
    if (project.status === 'archived') return project

    project.status = 'archived'
    project.updatedBy = actorUserId
    await project.save()

    await this.audit.log({
      event: AuditEvent.PROJECT_ARCHIVED,
      userId: actorUserId,
      organizationId,
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      requestId: ctx.requestId ?? null,
    })

    // P1 通知项目成员：项目已归档
    await this.notifications.createForProjectMembers(
      {
        organizationId,
        type: 'project_archived',
        title: `项目已归档：「${project.name}」`,
        body: `项目「${project.name}」已被归档，如需恢复请联系项目经理。`,
        severity: 'info',
        projectId: project.id,
        targetType: 'project',
        targetId: project.id,
        actionUrl: `/projects/${project.id}`,
        metadata: { projectName: project.name },
      },
      project.id,
      [actorUserId],
    )

    return project
  }

  /**
   * 恢复归档项目。
   */
  async restore(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Project> {
    const { project } = await this.get(organizationId, projectId)
    if (project.status !== 'archived') return project

    project.status = 'active'
    project.updatedBy = actorUserId
    await project.save()

    await this.audit.log({
      event: AuditEvent.PROJECT_RESTORED,
      userId: actorUserId,
      organizationId,
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      requestId: ctx.requestId ?? null,
    })

    // P1 通知项目成员：项目已恢复
    await this.notifications.createForProjectMembers(
      {
        organizationId,
        type: 'project_restored',
        title: `项目已恢复：「${project.name}」`,
        body: `项目「${project.name}」已恢复为活跃状态，可继续编辑。`,
        severity: 'info',
        projectId: project.id,
        targetType: 'project',
        targetId: project.id,
        actionUrl: `/projects/${project.id}`,
        metadata: { projectName: project.name },
      },
      project.id,
      [actorUserId],
    )

    return project
  }

  /**
   * 校验组织内 code 唯一（可选排除自身，用于更新）。
   */
  private async assertCodeUniqueInOrg(
    code: string,
    organizationId: number,
    excludeProjectId?: number,
  ): Promise<void> {
    const query = TenantScope.forOrganization(Project.query(), organizationId)
      .where('code', code)
      .whereNull('deleted_at')
    if (excludeProjectId) {
      query.where('id', '!=', excludeProjectId)
    }
    const exists = await query.first()
    if (exists) {
      throw new ValidationException('项目编码已被使用', {
        status: 422,
        code: '2001',
        details: { code },
      } as never)
    }
  }

  private assertNotArchived(project: Project): void {
    if (project.status === 'archived') {
      throw new ValidationException('项目已归档，需先恢复才能编辑')
    }
  }

  // ── v3-database-schema-expansion §4.1/§4.4 —— V3 事实校验 helpers ──

  /**
   * 归一 validator 产出的 projectManagerId（number | 'null' 字符串 | null | undefined）为 number | null。
   * create validator 用 vine.number().positive()，产出 number | undefined；
   * update validator 用 vine.any()，可能产出 number | string | null。
   */
  private normalizeManagerIdInput(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'string') {
      if (value === 'null') return null
      const n = Number(value)
      return Number.isFinite(n) && n > 0 ? n : null
    }
    return Number.isFinite(value) && value > 0 ? value : null
  }

  /**
   * §4.4：更新时校验 project_manager_id 属当前组织且为该项目活跃成员。
   * 非泄露：跨组织/非成员/隐藏用户统一返回非泄露的校验错误（不区分「不存在」与「无权」）。
   */
  private async assertManagerAssignable(
    organizationId: number,
    projectId: number,
    managerUserId: number,
  ): Promise<void> {
    // 1) 该用户是否为当前组织的活跃项目成员
    const membership = await ProjectMember.query()
      .where('project_id', projectId)
      .where('user_id', managerUserId)
      .where('is_active', true)
      .preload('project', (q) => q.where('organization_id', organizationId))
      .first()

    if (!membership || !membership.project) {
      // 非泄露：不区分「用户不存在」「跨组织」「非成员」
      throw new ValidationException('指派的项目经理须为当前组织的项目活跃成员', {
        status: 422,
        code: 'VALIDATION_ERROR',
        details: { field: 'projectManagerId' },
      })
    }
  }

  /** §4.1：investment_type / portfolio_fact_source 二次枚举校验（vine 已绑白名单，这里兜底 service 直调）。 */
  private assertV3Classification(input: {
    investmentType?: ProjectInvestmentType | null
    portfolioFactSource?: ProjectPortfolioFactSource | null
  }): void {
    this.assertInvestmentType(input.investmentType)
    this.assertPortfolioFactSource(input.portfolioFactSource)
  }

  private assertInvestmentType(value?: ProjectInvestmentType | null): void {
    if (value === null || value === undefined) return
    if (!PROJECT_INVESTMENT_TYPE_VALUES.includes(value)) {
      throw new ValidationException('不支持的投资类型', {
        status: 422,
        code: 'VALIDATION_ERROR',
        details: { field: 'investmentType', allowed: PROJECT_INVESTMENT_TYPE_VALUES },
      })
    }
  }

  private assertPortfolioFactSource(value?: ProjectPortfolioFactSource | null): void {
    if (value === null || value === undefined) return
    if (!PROJECT_PORTFOLIO_FACT_SOURCE_VALUES.includes(value)) {
      throw new ValidationException('不支持的事实来源', {
        status: 422,
        code: 'VALIDATION_ERROR',
        details: { field: 'portfolioFactSource', allowed: PROJECT_PORTFOLIO_FACT_SOURCE_VALUES },
      })
    }
  }

  /**
   * §4.1/§5：custom_fields 有界校验（契约层 validateBoundedProjectCustomFields）。
   * 拒 root array / 超限 / 可执行键 / raw SQL / HTML/script / prompt-model dump / secret-like。
   * 校验失败 → VALIDATION_ERROR，且不进入事务（spec「no partial project fact update is committed」）。
   */
  private assertBoundedCustomFields(value: unknown): void {
    if (value === undefined) return
    const check = validateBoundedProjectCustomFields(value)
    if (!check.ok) {
      throw new ValidationException('项目自定义字段不合规', {
        status: 422,
        code: 'VALIDATION_ERROR',
        details: { field: 'customFields', violations: check.violations },
      })
    }
  }

  /**
   * 取校验通过的 customFields 的存储形状（对象或 null）。
   * 调用前提：assertBoundedCustomFields 已拒绝 root array/超限/可执行键等非法值。
   */
  private boundedCustomFieldsOrNull(value: unknown): Record<string, unknown> | null {
    if (value === undefined || value === null) return null
    return value as Record<string, unknown>
  }

  private extractWorkingCalendar(
    settings: Record<string, unknown> | null,
  ): WorkingCalendarSettings {
    const calendar = settings?.workingCalendar
    if (calendar && typeof calendar === 'object' && !Array.isArray(calendar)) {
      return normalizeWorkingCalendarSettings(calendar as Partial<WorkingCalendarSettings>)
    }

    if (
      settings &&
      ('workdays' in settings || 'holidays' in settings || 'extraWorkdays' in settings)
    ) {
      return normalizeWorkingCalendarSettings(settings as Partial<WorkingCalendarSettings>)
    }

    return normalizeWorkingCalendarSettings()
  }

  private assertWorkingCalendarInput(input: WorkingCalendarUpdateInput, rawKeys: string[]): void {
    const allowed = new Set(['version', 'workdays', 'holidays', 'extraWorkdays'])
    const unknown = rawKeys.filter((key) => !allowed.has(key))
    if (unknown.length) {
      throw new ValidationException('V1 工作日历不支持提交范围外字段', {
        details: { fields: unknown },
      })
    }

    if (input.version !== undefined && input.version !== WORKING_CALENDAR_SETTINGS_VERSION) {
      throw new ValidationException('工作日历版本不受支持')
    }

    const duplicateHoliday = findDuplicateDate(input.holidays)
    const duplicateExtraWorkday = findDuplicateDate(input.extraWorkdays)
    if (duplicateHoliday || duplicateExtraWorkday) {
      throw new ValidationException('例外日期不能重复', {
        details: { date: duplicateHoliday ?? duplicateExtraWorkday },
      })
    }

    try {
      const normalized = normalizeWorkingCalendarSettings(input)
      const conflict = normalized.holidays.find((date) => normalized.extraWorkdays.includes(date))
      if (conflict) {
        throw new ValidationException('同一日期不能同时作为节假日和调休日', {
          details: { date: conflict },
        })
      }
    } catch (error) {
      if (error instanceof ValidationException) throw error
      throw new ValidationException((error as Error).message)
    }
  }

  private calendarAuditSummary(calendar: WorkingCalendarSettings): Record<string, unknown> {
    return {
      version: calendar.version,
      workdays: calendar.workdays,
      holidays: calendar.holidays,
      extraWorkdays: calendar.extraWorkdays,
      holidayCount: calendar.holidays.length,
      extraWorkdayCount: calendar.extraWorkdays.length,
    }
  }

  private assertValidStatusTransition(current: string, next: string): void {
    if (current === next) return
    const allowed = VALID_TRANSITIONS[current] ?? []
    if (!allowed.includes(next)) {
      throw new ValidationException(`不能从 ${current} 切换到 ${next}`)
    }
  }

  private coerceStatus(value?: string): string | null {
    if (!value) return null
    const normalized = value.toLowerCase()
    return VALID_STATUSES.includes(normalized) ? normalized : null
  }

  private coercePriority(value?: string): string | null {
    if (!value) return null
    const normalized = value.toLowerCase()
    return ['low', 'medium', 'high', 'critical'].includes(normalized) ? normalized : null
  }

  private parseSortField(sort: unknown): { column: string; direction: 'asc' | 'desc' } {
    // 健壮化：`sort` 运行时可能是 string / 数组（?sort=a&sort=b）/ 非法值。
    // 取首个字段（兼容文档的 `-createdAt,+name` 逗号多字段写法），非法则回落默认 -createdAt。
    const raw = Array.isArray(sort) ? sort[0] : sort
    const first = (typeof raw === 'string' ? raw : '').split(',')[0]?.trim() ?? ''
    if (!first) return { column: 'created_at', direction: 'desc' }
    const direction: 'asc' | 'desc' = first.startsWith('-') ? 'desc' : 'asc'
    const field = first.replace(/^[+-]/, '')
    const columnMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      name: 'name',
      status: 'status',
      priority: 'priority',
      startDate: 'start_date',
      endDate: 'end_date',
    }
    return { column: columnMap[field] ?? 'created_at', direction }
  }

  /**
   * 批量附加列表项的 member/task 聚合到 $extras（避免 N+1，design D6）。
   */
  private async attachListAggregates(projects: Project[]): Promise<void> {
    if (projects.length === 0) return
    const ids = projects.map((project) => project.id)
    const memberRows = await db
      .from('project_members')
      .whereIn('project_id', ids)
      .where('is_active', 1)
      .select('project_id')
      .count('* as total')
      .groupBy('project_id')
    const taskRows = await db
      .from('tasks')
      .whereIn('project_id', ids)
      .whereNull('deleted_at')
      .select('project_id')
      .count('* as total')
      .groupBy('project_id')
    const memberMap = new Map<number, number>()
    for (const row of memberRows) memberMap.set(Number(row.project_id), Number(row.total))
    const taskMap = new Map<number, number>()
    for (const row of taskRows) taskMap.set(Number(row.project_id), Number(row.total))
    for (const project of projects) {
      project.$extras = {
        ...project.$extras,
        memberCount: memberMap.get(project.id) ?? 0,
        taskCount: taskMap.get(project.id) ?? 0,
      }
    }
  }

  private async computeStats(projectId: number): Promise<ProjectStats> {
    const memberResult = await ProjectMember.query()
      .where('project_id', projectId)
      .where('is_active', true)
      .count('*', 'total')
    const taskResult = await db
      .from('tasks')
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .count('* as total')
    const milestoneResult = await db
      .from('milestones')
      .where('project_id', projectId)
      .count('* as total')

    return {
      memberCount: Number(memberResult[0]?.$extras?.total ?? 0),
      taskCount: Number(taskResult[0]?.total ?? 0),
      milestoneCount: Number(milestoneResult[0]?.total ?? 0),
    }
  }
}
