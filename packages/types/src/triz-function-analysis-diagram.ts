// @aiproj/types — V3 TRIZ 功能分析图共享契约（前后端共享）
// v3-triz-function-analysis-diagram / §2.1–§2.7
//
// 设计要点：
// - 功能分析图表示项目中的组件-功能关系：组件节点 + 功能边 + 问题候选。
// - 功能边区分 useful/harmful/insufficient/excessive 四种类型。
// - Run 持久分析运行快照，Node/Edge/Issue 持久快照，均非正式架构记录。
// - 确定性优先：输入签名 / idempotency key / node key / edge key / issue key / output hash。
// - AI 解释可选且可降级；handoff 只做候选预览。
// - 所有字段低敏，不泄露完整证据/敏感路径/不可访问来源。

import { deterministicHash } from './triz-contradiction.js'
import type { ContradictionInputWarning } from './triz-contradiction.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 功能分析运行状态 */
export const FUNCTION_ANALYSIS_RUN_STATUSES = [
  'queued',
  'completed',
  'completed_with_warnings',
  'failed',
  'stale',
  'archived',
] as const
export type FunctionAnalysisRunStatus = (typeof FUNCTION_ANALYSIS_RUN_STATUSES)[number]

/** 功能边类型（TRIZ 功能分类） */
export const FUNCTION_EDGE_TYPES = ['useful', 'harmful', 'insufficient', 'excessive'] as const
export type FunctionEdgeType = (typeof FUNCTION_EDGE_TYPES)[number]

/** 组件节点类型 */
export const COMPONENT_NODE_TYPES = [
  'system_component',
  'supersystem_component',
  'user_supplied',
  'inferred',
] as const
export type ComponentNodeType = (typeof COMPONENT_NODE_TYPES)[number]

/** 组件作用域 */
export const COMPONENT_SCOPES = ['internal', 'external', 'environment'] as const
export type ComponentScope = (typeof COMPONENT_SCOPES)[number]

/** 节点状态 */
export const NODE_STATUSES = ['active', 'deprecated', 'external'] as const
export type NodeStatus = (typeof NODE_STATUSES)[number]

/** 问题候选类型 */
export const FUNCTION_ISSUE_TYPES = [
  'trim_candidate',
  'harmful_function',
  'insufficient_function',
  'excessive_function',
  'duplicate_function',
  'isolated_component',
  'single_point_dependency',
] as const
export type FunctionIssueType = (typeof FUNCTION_ISSUE_TYPES)[number]

/** 问题严重度 */
export const FUNCTION_ISSUE_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type FunctionIssueSeverity = (typeof FUNCTION_ISSUE_SEVERITIES)[number]

/** 问题候选审查状态 */
export const FUNCTION_ISSUE_CANDIDATE_STATUSES = [
  'unreviewed',
  'reviewed',
  'dismissed',
  'needs_more_info',
  'blocked_stale',
] as const
export type FunctionIssueCandidateStatus = (typeof FUNCTION_ISSUE_CANDIDATE_STATUSES)[number]

/** 功能分析警告代码 */
export const FUNCTION_ANALYSIS_WARNING_CODES = [
  'INSUFFICIENT_COMPONENT_SOURCE',
  'SOURCE_UNAVAILABLE',
  'SOURCE_STALE',
  'PERMISSION_RESTRICTED',
  'INSUFFICIENT_EVIDENCE',
  'AI_EXPLANATION_FALLBACK',
  'AI_EXPLANATION_BLOCKED',
  'HANDOFF_BLOCKED_STALE',
  'LARGE_GRAPH_TRUNCATED',
] as const
export type FunctionAnalysisWarningCode = (typeof FUNCTION_ANALYSIS_WARNING_CODES)[number]

/** 功能分析规则集版本 */
export const FUNCTION_ANALYSIS_RULESET_VERSION = '1.0.0'

/** 布局版本（确定性布局算法版本） */
export const FUNCTION_ANALYSIS_LAYOUT_VERSION = '1.0.0'

// ---------------------------------------------------------------------------
// 共享类型
// ---------------------------------------------------------------------------

/** 低敏来源 ref */
export interface FunctionAnalysisSourceRef {
  sourceType: string
  sourceId: number
  lowSensitiveTitle: string
  hash: string
}

/** 组件节点 */
export interface FunctionComponentNode {
  /** 稳定节点 key（确定性派生） */
  nodeKey: string
  /** 低敏标签 */
  label: string
  /** 组件类型 */
  componentType: ComponentNodeType
  /** 作用域 */
  scope: ComponentScope
  /** 节点状态 */
  status: NodeStatus
  /** 来源 refs（低敏摘要） */
  sourceRefs: FunctionAnalysisSourceRef[]
  /** 来源 hashes */
  sourceHashes: Record<string, string>
  /** 指标：入度/出度/权重 */
  metrics: {
    inDegree: number
    outDegree: number
    totalWeight: number
  }
  /** 布局位置（由确定性布局算法计算） */
  position: { x: number; y: number } | null
  /** 警告代码 */
  warningCodes: FunctionAnalysisWarningCode[]
}

/** 功能关系边 */
export interface FunctionRelationEdge {
  /** 稳定边 key（确定性派生） */
  edgeKey: string
  /** 来源节点 key */
  fromNodeKey: string
  /** 目标节点 key */
  toNodeKey: string
  /** 功能类型 */
  functionType: FunctionEdgeType
  /** 低敏标签 */
  label: string
  /** 强度（0–1） */
  strength: number
  /** 置信度（0–1） */
  confidence: number
  /** 低敏证据 refs */
  evidenceRefs: FunctionAnalysisSourceRef[]
  /** 来源 hashes */
  sourceHashes: Record<string, string>
  /** 警告代码 */
  warningCodes: FunctionAnalysisWarningCode[]
}

/** 功能问题候选 */
export interface FunctionIssueCandidate {
  /** 稳定问题 key（确定性派生） */
  issueKey: string
  /** 问题类型 */
  issueType: FunctionIssueType
  /** 严重度 */
  severity: FunctionIssueSeverity
  /** 置信度（0–1） */
  confidence: number
  /** 影响得分（0–1） */
  impactScore: number
  /** 审查状态 */
  status: FunctionIssueCandidateStatus
  /** 关联节点 refs */
  nodeRefs: string[]
  /** 关联边 refs */
  edgeRefs: string[]
  /** 确定性理由摘要（低敏中文） */
  rationaleSummary: string
  /** 建议动作 */
  suggestedActions: Array<{
    action: string
    rationale: string
    confidence: number
  }>
  /** 来源 hashes */
  sourceHashes: Record<string, string>
  /** AI 解释 ref（可选） */
  aiExplanationRef: string | null
  /** 审查者 */
  reviewedBy: number | null
  /** 审查时间 */
  reviewedAt: string | null
  /** 警告代码 */
  warningCodes: FunctionAnalysisWarningCode[]
  /** 确定性输出 hash */
  outputHash: string
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string | null
}

/** 图布局元数据 */
export interface FunctionAnalysisLayoutMetadata {
  layoutVersion: string
  algorithm: 'layered' | 'force_directed'
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  nodePositions: Record<string, { x: number; y: number }>
}

/** 功能分析运行 */
export interface FunctionAnalysisRun {
  id: number
  organizationId: number
  projectId: number
  actorId: number
  status: FunctionAnalysisRunStatus
  inputSignature: string
  outputHash: string
  ruleVersion: string
  layoutVersion: string
  idempotencyKey: string
  sourceSummary: Record<string, { count: number; hash: string }>
  warningSummary: Array<{ code: FunctionAnalysisWarningCode; message: string }>
  nodeCount: number
  edgeCount: number
  issueCount: number
  costSummary: FunctionAnalysisCost | null
  createdAt: string
  updatedAt: string | null
  completedAt: string | null
  archivedAt: string | null
}

/** AI 成本摘要 */
export interface FunctionAnalysisCost {
  provider: string | null
  model: string | null
  promptTokens: number | null
  completionTokens: number | null
  estimatedCost: number | null
  latencyMs: number | null
}

/** AI 解释 */
export interface FunctionIssueAiExplanation {
  narrative: string
  isFallback: boolean
  hallucinationChecked: boolean
  degradedReason: string | null
  referencedNodeKeys: string[]
  referencedEdgeKeys: string[]
  confidence: number
  provider: string | null
  model: string | null
  cost: FunctionAnalysisCost | null
}

/** Handoff 输入（Workbench/Decision/Draft 交接） */
export interface FunctionAnalysisHandoffInput {
  runId: number
  issueKey: string
  nodeRefs: string[]
  edgeRefs: string[]
  issueType: FunctionIssueType
  rationaleSummary: string
  suggestedActions: Array<{ action: string; rationale: string; confidence: number }>
  sourceHashes: Record<string, string>
  warnings: FunctionAnalysisWarningCode[]
  idempotencyKey: string
  actorId: number
  organizationId: number
  projectId: number
}

// ---------------------------------------------------------------------------
// 输入收集
// ---------------------------------------------------------------------------

/** Collector 输入 */
export interface FunctionAnalysisCollectorInput {
  organizationId: number
  projectId: number
  actorId: number
  /** 用户补充组件草稿 */
  manualComponents?: ManualComponentDraft[]
  /** 用户上下文（可选自由文本） */
  userContext?: string
}

/** 用户手工补充的组件草稿 */
export interface ManualComponentDraft {
  name: string
  description?: string
  relatesTo?: string[]
  functionType?: FunctionEdgeType
  strength?: number
}

/** Collector 输出 */
export interface FunctionAnalysisCollectorOutput {
  organizationId: number
  projectId: number
  actorId: number
  projectName: string
  // 项目组件来源
  taskComponents: Array<{
    taskId: number
    title: string
    hash: string
  }>
  wbsComponentCount: number
  // 依赖信息
  dependencySummary: Array<{
    fromTaskId: number
    toTaskId: number
    type: string
    hash: string
  }>
  // 资源信息
  resourceSummary: Array<{
    resourceId: number
    name: string
    hash: string
  }>
  // 风险信息
  riskSummary: Array<{
    riskId: number
    title: string
    probability: number
    impact: number
    hash: string
  }>
  // 矛盾引用
  contradictionRefs: Array<{
    contradictionId: number
    type: string
    hash: string
  }>
  // Compiler TRIZ artifact 引用
  compilerArtifactRefs: Array<{
    artifactId: number
    kind: string
    shortSummary: string
    hash: string
  }>
  // Workbench 来源
  workbenchRefs: Array<{
    schemeId: number
    title: string
    hash: string
  }>
  // 用户手工补充
  manualComponents: ManualComponentDraft[]
  userContext: string | null
  // 收集元数据
  warnings: ContradictionInputWarning[]
  sourceHashes: Record<string, string>
  collectedAt: string
}

// ---------------------------------------------------------------------------
// API 请求/响应
// ---------------------------------------------------------------------------

export interface CreateFunctionAnalysisRequest {
  manualComponents?: ManualComponentDraft[]
  userContext?: string
  idempotencyKey?: string
}

export interface CreateFunctionAnalysisResponse {
  data: FunctionAnalysisRun & {
    nodes: FunctionComponentNode[]
    edges: FunctionRelationEdge[]
    issues: FunctionIssueCandidate[]
  }
}

export interface ListFunctionAnalysesQuery {
  page?: number
  perPage?: number
  status?: FunctionAnalysisRunStatus
  sort?: string
}

export interface ListFunctionAnalysesResponse {
  data: FunctionAnalysisRun[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface FunctionAnalysisDetailResponse {
  data: FunctionAnalysisRun
}

export interface FunctionAnalysisGraphResponse {
  data: {
    nodes: FunctionComponentNode[]
    edges: FunctionRelationEdge[]
    layout: FunctionAnalysisLayoutMetadata
    issuesSummary: Array<{
      issueKey: string
      issueType: FunctionIssueType
      severity: FunctionIssueSeverity
      status: FunctionIssueCandidateStatus
      rationaleSummary: string
    }>
    warnings: FunctionAnalysisWarningCode[]
  }
}

export interface ListFunctionIssuesQuery {
  page?: number
  perPage?: number
  issueType?: FunctionIssueType
  severity?: FunctionIssueSeverity
  status?: FunctionIssueCandidateStatus
  stale?: boolean
  sort?: string
}

export interface ListFunctionIssuesResponse {
  data: FunctionIssueCandidate[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface FunctionIssueDetailResponse {
  data: FunctionIssueCandidate
}

export interface ExplainFunctionIssueResponse {
  data: {
    issueKey: string
    explanation: FunctionIssueAiExplanation
  }
}

export interface ReviewFunctionIssueRequest {
  action: 'reviewed' | 'dismissed' | 'needs_more_info'
  reason?: string
}

export interface ReviewFunctionIssueResponse {
  data: {
    issueKey: string
    status: FunctionIssueCandidateStatus
    reviewedBy: number
    reviewedAt: string
  }
}

export interface WorkbenchPreviewResponse {
  data: FunctionAnalysisHandoffInput & { targetType: 'workbench' }
}

export interface DecisionPreviewResponse {
  data: FunctionAnalysisHandoffInput & { targetType: 'decision_log' }
}

export interface DraftHandoffPreviewResponse {
  data: FunctionAnalysisHandoffInput & { targetType: 'draft_layer' }
}

// ---------------------------------------------------------------------------
// 确定性纯函数（§2.2–§2.4）
// ---------------------------------------------------------------------------

/**
 * 计算功能分析的输入签名。
 */
export function computeFunctionAnalysisInputSignature(
  collected: FunctionAnalysisCollectorOutput,
): string {
  const sorted = {
    org: collected.organizationId,
    project: collected.projectId,
    actor: collected.actorId,
    projectName: collected.projectName,
    taskCount: collected.taskComponents.length,
    taskHashes: collected.taskComponents.map((t) => t.hash).sort(),
    wbsCount: collected.wbsComponentCount,
    depCount: collected.dependencySummary.length,
    depHashes: collected.dependencySummary.map((d) => d.hash).sort(),
    resourceHashes: collected.resourceSummary.map((r) => r.hash).sort(),
    riskHashes: collected.riskSummary.map((r) => r.hash).sort(),
    contradictionHashes: collected.contradictionRefs.map((c) => c.hash).sort(),
    compilerHashes: collected.compilerArtifactRefs.map((a) => a.hash).sort(),
    workbenchHashes: collected.workbenchRefs.map((w) => w.hash).sort(),
    manualNames: collected.manualComponents.map((m) => m.name).sort(),
    userContext: collected.userContext ?? '',
    warnings: [...collected.warnings].map((w) => `${w.source ?? ''}:${w.code}:${w.message}`).sort(),
  }
  return `fad-${deterministicHash(JSON.stringify(sorted))}`
}

/**
 * 计算功能分析运行的幂等 key。
 */
export function computeFunctionAnalysisIdempotencyKey(
  organizationId: number,
  projectId: number,
  actorId: number,
  inputSignature: string,
  userProvidedKey?: string,
): string {
  const base = userProvidedKey ?? `${organizationId}|${projectId}|${actorId}|${inputSignature}`
  return `fad-idem-${deterministicHash(base)}`
}

/**
 * 计算组件节点的稳定 key。
 */
export function computeFunctionNodeKey(
  componentType: ComponentNodeType,
  label: string,
  index: number,
): string {
  return `fcn-${deterministicHash([componentType, label, String(index)].join('|'))}`
}

/**
 * 计算功能边的稳定 key。
 */
export function computeFunctionEdgeKey(
  fromNodeKey: string,
  toNodeKey: string,
  functionType: FunctionEdgeType,
): string {
  return `fce-${deterministicHash([fromNodeKey, toNodeKey, functionType].join('|'))}`
}

/**
 * 计算问题候选的稳定 key。
 */
export function computeFunctionIssueKey(
  issueType: FunctionIssueType,
  nodeRefs: string[],
  edgeRefs: string[],
): string {
  const sortedNodes = [...nodeRefs].sort().join(',')
  const sortedEdges = [...edgeRefs].sort().join(',')
  return `fci-${deterministicHash([issueType, sortedNodes, sortedEdges].join('|'))}`
}

/**
 * 计算功能分析图的确定性输出 hash（基于所有 node/edge/issue keys）。
 */
export function computeFunctionAnalysisOutputHash(
  nodeKeys: string[],
  edgeKeys: string[],
  issueKeys: string[],
): string {
  const allKeys = [...nodeKeys.sort(), ...edgeKeys.sort(), ...issueKeys.sort()].join('|')
  return `fao-${deterministicHash(allKeys)}`
}

/**
 * 严重度到数值映射。
 */
export function functionIssueSeverityToScore(severity: FunctionIssueSeverity): number {
  const map: Record<FunctionIssueSeverity, number> = {
    critical: 1.0,
    high: 0.75,
    medium: 0.5,
    low: 0.25,
  }
  return map[severity] ?? 0.25
}

/**
 * 计算问题候选的 impactScore（0–1）。
 * 综合严重度(50%)、置信度(30%)、受影响节点/边数量(20%)。
 */
export function computeFunctionIssueImpactScore(
  severity: FunctionIssueSeverity,
  confidence: number,
  affectedNodeCount: number,
  affectedEdgeCount: number,
): number {
  const sevScore = functionIssueSeverityToScore(severity) * 0.5
  const confScore = (confidence ?? 0.5) * 0.3
  const scopeCount = affectedNodeCount + affectedEdgeCount
  const scopeScore = Math.min(1, scopeCount / 8) * 0.2
  return Number((sevScore + confScore + scopeScore).toFixed(2))
}

/**
 * 功能问题候选稳定排序比较器：严重度 → 置信度 → 影响分数 → issueType → issueKey。
 */
export function compareFunctionIssueCandidate(
  a: FunctionIssueCandidate,
  b: FunctionIssueCandidate,
): number {
  const sevOrder: FunctionIssueSeverity[] = ['critical', 'high', 'medium', 'low']
  const bySev = sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity)
  if (bySev !== 0) return bySev
  const byConf = (b.confidence ?? 0) - (a.confidence ?? 0)
  if (Math.abs(byConf) > 1e-9) return byConf
  const byImpact = (b.impactScore ?? 0) - (a.impactScore ?? 0)
  if (Math.abs(byImpact) > 1e-9) return byImpact
  if (a.issueType !== b.issueType) return a.issueType.localeCompare(b.issueType)
  return a.issueKey.localeCompare(b.issueKey)
}

/**
 * 聚合警告代码列表（去重、排序）。
 */
export function aggregateFunctionAnalysisWarnings(
  collectorWarnings: ContradictionInputWarning[],
  additionalCodes: FunctionAnalysisWarningCode[],
): FunctionAnalysisWarningCode[] {
  const codes = new Set(additionalCodes)
  for (const w of collectorWarnings) {
    codes.add(w.code as FunctionAnalysisWarningCode)
  }
  return [...codes].sort()
}

/**
 * 生成低敏警告摘要文本。
 */
export function summarizeFunctionAnalysisWarnings(codes: FunctionAnalysisWarningCode[]): string {
  if (codes.length === 0) return ''
  const labels: Record<FunctionAnalysisWarningCode, string> = {
    INSUFFICIENT_COMPONENT_SOURCE: '组件来源不足',
    SOURCE_UNAVAILABLE: '来源模块不可用',
    SOURCE_STALE: '来源数据已过期',
    PERMISSION_RESTRICTED: '部分来源因权限被隐藏',
    INSUFFICIENT_EVIDENCE: '证据不足',
    AI_EXPLANATION_FALLBACK: 'AI 解释已降级',
    AI_EXPLANATION_BLOCKED: 'AI 解释被预算/权限阻断',
    HANDOFF_BLOCKED_STALE: '交接因来源过期被阻止',
    LARGE_GRAPH_TRUNCATED: '大图已截断',
  }
  return codes
    .map((c) => labels[c] ?? c)
    .sort()
    .join('；')
}

/**
 * 判定功能分析来源是否陈旧（基于 hash 比对）。
 */
export function isFunctionAnalysisStale(
  sourceHashes: Record<string, string>,
  currentHashes: Record<string, string>,
): boolean {
  for (const [key, hash] of Object.entries(sourceHashes)) {
    if (currentHashes[key] !== undefined && currentHashes[key] !== hash) return true
  }
  return false
}

/**
 * 生成低敏摘要（用于审计/导出，不含完整证据）。
 */
export function generateLowSensitivitySummary(
  run: FunctionAnalysisRun,
  nodeCount: number,
  edgeCount: number,
  issueCount: number,
): string {
  const warnings = run.warningSummary.length > 0 ? `（含 ${run.warningSummary.length} 条警告）` : ''
  return `功能分析运行 #${run.id}：${nodeCount} 个组件节点，${edgeCount} 条功能边，${issueCount} 个问题候选${warnings}`
}

// ---------------------------------------------------------------------------
// 低敏夹具构造器（§2.4）
// ---------------------------------------------------------------------------

export function makeFunctionAnalysisCollectorOutput(
  overrides?: Partial<FunctionAnalysisCollectorOutput>,
): FunctionAnalysisCollectorOutput {
  return {
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    projectName: '测试项目',
    taskComponents: [
      { taskId: 1, title: '前端开发', hash: 't1hash' },
      { taskId: 2, title: '后端开发', hash: 't2hash' },
      { taskId: 3, title: '测试', hash: 't3hash' },
    ],
    wbsComponentCount: 5,
    dependencySummary: [
      { fromTaskId: 1, toTaskId: 2, type: 'finish_to_start', hash: 'dep1' },
      { fromTaskId: 2, toTaskId: 3, type: 'finish_to_start', hash: 'dep2' },
    ],
    resourceSummary: [
      { resourceId: 1, name: '前端开发', hash: 'r1hash' },
      { resourceId: 2, name: '后端开发', hash: 'r2hash' },
    ],
    riskSummary: [
      { riskId: 1, title: '需求变更风险', probability: 0.7, impact: 0.8, hash: 'risk1' },
      { riskId: 2, title: '技术债务风险', probability: 0.5, impact: 0.6, hash: 'risk2' },
    ],
    contradictionRefs: [{ contradictionId: 1, type: 'technical', hash: 'c1hash' }],
    compilerArtifactRefs: [
      { artifactId: 1, kind: 'triz_analysis', shortSummary: '架构分析', hash: 'art1' },
    ],
    workbenchRefs: [{ schemeId: 1, title: '方案A', hash: 'wb1hash' }],
    manualComponents: [
      {
        name: '日志模块',
        description: '集中日志收集',
        relatesTo: ['后端开发'],
        functionType: 'useful',
        strength: 0.8,
      },
    ],
    userContext: null,
    warnings: [],
    sourceHashes: { tasks: 'abc', resources: 'def', risks: 'ghi' },
    collectedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makeFunctionComponentNodeFixture(
  overrides?: Partial<FunctionComponentNode>,
): FunctionComponentNode {
  return {
    nodeKey: 'fcn-test001',
    label: '前端渲染引擎',
    componentType: 'system_component',
    scope: 'internal',
    status: 'active',
    sourceRefs: [
      { sourceType: 'task', sourceId: 1, lowSensitiveTitle: '前端开发', hash: 't1hash' },
    ],
    sourceHashes: { tasks: 'abc' },
    metrics: { inDegree: 1, outDegree: 3, totalWeight: 2.5 },
    position: { x: 100, y: 200 },
    warningCodes: [],
    ...overrides,
  }
}

export function makeFunctionRelationEdgeFixture(
  overrides?: Partial<FunctionRelationEdge>,
): FunctionRelationEdge {
  return {
    edgeKey: 'fce-test001',
    fromNodeKey: 'fcn-test001',
    toNodeKey: 'fcn-test002',
    functionType: 'useful',
    label: '提供数据',
    strength: 0.9,
    confidence: 0.85,
    evidenceRefs: [
      { sourceType: 'task', sourceId: 1, lowSensitiveTitle: '前端开发', hash: 't1hash' },
    ],
    sourceHashes: { tasks: 'abc' },
    warningCodes: [],
    ...overrides,
  }
}

export function makeFunctionIssueCandidateFixture(
  overrides?: Partial<FunctionIssueCandidate>,
): FunctionIssueCandidate {
  return {
    issueKey: 'fci-test001',
    issueType: 'harmful_function',
    severity: 'high',
    confidence: 0.8,
    impactScore: 0.72,
    status: 'unreviewed',
    nodeRefs: ['fcn-test001', 'fcn-test002'],
    edgeRefs: ['fce-test001'],
    rationaleSummary: '前端渲染引擎与后端 API 之间存在高延迟有害功能，影响用户体验。',
    suggestedActions: [
      {
        action: 'trim_or_replace',
        rationale: '评估是否可以替换为更轻量的渲染方案',
        confidence: 0.75,
      },
      {
        action: 'add_buffer',
        rationale: '为渲染关键路径增加缓冲资源',
        confidence: 0.65,
      },
    ],
    sourceHashes: { tasks: 'abc' },
    aiExplanationRef: null,
    reviewedBy: null,
    reviewedAt: null,
    warningCodes: [],
    outputHash: 'fco-test-output',
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  }
}

export function makeFunctionAnalysisRunFixture(
  overrides?: Partial<FunctionAnalysisRun>,
): FunctionAnalysisRun {
  return {
    id: 1,
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    status: 'completed_with_warnings',
    inputSignature: 'fad-test-sig',
    outputHash: 'fao-test',
    ruleVersion: FUNCTION_ANALYSIS_RULESET_VERSION,
    layoutVersion: FUNCTION_ANALYSIS_LAYOUT_VERSION,
    idempotencyKey: 'fad-idem-test',
    sourceSummary: {
      tasks: { count: 3, hash: 'abc' },
      resources: { count: 2, hash: 'def' },
      risks: { count: 2, hash: 'ghi' },
    },
    warningSummary: [],
    nodeCount: 5,
    edgeCount: 8,
    issueCount: 3,
    costSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    completedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  }
}

export function makeFunctionAnalysisHandoffInputFixture(
  overrides?: Partial<FunctionAnalysisHandoffInput>,
): FunctionAnalysisHandoffInput {
  return {
    runId: 1,
    issueKey: 'fci-test001',
    nodeRefs: ['fcn-test001', 'fcn-test002'],
    edgeRefs: ['fce-test001'],
    issueType: 'harmful_function',
    rationaleSummary: '前端渲染引擎与后端 API 之间存在高延迟有害功能。',
    suggestedActions: [
      { action: 'trim_or_replace', rationale: '评估轻量渲染方案', confidence: 0.75 },
    ],
    sourceHashes: { tasks: 'abc' },
    warnings: [],
    idempotencyKey: 'fad-idem-test',
    actorId: 1,
    organizationId: 1,
    projectId: 1,
    ...overrides,
  }
}
