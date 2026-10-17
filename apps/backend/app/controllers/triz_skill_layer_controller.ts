/**
 * TRIZ Skill Layer Controller (v3-triz-skill-layer-integration §3.14)
 *
 * 端点：summary、destinations、route preview、handoff preview。
 * 所有端点使用统一的 `{ data }`/`{ data, meta }`/`{ error }` envelope。
 */
import TrizSkillLayerService from '#services/triz_skill_layer/triz_skill_layer_service'
import {
  trizSkillLayerDestinationsQueryValidator,
  trizSkillLayerRoutePreviewValidator,
  trizSkillLayerHandoffPreviewValidator,
} from '#validators/triz_skill_layer'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { AuditEvent } from '#services/audit_service'
import type { AuditEventType } from '#services/audit_service'
import AuditService from '#services/audit_service'
import { isTrizSkillLayerEnabled } from '#services/triz_skill_layer/triz_skill_layer_feature_flag'
import RbacService from '#services/rbac_service'

@inject()
export default class TrizSkillLayerController {
  constructor(
    private service: TrizSkillLayerService,
    private auditService: AuditService,
    private rbac: RbacService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgProject(ctx: HttpContext): { organizationId: number; projectId: number } {
    return {
      organizationId: ctx.tenant!.organizationId,
      projectId: Number(ctx.params.projectId),
    }
  }

  private async getUserPermissions(
    user: User,
    _organizationId: number,
    projectId: number,
  ): Promise<Set<string>> {
    try {
      const perms = await this.rbac.resolveProjectPermissions(user, projectId)
      return new Set(perms)
    } catch {
      return new Set()
    }
  }

  // ── Guard helpers ────────────────────────────────────────────────

  private deny(
    ctx: HttpContext,
    event: AuditEventType,
    message: string,
    userId: number,
    orgId: number,
    projectId: number,
  ) {
    this.auditService.log({
      event,
      userId,
      organizationId: orgId,
      projectId,
      metadata: {},
    })
    ctx.response.status(403).json({
      error: { code: 'PERMISSION_DENIED', message },
    })
  }

  private featureOff(ctx: HttpContext) {
    ctx.response.status(503).json({
      error: { code: 'FEATURE_DISABLED', message: 'TRIZ Skill Layer 功能已关闭' },
    })
  }

  // ── GET /api/v1/projects/:projectId/triz/skill-layer/summary ─────

  async summary(ctx: HttpContext) {
    if (!isTrizSkillLayerEnabled()) return this.featureOff(ctx)

    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    const perms = await this.getUserPermissions(user, organizationId, projectId)

    if (!perms.has('triz_skill_layer:view')) {
      return this.deny(
        ctx,
        AuditEvent.TRIZ_SKILL_LAYER_PERMISSION_DENIED,
        '无权查看 TRIZ Skill Layer',
        user.id,
        organizationId,
        projectId,
      )
    }

    const result = await this.service.getSummary(organizationId, projectId, user.id, perms)

    await this.auditService.log({
      event: AuditEvent.TRIZ_SKILL_LAYER_SUMMARY_READ,
      userId: user.id,
      organizationId,
      projectId,
      metadata: {
        profileCount: result.profiles.length,
        featureFlagEnabled: result.featureFlagEnabled,
      },
    })

    return ctx.response.ok({ data: result })
  }

  // ── GET /api/v1/projects/:projectId/triz/skill-layer/destinations ─

  async destinations(ctx: HttpContext) {
    if (!isTrizSkillLayerEnabled()) return this.featureOff(ctx)

    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    const perms = await this.getUserPermissions(user, organizationId, projectId)

    if (!perms.has('triz_skill_layer:view')) {
      return this.deny(
        ctx,
        AuditEvent.TRIZ_SKILL_LAYER_PERMISSION_DENIED,
        '无权查看 TRIZ Skill destinations',
        user.id,
        organizationId,
        projectId,
      )
    }

    const query = await ctx.request.validateUsing(trizSkillLayerDestinationsQueryValidator)
    const result = await this.service.getDestinations(
      organizationId,
      projectId,
      user.id,
      perms,
      query.stage ? { stage: query.stage as any } : undefined,
      query.sort,
      query.page,
      query.perPage,
    )

    await this.auditService.log({
      event: AuditEvent.TRIZ_SKILL_LAYER_DESTINATIONS_READ,
      userId: user.id,
      organizationId,
      projectId,
      metadata: { total: result.meta.total },
    })

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  // ── POST /api/v1/projects/:projectId/triz/skill-layer/route-preview ─

  async routePreview(ctx: HttpContext) {
    if (!isTrizSkillLayerEnabled()) return this.featureOff(ctx)

    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    const perms = await this.getUserPermissions(user, organizationId, projectId)

    if (!perms.has('triz_skill_layer:preview')) {
      return this.deny(
        ctx,
        AuditEvent.TRIZ_SKILL_LAYER_PERMISSION_DENIED,
        '无权生成路由预览',
        user.id,
        organizationId,
        projectId,
      )
    }

    const payload = await ctx.request.validateUsing(trizSkillLayerRoutePreviewValidator)
    const profiles = await this.service.resolveManifests(organizationId, projectId, perms)
    const result = await this.service.routeDestinations(profiles, payload as any, perms)

    await this.auditService.log({
      event: AuditEvent.TRIZ_SKILL_LAYER_ROUTE_PREVIEW,
      userId: user.id,
      organizationId,
      projectId,
      metadata: { routeCount: result.routes.length, idempotencyKey: payload.idempotencyKey },
    })

    return ctx.response.ok({ data: result })
  }

  // ── POST /api/v1/projects/:projectId/triz/skill-layer/handoff-preview

  async handoffPreview(ctx: HttpContext) {
    if (!isTrizSkillLayerEnabled()) return this.featureOff(ctx)

    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    const perms = await this.getUserPermissions(user, organizationId, projectId)

    if (!perms.has('triz_skill_layer:preview')) {
      return this.deny(
        ctx,
        AuditEvent.TRIZ_SKILL_LAYER_PERMISSION_DENIED,
        '无权生成交接预览',
        user.id,
        organizationId,
        projectId,
      )
    }

    const payload = await ctx.request.validateUsing(trizSkillLayerHandoffPreviewValidator)
    const profiles = await this.service.resolveManifests(organizationId, projectId, perms)
    const result = await this.service.buildHandoffPreview(
      organizationId,
      projectId,
      user.id,
      payload as any,
      profiles,
      perms,
    )

    if (!result.hashValidationPassed) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_SKILL_LAYER_STALE_BLOCKED,
        userId: user.id,
        organizationId,
        projectId,
        metadata: { destinationKey: payload.destinationKey },
      })
    }

    await this.auditService.log({
      event: AuditEvent.TRIZ_SKILL_LAYER_HANDOFF_PREVIEW,
      userId: user.id,
      organizationId,
      projectId,
      metadata: {
        destinationKey: payload.destinationKey,
        hashValid: result.hashValidationPassed,
      },
    })

    return ctx.response.ok({ data: result })
  }
}
