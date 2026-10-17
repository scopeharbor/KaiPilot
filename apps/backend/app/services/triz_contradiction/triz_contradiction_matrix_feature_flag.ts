// @aiproj/backend — V3 TRIZ 矛盾矩阵审查 UI 特性门禁
// v3-triz-contradiction-matrix-ui / tasks §7.5
//
// 默认本机开启（保守策略，可通过环境变量关闭）。
// 关闭时：
// - 矩阵路由返回 FEATURE_DISABLED
// - 项目头部"查看矩阵"入口可隐藏
// - 已有的矛盾数据、Workbench、Rationale、Decision Log 不受影响
//
// 仅当前端 feature flag 模式支持时启用；本 change 不强制引入新的 feature flag 框架。

const FEATURE_FLAG_KEY = 'TRIZ_CONTRADICTION_MATRIX_UI_ENABLED'

/**
 * TRIZ 矛盾矩阵审查 UI 是否启用。
 * 默认本机开启（与 multi-project-impact-analysis 一致的保守策略）。
 */
export function isTrizContradictionMatrixUiEnabled(): boolean {
  const flag = process.env[FEATURE_FLAG_KEY]
  if (flag === undefined || flag === '') return true // 本机默认开启
  return flag === 'true' || flag === '1'
}
