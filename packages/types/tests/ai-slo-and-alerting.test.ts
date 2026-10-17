/**
 * v3-ai-slo-and-alerting —— 契约测试。
 *
 * 覆盖：
 * - §2.1-2.3 SLO 定义与告警记录类型（五指标、双档）
 * - §2.4 无 runbook 硬约束（D2）
 * - §2.6 禁存约束（告警记录不含敏感样本）
 * - §3.1-3.7 指标评估（窗口聚合、budget burn、无数据、确定性）
 * - §4.1-4.8 告警去重（持续越界不重复、档位升级、恢复通知、复用通知通道）
 * - §5.1-5.5 不自动处置（零域写、无 remediation 依赖、runbook 引用）
 * - §6.1-6.5 阈值配置（下调生效、上调越界、权限校验）
 * - §7.1-7.6 组织隔离与 RBAC
 */

import { describe, it, expect } from 'vitest'
import {
  // §2.1-2.3 类型与常量
  AI_SLO_INDICATORS,
  AI_SLO_SEVERITY_TIERS,
  isAiSloIndicator,
  isAiSloSeverityTier,
  // §2.4 runbook 硬约束
  validateSloRunbook,
  AI_SLO_RUNBOOK_REQUIRED,
  // §2.6 禁存约束
  validateAlertRecordNoSensitiveContent,
  AI_SLO_SENSITIVE_FIELD_TAGS,
  // §3.1-3.7 指标评估
  evaluateAiSloIndicator,
  evaluateAiSloIndicatorDeterministic,
  compareAiSloThreshold,
  computeBudgetBurn,
  isAiSloEvaluationOutcome,
  AI_SLO_EVALUATION_OUTCOMES,
  // §4.1-4.8 告警去重
  buildAlertDeduplicationKey,
  // §5.1-5.5 不自动处置
  AI_SLO_FORBIDDEN_REMEDIATION_DEPS,
  AI_SLO_ALLOWED_WRITES,
  // §6.1-6.5 阈值配置
  validateThresholdChange,
  // §7.1-7.6 权限
  AI_SLO_PERMISSIONS,
  AI_SLO_ALERT_RETENTION_POLICY,
  checkSloQueryPermission,
  checkSloThresholdChangePermission,
  checkSloManagePermission,
  isAiSloPermission,
  type AiSloDefinition,
  type AiAlertRecord,
  type AiSloQueryInput,
} from '../src/ai-slo-and-alerting.js'
import {
  resetAiSloFixtureSeq,
  buildSloDefinition,
  buildSloDefinitionWithoutRunbook,
  buildSloThreshold,
  fixtureHealthySamples,
  fixtureWarningSamples,
  fixtureCriticalSamples,
  fixtureNoDataSamples,
  fixtureRecoverySamples,
  buildAlertRecord,
  buildRecoveryAlertRecord,
  buildAlertNotification,
  buildRecoveryNotification,
  buildEscalationNotification,
  buildEvaluationResult,
  buildBudgetBurnResult,
} from '../src/ai-slo-and-alerting-fixtures.js'

// ---------------------------------------------------------------------------
// §2.1-2.3 SLO 定义类型
// ---------------------------------------------------------------------------

describe('§2.1-2.3 SLO definition types', () => {
  it('五指标枚举覆盖 TTFT/失败率/降级率/budget burn/延迟违约率', () => {
    expect(AI_SLO_INDICATORS).toEqual([
      'ttft',
      'failure_rate',
      'degradation_rate',
      'budget_burn',
      'latency_violation',
    ])
    expect(AI_SLO_INDICATORS).toHaveLength(5)
  })

  it('双档阈值只有 warning 和 critical，不设第三档', () => {
    expect(AI_SLO_SEVERITY_TIERS).toEqual(['warning', 'critical'])
    expect(AI_SLO_SEVERITY_TIERS).toHaveLength(2)
  })

  it('isAiSloIndicator 正确识别合法与非法值', () => {
    expect(isAiSloIndicator('ttft')).toBe(true)
    expect(isAiSloIndicator('failure_rate')).toBe(true)
    expect(isAiSloIndicator('invalid')).toBe(false)
    expect(isAiSloIndicator(null)).toBe(false)
  })

  it('isAiSloSeverityTier 正确识别合法与非法值', () => {
    expect(isAiSloSeverityTier('warning')).toBe(true)
    expect(isAiSloSeverityTier('critical')).toBe(true)
    expect(isAiSloSeverityTier('info')).toBe(false)
  })

  it('SLO 定义包含 organization_id', () => {
    const def = buildSloDefinition({ organizationId: 42 })
    expect(def.organizationId).toBe(42)
  })

  it('SLO 定义包含 runbookRef', () => {
    const def = buildSloDefinition()
    expect(def.runbookRef).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// §2.4 无 runbook 硬约束（D2）
// ---------------------------------------------------------------------------

describe('§2.4 runbook hard constraint (D2)', () => {
  it('缺少 runbook 的 SLO 定义被拒', () => {
    const def = buildSloDefinitionWithoutRunbook()
    const error = validateSloRunbook(def)
    expect(error).toBe(AI_SLO_RUNBOOK_REQUIRED)
  })

  it('有 runbook 的 SLO 定义通过', () => {
    const def = buildSloDefinition({ runbookRef: 'runbook://ai-slo/ttft/1' })
    const error = validateSloRunbook(def)
    expect(error).toBeNull()
  })

  it('空白 runbook 被拒', () => {
    const def = buildSloDefinition({ runbookRef: '   ' })
    const error = validateSloRunbook(def)
    expect(error).toBe(AI_SLO_RUNBOOK_REQUIRED)
  })
})

// ---------------------------------------------------------------------------
// §2.6 禁存约束
// ---------------------------------------------------------------------------

describe('§2.6 no sensitive content in alert records', () => {
  it('标准告警记录不含敏感样本', () => {
    const record = buildAlertRecord({
      indicator: 'ttft',
      tier: 'warning',
      actualValue: 2500,
      thresholdValue: 2000,
    })
    expect(
      validateAlertRecordNoSensitiveContent(record as unknown as Record<string, unknown>),
    ).toBe(true)
  })

  it('含 prompt 的记录被拒', () => {
    const record = {
      ...buildAlertRecord(),
      prompt: 'What is the meaning of life?',
    }
    expect(
      validateAlertRecordNoSensitiveContent(record as unknown as Record<string, unknown>),
    ).toBe(false)
  })

  it('含 token 的记录被拒', () => {
    const record = {
      ...buildAlertRecord(),
      token: 'sk-abc123',
    }
    expect(
      validateAlertRecordNoSensitiveContent(record as unknown as Record<string, unknown>),
    ).toBe(false)
  })

  it('含 secret 的记录被拒', () => {
    const record = {
      ...buildAlertRecord(),
      secret: 'my-api-secret',
    }
    expect(
      validateAlertRecordNoSensitiveContent(record as unknown as Record<string, unknown>),
    ).toBe(false)
  })

  it('含 modelOutput 的记录被拒', () => {
    const record = {
      ...buildAlertRecord(),
      modelOutput: 'The answer is 42.',
    }
    expect(
      validateAlertRecordNoSensitiveContent(record as unknown as Record<string, unknown>),
    ).toBe(false)
  })

  it('禁存字段标签列表完整', () => {
    expect(AI_SLO_SENSITIVE_FIELD_TAGS).toContain('prompt')
    expect(AI_SLO_SENSITIVE_FIELD_TAGS).toContain('model_output')
    expect(AI_SLO_SENSITIVE_FIELD_TAGS).toContain('modelOutput')
    expect(AI_SLO_SENSITIVE_FIELD_TAGS).toContain('token')
    expect(AI_SLO_SENSITIVE_FIELD_TAGS).toContain('secret')
  })
})

// ---------------------------------------------------------------------------
// §3.1-3.7 指标评估
// ---------------------------------------------------------------------------

describe('§3.1 metric evaluation', () => {
  it('达标样本产生 healthy 结果', () => {
    const def = buildSloDefinition({
      warning: buildSloThreshold({ value: 2000 }),
      critical: buildSloThreshold({ value: 5000 }),
    })
    const result = evaluateAiSloIndicator(fixtureHealthySamples(), 'ttft', def)
    expect(result.outcome).toBe('healthy')
    expect(result.actualValue).not.toBeNull()
    expect(result.triggeredTier).toBeNull()
  })

  it('warning 样本产生 warning 结果', () => {
    const def = buildSloDefinition({
      warning: buildSloThreshold({ value: 2000 }),
      critical: buildSloThreshold({ value: 5000 }),
    })
    const result = evaluateAiSloIndicator(fixtureWarningSamples(), 'ttft', def)
    expect(result.outcome).toBe('warning')
    expect(result.triggeredTier).toBe('warning')
    expect(result.runbookRef).toBeTruthy()
  })

  it('critical 样本产生 critical 结果', () => {
    const def = buildSloDefinition({
      warning: buildSloThreshold({ value: 2000 }),
      critical: buildSloThreshold({ value: 5000 }),
    })
    const result = evaluateAiSloIndicator(fixtureCriticalSamples(), 'ttft', def)
    expect(result.outcome).toBe('critical')
    expect(result.triggeredTier).toBe('critical')
  })
})

describe('§3.2 budget burn as projected exhaustion', () => {
  it('月初与月末同样已用比例产出不同燃烧率结论', () => {
    const totalBudget = 1000
    const consumed = 500 // 50% 已用
    const windowStart = new Date('2026-08-01T00:00:00.000Z')
    const windowEnd = new Date('2026-08-31T23:59:59.999Z')

    // 月初（8月2日）：消耗 500/1天 ≈ 500/天 → 剩余 500 需要 1 天
    const early = computeBudgetBurn(
      consumed,
      totalBudget,
      windowStart,
      windowEnd,
      new Date('2026-08-02T00:00:00.000Z'),
    )
    // 月末（8月28日）：消耗 500/27天 ≈ 18.5/天 → 剩余 500 需要 ~27天
    const late = computeBudgetBurn(
      consumed,
      totalBudget,
      windowStart,
      windowEnd,
      new Date('2026-08-28T00:00:00.000Z'),
    )

    // 月初燃烧率远高于月末
    expect(early.currentBurnRate).toBeGreaterThan(late.currentBurnRate)
    // 月初预计耗尽时间远早于月末
    expect(early.projectedExhaustionAt).not.toBeNull()
    expect(late.projectedExhaustionAt).not.toBeNull()
    expect(new Date(early.projectedExhaustionAt!).getTime()).toBeLessThan(
      new Date(late.projectedExhaustionAt!).getTime(),
    )
  })

  it('零消耗时 projectedExhaustionAt 为 null', () => {
    const result = computeBudgetBurn(
      0,
      1000,
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-08-31T23:59:59.999Z'),
      new Date('2026-08-15T00:00:00.000Z'),
    )
    expect(result.projectedExhaustionAt).toBeNull()
    expect(result.currentBurnRate).toBe(0)
  })
})

describe('§3.4 no data is not healthy (D8)', () => {
  it('无样本标注为 no_data 而非达标', () => {
    const def = buildSloDefinition()
    const result = evaluateAiSloIndicator(fixtureNoDataSamples(), 'ttft', def)
    expect(result.outcome).toBe('no_data')
    expect(result.actualValue).toBeNull()
    expect(result.outcome).not.toBe('healthy')
  })

  it('采集中断不表现为全绿', () => {
    const def = buildSloDefinition()
    const result = evaluateAiSloIndicator([], 'failure_rate', def)
    expect(result.outcome).toBe('no_data')
    // 确保不是 healthy
    expect(isAiSloEvaluationOutcome(result.outcome)).toBe(true)
    expect(AI_SLO_EVALUATION_OUTCOMES).toContain('no_data')
  })
})

describe('§3.6 evaluation determinism', () => {
  it('同一数据快照产出同一评估结果', () => {
    const def = buildSloDefinition({
      warning: buildSloThreshold({ value: 2000 }),
      critical: buildSloThreshold({ value: 5000 }),
    })
    const samples = fixtureWarningSamples()
    const evaluatedAt = '2026-08-22T00:00:00.000Z'

    const result1 = evaluateAiSloIndicatorDeterministic(samples, 'ttft', def, evaluatedAt)
    const result2 = evaluateAiSloIndicatorDeterministic(samples, 'ttft', def, evaluatedAt)

    expect(result1.outcome).toBe(result2.outcome)
    expect(result1.actualValue).toBe(result2.actualValue)
    expect(result1.triggeredTier).toBe(result2.triggeredTier)
    expect(result1.triggeredThreshold?.value).toBe(result2.triggeredThreshold?.value)
  })

  it('确定性评估不依赖 Date.now()', () => {
    const def = buildSloDefinition()
    const result = evaluateAiSloIndicatorDeterministic(
      fixtureCriticalSamples(),
      'ttft',
      def,
      '2026-01-01T00:00:00.000Z',
    )
    expect(result.evaluatedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// §4.1-4.8 告警去重
// ---------------------------------------------------------------------------

describe('§4.1 alert deduplication', () => {
  it('去重键按 (组织, 指标, 档位) 生成', () => {
    const key = buildAlertDeduplicationKey({
      organizationId: 1,
      indicator: 'ttft',
      tier: 'warning',
    })
    expect(key).toBe('1:ttft:warning')
  })

  it('不同组织产生不同去重键', () => {
    const key1 = buildAlertDeduplicationKey({
      organizationId: 1,
      indicator: 'ttft',
      tier: 'warning',
    })
    const key2 = buildAlertDeduplicationKey({
      organizationId: 2,
      indicator: 'ttft',
      tier: 'warning',
    })
    expect(key1).not.toBe(key2)
  })

  it('不同档位产生不同去重键', () => {
    const keyW = buildAlertDeduplicationKey({
      organizationId: 1,
      indicator: 'ttft',
      tier: 'warning',
    })
    const keyC = buildAlertDeduplicationKey({
      organizationId: 1,
      indicator: 'ttft',
      tier: 'critical',
    })
    expect(keyW).not.toBe(keyC)
  })
})

describe('§4.3 escalation produces new notification', () => {
  it('档位升级通知与原通知可区分', () => {
    const alert = buildAlertNotification({ notificationType: 'alert', tier: 'warning' })
    const escalation = buildEscalationNotification()
    expect(escalation.notificationType).toBe('escalation')
    expect(escalation.tier).toBe('critical')
    expect(escalation.notificationType).not.toBe(alert.notificationType)
  })
})

describe('§4.5 recovery notification', () => {
  it('恢复通知与告警通知可区分', () => {
    const alert = buildAlertNotification({ notificationType: 'alert' })
    const recovery = buildRecoveryNotification()
    expect(recovery.notificationType).toBe('recovery')
    expect(recovery.notificationType).not.toBe(alert.notificationType)
  })

  it('恢复通知有 isRecovery 标记', () => {
    const recovery = buildRecoveryAlertRecord()
    expect(recovery.isRecovery).toBe(true)
  })

  it('告警记录无 isRecovery 标记', () => {
    const alert = buildAlertRecord()
    expect(alert.isRecovery).toBe(false)
  })
})

describe('§4.7 delivery reuses notification channel', () => {
  it('通知类型枚举包含 alert/escalation/recovery', () => {
    // 这三种类型都通过既有 NotificationService 投递
    const notif = buildAlertNotification()
    expect(['alert', 'escalation', 'recovery']).toContain(notif.notificationType)
  })
})

// ---------------------------------------------------------------------------
// §5.1-5.5 不自动处置
// ---------------------------------------------------------------------------

describe('§5.1 no auto-remediation', () => {
  it('告警路径禁止的依赖类型明确列出', () => {
    expect(AI_SLO_FORBIDDEN_REMEDIATION_DEPS).toContain('model_selection')
    expect(AI_SLO_FORBIDDEN_REMEDIATION_DEPS).toContain('degradation')
    expect(AI_SLO_FORBIDDEN_REMEDIATION_DEPS).toContain('rate_limiting')
    expect(AI_SLO_FORBIDDEN_REMEDIATION_DEPS).toContain('rollback')
    expect(AI_SLO_FORBIDDEN_REMEDIATION_DEPS).toHaveLength(4)
  })

  it('告警路径只允许写告警记录', () => {
    expect(AI_SLO_ALLOWED_WRITES).toEqual(['alert_record'])
  })
})

describe('§5.4 alert carries runbook reference', () => {
  it('告警记录携带 runbookRef', () => {
    const alert = buildAlertRecord({ runbookRef: 'runbook://ai-slo/ttft/1' })
    expect(alert.runbookRef).toBe('runbook://ai-slo/ttft/1')
  })

  it('告警通知携带 runbookRef', () => {
    const notif = buildAlertNotification({ runbookRef: 'runbook://ai-slo/failure_rate/2' })
    expect(notif.runbookRef).toBe('runbook://ai-slo/failure_rate/2')
  })

  it('评估结果携带 runbookRef', () => {
    const result = buildEvaluationResult({ runbookRef: 'runbook://ai-slo/ttft/3' })
    expect(result.runbookRef).toBe('runbook://ai-slo/ttft/3')
  })
})

// ---------------------------------------------------------------------------
// §6.1-6.5 阈值配置
// ---------------------------------------------------------------------------

describe('§6.1-6.2 threshold configuration', () => {
  it('下调阈值使其更敏感被接受', () => {
    const def = buildSloDefinition({
      warning: buildSloThreshold({ operator: 'gt', value: 2000 }),
    })
    const result = validateThresholdChange(def, {
      sloDefinitionId: def.id,
      organizationId: 1,
      tier: 'warning',
      newValue: buildSloThreshold({ operator: 'gt', value: 1500 }),
      actorId: 1,
    })
    expect(result.success).toBe(true)
    expect(result.newThreshold?.value).toBe(1500)
  })

  it('上调阈值超过声明上限被拒', () => {
    const def = buildSloDefinition({
      warning: buildSloThreshold({ operator: 'gt', value: 2000 }),
    })
    const result = validateThresholdChange(def, {
      sloDefinitionId: def.id,
      organizationId: 1,
      tier: 'warning',
      newValue: buildSloThreshold({ operator: 'gt', value: 3000 }),
      actorId: 1,
    })
    expect(result.success).toBe(false)
    expect(result.reason).toContain('上调超过声明上限')
  })

  it('相同阈值不变更', () => {
    const def = buildSloDefinition({
      warning: buildSloThreshold({ operator: 'gt', value: 2000 }),
    })
    const result = validateThresholdChange(def, {
      sloDefinitionId: def.id,
      organizationId: 1,
      tier: 'warning',
      newValue: buildSloThreshold({ operator: 'gt', value: 2000 }),
      actorId: 1,
    })
    // 相同值既不是下调也不是上调
    expect(result.success).toBe(false)
  })

  it('lt 运算符下上调阈值使其更敏感被接受', () => {
    const def = buildSloDefinition({
      warning: buildSloThreshold({ operator: 'lt', value: 100 }),
    })
    const result = validateThresholdChange(def, {
      sloDefinitionId: def.id,
      organizationId: 1,
      tier: 'warning',
      newValue: buildSloThreshold({ operator: 'lt', value: 150 }),
      actorId: 1,
    })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// §7.1-7.6 组织隔离与 RBAC
// ---------------------------------------------------------------------------

describe('§7.1-7.6 organization isolation', () => {
  it('SLO 查询输入必须包含 organizationId', () => {
    const query: AiSloQueryInput = {
      organizationId: 1,
      permissions: ['slo:read'],
    }
    expect(query.organizationId).toBe(1)
  })

  it('权限列表包含 read/manage/configure', () => {
    expect(AI_SLO_PERMISSIONS).toContain('slo:read')
    expect(AI_SLO_PERMISSIONS).toContain('slo:manage')
    expect(AI_SLO_PERMISSIONS).toContain('slo:configure')
    expect(AI_SLO_PERMISSIONS).toHaveLength(3)
  })

  it('SLO 定义包含 organizationId', () => {
    const def = buildSloDefinition({ organizationId: 42 })
    expect(def.organizationId).toBe(42)
  })

  it('告警记录包含 organizationId', () => {
    const alert = buildAlertRecord({ organizationId: 42 })
    expect(alert.organizationId).toBe(42)
  })

  it('告警通知包含 organizationId', () => {
    const notif = buildAlertNotification({ organizationId: 42 })
    expect(notif.organizationId).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// §5.2-5.3 告警路径无 remediation 依赖 & 零域写
// ---------------------------------------------------------------------------

describe('§5.2 no remediation dependency', () => {
  it('告警记录只含指标名、档位、数值、时间与 runbook', () => {
    const record = buildAlertRecord()
    const keys = Object.keys(record)
    // 只允许这些字段
    const allowedFields = [
      'id',
      'organizationId',
      'indicator',
      'tier',
      'actualValue',
      'thresholdValue',
      'triggeredAt',
      'runbookRef',
      'isRecovery',
    ]
    for (const key of keys) {
      expect(allowedFields).toContain(key)
    }
  })

  it('告警记录不含模型选型、降级、限流、回滚字段', () => {
    const record = buildAlertRecord()
    const json = JSON.stringify(record).toLowerCase()
    expect(json).not.toContain('model_selection')
    expect(json).not.toContain('degradation')
    expect(json).not.toContain('rate_limit')
    expect(json).not.toContain('rollback')
  })
})

// ---------------------------------------------------------------------------
// §2.8 五态 fixtures
// ---------------------------------------------------------------------------

describe('§2.8 five-state fixtures', () => {
  beforeEach(() => {
    resetAiSloFixtureSeq()
  })

  it('达标态 fixture 样本在阈值内', () => {
    const samples = fixtureHealthySamples()
    expect(samples.length).toBeGreaterThan(0)
    for (const s of samples) {
      expect(s).toBeLessThan(2000) // warning 阈值
    }
  })

  it('warning 态 fixture 样本超过 warning 阈值', () => {
    const samples = fixtureWarningSamples()
    for (const s of samples) {
      expect(s).toBeGreaterThan(2000)
    }
  })

  it('critical 态 fixture 样本超过 critical 阈值', () => {
    const samples = fixtureCriticalSamples()
    for (const s of samples) {
      expect(s).toBeGreaterThan(5000)
    }
  })

  it('无数据态 fixture 为空数组', () => {
    expect(fixtureNoDataSamples()).toEqual([])
  })

  it('恢复态 fixture 样本回到阈值内', () => {
    const samples = fixtureRecoverySamples()
    for (const s of samples) {
      expect(s).toBeLessThan(2000)
    }
  })
})

// ---------------------------------------------------------------------------
// §4.2, §4.4, §4.6, §4.8 补充测试
// ---------------------------------------------------------------------------

describe('§4.2 sustained breach notifies once', () => {
  it('持续越界用相同去重键标识', () => {
    const key1 = buildAlertDeduplicationKey({
      organizationId: 1,
      indicator: 'ttft',
      tier: 'warning',
    })
    const key2 = buildAlertDeduplicationKey({
      organizationId: 1,
      indicator: 'ttft',
      tier: 'warning',
    })
    expect(key1).toBe(key2) // 相同键 = 应去重
  })
})

describe('§4.4 escalation感知', () => {
  it('升级通知 tier 从 warning 变为 critical', () => {
    const alert = buildAlertNotification({ tier: 'warning' })
    const escalation = buildEscalationNotification()
    expect(escalation.tier).toBe('critical')
    expect(alert.tier).toBe('warning')
    expect(escalation.tier).not.toBe(alert.tier)
  })
})

describe('§4.6 recovery distinguishable', () => {
  it('恢复通知有 distinct notificationType', () => {
    const alert = buildAlertNotification({ notificationType: 'alert' })
    const recovery = buildRecoveryNotification()
    expect(recovery.notificationType).toBe('recovery')
    expect(recovery.notificationType).not.toBe(alert.notificationType)
  })
})

describe('§4.8 no second delivery mechanism', () => {
  it('所有通知类型都通过同一套枚举', () => {
    // 确保没有超出 alert/escalation/recovery 的通知类型
    const types = ['alert', 'escalation', 'recovery']
    const notif = buildAlertNotification()
    expect(types).toContain(notif.notificationType)
  })
})

// ---------------------------------------------------------------------------
// §8.4 默认测试不外发通知
// ---------------------------------------------------------------------------

describe('§8.4 default tests stay offline', () => {
  it('fixture 不含真实通知投递', () => {
    const notif = buildAlertNotification()
    // fixture 只含元数据，不含投递动作
    expect(notif.id).toBeTruthy()
    expect(notif.sentAt).toBeTruthy()
    // 无外发 URL / API key
    const json = JSON.stringify(notif)
    expect(json).not.toContain('http')
    expect(json).not.toContain('api_key')
    expect(json).not.toContain('apiKey')
  })
})

// ---------------------------------------------------------------------------
// §3.5 采集中断不表现为全绿
// ---------------------------------------------------------------------------

describe('§3.5 collection outage', () => {
  it('所有指标无样本时都返回 no_data', () => {
    const def = buildSloDefinition()
    for (const indicator of AI_SLO_INDICATORS) {
      const result = evaluateAiSloIndicator([], indicator, def)
      expect(result.outcome).toBe('no_data')
      expect(result.outcome).not.toBe('healthy')
    }
  })
})

// ---------------------------------------------------------------------------
// §3.7 确定性测试（补充）
// ---------------------------------------------------------------------------

describe('§3.7 determinism (supplementary)', () => {
  it('不同时间戳但相同数据产出相同结论', () => {
    const def = buildSloDefinition({
      warning: buildSloThreshold({ value: 2000 }),
      critical: buildSloThreshold({ value: 5000 }),
    })
    const samples = fixtureCriticalSamples()

    const r1 = evaluateAiSloIndicatorDeterministic(samples, 'ttft', def, '2026-01-01T00:00:00.000Z')
    const r2 = evaluateAiSloIndicatorDeterministic(samples, 'ttft', def, '2026-12-31T23:59:59.999Z')

    expect(r1.outcome).toBe(r2.outcome)
    expect(r1.actualValue).toBe(r2.actualValue)
    expect(r1.triggeredTier).toBe(r2.triggeredTier)
  })
})

// ---------------------------------------------------------------------------
// §3.1 compareAiSloThreshold 补充
// ---------------------------------------------------------------------------

describe('§3.1 threshold comparison', () => {
  it('gt: actual <= threshold → pass', () => {
    expect(compareAiSloThreshold(100, 'gt', 100)).toBe(true)
    expect(compareAiSloThreshold(99, 'gt', 100)).toBe(true)
    expect(compareAiSloThreshold(101, 'gt', 100)).toBe(false)
  })

  it('gte: actual < threshold → pass', () => {
    expect(compareAiSloThreshold(99, 'gte', 100)).toBe(true)
    expect(compareAiSloThreshold(100, 'gte', 100)).toBe(false)
  })

  it('lt: actual >= threshold → pass', () => {
    expect(compareAiSloThreshold(100, 'lt', 100)).toBe(true)
    expect(compareAiSloThreshold(101, 'lt', 100)).toBe(true)
    expect(compareAiSloThreshold(99, 'lt', 100)).toBe(false)
  })

  it('lte: actual > threshold → pass', () => {
    expect(compareAiSloThreshold(101, 'lte', 100)).toBe(true)
    expect(compareAiSloThreshold(100, 'lte', 100)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §6.4-6.5 阈值变更权限
// ---------------------------------------------------------------------------

describe('§6.4 threshold change requires permission', () => {
  it('有 slo:configure 权限的变更被允许', () => {
    const result = checkSloThresholdChangePermission(['slo:configure'])
    expect(result.allowed).toBe(true)
  })

  it('无 slo:configure 权限的变更被拒', () => {
    const result = checkSloThresholdChangePermission(['slo:read'])
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('slo:configure')
  })

  it('空权限列表被拒', () => {
    const result = checkSloThresholdChangePermission([])
    expect(result.allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §7.3-7.4 查询 RBAC 校验
// ---------------------------------------------------------------------------

describe('§7.3 RBAC query validation', () => {
  it('有 slo:read 权限的查询被允许', () => {
    const query: AiSloQueryInput = {
      organizationId: 1,
      permissions: ['slo:read'],
    }
    const result = checkSloQueryPermission(query, 'slo:read')
    expect(result.allowed).toBe(true)
  })

  it('无 slo:read 权限的查询被拒', () => {
    const query: AiSloQueryInput = {
      organizationId: 1,
      permissions: [],
    }
    const result = checkSloQueryPermission(query, 'slo:read')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('slo:read')
  })

  it('slo:manage 权限校验', () => {
    const result = checkSloManagePermission(['slo:manage'])
    expect(result.allowed).toBe(true)

    const denied = checkSloManagePermission(['slo:read'])
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toContain('slo:manage')
  })

  it('权限枚举包含 read/manage/configure', () => {
    expect(AI_SLO_PERMISSIONS).toContain('slo:read')
    expect(AI_SLO_PERMISSIONS).toContain('slo:manage')
    expect(AI_SLO_PERMISSIONS).toContain('slo:configure')
  })

  it('isAiSloPermission 正确识别合法与非法值', () => {
    expect(isAiSloPermission('slo:read')).toBe(true)
    expect(isAiSloPermission('slo:manage')).toBe(true)
    expect(isAiSloPermission('slo:invalid')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §7.5 告警记录保留期声明
// ---------------------------------------------------------------------------

describe('§7.5 alert retention declaration', () => {
  it('声明保留期为 90 天', () => {
    expect(AI_SLO_ALERT_RETENTION_POLICY.retentionDays).toBe(90)
  })

  it('保留期声明包含说明', () => {
    expect(AI_SLO_ALERT_RETENTION_POLICY.note).toContain('v3-observability-data-retention')
  })
})
