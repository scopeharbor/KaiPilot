/**
 * v3-copilot-proactive-triggers-and-fatigue-control — 六态 fixtures
 *
 * 覆盖：命中、频次抑制、静默抑制、合并、降频、最高严重度豁免六态。
 * 全部使用确定性数据，零网络 / 零 provider。
 */

import type {
  TriggerDecisionRecord,
  TriggerEventRule,
  TriggerScheduleRule,
  FatigueWindowConfig,
  FatiguePreference,
} from './copilot-proactive-triggers.js'
import {
  DEFAULT_FATIGUE_WINDOW_MS,
  DEFAULT_PER_KIND_CAP,
  DEFAULT_GLOBAL_CAP,
  DEFAULT_DISMISS_THRESHOLD,
  DEFAULT_REDUCED_CAP_FLOOR,
} from './copilot-proactive-triggers.js'

// ---------------------------------------------------------------------------
// 辅助：确定性 ID 生成
// ---------------------------------------------------------------------------

let _seq = 0

function fixtureId(prefix: string): string {
  _seq++
  return `${prefix}-${String(_seq).padStart(4, '0')}`
}

/** 重置序列（测试间可选调用） */
export function resetTriggerFixtureSeq(): void {
  _seq = 0
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const ORG_ID = 'org-trigger-001'
const PROJECT_ID = 'proj-trigger-001'
const ACTOR_ID = 'actor-001'
const NOW = '2026-08-18T10:00:00.000Z'

// ---------------------------------------------------------------------------
// 规则工厂
// ---------------------------------------------------------------------------

export function makeEventRule(overrides: Partial<TriggerEventRule> = {}): TriggerEventRule {
  return {
    ruleId: `rule-evt-${fixtureId('r')}`,
    source: 'event',
    eventKind: 'task_overdue',
    problemKind: 'schedule_risk',
    severity: 'high',
    inboxSourceKind: 'smart_recommendation',
    dedupeKeyExtractor: 'task-overdue-${taskId}',
    ...overrides,
  }
}

export function makeScheduleRule(
  overrides: Partial<TriggerScheduleRule> = {},
): TriggerScheduleRule {
  return {
    ruleId: `rule-sch-${fixtureId('r')}`,
    source: 'schedule',
    scheduleKind: 'daily',
    problemKind: 'data_staleness',
    severity: 'medium',
    inboxSourceKind: 'health_diagnosis_draft',
    dedupeKeyExtractor: 'daily-check-${orgId}-${date}',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 决策记录工厂
// ---------------------------------------------------------------------------

export function makeDecisionRecord(
  overrides: Partial<TriggerDecisionRecord> = {},
): TriggerDecisionRecord {
  return {
    id: fixtureId('decision'),
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    ruleId: `rule-evt-${fixtureId('r')}`,
    actorId: ACTOR_ID,
    outcome: 'created',
    suppressionReason: null,
    severity: 'high',
    problemKind: 'schedule_risk',
    inboxSourceKind: 'smart_recommendation',
    windowKindCount: 0,
    windowGlobalCount: 0,
    kindCap: DEFAULT_PER_KIND_CAP,
    globalCap: DEFAULT_GLOBAL_CAP,
    kindCapExempt: false,
    timezoneFallback: false,
    frequencyReduced: false,
    createdAt: NOW,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 六态 fixture
// ---------------------------------------------------------------------------

/** 态 1：命中 —— 规则匹配，成功创建条目 */
export function fixtureHit(): TriggerDecisionRecord {
  return makeDecisionRecord({
    id: 'decision-hit-001',
    ruleId: 'rule-evt-task-overdue',
    outcome: 'created',
    suppressionReason: null,
    severity: 'high',
    problemKind: 'schedule_risk',
    windowKindCount: 1,
    windowGlobalCount: 1,
  })
}

/** 态 2：频次抑制 —— 种类上限已达 */
export function fixturePerKindCapSuppressed(): TriggerDecisionRecord {
  return makeDecisionRecord({
    id: 'decision-cap-001',
    ruleId: 'rule-evt-resource-overload',
    outcome: 'suppressed',
    suppressionReason: 'per_kind_cap',
    severity: 'medium',
    problemKind: 'resource_overload',
    windowKindCount: 5,
    windowGlobalCount: 8,
    kindCap: 5,
    globalCap: 15,
    kindCapExempt: false,
  })
}

/** 态 3：静默抑制 —— 静默时段内 */
export function fixtureQuietHoursSuppressed(): TriggerDecisionRecord {
  return makeDecisionRecord({
    id: 'decision-quiet-001',
    ruleId: 'rule-evt-milestone-risk',
    outcome: 'suppressed',
    suppressionReason: 'quiet_hours',
    severity: 'medium',
    problemKind: 'milestone_pressure',
    windowKindCount: 0,
    windowGlobalCount: 0,
    kindCap: 5,
    globalCap: 15,
    kindCapExempt: false,
  })
}

/** 态 4：合并 —— 同一去重键重复触发 */
export function fixtureDedupeMerged(): TriggerDecisionRecord {
  return makeDecisionRecord({
    id: 'decision-merge-001',
    ruleId: 'rule-evt-dependency-changed',
    outcome: 'merged',
    suppressionReason: 'dedupe_merge',
    severity: 'high',
    problemKind: 'dependency_block',
    windowKindCount: 2,
    windowGlobalCount: 3,
    kindCap: 5,
    globalCap: 15,
    kindCapExempt: false,
  })
}

/** 态 5：降频 —— 连续被忽略后自动降频 */
export function fixtureFrequencyReduced(): TriggerDecisionRecord {
  return makeDecisionRecord({
    id: 'decision-freq-001',
    ruleId: 'rule-sch-daily-inspection',
    outcome: 'suppressed',
    suppressionReason: 'frequency_reduction',
    severity: 'low',
    problemKind: 'data_staleness',
    windowKindCount: 0,
    windowGlobalCount: 2,
    kindCap: 1, // 降频后的下界
    globalCap: 15,
    kindCapExempt: false,
    frequencyReduced: true,
  })
}

/** 态 6：最高严重度豁免 —— critical 建议不被种类上限压掉 */
export function fixtureHighestSeverityExempt(): TriggerDecisionRecord {
  return makeDecisionRecord({
    id: 'decision-exempt-001',
    ruleId: 'rule-evt-change-request',
    outcome: 'created',
    suppressionReason: null,
    severity: 'critical',
    problemKind: 'risk_escalation',
    windowKindCount: 5, // 已达种类上限
    windowGlobalCount: 10,
    kindCap: 5,
    globalCap: 15,
    kindCapExempt: true, // 豁免种类上限
  })
}

// ---------------------------------------------------------------------------
// 疲劳控制配置工厂
// ---------------------------------------------------------------------------

export function makeFatigueWindowConfig(
  overrides: Partial<FatigueWindowConfig> = {},
): FatigueWindowConfig {
  return {
    windowMs: DEFAULT_FATIGUE_WINDOW_MS,
    perKindCap: DEFAULT_PER_KIND_CAP,
    globalCap: DEFAULT_GLOBAL_CAP,
    dismissThresholdForReduction: DEFAULT_DISMISS_THRESHOLD,
    reducedCapFloor: DEFAULT_REDUCED_CAP_FLOOR,
    ...overrides,
  }
}

export function makeFatiguePreference(
  overrides: Partial<FatiguePreference> = {},
): FatiguePreference {
  return {
    organizationId: ORG_ID,
    userId: null,
    windowConfig: {},
    quietHours: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 敏感样本（用于禁存约束测试）
// ---------------------------------------------------------------------------

/** 敏感样本集——这些值不应出现在 TriggerDecisionRecord 的任何字段中 */
export const PROACTIVE_TRIGGER_SENSITIVE_SAMPLES = {
  suggestionBody: '建议用户重新分配资源给前端团队以解决超载问题',
  promptText: 'You are a project management assistant...',
  modelOutput: '{"recommendation": "reassign resources"}',
  token: 'sk-proj-abc123def456ghi789',
  secret: 'Bearer eyJhbGciOiJIUzI1NiJ9',
} as const
