// @aiproj/types — V2 TRIZ AI Clarification Cards 测试 fixtures
// v2-triz-ai-clarification-cards / 1.4

import type {
  TrizClarificationSourceRef,
  TrizClarificationCandidate,
  TrizClarificationAnswer,
  TrizAnalysisClarificationHint,
  TrizClarificationCardDTO,
  TrizContextMergeOutput,
} from './triz-clarification-cards.js'
import type { ContradictionSeverity } from './triz-contradiction.js'

// ---------------------------------------------------------------------------
// Fixture: Confirmed contradictions (duration vs resource load)
// ---------------------------------------------------------------------------

export const fixtureConfirmedDurationResourceRef: TrizClarificationSourceRef = {
  contradictionId: 1,
  key: 'tc-dur-vs-res',
  type: 'technical',
  status: 'confirmed',
  severity: 'critical',
  confidence: 0.92,
  stale: false,
  staleReason: null,
  improvingParameterKey: 'duration',
  worseningParameterKey: 'resource_load',
  parameterKey: null,
  title: '压缩工期会导致资源负载过高',
  affectedScope: ['任务分配', '资源计划'],
  suggestedPrinciples: [
    { principleId: 'segmentation', name: '分割/分解' },
    { principleId: 'preliminary_action', name: '预先作用' },
  ],
  inputSignature: 'sig-dur-vs-res-001',
  outputHash: 'out-dur-vs-res-001',
}

export const fixtureConfirmedDurationResourceHint: TrizAnalysisClarificationHint = {
  artifactId: 'triz-artifact-001',
  version: 1,
  contentHash: 'hash-artifact-001',
  sourceKeys: ['tc-dur-vs-res', 'tc-scope-vs-quality'],
  topTensions: ['工期 ↔ 资源负载', '范围 ↔ 质量'],
  principleRefs: [
    { principleId: 'segmentation', name: '分割/分解', relevance: 'high' },
    { principleId: 'preliminary_action', name: '预先作用', relevance: 'medium' },
  ],
  resolutionPathHints: [
    { pathId: 'rp-001', name: '分段交付', suggestionType: 'split' },
    { pathId: 'rp-002', name: '前置缓冲', suggestionType: 'buffer' },
  ],
  warningCodes: [],
  hasAiNarrative: false,
}

// ---------------------------------------------------------------------------
// Fixture: Stale contradiction
// ---------------------------------------------------------------------------

export const fixtureStaleContradictionRef: TrizClarificationSourceRef = {
  contradictionId: 2,
  key: 'tc-scope-vs-quality',
  type: 'technical',
  status: 'confirmed',
  severity: 'high',
  confidence: 0.85,
  stale: true,
  staleReason: '基础数据已更新，需要重新检测',
  improvingParameterKey: 'scope',
  worseningParameterKey: 'quality',
  parameterKey: null,
  title: '扩大范围会降低交付质量',
  affectedScope: ['需求范围', '验收标准'],
  suggestedPrinciples: [
    { principleId: 'dynamics', name: '动态化' },
    { principleId: 'periodic_action', name: '周期性作用' },
  ],
  inputSignature: 'sig-scope-vs-quality-001',
  outputHash: 'out-scope-vs-quality-001',
}

// ---------------------------------------------------------------------------
// Fixture: Missing TRIZ analysis (no artifact available)
// ---------------------------------------------------------------------------

export const fixtureMissingAnalysisHints: TrizAnalysisClarificationHint[] = []

// ---------------------------------------------------------------------------
// Fixture: Contradiction with no evidence access
// ---------------------------------------------------------------------------

export const fixtureUnauthorizedContradictionRef: TrizClarificationSourceRef = {
  contradictionId: 3,
  key: 'tc-cost-vs-risk',
  type: 'technical',
  status: 'draft',
  severity: 'medium',
  confidence: 0.7,
  stale: false,
  staleReason: null,
  improvingParameterKey: 'cost',
  worseningParameterKey: 'risk_level',
  parameterKey: null,
  title: '降低成本会增加项目风险', // low-sensitivity title only
  affectedScope: ['预算', '风险管理'],
  suggestedPrinciples: [],
  inputSignature: 'sig-cost-vs-risk-001',
  outputHash: null,
}

// ---------------------------------------------------------------------------
// Fixture: Generated candidate for duration vs resource
// ---------------------------------------------------------------------------

export const fixtureDurationResourceCandidate: TrizClarificationCandidate = {
  cardId:
    'triz-1.0|triz|schedulePriority|trade_off|tc-dur-vs-res|hash-artifact-001|schedule_vs_resource',
  sourceRefs: [fixtureConfirmedDurationResourceRef],
  analysisHint: fixtureConfirmedDurationResourceHint,
  trizCategory: 'trade_off',
  mappedField: 'schedulePriority',
  title: '工期与资源负载取舍',
  description:
    '系统检测到「压缩工期会导致资源负载过高」的矛盾。请确认在本次项目中，如何平衡工期目标与资源负载？',
  impactScope: [
    { domain: '工期/进度', severity: 'high' },
    { domain: '资源负载', severity: 'high' },
  ],
  questionType: 'single_choice',
  quickOptions: [
    {
      label: '优先保证工期，接受资源负载增加',
      value: 'schedule_first',
      description: '适合关键里程碑不可延期的场景。',
    },
    {
      label: '优先控制资源负载，接受工期延长',
      value: 'resource_first',
      description: '适合团队容量已经接近上限的场景。',
      recommended: true,
    },
    {
      label: '寻找两者平衡，采用分段交付',
      value: 'balanced_split',
      description: '适合希望先交付核心能力、后续逐步补齐的场景。',
    },
  ],
  defaultValue: 'resource_first',
  confidence: 0.85,
  reasoning: '基于已确认矛盾「tc-dur-vs-res」，严重度 critical，置信度 0.92。',
  severity: 'critical',
  allowSkip: false,
  isRequired: true,
  warningCodes: [],
  warnings: [],
  answerEffect: {
    type: 'schedule_priority',
    description: '工期与资源负载的取舍将影响项目排期和资源分配',
    severity: 'high',
  },
  sourceHash: 'triz-sh-a1b2c3d4',
}

// ---------------------------------------------------------------------------
// Fixture: Candidate with warning (TRIZ analysis unavailable)
// ---------------------------------------------------------------------------

export const fixtureAnalysisUnavailableCandidate: TrizClarificationCandidate = {
  cardId:
    'triz-1.0|triz|schedulePriority|trade_off|tc-dur-vs-res|sig-dur-vs-res-001|schedule_vs_resource',
  sourceRefs: [fixtureConfirmedDurationResourceRef],
  analysisHint: null,
  trizCategory: 'trade_off',
  mappedField: 'schedulePriority',
  title: '工期与资源负载取舍',
  description:
    '系统检测到工期压缩与资源负载之间的矛盾，但 TRIZ 综合分析暂不可用。请直接根据矛盾信息确认您的优先级。',
  impactScope: [
    { domain: '工期/进度', severity: 'high' },
    { domain: '资源负载', severity: 'high' },
  ],
  questionType: 'single_choice',
  quickOptions: [
    {
      label: '优先保证工期，接受资源负载增加',
      value: 'schedule_first',
      description: '适合关键里程碑不可延期的场景。',
    },
    {
      label: '优先控制资源负载，接受工期延长',
      value: 'resource_first',
      description: '适合团队容量已经接近上限的场景。',
      recommended: true,
    },
  ],
  defaultValue: 'resource_first',
  confidence: 0.8,
  reasoning: '基于矛盾 snapshot。TRIZ analysis artifact 不可用。',
  severity: 'critical',
  allowSkip: false,
  isRequired: true,
  warningCodes: ['TRIZ_ANALYSIS_UNAVAILABLE'],
  warnings: [
    {
      code: 'TRIZ_ANALYSIS_UNAVAILABLE',
      message: 'TRIZ 综合分析不可用，基于矛盾 snapshot 派生基础卡片',
      source: 'triz-clarification-service',
    },
  ],
  answerEffect: {
    type: 'schedule_priority',
    description: '工期与资源负载的取舍将影响项目排期和资源分配',
    severity: 'high',
  },
  sourceHash: 'triz-sh-b2c3d4e5',
}

// ---------------------------------------------------------------------------
// Fixture: Answer for duration vs resource
// ---------------------------------------------------------------------------

export const fixtureScheduleFirstAnswer: TrizClarificationAnswer = {
  cardId:
    'triz-1.0|triz|schedulePriority|trade_off|tc-dur-vs-res|hash-artifact-001|schedule_vs_resource',
  action: 'answer',
  value: 'schedule_first',
  adoptedDefault: false,
  sourceHash: 'triz-sh-a1b2c3d4',
  marker: {
    confidence: 1,
    source: 'explicit',
    reason: '用户明确选择优先保证工期',
    needsConfirmation: false,
  },
  note: '关键里程碑不容延迟',
}

export const fixtureAdoptDefaultAnswer: TrizClarificationAnswer = {
  cardId:
    'triz-1.0|triz|schedulePriority|trade_off|tc-dur-vs-res|hash-artifact-001|schedule_vs_resource',
  action: 'adopt_default',
  value: 'resource_first',
  adoptedDefault: true,
  sourceHash: 'triz-sh-a1b2c3d4',
  marker: {
    confidence: 0.7,
    source: 'default',
    reason: '用户采纳了系统推荐的默认假设',
    needsConfirmation: true,
  },
}

// ---------------------------------------------------------------------------
// Fixture: Stale answer (source hash mismatch)
// ---------------------------------------------------------------------------

export const fixtureStaleAnswer: TrizClarificationAnswer = {
  cardId:
    'triz-1.0|triz|schedulePriority|trade_off|tc-dur-vs-res|hash-artifact-001|schedule_vs_resource',
  action: 'answer',
  value: 'resource_first',
  adoptedDefault: false,
  sourceHash: 'triz-sh-old-version',
  marker: null,
}

// ---------------------------------------------------------------------------
// Fixture: Mixed ordinary/TRIZ card DTOs
// ---------------------------------------------------------------------------

export const fixtureTrizCardDTO: TrizClarificationCardDTO = {
  cardId:
    'triz-1.0|triz|schedulePriority|trade_off|tc-dur-vs-res|hash-artifact-001|schedule_vs_resource',
  field: 'schedulePriority',
  category: 'critical',
  trizCategory: 'trade_off',
  source: 'triz',
  title: '工期与资源负载取舍',
  description: '系统检测到「压缩工期会导致资源负载过高」的矛盾。',
  impactScope: [
    { domain: '工期/进度', severity: 'high' },
    { domain: '资源负载', severity: 'high' },
  ],
  questionType: 'single_choice',
  quickOptions: [
    {
      label: '优先保证工期',
      value: 'schedule_first',
      description: '适合关键里程碑不可延期的场景。',
    },
    {
      label: '优先控制负载',
      value: 'resource_first',
      description: '适合团队容量已经接近上限的场景。',
      recommended: true,
    },
  ],
  defaultValue: 'resource_first',
  defaultValueMarker: {
    confidence: 0.72,
    source: 'default',
    reason: '根据矛盾严重度和常见工程实践，优先控制资源负载以避免项目风险',
    needsConfirmation: true,
  },
  confidence: 0.85,
  reasoning: '基于已确认矛盾「tc-dur-vs-res」',
  allowSkip: false,
  isRequired: true,
  sourceRefs: [
    {
      key: 'tc-dur-vs-res',
      type: 'technical',
      severity: 'critical',
      title: '压缩工期会导致资源负载过高',
    },
  ],
  analysisArtifactRef: 'triz-artifact-001',
  warningCodes: [],
  warnings: [],
  answerEffect: {
    type: 'schedule_priority',
    description: '工期与资源负载的取舍将影响项目排期和资源分配',
    severity: 'high',
  },
  sourceHash: 'triz-sh-a1b2c3d4',
}

// ---------------------------------------------------------------------------
// Fixture: Context merge output
// ---------------------------------------------------------------------------

export const fixtureContextMergeOutput: TrizContextMergeOutput = {
  cardId:
    'triz-1.0|triz|schedulePriority|trade_off|tc-dur-vs-res|hash-artifact-001|schedule_vs_resource',
  sourceRefs: [
    {
      key: 'tc-dur-vs-res',
      type: 'technical',
      severity: 'critical',
      title: '压缩工期会导致资源负载过高',
    },
  ],
  analysisArtifactRef: 'triz-artifact-001',
  action: 'answer',
  value: 'schedule_first',
  marker: {
    confidence: 1,
    source: 'explicit',
    reason: '用户明确选择优先保证工期',
    needsConfirmation: false,
  },
  sourceHash: 'triz-sh-a1b2c3d4',
  stale: false,
  warningCodes: [],
  answerEffect: {
    type: 'schedule_priority',
    description: '工期与资源负载的取舍将影响项目排期和资源分配',
    severity: 'high',
  },
}

// ---------------------------------------------------------------------------
// Fixture: Scope vs quality candidate
// ---------------------------------------------------------------------------

export const fixtureScopeQualityCandidate: TrizClarificationCandidate = {
  cardId:
    'triz-1.0|triz|scopePriority|trade_off|tc-scope-vs-quality|out-scope-vs-quality-001|scope_vs_quality',
  sourceRefs: [fixtureStaleContradictionRef],
  analysisHint: null,
  trizCategory: 'trade_off',
  mappedField: 'scopePriority',
  title: '范围与质量的取舍',
  description: '系统检测到「扩大范围会降低交付质量」的矛盾。请确认当前项目的范围与质量优先级。',
  impactScope: [
    { domain: '范围', severity: 'high' },
    { domain: '质量', severity: 'high' },
  ],
  questionType: 'single_choice',
  quickOptions: [
    {
      label: '优先覆盖更多需求',
      value: 'scope_first',
      description: '适合业务窗口更看重范围覆盖的场景。',
    },
    {
      label: '优先保证交付质量',
      value: 'quality_first',
      description: '适合验收、稳定性或返工风险更高的场景。',
      recommended: true,
    },
  ],
  defaultValue: 'quality_first',
  confidence: 0.75,
  reasoning: '基于矛盾 snapshot（已过期标记）。',
  severity: 'high',
  allowSkip: false,
  isRequired: true,
  warningCodes: ['TRIZ_SOURCE_CONTRADICTION_STALE'],
  warnings: [
    {
      code: 'TRIZ_SOURCE_CONTRADICTION_STALE',
      message: '来源矛盾已过期，建议刷新矛盾数据',
      source: 'triz-clarification-service',
    },
  ],
  answerEffect: {
    type: 'quality_priority',
    description: '范围与质量的取舍将影响需求清单和验收标准',
    severity: 'high',
  },
  sourceHash: 'triz-sh-c3d4e5f6',
}

// ---------------------------------------------------------------------------
// Helper to build candidate list for ordering tests
// ---------------------------------------------------------------------------

export function makeTestCandidate(
  cardId: string,
  severity: ContradictionSeverity,
  confidence: number,
  sourceHash: string,
): TrizClarificationCandidate {
  return {
    cardId,
    sourceRefs: [],
    analysisHint: null,
    trizCategory: 'trade_off',
    mappedField: 'priority',
    title: `测试 ${cardId}`,
    description: '',
    impactScope: [],
    questionType: 'single_choice',
    quickOptions: [],
    defaultValue: null,
    confidence,
    reasoning: '',
    severity,
    allowSkip: false,
    isRequired: true,
    warningCodes: [],
    warnings: [],
    answerEffect: { type: 'schedule_priority', description: '影响', severity: 'medium' },
    sourceHash,
  }
}
