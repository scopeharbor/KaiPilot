/**
 * v3-copilot-proactive-triggers-and-fatigue-control §3 — 规则注册表与求值器
 *
 * 核心设计纪律：
 * - 规则求值为纯函数，时钟由调用方注入
 * - 同输入同输出的确定性，含规则命中顺序稳定
 * - 不依赖隐式时钟与随机源
 * - 复用五来源的既有产出读取路径，不复制判定逻辑
 * - 无匹配规则时安全兜底：不创建条目、不报错、留决策记录
 */

import type {
  TriggerRule,
  TriggerEventRule,
  TriggerScheduleRule,
  TriggerDecisionOutcome,
  TriggerSuppressionReason,
  FatigueWindowConfig,
} from '@aiproj/types'
import { HIGHEST_SEVERITY_BAND } from '@aiproj/types'
import type { InboxProblemKind, InboxSeverity, InboxSourceKind } from '@aiproj/types'
import { serializeInboxDedupeKey } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 时钟接口（注入式，禁止读隐式时钟）
// ---------------------------------------------------------------------------

/**
 * 注入式时钟接口。
 * 测试中可注入固定时间以保证确定性。
 */
export interface InjectedClock {
  /** 返回当前时间的 ISO 字符串 */
  now(): string
  /** 返回当前时间戳（毫秒） */
  nowMs(): number
}

/**
 * 系统时钟实现（生产环境使用）。
 */
export class SystemClock implements InjectedClock {
  now(): string {
    return new Date().toISOString()
  }
  nowMs(): number {
    return Date.now()
  }
}

// ---------------------------------------------------------------------------
// 事件输入（事件类规则的求值输入）
// ---------------------------------------------------------------------------

export interface TriggerEventInput {
  /** 事件种类 */
  eventKind: string
  /** 归属（actor ID） */
  actorId: string
  /** 组织 ID */
  organizationId: string
  /** 项目 ID */
  projectId: string
  /** 事件时间 */
  occurredAt: string
  /** 事件关联实体 ID（用于去重键构造） */
  entityId: string
  /** 事件元数据（可选，规则可读取） */
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 巡检输入（定时类规则的求值输入）
// ---------------------------------------------------------------------------

export interface TriggerSweepInput {
  /** 巡检窗口标识（如 '2026-08-18'） */
  sweepWindow: string
  /** 归属（actor ID） */
  actorId: string
  /** 组织 ID */
  organizationId: string
  /** 项目 ID */
  projectId: string
}

// ---------------------------------------------------------------------------
// 来源快照（五来源的产出读取接口）
// ---------------------------------------------------------------------------

/**
 * 来源产出快照——规则求值时读取的数据。
 * 不复制判定逻辑，只读取已有产出。
 */
export interface SourceSnapshot {
  /** 来源能力标识 */
  sourceKind: InboxSourceKind
  /** 来源是否有新产出 */
  hasNewOutput: boolean
  /** 来源产出的去重键列表 */
  dedupeKeys: string[]
  /** 来源产出的严重度 */
  severity: InboxSeverity
  /** 来源是否可用 */
  available: boolean
  /** 来源不可用时的原因 */
  unavailableReason?: string
}

// ---------------------------------------------------------------------------
// 疲劳状态读取接口
// ---------------------------------------------------------------------------

/**
 * 疲劳状态——当前窗口内已创建的条目计数。
 */
export interface FatigueState {
  /** (actor, problemKind) 维度的当前窗口计数 */
  kindCount: number
  /** 全局维度的当前窗口计数 */
  globalCount: number
  /** 是否在静默时段 */
  inQuietHours: boolean
  /** 该 (actor, problemKind) 是否已被降频 */
  frequencyReduced: boolean
}

// ---------------------------------------------------------------------------
// 求值结果
// ---------------------------------------------------------------------------

export interface RuleEvaluationResult {
  /** 规则 ID */
  ruleId: string
  /** 是否匹配 */
  matched: boolean
  /** 决策结果 */
  outcome: TriggerDecisionOutcome
  /** 抑制原因 */
  suppressionReason: TriggerSuppressionReason | null
  /** 关联的 inbox 来源能力 */
  inboxSourceKind: InboxSourceKind
  /** 问题种类 */
  problemKind: InboxProblemKind
  /** 严重度 */
  severity: InboxSeverity
  /** 去重键（匹配时有值） */
  dedupeKey?: { problemKind: InboxProblemKind; declaredKey: string }
}

// ---------------------------------------------------------------------------
// 求值器
// ---------------------------------------------------------------------------

/**
 * 触发规则求值器。
 *
 * 纯函数设计：所有外部状态通过参数注入（时钟、疲劳状态、来源快照），
 * 不读取隐式状态，不产生副作用。
 */
export class TriggerRuleEvaluator {
  /**
   * 求值单条事件类规则。
   * 时钟由调用方注入，不依赖隐式时间。
   */
  evaluateEventRule(
    rule: TriggerEventRule,
    input: TriggerEventInput,
    sourceSnapshots: SourceSnapshot[],
    fatigueState: FatigueState,
    fatigueConfig: FatigueWindowConfig,
    existingDedupeKeys: Set<string>,
  ): RuleEvaluationResult {
    // 1. 事件种类匹配
    if (rule.eventKind !== input.eventKind) {
      return this.noMatch(rule)
    }

    // 2. 来源可用性检查
    const sourceSnapshot = sourceSnapshots.find((s) => s.sourceKind === rule.inboxSourceKind)
    if (!sourceSnapshot || !sourceSnapshot.available) {
      return this.suppressed(rule, 'source_unavailable', fatigueState, fatigueConfig)
    }

    // 3. 去重键检查
    const dedupeKey = this.buildDedupeKey(rule, input.entityId)
    const serializedKey = serializeInboxDedupeKey(dedupeKey)
    if (existingDedupeKeys.has(serializedKey)) {
      return this.suppressed(rule, 'dedupe_merge', fatigueState, fatigueConfig)
    }

    // 4. 静默时段检查
    if (fatigueState.inQuietHours) {
      return this.suppressed(rule, 'quiet_hours', fatigueState, fatigueConfig)
    }

    // 5. 频次上限检查（含豁免判定）
    const capCheck = this.checkFatigueCap(rule.severity, fatigueState, fatigueConfig)
    if (capCheck.suppressed) {
      return this.suppressed(rule, capCheck.reason!, fatigueState, fatigueConfig)
    }

    // 6. 匹配成功——应创建条目
    return {
      ruleId: rule.ruleId,
      matched: true,
      outcome: 'created',
      suppressionReason: null,
      inboxSourceKind: rule.inboxSourceKind,
      problemKind: rule.problemKind,
      severity: rule.severity,
      dedupeKey,
    }
  }

  /**
   * 求值单条定时类规则。
   * 时钟由调用方注入，不依赖隐式时间。
   */
  evaluateScheduleRule(
    rule: TriggerScheduleRule,
    input: TriggerSweepInput,
    sourceSnapshots: SourceSnapshot[],
    fatigueState: FatigueState,
    fatigueConfig: FatigueWindowConfig,
    existingDedupeKeys: Set<string>,
    existingSweepKeys: Set<string>,
  ): RuleEvaluationResult {
    // 1. 来源可用性检查
    const sourceSnapshot = sourceSnapshots.find((s) => s.sourceKind === rule.inboxSourceKind)
    if (!sourceSnapshot || !sourceSnapshot.available) {
      return this.suppressed(rule, 'source_unavailable', fatigueState, fatigueConfig)
    }

    // 2. 幂等键检查（同一巡检窗口不重复）
    const sweepKey = `${rule.ruleId}::${input.actorId}::${input.sweepWindow}`
    if (existingSweepKeys.has(sweepKey)) {
      return this.suppressed(rule, 'dedupe_merge', fatigueState, fatigueConfig)
    }

    // 3. 来源是否有新产出
    if (!sourceSnapshot.hasNewOutput) {
      return this.noMatch(rule)
    }

    // 4. 去重键检查
    const dedupeKey = this.buildScheduleDedupeKey(rule, input)
    const serializedKey = serializeInboxDedupeKey(dedupeKey)
    if (existingDedupeKeys.has(serializedKey)) {
      return this.suppressed(rule, 'dedupe_merge', fatigueState, fatigueConfig)
    }

    // 5. 静默时段检查
    if (fatigueState.inQuietHours) {
      return this.suppressed(rule, 'quiet_hours', fatigueState, fatigueConfig)
    }

    // 6. 频次上限检查（含豁免判定）
    const capCheck = this.checkFatigueCap(rule.severity, fatigueState, fatigueConfig)
    if (capCheck.suppressed) {
      return this.suppressed(rule, capCheck.reason!, fatigueState, fatigueConfig)
    }

    // 7. 匹配成功——应创建条目
    return {
      ruleId: rule.ruleId,
      matched: true,
      outcome: 'created',
      suppressionReason: null,
      inboxSourceKind: rule.inboxSourceKind,
      problemKind: rule.problemKind,
      severity: rule.severity,
      dedupeKey,
    }
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  /**
   * 构建事件类规则的去重键。
   */
  private buildDedupeKey(
    rule: TriggerEventRule,
    entityId: string,
  ): { problemKind: InboxProblemKind; declaredKey: string } {
    return {
      problemKind: rule.problemKind,
      declaredKey: `${rule.eventKind}::${entityId}`,
    }
  }

  /**
   * 构建定时类规则的去重键。
   */
  private buildScheduleDedupeKey(
    rule: TriggerScheduleRule,
    input: TriggerSweepInput,
  ): { problemKind: InboxProblemKind; declaredKey: string } {
    return {
      problemKind: rule.problemKind,
      declaredKey: `${rule.scheduleKind}::${input.sweepWindow}::${input.actorId}`,
    }
  }

  /**
   * 检查疲劳上限（含最高严重度豁免）。
   * 最高严重度豁免种类上限，但仍受全局上限约束。
   */
  private checkFatigueCap(
    severity: InboxSeverity,
    fatigueState: FatigueState,
    fatigueConfig: FatigueWindowConfig,
  ): { suppressed: boolean; reason?: TriggerSuppressionReason } {
    const isHighestSeverity = severity === HIGHEST_SEVERITY_BAND

    // 全局上限（所有严重度都受约束）
    if (fatigueState.globalCount >= fatigueConfig.globalCap) {
      return { suppressed: true, reason: 'global_cap' }
    }

    // 种类上限（最高严重度豁免）
    if (!isHighestSeverity && fatigueState.kindCount >= fatigueConfig.perKindCap) {
      return { suppressed: true, reason: 'per_kind_cap' }
    }

    return { suppressed: false }
  }

  /**
   * 无匹配——不创建条目，留决策记录。
   */
  private noMatch(rule: TriggerRule): RuleEvaluationResult {
    return {
      ruleId: rule.ruleId,
      matched: false,
      outcome: 'no_match',
      suppressionReason: null,
      inboxSourceKind: rule.inboxSourceKind,
      problemKind: rule.problemKind,
      severity: rule.severity,
    }
  }

  /**
   * 被抑制——不创建条目，留决策记录（含抑制原因）。
   */
  private suppressed(
    rule: TriggerRule,
    reason: TriggerSuppressionReason,
    _fatigueState: FatigueState,
    _fatigueConfig: FatigueWindowConfig,
  ): RuleEvaluationResult {
    return {
      ruleId: rule.ruleId,
      matched: true,
      outcome: 'suppressed',
      suppressionReason: reason,
      inboxSourceKind: rule.inboxSourceKind,
      problemKind: rule.problemKind,
      severity: rule.severity,
    }
  }
}
