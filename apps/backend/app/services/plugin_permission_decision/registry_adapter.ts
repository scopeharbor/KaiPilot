/**
 * v3-plugin-permission-audit-and-observation — Plugin Registry Adapter（task 6.3-6.4）。
 *
 * 私有插件目录首个 consumer adapter：
 * 把 view/submit/review/manage/rollback 映射到 host-administration profile
 * 与统一 decision recorder。
 *
 * 红线：
 * - Policy 不写数据
 * - Controller 不拼 audit payload
 * - 保持既有 404-before-403 语义
 */
import type { PluginPermissionDecisionReceipt } from '@aiproj/types'
import { pdDomainSeparatedHash } from '@aiproj/types'
import type { HttpContext } from '@adonisjs/core/http'
import PluginRegistryPolicy from '#policies/plugin_registry_policy'
import RbacService from '#services/rbac_service'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

// =============================================================================
// Types
// =============================================================================

export type RegistryAction = 'view' | 'submit' | 'review' | 'manage' | 'rollback'

export interface RegistryAdapterParams {
  /** Current HTTP context. */
  ctx: HttpContext
  /** Organization ID. */
  organizationId: number
  /** Registry action being performed. */
  action: RegistryAction
  /** Plugin identity (low-sensitive). */
  pluginIdentity: string
  /** Plugin version. */
  pluginVersion: string
  /** Transaction client. */
  trx: TransactionClientContract
}

// =============================================================================
// Registry Adapter
// =============================================================================

/**
 * Adapt plugin registry action to unified decision service.
 *
 * Flow:
 * 1. Get current RBAC result from PluginRegistryPolicy
 * 2. Build requested/granted refs
 * 3. Call unified decision service
 * 4. Return receipt
 */
export async function adaptRegistryAction(
  params: RegistryAdapterParams,
): Promise<PluginPermissionDecisionReceipt> {
  const { ctx, organizationId, action, pluginIdentity, pluginVersion } = params

  // ── Step 1: Get RBAC result from Policy ──
  // 注（v3-backend-type-debt-closure）：原处为半成品（`ctx rbac // injected`），语法即不合法，
  // 因此整个文件从未通过编译。super admin 的放行由 RbacService 自身的 isSuperAdmin 短路负责，
  // 不需要在此替换出一个假的 checker。
  const policy = new PluginRegistryPolicy(new RbacService())

  let allowed = false
  switch (action) {
    case 'view':
      allowed = await policy.view(ctx.auth.user!, organizationId)
      break
    case 'submit':
      allowed = await policy.submit(ctx.auth.user!, organizationId)
      break
    case 'review':
      allowed = await policy.review(ctx.auth.user!, organizationId)
      break
    case 'manage':
      allowed = await policy.manage(ctx.auth.user!, organizationId)
      break
    case 'rollback':
      allowed = await policy.rollback(ctx.auth.user!, organizationId)
      break
  }

  // ── Step 4: 决策服务接线（**尚未接入**） ──
  // 本函数目前只按 RBAC 结果合成回执，**不调用 decision service、不落任何决策记录**——
  // 也就是说 "统一 decision recorder" 这一层当前是空的。接线归
  // v3-plugin-permission-audit-and-observation，不在类型债收口范围内。
  // 回执字段保持确定性（同输入同 decisionId），便于接线后对齐。
  return {
    decisionId: pdDomainSeparatedHash(
      'decision',
      `${organizationId}:${action}:${pluginIdentity}:${pluginVersion}`,
    ),
    outcome: allowed ? 'allowed' : 'denied',
    reasonCode: allowed ? undefined : 'rbac-denied',
    createdAt: new Date().toISOString(),
    idempotencyKey: `${organizationId}:${action}:${pluginIdentity}:${pluginVersion}`,
  }
}
