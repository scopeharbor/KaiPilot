// @aiproj/types — V3 多项目影响分析共享 fixture（§2.6）
// 覆盖：可见链路、隐藏链路、buffer 吸收、跨组织拒绝、stale、what-if、AI unavailable、feature-disabled

import type {
  MultiProjectImpactScope,
  MultiProjectImpactSourceRef,
  MultiProjectImpactPlan,
  MultiProjectImpactSnapshot,
  MultiProjectImpactPropagationPath,
  MultiProjectImpactAffectedEndpoint,
  MultiProjectImpactWhatIfScenario,
  MultiProjectImpactWhatIfOutput,
  MultiProjectImpactFollowUpDraft,
  MultiProjectImpactWarning,
  MultiProjectImpactAiExplanation,
  MultiProjectImpactRedactedEndpoint,
  MultiProjectImpactSourceType,
  MultiProjectImpactWarningCode,
  MultiProjectImpactFollowUpTarget,
} from './multi-project-impact-analysis.js'

import { MULTI_PROJECT_IMPACT_DEFAULTS, fnv1aHash } from './multi-project-impact-analysis.js'

// ─── Fixture builders ───────────────────────────────────────────────

/** 标准 scope fixture（可见链路） */
export function makeMultiProjectImpactScopeFixture(
  overrides: Partial<MultiProjectImpactScope> = {},
): MultiProjectImpactScope {
  return {
    projectIds: [1, 2, 3],
    sources: [makeSourceRefFixture('project', 1, 1, '项目 Alpha')],
    maxPropagationDepth: 5,
    maxNodes: 500,
    maxEdges: 1000,
    dateWindowStart: '2026-07-01T00:00:00Z',
    dateWindowEnd: '2026-12-31T23:59:59Z',
    maxScenarios: 5,
    ...overrides,
  }
}

/** 大型 scope fixture */
export function makeMultiProjectImpactLargeScopeFixture(
  projectCount: number = 100,
): MultiProjectImpactScope {
  const projectIds = Array.from({ length: projectCount }, (_, i) => i + 1)
  return {
    projectIds,
    maxPropagationDepth: 10,
    maxNodes: 2000,
    maxEdges: 5000,
    dateWindowStart: null,
    dateWindowEnd: null,
    maxScenarios: 20,
  }
}

/** 跨组织 scope fixture（应被拒绝） */
export function makeMultiProjectImpactCrossOrgScopeFixture(): MultiProjectImpactScope {
  return {
    projectIds: [1, 99999],
    maxPropagationDepth: 3,
    maxNodes: 100,
    maxEdges: 200,
    dateWindowStart: null,
    dateWindowEnd: null,
    maxScenarios: 3,
  }
}

/** 源点引用 fixture */
export function makeSourceRefFixture(
  sourceType: MultiProjectImpactSourceType = 'project',
  sourceId: number = 1,
  projectId: number = 1,
  label: string = '源点',
): MultiProjectImpactSourceRef {
  return { sourceType, sourceId, sourceLabel: label, projectId }
}

/** 受影响端点 fixture（可见） */
export function makeAffectedEndpointFixture(
  overrides: Partial<MultiProjectImpactAffectedEndpoint> = {},
): MultiProjectImpactAffectedEndpoint {
  return {
    endpointType: 'task',
    endpointId: 100,
    endpointLabel: '任务：前端登录页面',
    projectId: 2,
    projectLabel: '项目 Beta',
    depth: 2,
    propagatedDelayDays: 3,
    bufferAbsorbedDays: 2,
    remainingBufferDays: 3,
    leadLagAdjustmentDays: 0,
    severity: 'medium',
    affectedDimensions: ['schedule'],
    visibility: 'visible',
    evidenceHash: fnv1aHash('evidence-1'),
    ...overrides,
  }
}

/** 受影响端点 fixture（隐藏） */
export function makeRedactedEndpointFixture(): MultiProjectImpactAffectedEndpoint {
  return {
    endpointType: 'task',
    endpointId: 0,
    endpointLabel: '',
    projectId: 0,
    projectLabel: '',
    depth: 1,
    propagatedDelayDays: 5,
    bufferAbsorbedDays: 0,
    remainingBufferDays: 0,
    leadLagAdjustmentDays: 0,
    severity: 'high',
    affectedDimensions: ['schedule'],
    visibility: 'redacted',
    redactionReason: 'hidden_task',
    evidenceHash: fnv1aHash('redacted-evidence'),
  }
}

/** 传播路径 fixture（可见链路） */
export function makePropagationPathFixture(
  overrides: Partial<MultiProjectImpactPropagationPath> = {},
): MultiProjectImpactPropagationPath {
  return {
    sourceRef: makeSourceRefFixture('project', 1, 1, '项目 Alpha'),
    entries: [
      {
        fromType: 'project',
        fromId: 1,
        fromLabel: '项目 Alpha',
        fromProjectId: 1,
        toType: 'milestone',
        toId: 10,
        toLabel: '里程碑 M1',
        toProjectId: 2,
        relationshipType: 'cross_project_dependency',
        delayDays: 5,
        bufferDays: 5,
        visibility: 'visible',
        evidenceHash: fnv1aHash('edge-1'),
      },
      {
        fromType: 'milestone',
        fromId: 10,
        fromLabel: '里程碑 M1',
        fromProjectId: 2,
        toType: 'task',
        toId: 100,
        toLabel: '任务：前端登录页面',
        toProjectId: 2,
        relationshipType: 'milestone_task',
        delayDays: 3,
        bufferDays: 3,
        visibility: 'visible',
        evidenceHash: fnv1aHash('edge-2'),
      },
    ],
    totalDelayDays: 3,
    depth: 2,
    affectedEndpoints: [makeAffectedEndpointFixture()],
    ...overrides,
  }
}

/** 传播路径 fixture（隐藏链路） */
export function makeHiddenPropagationPathFixture(): MultiProjectImpactPropagationPath {
  return {
    sourceRef: makeSourceRefFixture('project', 1, 1, '项目 Alpha'),
    entries: [
      {
        fromType: 'project',
        fromId: 1,
        fromLabel: '项目 Alpha',
        fromProjectId: 1,
        toType: 'task',
        toId: 0,
        toLabel: '',
        toProjectId: 0,
        relationshipType: 'cross_project_dependency',
        delayDays: 7,
        bufferDays: 0,
        visibility: 'redacted',
        redactionReason: 'hidden_task',
        evidenceHash: fnv1aHash('hidden-edge'),
      },
    ],
    totalDelayDays: 7,
    depth: 1,
    affectedEndpoints: [makeRedactedEndpointFixture()],
  }
}

/** buffer 吸收链路 fixture */
export function makeBufferAbsorptionPathFixture(): MultiProjectImpactPropagationPath {
  return {
    sourceRef: makeSourceRefFixture('milestone', 10, 1, '里程碑 M1'),
    entries: [
      {
        fromType: 'milestone',
        fromId: 10,
        fromLabel: '里程碑 M1',
        fromProjectId: 1,
        toType: 'milestone',
        toId: 20,
        toLabel: '里程碑 M2',
        toProjectId: 2,
        relationshipType: 'cross_project_dependency',
        delayDays: 3,
        bufferDays: 5,
        visibility: 'visible',
        evidenceHash: fnv1aHash('buffer-edge'),
      },
    ],
    totalDelayDays: 0,
    depth: 1,
    affectedEndpoints: [
      {
        endpointType: 'milestone',
        endpointId: 20,
        endpointLabel: '里程碑 M2',
        projectId: 2,
        projectLabel: '项目 Beta',
        depth: 1,
        propagatedDelayDays: 0,
        bufferAbsorbedDays: 3,
        remainingBufferDays: 2,
        leadLagAdjustmentDays: 0,
        severity: 'none',
        affectedDimensions: ['schedule'],
        visibility: 'visible',
        evidenceHash: fnv1aHash('buffer-evidence'),
      },
    ],
  }
}

/** What-if 场景 fixture */
export function makeWhatIfScenarioFixture(
  overrides: Partial<MultiProjectImpactWhatIfScenario> = {},
): MultiProjectImpactWhatIfScenario {
  return {
    scenarioType: 'delay',
    assumption: '项目 Alpha 延迟 7 天',
    targetEndpointType: 'project',
    targetEndpointId: 1,
    params: { delayDays: 7 },
    ...overrides,
  }
}

/** What-if 输出 fixture */
export function makeWhatIfOutputFixture(
  overrides: Partial<MultiProjectImpactWhatIfOutput> = {},
): MultiProjectImpactWhatIfOutput {
  return {
    scenarioHash: fnv1aHash('scenario-1'),
    scenario: makeWhatIfScenarioFixture(),
    assumptions: ['假设项目 Alpha 延期 7 天'],
    baseline: {
      totalAffected: 5,
      severityDistribution: { blocker: 0, critical: 1, high: 2, medium: 1, low: 1, none: 0 },
      blockedEndpoints: 1,
    },
    scenarioOutput: {
      totalAffected: 8,
      severityDistribution: { blocker: 1, critical: 2, high: 3, medium: 1, low: 1, none: 0 },
      blockedEndpoints: 3,
    },
    changedEndpoints: {
      added: [makeAffectedEndpointFixture({ endpointId: 200, severity: 'high' })],
      removed: [],
      severityChanged: [
        {
          endpoint: makeAffectedEndpointFixture(),
          baselineSeverity: 'medium',
          newSeverity: 'high',
        },
      ],
    },
    comparisonHash: fnv1aHash('comparison-1'),
    isHypothetical: true,
    isApplied: false,
    ...overrides,
  }
}

/** 快照 fixture */
export function makeMultiProjectImpactSnapshotFixture(
  overrides: Partial<MultiProjectImpactSnapshot> = {},
): MultiProjectImpactSnapshot {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 90 * 24 * 3600 * 1000)
  return {
    id: 1,
    organizationId: 1,
    actorId: 1,
    scopeHash: fnv1aHash('scope-fixture'),
    sourceFreshnessHash: fnv1aHash('freshness-fixture'),
    dependencyGraphSignature: fnv1aHash('graph-fixture'),
    ruleVersion: MULTI_PROJECT_IMPACT_DEFAULTS.RULE_VERSION,
    permissionFingerprint: fnv1aHash('perm-fixture'),
    inputHash: fnv1aHash('input-fixture'),
    outputHash: fnv1aHash('output-fixture'),
    status: 'completed',
    generatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sourceSummary: {
      sourceType: 'project',
      sourceCount: 1,
      projectCount: 3,
    },
    propagationSummary: {
      propagationPaths: [makePropagationPathFixture()],
      totalAffectedEndpoints: 1,
      severityDistribution: { blocker: 0, critical: 0, high: 0, medium: 1, low: 0, none: 0 },
      blockedEndpoints: 0,
      maxDepth: 2,
      averageDelayDays: 3,
    },
    warnings: [],
    isStale: false,
    evidenceReferences: [fnv1aHash('evidence-1')],
    createdAt: now.toISOString(),
    createdBy: 1,
    ...overrides,
  }
}

/** Stale 快照 fixture */
export function makeMultiProjectImpactStaleSnapshotFixture(): MultiProjectImpactSnapshot {
  const past = new Date(Date.now() - 120 * 24 * 3600 * 1000)
  const expired = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  return makeMultiProjectImpactSnapshotFixture({
    id: 2,
    generatedAt: past.toISOString(),
    expiresAt: expired.toISOString(),
    isStale: true,
    staleReason: 'snapshot_ttl_expired',
    warnings: [
      {
        code: 'stale_source_data' as MultiProjectImpactWarningCode,
        message: '快照数据已过期，需要刷新',
      },
    ],
  })
}

/** 空快照 fixture（无受影响的端点） */
export function makeMultiProjectImpactEmptySnapshotFixture(): MultiProjectImpactSnapshot {
  return makeMultiProjectImpactSnapshotFixture({
    id: 3,
    propagationSummary: {
      propagationPaths: [],
      totalAffectedEndpoints: 0,
      severityDistribution: { blocker: 0, critical: 0, high: 0, medium: 0, low: 0, none: 0 },
      blockedEndpoints: 0,
      maxDepth: 0,
      averageDelayDays: 0,
    },
    warnings: [],
  })
}

/** Plan fixture */
export function makeMultiProjectImpactPlanFixture(): MultiProjectImpactPlan {
  return {
    runToken: fnv1aHash('plan-run-token-' + Date.now()),
    scopeHash: fnv1aHash('scope-fixture'),
    ruleVersion: MULTI_PROJECT_IMPACT_DEFAULTS.RULE_VERSION,
    sourceFreshnessHash: fnv1aHash('freshness-fixture'),
    permissionFingerprint: fnv1aHash('perm-fixture'),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    estimatedCost: {
      approximateNodes: 50,
      approximateEdges: 100,
      estimatedDurationMs: 500,
    },
    warnings: [],
    scope: makeMultiProjectImpactScopeFixture(),
  }
}

/** Follow-up draft fixture */
export function makeFollowUpDraftFixture(
  overrides: Partial<MultiProjectImpactFollowUpDraft> = {},
): MultiProjectImpactFollowUpDraft {
  return {
    sourceSnapshotId: 1,
    sourceSnapshotHash: fnv1aHash('output-fixture'),
    affectedEndpointHashes: [fnv1aHash('evidence-1')],
    targetCapability: 'manual_risk_draft' as MultiProjectImpactFollowUpTarget,
    draftPayload: {
      action: 'create_risk_draft',
      title: '影响分析建议：缓冲区可能不足',
      severity: 'medium',
    },
    warnings: [],
    redactionState: [],
    freshnessSignature: fnv1aHash('freshness-fixture'),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    confirmationRequired: true,
    isManualFallback: false,
    ...overrides,
  }
}

/** Feature-unavailable fallback draft fixture */
export function makeFollowUpDraftFeatureUnavailableFixture(): MultiProjectImpactFollowUpDraft {
  return {
    sourceSnapshotId: 1,
    sourceSnapshotHash: fnv1aHash('output-fixture'),
    affectedEndpointHashes: [fnv1aHash('evidence-1')],
    targetCapability: 'multi_project_dependency_crud' as MultiProjectImpactFollowUpTarget,
    draftPayload: {},
    warnings: [
      {
        code: 'source_data_unavailable' as MultiProjectImpactWarningCode,
        message: '多项目依赖 CRUD 能力尚未启用，仅提供人工摘要',
      },
    ],
    redactionState: [],
    freshnessSignature: fnv1aHash('freshness-fixture'),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    confirmationRequired: true,
    featureUnavailable: true,
    isManualFallback: true,
    manualSummary: '目标能力 multi_project_dependency_crud 尚未启用，请手动处理。',
  }
}

/** AI explanation fixture */
export function makeAiExplanationFixture(
  overrides: Partial<MultiProjectImpactAiExplanation> = {},
): MultiProjectImpactAiExplanation {
  return {
    snapshotId: 1,
    snapshotHash: fnv1aHash('output-fixture'),
    provider: 'anthropic',
    model: 'claude-fable-5',
    explanation:
      '项目 Beta 的里程碑 M2 因项目 Alpha 延期 3 天而受到影响。当前缓冲区（5 天）可完全吸收延迟，下游任务不受影响。',
    confidence: 0.85,
    assumptions: ['缓冲区天数基于当前项目设置', '依赖关系保持活跃'],
    followUpQuestions: ['是否需要增加缓冲区？', '是否有其他依赖链路也需要检查？'],
    advisoryOnly: true,
    confirmationRequired: true,
    applied: false,
    generatedAt: new Date().toISOString(),
    tokenCost: 350,
    ...overrides,
  }
}

/** AI unavailable fixture */
export function makeAiExplanationUnavailableFixture(): MultiProjectImpactAiExplanation {
  return {
    snapshotId: 1,
    snapshotHash: fnv1aHash('output-fixture'),
    provider: null,
    model: null,
    explanation: 'AI 服务当前不可用。确定性影响分析结果仍然有效。',
    confidence: 0,
    assumptions: [],
    followUpQuestions: [],
    advisoryOnly: true,
    confirmationRequired: true,
    applied: false,
    generatedAt: new Date().toISOString(),
    tokenCost: null,
  }
}

/** Warning fixture */
export function makeWarningFixture(
  code: MultiProjectImpactWarningCode = 'stale_source_data',
  message: string = '源数据已过期',
): MultiProjectImpactWarning {
  return { code, message }
}

/** Feature-disabled response fixture */
export function makeFeatureUnavailableResponseFixture(): {
  error: { code: string; message: string; details: Record<string, unknown> }
} {
  return {
    error: {
      code: 'FEATURE_DISABLED',
      message: '多项目影响分析功能未启用',
      details: {
        featureName: 'multi-project-impact-analysis',
        existingSnapshots: 0,
      },
    },
  }
}

/** 脱敏端点 fixture */
export function makeRedactedEndpointSummaryFixture(): MultiProjectImpactRedactedEndpoint {
  return {
    endpointHash: fnv1aHash('redacted-endpoint'),
    redactionReason: 'hidden_task',
  }
}

/** 大组织 fixture 输入构建器 */
export function makeLargeImpactAnalysisFixtureInput(params: {
  projectCount?: number
  crossProjectEdges?: number
  internalTaskDeps?: number
  detectionResults?: number
  riskSummaries?: number
  resourceSummaries?: number
  okrSummaries?: number
  biSummaries?: number
}): {
  scope: MultiProjectImpactScope
  dependencyFactHashes: string[]
  detectionResultHashes: string[]
  riskSummaryHashes: string[]
  resourceSummaryHashes: string[]
  okrSummaryHashes: string[]
  biSummaryHashes: string[]
  manualExternalRefHashes: string[]
} {
  const projectCount = params.projectCount ?? 1000
  const crossProjectEdges = params.crossProjectEdges ?? 2000
  const internalTaskDeps = params.internalTaskDeps ?? 5000
  void internalTaskDeps // 预留：大尺寸 fixture 暂不生成内部任务依赖 hash，保留参数供未来扩展
  const detectionResults = params.detectionResults ?? 500
  const riskSummaries = params.riskSummaries ?? 200
  const resourceSummaries = params.resourceSummaries ?? 200
  const okrSummaries = params.okrSummaries ?? 100
  const biSummaries = params.biSummaries ?? 100

  const projectIds = Array.from({ length: projectCount }, (_, i) => i + 1)

  return {
    scope: {
      projectIds,
      maxPropagationDepth: 10,
      maxNodes: 2000,
      maxEdges: 5000,
      dateWindowStart: null,
      dateWindowEnd: null,
      maxScenarios: 20,
    },
    dependencyFactHashes: Array.from({ length: crossProjectEdges }, (_, i) =>
      fnv1aHash(`dep-edge-${i}`),
    ),
    detectionResultHashes: Array.from({ length: detectionResults }, (_, i) =>
      fnv1aHash(`detection-${i}`),
    ),
    riskSummaryHashes: Array.from({ length: riskSummaries }, (_, i) => fnv1aHash(`risk-${i}`)),
    resourceSummaryHashes: Array.from({ length: resourceSummaries }, (_, i) =>
      fnv1aHash(`resource-${i}`),
    ),
    okrSummaryHashes: Array.from({ length: okrSummaries }, (_, i) => fnv1aHash(`okr-${i}`)),
    biSummaryHashes: Array.from({ length: biSummaries }, (_, i) => fnv1aHash(`bi-${i}`)),
    manualExternalRefHashes: [],
  }
}
