/**
 * @aiproj/compiler-spec —— Repair / Reconciliation schema 单元测试（tasks 1.8）。
 *
 * 测试覆盖：
 * - 各 schema 合法样本通过
 * - 缺必填字段失败
 * - 未知 strategy/severity/source 失败
 * - 非法 path / 非法 budget 失败
 * - 默认值填充
 */

import { describe, expect, it } from 'vitest'
import {
  cascadeGuardSchema,
  reconciliationFindingSchema,
  reconciliationReportSchema,
  repairabilitySchema,
  repairAttemptSchema,
  repairAttemptStatusSchema,
  repairBlockedItemSchema,
  repairBudgetSchema,
  repairCandidatePatchSchema,
  repairCostSummarySchema,
  repairErrorCategorySchema,
  repairEvidenceEntrySchema,
  repairIssueSchema,
  repairIssueSourceSchema,
  repairPlanItemSchema,
  repairPlanSchema,
  repairSeveritySchema,
  revalidationRequestSchema,
  revalidationResultSchema,
  suggestedRepairStrategySchema,
} from './index.js'

// ── Helper: valid sample builders ──

const validIssue = {
  issueId: 'issue-1',
  source: 'hard_validator' as const,
  stageId: 'stage-1',
  entityIds: ['entity-1'],
  ruleId: 'HV-001',
  severity: 'blocking' as const,
  repairability: 'deterministic_auto_fixable' as const,
  description: 'Cycle detected in task dependencies',
  createdAt: new Date().toISOString(),
}

const validBudget = {
  maxAttemptsPerItem: 3,
  maxTotalAttempts: 10,
  maxLlmRetries: 2,
  maxCascadeDepth: 3,
  maxWallClockMs: 30000,
  maxTokenBudget: 50000,
}

const validPlan = {
  planId: 'plan-1',
  compilerRunId: 1,
  budget: validBudget,
  items: [
    {
      itemId: 'item-1',
      issueId: 'issue-1',
      strategy: 'deterministic_auto_fix' as const,
      entityIds: ['entity-1'],
      stageId: 'stage-1',
      priority: 1,
    },
  ],
  createdAt: new Date().toISOString(),
}

const validAttempt = {
  attemptId: 'attempt-1',
  issueId: 'issue-1',
  planItemId: 'item-1',
  strategy: 'deterministic_auto_fix' as const,
  stageId: 'stage-1',
  entityIds: ['entity-1'],
  attemptNumber: 1,
  status: 'succeeded' as const,
  costSummary: { tokensUsed: 100, llmCallsMade: 0, deterministicAttempts: 1, latencyMs: 50 },
  idempotencyKey: 'ik-repair-run-1-stage-1-entity-1-v1-1-issue-1',
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
}

const validPatch = {
  patchId: 'patch-1',
  attemptId: 'attempt-1',
  issueIds: ['issue-1'],
  baseArtifactRef: 'pdm:run_1:v3',
  entityIds: ['entity-1'],
  ops: [{ op: 'replace' as const, path: '/tasks/entity-1/name', value: 'Updated task' }],
  reason: 'Cycle resolved by deterministic rule',
  sourceRuleIds: ['HV-001'],
  attemptNumber: 1,
  riskLevel: 'low_risk' as const,
  confidence: 0.9,
  idempotencyKey: 'ik-repair-patch-run-1-entity-1-v1-1',
  createdAt: new Date().toISOString(),
}

const validRevalidationRequest = {
  requestId: 'rv-1',
  compilerRunId: 1,
  attemptId: 'attempt-1',
  affectedEntityIds: ['entity-1'],
  createdAt: new Date().toISOString(),
}

const validRevalidationResult = {
  requestId: 'rv-1',
  passed: true,
  affectedEntityIds: ['entity-1'],
  remainingIssues: [],
  summary: 'All checks passed',
  completedAt: new Date().toISOString(),
}

const validReconciliationFinding = {
  findingId: 'finding-1',
  ruleId: 'RC-WBS-01',
  severity: 'warning' as const,
  entityIds: ['task-1'],
  description: 'Task missing WBS parent',
  createdAt: new Date().toISOString(),
}

const validReconciliationReport = {
  reportId: 'report-1',
  compilerRunId: 1,
  summary: {
    totalFindings: 1,
    blockingCount: 0,
    warningCount: 1,
    infoCount: 0,
    candidatePatches: 0,
    reviewItems: 0,
  },
  findings: [validReconciliationFinding],
  generatedAt: new Date().toISOString(),
}

// ============================================================================
// 1. Repair Issue Schema Tests
// ============================================================================

describe('repairIssueSchema', () => {
  it('accepts valid blocking issue', () => {
    expect(repairIssueSchema.safeParse(validIssue).success).toBe(true)
  })

  it('accepts valid advisory issue with optional fields', () => {
    const advisory = {
      ...validIssue,
      source: 'soft_evaluator' as const,
      severity: 'warning' as const,
      repairability: 'human_review_required' as const,
      dimensionId: 'SE-WBS-01',
    }
    expect(repairIssueSchema.safeParse(advisory).success).toBe(true)
  })

  it('rejects missing issueId', () => {
    const { issueId, ...rest } = validIssue as any
    expect(repairIssueSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects unknown severity', () => {
    expect(repairIssueSchema.safeParse({ ...validIssue, severity: 'critical' }).success).toBe(false)
  })

  it('rejects unknown source', () => {
    expect(repairIssueSchema.safeParse({ ...validIssue, source: 'external' }).success).toBe(false)
  })

  it('rejects unknown repairability', () => {
    expect(
      repairIssueSchema.safeParse({ ...validIssue, repairability: 'impossible' }).success,
    ).toBe(false)
  })

  it('fills default arrays when omitted', () => {
    const minimal = {
      issueId: 'issue-1',
      source: 'schema_parse' as const,
      stageId: 'stage-1',
      severity: 'info' as const,
      repairability: 'not_repairable' as const,
      createdAt: new Date().toISOString(),
    }
    const parsed = repairIssueSchema.parse(minimal)
    expect(parsed.entityIds).toEqual([])
    expect(parsed.evidenceRefs).toEqual([])
    expect(parsed.affectedPaths).toEqual([])
  })
})

// ============================================================================
// 2. Repair Plan / Budget / Cascade / Blocked Item Schema Tests
// ============================================================================

describe('repairBudgetSchema', () => {
  it('accepts valid budget', () => {
    expect(repairBudgetSchema.safeParse(validBudget).success).toBe(true)
  })

  it('rejects zero maxAttemptsPerItem', () => {
    expect(repairBudgetSchema.safeParse({ ...validBudget, maxAttemptsPerItem: 0 }).success).toBe(
      false,
    )
  })

  it('rejects negative maxTotalAttempts', () => {
    expect(repairBudgetSchema.safeParse({ ...validBudget, maxTotalAttempts: -1 }).success).toBe(
      false,
    )
  })

  it('fills defaults with empty object', () => {
    const parsed = repairBudgetSchema.parse({})
    expect(parsed.maxAttemptsPerItem).toBe(3)
    expect(parsed.maxTokenBudget).toBe(50000)
  })
})

describe('cascadeGuardSchema', () => {
  it('accepts valid cascade guard', () => {
    const guard = {
      changedEntityIds: ['entity-1'],
      affectedEntityIds: ['entity-2', 'entity-3'],
      cascadeDepth: 2,
      exceedsLimit: false,
    }
    expect(cascadeGuardSchema.safeParse(guard).success).toBe(true)
  })

  it('rejects negative cascadeDepth', () => {
    expect(cascadeGuardSchema.safeParse({ cascadeDepth: -1 }).success).toBe(false)
  })
})

describe('repairBlockedItemSchema', () => {
  it('accepts valid blocked item', () => {
    const item = {
      itemId: 'blocked-1',
      issueId: 'issue-1',
      reason: 'budget_exhausted' as const,
    }
    expect(repairBlockedItemSchema.safeParse(item).success).toBe(true)
  })

  it('rejects unknown reason', () => {
    expect(
      repairBlockedItemSchema.safeParse({
        itemId: 'blocked-1',
        issueId: 'issue-1',
        reason: 'unknown_reason',
      }).success,
    ).toBe(false)
  })
})

describe('repairPlanSchema', () => {
  it('accepts valid plan', () => {
    expect(repairPlanSchema.safeParse(validPlan).success).toBe(true)
  })

  it('rejects missing planId', () => {
    const { planId, ...rest } = validPlan as any
    expect(repairPlanSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects unknown strategy in item', () => {
    expect(
      repairPlanSchema.safeParse({
        ...validPlan,
        items: [{ ...validPlan.items[0], strategy: 'model_upgrade' }],
      }).success,
    ).toBe(false)
  })
})

// ============================================================================
// 3. Repair Attempt Schema Tests
// ============================================================================

describe('repairAttemptSchema', () => {
  it('accepts valid attempt', () => {
    expect(repairAttemptSchema.safeParse(validAttempt).success).toBe(true)
  })

  it('accepts in-progress attempt without completedAt', () => {
    const { completedAt, ...inProgress } = validAttempt as any
    expect(repairAttemptSchema.safeParse({ ...inProgress, status: 'in_progress' }).success).toBe(
      true,
    )
  })

  it('rejects unknown status', () => {
    expect(repairAttemptSchema.safeParse({ ...validAttempt, status: 'cancelled' }).success).toBe(
      false,
    )
  })

  it('rejects missing idempotencyKey', () => {
    const { idempotencyKey, ...rest } = validAttempt as any
    expect(repairAttemptSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects attemptNumber < 1', () => {
    expect(repairAttemptSchema.safeParse({ ...validAttempt, attemptNumber: 0 }).success).toBe(false)
  })
})

// ============================================================================
// 4. Candidate Patch Schema Tests
// ============================================================================

describe('repairCandidatePatchSchema', () => {
  it('accepts valid patch', () => {
    expect(repairCandidatePatchSchema.safeParse(validPatch).success).toBe(true)
  })

  it('rejects patch with op missing path', () => {
    const bad = {
      ...validPatch,
      ops: [{ op: 'replace', value: 'x' }],
    }
    expect(repairCandidatePatchSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects unknown op type', () => {
    expect(
      repairCandidatePatchSchema.safeParse({
        ...validPatch,
        ops: [{ op: 'delete', path: '/x', value: null }],
      }).success,
    ).toBe(false)
  })

  it('rejects empty entityIds', () => {
    expect(repairCandidatePatchSchema.safeParse({ ...validPatch, entityIds: [] }).success).toBe(
      false,
    )
  })

  it('rejects empty ops', () => {
    expect(repairCandidatePatchSchema.safeParse({ ...validPatch, ops: [] }).success).toBe(false)
  })

  it('rejects confidence > 1', () => {
    expect(repairCandidatePatchSchema.safeParse({ ...validPatch, confidence: 1.5 }).success).toBe(
      false,
    )
  })

  it('rejects unknown riskLevel', () => {
    expect(
      repairCandidatePatchSchema.safeParse({ ...validPatch, riskLevel: 'extreme' }).success,
    ).toBe(false)
  })
})

// ============================================================================
// 5. Revalidation Schema Tests
// ============================================================================

describe('revalidationRequestSchema', () => {
  it('accepts valid request', () => {
    expect(revalidationRequestSchema.safeParse(validRevalidationRequest).success).toBe(true)
  })

  it('rejects missing requestId', () => {
    const { requestId, ...rest } = validRevalidationRequest as any
    expect(revalidationRequestSchema.safeParse(rest).success).toBe(false)
  })

  it('fills defaults', () => {
    const parsed = revalidationRequestSchema.parse(validRevalidationRequest)
    expect(parsed.includeDeterministicRecompute).toBe(true)
    expect(parsed.includeHardValidation).toBe(true)
  })
})

describe('revalidationResultSchema', () => {
  it('accepts passed result', () => {
    expect(revalidationResultSchema.safeParse(validRevalidationResult).success).toBe(true)
  })

  it('accepts failed result', () => {
    expect(
      revalidationResultSchema.safeParse({
        ...validRevalidationResult,
        passed: false,
        schemaValid: false,
        hardValidationValid: false,
      }).success,
    ).toBe(true)
  })

  it('fills defaults for optional booleans', () => {
    const parsed = revalidationResultSchema.parse(validRevalidationResult)
    expect(parsed.schemaValid).toBe(true)
    expect(parsed.referencesValid).toBe(true)
  })
})

// ============================================================================
// 6. Reconciliation Schema Tests
// ============================================================================

describe('reconciliationFindingSchema', () => {
  it('accepts valid finding', () => {
    expect(reconciliationFindingSchema.safeParse(validReconciliationFinding).success).toBe(true)
  })

  it('rejects missing description', () => {
    const { description, ...rest } = validReconciliationFinding as any
    expect(reconciliationFindingSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects unknown severity', () => {
    expect(
      reconciliationFindingSchema.safeParse({ ...validReconciliationFinding, severity: 'critical' })
        .success,
    ).toBe(false)
  })
})

describe('reconciliationReportSchema', () => {
  it('accepts valid report', () => {
    expect(reconciliationReportSchema.safeParse(validReconciliationReport).success).toBe(true)
  })

  it('rejects missing reportId', () => {
    const { reportId, ...rest } = validReconciliationReport as any
    expect(reconciliationReportSchema.safeParse(rest).success).toBe(false)
  })
})

// ============================================================================
// 7. Repair Evidence Schema Tests
// ============================================================================

describe('repairEvidenceEntrySchema', () => {
  it('accepts valid evidence', () => {
    const evidence = {
      evidenceId: 'ev-1',
      compilerRunId: 1,
      evidenceType: 'repair_plan_generated' as const,
      createdAt: new Date().toISOString(),
    }
    expect(repairEvidenceEntrySchema.safeParse(evidence).success).toBe(true)
  })

  it('rejects unknown evidenceType', () => {
    expect(
      repairEvidenceEntrySchema.safeParse({
        evidenceId: 'ev-1',
        compilerRunId: 1,
        evidenceType: 'random_event',
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false)
  })
})

// ============================================================================
// Enum schema consistency tests
// ============================================================================

describe('enum schemas', () => {
  it('repairIssueSourceSchema has expected values', () => {
    const values = repairIssueSourceSchema.options
    expect(values).toContain('hard_validator')
    expect(values).toContain('soft_evaluator')
    expect(values).toContain('llm_output')
    expect(values).toContain('reconciliation')
  })

  it('repairSeveritySchema has expected values', () => {
    const values = repairSeveritySchema.options
    expect(values).toContain('blocking')
    expect(values).toContain('warning')
  })

  it('repairabilitySchema has expected values', () => {
    const values = repairabilitySchema.options
    expect(values).toContain('deterministic_auto_fixable')
    expect(values).toContain('human_review_required')
  })

  it('suggestedRepairStrategySchema has expected values', () => {
    const values = suggestedRepairStrategySchema.options
    expect(values).toContain('deterministic_auto_fix')
    expect(values).toContain('same_stage_llm_retry')
    expect(values).toContain('human_review')
  })

  it('repairAttemptStatusSchema has expected values', () => {
    const values = repairAttemptStatusSchema.options
    expect(values).toContain('succeeded')
    expect(values).toContain('failed')
    expect(values).toContain('degraded_to_human_review')
  })

  it('repairErrorCategorySchema has expected values', () => {
    const values = repairErrorCategorySchema.options
    expect(values).toContain('llm_empty')
    expect(values).toContain('llm_malformed_json')
    expect(values).toContain('llm_truncated')
    expect(values).toContain('budget_exhausted')
  })
})
