// 前端租户 scope 展示层 helper（v3-multitenant-isolation-architecture §7.3）。
//
// **本模块不是安全边界，也不能被当成安全边界。**
//
// 前端持有的 `currentOrganizationId` 来自 access token 的声明，可被用户改写
//（sessionStorage 可编辑、URL 参数可伪造）。真正的租户边界只有一处：服务端从
// 认证态解析的 `ctx.tenant.organizationId`。前端传上去的组织值仅作**请求提示**，
// 服务端 `tenant_middleware` 会做一致性校验，不一致统一 404 掩蔽
//（既不放行，也不告诉你目标是否存在）。
//
// 因此本模块只做三件事，全部是展示层：
//   1. 把当前组织折算成**低敏**标签（ID + scope hash，不含隐藏租户详情）
//   2. 把服务端返回的隔离 warning 渲染成中文文案
//   3. 提供 `isDisplayOnlyOrganizationState` 之类的语义命名，让调用点自我说明
//
// 低敏标签与 warning 的构造复用 `@aiproj/types`，保证前后端同一套契约。

import {
  buildLowSensitiveScopeLabels,
  buildMultitenantWarning,
  detectMultitenantForbiddenKeysDeep,
  isMultitenantWarningCode,
  type MultitenantReasonCode,
  type MultitenantWarningCode,
} from '@aiproj/types/multitenant-isolation-architecture'

/** 低敏 scope 标签（可安全渲染）。 */
export type TenantScopeLabels = ReturnType<typeof buildLowSensitiveScopeLabels>

/** 低敏 warning 条目（可安全渲染）。 */
export type TenantScopeWarning = ReturnType<typeof buildMultitenantWarning>

/**
 * UI 组织状态的显式语义：**display-only**。
 *
 * 命名本身就是这条契约的载体——任何调用点写下
 * `describeTenantScopeForDisplay(...)` 就等于声明"我只用它渲染，不用它授权"。
 * 无有效组织时返回 null，调用方据此渲染空态/禁用查询，而不是自行猜一个组织 ID。
 */
export function describeTenantScopeForDisplay(context: {
  organizationId: number | null | undefined
  projectId?: number | null
  projectName?: string | null
}): TenantScopeLabels | null {
  const organizationId = Number(context.organizationId)
  if (!Number.isInteger(organizationId) || organizationId <= 0) return null
  return buildLowSensitiveScopeLabels({
    organizationId,
    projectId: context.projectId ?? null,
    projectName: context.projectName ?? null,
  })
}

/**
 * UI 组织状态永远是展示层。
 *
 * 保留为显式常量而非 `true` 字面量散落各处，是为了让"这里没有安全判断"
 * 在代码搜索里可被找到（grep `isDisplayOnlyOrganizationState`）。
 */
export const isDisplayOnlyOrganizationState = true as const

/** warning code → 中文低敏文案（不含隐藏资源名/计数/租户归属）。 */
const WARNING_MESSAGES: Record<MultitenantWarningCode, string> = {
  NO_ACTIVE_TENANT: '当前没有可用的组织上下文，请先选择组织。',
  ORGANIZATION_NOT_MATCHED: '请求的组织与当前会话不一致，已按当前组织处理。',
  CROSS_ORGANIZATION_BLOCKED: '该操作涉及当前组织之外的数据，已被阻止。',
  GLOBAL_LOW_SENSITIVE_ONLY: '全局视图仅展示低敏信息。',
  DEGRADED_ADAPTER_MODULE: '部分依赖暂不可用，已降级为实时计算，结果仍限于当前组织。',
  UNSUPPORTED_TENANT_RESOURCE: '该资源暂未纳入租户隔离清单，相关操作已停用。',
  STALE_SCOPE_SNAPSHOT: '会话的组织范围已变化，请刷新后重试。',
  PARTIAL_SAME_TENANT_SUCCESS: '仅当前组织内的条目已处理，其余条目未执行。',
  HIDDEN_CROSS_TENANT_ID: '部分引用不在当前组织范围内，已从结果中略去。',
}

/**
 * 把服务端返回的 warning 归一化为可渲染条目。
 *
 * 关键点：**文案只由 code 决定，绝不透传服务端 message**。
 * 服务端 message 可能夹带隐藏细节，前端渲染它等于把泄露搬到 UI 上。
 * 未知 code 一律丢弃（fail closed），不做"原样显示"兜底。
 */
export function toDisplayWarning(input: unknown): TenantScopeWarning | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { code?: unknown; reasonCode?: unknown }
  if (!isMultitenantWarningCode(raw.code)) return null
  return buildMultitenantWarning({
    code: raw.code,
    reasonCode: (raw.reasonCode ?? 'PERMISSION_DENIED') as MultitenantReasonCode,
    message: WARNING_MESSAGES[raw.code],
  })
}

/** 批量归一化，未知 code 静默丢弃。 */
export function toDisplayWarnings(input: unknown): TenantScopeWarning[] {
  if (!Array.isArray(input)) return []
  return input.map(toDisplayWarning).filter((w): w is TenantScopeWarning => w !== null)
}

/**
 * 渲染前的兜底体检：任何要进 UI 的隔离相关对象都不得含禁止字段。
 * 返回命中的键路径（空数组 = 通过），供测试与开发期断言。
 */
export function detectForbiddenDisplayKeys(value: unknown): string[] {
  return detectMultitenantForbiddenKeysDeep(value)
}
