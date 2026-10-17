/**
 * v2-triz-ai-clarification-cards —— TRIZ 候选卡片确定性生成器（tasks 2.3–2.5）。
 *
 * 从已授权的矛盾 snapshot 和（可选的）TRIZ analysis artifact hints 中，
 * 确定性地派生 TRIZ 澄清卡片候选。
 * - 同一输入必须产生完全相同的候选集
 * - 候选受严重度阈值、每轮上限和 grouping 控制
 * - 支持 source validation（不能引用不存在的 entity）
 */
import {
  type ClarificationQuestionType,
  type ClarificationImpact,
  type ClarificationQuickOption,
  type ContradictionSeverity,
} from '@aiproj/types'
import {
  type TrizClarificationSourceRef,
  type TrizClarificationCandidate,
  type TrizClarificationWarningCode,
  type TrizClarificationWarning,
  type TrizClarificationCategory,
  type TrizAnswerEffect,
  type TrizCardIdentity,
  type TrizAnalysisClarificationHint,
  computeTrizCardId,
  computeTrizSourceHash,
  compareTrizCandidates,
  dedupeTrizCandidates,
  sortTrizWarningCodes,
} from '@aiproj/types'

export interface CandidateGeneratorOptions {
  /** 最大卡片数（默认 5） */
  maxCards?: number
  /** 最少严重度阈值（默认 low — 即全部纳入） */
  minSeverity?: ContradictionSeverity
  /** Schema 版本（用于 cardId 计算） */
  schemaVersion?: string
}

const SEVERITY_ORDER: ContradictionSeverity[] = ['critical', 'high', 'medium', 'low']

function severityLevel(severity: ContradictionSeverity): number {
  return SEVERITY_ORDER.indexOf(severity)
}

/**
 * 判断 severity 是否满足阈值要求。
 */
function meetsSeverityThreshold(
  severity: ContradictionSeverity,
  threshold: ContradictionSeverity,
): boolean {
  return severityLevel(severity) <= severityLevel(threshold)
}

/**
 * TrizCandidateGenerator —— 确定性 TRIZ 卡片候选生成器。
 *
 * 不调用任何外部服务、不触发 side-effect、不写数据库。
 * 纯函数式生成，便于测试和幂等。
 */
export class TrizCandidateGenerator {
  constructor() {}

  /**
   * 从矛盾 refs 和可选 artifact hint 生成候选卡片。
   */
  generateCandidates(
    sourceRefs: TrizClarificationSourceRef[],
    analysisHint: TrizAnalysisClarificationHint | null,
    options: CandidateGeneratorOptions = {},
  ): TrizClarificationCandidate[] {
    const { maxCards = 5, minSeverity = 'low', schemaVersion = '1.0' } = options

    // 1. 过滤：只保留满足严重度阈值的矛盾
    let validRefs = sourceRefs.filter((r) => meetsSeverityThreshold(r.severity, minSeverity))

    // 跳过 stale 矛盾
    const staleRefs = sourceRefs.filter((r) => r.stale)
    const staleWarnings = this.buildStaleWarnings(staleRefs)

    validRefs = validRefs.filter((r) => !r.stale)

    // 如果过滤后无矛盾，返回空
    if (validRefs.length === 0) {
      return []
    }

    // 2. 为每个 visible 矛盾生成候选
    const candidates: TrizClarificationCandidate[] = []

    for (const ref of validRefs) {
      const candidate = this.buildCandidateFromRef(ref, analysisHint, schemaVersion, staleWarnings)
      candidates.push(candidate)
    }

    // 3. 排序
    candidates.sort(compareTrizCandidates)

    // 4. 去重（按 cardId）
    const deduped = dedupeTrizCandidates(candidates)

    // 5. 截断至上限
    return deduped.slice(0, maxCards)
  }

  /**
   * 校验候选卡片来源一致性。
   * 返回校验失败的 warning。
   */
  validateSourceIntegrity(candidate: TrizClarificationCandidate): TrizClarificationWarning[] {
    const warnings: TrizClarificationWarning[] = []

    // 检查 sourceRefs 是否存在且非空
    if (!candidate.sourceRefs || candidate.sourceRefs.length === 0) {
      warnings.push({
        code: 'TRIZ_CANDIDATE_SOURCE_MISSING',
        message: '候选卡片缺少来源矛盾引用',
        source: 'triz-candidate-generator',
      })
    }

    // 检查每个 sourceRef 是否包含必要字段
    for (const ref of candidate.sourceRefs) {
      if (!ref.key) {
        warnings.push({
          code: 'TRIZ_CANDIDATE_SOURCE_MISSING',
          message: '来源矛盾缺少 key',
          source: 'triz-candidate-generator',
        })
      }
      if (!ref.title) {
        warnings.push({
          code: 'TRIZ_CANDIDATE_VALIDATION_FAILED',
          message: '来源矛盾缺少标题',
          source: 'triz-candidate-generator',
        })
      }
    }

    // 如果 warning 代码需要去重排序
    const codes = warnings.map((w) => w.code as TrizClarificationWarningCode)
    sortTrizWarningCodes(codes)

    return warnings
  }

  // ── Private ──

  private buildCandidateFromRef(
    ref: TrizClarificationSourceRef,
    analysisHint: TrizAnalysisClarificationHint | null,
    schemaVersion: string,
    staleWarnings: TrizClarificationWarning[],
  ): TrizClarificationCandidate {
    const trizCategory = this.inferCategory(ref)
    const mappedField = this.mapToField(ref)
    const questionType: ClarificationQuestionType = 'single_choice'
    const quickOptions = this.buildQuickOptions(ref)
    const defaultValue = quickOptions.find((o) => o.recommended)?.value ?? null
    const answerEffect = this.buildAnswerEffect(ref)
    const impactScope = this.buildImpactScope(ref)
    const severity = ref.severity
    const confidence = ref.confidence * 0.9 // 略微降低置信度以考虑转换损耗
    const allowSkip = trizCategory !== 'trade_off'
    const isRequired = !allowSkip && severity !== 'low'

    // 构建 card identity
    const identity: TrizCardIdentity = {
      schemaVersion,
      field: mappedField,
      category: trizCategory,
      source: 'triz',
      contradictionKey: ref.key,
      analysisHash: analysisHint?.contentHash ?? null,
      contradictionSourceHash: ref.outputHash ?? ref.inputSignature,
      questionPurpose: this.inferQuestionPurpose(ref),
    }

    const cardId = computeTrizCardId(identity)
    const sourceHash = computeTrizSourceHash([ref], analysisHint?.contentHash ?? null)

    // 构建 warning codes
    const warningCodes: TrizClarificationWarningCode[] = [
      ...staleWarnings.map((w) => w.code as TrizClarificationWarningCode),
    ]
    if (!analysisHint) {
      warningCodes.push('TRIZ_ANALYSIS_UNAVAILABLE')
    }
    const warnings = [...staleWarnings]
    if (!analysisHint) {
      warnings.push({
        code: 'TRIZ_ANALYSIS_UNAVAILABLE',
        message: 'TRIZ 综合分析不可用，基于矛盾 snapshot 派生基础卡片',
        source: 'triz-candidate-generator',
      })
    }

    const { title, description } = this.buildCardText(ref, analysisHint)

    return {
      cardId,
      sourceRefs: [ref],
      analysisHint,
      trizCategory,
      mappedField,
      title,
      description,
      impactScope,
      questionType,
      quickOptions,
      defaultValue,
      confidence,
      reasoning: `基于${analysisHint ? 'TRIZ 综合分析' : '矛盾 snapshot'}「${ref.key}」，严重度 ${ref.severity}，置信度 ${(ref.confidence * 100).toFixed(0)}%。`,
      severity,
      allowSkip,
      isRequired,
      warningCodes,
      warnings,
      answerEffect,
      sourceHash,
    }
  }

  private inferCategory(ref: TrizClarificationSourceRef): TrizClarificationCategory {
    // 技术矛盾 → trade_off
    if (ref.type === 'technical') return 'trade_off'
    // 物理矛盾 → constraint
    return 'constraint'
  }

  private mapToField(ref: TrizClarificationSourceRef): string {
    // 根据参数对映射到业务字段
    if (ref.improvingParameterKey === 'duration' || ref.worseningParameterKey === 'duration') {
      return 'schedulePriority'
    }
    if (ref.improvingParameterKey === 'quality' || ref.worseningParameterKey === 'quality') {
      return 'qualityPriority'
    }
    if (
      ref.improvingParameterKey === 'resource_load' ||
      ref.worseningParameterKey === 'resource_load'
    ) {
      return 'resourcePriority'
    }
    if (ref.improvingParameterKey === 'scope' || ref.worseningParameterKey === 'scope') {
      return 'scopePriority'
    }
    if (ref.improvingParameterKey === 'cost' || ref.worseningParameterKey === 'cost') {
      return 'costPriority'
    }
    if (ref.improvingParameterKey === 'risk_level' || ref.worseningParameterKey === 'risk_level') {
      return 'riskPriority'
    }
    return 'projectPriority'
  }

  private inferQuestionPurpose(ref: TrizClarificationSourceRef): string {
    if (ref.type === 'physical') return 'constraint_resolution'
    if (ref.severity === 'critical' || ref.severity === 'high') return 'trade_off_priority'
    return 'default_assumption'
  }

  private buildQuickOptions(ref: TrizClarificationSourceRef): ClarificationQuickOption[] {
    const improvingName = this.parameterName(ref.improvingParameterKey)
    const worseningName = this.parameterName(ref.worseningParameterKey)

    if (ref.improvingParameterKey && ref.worseningParameterKey) {
      return [
        {
          label: `优先改善${improvingName}，接受${worseningName}可能受影响`,
          value: `${ref.improvingParameterKey}_first`,
          description: `适合当前更重视${improvingName}改善的场景。`,
        },
        {
          label: `优先控制${worseningName}，接受${improvingName}可能受影响`,
          value: `${ref.worseningParameterKey}_first`,
          description: `适合当前更需要守住${worseningName}边界的场景。`,
          recommended: true,
        },
        {
          label: '保持当前平衡，暂不调整',
          value: 'maintain_current',
          description: '适合证据不足，需要继续观察后再决策的场景。',
        },
      ]
    }

    return [
      {
        label: '优先解决此矛盾',
        value: 'resolve',
        description: '适合该矛盾已经影响计划、资源或交付质量的场景。',
        recommended: true,
      },
      {
        label: '暂不处理，先推进其他工作',
        value: 'defer',
        description: '适合影响较低，或需要更多证据再处理的场景。',
      },
    ]
  }

  private buildAnswerEffect(ref: TrizClarificationSourceRef): TrizAnswerEffect {
    const improvingName = this.parameterName(ref.improvingParameterKey)
    const worseningName = this.parameterName(ref.worseningParameterKey)

    if (ref.improvingParameterKey && ref.worseningParameterKey) {
      return {
        type: 'resource_tradeoff',
        description: `${improvingName}与${worseningName}的取舍将影响项目整体资源分配和风险状况`,
        severity: ref.severity === 'critical' ? 'high' : 'medium',
      }
    }

    return {
      type: 'default_adoption',
      description: '解决此矛盾将影响项目计划与资源安排',
      severity: 'medium',
    }
  }

  private buildImpactScope(ref: TrizClarificationSourceRef): ClarificationImpact[] {
    const impacts: ClarificationImpact[] = []
    if (ref.improvingParameterKey) {
      impacts.push({
        domain: this.parameterName(ref.improvingParameterKey),
        severity: 'high',
      })
    }
    if (ref.worseningParameterKey) {
      impacts.push({
        domain: this.parameterName(ref.worseningParameterKey),
        severity: 'high',
      })
    }
    return impacts
  }

  private buildCardText(
    ref: TrizClarificationSourceRef,
    analysisHint: TrizAnalysisClarificationHint | null,
  ): { title: string; description: string } {
    const improvingName = this.parameterName(ref.improvingParameterKey)
    const worseningName = this.parameterName(ref.worseningParameterKey)

    let title: string
    if (improvingName && worseningName) {
      title = `${improvingName}与${worseningName}取舍`
    } else {
      title = ref.title || '项目矛盾确认'
    }

    let description = `系统检测到「${ref.title}」。`
    if (analysisHint && analysisHint.topTensions.length > 0) {
      description += `\n\n综合分析建议：${analysisHint.topTensions.slice(0, 2).join('、')}。`
    }
    description += '\n\n请确认在本次项目中如何平衡这对矛盾关系。'

    return { title, description }
  }

  private buildStaleWarnings(staleRefs: TrizClarificationSourceRef[]): TrizClarificationWarning[] {
    return staleRefs.map((ref) => ({
      code: 'TRIZ_SOURCE_CONTRADICTION_STALE' as TrizClarificationWarningCode,
      message: `来源矛盾「${ref.key}」已过期（${ref.staleReason || '基础数据已更新'}）`,
      source: 'triz-candidate-generator',
    }))
  }

  private parameterName(key: string | null): string {
    const names: Record<string, string> = {
      duration: '工期/进度',
      cost: '成本',
      resource_load: '资源负载',
      quality: '质量',
      scope: '范围',
      risk_level: '风险水平',
      flexibility: '灵活性',
      stability: '稳定性',
      information_completeness: '信息完整度',
      maintainability: '可维护性',
      uncertainty: '不确定性',
      throughput: '交付吞吐',
    }
    return key ? (names[key] ?? key) : ''
  }
}
