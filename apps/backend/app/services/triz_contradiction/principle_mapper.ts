import type {
  CandidateContradiction,
  InventivePrincipleId,
  ProjectParameterKey,
  SuggestedPrinciple,
} from '@aiproj/types'
import { getInventivePrinciple } from '@aiproj/types'

/**
 * 解决建议映射器（v2-triz-contradiction-model-foundation D3）。
 *
 * 给定一条矛盾，确定性映射到若干候选发明原理与中文落地建议，按与参数对的相关度排序。
 * 仅返回待人工审查的文本建议，绝不自动应用。
 */
export default class PrincipleSuggestionMapper {
  /**
   * 为一条矛盾生成候选原理建议（确定性、可复现）。
   * 目录外参数降级为物理矛盾通用集；无任何匹配时返回空数组。
   */
  suggestPrinciples(contradiction: CandidateContradiction): SuggestedPrinciple[] {
    const scored = this.scoreByRelevance(contradiction)
    if (scored.length === 0) return []

    // 按相关度降序稳定排序（相关度相同按 principleId 字典序）
    scored.sort((a, b) => {
      if (Math.abs(b.relevance - a.relevance) > 1e-9) return b.relevance - a.relevance
      return a.principleId.localeCompare(b.principleId)
    })

    // 取相关度 > 0 的候选，最多 5 条
    return scored
      .filter((s) => s.relevance > 0)
      .slice(0, 5)
      .map((s) => {
        const entry = getInventivePrinciple(s.principleId)
        return {
          principleId: s.principleId,
          name: entry?.name ?? s.principleId,
          relevance: Number(s.relevance.toFixed(2)),
          advice: entry?.projectAdvice ?? '',
        }
      })
  }

  /**
   * 按矛盾类型与参数对打分。
   * 技术矛盾按 improving/worsening 参数对查表；物理矛盾走分离原理通用集。
   */
  private scoreByRelevance(
    contradiction: CandidateContradiction,
  ): Array<{ principleId: InventivePrincipleId; relevance: number }> {
    if (contradiction.type === 'physical') {
      // 物理矛盾：分离原理优先（空间/时间/条件分离 ≈ 分割/动态化/周期性/参数变化）
      return [
        { principleId: 'segmentation', relevance: 0.9 },
        { principleId: 'dynamics', relevance: 0.85 },
        { principleId: 'parameter_change', relevance: 0.8 },
        { principleId: 'periodic_action', relevance: 0.7 },
      ]
    }

    const improving = contradiction.improvingParameterKey
    const worsening = contradiction.worseningParameterKey
    if (!improving || !worsening) return []

    const key = `${improving}>${worsening}`
    const table = TECHNICAL_MAP[key]
    if (table) return table.map(([id, rel]) => ({ principleId: id, relevance: rel }))

    // 目录内参数但无精确对：按恶化参数回退（仍可追溯）
    const fallback = WORSENING_FALLBACK[worsening]
    if (fallback) return fallback.map(([id, rel]) => ({ principleId: id, relevance: rel - 0.1 }))

    return []
  }
}

/**
 * 技术矛盾参数对 → 候选原理（含相关度）。键为 `improving>worsening`。
 * 仅收录项目域高频对立；未收录对走恶化参数回退。
 */
const TECHNICAL_MAP: Record<string, Array<[InventivePrincipleId, number]>> = {
  // 工期压缩 → 成本/风险/质量（CD-001）
  'duration>cost': [
    ['segmentation', 0.9],
    ['preliminary_action', 0.85],
    ['dynamics', 0.7],
  ],
  'duration>risk_level': [
    ['preliminary_action', 0.9],
    ['before_in_conclusion', 0.85],
    ['segmentation', 0.7],
  ],
  'duration>quality': [
    ['segmentation', 0.85],
    ['periodic_action', 0.8],
    ['mechanics_substitution', 0.7],
  ],
  // 资源利用率 → 稳定性（CD-002）
  'resource_load>stability': [
    ['parameter_change', 0.9],
    ['dynamics', 0.85],
    ['intermediary', 0.7],
  ],
  // 范围 → 工期/质量（CD-003）
  'scope>duration': [
    ['segmentation', 0.9],
    ['periodic_action', 0.85],
    ['preliminary_action', 0.7],
  ],
  'scope>quality': [
    ['segmentation', 0.85],
    ['mechanics_substitution', 0.75],
    ['self_service', 0.7],
  ],
  // 风险降低 → 成本/工期（CD-004）
  'risk_level>cost': [
    ['before_in_conclusion', 0.9],
    ['intermediary', 0.8],
    ['preliminary_action', 0.7],
  ],
  'risk_level>duration': [
    ['before_in_conclusion', 0.9],
    ['preliminary_action', 0.8],
    ['intermediary', 0.7],
  ],
  // 吞吐 → 灵活性（CD-005）
  'throughput>flexibility': [
    ['dynamics', 0.9],
    ['parameter_change', 0.85],
    ['periodic_action', 0.75],
  ],
}

/** 恶化参数回退集（精确对未命中时使用，相关度略降）。 */
const WORSENING_FALLBACK: Record<ProjectParameterKey, Array<[InventivePrincipleId, number]>> = {
  cost: [
    ['mechanics_substitution', 0.75],
    ['parameter_change', 0.7],
  ],
  duration: [
    ['segmentation', 0.75],
    ['preliminary_action', 0.7],
  ],
  quality: [
    ['self_service', 0.75],
    ['mechanics_substitution', 0.7],
  ],
  risk_level: [
    ['before_in_conclusion', 0.8],
    ['intermediary', 0.7],
  ],
  stability: [
    ['parameter_change', 0.75],
    ['intermediary', 0.7],
  ],
  flexibility: [
    ['dynamics', 0.8],
    ['periodic_action', 0.7],
  ],
  scope: [
    ['segmentation', 0.75],
    ['periodic_action', 0.7],
  ],
  resource_load: [
    ['parameter_change', 0.75],
    ['dynamics', 0.7],
  ],
  information_completeness: [
    ['self_service', 0.75],
    ['intermediary', 0.7],
  ],
  maintainability: [
    ['segmentation', 0.7],
    ['self_service', 0.65],
  ],
  uncertainty: [
    ['before_in_conclusion', 0.75],
    ['preliminary_action', 0.7],
  ],
  throughput: [
    ['periodic_action', 0.75],
    ['mechanics_substitution', 0.7],
  ],
}
