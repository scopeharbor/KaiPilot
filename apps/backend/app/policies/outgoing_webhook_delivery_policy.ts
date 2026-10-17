/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递账本 RBAC Policy（design D5）。
 *
 * 复用订阅管理的 `outgoing_webhook:manage` 权限族（同属集成管理），覆盖账本 read 与
 * manual retry / pause / unpause。前端权限提示仅展示，服务端为本权威。
 */
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { OUTGOING_WEBHOOK_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class OutgoingWebhookDeliveryPolicy {
  constructor(private rbac: RbacService) {}

  async manage(user: User, organizationId: number) {
    const result = await this.rbac.check(user, OUTGOING_WEBHOOK_MANAGE, organizationId)
    return result.allowed
  }
}
