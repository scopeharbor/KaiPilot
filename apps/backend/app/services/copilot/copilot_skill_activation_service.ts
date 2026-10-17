/**
 * v3-copilot-skill-injection — CopilotSkillActivationService（§3 供给端接线）。
 *
 * 轻量适配器：让 Copilot 回合能复用 Compiler 侧的 `resolveActivation` 纯函数引擎，
 * 但不需要 `compilerRunId` / `ArtifactStore` 等 Compiler 专用依赖。
 *
 * 设计决策（§3.2）：
 * - **不新建第二套解析**——直接调用 `@aiproj/types` 的 `resolveActivation`
 * - 从 `SkillRegistryService.listByOrg` 获取本组织 active Skill
 * - 空激活集 = 合法降级（返回 undefined，装配服务跳过切面）
 * - 项目类型缺失时激活种子 Skill（§3.10）
 *
 * @aiproj/backend
 */
import type SkillRegistryService from '#services/compiler/skills/skill_registry_service'
import type PluginSkillAdapterService from '#services/plugin_skill_adapter_service'
import { resolveActivation, type ActivationContext, type ActivationDecision } from '@aiproj/types'
import type { Skill } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** Copilot 侧的激活结果（裁剪掉 Compiler 专用字段）。 */
export interface CopilotSkillActivationResult {
  /** 已激活的 skillKey 列表（稳定排序）。 */
  readonly skillKeys: readonly string[]
  /** 方法论版本 hash（与项目事实 source hash 分列）。 */
  readonly methodologyVersionHash: string
  /** 方法论指引条目（从 activation decision 裁剪）。 */
  readonly guidanceItems: readonly CopilotGuidanceItem[]
  /** 完整的激活决策（供调试/审计）。 */
  readonly decision: ActivationDecision
}

/** 方法论指引条目（装配服务消费的形状，对齐 CopilotContextAssemblyDeps.skillActivation）。 */
export interface CopilotGuidanceItem {
  readonly itemId: string
  readonly skillKey: string
  readonly label: string
  readonly summary: string
  /** 可追溯到来源 Skill 与知识片段的引用（§5.7 Provenance）。 */
  readonly sourceRef: string
  /** 可追溯到知识片段的引用（补充来源信息）。 */
  readonly knowledgeRef?: string
  /** 激活规则 ID：产生此条目的 Skill 激活规则标识。 */
  readonly activationRuleId: string
  /** 激活依据：人类可读的激活原因说明。 */
  readonly activationReason: string
  /** 知识条目所属层级（L1/L2/L3/L4），用于 §4 L3 排除断言。 */
  readonly knowledgeTier?: string
}

/** 激活失败降级结果。 */
export interface CopilotSkillActivationDegraded {
  readonly degraded: true
  readonly errorCode: string
  readonly reason: string
}

export type CopilotSkillActivationOutcome =
  | { ok: true; result: CopilotSkillActivationResult }
  | { ok: true; result: undefined } // 零激活 = 合法降级
  | { ok: false; degraded: CopilotSkillActivationDegraded }

// ---------------------------------------------------------------------------
// 种子 Skill（§3.10：项目类型缺失时的兜底激活）
// ---------------------------------------------------------------------------

/** 种子 Skill key，当项目类型缺失且无其他激活时使用。 */
export const COPILOT_SEED_SKILL_KEY = 'general-project-guidance'

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export class CopilotSkillActivationService {
  readonly #skillRegistry: SkillRegistryService
  readonly #pluginAdapter?: PluginSkillAdapterService

  constructor(skillRegistry: SkillRegistryService, pluginAdapter?: PluginSkillAdapterService) {
    this.#skillRegistry = skillRegistry
    this.#pluginAdapter = pluginAdapter
  }

  /**
   * 解析 Copilot 回合的 Skill 激活决策。
   *
   * 流程：
   * 1. 从 Registry 取本组织 active Skill（结合已启用插件贡献）
   * 2. 调 `resolveActivation` 纯函数（§3.2 复用 Compiler 引擎）
   * 3. 空激活集 → 返回 undefined（§3.4 零激活 = 切面缺席）
   * 4. 项目类型缺失 → 激活种子 Skill（§3.10）
   * 5. 裁剪为 Copilot 消费的最小形状
   *
   * @param organizationId 组织 ID
   * @param activationContext 激活上下文（projectType/industry 等）
   * @returns 激活结果或 undefined（零激活）或 degraded（激活失败）
   */
  async resolve(
    organizationId: number,
    activationContext: ActivationContext,
  ): Promise<CopilotSkillActivationOutcome> {
    try {
      // 1. 从 Registry 取本组织 active Skill
      const { data: rawActiveSkills } = await this.#skillRegistry.listByOrg(organizationId, {
        status: 'active',
        perPage: 100,
      })

      // 结合插件生效性过滤未启用插件的 Skill（无插件组织零行为变化）
      let activeSkills = rawActiveSkills
      if (this.#pluginAdapter) {
        try {
          const { effectiveSkillKeys } =
            await this.#pluginAdapter.getEffectivePluginContributions(organizationId)
          activeSkills = rawActiveSkills.filter((s) => {
            const prov = s.provenance as { origin?: string; pluginId?: string } | undefined
            if (prov?.origin === 'plugin' || prov?.pluginId) {
              return effectiveSkillKeys.includes(s.skillKey)
            }
            return true
          })
        } catch {
          // 插件解析失败降级，不阻断原生 Skill
        }
      }

      // 2. 空 active Skill 集 = 合法降级
      if (activeSkills.length === 0) {
        return { ok: true, result: undefined }
      }

      // 3. 调激活引擎（§3.2 复用 resolveActivation 纯函数）
      const decision = resolveActivation(activationContext, activeSkills)

      // 4. 空激活集 = 合法降级（§3.4 零激活 → 切面缺席而非空壳）
      if (decision.activatedSkills.length === 0 && decision.advisoryCandidates.length === 0) {
        // §3.10：项目类型缺失时尝试激活种子 Skill
        if (!activationContext.projectType) {
          const seededDecision = this.#trySeedActivation(activationContext, activeSkills)
          if (seededDecision && seededDecision.activatedSkills.length > 0) {
            return { ok: true, result: this.#buildResult(seededDecision) }
          }
        }
        return { ok: true, result: undefined }
      }

      // 5. 裁剪为 Copilot 消费的最小形状
      return { ok: true, result: this.#buildResult(decision) }
    } catch (error) {
      // §3.6：激活失败 → 降级，不阻断回合
      return {
        ok: false,
        degraded: {
          degraded: true,
          errorCode: 'SKILL_ACTIVATION_FAILED',
          reason: error instanceof Error ? error.message : 'Unknown activation error',
        },
      }
    }
  }

  // ── 内部方法 ────────────────────────────────────────────────────

  /**
   * §3.10：项目类型缺失时激活种子 Skill 并标注为兜底。
   * 只在零激活且无项目类型时尝试。
   */
  #trySeedActivation(
    _context: ActivationContext,
    activeSkills: readonly Skill[],
  ): ActivationDecision | null {
    // 查找种子 Skill
    const seedSkill = activeSkills.find((s) => s.skillKey === COPILOT_SEED_SKILL_KEY)
    if (!seedSkill) return null

    // 手动构造一个包含种子 Skill 的激活决策
    // 复用 resolveActivation：传入手动选择种子 Skill 的上下文
    const seedContext: ActivationContext = {
      ..._context,
      manualSelections: [COPILOT_SEED_SKILL_KEY],
    }
    return resolveActivation(seedContext, [...activeSkills])
  }

  /**
   * 从 ActivationDecision 裁剪为 Copilot 消费的最小形状。
   * 提取 guidance items 从 Skill 的 knowledge 包中。
   */
  #buildResult(decision: ActivationDecision): CopilotSkillActivationResult {
    const skillKeys = decision.activatedSkills.map((e) => e.skill.skillKey)
    const guidanceItems: CopilotGuidanceItem[] = []

    for (const entry of decision.activatedSkills) {
      const skill = entry.skill
      // 从 knowledge 包提取指引条目
      const items = this.#extractGuidanceItems(skill, entry.activationMode, entry.reason)
      guidanceItems.push(...items)
    }

    // 方法论版本 hash 从 decision.evidenceDigest 派生
    const methodologyVersionHash = decision.evidenceDigest.slice(0, 16)

    return {
      skillKeys,
      methodologyVersionHash,
      guidanceItems,
      decision,
    }
  }

  /**
   * 从 Skill 的 knowledge 包提取方法论指引条目。
   * 知识条目携带 sourceRef.layer 信息（L1/L2/L3/L4），
   * 用于装配服务侧的 L3 二次断言（§4.1）。
   */
  #extractGuidanceItems(
    skill: Skill,
    activationMode: string,
    activationReason: string,
  ): CopilotGuidanceItem[] {
    const items: CopilotGuidanceItem[] = []
    const knowledge = skill.knowledge

    // 从 rules / patterns / antiPatterns / checklists 提取指引
    const sections = [
      { kind: 'rules', label: '规则' },
      { kind: 'patterns', label: '模式' },
      { kind: 'antiPatterns', label: '反模式' },
      { kind: 'checklists', label: '检查清单' },
    ] as const

    for (const section of sections) {
      const entries = knowledge[section.kind]
      if (!Array.isArray(entries)) continue

      for (const [i, rawEntry] of entries.entries()) {
        const entry = rawEntry as Record<string, unknown>
        const title = (entry.title ?? entry.name ?? `${section.label} ${i + 1}`) as string
        const description = (entry.description ?? entry.content ?? '') as string

        // 提取知识层级（从 sourceRefs 或顶层 tier 字段）
        const tier = this.#extractTier(entry)

        items.push({
          itemId: `${skill.skillKey}:${section.kind}:${i}`,
          skillKey: skill.skillKey,
          label: `[${skill.name}] ${section.label}: ${title}`,
          summary: description,
          sourceRef: `skill:${skill.skillKey}:v${skill.version}:${section.kind}:${i}`,
          knowledgeRef: tier ? `knowledge:${tier}:${skill.skillKey}` : undefined,
          activationRuleId: `${skill.skillKey}.activation`,
          activationReason: `${activationMode}: ${activationReason}`,
          knowledgeTier: tier,
        })
      }
    }

    return items
  }

  /**
   * 从知识条目提取层级信息。
   * 优先从 sourceRefs[0].layer 取，其次从顶层 tier 字段取。
   */
  #extractTier(entry: Record<string, unknown>): string | undefined {
    // 检查 sourceRefs
    const sourceRefs = entry.sourceRefs
    if (Array.isArray(sourceRefs) && sourceRefs.length > 0) {
      const firstRef = sourceRefs[0] as Record<string, unknown>
      if (typeof firstRef.layer === 'string') {
        return firstRef.layer
      }
    }
    // 检查顶层 tier 字段
    if (typeof entry.tier === 'string') {
      return entry.tier
    }
    return undefined
  }
}
