import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { DIAGRAM_MANAGE, PROJECT_VIEW, type Permission } from '#rbac'

/**
 * v3-triz-contradiction-copilot 任务 4.1 —— 分馆产物的 RBAC 策略（design D17 ③）。
 *
 * 裁定（0.2 三件裁定第 3 项，已核实落档）：
 * - **读取** = `project:view`（spec「分馆产物的持久化与权限」第 3 条 + 第 5 条）；
 * - **写入**（新建 / 更新 / 删除）= 既有 `diagram:manage`，**不新增权限码、不做 RBAC 迁移**。
 *   复核：`start/rbac/roles.ts` 的 `ROLE_PERMISSIONS` 中 `DIAGRAM_MANAGE` 仅出现在 `org_admin`
 *   与 `project_manager`，普通成员只有 `DIAGRAM_VIEW`；`SYSTEM_ADMIN` 由哨兵 `system:admin` +
 *   本策略的 `user.isSuperAdmin` 短路放行（与 `DiagramPolicy.allows` 同款口径）。
 *
 * 调用签名与既有 `DiagramPolicy` 完全一致的三元组 `(user, organizationId, projectId)`，
 * 经 `RbacService.check` 解析组织 / 项目级角色：跨组织项目返回 `cross_org_denied` ——
 * 调用方**必须**据此回 404 `RESOURCE_NOT_FOUND` 而非 403（RL-05，不泄露存在性）。
 *
 * 策略只判定与解析，不碰数据（产物存在性断言在服务层，同样回 404）。
 */
export interface TrizGalleryArtifactPolicyDecision {
  allowed: boolean
  /** 判定服务给出的原因（`cross_org_denied` / `permission_not_granted` / …） */
  reason: string | null
  missingPermission: Permission | null
}

@inject()
export default class TrizGalleryArtifactPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 读取（列表 / 详情 / 版本历史）：`project:view`。 */
  async authorizeView(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<TrizGalleryArtifactPolicyDecision> {
    return this.#allows(PROJECT_VIEW, user, organizationId, projectId)
  }

  /** 写入（创建 / 更新 / 删除）：既有 `diagram:manage`（PM / OrgAdmin 已覆盖）。 */
  async authorizeManage(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<TrizGalleryArtifactPolicyDecision> {
    return this.#allows(DIAGRAM_MANAGE, user, organizationId, projectId)
  }

  async #allows(
    permission: Permission,
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<TrizGalleryArtifactPolicyDecision> {
    if (user.isSuperAdmin) return { allowed: true, reason: null, missingPermission: null }
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    if (result.allowed) return { allowed: true, reason: null, missingPermission: null }
    return {
      allowed: false,
      reason: result.reason ?? 'permission_not_granted',
      missingPermission: permission,
    }
  }
}
