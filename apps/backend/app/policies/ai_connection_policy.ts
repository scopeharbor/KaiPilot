import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_CONNECTION_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * AI 连接权限(ai-gateway-abstraction)。
 * - manage(CRUD):需 `ai:connection:manage`(org_admin / project_manager)。
 * - 列表/查看/选用连接:复用 `ai:trigger`(能触发 AI 即可见连接),不在本 Policy。
 */
@inject()
export default class AiConnectionPolicy {
  constructor(private rbac: RbacService) {}

  async manage(user: User, organizationId: number) {
    const result = await this.rbac.check(user, AI_CONNECTION_MANAGE, organizationId)
    return result.allowed
  }
}
