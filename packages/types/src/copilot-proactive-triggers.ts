/**
 * v3-copilot-proactive-triggers-and-fatigue-control — 共享契约
 *
 * 核心设计纪律：
 * - 规则声明式、纯函数可测，时钟由调用方注入
 * - 触发决策记录为低敏观察记录：规则 ID、命中与否、抑制原因、窗口计数
 * - 决策记录不含建议正文、prompt、模型输出、token 与 secret
 * - 抑制是「不创建」而非「创建后隐藏」
 * - 疲劳控制作用在 (actor, problemKind) 维度
 * - 最高严重度豁免种类上限，仍受全局上限约束
 */

import type {
  InboxProblemKind,
  InboxSeverity,
  InboxSourceKind,
} from './copilot-suggestion-inbox.js'

// ---------------------------------------------------------------------------
// 规则来源类型
// ---------------------------------------------------------------------------

/** 规则触发来源：事件驱动 or 定时巡检 */
export const TRIGGER_RULE_SOURCES = ['event', 'schedule'] as const
export type TriggerRuleSource = (typeof TRIGGER_RULE_SOURCES)[number]

// ---------------------------------------------------------------------------
// 事件种类（与既有事件系统对齐）
// ---------------------------------------------------------------------------

/** 触发规则可监听的事件种类 */
export const TRIGGER_EVENT_KINDS = [
  /** 任务逾期 */
  'task_overdue',
  /** 依赖新增或变更 */
  'dependency_changed',
  /** 资源超载 */
  'resource_overload',
  /** 里程碑风险 */
  'milestone_risk',
  /** 变更请求提交 */
  'change_request_submitted',
] as const

export type TriggerEventKind = (typeof TRIGGER_EVENT_KINDS)[number]

export const TRIGGER_EVENT_KIND_LABELS: Record<TriggerEventKind, string> = {
  task_overdue: '任务逾期',
  dependency_changed: '依赖变更',
  resource_overload: '资源超载',
  milestone_risk: '里程碑风险',
  change_request_submitted: '变更请求提交',
}

// ---------------------------------------------------------------------------
// 巡检周期
// ---------------------------------------------------------------------------

/** 定时巡检周期 */
export const TRIGGER_SCHEDULE_KINDS = ['daily', 'weekly'] as const
export type TriggerScheduleKind = (typeof TRIGGER_SCHEDULE_KINDS)[number]

export const TRIGGER_SCHEDULE_KIND_LABELS: Record<TriggerScheduleKind, string> = {
  daily: '每日巡检',
  weekly: '每周巡检',
}

// ---------------------------------------------------------------------------
// 抑制原因
// ---------------------------------------------------------------------------

/** 抑制原因枚举 */
export const TRIGGER_SUPPRESSION_REASONS = [
  /** 种类频次上限已达 */
  'per_kind_cap',
  /** 全局兜底上限已达 */
  'global_cap',
  /** 同类建议合并（已有相同去重键的条目） */
  'dedupe_merge',
  /** 静默时段 */
  'quiet_hours',
  /** 降频（连续被忽略） */
  'frequency_reduction',
  /** 权限不足（actor 不可访问该来源） */
  'permission_denied',
  /** 来源不可用 */
  'source_unavailable',
] as const

export type TriggerSuppressionReason = (typeof TRIGGER_SUPPRESSION_REASONS)[number]

export const TRIGGER_SUPPRESSION_REASON_LABELS: Record<TriggerSuppressionReason, string> = {
  per_kind_cap: '种类频次上限',
  global_cap: '全局兜底上限',
  dedupe_merge: '同类合并',
  quiet_hours: '静默时段',
  frequency_reduction: '自动降频',
  permission_denied: '权限不足',
  source_unavailable: '来源不可用',
}

// ---------------------------------------------------------------------------
// 触发规则定义
// ---------------------------------------------------------------------------

/**
 * 事件类触发规则。
 * 声明式：规则 ID、来源、事件种类、问题种类、严重度、去重键构造。
 */
export interface TriggerEventRule {
  /** 规则唯一标识 */
  ruleId: string
  /** 规则来源（固定 'event'） */
  source: 'event'
  /** 监听的事件种类 */
  eventKind: TriggerEventKind
  /** 产出的问题种类 */
  problemKind: InboxProblemKind
  /** 建议严重度 */
  severity: InboxSeverity
  /** 关联的 inbox 来源能力 */
  inboxSourceKind: InboxSourceKind
  /** 去重键构造说明（纯函数，由调用方提供键值） */
  dedupeKeyExtractor: string
}

/**
 * 定时类触发规则。
 * 声明式：规则 ID、来源、巡检周期、问题种类、严重度、去重键构造。
 */
export interface TriggerScheduleRule {
  /** 规则唯一标识 */
  ruleId: string
  /** 规则来源（固定 'schedule'） */
  source: 'schedule'
  /** 巡检周期 */
  scheduleKind: TriggerScheduleKind
  /** 产出的问题种类 */
  problemKind: InboxProblemKind
  /** 建议严重度 */
  severity: InboxSeverity
  /** 关联的 inbox 来源能力 */
  inboxSourceKind: InboxSourceKind
  /** 去重键构造说明（纯函数，由调用方提供键值） */
  dedupeKeyExtractor: string
}

/** 触发规则（事件类 or 定时类） */
export type TriggerRule = TriggerEventRule | TriggerScheduleRule

// ---------------------------------------------------------------------------
// 触发决策记录（低敏，不含建议正文）
// ---------------------------------------------------------------------------

/**
 * 触发决策结果。
 */
export const TRIGGER_DECISION_OUTCOMES = [
  'created',
  'suppressed',
  'merged',
  'no_match',
  'source_unavailable',
] as const
export type TriggerDecisionOutcome = (typeof TRIGGER_DECISION_OUTCOMES)[number]

/**
 * 触发决策记录（低敏观察记录）。
 * 不含建议正文、prompt、模型输出、token 与 secret。
 */
export interface TriggerDecisionRecord {
  /** 决策记录 ID（UUID） */
  id: string
  /** 组织 ID（组织隔离） */
  organizationId: string
  /** 项目 ID */
  projectId: string
  /** 触发的规则 ID */
  ruleId: string
  /** 归属（actor ID，用于疲劳控制维度） */
  actorId: string
  /** 决策结果 */
  outcome: TriggerDecisionOutcome
  /** 抑制原因（outcome=suppressed 时必填） */
  suppressionReason: TriggerSuppressionReason | null
  /** 严重度（豁免判定用） */
  severity: InboxSeverity
  /** 问题种类 */
  problemKind: InboxProblemKind
  /** 关联的 inbox 来源能力 */
  inboxSourceKind: InboxSourceKind
  /** 当前窗口已创建条目数（per-kind） */
  windowKindCount: number
  /** 当前窗口已创建条目数（global） */
  windowGlobalCount: number
  /** 窗口上限（per-kind） */
  kindCap: number
  /** 窗口上限（global） */
  globalCap: number
  /** 是否豁免种类上限（最高严重度） */
  kindCapExempt: boolean
  /** 静默时段回落标记（缺失时区时标记 UTC 回落） */
  timezoneFallback: boolean
  /** 降频标记（是否因降频被抑制） */
  frequencyReduced: boolean
  /** 创建时间 */
  createdAt: string
  /** 事件种类（event 规则时有值） */
  eventKind?: TriggerEventKind
  /** 巡检窗口（schedule 规则时有值） */
  sweepWindow?: string
}

// ---------------------------------------------------------------------------
// 疲劳控制配置
// ---------------------------------------------------------------------------

/**
 * 疲劳控制窗口配置。
 */
export interface FatigueWindowConfig {
  /** 时间窗大小（毫秒） */
  windowMs: number
  /** 每个 (actor, problemKind) 维度的频次上限 */
  perKindCap: number
  /** 全局兜底上限 */
  globalCap: number
  /** 连续被忽略多少次后降频 */
  dismissThresholdForReduction: number
  /** 降频后的下界（最小值） */
  reducedCapFloor: number
}

/**
 * 疲劳控制偏好（组织级或个人级）。
 */
export interface FatiguePreference {
  /** 组织 ID */
  organizationId: string
  /** 用户 ID（个人级偏好时有值） */
  userId: string | null
  /** 窗口配置覆盖 */
  windowConfig: Partial<FatigueWindowConfig>
  /** 静默时段（组织时区下的小时范围，如 { start: 22, end: 8 } 表示 22:00-08:00） */
  quietHours: { start: number; end: number } | null
}

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

export function isTriggerRuleSource(v: unknown): v is TriggerRuleSource {
  return typeof v === 'string' && (TRIGGER_RULE_SOURCES as readonly string[]).includes(v)
}

export function isTriggerEventKind(v: unknown): v is TriggerEventKind {
  return typeof v === 'string' && (TRIGGER_EVENT_KINDS as readonly string[]).includes(v)
}

export function isTriggerScheduleKind(v: unknown): v is TriggerScheduleKind {
  return typeof v === 'string' && (TRIGGER_SCHEDULE_KINDS as readonly string[]).includes(v)
}

export function isTriggerSuppressionReason(v: unknown): v is TriggerSuppressionReason {
  return typeof v === 'string' && (TRIGGER_SUPPRESSION_REASONS as readonly string[]).includes(v)
}

export function isTriggerDecisionOutcome(v: unknown): v is TriggerDecisionOutcome {
  return typeof v === 'string' && (TRIGGER_DECISION_OUTCOMES as readonly string[]).includes(v)
}

// ---------------------------------------------------------------------------
// 默认配置常量
// ---------------------------------------------------------------------------

/** 默认疲劳控制窗口配置（24 小时） */
export const DEFAULT_FATIGUE_WINDOW_MS = 24 * 60 * 60 * 1000

/** 默认每种类频次上限 */
export const DEFAULT_PER_KIND_CAP = 5

/** 默认全局兜底上限 */
export const DEFAULT_GLOBAL_CAP = 15

/** 默认连续忽略降频阈值 */
export const DEFAULT_DISMISS_THRESHOLD = 3

/** 默认降频下界 */
export const DEFAULT_REDUCED_CAP_FLOOR = 1

/** 默认最高严重度（豁免种类上限） */
export const HIGHEST_SEVERITY_BAND: InboxSeverity = 'critical'
