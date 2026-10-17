/**
 * v3-skill-compiler-integration —— SkillActivationResolver（task 3.1-3.3）。
 *
 * Compiler run 启动后（Intent Parsing 产出 projectType/industry 之后），
 * 从 Registry 取本组织 active Skill，调 resolveActivation 产出 ActivationDecision，
 * 持久化为 skill_activation_decision artifact，返回 SkillActivationRef。
 *
 * Resume 复用：检查 artifact 是否存在 + evidenceDigest 校验 → 一致则复用。
 *
 * @aiproj/backend
 */
import { ArtifactStore } from '#services/compiler/artifact_store'
import type SkillRegistryService from '#services/compiler/skills/skill_registry_service'
import type PluginSkillAdapterService from '#services/plugin_skill_adapter_service'
import { resolveActivation, type ActivationContext } from '@aiproj/types'
import type { SkillActivationRef, ActivationDecision } from '@aiproj/types'
import { createHash } from 'node:crypto'

// ── Errors ──

export class SkillActivationResolverError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillActivationResolverError'
  }
}

export class OrganizationMismatchError extends SkillActivationResolverError {
  constructor() {
    super('Organization mismatch: cannot access activation decision of another organization')
    this.name = 'OrganizationMismatchError'
  }
}

// ── Service ──

export class SkillActivationResolver {
  readonly #skillRegistry: SkillRegistryService
  readonly #artifactStore: ArtifactStore
  readonly #pluginAdapter?: PluginSkillAdapterService

  constructor(
    skillRegistry: SkillRegistryService,
    artifactStore?: ArtifactStore,
    pluginAdapter?: PluginSkillAdapterService,
  ) {
    this.#skillRegistry = skillRegistry
    this.#artifactStore = artifactStore ?? new ArtifactStore()
    this.#pluginAdapter = pluginAdapter
  }

  /**
   * 解析 Compiler run 的 Skill 激活决策。
   *
   * 流程：
   * 1. 检查 skill_activation_decision artifact 是否存在（Resume 复用）
   * 2. 若存在且 evidenceDigest 匹配 → 返回既有 SkillActivationRef
   * 3. 否则：从 Registry 取本组织 active Skill（结合已启用插件贡献）→ resolveActivation → 持久化 → 返回 ref
   *
   * @param compilerRunId Compiler run ID
   * @param organizationId 组织 ID
   * @param activationContext 激活上下文（projectType/industry 等）
   * @returns SkillActivationRef（含 decision、digest、skillKey 列表）
   */
  async resolve(
    compilerRunId: number,
    organizationId: number,
    activationContext: ActivationContext,
  ): Promise<SkillActivationRef | null> {
    // 1. Resume 复用：检查既有 artifact
    const existingRef = await this.#tryResume(compilerRunId, organizationId, activationContext)
    if (existingRef) return existingRef

    // 2. 从 Registry 取本组织 active Skill
    const { data: rawActiveSkills } = await this.#skillRegistry.listByOrg(organizationId, {
      status: 'active',
      perPage: 100, // 足够大的页面
    })

    // 若配置了插件适配服务，过滤掉未启用插件声明的 Skill（无插件组织零行为变化）
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
        // 插件解析故障按降级处理，不影响原生 Skill
      }
    }

    // 3. 空 active Skill 集合 = 合法降级
    if (activeSkills.length === 0) {
      return null
    }

    // 4. 调激活引擎
    const decision = resolveActivation(activationContext, activeSkills)

    // 5. 空激活集 = 合法降级
    if (decision.activatedSkills.length === 0 && decision.advisoryCandidates.length === 0) {
      return null
    }

    // 6. 持久化为 skill_activation_decision artifact
    const artifactId = `skill_activation_${compilerRunId}`
    const idempotencyKey = this.#buildIdempotencyKey(compilerRunId, organizationId)

    await this.#artifactStore.save({
      compilerRunId,
      organizationId,
      kind: 'skill_activation_decision',
      stageId: null,
      artifactId,
      version: 1,
      contentHash: createHash('sha256').update(JSON.stringify(decision)).digest('hex'),
      idempotencyKey,
      summaryLevel: 'full',
      payload: decision as unknown as Record<string, unknown>,
    })

    // 7. 构建 ref
    return this.#buildRef(compilerRunId, organizationId, artifactId, decision)
  }

  // ── Resume 复用 ──

  async #tryResume(
    compilerRunId: number,
    organizationId: number,
    context: ActivationContext,
  ): Promise<SkillActivationRef | null> {
    const artifactId = `skill_activation_${compilerRunId}`

    try {
      const artifacts = await this.#artifactStore.queryByRunId(
        compilerRunId,
        organizationId,
        'skill_activation_decision',
      )

      const existing = artifacts.find((a: Record<string, unknown>) => a.artifactId === artifactId)

      if (!existing) return null

      // 校验 evidenceDigest
      const decision = existing as unknown as ActivationDecision
      if (!decision.evidenceDigest) return null

      // 重新计算当前的 digest 做比较
      const currentSkills = await this.#skillRegistry.listByOrg(organizationId, {
        status: 'active',
        perPage: 100,
      })
      const currentDecision = resolveActivation(context, currentSkills.data)

      if (currentDecision.evidenceDigest === decision.evidenceDigest) {
        // digest 匹配 → 复用
        return this.#buildRef(compilerRunId, organizationId, artifactId, decision)
      }

      // digest 不匹配 → 重新解析
      return null
    } catch {
      return null
    }
  }

  // ── Helpers ──

  #buildRef(
    _compilerRunId: number,
    _organizationId: number,
    artifactId: string,
    decision: ActivationDecision,
  ): SkillActivationRef {
    return {
      activationDecisionRef: `artifact:skill_activation_decision:${artifactId}:v1@full`,
      evidenceDigest: decision.evidenceDigest,
      activatedSkillKeys: decision.activatedSkills.map((e) => e.skill.skillKey),
      advisorySkillKeys: decision.advisoryCandidates.map((e) => e.skill.skillKey),
      decision,
    }
  }

  #buildIdempotencyKey(compilerRunId: number, organizationId: number): string {
    return `skill_activation_decision:${compilerRunId}:${organizationId}:v1`
  }
}
