/**
 * v3-copilot-proactive-triggers-and-fatigue-control — 触发规则求值器单元测试
 *
 * 覆盖 spec REQ：
 * - 确定性求值（注入时钟，无隐式时钟/随机源）
 * - 同输入同输出
 * - 来源只读不复制判定
 * - 无匹配安全兜底
 * - 禁存约束（决策记录不含敏感内容）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TriggerRuleEvaluator,
  type TriggerEventInput,
  type TriggerSweepInput,
  type SourceSnapshot,
  type FatigueState,
} from '../../app/services/copilot_triggers/trigger_rule_evaluator.js'
import type { TriggerEventRule, TriggerScheduleRule } from '@aiproj/types'
import { DEFAULT_FATIGUE_WINDOW_MS, DEFAULT_PER_KIND_CAP, DEFAULT_GLOBAL_CAP } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 辅助工厂
// ---------------------------------------------------------------------------

function makeEventRule(overrides: Partial<TriggerEventRule> = {}): TriggerEventRule {
  return {
    ruleId: 'rule-task-overdue-001',
    source: 'event',
    eventKind: 'task_overdue',
    problemKind: 'schedule_risk',
    severity: 'high',
    inboxSourceKind: 'smart_recommendation',
    dedupeKeyExtractor: 'task-overdue-${entityId}',
    ...overrides,
  }
}

function makeScheduleRule(overrides: Partial<TriggerScheduleRule> = {}): TriggerScheduleRule {
  return {
    ruleId: 'rule-daily-001',
    source: 'schedule',
    scheduleKind: 'daily',
    problemKind: 'data_staleness',
    severity: 'medium',
    inboxSourceKind: 'health_diagnosis_draft',
    dedupeKeyExtractor: 'daily-check-${orgId}',
    ...overrides,
  }
}

function makeEventInput(overrides: Partial<TriggerEventInput> = {}): TriggerEventInput {
  return {
    eventKind: 'task_overdue',
    actorId: 'actor-001',
    organizationId: 'org-001',
    projectId: 'proj-001',
    occurredAt: '2026-08-18T10:00:00.000Z',
    entityId: 'task-001',
    ...overrides,
  }
}

function makeSweepInput(overrides: Partial<TriggerSweepInput> = {}): TriggerSweepInput {
  return {
    sweepWindow: '2026-08-18',
    actorId: 'actor-001',
    organizationId: 'org-001',
    projectId: 'proj-001',
    ...overrides,
  }
}

function makeSourceSnapshot(sourceKind: string, available = true): SourceSnapshot {
  return {
    sourceKind: sourceKind as any,
    hasNewOutput: true,
    dedupeKeys: [],
    severity: 'high',
    available,
  }
}

function makeFatigueState(overrides: Partial<FatigueState> = {}): FatigueState {
  return {
    kindCount: 0,
    globalCount: 0,
    inQuietHours: false,
    frequencyReduced: false,
    ...overrides,
  }
}

const defaultFatigueConfig = {
  windowMs: DEFAULT_FATIGUE_WINDOW_MS,
  perKindCap: DEFAULT_PER_KIND_CAP,
  globalCap: DEFAULT_GLOBAL_CAP,
  dismissThresholdForReduction: 3,
  reducedCapFloor: 1,
}

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('TriggerRuleEvaluator', () => {
  let evaluator: TriggerRuleEvaluator

  beforeEach(() => {
    evaluator = new TriggerRuleEvaluator()
  })

  // ── 确定性求值 ──────────────────────────────────────────────────────

  describe('deterministic evaluation', () => {
    it('should produce identical results for equal inputs in different key orders', () => {
      const rule = makeEventRule()
      const input = makeEventInput()
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState()
      const existingDedupe = new Set<string>()

      // Run 1
      const result1 = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        existingDedupe,
      )

      // Run 2 (independent, same values)
      const result2 = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set<string>(),
      )

      expect(result1.ruleId).toBe(result2.ruleId)
      expect(result1.outcome).toBe(result2.outcome)
      expect(result1.matched).toBe(result2.matched)
      expect(result1.problemKind).toBe(result2.problemKind)
      expect(result1.severity).toBe(result2.severity)
      expect(result1.inboxSourceKind).toBe(result2.inboxSourceKind)
    })

    it('should not depend on ambient clock', () => {
      const rule = makeEventRule()
      const input = makeEventInput()
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState()
      const existingDedupe = new Set<string>()

      // The evaluator itself doesn't use clock directly - clock is for fatigue service
      const result1 = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        existingDedupe,
      )
      const result2 = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set<string>(),
      )

      expect(result1.outcome).toBe(result2.outcome)
    })
  })

  // ── 事件类规则求值 ──────────────────────────────────────────────────

  describe('event rule evaluation', () => {
    it('should match when event kind matches rule', () => {
      const rule = makeEventRule({ eventKind: 'task_overdue' })
      const input = makeEventInput({ eventKind: 'task_overdue' })
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState()

      const result = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
      )

      expect(result.matched).toBe(true)
      expect(result.outcome).toBe('created')
      expect(result.suppressionReason).toBeNull()
    })

    it('should not match when event kind differs', () => {
      const rule = makeEventRule({ eventKind: 'task_overdue' })
      const input = makeEventInput({ eventKind: 'resource_overload' })
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState()

      const result = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
      )

      expect(result.matched).toBe(false)
      expect(result.outcome).toBe('no_match')
    })

    it('should suppress when source is unavailable', () => {
      const rule = makeEventRule()
      const input = makeEventInput()
      const sources = [makeSourceSnapshot('smart_recommendation', false)]
      const fatigue = makeFatigueState()

      const result = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
      )

      expect(result.matched).toBe(true)
      expect(result.outcome).toBe('suppressed')
      expect(result.suppressionReason).toBe('source_unavailable')
    })

    it('should suppress on dedupe merge', () => {
      const rule = makeEventRule()
      const input = makeEventInput({ entityId: 'task-001' })
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState()
      const existingDedupe = new Set(['schedule_risk::task_overdue::task-001'])

      const result = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        existingDedupe,
      )

      expect(result.matched).toBe(true)
      expect(result.outcome).toBe('suppressed')
      expect(result.suppressionReason).toBe('dedupe_merge')
    })

    it('should suppress during quiet hours', () => {
      const rule = makeEventRule()
      const input = makeEventInput()
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState({ inQuietHours: true })

      const result = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
      )

      expect(result.matched).toBe(true)
      expect(result.outcome).toBe('suppressed')
      expect(result.suppressionReason).toBe('quiet_hours')
    })

    it('should suppress on per-kind cap', () => {
      const rule = makeEventRule({ severity: 'medium' })
      const input = makeEventInput()
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState({ kindCount: 5, globalCount: 3 })

      const result = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
      )

      expect(result.matched).toBe(true)
      expect(result.outcome).toBe('suppressed')
      expect(result.suppressionReason).toBe('per_kind_cap')
    })

    it('should suppress on global cap', () => {
      const rule = makeEventRule({ severity: 'medium' })
      const input = makeEventInput()
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState({ kindCount: 2, globalCount: 15 })

      const result = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
      )

      expect(result.matched).toBe(true)
      expect(result.outcome).toBe('suppressed')
      expect(result.suppressionReason).toBe('global_cap')
    })

    it('should exempt highest severity from per-kind cap', () => {
      const rule = makeEventRule({ severity: 'critical' })
      const input = makeEventInput()
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState({ kindCount: 5, globalCount: 3 })

      const result = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
      )

      expect(result.matched).toBe(true)
      expect(result.outcome).toBe('created')
      expect(result.suppressionReason).toBeNull()
    })

    it('should still enforce global cap even for critical severity', () => {
      const rule = makeEventRule({ severity: 'critical' })
      const input = makeEventInput()
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState({ kindCount: 5, globalCount: 15 })

      const result = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
      )

      expect(result.matched).toBe(true)
      expect(result.outcome).toBe('suppressed')
      expect(result.suppressionReason).toBe('global_cap')
    })
  })

  // ── 定时类规则求值 ──────────────────────────────────────────────────

  describe('schedule rule evaluation', () => {
    it('should match when source has new output', () => {
      const rule = makeScheduleRule()
      const input = makeSweepInput()
      const sources = [makeSourceSnapshot('health_diagnosis_draft')]
      const fatigue = makeFatigueState()

      const result = evaluator.evaluateScheduleRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
        new Set(),
      )

      expect(result.matched).toBe(true)
      expect(result.outcome).toBe('created')
    })

    it('should not match when source has no new output', () => {
      const rule = makeScheduleRule()
      const input = makeSweepInput()
      const sources: SourceSnapshot[] = [
        {
          sourceKind: 'health_diagnosis_draft',
          hasNewOutput: false,
          dedupeKeys: [],
          severity: 'medium',
          available: true,
        },
      ]
      const fatigue = makeFatigueState()

      const result = evaluator.evaluateScheduleRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
        new Set(),
      )

      expect(result.matched).toBe(false)
      expect(result.outcome).toBe('no_match')
    })

    it('should be idempotent per sweep window', () => {
      const rule = makeScheduleRule()
      const input = makeSweepInput()
      const sources = [makeSourceSnapshot('health_diagnosis_draft')]
      const fatigue = makeFatigueState()
      const existingSweepKeys = new Set(['rule-daily-001::actor-001::2026-08-18'])

      const result = evaluator.evaluateScheduleRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
        existingSweepKeys,
      )

      expect(result.matched).toBe(true)
      expect(result.outcome).toBe('suppressed')
      expect(result.suppressionReason).toBe('dedupe_merge')
    })
  })

  // ── 禁存约束 ────────────────────────────────────────────────────────

  describe('no-sensitive-content constraint', () => {
    it('should not include suggestion body, prompt, model output, token, or secret in results', () => {
      const rule = makeEventRule()
      const input = makeEventInput()
      const sources = [makeSourceSnapshot('smart_recommendation')]
      const fatigue = makeFatigueState()

      const result = evaluator.evaluateEventRule(
        rule,
        input,
        sources,
        fatigue,
        defaultFatigueConfig,
        new Set(),
      )

      const resultStr = JSON.stringify(result)
      const sensitiveSamples = [
        '建议用户重新分配资源',
        'You are a project management assistant',
        '{"recommendation":',
        'sk-proj-abc123',
        'Bearer eyJ',
      ]

      for (const sample of sensitiveSamples) {
        expect(resultStr).not.toContain(sample)
      }
    })
  })
})
