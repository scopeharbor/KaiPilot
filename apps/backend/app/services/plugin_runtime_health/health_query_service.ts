import { inject } from '@adonisjs/core'
import PluginRuntimeHealthSnapshotModel from '#models/plugin_runtime_health_snapshot'
import PluginRuntimeHealthEvent from '#models/plugin_runtime_health_event'
import {
  aggregateHealthSummaries,
  paginateHealthSnapshots,
  sortHealthSnapshots,
  toHealthEventSummary,
  type PluginRuntimeHealthAggregate,
  type PluginRuntimeHealthEventSummary,
  type PluginRuntimeHealthQueryFilter,
  type PluginRuntimeHealthSnapshot as HealthSnapshotDto,
  type PluginRuntimeHealthSnapshotListItem,
} from '@aiproj/types'

@inject()
export default class HealthQueryService {
  async listSnapshots(
    organizationId: number,
    filter: PluginRuntimeHealthQueryFilter,
  ): Promise<{
    data: PluginRuntimeHealthSnapshotListItem[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
    aggregate: PluginRuntimeHealthAggregate
  }> {
    const query = PluginRuntimeHealthSnapshotModel.query().where('organizationId', organizationId)

    if (filter.pluginId) query.where('pluginId', filter.pluginId)
    if (filter.contributionKey) query.where('contributionKey', filter.contributionKey)
    if (filter.status) query.where('status', filter.status)
    if (filter.reasonCode) query.where('reasonCode', filter.reasonCode)
    if (filter.circuitState) query.where('circuitState', filter.circuitState)
    if (filter.isStale != null) query.where('isStale', filter.isStale)

    const all = await query.orderBy('lastSeenAt', 'desc')
    const dtos: HealthSnapshotDto[] = all.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      installationId: row.installationId,
      pluginId: row.pluginId,
      contributionKey: row.contributionKey,
      status: row.status,
      reasonCode: row.reasonCode,
      circuitState: row.circuitState,
      firstSeenAt: row.firstSeenAt.toISO()!,
      lastSeenAt: row.lastSeenAt.toISO()!,
      lastSuccessAt: row.lastSuccessAt?.toISO() ?? null,
      lastFailureAt: row.lastFailureAt?.toISO() ?? null,
      recoveredAt: row.recoveredAt?.toISO() ?? null,
      totalSuccess: row.totalSuccess,
      totalCrash: row.totalCrash,
      totalTimeout: row.totalTimeout,
      totalQuota: row.totalQuota,
      totalPermissionDenied: row.totalPermissionDenied,
      totalIncompatible: row.totalIncompatible,
      totalIsolationFailed: row.totalIsolationFailed,
      consecutiveFailures: row.consecutiveFailures,
      isStale: row.isStale,
      warningCodes: row.warningCodes,
      rowVersion: row.rowVersion,
      updatedAt: row.updatedAt?.toISO() ?? new Date().toISOString(),
    }))

    const sorted = sortHealthSnapshots(dtos, filter.sort ?? '-lastSeenAt')
    const paginated = paginateHealthSnapshots(sorted, filter.page ?? 1, filter.perPage ?? 20)
    const aggregate = aggregateHealthSummaries(dtos)

    return { ...paginated, aggregate }
  }

  async listEvents(
    organizationId: number,
    installationId: number,
    page: number = 1,
    perPage: number = 20,
  ): Promise<{
    data: PluginRuntimeHealthEventSummary[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const query = PluginRuntimeHealthEvent.query()
      .where('organizationId', organizationId)
      .where('installationId', installationId)
      .orderBy('occurredAt', 'desc')

    const totalResult = await PluginRuntimeHealthEvent.query()
      .where('organizationId', organizationId)
      .where('installationId', installationId)
      .count('* as total')
      .first()
    const total = Number((totalResult as any)?.$extras?.total ?? (totalResult as any)?.total ?? 0)

    const rows = await query.paginate(page, perPage)
    const data = rows.all().map((row) =>
      toHealthEventSummary({
        id: row.id,
        organizationId: row.organizationId,
        installationId: row.installationId,
        pluginId: row.pluginId,
        pluginVersion: row.pluginVersion ?? null,
        contributionKey: row.contributionKey ?? null,
        seamKey: row.seamKey ?? null,
        outcome: row.outcome,
        reasonCode: row.reasonCode,
        quotaKind: row.quotaKind,
        durationBucket: row.durationBucket,
        latencyMs: row.latencyMs ?? null,
        circuitState: row.circuitState,
        invocationId: row.invocationId,
        occurredAt: row.occurredAt.toISO()!,
        rowVersion: row.rowVersion,
      }),
    )

    return {
      data,
      meta: {
        total: total || rows.all().length,
        page,
        perPage,
        totalPages: Math.max(1, Math.ceil((total || rows.all().length) / perPage)),
      },
    }
  }

  async getSnapshot(
    organizationId: number,
    installationId: number,
    contributionKey?: string | null,
  ): Promise<HealthSnapshotDto | null> {
    const query = PluginRuntimeHealthSnapshotModel.query()
      .where('organizationId', organizationId)
      .where('installationId', installationId)
    if (contributionKey) query.where('contributionKey', contributionKey)
    else query.whereNull('contributionKey')
    const row = await query.first()
    if (!row) return null
    return {
      id: row.id,
      organizationId: row.organizationId,
      installationId: row.installationId,
      pluginId: row.pluginId,
      contributionKey: row.contributionKey,
      status: row.status,
      reasonCode: row.reasonCode,
      circuitState: row.circuitState,
      firstSeenAt: row.firstSeenAt.toISO()!,
      lastSeenAt: row.lastSeenAt.toISO()!,
      lastSuccessAt: row.lastSuccessAt?.toISO() ?? null,
      lastFailureAt: row.lastFailureAt?.toISO() ?? null,
      recoveredAt: row.recoveredAt?.toISO() ?? null,
      totalSuccess: row.totalSuccess,
      totalCrash: row.totalCrash,
      totalTimeout: row.totalTimeout,
      totalQuota: row.totalQuota,
      totalPermissionDenied: row.totalPermissionDenied,
      totalIncompatible: row.totalIncompatible,
      totalIsolationFailed: row.totalIsolationFailed,
      consecutiveFailures: row.consecutiveFailures,
      isStale: row.isStale,
      warningCodes: row.warningCodes,
      rowVersion: row.rowVersion,
      updatedAt: row.updatedAt?.toISO() ?? new Date().toISOString(),
    }
  }
}
