// @aiproj/backend — V3 TRIZ Skill Layer 集成特性门禁
// v3-triz-skill-layer-integration / tasks §3.1
//
// 默认本机开启（保守策略，可通过环境变量关闭）。
// 关闭时：
// - Skill Layer 路由返回 FEATURE_DISABLED
// - 项目导航入口隐藏
// - 已有的 Skill Registry、TRIZ 分析器、Compiler 不受影响

const FEATURE_FLAG_KEY = 'TRIZ_SKILL_LAYER_ENABLED'

/**
 * TRIZ Skill Layer 集成是否启用。
 * 默认本机开启。
 */
export function isTrizSkillLayerEnabled(): boolean {
  const flag = process.env[FEATURE_FLAG_KEY]
  if (flag === undefined || flag === '') return true
  return flag === 'true' || flag === '1'
}
