/**
 * CustomViewService —— 自定义视图资源语义服务（v2-custom-views-view-config）。
 *
 * 职责：
 * - 组织/项目隔离（所有查询强制 organization_id + project_id）
 * - 个人 vs 共享视图权限边界
 * - 共享视图复制为个人视图
 * - 个人视图排序更新
 * - 默认视图唯一性管理
 * - 配置版本校验与迁移
 * - 低敏审计写入（共享视图关键操作）
 */
import type { CreateCustomViewRequest, UpdateCustomViewRequest } from '@aiproj/types'
import CustomView from '#models/custom_view'
import Project from '#models/project'
import type User from '#models/user'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import AuditService, { AuditEvent } from '#services/audit_service'
import CustomViewPolicy from '#policies/custom_view_policy'
import type { AuthContext } from '#types/auth'
import { validateCustomViewConfig } from '#validators/custom_view_config_validator'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'

@inject()
export default class CustomViewService {
  constructor(
    private policy: CustomViewPolicy,
    private audit: AuditService,
  ) {}

  /**
   * 确保项目存在于指定组织下。
   * 跨组织访问返回 404（ResourceNotFoundException），防信息泄露。
   */
  private async projectExistsInOrg(organizationId: number, projectId: number): Promise<void> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) {
      throw new ResourceNotFoundException('项目不存在')
    }
  }

  private policyContext(user: User, requestContext: AuthContext) {
    return { ...requestContext, user }
  }

  private async auditCustomViewChange(
    user: User,
    requestContext: AuthContext,
    organizationId: number,
    projectId: number,
    viewId: number,
    operation: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.log({
      event: AuditEvent.CONFIG_CHANGED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'custom_view',
      entityId: viewId,
      requestId: requestContext.requestId ?? null,
      changes: {
        after: {
          operation,
          customViewId: viewId,
        },
      },
      metadata: {
        resource: 'custom_view',
        operation,
        ...metadata,
      },
    })
  }

  // ─── 列表 ─────────────────────────────────────────
  async list(
    user: User,
    _requestContext: AuthContext,
    organizationId: number,
    projectId: number,
  ): Promise<{ personal: CustomView[]; shared: CustomView[] }> {
    await this.projectExistsInOrg(organizationId, projectId)

    const [personal, shared] = await Promise.all([
      CustomView.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('owner_user_id', user.id)
        .where('visibility', 'personal')
        .whereNull('deleted_at')
        .orderBy('position', 'asc')
        .orderBy('id', 'asc'),
      CustomView.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('visibility', 'shared')
        .whereNull('deleted_at')
        .orderBy('position', 'asc')
        .orderBy('id', 'asc'),
    ])

    return { personal, shared }
  }

  // ─── 详情 ─────────────────────────────────────────
  async show(
    user: User,
    requestContext: AuthContext,
    organizationId: number,
    projectId: number,
    viewId: number,
  ): Promise<CustomView> {
    await this.projectExistsInOrg(organizationId, projectId)

    const view = await CustomView.query()
      .where('id', viewId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .first()

    if (!view) {
      throw new ResourceNotFoundException('自定义视图不存在')
    }

    // 权限：个人视图仅 owner；共享视图对项目成员可见
    const auth = this.policyContext(user, requestContext)
    if (view.visibility === 'personal') {
      await this.policy.authorizeViewPersonal(auth, view)
    } else {
      await this.policy.authorizeViewShared(auth, organizationId, projectId)
    }

    return view
  }

  // ─── 创建 ─────────────────────────────────────────
  async create(
    user: User,
    requestContext: AuthContext,
    organizationId: number,
    projectId: number,
    data: CreateCustomViewRequest,
  ): Promise<CustomView> {
    await this.projectExistsInOrg(organizationId, projectId)
    const auth = this.policyContext(user, requestContext)
    await this.policy.authorizeCreate(auth, organizationId, projectId, data.visibility)
    validateCustomViewConfig(data.config, data.baseViewType)

    const maxPosition = await CustomView.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('owner_user_id', user.id)
      .whereNull('deleted_at')
      .max('position as max_pos')
      .first()

    const position = (maxPosition?.$extras?.max_pos ?? -1) + 1

    const view = await CustomView.create({
      organizationId,
      projectId,
      ownerUserId: user.id,
      name: data.name,
      baseViewType: data.baseViewType,
      visibility: data.visibility,
      configJson: data.config,
      schemaVersion: 1,
      position,
      isDefault: false,
    })

    // 共享视图创建写审计
    if (data.visibility === 'shared') {
      await this.auditCustomViewChange(
        user,
        requestContext,
        organizationId,
        projectId,
        view.id,
        'shared_view_created',
        { baseViewType: data.baseViewType, visibility: data.visibility },
      )
    }

    return view
  }

  // ─── 更新 ─────────────────────────────────────────
  async update(
    user: User,
    requestContext: AuthContext,
    organizationId: number,
    projectId: number,
    viewId: number,
    data: UpdateCustomViewRequest,
  ): Promise<CustomView> {
    await this.projectExistsInOrg(organizationId, projectId)

    const view = await CustomView.query()
      .where('id', viewId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .first()

    if (!view) {
      throw new ResourceNotFoundException('自定义视图不存在')
    }

    const auth = this.policyContext(user, requestContext)
    await this.policy.authorizeManage(auth, view)

    const oldName = view.name
    const oldVisibility = view.visibility

    if (data.name !== undefined) view.name = data.name
    if (data.config !== undefined) {
      validateCustomViewConfig(data.config, view.baseViewType)
      view.configJson = data.config
      view.schemaVersion = data.config.schemaVersion
    }
    if (data.visibility !== undefined) {
      view.visibility = data.visibility
    }

    await view.save()

    // 共享视图更新写审计
    if (view.visibility === 'shared' || oldVisibility === 'shared') {
      await this.auditCustomViewChange(
        user,
        requestContext,
        organizationId,
        projectId,
        view.id,
        'shared_view_updated',
        {
          beforeName: oldName,
          afterName: view.name,
          beforeVisibility: oldVisibility,
          afterVisibility: view.visibility,
        },
      )
    }

    return view
  }

  // ─── 删除 ─────────────────────────────────────────
  async destroy(
    user: User,
    requestContext: AuthContext,
    organizationId: number,
    projectId: number,
    viewId: number,
  ): Promise<void> {
    await this.projectExistsInOrg(organizationId, projectId)

    const view = await CustomView.query()
      .where('id', viewId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .first()

    if (!view) {
      throw new ResourceNotFoundException('自定义视图不存在')
    }

    const auth = this.policyContext(user, requestContext)
    await this.policy.authorizeManage(auth, view)

    const wasShared = view.visibility === 'shared'
    const viewName = view.name

    // 事务：软删除
    await db.transaction(async (trx) => {
      view.useTransaction(trx)
      view.deletedAt = DateTime.now()
      await view.save()
    })

    // 共享视图删除写审计
    if (wasShared) {
      await this.auditCustomViewChange(
        user,
        requestContext,
        organizationId,
        projectId,
        viewId,
        'shared_view_deleted',
        { name: viewName },
      )
    }
  }

  // ─── 复制共享视图为个人视图 ───────────────────────
  async clone(
    user: User,
    requestContext: AuthContext,
    organizationId: number,
    projectId: number,
    viewId: number,
    newName?: string,
  ): Promise<CustomView> {
    await this.projectExistsInOrg(organizationId, projectId)

    const source = await CustomView.query()
      .where('id', viewId)
      .where('project_id', projectId)
      .where('visibility', 'shared')
      .whereNull('deleted_at')
      .first()

    if (!source) {
      throw new ResourceNotFoundException('源共享视图不存在')
    }

    // 普通成员可复制共享视图
    const auth = this.policyContext(user, requestContext)
    await this.policy.authorizeViewShared(auth, organizationId, projectId)

    const maxPosition = await CustomView.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('owner_user_id', user.id)
      .whereNull('deleted_at')
      .max('position as max_pos')
      .first()

    const position = (maxPosition?.$extras?.max_pos ?? -1) + 1

    const cloned = await CustomView.create({
      organizationId,
      projectId,
      ownerUserId: user.id,
      name: newName || `${source.name} (副本)`,
      baseViewType: source.baseViewType,
      visibility: 'personal',
      configJson: source.configJson,
      schemaVersion: source.schemaVersion,
      position,
      isDefault: false,
    })

    // 复制写审计
    await this.auditCustomViewChange(
      user,
      requestContext,
      organizationId,
      projectId,
      viewId,
      'shared_view_cloned',
      { clonedViewId: cloned.id },
    )

    return cloned
  }

  // ─── 排序更新 ─────────────────────────────────────
  async reorder(
    user: User,
    _requestContext: AuthContext,
    organizationId: number,
    projectId: number,
    viewIds: number[],
  ): Promise<void> {
    await this.projectExistsInOrg(organizationId, projectId)

    // 校验所有排序目标属于当前用户、当前项目和当前组织
    const views = await CustomView.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('owner_user_id', user.id)
      .whereIn('id', viewIds)
      .whereNull('deleted_at')

    if (views.length !== viewIds.length) {
      throw new ValidationException('部分排序目标不属于当前用户或不存在')
    }

    await db.transaction(async (trx) => {
      for (const [i, viewId] of viewIds.entries()) {
        const view = await CustomView.query({ client: trx }).where('id', viewId).first()
        if (view) {
          view.useTransaction(trx)
          view.position = i
          await view.save()
        }
      }
    })
  }

  // ─── 设默认视图 ───────────────────────────────────
  async setDefault(
    user: User,
    requestContext: AuthContext,
    organizationId: number,
    projectId: number,
    viewId: number,
  ): Promise<void> {
    await this.projectExistsInOrg(organizationId, projectId)

    const view = await CustomView.query()
      .where('id', viewId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .first()

    if (!view) {
      throw new ResourceNotFoundException('自定义视图不存在')
    }

    // 只能设自己可见的视图为默认
    const auth = this.policyContext(user, requestContext)
    if (view.visibility === 'personal') {
      await this.policy.authorizeViewPersonal(auth, view)
    } else {
      await this.policy.authorizeViewShared(auth, organizationId, projectId)
    }

    await db.transaction(async (trx) => {
      // 清除该用户在该项目的所有默认视图标记
      await CustomView.query({ client: trx })
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('owner_user_id', user.id)
        .where('is_default', true)
        .update({ isDefault: false })

      // 设置新默认
      view.useTransaction(trx)
      view.isDefault = true
      await view.save()
    })

    if (view.visibility === 'shared') {
      await this.auditCustomViewChange(
        user,
        requestContext,
        organizationId,
        projectId,
        view.id,
        'shared_view_set_default',
        { baseViewType: view.baseViewType },
      )
    }
  }

  // ─── 获取用户默认视图 ─────────────────────────────
  async getUserDefaultView(
    organizationId: number,
    projectId: number,
    userId: number,
  ): Promise<CustomView | null> {
    return CustomView.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('owner_user_id', userId)
      .where('is_default', true)
      .whereNull('deleted_at')
      .first()
  }

  // ─── 获取项目的共享视图入口（导航栏用） ──────────
  async listSharedViewEntries(organizationId: number, projectId: number): Promise<CustomView[]> {
    return CustomView.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('visibility', 'shared')
      .whereNull('deleted_at')
      .orderBy('position', 'asc')
      .orderBy('id', 'asc')
  }

  // ─── 获取用户个人视图入口（导航栏用） ──────────
  async listPersonalViewEntries(
    organizationId: number,
    projectId: number,
    userId: number,
  ): Promise<CustomView[]> {
    return CustomView.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('owner_user_id', userId)
      .where('visibility', 'personal')
      .whereNull('deleted_at')
      .orderBy('position', 'asc')
      .orderBy('id', 'asc')
  }
}
