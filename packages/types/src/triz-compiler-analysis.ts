// @aiproj/types — V2 TRIZ Compiler Analysis Layer 共享契约（前后端共享）
// v2-triz-compiler-analysis-layer / D1–D9
//
// 设计要点：
// - TrizAnalysisArtifact 是 Compiler 运行态 artifact，不写入正式业务表。
// - 解决路径是建议型（advisory），不包含可执行数据库 patch。
// - 确定性模式零模型调用；hybrid 模式可选 AI 综合，失败降级保留确定性输出。
// - source hashes 用于 resume/replay 时的 idempotency 校验。
// - 前端展示为审查/追溯面，不提供自动执行按钮。

import type {
  ContradictionSeverity,
  ContradictionStatus,
  ContradictionType,
  InventivePrincipleId,
  ProjectParameterKey,
} from './triz-contradiction.js'

// ---------------------------------------------------------------------------
// 枚举与常量
// ---------------------------------------------------------------------------

/** TRIZ 分析执行模式 */
export const TRIZ_ANALYSIS_MODES = ['deterministic', 'hybrid'] as const
export type TrizAnalysisMode = (typeof TRIZ_ANALYSIS_MODES)[number]

/** TRIZ 分析 artifact 状态 */
export const TRIZ_ANALYSIS_STATUSES = [
  'pending',
  'completed',
  'failed',
  'needs_human_review',
] as const
export type TrizAnalysisStatus = (typeof TRIZ_ANALYSIS_STATUSES)[number]

/** Handoff 状态 */
export const TRIZ_HANDOFF_STATUSES = ['none', 'candidate_created', 'stale', 'handed_off'] as const
export type TrizHandoffStatus = (typeof TRIZ_HANDOFF_STATUSES)[number]

/** warning code 枚举（稳定标识，前端按 code 显式处理） */
export const TRIZ_ANALYSIS_WARNING_CODES = [
  'NEEDS_HUMAN_REVIEW',
  'STALE_SOURCE_CONTRADICTION',
  'DRAFT_INPUT_INCLUDED',
  'AI_SUMMARY_FALLBACK',
  'BUDGET_BLOCKED',
  'MODEL_FAILURE',
  'INVALID_AI_OUTPUT',
  'HALLUCINATION_WARNING',
  'CONTEXT_UNAVAILABLE',
  'NO_CONTRADICTIONS_FOUND',
  'EMPTY_RESOLUTION_PATHS',
  'SOURCE_HASH_MISMATCH',
] as const
export type TrizAnalysisWarningCode = (typeof TRIZ_ANALYSIS_WARNING_CODES)[number]

/** Warning/error severity level */
export const TRIZ_WARNING_SEVERITIES = ['blocking', 'warning', 'info'] as const
export type TrizWarningSeverity = (typeof TRIZ_WARNING_SEVERITIES)[number]

/** 发明原理相关度等级 */
export const PRINCIPLE_RELEVANCE_LEVELS = ['high', 'medium', 'low'] as const
export type PrincipleRelevanceLevel = (typeof PRINCIPLE_RELEVANCE_LEVELS)[number]

// ---------------------------------------------------------------------------
// 结构化类型
// ---------------------------------------------------------------------------

/** 单个 warning 条目 */
export interface TrizAnalysisWarning {
  code: TrizAnalysisWarningCode
  severity: TrizWarningSeverity
  message: string
  /** 关联的 contradiction key（可选） */
  sourceKey?: string
  /** 关联的 resolution path id（可选） */
  pathId?: string
}

/** 来源矛盾低敏 ref（Compiler 消费版，不包含完整证据或 AI 解释正文） */
export interface TrizAnalysisSourceRef {
  /** 矛盾记录稳定 key */
  key: string
  /** 矛盾标题 */
  title: string
  /** 矛盾类型 */
  type: ContradictionType
  /** 当前状态 */
  status: ContradictionStatus
  /** 严重度 */
  severity: ContradictionSeverity
  /** 置信度（0-1） */
  confidence: number
  /** 是否过期 */
  stale: boolean
  /** 过期原因 */
  staleReason: string | null
  /** 规则版本 */
  ruleVersion: string
  /** 输入签名 */
  inputSignature: string
  /** 输出 hash */
  outputHash: string | null
  /** 改善参数 key（技术矛盾） */
  improvingParameterKey: ProjectParameterKey | null
  /** 恶化参数 key（技术矛盾） */
  worseningParameterKey: ProjectParameterKey | null
  /** 参数 key（物理矛盾） */
  parameterKey: ProjectParameterKey | null
  /** 对立要求 A（物理矛盾） */
  requirementA: string | null
  /** 对立要求 B（物理矛盾） */
  requirementB: string | null
  /** 候选原理 refs（仅 id + 名称，不包含完整描述） */
  suggestedPrinciples: Array<{
    principleId: InventivePrincipleId
    name: string
  }>
  /** 低敏 evidence refs */
  evidenceRefs: string[]
  /** 矛盾记录 id（用于追溯） */
  contradictionId: number
}

/** 参数张力摘要（给前端展示用，人读） */
export interface ParameterTensionSummary {
  /** 改善参数 key */
  improvingKey: ProjectParameterKey | null
  /** 恶化参数 key */
  worseningKey: ProjectParameterKey | null
  /** 技术矛盾中文摘要 */
  technicalSummary: string
  /** 物理矛盾中文摘要 */
  physicalSummary: string | null
  /** 关联的矛盾 key 列表 */
  sourceKeys: string[]
}

/** 候选原理条目（带相关度） */
export interface PrincipleCandidate {
  principleId: InventivePrincipleId
  name: string
  /** 中文名称（可选，展示用） */
  chineseName: string | null
  relevance: PrincipleRelevanceLevel
  /** 关联的矛盾 key 列表 */
  sourceKeys: string[]
}

/** 建议型解决路径（不可直接执行 — 只包含描述性建议） */
export interface TrizResolutionPath {
  /** 路径稳定 ID（在同 artifact 内唯一） */
  pathId: string
  /** 路径名称 */
  name: string
  /** 中文描述 */
  description: string
  /** 建议类型（如 "split", "buffer", "scope_window", "cr_draft"） */
  suggestionType: string
  /** 适用条件 */
  applicability: string[]
  /** 不适用条件 */
  nonApplicability: string[]
  /** 关联的矛盾 key 列表 */
  sourceKeys: string[]
  /** 关联的原理 id 列表 */
  principleIds: InventivePrincipleId[]
  /** 需要人工复核 */
  requiresHumanReview: boolean
  /** 警告列表 */
  warnings: TrizAnalysisWarning[]
}

/** Handoff 元数据 */
export interface TrizHandoffMeta {
  status: TrizHandoffStatus
  /** Draft Layer session ref（创建后填充） */
  draftSessionRef: string | null
  /** 选中的 resolution path id */
  selectedPathId: string | null
  /** handoff 创建时间 */
  handedOffAt: string | null
  /** 阻止 handoff 的原因 */
  blockedReason: string | null
}

/** AI 综合说明（hybrid 模式可选） */
export interface TrizAiNarrative {
  /** AI 生成的中文综合分析 */
  summary: string
  /** 综合说明的来源 provider */
  provider: string
  /** 使用的模型 */
  model: string
  /** 是否经过 HL 校验 */
  hallucinationChecked: boolean
  /** 校验结果 */
  hallucinationPassed: boolean
  /** Token 用量 */
  tokenUsage: {
    input: number
    output: number
    total: number
  } | null
}

/** Dashboard 摘要用的紧凑版 artifact summary */
export interface TrizCompilerAnalysisSummary {
  artifactId: string
  version: number
  status: TrizAnalysisStatus
  warningCount: number
  blockingWarningCount: number
  topTensions: string[]
  sourceContradictionCount: number
  resolutionPathCount: number
  handoffStatus: TrizHandoffStatus
  hasAiNarrative: boolean
  calculatedAt: string
  stale: boolean
}

// ---------------------------------------------------------------------------
// 主 Artifact Schema
// ---------------------------------------------------------------------------

/**
 * TRIZ Compiler Analysis Artifact —— 完整输出结构。
 * 保存为 Compiler 运行态 artifact（compiler_artifacts 表），不写入正式业务表。
 */
export interface TrizAnalysisArtifact {
  /** Schema 版本 */
  schemaVersion: string
  /** 执行模式 */
  mode: TrizAnalysisMode
  /** 状态 */
  status: TrizAnalysisStatus
  /** 来源矛盾低敏 refs（仅已确认/可见） */
  sourceContradictions: TrizAnalysisSourceRef[]
  /** 参数张力摘要 */
  parameterTensions: ParameterTensionSummary[]
  /** 候选原理 */
  principleCandidates: PrincipleCandidate[]
  /** 建议型解决路径（不可直接执行） */
  resolutionPaths: TrizResolutionPath[]
  /** 全局 warnings */
  warnings: TrizAnalysisWarning[]
  /** 需要人工复核 */
  requiresHumanReview: boolean
  /** Source hashes（稳定性检测用） */
  sourceHashes: {
    /** 输入签名列表 */
    inputSignatures: string[]
    /** 输出 hash */
    outputHash: string
    /** 内容 hash */
    contentHash: string
  }
  /** Handoff 元数据 */
  handoff: TrizHandoffMeta
  /** AI 综合说明（仅 hybrid 模式且成功时） */
  aiNarrative: TrizAiNarrative | null
  /** 创建时间 */
  createdAt: string
}

// ---------------------------------------------------------------------------
// DTO — API 请求/响应
// ---------------------------------------------------------------------------

/** 列表查询响应 */
export interface TrizAnalysisListResponse {
  data: TrizAnalysisArtifact[]
  meta: {
    total: number
    runId: number
  }
}

/** 详情响应 */
export interface TrizAnalysisDetailResponse {
  data: TrizAnalysisArtifact
}

/** Handoff 请求 */
export interface TrizDraftHandoffRequest {
  /** 选中的 resolution path id */
  selectedPathId: string
  /** 可选的备注 */
  note?: string
}

/** Handoff 响应 */
export interface TrizDraftHandoffResponse {
  data: {
    handoffStatus: TrizHandoffStatus
    draftSessionRef: string | null
    blockedReason: string | null
  }
}

/** Dashboard 摘要响应 */
export interface TrizDashboardSummaryResponse {
  data: {
    trizCompilerSummary: TrizCompilerAnalysisSummary | null
    /** 是否有查看权限 */
    hasViewPermission: boolean
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * Warning code 排序：blocking > warning > info。
 * 用于前端渲染时将最严重的 warning 排在前面。
 */
const WARNING_SEVERITY_RANK: Record<TrizWarningSeverity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
}

export function sortWarningsBySeverity(warnings: TrizAnalysisWarning[]): TrizAnalysisWarning[] {
  return [...warnings].sort(
    (a, b) => WARNING_SEVERITY_RANK[a.severity] - WARNING_SEVERITY_RANK[b.severity],
  )
}

/**
 * 计算 stable content hash（排除时间戳等抖动字段）。
 */
export function computeTrizArtifactContentHash(artifact: {
  sourceContradictions: TrizAnalysisSourceRef[]
  parameterTensions: ParameterTensionSummary[]
  principleCandidates: PrincipleCandidate[]
  resolutionPaths: TrizResolutionPath[]
  warnings: TrizAnalysisWarning[]
}): string {
  // 使用 crypto 子系统的轻量 hash（运行时实现由具体平台提供）
  // 这里只定义序列化格式，具体 hash 调用者在服务层完成
  const stable = {
    sc: artifact.sourceContradictions.map((s) => ({
      k: s.key,
      i: s.inputSignature,
      o: s.outputHash,
      st: s.status,
      sv: s.severity,
    })),
    pt: artifact.parameterTensions.map((p) => ({
      i: p.improvingKey,
      w: p.worseningKey,
    })),
    pc: artifact.principleCandidates.map((p) => ({
      id: p.principleId,
      r: p.relevance,
    })),
    rp: artifact.resolutionPaths.map((r) => ({
      id: r.pathId,
      t: r.suggestionType,
      r: r.requiresHumanReview,
    })),
    w: artifact.warnings.map((w) => ({
      c: w.code,
      s: w.severity,
    })),
  }
  return JSON.stringify(stable)
}

/**
 * 从 warning code 获取中文标签（前端展示用）。
 */
export function getWarningCodeLabel(code: TrizAnalysisWarningCode): string {
  const labels: Record<TrizAnalysisWarningCode, string> = {
    NEEDS_HUMAN_REVIEW: '需要人工复核',
    STALE_SOURCE_CONTRADICTION: '来源矛盾已过期',
    DRAFT_INPUT_INCLUDED: '包含待确认候选矛盾',
    AI_SUMMARY_FALLBACK: 'AI 综合说明已降级',
    BUDGET_BLOCKED: '预算阻断 — AI 综合已跳过',
    MODEL_FAILURE: '模型调用失败 — AI 综合已跳过',
    INVALID_AI_OUTPUT: 'AI 输出格式无效 — 已降级',
    HALLUCINATION_WARNING: '反幻觉校验未通过 — AI 综合已降级',
    CONTEXT_UNAVAILABLE: '上下文不可用 — AI 综合已跳过',
    NO_CONTRADICTIONS_FOUND: '未发现项目矛盾',
    EMPTY_RESOLUTION_PATHS: '未生成可审查解决路径',
    SOURCE_HASH_MISMATCH: '来源矛盾 hash 不匹配',
  }
  return labels[code] ?? code
}

/**
 * 检查 resolution path 是否可以 handoff。
 * 不能 handoff 的条件：
 * - path 标记 requiresHumanReview
 * - 有关联的 blocking warnings
 * - source 已 stale
 */
export function canHandoffResolutionPath(
  path: TrizResolutionPath,
  warnings: TrizAnalysisWarning[],
): { allowed: boolean; reason: string | null } {
  if (path.requiresHumanReview) {
    return { allowed: false, reason: '该解决路径需要人工复核' }
  }

  const blockingWarnings = warnings.filter(
    (w) => w.severity === 'blocking' && (!w.pathId || w.pathId === path.pathId),
  )
  if (blockingWarnings.length > 0) {
    return {
      allowed: false,
      reason: `存在阻止自动 handoff 的 warning: ${blockingWarnings.map((w) => getWarningCodeLabel(w.code)).join('、')}`,
    }
  }

  const staleWarnings = warnings.filter(
    (w) => w.code === 'STALE_SOURCE_CONTRADICTION' && w.pathId === path.pathId,
  )
  if (staleWarnings.length > 0) {
    return { allowed: false, reason: '来源矛盾已过期，请重新运行分析' }
  }

  return { allowed: true, reason: null }
}
