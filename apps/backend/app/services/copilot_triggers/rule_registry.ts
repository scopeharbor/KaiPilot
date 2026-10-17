/**
 * v3-copilot-proactive-triggers-and-fatigue-control §5 — 内建触发规则注册表
 *
 * 规则声明式、纯数据，由代码评审而非运行时配置维护。
 * 每条规则声明规则 ID、来源类型、事件/巡检周期、问题种类、严重度、去重键构造。
 *
 * 设计纪律：
 * - 规则 ID 全局唯一，不可复用
 * - problemKind 与 inboxSourceKind 与五来源的能力边界一一对应
 * - 事件规则的 eventKind 必须在 TRIGGER_EVENT_KINDS 枚举内
 * - 定时规则的 scheduleKind 必须在 TRIGGER_SCHEDULE_KINDS 枚举内
 * - 去重键说明仅描述构造规则，实际键值由调用方提供
 */

import type { TriggerRule, TriggerEventRule, TriggerScheduleRule } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 事件类规则：5 条
// ---------------------------------------------------------------------------

/**
 * 任务逾期 —— 检测到任务超出截止日期。
 * problemKind: schedule_risk（进度风险）
 * inboxSourceKind: smart_recommendation（智能推荐）
 */
const taskOverdue: TriggerEventRule = {
  ruleId: 'event:task_overdue',
  source: 'event',
  eventKind: 'task_overdue',
  problemKind: 'schedule_risk',
  severity: 'high',
  inboxSourceKind: 'smart_recommendation',
  dedupeKeyExtractor: 'task_overdue::{entityId}',
}

/**
 * 依赖变更 —— 任务依赖新增或变更。
 * problemKind: dependency_block（依赖阻塞）
 * inboxSourceKind: smart_recommendation（智能推荐）
 */
const dependencyChanged: TriggerEventRule = {
  ruleId: 'event:dependency_changed',
  source: 'event',
  eventKind: 'dependency_changed',
  problemKind: 'dependency_block',
  severity: 'medium',
  inboxSourceKind: 'smart_recommendation',
  dedupeKeyExtractor: 'dependency_changed::{entityId}',
}

/**
 * 资源超载 —— 成员工时或分配超出阈值。
 * problemKind: resource_overload（资源超载）
 * inboxSourceKind: smart_recommendation（智能推荐）
 */
const resourceOverload: TriggerEventRule = {
  ruleId: 'event:resource_overload',
  source: 'event',
  eventKind: 'resource_overload',
  problemKind: 'resource_overload',
  severity: 'high',
  inboxSourceKind: 'smart_recommendation',
  dedupeKeyExtractor: 'resource_overload::{entityId}',
}

/**
 * 里程碑风险 —— 里程碑存在延期风险。
 * problemKind: milestone_pressure（里程碑压力）
 * inboxSourceKind: progress_risk_prediction（进度与风险预测）
 */
const milestoneRisk: TriggerEventRule = {
  ruleId: 'event:milestone_risk',
  source: 'event',
  eventKind: 'milestone_risk',
  problemKind: 'milestone_pressure',
  severity: 'high',
  inboxSourceKind: 'progress_risk_prediction',
  dedupeKeyExtractor: 'milestone_risk::{entityId}',
}

/**
 * 变更请求提交 —— 新增变更请求，可能影响范围。
 * problemKind: scope_change_impact（范围变更影响）
 * inboxSourceKind: pmo_priority_recommendation（PMO 优先级推荐）
 */
const changeRequestSubmitted: TriggerEventRule = {
  ruleId: 'event:change_request_submitted',
  source: 'event',
  eventKind: 'change_request_submitted',
  problemKind: 'scope_change_impact',
  severity: 'medium',
  inboxSourceKind: 'pmo_priority_recommendation',
  dedupeKeyExtractor: 'change_request_submitted::{entityId}',
}

// ---------------------------------------------------------------------------
// 定时类规则：2 条
// ---------------------------------------------------------------------------

/**
 * 每日巡检 —— 项目级数据陈旧检测。
 * problemKind: data_staleness（数据陈旧）
 * inboxSourceKind: health_diagnosis_draft（项目健康诊断 AI 草案）
 */
const dailyInspection: TriggerScheduleRule = {
  ruleId: 'schedule:daily_inspection',
  source: 'schedule',
  scheduleKind: 'daily',
  problemKind: 'data_staleness',
  severity: 'medium',
  inboxSourceKind: 'health_diagnosis_draft',
  dedupeKeyExtractor: 'daily::{sweepWindow}::{actorId}',
}

/**
 * 每周巡检 —— 流程缺口检测与健康诊断。
 * problemKind: process_gap（流程缺陷）
 * inboxSourceKind: health_diagnosis_draft（项目健康诊断 AI 草案）
 */
const weeklyInspection: TriggerScheduleRule = {
  ruleId: 'schedule:weekly_inspection',
  source: 'schedule',
  scheduleKind: 'weekly',
  problemKind: 'process_gap',
  severity: 'medium',
  inboxSourceKind: 'health_diagnosis_draft',
  dedupeKeyExtractor: 'weekly::{sweepWindow}::{actorId}',
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

/**
 * 内建触发规则列表（事件 5 + 定时 2 = 7 条）。
 *
 * 规则 ID 全局唯一，按 (source, eventKind|scheduleKind) 排序以保证枚举稳定。
 * 规则变更走代码评审，不走运行时配置。
 */
export const BUILTIN_TRIGGER_RULES: TriggerRule[] = [
  taskOverdue,
  dependencyChanged,
  resourceOverload,
  milestoneRisk,
  changeRequestSubmitted,
  dailyInspection,
  weeklyInspection,
]

/**
 * 按事件种类索引的事件规则映射。
 * 同一事件种类可能命中多条规则（不同 problemKind/inboxSourceKind）。
 */
export const EVENT_RULES_BY_KIND = new Map(
  BUILTIN_TRIGGER_RULES.filter((r): r is TriggerEventRule => r.source === 'event').reduce<
    Array<[string, TriggerEventRule[]]>
  >((acc, rule) => {
    const existing = acc.find(([kind]) => kind === rule.eventKind)
    if (existing) {
      existing[1].push(rule)
    } else {
      acc.push([rule.eventKind, [rule]])
    }
    return acc
  }, []),
)

/**
 * 按巡检周期索引的定时规则映射。
 */
export const SCHEDULE_RULES_BY_KIND = new Map(
  BUILTIN_TRIGGER_RULES.filter((r): r is TriggerScheduleRule => r.source === 'schedule').reduce<
    Array<[string, TriggerScheduleRule[]]>
  >((acc, rule) => {
    const existing = acc.find(([kind]) => kind === rule.scheduleKind)
    if (existing) {
      existing[1].push(rule)
    } else {
      acc.push([rule.scheduleKind, [rule]])
    }
    return acc
  }, []),
)

/**
 * 验证内建规则 ID 唯一性（可在启动时或测试中调用）。
 * 重复 ID 时抛出错误。
 */
export function validateBuiltinRuleIds(): void {
  const seen = new Set<string>()
  for (const rule of BUILTIN_TRIGGER_RULES) {
    if (seen.has(rule.ruleId)) {
      throw new Error(`Duplicate trigger rule ID: ${rule.ruleId}`)
    }
    seen.add(rule.ruleId)
  }
}
