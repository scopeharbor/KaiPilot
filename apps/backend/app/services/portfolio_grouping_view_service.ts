/**
 * v3-pmo-portfolio-grouping-views —— PortfolioGroupingViewService。
 *
 * 职责：
 *   - 列表系统预设、个人保存、组织共享视图
 *   - 解析默认视图
 *   - CRUD：创建/更新/删除/复制/设默认
 *   - 隐藏无权限视图的存在
 *   - 低敏审计
 *   - 组织隔离
 */

import type User from '#models/user'
import { inject } from '@adonisjs/core'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import PmoGroupingViewModel from '#models/pmo_grouping_view'
// 注意：不得改回 import type——@inject() 依赖 emitDecoratorMetadata 的运行时类型，
// type-only 导入会让参数元数据退化为 Object，容器报 "Cannot inject [Function: Object]"。
import PortfolioGroupingViewPolicy from '#policies/portfolio_grouping_view_policy'
import AuditService from '#services/audit_service'
import type { AuditEventType } from '#services/audit_service'
import {
  type PmoGroupingViewDefinition,
  type PmoGroupingViewListQuery,
  type PmoGroupingViewListResponse,
  type PmoGroupingViewCreateRequest,
  type PmoGroupingViewUpdateRequest,
  type PmoGroupingViewCapabilities,
  PMO_GROUPING_VIEW_SCOPES,
  PMO_GROUPING_VIEW_DEFINITION_VERSION,
  PMO_GROUPING_VIEW_DEFAULT_PER_PAGE,
  PMO_GROUPING_VIEW_MAX_PER_PAGE,
  PMO_GROUPING_VIEW_MAX_NAME_LENGTH,
  getSystemPresetViews,
  isSystemPresetId,
  normalizeGroupingViewQuery,
  hashGroupingViewQuery,
} from '@aiproj/types'

@inject()
export default class PortfolioGroupingViewService {
  constructor(
    private policy: PortfolioGroupingViewPolicy,
    private audit: AuditService,
  ) {}

  // ─── List ────────────────────────────────────────────────────────────────────

  /**
   * 获取分组视图列表（系统预设 + 当前组织的个人/共享视图）。
   */
  async list(
    user: User,
    organizationId: number,
    query: PmoGroupingViewListQuery = {},
  ): Promise<PmoGroupingViewListResponse> {
    await this.policy.authorizeView(user, organizationId)

    const page = query.page ?? 1
    const perPage = Math.min(
      query.perPage ?? PMO_GROUPING_VIEW_DEFAULT_PER_PAGE,
      PMO_GROUPING_VIEW_MAX_PER_PAGE,
    )

    // 系统预设视图
    const systemPresets = getSystemPresetViews(organizationId)

    // 从数据库查询当前组织的个人/组织视图
    const dbQuery = PmoGroupingViewModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')

    if (query.scope && query.scope !== PMO_GROUPING_VIEW_SCOPES.SYSTEM) {
      dbQuery.where('scope', query.scope)
    }
    if (query.search) {
      const q = `%${query.search}%`
      dbQuery.where((b) => {
        b.where('name', 'like', q).orWhere('description', 'like', q)
      })
    }

    const dbViews = await dbQuery.orderBy('updated_at', 'desc')

    // 合并：系统预设 + DB 视图，过滤不可见。
    // scope 过滤必须同时作用于系统预设：原先无条件把预设塞进结果，于是
    // `scope=personal` 也会带出一堆 scope=system 的预设，过滤器等于对预设失效。
    // 另外这里必须复制数组——直接用 systemPresets 会把 DB 视图 push 进预设数组本身。
    const includeSystemPresets = !query.scope || query.scope === PMO_GROUPING_VIEW_SCOPES.SYSTEM
    const allViews: PmoGroupingViewDefinition[] = includeSystemPresets ? [...systemPresets] : []

    for (const dbView of dbViews) {
      const dto = this.toDto(dbView, user, organizationId)
      if (dto) {
        allViews.push(dto)
      }
    }

    const total = allViews.length
    const totalPages = Math.ceil(total / perPage)
    const offset = (page - 1) * perPage
    const paged = allViews.slice(offset, offset + perPage)

    return {
      data: paged,
      meta: { page, perPage, total, totalPages },
    }
  }

  // ─── Detail ─────────────────────────────────────────────────────────────────

  /**
   * 获取分组视图详情。
   */
  async detail(
    user: User,
    organizationId: number,
    viewId: string,
  ): Promise<PmoGroupingViewDefinition | null> {
    await this.policy.authorizeView(user, organizationId)

    // 先检查系统预设
    if (isSystemPresetId(viewId)) {
      const presets = getSystemPresetViews(organizationId)
      return presets.find((p) => p.id === viewId) ?? null
    }

    // 查询数据库
    const dbView = await PmoGroupingViewModel.query()
      .where('view_id', viewId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()

    if (!dbView) return null

    // 权限检查：隐藏无权限视图
    if (!(await this.policy.canReadView(user, organizationId, dbView))) {
      return null // 不暴露视图存在
    }

    return this.toDto(dbView, user, organizationId)!
  }

  // ─── Create ─────────────────────────────────────────────────────────────────

  /**
   * 创建分组视图。
   */
  async create(
    user: User,
    organizationId: number,
    input: PmoGroupingViewCreateRequest,
  ): Promise<PmoGroupingViewDefinition> {
    await this.policy.authorizeView(user, organizationId)

    // 权限检查
    if (input.scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION) {
      await this.policy.authorizeManage(user, organizationId)
    }

    // 规范化查询定义
    const normalizedQuery = normalizeGroupingViewQuery(input.query)

    // 生成 view_id
    const viewId = randomUUID()

    // 如果设为默认，先清除当前范围的旧默认
    if (input.isDefault && input.scope === PMO_GROUPING_VIEW_SCOPES.PERSONAL) {
      await PmoGroupingViewModel.query()
        .where('organization_id', organizationId)
        .where('owner_user_id', Number(user.id))
        .where('scope', PMO_GROUPING_VIEW_SCOPES.PERSONAL)
        .where('is_default', 1)
        .update({ is_default: 0 })
    }
    if (input.isDefault && input.scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION) {
      await PmoGroupingViewModel.query()
        .where('organization_id', organizationId)
        .where('scope', PMO_GROUPING_VIEW_SCOPES.ORGANIZATION)
        .where('is_org_default', 1)
        .update({ is_org_default: 0 })
    }

    const model = await PmoGroupingViewModel.create({
      viewId,
      organizationId,
      scope: input.scope,
      ownerUserId:
        input.scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION ? Number(user.id) : Number(user.id),
      name: input.name.slice(0, PMO_GROUPING_VIEW_MAX_NAME_LENGTH),
      description: input.description ?? null,
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify(normalizedQuery),
      isDefault: input.scope === PMO_GROUPING_VIEW_SCOPES.PERSONAL && input.isDefault ? 1 : 0,
      isOrgDefault:
        input.scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION && input.isDefault ? 1 : 0,
    })

    // 低敏审计
    await this.audit.log({
      event: 'PMO_GROUPING_VIEW_CREATED' as AuditEventType,
      severity: 'info',
      userId: Number(user.id),
      organizationId,
      entityType: 'pmo_grouping_view',
      changes: {
        after: {
          scope: input.scope,
          name: input.name,
          definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
          queryHash: hashGroupingViewQuery(normalizedQuery),
        },
      },
      metadata: { viewId },
    })

    return this.toDto(model, user, organizationId)!
  }

  // ─── Update ─────────────────────────────────────────────────────────────────

  /**
   * 更新分组视图。
   */
  async update(
    user: User,
    organizationId: number,
    viewId: string,
    input: PmoGroupingViewUpdateRequest,
  ): Promise<PmoGroupingViewDefinition | null> {
    await this.policy.authorizeView(user, organizationId)

    const model = await PmoGroupingViewModel.query()
      .where('view_id', viewId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()

    if (!model) return null

    if (!(await this.policy.canEditView(user, organizationId, model))) {
      throw new Error('PERMISSION_DENIED')
    }

    if (input.name !== undefined) {
      model.name = input.name.slice(0, PMO_GROUPING_VIEW_MAX_NAME_LENGTH)
    }
    if (input.description !== undefined) {
      model.description = input.description
    }
    if (input.query !== undefined) {
      model.queryDefinition = JSON.stringify(normalizeGroupingViewQuery(input.query))
    }
    if (input.isDefault !== undefined && model.scope === PMO_GROUPING_VIEW_SCOPES.PERSONAL) {
      if (input.isDefault) {
        await PmoGroupingViewModel.query()
          .where('organization_id', organizationId)
          .where('owner_user_id', Number(user.id))
          .where('scope', PMO_GROUPING_VIEW_SCOPES.PERSONAL)
          .where('is_default', 1)
          .whereNot('view_id', viewId)
          .update({ is_default: 0 })
      }
      model.isDefault = input.isDefault ? 1 : 0
    }

    await model.save()

    await this.audit.log({
      event: 'PMO_GROUPING_VIEW_UPDATED' as AuditEventType,
      severity: 'info',
      userId: Number(user.id),
      organizationId,
      entityType: 'pmo_grouping_view',
      changes: {
        after: {
          updatedFields: Object.keys(input),
          queryHash: model.queryDefinition
            ? hashGroupingViewQuery(JSON.parse(model.queryDefinition))
            : undefined,
        },
      },
      metadata: { viewId },
    })

    return this.toDto(model, user, organizationId)!
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  /**
   * 软删除分组视图。
   */
  async delete(user: User, organizationId: number, viewId: string): Promise<boolean> {
    await this.policy.authorizeView(user, organizationId)

    const model = await PmoGroupingViewModel.query()
      .where('view_id', viewId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()

    if (!model) return false

    if (!(await this.policy.canDeleteView(user, organizationId, model))) {
      throw new Error('PERMISSION_DENIED')
    }

    // 该列是 @column.dateTime()，Lucid 只接受 luxon DateTime；
    // 原先塞原生 Date 再 as any 绕过类型，运行时被 prepareDateTimeColumn 直接抛错。
    model.deletedAt = DateTime.now()
    model.isDefault = 0
    model.isOrgDefault = 0
    await model.save()

    await this.audit.log({
      event: 'PMO_GROUPING_VIEW_DELETED' as AuditEventType,
      severity: 'info',
      userId: Number(user.id),
      organizationId,
      entityType: 'pmo_grouping_view',
      changes: {
        after: {
          scope: model.scope,
          name: model.name,
        },
      },
      metadata: { viewId },
    })

    return true
  }

  // ─── Duplicate ──────────────────────────────────────────────────────────────

  /**
   * 复制分组视图为个人视图。
   */
  async duplicate(
    user: User,
    organizationId: number,
    viewId: string,
    newName?: string,
    targetScope?: string,
  ): Promise<PmoGroupingViewDefinition | null> {
    await this.policy.authorizeView(user, organizationId)

    // 先找系统预设，再找数据库
    let sourceQuery: any = null
    if (isSystemPresetId(viewId)) {
      const presets = getSystemPresetViews(organizationId)
      const preset = presets.find((p) => p.id === viewId)
      if (!preset) return null
      sourceQuery = preset.query
    } else {
      const sourceModel = await PmoGroupingViewModel.query()
        .where('view_id', viewId)
        .where('organization_id', organizationId)
        .whereNull('deleted_at')
        .first()
      if (!sourceModel) return null
      if (!(await this.policy.canDuplicateView(user, organizationId, sourceModel))) {
        throw new Error('PERMISSION_DENIED')
      }
      sourceQuery = JSON.parse(sourceModel.queryDefinition)
    }

    if (!sourceQuery) return null

    const scope = targetScope ?? PMO_GROUPING_VIEW_SCOPES.PERSONAL
    if (scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION) {
      await this.policy.authorizeManage(user, organizationId)
    }

    return this.create(user, organizationId, {
      name: newName ?? `副本 - ${viewId}`,
      scope: scope as any,
      query: sourceQuery,
    })
  }

  // ─── Set Default ────────────────────────────────────────────────────────────

  /**
   * 设置默认视图（个人或组织范围）。
   */
  async setDefault(
    user: User,
    organizationId: number,
    viewId: string,
    scope: 'personal' | 'organization',
  ): Promise<PmoGroupingViewDefinition | null> {
    await this.policy.authorizeView(user, organizationId)

    const canSet = await this.policy.canSetDefault(user, organizationId, scope)
    if (!canSet) {
      throw new Error('PERMISSION_DENIED')
    }

    // 查找视图
    let model: PmoGroupingViewModel | null = null
    if (isSystemPresetId(viewId)) {
      // 系统预设不能设为默认（它们没有持久化记录）
      return null
    } else {
      model = await PmoGroupingViewModel.query()
        .where('view_id', viewId)
        .where('organization_id', organizationId)
        .whereNull('deleted_at')
        .first()
    }

    if (!model) return null

    // 清除旧默认
    if (scope === 'personal') {
      await PmoGroupingViewModel.query()
        .where('organization_id', organizationId)
        .where('owner_user_id', Number(user.id))
        .where('scope', PMO_GROUPING_VIEW_SCOPES.PERSONAL)
        .where('is_default', 1)
        .update({ is_default: 0 })
      model.isDefault = 1
    } else {
      await PmoGroupingViewModel.query()
        .where('organization_id', organizationId)
        .where('scope', PMO_GROUPING_VIEW_SCOPES.ORGANIZATION)
        .where('is_org_default', 1)
        .update({ is_org_default: 0 })
      model.isOrgDefault = 1
    }
    await model.save()

    await this.audit.log({
      event: 'PMO_GROUPING_VIEW_SET_DEFAULT' as AuditEventType,
      severity: 'info',
      userId: Number(user.id),
      organizationId,
      entityType: 'pmo_grouping_view',
      changes: { after: { scope } },
      metadata: { viewId },
    })

    return this.toDto(model, user, organizationId)!
  }

  // ─── Preview ────────────────────────────────────────────────────────────────

  /**
   * 预览分组视图结果（复用 Dashboard 聚合）。
   * 预览不落库、不调用 AI、不写 review marker。
   */
  async preview(
    user: User,
    organizationId: number,
    viewIdOrQuery: { viewId?: string; query?: any },
  ): Promise<any> {
    await this.policy.authorizeView(user, organizationId)

    // 解析查询定义
    let queryDef: any = null
    if (viewIdOrQuery.query) {
      queryDef = normalizeGroupingViewQuery(viewIdOrQuery.query)
    } else if (viewIdOrQuery.viewId) {
      const view = await this.detail(user, organizationId, viewIdOrQuery.viewId)
      if (!view) return null
      queryDef = view.query
    } else {
      queryDef = normalizeGroupingViewQuery({ primaryGrouping: 'status' })
    }

    // 委托给 Dashboard service 执行分组
    // 通过 import 避免循环依赖
    const { default: PortfolioDashboardService } =
      await import('#services/portfolio_dashboard_service')
    const dashboardService = new PortfolioDashboardService()

    const groupResult = await dashboardService.evaluateGroupingView(organizationId, user, queryDef)

    const now = new Date().toISOString()
    return {
      view: viewIdOrQuery.viewId
        ? await this.detail(user, organizationId, viewIdOrQuery.viewId!)
        : undefined,
      groups: groupResult.groups,
      secondaryGroups: groupResult.secondaryGroups,
      compare: groupResult.compare,
      freshness: groupResult.freshness,
      warnings: groupResult.warnings,
      meta: {
        calculatedAt: now,
        metricVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
        organizationId,
        visibleProjectCount: groupResult.totalProjectCount ?? 0,
        primaryGroupCount: groupResult.primaryGroupCount ?? 0,
        secondaryGroupCount: groupResult.secondaryGroupCount ?? 0,
        truncated: groupResult.truncated ?? false,
      },
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * 将 Model 转换为 DTO。
   * 如果用户没有读取权限则返回 null（隐藏视图存在）。
   */
  private toDto(
    model: PmoGroupingViewModel,
    user: User,
    _organizationId: number,
  ): PmoGroupingViewDefinition | null {
    let queryDef: any
    try {
      queryDef =
        typeof model.queryDefinition === 'string'
          ? JSON.parse(model.queryDefinition)
          : model.queryDefinition
    } catch {
      queryDef = { primaryGrouping: 'status' }
    }

    const capabilities: PmoGroupingViewCapabilities = {
      canEdit:
        model.scope === PMO_GROUPING_VIEW_SCOPES.PERSONAL
          ? model.ownerUserId === Number(user.id)
          : false,
      canDelete:
        model.scope === PMO_GROUPING_VIEW_SCOPES.PERSONAL
          ? model.ownerUserId === Number(user.id)
          : false,
      canDuplicate: true,
      canSetDefault:
        model.scope === PMO_GROUPING_VIEW_SCOPES.PERSONAL && model.ownerUserId === Number(user.id),
      canSetOrgDefault: model.scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION,
      isReadonly: false,
    }

    return {
      id: model.viewId,
      scope: model.scope as PmoGroupingViewDefinition['scope'],
      organizationId: model.organizationId,
      ownerUserId: model.ownerUserId ?? undefined,
      name: model.name,
      description: model.description ?? undefined,
      definitionVersion: model.definitionVersion,
      query: queryDef,
      isDefault: model.isDefault === 1 || model.isOrgDefault === 1,
      capabilities,
      createdAt: model.createdAt.toISO()!,
      updatedAt: model.updatedAt.toISO()!,
    }
  }
}
