// TRIZ 静态知识包模块入口（v3-triz-contradiction-copilot 任务 1.1）。
//
// 知识包是**只读静态数据 + 纯函数检索**的服务端底座：无写库、无权限判定、不接受任何
// 作用域参数、无网络与模型调用（v3-triz-contradiction-copilot spec「TRIZ 静态知识包内容
// 契约」）。该边界使整包后续可平移为插件贡献而不触碰授权面。
//
// 素材来源（仓库内调研文档，逐条可追溯）：
// - docs/v2-v3/planning/ui-redesign/research/triz-fundamentals.md §二（40 原则）、
//   §3.1（39 参数）、§3.3（PM 参数映射与 3 个经典矛盾推演）；
// - docs/v2-v3/planning/ui-redesign/research/triz-application-ai-pm.md §三（14 对 PM 矛盾映射）。
// 知识包 MUST NOT 嵌入未获授权的外部矩阵数据集（如 Matrix 2010 全量数据表），本包只采用
// 其语汇取向。

export type { TrizPrincipleEntry } from './principles.js'
export { TRIZ_PRINCIPLES } from './principles.js'
export type { TrizParameterEntry } from './parameters.js'
export { TRIZ_PARAMETERS } from './parameters.js'
export type { TrizPmClassicScenario, TrizPmContradictionPair } from './pm_contradiction_pairs.js'
export { TRIZ_PM_CLASSIC_SCENARIOS, TRIZ_PM_CONTRAIDCTION_PAIRS } from './pm_contradiction_pairs.js'

/** 知识包版本：内容发生增删改时递增，供分析记录与审计追溯引用的是哪一版知识。 */
export const TRIZ_KNOWLEDGE_PACK_VERSION = '1.0.0'

/** 知识包内容的仓库内来源文档（相对仓库根）。 */
export const TRIZ_RESEARCH_DOC_PATHS = {
  fundamentals: 'docs/v2-v3/planning/ui-redesign/research/triz-fundamentals.md',
  applicationAiPm: 'docs/v2-v3/planning/ui-redesign/research/triz-application-ai-pm.md',
} as const
