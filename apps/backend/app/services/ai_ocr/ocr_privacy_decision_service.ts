/**
 * OcrPrivacyDecisionService — OCR 隐私决策服务（v3-ocr-privacy-policy-controls §5.1）
 *
 * 职责：
 * - 隐私 preflight 决策：基于认证上下文、声明目的、内容类别、
 *   来源可见性、生命周期/hold 状态、新鲜度和策略哈希判定
 * - 输出 allow/redact/mask/metadata_only/confirm_required/block 决策
 * - 所有决策是确定性的，不取决于外部服务或模型调用
 */
import {
  type OcrPrivacyPolicy,
  type OcrPrivacyDecisionInput,
  type OcrPrivacyDecision,
  type OcrPrivacyDecisionResult,
  type OcrPrivacyOutputMode,
  type OcrPrivacyDecisionReason,
  type OcrPrivacyWarningCode,
  computePrivacyDecisionHash,
  resolveOutputMode,
  isHighSensitivityCategory,
  isPurposeAllowed,
  computeAllowedFields,
} from '@aiproj/types'

export class OcrPrivacyDecisionService {
  /**
   * 隐私 preflight 决策
   *
   * 输入来源由外部提供（auth 上下文、策略、内容信息），本方法只做确定性判定。
   */
  preflight(input: OcrPrivacyDecisionInput, policy: OcrPrivacyPolicy): OcrPrivacyDecision {
    const reasons: OcrPrivacyDecisionReason[] = []
    const warnings: OcrPrivacyWarningCode[] = []

    // 1. 策略哈希校验
    if (input.policyHash !== policy.policyHash) {
      warnings.push('POLICY_HASH_MISMATCH')
    }

    // 2. 权限检查
    if (input.authContext.permissions.length === 0) {
      reasons.push('permission_denied')
      return this.#buildDecision(input, 'block', 'blocked', reasons, ['PERMISSION_DENIED'])
    }

    // 3. 组织隔离
    if (input.authContext.organizationId !== policy.organizationId) {
      reasons.push('cross_organization')
      return this.#buildDecision(input, 'block', 'blocked', reasons, ['PERMISSION_DENIED'])
    }

    // 4. 生命周期检查
    if (input.lifecycleState !== 'active') {
      switch (input.lifecycleState) {
        case 'expired':
          reasons.push('lifecycle_expired')
          warnings.push('LIFECYCLE_WARNING')
          break
        case 'purge_pending':
          reasons.push('lifecycle_purge_pending')
          warnings.push('LIFECYCLE_WARNING')
          break
        case 'purged':
          reasons.push('lifecycle_purged')
          warnings.push('LIFECYCLE_WARNING')
          return this.#buildDecision(input, 'block', 'blocked', reasons, warnings)
        case 'tombstoned':
          reasons.push('lifecycle_tombstoned')
          warnings.push('LIFECYCLE_WARNING')
          return this.#buildDecision(input, 'metadata_only', 'metadata_only', reasons, warnings)
        case 'hold_blocked':
          reasons.push('hold_blocked')
          warnings.push('LIFECYCLE_WARNING')
          return this.#buildDecision(input, 'block', 'blocked', reasons, warnings)
      }
    }

    // 5. 来源可见性
    if (!input.sourceVisible) {
      reasons.push('source_hidden')
      warnings.push('SOURCE_HIDDEN')
      return this.#buildDecision(input, 'redact', 'masked', reasons, warnings)
    }

    // 6. AI handoff 特殊检查（必须在 purpose 检查之前）
    if (input.action === 'ai_handoff') {
      if (!input.authContext.permissions.includes('ai:trigger')) {
        reasons.push('ai_permission_missing')
        return this.#buildDecision(input, 'block', 'blocked', reasons, ['PERMISSION_DENIED'])
      }
    }

    // 7. 类别 + 目的
    if (!isPurposeAllowed(input.purpose, input.contentCategory, policy.categoryRules)) {
      reasons.push('purpose_not_allowed')
      return this.#buildDecision(input, 'block', 'blocked', reasons, warnings)
    }

    // 8. 未知类别
    if (!policy.categoryRules.some((r) => r.category === input.contentCategory)) {
      reasons.push('unknown_category')
      return this.#buildDecision(input, 'block', 'blocked', reasons, warnings)
    }

    // 9. 解析输出模式
    const outputMode = resolveOutputMode(
      input.purpose,
      input.contentCategory,
      policy.categoryRules,
      policy.globalOutputMode,
    )

    if (outputMode === 'blocked') {
      reasons.push('category_blocked')
      return this.#buildDecision(input, 'block', 'blocked', reasons, warnings)
    }

    // 10. 是否需要显式确认
    let result: OcrPrivacyDecisionResult = 'allow'
    if (['copy', 'export', 'ai_handoff'].includes(input.action)) {
      if (isHighSensitivityCategory(input.contentCategory)) {
        result = 'confirm_required'
        warnings.push('CONFIRM_REQUIRED')
      }
    }

    // 11. 脱敏决策（根据输出模式）
    if (outputMode === 'masked') {
      result = 'mask'
    } else if (outputMode === 'metadata_only') {
      result = 'metadata_only'
    }

    return this.#buildDecision(input, result, outputMode, reasons, warnings)
  }

  /** 构建最终决策 */
  #buildDecision(
    input: OcrPrivacyDecisionInput,
    result: OcrPrivacyDecisionResult,
    outputMode: OcrPrivacyOutputMode,
    reasons: OcrPrivacyDecisionReason[],
    warnings: OcrPrivacyWarningCode[],
  ): OcrPrivacyDecision {
    return {
      result,
      outputMode,
      reasons,
      warnings,
      requiresExplicitConfirmation:
        result === 'confirm_required' ||
        (['copy', 'export', 'ai_handoff'].includes(input.action) && result === 'allow'),
      decisionHash: computePrivacyDecisionHash({
        purpose: input.purpose,
        contentCategory: input.contentCategory,
        action: input.action,
        sourceHash: input.sourceHash,
        contentHash: input.contentHash,
        policyHash: input.policyHash,
        result,
      }),
      policyHash: input.policyHash,
      sourceHash: input.sourceHash,
      allowedFields: computeAllowedFields(outputMode, input.contentCategory),
    }
  }
}
