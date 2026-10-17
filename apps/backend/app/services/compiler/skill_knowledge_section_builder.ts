/**
 * v3-skill-compiler-integration —— SkillKnowledgeSectionBuilder（task 4.1）。
 *
 * 消费 SkillActivationRef + Stage ID + token budget，调用三个纯函数
 * (projectSkillKnowledge → assertNoL3Synthetic → applyKnowledgeBudget)，
 * 返回 ContextSection（P2, name='skillKnowledge'）或 null。
 *
 * @aiproj/backend
 */
import {
  projectSkillKnowledge,
  assertNoL3Synthetic,
  applyKnowledgeBudget,
  type SkillActivationRef,
  type SkillKnowledgeSection,
} from '@aiproj/types'
import type { ContextSection } from '@aiproj/compiler-spec'

// ── Types ──

export interface SkillKnowledgeBuildResult {
  section: ContextSection | null
  warnings: string[]
  l3RejectedCount: number
}

// ── Builder ──

/**
 * 构建 skillKnowledge Context Section。
 *
 * 流程：
 * 1. projectSkillKnowledge — 按 Stage 过滤 Skill 的 KnowledgeBundle 条目
 * 2. assertNoL3Synthetic — 拒绝 L3 合成来源条目（V3 红线 1）
 * 3. applyKnowledgeBudget — 按 token 预算裁剪
 *
 * @param ref SkillActivationRef（含完整 ActivationDecision）
 * @param stageId 当前 Compiler Stage ID
 * @param tokenBudget 此 section 的 token 预算
 * @returns 构建结果（section 或 null，warnings，L3 拒绝计数）
 */
export function buildSkillKnowledgeSection(
  ref: SkillActivationRef,
  stageId: string,
  tokenBudget: number,
): SkillKnowledgeBuildResult {
  const warnings: string[] = []

  // 1. 按 Stage 投影
  const { projected, warnings: projWarnings } = projectSkillKnowledge(ref.decision, stageId)
  warnings.push(...projWarnings)

  // 2. 收集所有条目
  const allEntries = projected.flatMap((g) => g.entries)

  // 3. L3 校验
  const { allowed, rejected, warnings: l3Warnings } = assertNoL3Synthetic(allEntries)
  warnings.push(...l3Warnings)

  // 4. 构建 filtered projected（用 allowed 替换原始 entries）
  const filteredProjected = projected.map((g) => ({
    skillKey: g.skillKey,
    version: g.version,
    entries: g.entries.filter((e) => allowed.some((a) => a.id === e.id)),
  }))

  // 5. 预算裁剪
  const {
    section: knowledgeSection,
    cutLevel,
    cutReason,
    includedCount,
  } = applyKnowledgeBudget(filteredProjected, tokenBudget)

  if (!knowledgeSection) {
    return { section: null, warnings, l3RejectedCount: rejected.length }
  }

  // 6. 构建 ContextSection
  const content: SkillKnowledgeSection = {
    skillRefs: ref.activatedSkillKeys.map((key) => {
      const entry = ref.decision.activatedSkills.find((e) => e.skill.skillKey === key)
      return { skillKey: key, version: entry?.skill.version ?? 'unknown' }
    }),
    entries: knowledgeSection.entries,
    summaryLevel: cutLevel,
    cutSkillRefs: cutLevel === 'cut' ? ref.activatedSkillKeys : undefined,
  }

  const section: ContextSection = {
    name: 'skillKnowledge',
    priority: 'P2',
    summaryLevel: cutLevel === 'full' ? 'full' : cutLevel === 'compact' ? 'compact' : 'compact',
    requestedTokens: tokenBudget,
    includedTokens: includedCount,
    cutReason: cutLevel !== 'full' ? cutReason : undefined,
    content,
    sourceRefs: ref.activatedSkillKeys.map((k) => `skill:${k}`),
  }

  return { section, warnings, l3RejectedCount: rejected.length }
}
