/**
 * v2-5-provider-incoming-webhook-foundation —— webhook 管理 RBAC Policy（design D9）。
 *
 * 管理操作校验 `webhook:manage` + 组织隔离。接收端点本身不挂 RBAC
 * （provider→平台，无用户上下文），安全边界由签名承担。
 */
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { WEBHOOK_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class WebhookPolicy {
  constructor(private rbac: RbacService) {}

  async manage(user: User, organizationId: number) {
    const result = await this.rbac.check(user, WEBHOOK_MANAGE, organizationId)
    return result.allowed
  }
}
