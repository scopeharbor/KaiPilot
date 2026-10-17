/**
 * v3-skill-knowledge-authoring —— Skill 知识包创作共享契约与确定性纯函数引擎。
 *
 * 定位：Skill System 第四块地基——把 Registry 的 KnowledgeBundle 空顶层形状变成
 * 可创作、可校验、可溯源、可审查的真实知识。提供结构化 KnowledgeSection 单元、
 * 确定性 assemble/validate/diff 引擎与 fixture AI 辅助适配器，前后端零运行时依赖。
 *
 * 零运行时依赖原则：不导入 zod / adonisjs / compiler-spec / Date.now()。
 * 导入 ./compiler-skill 的 KnowledgeBundle/Skill，不重新定义二者。
 *
 * @aiproj/types 零依赖约束
 */

import type { KnowledgeBundle } from './compiler-skill.js'

// ── KnowledgeSectionKind ───────────────────────────────────────────────

/** 知识 section 种类，六类，对齐 KnowledgeBundle 顶层形状。 */
export const KNOWLEDGE_SECTION_KINDS = [
  'rules',
  'patterns',
  'antiPatterns',
  'examples',
  'checklists',
  'rubric',
] as const

export type KnowledgeSectionKind = (typeof KNOWLEDGE_SECTION_KINDS)[number]

export function isKnowledgeSectionKind(value: string): value is KnowledgeSectionKind {
  return (KNOWLEDGE_SECTION_KINDS as readonly string[]).includes(value)
}

// ── KnowledgeSourceRef ─────────────────────────────────────────────────

/** 知识源引用（复用 traceability SourceRef 模式，对齐四层底座 D3）。 */
export interface KnowledgeSourceRef {
  /** 四层底座 layer（L1/L2/L3/L4），手写片段可为空。 */
  layer?: string
  /** 源条目 ID，手写片段可为空。 */
  sourceId?: string
  /** 源条目内 section 引用。 */
  section?: string
  /** 是否手写（manual: true 时不引用外部条目）。 */
  manual: boolean
}

// ── KnowledgeSection ───────────────────────────────────────────────────

/** 知识 section 状态。 */
export type KnowledgeSectionStatus = 'draft' | 'reviewed' | 'source_linked'

/** 知识 section 来源信息。 */
export interface KnowledgeSectionProvenance {
  /** 来源类型。 */
  source?: 'ai_assisted' | 'manual' | 'imported'
  /** 原始作者 ID。 */
  authorId?: number
  /** 导入时间（ISO 8601）。 */
  importedAt?: string
  /** 导入备注。 */
  note?: string
}

/**
 * 知识 section —— 可编辑、可校验、可溯源的结构化原子单元。
 *
 * 每个 section 对应 KnowledgeBundle 中某一 kind 数组的一个条目。
 */
export interface KnowledgeSection {
  /** 唯一标识（创作空间内唯一，UUID 或语义 id）。 */
  id: string
  /** 知识种类。 */
  kind: KnowledgeSectionKind
  /** 标题（人类可读）。 */
  title: string
  /** 内容 —— per-kind 最小结构见 validateBundleStructure。 */
  content: Record<string, unknown>
  /** 知识源引用列表。 */
  sourceRefs: KnowledgeSourceRef[]
  /** 来源信息。 */
  provenance?: KnowledgeSectionProvenance
  /** 状态。 */
  status: KnowledgeSectionStatus
}

// ── AuthoringDraft ─────────────────────────────────────────────────────

/** 创作草稿状态。 */
export type AuthoringDraftStatus = 'pending' | 'committed' | 'discarded'

/**
 * 知识创作草稿 —— 独立于 Skill 生命周期的知识编辑工作副本。
 *
 * 一个 Skill 同时至多一个 pending 草稿；committed/discarded 为终态。
 */
export interface AuthoringDraft {
  /** 目标 Skill ID。 */
  skillId: number
  /** 知识 sections 列表。 */
  sections: KnowledgeSection[]
  /** 创作基准版本（Skill.version）。 */
  baseVersion: string
  /** 是否 AI 辅助生成。 */
  aiAssisted: boolean
  /** 草稿状态。 */
  status: AuthoringDraftStatus
  /** 创建者 ID。 */
  createdBy: number
  /** 最后更新者 ID。 */
  updatedBy: number
  /** 创建时间（ISO 8601）。 */
  createdAt: string
  /** 更新时间（ISO 8601）。 */
  updatedAt: string
}

// ── AuthoringPreview ────────────────────────────────────────────────────

/** 创作预览 DTO —— previewDraft 的返回类型。 */
export interface AuthoringPreview {
  /** 组装后的 KnowledgeBundle。 */
  bundle: KnowledgeBundle
  /** 校验问题清单。 */
  issues: StructureIssue[]
  /** 与当前 Skill.knowledge 的差异（无当前 knowledge 时为空 diff）。 */
  diff: BundleDiff
}

// ── BundleDiff ──────────────────────────────────────────────────────────

/** Bundle 差异 —— diffBundles 的返回类型。 */
export interface BundleDiff {
  /** 新增的 section（按 id）。 */
  added: KnowledgeSection[]
  /** 修改的 section（按 id）。 */
  modified: KnowledgeSection[]
  /** 删除的 section（按 id）。 */
  removed: KnowledgeSection[]
}

// ── StructureIssue ─────────────────────────────────────────────────────

/** 结构校验问题。 */
export interface StructureIssue {
  /** 相关 section ID。 */
  sectionId: string
  /** 问题码。 */
  code: string
  /** 人类可读消息。 */
  message: string
}

// ── 纯函数：assembleBundle ─────────────────────────────────────────────

/**
 * 把 KnowledgeSection[] 按 kind 投影回 KnowledgeBundle 顶层形状。
 *
 * 确定性：相同输入产出相同输出，不依赖时间/随机/外部状态。
 *
 * @param sections 知识 sections
 * @returns KnowledgeBundle 顶层形状
 */
export function assembleBundle(sections: KnowledgeSection[]): KnowledgeBundle {
  const bundle: KnowledgeBundle = {}

  for (const section of sections) {
    const arr = bundle[section.kind] as unknown[] | undefined
    if (arr) {
      arr.push(section.content)
    } else {
      bundle[section.kind] = [section.content]
    }
  }

  return bundle
}

// ── 纯函数：validateBundleStructure ────────────────────────────────────

/** Per-kind content 最小结构定义。 */
const MIN_CONTENT_KEYS: Record<KnowledgeSectionKind, string[]> = {
  rules: ['summary', 'detail'],
  patterns: ['summary', 'detail'],
  antiPatterns: ['summary', 'detail'],
  examples: ['input', 'output', 'note'],
  checklists: ['item', 'required'],
  rubric: ['criterion', 'weight'],
}

/**
 * 对 KnowledgeSection[] 做比 KnowledgeBundle 顶层形状更强的子结构校验。
 *
 * 校验覆盖：
 * - kind 合法性
 * - id 唯一性
 * - content 按 kind 的最小结构
 * - sourceRefs 形状（数组 + layer/sourceId 或 manual:true）
 *
 * 确定性：不调用外部服务/数据库，不依赖时间/随机。
 *
 * @param sections 知识 sections
 * @returns 问题清单（空数组 = 全部合法）
 */
export function validateBundleStructure(sections: KnowledgeSection[]): StructureIssue[] {
  const issues: StructureIssue[] = []
  const seenIds = new Set<string>()

  for (const section of sections) {
    // kind 合法性
    if (!isKnowledgeSectionKind(section.kind)) {
      issues.push({
        sectionId: section.id,
        code: 'INVALID_KIND',
        message: `Unknown section kind: "${section.kind}". Must be one of: ${KNOWLEDGE_SECTION_KINDS.join(', ')}`,
      })
      continue
    }

    // id 唯一性
    if (seenIds.has(section.id)) {
      issues.push({
        sectionId: section.id,
        code: 'DUPLICATE_ID',
        message: `Duplicate section id: "${section.id}"`,
      })
    }
    seenIds.add(section.id)

    // content 最小结构
    const requiredKeys = MIN_CONTENT_KEYS[section.kind]
    const content = section.content
    if (typeof content !== 'object' || content === null) {
      issues.push({
        sectionId: section.id,
        code: 'INVALID_CONTENT_TYPE',
        message: `Section "${section.id}" content must be a non-null object`,
      })
      continue
    }
    for (const key of requiredKeys) {
      if (!(key in content)) {
        issues.push({
          sectionId: section.id,
          code: 'MISSING_CONTENT_KEY',
          message: `Section "${section.id}" (kind: ${section.kind}) missing required content key: "${key}"`,
        })
      }
    }

    // sourceRefs 形状
    if (!Array.isArray(section.sourceRefs)) {
      issues.push({
        sectionId: section.id,
        code: 'INVALID_SOURCE_REFS',
        message: `Section "${section.id}" sourceRefs must be an array`,
      })
    } else {
      for (const ref of section.sourceRefs) {
        if (!ref.manual && !ref.sourceId && !ref.layer) {
          issues.push({
            sectionId: section.id,
            code: 'INVALID_SOURCE_REF_SHAPE',
            message: `Section "${section.id}" sourceRef must have (layer + sourceId) or manual:true`,
          })
        }
      }
    }
  }

  return issues
}

// ── 纯函数：diffBundles ────────────────────────────────────────────────

/**
 * 对两个 sections 集合按 section.id 对齐，返回确定性差异。
 *
 * 确定性：相同输入产出相同差异，不依赖时间/随机/外部状态。
 *
 * @param base 基准 sections（如当前 Skill.knowledge 组装后的 sections）
 * @param draft 草稿 sections
 * @returns BundleDiff
 */
export function diffBundles(base: KnowledgeSection[], draft: KnowledgeSection[]): BundleDiff {
  const baseMap = new Map<string, KnowledgeSection>()
  for (const s of base) baseMap.set(s.id, s)

  const draftMap = new Map<string, KnowledgeSection>()
  for (const s of draft) draftMap.set(s.id, s)

  const added: KnowledgeSection[] = []
  const modified: KnowledgeSection[] = []
  const removed: KnowledgeSection[] = []

  // 新增 + 修改
  for (const s of draft) {
    const baseSection = baseMap.get(s.id)
    if (!baseSection) {
      added.push(s)
    } else if (JSON.stringify(baseSection) !== JSON.stringify(s)) {
      modified.push(s)
    }
  }

  // 删除
  for (const s of base) {
    if (!draftMap.has(s.id)) {
      removed.push(s)
    }
  }

  return { added, modified, removed }
}

// ── Fixture AI 辅助适配器 ──────────────────────────────────────────────

/** AI 辅助生成 hint 参数。 */
export interface AiAssistHint {
  /** 目标领域（如 "software_engineering"）。 */
  domain?: string
  /** 目标用途（如 "code_review"）。 */
  purpose?: string
  /** 项目复杂度。 */
  complexity?: number
  /** 期望的 section kind。 */
  targetKind?: KnowledgeSectionKind
}

/** AI 辅助生成结果。 */
export interface AiAssistResult {
  /** 生成的 advisory sections（aiAssisted: true）。 */
  sections: KnowledgeSection[]
  /** 消耗的 token 估算（fixture 为 0）。 */
  tokensUsed: number
}

/**
 * Fixture AI 辅助适配器 —— 确定性生成 advisory section 草稿。
 *
 * 零真实模型调用、零外部 HTTP、零随机、零时间依赖。
 * 相同 hint 输入产出完全一致的 KnowledgeSection[]。
 *
 * @param hint AI 辅助提示
 * @returns 确定性 advisory sections
 */
export function generateFixtureAiAssistSections(hint: AiAssistHint): AiAssistResult {
  const kind = hint.targetKind ?? 'rules'
  const domain = hint.domain ?? 'general'
  const purpose = hint.purpose ?? 'general'

  // 确定性 fixture：每个 kind 提供一组样例
  const fixtureContent: Record<KnowledgeSectionKind, Record<string, unknown>> = {
    rules: {
      summary: `${domain} 领域规则：${purpose}`,
      detail: `此规则适用于复杂度 ${hint.complexity ?? 'medium'} 的项目场景。基于通用最佳实践生成，需领域专家审核。`,
    },
    patterns: {
      summary: `${domain} 通用模式`,
      detail: `在 ${purpose} 场景下推荐的模式，适用于中等复杂度项目。`,
    },
    antiPatterns: {
      summary: `${domain} 常见反模式`,
      detail: `在 ${purpose} 中应避免的做法，可能降低效率或引入风险。`,
    },
    examples: {
      input: `${domain} 典型输入场景`,
      output: '预期输出结果',
      note: `复杂度 ${hint.complexity ?? 'medium'} 的参考示例。`,
    },
    checklists: {
      item: `${domain} ${purpose} 检查项`,
      required: true,
    },
    rubric: {
      criterion: `${domain} 评估维度`,
      weight: 50,
    },
  }

  const section: KnowledgeSection = {
    id: `fixture-${kind}-${domain}-${purpose}`,
    kind,
    title: `${domain} ${kind} (AI 辅助草稿)`,
    content: fixtureContent[kind],
    sourceRefs: [{ manual: true }],
    provenance: { source: 'ai_assisted' },
    status: 'draft',
  }

  return {
    sections: [section],
    tokensUsed: 0,
  }
}
