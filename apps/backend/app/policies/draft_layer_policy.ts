/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerPolicy（task 9.3）。
 *
 *   - 创建草案会话（handoff）：需 `ai:trigger`；
 *   - 预览/查看/决策/dry-run：需 `ai:view` 或继承项目级权限；
 *   - apply/丢弃：需 `ai:confirm` **且** `project:create`；
 *   组织隔离与跨组织不可见由 Controller 的 forOrganization + RESOURCE_NOT_FOUND 兜底。
 */
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_TRIGGER, AI_CONFIRM, PROJECT_CREATE, PROJECT_VIEW } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class DraftLayerPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 创建草案会话（从 Compiler Run handoff）。 */
  async canCreate(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, AI_TRIGGER, organizationId)
    return result.allowed
  }

  /** 查看/预览/diff/决策。 */
  async canView(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PROJECT_VIEW, organizationId)
    return result.allowed
  }

  /** dry-run。 */
  async canDryRun(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, AI_TRIGGER, organizationId)
    return result.allowed
  }

  /** Apply（确认导入）：需同时具备 ai:confirm 与 project:create。 */
  async canApply(user: User, organizationId: number): Promise<boolean> {
    const confirm = await this.rbac.check(user, AI_CONFIRM, organizationId)
    if (!confirm.allowed) return false
    const create = await this.rbac.check(user, PROJECT_CREATE, organizationId)
    return create.allowed
  }

  /** 放弃草案。 */
  async canDiscard(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, AI_TRIGGER, organizationId)
    return result.allowed
  }
}
