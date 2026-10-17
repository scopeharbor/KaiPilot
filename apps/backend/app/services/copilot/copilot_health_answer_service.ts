/**
 * CopilotHealthAnswerService —— 项目健康答案合成服务。
 *
 * v3-copilot-project-health-answer / Phase 4
 *
 * 健康答案由诊断项与预测信号聚合，复用既有服务不新增规则。
 * 每条结论可展开到具体诊断项或预测信号。
 * 零素材时输出「暂无足够依据」并说明缺什么。
 * 答案结论集合是健康诊断页面结论集合的子集。
 *
 * 红线：
 * - 复用既有 diagnosis_service 和 prediction_service，不新增规则
 * - 每条结论可追溯到具体诊断项或预测信号
 * - 零素材时不产出任何结论、不回落通用建议
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
  HealthDiagnosisSummary,
  HealthDimensionScore,
  PredictionSignalInput,
  CopilotConfidenceBand,
} from '@aiproj/types'
import CopilotAnswerSynthesisService from './copilot_answer_synthesis_service.js'
import type { SynthesisMaterialEntry } from './copilot_answer_synthesis_service.js'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 健康答案请求参数。 */
export interface HealthAnswerParams {
  /** 组织 ID。 */
  readonly organizationId: number
  /** 项目 ID。 */
  readonly projectId: number
  /** 用户 ID。 */
  readonly userId: number
  /** 健康诊断摘要（来自 diagnosis_service）。 */
  readonly diagnosisSummary: HealthDiagnosisSummary | null
  /** 预测信号列表（来自 prediction_service）。 */
  readonly predictionSignals: readonly PredictionSignalInput[]
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
export default class CopilotHealthAnswerService {
  constructor(private synthesisService: CopilotAnswerSynthesisService) {}

  // -----------------------------------------------------------------------
  // 主入口
  // -----------------------------------------------------------------------

  /**
   * 合成项目健康答案。
   *
   * @param params 健康答案请求参数
   * @returns 健康答案输出
   */
  async answer(params: HealthAnswerParams): Promise<CopilotAnswerOutput> {
    // Step 1: 从诊断摘要和预测信号提取素材
    const materials = this.extractMaterials(params)

    // Step 2: 如果素材为空，返回「暂无足够依据」
    if (materials.length === 0) {
      return this.buildInsufficientResult(params)
    }

    // Step 3: 使用合成服务生成答案
    const synthesisResult = this.synthesisService.synthesize(
      'health',
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
    const narrative = this.generateNarrative(synthesisResult.entries)

    // Step 6: 构建充足答案
    const answer: CopilotAnswerSufficient = {
      kind: 'sufficient',
      answerKind: 'health',
      entries: synthesisResult.entries,
      narrative,
      isFallback: synthesisResult.isFallback,
      fallbackReason: synthesisResult.fallbackReason,
      deepLink: {
        label: '查看健康诊断详情',
        href: `/projects/${params.projectId}/health`,
      },
    }

    return answer
  }

  // -----------------------------------------------------------------------
  // 素材提取
  // -----------------------------------------------------------------------

  /**
   * 从诊断摘要和预测信号提取素材。
   */
  private extractMaterials(params: HealthAnswerParams): readonly SynthesisMaterialEntry[] {
    const materials: SynthesisMaterialEntry[] = []

    // 从诊断摘要提取素材
    if (params.diagnosisSummary) {
      materials.push(...this.extractDiagnosisMaterials(params.diagnosisSummary))
    }

    // 从预测信号提取素材
    materials.push(...this.extractPredictionMaterials(params.predictionSignals))

    return materials
  }

  /**
   * 从诊断摘要提取素材。
   */
  private extractDiagnosisMaterials(
    summary: HealthDiagnosisSummary,
  ): readonly SynthesisMaterialEntry[] {
    const materials: SynthesisMaterialEntry[] = []

    // 整体健康状况
    materials.push({
      materialId: `diag-overall-${summary.overallScore}`,
      materialKind: 'diagnosis-item',
      summary: `项目整体健康状况为${summary.overallLabel}，总分${summary.overallScore}分`,
      group: 'overall',
      confidence: 'medium',
    })

    // 各维度评分
    for (const dim of summary.dimensionScores) {
      if (dim.evidence.length > 0) {
        materials.push(...this.extractDimensionMaterials(dim))
      }
    }

    return materials
  }

  /**
   * 从维度评分提取素材。
   */
  private extractDimensionMaterials(dim: HealthDimensionScore): readonly SynthesisMaterialEntry[] {
    const materials: SynthesisMaterialEntry[] = []

    for (const evidence of dim.evidence) {
      materials.push({
        materialId: `diag-${evidence.ruleId}-${dim.dimension}`,
        materialKind: 'diagnosis-item',
        summary: evidence.summary,
        severity: evidence.severity,
        scoreImpact: evidence.impact,
        group: dim.dimension,
        confidence: this.severityToConfidence(evidence.severity),
      })
    }

    return materials
  }

  /**
   * 从预测信号提取素材。
   */
  private extractPredictionMaterials(
    signals: readonly PredictionSignalInput[],
  ): readonly SynthesisMaterialEntry[] {
    const materials: SynthesisMaterialEntry[] = []

    for (const [i, signal] of signals.entries()) {
      materials.push({
        materialId: `pred-${signal.ruleId}-${i}`,
        materialKind: 'prediction-signal',
        summary: signal.description,
        severity: signal.severity,
        scoreImpact: signal.score,
        group: this.signalTypeToGroup(signal.signalType),
        confidence: this.confidenceBandToConfidence(signal.confidenceBand),
      })
    }

    return materials
  }

  // -----------------------------------------------------------------------
  // 辅助方法
  // -----------------------------------------------------------------------

  /**
   * 严重度转置信度。
   */
  private severityToConfidence(severity: string): CopilotConfidenceBand {
    switch (severity) {
      case 'critical':
      case 'high':
        return 'high'
      case 'medium':
        return 'medium'
      case 'low':
        return 'low'
      default:
        return 'fallback'
    }
  }

  /**
   * 预测置信度带转置信度。
   */
  private confidenceBandToConfidence(band: string): CopilotConfidenceBand {
    switch (band) {
      case 'high':
        return 'high'
      case 'medium':
        return 'medium'
      case 'low':
        return 'low'
      default:
        return 'fallback'
    }
  }

  /**
   * 预测信号类型转分组。
   */
  private signalTypeToGroup(signalType: string): string {
    const groupMap: Record<string, string> = {
      schedule_risk: 'progress',
      critical_path_drift: 'critical_path',
      milestone_pressure: 'milestone',
      dependency_block: 'critical_path',
      resource_bottleneck: 'resource',
      risk_escalation: 'risk',
      change_impact: 'change_impact',
      data_staleness: 'data_integrity',
      data_quality: 'data_integrity',
    }
    return groupMap[signalType] ?? 'other'
  }

  /**
   * 生成叙述文本。
   */
  private generateNarrative(entries: readonly CopilotAnswerEntry[]): string {
    return entries.map((e) => e.statement).join('。')
  }

  /**
   * 构建「暂无足够依据」结果。
   */
  private buildInsufficientResult(params: HealthAnswerParams): CopilotAnswerInsufficient {
    const missingWhat: string[] = []

    if (!params.diagnosisSummary) {
      missingWhat.push('本项目尚无健康诊断记录')
    }

    if (params.predictionSignals.length === 0) {
      missingWhat.push('本项目尚无预测信号')
    }

    return {
      kind: 'insufficient',
      reason: 'material-insufficient',
      missingWhat: missingWhat.join('；') || '素材不足',
    }
  }
}
