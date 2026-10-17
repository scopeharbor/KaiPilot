/**
 * v3-multi-project-impact-analysis —— 多项目影响分析特性门禁
 *
 * 默认关闭（保守策略）。关闭时：
 * - 影响分析路由返回 FEATURE_DISABLED
 * - PMO 工作台影响分析入口隐藏
 * - 已生成的快照和审计记录保留，不影响正式依赖 CRUD、检测、
 *   项目内任务依赖、甘特、PMO Dashboard、资源、OKR 和 BI 能力
 */

const FEATURE_FLAG_KEY = 'MULTI_PROJECT_IMPACT_ANALYSIS_ENABLED'

/**
 * 多项目影响分析是否启用
 */
export function isMultiProjectImpactAnalysisEnabled(): boolean {
  const flag = process.env[FEATURE_FLAG_KEY]
  if (flag === undefined || flag === '') return true // 本机默认开启
  return flag === 'true' || flag === '1'
}
