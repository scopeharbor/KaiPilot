// @aiproj/types — V3 Copilot 上下文组装测试夹具（七态）
// v3-copilot-context-packet-and-project-panorama / §2.9 —
// complete / truncated / stale / permission-missing / zero-result /
// methodology-injected / general-scope。全部离线确定性（固定时间戳与 hash）。

import type {
  CopilotContextPacket,
  CopilotSourceSummary,
  CopilotWarningCode,
} from './copilot-shared-contracts.js'
import { buildCopilotSourceSummary } from './copilot-shared-contracts-fixtures.js'
import {
  COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP,
  COPILOT_RETRIEVAL_KIND_TO_SOURCE_KIND,
  COPILOT_RETRIEVAL_SOURCE_KINDS,
  deriveEligibleKnowledgeTiers,
  estimateCopilotSourceBytes,
  generateCopilotContextAssemblyId,
  makeCopilotRoutingInputsPreserved,
  planCopilotAssemblyTruncation,
  type CopilotAssemblySourceMetadata,
  type CopilotAssemblyTruncationMarker,
  type CopilotConclusionTraceEntry,
  type CopilotContextAssemblyResult,
  type CopilotMethodologyFacet,
  type CopilotPanoramaFacetName,
  type CopilotProjectPanorama,
  type CopilotRetrievalSourceKind,
  type CopilotRoutingInputsPreserved,
  type CopilotUncertaintyEntry,
} from './copilot-context-assembly.js'

// ---------------------------------------------------------------------------
// 固定时间轴（确定性）
// ---------------------------------------------------------------------------

export const COPILOT_ASSEMBLY_FIXTURE_T0 = '2026-08-16T00:00:00.000Z'
export const COPILOT_ASSEMBLY_FIXTURE_T1 = '2026-08-16T01:00:00.000Z'
export const COPILOT_ASSEMBLY_FIXTURE_T2 = '2026-08-16T02:00:00.000Z'

// ---------------------------------------------------------------------------
// 小构件 builders
// ---------------------------------------------------------------------------

export function buildAssemblySourceMetadata(params: {
  retrievalKind: CopilotRetrievalSourceKind
  sourceRef?: string
  sourceHash?: string
  capturedAt?: string
  hitCount?: number
  scoreRange?: { min: number; max: number }
  permissionDecision?: CopilotAssemblySourceMetadata['permissionDecision']
  matched?: boolean
}): CopilotAssemblySourceMetadata {
  const sourceRef = params.sourceRef ?? `${params.retrievalKind}/ref-001`
  return {
    retrievalKind: params.retrievalKind,
    sourceRef,
    sourceHash: params.sourceHash ?? `hash_${params.retrievalKind}_${sourceRef}`,
    capturedAt: params.capturedAt ?? COPILOT_ASSEMBLY_FIXTURE_T1,
    hitCount: params.hitCount ?? 1,
    scoreRange: params.scoreRange,
    permissionDecision: params.permissionDecision ?? 'granted',
    packetSourceKind: COPILOT_RETRIEVAL_KIND_TO_SOURCE_KIND[params.retrievalKind],
    matched: params.matched ?? true,
  }
}

export function buildAssemblyPacket(params: {
  scope: CopilotContextPacket['scope']
  sources: readonly CopilotSourceSummary[]
  eligibleKnowledgeTiers?: CopilotContextPacket['eligibleKnowledgeTiers']
  truncation?: CopilotContextPacket['truncation']
  warnings?: readonly CopilotWarningCode[]
}): CopilotContextPacket {
  return {
    contextHash: 'ctx_hash_fixture',
    scope: params.scope,
    sources: params.sources,
    eligibleKnowledgeTiers:
      params.eligibleKnowledgeTiers ?? deriveEligibleKnowledgeTiers('production'),
    truncation: params.truncation ?? {
      truncated: false,
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      budgetBytes: 8192,
      warning: undefined,
    },
    budget: {
      contextBytesUsed: 0,
      contextBytesLimit: 8192,
      evidenceBytesUsed: 0,
      evidenceBytesLimit: 16384,
    },
    warnings: params.warnings ?? [],
    sourceOrdering: params.sources.map((s) => s.sourceKind),
  }
}

export function buildAssemblyPanorama(params?: {
  projectId?: string
  capturedAt?: string
  facetAts?: Partial<Record<CopilotPanoramaFacetName, string>>
}): CopilotProjectPanorama {
  const capturedAt = params?.capturedAt ?? COPILOT_ASSEMBLY_FIXTURE_T1
  const facetAts = params?.facetAts ?? {}
  return {
    scope: 'project',
    projectId: params?.projectId ?? 'project-42',
    capturedAt,
    facets: {
      wbs: { nodeCount: 12, depth: 3, leafCount: 9, byLevel: { phase: 2, task: 9 } },
      taskStatus: {
        total: 9,
        byStatus: { todo: 3, in_progress: 2, done: 4 },
        completionRatio: 4 / 9,
      },
      dependency: {
        dependencyCount: 6,
        criticalPathLength: 4,
        criticalPathTaskRefs: ['task/101', 'task/102', 'task/103', 'task/104'],
        hasCycle: false,
      },
      resource: { assignmentCount: 5, overallLoadRatio: 0.8, overallocatedUserCount: 1 },
      risk: {
        total: 3,
        bySeverity: { high: 1, medium: 2 },
        byStatus: { open: 2, mitigated: 1 },
      },
      milestone: { total: 2, upcomingCount: 1, overdueCount: 0, nextMilestoneRef: 'milestone/7' },
      change: { total: 1, byStatus: { pending: 1 } },
      docs: { documentCount: 4, attachmentCount: 9 },
      activity: {
        recentCount: 6,
        latestActivityAt: COPILOT_ASSEMBLY_FIXTURE_T2,
        byType: { task_update: 4, comment: 2 },
      },
    },
    facetCapturedAts: {
      wbs: facetAts.wbs ?? capturedAt,
      taskStatus: facetAts.taskStatus ?? capturedAt,
      dependency: facetAts.dependency ?? capturedAt,
      resource: facetAts.resource ?? capturedAt,
      risk: facetAts.risk ?? capturedAt,
      milestone: facetAts.milestone ?? capturedAt,
      change: facetAts.change ?? capturedAt,
      docs: facetAts.docs ?? capturedAt,
      activity: facetAts.activity ?? capturedAt,
    },
  }
}

export function buildMethodologyFacet(params?: {
  skillKeys?: readonly string[]
  capturedAt?: string
}): CopilotMethodologyFacet {
  return {
    facetKind: 'methodology',
    isMethodologyGuidance: true,
    isProjectFact: false,
    skillKeys: params?.skillKeys ?? ['agile-delivery'],
    guidanceItems: [
      {
        itemId: 'meth-001',
        skillKey: 'agile-delivery',
        label: '敏捷交付方法论',
        summary: '迭代式交付、每日站会与看板节奏（方法论指引，非本项目事实）',
        sourceRef: 'skill:agile-delivery#kanban-cadence',
        activationRuleId: 'rule-agile-delivery-default',
        activationReason: '项目采用迭代交付节奏，命中敏捷方法论默认激活规则',
      },
    ],
    capturedAt: params?.capturedAt ?? COPILOT_ASSEMBLY_FIXTURE_T1,
    // 方法论版本 hash 与项目事实 source hash 分列（Skill 版本变化只影响本值）
    methodologyVersionHash: 'mvh-agile-delivery-v1',
  }
}

export function buildConclusionTrace(params?: {
  supported?: boolean
  sourceRefs?: readonly string[]
}): CopilotConclusionTraceEntry[] {
  const supported = params?.supported ?? true
  return [
    {
      conclusionId: 'concl-001',
      statement: '项目当前完成比例约 44%',
      sourceRefs: params?.sourceRefs ?? (supported ? ['task/search-001'] : []),
      sourceHashes: supported ? ['hash_task_status'] : [],
      supported,
    },
  ]
}

export function buildUncertainty(params?: {
  kind?: CopilotUncertaintyEntry['kind']
  topic?: string
  confidence?: number
}): CopilotUncertaintyEntry[] {
  return [
    {
      uncertaintyId: 'unc-001',
      topic: params?.topic ?? '项目预算总额',
      kind: params?.kind ?? 'no-match',
      confidence: params?.confidence ?? 0.2,
      sourceRefs: [],
    },
  ]
}

export function buildAssemblyResult(params: {
  scope: CopilotContextAssemblyResult['packet']['scope']
  sources: readonly CopilotAssemblySourceMetadata[]
  packetSources?: readonly CopilotSourceSummary[]
  methodology?: CopilotMethodologyFacet
  panorama?: CopilotProjectPanorama
  truncation?: CopilotAssemblyTruncationMarker
  uncertainty?: readonly CopilotUncertaintyEntry[]
  conclusionTrace?: readonly CopilotConclusionTraceEntry[]
  routingInputs?: CopilotRoutingInputsPreserved
  warnings?: readonly CopilotWarningCode[]
  knowledgeQueryPath?: 'production' | 'eval'
}): CopilotContextAssemblyResult {
  const packetSources =
    params.packetSources ??
    params.sources.map((s) =>
      buildCopilotSourceSummary({
        sourceKind: s.packetSourceKind,
        sourceRef: s.sourceRef,
        sourceHash: s.sourceHash,
        lowSensitivitySummary: `${s.retrievalKind} 检索摘要（${s.hitCount} 条命中）`,
        isStale: false,
      }),
    )
  return {
    assemblyId: generateCopilotContextAssemblyId(),
    requestRef: 'req-001',
    packet: buildAssemblyPacket({
      scope: params.scope,
      sources: packetSources,
      truncation: params.truncation
        ? {
            truncated: params.truncation.truncated,
            omittedSourceCount: params.truncation.omittedSourceCount,
            omittedEvidenceCount: params.truncation.omittedEvidenceCount,
            budgetBytes: 8192,
            warning: params.truncation.warning,
          }
        : undefined,
      warnings: params.warnings,
    }),
    sources: params.sources,
    eligibleKnowledgeTiers: deriveEligibleKnowledgeTiers(params.knowledgeQueryPath ?? 'production'),
    knowledgeQueryPath: params.knowledgeQueryPath ?? 'production',
    methodology: params.methodology,
    panorama: params.panorama,
    truncation: params.truncation ?? {
      truncated: false,
      stage: 'none',
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      droppedRetrievalKinds: [],
      droppedFacets: [],
      hitBudgetFloor: false,
      omittedMethodologyCount: 0,
    },
    uncertainty: params.uncertainty ?? [],
    conclusionTrace: params.conclusionTrace ?? buildConclusionTrace(),
    routingInputs: params.routingInputs ?? makeCopilotRoutingInputsPreserved(true),
    timing: { totalMs: 12, perSourceMs: {} },
    warnings: params.warnings ?? [],
  }
}

// ---------------------------------------------------------------------------
// 七态 fixtures
// ---------------------------------------------------------------------------

export type CopilotAssemblyFixtureStateName =
  | 'complete'
  | 'truncated'
  | 'stale'
  | 'permission-missing'
  | 'zero-result'
  | 'methodology-injected'
  | 'general-scope'

export interface CopilotAssemblyFixtureState {
  readonly state: CopilotAssemblyFixtureStateName
  readonly result: CopilotContextAssemblyResult
}

/** 1/7 完整态：project scope、三来源 granted、全景 + 方法论、零截断、零不确定。 */
export function buildCompleteAssemblyFixture(): CopilotAssemblyFixtureState {
  const sources = [
    buildAssemblySourceMetadata({
      retrievalKind: 'task',
      sourceRef: 'task/search-001',
      hitCount: 6,
      scoreRange: { min: 0.7, max: 0.9 },
    }),
    buildAssemblySourceMetadata({
      retrievalKind: 'risk',
      sourceRef: 'risk/search-001',
      hitCount: 2,
      scoreRange: { min: 0.6, max: 0.8 },
    }),
    buildAssemblySourceMetadata({
      retrievalKind: 'milestone',
      sourceRef: 'milestone/search-001',
      hitCount: 1,
      scoreRange: { min: 0.5, max: 0.7 },
    }),
  ]
  return {
    state: 'complete',
    result: buildAssemblyResult({
      scope: 'project',
      sources,
      methodology: buildMethodologyFacet(),
      panorama: buildAssemblyPanorama(),
      uncertainty: [],
    }),
  }
}

/** 2/7 截断态：十二来源超预算，走声明式截断，路由输入存活。 */
export function buildTruncatedAssemblyFixture(): CopilotAssemblyFixtureState {
  const sources = COPILOT_RETRIEVAL_SOURCE_KINDS.map((kind, i) =>
    buildAssemblySourceMetadata({
      retrievalKind: kind,
      sourceRef: `${kind}/search-${String(i).padStart(3, '0')}`,
      hitCount: i + 1,
      scoreRange: { min: 0.1 + i * 0.05, max: 0.3 + i * 0.05 },
      capturedAt: COPILOT_ASSEMBLY_FIXTURE_T2,
    }),
  )
  const plan = planCopilotAssemblyTruncation({
    sources,
    budget: { contextBytesLimit: 1500, evidenceBytesLimit: 5000, minContextBytes: 800 },
    evidenceCount: 9000,
  })
  return {
    state: 'truncated',
    result: buildAssemblyResult({
      scope: 'project',
      sources: plan.keptSources,
      truncation: plan.marker,
      uncertainty: [],
      conclusionTrace: [],
    }),
  }
}

/** 3/7 stale 态：task 来源 freshness.isStale=true（hash 失配），其余正常。 */
export function buildStaleAssemblyFixture(): CopilotAssemblyFixtureState {
  const taskMeta = buildAssemblySourceMetadata({
    retrievalKind: 'task',
    sourceRef: 'task/stale-001',
    sourceHash: 'hash_task_old',
    capturedAt: COPILOT_ASSEMBLY_FIXTURE_T0,
  })
  const riskMeta = buildAssemblySourceMetadata({
    retrievalKind: 'risk',
    sourceRef: 'risk/fresh-001',
  })
  const packetSources: CopilotSourceSummary[] = [
    buildCopilotSourceSummary({
      sourceKind: taskMeta.packetSourceKind,
      sourceRef: taskMeta.sourceRef,
      sourceHash: taskMeta.sourceHash,
      lowSensitivitySummary: '任务检索摘要（1 条命中，stale）',
      isStale: true,
    }),
    buildCopilotSourceSummary({
      sourceKind: riskMeta.packetSourceKind,
      sourceRef: riskMeta.sourceRef,
      sourceHash: riskMeta.sourceHash,
      lowSensitivitySummary: '风险检索摘要（1 条命中）',
      isStale: false,
    }),
  ]
  return {
    state: 'stale',
    result: buildAssemblyResult({
      scope: 'project',
      sources: [taskMeta, riskMeta],
      packetSources,
      uncertainty: [],
      warnings: ['SOURCE_STALE'],
      conclusionTrace: [],
    }),
  }
}

/**
 * 4/7 权限缺失态：denied-hidden 来源整条省略（不暴露存在/名称/计数/hash），
 * 仅保留通用能力限制告警；两来源 granted 正常采集。
 */
export function buildPermissionMissingAssemblyFixture(): CopilotAssemblyFixtureState {
  const granted = [
    buildAssemblySourceMetadata({
      retrievalKind: 'task',
      sourceRef: 'task/visible-001',
    }),
    buildAssemblySourceMetadata({
      retrievalKind: 'milestone',
      sourceRef: 'milestone/visible-001',
    }),
  ]
  return {
    state: 'permission-missing',
    result: buildAssemblyResult({
      scope: 'project',
      sources: granted,
      uncertainty: [
        {
          uncertaintyId: 'unc-002',
          topic: '项目预算总额',
          kind: 'not-accessible',
          confidence: 0.3,
          sourceRefs: [],
        },
      ],
      conclusionTrace: [],
      warnings: ['SOURCE_PERMISSION_DENIED'],
    }),
  }
}

/** 5/7 零结果态：来源 matched=false，走 no-match 不确定表达，不以通用知识补足。 */
export function buildZeroResultAssemblyFixture(): CopilotAssemblyFixtureState {
  const sources = [
    buildAssemblySourceMetadata({
      retrievalKind: 'task',
      sourceRef: 'task/nomatch-001',
      hitCount: 0,
      matched: false,
      scoreRange: { min: 0, max: 0 },
    }),
  ]
  return {
    state: 'zero-result',
    result: buildAssemblyResult({
      scope: 'project',
      sources,
      uncertainty: buildUncertainty({ kind: 'no-match', topic: '成本超支风险', confidence: 0.1 }),
      conclusionTrace: buildConclusionTrace({ supported: false, sourceRefs: [] }),
    }),
  }
}

/** 6/7 方法论注入态：project scope 注入 agile-delivery 方法论切面（非项目事实）。 */
export function buildMethodologyInjectedAssemblyFixture(): CopilotAssemblyFixtureState {
  const base = buildCompleteAssemblyFixture()
  return {
    state: 'methodology-injected',
    result: {
      ...base.result,
      methodology: buildMethodologyFacet({
        skillKeys: ['agile-delivery', 'data-project'],
        capturedAt: COPILOT_ASSEMBLY_FIXTURE_T1,
      }),
    },
  }
}

/** 7/7 通用 scope 态：global scope、零来源、无全景、无方法论、禁写标记。 */
export function buildGeneralScopeAssemblyFixture(): CopilotAssemblyFixtureState {
  return {
    state: 'general-scope',
    result: buildAssemblyResult({
      scope: 'global',
      sources: [],
      uncertainty: [],
      conclusionTrace: [],
    }),
  }
}

export const COPILOT_ASSEMBLY_FIXTURES: Record<
  CopilotAssemblyFixtureStateName,
  () => CopilotAssemblyFixtureState
> = {
  complete: buildCompleteAssemblyFixture,
  truncated: buildTruncatedAssemblyFixture,
  stale: buildStaleAssemblyFixture,
  'permission-missing': buildPermissionMissingAssemblyFixture,
  'zero-result': buildZeroResultAssemblyFixture,
  'methodology-injected': buildMethodologyInjectedAssemblyFixture,
  'general-scope': buildGeneralScopeAssemblyFixture,
}

export function buildAllAssemblyFixtures(): CopilotAssemblyFixtureState[] {
  return (Object.keys(COPILOT_ASSEMBLY_FIXTURES) as CopilotAssemblyFixtureStateName[]).map(
    (state) => COPILOT_ASSEMBLY_FIXTURES[state](),
  )
}

// ===========================================================================
// §2.7 五态方法论切面 fixtures（Skill 注入专用）
// ===========================================================================

/** 态 1：单 Skill 激活 — 一个 Skill 的方法论条目。 */
export function buildMethodologySingleSkillFacet(): CopilotMethodologyFacet {
  return {
    facetKind: 'methodology',
    isMethodologyGuidance: true,
    isProjectFact: false,
    skillKeys: ['skill-sw-dev'],
    guidanceItems: [
      {
        itemId: 'sw-rule-001',
        skillKey: 'skill-sw-dev',
        label: '需求功能性与非功能性分类',
        summary: '所有需求必须明确划分为功能需求与非功能需求（方法论指引，非本项目事实）',
        sourceRef: 'skill:skill-sw-dev#sw-rule-001',
        activationRuleId: 'activation:projectType:软件开发',
        activationReason: "projectType='软件开发' 匹配 skill-sw-dev.activation.projectTypes",
      },
    ],
    capturedAt: COPILOT_ASSEMBLY_FIXTURE_T1,
    methodologyVersionHash: 'mvh-single-sw-dev-v1',
  }
}

/** 态 2：多 Skill 激活 — 多个 Skill 的方法论条目合并。 */
export function buildMethodologyMultiSkillFacet(): CopilotMethodologyFacet {
  return {
    facetKind: 'methodology',
    isMethodologyGuidance: true,
    isProjectFact: false,
    skillKeys: ['skill-sw-dev', 'skill-devops'],
    guidanceItems: [
      {
        itemId: 'sw-rule-001',
        skillKey: 'skill-sw-dev',
        label: '需求功能性与非功能性分类',
        summary: '所有需求必须明确划分为功能需求与非功能需求（方法论指引，非本项目事实）',
        sourceRef: 'skill:skill-sw-dev#sw-rule-001',
        activationRuleId: 'activation:projectType:软件开发',
        activationReason: "projectType='软件开发' 匹配 skill-sw-dev.activation.projectTypes",
      },
      {
        itemId: 'devops-rule-001',
        skillKey: 'skill-devops',
        label: 'CI/CD 流水线设计',
        summary: '所有变更必须通过自动化流水线验证（方法论指引，非本项目事实）',
        sourceRef: 'skill:skill-devops#devops-rule-001',
        activationRuleId: 'activation:domain:devops',
        activationReason: "domain='devops' 匹配 skill-devops.activation.domains",
      },
    ],
    capturedAt: COPILOT_ASSEMBLY_FIXTURE_T1,
    methodologyVersionHash: 'mvh-multi-sw-devops-v1',
  }
}

/**
 * 态 3：零激活 — 返回 undefined（切面缺席，非空壳）。
 * 零激活时 CopilotContextAssemblyResult.methodology 为 undefined。
 */
export function buildMethodologyZeroActivationFacet(): undefined {
  return undefined
}

/**
 * 态 4：含 L3 条目的非法 Skill — 该条目被拒且不进切面。
 * 模拟：一个 Skill 的 knowledge 含 L3 条目，注入前被 L3 断言拒绝，
 * 最终切面只含合法条目。
 */
export function buildMethodologyL3RejectionFacet(): CopilotMethodologyFacet {
  return {
    facetKind: 'methodology',
    isMethodologyGuidance: true,
    isProjectFact: false,
    skillKeys: ['skill-sw-dev'],
    guidanceItems: [
      {
        itemId: 'sw-rule-001',
        skillKey: 'skill-sw-dev',
        label: '需求功能性与非功能性分类',
        summary: '所有需求必须明确划分为功能需求与非功能需求（方法论指引，非本项目事实）',
        sourceRef: 'skill:skill-sw-dev#sw-rule-001',
        activationRuleId: 'activation:projectType:软件开发',
        activationReason: "projectType='软件开发' 匹配 skill-sw-dev.activation.projectTypes",
      },
      // 注意：L3 条目被 assertNoL3Synthetic 拒绝，不在这里
    ],
    capturedAt: COPILOT_ASSEMBLY_FIXTURE_T1,
    methodologyVersionHash: 'mvh-l3-rejected-v1',
  }
}

/**
 * 态 5：激活失败 — 降级到 null（切面缺席）。
 * 激活失败时 SkillActivationResolver 返回 null → 切面为 undefined。
 */
export function buildMethodologyActivationFailureFacet(): undefined {
  return undefined
}

/** 五态 fixtures 集合（供批量测试）。 */
export const METHODOLOGY_FIVE_STATE_FIXTURES = {
  'single-skill': buildMethodologySingleSkillFacet,
  'multi-skill': buildMethodologyMultiSkillFacet,
  'zero-activation': buildMethodologyZeroActivationFacet,
  'l3-rejection': buildMethodologyL3RejectionFacet,
  'activation-failure': buildMethodologyActivationFailureFacet,
} as const

export type MethodologyFiveStateName = keyof typeof METHODOLOGY_FIVE_STATE_FIXTURES

export { COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP, estimateCopilotSourceBytes }
