/**
 * v3-copilot-custom-agent-eval-gate — 自建助手上线门禁共享契约
 *
 * 设计决策（design.md D1-D7）：
 * - D1：门禁结论绑定助手定义版本，不绑助手 ID
 * - D2：依赖（Skill / 知识包）变更使门禁失效
 * - D3：L3 进出各设一道断言（数据集允许 L3，产物不得进生产）
 * - D4：判定确定性 = f(助手版本, 数据集版本, 评分器配置)
 * - D5：门禁结果逐项可解释
 * - D6：真实大规模评测属授权门，默认 fixture provider
 * - D7：门禁失败不删除助手，只是不开放
 *
 * 禁存约束：报告不含 prompt 全文、模型输出全文、token 与 secret。
 * 只存得分、失败项标识、评分器版本与 benchmark 来源。
 */

import { createHash } from 'node:crypto'

// ===========================================================================
// 判定结果枚举
// ===========================================================================

/** 门禁判定结果。 */
export const EVAL_GATE_VERDICTS = ['pass', 'fail', 'unavailable', 'invalidated'] as const
export type EvalGateVerdict = (typeof EVAL_GATE_VERDICTS)[number]

/** 判定结果标签。 */
export const EVAL_GATE_VERDICT_LABELS: Record<EvalGateVerdict, string> = {
  pass: '通过',
  fail: '未通过',
  unavailable: '不可用',
  invalidated: '已失效',
}

// ===========================================================================
// 失效原因枚举
// ===========================================================================

/** 门禁结论失效原因。 */
export const EVAL_GATE_INVALIDATION_REASONS = [
  'definition_version_changed', // 助手定义版本变更
  'skill_version_changed', // 绑定 Skill 版本变更
  'knowledge_package_version_changed', // 绑定知识包版本变更
  'threshold_reconfigured', // 阈值重新配置
  'scorer_config_changed', // 评分器配置变更
] as const

export type EvalGateInvalidationReason = (typeof EVAL_GATE_INVALIDATION_REASONS)[number]

/** 失效原因标签。 */
export const EVAL_GATE_INVALIDATION_REASON_LABELS: Record<EvalGateInvalidationReason, string> = {
  definition_version_changed: '助手定义版本已变更',
  skill_version_changed: '绑定 Skill 版本已变更',
  knowledge_package_version_changed: '绑定知识包版本已变更',
  threshold_reconfigured: '阈值已重新配置',
  scorer_config_changed: '评分器配置已变更',
}

// ===========================================================================
// 评测项得分
// ===========================================================================

/** 单个评测项的得分。 */
export interface EvalGateItemScore {
  /** 评测项标识（与 dimensionScores 对齐）。 */
  itemId: string
  /** 评测项名称（可读）。 */
  itemName: string
  /** 得分（0-1 归一化）。 */
  score: number
  /** 是否为失败项。 */
  failed: boolean
  /** 失败时的可操作方向。 */
  actionableHint?: string
}

// ===========================================================================
// 依赖指纹
// ===========================================================================

/** 助手依赖的 Skill 引用。 */
export interface EvalGateSkillRef {
  skillId: number
  version: string
}

/** 助手依赖的知识包引用。 */
export interface EvalGateKnowledgeRef {
  packageId: string
  version: string
}

/** 依赖指纹输入（用于确定性 hash）。 */
export interface EvalGateDependencyFingerprintInput {
  skills: EvalGateSkillRef[]
  knowledgePackages: EvalGateKnowledgeRef[]
}

/**
 * 计算依赖指纹（确定性 hash）。
 * 对 skill 版本与知识包版本做 lexicographic sort 后 SHA-256。
 */
export function computeDependencyFingerprint(input: EvalGateDependencyFingerprintInput): string {
  const parts: string[] = []
  for (const s of [...input.skills].sort((a, b) =>
    `${a.skillId}:${a.version}`.localeCompare(`${b.skillId}:${b.version}`),
  )) {
    parts.push(`skill:${s.skillId}@${s.version}`)
  }
  for (const k of [...input.knowledgePackages].sort((a, b) =>
    `${a.packageId}:${a.version}`.localeCompare(`${b.packageId}:${b.version}`),
  )) {
    parts.push(`knowledge:${k.packageId}@${k.version}`)
  }
  return createHash('sha256').update(parts.join('|')).digest('hex')
}

// ===========================================================================
// 门禁结论
// ===========================================================================

/** 门禁结论（绑定到具体助手定义版本 + 依赖指纹）。 */
export interface EvalGateVerdictRecord {
  /** 结论 ID。 */
  id: string
  /** 组织 ID（组织隔离）。 */
  organizationId: number
  /** 助手 ID。 */
  agentId: string
  /** 助手定义版本（绑定对象，不绑助手 ID）。 */
  definitionVersion: string
  /** 依赖指纹（Skill 版本 + 知识包版本的确定性 hash）。 */
  dependencyFingerprint: string
  /** 数据集版本。 */
  datasetVersion: string
  /** 评分器配置指纹。 */
  scorerConfigFingerprint: string
  /** 判定结果。 */
  verdict: EvalGateVerdict
  /** 逐项得分。 */
  itemScores: EvalGateItemScore[]
  /** 失败项标识列表（便于快速定位）。 */
  failingItemIds: string[]
  /** 失效原因（仅当 verdict='invalidated' 时有值）。 */
  invalidationReason?: EvalGateInvalidationReason
  /** Benchmark 来源（L3 / fixture）。 */
  benchmarkSource: 'L3' | 'fixture'
  /** 评分器版本（低敏，不含配置详情）。 */
  scorerVersion: string
  /** 创建者 ID。 */
  createdBy: number
  /** 创建时间。 */
  createdAt: string
}

// ===========================================================================
// 门禁配置
// ===========================================================================

/** 门禁阈值配置（由组织显式设置，无静默全局默认）。 */
export interface EvalGateThresholdConfig {
  /** 组织 ID。 */
  organizationId: number
  /** 通过阈值（0-1 归一化分数，必须显式配置）。 */
  passThreshold: number
  /** 是否启用门禁。 */
  enabled: boolean
  /** 真实模型评测是否获授权。 */
  realModelEvalAuthorized: boolean
  /** 配置者 ID。 */
  configuredBy: number
  /** 配置时间。 */
  configuredAt: string
}

// ===========================================================================
// 门禁运行请求
// ===========================================================================

/** 门禁运行请求。 */
export interface EvalGateRunRequest {
  /** 组织 ID。 */
  organizationId: number
  /** 助手 ID。 */
  agentId: string
  /** 助手定义版本。 */
  definitionVersion: string
  /** 依赖指纹（调用方计算后传入，用于绑定验证）。 */
  dependencyFingerprint: string
  /** 数据集版本。 */
  datasetVersion: string
  /** 评分器配置。 */
  scorerConfig: EvalGateScorerConfig
  /** Benchmark 来源。 */
  benchmarkSource: 'L3' | 'fixture'
}

/** 评分器配置（确定性判定的输入之一）。 */
export interface EvalGateScorerConfig {
  /** 评分器类型。 */
  kind: 'deterministic' | 'llm_judge' | 'fixture'
  /** 评分器版本。 */
  version: string
  /** 评分器参数（仅存低敏摘要）。 */
  paramsFingerprint: string
}

// ===========================================================================
// 门禁运行结果
// ===========================================================================

/** 门禁运行结果。 */
export interface EvalGateRunResult {
  /** 结论记录。 */
  verdict: EvalGateVerdictRecord
  /** 评测运行 ID（关联 skill_eval_runs）。 */
  evalRunId: number
  /** 评测报告 ID（关联 skill_eval_reports）。 */
  evalReportId: number
  /** 是否因授权门短路。 */
  authorizationGated: boolean
  /** 授权门短路原因（仅当 authorizationGated=true 时有值）。 */
  authorizationGateReason?: string
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/** 检查门禁结论是否对指定版本有效。 */
export function isVerdictValidForVersion(
  verdict: EvalGateVerdictRecord,
  definitionVersion: string,
  dependencyFingerprint: string,
): boolean {
  return (
    verdict.verdict === 'pass' &&
    verdict.definitionVersion === definitionVersion &&
    verdict.dependencyFingerprint === dependencyFingerprint
  )
}

/** 检查门禁结论是否需要重跑（版本或依赖变更）。 */
export function needsReEvaluation(
  verdict: EvalGateVerdictRecord,
  currentDefinitionVersion: string,
  currentDependencyFingerprint: string,
): { needed: boolean; reason?: EvalGateInvalidationReason } {
  if (verdict.definitionVersion !== currentDefinitionVersion) {
    return { needed: true, reason: 'definition_version_changed' }
  }
  if (verdict.dependencyFingerprint !== currentDependencyFingerprint) {
    // 区分是 Skill 还是知识包变更（简化：统一归为依赖变更）
    return { needed: true, reason: 'skill_version_changed' }
  }
  return { needed: false }
}

/** 从门禁结论中提取失败项的可操作方向。 */
export function extractFailingHints(verdict: EvalGateVerdictRecord): EvalGateItemScore[] {
  return verdict.itemScores.filter((item) => item.failed && item.actionableHint)
}

/** 检查报告是否包含禁存内容（prompt 全文、模型输出全文、token、secret）。 */
export function detectSensitiveContentInReport(report: Record<string, unknown>): string[] {
  const violations: string[] = []
  const sensitivePatterns = [
    /sk-[a-zA-Z0-9_-]{20,}/, // API key patterns (with hyphens/underscores)
    /Bearer\s+[a-zA-Z0-9._-]{20,}/, // Bearer tokens
    /password\s*[:=]\s*\S+/i, // Password assignments
    /secret\s*[:=]\s*\S+/i, // Secret assignments
  ]
  const forbiddenKeys = ['prompt', 'fullprompt', 'modeloutput', 'fulloutput', 'token', 'secret']

  function walk(obj: unknown, path: string) {
    if (obj === null || obj === undefined) return
    if (typeof obj === 'string') {
      for (const pat of sensitivePatterns) {
        if (pat.test(obj)) {
          violations.push(`${path} contains sensitive pattern: ${pat.source}`)
        }
      }
      return
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if (typeof obj === 'object') {
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        if (forbiddenKeys.includes(key.toLowerCase())) {
          violations.push(`${path}.${key} is a forbidden key`)
        }
        walk(val, `${path}.${key}`)
      }
    }
  }

  walk(report, '$')
  return violations
}

// ===========================================================================
// 禁存约束标签（用于负例测试）
// ===========================================================================

/** 敏感样本（用于测试报告中不得出现的内容）。 */
export const EVAL_GATE_SENSITIVE_SAMPLES = [
  'sk-test-api-key-1234567890abcdef',
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'password: hunter2',
  'secret=abc123def456',
  '完整的 prompt 文本内容',
  '完整的模型输出内容',
] as const

// ===========================================================================
// 五态 fixtures 标识
// ===========================================================================

/** 门禁五态 fixture 名称。 */
export const EVAL_GATE_FIXTURE_STATES = [
  'passing', // 通过
  'below_threshold', // 未达阈值
  'dependency_invalidated', // 依赖变更失效
  'auth_gated', // 授权门未开
  'scorer_unavailable', // 评分器不可用
] as const

export type EvalGateFixtureState = (typeof EVAL_GATE_FIXTURE_STATES)[number]
