// vitest 的 include 匹配 src/**/*.test.ts：本文件若从 'node:test' 取 describe/it，
// vitest 收集得到文件却找不到任何 suite，直接报 "No test suite found" 并让整包测试变红
// （断言一条也不执行）。改用 vitest 的 describe/it，断言仍用 node:assert/strict。
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  OBSERVABILITY_DATA_CLASSES,
  SECURITY_DATA_CLASSES,
  RETENTION_TIERS,
  DATA_CLASS_TIER_MAP,
  OBSERVABILITY_RETENTION_TIER_BOUNDS,
  OBSERVABILITY_RETENTION_DEFAULT_DAYS,
  isObservabilityDataClass,
  isRetentionTier,
  computeObservabilityRetentionPolicyHash,
  computeAggregateHash,
  computeCleanupRunKey,
  getDefaultRetentionDays,
  getTierForDataClass,
  getMaxRetentionDays,
  getMinRetentionDays,
  isSecurityDataClass,
  buildObservabilityDefaultCategoryPolicies,
  resolveObservabilityDefaultRetentionPolicy,
  mergeObservabilityRetentionPolicy,
  validatePolicyUpdateRequest,
  retentionDaysForDataClass,
  computeObservabilityRetentionDeadlineIso,
  isObservabilityRetentionDeadlineReached,
  isEligibleForCleanup,
  computeAggregateSummary,
  isRetentionChangeValid,
  type ObservabilityDataClass,
  type RetentionTier,
} from './observability-retention.js'

describe('ObservabilityDataRetention — 枚举与分类', () => {
  it('数据类别枚举包含所有预期类别', () => {
    assert.equal(OBSERVABILITY_DATA_CLASSES.length, 19)
    assert.ok(OBSERVABILITY_DATA_CLASSES.includes('trace_spans'))
    assert.ok(OBSERVABILITY_DATA_CLASSES.includes('security_events'))
    assert.ok(OBSERVABILITY_DATA_CLASSES.includes('invocation_ledger'))
  })

  it('安全事件类别是数据类别的子集', () => {
    for (const cls of SECURITY_DATA_CLASSES) {
      assert.ok(OBSERVABILITY_DATA_CLASSES.includes(cls))
    }
  })

  it('安全事件的档期长于一般观察数据', () => {
    const generalTier = DATA_CLASS_TIER_MAP['trace_spans']
    const securityTier = DATA_CLASS_TIER_MAP['security_events']
    assert.ok(
      OBSERVABILITY_RETENTION_TIER_BOUNDS[securityTier].maxDays >
        OBSERVABILITY_RETENTION_TIER_BOUNDS[generalTier].maxDays,
      `Security tier max (${OBSERVABILITY_RETENTION_TIER_BOUNDS[securityTier].maxDays}) ` +
        `must be > general tier max (${OBSERVABILITY_RETENTION_TIER_BOUNDS[generalTier].maxDays})`,
    )
  })

  it('每个数据类别都映射到有效档期', () => {
    for (const dataClass of OBSERVABILITY_DATA_CLASSES) {
      const tier = DATA_CLASS_TIER_MAP[dataClass]
      assert.ok(
        RETENTION_TIERS.includes(tier),
        `Data class ${dataClass} maps to invalid tier ${tier}`,
      )
    }
  })
})

describe('ObservabilityDataRetention — 类型守卫', () => {
  it('isObservabilityDataClass 识别有效类别', () => {
    assert.ok(isObservabilityDataClass('trace_spans'))
    assert.ok(isObservabilityDataClass('security_events'))
    assert.ok(!isObservabilityDataClass('invalid_class'))
    assert.ok(!isObservabilityDataClass(null))
    assert.ok(!isObservabilityDataClass(42))
  })

  it('isRetentionTier 识别有效档期', () => {
    assert.ok(isRetentionTier('general'))
    assert.ok(isRetentionTier('sensitive'))
    assert.ok(isRetentionTier('security'))
    assert.ok(!isRetentionTier('invalid'))
  })
})

describe('ObservabilityDataRetention — 哈希确定性', () => {
  it('策略哈希确定性：同一输入产出同一输出', () => {
    const categories = buildObservabilityDefaultCategoryPolicies()
    const hash1 = computeObservabilityRetentionPolicyHash({ organizationId: 1, categories })
    const hash2 = computeObservabilityRetentionPolicyHash({ organizationId: 1, categories })
    assert.equal(hash1, hash2)
  })

  it('策略哈希区分不同组织', () => {
    const categories = buildObservabilityDefaultCategoryPolicies()
    const hash1 = computeObservabilityRetentionPolicyHash({ organizationId: 1, categories })
    const hash2 = computeObservabilityRetentionPolicyHash({ organizationId: 2, categories })
    assert.notEqual(hash1, hash2)
  })

  it('聚合哈希确定性', () => {
    const hash1 = computeAggregateHash({
      organizationId: 1,
      dataClass: 'trace_spans',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T23:59:59.999Z',
      recordCount: 100,
    })
    const hash2 = computeAggregateHash({
      organizationId: 1,
      dataClass: 'trace_spans',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T23:59:59.999Z',
      recordCount: 100,
    })
    assert.equal(hash1, hash2)
  })

  it('聚合哈希区分不同记录数', () => {
    const hash1 = computeAggregateHash({
      organizationId: 1,
      dataClass: 'trace_spans',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T23:59:59.999Z',
      recordCount: 100,
    })
    const hash2 = computeAggregateHash({
      organizationId: 1,
      dataClass: 'trace_spans',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T23:59:59.999Z',
      recordCount: 101,
    })
    assert.notEqual(hash1, hash2)
  })

  it('清理运行幂等键按天粒度', () => {
    const key1 = computeCleanupRunKey({
      organizationId: 1,
      dataClass: 'trace_spans',
      nowIso: '2026-08-22T10:00:00.000Z',
    })
    const key2 = computeCleanupRunKey({
      organizationId: 1,
      dataClass: 'trace_spans',
      nowIso: '2026-08-22T15:00:00.000Z',
    })
    assert.equal(key1, key2) // 同一天
  })

  it('清理运行幂等键区分不同天', () => {
    const key1 = computeCleanupRunKey({
      organizationId: 1,
      dataClass: 'trace_spans',
      nowIso: '2026-08-22T23:59:59.999Z',
    })
    const key2 = computeCleanupRunKey({
      organizationId: 1,
      dataClass: 'trace_spans',
      nowIso: '2026-08-23T00:00:00.000Z',
    })
    assert.notEqual(key1, key2)
  })
})

describe('ObservabilityDataRetention — 策略解析', () => {
  it('系统默认策略覆盖所有类别', () => {
    const policy = resolveObservabilityDefaultRetentionPolicy({ organizationId: 1 })
    assert.equal(policy.categories.length, OBSERVABILITY_DATA_CLASSES.length)
    assert.equal(policy.source, 'system')
    assert.equal(policy.organizationId, 1)
  })

  it('每个类别都有正确的档期', () => {
    const categories = buildObservabilityDefaultCategoryPolicies()
    for (const cat of categories) {
      const expectedTier = DATA_CLASS_TIER_MAP[cat.dataClass]
      assert.equal(cat.tier, expectedTier)
    }
  })

  it('retentionDaysForDataClass 回落系统默认', () => {
    const policy = resolveObservabilityDefaultRetentionPolicy({ organizationId: 1 })
    const days = retentionDaysForDataClass(policy, 'trace_spans')
    assert.equal(days, OBSERVABILITY_RETENTION_DEFAULT_DAYS.general)
  })

  it('getTierForDataClass 返回正确档期', () => {
    assert.equal(getTierForDataClass('trace_spans'), 'general')
    assert.equal(getTierForDataClass('security_events'), 'security')
    assert.equal(getTierForDataClass('ocr_provider_observability'), 'sensitive')
  })

  it('getMaxRetentionDays 返回正确上限', () => {
    assert.equal(getMaxRetentionDays('general'), 90)
    assert.equal(getMaxRetentionDays('sensitive'), 365)
    assert.equal(getMaxRetentionDays('security'), 730)
  })

  it('getMinRetentionDays 返回正确下限', () => {
    assert.equal(getMinRetentionDays('general'), 1)
    assert.equal(getMinRetentionDays('sensitive'), 1)
    assert.equal(getMinRetentionDays('security'), 1)
  })

  it('isSecurityDataClass 识别安全事件', () => {
    assert.ok(isSecurityDataClass('security_events'))
    assert.ok(!isSecurityDataClass('trace_spans'))
    assert.ok(!isSecurityDataClass('ocr_provider_observability'))
  })
})

describe('ObservabilityDataRetention — 策略合并', () => {
  it('缩短保留期生效', () => {
    const base = buildObservabilityDefaultCategoryPolicies()
    const { categories, rejected } = mergeObservabilityRetentionPolicy(base, [
      { dataClass: 'trace_spans', retentionDays: 15 },
    ])
    const traceSpans = categories.find((c) => c.dataClass === 'trace_spans')
    assert.equal(traceSpans?.retentionDays, 15)
    assert.equal(rejected.length, 0)
  })

  it('延长超过声明上限被拒绝', () => {
    const base = buildObservabilityDefaultCategoryPolicies()
    const { categories, rejected } = mergeObservabilityRetentionPolicy(base, [
      { dataClass: 'trace_spans', retentionDays: 100 }, // 超过 general 上限 90
    ])
    const traceSpans = categories.find((c) => c.dataClass === 'trace_spans')
    assert.equal(traceSpans?.retentionDays, OBSERVABILITY_RETENTION_DEFAULT_DAYS.general) // 保留原值
    assert.equal(rejected.length, 1)
    assert.equal(rejected[0].dataClass, 'trace_spans')
    assert.equal(rejected[0].reason, 'exceeds_maximum')
  })

  it('安全事件可延长到 730 天', () => {
    const base = buildObservabilityDefaultCategoryPolicies()
    const { categories, rejected } = mergeObservabilityRetentionPolicy(base, [
      { dataClass: 'security_events', retentionDays: 730 },
    ])
    const sec = categories.find((c) => c.dataClass === 'security_events')
    assert.equal(sec?.retentionDays, 730)
    assert.equal(rejected.length, 0)
  })
})

describe('ObservabilityDataRetention — 策略验证', () => {
  it('有效请求无错误', () => {
    const errors = validatePolicyUpdateRequest({
      categories: [
        { dataClass: 'trace_spans', retentionDays: 15 },
        { dataClass: 'security_events', retentionDays: 500 },
      ],
    })
    assert.equal(errors.length, 0)
  })

  it('超出上限被拒', () => {
    const errors = validatePolicyUpdateRequest({
      categories: [{ dataClass: 'trace_spans', retentionDays: 100 }],
    })
    assert.equal(errors.length, 1)
    assert.equal(errors[0].reason, 'exceeds_maximum')
  })

  it('未知类别被拒', () => {
    const errors = validatePolicyUpdateRequest({
      categories: [{ dataClass: 'nonexistent' as ObservabilityDataClass, retentionDays: 15 }],
    })
    assert.equal(errors.length, 1)
    assert.equal(errors[0].reason, 'unknown_class')
  })
})

describe('ObservabilityDataRetention — 保留截止时间', () => {
  it('计算截止时间正确', () => {
    const deadline = computeObservabilityRetentionDeadlineIso('2026-08-22T00:00:00.000Z', 30)
    assert.equal(deadline, '2026-09-21T00:00:00.000Z')
  })

  it('未到期判定为 false', () => {
    const reached = isObservabilityRetentionDeadlineReached({
      baseIso: '2026-08-22T00:00:00.000Z',
      retentionDays: 30,
      nowIso: '2026-09-01T00:00:00.000Z',
    })
    assert.equal(reached, false)
  })

  it('已到期判定为 true', () => {
    const reached = isObservabilityRetentionDeadlineReached({
      baseIso: '2026-08-22T00:00:00.000Z',
      retentionDays: 30,
      nowIso: '2026-10-01T00:00:00.000Z',
    })
    assert.equal(reached, true)
  })
})

describe('ObservabilityDataRetention — 过期前聚合', () => {
  it('未聚合时不满足清理条件', () => {
    const eligible = isEligibleForCleanup({
      recordCreatedAt: '2026-01-01T00:00:00.000Z',
      retentionDays: 30,
      nowIso: '2026-12-01T00:00:00.000Z',
      aggregateMaterialized: false,
    })
    assert.equal(eligible, false)
  })

  it('已聚合且到期满足清理条件', () => {
    const eligible = isEligibleForCleanup({
      recordCreatedAt: '2026-01-01T00:00:00.000Z',
      retentionDays: 30,
      nowIso: '2026-12-01T00:00:00.000Z',
      aggregateMaterialized: true,
    })
    assert.equal(eligible, true)
  })

  it('已聚合但未到期不满足清理条件', () => {
    const eligible = isEligibleForCleanup({
      recordCreatedAt: '2026-08-01T00:00:00.000Z',
      retentionDays: 30,
      nowIso: '2026-08-15T00:00:00.000Z',
      aggregateMaterialized: true,
    })
    assert.equal(eligible, false)
  })
})

describe('ObservabilityDataRetention — 聚合确定性', () => {
  it('同一快照产出同一聚合', () => {
    const records = [
      { id: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, createdAt: '2026-01-15T00:00:00.000Z' },
      { id: 3, createdAt: '2026-01-20T00:00:00.000Z' },
    ]
    const agg1 = computeAggregateSummary({
      organizationId: 1,
      dataClass: 'trace_spans',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T23:59:59.999Z',
      records,
    })
    const agg2 = computeAggregateSummary({
      organizationId: 1,
      dataClass: 'trace_spans',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T23:59:59.999Z',
      records,
    })
    assert.equal(agg1.aggregateHash, agg2.aggregateHash)
    assert.equal(agg1.recordCount, agg2.recordCount)
  })

  it('聚合不含禁存字段', () => {
    const agg = computeAggregateSummary({
      organizationId: 1,
      dataClass: 'trace_spans',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T23:59:59.999Z',
      records: [{ id: 1, createdAt: '2026-01-01T00:00:00.000Z' }],
    })
    assert.ok(agg.prohibitedFields.length > 0)
    assert.ok(agg.prohibitedFields.includes('prompt'))
    assert.ok(agg.prohibitedFields.includes('token'))
    assert.ok(agg.prohibitedFields.includes('secret'))
  })
})

describe('ObservabilityDataRetention — 保留期变更合法性', () => {
  it('缩短合法', () => {
    const result = isRetentionChangeValid({
      dataClass: 'trace_spans',
      currentDays: 30,
      newDays: 15,
    })
    assert.ok(result.valid)
  })

  it('延长但不超上限合法', () => {
    const result = isRetentionChangeValid({
      dataClass: 'trace_spans',
      currentDays: 30,
      newDays: 60,
    })
    assert.ok(result.valid)
  })

  it('延长超过上限非法', () => {
    const result = isRetentionChangeValid({
      dataClass: 'trace_spans',
      currentDays: 30,
      newDays: 100,
    })
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'exceeds_maximum')
  })

  it('低于最小值非法', () => {
    const result = isRetentionChangeValid({
      dataClass: 'trace_spans',
      currentDays: 30,
      newDays: 0,
    })
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'out_of_bounds')
  })
})
