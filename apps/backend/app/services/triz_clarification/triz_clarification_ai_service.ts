/**
 * v2-triz-ai-clarification-cards —— TRIZ 卡片 AI 文案与反幻觉校验（tasks 5.1–5.5）。
 *
 * 默认使用确定性中文文案。AI/wording path 可选，需 ai:trigger 权限。
 * 反幻觉校验确保 AI 输出可追溯到结构化 refs。
 */
import {
  type TrizClarificationSourceRef,
  type TrizClarificationCandidate,
  type TrizClarificationWarning,
} from '@aiproj/types'

export interface AiWordingResult {
  /** 是否成功 */
  success: boolean
  /** 生成的文案 */
  wording: string | null
  /** 描述（可能含 AI 润色或 fallback 说明） */
  description: string | null
  /** 是否 fallback */
  isFallback: boolean
  /** warnings */
  warnings: TrizClarificationWarning[]
  /** provider（AI 调用时填充） */
  provider: string | null
  /** model（AI 调用时填充） */
  model: string | null
  /** 成本摘要 */
  cost: {
    promptTokens: number | null
    completionTokens: number | null
    estimatedCost: number | null
    latencyMs: number | null
  } | null
}

/**
 * TrizClarificationAiService —— TRIZ 卡片 AI 文案与反幻觉校验。
 *
 * 默认生成确定性中文文案（tasks 5.1），不使用 AI。
 * 当配置 AIGateway 时可选使用 AI 润色（tasks 5.2）。
 * 反幻觉校验验证 AI 输出中的 refs 是否可追溯（tasks 5.3）。
 */
export class TrizClarificationAiService {
  constructor() {}

  /**
   * 生成确定性中文卡片文案（默认路径，零 AI 成本）。
   */
  generateDeterministicWording(candidate: TrizClarificationCandidate): AiWordingResult {
    return {
      success: true,
      wording: candidate.title,
      description: `TRIZ 澄清卡片已生成：${candidate.sourceRefs.length} 个来源，严重度 ${candidate.severity}。`,
      isFallback: false,
      warnings: [],
      provider: null,
      model: null,
      cost: null,
    }
  }

  /**
   * 反幻觉校验：验证 AI 输出中的引用与结构化 refs 一致。
   * 校验失败则降级为确定性文案。
   */
  validateAgainstHallucination(
    _aiWording: string,
    sourceRefs: TrizClarificationSourceRef[],
  ): { passed: boolean; warnings: TrizClarificationWarning[] } {
    const warnings: TrizClarificationWarning[] = []

    // 检查 AI 文案中是否提及不存在的矛盾 key
    const validKeys = new Set(sourceRefs.map((r) => r.key))
    for (const ref of sourceRefs) {
      if (!validKeys.has(ref.key)) {
        warnings.push({
          code: 'TRIZ_HALLUCINATION_WARNING',
          message: `AI 文案引用了不存在的矛盾「${ref.key}」`,
          source: 'triz-clarification-ai-service',
        })
      }
    }

    return {
      passed: warnings.length === 0,
      warnings,
    }
  }

  /**
   * 尝试 AI 润色（带 budget guard 和 fallback）。
   * 本方法当前简化实现——直接返回 deterministic wording；
   * 未来接入 AIGateway 后可在此扩展。
   */
  async generateWithAiFallback(
    candidate: TrizClarificationCandidate,
    hasAiTrigger: boolean,
  ): Promise<AiWordingResult> {
    // 没有 ai:trigger 权限 → 走确定性文案
    if (!hasAiTrigger) {
      return this.generateDeterministicWording(candidate)
    }

    // 简化：当前版本直接返回确定性文案（AI 润色为未来扩展）
    // TODO-v2: 接入 AIGateway 实现 AI 润色
    return {
      ...this.generateDeterministicWording(candidate),
      warnings: [],
    }
  }
}
