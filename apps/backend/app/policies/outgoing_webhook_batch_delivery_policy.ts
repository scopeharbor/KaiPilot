import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { OUTGOING_WEBHOOK_MANAGE } from '#rbac'

/**
 * v2-5-webhook-batched-delivery -- 出站 webhook 批量投递 Policy（design D5/D6）。
 *
 * 复用 outgoing_webhook:manage 权限，与 delivery ledger 同一权限边界。
 * 校验用户是否有所需角色权限，且操作在用户组织内。
 */
@inject()
export default class OutgoingWebhookBatchDeliveryPolicy {
  constructor(private rbac: RbacService) {}

  async manage(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, OUTGOING_WEBHOOK_MANAGE, organizationId)
    return result.allowed
  }
}
