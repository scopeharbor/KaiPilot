import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import HealthQueryService from '#services/plugin_runtime_health/health_query_service'
import HealthCircuitProbe from '#services/plugin_runtime_health/health_circuit_probe'
import PluginRuntimeHealthPolicy from '#policies/plugin_runtime_health_policy'
import {
  listHealthSnapshotsValidator,
  listHealthEventsValidator,
  healthProbeValidator,
} from '#validators/plugin_runtime_health_validator'
@inject()
export default class PluginRuntimeHealthController {
  constructor(
    private queryService: HealthQueryService,
    private probe: HealthCircuitProbe,
    private policy: PluginRuntimeHealthPolicy,
  ) {}

  private organizationId(ctx: HttpContext): number {
    const raw = (ctx.request as any).organizationId ?? ctx.request.header('x-organization-id')
    const parsed = Number(raw ?? ctx.request.qs()?.organizationId)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('organizationId required')
    }
    return parsed
  }

  /** GET /api/v1/plugin-health/snapshots */
  async snapshots(ctx: HttpContext) {
    const orgId = this.organizationId(ctx)
    const user = ctx.auth.user!
    const canView = await this.policy.canView(user as any, orgId)
    if (!canView)
      return ctx.response.forbidden({ error: { code: 'PERMISSION_DENIED', message: 'forbidden' } })

    const payload = await listHealthSnapshotsValidator.validate(ctx.request.qs())
    const result = await this.queryService.listSnapshots(orgId, payload as any)
    return ctx.response.ok({ data: result.data, meta: result.meta, aggregate: result.aggregate })
  }

  /** GET /api/v1/plugin-health/installations/:id/events */
  async events(ctx: HttpContext) {
    const orgId = this.organizationId(ctx)
    const user = ctx.auth.user!
    const canView = await this.policy.canView(user as any, orgId)
    if (!canView)
      return ctx.response.forbidden({ error: { code: 'PERMISSION_DENIED', message: 'forbidden' } })

    const installationId = Number(ctx.params.id)
    if (!Number.isFinite(installationId))
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'invalid installation id' },
      })

    const payload = await listHealthEventsValidator.validate(ctx.request.qs())
    const result = await this.queryService.listEvents(
      orgId,
      installationId,
      payload.page ?? 1,
      payload.perPage ?? 20,
    )
    return ctx.response.ok(result)
  }

  /** POST /api/v1/plugin-health/installations/:id/probe */
  async triggerProbe(ctx: HttpContext) {
    const orgId = this.organizationId(ctx)
    const canProbe = await this.policy.canProbe(ctx, orgId)
    if (!canProbe)
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: 'probe forbidden' },
      })

    const installationId = Number(ctx.params.id)
    if (!Number.isFinite(installationId))
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'invalid installation id' },
      })

    const payload = await healthProbeValidator.validate(ctx.request.body() ?? {})
    const contributionKey = (ctx.request.qs()?.contributionKey as string | undefined) ?? null
    const result = await this.probe.probe(
      orgId,
      installationId,
      contributionKey,
      (payload.outcome as any) ?? 'success',
    )
    return ctx.response.ok(result)
  }
}
