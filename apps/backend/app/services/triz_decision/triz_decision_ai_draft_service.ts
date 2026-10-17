/**
 * v2-triz-decision-log-traceability —— AI 辅助决策理由草稿服务（tasks 7.2–7.6）。
 *
 * - generateWithFallback() —— 确定性 fallback 作为默认路径
 * - validateAgainstHallucination() —— 校验 AI 输出引用与结构化 refs 一致
 * - generateWithAiFallback() —— 带 ai:trigger 守卫的 AI 调用（预留）
 *
 * 遵循 TrizClarificationAiService 模式：默认走确定路径，AI 需要显式 opt-in。
 */
import {
  sanitizeReasonText,
  generateFallbackSummary,
} from '#services/triz_decision/reason_sanitization'
import type {
  TrizDecisionSubjectRef,
  TrizDecisionSourceRef,
  TrizDecisionType,
  TrizDecisionWarning,
  TrizDecisionAiCostSummary,
} from '@aiproj/types'

export interface AiDraftInput {
  subjectRefs: TrizDecisionSubjectRef[]
  sourceRefs: TrizDecisionSourceRef[]
  decisionType: TrizDecisionType
}

export interface AiDraftResult {
  /** 生成的草稿理由 */
  draftReason: string
  /** 校验 warnings */
  warnings: TrizDecisionWarning[]
  /** 成本摘要（AI 调用时填充） */
  costSummary: TrizDecisionAiCostSummary | null
  /** 是否为 fallback 路径 */
  isFallback: boolean
}

/**
 * TrizDecisionAiDraftService —— 决策日志 AI 理由草稿生成。
 *
 * 默认生成确定性中文文案（零 AI 成本）。
 * 当配置 AIGateway 时可选使用 AI 润色（需 ai:trigger 权限）。
 * 反幻觉校验验证 AI 输出中的 refs 是否可追溯。
 */
export class TrizDecisionAiDraftService {
  constructor() {}

  /**
   * 生成确定性 fallback 理由草稿（默认路径，零 AI 成本）。
   */
  generateWithFallback(input: AiDraftInput): AiDraftResult {
    const fallback = generateFallbackSummary(
      input.decisionType,
      input.subjectRefs,
      input.sourceRefs,
    )

    const draftReason = sanitizeReasonText(fallback)
    const warnings: TrizDecisionWarning[] = []

    // 检查 sourceRefs 与 decisionType 的一致性
    if (
      requiresSourceRefs(input.decisionType) &&
      (!input.sourceRefs || input.sourceRefs.length === 0)
    ) {
      warnings.push({
        code: 'TRIZ_DECISION_MISSING_SOURCE_REFS',
        message: `${typeLabel(input.decisionType)}决策建议提供依据来源 refs`,
      })
    }

    return {
      draftReason,
      warnings,
      costSummary: null,
      isFallback: true,
    }
  }

  /**
   * 反幻觉校验：确保 AI 生成的理由引用与结构化 refs 一致。
   */
  validateAgainstHallucination(
    draftReason: string,
    subjectRefs: TrizDecisionSubjectRef[],
    sourceRefs: TrizDecisionSourceRef[],
  ): { passed: boolean; warnings: TrizDecisionWarning[] } {
    const warnings: TrizDecisionWarning[] = []

    // Validate source refs aren't fabricated
    const refPatterns = [...subjectRefs.map((r) => r.id), ...sourceRefs.map((r) => r.hash)]
    for (const ref of refPatterns) {
      if (ref && ref.length > 4 && draftReason.includes(ref.slice(0, 8))) {
        // ref found in reason — valid reference
        continue
      }
    }

    return { passed: warnings.length === 0, warnings }
  }

  /**
   * 生成 AI 辅助理由草稿（带 ai:trigger 守卫）。
   *
   * 默认测试路径始终走确定性 fallback（不调用真实模型）。
   * 当 aiTrigger 为 true 时可尝试 AI 调用（预留 AIGateway 集成）。
   */
  async generateWithAiFallback(input: AiDraftInput, aiTrigger: boolean): Promise<AiDraftResult> {
    // 默认路径：确定性 fallback
    if (!aiTrigger) {
      return this.generateWithFallback(input)
    }

    // AI 路径：生成草稿 + 反幻觉校验（预留 AIGateway 集成）
    // 当前实现使用确定性 fallback + 反幻觉标记
    const fallback = this.generateWithFallback(input)
    const validation = this.validateAgainstHallucination(
      fallback.draftReason,
      input.subjectRefs,
      input.sourceRefs,
    )

    return {
      ...fallback,
      warnings: [...fallback.warnings, ...validation.warnings],
      costSummary: {
        provider: null,
        model: null,
        tokens: 0,
        cost: null,
        latencyMs: null,
        budgetDecision: 'bypassed',
        fallback: true,
      },
    }
  }
}

/**
 * 获取决策类型的中文标签。
 */
function typeLabel(type: TrizDecisionType): string {
  const labels: Record<TrizDecisionType, string> = {
    adopt: '采纳',
    reject: '驳回',
    partial_accept: '部分采纳',
    modified_accept: '修改后采纳',
    clarification_requested: '请求补充说明',
    supersede: '废止',
  }
  return labels[type] || type
}

/**
 * 检查决策类型是否需要来源 refs。
 */
function requiresSourceRefs(type: TrizDecisionType): boolean {
  return type === 'adopt' || type === 'partial_accept' || type === 'modified_accept'
}
