// 前端租户**识别**展示层 helper（v3-multitenant-tenant-identification §8.1/§8.4）。
//
// 与 `@/lib/tenant-scope`（隔离执行层展示 helper）的分工：那个模块渲染"某次查询被隔离
// 拦下"的 warning；本模块渲染"当前租户是怎么识别出来的、为什么需要重选组织"的状态。
//
// **本模块同样不是安全边界。** 前端持有的 effective tenant context 是服务端决定的快照，
// 只用于渲染与"手里的句柄是否已过期"的本地判断；每个请求的租户仍由服务端重算。
//
// 三条硬规则（与 tenant-scope 一致）：
//   1. 文案**只由 code 决定**，绝不透传服务端 message —— 后者可能夹带隐藏组织/资源细节；
//   2. 未知 code 一律丢弃（fail closed），不做"原样显示"兜底；
//   3. 输出只含枚举、ID、hash 与固定中文文案，可安全进 DOM。

import {
  TENANT_WARNING_CODES,
  isTenantWarningCode,
  type EffectiveTenantContext,
  type TenantWarningCode,
} from '@aiproj/types/multitenant-tenant-identification'

/** 识别链路 warning code → 中文低敏文案。 */
const TENANT_ID_WARNING_MESSAGES: Record<TenantWarningCode, string> = {
  NO_ACTIVE_TENANT: '尚未选择组织，请先选择要进入的组织。',
  ORGANIZATION_HIDDEN: '该组织不可用或你没有访问权限。',
  MEMBERSHIP_STALE_REFRESH_REQUIRED: '你的成员身份已变化，请刷新后重试。',
  ROLE_STALE_REFRESH_REQUIRED: '你的角色已更新，请刷新登录状态后重试。',
  ROUTE_ORGANIZATION_MISMATCH: '请求的组织与当前会话不一致，已按当前组织处理。',
  BODY_ORGANIZATION_HINT_IGNORED: '请求中的组织参数已忽略，操作按当前组织执行。',
  RESOURCE_HIDDEN: '该资源不存在或不在当前组织范围内。',
  RESOURCE_OWNERSHIP_MISMATCH: '该资源不属于当前组织，操作已停止。',
  GLOBAL_LOW_SENSITIVE_ONLY: '当前为全局低敏视图，仅展示汇总信息。',
  SYSTEM_MAINTENANCE_ONLY: '当前为运维只读视图，业务操作不可用。',
  REPLAY_STALE_OR_INVALID: '此前生成的预览或导出已失效，请重新生成。',
}

/** 可渲染的识别状态条目。 */
export interface TenantIdentificationNotice {
  code: TenantWarningCode
  message: string
  /**
   * 建议的恢复动作（供 UI 决定渲染哪个按钮）：
   * - `select_organization` 需要重新选组织
   * - `refresh_session`     需要刷新登录态/租户上下文
   * - `regenerate`          需要重新生成预览/导出
   * - `none`                只是信息提示
   */
  recovery: 'select_organization' | 'refresh_session' | 'regenerate' | 'none'
  /** ARIA live region 的紧急程度：阻断性状态用 assertive，其余 polite。 */
  ariaLive: 'polite' | 'assertive'
}

const RECOVERY_BY_CODE: Record<TenantWarningCode, TenantIdentificationNotice['recovery']> = {
  NO_ACTIVE_TENANT: 'select_organization',
  ORGANIZATION_HIDDEN: 'select_organization',
  MEMBERSHIP_STALE_REFRESH_REQUIRED: 'refresh_session',
  ROLE_STALE_REFRESH_REQUIRED: 'refresh_session',
  ROUTE_ORGANIZATION_MISMATCH: 'none',
  BODY_ORGANIZATION_HINT_IGNORED: 'none',
  RESOURCE_HIDDEN: 'none',
  RESOURCE_OWNERSHIP_MISMATCH: 'none',
  GLOBAL_LOW_SENSITIVE_ONLY: 'none',
  SYSTEM_MAINTENANCE_ONLY: 'none',
  REPLAY_STALE_OR_INVALID: 'regenerate',
}

/** 阻断性状态（用户不做动作就无法继续）走 assertive，让读屏软件立即播报。 */
const ASSERTIVE_CODES: readonly TenantWarningCode[] = [
  'NO_ACTIVE_TENANT',
  'ORGANIZATION_HIDDEN',
  'MEMBERSHIP_STALE_REFRESH_REQUIRED',
  'ROLE_STALE_REFRESH_REQUIRED',
  'RESOURCE_OWNERSHIP_MISMATCH',
]

/** 单条归一化；未知 code 返回 null（不显示优于显示未知内容）。 */
export function toTenantIdentificationNotice(input: unknown): TenantIdentificationNotice | null {
  const code = typeof input === 'string' ? input : (input as { code?: unknown } | null)?.code
  if (!isTenantWarningCode(code)) return null
  return {
    code,
    message: TENANT_ID_WARNING_MESSAGES[code],
    recovery: RECOVERY_BY_CODE[code],
    ariaLive: ASSERTIVE_CODES.includes(code) ? 'assertive' : 'polite',
  }
}

/** 批量归一化（接受 warning code 字符串数组或对象数组），未知 code 静默丢弃。 */
export function toTenantIdentificationNotices(input: unknown): TenantIdentificationNotice[] {
  if (!Array.isArray(input)) return []
  return input
    .map(toTenantIdentificationNotice)
    .filter((n): n is TenantIdentificationNotice => n !== null)
}

/** 当前租户的低敏展示标签（组织 ID + scope hash，不含组织名）。 */
export interface TenantIdentificationLabels {
  organizationLabel: string
  scopeHashLabel: string
  scopeModeLabel: string
}

const SCOPE_MODE_LABELS: Record<string, string> = {
  tenant: '组织范围',
  'global-low-sensitive': '全局低敏视图',
  'system-maintenance': '运维只读视图',
}

/**
 * 把 effective tenant context 折算成可渲染标签。
 *
 * 刻意**不接受**组织名称参数：组织名要另行从用户自己的组织列表取
 *（那份数据本就属于该用户）。识别上下文本身只带 ID 与 hash，
 * 从这里渲染名称会给"服务端在决定里回传组织名"开口子。
 */
export function describeTenantIdentificationForDisplay(
  context: Pick<EffectiveTenantContext, 'organizationId' | 'scopeHash' | 'scopeMode'> | null,
): TenantIdentificationLabels | null {
  if (!context) return null
  const { organizationId } = context
  return {
    organizationLabel:
      organizationId === null || organizationId <= 0 ? '未选择组织' : `组织 #${organizationId}`,
    scopeHashLabel: context.scopeHash ? `范围 ${context.scopeHash.slice(0, 8)}` : '范围未确定',
    scopeModeLabel: SCOPE_MODE_LABELS[context.scopeMode] ?? '组织范围',
  }
}

/**
 * 判断一个本地持有的派生句柄是否仍属于当前 selection（§4.3 的前端一侧）。
 *
 * 与后端 `TenantSelectionInvalidationService.isSelectionFresh` 同一套判据，
 * 目的是让 UI 在提交前就能提示"请重新生成"，而不是等服务端 404 才发现。
 * **前端判断只影响提示**——服务端仍会独立复核。
 */
export function isHandleFreshForSelection(params: {
  handleEpoch?: number | null
  currentEpoch: number
  handleOrganizationId?: number | null
  currentOrganizationId: number | null
}): boolean {
  if (params.handleEpoch == null) return false
  if (params.handleEpoch !== params.currentEpoch) return false
  if (
    params.handleOrganizationId != null &&
    params.handleOrganizationId !== params.currentOrganizationId
  ) {
    return false
  }
  return true
}

/** 全部识别 warning code（供测试穷举断言文案覆盖完整）。 */
export const ALL_TENANT_IDENTIFICATION_CODES = TENANT_WARNING_CODES
