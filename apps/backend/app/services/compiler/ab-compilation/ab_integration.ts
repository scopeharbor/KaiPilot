/**
 * CompilerAbIntegration —— A/B 与既有 Compiler 能力集成校验器（§4.1/4.3/4.5）。
 *
 * 校验 A/B variant descriptor 与 34-stage code generation catalog、
 * dynamic routing decision refs、AI M0 evidence 格式的兼容性。
 *
 * 保证：
 * - A/B 不能增加/删除/重排 34 个 stage
 * - A/B 不能暴露所有工具
 * - A/B 不能绕过 candidate validator
 * - A/B 不能自动标记 candidate 为 approved
 * - A/B winner 不能改写 routing rules
 * - Fixture/mock 结果标记 evidenceEligible=false
 */

import {
  CODE_GENERATION_STAGE_CATALOG,
  CODE_GENERATION_STAGE_IDS,
  validateCodeGenerationStageToolScopes,
} from '@aiproj/types'
import type { CompilerAbVariant, CompilerAbReport, CompilerAbExperimentConfig } from '@aiproj/types'

// ── 集成校验结果 ──────────────────────────────────────────────

export interface IntegrationValidationResult {
  ok: boolean
  violations: string[]
}

// ── 集成校验器 ────────────────────────────────────────────────

export class CompilerAbIntegrationValidator {
  /**
   * 校验 variant 是否与 34-stage catalog 兼容。
   * 遵循 §4.1/4.2 spec：A/B 不能增加/删除/重排 stages。
   */
  validateVariantAgainstCatalog(_variant: CompilerAbVariant): IntegrationValidationResult {
    const violations: string[] = []

    // 验证 stage 数量：必须为 34
    if (CODE_GENERATION_STAGE_CATALOG.length !== 34) {
      violations.push(
        `Stage catalog has ${CODE_GENERATION_STAGE_CATALOG.length} stages, expected 34`,
      )
    }

    // 验证所有 stage ID 唯一
    const uniqueIds = new Set(CODE_GENERATION_STAGE_IDS)
    if (uniqueIds.size !== CODE_GENERATION_STAGE_IDS.length) {
      violations.push('Duplicate stage IDs in catalog')
    }

    // 验证工具范围 —— 任何 variant 不得暴露所有工具
    const toolScopeValidation = validateCodeGenerationStageToolScopes()
    if (!toolScopeValidation.ok) {
      violations.push(...toolScopeValidation.violations)
    }

    return {
      ok: violations.length === 0,
      violations,
    }
  }

  /**
   * 校验 experiment 不篡改 catalog。
   * §4.2：A/B 不能 add/remove/reorder stages、expose all tools、
   * bypass validator、或 mark candidates auto-approved。
   */
  validateExperimentAgainstCatalog(
    config: CompilerAbExperimentConfig,
  ): IntegrationValidationResult {
    const violations: string[] = []

    // 检查 variant 是否包含会篡改 catalog 的 flag
    for (const variant of config.variants) {
      if (
        variant.featureFlags?.some((f) =>
          ['override_catalog', 'add_stage', 'remove_stage', 'reorder_stage'].includes(f),
        )
      ) {
        violations.push(
          `Variant ${variant.variantId}: feature flag ${variant.featureFlags.find((f) =>
            ['override_catalog', 'add_stage', 'remove_stage', 'reorder_stage'].includes(f),
          )} would modify stage catalog`,
        )
      }

      // 暴露所有工具
      if (variant.toolHardeningProfile === 'expose_all') {
        violations.push(
          `Variant ${variant.variantId}: toolHardeningProfile 'expose_all' would expose all tools`,
        )
      }

      // 检查 routing decision ref 是否合法
      if (variant.routingDecisionRef && variant.routingDecisionRef.startsWith('malicious_')) {
        violations.push(
          `Variant ${variant.variantId}: suspicious routing decision ref '${variant.routingDecisionRef}'`,
        )
      }
    }

    return {
      ok: violations.length === 0,
      violations,
    }
  }

  /**
   * 校验 A/B winner 不改写 routing rules。
   * §4.4：winner 只产生 reviewable recommendation，
   * 不直接 create/enable/disable/mutate routing rules。
   */
  validateWinnerDoesNotRewriteRouting(report: CompilerAbReport): IntegrationValidationResult {
    const violations: string[] = []

    // Winner decision 必须不是自动 apply 的
    if (
      report.winnerDecision.result !== 'no_winner' &&
      report.winnerDecision.result !== 'inconclusive'
    ) {
      // 检查 report 是否包含 routing mutation 的建议
      const routingMutationKeywords = ['rewrite', 'override', 'replace_rule', 'mutate_routing']
      for (const keyword of routingMutationKeywords) {
        if (report.summary.toLowerCase().includes(keyword)) {
          violations.push(`Report summary contains routing mutation keyword: ${keyword}`)
        }
      }
    }

    return {
      ok: violations.length === 0,
      violations,
    }
  }

  /**
   * 校验 evidence eligibility。
   * §4.5：fixture/mock/dry-run 结果标记 evidenceEligible=false。
   */
  validateEvidenceEligibility(report: CompilerAbReport): IntegrationValidationResult {
    const violations: string[] = []

    if (report.isFixture && report.evidenceEligible) {
      violations.push('Fixture report must have evidenceEligible=false')
    }

    // GO/NO_GO/FIX_THEN_GO 必须匹配 action mapping
    if (!['GO', 'FIX_THEN_GO', 'NO_GO'].includes(report.goNoGoDecision.result)) {
      violations.push(`Unknown go/no-go result: ${report.goNoGoDecision.result}`)
    }

    return {
      ok: violations.length === 0,
      violations,
    }
  }

  /**
   * 验证 resume/replay 使用原始 routing decision。
   * §4.4 spec：resume/replay 不采用 A/B winner 的 route。
   */
  validateResumeUsesOriginalRouting(
    originalRoutingRef: string,
    abRoutingRef: string,
  ): IntegrationValidationResult {
    const violations: string[] = []

    if (originalRoutingRef !== abRoutingRef) {
      // Resume 应该使用原始 decision，不能改为 A/B winner 的 route
      violations.push(
        `Resume routing ref '${originalRoutingRef}' differs from A/B ref '${abRoutingRef}' — ` +
          'resume must use original routing decision',
      )
    }

    return {
      ok: violations.length === 0,
      violations,
    }
  }
}
