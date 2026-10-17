/**
 * compiler-skill —— Skill Registry 共享契约与确定性纯函数引擎（V3 四层知识体系第一块地基）。
 *
 * 定义 Skill 实体的生命周期状态、分类体系、激活规则、知识包顶层形状、查询/匹配 DTO，
 * 以及两个纯函数引擎：生命周期状态机与确定性匹配/优先级评分器。
 *
 * 零运行时依赖原则：不导入 zod / adonisjs / compiler-spec / Date.now()。
 * 参考时间由调用方显式传入（参照 D4），保持纯函数确定性。
 *
 * @aiproj/types 零依赖约束
 */

// ── 生命周期状态 ──────────────────────────────────────────────────

export const SKILL_LIFECYCLE_STATUSES = [
  'draft',
  'eval',
  'active',
  'deprecated',
  'quality_alert',
] as const

export type SkillLifecycleStatus = (typeof SKILL_LIFECYCLE_STATUSES)[number]

export function isSkillLifecycleStatus(value: string): value is SkillLifecycleStatus {
  return (SKILL_LIFECYCLE_STATUSES as readonly string[]).includes(value)
}

// ── 生命周期转移表 ────────────────────────────────────────────────

/**
 * 显式转移表（D3）。key = `${from}→${to}`。
 * - `deprecated` 为终态，不可转出。
 * - `eval` 门禁：禁止 `draft→active` 跳级（产品哲学 P3「Eval 驱动」）。
 * - `eval` 仅为人工评审治理阶段，本期不触发任何自动评测。
 */
export const SKILL_LIFECYCLE_TRANSITIONS: Record<string, true> = {
  'draft→eval': true,
  'eval→active': true,
  'eval→draft': true,
  'active→deprecated': true,
  'active→quality_alert': true,
  'quality_alert→active': true,
  'quality_alert→deprecated': true,
}

// ── 转移原因码 ────────────────────────────────────────────────────

export const SKILL_TRANSITION_REASON_CODES = [
  'SKILL_TRANSITION_INVALID',
  'SKILL_TERMINAL_STATE',
  'SKILL_EVAL_GATE_REQUIRED',
  'SKILL_TRANSITION_GRANTED',
] as const

export type SkillTransitionReasonCode = (typeof SKILL_TRANSITION_REASON_CODES)[number]

// ── 分类维 ────────────────────────────────────────────────────────

export const SKILL_CATEGORY_PRIMARY_TYPES = [
  'domain',
  'methodology',
  'tool',
  'regulation',
  'template',
] as const

export type SkillCategoryPrimaryType = (typeof SKILL_CATEGORY_PRIMARY_TYPES)[number]

export interface SkillCategory {
  /** 一级分类：领域/方法论/工具/法规/模板。 */
  primary: SkillCategoryPrimaryType
  /** 二级分类（可选，自由字符串，如 "software_engineering"、"risk_management"）。 */
  secondary?: string
  /** 三级标签（可选，自由字符串数组）。 */
  tertiary?: string[]
}

// ── 激活规则 ──────────────────────────────────────────────────────

export interface SkillComplexityRange {
  min?: number
  max?: number
}

export interface ActivationRule {
  /** 匹配的 Compiler Stage ID 列表（空 = 不限制）。 */
  stages?: string[]
  /** 匹配的项目类型列表（空 = 不限制）。 */
  projectTypes?: string[]
  /** 匹配的领域标签列表（空 = 不限制）。 */
  domains?: string[]
  /** 匹配的项目复杂度范围（缺省侧不限制）。 */
  complexityRange?: SkillComplexityRange
  /** 结构化 predicate 条件（可选，语义由激活引擎按宽松评估）。 */
  condition?: Record<string, unknown>
  /** 激活优先级（0-100），值越大优先级越高，默认 50。 */
  priority?: number
}

// ── 知识包顶层形状 ───────────────────────────────────────────────

export interface KnowledgeBundle {
  /** 规则（数组，自由 JSON 形状）。 */
  rules?: unknown[]
  /** 模式/范式（数组）。 */
  patterns?: unknown[]
  /** 反模式（数组）。 */
  antiPatterns?: unknown[]
  /** 示例（数组）。 */
  examples?: unknown[]
  /** 检查清单（数组）。 */
  checklists?: unknown[]
  /** 评估标准（数组或对象）。 */
  rubric?: unknown[] | Record<string, unknown>
  /** 扩展字段（自由 JSON）。 */
  [key: string]: unknown
}

// ── 来源追踪 ──────────────────────────────────────────────────────

export interface SkillProvenance {
  /** 来源 Skill 的全名（如 "org/acme-domain-v1"）。 */
  sourceSkillKey?: string
  /** 来源版本。 */
  sourceVersion?: string
  /** 导入时间（ISO 8601 字符串，非 Date 对象以保持可序列化）。 */
  importedAt?: string
  /** 导入备注。 */
  importNote?: string
}

// ── Skill 实体（全量） ────────────────────────────────────────────

export interface Skill {
  id: number
  organizationId: number
  skillKey: string
  name: string
  version: string
  description: string
  status: SkillLifecycleStatus
  category: SkillCategory
  tags: string[]
  dependencies: string[]
  activation: ActivationRule
  knowledge: KnowledgeBundle
  provenance?: SkillProvenance
  basePriority: number
  createdBy: number
  updatedBy: number
  createdAt: string
  updatedAt: string
}

// ── 低敏投影（审计/列表用，不含 knowledge 全文） ─────────────────

export interface SkillLowSensitiveProjection {
  id: number
  organizationId: number
  skillKey: string
  name: string
  version: string
  status: SkillLifecycleStatus
  category: SkillCategory
  tags: string[]
  basePriority: number
  createdBy: number
  updatedBy: number
  createdAt: string
  updatedAt: string
}

// ── 查询/匹配 DTO ────────────────────────────────────────────────

export interface SkillQuery {
  /** 按 Skill 名称/描述关键词模糊搜索。 */
  search?: string
  /** 按状态过滤。 */
  status?: SkillLifecycleStatus
  /** 按一级分类过滤。 */
  categoryPrimary?: SkillCategoryPrimaryType
  /** 按标签过滤（交集）。 */
  tags?: string[]
  /** 排序字段。 */
  sortBy?: string
  /** 排序方向。 */
  sortOrder?: 'asc' | 'desc'
  /** 分页。 */
  page?: number
  perPage?: number
}

export interface SkillMatchQuery {
  /** 当前的 Compiler Stage ID。 */
  stageId?: string
  /** 项目类型。 */
  projectType?: string
  /** 项目领域标签。 */
  domains?: string[]
  /** 项目复杂度。 */
  complexity?: number
  /** 返回的最大匹配数。 */
  limit?: number
}

export interface SkillMatchResult {
  skill: Skill
  /** 匹配得分（basePriority × domainMatch × typeMatch × recencyBoost）。 */
  score: number
  /** 命中的激活维度详情。 */
  matchedDimensions: {
    stage?: boolean
    projectType?: boolean
    domain?: boolean
    complexity?: boolean
  }
}

// ── 生命周期转移检验结果 ─────────────────────────────────────────

export interface TransitionValidation {
  valid: boolean
  reasonCode: SkillTransitionReasonCode
  resultingStatus?: SkillLifecycleStatus
}

// ── 纯函数：生命周期状态机 ───────────────────────────────────────

/**
 * 校验 Skill 生命周期状态转移是否合法（D3）。
 *
 * 规则：
 * - `deprecated` 为终态，不可转出。
 * - 禁止 `draft→active` 跳级（需经 eval 门）。
 * - 合法的转移必须在 `SKILL_LIFECYCLE_TRANSITIONS` 表中显式声明。
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns TransitionValidation 包含是否合法、原因码和结果状态
 */
export function validateSkillLifecycleTransition(
  from: SkillLifecycleStatus,
  to: SkillLifecycleStatus,
): TransitionValidation {
  // 终态判定
  if (from === 'deprecated') {
    return {
      valid: false,
      reasonCode: 'SKILL_TERMINAL_STATE',
    }
  }

  // Eval 门禁：禁止 draft→active 跳级
  if (from === 'draft' && to === 'active') {
    return {
      valid: false,
      reasonCode: 'SKILL_EVAL_GATE_REQUIRED',
    }
  }

  // 查转移表
  const key = `${from}→${to}`
  if (SKILL_LIFECYCLE_TRANSITIONS[key]) {
    return {
      valid: true,
      reasonCode: 'SKILL_TRANSITION_GRANTED',
      resultingStatus: to,
    }
  }

  // 非法转移
  return {
    valid: false,
    reasonCode: 'SKILL_TRANSITION_INVALID',
  }
}

// ── 纯函数：匹配引擎 ─────────────────────────────────────────────

/**
 * 计算领域匹配因子（0~1）。
 * 取 Skill 激活规则中的 domains 与查询 domains 的交集比例。
 * 双方均空 = 1，Skill 未限制 = 1，查询无指定 = 1。
 */
function computeDomainMatch(activation: ActivationRule, queryDomains?: string[]): number {
  if (!activation.domains || activation.domains.length === 0) return 1
  if (!queryDomains || queryDomains.length === 0) return 1

  const matchCount = activation.domains.filter((d) => queryDomains.includes(d)).length
  if (matchCount === 0) return 0
  return matchCount / Math.max(activation.domains.length, queryDomains.length)
}

/**
 * 计算项目类型匹配因子（0 或 1）。
 * Skill 未限制类型 = 1，查询无类型 = 1，类型匹配 = 1，否则 = 0（硬过滤）。
 */
function computeTypeMatch(activation: ActivationRule, queryProjectType?: string): number {
  if (!activation.projectTypes || activation.projectTypes.length === 0) return 1
  if (!queryProjectType) return 1
  return activation.projectTypes.includes(queryProjectType) ? 1 : 0
}

/**
 * 计算新鲜度提升因子（1.0~1.2）。
 * 最近 7 天更新 = 1.2，7~30 天 = 1.1，30 天以上 = 1.0。
 *
 * @param referenceTime ISO 8601 参考时间字符串
 * @param updatedAt ISO 8601 更新时间字符串
 */
function computeRecencyBoost(referenceTime: string, updatedAt: string): number {
  const ref = new Date(referenceTime).getTime()
  const upd = new Date(updatedAt).getTime()
  const diffDays = (ref - upd) / (1000 * 60 * 60 * 24)

  if (diffDays <= 7) return 1.2
  if (diffDays <= 30) return 1.1
  return 1.0
}

/**
 * 确定性匹配/优先级评分器（D4）。
 *
 * 1. 过滤：仅返回 `active` 状态的 Skill，再按 activation 规则（stages/projectTypes/domains/complexityRange）过滤。
 * 2. 排序：`basePriority × domainMatch × typeMatch × recencyBoost` 降序，同分按 `version` 语义版本高者优先。
 * 3. 参考时间由 `opts.referenceTime` 显式传入，函数内不调 `Date.now()`。
 *
 * @param skills 待匹配的 Skill 数组（需已按组织过滤）
 * @param query 匹配查询条件
 * @param opts 可选项：referenceTime（ISO 8601）和 limit
 * @returns 排序后的匹配结果
 */
export function matchSkills(
  skills: Skill[],
  query: SkillMatchQuery,
  opts?: { referenceTime?: string; limit?: number },
): SkillMatchResult[] {
  const refTime = opts?.referenceTime ?? new Date(0).toISOString()
  const limit = opts?.limit ?? 10

  // 1. 仅 active
  const active = skills.filter((s) => s.status === 'active')
  if (active.length === 0) return []

  // 2. activation 过滤
  const filtered = active.filter((s) => {
    const a = s.activation

    // Stage 过滤
    if (a.stages && a.stages.length > 0 && query.stageId) {
      if (!a.stages.includes(query.stageId)) return false
    }

    // ProjectType 过滤
    if (a.projectTypes && a.projectTypes.length > 0 && query.projectType) {
      if (!a.projectTypes.includes(query.projectType)) return false
    }

    // Domain 过滤（交集非空）
    if (a.domains && a.domains.length > 0 && query.domains && query.domains.length > 0) {
      const hasMatch = a.domains.some((d) => query.domains!.includes(d))
      if (!hasMatch) return false
    }

    // Complexity 范围过滤
    if (a.complexityRange && query.complexity !== undefined) {
      const { min, max } = a.complexityRange
      if (min !== undefined && query.complexity < min) return false
      if (max !== undefined && query.complexity > max) return false
    }

    return true
  })

  if (filtered.length === 0) return []

  // 3. 评分 & 排序
  const scored = filtered.map((s) => {
    const domainMatch = computeDomainMatch(s.activation, query.domains)
    const typeMatch = computeTypeMatch(s.activation, query.projectType)
    const recencyBoost = computeRecencyBoost(refTime, s.updatedAt)

    const score = s.basePriority * domainMatch * typeMatch * recencyBoost

    return {
      skill: s,
      score,
      matchedDimensions: {
        stage: s.activation.stages
          ? s.activation.stages.length === 0 || !query.stageId
            ? undefined
            : s.activation.stages.includes(query.stageId)
          : undefined,
        projectType: s.activation.projectTypes
          ? s.activation.projectTypes.length === 0 || !query.projectType
            ? undefined
            : s.activation.projectTypes.includes(query.projectType)
          : undefined,
        domain: s.activation.domains
          ? s.activation.domains.length === 0 || !query.domains || query.domains.length === 0
            ? undefined
            : s.activation.domains.some((d) => query.domains!.includes(d))
          : undefined,
        complexity: s.activation.complexityRange
          ? query.complexity !== undefined
            ? (s.activation.complexityRange.min === undefined ||
                query.complexity >= s.activation.complexityRange.min) &&
              (s.activation.complexityRange.max === undefined ||
                query.complexity <= s.activation.complexityRange.max)
            : undefined
          : undefined,
      },
    }
  })

  // 同分时按 version 高者优先（简单字符串比较，semver 语义）
  scored.sort((a, b) => {
    const scoreDiff = b.score - a.score
    if (scoreDiff !== 0) return scoreDiff

    // 按 version 降序（字符串比较，合理假设 semver 格式一致）
    return b.skill.version.localeCompare(a.skill.version)
  })

  return scored.slice(0, limit)
}
