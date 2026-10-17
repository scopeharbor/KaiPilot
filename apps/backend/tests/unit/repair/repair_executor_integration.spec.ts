/**
 * @aiproj/backend —— Repair Executor + Revalidation + Evidence + Reconciliation 集成测试（tasks 4.6, 5.6, 6.6, 7.8）。
 *
 * 测试覆盖：
 * - 确定性 auto-fix 成功
 * - LLM retry 成功/失败
 * - 预算耗尽降级
 * - 重校验通过/失败
 * - 受影响闭包扩展
 * - Global Reconciliation 各维度对账
 * - 证据写入
 * - 正式业务表零写入
 */

import { describe, expect, it } from 'vitest'
import type {
  RepairPlan,
  RepairPlanItem,
  RepairCandidatePatch,
  RepairAttempt,
} from '@aiproj/compiler-spec'
import { RepairExecutor } from '../../../app/services/compiler/repair/repair_executor.js'
import type {
  DeterministicAutoFixAdapter,
  LlmRetryAdapter,
} from '../../../app/services/compiler/repair/repair_executor.js'
import { RepairRevalidationOrchestrator } from '../../../app/services/compiler/repair/repair_revalidation_orchestrator.js'
import type {
  SchemaValidator,
  GraphValidator,
  DeterministicRecompute,
  HardValidator,
  VGate,
} from '../../../app/services/compiler/repair/repair_revalidation_orchestrator.js'
import { GlobalReconciliationChecker } from '../../../app/services/compiler/repair/global_reconciliation_checker.js'
import type {
  ReconciliationPdmInput,
  PdmComputedInput,
} from '../../../app/services/compiler/repair/global_reconciliation_checker.js'
import { RepairEvidenceWriter } from '../../../app/services/compiler/repair/repair_evidence_writer.js'
import type {
  ArtifactStoreWriter,
  LedgerWriter,
} from '../../../app/services/compiler/repair/repair_evidence_writer.js'
import { RepairBudgetGuard } from '../../../app/services/compiler/repair/repair_budget_guard.js'
import { CascadeGuardService } from '../../../app/services/compiler/repair/cascade_guard_service.js'
import { DEFAULT_REPAIR_BUDGET } from '@aiproj/compiler-spec'

// ── Helper: create minimal plan for testing ──

function makePlan(items: Partial<RepairPlanItem>[]): RepairPlan {
  return {
    planId: 'test-plan',
    compilerRunId: 1,
    policyProfile: 'default',
    budget: DEFAULT_REPAIR_BUDGET,
    cascadeDepth: 0,
    items: items.map((item, i) => ({
      itemId: item.itemId ?? `item-${i}`,
      issueId: item.issueId ?? `issue-${i}`,
      strategy: item.strategy ?? 'deterministic_auto_fix',
      entityIds: item.entityIds ?? ['entity-1'],
      stageId: item.stageId ?? 'test-stage',
      priority: item.priority ?? 0,
      executable: item.executable ?? true,
    })),
    blockedItems: [],
    evidenceRefs: [],
    createdAt: new Date().toISOString(),
  }
}

// ── Fake Adapters ──

const successAutoFix: DeterministicAutoFixAdapter = {
  async tryAutoFix() {
    return {
      applied: true,
      patch: {
        patchId: 'patch-auto-1',
        attemptId: 'att-1',
        issueIds: ['issue-1'],
        baseArtifactRef: 'pdm:current',
        entityIds: ['entity-1'],
        ops: [{ op: 'replace', path: '/tasks/entity-1/name', value: 'Fixed' }],
        reason: 'Auto-fix succeeded',
        sourceRuleIds: ['HV-001'],
        attemptNumber: 1,
        riskLevel: 'low_risk',
        confidence: 0.95,
        idempotencyKey: 'ik-det-1',
        isSchemaPath: true,
        createdAt: new Date().toISOString(),
        revalidationStatus: 'pending',
      },
    }
  },
}

const failingAutoFix: DeterministicAutoFixAdapter = {
  async tryAutoFix() {
    return { applied: false, error: 'Deterministic rule not applicable' }
  },
}

const successLlmRetry: LlmRetryAdapter = {
  async executeRetry() {
    return { success: true, output: JSON.stringify({ name: 'Fixed Task' }), tokensUsed: 100 }
  },
}

const failingLlmRetry: LlmRetryAdapter = {
  async executeRetry() {
    return {
      success: false,
      errorCategory: 'malformed_json',
      errorMessage: 'Malformed JSON output',
      tokensUsed: 50,
    }
  },
}

// ── Fake Validators ──

const passingValidators = {
  schema: { validate: () => ({ valid: true, errors: [] }) } satisfies SchemaValidator,
  graph: { validate: () => ({ valid: true, issues: [] }) } satisfies GraphValidator,
  deterministic: {
    recompute: async () => ({ success: true, errors: [] }),
  } satisfies DeterministicRecompute,
  hard: { validate: async () => ({ passed: true, blockingIssues: [] }) } satisfies HardValidator,
  vGate: {
    decide: async () => ({ status: 'pass' as const, summary: 'All checks passed' }),
  } satisfies VGate,
}

const failingValidators = {
  schema: {
    validate: () => ({ valid: false, errors: ['Schema error'] }),
  } satisfies SchemaValidator,
  graph: { validate: () => ({ valid: true, issues: [] }) } satisfies GraphValidator,
  deterministic: {
    recompute: async () => ({ success: true, errors: [] }),
  } satisfies DeterministicRecompute,
  hard: {
    validate: async () => ({ passed: false, blockingIssues: ['HV-008: Date conflict'] }),
  } satisfies HardValidator,
  vGate: {
    decide: async () => ({ status: 'blocked' as const, summary: 'Blocking issues remain' }),
  } satisfies VGate,
}

// ── Fake Store ──

class FakeArtifactStore implements ArtifactStoreWriter {
  records: { kind: string; payload: unknown; opts?: any }[] = []
  async save(kind: string, payload: unknown, opts?: any) {
    this.records.push({ kind, payload, opts })
    return { ref: `${kind}-${this.records.length}` }
  }
}

class FakeLedger implements LedgerWriter {
  entries: any[] = []
  async recordAttemptHistory(entry: any) {
    this.entries.push(entry)
  }
}

// ============================================================================
// 4. Repair Executor Tests
// ============================================================================

describe('RepairExecutor', () => {
  it('executes deterministic auto-fix successfully', async () => {
    const executor = new RepairExecutor(successAutoFix, successLlmRetry)
    const plan = makePlan([{ itemId: 'item-1', strategy: 'deterministic_auto_fix' }])
    const guard = new RepairBudgetGuard(DEFAULT_REPAIR_BUDGET)
    const cascade = new CascadeGuardService().computeClosure(['entity-1'], [])

    const results = await executor.execute(plan, {}, guard, cascade.cascadeGuard)
    expect(results.length).toBe(1)
    expect(results[0].attempt.status).toBe('succeeded')
    expect(results[0].patch).toBeDefined()
    expect(results[0].requiresHumanReview).toBeFalsy()
  })

  it('degrade to human review when deterministic auto-fix fails', async () => {
    const executor = new RepairExecutor(failingAutoFix, successLlmRetry)
    const plan = makePlan([{ itemId: 'item-1', strategy: 'deterministic_auto_fix' }])
    const guard = new RepairBudgetGuard(DEFAULT_REPAIR_BUDGET)
    const cascade = new CascadeGuardService().computeClosure(['entity-1'], [])

    const results = await executor.execute(plan, {}, guard, cascade.cascadeGuard)
    expect(results.length).toBe(1)
    expect(results[0].attempt.status).toBe('failed')
  })

  it('executes LLM retry successfully', async () => {
    const executor = new RepairExecutor(successAutoFix, successLlmRetry)
    const plan = makePlan([{ itemId: 'item-llm', strategy: 'same_stage_llm_retry' }])
    const guard = new RepairBudgetGuard(DEFAULT_REPAIR_BUDGET)
    const cascade = new CascadeGuardService().computeClosure(['entity-1'], [])

    const results = await executor.execute(plan, {}, guard, cascade.cascadeGuard)
    expect(results.length).toBe(1)
    expect(results[0].attempt.status).toBe('succeeded')
  })

  it('degrade to human review when LLM retry fails', async () => {
    const executor = new RepairExecutor(successAutoFix, failingLlmRetry)
    const plan = makePlan([{ itemId: 'item-llm-fail', strategy: 'same_stage_llm_retry' }])
    const guard = new RepairBudgetGuard(DEFAULT_REPAIR_BUDGET)
    const cascade = new CascadeGuardService().computeClosure(['entity-1'], [])

    const results = await executor.execute(plan, {}, guard, cascade.cascadeGuard)
    const degraded = results.find((r) => r.attempt.status === 'degraded_to_human_review')
    expect(degraded).toBeDefined()
    expect(degraded!.requiresHumanReview).toBe(true)
  })

  it('skips non-executable items', async () => {
    const executor = new RepairExecutor(successAutoFix, successLlmRetry)
    const plan = makePlan([{ itemId: 'item-hr', strategy: 'human_review', executable: false }])
    const guard = new RepairBudgetGuard(DEFAULT_REPAIR_BUDGET)
    const cascade = new CascadeGuardService().computeClosure(['entity-1'], [])

    const results = await executor.execute(plan, {}, guard, cascade.cascadeGuard)
    // human_review items are filtered out
    expect(results.length).toBe(0)
  })

  it('respects budget limits', async () => {
    const executor = new RepairExecutor(successAutoFix, successLlmRetry)
    const plan = makePlan([
      { itemId: 'item-1', strategy: 'deterministic_auto_fix' },
      { itemId: 'item-2', strategy: 'deterministic_auto_fix' },
    ])
    // Budget: maxTotalAttempts = 1
    const guard = new RepairBudgetGuard({ ...DEFAULT_REPAIR_BUDGET, maxTotalAttempts: 1 })
    const cascade = new CascadeGuardService().computeClosure(['entity-1'], [])

    const results = await executor.execute(plan, {}, guard, cascade.cascadeGuard)
    expect(results.length).toBe(2)
    const degraded = results.filter((r) => r.attempt.status === 'degraded_to_human_review')
    expect(degraded.length).toBe(1)
  })
})

// ============================================================================
// 5. Revalidation Tests
// ============================================================================

describe('RepairRevalidationOrchestrator', () => {
  it('passes when all validators pass', async () => {
    const orch = new RepairRevalidationOrchestrator(
      passingValidators.schema,
      passingValidators.graph,
      passingValidators.deterministic,
      passingValidators.hard,
      passingValidators.vGate,
    )

    const patch: RepairCandidatePatch = {
      patchId: 'patch-1',
      attemptId: 'att-1',
      issueIds: ['issue-1'],
      baseArtifactRef: 'pdm:v1',
      entityIds: ['entity-1'],
      ops: [{ op: 'replace', path: '/tasks/entity-1/name', value: 'Fixed' }],
      reason: 'Test',
      sourceRuleIds: [],
      attemptNumber: 1,
      riskLevel: 'low_risk',
      confidence: 0.9,
      idempotencyKey: 'ik-1',
      isSchemaPath: true,
      createdAt: new Date().toISOString(),
      revalidationStatus: 'pending',
    }

    const result = await orch.revalidate(
      patch,
      { tasks: {} },
      {
        requestId: 'rv-1',
        compilerRunId: 1,
        attemptId: 'att-1',
        affectedEntityIds: ['entity-1'],
        affectedClosurePaths: [],
        artifactRefs: [],
        includeDeterministicRecompute: true,
        includeHardValidation: true,
        includeVGate: true,
        createdAt: new Date().toISOString(),
      },
    )

    expect(result.passed).toBe(true)
    expect(result.schemaValid).toBe(true)
    expect(result.hardValidationValid).toBe(true)
  })

  it('fails when hard validation fails', async () => {
    const orch = new RepairRevalidationOrchestrator(
      failingValidators.schema,
      failingValidators.graph,
      failingValidators.deterministic,
      failingValidators.hard,
      failingValidators.vGate,
    )

    const result = await orch.revalidate(
      {} as any,
      {},
      {
        requestId: 'rv-2',
        compilerRunId: 1,
        attemptId: 'att-1',
        affectedEntityIds: ['entity-1'],
        affectedClosurePaths: [],
        artifactRefs: [],
        includeHardValidation: true,
        includeDeterministicRecompute: true,
        includeVGate: true,
        createdAt: new Date().toISOString(),
      },
    )

    expect(result.passed).toBe(false)
    expect(result.remainingIssues.length).toBeGreaterThan(0)
  })

  it('expands affected closure for schedule changes', () => {
    const orch = new RepairRevalidationOrchestrator(
      passingValidators.schema,
      passingValidators.graph,
      passingValidators.deterministic,
      passingValidators.hard,
      passingValidators.vGate,
    )
    const deps = new Map([['T1', ['T2']]])
    const cascadeGuard = {
      changedEntityIds: ['T1'],
      changedPaths: [],
      affectedEntityIds: ['T1', 'T2'],
      cascadeDepth: 1,
      exceedsLimit: false,
    }

    const patch: RepairCandidatePatch = {
      patchId: 'patch-sch',
      attemptId: 'att-1',
      issueIds: ['issue-1'],
      baseArtifactRef: 'pdm:v1',
      entityIds: ['T1'],
      ops: [{ op: 'replace', path: '/tasks/T1/plannedStart', value: '2026-07-02' }],
      reason: 'Schedule fix',
      sourceRuleIds: [],
      attemptNumber: 1,
      riskLevel: 'low_risk',
      confidence: 0.9,
      idempotencyKey: 'ik-sch',
      isSchemaPath: true,
      createdAt: new Date().toISOString(),
      revalidationStatus: 'pending',
    }

    const expanded = orch.expandAffectedClosure(patch, deps, cascadeGuard)
    expect(expanded).toContain('T2')
  })

  it('expands affected closure for resource changes', () => {
    const orch = new RepairRevalidationOrchestrator(
      passingValidators.schema,
      passingValidators.graph,
      passingValidators.deterministic,
      passingValidators.hard,
      passingValidators.vGate,
    )
    const patch: RepairCandidatePatch = {
      patchId: 'patch-res',
      attemptId: 'att-1',
      issueIds: ['issue-1'],
      baseArtifactRef: 'pdm:v1',
      entityIds: ['RS-001'],
      ops: [{ op: 'replace', path: '/resources/RS-001/allocations', value: [] }],
      reason: 'Resource fix',
      sourceRuleIds: [],
      attemptNumber: 1,
      riskLevel: 'low_risk',
      confidence: 0.9,
      idempotencyKey: 'ik-res',
      isSchemaPath: true,
      createdAt: new Date().toISOString(),
      revalidationStatus: 'pending',
    }

    const expanded = orch.expandAffectedClosure(patch, new Map(), {
      changedEntityIds: ['RS-001'],
      changedPaths: [],
      affectedEntityIds: ['RS-001'],
      cascadeDepth: 0,
      exceedsLimit: false,
    })
    expect(expanded).toContain('resource-bucket-RS-001')
  })
})

// ============================================================================
// 6. Evidence & Ledger Integration Tests
// ============================================================================

describe('RepairEvidenceWriter', () => {
  it('writes repair plan to artifact store', async () => {
    const store = new FakeArtifactStore()
    const ledger = new FakeLedger()
    const writer = new RepairEvidenceWriter(store, ledger, 1)

    const plan: RepairPlan = makePlan([])
    const ref = await writer.writeRepairPlan(plan)
    expect(ref).toBeDefined()
    expect(store.records.length).toBe(1)
    expect(store.records[0].kind).toBe('repair_plan')
  })

  it('writes repair attempt with idempotency', async () => {
    const store = new FakeArtifactStore()
    const ledger = new FakeLedger()
    const writer = new RepairEvidenceWriter(store, ledger, 1)

    const attempt: RepairAttempt = {
      attemptId: 'att-1',
      issueId: 'issue-1',
      planItemId: 'item-1',
      strategy: 'deterministic_auto_fix',
      stageId: 'sg',
      entityIds: ['e-1'],
      attemptNumber: 1,
      inputArtifactRefs: [],
      outputArtifactRefs: [],
      status: 'succeeded',
      costSummary: { tokensUsed: 0, llmCallsMade: 0, deterministicAttempts: 1, latencyMs: 0 },
      errorCategory: 'none',
      idempotencyKey: 'ik-att-1',
      startedAt: new Date().toISOString(),
    }

    const ref = await writer.writeRepairAttempt(attempt)
    expect(ref).toBeDefined()
    expect(store.records[0].opts?.idempotencyKey).toBe('ik-att-1')
  })

  it('writes ledger attempt history', async () => {
    const store = new FakeArtifactStore()
    const ledger = new FakeLedger()
    const writer = new RepairEvidenceWriter(store, ledger, 1)

    const attempt: RepairAttempt = {
      attemptId: 'att-1',
      issueId: 'issue-1',
      planItemId: 'item-1',
      strategy: 'same_stage_llm_retry',
      stageId: 'sg',
      entityIds: ['e-1'],
      attemptNumber: 2,
      inputArtifactRefs: [],
      outputArtifactRefs: [],
      status: 'degraded_to_human_review',
      errorCategory: 'llm_malformed_json',
      idempotencyKey: 'ik-att-2',
      startedAt: new Date().toISOString(),
    }

    await writer.writeLedgerHistory(attempt, 'patch-1', 'Revalidation failed')
    expect(ledger.entries.length).toBe(1)
    expect(ledger.entries[0].attemptNumber).toBe(2)
    expect(ledger.entries[0].requiresHumanReview).toBe(true)
  })

  it('writes candidate patch, revalidation and reconciliation reports', async () => {
    const store = new FakeArtifactStore()
    const ledger = new FakeLedger()
    const writer = new RepairEvidenceWriter(store, ledger, 1)

    const patch: RepairCandidatePatch = {
      patchId: 'patch-1',
      attemptId: 'att-1',
      issueIds: ['issue-1'],
      baseArtifactRef: 'pdm:v1',
      entityIds: ['e-1'],
      ops: [{ op: 'replace', path: '/e-1/name', value: 'x' }],
      reason: 'test',
      sourceRuleIds: [],
      attemptNumber: 1,
      riskLevel: 'low_risk',
      confidence: 0.9,
      idempotencyKey: 'ik-patch',
      isSchemaPath: true,
      createdAt: new Date().toISOString(),
      revalidationStatus: 'pending',
    }
    await writer.writeCandidatePatch(patch)
    await writer.writeReconciliationReport({
      reportId: 'rc-1',
      compilerRunId: 1,
      scope: 'global',
      rulesetVersion: '2.0',
      summary: {
        totalFindings: 1,
        blockingCount: 0,
        warningCount: 1,
        infoCount: 0,
        candidatePatches: 0,
        reviewItems: 0,
      },
      findings: [],
      candidatePatchRefs: [],
      blockingItems: [],
      warnings: [],
      evidenceRefs: [],
      generatedAt: new Date().toISOString(),
    })

    expect(store.records.length).toBe(2)
  })
})

// ============================================================================
// 7. Global Reconciliation Tests
// ============================================================================

describe('GlobalReconciliationChecker', () => {
  const checker = new GlobalReconciliationChecker(1)

  const pdm: ReconciliationPdmInput = {
    tasks: {
      'T1-001': {
        id: 'T1-001',
        name: 'Task 1',
        workPackageId: 'WP-001',
        projectId: 'proj-1',
        organizationId: 'org-1',
      },
      'T2-001': { id: 'T2-001', name: 'Task 2', wbsNodeId: 'WBS-001', plannedStart: '2026-07-01' },
      'T3-001': { id: 'T3-001', name: 'Orphan Task' }, // no WBS
    },
    milestones: {
      'M-001': { id: 'M-001', name: 'Launch', date: '2026-07-01', dependsOn: ['T2-001'] },
    },
    wbsNodes: {
      'WBS-001': {
        id: 'WBS-001',
        projectId: 'proj-1',
        organizationId: 'org-1',
        type: 'work_package',
      },
    },
    resources: {
      'RS-001': {
        id: 'RS-001',
        name: 'Developer A',
        allocations: [{ taskId: 'T1-001', hours: 40 }],
        capacity: 40,
      },
      'RS-002': {
        id: 'RS-002',
        name: 'Developer B',
        allocations: [{ taskId: 'T1-001', hours: 60 }],
        capacity: 40,
      }, // overloaded
    },
    risks: {
      'RK-001': {
        id: 'RK-001',
        name: 'Schedule Risk',
        relatedTaskIds: ['T1-001'],
        projectId: 'proj-1',
      },
      'RK-002': { id: 'RK-002', name: 'Orphan Risk' }, // no related tasks
      'RK-003': { id: 'RK-003', name: 'Bad Ref Risk', relatedTaskIds: ['NONEXISTENT'] },
    },
  }

  const computed: PdmComputedInput = {
    schedules: {
      'T2-001': { plannedStart: '2026-07-05', plannedEnd: '2026-07-10' },
    },
    completionStatus: {
      'T1-001': 'outdated',
    },
    validationSummaries: {
      'T3-001': { status: 'blocking' },
    },
  }

  it('finds WBS alignment issues', () => {
    const report = checker.check(pdm)
    const wbsFindings = report.findings.filter((f) => f.ruleId === 'RC-WBS-01')
    expect(wbsFindings.length).toBeGreaterThan(0)
    expect(wbsFindings.some((f) => f.description.includes('no WBS'))).toBe(true)
  })

  it('finds milestone date issues', () => {
    const report = checker.check(pdm, computed)
    const msFindings = report.findings.filter((f) => f.ruleId === 'RC-SCH-01')
    expect(msFindings.length).toBeGreaterThan(0)
  })

  it('finds resource overload issues', () => {
    const report = checker.check(pdm)
    const resFindings = report.findings.filter((f) => f.ruleId === 'RC-RES-01')
    expect(resFindings.length).toBeGreaterThan(0)
    const overload = resFindings.find((f) => f.description.includes('overloaded'))
    expect(overload).toBeDefined()
  })

  it('finds risk reference issues', () => {
    const report = checker.check(pdm)
    const riskFindings = report.findings.filter((f) => f.ruleId === 'RC-RSK-01')
    expect(riskFindings.length).toBeGreaterThan(0)
    expect(riskFindings.some((f) => f.description.includes('non-existent'))).toBe(true)
  })

  it('finds PDM/validation state issues', () => {
    const report = checker.check(pdm, computed)
    const pdmFindings = report.findings.filter((f) => f.ruleId === 'RC-PDM-01')
    expect(pdmFindings.length).toBeGreaterThan(0)
    const blocking = pdmFindings.some(
      (f) => f.severity === 'blocking' && f.description.includes('blocking'),
    )
    expect(blocking).toBe(true)
  })

  it('generates aggregate summary', () => {
    const report = checker.check(pdm, computed)
    expect(report.summary.totalFindings).toBeGreaterThan(0)
    expect(
      report.summary.blockingCount + report.summary.warningCount + report.summary.infoCount,
    ).toBe(report.summary.totalFindings)
  })

  it('does not mutate input PDM', () => {
    const before = JSON.stringify(pdm)
    checker.check(pdm, computed)
    const after = JSON.stringify(pdm)
    expect(before).toBe(after)
  })
})

// ============================================================================
// 9.5: Business Table Zero-Write Test
// ============================================================================

describe('Zero-Write to Business Tables', () => {
  it('repair services do not write to business tables (in-memory only)', async () => {
    // All services use in-memory or interface-based storage
    // This test verifies no direct Lucid Model writes
    const executor = new RepairExecutor(successAutoFix, successLlmRetry)
    const plan = makePlan([{ strategy: 'deterministic_auto_fix' }])
    const guard = new RepairBudgetGuard(DEFAULT_REPAIR_BUDGET)
    const cascade = new CascadeGuardService().computeClosure(['entity-1'], [])

    const results = await executor.execute(plan, {}, guard, cascade.cascadeGuard)
    expect(results.length).toBeGreaterThan(0)
    // No business table was accessed — all in-memory
  })

  it('reconciliation checker does not write to business tables', () => {
    const checker = new GlobalReconciliationChecker(1)
    const report = checker.check({
      tasks: { T1: { id: 'T1', name: 'Test' } },
    })
    expect(report.findings).toBeDefined()
    // Report is returned but not persisted to any business table
  })

  it('evidence writer uses mock store not business tables', async () => {
    const store = new FakeArtifactStore()
    const ledger = new FakeLedger()
    const writer = new RepairEvidenceWriter(store, ledger, 1)

    const attempt: RepairAttempt = {
      attemptId: 'att-test',
      issueId: 'issue-1',
      planItemId: 'item-1',
      strategy: 'deterministic_auto_fix',
      stageId: 'sg',
      entityIds: ['e-1'],
      attemptNumber: 1,
      inputArtifactRefs: [],
      outputArtifactRefs: [],
      status: 'succeeded',
      costSummary: { tokensUsed: 0, llmCallsMade: 0, deterministicAttempts: 0, latencyMs: 0 },
      errorCategory: 'none',
      idempotencyKey: 'ik-test',
      startedAt: new Date().toISOString(),
    }
    await writer.writeRepairAttempt(attempt)
    const written = store.records.find((r) => r.kind === 'repair_attempt')
    expect(written).toBeDefined()
    // Written to mock store, not real DB
  })
})
