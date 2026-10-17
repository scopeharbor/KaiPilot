// @aiproj/types — 多项目依赖管理测试夹具构建器
// v3-multi-project-dependency-model / §1.5
// 零运行时依赖

import type {
  MultiProjectAffectedEndpoint,
  MultiProjectDependency,
  MultiProjectDependencyPreview,
  MultiProjectDependencySuggestion,
  MultiProjectEndpointRef,
  MultiProjectEndpointSummary,
  MultiProjectEvidenceRef,
  MultiProjectGraphEdge,
  MultiProjectGraphNode,
  MultiProjectGraphResponse,
  MultiProjectImpactAnalysisResponse,
} from './multi-project-dependency-model.js'

// ---------------------------------------------------------------------------
// 端点构建器
// ---------------------------------------------------------------------------

export function makeEndpointRef(
  overrides: Partial<MultiProjectEndpointRef> = {},
): MultiProjectEndpointRef {
  return {
    endpointType: 'task',
    projectId: 1,
    projectName: 'Project Alpha',
    milestoneId: null,
    milestoneName: null,
    taskId: 101,
    taskName: 'Task Alpha',
    externalLabel: null,
    externalKey: null,
    redacted: false,
    redactionReason: null,
    ...overrides,
  }
}

export function makeEndpointSummary(
  overrides: Partial<MultiProjectEndpointSummary> = {},
): MultiProjectEndpointSummary {
  return {
    endpointType: 'task',
    projectId: 1,
    projectName: 'Project Alpha',
    taskId: 101,
    taskName: 'Task Alpha',
    milestoneId: null,
    milestoneName: null,
    externalLabel: null,
    redacted: false,
    redactionReason: null,
    ...overrides,
  }
}

export function makeExternalEndpointRef(
  externalKey: string,
  label: string,
): MultiProjectEndpointRef {
  return {
    endpointType: 'external',
    projectId: null,
    projectName: null,
    milestoneId: null,
    milestoneName: null,
    taskId: null,
    taskName: null,
    externalLabel: label,
    externalKey,
    redacted: false,
    redactionReason: null,
  }
}

// ---------------------------------------------------------------------------
// 依赖事实构建器
// ---------------------------------------------------------------------------

let depIdCounter = 1
export function resetDepIdCounter() {
  depIdCounter = 1
}

export function makeDependency(
  overrides: Partial<MultiProjectDependency> = {},
): MultiProjectDependency {
  const id = overrides.id ?? depIdCounter++
  return {
    id,
    organizationId: 1,
    providerEndpoint: makeEndpointRef({
      taskId: 101,
      taskName: 'Task Alpha',
      projectId: 1,
      projectName: 'Project Alpha',
    }),
    consumerEndpoint: makeEndpointRef({
      taskId: 201,
      taskName: 'Task Beta',
      projectId: 2,
      projectName: 'Project Beta',
    }),
    category: 'deliverable',
    type: 'fs',
    lagDays: 0,
    strength: 'hard',
    bufferDays: 3,
    status: 'active',
    riskLevel: 'medium',
    ownerUserId: 1,
    sourceMode: 'manual',
    sourceSuggestionId: null,
    evidenceRefs: [],
    freshnessSignature: 'abc123',
    freshnessCheckedAt: '2026-07-31T00:00:00.000Z',
    freshnessStatus: 'fresh',
    confirmationHash: null,
    idempotencyKey: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: null,
    archivedAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 证据引用构建器
// ---------------------------------------------------------------------------

export function makeEvidenceRef(
  overrides: Partial<MultiProjectEvidenceRef> = {},
): MultiProjectEvidenceRef {
  return {
    type: 'manual_note',
    summary: '手动添加的依赖证据',
    freshness: 'fresh',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 预览快照构建器
// ---------------------------------------------------------------------------

export function makePreview(
  overrides: Partial<MultiProjectDependencyPreview> = {},
): MultiProjectDependencyPreview {
  return {
    previewId: 'preview-001',
    operation: 'create',
    providerEndpoint: makeEndpointSummary({
      taskId: 101,
      taskName: 'Task Alpha',
      projectId: 1,
      projectName: 'Project Alpha',
    }),
    consumerEndpoint: makeEndpointSummary({
      taskId: 201,
      taskName: 'Task Beta',
      projectId: 2,
      projectName: 'Project Beta',
    }),
    permissionFingerprint: 'fp001',
    diff: {
      operation: 'create',
      before: null,
      after: {
        category: 'deliverable',
        type: 'fs',
        lagDays: 0,
        bufferDays: 3,
        strength: 'hard',
      },
      changedFields: ['category', 'type', 'lagDays', 'bufferDays', 'strength'],
    },
    duplicateCheck: { isDuplicate: false, existingId: null, message: null },
    cycleCheck: { wouldCreateCycle: false, message: null },
    lifecycleCheck: { isValid: true, message: null },
    selfDependencyCheck: { isSelfDependency: false, message: null },
    freshnessSignature: 'sig001',
    warningCodes: [],
    confirmationHash: 'conf-hash-001',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    idempotencyKey: 'idem-key-001',
    idempotencyGuidance: 'Retry with same previewId, confirmationHash, and idempotencyKey.',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 图谱构建器
// ---------------------------------------------------------------------------

export function makeGraphNode(
  overrides: Partial<MultiProjectGraphNode> = {},
): MultiProjectGraphNode {
  return {
    nodeId: 'task:p1:t101',
    endpoint: makeEndpointSummary({
      taskId: 101,
      taskName: 'Task Alpha',
      projectId: 1,
      projectName: 'Project Alpha',
    }),
    label: 'Project Alpha / Task Alpha',
    redacted: false,
    redactionReason: null,
    dependencyCount: 2,
    riskSummary: { critical: 0, high: 1, medium: 1, low: 0 },
    drillDownRef: null,
    ...overrides,
  }
}

export function makeGraphEdge(
  overrides: Partial<MultiProjectGraphEdge> = {},
): MultiProjectGraphEdge {
  return {
    edgeId: 1,
    sourceNodeId: 'task:p1:t101',
    targetNodeId: 'task:p2:t201',
    category: 'deliverable',
    type: 'fs',
    status: 'active',
    riskLevel: 'medium',
    bufferDays: 3,
    lagDays: 0,
    freshness: 'fresh',
    drillDownRef: {
      refType: 'dependency',
      targetId: 1,
      opaqueToken: 'tok-001',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
    warningCodes: [],
    ...overrides,
  }
}

export function makeGraphResponse(
  overrides: Partial<MultiProjectGraphResponse> = {},
): MultiProjectGraphResponse {
  return {
    nodes: [makeGraphNode()],
    edges: [makeGraphEdge()],
    visibleNodeCount: 1,
    redactedNodeCount: 0,
    visibleEdgeCount: 1,
    truncated: false,
    truncationReason: null,
    warningCodes: [],
    freshnessMeta: {
      checkedAt: '2026-07-31T00:00:00.000Z',
      staleCount: 0,
      freshCount: 1,
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 影响分析构建器
// ---------------------------------------------------------------------------

export function makeAffectedEndpoint(
  overrides: Partial<MultiProjectAffectedEndpoint> = {},
): MultiProjectAffectedEndpoint {
  return {
    endpoint: makeEndpointSummary({
      taskId: 201,
      taskName: 'Task Beta',
      projectId: 2,
      projectName: 'Project Beta',
    }),
    pathDepth: 1,
    propagatedDelayDays: 5,
    absorbedBufferDays: 3,
    netDelayDays: 2,
    impactType: 'direct',
    delayAbsorbed: false,
    blocked: false,
    riskLevel: 'high',
    redacted: false,
    blockingChain: [1],
    evidenceRefs: [],
    ...overrides,
  }
}

export function makeImpactAnalysisResponse(
  overrides: Partial<MultiProjectImpactAnalysisResponse> = {},
): MultiProjectImpactAnalysisResponse {
  return {
    source: {
      type: 'endpoint',
      endpoint: makeEndpointSummary({ taskId: 101, taskName: 'Task Alpha' }),
      hypotheticalDelayDays: null,
      description: null,
    },
    directAffected: [makeAffectedEndpoint()],
    indirectAffected: [],
    redactedAffectedCount: 0,
    totalEdgesAnalyzed: 1,
    truncated: false,
    warnings: [],
    analyzedAt: '2026-07-31T00:00:00.000Z',
    advisoryOnly: true,
    evidenceSummary: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 建议构建器
// ---------------------------------------------------------------------------

export function makeSuggestion(
  overrides: Partial<MultiProjectDependencySuggestion> = {},
): MultiProjectDependencySuggestion {
  return {
    id: 1,
    suggestionType: 'rule',
    ruleSource: 'milestone_reference',
    status: 'pending',
    confidence: 'high',
    suggestedProvider: makeEndpointSummary({
      taskId: 101,
      taskName: 'Task Alpha',
      projectId: 1,
      projectName: 'Project Alpha',
    }),
    suggestedConsumer: makeEndpointSummary({
      taskId: 201,
      taskName: 'Task Beta',
      projectId: 2,
      projectName: 'Project Beta',
    }),
    suggestedCategory: 'milestone',
    suggestedType: 'fs',
    rationale: '检测到里程碑引用',
    evidenceRefs: [],
    sourceFreshness: 'fresh',
    warningCodes: [],
    previewDraftInput: null,
    redacted: false,
    advisoryOnly: true,
    confirmationRequired: true,
    applied: false,
    createdAt: '2026-07-31T00:00:00.000Z',
    expiresAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 预构建场景
// ---------------------------------------------------------------------------

/** 可见依赖场景 */
export function visibleDependencyFixture(): MultiProjectDependency {
  return makeDependency()
}

/** 受限/脱敏依赖场景 */
export function restrictedDependencyFixture(): MultiProjectDependency {
  return makeDependency({
    id: 2,
    providerEndpoint: makeEndpointRef({
      taskId: 102,
      taskName: 'Hidden Task',
      projectId: 3,
      projectName: 'Hidden Project',
      redacted: true,
      redactionReason: 'PERMISSION_DENIED',
    }),
  })
}

/** 过期依赖场景 */
export function staleDependencyFixture(): MultiProjectDependency {
  return makeDependency({
    id: 3,
    freshnessStatus: 'stale',
    freshnessCheckedAt: '2026-01-01T00:00:00.000Z',
  })
}

/** 重复依赖场景 */
export function duplicateDependencyFixture(): [MultiProjectDependency, MultiProjectDependency] {
  const dep1 = makeDependency({ id: 4 })
  const dep2 = makeDependency({
    id: 5,
    providerEndpoint: { ...dep1.providerEndpoint },
    consumerEndpoint: { ...dep1.consumerEndpoint },
    category: dep1.category,
    type: dep1.type,
  })
  return [dep1, dep2]
}

/** 循环依赖场景：P1→P2, P2→P3, P3→P1 */
export function cycleDependencyFixture(): MultiProjectDependency[] {
  return [
    makeDependency({
      id: 10,
      providerEndpoint: makeEndpointRef({
        taskId: 101,
        taskName: 'T1',
        projectId: 1,
        projectName: 'P1',
      }),
      consumerEndpoint: makeEndpointRef({
        taskId: 201,
        taskName: 'T2',
        projectId: 2,
        projectName: 'P2',
      }),
    }),
    makeDependency({
      id: 11,
      providerEndpoint: makeEndpointRef({
        taskId: 201,
        taskName: 'T2',
        projectId: 2,
        projectName: 'P2',
      }),
      consumerEndpoint: makeEndpointRef({
        taskId: 301,
        taskName: 'T3',
        projectId: 3,
        projectName: 'P3',
      }),
    }),
    makeDependency({
      id: 12,
      providerEndpoint: makeEndpointRef({
        taskId: 301,
        taskName: 'T3',
        projectId: 3,
        projectName: 'P3',
      }),
      consumerEndpoint: makeEndpointRef({
        taskId: 101,
        taskName: 'T1',
        projectId: 1,
        projectName: 'P1',
      }),
    }),
  ]
}

/** 外部引用依赖场景 */
export function externalReferenceFixture(): MultiProjectDependency {
  return makeDependency({
    id: 6,
    providerEndpoint: makeExternalEndpointRef('vendor-x', 'Vendor X API'),
    consumerEndpoint: makeEndpointRef({
      taskId: 201,
      taskName: 'Task Beta',
      projectId: 2,
      projectName: 'Project Beta',
    }),
    category: 'external',
    riskLevel: 'high',
  })
}

/** 大图场景：生成 N 条边 */
export function largeGraphFixture(
  projectCount: number,
  edgeCount: number,
): MultiProjectDependency[] {
  const deps: MultiProjectDependency[] = []
  for (let i = 0; i < edgeCount; i++) {
    const providerProj = (i % projectCount) + 1
    const consumerProj = ((i + 1) % projectCount) + 1
    deps.push(
      makeDependency({
        id: 1000 + i,
        providerEndpoint: makeEndpointRef({
          taskId: 100 + i,
          taskName: `Task ${100 + i}`,
          projectId: providerProj,
          projectName: `Project ${providerProj}`,
        }),
        consumerEndpoint: makeEndpointRef({
          taskId: 200 + i,
          taskName: `Task ${200 + i}`,
          projectId: consumerProj,
          projectName: `Project ${consumerProj}`,
        }),
      }),
    )
  }
  return deps
}
