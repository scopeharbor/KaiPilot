/**
 * v3-copilot-voice-input §4 — 隐私告知服务。
 *
 * 职责：
 * - 上传前的隐私告知，不可跳过且需明确确认
 * - 每次上传都需确认，不因首次同意而记住
 * - 告知文案明确列出上传、转写与按保留期保存三件事
 *
 * 设计决策（D3）：
 * - 音频含人声，且上传者往往不是唯一的声音来源
 * - 告知必须在上传动作之前呈现且需明确确认
 * - 备选是首次告知后记住选择，被否：会议录音的参与者每次不同，
 *   一次性同意覆盖不了后续所有录音
 */

import { COPILOT_VOICE_PRIVACY_NOTICE } from '@aiproj/types'

// ===========================================================================
// 告知确认记录
// ===========================================================================

/**
 * 隐私告知确认状态。
 *
 * 设计决策（D3）：
 * - 每次上传都需确认，不因首次同意而记住
 * - 确认记录只在单次回合内有效
 */
export interface CopilotVoicePrivacyConsent {
  /** 是否已确认。 */
  readonly confirmed: boolean
  /** 确认时间戳（毫秒）。 */
  readonly confirmedAt: number
  /** 回合 ID（确认只在单次回合内有效）。 */
  readonly turnId: string
}

// ===========================================================================
// 服务
// ===========================================================================

export default class CopilotVoicePrivacyNotice {
  /**
   * 获取隐私告知文案。
   *
   * 文案明确列出三件事：
   * 1. 音频将被上传
   * 2. 音频将被转写
   * 3. 转写结果将按保留期保存
   */
  getNoticeText(): string {
    return COPILOT_VOICE_PRIVACY_NOTICE
  }

  /**
   * 验证隐私告知确认。
   *
   * 设计决策（D3）：
   * - 每次上传都需确认
   * - 确认记录只在单次回合内有效
   * - 未确认时上传不发生
   */
  validateConsent(consent: CopilotVoicePrivacyConsent | null): {
    valid: boolean
    reason?: string
  } {
    if (!consent) {
      return { valid: false, reason: '隐私告知未确认' }
    }

    if (!consent.confirmed) {
      return { valid: false, reason: '隐私告知未确认' }
    }

    // 确认记录必须是当前回合的（不跨回合有效）
    // 这里只做基本校验，实际的 turnId 匹配由调用方负责
    if (!consent.turnId || consent.turnId.length === 0) {
      return { valid: false, reason: '隐私告知确认无效' }
    }

    return { valid: true }
  }

  /**
   * 创建确认记录。
   *
   * 调用方在用户明确确认后调用此方法。
   */
  createConsent(turnId: string): CopilotVoicePrivacyConsent {
    return {
      confirmed: true,
      confirmedAt: Date.now(),
      turnId,
    }
  }
}
