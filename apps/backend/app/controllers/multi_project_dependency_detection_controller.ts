import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import MultiProjectDependencyDetectionService from '#services/multi_project_dependency_detection_service'
import MultiProjectDependencyDetectionPolicy from '#policies/multi_project_dependency_detection_policy'
import {
  detectionPlanValidator,
  detectionRunValidator,
  detectionIgnoreValidator,
  detectionReopenValidator,
  detectionDraftBridgeValidator,
} from '#validators/multi_project_dependency_detection_validator'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import AuditService, { AuditEvent } from '#services/audit_service'
import TenantScopeService from '#services/tenant_scope_service'

@inject()
export default class MultiProjectDependencyDetectionController {
  constructor(
    protected detectionService: MultiProjectDependencyDetectionService,
    protected policy: MultiProjectDependencyDetectionPolicy,
    protected auditService: AuditService,
    protected tenantScope: TenantScopeService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  async plan(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const payload = await detectionPlanValidator.validate(ctx.request.body())

    // v3-multitenant-isolation-architecture §4.2：组织 scope 由服务端租户上下文解析，
    // body 的 organizationId 仅作一致性校验输入。
    const organizationId = this.tenantScope.requireOrganizationId(ctx, payload.organizationId)

    if (!(await this.policy.plan(organizationId, { userId: user.id }))) {
      await this.auditService.log({
        event: AuditEvent.DEPENDENCY_DETECTION_PERMISSION_DENIED,
        userId: user.id,
        organizationId,
      })
      throw new PermissionDeniedException('无权进行依赖检测计划')
    }

    const plan = await this.detectionService.planDetection(payload.scope, { userId: user.id })
    return ctx.response.json({ data: plan })
  }

  async run(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const payload = await detectionRunValidator.validate(ctx.request.body())

    // §4.2：同 plan，组织 scope 只来自服务端解析。
    const organizationId = this.tenantScope.requireOrganizationId(ctx, payload.organizationId)

    if (!(await this.policy.run(organizationId, { userId: user.id }))) {
      await this.auditService.log({
        event: AuditEvent.DEPENDENCY_DETECTION_PERMISSION_DENIED,
        userId: user.id,
        organizationId,
      })
      throw new PermissionDeniedException('无权执行依赖检测')
    }

    const result = await this.detectionService.runDetection(organizationId, payload.planToken, {
      userId: user.id,
    })
    return ctx.response.json({ data: result.run, results: result.results })
  }

  async listRuns(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = Number(ctx.request.param('organizationId'))
    const query = (ctx.request.qs() ?? {}) as Record<string, unknown>

    if (!(await this.policy.listRuns(organizationId, { userId: user.id }))) {
      throw new ResourceNotFoundException('资源不存在')
    }

    const result = await this.detectionService.listRuns(organizationId, { userId: user.id }, query)
    return ctx.response.json(result)
  }

  async listResults(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = Number(ctx.request.param('organizationId'))
    const query = (ctx.request.qs() ?? {}) as Record<string, unknown>

    if (!(await this.policy.listResults(organizationId, { userId: user.id }))) {
      throw new ResourceNotFoundException('资源不存在')
    }

    const result = await this.detectionService.listResults(
      organizationId,
      { userId: user.id },
      query,
    )
    return ctx.response.json(result)
  }

  async showResult(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = Number(ctx.request.param('organizationId'))
    const resultId = Number(ctx.request.param('resultId'))

    if (!(await this.policy.getResult(organizationId, { userId: user.id }))) {
      throw new ResourceNotFoundException('资源不存在')
    }

    const result = await this.detectionService.getResult(organizationId, resultId, {
      userId: user.id,
    })
    if (!result) throw new ResourceNotFoundException('检测结果不存在')
    return ctx.response.json({ data: result })
  }

  async ignoreResult(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = Number(ctx.request.param('organizationId'))
    const resultId = Number(ctx.request.param('resultId'))
    const payload = await detectionIgnoreValidator.validate(ctx.request.body())

    if (!(await this.policy.ignoreResult(organizationId, { userId: user.id }))) {
      throw new PermissionDeniedException('无权忽略检测结果')
    }

    const result = await this.detectionService.ignoreResult(
      organizationId,
      resultId,
      payload.reasonHash,
      { userId: user.id },
    )
    return ctx.response.json({ data: result })
  }

  async reopenResult(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = Number(ctx.request.param('organizationId'))
    const resultId = Number(ctx.request.param('resultId'))
    const payload = await detectionReopenValidator.validate(ctx.request.body())

    if (!(await this.policy.reopenResult(organizationId, { userId: user.id }))) {
      throw new PermissionDeniedException('无权重新打开检测结果')
    }

    const result = await this.detectionService.reopenResult(
      organizationId,
      resultId,
      payload.reasonHash,
      { userId: user.id },
    )
    return ctx.response.json({ data: result })
  }

  async buildDraftBridge(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = Number(ctx.request.param('organizationId'))
    const payload = await detectionDraftBridgeValidator.validate(ctx.request.body())

    if (!(await this.policy.buildDraftBridge(organizationId, { userId: user.id }))) {
      throw new PermissionDeniedException('无权生成 CRUD 草案')
    }

    const draft = await this.detectionService.buildDraftBridge(organizationId, payload.resultId, {
      userId: user.id,
    })
    return ctx.response.json({ data: draft })
  }
}
