// v3-bi-dashboard-builder §4.4 — BI Dashboard Definition Service。
// list/get/current/create/update/copy/set default/archive/restore/version history。

import type User from '#models/user'
import BiDashboardDefinition from '#models/bi_dashboard_definition'
import type BiDashboardPolicy from '#policies/bi_dashboard_policy'
import type BiDashboardPreviewService from './preview_service.js'
import type AuditService from '#services/audit_service'
import {
  BI_DASHBOARD_SCOPES,
  BI_DASHBOARD_SYSTEM_DEFAULT,
  BI_DASHBOARD_AUDIT_EVENTS,
  normalizeBiDashboardDefinition,
  type BiDashboardDefinition as DashboardDto,
  type BiDashboardCreatePayload,
  type BiDashboardUpdatePayload,
  type BiDashboardPreviewPayload,
  type BiDashboardPreviewResult,
  type BiDashboardListResponse,
  type BiDashboardDetailResponse,
} from '@aiproj/types'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'

export default class BiDashboardDefinitionService {
  constructor(
    private readonly policy: BiDashboardPolicy,
    private readonly previewService: BiDashboardPreviewService,
    private readonly audit: AuditService,
  ) {}

  // ─── 系统默认 ────────────────────────────────────────────────────────────

  getSystemDefault(organizationId: number): DashboardDto {
    return {
      dashboardId: 0,
      organizationId,
      ownerActorId: null,
      ...BI_DASHBOARD_SYSTEM_DEFAULT,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
  }

  // ─── 列表 ────────────────────────────────────────────────────────────────

  async list(
    user: User,
    organizationId: number,
    query: { page?: number; perPage?: number; scope?: string; includeArchived?: boolean },
  ): Promise<BiDashboardListResponse> {
    await this.policy.assertOrganizationVisible(user, organizationId)

    const page = query.page ?? 1
    const perPage = Math.min(query.perPage ?? 20, 100)

    let dbQuery = BiDashboardDefinition.query().where('organization_id', organizationId)

    // includeArchived 为真时不加归档过滤；为假/未传时只返回未归档
    if (!query.includeArchived) {
      dbQuery = dbQuery.where('is_archived', false)
    }

    if (query.scope === BI_DASHBOARD_SCOPES.PERSONAL) {
      dbQuery = dbQuery.where('owner_actor_id', user.id)
    } else if (query.scope === BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED) {
      dbQuery = dbQuery.where('scope', BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED)
    } else {
      // 默认返回 shared + 自己的 personal
      dbQuery = dbQuery.where((q) => {
        q.where('scope', BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED).orWhere('owner_actor_id', user.id)
      })
    }

    const result = await dbQuery
      .orderBy('is_default', 'desc')
      .orderBy('updated_at', 'desc')
      .paginate(page, perPage)

    return {
      data: result.all().map((r) => this.toDto(r)),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  // ─── 获取当前 ────────────────────────────────────────────────────────────

  async getCurrent(user: User, organizationId: number): Promise<BiDashboardDetailResponse> {
    await this.policy.assertOrganizationVisible(user, organizationId)

    const dashboard = await BiDashboardDefinition.query()
      .where('organization_id', organizationId)
      .where('is_default', true)
      .where('is_archived', false)
      .first()

    if (!dashboard) {
      return { data: this.getSystemDefault(organizationId) }
    }

    return { data: this.toDto(dashboard) }
  }

  // ─── 获取详情 ────────────────────────────────────────────────────────────

  async getById(
    user: User,
    organizationId: number,
    dashboardId: number,
  ): Promise<BiDashboardDetailResponse> {
    const dashboard = await BiDashboardDefinition.find(dashboardId)
    if (!dashboard || dashboard.organizationId !== organizationId) {
      throw new ResourceNotFoundException('BI Dashboard not found')
    }

    await this.policy.authorizeView(user, dashboard)
    return { data: this.toDto(dashboard) }
  }

  // ─── 预览 ────────────────────────────────────────────────────────────────

  async preview(
    user: User,
    organizationId: number,
    payload: BiDashboardPreviewPayload,
  ): Promise<BiDashboardPreviewResult> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    return this.previewService.preview(user, organizationId, payload)
  }

  // ─── 创建 ────────────────────────────────────────────────────────────────

  async create(
    user: User,
    organizationId: number,
    payload: BiDashboardCreatePayload,
  ): Promise<BiDashboardDetailResponse> {
    await this.policy.assertOrganizationVisible(user, organizationId)

    if (payload.scope === BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED) {
      const canCreate = await this.policy.authorizeCreateShared(user, organizationId)
      if (!canCreate)
        throw new ValidationException('PERMISSION_DENIED: cannot create shared dashboard')
    }

    // 预览以验证
    const preview = await this.previewService.preview(user, organizationId, {
      layout: payload.layout,
      widgets: payload.widgets,
      globalFilters: payload.globalFilters,
      timeWindow: payload.timeWindow,
    })
    if (!preview.saveable) {
      throw new ValidationException('Dashboard preview has blocking warnings')
    }

    const definitionHash = normalizeBiDashboardDefinition({
      name: payload.name,
      scope: payload.scope,
      ownerActorId: payload.scope === BI_DASHBOARD_SCOPES.PERSONAL ? user.id : null,
      layout: payload.layout,
      widgets: payload.widgets,
      globalFilters: payload.globalFilters ?? [],
      timeWindow: payload.timeWindow ?? { mode: 'last_n_days', days: 30 },
      freshnessPolicy: payload.freshnessPolicy ?? { maxAgeSeconds: 3600, staleBehavior: 'warning' },
      isDefault: false,
      isArchived: false,
      warningSummary: [],
    })

    const dashboard = await BiDashboardDefinition.create({
      organizationId,
      scope: payload.scope,
      ownerActorId: payload.scope === BI_DASHBOARD_SCOPES.PERSONAL ? user.id : null,
      name: payload.name,
      version: 1,
      definitionHash,
      snapshotHash: preview.snapshotHash,
      layout: payload.layout,
      widgets: payload.widgets,
      globalFilters: payload.globalFilters ?? null,
      timeWindow: payload.timeWindow ?? null,
      freshnessPolicy: payload.freshnessPolicy ?? null,
      isDefault: false,
      isArchived: false,
      warningSummary: preview.globalWarnings,
    })

    await this.audit.log({
      userId: user.id,
      organizationId,
      event: BI_DASHBOARD_AUDIT_EVENTS.CREATED,
      entityType: 'bi_dashboard',
      entityId: dashboard.id,
      metadata: {
        scope: payload.scope,
        version: 1,
        widgetKeys: payload.widgets.map((w) => w.widgetKey),
      },
    })

    return { data: this.toDto(dashboard) }
  }

  // ─── 更新 ────────────────────────────────────────────────────────────────

  async update(
    user: User,
    organizationId: number,
    dashboardId: number,
    payload: BiDashboardUpdatePayload,
  ): Promise<BiDashboardDetailResponse> {
    const dashboard = await BiDashboardDefinition.find(dashboardId)
    if (!dashboard || dashboard.organizationId !== organizationId) {
      throw new ResourceNotFoundException('BI Dashboard not found')
    }

    await this.policy.authorizeManage(user, dashboard)

    // 乐观并发检查
    if (dashboard.version !== payload.version) {
      throw new ValidationException('Stale version: dashboard has been updated by another session')
    }

    // 预览验证
    const preview = await this.previewService.preview(user, organizationId, {
      layout: payload.layout,
      widgets: payload.widgets,
      globalFilters: payload.globalFilters,
      timeWindow: payload.timeWindow,
    })
    if (!preview.saveable) {
      throw new ValidationException('Dashboard preview has blocking warnings')
    }

    const definitionHash = normalizeBiDashboardDefinition({
      name: payload.name,
      scope: payload.scope,
      ownerActorId: payload.scope === BI_DASHBOARD_SCOPES.PERSONAL ? user.id : null,
      layout: payload.layout,
      widgets: payload.widgets,
      globalFilters: payload.globalFilters ?? [],
      timeWindow: payload.timeWindow ?? { mode: 'last_n_days', days: 30 },
      freshnessPolicy: payload.freshnessPolicy ?? { maxAgeSeconds: 3600, staleBehavior: 'warning' },
      isDefault: dashboard.isDefault,
      isArchived: false,
      warningSummary: [],
    })

    const newVersion = dashboard.version + 1
    dashboard.merge({
      name: payload.name,
      scope: payload.scope,
      version: newVersion,
      definitionHash,
      snapshotHash: preview.snapshotHash,
      layout: payload.layout,
      widgets: payload.widgets,
      globalFilters: payload.globalFilters ?? null,
      timeWindow: payload.timeWindow ?? null,
      freshnessPolicy: payload.freshnessPolicy ?? null,
      warningSummary: preview.globalWarnings,
    })
    await dashboard.save()

    await this.audit.log({
      userId: user.id,
      organizationId,
      event: BI_DASHBOARD_AUDIT_EVENTS.UPDATED,
      entityType: 'bi_dashboard',
      entityId: dashboard.id,
      metadata: {
        scope: payload.scope,
        version: newVersion,
        widgetKeys: payload.widgets.map((w) => w.widgetKey),
      },
    })

    return { data: this.toDto(dashboard) }
  }

  // ─── 复制 ────────────────────────────────────────────────────────────────

  async copy(
    user: User,
    organizationId: number,
    dashboardId: number,
  ): Promise<BiDashboardDetailResponse> {
    const source = await BiDashboardDefinition.find(dashboardId)
    if (!source || source.organizationId !== organizationId) {
      throw new ResourceNotFoundException('BI Dashboard not found')
    }
    await this.policy.authorizeView(user, source)

    const copy = await BiDashboardDefinition.create({
      organizationId,
      scope: BI_DASHBOARD_SCOPES.PERSONAL,
      ownerActorId: user.id,
      name: `${source.name} (副本)`,
      version: 1,
      definitionHash: source.definitionHash,
      snapshotHash: source.snapshotHash,
      layout: source.layout,
      widgets: source.widgets,
      globalFilters: source.globalFilters,
      timeWindow: source.timeWindow,
      freshnessPolicy: source.freshnessPolicy,
      isDefault: false,
      isArchived: false,
      warningSummary: source.warningSummary,
    })

    await this.audit.log({
      userId: user.id,
      organizationId,
      event: BI_DASHBOARD_AUDIT_EVENTS.COPIED,
      entityType: 'bi_dashboard',
      entityId: copy.id,
      metadata: { sourceDashboardId: source.id },
    })

    return { data: this.toDto(copy) }
  }

  // ─── 设默认 ──────────────────────────────────────────────────────────────

  async setDefault(
    user: User,
    organizationId: number,
    dashboardId: number,
  ): Promise<BiDashboardDetailResponse> {
    const dashboard = await BiDashboardDefinition.find(dashboardId)
    if (!dashboard || dashboard.organizationId !== organizationId) {
      throw new ResourceNotFoundException('BI Dashboard not found')
    }

    const canSetDefault = await this.policy.authorizeSetDefault(user, dashboard)
    if (!canSetDefault) {
      throw new ValidationException('PERMISSION_DENIED: cannot set this dashboard as default')
    }

    // 清除现有默认
    await BiDashboardDefinition.query()
      .where('organization_id', organizationId)
      .where('is_default', true)
      .update({ isDefault: false })

    dashboard.isDefault = true
    await dashboard.save()

    await this.audit.log({
      userId: user.id,
      organizationId,
      event: BI_DASHBOARD_AUDIT_EVENTS.SET_DEFAULT,
      entityType: 'bi_dashboard',
      entityId: dashboard.id,
      metadata: { scope: dashboard.scope },
    })

    return { data: this.toDto(dashboard) }
  }

  // ─── 归档 ────────────────────────────────────────────────────────────────

  async archive(
    user: User,
    organizationId: number,
    dashboardId: number,
  ): Promise<BiDashboardDetailResponse> {
    const dashboard = await BiDashboardDefinition.find(dashboardId)
    if (!dashboard || dashboard.organizationId !== organizationId) {
      throw new ResourceNotFoundException('BI Dashboard not found')
    }

    await this.policy.authorizeManage(user, dashboard)

    if (dashboard.isDefault) {
      throw new ValidationException('Cannot archive the default dashboard')
    }

    dashboard.isArchived = true
    await dashboard.save()

    await this.audit.log({
      userId: user.id,
      organizationId,
      event: BI_DASHBOARD_AUDIT_EVENTS.ARCHIVED,
      entityType: 'bi_dashboard',
      entityId: dashboard.id,
      metadata: { scope: dashboard.scope },
    })

    return { data: this.toDto(dashboard) }
  }

  // ─── 恢复 ────────────────────────────────────────────────────────────────

  async restore(
    user: User,
    organizationId: number,
    dashboardId: number,
  ): Promise<BiDashboardDetailResponse> {
    const dashboard = await BiDashboardDefinition.find(dashboardId)
    if (!dashboard || dashboard.organizationId !== organizationId) {
      throw new ResourceNotFoundException('BI Dashboard not found')
    }

    await this.policy.authorizeManage(user, dashboard)

    dashboard.isArchived = false
    await dashboard.save()

    await this.audit.log({
      userId: user.id,
      organizationId,
      event: BI_DASHBOARD_AUDIT_EVENTS.RESTORED,
      entityType: 'bi_dashboard',
      entityId: dashboard.id,
      metadata: { scope: dashboard.scope },
    })

    return { data: this.toDto(dashboard) }
  }

  // ─── 删除 ────────────────────────────────────────────────────────────────

  async delete(user: User, organizationId: number, dashboardId: number): Promise<void> {
    const dashboard = await BiDashboardDefinition.find(dashboardId)
    if (!dashboard || dashboard.organizationId !== organizationId) {
      throw new ResourceNotFoundException('BI Dashboard not found')
    }

    await this.policy.authorizeManage(user, dashboard)

    if (dashboard.isDefault) {
      throw new ValidationException('Cannot delete the default dashboard')
    }

    await dashboard.delete()

    await this.audit.log({
      userId: user.id,
      organizationId,
      event: BI_DASHBOARD_AUDIT_EVENTS.DELETED,
      entityType: 'bi_dashboard',
      entityId: dashboardId,
      metadata: { scope: dashboard.scope },
    })
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private toDto(model: BiDashboardDefinition): DashboardDto {
    return {
      dashboardId: model.id,
      organizationId: model.organizationId,
      scope: model.scope as DashboardDto['scope'],
      ownerActorId: model.ownerActorId,
      name: model.name,
      version: model.version,
      definitionHash: model.definitionHash,
      snapshotHash: model.snapshotHash,
      layout: model.layout as unknown as DashboardDto['layout'],
      widgets: model.widgets as unknown as DashboardDto['widgets'],
      globalFilters: (model.globalFilters as DashboardDto['globalFilters']) ?? [],
      timeWindow: (model.timeWindow as DashboardDto['timeWindow']) ?? {
        mode: 'last_n_days',
        days: 30,
      },
      freshnessPolicy: (model.freshnessPolicy as DashboardDto['freshnessPolicy']) ?? {
        maxAgeSeconds: 3600,
        staleBehavior: 'warning',
      },
      isDefault: model.isDefault,
      isArchived: model.isArchived,
      warningSummary: model.warningSummary as DashboardDto['warningSummary'],
      createdAt: model.createdAt.toISO()!,
      updatedAt: model.updatedAt.toISO()!,
    }
  }
}
