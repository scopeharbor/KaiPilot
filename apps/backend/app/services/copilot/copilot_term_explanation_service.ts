/**
 * CopilotTermExplanationService —— 术语解释答案合成服务。
 *
 * v3-copilot-project-health-answer / Phase 6
 *
 * 术语解释取知识 L1，继承 L3 Synthetic 排除；
 * 无命中时给出「知识库暂未收录」而非模型自由发挥。
 *
 * 红线：
 * - 术语解释走生产知识路径，L3 Synthetic 恒排除
 * - 无命中时输出「知识库暂未收录」，不回落模型常识
 * - 术语解释带 SourceRef，可追溯到知识条目
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import type {
  CopilotAnswerOutput,
  CopilotAnswerSufficient,
  CopilotAnswerInsufficient,
  CopilotAnswerEntry,
  CopilotUncertaintyEntry,
  CopilotConclusionTraceEntry,
  KnowledgeItemLowSensitiveProjection,
} from '@aiproj/types'
import CopilotAnswerSynthesisService from './copilot_answer_synthesis_service.js'
import type { SynthesisMaterialEntry } from './copilot_answer_synthesis_service.js'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 术语解释答案请求参数。 */
export interface TermExplanationParams {
  /** 组织 ID。 */
  readonly organizationId: number
  /** 项目 ID。 */
  readonly projectId: number
  /** 用户 ID。 */
  readonly userId: number
  /** 要解释的术语。 */
  readonly term: string
  /** 知识条目列表（来自 knowledge_service L1 生产路径）。 */
  readonly knowledgeEntries: readonly KnowledgeItemLowSensitiveProjection[]
  /** 不确定三分条目（来自上下文装配）。 */
  readonly uncertainty: readonly CopilotUncertaintyEntry[]
  /** 结论回溯条目（来自上下文装配）。 */
  readonly conclusionTrace: readonly CopilotConclusionTraceEntry[]
  /** 模型是否可用。 */
  readonly modelAvailable: boolean
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@inject()
export default class CopilotTermExplanationService {
  constructor(private synthesisService: CopilotAnswerSynthesisService) {}

  // -----------------------------------------------------------------------
  // 主入口
  // -----------------------------------------------------------------------

  /**
   * 合成术语解释答案。
   *
   * @param params 术语解释答案请求参数
   * @returns 术语解释答案输出
   */
  async answer(params: TermExplanationParams): Promise<CopilotAnswerOutput> {
    // Step 1: 从知识条目提取素材
    const materials = this.extractMaterials(params)

    // Step 2: 如果素材为空，返回「知识库暂未收录」
    if (materials.length === 0) {
      return this.buildInsufficientResult(params)
    }

    // Step 3: 使用合成服务生成答案
    const synthesisResult = this.synthesisService.synthesize(
      'term-explanation',
      materials,
      params.uncertainty,
      params.conclusionTrace,
      params.modelAvailable,
    )

    // Step 4: 构建最终答案
    if (synthesisResult.entries.length === 0) {
      return this.buildInsufficientResult(params)
    }

    // Step 5: 生成叙述文本
    const narrative = this.generateNarrative(synthesisResult.entries, params.term)

    // Step 6: 构建充足答案
    const answer: CopilotAnswerSufficient = {
      kind: 'sufficient',
      answerKind: 'term-explanation',
      entries: synthesisResult.entries,
      narrative,
      isFallback: synthesisResult.isFallback,
      fallbackReason: synthesisResult.fallbackReason,
    }

    return answer
  }

  // -----------------------------------------------------------------------
  // 素材提取
  // -----------------------------------------------------------------------

  /**
   * 从知识条目提取素材。
   *
   * 红线：L3 Synthetic 恒排除。
   */
  private extractMaterials(params: TermExplanationParams): readonly SynthesisMaterialEntry[] {
    const materials: SynthesisMaterialEntry[] = []

    for (const entry of params.knowledgeEntries) {
      // 红线：L3 Synthetic 恒排除
      if (entry.layer === 'L3' && entry.isSynthetic) {
        continue
      }

      // 只取 L1 生产路径
      if (entry.layer !== 'L1') {
        continue
      }

      // 只取 active 状态的知识条目
      if (entry.status !== 'active') {
        continue
      }

      materials.push({
        materialId: `kb-${entry.id}`,
        materialKind: 'knowledge-entry',
        summary: entry.title,
        group: 'term',
        confidence: 'high',
      })
    }

    return materials
  }

  // -----------------------------------------------------------------------
  // 辅助方法
  // -----------------------------------------------------------------------

  /**
   * 生成叙述文本。
   */
  private generateNarrative(entries: readonly CopilotAnswerEntry[], term: string): string {
    if (entries.length === 0) {
      return `「${term}」的知识库暂未收录。`
    }

    return entries.map((e) => e.statement).join('。')
  }

  /**
   * 构建「知识库暂未收录」结果。
   */
  private buildInsufficientResult(params: TermExplanationParams): CopilotAnswerInsufficient {
    return {
      kind: 'insufficient',
      reason: 'no-knowledge-entry',
      missingWhat: `知识库暂未收录「${params.term}」`,
    }
  }
}
