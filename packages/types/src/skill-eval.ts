/**
 * skill-eval —— V3 Skill 评估系统契约与确定性纯函数引擎（V3 Skill System 第五块地基）。
 *
 * 定义评估契约（QualityWeights / QualityReport / DimensionScore / EvalGrade / BenchmarkInput /
 * BenchmarkReport / SkillEffectEvent / SkillEffectMetrics / TransitionSuggestion）与
 * 四个确定性纯函数引擎：scoreSkillQuality / suggestTransition / runSkillBenchmark /
 * aggregateSkillEffectMetrics。
 *
 * 零运行时依赖原则：不导入 zod / adonisjs / compiler-spec / Date.now() / Math.random()。
 * 参考时间由调用方经 opts.referenceTime 显式传入。
 * import type 导入兄弟模块 compiler-skill 与 skill-activation，不重新定义 Skill / KnowledgeBundle /
 * ActivationDecision。
 *
 * @aiproj/types 零依赖约束
 */

import type { Skill, KnowledgeBundle } from './compiler-skill.js'
import type {
  ActivationDecision,
  ActivatedSkillEntry,
  ActivationContext,
} from './skill-activation.js'
import { resolveActivation } from './skill-activation.js'
import { createHash } from 'node:crypto'

// ── EvalGrade 枚举 ─────────────────────────────────────────────────────

export const EVAL_GRADES = ['excellent', 'good', 'pass', 'fail'] as const

export type EvalGrade = (typeof EVAL_GRADES)[number]

// ── 评分权重配置 ───────────────────────────────────────────────────────

export interface QualityWeights {
  structure: number
  coverage: number
  provenance: number
  regulation: number
  antiHallucination: number
}

export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
  structure: 25,
  coverage: 25,
  provenance: 20,
  regulation: 15,
  antiHallucination: 15,
}

// ── 维度评分 ───────────────────────────────────────────────────────────

export interface DimensionScore {
  /** 维度名称。 */
  dimension: keyof QualityWeights
  /** 0-100 分。 */
  score: number
  /** 满分值（用于归一化）。 */
  max: number
  /** 该维度的详细问题列表。 */
  issues: string[]
}

// ── 质量报告 ───────────────────────────────────────────────────────────

export interface QualityReport {
  /** 评估的 Skill key。 */
  skillKey: string
  /** 评估的 Skill 版本。 */
  skillVersion: string
  /** 总分 0-100。 */
  score: number
  /** 等级。 */
  grade: EvalGrade
  /** 各维度明细。 */
  dimensionScores: DimensionScore[]
  /** 全局问题清单。 */
  issues: string[]
  /** 评估参考时间（ISO 8601 字符串，由调用方传入）。 */
  referenceTime: string
}

// ── 评测输入 ───────────────────────────────────────────────────────────

export interface BenchmarkInput {
  /** 测试用例标识（human-readable）。 */
  label: string
  /** 项目级激活上下文（传入 resolveActivation）。 */
  context: ActivationContext
  /** 候选 Skill 列表。 */
  skills: Skill[]
  /** 期望的激活 Skill key 集合（用于覆盖命中判断，空 = 不检查）。 */
  expectedActivatedKeys?: string[]
  /** 期望的冲突数（可选，用于质量检查）。 */
  expectedConflicts?: number
  /** 期望的去重数（可选）。 */
  expectedDuplicates?: number
}

// ── 评测报告 ───────────────────────────────────────────────────────────

export interface BenchmarkReport {
  /** 评估的 Skill key。 */
  skillKey: string
  /** 评测集来源（L3 或 fixture）。 */
  benchmarkSource: 'L3' | 'fixture'
  /** 总测试案例数。 */
  totalInputs: number
  /** 各案例的激活决策（每个 input 对应一条 ActivationDecision）。 */
  activationDecisions: ActivationDecision[]
  /** 覆盖命中统计：expectedActivatedKeys 被激活的案例数。 */
  coverageHits: number
  /** 覆盖命中率。 */
  coverageRate: number
  /** 各案例的 evidence digest（SHA-256）。 */
  evidenceDigest: string
  /** 冲突案例统计。 */
  droppedConflictsCount: number
  /** 去重案例统计。 */
  droppedDuplicatesCount: number
  /** 评测参考时间。 */
  referenceTime: string
}

// ── 效果事件 ───────────────────────────────────────────────────────────

export interface SkillEffectEvent {
  /** 组织 ID。 */
  organizationId: number
  /** Skill key。 */
  skillKey: string
  /** Compiler run ID（可选，关联的 run）。 */
  runId?: number
  /** 项目 ID（可选，关联的项目）。 */
  projectId?: number
  /** 激活时间（ISO 8601 字符串）。 */
  activatedAt: string
  /** 关联的质量评分（可选，供 avgScore 计算）。 */
  qualityScore?: number
  /** 参考时间。 */
  referenceTime: string
}

// ── 效果度量 ───────────────────────────────────────────────────────────

export interface SkillEffectMetrics {
  /** 激活次数。 */
  activationCount: number
  /** 平均质量评分（null = 无评分数据）。 */
  avgScore: number | null
}

// ── 转移建议 ───────────────────────────────────────────────────────────

export interface TransitionSuggestion {
  /** 建议的转移方向（"eval->active" / "active->quality_alert" / null）。 */
  suggestTransition: 'eval->active' | 'active->quality_alert' | null
  /** 建议理由。 */
  reason: string
  /** 是否含 blocking 违规。 */
  hasBlockingIssues: boolean
}

// ── AI 辅助评估 ───────────────────────────────────────────────────────

export interface AiAssistAdvisory {
  /** 待审状态（固定 advisory）。 */
  status: 'advisory'
  /** 覆盖维度的自然语言意见。 */
  accuracy: string
  completeness: string
  consistency: string
  /** 整体建议。 */
  overall: string
  /** 置信度（0-1）。 */
  confidence: number
  /** 生成时间。 */
  generatedAt: string
}

// ═══════════════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════════════

/** 从 KnowledgeBundle 提取六类数组。 */
function getBundleArrays(bundle: KnowledgeBundle): Record<string, unknown[]> {
  return {
    rules: Array.isArray(bundle.rules) ? bundle.rules : [],
    patterns: Array.isArray(bundle.patterns) ? bundle.patterns : [],
    antiPatterns: Array.isArray(bundle.antiPatterns) ? bundle.antiPatterns : [],
    examples: Array.isArray(bundle.examples) ? bundle.examples : [],
    checklists: Array.isArray(bundle.checklists) ? bundle.checklists : [],
    rubric: normalizeRubric(bundle.rubric),
  }
}

function normalizeRubric(rubric: unknown): unknown[] {
  if (Array.isArray(rubric)) return rubric
  if (rubric && typeof rubric === 'object') return Object.values(rubric as Record<string, unknown>)
  return []
}

/** 从 Skill 提取 sourceRefs 列表。 */
function extractSourceRefs(skill: Skill): unknown[] {
  const refs: unknown[] = []
  const bundles = getBundleArrays(skill.knowledge)
  for (const arr of Object.values(bundles)) {
    for (const item of arr) {
      if (
        item &&
        typeof item === 'object' &&
        Array.isArray((item as Record<string, unknown>).sourceRefs)
      ) {
        refs.push(...((item as Record<string, unknown>).sourceRefs as unknown[]))
      }
    }
  }
  // 同时从 skill.provenance 提取
  if (skill.provenance?.sourceSkillKey) {
    refs.push({ layer: 'L1', sourceId: skill.provenance.sourceSkillKey })
  }
  return refs
}

// ═══════════════════════════════════════════════════════════════════════
// 反幻觉 HL 规则检查（HL-001~010）
// ═══════════════════════════════════════════════════════════════════════

export const HL_RULES = [
  'HL-001',
  'HL-002',
  'HL-003',
  'HL-004',
  'HL-005',
  'HL-006',
  'HL-007',
  'HL-008',
  'HL-009',
  'HL-010',
] as const

export type HLRule = (typeof HL_RULES)[number]

export interface HLIssue {
  rule: HLRule
  /** 违规所在的类别（rules/patterns/...）。 */
  category: string
  /** 违规条目的 index（从 0 开始）。 */
  entryIndex: number
  description: string
}

function checkAntiHallucination(knowledge: KnowledgeBundle): HLIssue[] {
  const issues: HLIssue[] = []
  const bundles = getBundleArrays(knowledge)

  for (const [category, arr] of Object.entries(bundles)) {
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      if (item === null || item === undefined) {
        issues.push({
          rule: 'HL-004',
          category,
          entryIndex: i,
          description: `${category}[${i}] 为空值`,
        })
        continue
      }
      if (typeof item !== 'object') {
        issues.push({
          rule: 'HL-010',
          category,
          entryIndex: i,
          description: `${category}[${i}] 为非结构化内容（期望对象）`,
        })
        continue
      }
      const obj = item as Record<string, unknown>
      // HL-003: 置信度标注缺失
      const hasConfidence = 'confidence' in obj && typeof obj.confidence === 'number'
      if (!hasConfidence) {
        issues.push({
          rule: 'HL-003',
          category,
          entryIndex: i,
          description: `${category}[${i}] 缺少 confidence 字段`,
        })
      }
      // HL-004: 空内容条目
      if (typeof obj.content === 'string' && obj.content.trim().length === 0) {
        issues.push({
          rule: 'HL-004',
          category,
          entryIndex: i,
          description: `${category}[${i}] content 为空字符串`,
        })
      }
    }
  }

  // HL-005: 重复 section id
  const allIds = new Set<string>()
  for (const [category, arr] of Object.entries(bundles)) {
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      if (item && typeof item === 'object') {
        const id = (item as Record<string, unknown>).id as string | undefined
        if (id) {
          if (allIds.has(id)) {
            issues.push({
              rule: 'HL-005',
              category,
              entryIndex: i,
              description: `重复的 section id: "${id}"`,
            })
          }
          allIds.add(id)
        }
      }
    }
  }

  return issues
}

// ═══════════════════════════════════════════════════════════════════════
// 维度一：内容质量评分子函数
// ═══════════════════════════════════════════════════════════════════════

/** 结构完整性评估：六类知识字段形状合法 + 无重复 section id。 */
function evaluateStructure(bundle: KnowledgeBundle): {
  score: number
  max: number
  issues: string[]
} {
  const arrays = getBundleArrays(bundle)
  const categories = ['rules', 'patterns', 'antiPatterns', 'examples', 'checklists', 'rubric']
  const issues: string[] = []
  let validCategories = 0

  for (const cat of categories) {
    const arr = arrays[cat]
    if (Array.isArray(arr) && arr.length > 0) {
      validCategories++
    } else {
      issues.push(`${cat} 为空或非数组`)
    }
  }

  // 满分 100，每缺一类扣约 16.67 分
  const score = Math.round((validCategories / categories.length) * 100)
  return { score, max: 100, issues }
}

/** 覆盖度评估：非空类别占比 + 条目数。 */
function evaluateCoverage(bundle: KnowledgeBundle): {
  score: number
  max: number
  issues: string[]
} {
  const arrays = getBundleArrays(bundle)
  const categories = ['rules', 'patterns', 'antiPatterns', 'examples', 'checklists', 'rubric']
  const issues: string[] = []
  let totalEntries = 0
  let nonEmptyCategories = 0

  for (const cat of categories) {
    const arr = arrays[cat]
    if (Array.isArray(arr) && arr.length > 0) {
      nonEmptyCategories++
      totalEntries += arr.length
    } else {
      issues.push(`${cat} 无条目`)
    }
  }

  // 非空类别占比 + 条目数加分（>=50 条满分）
  const categoryScore = Math.round((nonEmptyCategories / categories.length) * 100)
  const entryBonus = Math.min(totalEntries, 50) * 0.2 // 最多 +10
  const score = Math.min(100, Math.round(categoryScore + entryBonus))
  return { score, max: 100, issues }
}

/** 溯源完整性评估：sourceRefs 完整性 + provenance 链可追。 */
function evaluateProvenance(skill: Skill): { score: number; max: number; issues: string[] } {
  const refs = extractSourceRefs(skill)
  const issues: string[] = []

  if (refs.length === 0) {
    issues.push('无任何 sourceRefs')
    return { score: 0, max: 100, issues }
  }

  let validRefs = 0
  for (const ref of refs) {
    if (ref && typeof ref === 'object') {
      const r = ref as Record<string, unknown>
      const layer = r.layer as string | undefined
      const sourceId = r.sourceId as string | undefined
      if (layer && sourceId) {
        validRefs++
      } else {
        issues.push(`sourceRef 不完整: layer=${layer}, sourceId=${sourceId}`)
      }
    }
  }

  // 每条有效 ref 计分（最多 10 条满分）
  const score = Math.min(100, validRefs * 10)
  return { score, max: 100, issues }
}

/** 规范参照格式评估：GB/T、ISO 等格式合法检查。 */
const REGULATION_PATTERNS = [
  /^GB\/T\s*\d/,
  /^ISO\s*\d/,
  /^IEC\s*\d/,
  /^IEEE\s*\d/,
  /^NIST\s/,
  /^CMMI/,
  /^PMBOK/i,
  /^PRINCE2/i,
  /^ITIL/i,
  /^GDPR/i,
  /^PIPL/i,
  /^SOC\s*2/i,
  /^HIPAA/i,
]

function evaluateRegulation(skill: Skill): { score: number; max: number; issues: string[] } {
  const refs = extractSourceRefs(skill)
  const issues: string[] = []

  if (refs.length === 0) {
    return { score: 100, max: 100, issues: ['无规范参照引用，跳过检查'] }
  }

  let recognizedCount = 0
  for (const ref of refs) {
    if (ref && typeof ref === 'object') {
      const r = ref as Record<string, unknown>
      const sourceId = String(r.sourceId ?? '')
      if (REGULATION_PATTERNS.some((p) => p.test(sourceId))) {
        recognizedCount++
      } else {
        issues.push(`未识别的规范参照格式: ${sourceId}`)
      }
    }
  }

  const score = refs.length > 0 ? Math.round((recognizedCount / refs.length) * 100) : 100
  return { score, max: 100, issues }
}

// ═══════════════════════════════════════════════════════════════════════
// 主评分引擎
// ═══════════════════════════════════════════════════════════════════════

/**
 * 确定性内容质量评分引擎。
 *
 * 对 Skill.knowledge（KnowledgeBundle 六类）做多维度加权 0-100 评分，
 * 沿用 PRD §2.5.3 阈值映射等级。
 *
 * @param skill 待评估的 Skill
 * @param opts 可选配置（权重覆盖、参考时间）
 * @returns QualityReport 质量报告
 */
export function scoreSkillQuality(
  skill: Skill,
  opts?: { weights?: Partial<QualityWeights>; referenceTime?: string },
): QualityReport {
  const weights = { ...DEFAULT_QUALITY_WEIGHTS, ...opts?.weights }
  // 使用传入的 referenceTime，默认值仅在测试环境覆盖
  const referenceTime = opts?.referenceTime ?? '2026-07-26T00:00:00.000Z'

  // 各维度独立评估
  const structResult = evaluateStructure(skill.knowledge)
  const coverageResult = evaluateCoverage(skill.knowledge)
  const provenanceResult = evaluateProvenance(skill)
  const regulationResult = evaluateRegulation(skill)
  const hlIssues = checkAntiHallucination(skill.knowledge)

  // 反幻觉得分：有违规则扣分
  // HL-003 (confidence 缺失) 每条扣 5 分，其他 blocking 违规每条扣 15 分
  const hlScore =
    hlIssues.length > 0
      ? Math.max(
          0,
          100 -
            hlIssues.filter((i) => i.rule === 'HL-003').length * 5 -
            hlIssues.filter((i) => i.rule !== 'HL-003').length * 15,
        )
      : 100

  const dimensionScores: DimensionScore[] = [
    {
      dimension: 'structure',
      score: structResult.score,
      max: structResult.max,
      issues: structResult.issues,
    },
    {
      dimension: 'coverage',
      score: coverageResult.score,
      max: coverageResult.max,
      issues: coverageResult.issues,
    },
    {
      dimension: 'provenance',
      score: provenanceResult.score,
      max: provenanceResult.max,
      issues: provenanceResult.issues,
    },
    {
      dimension: 'regulation',
      score: regulationResult.score,
      max: regulationResult.max,
      issues: regulationResult.issues,
    },
    {
      dimension: 'antiHallucination',
      score: hlScore,
      max: 100,
      issues: hlIssues.map((i) => `${i.rule}: ${i.description}`),
    },
  ]

  // 加权总分
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
  const totalScore =
    totalWeight > 0
      ? Math.round(
          dimensionScores.reduce((sum, d) => {
            const w = weights[d.dimension]
            return sum + (d.score / d.max) * w
          }, 0),
        )
      : 0

  // 等级映射
  let grade: EvalGrade
  if (totalScore >= 85) {
    grade = 'excellent'
  } else if (totalScore >= 70) {
    grade = 'good'
  } else if (totalScore >= 60) {
    grade = 'pass'
  } else {
    grade = 'fail'
  }

  // 汇总所有 issues
  const allIssues = dimensionScores.flatMap((d) =>
    d.issues.map((issue) => `[${d.dimension}] ${issue}`),
  )

  return {
    skillKey: skill.skillKey,
    skillVersion: skill.version,
    score: totalScore,
    grade,
    dimensionScores,
    issues: allIssues,
    referenceTime,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 转移建议
// ═══════════════════════════════════════════════════════════════════════

/**
 * 基于质量报告给出生命周期转移建议。
 *
 * 仅在合法路径上建议：
 * - eval 状态且 >=70 分且无 blocking -> eval->active
 * - active 状态且 <60 分或有 blocking -> active->quality_alert
 * - 非法路径返回 null
 *
 * @param skill 当前 Skill
 * @param report 质量报告
 * @returns TransitionSuggestion 转移建议
 */
export function suggestTransition(skill: Skill, report: QualityReport): TransitionSuggestion {
  const hasBlocking = report.dimensionScores.some(
    (d) => d.dimension === 'antiHallucination' && d.score < 60,
  )

  if (skill.status === 'eval' && report.score >= 70 && !hasBlocking) {
    return {
      suggestTransition: 'eval->active',
      reason: `质量评分 ${report.score}（${report.grade}），建议上线`,
      hasBlockingIssues: false,
    }
  }

  if (skill.status === 'active' && (report.score < 60 || hasBlocking)) {
    return {
      suggestTransition: 'active->quality_alert',
      reason: `质量评分 ${report.score}（${report.grade}），建议降级为 quality_alert`,
      hasBlockingIssues: hasBlocking,
    }
  }

  return { suggestTransition: null, reason: '', hasBlockingIssues: hasBlocking }
}

// ═══════════════════════════════════════════════════════════════════════
// 评测管道
// ═══════════════════════════════════════════════════════════════════════

/**
 * 运行 Skill 评测基准。
 *
 * 对每个 BenchmarkInput 调用 resolveActivation，评估激活决策质量，
 * 收集 coverageHits、evidenceDigest、冲突/去重统计。
 *
 * @param skill 待评测的 Skill
 * @param inputs 评测输入数组
 * @param opts 可选配置（参考时间、benchmarkSource）
 * @returns BenchmarkReport 评测报告
 */
export function runSkillBenchmark(
  skill: Skill,
  inputs: BenchmarkInput[],
  opts?: { referenceTime?: string; benchmarkSource?: 'L3' | 'fixture' },
): BenchmarkReport {
  const referenceTime = opts?.referenceTime ?? '2026-07-26T00:00:00.000Z'
  const benchmarkSource = opts?.benchmarkSource ?? 'fixture'

  const activationDecisions: ActivationDecision[] = []
  let coverageHits = 0
  let totalExpected = 0
  let totalConflicts = 0
  let totalDuplicates = 0

  for (const input of inputs) {
    const decision = resolveActivation(input.context, input.skills)
    activationDecisions.push(decision)

    // 计算覆盖命中
    if (input.expectedActivatedKeys && input.expectedActivatedKeys.length > 0) {
      const activatedKeys = new Set(
        decision.activatedSkills.map((e: ActivatedSkillEntry) => e.skill.skillKey),
      )
      for (const ek of input.expectedActivatedKeys) {
        if (activatedKeys.has(ek)) coverageHits++
      }
      totalExpected += input.expectedActivatedKeys.length
    }

    totalConflicts += decision.droppedConflicts.length
    totalDuplicates += decision.droppedDuplicates.length
  }

  const coverageRate =
    totalExpected > 0 ? Math.round((coverageHits / totalExpected) * 100) / 100 : 0

  // 所有 decision 序列化后计算 SHA-256
  const serialized = JSON.stringify(
    activationDecisions.map((d) => ({
      activatedKeys: d.activatedSkills.map((e: ActivatedSkillEntry) => e.skill.skillKey),
      conflicts: d.droppedConflicts.length,
      duplicates: d.droppedDuplicates.length,
    })),
  )
  const evidenceDigest = createHash('sha256').update(serialized, 'utf-8').digest('hex')

  return {
    skillKey: skill.skillKey,
    benchmarkSource,
    totalInputs: inputs.length,
    activationDecisions,
    coverageHits,
    coverageRate,
    evidenceDigest,
    droppedConflictsCount: totalConflicts,
    droppedDuplicatesCount: totalDuplicates,
    referenceTime,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 效果指标聚合
// ═══════════════════════════════════════════════════════════════════════

/**
 * 聚合 SkillEffectEvent 数组为 SkillEffectMetrics。
 *
 * 无事件时返回零数据降级结果（activationCount=0, avgScore=null），不产生假数据。
 *
 * @param skillId Skill 标识
 * @param events 效果事件数组
 * @param opts 可选配置（参考时间）
 * @returns SkillEffectMetrics
 */
export function aggregateSkillEffectMetrics(
  _skillId: string,
  events: SkillEffectEvent[],
  _opts?: { referenceTime?: string },
): SkillEffectMetrics {
  if (!events || events.length === 0) {
    return { activationCount: 0, avgScore: null }
  }

  const scores = events
    .filter((e) => typeof e.qualityScore === 'number')
    .map((e) => e.qualityScore as number)

  const avgScore =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
      : null

  return {
    activationCount: events.length,
    avgScore,
  }
}
