import ResourcePolicy from '#policies/resource_policy'
import ResourceLoadService from '#services/resource_load_service'
import ResourceAiAnalysisService from '#services/resource_ai_analysis_service'
import ResourceConflictService from '#services/resource_conflict_service'
import ResourceMatchingService from '#services/resource_matching_service'
import ResourcePlanningService from '#services/resource_planning_service'
import ResourceService from '#services/resource_service'
import ResourceSuggestionService from '#services/resource_suggestion_service'
import ResourceAvailabilityExceptionService from '#services/resource_availability_exception_service'
import TaskResourceRequirementService from '#services/task_resource_requirement_service'
import { resourceDto } from '#types/dto'
import {
  createResourceValidator,
  listResourcesValidator,
  updateResourceValidator,
} from '#validators/resource'
import { loadQueryValidator } from '#validators/resource_load'
import {
  createTaskResourceRequirementValidator,
  createResourceAvailabilityExceptionValidator,
  listResourceAvailabilityExceptionsValidator,
  listTaskResourceRequirementsValidator,
  resourceMatchQueryValidator,
  resourcePlanningQueryValidator,
  updateResourceAvailabilityExceptionValidator,
  updateTaskResourceRequirementValidator,
} from '#validators/resource_management_v2'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

@inject()
export default class ResourcesController {
  constructor(
    private resources: ResourceService,
    private loadService: ResourceLoadService,
    private aiAnalysisService: ResourceAiAnalysisService,
    private planningService: ResourcePlanningService,
    private conflictService: ResourceConflictService,
    private matchingService: ResourceMatchingService,
    private requirementService: TaskResourceRequirementService,
    private availabilityExceptionService: ResourceAvailabilityExceptionService,
    private suggestionService: ResourceSuggestionService,
    private policy: ResourcePolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private auditContext({ request }: HttpContext) {
    return {
      requestId: request.id() ?? null,
      ip: request.ip(),
      userAgent: request.header('user-agent') ?? '',
    }
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)

    const filters = await ctx.request.validateUsing(listResourcesValidator, {
      data: ctx.request.qs(),
    })
    const { data, meta } = await this.resources.list(ctx.tenant!.organizationId, projectId, filters)
    return ctx.response.ok({ data: data.map(resourceDto), meta })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createResourceValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, organizationId, projectId)

    const resource = await this.resources.create(
      organizationId,
      projectId,
      input,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: resourceDto(resource) })
  }

  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const resourceId = Number(ctx.params.id)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)

    const resource = await this.resources.get(ctx.tenant!.organizationId, projectId, resourceId)
    return ctx.response.ok({
      data: {
        ...resourceDto(resource),
        allocations: resource.allocations,
      },
    })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateResourceValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const resourceId = Number(ctx.params.id)
    await this.policy.authorizeManage(user, organizationId, projectId)

    const resource = await this.resources.update(
      organizationId,
      projectId,
      resourceId,
      input,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: resourceDto(resource) })
  }

  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const resourceId = Number(ctx.params.id)
    await this.policy.authorizeManage(user, organizationId, projectId)

    await this.resources.delete(
      organizationId,
      projectId,
      resourceId,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.noContent()
  }

  async getLoad(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)

    const { from, to, view, resourceId } = await ctx.request.validateUsing(loadQueryValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.loadService.load(
      ctx.tenant!.organizationId,
      projectId,
      from,
      to,
      view,
      resourceId,
    )
    return ctx.response.ok({ data: result })
  }

  async getAiAnalysis(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)

    const result = await this.aiAnalysisService.analyze(ctx.tenant!.organizationId, projectId)
    return ctx.response.ok({ data: result })
  }

  async planning(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, organizationId, projectId)
    const filters = await ctx.request.validateUsing(resourcePlanningQueryValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.planningService.getPlanning(organizationId, projectId, filters)
    return ctx.response.ok({ data: result })
  }

  async conflicts(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, organizationId, projectId)
    const filters = await ctx.request.validateUsing(resourcePlanningQueryValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.conflictService.listConflicts(organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  async requirements(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, organizationId, projectId)
    const filters = await ctx.request.validateUsing(listTaskResourceRequirementsValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.requirementService.list(organizationId, projectId, filters)
    return ctx.response.ok({
      data: result.data.map((requirement) => this.requirementDto(requirement)),
      meta: result.meta,
    })
  }

  async storeRequirement(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createTaskResourceRequirementValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, organizationId, projectId)
    const requirement = await this.requirementService.create(
      organizationId,
      projectId,
      input,
      user.id,
    )
    return ctx.response.created({ data: this.requirementDto(requirement) })
  }

  async updateRequirement(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateTaskResourceRequirementValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, organizationId, projectId)
    const requirement = await this.requirementService.update(
      organizationId,
      projectId,
      Number(ctx.params.requirementId),
      input,
      user.id,
    )
    return ctx.response.ok({ data: this.requirementDto(requirement) })
  }

  async destroyRequirement(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, organizationId, projectId)
    await this.requirementService.delete(
      organizationId,
      projectId,
      Number(ctx.params.requirementId),
      user.id,
    )
    return ctx.response.noContent()
  }

  async matchRequirement(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, organizationId, projectId)
    const { limit } = await ctx.request.validateUsing(resourceMatchQueryValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.matchingService.matchRequirement(
      organizationId,
      projectId,
      Number(ctx.params.requirementId),
      limit,
    )
    return ctx.response.ok({ data: result })
  }

  async previewSuggestions(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, organizationId, projectId)
    const result = await this.suggestionService.preview(
      organizationId,
      projectId,
      ctx.request.body(),
      user.id,
    )
    return ctx.response.ok({ data: result })
  }

  async applySuggestions(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, organizationId, projectId)
    const result = await this.suggestionService.apply(
      organizationId,
      projectId,
      ctx.request.body(),
      user.id,
    )
    return ctx.response.ok({ data: result })
  }

  async unsupportedLeveling(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, organizationId, projectId)
    this.suggestionService.unsupportedLeveling()
  }

  async availabilityExceptions(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const resourceId = Number(ctx.params.resourceId)
    await this.policy.authorizeView(user, organizationId, projectId)
    const filters = await ctx.request.validateUsing(listResourceAvailabilityExceptionsValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.availabilityExceptionService.list(
      organizationId,
      projectId,
      resourceId,
      filters,
    )
    return ctx.response.ok({
      data: result.data.map((exception) => this.availabilityExceptionDto(exception)),
      meta: result.meta,
    })
  }

  async storeAvailabilityException(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createResourceAvailabilityExceptionValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const resourceId = Number(ctx.params.resourceId)
    const resource = await this.resources.getForAuthorize(organizationId, projectId, resourceId)
    await this.policy.authorizeSelfAvailability(user, organizationId, projectId, resource.userId)
    const exception = await this.availabilityExceptionService.create(
      organizationId,
      projectId,
      resourceId,
      input,
      user.id,
      Object.keys(ctx.request.body()),
    )
    return ctx.response.created({ data: this.availabilityExceptionDto(exception) })
  }

  async updateAvailabilityException(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateResourceAvailabilityExceptionValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const resourceId = Number(ctx.params.resourceId)
    const resource = await this.resources.getForAuthorize(organizationId, projectId, resourceId)
    await this.policy.authorizeSelfAvailability(user, organizationId, projectId, resource.userId)
    const exception = await this.availabilityExceptionService.update(
      organizationId,
      projectId,
      resourceId,
      Number(ctx.params.exceptionId),
      input,
      user.id,
      Object.keys(ctx.request.body()),
    )
    return ctx.response.ok({ data: this.availabilityExceptionDto(exception) })
  }

  async destroyAvailabilityException(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const resourceId = Number(ctx.params.resourceId)
    const resource = await this.resources.getForAuthorize(organizationId, projectId, resourceId)
    await this.policy.authorizeSelfAvailability(user, organizationId, projectId, resource.userId)
    await this.availabilityExceptionService.delete(
      organizationId,
      projectId,
      resourceId,
      Number(ctx.params.exceptionId),
      user.id,
    )
    return ctx.response.noContent()
  }

  private requirementDto(requirement: {
    id: number
    organizationId: number
    projectId: number
    taskId: number
    role: string
    skillTags: string | null
    allocationPercent: number | null
    estimatedPersonDays: number | null
    startDate: { toISODate(): string | null }
    endDate: { toISODate(): string | null }
    priority: string
    status: string
    sourceKind: string
    sourceRef: string | null
    createdBy: number | null
    createdAt: { toISO(): string | null }
    updatedAt: { toISO(): string | null } | null
  }) {
    return {
      id: requirement.id,
      organizationId: Number(requirement.organizationId),
      projectId: Number(requirement.projectId),
      taskId: Number(requirement.taskId),
      role: requirement.role,
      skillTags: requirement.skillTags ? JSON.parse(requirement.skillTags) : [],
      allocationPercent:
        requirement.allocationPercent === null ? null : Number(requirement.allocationPercent),
      estimatedPersonDays:
        requirement.estimatedPersonDays === null ? null : Number(requirement.estimatedPersonDays),
      startDate: requirement.startDate.toISODate(),
      endDate: requirement.endDate.toISODate(),
      priority: requirement.priority,
      status: requirement.status,
      sourceKind: requirement.sourceKind,
      sourceRef: requirement.sourceRef,
      createdBy: requirement.createdBy === null ? null : Number(requirement.createdBy),
      createdAt: requirement.createdAt.toISO(),
      updatedAt: requirement.updatedAt?.toISO() ?? null,
    }
  }

  private availabilityExceptionDto(exception: {
    id: number
    organizationId: number
    projectId: number
    resourceId: number
    startDate: { toISODate(): string | null }
    endDate: { toISODate(): string | null }
    capacityOverrideHours: number
    reason: string
    status: string
    auditLogId: number | null
    createdBy: number | null
    createdAt: { toISO(): string | null }
    updatedAt: { toISO(): string | null } | null
  }) {
    return {
      id: exception.id,
      organizationId: Number(exception.organizationId),
      projectId: Number(exception.projectId),
      resourceId: Number(exception.resourceId),
      startDate: exception.startDate.toISODate(),
      endDate: exception.endDate.toISODate(),
      capacityOverrideHours: Number(exception.capacityOverrideHours),
      reason: exception.reason,
      status: exception.status,
      auditLogId: exception.auditLogId === null ? null : Number(exception.auditLogId),
      createdBy: exception.createdBy === null ? null : Number(exception.createdBy),
      createdAt: exception.createdAt.toISO(),
      updatedAt: exception.updatedAt?.toISO() ?? null,
    }
  }
}
