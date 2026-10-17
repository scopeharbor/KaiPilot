/**
 * @aiproj/backend —— Repair Classifier / Planner / Budget / Cascade 单元测试（tasks 2.8）。
 *
 * 测试覆盖：
 * - blocking issue 分类
 * - advisory/soft issue 分类（禁止 auto-fix）
 * - LLM output quality failure 分类（empty/malformed/truncated/unknown entity）
 * - Repair Plan 生成
 * - budget guard（单项上限、总上限、token 上限、wall clock）
 * - cascade guard（级联深度计算、超限拒绝）
 * - unknown entity、budget exhausted、cascade exceeded
 */

import { describe, expect, it } from 'vitest'
import type { V2HardValidationReport, SoftEvaluationReport } from '@aiproj/compiler-spec'
import { RepairIssueClassifier } from '../../../app/services/compiler/repair/repair_issue_classifier.js'
import type { ClassifierInput } from '../../../app/services/compiler/repair/repair_issue_classifier.js'
import { RepairBudgetGuard } from '../../../app/services/compiler/repair/repair_budget_guard.js'
import { CascadeGuardService } from '../../../app/services/compiler/repair/cascade_guard_service.js'
import { RepairPlanner } from '../../../app/services/compiler/repair/repair_planner.js'
import type {
  ManifestEntityState,
  PlannerContext,
} from '../../../app/services/compiler/repair/repair_planner.js'
import { DEFAULT_REPAIR_BUDGET } from '@aiproj/compiler-spec'

// ── Fixtures ──

const now = new Date().toISOString()
const classifier = new RepairIssueClassifier()

const hardValidationReport: V2HardValidationReport = {
  validationId: 'hv-001',
  stageId: 'schedule_gate',
  pdmSnapshotId: 'snap-001',
  rulesetVersion: '2.0',
  summary: {
    totalRules: 1,
    passed: 0,
    blocking: 1,
    warnings: 0,
    infos: 0,
    notApplicable: 0,
    inputMissing: 0,
  },
  issues: [
    {
      ruleId: 'HV-008',
      severity: 'blocking',
      category: 'date_schedule',
      path: '/tasks/T1-001/plannedEnd',
      message: 'Task end date before project start',
      affectedEntityIds: ['T1-001'],
      autoFixable: true,
      requiresHumanReview: false,
      sourceStageId: 'schedule_gate',
      evidence: 'computed schedule',
    },
  ],
  notApplicableRules: [],
  inputSignature: {
    schemaParsed: true,
    graphAvailable: true,
    scheduleAvailable: true,
    criticalPathAvailable: false,
    resourceLoadAvailable: false,
    diffAvailable: false,
    stageMetadataAvailable: true,
  },
  isFullValidation: true,
  skippedRules: [],
  generatedAt: now,
}

const softReport: SoftEvaluationReport = {
  evaluationId: 'se-001',
  profile: {
    profileId: 'wbs_profile',
    name: 'WBS Profile',
    dimensionIds: ['SE-WBS-01'],
    weightOverrides: {},
    thresholdOverrides: {},
    budgetTokens: 0,
    budgetCalls: 0,
    maxRetriesPerDimension: 2,
    enabledByDefault: false,
    description: '',
  },
  model: 'deepseek-v4',
  dimensionsEvaluated: ['SE-WBS-01'],
  status: 'completed',
  dimensionScores: [
    {
      dimensionId: 'SE-WBS-01',
      score: 2,
      confidence: 0.8,
      rationale: 'WBS decomposition unclear',
      findings: [
        {
          description: 'Work packages not well defined',
          severity: 'warning',
          affectedEntityIds: ['WP-001'],
          unanchored: false,
          evidenceSnippet: 'WP-001',
          suggestedReviewAction: '人工复核 WBS 拆解',
        },
      ],
      status: 'evaluated',
      tokensUsed: 500,
      latencyMs: 200,
      retryCount: 0,
    },
  ],
  costAndLatencySummary: {
    totalCalls: 1,
    totalTokens: 500,
    totalLatencyMs: 200,
    provider: 'deepseek',
    model: 'deepseek-v4',
    dimensionCount: 1,
    retryCount: 0,
    budgetStatus: 'within_budget',
    budgetLimitTokens: 0,
    budgetLimitCalls: 0,
  },
  generatedAt: now,
}

const input: ClassifierInput = {
  stageId: 'schedule_gate',
  hardValidationReport,
  softEvaluationReport: softReport,
  vGateDecision: {
    decisionId: 'vg-schedule-001',
    stageId: 'schedule_gate',
    profileId: 'schedule_gate',
    status: 'blocked',
    blockingReasons: ['Schedule validation failed'],
    warnings: [],
    attentionAreas: [],
    evidenceRefs: ['hv-001'],
    repairSuggestions: [],
    requiresHumanReview: false,
    allowedNextActions: [],
    hardSummary: { totalBlocking: 1, totalWarnings: 0, passed: false },
    generatedAt: now,
  },
  llmOutputIssues: [
    { description: 'Model returned empty response', category: 'empty' },
    { description: 'Malformed JSON: unterminated string', category: 'malformed_json' },
    { description: 'Truncated JSON: missing closing brace', category: 'truncated_json' },
    {
      description: 'Unknown entity ID "FAKE-001"',
      category: 'unknown_entity',
      entityIds: ['FAKE-001'],
    },
  ],
}

const manifestEntities: ManifestEntityState[] = [
  { entityId: 'T1-001', status: 'failed_retryable', attemptCount: 1 },
  { entityId: 'WP-001', status: 'pending', attemptCount: 0 },
  { entityId: 'M-001', status: 'committed_to_pdm', attemptCount: 1 },
  { entityId: 'T2-001', status: 'needs_human_review', attemptCount: 2 },
]

const plannerContext: PlannerContext = {
  compilerRunId: 1,
  stageId: 'schedule_gate',
  manifestEntities,
}

// ============================================================================
// RepairIssueClassifier Tests
// ============================================================================

describe('RepairIssueClassifier', () => {
  it('classifies hard validator blocking issue', () => {
    const issues = classifier.classify({ stageId: 'sg', hardValidationReport })
    const hvIssues = issues.filter((i) => i.source === 'hard_validator')
    expect(hvIssues.length).toBeGreaterThan(0)
    expect(hvIssues[0].severity).toBe('blocking')
    expect(hvIssues[0].repairability).toBe('deterministic_auto_fixable')
    expect(hvIssues[0].entityIds).toContain('T1-001')
    expect(hvIssues[0].ruleId).toBe('HV-008')
  })

  it('classifies soft evaluation low score as advisory (not auto-fix)', () => {
    const issues = classifier.classify({ stageId: 'wbs', softEvaluationReport: softReport })
    const seIssues = issues.filter((i) => i.source === 'soft_evaluator')
    expect(seIssues.length).toBeGreaterThan(0)
    expect(seIssues[0].severity).toBe('warning')
    expect(seIssues[0].repairability).toBe('human_review_required')
    expect(seIssues[0].suggestedStrategy).toBe('human_review')
  })

  it('classifies V-Gate blocked as blocking issue', () => {
    const issues = classifier.classify({
      stageId: 'sg',
      vGateDecision: {
        decisionId: 'vg-002',
        stageId: 'sg',
        profileId: 'test',
        status: 'blocked',
        blockingReasons: ['Test blocking'],
        warnings: [],
        attentionAreas: [],
        evidenceRefs: [],
        repairSuggestions: [],
        requiresHumanReview: false,
        allowedNextActions: [],
        hardSummary: { totalBlocking: 1, totalWarnings: 0, passed: false },
        generatedAt: now,
      },
    })
    const vgIssues = issues.filter((i) => i.source === 'v_gate')
    expect(vgIssues.length).toBe(1)
    expect(vgIssues[0].severity).toBe('blocking')
  })

  it('classifies LLM empty output as retryable', () => {
    const issues = classifier.classify({
      stageId: 'sg',
      llmOutputIssues: [{ description: 'Empty', category: 'empty' }],
    })
    const llmIssue = issues.find((i) => i.source === 'llm_output')
    expect(llmIssue).toBeDefined()
    expect(llmIssue!.repairability).toBe('retryable')
    expect(llmIssue!.suggestedStrategy).toBe('same_stage_llm_retry')
  })

  it('classifies LLM truncated JSON as retryable', () => {
    const issues = classifier.classify({
      stageId: 'sg',
      llmOutputIssues: [{ description: 'Truncated', category: 'truncated_json' }],
    })
    const llmIssue = issues.find((i) => i.source === 'llm_output')
    expect(llmIssue).toBeDefined()
    expect(llmIssue!.repairability).toBe('retryable')
  })

  it('classifies LLM unknown entity as retryable', () => {
    const issues = classifier.classify({
      stageId: 'sg',
      llmOutputIssues: [
        { description: 'Unknown entity FAKE', category: 'unknown_entity', entityIds: ['FAKE'] },
      ],
    })
    const llmIssue = issues.find((i) => i.source === 'llm_output')
    expect(llmIssue).toBeDefined()
    expect(llmIssue!.repairability).toBe('retryable')
  })

  it('classifies placeholder content as human review', () => {
    const issues = classifier.classify({
      stageId: 'sg',
      llmOutputIssues: [{ description: 'Placeholder detected', category: 'placeholder_content' }],
    })
    const llmIssue = issues.find((i) => i.source === 'llm_output')
    expect(llmIssue).toBeDefined()
    expect(llmIssue!.repairability).toBe('human_review_required')
    expect(llmIssue!.suggestedStrategy).toBe('human_review')
  })

  it('classifies schema issues as blocking deterministic_auto_fixable', () => {
    const issues = classifier.classify({
      stageId: 'sg',
      schemaIssues: [
        {
          description: 'Missing required field: name',
          path: '/tasks/T1-001/name',
          entityIds: ['T1-001'],
        },
      ],
    })
    const schemaIssue = issues.find((i) => i.source === 'schema_parse')
    expect(schemaIssue).toBeDefined()
    expect(schemaIssue!.severity).toBe('blocking')
    expect(schemaIssue!.repairability).toBe('deterministic_auto_fixable')
  })

  it('classifies manifest/ledger issues as blocking human_review_required', () => {
    const issues = classifier.classify({
      stageId: 'sg',
      manifestLedgerIssues: [
        { description: 'Entity not in Manifest registry', entityIds: ['UNKNOWN'] },
      ],
    })
    const mlIssue = issues.find((i) => i.source === 'manifest_ledger')
    expect(mlIssue).toBeDefined()
    expect(mlIssue!.severity).toBe('blocking')
    expect(mlIssue!.repairability).toBe('human_review_required')
  })

  it('returns empty array when no input provided', () => {
    const issues = classifier.classify({ stageId: 'sg' })
    expect(issues).toEqual([])
  })

  it('handles multiple issue sources together', () => {
    const issues = classifier.classify(input)
    expect(issues.length).toBeGreaterThanOrEqual(7) // 1 HV + 1 SE + 1 VG + 4 LLM
    const sources = new Set(issues.map((i) => i.source))
    expect(sources.has('hard_validator')).toBe(true)
    expect(sources.has('soft_evaluator')).toBe(true)
    expect(sources.has('v_gate')).toBe(true)
    expect(sources.has('llm_output')).toBe(true)
  })
})

// ============================================================================
// RepairBudgetGuard Tests
// ============================================================================

describe('RepairBudgetGuard', () => {
  it('allows first attempt within budget', () => {
    const guard = new RepairBudgetGuard(DEFAULT_REPAIR_BUDGET)
    expect(guard.canAttempt('item-1')).toEqual({ allowed: true })
  })

  it('blocks when maxAttemptsPerItem reached', () => {
    const guard = new RepairBudgetGuard({ ...DEFAULT_REPAIR_BUDGET, maxAttemptsPerItem: 1 })
    guard.recordAttempt('item-1')
    expect(guard.canAttempt('item-1').allowed).toBe(false)
  })

  it('blocks when maxTotalAttempts reached', () => {
    const guard = new RepairBudgetGuard({ ...DEFAULT_REPAIR_BUDGET, maxTotalAttempts: 2 })
    guard.recordAttempt('item-1')
    guard.recordAttempt('item-2')
    // 第3个 attempt 应被阻止
    expect(guard.canAttempt('item-3').allowed).toBe(false)
    expect(guard.canAttempt('item-3').reason).toBe('budget_exhausted')
  })

  it('blocks when token budget exhausted', () => {
    const guard = new RepairBudgetGuard({ ...DEFAULT_REPAIR_BUDGET, maxTokenBudget: 100 })
    guard.recordAttempt('item-1', 150)
    expect(guard.canAttempt('item-2').allowed).toBe(false)
  })

  it('blocks when wall clock exhausted', () => {
    const guard = new RepairBudgetGuard({ ...DEFAULT_REPAIR_BUDGET, maxWallClockMs: -1 }) // expired
    expect(guard.canAttempt('item-1').allowed).toBe(false)
  })

  it('tracks LLM retries separately', () => {
    const guard = new RepairBudgetGuard({ ...DEFAULT_REPAIR_BUDGET, maxLlmRetries: 1 })
    expect(guard.canLlmRetry()).toEqual({ allowed: true })
    guard.recordAttempt('item-1', 10, true)
    expect(guard.canLlmRetry().allowed).toBe(false)
  })

  it('records multiple items independently', () => {
    const guard = new RepairBudgetGuard({ ...DEFAULT_REPAIR_BUDGET, maxAttemptsPerItem: 3 })
    guard.recordAttempt('a')
    guard.recordAttempt('a')
    guard.recordAttempt('b')
    expect(guard.canAttempt('a').allowed).toBe(true) // 2/3
    expect(guard.canAttempt('b').allowed).toBe(true) // 1/3
    guard.recordAttempt('a')
    expect(guard.canAttempt('a').allowed).toBe(false) // 3/3 reached
  })

  it('returns correct budget state', () => {
    const guard = new RepairBudgetGuard(DEFAULT_REPAIR_BUDGET)
    guard.recordAttempt('item-1', 50, true)
    const state = guard.state
    expect(state.totalAttempts).toBe(1)
    expect(state.tokensUsed).toBe(50)
    expect(state.llmRetries).toBe(1)
  })
})

// ============================================================================
// CascadeGuardService Tests
// ============================================================================

describe('CascadeGuardService', () => {
  it('computes closure for simple dependency chain', () => {
    const deps = new Map<string, string[]>([
      ['T1-001', ['T2-001']],
      ['T2-001', ['T3-001']],
    ])
    const service = new CascadeGuardService(3)
    const result = service.computeClosure(['T1-001'], ['/tasks/T1-001'], deps)
    expect(result.cascadeGuard.affectedEntityIds).toContain('T1-001')
    expect(result.cascadeGuard.affectedEntityIds).toContain('T2-001')
    expect(result.cascadeGuard.affectedEntityIds).toContain('T3-001')
    expect(result.cascadeGuard.exceedsLimit).toBe(false)
    expect(result.cascadeGuard.cascadeDepth).toBeLessThanOrEqual(3)
  })

  it('rejects when cascade depth exceeds maxCascadeDepth', () => {
    const deps = new Map<string, string[]>([
      ['T1', ['T2']],
      ['T2', ['T3']],
      ['T3', ['T4']],
      ['T4', ['T5']],
    ])
    const service = new CascadeGuardService(2)
    const result = service.computeClosure(['T1'], ['/tasks/T1'], deps)
    expect(result.cascadeGuard.exceedsLimit).toBe(true)
    expect(service.canAutoRepair(result.cascadeGuard).allowed).toBe(false)
  })

  it('allows repair when within cascade limit', () => {
    const deps = new Map<string, string[]>([
      ['T1', ['T2']],
      ['T2', ['T3']],
    ])
    const service = new CascadeGuardService(3)
    const result = service.computeClosure(['T1'], ['/tasks/T1'], deps)
    expect(service.canAutoRepair(result.cascadeGuard).allowed).toBe(true)
  })

  it('handles no dependencies gracefully', () => {
    const service = new CascadeGuardService(3)
    const result = service.computeClosure(['T1'], ['/tasks/T1'])
    expect(result.cascadeGuard.affectedEntityIds).toEqual(['T1'])
    expect(result.cascadeGuard.exceedsLimit).toBe(false)
  })

  it('handles fan-out dependency tree', () => {
    const deps = new Map<string, string[]>([
      ['T1', ['T2', 'T3', 'T4']],
      ['T2', ['T5']],
    ])
    const service = new CascadeGuardService(3)
    const result = service.computeClosure(['T1'], ['/tasks/T1'], deps)
    expect(result.cascadeGuard.affectedEntityIds.length).toBeGreaterThanOrEqual(4)
    expect(result.cascadeGuard.exceedsLimit).toBe(false)
  })
})

// ============================================================================
// RepairPlanner Tests
// ============================================================================

describe('RepairPlanner', () => {
  const planner = new RepairPlanner()

  it('generates plan with executable items for fixable issues', () => {
    const localClassifier = new RepairIssueClassifier()
    const issues = localClassifier.classify({
      stageId: 'schedule_gate',
      hardValidationReport,
    })
    const plan = planner.plan(issues, plannerContext)
    expect(plan.planId).toBeDefined()
    expect(plan.compilerRunId).toBe(1)
    expect(plan.items.length).toBeGreaterThan(0)
    expect(plan.items.some((i) => i.executable)).toBe(true)
  })

  it('generates plan with blocked items for committed entities', () => {
    const localClassifier = new RepairIssueClassifier()
    const issues = localClassifier.classify({
      stageId: 'sg',
      llmOutputIssues: [
        { description: 'Retry needed', category: 'malformed_json', entityIds: ['M-001'] },
      ],
    })
    const plan = planner.plan(issues, {
      ...plannerContext,
      manifestEntities: [...manifestEntities],
    })
    // M-001 is committed_to_pdm, should be blocked
    const blocked = plan.blockedItems.filter((b) => b.reason === 'skipped_by_policy')
    expect(blocked.length).toBeGreaterThan(0)
  })

  it('generates plan with human_review items for soft advisory issues', () => {
    const issues = classifier.classify({ stageId: 'wbs', softEvaluationReport: softReport })
    const plan = planner.plan(issues, plannerContext)
    const reviewItems = plan.items.filter((i) => i.strategy === 'human_review')
    expect(reviewItems.length).toBeGreaterThan(0)
  })

  it('generates plan with blocked items for not_repairable issues', () => {
    const issues = classifier.classify({ stageId: 'sg', hardValidationReport })
    // mark one issue not_repairable
    const modified = issues.map((i) => ({
      ...i,
      repairability: 'not_repairable' as const,
    }))
    const plan = planner.plan(modified, plannerContext)
    expect(plan.blockedItems.some((b) => b.reason === 'not_repairable')).toBe(true)
  })

  it('generates blocked items when budget is exhausted', () => {
    const issues = classifier.classify(input)
    const plan = planner.plan(issues, {
      ...plannerContext,
      budget: { maxTotalAttempts: 0 },
    })
    expect(plan.blockedItems.length).toBeGreaterThan(0)
    const budgetBlocked = plan.blockedItems.some((b) => b.reason === 'budget_exhausted')
    expect(budgetBlocked).toBe(true)
  })

  it('blocks items for unregistered entities', () => {
    const issues = [
      {
        issueId: 'issue-unknown',
        source: 'hard_validator' as const,
        stageId: 'sg',
        entityIds: ['UNKNOWN-ENTITY'],
        severity: 'blocking' as const,
        repairability: 'deterministic_auto_fixable' as const,
        description: 'Unknown entity issue',
        evidenceRefs: [],
        affectedPaths: [],
        createdAt: now,
      },
    ]
    const plan = planner.plan(issues, plannerContext)
    expect(plan.blockedItems.some((b) => b.reason === 'skipped_by_policy')).toBe(true)
  })

  it('sorts blocking issues before warning/info', () => {
    const issues: any[] = [
      {
        issueId: 'info-1',
        source: 'hard_validator',
        stageId: 'sg',
        severity: 'info',
        repairability: 'retryable',
        suggestedStrategy: 'same_stage_llm_retry',
        description: 'Info level issue',
        entityIds: ['T1-001'],
        evidenceRefs: [],
        affectedPaths: [],
        createdAt: now,
      },
      {
        issueId: 'blocking-1',
        source: 'hard_validator',
        stageId: 'sg',
        severity: 'blocking',
        repairability: 'deterministic_auto_fixable',
        suggestedStrategy: 'deterministic_auto_fix',
        description: 'Blocking issue',
        entityIds: ['T1-001'],
        evidenceRefs: [],
        affectedPaths: [],
        createdAt: now,
      },
    ]
    const plan = planner.plan(issues, plannerContext)
    const blockingItems = plan.items.filter((i) => i.priority === 0)
    expect(blockingItems.length).toBeGreaterThan(0)
  })
})
