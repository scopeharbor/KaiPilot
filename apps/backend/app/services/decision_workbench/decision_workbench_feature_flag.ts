/**
 * v3-pmo-decision-intelligence-workbench —— 决策工作台特性门禁。
 *
 * 默认开启（本机优先基线）。关闭时：
 * - decision-workbench 路由返回 FEATURE_DISABLED
 * - PMO 导航入口隐藏
 * - 已有决策议题/快照/结论/回执保留（审计与恢复），不删除任何决策记录
 */
const FEATURE_FLAG_KEY = 'PMO_DECISION_WORKBENCH_ENABLED'

export function isDecisionWorkbenchEnabled(): boolean {
  const flag = process.env[FEATURE_FLAG_KEY]
  if (flag === undefined || flag === '') return true
  return flag === 'true' || flag === '1'
}
