/**
 * skill-activation —— V3 技能激活规则引擎（项目级激活决策与组合层）。
 *
 * 纯函数引擎：零运行时依赖，不调 Date.now()/Math.random()，不发起 HTTP/DB/AI 调用。
 *
 * 消费兄弟 `compiler-skill.ts` 的 Skill / ActivationRule 契约，不重新定义。
 *
 * @aiproj/types 零依赖约束
 */
import type { Skill, ActivationRule } from './compiler-skill.js'
import { createHash } from 'node:crypto'

// ── 激活专属类型 ──────────────────────────────────────────────────

export type ActivationMode = 'manual' | 'auto' | 'dependency'

export interface ActivationContext {
  /** 项目类型（如 software、construction）。 */
  projectType?: string
  /** 项目标签。 */
  projectTags?: string[]
  /** 行业。 */
  industry?: string
  /** 手动选择的 skillKey 列表。 */
  manualSelections?: string[]
  /** AI 推荐的 skillKey 列表（仅建议，不自动激活）。 */
  aiRecommendations?: string[]
}

export interface StackingEvidence {
  /** 裁决类型。 */
  type: 'conflict' | 'complementary' | 'dependency' | 'duplicate'
  /** 关联的 skillKey 引用。 */
  subjects: string[]
  /** 人类可读的裁决说明。 */
  description: string
}

export interface ActivatedSkillEntry {
  skill: Skill
  activationMode: ActivationMode
  /** 为何激活（manual/auto/dependency 的来源说明）。 */
  reason: string
}

export interface ActivationDecision {
  /** 最终激活的 Skill 列表（稳定排序：priority 降序 → skillKey 字典序）。 */
  activatedSkills: ActivatedSkillEntry[]
  /** AI 推荐的候选 Skill（仅建议，不许在 activatedSkills 中出现）。 */
  advisoryCandidates: ActivatedSkillEntry[]
  /** 因冲突被淘汰的 Skill。 */
  droppedConflicts: { skill: Skill; winner: string; evidence: StackingEvidence }[]
  /** 因重复（同 skillKey 低 version）被淘汰的 Skill。 */
  droppedDuplicates: { skill: Skill; keptVersion: string }[]
  /** 所有裁决的 evidence 记录。 */
  evidence: StackingEvidence[]
  /** SHA-256 digest，对决策内容确定性序列化后计算（可复现）。 */
  evidenceDigest: string
}

// ── 确定性错误 ──────────────────────────────────────────────────────

export const SKILL_ACTIVATION_ERROR_CODES = ['SKILL_DEPENDENCY_CYCLE'] as const
export type SkillActivationErrorCode = (typeof SKILL_ACTIVATION_ERROR_CODES)[number]

export class SkillActivationError extends Error {
  readonly code: SkillActivationErrorCode
  constructor(code: SkillActivationErrorCode, message: string) {
    super(message)
    this.name = 'SkillActivationError'
    this.code = code
  }
}

// ── 辅助：评估 ActivationRule 是否匹配项目级上下文 ─────────────────

/**
 * 评估单个 ActivationRule 是否匹配给定的项目上下文。
 * 兄弟 ActivationRule 形状：projectTypes、domains、complexityRange、stages（不在此层评估）、condition。
 */
function evaluateActivationRule(rule: ActivationRule, context: ActivationContext): boolean {
  // projectTypes 匹配：rule 未限制 = 通行；rule 有限制 = 必须匹配
  if (rule.projectTypes && rule.projectTypes.length > 0) {
    if (!context.projectType || !rule.projectTypes.includes(context.projectType)) {
      return false
    }
  }

  // domains 匹配：rule 未限制 = 通行；rule 有限制 = context.projectTags 须有交集
  if (rule.domains && rule.domains.length > 0) {
    const tags = context.projectTags ?? []
    const hasMatch = rule.domains.some((d) => tags.includes(d))
    if (!hasMatch) return false
  }

  // complexityRange 匹配：rule 未限制 = 通行。
  // 上下文暂未定义全局 complexity 字段，预留；有值时评估。
  if (rule.complexityRange) {
    // complexity 取值：优先 (context as any).complexity?，无则跳过（通行）
    const complexity = (context as Record<string, unknown>).complexity as number | undefined
    if (complexity !== undefined) {
      const { min, max } = rule.complexityRange
      if (min !== undefined && complexity < min) return false
      if (max !== undefined && complexity > max) return false
    }
  }

  // condition：结构化 predicate 保留，有值时宽松评估（全 true 才通行）
  if (rule.condition) {
    // 宽松评估：把 condition 中的 bool 字段视为 AND 条件
    const cond = rule.condition
    for (const [key, value] of Object.entries(cond)) {
      if (typeof value === 'boolean' && value === false) {
        // false 字段 = 条件不满足
        // 检查上下文是否有该字段
        const ctxVal = (context as Record<string, unknown>)[key]
        if (ctxVal !== true) return false
      }
    }
  }

  return true
}

// ── DFS 三色标记环路检测 ───────────────────────────────────────────

type Color = 'white' | 'gray' | 'black'

function detectCycle(skillMap: Map<string, Skill>): void {
  const colors = new Map<string, Color>()
  for (const key of skillMap.keys()) {
    colors.set(key, 'white')
  }

  function dfs(key: string, path: string[]): void {
    const color = colors.get(key)
    if (color === 'black') return
    if (color === 'gray') {
      const cyclePath = [...path.slice(path.indexOf(key)), key]
      throw new SkillActivationError(
        'SKILL_DEPENDENCY_CYCLE',
        `检测到 Skill 依赖环路: ${cyclePath.join(' → ')}`,
      )
    }

    colors.set(key, 'gray')
    const skill = skillMap.get(key)
    if (skill && skill.dependencies && skill.dependencies.length > 0) {
      for (const dep of skill.dependencies) {
        // 只检查已在激活集或候选集中的依赖
        if (skillMap.has(dep)) {
          dfs(dep, [...path, key])
        }
      }
    }
    colors.set(key, 'black')
  }

  for (const key of [...skillMap.keys()].sort()) {
    dfs(key, [])
  }
}

// ── 稳定排序 —— priority 降序 → skillKey 字典序升序 ───────────────

function stableSortEntries(entries: ActivatedSkillEntry[]): ActivatedSkillEntry[] {
  return [...entries].sort((a, b) => {
    const pa = a.skill.activation.priority ?? 50
    const pb = b.skill.activation.priority ?? 50
    // priority 降序
    if (pb !== pa) return pb - pa
    // skillKey 字典序升序（确定性 tie-break）
    return a.skill.skillKey.localeCompare(b.skill.skillKey)
  })
}

// ── 确定性序列化（键排序）──────────────────────────────────────────

function serializeForDigest(decision: ActivationDecision): string {
  const ordered = {
    activatedSkills: decision.activatedSkills.map((e) => ({
      skillKey: e.skill.skillKey,
      version: e.skill.version,
      activationMode: e.activationMode,
      reason: e.reason,
    })),
    advisoryCandidates: decision.advisoryCandidates.map((e) => ({
      skillKey: e.skill.skillKey,
      reason: e.reason,
    })),
    droppedConflicts: decision.droppedConflicts.map((d) => ({
      skillKey: d.skill.skillKey,
      winner: d.winner,
    })),
    droppedDuplicates: decision.droppedDuplicates.map((d) => ({
      skillKey: d.skill.skillKey,
      keptVersion: d.keptVersion,
    })),
  }
  // 键排序 JSON 序列化保证确定性
  return JSON.stringify(ordered, Object.keys(ordered).sort())
}

// ── 主引擎 ─────────────────────────────────────────────────────────

/**
 * 项目级激活决策引擎（D3/D4/D5/D6/D7）。
 *
 * 处理流程：
 * 1. 入参校验
 * 2. 状态过滤（仅 active 进入激活路径）
 * 3. 手动选择激活（mode = manual）
 * 4. 自动激活评估（按 ActivationRule 匹配项目上下文，mode = auto）
 * 5. 依赖传递性自动加载 + 环路检测（mode = dependency）
 * 6. 叠加规则四态：冲突/互补/依赖/去重
 * 7. AI 推荐候选通道（advisory，不晋升为激活）
 * 8. 稳定排序 + evidence digest
 *
 * @param context 项目级激活上下文
 * @param skills 候选 Skill 数组（来自 matchSkills 或 Registry list）
 * @returns ActivationDecision 包含激活集、advisory 候选、淘汰记录、evidence 和 digest
 */
export function resolveActivation(context: ActivationContext, skills: Skill[]): ActivationDecision {
  // 入参校验
  if (!context || !skills) {
    throw new Error('resolveActivation: context 和 skills 为必填参数')
  }
  if (!Array.isArray(skills)) {
    throw new Error('resolveActivation: skills 必须是数组')
  }

  const evidence: StackingEvidence[] = []
  const manualKeys = new Set(context.manualSelections ?? [])
  const aiKeys = new Set(context.aiRecommendations ?? [])
  const skillMap = new Map<string, Skill>(skills.map((s) => [s.skillKey, s]))

  // 已激活的 skillKey 集合（用于快速查找）
  const activatedMap = new Map<string, ActivatedSkillEntry>()
  // 去重：同 skillKey 的多个版本中保留最高版本
  const versionBest = new Map<string, { id: number; version: string }>()

  // ── Step 1: 状态过滤 & 去重预处理 ──
  const activeSkills = skills.filter((s) => s.status === 'active')

  // 检测同 skillKey 重复，记录最高 version
  for (const s of activeSkills) {
    const existing = versionBest.get(s.skillKey)
    if (!existing || s.version > existing.version) {
      versionBest.set(s.skillKey, { id: s.id, version: s.version })
    }
  }

  // 标记被淘汰的低版本
  const keptVersionIds = new Set([...versionBest.values()].map((v) => v.id))
  const droppedDuplicates: ActivationDecision['droppedDuplicates'] = []
  for (const s of activeSkills) {
    if (!keptVersionIds.has(s.id)) {
      const best = versionBest.get(s.skillKey)!
      droppedDuplicates.push({ skill: s, keptVersion: best.version })
    }
  }

  // 去重后的 active skill 列表
  const dedupedActive = activeSkills.filter((s) => keptVersionIds.has(s.id))

  // ── Step 2: 手动选择激活 ──
  for (const key of [...manualKeys].sort()) {
    const best = versionBest.get(key)
    if (!best) continue
    const skill = skillMap.get(key)
    if (!skill || skill.status !== 'active') continue
    // 确保是最佳版本
    if (skill.id !== best.id) continue

    activatedMap.set(key, {
      skill,
      activationMode: 'manual',
      reason: 'manual-selection',
    })
    evidence.push({
      type: 'complementary',
      subjects: [key],
      description: `手动选择激活: ${skill.name}`,
    })
  }

  // ── Step 3: 自动激活评估（项目级 ActivationRule 匹配）──
  const autoCandidates: ActivatedSkillEntry[] = []
  for (const skill of dedupedActive) {
    if (activatedMap.has(skill.skillKey)) continue
    if (skill.activation && evaluateActivationRule(skill.activation, context)) {
      autoCandidates.push({
        skill,
        activationMode: 'auto',
        reason: `项目级匹配: projectType=${context.projectType ?? '(不限)'}`,
      })
    }
  }

  // 自动候选按 priority 降序进入激活集
  const sortedAuto = stableSortEntries(autoCandidates)
  for (const entry of sortedAuto) {
    if (!activatedMap.has(entry.skill.skillKey)) {
      activatedMap.set(entry.skill.skillKey, entry)
      evidence.push({
        type: 'complementary',
        subjects: [entry.skill.skillKey],
        description: `自动激活: ${entry.skill.name} (projectType=${context.projectType ?? '(不限)'})`,
      })
    }
  }

  // ── Step 4: 冲突裁决 ──
  // 同域互斥定义：category.primary 相同且 category.secondary 相同的 Skill 视为同域。
  // 仅 manual 与 auto 激活的 Skill 参与冲突裁决；dependency 模式免于冲突（必需依赖）。
  const droppedConflicts: ActivationDecision['droppedConflicts'] = []
  const domainGroups = new Map<string, ActivatedSkillEntry[]>()

  for (const entry of activatedMap.values()) {
    // dependency 模式的 Skill 不参与冲突裁决
    if (entry.activationMode === 'dependency') continue

    const domainKey = `${entry.skill.category.primary}:${entry.skill.category.secondary ?? ''}`
    if (!domainGroups.has(domainKey)) {
      domainGroups.set(domainKey, [])
    }
    domainGroups.get(domainKey)!.push(entry)
  }

  // 每组按 priority（降序，tie-break skillKey 字典序）裁决
  for (const [, entries] of domainGroups) {
    if (entries.length <= 1) continue

    // 按 priority 排序
    const sorted = [...entries].sort((a, b) => {
      const pa = a.skill.activation.priority ?? 50
      const pb = b.skill.activation.priority ?? 50
      if (pb !== pa) return pb - pa
      return a.skill.skillKey.localeCompare(b.skill.skillKey)
    })

    // 第一个胜出，其余冲突淘汰（length >= 2，winner 和 loser 必定非空）
    const winner = sorted[0]!
    for (let i = 1; i < sorted.length; i++) {
      const loser = sorted[i]!
      const ev: StackingEvidence = {
        type: 'conflict',
        subjects: [winner.skill.skillKey, loser.skill.skillKey],
        description: `同域冲突裁决 (${entries[0]!.skill.category.primary}): ${loser.skill.name} (priority=${loser.skill.activation.priority ?? 50}) 被 ${winner.skill.name} (priority=${winner.skill.activation.priority ?? 50}) 淘汰`,
      }
      evidence.push(ev)
      droppedConflicts.push({
        skill: loser.skill,
        winner: winner.skill.skillKey,
        evidence: ev,
      })
      activatedMap.delete(loser.skill.skillKey)
    }
  }

  // ── Step 5: 依赖传递性自动加载 + 环路检测 ──
  // 在冲突裁决之后执行：依赖项免于冲突淘汰（必需依赖）
  // 构建当前激活集 + 全部候选的依赖图做环路检测
  const allKeys = new Set([...activatedMap.keys(), ...dedupedActive.map((s) => s.skillKey)])
  const depGraph = new Map<string, Skill>()
  for (const key of allKeys) {
    const s = skillMap.get(key)
    if (s) depGraph.set(key, s)
  }
  detectCycle(depGraph)

  // 传递性加载依赖（BFS）
  const visited = new Set(activatedMap.keys())
  const queue = [...activatedMap.keys()]
  while (queue.length > 0) {
    const currentKey = queue.shift()!
    const skill = skillMap.get(currentKey)
    if (!skill || !skill.dependencies || skill.dependencies.length === 0) continue

    for (const depKey of skill.dependencies) {
      if (visited.has(depKey)) continue
      const depSkill = skillMap.get(depKey)
      if (!depSkill || depSkill.status !== 'active') continue
      // 确保是最佳版本
      const best = versionBest.get(depKey)
      if (!best || depSkill.id !== best.id) continue

      visited.add(depKey)
      activatedMap.set(depKey, {
        skill: depSkill,
        activationMode: 'dependency',
        reason: `依赖自动加载: 被 ${skill.name} (${currentKey}) 所依赖`,
      })
      evidence.push({
        type: 'dependency',
        subjects: [currentKey, depKey],
        description: `${currentKey} 依赖 ${depKey}: 自动加载 ${depSkill.name}`,
      })
      queue.push(depKey)
    }
  }

  // ── Step 6: AI 推荐候选通道 ──
  // AI 推荐只产候选：若已在 activatedSkills（由手动/自动/依赖触发），则跳过 advisory，
  // 不抛错（产品语义：已激活优先，AI 推荐不覆盖）
  const advisoryCandidates: ActivatedSkillEntry[] = []
  const activatedKeys = new Set([...activatedMap.keys()])
  for (const key of [...aiKeys].sort()) {
    // 已在激活集中的，跳过 advisory（不变式：advisory 不与 activated 重叠）
    if (activatedKeys.has(key)) continue

    const best = versionBest.get(key)
    if (!best) continue
    const skill = skillMap.get(key)
    if (!skill || skill.status !== 'active') continue
    if (skill.id !== best.id) continue

    advisoryCandidates.push({
      skill,
      activationMode: 'auto',
      reason: 'ai-recommendation',
    })
  }

  // ── Step 7: 组装最终决策 ──
  const activatedSkills = stableSortEntries([...activatedMap.values()])

  const decision: Omit<ActivationDecision, 'evidenceDigest'> = {
    activatedSkills,
    advisoryCandidates,
    droppedConflicts,
    droppedDuplicates,
    evidence,
  }

  // 确定性序列化 + SHA-256
  const digestPayload = serializeForDigest(decision as ActivationDecision)
  const evidenceDigest = createHash('sha256').update(digestPayload, 'utf-8').digest('hex')

  return {
    ...decision,
    evidenceDigest,
  }
}
