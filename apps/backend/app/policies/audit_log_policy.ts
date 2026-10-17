import { PermissionDeniedException } from '#exceptions/api_exception'
import AuditLog from '#models/audit_log'
import type User from '#models/user'
import { inject } from '@adonisjs/core'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'

/**
 * 审计日志策略（design D3）。
 *
 * 提供统一 scope 注入：
 * - sysadmin：全局，不加 organization_id 过滤
 * - org_admin：强制 .where('organization_id', actor.orgId)
 * - 其他角色：直接 deny（403）
 */
@inject()
export default class AuditLogPolicy {
  scope(actor: User, organizationId?: number | null): ModelQueryBuilderContract<typeof AuditLog> {
    if (actor.isSuperAdmin) {
      return AuditLog.query()
    }

    if (!organizationId) {
      throw new PermissionDeniedException('需要组织上下文')
    }

    return AuditLog.query().where('organization_id', organizationId)
  }
}
