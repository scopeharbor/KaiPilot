/**
 * v2-triz-ai-clarification-cards —— TRIZ 与普通 Clarification 卡片合并器（tasks 3.1–3.5）。
 *
 * 将 TRIZ 候选卡片与现有的普通澄清卡片合并为一个统一的有序卡片列表。
 * 保留现有卡片的行为语义。
 */
import {
  type AnalyzeProjectIntentResponse,
  type ClarificationAnswers,
  type ClarificationCard,
  type ClarificationCategory,
  type ConfirmedProjectContext,
} from '@aiproj/types'
import {
  type TrizClarificationCandidate,
  type TrizClarificationCardDTO,
  type TrizClarificationAnswer,
  type TrizClarificationWarningCode,
  type TrizContextMergeOutput,
  mapTrizCategoryToClarification,
  isTrizAnswerStale,
} from '@aiproj/types'
import ClarificationService from '../ai_intent/clarification_service.js' // existing service

const CATEGORY_RANK: Record<ClarificationCategory, number> = {
  critical: 0,
  recommended: 1,
  optional: 2,
}

function marker(
  source: 'explicit' | 'inferred' | 'default',
  reason: string,
  confidence: number,
  needsConfirmation: boolean,
) {
  return { source, reason, confidence, needsConfirmation }
}

/**
 * TrizClarificationMerger —— 将 TRIZ 卡片合并到现有澄清流程。
 *
 * 负责：
 * - 将 TRIZ 候选转为 ClarificationCard DTO
 * - 与普通卡片合并排序
 * - 扩展 branch 计算
 * - 扩展 answer 校验
 * - 扩展 ConfirmedProjectContext 合并
 */
export class TrizClarificationMerger {
  private existingService: ClarificationService

  constructor(existingService?: ClarificationService) {
    this.existingService = existingService ?? new ClarificationService()
  }

  /**
   * 分析请求：融合普通卡片 + TRIZ 卡片。
   * 保留现有服务的所有行为，仅增加 TRIZ 卡片。
   */
  analyze(
    rawInput: string,
    answers: ClarificationAnswers = {},
    trizCandidates: TrizClarificationCandidate[] = [],
    trizAnswers: TrizClarificationAnswer[] = [],
  ): AnalyzeProjectIntentResponse {
    // 1. 让现有服务处理普通卡片
    const existingResult = this.existingService.analyze(rawInput, answers)

    // 2. 如果有 TRIZ 候选，转换为 DTO 并合并
    const trizCardDTOs = this.candidatesToDTOs(trizCandidates, trizAnswers)

    // 3. 合并卡片列表
    const mergedCards = this.mergeCardLists(existingResult.cards, trizCardDTOs)

    // 4. 计算 branch（TRIZ 未回答的 critical 卡片使 branch 保持 clarify）
    const allCardsAnswered = mergedCards.every((card) => {
      if (card.category !== 'critical') return true
      if ('source' in card && card.source === 'triz') {
        return trizAnswers.some((a) => a.cardId === card.cardId)
      }
      return true // ordinary cards processed by existing service
    })

    // 5. 构建 merge output
    const trizClarifications = this.buildTrizContextMerge(trizAnswers, trizCandidates)

    // 6. 扩展 confirmedContext
    const extendedContext: ConfirmedProjectContext & {
      trizClarifications?: TrizContextMergeOutput[]
    } = {
      ...existingResult.confirmedContext,
      trizClarifications: trizClarifications.length > 0 ? trizClarifications : undefined,
    }

    // 如果仍有未解决的 TRIZ critical 卡片，branch=clarify
    const branch =
      existingResult.branch === 'clarify' || !allCardsAnswered
        ? ('clarify' as const)
        : ('ready' as const)

    // 7. 扩展 summary
    const trizSummary = {
      critical: trizCardDTOs.filter((c) => c.category === 'critical').length,
      recommended: trizCardDTOs.filter((c) => c.category === 'recommended').length,
      optional: trizCardDTOs.filter((c) => c.category === 'optional').length,
    }

    return {
      ...existingResult,
      cards: mergedCards,
      confirmedContext: extendedContext as ConfirmedProjectContext,
      branch,
      summary: {
        critical: existingResult.summary.critical + trizSummary.critical,
        recommended: existingResult.summary.recommended + trizSummary.recommended,
        optional: existingResult.summary.optional + trizSummary.optional,
      },
    }
  }

  /**
   * 校验 TRIZ 回答的有效性。
   */
  validateTrizAnswer(
    answer: TrizClarificationAnswer,
    knownCards: TrizClarificationCardDTO[],
  ): string | null {
    const card = knownCards.find((c) => c.cardId === answer.cardId)
    if (!card) {
      return `TRIZ 卡片 ${answer.cardId} 不存在`
    }

    // 检查 action 有效性
    if (!['answer', 'adopt_default', 'skip', 'defer_review'].includes(answer.action)) {
      return `TRIZ 回答 action「${answer.action}」无效`
    }

    // 检查 stale
    if (
      isTrizAnswerStale(
        {
          cardId: answer.cardId,
          action: answer.action,
          value: answer.value,
          adoptedDefault: answer.adoptedDefault,
          sourceHash: answer.sourceHash,
          marker: answer.marker,
          note: answer.note,
        },
        card.sourceHash,
      )
    ) {
      return `TRIZ 卡片 ${answer.cardId} 的回答已过期，需要重新确认`
    }

    // 检查关键卡片不能跳过
    if (answer.action === 'skip' && card.isRequired) {
      return `关键 TRIZ 卡片 ${answer.cardId} 不能跳过`
    }

    return null
  }

  /**
   * 将 TRIZ 候选转为 DTO。
   */
  private candidatesToDTOs(
    candidates: TrizClarificationCandidate[],
    existingAnswers: TrizClarificationAnswer[],
  ): TrizClarificationCardDTO[] {
    return candidates.map((c) => {
      const category = mapTrizCategoryToClarification(c.trizCategory, c.severity)
      const existingAnswer = existingAnswers.find((a) => a.cardId === c.cardId)
      const isStale = existingAnswer ? isTrizAnswerStale(existingAnswer, c.sourceHash) : false

      return {
        cardId: c.cardId,
        field: c.mappedField,
        category,
        trizCategory: c.trizCategory,
        source: 'triz',
        title: c.title,
        description: c.description,
        impactScope: c.impactScope,
        questionType: c.questionType,
        quickOptions: c.quickOptions,
        defaultValue: c.defaultValue ?? null,
        defaultValueMarker:
          c.defaultValue && c.confidence >= 0.7
            ? marker('default', c.reasoning, c.confidence, true)
            : null,
        confidence: c.confidence,
        reasoning: c.reasoning,
        allowSkip: c.allowSkip,
        isRequired: c.isRequired,
        sourceRefs: c.sourceRefs.map((r) => ({
          key: r.key,
          type: r.type,
          severity: r.severity,
          title: r.title,
        })),
        analysisArtifactRef: c.analysisHint?.contentHash ?? null,
        warningCodes: isStale ? [...c.warningCodes, 'TRIZ_STALE_ANSWER'] : c.warningCodes,
        warnings: isStale
          ? [
              ...c.warnings,
              {
                code: 'TRIZ_STALE_ANSWER' as TrizClarificationWarningCode,
                message: '卡片来源已更新，旧回答需要重新确认',
                source: 'triz-clarification-merger',
              },
            ]
          : c.warnings,
        answerEffect: c.answerEffect,
        sourceHash: c.sourceHash,
      }
    })
  }

  /**
   * 合并 TRIZ 和普通卡片列表。
   * 排序规则：category → severity → confidence → cardId
   */
  private mergeCardLists(
    ordinaryCards: ClarificationCard[],
    trizCards: TrizClarificationCardDTO[],
  ): ClarificationCard[] {
    const all = [...ordinaryCards, ...trizCards]

    // 按category rank → severity → confidence → title排序
    // 但需要将TRIZ卡片的severity映射到可与普通卡片比较的格式
    return all.sort((a, b) => {
      const catDiff = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]
      if (catDiff !== 0) return catDiff

      // 按严重度/置信度降序
      const aImpacts = 'impactScope' in a ? (a.impactScope?.length ?? 0) : 0
      const bImpacts = 'impactScope' in b ? (b.impactScope?.length ?? 0) : 0
      if (aImpacts !== bImpacts) return bImpacts - aImpacts

      const aConf = 'confidence' in a ? (a.confidence ?? 0) : 0
      const bConf = 'confidence' in b ? (b.confidence ?? 0) : 0
      if (Math.abs(aConf - bConf) > 1e-9) return bConf - aConf

      return a.cardId.localeCompare(b.cardId)
    }) as ClarificationCard[]
  }

  /**
   * 构建 TRIZ 上下文合并输出。
   */
  private buildTrizContextMerge(
    answers: TrizClarificationAnswer[],
    candidates: TrizClarificationCandidate[],
  ): TrizContextMergeOutput[] {
    return answers.map((answer) => {
      const candidate = candidates.find((c) => c.cardId === answer.cardId)
      const isStale = candidate ? isTrizAnswerStale(answer, candidate.sourceHash) : true
      const refs = candidate
        ? candidate.sourceRefs.map((r) => ({
            key: r.key,
            type: r.type,
            severity: r.severity,
            title: r.title,
          }))
        : []
      const artifactRef = candidate?.analysisHint?.contentHash ?? null

      return {
        cardId: answer.cardId,
        sourceRefs: refs,
        analysisArtifactRef: artifactRef,
        action: answer.action,
        value: answer.value,
        marker: answer.marker ?? marker('inferred', 'TRIZ 卡片回答', 0.8, true),
        sourceHash: answer.sourceHash,
        stale: isStale,
        warningCodes: isStale ? ['TRIZ_STALE_ANSWER'] : [],
        answerEffect: candidate?.answerEffect ?? null,
      }
    })
  }
}
