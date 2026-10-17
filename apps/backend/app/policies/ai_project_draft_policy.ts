/**
 * ai-draft-generation / T036·T037 —— 草案权限判定（tasks 3.2）。
 *
 *   - 生成/保存/拒绝/重试：需 `ai:trigger`；
 *   - 确认导入：需 `ai:confirm` **且** `project:create`（缺一不可，spec「确认导入生成正式项目」）。
 * 组织隔离与跨组织不可见由 Service 的 `findForUser` + RESOURCE_NOT_FOUND 兜底，不在本 Policy。
 */

import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_TRIGGER, AI_CONFIRM, PROJECT_CREATE } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class AiProjectDraftPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 生成/保存/拒绝/重试草案。 */
  async canTrigger(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, AI_TRIGGER, organizationId)
    return result.allowed
  }

  /** 确认导入：需同时具备 ai:confirm 与 project:create。 */
  async canConfirm(user: User, organizationId: number): Promise<boolean> {
    const confirm = await this.rbac.check(user, AI_CONFIRM, organizationId)
    if (!confirm.allowed) return false
    const create = await this.rbac.check(user, PROJECT_CREATE, organizationId)
    return create.allowed
  }
}
