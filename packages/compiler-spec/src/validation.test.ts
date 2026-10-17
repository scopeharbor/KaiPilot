/**
 * @aiproj/compiler-spec —— Validation 套件单元测试。
 *
 * 覆盖（tasks 1.6）：
 * - HardValidationReport schema（unknown fields、not_applicable、状态枚举）
 * - SoftEvaluationReport schema（unanchored finding、cost summary）
 * - VGateDecision schema（决策状态枚举、repair suggestion）
 * - ValidationLedgerEvidence schema
 * - HV rule registry 常量
 * - SE dimension registry 常量
 * - 测试夹具（valid PDM、依赖环、缺失 input、warning-only、Soft 低分、Soft unavailable、预算耗尽）
 */
import { describe, expect, it } from 'vitest'
import {
  v2HardValidationReportSchema,
  softEvaluationReportSchema,
  vGateDecisionSchema,
  validationLedgerEvidenceSchema,
  hardRuleRegistryEntrySchema,
  softDimensionRegistryEntrySchema,
  evaluationProfileSchema,
  costAndLatencySummarySchema,
  validationInputContextSchema,
  HV_RULE_IDS,
  SE_DIMENSION_IDS,
} from './index.js'

// ============================================================================
// 测试夹具
// ============================================================================

/** 夹具 1：有效的 Hard Validation Report。 */
const validHardReport = {
  validationId: 'hv-20260711-001',
  stageId: 'blueprint_gate',
  pdmSnapshotId: 'pdm-snap-001',
  rulesetVersion: '1.0',
  summary: {
    totalRules: 25,
    passed: 20,
    blocking: 1,
    warnings: 2,
    infos: 1,
    notApplicable: 1,
    inputMissing: 0,
  },
  issues: [
    {
      ruleId: 'HV-008',
      severity: 'blocking',
      category: 'structure',
      path: '/dependencies',
      message: '依赖环路检测失败：任务 T1 → T2 → T3 → T1',
      affectedEntityIds: ['T1task_a_abc123', 'T2task_b_def456', 'T3task_c_ghi789'],
      autoFixable: false,
      requiresHumanReview: true,
      sourceStageId: 'deterministic_graph_validation',
      evidence: 'Graph validation 返回 cycle detected',
    },
    {
      ruleId: 'HV-011',
      severity: 'warning',
      category: 'date_schedule',
      path: '/schedule/T4task_d',
      message: '任务结束日期早于开始日期',
      affectedEntityIds: ['T4task_d_jkl012'],
      autoFixable: true,
      requiresHumanReview: false,
      sourceStageId: 'deterministic_schedule',
      evidence: 'plannedEnd < plannedStart',
    },
  ],
  notApplicableRules: [
    {
      ruleId: 'HV-017',
      reason: '当前 PDM 未启用 progress 字段',
      category: 'numeric',
    },
  ],
  inputSignature: {
    schemaParsed: true,
    graphAvailable: true,
    scheduleAvailable: true,
    criticalPathAvailable: true,
    resourceLoadAvailable: false,
    diffAvailable: true,
    stageMetadataAvailable: true,
    pdmSnapshotId: 'pdm-snap-001',
  },
  isFullValidation: true,
  skippedRules: [],
  generatedAt: '2026-07-11T00:00:00.000Z',
}

/** 夹具 2：依赖环（blocking-only）。 */
const cycleHardReport = {
  ...validHardReport,
  validationId: 'hv-cycle-001',
  summary: { ...validHardReport.summary, blocking: 2, warnings: 0 },
  issues: [
    {
      ruleId: 'HV-008',
      severity: 'blocking',
      category: 'structure',
      path: '/dependencies',
      message: '依赖环路检测失败',
      affectedEntityIds: ['T1a', 'T2b', 'T3c'],
      autoFixable: false,
      requiresHumanReview: true,
      sourceStageId: 'deterministic_graph_validation',
      evidence: 'Cycle: T1a → T2b → T3c → T1a',
    },
  ],
  generatedAt: '2026-07-11T00:00:00.000Z',
}

/** 夹具 3：缺少 deterministic input。 */
const missingInputReport = {
  ...validHardReport,
  validationId: 'hv-missing-input-001',
  summary: { ...validHardReport.summary, passed: 15, inputMissing: 5 },
  inputSignature: {
    schemaParsed: true,
    graphAvailable: true,
    scheduleAvailable: false,
    criticalPathAvailable: false,
    resourceLoadAvailable: false,
    diffAvailable: false,
    stageMetadataAvailable: true,
  },
  generatedAt: '2026-07-11T00:00:00.000Z',
}

/** 夹具 4：Hard warning-only（no blocking）。 */
const warningOnlyReport = {
  ...validHardReport,
  validationId: 'hv-warning-001',
  summary: { ...validHardReport.summary, blocking: 0, warnings: 3 },
  issues: [
    {
      ruleId: 'HV-019',
      severity: 'warning',
      category: 'resource',
      path: '/resources/RSuser1',
      message: '资源 RSuser1 在 2026-07-15 超载 120%',
      affectedEntityIds: ['RSuser1_mno345'],
      autoFixable: false,
      requiresHumanReview: true,
      sourceStageId: 'deterministic_resource_load',
      evidence: 'Resource load: 12h assigned / 8h capacity',
    },
  ],
  generatedAt: '2026-07-11T00:00:00.000Z',
}

/** 夹具 5：Soft 低分报告。 */
const lowScoreSoftReport = {
  evaluationId: 'se-20260711-001',
  profile: {
    profileId: 'wbs_gate',
    name: 'WBS Gate Profile',
    dimensionIds: ['SE-WBS-01', 'SE-WBS-02', 'SE-DEL-01'],
    weightOverrides: {},
    thresholdOverrides: {},
    budgetTokens: 50000,
    budgetCalls: 10,
    maxRetriesPerDimension: 2,
    enabledByDefault: false,
    description: 'WBS 输出验证关卡',
  },
  model: 'deepseek-v4-flash',
  dimensionsEvaluated: ['SE-WBS-01', 'SE-WBS-02', 'SE-DEL-01'],
  overallScore: 2.7,
  weightedScore: 2.5,
  status: 'completed',
  dimensionScores: [
    {
      dimensionId: 'SE-WBS-01',
      score: 4,
      confidence: 0.85,
      rationale: 'WBS 分解覆盖了主要工作包',
      findings: [],
      status: 'evaluated',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      tokensUsed: 500,
      latencyMs: 1200,
      retryCount: 0,
    },
    {
      dimensionId: 'SE-WBS-02',
      score: 2,
      confidence: 0.6,
      rationale: '部分任务粒度不一致，某些 L2 任务跨越 3 周',
      findings: [
        {
          findingId: 'f-001',
          description: '任务 T2x 包含 15 个子任务，跨度 3 周，建议拆分',
          severity: 'warning',
          affectedEntityIds: ['T2x_task_large_pqr678'],
          unanchored: false,
          evidenceSnippet: 'T2x: 3 周 duration, 15 子任务',
          suggestedReviewAction: '考虑将 T2x 拆分为多个小任务',
          confidence: 0.7,
        },
      ],
      status: 'evaluated',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      tokensUsed: 800,
      latencyMs: 1500,
      retryCount: 0,
    },
    {
      dimensionId: 'SE-DEL-01',
      score: 2,
      confidence: 0.5,
      rationale: '交付物验收标准不够可度量',
      findings: [
        {
          findingId: 'f-002',
          description: '交付物 D1 验收标准不具体',
          severity: 'warning',
          affectedEntityIds: [],
          unanchored: true,
          evidenceSnippet: 'D1 acceptance criteria vague',
          suggestedReviewAction: '补充具体可度量标准',
          confidence: 0.5,
        },
      ],
      status: 'evaluated',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      tokensUsed: 600,
      latencyMs: 1100,
      retryCount: 0,
    },
  ],
  confidence: 0.65,
  costAndLatencySummary: {
    totalCalls: 3,
    totalTokens: 1900,
    totalLatencyMs: 3800,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    dimensionCount: 3,
    retryCount: 0,
    budgetStatus: 'within_budget',
    budgetLimitTokens: 50000,
    budgetLimitCalls: 10,
  },
  generatedAt: '2026-07-11T00:00:00.000Z',
}

/** 夹具 6：Soft unavailable 报告。 */
const unavailableSoftReport = {
  evaluationId: 'se-unavailable-001',
  profile: {
    profileId: 'wbs_gate',
    name: 'WBS Gate Profile',
    dimensionIds: ['SE-WBS-01', 'SE-WBS-02', 'SE-DEL-01'],
    weightOverrides: {},
    thresholdOverrides: {},
    budgetTokens: 50000,
    budgetCalls: 10,
    maxRetriesPerDimension: 2,
    enabledByDefault: false,
    description: 'WBS 输出验证关卡',
  },
  model: 'deepseek-v4-flash',
  dimensionsEvaluated: ['SE-WBS-01'],
  status: 'all_unavailable' as const,
  dimensionScores: [
    {
      dimensionId: 'SE-WBS-01',
      score: 0,
      confidence: 0,
      rationale: '模型调用失败',
      findings: [],
      status: 'unavailable',
      unavailableReason: 'provider_error: timeout after 30s',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      tokensUsed: 0,
      latencyMs: 30000,
      retryCount: 2,
    },
  ],
  costAndLatencySummary: {
    totalCalls: 3,
    totalTokens: 0,
    totalLatencyMs: 90000,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    dimensionCount: 1,
    retryCount: 2,
    budgetStatus: 'within_budget',
    budgetLimitTokens: 50000,
    budgetLimitCalls: 10,
  },
  generatedAt: '2026-07-11T00:00:00.000Z',
}

/** 夹具 7：预算耗尽报告。 */
const budgetExceededSoftReport = {
  evaluationId: 'se-budget-001',
  profile: {
    profileId: 'wbs_gate',
    name: 'WBS Gate Profile',
    dimensionIds: ['SE-WBS-01', 'SE-WBS-02', 'SE-DEL-01'],
    weightOverrides: {},
    thresholdOverrides: {},
    budgetTokens: 50000,
    budgetCalls: 10,
    maxRetriesPerDimension: 2,
    enabledByDefault: false,
    description: 'WBS 输出验证关卡',
  },
  model: 'deepseek-v4-flash',
  dimensionsEvaluated: ['SE-WBS-01', 'SE-WBS-02'],
  overallScore: 2.0,
  weightedScore: 1.8,
  status: 'budget_exceeded' as const,
  dimensionScores: [
    {
      dimensionId: 'SE-WBS-01',
      score: 4,
      confidence: 0.85,
      rationale: 'WBS 分解良好',
      findings: [],
      status: 'evaluated',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      tokensUsed: 500,
      latencyMs: 1200,
      retryCount: 0,
    },
    {
      dimensionId: 'SE-WBS-02',
      score: 0,
      confidence: 0,
      rationale: '预算耗尽未能评估',
      findings: [],
      status: 'unavailable',
      unavailableReason: 'budget_exceeded',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      tokensUsed: 0,
      latencyMs: 0,
      retryCount: 0,
    },
  ],
  confidence: 0.85,
  costAndLatencySummary: {
    totalCalls: 5,
    totalTokens: 55000,
    totalLatencyMs: 6000,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    dimensionCount: 2,
    retryCount: 1,
    budgetStatus: 'budget_exceeded',
    budgetLimitTokens: 50000,
    budgetLimitCalls: 10,
  },
  generatedAt: '2026-07-11T00:00:00.000Z',
}

/** 夹具 8：V-Gate decision blocked。 */
const vGateBlocked = {
  decisionId: 'vg-blocked-001',
  stageId: 'blueprint_gate',
  profileId: 'blueprint_gate',
  status: 'blocked',
  blockingReasons: ['HV-008: 依赖环路检测失败'],
  warnings: [],
  attentionAreas: [],
  requiresHumanReview: true,
  allowedNextActions: ['fix_blocking_issues', 'request_human_review'],
  evidenceRefs: ['ev-hv-20260711-001'],
  hardSummary: { totalBlocking: 1, totalWarnings: 0, passed: false },
  generatedAt: '2026-07-11T00:00:00.000Z',
}

/** 夹具 9：V-Gate decision conditional_pass。 */
const vGateConditionalPass = {
  decisionId: 'vg-conditional-001',
  stageId: 'wbs_gate',
  profileId: 'wbs_gate',
  status: 'conditional_pass',
  blockingReasons: [],
  warnings: ['Soft weightedScore 2.5 低于阈值 3.0'],
  attentionAreas: [
    { area: 'SE-WBS-02', description: '任务粒度不一致', severity: 'warning' },
    { area: 'SE-DEL-01', description: '交付物验收标准不具体', severity: 'attention' },
  ],
  requiresHumanReview: true,
  allowedNextActions: ['proceed_to_preview', 'address_soft_concerns', 'request_human_review'],
  evidenceRefs: ['ev-hv-001', 'ev-se-001'],
  hardSummary: { totalBlocking: 0, totalWarnings: 0, passed: true },
  softSummary: {
    overallScore: 2.7,
    weightedScore: 2.5,
    dimensionsEvaluated: 3,
    status: 'completed',
  },
  repairSuggestions: [
    {
      suggestionId: 'rep-001',
      dimensionId: 'SE-WBS-02',
      description: 'T2x 任务粒度过大',
      suggestedAction: '将 T2x 拆分为多个子任务',
      affectedEntityIds: ['T2x_task_large_pqr678'],
      priority: 'high',
    },
  ],
  generatedAt: '2026-07-11T00:00:00.000Z',
}

// ============================================================================
// 测试套件
// ============================================================================

describe('hardRuleRegistryEntrySchema', () => {
  it('合法规则条目通过', () => {
    const entry = {
      ruleId: 'HV-001',
      name: 'PDM Schema Parse 完整',
      category: 'schema_parse' as const,
      description: '验证 PDM 是否按 schema 完整解析',
      defaultSeverity: 'blocking' as const,
      applicableProfiles: ['all'],
      requiredInputs: ['pdm_schema_parse'],
      implementationId: 'impl-schema-parse',
      sourceRuleIds: [],
      autoFixable: false,
      requiresHumanReview: false,
    }
    expect(hardRuleRegistryEntrySchema.safeParse(entry).success).toBe(true)
  })

  it('聚合实现包含 sourceRuleIds', () => {
    const aggregated = {
      ruleId: 'HV-007',
      name: '层级完整性',
      category: 'structure' as const,
      description: '层级 gap/orphan 检测',
      defaultSeverity: 'blocking' as const,
      applicableProfiles: ['all'],
      requiredInputs: ['pdm_snapshot'],
      implementationId: 'impl-hierarchy',
      sourceRuleIds: ['HV-007', 'HV-009'],
      autoFixable: true,
      requiresHumanReview: false,
    }
    const parsed = hardRuleRegistryEntrySchema.safeParse(aggregated)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.sourceRuleIds).toHaveLength(2)
    }
  })

  it('缺少必填字段失败', () => {
    expect(hardRuleRegistryEntrySchema.safeParse({}).success).toBe(false)
  })
})

describe('v2HardValidationReportSchema', () => {
  it('有效报告通过解析', () => {
    const parsed = v2HardValidationReportSchema.safeParse(validHardReport)
    expect(parsed.success).toBe(true)
  })

  it('unknown fields 被剥离（strip）', () => {
    const withUnknown = { ...validHardReport, unknownField: 'should_be_stripped' }
    const parsed = v2HardValidationReportSchema.safeParse(withUnknown)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect((parsed.data as any).unknownField).toBeUndefined()
    }
  })

  it('not_applicable 规则有原因', () => {
    const parsed = v2HardValidationReportSchema.safeParse(validHardReport)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.notApplicableRules).toHaveLength(1)
      expect(parsed.data.notApplicableRules[0].reason).toContain('未启用')
    }
  })

  it('summary 统计正确', () => {
    const parsed = v2HardValidationReportSchema.safeParse(validHardReport)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.summary.blocking).toBe(1)
      expect(parsed.data.summary.warnings).toBe(2)
    }
  })

  it('依赖环报告', () => {
    const parsed = v2HardValidationReportSchema.safeParse(cycleHardReport)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.issues[0].ruleId).toBe('HV-008')
    }
  })

  it('缺失 input 报告', () => {
    const parsed = v2HardValidationReportSchema.safeParse(missingInputReport)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.inputSignature.scheduleAvailable).toBe(false)
      expect(parsed.data.summary.inputMissing).toBe(5)
    }
  })

  it('warning-only 报告', () => {
    const parsed = v2HardValidationReportSchema.safeParse(warningOnlyReport)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.summary.blocking).toBe(0)
      expect(parsed.data.issues[0].severity).toBe('warning')
    }
  })

  it('缺少必填字段失败', () => {
    expect(v2HardValidationReportSchema.safeParse({}).success).toBe(false)
  })
})

describe('softEvaluationReportSchema', () => {
  it('有效低分报告通过解析', () => {
    const parsed = softEvaluationReportSchema.safeParse(lowScoreSoftReport)
    expect(parsed.success).toBe(true)
  })

  it('unanchored finding 被标记', () => {
    const parsed = softEvaluationReportSchema.safeParse(lowScoreSoftReport)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      const delFindings = parsed.data.dimensionScores.find(
        (d) => d.dimensionId === 'SE-DEL-01',
      )?.findings
      expect(delFindings).toBeDefined()
      expect(delFindings![0].unanchored).toBe(true)
    }
  })

  it('costAndLatencySummary 结构完整', () => {
    const parsed = softEvaluationReportSchema.safeParse(lowScoreSoftReport)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      const c = parsed.data.costAndLatencySummary
      expect(c.totalCalls).toBe(3)
      expect(c.totalTokens).toBe(1900)
      expect(c.budgetStatus).toBe('within_budget')
    }
  })

  it('Soft unavailable 报告', () => {
    const parsed = softEvaluationReportSchema.safeParse(unavailableSoftReport)
    if (!parsed.success) {
      throw new Error('ZOD_ERROR: ' + JSON.stringify(parsed.error.issues, null, 2))
    }
    expect(parsed.data.status).toBe('all_unavailable')
    expect(parsed.data.dimensionScores[0].status).toBe('unavailable')
    expect(parsed.data.dimensionScores[0].unavailableReason).toContain('provider_error')
  })

  it('预算耗尽报告', () => {
    const parsed = softEvaluationReportSchema.safeParse(budgetExceededSoftReport)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.status).toBe('budget_exceeded')
      expect(parsed.data.costAndLatencySummary.budgetStatus).toBe('budget_exceeded')
    }
  })

  it('unknown fields 被剥离', () => {
    const withUnknown = { ...lowScoreSoftReport, extra: 'should_be_stripped' }
    const parsed = softEvaluationReportSchema.safeParse(withUnknown)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect((parsed.data as any).extra).toBeUndefined()
    }
  })
})

describe('vGateDecisionSchema', () => {
  it('blocked 决策通过解析', () => {
    const parsed = vGateDecisionSchema.safeParse(vGateBlocked)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.status).toBe('blocked')
      expect(parsed.data.blockingReasons).toHaveLength(1)
      expect(parsed.data.requiresHumanReview).toBe(true)
    }
  })

  it('conditional_pass 决策有 attentionAreas', () => {
    const parsed = vGateDecisionSchema.safeParse(vGateConditionalPass)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.status).toBe('conditional_pass')
      expect(parsed.data.attentionAreas).toHaveLength(2)
      expect(parsed.data.repairSuggestions).toHaveLength(1)
      expect(parsed.data.softSummary).toBeDefined()
      expect(parsed.data.softSummary!.weightedScore).toBe(2.5)
    }
  })

  it('决策状态枚举完整', () => {
    const statuses = ['pass', 'conditional_pass', 'blocked', 'awaiting_review'] as const
    for (const s of statuses) {
      const d = { ...vGateBlocked, decisionId: `test-${s}`, status: s }
      const parsed = vGateDecisionSchema.safeParse(d)
      expect(parsed.success).toBe(true)
    }
  })

  it('非法决策状态失败', () => {
    const d = { ...vGateBlocked, status: 'invalid_status' }
    expect(vGateDecisionSchema.safeParse(d).success).toBe(false)
  })

  it('repair suggestion 只保存为 candidate', () => {
    const parsed = vGateDecisionSchema.safeParse(vGateConditionalPass)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.repairSuggestions[0].suggestionId).toBe('rep-001')
      expect(parsed.data.repairSuggestions[0].priority).toBe('high')
    }
  })
})

describe('validationLedgerEvidenceSchema', () => {
  it('V-Gate 完成证据', () => {
    const evidence = {
      evidenceId: 'ev-vg-001',
      stageId: 'wbs_gate',
      evidenceType: 'v_gate_decision' as const,
      inputSignature: { profileId: 'wbs_gate' },
      rulesetVersion: '1.0',
      registryVersion: '1.0',
      outputSummary: { status: 'conditional_pass' },
      costSummary: { tokensUsed: 1900, callsMade: 3, latencyMs: 3800 },
      generatedAt: '2026-07-11T00:00:00.000Z',
    }
    expect(validationLedgerEvidenceSchema.safeParse(evidence).success).toBe(true)
  })

  it('评估跳过证据有 reason', () => {
    const skipped = {
      evidenceId: 'ev-skip-001',
      stageId: 'requirements_gate',
      evidenceType: 'soft_evaluation_skipped' as const,
      inputSignature: {},
      rulesetVersion: '1.0',
      registryVersion: '1.0',
      outputSummary: {},
      costSummary: { tokensUsed: 0, callsMade: 0, latencyMs: 0 },
      skippedReason: 'Profile not enabled for this stage',
      generatedAt: '2026-07-11T00:00:00.000Z',
    }
    const parsed = validationLedgerEvidenceSchema.safeParse(skipped)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.skippedReason).toContain('Profile not enabled')
    }
  })

  it('预算耗尽证据有 degraded reason', () => {
    const degraded = {
      evidenceId: 'ev-budget-001',
      stageId: 'wbs_gate',
      evidenceType: 'budget_exceeded' as const,
      inputSignature: {},
      rulesetVersion: '1.0',
      registryVersion: '1.0',
      outputSummary: { dimensionsCompleted: 2, dimensionsTotal: 3 },
      costSummary: { tokensUsed: 55000, callsMade: 5, latencyMs: 6000 },
      degradedReason: 'Token budget 50000 exceeded at 55000',
      generatedAt: '2026-07-11T00:00:00.000Z',
    }
    const parsed = validationLedgerEvidenceSchema.safeParse(degraded)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.degradedReason).toContain('budget')
    }
  })
})

describe('costAndLatencySummarySchema', () => {
  it('合法摘要通过', () => {
    const c = {
      totalCalls: 5,
      totalTokens: 10000,
      totalLatencyMs: 15000,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      dimensionCount: 3,
      retryCount: 2,
      budgetStatus: 'within_budget' as const,
      budgetLimitTokens: 50000,
      budgetLimitCalls: 10,
    }
    expect(costAndLatencySummarySchema.safeParse(c).success).toBe(true)
  })

  it('预算耗尽状态', () => {
    const c = {
      totalCalls: 10,
      totalTokens: 60000,
      totalLatencyMs: 20000,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      dimensionCount: 5,
      retryCount: 3,
      budgetStatus: 'budget_exceeded' as const,
      budgetLimitTokens: 50000,
      budgetLimitCalls: 10,
    }
    expect(costAndLatencySummarySchema.safeParse(c).success).toBe(true)
  })
})

describe('HV_RULE_IDS 常量', () => {
  it('包含 HV-001~HV-025', () => {
    const ids = Object.values(HV_RULE_IDS)
    expect(ids).toHaveLength(25)
    expect(ids).toContain('HV-001')
    expect(ids).toContain('HV-025')
  })

  it('无重复 ID', () => {
    const ids = Object.values(HV_RULE_IDS)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('SE_DIMENSION_IDS 常量', () => {
  it('包含 SE-WBS-01~SE-COMM-01 共 17 维', () => {
    const ids = Object.values(SE_DIMENSION_IDS)
    expect(ids).toHaveLength(17)
    expect(ids).toContain('SE-WBS-01')
    expect(ids).toContain('SE-COMM-01')
  })

  it('无重复 ID', () => {
    const ids = Object.values(SE_DIMENSION_IDS)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('evaluationProfileSchema', () => {
  it('合法 profile 通过', () => {
    const p = {
      profileId: 'wbs_gate',
      name: 'WBS Gate Profile',
      dimensionIds: ['SE-WBS-01', 'SE-WBS-02', 'SE-DEL-01', 'SE-RISK-01'],
      weightOverrides: { 'SE-WBS-01': 0.4, 'SE-WBS-02': 0.3 },
      thresholdOverrides: { 'SE-DEL-01': 4 },
      budgetTokens: 50000,
      budgetCalls: 10,
      maxRetriesPerDimension: 2,
      enabledByDefault: false,
      description: 'WBS 输出验证关卡',
    }
    expect(evaluationProfileSchema.safeParse(p).success).toBe(true)
  })

  it('默认值正确', () => {
    const minimal = {
      profileId: 'minimal',
      name: 'Minimal',
      dimensionIds: ['SE-WBS-01'],
    }
    const parsed = evaluationProfileSchema.safeParse(minimal)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.maxRetriesPerDimension).toBe(2)
      expect(parsed.data.enabledByDefault).toBe(false)
    }
  })
})

describe('validationInputContextSchema', () => {
  it('最小上下文通过', () => {
    const ctx = {
      stageId: 'blueprint_gate',
      profileId: 'global_sample',
    }
    expect(validationInputContextSchema.safeParse(ctx).success).toBe(true)
  })

  it('完整上下文通过', () => {
    const ctx = {
      pdmSnapshotId: 'snap-001',
      pdmSnapshot: { tasks: [] },
      stageId: 'wbs_gate',
      stageName: 'WBS Gate',
      deterministicOutputs: {
        graphValidation: { passed: true },
        schedule: { scheduled: {} },
      },
      profileId: 'wbs_gate',
      organizationId: 'org-1',
      runId: 'run-001',
      isIncremental: true,
      changedPaths: ['/tasks/T1/description'],
      changedEntityIds: ['T1task_a'],
    }
    expect(validationInputContextSchema.safeParse(ctx).success).toBe(true)
  })
})
