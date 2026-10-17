import vine from '@vinejs/vine'

/**
 * 组织选择（切换）请求校验（v3-multitenant-tenant-identification §4.1）。
 *
 * 只接受**目标组织意图**与可选的旧 scope hash：
 *   - `organizationId` 仅作意图，成员关系/所有权由 `TenantResolutionService` 服务端重算；
 *   - `previousScopeHash` 只进审计对比，不参与授权判定（客户端可伪造，故不可信）。
 *
 * 刻意**不接受** permissions / scopeMode / roleVersion 等字段：spec
 * 「Frontend permission claim is ignored」要求这些一律由服务端重算，
 * 在 validator 层就不给它们入口，比在 service 层忽略更难写错。
 */
export const organizationSelectionValidator = vine.create({
  organizationId: vine.number().withoutDecimals().positive(),
  previousScopeHash: vine.string().trim().maxLength(64).nullable().optional(),
})
