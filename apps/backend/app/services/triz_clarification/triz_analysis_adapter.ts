/**
 * v2-triz-ai-clarification-cards —— TRIZ Analysis Artifact Adapter（tasks 2.2）。
 *
 * 当 TrizAnalysisArtifact 可用时消费其 compact hints/refs；
 * 不可用时返回 TRIZ_ANALYSIS_UNAVAILABLE warning。
 * 此适配器不读取正式业务表。
 */
import type { TrizAnalysisClarificationHint, TrizClarificationWarningCode } from '@aiproj/types'
import type { TrizAnalysisArtifact } from '@aiproj/types'

export interface TrizAnalysisAdapterResult {
  hint: TrizAnalysisClarificationHint | null
  warningCodes: TrizClarificationWarningCode[]
  warnings: Array<{ code: string; message: string; source?: string }>
}

/**
 * TrizAnalysisArtifactAdapter —— 可选 TRIZ analysis artifact 适配器。
 *
 * 当 artifact 可用时，从 artifact 中提取 compact clarification hints；
 * 不可用时返回 warning。
 * 本适配器仅消费已有 artifact，不触发 Compiler run 或 AIGateway 调用。
 */
export class TrizAnalysisArtifactAdapter {
  constructor() {}

  /**
   * 从 TrizAnalysisArtifact 中提取 clarification hints。
   * artifact 为 null 或不可用时返回 TRIZ_ANALYSIS_UNAVAILABLE warning。
   */
  extractHints(artifact: TrizAnalysisArtifact | null): TrizAnalysisAdapterResult {
    if (!artifact) {
      return {
        hint: null,
        warningCodes: ['TRIZ_ANALYSIS_UNAVAILABLE'],
        warnings: [
          {
            code: 'TRIZ_ANALYSIS_UNAVAILABLE',
            message: 'TRIZ 综合分析不可用，基于矛盾 snapshot 派生基础卡片',
            source: 'triz-analysis-artifact-adapter',
          },
        ],
      }
    }

    // 从 artifact 提取紧凑 hints
    const sourceKeys = artifact.sourceContradictions.map((s) => s.key)
    const topTensions = artifact.parameterTensions
      .map((t) => t.technicalSummary || t.physicalSummary || '')
      .filter(Boolean)
    const principleRefs = artifact.principleCandidates.map((p) => ({
      principleId: p.principleId,
      name: p.name,
      relevance: p.relevance,
    }))
    const resolutionPathHints = artifact.resolutionPaths.map((r) => ({
      pathId: r.pathId,
      name: r.name,
      suggestionType: r.suggestionType,
    }))

    // 传递 artifact 的 warning codes
    const warningCodes: TrizClarificationWarningCode[] = []
    const warnings: Array<{ code: string; message: string; source?: string }> = []

    for (const w of artifact.warnings) {
      if (w.code === 'STALE_SOURCE_CONTRADICTION') {
        warningCodes.push('TRIZ_SOURCE_CONTRADICTION_STALE')
        warnings.push({
          code: 'TRIZ_SOURCE_CONTRADICTION_STALE',
          message: w.message,
          source: 'triz-analysis-artifact',
        })
      }
      if (w.code === 'AI_SUMMARY_FALLBACK') {
        warningCodes.push('TRIZ_AI_WORDING_FALLBACK')
        warnings.push({
          code: 'TRIZ_AI_WORDING_FALLBACK',
          message: 'AI 综合已降级为确定性文本',
          source: 'triz-analysis-artifact',
        })
      }
      if (w.code === 'BUDGET_BLOCKED') {
        warningCodes.push('TRIZ_BUDGET_BLOCKED')
        warnings.push({
          code: 'TRIZ_BUDGET_BLOCKED',
          message: '预算阻断导致 AI 综合已跳过',
          source: 'triz-analysis-artifact',
        })
      }
      if (w.code === 'HALLUCINATION_WARNING') {
        warningCodes.push('TRIZ_HALLUCINATION_WARNING')
        warnings.push({
          code: 'TRIZ_HALLUCINATION_WARNING',
          message: '反幻觉校验未通过，AI 文案已降级',
          source: 'triz-analysis-artifact',
        })
      }
    }

    return {
      hint: {
        artifactId: artifact.sourceHashes.contentHash,
        version: 1,
        contentHash: artifact.sourceHashes.contentHash,
        sourceKeys,
        topTensions,
        principleRefs,
        resolutionPathHints,
        warningCodes: artifact.warnings.map((w) => w.code),
        hasAiNarrative: artifact.aiNarrative !== null && artifact.aiNarrative.hallucinationPassed,
      },
      warningCodes,
      warnings,
    }
  }

  /**
   * 检查 artifact 是否可用于澄清（非 stale 且 schema 兼容）。
   */
  isArtifactUsable(artifact: TrizAnalysisArtifact | null): boolean {
    if (!artifact) return false
    if (artifact.status === 'failed') return false
    if (artifact.status === 'needs_human_review') return false
    if (artifact.handoff.status === 'stale') return false
    return true
  }
}
