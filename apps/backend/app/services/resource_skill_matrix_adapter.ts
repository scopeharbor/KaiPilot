/**
 * 资源技能矩阵适配层（v3-resource-skill-matrix §4.1, §4.3）。
 *
 * 为现有 ResourceMatchingService 与 SkillRegistryService 提供薄适配器，
 * 使其可消费规范化技能 key 与矩阵缺口摘要，但不改变正式写入语义。
 */

import { normalizeSkillTag } from '@aiproj/types'

/**
 * 将原始技能标签列表规范化为统一 key 集合。
 * 用于匹配服务在比较技能时使用规范化口径。
 */
export function resolveNormalizedSkillKeys(rawTags: string | null | undefined): string[] {
  if (!rawTags) return []
  try {
    const parsed = JSON.parse(rawTags)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.map((tag) => normalizeSkillTag(String(tag))).filter(Boolean))].sort()
  } catch {
    return []
  }
}

/**
 * 比较两组规范化技能 key 的匹配情况。
 * 返回匹配数和匹配的 key 列表。
 */
export function compareNormalizedSkillKeys(
  requirementKeys: string[],
  resourceKeys: string[],
): { matchedCount: number; matchedKeys: string[] } {
  const resourceSet = new Set(resourceKeys)
  const matchedKeys = requirementKeys.filter((key) => resourceSet.has(key))
  return { matchedCount: matchedKeys.length, matchedKeys }
}

/**
 * 为 Skill Registry 构建低敏 advisory 元数据。
 * 只暴露组织隔离下必要的展示字段，不含知识包、prompt、模型输出等敏感内容。
 */
export function buildSkillAdvisoryMetadata(input: {
  skillKey: string
  name: string
  version: string
  status: string
  category?: string | null
  tags: string[]
  matchedTags: string[]
  matchReason?: string
  evaluationOnly: boolean
}) {
  return {
    skillKey: input.skillKey,
    skillName: input.name,
    skillVersion: input.version,
    skillStatus: input.status,
    skillCategory: input.category ?? undefined,
    matchedTags: input.matchedTags,
    matchReason: input.matchReason ?? `技能标签与 Compiler Skill 匹配`,
    evaluationOnly: input.evaluationOnly,
    advisoryOnly: true as const,
    activationApplied: false as const,
    drillDownUrl: input.skillKey ? `/organization/skills/${input.skillKey}` : null,
  }
}

/**
 * 检查矩阵缺口是否可以由现有 Skill advisory 缓解。
 * 返回缓解建议（advisory only）。
 */
export function checkSkillAdvisoryForGap(
  gapSkillKey: string,
  skillTags: string[],
): { hasAdvisory: boolean; matchCount: number; expected: boolean } {
  const normalizedGap = normalizeSkillTag(gapSkillKey)
  const matches = skillTags.filter((tag) => normalizeSkillTag(tag) === normalizedGap)
  return {
    hasAdvisory: matches.length > 0,
    matchCount: matches.length,
    expected: matches.length > 0,
  }
}
