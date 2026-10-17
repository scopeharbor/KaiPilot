/**
 * skill-compiler-integration —— V3 Skill 知识注入 Compiler Context Packet 共享契约与纯函数。
 *
 * 零运行时依赖：导入 ./skill-activation（ActivationDecision/ActivatedSkillEntry）与
 * ./compiler-skill（Skill/KnowledgeBundle），不重新定义。
 *
 * 提供 SkillKnowledgeSection / SkillActivationRef / SkillKnowledgeEntry 类型，
 * 以及 projectSkillKnowledge / assertNoL3Synthetic / applyKnowledgeBudget 三个纯函数。
 *
 * @aiproj/types 零依赖约束
 */
import type { ActivationDecision } from './skill-activation.js'
import type { KnowledgeBundle } from './compiler-skill.js'

// ── 注入条目形状 ───────────────────────────────────────────────────

export interface SkillKnowledgeEntry {
  /** 条目稳定 ID（来自 KnowledgeBundle 的 entry.id）。 */
  id: string
  /** 条目标题。 */
  title: string
  /** 正文（简体中文，100–300 字）。 */
  content: string
  /** 对齐 PRD Stage 1–6 注入点（可选）。 */
  stage?: number
  /** 来源类型。 */
  provenance: string
  /** 来源标注。 */
  sourceRefs?: {
    layer: 'L1' | 'L2' | 'L3' | 'L4'
    sourceId: string
    section?: string
  }[]
}

// ── 裁剪级别 ───────────────────────────────────────────────────────

export type SkillKnowledgeCutLevel = 'full' | 'compact' | 'ref-only' | 'cut'

// ── skillKnowledge section 注入形状 ────────────────────────────────

export interface SkillKnowledgeSection {
  /** 技能引用摘要：激活的 Skill 的 skillKey/version。 */
  skillRefs: Array<{ skillKey: string; version: string }>
  /** 注入的知识条目（已过滤 + 裁剪）。 */
  entries: SkillKnowledgeEntry[]
  /** 当前裁剪级别。 */
  summaryLevel: SkillKnowledgeCutLevel
  /** 被裁条目的 skillKey 引用（用于追溯）。 */
  cutSkillRefs?: string[]
}

// ── 激活决策引用 ───────────────────────────────────────────────────

export interface SkillActivationRef {
  /** 指向 skill_activation_decision artifact 的引用。 */
  activationDecisionRef: string
  /** SHA-256 evidence digest（用于 Resume 校验一致性）。 */
  evidenceDigest: string
  /** 已激活的 skillKey 列表。 */
  activatedSkillKeys: string[]
  /** advisory 候选的 skillKey 列表（不注入，仅记录 ref）。 */
  advisorySkillKeys: string[]
  /** 完整的 ActivationDecision 序列化副本（供 section builder 消费）。 */
  decision: ActivationDecision
}

// ── PDM 生成路径 Stage ID → 注入点 1–6 映射 ────────────────────────

/**
 * PDM 生成路径 Stage ID 到 Skill 知识注入点 1–6 的映射表。
 *
 * 对齐 PRD §2.4.1：stage=1 → Intent/章程，stage=2 → WBS 结构，
 * stage=3 → 架构/模式，stage=4 → 任务/依赖，stage=5 → 质量/测试，
 * stage=6 → 评审/评分。
 *
 * Stage ID 取自 compiler-spec Stage catalog（PDM 生成路径）。
 */
export const PDM_STAGE_INJECTION_MAP: Record<string, number> = {
  intent_parsing: 1,
  project_charter: 1,
  wbs_generation: 2,
  wbs_structure: 2,
  architecture_planning: 3,
  architecture_design: 3,
  task_generation: 4,
  dependency_resolution: 4,
  quality_planning: 5,
  test_planning: 5,
  review_scoring: 6,
  risk_identification: 5,
  resource_suggestion: 4,
}

// ── 纯函数：projectSkillKnowledge ──────────────────────────────────

/**
 * 把 ActivationDecision 的已激活 Skill 按 Stage 过滤，投影为按 Skill 分组的条目列表。
 *
 * 两步过滤：
 * 1. Skill 级：只取 decision.activatedSkills 中 skill.activation.stages 含 stageId
 *    （或 stages 未声明/空 = 通行）的 Skill。
 * 2. 条目级：对该 Skill 的 KnowledgeBundle 六类条目，只取 entry.stage 匹配当前注入点
 *    （或 stage 未声明 = 通行）的条目。
 *
 * 条目形状兜底：若 entry 缺 id/title/content，fail-soft 跳过并收集 warning。
 *
 * @param decision 激活决策（仅消费 activatedSkills，不碰 advisoryCandidates）
 * @param stageId 当前 Compiler Stage ID
 * @returns 按 Skill 分组的投影结果与 warnings
 */
export function projectSkillKnowledge(
  decision: ActivationDecision,
  stageId: string,
): {
  projected: Array<{ skillKey: string; version: string; entries: SkillKnowledgeEntry[] }>
  warnings: string[]
} {
  const warnings: string[] = []
  const injectionPoint = PDM_STAGE_INJECTION_MAP[stageId]

  const projected: Array<{ skillKey: string; version: string; entries: SkillKnowledgeEntry[] }> = []

  for (const entry of decision.activatedSkills) {
    const { skill } = entry

    // Skill 级过滤：stages 未声明/空 = 通行
    const skillStages = skill.activation.stages
    if (skillStages && skillStages.length > 0) {
      if (!skillStages.includes(stageId)) continue
    }

    // 条目级过滤：从 KnowledgeBundle 六类中提取匹配条目
    const bundle: KnowledgeBundle = skill.knowledge
    const categories: Array<
      keyof Pick<
        KnowledgeBundle,
        'rules' | 'patterns' | 'antiPatterns' | 'examples' | 'checklists' | 'rubric'
      >
    > = ['rules', 'patterns', 'antiPatterns', 'examples', 'checklists', 'rubric']

    const matchedEntries: SkillKnowledgeEntry[] = []

    for (const cat of categories) {
      const items = bundle[cat]
      if (!Array.isArray(items)) continue

      for (const item of items) {
        if (!item || typeof item !== 'object') continue

        const rec = item as Record<string, unknown>

        // 条目级 stage 过滤
        if (injectionPoint !== undefined && rec.stage !== undefined) {
          if (rec.stage !== injectionPoint) continue
        }

        // 形状兜底：缺 id/title/content 则跳过 + warning
        if (!rec.id || !rec.title || !rec.content) {
          warnings.push(
            `skill-compiler-integration: 条目缺少 id/title/content，已跳过 (skillKey=${skill.skillKey}, category=${cat})`,
          )
          continue
        }

        matchedEntries.push({
          id: String(rec.id),
          title: String(rec.title),
          content: String(rec.content),
          stage: rec.stage !== undefined ? Number(rec.stage) : undefined,
          provenance: String(rec.provenance ?? 'unknown'),
          sourceRefs: Array.isArray(rec.sourceRefs)
            ? (rec.sourceRefs as SkillKnowledgeEntry['sourceRefs'])
            : undefined,
        })
      }
    }

    if (matchedEntries.length > 0) {
      projected.push({
        skillKey: skill.skillKey,
        version: skill.version,
        entries: matchedEntries,
      })
    }
  }

  return { projected, warnings }
}

// ── 纯函数：assertNoL3Synthetic ────────────────────────────────────

/**
 * 校验知识条目不含 L3 合成来源。
 *
 * V3 红线 1：L3 Synthetic 绝不注入生产 Stage。
 * 若任一 sourceRef 的 layer === 'L3'，该条目被拒绝注入，fail-soft 不抛错。
 *
 * @param entries 待校验的知识条目
 * @returns 通过校验的条目、被拒绝的条目、warnings
 */
export function assertNoL3Synthetic(entries: SkillKnowledgeEntry[]): {
  allowed: SkillKnowledgeEntry[]
  rejected: SkillKnowledgeEntry[]
  warnings: string[]
} {
  const allowed: SkillKnowledgeEntry[] = []
  const rejected: SkillKnowledgeEntry[] = []
  const warnings: string[] = []

  for (const entry of entries) {
    const hasL3 = entry.sourceRefs?.some((ref) => ref.layer === 'L3')

    if (hasL3) {
      rejected.push(entry)
      warnings.push(
        `skill-compiler-integration: L3 Synthetic 条目被拒绝注入 (id=${entry.id}, title=${entry.title})`,
      )
    } else {
      allowed.push(entry)
    }
  }

  return { allowed, rejected, warnings }
}

// ── 纯函数：applyKnowledgeBudget ───────────────────────────────────

/**
 * 按 token 预算裁剪注入知识条目。
 *
 * 四级降级：full → compact → ref-only → 完全裁剪。
 * - full: 完整条目 { id, title, content, stage, provenance, sourceRefs }
 * - compact: 仅 { id, title, provenance }（去 content/sourceRefs）
 * - ref-only: 仅 sourceRefs（skillKey/version ref，无条目正文）
 * - cut: 完全裁剪（返回 null section）
 *
 * token 估算：中文 ≈ 2 token/字，英文 ≈ 0.25 token/字。
 *
 * @param projected 按 Skill 分组的投影条目（来自 projectSkillKnowledge）
 * @param tokenBudget 剩余 token 预算
 * @returns 裁剪后的 section 或 null（完全裁剪），以及裁剪元数据
 */
export function applyKnowledgeBudget(
  projected: Array<{ skillKey: string; version: string; entries: SkillKnowledgeEntry[] }>,
  tokenBudget: number,
): {
  section: SkillKnowledgeSection | null
  cutLevel: SkillKnowledgeCutLevel
  cutReason: string
  includedCount: number
} {
  if (projected.length === 0) {
    return {
      section: null,
      cutLevel: 'cut',
      cutReason: 'empty_input',
      includedCount: 0,
    }
  }

  if (tokenBudget <= 0) {
    return {
      section: null,
      cutLevel: 'cut',
      cutReason: 'no_budget',
      includedCount: 0,
    }
  }

  // 收集所有条目
  const allEntries: Array<{ entry: SkillKnowledgeEntry; skillKey: string; version: string }> = []
  for (const group of projected) {
    for (const entry of group.entries) {
      allEntries.push({ entry, skillKey: group.skillKey, version: group.version })
    }
  }

  if (allEntries.length === 0) {
    return {
      section: null,
      cutLevel: 'cut',
      cutReason: 'no_entries_after_filter',
      includedCount: 0,
    }
  }

  // 估算 token（简单实现：中文 2 token/字，ASCII 0.25 token/字）
  const estimateToken = (s?: string | null): number => {
    if (!s) return 0
    let tokens = 0
    for (let i = 0; i < s.length; i++) {
      tokens += s.charCodeAt(i) > 0x7f ? 2 : 0.25
    }
    return Math.ceil(tokens)
  }

  // full 级别 token 估算：每个条目 id + title + content + sourceRefs
  const fullTokenPerEntry = allEntries.map(({ entry }) => {
    const idTokens = estimateToken(entry.id)
    const titleTokens = estimateToken(entry.title)
    const contentTokens = estimateToken(entry.content)
    const refsTokens = entry.sourceRefs
      ? entry.sourceRefs.reduce(
          (sum, r) => sum + estimateToken(r.sourceId) + estimateToken(r.layer),
          0,
        )
      : 0
    return idTokens + titleTokens + contentTokens + refsTokens + 10 // overhead
  })

  const fullTotal = fullTokenPerEntry.reduce((sum, t) => sum + t, 0)

  // 检查 full 级别是否可行
  if (fullTotal <= tokenBudget) {
    // 全部 full
    const entries: SkillKnowledgeEntry[] = allEntries.map(({ entry }) => entry)
    const skillRefs = extractSkillRefs(projected)
    return {
      section: {
        skillRefs,
        entries,
        summaryLevel: 'full',
      },
      cutLevel: 'full',
      cutReason: '',
      includedCount: entries.length,
    }
  }

  // compact 级别：仅 id + title + provenance
  const compactTokenPerEntry = allEntries.map(({ entry }) => {
    return (
      estimateToken(entry.id) + estimateToken(entry.title) + estimateToken(entry.provenance) + 5
    )
  })
  const compactTotal = compactTokenPerEntry.reduce((sum, t) => sum + t, 0)

  if (compactTotal <= tokenBudget) {
    const entries: SkillKnowledgeEntry[] = allEntries.map(({ entry }) => ({
      id: entry.id,
      title: entry.title,
      content: '', // compact: 去 content
      stage: entry.stage,
      provenance: entry.provenance,
      sourceRefs: undefined, // compact: 去 sourceRefs
    }))
    const skillRefs = extractSkillRefs(projected)
    return {
      section: {
        skillRefs,
        entries,
        summaryLevel: 'compact',
      },
      cutLevel: 'compact',
      cutReason: `budget_limit: ${fullTotal} > ${tokenBudget}, compact ${compactTotal} tokens`,
      includedCount: entries.length,
    }
  }

  // ref-only 级别：仅 skillKey/version refs，无条目正文
  const refTokens = projected.length * 20 // 每个 Skill ref ~20 tokens
  if (refTokens <= tokenBudget) {
    const skillRefs = extractSkillRefs(projected)
    return {
      section: {
        skillRefs,
        entries: [],
        summaryLevel: 'ref-only',
      },
      cutLevel: 'ref-only',
      cutReason: `budget_limit: compact ${compactTotal} > ${tokenBudget}, ref-only ${refTokens} tokens`,
      includedCount: 0,
    }
  }

  // 完全裁剪
  const skillRefs = extractSkillRefs(projected)
  return {
    section: null,
    cutLevel: 'cut',
    cutReason: `budget_limit: ref-only ${refTokens} > ${tokenBudget}`,
    includedCount: 0,
    cutSkillRefs: skillRefs.map((s) => s.skillKey),
  } as {
    section: null
    cutLevel: SkillKnowledgeCutLevel
    cutReason: string
    includedCount: number
    cutSkillRefs?: string[]
  }
}

/** 从 projected 分组提取去重的 skillRefs */
function extractSkillRefs(
  projected: Array<{ skillKey: string; version: string; entries: SkillKnowledgeEntry[] }>,
): Array<{ skillKey: string; version: string }> {
  const seen = new Set<string>()
  const refs: Array<{ skillKey: string; version: string }> = []
  for (const g of projected) {
    if (!seen.has(g.skillKey)) {
      seen.add(g.skillKey)
      refs.push({ skillKey: g.skillKey, version: g.version })
    }
  }
  return refs
}
