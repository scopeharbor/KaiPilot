/**
 * 变更请求域权限常量（v3-ui-next-risk-change-domains W2）。
 *
 * 已核实的后端 RBAC 事实（apps/backend/start/rbac/permissions.ts +
 * app/policies/change_request_policy.ts）：
 * - 变更域权限目录仅含 `change_request:create` 与 `change_request:approve`；
 * - 查看能力由 policy 以 change_request:create 承载（create = 项目成员可查可建），
 *   不存在独立 `change_request:view` claim —— 故路由准入为「view 或 create 任一」；
 * - 操作级判定：提交/编辑 `change_request:create`（服务端另校验请求人本人 + 草稿/
 *   退回态）；审批/退回/标记实施/关闭 `change_request:approve`（服务端另校验请求人
 *   不得自批）；影响分析解算/确认见 change_impact:view / change_impact:manage。
 */

/** 路由级查看准入（view 或 create，任一即放行；W4 测试可注入任一声明）。 */
export const CHANGE_REQUEST_VIEW_PERMISSIONS = ['change_request:view', 'change_request:create']

/** 创建（新建页 + 列表页「新建变更请求」按钮）。 */
export const CHANGE_REQUEST_CREATE = 'change_request:create'

/** 审批决策（批准/拒绝/退回/标记已实施/关闭）。 */
export const CHANGE_REQUEST_APPROVE = 'change_request:approve'

/** 六维影响分析：解算（create）与人工确认（manage）。 */
export const CHANGE_IMPACT_VIEW = 'change_impact:view'
export const CHANGE_IMPACT_MANAGE = 'change_impact:manage'
