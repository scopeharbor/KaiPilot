import type User from '#models/user'
import OrganizationDashboardLayout from '#models/organization_dashboard_layout'
// DI 依賴必須值 import：`import type` 会让 design:paramtypes 退化成 Object，
// 容器无法解析（Cannot inject "[Function: Object]"）。
import AuditService from '#services/audit_service'
import OrganizationDashboardLayoutPolicy from '#policies/organization_dashboard_layout_policy'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_SCOPES,
  ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES,
  ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT,
  type OrganizationDashboardLayout as LayoutDto,
  type OrganizationDashboardLayoutPayload,
  type OrganizationDashboardLayoutPreviewResult,
  type OrganizationDashboardLayoutPreviewWarning,
  type OrganizationDashboardLayoutScope,
  type OrganizationDashboardLayoutDensity,
} from '@aiproj/types'
import { validateModulesAgainstRegistry } from '#validators/organization_dashboard_layout'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'

/**
 * OrganizationDashboardLayoutService —— 组织 Dashboard 布局编排服务（v3-organization-dashboard-layout-builder §3.3）。
 *
 * 职责：布局 CRUD、默认策略、版本校验、预览、模块权限校验、审计。
 * 约束：
 *   - 系统默认布局不可变，来自代码常量。
 *   - 个人布局按 actor+organization 作用域保存。
 *   - 共享布局只有授权角色可管理。
 *   - version 字段用于乐观锁。
 *   - 预览无副作用，保存才审计。
 *
 * 审计事件：由于新增事件可能尚未合并进 AuditEvent 常量，
 * 本服务直接使用 `audit.log()` 的字符串 event 名，避免编译阻塞。
 */
@inject()
export default class OrganizationDashboardLayoutService {
  constructor(
    private readonly policy: OrganizationDashboardLayoutPolicy,
    private readonly audit: AuditService,
  ) {}

  // ─── 系统默认布局 ────────────────────────────────────────────────────────────

  /** 获取系统默认布局（不可变，来自代码常量）。 */
  getSystemDefault(organizationId: number): LayoutDto {
    return {
      layoutId: 0,
      ...ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT,
      organizationId,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
  }

  // ─── 列表与当前布局选择 ──────────────────────────────────────────────────────

  /** 获取组织的所有布局（系统默认 + 个人 + 共享）。 */
  async list(user: User, organizationId: number): Promise<{ data: LayoutDto[]; total: number }> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const personal = await OrganizationDashboardLayout.query()
      .where('organization_id', organizationId)
      .where('scope', ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.PERSONAL)
      .where('owner_actor_id', user.id)
      .orderBy('updated_at', 'desc')

    const shared = await OrganizationDashboardLayout.query()
      .where('organization_id', organizationId)
      .where('scope', ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SHARED)
      .orderBy('is_default', 'desc')
      .orderBy('updated_at', 'desc')

    const all = [
      this.getSystemDefault(organizationId),
      ...personal.map((m) => this.toDto(m)),
      ...shared.map((m) => this.toDto(m)),
    ]

    return { data: all, total: all.length }
  }

  /** 获取当前布局——优先级：个人默认 > 组织共享默认 > 系统默认。 */
  async getCurrent(
    user: User,
    organizationId: number,
  ): Promise<{ layout: LayoutDto; warnings: OrganizationDashboardLayoutPreviewWarning[] }> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const warnings: OrganizationDashboardLayoutPreviewWarning[] = []

    // 1. 个人默认布局
    const personalDefault = await OrganizationDashboardLayout.query()
      .where('organization_id', organizationId)
      .where('scope', ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.PERSONAL)
      .where('owner_actor_id', user.id)
      .where('is_default', 1)
      .first()

    if (personalDefault) {
      return this.toCurrentResponse(personalDefault, user, warnings)
    }

    // 2. 组织共享默认布局
    const sharedDefault = await OrganizationDashboardLayout.query()
      .where('organization_id', organizationId)
      .where('scope', ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SHARED)
      .where('is_default', 1)
      .first()

    if (sharedDefault) {
      return this.toCurrentResponse(sharedDefault, user, warnings)
    }

    // 3. 系统默认布局
    warnings.push({
      code: ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_NOT_FOUND,
      message: '未找到自定义布局，使用系统默认布局',
    })
    return {
      layout: this.getSystemDefault(organizationId),
      warnings,
    }
  }

  // ─── 预览 ────────────────────────────────────────────────────────────────────

  /** 预览布局（无副作用——不落库、不审计写入）。 */
  async preview(
    user: User,
    organizationId: number,
    payload: OrganizationDashboardLayoutPayload,
  ): Promise<OrganizationDashboardLayoutPreviewResult> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const registryErrors = validateModulesAgainstRegistry(payload.modules)
    if (registryErrors.length > 0) {
      return {
        valid: false,
        layout: payload,
        warnings: registryErrors.map((msg) => ({
          code: ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_MODULE_UNAVAILABLE,
          message: msg,
        })),
        breakpointSnapshots: [],
      }
    }

    const permissionWarnings: OrganizationDashboardLayoutPreviewWarning[] = []
    for (const mod of payload.modules) {
      const canView = await this.policy.checkModulePermission(user, organizationId, mod.moduleKey)
      if (!canView) {
        permissionWarnings.push({
          code: ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_MODULE_FORBIDDEN,
          message: `模块 "${mod.moduleKey}" 当前角色无查看权限，渲染时将脱敏或隐藏`,
          moduleKey: mod.moduleKey,
        })
      }
    }

    // 低敏 read audit——preview 是可选的读 trace
    void this.audit.log({
      event: 'ORG_DASHBOARD_LAYOUT_PREVIEWED' as any,
      severity: 'info',
      userId: user.id,
      organizationId,
      entityType: 'organization_dashboard_layout',
    })

    return {
      valid: true,
      layout: payload,
      warnings: permissionWarnings,
      breakpointSnapshots: [],
    }
  }

  // ─── 创建/更新 ───────────────────────────────────────────────────────────────

  /** 创建或更新个人布局。 */
  async savePersonal(
    user: User,
    organizationId: number,
    payload: OrganizationDashboardLayoutPayload,
  ): Promise<LayoutDto> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizePersonalWrite(user, organizationId)

    return this.upsertLayout(
      user.id,
      organizationId,
      ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.PERSONAL,
      user.id,
      payload,
    )
  }

  /** 创建或更新组织共享布局。 */
  async saveShared(
    user: User,
    organizationId: number,
    payload: OrganizationDashboardLayoutPayload,
  ): Promise<LayoutDto> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeSharedWrite(user, organizationId)

    return this.upsertLayout(
      user.id,
      organizationId,
      ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SHARED,
      null,
      payload,
    )
  }

  // ─── 复制 ────────────────────────────────────────────────────────────────────

  /** 复制布局为个人或共享。 */
  async copy(
    user: User,
    organizationId: number,
    layoutId: number,
    targetScope: OrganizationDashboardLayoutScope,
    name?: string,
  ): Promise<LayoutDto> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    if (targetScope === ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SHARED) {
      await this.policy.authorizeSharedWrite(user, organizationId)
    }

    const source = await this.findLayoutOrFail(organizationId, layoutId)
    const payload: OrganizationDashboardLayoutPayload = {
      name: name ?? `${source.name ?? '复制布局'} (副本)`,
      density: source.density as OrganizationDashboardLayoutDensity,
      modules: source.modulesJson,
    }

    void this.audit.log({
      event: 'ORG_DASHBOARD_LAYOUT_COPIED' as any,
      severity: 'info',
      userId: user.id,
      organizationId,
      entityType: 'organization_dashboard_layout',
      entityId: layoutId,
      metadata: { targetScope, sourceId: layoutId },
    })

    return this.upsertLayout(user.id, organizationId, targetScope, user.id, payload)
  }

  // ─── 设为默认 ────────────────────────────────────────────────────────────────

  /** 将布局设为默认。 */
  async setDefault(
    user: User,
    organizationId: number,
    layoutId: number,
    expectedVersion?: number,
  ): Promise<LayoutDto> {
    await this.policy.assertOrganizationVisible(user, organizationId)

    const layout = await this.findLayoutOrFail(organizationId, layoutId)

    if (layout.scope === ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SHARED) {
      await this.policy.authorizeSharedWrite(user, organizationId)
    } else {
      // 只能设置自己的个人布局为默认
      if (layout.ownerActorId !== user.id && !user.isSuperAdmin) {
        throw new ResourceNotFoundException('布局不存在')
      }
    }

    if (expectedVersion !== undefined && layout.version !== expectedVersion) {
      throw new ValidationException('布局版本冲突，请刷新后重试', {
        code: 'LAYOUT_VERSION_CONFLICT',
      })
    }

    const ownerActorId = layout.ownerActorId
    // 清除同作用域下其他默认布局
    await OrganizationDashboardLayout.query()
      .where('organization_id', organizationId)
      .where('scope', layout.scope)
      .where('owner_actor_id', ownerActorId as any)
      .where('is_default', 1)
      .update({ is_default: 0 })

    layout.isDefault = 1
    layout.version += 1
    await layout.save()

    void this.audit.log({
      event: 'ORG_DASHBOARD_LAYOUT_DEFAULT_SET' as any,
      severity: 'info',
      userId: user.id,
      organizationId,
      entityType: 'organization_dashboard_layout',
      entityId: layout.id,
    })

    return this.toDto(layout)
  }

  // ─── 重置 ────────────────────────────────────────────────────────────────────

  /** 重置为系统默认（删除自定义布局，仅对个人作用域有效）。 */
  async reset(user: User, organizationId: number): Promise<LayoutDto> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizePersonalWrite(user, organizationId)

    const existing = await OrganizationDashboardLayout.query()
      .where('organization_id', organizationId)
      .where('scope', ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.PERSONAL)
      .where('owner_actor_id', user.id)

    for (const layout of existing) {
      await layout.delete()
    }

    void this.audit.log({
      event: 'ORG_DASHBOARD_LAYOUT_RESET' as any,
      severity: 'info',
      userId: user.id,
      organizationId,
      entityType: 'organization_dashboard_layout',
    })

    return this.getSystemDefault(organizationId)
  }

  // ─── 删除 ────────────────────────────────────────────────────────────────────

  /** 删除布局。 */
  async delete(user: User, organizationId: number, layoutId: number): Promise<void> {
    await this.policy.assertOrganizationVisible(user, organizationId)

    const layout = await this.findLayoutOrFail(organizationId, layoutId)

    if (layout.scope === ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SHARED) {
      await this.policy.authorizeSharedWrite(user, organizationId)
    } else if (layout.scope === ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.PERSONAL) {
      if (layout.ownerActorId !== user.id && !user.isSuperAdmin) {
        throw new ResourceNotFoundException('布局不存在')
      }
    } else {
      throw new ResourceNotFoundException('系统默认布局不可删除')
    }

    await layout.delete()

    void this.audit.log({
      event: 'ORG_DASHBOARD_LAYOUT_DELETED' as any,
      severity: 'info',
      userId: user.id,
      organizationId,
      entityType: 'organization_dashboard_layout',
      entityId: layoutId,
    })
  }

  // ─── 获取详情 ────────────────────────────────────────────────────────────────

  /** 获取单个布局详情。 */
  async getById(user: User, organizationId: number, layoutId: number): Promise<LayoutDto> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    if (layoutId === 0) {
      return this.getSystemDefault(organizationId)
    }

    const layout = await this.findLayoutOrFail(organizationId, layoutId)
    return this.toDto(layout)
  }

  // ─── 内部方法 ────────────────────────────────────────────────────────────────

  private async upsertLayout(
    actorId: number,
    organizationId: number,
    scope: OrganizationDashboardLayoutScope,
    ownerActorId: number | null,
    payload: OrganizationDashboardLayoutPayload,
  ): Promise<LayoutDto> {
    // 校验模块是否在注册表中
    const registryErrors = validateModulesAgainstRegistry(payload.modules)
    if (registryErrors.length > 0) {
      throw new ValidationException(`模块校验失败：${registryErrors.join('；')}`, {
        code: 'LAYOUT_MODULE_UNAVAILABLE',
      })
    }

    const isUpdate = payload.expectedVersion !== undefined
    let layout: OrganizationDashboardLayout | null = null

    if (isUpdate) {
      // 查找同作用域下的布局
      const q = OrganizationDashboardLayout.query()
        .where('organization_id', organizationId)
        .where('scope', scope)
        .where('is_default', 1)

      if (ownerActorId !== null) {
        q.where('owner_actor_id', ownerActorId)
      } else {
        q.whereNull('owner_actor_id')
      }

      layout = await q.first()

      if (!layout) {
        throw new ResourceNotFoundException('未找到可更新的布局，请使用创建操作')
      }

      if (layout.version !== payload.expectedVersion) {
        throw new ValidationException('布局版本冲突，请刷新后重试', {
          code: 'LAYOUT_VERSION_CONFLICT',
        })
      }
    } else {
      // 创建新布局——先取消同作用域下的其他默认标记
      const updateQ = OrganizationDashboardLayout.query()
        .where('organization_id', organizationId)
        .where('scope', scope)
        .where('is_default', 1)

      if (ownerActorId !== null) {
        updateQ.where('owner_actor_id', ownerActorId)
      } else {
        updateQ.whereNull('owner_actor_id')
      }

      await updateQ.update({ is_default: 0 })

      layout = new OrganizationDashboardLayout()
      layout.organizationId = organizationId
      layout.scope = scope
      layout.ownerActorId = ownerActorId
      layout.version = 1
      layout.isDefault = 1
    }

    layout.name = payload.name ?? layout.name
    layout.density = payload.density ?? layout.density
    layout.modulesJson = payload.modules
    layout.version += 1
    await layout.save()

    const eventType = isUpdate ? 'ORG_DASHBOARD_LAYOUT_UPDATED' : 'ORG_DASHBOARD_LAYOUT_CREATED'

    void this.audit.log({
      event: eventType as any,
      severity: 'info',
      userId: actorId,
      organizationId,
      entityType: 'organization_dashboard_layout',
      entityId: layout.id,
      metadata: {
        scope,
        version: layout.version,
        moduleCount: payload.modules.length,
      },
    })

    return this.toDto(layout)
  }

  private async findLayoutOrFail(
    organizationId: number,
    layoutId: number,
  ): Promise<OrganizationDashboardLayout> {
    const layout = await OrganizationDashboardLayout.query()
      .where('id', layoutId)
      .where('organization_id', organizationId)
      .first()

    if (!layout) {
      throw new ResourceNotFoundException('布局不存在')
    }
    return layout
  }

  private toDto(model: OrganizationDashboardLayout): LayoutDto {
    return {
      layoutId: model.id,
      organizationId: model.organizationId,
      scope: model.scope,
      ownerActorId: model.ownerActorId,
      name: model.name,
      version: model.version,
      isDefault: model.isDefault === 1,
      density: model.density as OrganizationDashboardLayoutDensity,
      modules: model.modulesJson,
      createdAt: model.createdAt.toISO()!,
      updatedAt: model.updatedAt.toISO()!,
    }
  }

  private async toCurrentResponse(
    model: OrganizationDashboardLayout,
    user: User,
    existingWarnings: OrganizationDashboardLayoutPreviewWarning[],
  ): Promise<{ layout: LayoutDto; warnings: OrganizationDashboardLayoutPreviewWarning[] }> {
    const warnings = [...existingWarnings]
    for (const mod of model.modulesJson) {
      const canView = await this.policy.checkModulePermission(
        user,
        model.organizationId,
        mod.moduleKey,
      )
      if (!canView) {
        warnings.push({
          code: ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES.LAYOUT_MODULE_FORBIDDEN,
          message: `模块 "${mod.moduleKey}" 当前角色无查看权限`,
          moduleKey: mod.moduleKey,
        })
      }
    }
    return { layout: this.toDto(model), warnings }
  }
}
