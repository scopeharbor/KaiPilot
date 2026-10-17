// v3-resource-capacity-forecasting-closed-loop —— feature flag（默认关闭，保守策略）。
//
// 关闭时：
// - 后端闭环路由不放行（统一 RESOURCE_NOT_FOUND 语义，见 Controller 层）
// - 保留清理服务整体跳过
// - 已有闭环记录保留用于审计与恢复，不影响既有资源预测/调配行为

const FEATURE_FLAG_KEY = 'RESOURCE_CAPACITY_LOOP_ENABLED'

/**
 * 资源容量预测闭环是否启用。
 * 未设置时**默认关闭**（与 multi_project_impact 的本机默认开启不同——
 * 本能力涉及新的组织级状态机与 handoff 面，保守起见须显式开启）。
 */
export function isResourceCapacityLoopEnabled(): boolean {
  const flag = process.env[FEATURE_FLAG_KEY]
  return flag === 'true' || flag === '1'
}
