import type {
  DraftAutoFixDiff,
  DraftValidationPhase,
  DraftValidationReport,
  DraftValidationIssue,
  ProjectDraft,
  ProjectDraftMeta,
  ProjectDraftSelection,
} from '@aiproj/types'
import { DraftValidationService } from './validation_service.ts'

export interface DraftValidationInput {
  draft: ProjectDraft
  phase?: DraftValidationPhase | 'all'
  selection?: ProjectDraftSelection | null
}

export interface DraftValidationGateway {
  validate(input: DraftValidationInput): DraftValidationReport
  autoFix?(input: DraftValidationInput): {
    draft: ProjectDraft
    report: DraftValidationReport
    diffs: DraftAutoFixDiff[]
  }
}

export class StructuralDraftValidationGateway implements DraftValidationGateway {
  private readonly service = new DraftValidationService()

  validate(input: DraftValidationInput): DraftValidationReport {
    return this.service.validate(input.draft, {
      phase: input.phase ?? 'all',
      selection: input.selection,
    })
  }

  autoFix(input: DraftValidationInput) {
    return this.service.autoFix(input.draft, {
      phase: input.phase ?? 'all',
      selection: input.selection,
    })
  }
}

export const draftValidationGateway: DraftValidationGateway = new StructuralDraftValidationGateway()

/** 将结构规则与生成来源/grounding 硬门合并为唯一可确认报告。 */
export function applyGenerationQualityGate(
  report: DraftValidationReport,
  input: { meta: ProjectDraftMeta; qualityIssues?: DraftValidationIssue[] },
): DraftValidationReport {
  const additional = [...(input.qualityIssues ?? [])]
  const status = input.meta.confirmability?.status
  if (status && status !== 'confirmable') {
    additional.push({
      ruleId: 'HL-010',
      severity: 'blocking',
      message:
        status === 'failed'
          ? '生成未形成可审查的权威草案。'
          : '草案来源或语义尚未验证，禁止确认导入。',
      path: 'meta.confirmability',
      autoFixable: false,
      dimension: 'assumptionClarity',
      failed: true,
    })
  }
  if (input.meta.fallbackUsed || input.meta.provenance?.fallbackUsed) {
    additional.push({
      ruleId: 'HL-010',
      severity: 'blocking',
      message: 'Fallback 或离线蓝图不能作为可确认的真实模型草案。',
      path: 'meta.provenance.fallbackUsed',
      autoFixable: false,
      dimension: 'factualAccuracy',
      failed: true,
    })
  }
  if (input.meta.stages) {
    const stagesComplete =
      input.meta.stages.length === 5 &&
      input.meta.stages.every(
        (stage) => stage.status === 'completed' && stage.artifactHash !== null,
      )
    const toolsWithinLimit = input.meta.stages.every((stage) => stage.allowedTools.length <= 2)
    if (!stagesComplete) {
      additional.push({
        ruleId: 'HL-010',
        severity: 'blocking',
        message: '阶段产物不完整，禁止确认导入。',
        path: 'meta.stages',
        autoFixable: false,
        dimension: 'logicalConsistency',
        failed: true,
      })
    }
    if (!toolsWithinLimit) {
      additional.push({
        ruleId: 'HL-010',
        severity: 'blocking',
        message: '阶段工具暴露超出上限，禁止确认导入。',
        path: 'meta.stages.allowedTools',
        autoFixable: false,
        dimension: 'logicalConsistency',
        failed: true,
      })
    }
  }
  const seen = new Set(report.blocking.map((issue) => `${issue.ruleId}:${issue.path}`))
  const blocking = [...report.blocking]
  for (const issue of additional) {
    const key = `${issue.ruleId}:${issue.path}`
    if (!seen.has(key)) {
      blocking.push(issue)
      seen.add(key)
    }
  }
  // DraftValidationReport 的权威契约是 0–100；不得用 0–1 的小数把真实分数压成 1 分。
  const confidenceCap = status === undefined ? 100 : status === 'confirmable' ? 99 : 85
  const confidenceScore = Math.min(report.confidenceScore, confidenceCap)
  return {
    ...report,
    confidenceScore,
    blocking,
    ruleResults: [...report.ruleResults, ...additional],
    canConfirm: blocking.length === 0,
  }
}
