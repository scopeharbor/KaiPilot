/**
 * v2-context-compiler-artifact-store —— ContextCompilerService（tasks 4.1-4.5）。
 *
 * 根据 Stage Contract、resolved context、target entity/batch、artifact refs、token budget 与 repair feedback
 * 编译 Context Packet，并按预算裁剪。生成的 Packet 保存为 context_packet artifact。
 *
 * Section 优先级体系：
 * - P0（system, stageDirective）：不可裁剪；超预算直接失败
 * - P1（targetEntity, requiredArtifacts, constraints, repairFeedback）：优先 full，必要时 compact
 * - P2（neighbors, userInput）：可降级为 compact 或 ref-only
 */
import { ArtifactStore } from './artifact_store.js'
import type { ContextScope, StageDefinition } from '@aiproj/compiler-spec'
import {
  type ArtifactRef,
  type ContextBudget,
  type ContextPacket,
  type ContextSection,
  type ContextProvenance,
  contextPacketSchema,
  estimateTokens,
  stringifyArtifactRef,
} from '@aiproj/compiler-spec'
import type { SkillActivationRef } from '@aiproj/types'
import { buildSkillKnowledgeSection } from './skill_knowledge_section_builder.js'

// ── Input Types ──

export interface ContextCompilerInput {
  compilerRunId: number
  organizationId: number
  stageDefinition: StageDefinition
  targetEntityId?: string
  targetBatchId?: string
  artifactRefs: ArtifactRef[]
  tokenBudget: number
  repairFeedback?: RepairFeedbackEntry[]
  userInput?: Record<string, unknown>
  allowedTools?: string[]
  /** v3-skill-compiler-integration：激活决策引用（仅 LLM/hybrid Stage 传入） */
  skillActivationRef?: SkillActivationRef
  /** v3-skill-compiler-integration：feature flag（默认关闭） */
  skillInjectionEnabled?: boolean
}

export interface RepairFeedbackEntry {
  source: string
  severity: 'error' | 'warning' | 'info'
  message: string
  artifactRef?: string
}

// ── Output Types ──

export interface ContextCompilerResult {
  packetRef: string
  packet: ContextPacket
  budgetSummary: ContextBudgetSummary
  provenance: ContextProvenance
}

export interface ContextBudgetSummary {
  totalBudget: number
  totalRequested: number
  totalIncluded: number
  overBudget: boolean
  sections: Array<{
    name: string
    priority: string
    requested: number
    included: number
    summaryLevel: string
    cutReason?: string
  }>
}

// ── Errors ──

export class ContextCompilerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ContextCompilerError'
  }
}

// ── Service ──

/**
 * ContextCompilerService —— 按 Stage Contract 编译并裁剪 Context Packet。
 *
 * 实现 D4（固定 section 模板 + P0/P1/P2 优先级）、D5（只在 llm/hybrid Stage 强制）。
 */
export class ContextCompilerService {
  readonly #artifactStore: ArtifactStore

  constructor(artifactStore?: ArtifactStore) {
    this.#artifactStore = artifactStore ?? new ArtifactStore()
  }

  // ── Section Builders ──

  /** P0: system section  — 全局规则与 JSON 输出边界。 */
  #buildSystemSection(): ContextSection {
    return {
      name: 'system',
      priority: 'P0',
      summaryLevel: 'full',
      requestedTokens: 0,
      includedTokens: 0,
      content: {
        role: '你是开项 KaiPilot 项目管理助手',
        rules: [
          '始终以简体中文回复',
          '输出必须符合 JSON Schema',
          '禁止新增 Manifest 未登记的实体',
          '禁止跨组织数据泄露',
        ],
        outputFormat: 'strict_json',
      },
      sourceRefs: [],
    }
  }

  /** P0: stageDirective section — Stage Contract 摘要。 */
  #buildStageDirectiveSection(definition: StageDefinition): ContextSection {
    return {
      name: 'stageDirective',
      priority: 'P0',
      summaryLevel: 'full',
      requestedTokens: 0,
      includedTokens: 0,
      content: {
        stageId: definition.stageId,
        type: definition.type,
        phase: definition.phase,
        name: definition.name,
        description: definition.description,
        contextScope: definition.contextScope,
        allowedTools: definition.allowedTools,
        sideEffects: definition.sideEffects,
      },
      sourceRefs: [],
    }
  }

  /** P1: targetEntity section。 */
  #buildTargetEntitySection(entityId?: string, batchId?: string): ContextSection {
    return {
      name: 'targetEntity',
      priority: 'P1',
      summaryLevel: 'full',
      requestedTokens: 200,
      includedTokens: 0,
      content: {
        targetEntityId: entityId ?? null,
        targetBatchId: batchId ?? null,
      },
      sourceRefs: [],
    }
  }

  /** P1: requiredArtifacts section。 */
  #buildRequiredArtifactsSection(refs: ArtifactRef[]): ContextSection {
    const refStrings = refs.map((r) => stringifyArtifactRef(r))
    return {
      name: 'requiredArtifacts',
      priority: 'P1',
      summaryLevel: 'compact',
      requestedTokens: refs.length * 100,
      includedTokens: 0,
      content: { artifactRefs: refStrings },
      sourceRefs: refStrings,
    }
  }

  /** P1: constraints section。 */
  #buildConstraintsSection(definition: StageDefinition): ContextSection {
    return {
      name: 'constraints',
      priority: 'P1',
      summaryLevel: 'full',
      requestedTokens: 500,
      includedTokens: 0,
      content: {
        contextScope: definition.contextScope,
        timeoutMs: definition.timeoutMs,
      },
      sourceRefs: [],
    }
  }

  /** P2: neighbors section。 */
  #buildNeighborsSection(refs: ArtifactRef[]): ContextSection {
    const refStrings = refs.map((r) => stringifyArtifactRef(r))
    return {
      name: 'neighbors',
      priority: 'P2',
      summaryLevel: 'compact',
      requestedTokens: refs.length * 50,
      includedTokens: 0,
      content: { neighborRefs: refStrings },
      sourceRefs: refStrings,
    }
  }

  /** P1: repairFeedback section — 仅 repair/retry 时出现。 */
  #buildRepairFeedbackSection(feedback: RepairFeedbackEntry[]): ContextSection | null {
    if (feedback.length === 0) return null
    return {
      name: 'repairFeedback',
      priority: 'P1',
      summaryLevel: 'full',
      requestedTokens: feedback.length * 200,
      includedTokens: 0,
      content: {
        feedback: feedback.map((f) => ({
          source: f.source,
          severity: f.severity,
          message: f.message,
          artifactRef: f.artifactRef ?? null,
        })),
      },
      sourceRefs: feedback.filter((f) => f.artifactRef).map((f) => f.artifactRef!),
    }
  }

  /** P2: userInput section。 */
  #buildUserInputSection(userInput?: Record<string, unknown>): ContextSection | null {
    if (!userInput || Object.keys(userInput).length === 0) return null
    return {
      name: 'userInput',
      priority: 'P2',
      summaryLevel: 'full',
      requestedTokens: estimateTokens(userInput),
      includedTokens: 0,
      content: userInput,
      sourceRefs: [],
    }
  }

  // ── Budget & Cut Algorithm ──

  /**
   * 预算与裁剪算法（D4）。
   *
   * P0 sections 不可裁剪；超出预算则失败。
   * P1 sections 优先 full，必要时 compact。
   * P2 sections 降级为 compact 或 ref-only。
   */
  #applyBudget(
    sections: ContextSection[],
    totalBudget: number,
  ): { sections: ContextSection[]; budget: ContextBudget } {
    // 1. 分离 P0 vs P1/P2
    const p0Sections = sections.filter((s) => s.priority === 'P0')
    const otherSections = sections.filter((s) => s.priority !== 'P0')

    // 2. 估算 token
    for (const section of sections) {
      if (section.requestedTokens === 0) {
        section.requestedTokens = estimateTokens(section.content)
      }
    }

    // 3. P0 必须全量包含
    let totalIncluded = 0
    for (const s of p0Sections) {
      s.includedTokens = s.requestedTokens
      s.summaryLevel = 'full'
      totalIncluded += s.includedTokens
    }

    // 4. 检查 P0 是否超预算
    if (totalIncluded > totalBudget) {
      return {
        sections,
        budget: {
          totalBudget,
          totalRequested: sections.reduce((sum, s) => sum + s.requestedTokens, 0),
          totalIncluded,
          sections,
          overBudget: true,
          overBudgetReason: `P0 sections (${p0Sections.map((s) => s.name).join(', ')}) require ${totalIncluded} tokens, exceeding total budget of ${totalBudget}`,
        },
      }
    }

    const remaining = totalBudget - totalIncluded

    // 5. P1: 先 full，超出则 compact
    const p1Sections = otherSections.filter((s) => s.priority === 'P1')
    for (const s of p1Sections) {
      if (s.requestedTokens <= remaining) {
        s.includedTokens = s.requestedTokens
        s.summaryLevel = 'full'
      } else {
        // compact 占约 30%
        const compactTokens = Math.ceil(s.requestedTokens * 0.3)
        if (compactTokens <= remaining) {
          s.includedTokens = compactTokens
          s.summaryLevel = 'compact'
          s.cutReason = 'budget_limit'
        } else {
          s.includedTokens = 0
          s.summaryLevel = 'compact'
          s.cutReason = 'ref_only'
        }
      }
    }

    // 6. P2: compact 或 ref-only
    const p2Sections = otherSections.filter((s) => s.priority === 'P2')
    for (const s of p2Sections) {
      if (s.requestedTokens <= remaining) {
        s.includedTokens = s.requestedTokens
        s.summaryLevel = 'full'
      } else {
        const compactTokens = Math.ceil(s.requestedTokens * 0.2)
        if (compactTokens <= remaining) {
          s.includedTokens = compactTokens
          s.summaryLevel = 'compact'
          s.cutReason = 'budget_limit'
        } else {
          s.includedTokens = 0
          s.summaryLevel = 'compact'
          s.cutReason = 'ref_only'
        }
      }
    }

    totalIncluded = sections.reduce((sum, s) => sum + s.includedTokens, 0)

    return {
      sections,
      budget: {
        totalBudget,
        totalRequested: sections.reduce((sum, s) => sum + s.requestedTokens, 0),
        totalIncluded,
        sections,
        overBudget: false,
      },
    }
  }

  // ── Scope & Tool Filtering ──

  /**
   * 根据 Stage Contract 的 contextScope 过滤 artifact 可见性（D6/D7）。
   * 禁止超 scope 数据进入 Context Packet。
   */
  #filterByScope(
    refs: ArtifactRef[],
    scopes: ContextScope[],
    organizationId: number,
  ): ArtifactRef[] {
    // 组织隔离（v3-multitenant-isolation-architecture §6.1）。
    //
    // 旧实现额外放行 `r.organizationId === 0`。ArtifactRef schema 声明
    // `organizationId: z.number().int().positive()`，0 不是合法取值，而是
    // `parseArtifactRef` 留给调用方回填的占位（`packages/compiler-spec/src/
    // artifact-context.ts:84`）——即"租户未填"。把未填当全局放行，等于给
    // Context Packet 开了一个不受 registry 管辖的隐式 global 通道；而 registry
    // 对 compiler_artifact 声明 `allowSuperAdminGlobal: false`，本就不存在
    // 合法的全局 compiler artifact。此处改为严格同组织，未填即丢弃（fail closed）。
    const orgFiltered = refs.filter((r) => r.organizationId === organizationId)

    // scope 过滤
    if (scopes.includes('user_input_only')) {
      // user_input_only 只允许 user input 相关 artifact
      return []
    }

    if (scopes.includes('run_metadata')) {
      return orgFiltered.filter((r) => ['contract', 'manifest', 'ledger'].includes(r.kind))
    }

    return orgFiltered
  }

  // ── Main Compile Method ──

  /**
   * 编译 Context Packet。
   *
   * 流程：
   * 1. 构建固定 section（按优先级排序）
   * 2. 估算 token 并执行预算裁剪
   * 3. P0 超预算失败
   * 4. 保存并返回 Context Packet
   */
  async compile(input: ContextCompilerInput): Promise<ContextCompilerResult> {
    const {
      compilerRunId,
      organizationId,
      stageDefinition,
      targetEntityId,
      targetBatchId,
      artifactRefs,
      tokenBudget,
      repairFeedback,
      userInput,
      skillActivationRef,
      skillInjectionEnabled,
    } = input

    // 0. 租户边界（v3-multitenant-isolation-architecture §6.1）：
    //    scope 校验必须在**任何 prompt / source summary / section 组装之前**完成。
    //    缺失或非法组织上下文一律失败，不允许"先组装再过滤"。
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new ContextCompilerError(
        'Context compilation requires a resolved organization scope',
        'TENANT_SCOPE_REQUIRED',
        { compilerRunId },
      )
    }

    // 1. 过滤 artifact refs
    const filteredRefs = this.#filterByScope(
      artifactRefs,
      stageDefinition.contextScope,
      organizationId,
    )

    // 2. 构建 section
    const sections: ContextSection[] = [
      this.#buildSystemSection(),
      this.#buildStageDirectiveSection(stageDefinition),
      this.#buildTargetEntitySection(targetEntityId, targetBatchId),
      this.#buildRequiredArtifactsSection(filteredRefs),
      this.#buildConstraintsSection(stageDefinition),
      this.#buildNeighborsSection(filteredRefs),
    ]

    // repair feedback（P1，仅在 retry/repair 时）
    const repairSection = this.#buildRepairFeedbackSection(repairFeedback ?? [])
    if (repairSection) sections.push(repairSection)

    // userInput（P2）
    const userInputSection = this.#buildUserInputSection(userInput)
    if (userInputSection) sections.push(userInputSection)

    // v3-skill-compiler-integration: skillKnowledge (P2，条件性注入)
    const contextScope = stageDefinition.contextScope ?? []
    const shouldInjectSkill =
      skillInjectionEnabled === true &&
      skillActivationRef !== null &&
      skillActivationRef !== undefined &&
      !contextScope.includes('user_input_only')

    if (shouldInjectSkill) {
      const skillBudget = Math.floor(tokenBudget * 0.15) // 最多占 15% 预算
      const result = buildSkillKnowledgeSection(
        skillActivationRef,
        stageDefinition.stageId,
        skillBudget,
      )
      if (result.section) {
        sections.push(result.section)
      }
    }

    // 3. 预算裁剪
    const { sections: budgetedSections, budget } = this.#applyBudget(sections, tokenBudget)

    // 4. P0 超预算必须失败
    if (budget.overBudget) {
      throw new ContextCompilerError(
        budget.overBudgetReason ?? 'P0 sections over budget',
        'BUDGET_EXCEEDED_P0',
        { totalBudget: tokenBudget, sections: budgetedSections.map((s) => s.name) },
      )
    }

    // 5. 构建 provenance
    const provenance: ContextProvenance = {
      inputScope: stageDefinition.contextScope,
      allowedTools: stageDefinition.allowedTools.map((t) => (typeof t === 'string' ? t : t.toolId)),
      repairFeedbackRefs: (repairFeedback ?? [])
        .filter((f) => f.artifactRef)
        .map((f) => f.artifactRef!),
      skillActivationRef: skillActivationRef?.activationDecisionRef,
      advisorySkillRefs: skillActivationRef?.advisorySkillKeys ?? [],
    }

    // 6. 构建 packet
    const packetId = `ctx_${compilerRunId}_${stageDefinition.stageId}_${Date.now()}`
    const packet: ContextPacket = {
      schemaVersion: '2.0',
      packetId,
      compilerRunId,
      organizationId,
      targetEntityId,
      targetBatchId,
      sections: budgetedSections,
      budget,
      provenance,
      createdAt: new Date().toISOString(),
    }

    // 7. Schema 校验
    const validation = contextPacketSchema.safeParse(packet)
    if (!validation.success) {
      throw new ContextCompilerError(
        `Context Packet validation failed: ${validation.error.issues.map((i) => i.message).join('; ')}`,
        'INTERNAL_ERROR',
      )
    }

    // 8. 保存为 context_packet artifact
    await this.#artifactStore.save({
      compilerRunId,
      organizationId,
      kind: 'context_packet',
      stageId: stageDefinition.stageId,
      artifactId: packetId,
      version: 1,
      summaryLevel: 'full',
      payload: packet as unknown as Record<string, unknown>,
    })

    const packetRef = stringifyArtifactRef({
      compilerRunId,
      organizationId,
      kind: 'context_packet',
      artifactId: packetId,
      version: 1,
      summaryLevel: 'full',
      stageId: stageDefinition.stageId,
    })

    // 9. 返回结果
    return {
      packetRef,
      packet,
      budgetSummary: {
        totalBudget: budget.totalBudget,
        totalRequested: budget.totalRequested,
        totalIncluded: budget.totalIncluded,
        overBudget: budget.overBudget,
        sections: budgetedSections.map((s) => ({
          name: s.name,
          priority: s.priority,
          requested: s.requestedTokens,
          included: s.includedTokens,
          summaryLevel: s.summaryLevel,
          cutReason: s.cutReason,
        })),
      },
      provenance,
    }
  }
}
