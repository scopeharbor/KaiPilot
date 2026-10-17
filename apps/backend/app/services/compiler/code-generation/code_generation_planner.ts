/**
 * v2-5-compiler-34-stage-code-generation-pipeline —— backend planner.
 *
 * The planner is deliberately side-effect free: no model calls, no file writes,
 * no package installs, no run mutation. It prepares stage-local tool/context
 * metadata and candidate bundle summaries for future review-only execution.
 */

import {
  CODE_GENERATION_STAGE_CATALOG,
  buildCodeGenerationStagePlan,
  createCodeCandidateBundleSummary,
  createDisabledCodeGenerationPlan,
  validateCodeGenerationStageToolScopes,
  type CodeCandidateBundleSummary,
  type CodeCandidateFileIntent,
  type CodeGenerationPlanResult,
  type CodeGenerationPlanStage,
} from '@aiproj/types/compiler-code-generation'

export interface CodeGenerationPlannerInput {
  enabled: boolean
  bundleId: string
  files?: CodeCandidateFileIntent[]
  evidenceRefs?: string[]
  metadata?: Record<string, unknown>
}

export interface CodeGenerationEvidenceSummary {
  enabled: boolean
  reasonCode: CodeGenerationPlanResult['reasonCode']
  stageCount: number
  fileCount: number
  phaseCount: number
  maxToolsPerStage: number
  requiresHumanReview: boolean
  reviewStatus?: CodeCandidateBundleSummary['reviewStatus']
  validationOk?: boolean
  violations: string[]
}

export class CodeGenerationPlanner {
  plan(input: CodeGenerationPlannerInput): CodeGenerationPlanResult {
    if (!input.enabled) {
      return createDisabledCodeGenerationPlan()
    }

    const toolScopeValidation = validateCodeGenerationStageToolScopes()
    if (!toolScopeValidation.ok) {
      return {
        enabled: true,
        reasonCode: 'CODEGEN_TOOL_SCOPE_TOO_BROAD',
        stages: [],
        violations: toolScopeValidation.violations,
      }
    }

    const stages = buildCodeGenerationStagePlan()
    const candidateBundle = createCodeCandidateBundleSummary({
      bundleId: input.bundleId,
      files: input.files ?? [],
      requiresHumanReview: true,
      reviewStatus: 'pending_human_review',
      evidenceRefs: input.evidenceRefs ?? [],
      metadata: input.metadata,
    })

    return {
      enabled: true,
      reasonCode: candidateBundle.validation.ok
        ? 'CODEGEN_PLAN_READY'
        : 'CODEGEN_VALIDATION_FAILED',
      stages,
      candidateBundle,
      violations: candidateBundle.validation.violations,
    }
  }

  summarize(result: CodeGenerationPlanResult): CodeGenerationEvidenceSummary {
    const phaseCount = new Set(result.stages.map((stage) => stage.phase)).size
    const maxToolsPerStage = result.stages.reduce(
      (max, stage) => Math.max(max, stage.allowedTools.length),
      0,
    )

    return {
      enabled: result.enabled,
      reasonCode: result.reasonCode,
      stageCount: result.stages.length,
      fileCount: result.candidateBundle?.fileCount ?? 0,
      phaseCount,
      maxToolsPerStage,
      requiresHumanReview: result.candidateBundle?.requiresHumanReview ?? true,
      reviewStatus: result.candidateBundle?.reviewStatus,
      validationOk: result.candidateBundle?.validation.ok,
      violations: [...result.violations],
    }
  }

  getStageVisibility(stageId: string): CodeGenerationPlanStage | undefined {
    return buildCodeGenerationStagePlan().find((stage) => stage.stageId === stageId)
  }
}

export function createCodeGenerationPlanner(): CodeGenerationPlanner {
  return new CodeGenerationPlanner()
}

export function getCodeGenerationCatalogSize(): number {
  return CODE_GENERATION_STAGE_CATALOG.length
}
