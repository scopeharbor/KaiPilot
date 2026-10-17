/**
 * v3-ai-slo-and-alerting —— 五态 fixtures（达标/warning/critical/无数据/恢复）。
 *
 * 命名纪律：buildSlo / buildAlert / buildNotification 前缀。
 */

import type {
  AiSloDefinition,
  AiSloThreshold,
  AiAlertRecord,
  AiAlertNotification,
  AiSloEvaluationResult,
  AiSloBudgetBurnResult,
  AiSloEvaluationSnapshot,
} from './ai-slo-and-alerting.js'

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

let _fixtureSeq = 0
/** 递增序号，保证 fixture ID 唯一。 */
function nextSeq(): number {
  return ++_fixtureSeq
}

/** 重置序号（测试间可选调用）。 */
export function resetAiSloFixtureSeq(): void {
  _fixtureSeq = 0
}

// ---------------------------------------------------------------------------
// SLO 定义
// ---------------------------------------------------------------------------

/** 构建一个标准 SLO 定义。 */
export function buildSloDefinition(overrides?: Partial<AiSloDefinition>): AiSloDefinition {
  const seq = nextSeq()
  return {
    id: `slo-def-${seq}`,
    organizationId: 1,
    indicator: 'ttft',
    warning: buildSloThreshold({ operator: 'gt', value: 2000, unit: 'ms', source: 'p95-baseline' }),
    critical: buildSloThreshold({
      operator: 'gt',
      value: 5000,
      unit: 'ms',
      source: 'p99-baseline',
    }),
    windowMs: 300_000, // 5 分钟
    runbookRef: `runbook://ai-slo/ttft/${seq}`,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  }
}

/** 构建一个无 runbook 的 SLO 定义（用于 D2 硬约束测试）。 */
export function buildSloDefinitionWithoutRunbook(): AiSloDefinition {
  return buildSloDefinition({ runbookRef: '' })
}

/** 构建阈值。 */
export function buildSloThreshold(overrides?: Partial<AiSloThreshold>): AiSloThreshold {
  return {
    operator: 'gt',
    value: 100,
    unit: 'ms',
    source: 'test',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 五态 fixtures
// ---------------------------------------------------------------------------

/** 达标态：样本值在阈值内。 */
export function fixtureHealthySamples(): number[] {
  return [100, 120, 110, 95, 130, 105, 115, 125, 108, 112]
}

/** warning 态：部分样本超过 warning 阈值。 */
export function fixtureWarningSamples(): number[] {
  return [2100, 2200, 2300, 2150, 2250, 2180, 2220, 2280, 2190, 2210]
}

/** critical 态：样本值超过 critical 阈值。 */
export function fixtureCriticalSamples(): number[] {
  return [5100, 5200, 5300, 5150, 5250, 5180, 5220, 5280, 5190, 5210]
}

/** 无数据态：空样本。 */
export function fixtureNoDataSamples(): number[] {
  return []
}

/** 恢复态：之前越界，现在回到阈值内。 */
export function fixtureRecoverySamples(): number[] {
  return [50, 60, 55, 45, 65, 52, 58, 62, 53, 57]
}

// ---------------------------------------------------------------------------
// 告警记录
// ---------------------------------------------------------------------------

/** 构建告警记录。 */
export function buildAlertRecord(overrides?: Partial<AiAlertRecord>): AiAlertRecord {
  const seq = nextSeq()
  return {
    id: `alert-${seq}`,
    organizationId: 1,
    indicator: 'ttft',
    tier: 'warning',
    actualValue: 2500,
    thresholdValue: 2000,
    triggeredAt: '2026-08-22T00:00:00.000Z',
    runbookRef: `runbook://ai-slo/ttft/${seq}`,
    isRecovery: false,
    ...overrides,
  }
}

/** 构建恢复通知记录。 */
export function buildRecoveryAlertRecord(overrides?: Partial<AiAlertRecord>): AiAlertRecord {
  return buildAlertRecord({ isRecovery: true, tier: 'warning', ...overrides })
}

// ---------------------------------------------------------------------------
// 告警通知
// ---------------------------------------------------------------------------

/** 构建告警通知。 */
export function buildAlertNotification(
  overrides?: Partial<AiAlertNotification>,
): AiAlertNotification {
  const seq = nextSeq()
  return {
    id: `notif-${seq}`,
    notificationType: 'alert',
    deduplicationKey: `1:ttft:warning`,
    indicator: 'ttft',
    tier: 'warning',
    actualValue: 2500,
    thresholdValue: 2000,
    runbookRef: `runbook://ai-slo/ttft/${seq}`,
    organizationId: 1,
    sentAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  }
}

/** 构建恢复通知。 */
export function buildRecoveryNotification(
  overrides?: Partial<AiAlertNotification>,
): AiAlertNotification {
  return buildAlertNotification({ notificationType: 'recovery', ...overrides })
}

/** 构建升级通知。 */
export function buildEscalationNotification(
  overrides?: Partial<AiAlertNotification>,
): AiAlertNotification {
  return buildAlertNotification({ notificationType: 'escalation', tier: 'critical', ...overrides })
}

// ---------------------------------------------------------------------------
// 评估结果
// ---------------------------------------------------------------------------

/** 构建评估结果。 */
export function buildEvaluationResult(
  overrides?: Partial<AiSloEvaluationResult>,
): AiSloEvaluationResult {
  return {
    indicator: 'ttft',
    outcome: 'healthy',
    actualValue: 150,
    triggeredThreshold: null,
    triggeredTier: null,
    runbookRef: 'runbook://ai-slo/ttft/test',
    evaluatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  }
}

/** 构建 budget burn 结果。 */
export function buildBudgetBurnResult(
  overrides?: Partial<AiSloBudgetBurnResult>,
): AiSloBudgetBurnResult {
  return {
    projectedExhaustionAt: '2026-08-22T12:00:00.000Z',
    currentBurnRate: 0.001,
    remainingRatio: 0.6,
    remainingMs: 43_200_000,
    ...overrides,
  }
}

/** 构建评估快照。 */
export function buildEvaluationSnapshot(
  overrides?: Partial<AiSloEvaluationSnapshot>,
): AiSloEvaluationSnapshot {
  return {
    organizationId: 1,
    results: [
      buildEvaluationResult({ indicator: 'ttft', outcome: 'healthy' }),
      buildEvaluationResult({ indicator: 'failure_rate', outcome: 'healthy' }),
      buildEvaluationResult({ indicator: 'degradation_rate', outcome: 'healthy' }),
      buildEvaluationResult({ indicator: 'latency_violation', outcome: 'healthy' }),
    ],
    budgetBurn: buildBudgetBurnResult(),
    evaluatedAt: '2026-08-22T00:00:00.000Z',
    windowStart: '2026-08-21T23:55:00.000Z',
    windowEnd: '2026-08-22T00:00:00.000Z',
    ...overrides,
  }
}
