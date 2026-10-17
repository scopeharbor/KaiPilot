import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import ProjectPolicy from '#policies/project_policy'
import ProjectService from '#services/project_service'
import TenantOwnershipResolverService from '#services/tenant_ownership_resolver_service'
import {
  createProjectValidator,
  updateProjectValidator,
  workingCalendarValidator,
} from '#validators/project'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { deriveProjectHealth } from '#services/project_health_service'
import {
  withTenantBoundaryDetailMeta,
  withTenantBoundaryListMeta,
} from '#services/tenant_boundary_envelope_helper'

@inject()
export default class ProjectsController {
  constructor(
    private projects: ProjectService,
    private policy: ProjectPolicy,
    private ownership: TenantOwnershipResolverService,
  ) {}

  /**
   * 资源归属前置校验（v3-multitenant-tenant-identification §5.3）。
   *
   * `/projects/:id` 只带项目 ID、没有组织路由参数，属 spec 场景
   * 「Project-only route resolves organization」：先服务端反推项目归属并与 effective
   * tenant 比对，再进业务逻辑。这是 ProjectService scoped 查询之外的显式第二道，
   * 也是唯一会写 `ownership.project` 审计的一道（跨租户尝试因此可追溯）。
   */
  private async assertProjectOwnership(ctx: HttpContext, projectId: number) {
    await this.ownership.assertRouteResourceOwnership({
      resourceType: 'project',
      resourceId: projectId,
      effectiveOrganizationId: ctx.tenant?.organizationId ?? null,
      decision: ctx.tenantDecision ?? null,
      userId: ctx.authUser?.id ?? null,
      requestId: ctx.request.id() ?? 'unknown',
    })
  }

  private auditContext({ request }: HttpContext) {
    return {
      requestId: request.id() ?? null,
      ip: request.ip(),
      userAgent: request.header('user-agent') ?? '',
    }
  }

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private assertOrganizationRouteMatchesTenant(ctx: HttpContext) {
    const organizationId = Number(ctx.params.organizationId)
    if (organizationId && organizationId !== ctx.tenant!.organizationId) {
      throw new ResourceNotFoundException('Organization not found')
    }
  }

  async indexForOrganization(ctx: HttpContext) {
    this.assertOrganizationRouteMatchesTenant(ctx)
    return this.index(ctx)
  }

  async storeForOrganization(ctx: HttpContext) {
    this.assertOrganizationRouteMatchesTenant(ctx)
    return this.store(ctx)
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const { data, meta } = await this.projects.list(ctx.tenant!.organizationId, user, {
      status: ctx.request.input('status'),
      priority: ctx.request.input('priority'),
      search: ctx.request.input('search'),
      sort: ctx.request.input('sort'),
      page: ctx.request.input('page', 1),
      perPage: ctx.request.input('perPage', 20),
      includeArchived: parseBool(ctx.request.input('includeArchived')),
    })
    // 健康度读取期派生（列值恒为 unknown，直接返回会让所有项目显示「未评估」）
    const health = await deriveProjectHealth(data)
    return ctx.response.ok(
      withTenantBoundaryListMeta(ctx.tenantApiBoundary, {
        data: data.map((p) => ({
          ...projectDto(p),
          healthStatus: health.get(Number(p.id)) ?? p.healthStatus,
        })),
        meta,
      }),
    )
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createProjectValidator)
    const user = this.currentUser(ctx)
    const project = await this.projects.create(
      {
        name: input.name,
        code: input.code,
        description: input.description,
        category: input.category,
        status: input.status,
        priority: input.priority,
        startDate: input.startDate,
        endDate: input.endDate,
        budgetCents: input.budgetCents,
        currency: input.currency,
        settings: input.settings,
        // v3-database-schema-expansion §4.2 —— V3 组合事实
        projectManagerId: normalizeManagerId(input.projectManagerId),
        departmentKey: input.departmentKey,
        departmentName: input.departmentName,
        businessLine: input.businessLine,
        investmentType: input.investmentType as never,
        strategyTheme: input.strategyTheme,
        programKey: input.programKey,
        forecastCostCents: input.forecastCostCents,
        forecastEndDate: input.forecastEndDate,
        customFields: normalizeCustomFields(input.customFields),
        portfolioFactSource: input.portfolioFactSource as never,
      },
      ctx.tenant!.organizationId,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: projectDto(project) })
  }

  async show(ctx: HttpContext) {
    await this.assertProjectOwnership(ctx, Number(ctx.params.id))
    const { project, stats } = await this.projects.get(
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
    )
    const health = await deriveProjectHealth([project])
    return ctx.response.ok(
      withTenantBoundaryDetailMeta(ctx.tenantApiBoundary, {
        data: {
          ...projectDto(project, stats),
          healthStatus: health.get(Number(project.id)) ?? project.healthStatus,
        },
      }),
    )
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateProjectValidator)
    const user = this.currentUser(ctx)
    await this.assertProjectOwnership(ctx, Number(ctx.params.id))
    const project = await this.projects.update(
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
      {
        name: input.name,
        code: input.code,
        description: input.description,
        category: input.category,
        status: input.status,
        priority: input.priority,
        startDate: input.startDate,
        endDate: input.endDate,
        budgetCents: input.budgetCents,
        currency: input.currency,
        settings: input.settings,
        // v3-database-schema-expansion §4.2 —— V3 组合事实（部分更新）
        projectManagerId: normalizeManagerId(input.projectManagerId),
        departmentKey: input.departmentKey,
        departmentName: input.departmentName,
        businessLine: input.businessLine,
        investmentType: input.investmentType as never,
        strategyTheme: input.strategyTheme,
        programKey: input.programKey,
        forecastCostCents: input.forecastCostCents,
        forecastEndDate: input.forecastEndDate,
        customFields: normalizeCustomFields(input.customFields),
        portfolioFactSource: input.portfolioFactSource as never,
      },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: projectDto(project) })
  }

  async workingCalendar(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.id)
    const calendar = await this.projects.getWorkingCalendar(organizationId, projectId)
    if (!(await this.policy.view(user, organizationId, projectId))) {
      throw new PermissionDeniedException('??銝雲')
    }
    return ctx.response.ok({ data: calendar })
  }

  async updateWorkingCalendar(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(workingCalendarValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.id)
    if (!(await this.policy.update(user, organizationId, projectId))) {
      throw new PermissionDeniedException('??銝雲')
    }
    const calendar = await this.projects.updateWorkingCalendar(
      organizationId,
      projectId,
      input,
      user.id,
      this.auditContext(ctx),
      Object.keys(ctx.request.body()),
    )
    return ctx.response.ok({ data: calendar })
  }

  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    await this.projects.delete(
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
      user.id,
      ctx.request.input('force', false),
      this.auditContext(ctx),
    )
    return ctx.response.noContent()
  }

  async archive(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const project = await this.projects.archive(
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: projectDto(project) })
  }

  async restore(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const project = await this.projects.restore(
      ctx.tenant!.organizationId,
      Number(ctx.params.id),
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: projectDto(project) })
  }
}

function projectDto(
  project: any,
  stats?: { memberCount: number; taskCount: number; milestoneCount: number },
) {
  return {
    id: project.id,
    organizationId: Number(project.organizationId),
    name: project.name,
    code: project.code,
    description: project.description,
    category: project.category,
    status: project.status,
    priority: project.priority,
    startDate: project.startDate?.toISODate?.() ?? project.startDate ?? null,
    endDate: project.endDate?.toISODate?.() ?? project.endDate ?? null,
    actualStartDate: project.actualStartDate?.toISODate?.() ?? project.actualStartDate ?? null,
    actualEndDate: project.actualEndDate?.toISODate?.() ?? project.actualEndDate ?? null,
    budgetCents: project.budgetCents,
    actualCostCents: project.actualCostCents,
    currency: project.currency,
    progressPercent: project.progressPercent,
    healthStatus: project.healthStatus,
    settings: project.settings,
    createdBy: Number(project.createdBy),
    updatedBy: project.updatedBy ? Number(project.updatedBy) : null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deletedAt: project.deletedAt,
    // v3-database-schema-expansion §4.5 —— V3 组合事实（仅授权读后返回，可空）
    projectManagerId: project.projectManagerId ? Number(project.projectManagerId) : null,
    departmentKey: project.departmentKey ?? null,
    departmentName: project.departmentName ?? null,
    businessLine: project.businessLine ?? null,
    investmentType: project.investmentType ?? null,
    strategyTheme: project.strategyTheme ?? null,
    programKey: project.programKey ?? null,
    forecastCostCents: project.forecastCostCents ?? null,
    forecastEndDate: project.forecastEndDate?.toISODate?.() ?? project.forecastEndDate ?? null,
    customFields: project.customFields ?? null,
    portfolioFactSource: project.portfolioFactSource ?? null,
    portfolioFactUpdatedAt: project.portfolioFactUpdatedAt ?? null,
    ...buildStats(project, stats),
  }
}

/**
 * v3-database-schema-expansion —— validator 产出的 projectManagerId 可能是 number / 'null' 字符串 / null。
 * 统一归一为 number | null（service 层据此判定「清空」vs「指派」）。
 */
function normalizeManagerId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (value === 'null') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * v3-database-schema-expansion —— validator 用 vine.any() 接收 customFields，
 * 直接透传原始值给 service 层 validateBoundedProjectCustomFields 二次强制。
 * 不再提前归一化（避免 root array 被静默转 null 绕过校验）。
 */
function normalizeCustomFields(value: unknown): unknown {
  return value === undefined ? null : value
}

/** 详情传完整 stats；列表项从 service 附加的 $extras 聚合读取。 */
function buildStats(
  project: any,
  stats?: { memberCount: number; taskCount: number; milestoneCount: number },
) {
  if (stats) {
    return {
      stats: {
        memberCount: stats.memberCount,
        taskCount: stats.taskCount,
        milestoneCount: stats.milestoneCount,
      },
    }
  }
  if (project.$extras && project.$extras.memberCount !== undefined) {
    return {
      stats: {
        memberCount: Number(project.$extras.memberCount),
        taskCount: Number(project.$extras.taskCount ?? 0),
        milestoneCount: 0,
      },
    }
  }
  return {}
}

/** 把 query 参数归一化为布尔：仅 'true' / true 视为真，其余为假。 */
function parseBool(value: unknown): boolean {
  return value === true || value === 'true'
}
