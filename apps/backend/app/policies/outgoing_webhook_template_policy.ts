/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 模板 RBAC Policy（3.3 P0）。
 *
 * 复用已有的 `outgoing_webhook:manage` 权限族（同属集成管理）。
 * 模板本身是只读操作（list/get/prefill），但应用模板（创建订阅）是写操作，
 * 使用同一权限边界。
 */
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { OUTGOING_WEBHOOK_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class OutgoingWebhookTemplatePolicy {
  constructor(private rbac: RbacService) {}

  async manage(user: User, organizationId: number) {
    const result = await this.rbac.check(user, OUTGOING_WEBHOOK_MANAGE, organizationId)
    return result.allowed
  }
}
