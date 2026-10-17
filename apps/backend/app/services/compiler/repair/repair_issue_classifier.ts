/**
 * @aiproj/backend —— Repair Issue Classifier（tasks 2.1–2.4）。
 *
 * 把 Compiler 运行中的 schema、引用、确定性计算、Hard Validator、
 * Soft Evaluator、V-Gate、LLM 输出问题归一化为 Repair Issue。
 *
 * @aiproj/backend
 */

import type {
  V2HardValidationReport,
  SoftEvaluationReport,
  VGateDecision,
} from '@aiproj/compiler-spec'
import type { RepairIssue } from '@aiproj/compiler-spec'

// ── Classifier Input ──

export interface ClassifierInput {
  stageId: string
  hardValidationReport?: V2HardValidationReport | null
  softEvaluationReport?: SoftEvaluationReport | null
  vGateDecision?: VGateDecision | null
  llmOutputIssues?: LlmOutputIssue[]
  reconciliationIssues?: Omit<RepairIssue, 'createdAt'>[]
  schemaIssues?: SchemaIssue[]
  deterministicIssues?: DeterministicIssue[]
  manifestLedgerIssues?: ManifestLedgerIssue[]
}

// ── Secondary Issue Types ──

export interface LlmOutputIssue {
  description: string
  category:
    | 'empty'
    | 'malformed_json'
    | 'truncated_json'
    | 'unknown_entity'
    | 'duplicate_entity'
    | 'missing_field'
    | 'placeholder_content'
  entityIds?: string[]
  details?: string
}

export interface SchemaIssue {
  description: string
  path?: string
  field?: string
  entityIds?: string[]
  details?: string
}

export interface DeterministicIssue {
  description: string
  ruleId?: string
  entityIds?: string[]
  details?: string
}

export interface ManifestLedgerIssue {
  description: string
  entityIds?: string[]
  details?: string
}

// ── Classifier ──

export class RepairIssueClassifier {
  /**
   * 归一化各类输入为 RepairIssue 列表。
   */
  classify(input: ClassifierInput): RepairIssue[] {
    const issues: RepairIssue[] = []
    const now = new Date().toISOString()

    // 2.2: Hard Validator blocking/warning → Repair Issue
    if (input.hardValidationReport) {
      for (const issue of input.hardValidationReport.issues ?? []) {
        issues.push(this.#fromHardValidationIssue(issue, input.stageId, now))
      }
    }

    // 2.3: Soft Evaluator finding → advisory Repair Issue
    if (input.softEvaluationReport) {
      for (const dimScore of input.softEvaluationReport.dimensionScores ?? []) {
        if (dimScore.score < 3 || (dimScore.confidence ?? 0) < 0.3) {
          issues.push(this.#fromSoftScore(dimScore, input.stageId, now))
        }
      }
    }

    // V-Gate blocked → blocking issue
    if (input.vGateDecision && input.vGateDecision.status === 'blocked') {
      issues.push({
        issueId: `vg-${input.stageId}-${now}`,
        source: 'v_gate',
        stageId: input.stageId,
        entityIds: [],
        severity: 'blocking',
        repairability: 'human_review_required',
        description: `V-Gate blocked: ${(input.vGateDecision.blockingReasons ?? []).join('; ')}`,
        evidenceRefs: input.vGateDecision.evidenceRefs ?? [],
        affectedPaths: [],
        createdAt: now,
      })
    }

    // 2.4: LLM output quality failure → Repair Issue
    if (input.llmOutputIssues) {
      for (const llmIssue of input.llmOutputIssues) {
        issues.push(this.#fromLlmOutputIssue(llmIssue, input.stageId, now))
      }
    }

    // Schema issues
    if (input.schemaIssues) {
      for (const si of input.schemaIssues) {
        issues.push({
          issueId: `schema-${input.stageId}-${issues.length}-${now}`,
          source: 'schema_parse',
          stageId: input.stageId,
          entityIds: si.entityIds ?? [],
          severity: 'blocking',
          repairability: 'deterministic_auto_fixable',
          description: si.description,
          evidenceRefs: [],
          affectedPaths: si.path ? [si.path] : [],
          createdAt: now,
        })
      }
    }

    // Deterministic issues
    if (input.deterministicIssues) {
      for (const di of input.deterministicIssues) {
        issues.push({
          issueId: `det-${input.stageId}-${issues.length}-${now}`,
          source: 'deterministic',
          stageId: input.stageId,
          entityIds: di.entityIds ?? [],
          ruleId: di.ruleId,
          severity: 'blocking',
          repairability: 'deterministic_auto_fixable',
          description: di.description,
          evidenceRefs: [],
          affectedPaths: [],
          createdAt: now,
        })
      }
    }

    // Manifest/Ledger issues
    if (input.manifestLedgerIssues) {
      for (const mi of input.manifestLedgerIssues) {
        issues.push({
          issueId: `ml-${input.stageId}-${issues.length}-${now}`,
          source: 'manifest_ledger',
          stageId: input.stageId,
          entityIds: mi.entityIds ?? [],
          severity: 'blocking',
          repairability: 'human_review_required',
          description: mi.description,
          evidenceRefs: [],
          affectedPaths: [],
          createdAt: now,
        })
      }
    }

    return issues
  }

  #fromHardValidationIssue(
    issue: {
      ruleId: string
      severity: string
      path: string
      message: string
      affectedEntityIds?: string[]
      autoFixable?: boolean
      requiresHumanReview?: boolean
      sourceStageId?: string
    },
    stageId: string,
    now: string,
  ): RepairIssue {
    return {
      issueId: `hv-${issue.ruleId}-${issue.path}-${now}`,
      source: 'hard_validator',
      stageId: (issue as any).sourceStageId ?? stageId,
      entityIds: issue.affectedEntityIds ?? [],
      ruleId: issue.ruleId,
      severity: issue.severity === 'blocking' ? 'blocking' : 'warning',
      repairability: issue.autoFixable ? 'deterministic_auto_fixable' : 'human_review_required',
      suggestedStrategy: issue.autoFixable ? 'deterministic_auto_fix' : 'human_review',
      description: issue.message,
      evidenceRefs: [],
      affectedPaths: [issue.path],
      createdAt: now,
    }
  }

  #fromSoftScore(
    dimScore: {
      dimensionId: string
      score: number
      confidence?: number
      rationale?: string
      findings?: { description: string; severity?: string; affectedEntityIds?: string[] }[]
    },
    stageId: string,
    now: string,
  ): RepairIssue {
    return {
      issueId: `se-${dimScore.dimensionId}-${now}`,
      source: 'soft_evaluator',
      stageId,
      entityIds: (dimScore.findings ?? []).flatMap((f) => f.affectedEntityIds ?? []),
      dimensionId: dimScore.dimensionId,
      severity: 'warning',
      repairability: 'human_review_required',
      suggestedStrategy: 'human_review',
      description: `Soft evaluation low score (${dimScore.score}/5) for ${dimScore.dimensionId}: ${dimScore.rationale ?? ''}`,
      evidenceRefs: [],
      affectedPaths: [],
      createdAt: now,
    }
  }

  #fromLlmOutputIssue(llmIssue: LlmOutputIssue, stageId: string, now: string): RepairIssue {
    const { severity, repairability, strategy } = this.#classifyLlmIssue(llmIssue.category)
    return {
      issueId: `llm-${llmIssue.category}-${now}`,
      source: 'llm_output',
      stageId,
      entityIds: llmIssue.entityIds ?? [],
      severity,
      repairability,
      suggestedStrategy: strategy,
      description: llmIssue.description,
      evidenceRefs: [],
      affectedPaths: [],
      createdAt: now,
    }
  }

  #classifyLlmIssue(category: LlmOutputIssue['category']): {
    severity: 'blocking' | 'warning' | 'info'
    repairability: 'retryable' | 'human_review_required' | 'not_repairable'
    strategy: 'same_stage_llm_retry' | 'human_review' | 'skip'
  } {
    switch (category) {
      case 'empty':
      case 'malformed_json':
      case 'truncated_json':
        return {
          severity: 'blocking',
          repairability: 'retryable',
          strategy: 'same_stage_llm_retry',
        }
      case 'unknown_entity':
      case 'duplicate_entity':
        return {
          severity: 'blocking',
          repairability: 'retryable',
          strategy: 'same_stage_llm_retry',
        }
      case 'missing_field':
        return { severity: 'warning', repairability: 'retryable', strategy: 'same_stage_llm_retry' }
      case 'placeholder_content':
        return {
          severity: 'warning',
          repairability: 'human_review_required',
          strategy: 'human_review',
        }
    }
  }
}
