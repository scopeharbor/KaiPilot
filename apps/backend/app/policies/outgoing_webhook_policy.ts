/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅管理 RBAC Policy（design D5）。
 *
 * 管理操作校验 `outgoing_webhook:manage` + 组织隔离。前端权限提示仅作展示，服务端为本权威。
 */
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { OUTGOING_WEBHOOK_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class OutgoingWebhookPolicy {
  constructor(private rbac: RbacService) {}

  async manage(user: User, organizationId: number) {
    const result = await this.rbac.check(user, OUTGOING_WEBHOOK_MANAGE, organizationId)
    return result.allowed
  }
}
