/**
 * @aiproj/backend —— Compiler Integration：验证套件的 Compiler 入口。
 *
 * 9.1: 注册为 Compiler 可调用的 validation/V-Gate handler，不直接嵌入 PipelineExecutor。
 * 9.2: foundation persistence 未完成时使用 in-memory writer。
 */

import type {
  V2HardValidationReport,
  SoftEvaluationReport,
  VGateDecision,
} from '@aiproj/compiler-spec'
import type { ValidationInputContext } from './types.js'
import type { ValidationEvidenceWriter } from './interfaces.js'
import { InMemoryEvidenceWriter } from './interfaces.js'

// ── Validation Result ──

export interface ValidationSuiteResult {
  hardReport: V2HardValidationReport
  softReport: SoftEvaluationReport | null
  vGateDecision: VGateDecision
  evidenceIds: string[]
}

// ── Validation Handler ──

/**
 * Validation Suite 的 Compiler handler。
 * 由 Compiler pipeline（PipelineExecutor）在对应 stage 调用。
 * 不直接嵌入 PipelineExecutor——通过 handler 注册调用。
 */
export class ValidationHandler {
  readonly #evidenceWriter: ValidationEvidenceWriter

  constructor(evidenceWriter?: ValidationEvidenceWriter) {
    this.#evidenceWriter = evidenceWriter ?? new InMemoryEvidenceWriter()
  }

  /**
   * 执行完整的验证套件（Hard → Soft → V-Gate → Evidence）。
   *
   * @param hardSuite 函数：运行 Hard Validator 并返回报告
   * @param softOrchestrator 函数：运行 Soft Evaluator 并返回报告（可为 null 跳过）
   * @param vGateService 函数：运行 V-Gate 决策
   * @param context 验证输入上下文
   * @returns 验证结果
   */
  async runFullValidation(
    hardSuite: (ctx: ValidationInputContext) => Promise<V2HardValidationReport>,
    softOrchestrator: ((ctx: ValidationInputContext) => Promise<SoftEvaluationReport>) | null,
    vGateService: (
      hardReport: V2HardValidationReport,
      softReport: SoftEvaluationReport | null,
      ctx: ValidationInputContext,
    ) => Promise<VGateDecision>,
    context: ValidationInputContext,
  ): Promise<ValidationSuiteResult> {
    const evidenceIds: string[] = []

    // 1. Hard Validation
    const hardReport = await hardSuite(context)
    evidenceIds.push(
      await this.#writeEvidence({
        evidenceType: 'hard_validation_complete',
        stageId: context.stageId,
        rulesetVersion: '1.0',
        registryVersion: '1.0',
        outputSummary: {
          passed: hardReport.summary.passed,
          blockingCount: hardReport.summary.blocking,
        },
      }),
    )

    // 2. Soft Evaluation（可选）
    let softReport: SoftEvaluationReport | null = null
    if (softOrchestrator) {
      try {
        softReport = await softOrchestrator(context)
        evidenceIds.push(
          await this.#writeEvidence({
            evidenceType: 'soft_evaluation_complete',
            stageId: context.stageId,
            rulesetVersion: '1.0',
            registryVersion: '1.0',
            outputSummary: { status: softReport.status, weightedScore: softReport.weightedScore },
          }),
        )
      } catch {
        evidenceIds.push(
          await this.#writeEvidence({
            evidenceType: 'soft_evaluation_degraded',
            stageId: context.stageId,
            rulesetVersion: '1.0',
            registryVersion: '1.0',
            outputSummary: { error: 'Soft evaluation failed' },
            degradedReason: 'Soft evaluation orchestrator threw',
          }),
        )
      }
    } else {
      evidenceIds.push(
        await this.#writeEvidence({
          evidenceType: 'soft_evaluation_skipped',
          stageId: context.stageId,
          rulesetVersion: '1.0',
          registryVersion: '1.0',
          outputSummary: {},
          skippedReason: 'No soft orchestrator configured',
        }),
      )
    }

    // 3. V-Gate Decision
    const vGateDecision = await vGateService(hardReport, softReport, context)
    evidenceIds.push(
      await this.#writeEvidence({
        evidenceType: 'v_gate_decision',
        stageId: context.stageId,
        rulesetVersion: '1.0',
        registryVersion: '1.0',
        outputSummary: {
          status: vGateDecision.status,
          requiresHumanReview: vGateDecision.requiresHumanReview,
        },
        repairSuggestionIds: vGateDecision.repairSuggestions.map((s) => s.suggestionId),
      }),
    )

    return { hardReport, softReport, vGateDecision, evidenceIds }
  }

  /** 写入证据。 */
  async #writeEvidence(opts: {
    evidenceType:
      | 'hard_validation_complete'
      | 'soft_evaluation_complete'
      | 'v_gate_decision'
      | 'soft_evaluation_skipped'
      | 'soft_evaluation_degraded'
    stageId: string
    rulesetVersion: string
    registryVersion: string
    outputSummary: Record<string, unknown>
    skippedReason?: string
    degradedReason?: string
    repairSuggestionIds?: string[]
  }): Promise<string> {
    return this.#evidenceWriter.write({
      evidenceId: `ev-${opts.evidenceType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      stageId: opts.stageId,
      evidenceType: opts.evidenceType,
      inputSignature: {},
      rulesetVersion: opts.rulesetVersion,
      registryVersion: opts.registryVersion,
      outputSummary: opts.outputSummary,
      costSummary: { tokensUsed: 0, callsMade: 0, latencyMs: 0 },
      skippedReason: opts.skippedReason,
      degradedReason: opts.degradedReason,
      repairSuggestionIds: opts.repairSuggestionIds,
      generatedAt: new Date().toISOString(),
    })
  }
}
