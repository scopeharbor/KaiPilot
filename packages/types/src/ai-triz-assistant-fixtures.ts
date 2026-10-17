// @aiproj/types — V3 AI-TRIZ 助手共享测试夹具（前后端共享）
// v3-ai-triz-assistant / §2.9

import type {
  AiTrizAssistantActorPermissions,
  AiTrizAssistantContextPacket,
  AiTrizAssistantFeatureFlags,
  AiTrizAssistantIntent,
  AiTrizAssistantResponse,
  AiTrizAssistantRouteDecision,
  AiTrizAssistantSourceKind,
  AiTrizAssistantSourceSummary,
  AiTrizAssistantWarningCode,
} from './ai-triz-assistant.js'
import {
  generateAssistantMessageId,
  generateAssistantRouteDecisionId,
  generateAssistantRunId,
} from './ai-triz-assistant.js'

// ---------------------------------------------------------------------------
// 权限构建器
// ---------------------------------------------------------------------------

export function buildAuthorizedAssistantPermissions(): AiTrizAssistantActorPermissions {
  const sourcePermissions: Record<AiTrizAssistantSourceKind, boolean> = {
    contradiction: true,
    contradiction_matrix: true,
    technical_contradiction_analysis: true,
    physical_contradiction_analysis: true,
    ifr_snapshot: true,
    function_analysis_snapshot: true,
    resource_analysis: true,
    evolution_trend_run: true,
    recommendation_rationale: true,
    innovation_workbench_scheme: true,
    decision_log: true,
    clarification_card: true,
    compiler_triz_artifact: true,
    draft_layer: true,
    knowledge_summary: true,
    skill_summary: true,
  }
  return {
    canViewTriz: true,
    canManageTriz: true,
    canTriggerAi: true,
    sourcePermissions,
  }
}

export function buildPartiallyAuthorizedAssistantPermissions(): AiTrizAssistantActorPermissions {
  const base = buildAuthorizedAssistantPermissions()
  return {
    ...base,
    canManageTriz: false,
    canTriggerAi: false,
    sourcePermissions: {
      ...base.sourcePermissions,
      evolution_trend_run: false,
      draft_layer: false,
      knowledge_summary: false,
      skill_summary: false,
    },
  }
}

// ---------------------------------------------------------------------------
// 来源摘要构建器
// ---------------------------------------------------------------------------

export function buildAssistantSourceSummary(params: {
  sourceKind: AiTrizAssistantSourceKind
  sourceRef?: string
  sourceHash?: string
  lowSensitivitySummary?: string
  isStale?: boolean
  warnings?: AiTrizAssistantWarningCode[]
}): AiTrizAssistantSourceSummary {
  const sourceRef = params.sourceRef ?? `${params.sourceKind}/ref-001`
  const sourceHash = params.sourceHash ?? `hash_${params.sourceKind}_001`
  return {
    sourceKind: params.sourceKind,
    sourceRef,
    sourceHash,
    lowSensitivitySummary: params.lowSensitivitySummary ?? `${params.sourceKind} 的低敏摘要`,
    freshness: {
      lastUpdatedAt: new Date().toISOString(),
      isStale: params.isStale ?? false,
    },
    routeHints: [],
    warnings: params.warnings ?? [],
  }
}

export function buildStaleAssistantSourceSummary(
  sourceKind: AiTrizAssistantSourceKind,
): AiTrizAssistantSourceSummary {
  return buildAssistantSourceSummary({
    sourceKind,
    sourceHash: `stale_hash_${sourceKind}_001`,
    lowSensitivitySummary: `[陈旧] ${sourceKind} 的低敏摘要`,
    isStale: true,
    warnings: ['SOURCE_STALE'],
  })
}

// ---------------------------------------------------------------------------
// 功能标志构建器
// ---------------------------------------------------------------------------

export function buildAllEnabledAssistantFeatureFlags(): AiTrizAssistantFeatureFlags {
  return {
    evolutionTrendAvailable: true,
    knowledgeBaseAvailable: true,
    skillSystemAvailable: true,
  }
}

export function buildLimitedAssistantFeatureFlags(): AiTrizAssistantFeatureFlags {
  return {
    evolutionTrendAvailable: false,
    knowledgeBaseAvailable: true,
    skillSystemAvailable: false,
  }
}

// ---------------------------------------------------------------------------
// 上下文数据包构建器
// ---------------------------------------------------------------------------

export function buildAuthorizedAssistantContextPacket(
  sources?: AiTrizAssistantSourceSummary[],
): AiTrizAssistantContextPacket {
  const actualSources =
    sources ??
    [
      'contradiction',
      'technical_contradiction_analysis',
      'ifr_snapshot',
      'innovation_workbench_scheme',
      'decision_log',
    ].map((sk) => buildAssistantSourceSummary({ sourceKind: sk as AiTrizAssistantSourceKind }))

  return {
    contextHash: `ctx_hash_${Date.now()}`,
    sources: actualSources,
    sourceOrdering: actualSources.map((s) => s.sourceKind),
    truncated: false,
    permissions: buildAuthorizedAssistantPermissions(),
    featureFlags: buildAllEnabledAssistantFeatureFlags(),
  }
}

export function buildEmptyAssistantContextPacket(): AiTrizAssistantContextPacket {
  return {
    contextHash: 'ctx_empty',
    sources: [],
    sourceOrdering: [],
    truncated: false,
    permissions: buildAuthorizedAssistantPermissions(),
    featureFlags: buildAllEnabledAssistantFeatureFlags(),
  }
}

export function buildLargeAssistantContextPacket(
  sourceCount: number,
): AiTrizAssistantContextPacket {
  const kinds: AiTrizAssistantSourceKind[] = [
    'contradiction',
    'contradiction_matrix',
    'technical_contradiction_analysis',
    'physical_contradiction_analysis',
    'ifr_snapshot',
    'function_analysis_snapshot',
    'resource_analysis',
    'evolution_trend_run',
    'recommendation_rationale',
    'innovation_workbench_scheme',
    'decision_log',
    'clarification_card',
    'compiler_triz_artifact',
    'draft_layer',
    'knowledge_summary',
    'skill_summary',
  ]

  const sources: AiTrizAssistantSourceSummary[] = []
  for (let i = 0; i < sourceCount; i++) {
    const kind = kinds[i % kinds.length]!
    sources.push(
      buildAssistantSourceSummary({
        sourceKind: kind,
        sourceRef: `${kind}/ref-${String(i).padStart(3, '0')}`,
        sourceHash: `hash_${kind}_${String(i).padStart(3, '0')}`,
      }),
    )
  }

  return {
    contextHash: `ctx_large_${sourceCount}`,
    sources,
    sourceOrdering: kinds,
    truncated: sourceCount > 20,
    truncationWarning:
      sourceCount > 20 ? `上下文截断：共 ${sourceCount} 个来源，仅纳入 20 个` : undefined,
    permissions: buildAuthorizedAssistantPermissions(),
    featureFlags: buildAllEnabledAssistantFeatureFlags(),
  }
}

export function buildCrossOrganizationAssistantContextPacket(): AiTrizAssistantContextPacket {
  return {
    contextHash: 'ctx_cross_org',
    sources: [],
    sourceOrdering: [],
    truncated: false,
    permissions: buildAuthorizedAssistantPermissions(),
    featureFlags: buildAllEnabledAssistantFeatureFlags(),
  }
}

// ---------------------------------------------------------------------------
// 响应构建器
// ---------------------------------------------------------------------------

export function buildAssistantResponse(params: {
  intent?: AiTrizAssistantIntent
  routeDecisions?: AiTrizAssistantRouteDecision[]
  warnings?: AiTrizAssistantWarningCode[]
  fallback?: boolean
}): AiTrizAssistantResponse {
  const runId = generateAssistantRunId()
  return {
    runId,
    messageId: generateAssistantMessageId(),
    intent: params.intent ?? 'general_guidance',
    routeDecisions: params.routeDecisions ?? [],
    recommendedActions: [],
    clarificationPrompts: [],
    warnings: params.warnings ?? [],
    fallback: params.fallback ?? false,
    reviewRequired: true,
    auditRefs: {
      runId,
      routeIds: [],
      actionIds: [],
      sourceRefKinds: [],
      sourceHashPrefixes: [],
      warningCodes: params.warnings ?? [],
      fallbackState: params.fallback ?? false,
    },
    createdAt: new Date().toISOString(),
  }
}

export function buildAiFallbackAssistantResponse(): AiTrizAssistantResponse {
  return buildAssistantResponse({
    intent: 'general_guidance',
    warnings: ['AI_FALLBACK', 'AI_PROVIDER_ERROR'],
    fallback: true,
  })
}

// ---------------------------------------------------------------------------
// 路由决策构建器
// ---------------------------------------------------------------------------

export function buildAssistantRouteDecision(params: {
  destination: import('./ai-triz-assistant.js').AiTrizAssistantDestination
  confidence?: import('./ai-triz-assistant.js').AiTrizAssistantConfidenceLevel
  warnings?: AiTrizAssistantWarningCode[]
  order?: number
}): AiTrizAssistantRouteDecision {
  return {
    routeId: generateAssistantRouteDecisionId(),
    destination: params.destination,
    confidence: params.confidence ?? 'medium',
    reason: `推荐使用 ${params.destination}`,
    sourceRefs: [],
    sourceHashes: [],
    warnings: params.warnings ?? [],
    order: params.order ?? 0,
  }
}
