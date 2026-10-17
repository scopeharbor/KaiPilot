import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import type User from '#models/user'
import {
  AI_CONNECTION_MANAGE,
  CanonicalRole,
  canonicalRoleFromOrganizationRole,
  canonicalRoleFromProjectRole,
  ENTERPRISE_PERMISSIONS,
  getRolePermissionSet,
  mergeProjectScopedPermissions,
  OrganizationMemberRole,
  type Permission,
  ProjectRoleName,
  SYSTEM_ADMIN,
} from '#rbac'
import type { PermissionCheckResult } from '#types/auth'
import { editionHooks } from '#services/edition/edition_registry'

/**
 * 套餐门控使用的企业权限集合（仅阻止集合运算时的重复构造）。
 */
const ENTERPRISE_PERMISSION_SET: ReadonlySet<Permission> = new Set(ENTERPRISE_PERMISSIONS)

/**
 * RBAC 服务：按 sec11 判定链计算用户在指定 scope 下的有效权限。
 *
 * 判定链（design D5）：
 * 1. 系统管理员直接放行；
 * 2. 分别取组织级与项目级的规范角色→权限集；
 * 3. 若两级同时适用，取交集（最小权限）；
 * 4. 默认拒绝。
 */
export default class RbacService {
  /**
   * 同一实例内的短时记忆：批量任务接口会对每个任务各做两轮完整判定（编辑 + 指派），
   * 每轮 8~10 次查询；远端库往返 100~200ms 时 1 个任务要 1 秒多。按 (方法, 参数) 记住
   * 查询 Promise 2 秒，实例通常随请求创建；若被常驻服务持有，角色变更最多延迟 2 秒生效。
   */
  private readonly memoTtlMs = 2_000
  private readonly memoStore = new Map<string, { at: number; value: Promise<unknown> }>()

  private memoEnabled = false

  /**
   * 仅对当前请求内的批量判定开启短时记忆（批量任务接口调用）。默认关闭：
   * 同一请求内先改角色 / 开关再判定的场景必须读到最新值。
   */
  enableRequestMemo(): this {
    this.memoEnabled = true
    return this
  }

  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.memoEnabled) return load()
    const now = Date.now()
    const hit = this.memoStore.get(key)
    if (hit && now - hit.at < this.memoTtlMs) return hit.value as Promise<T>
    const value = load()
    this.memoStore.set(key, { at: now, value })
    value.catch(() => this.memoStore.delete(key))
    return value
  }

  /**
   * 检查用户是否具备指定权限。
   *
   * @param user 当前用户
   * @param permission 权限标识串
   * @param organizationId 当前组织
   * @param projectId 目标项目（可选）
   */
  async check(
    user: User,
    permission: Permission,
    organizationId: number,
    projectId?: number,
  ): Promise<PermissionCheckResult> {
    if (user.isSuperAdmin) {
      return { allowed: true, reason: 'system_admin' }
    }

    const orgPermissions = await this.resolveOrganizationPermissions(user, organizationId)
    const projectBelongsToOrg = projectId
      ? await this.projectExistsInOrg(projectId, organizationId)
      : false

    if (projectId && !projectBelongsToOrg) {
      return { allowed: false, reason: 'cross_org_denied' }
    }

    if (
      projectId &&
      orgPermissions.has(permission) &&
      (await this.isOrgAdmin(user, organizationId))
    ) {
      return { allowed: true, reason: 'organization_admin_project' }
    }

    const projectPermissions = projectId
      ? await this.resolveProjectPermissions(user, projectId)
      : null

    // 若存在项目 scope，取组织级与项目级的交集；否则只看组织级
    let allowed: boolean
    let reason: string | undefined

    if (projectPermissions) {
      // 若用户无组织角色，仅在校验项目归属该组织后使用项目权限
      if (orgPermissions.size === 0) {
        allowed = projectPermissions.has(permission)
        reason = allowed ? 'project_only' : undefined
      } else {
        const orgRole = await this.resolveOrganizationRole(user, organizationId)
        allowed = mergeProjectScopedPermissions(orgRole, orgPermissions, projectPermissions).has(
          permission,
        )
        reason = allowed ? 'organization ∩ project (+项目角色下放)' : undefined
      }
    } else {
      allowed = orgPermissions.has(permission)
      reason = allowed ? 'organization' : undefined
    }

    if (!allowed) {
      return { allowed: false, reason: 'permission_not_granted' }
    }

    return { allowed: true, reason }
  }

  /**
   * 收集用户在某组织下的所有权限（规范角色解析后的权限集）。
   *
   * 套餐权益门控（plan policy）：组织 `planTier === 'free'` 时，从**任何来源**
   * （owner 的 ORG_ADMIN 角色集、成员角色集、`organization_members.permissions`
   * 显式权限）解析出的权限中剥离 `ENTERPRISE_PERMISSIONS`——free 个人组织
   * 不授予 SSO/KMS/DLP/水印/合规/多租户/AI 质量成本/发布信任/插件目录等企业能力。
   * `system_admin` 哨兵在 `resolveUserPermissions` 先行放行，不受套餐影响。
   */
  async resolveOrganizationPermissions(
    user: User,
    organizationId: number,
  ): Promise<Set<Permission>> {
    return this.memo(`orgPerms:${user.id}:${organizationId}`, () =>
      this.resolveOrganizationPermissionsUncached(user, organizationId),
    )
  }

  private async resolveOrganizationPermissionsUncached(
    user: User,
    organizationId: number,
  ): Promise<Set<Permission>> {
    const org = await Organization.find(organizationId)
    if (!org) {
      return new Set()
    }

    let permissions: Set<Permission>

    if (org.ownerId === user.id) {
      permissions = getRolePermissionSet(CanonicalRole.ORG_ADMIN)
    } else {
      const member = await OrganizationMember.query()
        .where('user_id', user.id)
        .where('organization_id', organizationId)
        .first()

      if (!member) {
        return new Set()
      }

      const role = canonicalRoleFromOrganizationRole(member.role)
      if (!role) {
        return new Set()
      }

      permissions = getRolePermissionSet(role)

      // 合并 organization_members.permissions 中的额外显式权限（若存在）
      if (Array.isArray(member.permissions)) {
        const extra = member.permissions as Permission[]
        permissions = new Set([...permissions, ...extra])
      }
    }

    // 套餐权益门控：free 组织不授企业能力（对角色集与显式权限一并生效）。
    if (org.planTier === 'free') {
      permissions = new Set([...permissions].filter((p) => !ENTERPRISE_PERMISSION_SET.has(p)))
      // 平台统一 AI 配置（私有部署的版本扩展点）：free 组织默认不自行管理 AI 连接，由平台
      // 管理员按账号开启（users.allow_self_ai_config，见 `platform_ai_scope.ts`）。
      // 开源个人版没有平台统一配置，使用者自带 AI Key，不剥离该权限。
      if (editionHooks().platformAi && !user.allowSelfAiConfig) {
        permissions.delete(AI_CONNECTION_MANAGE)
      }
    }

    return permissions
  }

  /**
   * 用户在组织中的规范角色（所有者视为 ORG_ADMIN）；非成员返回 null。
   */
  async resolveOrganizationRole(user: User, organizationId: number): Promise<CanonicalRole | null> {
    return this.memo(`orgRole:${user.id}:${organizationId}`, () =>
      this.resolveOrganizationRoleUncached(user, organizationId),
    )
  }

  private async resolveOrganizationRoleUncached(
    user: User,
    organizationId: number,
  ): Promise<CanonicalRole | null> {
    const org = await Organization.find(organizationId)
    if (!org) return null
    if (Number(org.ownerId) === Number(user.id)) return CanonicalRole.ORG_ADMIN
    const member = await OrganizationMember.query()
      .where('user_id', user.id)
      .where('organization_id', organizationId)
      .first()
    return member ? canonicalRoleFromOrganizationRole(member.role) : null
  }

  /**
   * 收集用户在某项目下的所有权限。
   */
  async resolveProjectPermissions(user: User, projectId: number): Promise<Set<Permission>> {
    return this.memo(`projPerms:${user.id}:${projectId}`, () =>
      this.resolveProjectPermissionsUncached(user, projectId),
    )
  }

  private async resolveProjectPermissionsUncached(
    user: User,
    projectId: number,
  ): Promise<Set<Permission>> {
    const project = await Project.query().where('id', projectId).whereNull('deleted_at').first()
    if (!project) {
      return new Set()
    }

    // 项目创建者默认拥有 Owner 权限
    if (Number(project.createdBy) === Number(user.id)) {
      return getRolePermissionSet(CanonicalRole.PROJECT_MANAGER)
    }

    const membership = await ProjectMember.query()
      .where('user_id', user.id)
      .where('project_id', projectId)
      .where('is_active', true)
      .preload('projectRole')
      .first()

    if (!membership || !membership.projectRole) {
      return new Set()
    }

    const roleName = membership.projectRole.name

    // Owner 与项目经理使用同一权限集
    if (roleName === ProjectRoleName.OWNER || roleName === ProjectRoleName.PROJECT_MANAGER) {
      return getRolePermissionSet(CanonicalRole.PROJECT_MANAGER)
    }

    const role = canonicalRoleFromProjectRole(roleName)
    if (!role) {
      return new Set()
    }

    let permissions = getRolePermissionSet(role)

    // 合并 project_role.permissions 中的额外显式权限
    if (Array.isArray(membership.projectRole.permissions)) {
      const extra = membership.projectRole.permissions as Permission[]
      permissions = new Set([...permissions, ...extra])
    }

    return permissions
  }

  /**
   * 计算用户在某组织+可选项目下的全部权限（用于 JWT claims）。
   */
  async resolveUserPermissions(
    user: User,
    organizationId: number | null,
    projectId?: number,
  ): Promise<Permission[]> {
    if (user.isSuperAdmin) {
      return [SYSTEM_ADMIN]
    }
    if (organizationId === null) {
      return []
    }

    const orgPermissions = await this.resolveOrganizationPermissions(user, organizationId)
    // 与 check() 一致：组织管理员在本组织项目内按组织权限放行
    if (projectId && (await this.isOrgAdmin(user, organizationId))) {
      return Array.from(orgPermissions)
    }
    const projectPermissions = projectId
      ? await this.resolveProjectPermissions(user, projectId)
      : null

    const merged = projectPermissions
      ? mergeProjectScopedPermissions(
          await this.resolveOrganizationRole(user, organizationId),
          orgPermissions,
          projectPermissions,
        )
      : orgPermissions

    return Array.from(merged)
  }

  /**
   * 判断用户在目标组织中是否为组织管理员。
   */
  async isOrgAdmin(user: User, organizationId: number): Promise<boolean> {
    return this.memo(`orgAdmin:${user.id}:${organizationId}`, () =>
      this.isOrgAdminUncached(user, organizationId),
    )
  }

  private async isOrgAdminUncached(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const org = await Organization.find(organizationId)
    if (org?.ownerId === user.id) return true

    const member = await OrganizationMember.query()
      .where('user_id', user.id)
      .where('organization_id', organizationId)
      .first()

    return (
      member?.role === OrganizationMemberRole.OWNER || member?.role === OrganizationMemberRole.ADMIN
    )
  }

  /**
   * 判断用户是否为某项目的项目经理（或 Owner）。
   */
  async isProjectManager(user: User, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const project = await Project.find(projectId)
    if (project?.createdBy === user.id) return true

    const membership = await ProjectMember.query()
      .where('user_id', user.id)
      .where('project_id', projectId)
      .where('is_active', true)
      .preload('projectRole')
      .first()

    if (!membership?.projectRole) return false
    const name = membership.projectRole.name
    return name === ProjectRoleName.PROJECT_MANAGER || name === ProjectRoleName.OWNER
  }

  /**
   * 判断项目是否属于指定组织且未软删除。
   *
   * 用于跨组织 404 隔离（design D7）：RBAC denied 后区分「同组织非成员(403)」
   * 与「跨组织/不存在(404，不泄露存在性)」。
   */
  async projectExistsInOrg(projectId: number, organizationId: number): Promise<boolean> {
    return this.memo(`projInOrg:${projectId}:${organizationId}`, () =>
      this.projectExistsInOrgUncached(projectId, organizationId),
    )
  }

  private async projectExistsInOrgUncached(
    projectId: number,
    organizationId: number,
  ): Promise<boolean> {
    const row = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    return !!row
  }
}
