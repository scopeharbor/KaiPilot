/**
 * v2-triz-ai-clarification-cards —— Draft Layer 输入适配器（tasks 6.1–6.4）。
 *
 * 将 TRIZ 澄清回答转为 Draft Layer candidate 输入。
 * 保证：
 * - 只影响待审核草案生成/修复输入，不写正式业务表
 * - 过期回答被阻止或标记警告
 * - 回答的来源 refs / AIMarker / stale 状态全程保留
 */
import type {
  TrizClarificationAnswer,
  TrizContextMergeOutput,
  TrizClarificationWarningCode,
} from '@aiproj/types'
import type { DraftLayerSession } from '@aiproj/types'

export interface TrizDraftInputResult {
  /** 是否可以 proceed */
  canProceed: boolean
  /** 阻断或警告原因 */
  reasons: string[]
  /** 合并后的 TRIZ context（用于 draft 生成） */
  context: TrizContextMergeOutput[]
  /** warning codes */
  warningCodes: TrizClarificationWarningCode[]
}

/**
 * TrizDraftInputAdapter —— Draft Layer 对 TRIZ 回答的消费适配器。
 *
 * - 将 TRIZ answer 转为 Draft Layer candidate 输入
 * - 检测 stale answer 并决定是否阻断
 * - 不写入任何正式业务表
 */
export class TrizDraftInputAdapter {
  constructor() {}

  /**
   * 准备 TRIZ 回答供 Draft Layer 消费。
   * 返回结果包含是否可继续、警告/阻断原因、合并后的 context。
   */
  prepareInput(
    _answers: TrizClarificationAnswer[],
    mergeOutputs: TrizContextMergeOutput[],
  ): TrizDraftInputResult {
    const reasons: string[] = []
    const warningCodes: TrizClarificationWarningCode[] = []

    // 1. 检查是否有 stale answer
    const staleAnswers = mergeOutputs.filter((m) => m.stale)
    if (staleAnswers.length > 0) {
      reasons.push(`${staleAnswers.length} 个 TRIZ 回答已过期，需要重新确认`)
      warningCodes.push('TRIZ_STALE_ANSWER')
    }

    // 2. 检查是否所有 critical 卡片都有答案
    const skippedCritical = mergeOutputs.filter(
      (m) => m.action === 'skip' && m.answerEffect?.severity === 'high',
    )
    if (skippedCritical.length > 0) {
      reasons.push(`${skippedCritical.length} 个关键 TRIZ 卡片被跳过，草案可能需要人工审查`)
    }

    // 3. 判断能否 proceed
    const canProceed = staleAnswers.length === 0

    return {
      canProceed,
      reasons,
      context: mergeOutputs,
      warningCodes,
    }
  }

  /**
   * 检查 Draft Layer session 中的 TRIZ answer 是否过期。
   * 阻塞时返回阻止 apply 的原因。
   */
  validateSessionInput(
    _session: DraftLayerSession,
    currentMergeOutputs: TrizContextMergeOutput[],
  ): string | null {
    // 检查是否有 stale 标记
    const staleCount = currentMergeOutputs.filter((m) => m.stale).length
    if (staleCount > 0) {
      return `检测到 ${staleCount} 个过期 TRIZ 回答，请重新确认后再执行应用`
    }
    return null
  }
}
