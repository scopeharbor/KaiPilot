import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import MultiProjectDependencyPolicy from '#policies/multi_project_dependency_policy'
import MultiProjectDependencyService from '#services/multi_project_dependency_service'
import {
  listMultiProjectDependenciesValidator,
  graphMultiProjectDependenciesValidator,
  createMultiProjectDependencyPreviewValidator,
  updateMultiProjectDependencyPreviewValidator,
  archiveMultiProjectDependencyPreviewValidator,
  restoreMultiProjectDependencyPreviewValidator,
  confirmMultiProjectDependencyValidator,
  impactAnalysisValidator,
  drillDownValidator,
  listSuggestionsValidator,
} from '#validators/multi_project_dependency'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class MultiProjectDependenciesController {
  constructor(
    private service: MultiProjectDependencyService,
    private policy: MultiProjectDependencyPolicy,
  ) {}

  private user(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  /**
   * 取组织上下文。
   *
   * 不能用 `ctx.tenant!`：tenant_middleware 在 NO_ACTIVE_ORGANIZATION
   * （未认证，或已认证但尚未选择组织）时**故意放行且不挂 ctx.tenant**，
   * 而本路由组未登记进 ROUTE_PERMISSION_RULES，RbacMiddleware 的
   * 「tenant 为空 → 403」兜底也不会触发。非空断言只骗过编译器，
   * 运行期是 TypeError → 500，把「缺组织上下文」伪装成服务端故障。
   * 与 ai_connections_controller.orgIdOf 保持同一范式。
   */
  private orgId(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  // =========================================================================
  // List
  // =========================================================================

  async index(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeView(user, organizationId)

    const input = await ctx.request.validateUsing(listMultiProjectDependenciesValidator)
    const result = await this.service.list(
      organizationId,
      {
        projectIds: input.projectIds,
        endpointType: input.endpointType,
        category: input.category,
        type: input.type,
        status: input.status,
        riskLevel: input.riskLevel,
        sourceMode: input.sourceMode,
        freshness: input.freshness,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        search: input.search,
      },
      input.sort ?? '-createdAt',
      input.page ?? 1,
      input.perPage ?? 20,
      user.id,
      { requestId: ctx.request.id() ?? null },
    )

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  // =========================================================================
  // Detail
  // =========================================================================

  async show(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeView(user, organizationId)

    // 路由声明的是 `/:dependencyId`（见 start/routes.ts）。原先读 `ctx.params.id`
    // 恒为 undefined → Number(undefined) = NaN → 查不到任何行，
    // 于是详情端点一直无条件 404。
    const dep = await this.service.detail(
      organizationId,
      Number(ctx.params.dependencyId),
      user.id,
      {
        requestId: ctx.request.id() ?? null,
      },
    )

    return ctx.response.ok({ data: dep })
  }

  // =========================================================================
  // Graph
  // =========================================================================

  async graph(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeView(user, organizationId)

    const input = await ctx.request.validateUsing(graphMultiProjectDependenciesValidator)
    const result = await this.service.buildGraph(
      organizationId,
      {
        projectIds: input.projectIds,
        endpointType: input.endpointType,
        category: input.category,
        status: input.status,
        riskLevel: input.riskLevel,
        maxDepth: input.maxDepth,
        nodeLimit: input.nodeLimit,
        edgeLimit: input.edgeLimit,
        freshnessThreshold: input.freshnessThreshold,
      },
      user.id,
      { requestId: ctx.request.id() ?? null },
    )

    return ctx.response.ok({ data: result })
  }

  // =========================================================================
  // Impact Analysis
  // =========================================================================

  async impactAnalysis(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeView(user, organizationId)

    const input = await ctx.request.validateUsing(impactAnalysisValidator)
    const sourceEndpoint = input.sourceEndpoint
      ? {
          endpointType: input.sourceEndpoint.endpointType,
          projectId: input.sourceEndpoint.projectId ?? null,
          projectName: null,
          milestoneId: input.sourceEndpoint.milestoneId ?? null,
          milestoneName: null,
          taskId: input.sourceEndpoint.taskId ?? null,
          taskName: null,
          externalKey: input.sourceEndpoint.externalKey ?? null,
          externalLabel: null,
          redacted: false,
          redactionReason: null,
        }
      : undefined

    const result = await this.service.impactAnalysis(
      organizationId,
      {
        sourceType: input.sourceType as any,
        sourceEndpoint,
        hypotheticalDelayDays: input.hypotheticalDelayDays,
        hypotheticalDescription: input.hypotheticalDescription,
        maxDepth: input.maxDepth,
        edgeLimit: input.edgeLimit,
        includeLocalContext: input.includeLocalContext ?? false,
        projectIds: input.projectIds,
      },
      user.id,
      { requestId: ctx.request.id() ?? null },
    )

    return ctx.response.ok({ data: result })
  }

  // =========================================================================
  // Preview Create
  // =========================================================================

  async previewCreate(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeManage(user, organizationId)

    const input = await ctx.request.validateUsing(createMultiProjectDependencyPreviewValidator)

    // Authorization: consumer manage + provider view
    await this.policy.authorizeConsumerManage(
      user,
      organizationId,
      input.consumerEndpointType as any,
      input.consumerProjectId ?? null,
      input.consumerTaskId ?? null,
    )
    await this.policy.authorizeProviderView(
      user,
      organizationId,
      input.providerEndpointType as any,
      input.providerProjectId ?? null,
    )

    // 校验器把端点字段声明为 optional，Service 侧要求显式 null，这里统一归一
    const preview = await this.service.previewCreate(
      organizationId,
      user.id,
      {
        ...input,
        providerProjectId: input.providerProjectId ?? null,
        providerMilestoneId: input.providerMilestoneId ?? null,
        providerTaskId: input.providerTaskId ?? null,
        providerExternalLabel: input.providerExternalLabel ?? null,
        providerExternalKey: input.providerExternalKey ?? null,
        consumerProjectId: input.consumerProjectId ?? null,
        consumerMilestoneId: input.consumerMilestoneId ?? null,
        consumerTaskId: input.consumerTaskId ?? null,
        consumerExternalLabel: input.consumerExternalLabel ?? null,
        consumerExternalKey: input.consumerExternalKey ?? null,
      },
      { requestId: ctx.request.id() ?? null },
    )

    return ctx.response.ok({ data: preview })
  }

  // =========================================================================
  // Confirm
  // =========================================================================

  async confirm(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeManage(user, organizationId)

    const input = await ctx.request.validateUsing(confirmMultiProjectDependencyValidator)
    const result = await this.service.confirm(
      organizationId,
      user.id,
      input.previewId,
      input.confirmationHash,
      input.idempotencyKey,
      { requestId: ctx.request.id() ?? null },
    )

    return ctx.response.created({ data: result.data })
  }

  // =========================================================================
  // CRUD 生命周期分支（update / archive / restore / delete）
  //
  // 这些分支曾长期是 501 占位——该 change 的 tasks.md 全部打勾但 service 只落地了
  // previewCreate 与 create 分支的 confirm。现已按规范
  // multi-project-dependency-crud 实现：archive 保留行与审计链；restore 重跑
  // 重复与环检测；delete 比 archive 更严格（仅允许已归档），痕迹由审计事件承担。
  // =========================================================================

  /**
   * 按操作分设的确认端点统一走 service.confirm，并传入 expectedOperation——
   * 预览的 operation 决定真实分支，端点只负责声明自己期望哪一种，不匹配即拒绝。
   */
  private async confirmWith(
    ctx: HttpContext,
    expectedOperation: 'create' | 'update' | 'archive' | 'restore' | 'delete',
  ) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeManage(user, organizationId)

    const input = await ctx.request.validateUsing(confirmMultiProjectDependencyValidator)
    const result = await this.service.confirm(
      organizationId,
      user.id,
      input.previewId,
      input.confirmationHash,
      input.idempotencyKey,
      { requestId: ctx.request.id() ?? null },
      expectedOperation,
    )

    return ctx.response.created({ data: result.data })
  }

  async confirmCreate(ctx: HttpContext) {
    return this.confirmWith(ctx, 'create')
  }

  async previewUpdate(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeManage(user, organizationId)

    const input = await ctx.request.validateUsing(updateMultiProjectDependencyPreviewValidator)
    const preview = await this.service.previewUpdate(organizationId, user.id, input, {
      requestId: ctx.request.id() ?? null,
    })

    return ctx.response.ok({ data: preview })
  }

  async confirmUpdate(ctx: HttpContext) {
    return this.confirmWith(ctx, 'update')
  }

  async previewArchive(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeManage(user, organizationId)

    const input = await ctx.request.validateUsing(archiveMultiProjectDependencyPreviewValidator)
    const preview = await this.service.previewArchive(organizationId, user.id, input.dependencyId, {
      requestId: ctx.request.id() ?? null,
    })

    return ctx.response.ok({ data: preview })
  }

  async confirmArchive(ctx: HttpContext) {
    return this.confirmWith(ctx, 'archive')
  }

  async previewRestore(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeManage(user, organizationId)

    const input = await ctx.request.validateUsing(restoreMultiProjectDependencyPreviewValidator)
    const preview = await this.service.previewRestore(organizationId, user.id, input.dependencyId, {
      requestId: ctx.request.id() ?? null,
    })

    return ctx.response.ok({ data: preview })
  }

  async confirmRestore(ctx: HttpContext) {
    return this.confirmWith(ctx, 'restore')
  }

  async previewDelete(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeManage(user, organizationId)

    // delete 与 archive 的入参同形（仅 dependencyId），复用同一校验器
    const input = await ctx.request.validateUsing(archiveMultiProjectDependencyPreviewValidator)
    const preview = await this.service.previewDelete(organizationId, user.id, input.dependencyId, {
      requestId: ctx.request.id() ?? null,
    })

    return ctx.response.ok({ data: preview })
  }

  async confirmDelete(ctx: HttpContext) {
    return this.confirmWith(ctx, 'delete')
  }

  // =========================================================================
  // Suggestions
  // =========================================================================

  async suggestions(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)
    await this.policy.authorizeView(user, organizationId)

    // 校验查询参数（当前建议生成不接受过滤条件，仅做入参合法性把关）
    await ctx.request.validateUsing(listSuggestionsValidator)
    const result = await this.service.generateRuleSuggestions(organizationId, user.id)

    return ctx.response.ok({
      data: result,
      meta: { total: result.length, page: 1, perPage: 100, totalPages: 1 },
    })
  }

  // =========================================================================
  // Drill-down
  // =========================================================================

  async drillDown(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const user = this.user(ctx)

    const input = await ctx.request.validateUsing(drillDownValidator)
    const authorized = await this.policy.authorizeDrillDown(
      user,
      organizationId,
      input.refType,
      input.targetId,
    )

    if (!authorized) {
      return ctx.response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在' } })
    }

    // For now return the simple authorized response
    return ctx.response.ok({
      data: {
        refType: input.refType,
        targetId: input.targetId,
        detail: {},
        authorized: true,
        redacted: false,
      },
    })
  }
}
