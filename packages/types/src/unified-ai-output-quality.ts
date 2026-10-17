/**
 * v3-unified-ai-output-quality-ledger —— 跨能力面 AI 产出校验结果统一账本契约。
 *
 * 核心纪律：
 * - 逐检查项记录（不只存总分），写时拆解，读时不解析 report；
 * - 确定性校验与主观质量评分严格分离（本模块只管硬校验）；
 * - 反幻觉命中项用稳定标识，校验器版本随记录以保可比性；
 * - 自动修复尝试与结果留痕；
 * - 既有草案校验只读投影，不迁移不改写；
 * - 聚合与阈值只产健康状态，禁止任何自动动作；
 * - 低敏红线：report 只存检查项标识+结果+位置引用+hash，禁存产物正文；
 * - 记账可降级，但 can_confirm=false 必须继续阻断确认。
 *
 * @aiproj/types 零依赖约束：不导入 zod / adonisjs。
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// §2.3 能力面枚举 —— 校验结果归属
// ---------------------------------------------------------------------------

/** 校验结果所属能力面。草案链已有持久化；其余六面为本次接线目标。 */
export const QUALITY_LEDGER_CAPABILITY_SURFACES = [
  'draft',
  'risk',
  'prediction',
  'pmo',
  'triz',
  'report',
  'health',
] as const
export type QualityLedgerCapabilitySurface = (typeof QUALITY_LEDGER_CAPABILITY_SURFACES)[number]

/** 能力面 → 中文标签（日志/UI 消费）。 */
export const QUALITY_LEDGER_SURFACE_LABELS: Record<QualityLedgerCapabilitySurface, string> = {
  draft: '草案校验',
  risk: '风险建议',
  prediction: '预测解释',
  pmo: 'PMO 推荐',
  triz: 'TRIZ 叙述',
  report: '报告草案',
  health: '健康诊断',
}

// ---------------------------------------------------------------------------
// §2.3 校验器类别与版本
// ---------------------------------------------------------------------------

/** 校验器类别：硬校验（确定性规则）或软评估（主观评分，本模块不记录）。 */
export const QUALITY_VALIDATOR_CATEGORIES = ['hard', 'soft'] as const
export type QualityValidatorCategory = (typeof QUALITY_VALIDATOR_CATEGORIES)[number]

// ---------------------------------------------------------------------------
// §2.3 稳定检查项标识
// ---------------------------------------------------------------------------

/**
 * 稳定检查项标识枚举（复用 anti-hallucination 的 HL-001~HL-010 / VE-001~VE-012）。
 * 校验器升级时标识不变，保证趋势可比性。
 */
export const QUALITY_CHECK_IDS = [
  // Anti-hallucination 十项（self_checking 阶段）
  'HL-001', // 事实一致性
  'HL-002', // 数值合理性
  'HL-003', // 逻辑一致性
  'HL-004', // 假设完整性
  'HL-005', // 引用可溯源
  'HL-006', // 时间可行性
  'HL-007', // 依赖无循环
  'HL-008', // 资源不超限
  'HL-009', // 术语一致性
  'HL-010', // 范围不膨胀
  // 草案转换规则（validating 阶段）
  'VE-001', // 同资源同日无冲突
  'VE-002', // 依赖无循环
  'VE-003', // 无资源超载
  'VE-004', // 关键任务有负责人
  'VE-005', // 交付物覆盖
  'VE-006', // 时间线物理可行
  'VE-007', // 里程碑有目标日期
  'VE-008', // 单任务工期合理
  'VE-009', // 关键路径可算
  'VE-010', // 必填字段完整
  'VE-011', // WBS 叶子任务
  'VE-012', // 甘特任务同步
] as const
export type QualityCheckId = (typeof QUALITY_CHECK_IDS)[number]

// ---------------------------------------------------------------------------
// §2.2 校验结果严重级别（复用 anti-hallucination）
// ---------------------------------------------------------------------------

export const QUALITY_SEVERITIES = ['blocking', 'warning', 'info'] as const
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number]

// ---------------------------------------------------------------------------
// §2.2 逐检查项结果
// ---------------------------------------------------------------------------

/** 单项检查结果（写时拆解，读时不解析 report）。 */
export interface QualityCheckResult {
  /** 稳定检查项标识（HL-001 / VE-001 等）。 */
  checkId: QualityCheckId | string
  /** 该项是否命中（true = 发现问题）。 */
  hit: boolean
  /** 严重级别。 */
  severity: QualitySeverity
  /** 位置引用（JSONPath / outlineCode 等，不含产物正文）。 */
  locationRef: string | null
  /** 内容 hash（SHA-256 前 12 hex，指向被校验产物片段，不含原文）。 */
  contentHash: string | null
  /** 人类可读摘要（不含产物正文引用）。 */
  message: string
}

// ---------------------------------------------------------------------------
// §2.4 自动修复留痕
// ---------------------------------------------------------------------------

/** 自动修复尝试与结果留痕。 */
export interface QualityAutoFixTrace {
  /** 尝试修复的问题数。 */
  attemptedCount: number
  /** 修复成功数。 */
  successCount: number
  /** 修复后是否仍失败。 */
  stillFailingAfterFix: boolean
}

// ---------------------------------------------------------------------------
// §2.5 脱敏后的 report 结构
// ---------------------------------------------------------------------------

/** 脱敏后的结构化报告条目（禁含产物正文）。 */
export interface QualitySanitizedReportEntry {
  /** 检查项标识。 */
  checkId: QualityCheckId | string
  /** 是否命中。 */
  hit: boolean
  /** 严重级别。 */
  severity: QualitySeverity
  /** 位置引用。 */
  locationRef: string | null
  /** 内容 hash。 */
  contentHash: string | null
}

// ---------------------------------------------------------------------------
// §2.1 风险等级（复用既有）
// ---------------------------------------------------------------------------

export const QUALITY_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type QualityRiskLevel = (typeof QUALITY_RISK_LEVELS)[number]

// ---------------------------------------------------------------------------
// §2.8 阈值声明与健康状态
// ---------------------------------------------------------------------------

/** 健康状态评级（复用 streaming-observability 的 HealthState 语义）。 */
export const QUALITY_HEALTH_STATES = ['healthy', 'warning', 'critical', 'unknown'] as const
export type QualityHealthState = (typeof QUALITY_HEALTH_STATES)[number]

/** 稳定原因码（跨版本可比）。 */
export const QUALITY_HEALTH_REASON_CODES = [
  'all_clear',
  'hit_rate_warning',
  'hit_rate_critical',
  'no_data',
  'insufficient_data',
  'recording_degraded',
] as const
export type QualityHealthReasonCode = (typeof QUALITY_HEALTH_REASON_CODES)[number]

/** 阈值越界产出（只产健康状态，禁止任何自动动作）。 */
export interface QualityHealthIndicator {
  /** 健康状态。 */
  state: QualityHealthState
  /** 稳定原因码。 */
  reasonCode: QualityHealthReasonCode
  /** Runbook 引用（URL 或文档路径）。 */
  runbookRef: string | null
  /** 触发阈值的检查项标识（如有）。 */
  triggeredCheckId: string | null
}

/** 阈值声明（按检查项可配）。 */
export interface QualityThresholdDeclaration {
  /** 检查项标识（null = 全局阈值）。 */
  checkId: QualityCheckId | null
  /** warning 阈值（命中率 0~1）。 */
  warningThreshold: number
  /** critical 阈值（命中率 0~1）。 */
  criticalThreshold: number
  /** Runbook 引用。 */
  runbookRef: string | null
}

// ---------------------------------------------------------------------------
// §2.2 校验结果记录（核心行结构）
// ---------------------------------------------------------------------------

/**
 * 一条校验结果记录（写入 quality_validation_results 表）。
 *
 * 设计约束：
 * - 只存确定性校验结果，不含主观质量评分字段；
 * - report 脱敏：只存检查项标识+结果+位置引用+hash，禁存产物正文；
 * - 被校验产物通过引用关联，不内联内容。
 */
export interface QualityValidationRecord {
  /** 主键（DB 自动生成）。 */
  id?: number
  /** 组织归属（必须）。 */
  organizationId: number
  /** 被校验产物引用（draft version / suggestion id / narrative id 等）。 */
  artifactRef: string
  /** 能力面。 */
  capabilitySurface: QualityLedgerCapabilitySurface
  /** 校验器类别。 */
  validatorCategory: QualityValidatorCategory
  /** 校验器版本（SemVer 或 commit hash，必须）。 */
  validatorVersion: string
  /** 逐检查项结果（写时拆解）。 */
  checkResults: QualityCheckResult[]
  /** 命中的反幻觉项标识列表（去重）。 */
  hitCheckIds: string[]
  /** 总体置信度（0~100，校验器对自身结论的置信度，非主观质量分）。 */
  confidenceScore: number
  /** 总体风险档。 */
  overallRiskLevel: QualityRiskLevel
  /** 是否可确认（无 blocking 项）。 */
  canConfirm: boolean
  /** 自动修复留痕（可选，仅 draft 能力面有自动修复）。 */
  autoFixTrace: QualityAutoFixTrace | null
  /** 脱敏后的结构化报告（禁含产物正文）。 */
  sanitizedReport: QualitySanitizedReportEntry[]
  /** 幂等键（防重复写入）。 */
  idempotencyKey: string
  /** 创建时间（ISO 8601）。 */
  createdAt: string
}

// ---------------------------------------------------------------------------
// §2.10 sanitizer —— 复用 invocation ledger 禁止键类别
// ---------------------------------------------------------------------------

/** 质量账本报告 sanitizer 拒绝的键模式（复用 invocation ledger 禁止键类别）。 */
export const QUALITY_REPORT_FORBIDDEN_PATTERNS: ReadonlyArray<{
  category: string
  pattern: RegExp
}> = [
  // 注意：contentHash / locationRef 是低敏引用字段，不匹配禁止模式
  // content 禁止模式排除 Hash/Ref 后缀
  {
    category: 'artifact_content',
    pattern: /(^|[-_.])(content|text|body|output|result|draft|narrative)(?!Hash|Ref|Id|Key)/i,
  },
  { category: 'prompt', pattern: /prompt/i },
  { category: 'system_instruction', pattern: /(system[-_.]?instruction|sys[-_.]?prompt)/i },
  { category: 'completion', pattern: /completionText|outputText|responseText/i },
  { category: 'messages', pattern: /(^|[-_.])messages?($|[-_.])/i },
  { category: 'token', pattern: /token/i },
  { category: 'secret', pattern: /(secret|password|passphrase)/i },
  { category: 'api_key', pattern: /api[-_.]?key/i },
  { category: 'authorization', pattern: /(authorization|auth[-_.]?header)/i },
]

/** 校验报告对象中是否有禁止的内容键（返回命中类别列表）。 */
export function qualityReportDetectForbiddenKeys(
  input: Record<string, unknown> | null | undefined,
): string[] {
  if (!input) return []
  const found = new Set<string>()
  const walk = (value: unknown, prefix: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, prefix)
      return
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const fullKey = prefix ? `${prefix}.${k}` : k
        for (const { category, pattern } of QUALITY_REPORT_FORBIDDEN_PATTERNS) {
          if (pattern.test(fullKey)) found.add(category)
        }
        walk(v, fullKey)
      }
    }
  }
  walk(input, '')
  return [...found].sort()
}

/** 断言报告无禁止内容键（返回布尔，不抛错）。 */
export function qualityReportHasForbiddenKeys(
  input: Record<string, unknown> | null | undefined,
): boolean {
  return qualityReportDetectForbiddenKeys(input).length > 0
}

// ---------------------------------------------------------------------------
// §2.2 聚合查询参数与结果
// ---------------------------------------------------------------------------

/** 聚合维度。 */
export const QUALITY_AGGREGATION_DIMENSIONS = [
  'organization',
  'capability_surface',
  'check_id',
  'validator_version',
  'time_window',
] as const
export type QualityAggregationDimension = (typeof QUALITY_AGGREGATION_DIMENSIONS)[number]

/** 聚合桶。 */
export interface QualityAggregationBucket {
  /** 分组键。 */
  groupKey: string
  /** 维度。 */
  dimension: QualityAggregationDimension
  /** 校验总数。 */
  totalCount: number
  /** 命中数。 */
  hitCount: number
  /** 命中率（0~1，null = 无数据）。 */
  hitRate: number | null
  /** 确认通过数。 */
  confirmableCount: number
  /** 自动修复尝试总数。 */
  autoFixAttempted: number
  /** 自动修复成功数。 */
  autoFixSucceeded: number
  /** 修复率（0~1，null = 无修复尝试）。 */
  repairRate: number | null
}

/** 聚合结果。 */
export interface QualityAggregationResult {
  /** 维度。 */
  dimension: QualityAggregationDimension
  /** 分桶。 */
  buckets: QualityAggregationBucket[]
  /** 有界窗口 [start, end]（ISO 字符串）。 */
  windowStart: string
  windowEnd: string
  /** 是否空窗口。 */
  empty: boolean
}

// ---------------------------------------------------------------------------
// §2.11 内容 hash helpers
// ---------------------------------------------------------------------------

/** SHA-256 前 12 hex（与 invocation ledger 保持同源语义）。 */
export function computeQualityContentHash(content: unknown, salt?: string | null): string {
  const raw = salt
    ? `${salt}::${JSON.stringify(content, Object.keys(content as object).sort())}`
    : JSON.stringify(content, Object.keys(content as object).sort())
  return createHash('sha256').update(raw).digest('hex').slice(0, 12)
}

/** 为被校验产物片段计算内容 hash（低敏，不含原文）。 */
export function computeQualityFragmentHash(fragment: unknown): string {
  return computeQualityContentHash(fragment, 'quality:fragment')
}

// ---------------------------------------------------------------------------
// §2.10 脱敏 sanitizer 纯函数
// ---------------------------------------------------------------------------

/**
 * 将原始校验结果列表脱敏为 QualitySanitizedReportEntry[]。
 * 确保不包含产物正文、prompt 或模型输出。
 */
export function sanitizeQualityReport(
  checkResults: QualityCheckResult[],
): QualitySanitizedReportEntry[] {
  return checkResults.map((r) => ({
    checkId: r.checkId,
    hit: r.hit,
    severity: r.severity,
    locationRef: r.locationRef,
    contentHash: r.contentHash,
  }))
}

// ---------------------------------------------------------------------------
// §2.6 字段分离约束类型
// ---------------------------------------------------------------------------

/**
 * 校验置信度字段（确定性校验器对自身结论的置信度）。
 * 与主观质量评分（relevance / usefulness / clarity）严格分离，
 * 不得共用同一字段。
 */
export interface QualityValidationConfidence {
  /** 校验器置信度（0~100）。 */
  confidenceScore: number
}

/**
 * 占位标记：主观质量评分接口。
 * 本模块不实现，此处仅声明"这个接口不存在于本契约中"。
 *
 * @example
 * // 编译时断言：QualityValidationRecord 不含 qualityScore 字段
 * type AssertNoQualityScore = QualityValidationRecord extends { qualityScore: unknown }
 *   ? 'FAIL: shared field detected' : 'PASS'
 */
//主观质量评分归 v3-ai-automated-evaluation，本模块无此字段。

// ---------------------------------------------------------------------------
// §6.6 阈值判定纯函数（只产健康状态，禁止任何自动动作）
// ---------------------------------------------------------------------------

/**
 * 根据阈值声明判定健康状态。
 * 返回 QualityHealthIndicator，禁止产生任何修复策略变更、prompt 回滚或业务动作。
 */
export function evaluateQualityHealth(
  hitRate: number | null,
  threshold: QualityThresholdDeclaration,
): QualityHealthIndicator {
  if (hitRate === null) {
    return {
      state: 'unknown',
      reasonCode: 'no_data',
      runbookRef: threshold.runbookRef,
      triggeredCheckId: threshold.checkId,
    }
  }
  if (hitRate >= threshold.criticalThreshold) {
    return {
      state: 'critical',
      reasonCode: 'hit_rate_critical',
      runbookRef: threshold.runbookRef,
      triggeredCheckId: threshold.checkId,
    }
  }
  if (hitRate >= threshold.warningThreshold) {
    return {
      state: 'warning',
      reasonCode: 'hit_rate_warning',
      runbookRef: threshold.runbookRef,
      triggeredCheckId: threshold.checkId,
    }
  }
  return {
    state: 'healthy',
    reasonCode: 'all_clear',
    runbookRef: threshold.runbookRef,
    triggeredCheckId: threshold.checkId,
  }
}

// ---------------------------------------------------------------------------
// §6.8 记账失败降级 —— 确认阻断不依赖本账本
// ---------------------------------------------------------------------------

/**
 * 记账失败时的降级策略。
 * 核心纪律：记录可降级，判定不可降级。
 * can_confirm=false 必须继续阻断确认，不得因记账故障放行。
 */
export interface QualityRecordingDegradation {
  /** 记账是否失败。 */
  recordingFailed: boolean
  /** 业务校验结论是否为不可确认。 */
  businessVerdictNotConfirmable: boolean
  /** 确认是否仍被阻断（必须 = businessVerdictNotConfirmable）。 */
  confirmationBlocked: boolean
}

/**
 * 验证降级策略正确性：确认阻断不依赖本账本可用性。
 */
export function validateRecordingDegradation(
  recordingFailed: boolean,
  businessVerdictNotConfirmable: boolean,
): QualityRecordingDegradation {
  return {
    recordingFailed,
    businessVerdictNotConfirmable,
    // 关键：确认阻断 = 业务判定，不依赖记账是否成功
    confirmationBlocked: businessVerdictNotConfirmable,
  }
}

// ---------------------------------------------------------------------------
// §5.6 六面接线能力面标识
// ---------------------------------------------------------------------------

/** 为六面接线定义的校验调用入口输入。 */
export interface QualityRecordingInput {
  /** 组织归属。 */
  organizationId: number
  /** 被校验产物引用。 */
  artifactRef: string
  /** 能力面。 */
  capabilitySurface: QualityLedgerCapabilitySurface
  /** 校验器版本。 */
  validatorVersion: string
  /** 逐检查项结果。 */
  checkResults: QualityCheckResult[]
  /** 命中项标识列表。 */
  hitCheckIds: string[]
  /** 置信度。 */
  confidenceScore: number
  /** 风险档。 */
  overallRiskLevel: QualityRiskLevel
  /** 是否可确认。 */
  canConfirm: boolean
  /** 自动修复留痕（可选）。 */
  autoFixTrace?: QualityAutoFixTrace | null
  /** 幂等键。 */
  idempotencyKey: string
}

// ---------------------------------------------------------------------------
// §5.1 既有草案校验投影（只读，不迁移不改写）
// ---------------------------------------------------------------------------

/**
 * 既有 ai_project_draft_validations 行的投影形状。
 * 只读投影，不写入、不修改原表。
 */
export interface DraftValidationProjection {
  /** 原表主键。 */
  id: number
  /** 草案 ID。 */
  draftId: number
  /** 版本。 */
  version: number
  /** 阶段。 */
  phase: string
  /** 置信度。 */
  confidenceScore: number
  /** 风险档。 */
  overallRiskLevel: string
  /** 是否可确认。 */
  canConfirm: boolean
  /** 报告 JSON。 */
  report: unknown
  /** 自动修复差异。 */
  autoFixDiffs: unknown
  /** 创建时间。 */
  createdAt: string
  /** 投影来源标记（标识此行来自投影而非新写入）。 */
  projectionSource: 'draft_validation_table'
}

// ---------------------------------------------------------------------------
// §6.1 聚合查询只读聚合纯函数
// ---------------------------------------------------------------------------

/**
 * 只读聚合：按维度 rollup 命中率与趋势。
 * 纯函数，无 DB 依赖；空窗口返回显式 empty=true（而不是零故障假象）。
 */
export function aggregateQualityRecords(
  records: QualityValidationRecord[],
  dimension: QualityAggregationDimension,
  window: { startIso: string; endIso: string },
): QualityAggregationResult {
  const inWindow = records.filter(
    (r) => r.createdAt >= window.startIso && r.createdAt <= window.endIso,
  )
  const bucketsMap = new Map<string, QualityAggregationBucket>()

  for (const record of inWindow) {
    const groupKey = qualityGroupKeyForDimension(dimension, record)
    let bucket = bucketsMap.get(groupKey)
    if (!bucket) {
      bucket = {
        groupKey,
        dimension,
        totalCount: 0,
        hitCount: 0,
        hitRate: null,
        confirmableCount: 0,
        autoFixAttempted: 0,
        autoFixSucceeded: 0,
        repairRate: null,
      }
      bucketsMap.set(groupKey, bucket)
    }
    bucket.totalCount++
    if (record.hitCheckIds.length > 0) bucket.hitCount++
    if (record.canConfirm) bucket.confirmableCount++
    if (record.autoFixTrace) {
      bucket.autoFixAttempted += record.autoFixTrace.attemptedCount
      bucket.autoFixSucceeded += record.autoFixTrace.successCount
    }
  }

  const buckets = [...bucketsMap.values()].sort((a, b) => a.groupKey.localeCompare(b.groupKey))
  for (const bucket of buckets) {
    bucket.hitRate = bucket.totalCount > 0 ? round3(bucket.hitCount / bucket.totalCount) : null
    bucket.repairRate =
      bucket.autoFixAttempted > 0 ? round3(bucket.autoFixSucceeded / bucket.autoFixAttempted) : null
  }

  return {
    dimension,
    buckets,
    windowStart: window.startIso,
    windowEnd: window.endIso,
    empty: inWindow.length === 0,
  }
}

function qualityGroupKeyForDimension(
  dimension: QualityAggregationDimension,
  record: QualityValidationRecord,
): string {
  switch (dimension) {
    case 'organization':
      return String(record.organizationId)
    case 'capability_surface':
      return record.capabilitySurface
    case 'check_id':
      return record.hitCheckIds[0] ?? 'none'
    case 'validator_version':
      return record.validatorVersion
    case 'time_window':
      return record.createdAt.slice(0, 10) // 按天分组
    default:
      return 'unknown'
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

// ---------------------------------------------------------------------------
// §2.9 默认阈值声明
// ---------------------------------------------------------------------------

/** 默认全局阈值声明。 */
export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholdDeclaration[] = [
  {
    checkId: null,
    warningThreshold: 0.3,
    criticalThreshold: 0.6,
    runbookRef: 'docs/runbooks/quality-ledger-thresholds.md',
  },
]

// ---------------------------------------------------------------------------
// §2.2 校验器版本变化时趋势可比性
// ---------------------------------------------------------------------------

/**
 * 按校验器版本分组聚合，保证版本升级时趋势不断裂。
 */
export function groupRecordsByValidatorVersion(
  records: QualityValidationRecord[],
): Map<string, QualityValidationRecord[]> {
  const groups = new Map<string, QualityValidationRecord[]>()
  for (const record of records) {
    const list = groups.get(record.validatorVersion) ?? []
    list.push(record)
    groups.set(record.validatorVersion, list)
  }
  return groups
}
