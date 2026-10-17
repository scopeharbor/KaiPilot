import { test } from '@japa/runner'
import {
  OBSERVABILITY_DATA_CLASSES,
  DATA_CLASS_TIER_MAP,
  OBSERVABILITY_RETENTION_DEFAULT_DAYS,
  buildObservabilityDefaultCategoryPolicies,
  computeObservabilityRetentionPolicyHash,
  getDefaultRetentionDays,
  getTierForDataClass,
  isSecurityDataClass,
  isEligibleForCleanup,
  computeAggregateSummary,
  isRetentionChangeValid,
  mergeObservabilityRetentionPolicy,
} from '@aiproj/types'

test.group('ObservabilityRetentionService — 策略解析', (group) => {
  group.setup(() => {})

  test('系统默认策略覆盖所有类别', ({ assert }) => {
    const categories = buildObservabilityDefaultCategoryPolicies()
    assert.equal(categories.length, OBSERVABILITY_DATA_CLASSES.length)
  })

  test('每个类别都有正确的档期', ({ assert }) => {
    const categories = buildObservabilityDefaultCategoryPolicies()
    for (const cat of categories) {
      const expectedTier = DATA_CLASS_TIER_MAP[cat.dataClass]
      assert.equal(cat.tier, expectedTier)
    }
  })

  test('安全事件档期长于一般数据', ({ assert }) => {
    const generalDays = getDefaultRetentionDays('trace_spans')
    const securityDays = getDefaultRetentionDays('security_events')
    assert.ok(securityDays > generalDays)
  })

  test('策略哈希确定性', ({ assert }) => {
    const categories = buildObservabilityDefaultCategoryPolicies()
    const hash1 = computeObservabilityRetentionPolicyHash({
      organizationId: 1,
      categories,
    })
    const hash2 = computeObservabilityRetentionPolicyHash({
      organizationId: 1,
      categories,
    })
    assert.equal(hash1, hash2)
  })

  test('策略哈希区分不同组织', ({ assert }) => {
    const categories = buildObservabilityDefaultCategoryPolicies()
    const hash1 = computeObservabilityRetentionPolicyHash({
      organizationId: 1,
      categories,
    })
    const hash2 = computeObservabilityRetentionPolicyHash({
      organizationId: 2,
      categories,
    })
    assert.notEqual(hash1, hash2)
  })
})

test.group('ObservabilityRetentionService — 策略合并', (group) => {
  group.setup(() => {})

  test('缩短保留期生效', ({ assert }) => {
    const base = buildObservabilityDefaultCategoryPolicies()
    const { categories, rejected } = mergeObservabilityRetentionPolicy(base, [
      { dataClass: 'trace_spans', retentionDays: 15 },
    ])
    const traceSpans = categories.find((c) => c.dataClass === 'trace_spans')
    assert.equal(traceSpans?.retentionDays, 15)
    assert.equal(rejected.length, 0)
  })

  test('延长超过声明上限被拒绝', ({ assert }) => {
    const base = buildObservabilityDefaultCategoryPolicies()
    const { categories, rejected } = mergeObservabilityRetentionPolicy(base, [
      { dataClass: 'trace_spans', retentionDays: 100 },
    ])
    const traceSpans = categories.find((c) => c.dataClass === 'trace_spans')
    assert.equal(traceSpans?.retentionDays, OBSERVABILITY_RETENTION_DEFAULT_DAYS.general)
    assert.equal(rejected.length, 1)
    assert.equal(rejected[0].reason, 'exceeds_maximum')
  })

  test('安全事件可延长到 730 天', ({ assert }) => {
    const base = buildObservabilityDefaultCategoryPolicies()
    const { categories, rejected } = mergeObservabilityRetentionPolicy(base, [
      { dataClass: 'security_events', retentionDays: 730 },
    ])
    const sec = categories.find((c) => c.dataClass === 'security_events')
    assert.equal(sec?.retentionDays, 730)
    assert.equal(rejected.length, 0)
  })
})

test.group('ObservabilityRetentionService — 过期前聚合', (group) => {
  group.setup(() => {})

  test('未聚合时不满足清理条件', ({ assert }) => {
    const eligible = isEligibleForCleanup({
      recordCreatedAt: '2026-01-01T00:00:00.000Z',
      retentionDays: 30,
      nowIso: '2026-12-01T00:00:00.000Z',
      aggregateMaterialized: false,
    })
    assert.equal(eligible, false)
  })

  test('已聚合且到期满足清理条件', ({ assert }) => {
    const eligible = isEligibleForCleanup({
      recordCreatedAt: '2026-01-01T00:00:00.000Z',
      retentionDays: 30,
      nowIso: '2026-12-01T00:00:00.000Z',
      aggregateMaterialized: true,
    })
    assert.equal(eligible, true)
  })

  test('聚合确定性', ({ assert }) => {
    const records = [
      { id: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, createdAt: '2026-01-15T00:00:00.000Z' },
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
  })

  test('聚合不含禁存字段', ({ assert }) => {
    const agg = computeAggregateSummary({
      organizationId: 1,
      dataClass: 'trace_spans',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T23:59:59.999Z',
      records: [{ id: 1, createdAt: '2026-01-01T00:00:00.000Z' }],
    })
    assert.ok(agg.prohibitedFields.includes('prompt'))
    assert.ok(agg.prohibitedFields.includes('token'))
    assert.ok(agg.prohibitedFields.includes('secret'))
  })
})

test.group('ObservabilityRetentionService — 保留期变更', (group) => {
  group.setup(() => {})

  test('缩短合法', ({ assert }) => {
    const result = isRetentionChangeValid({
      dataClass: 'trace_spans',
      currentDays: 30,
      newDays: 15,
    })
    assert.ok(result.valid)
  })

  test('延长超过上限非法', ({ assert }) => {
    const result = isRetentionChangeValid({
      dataClass: 'trace_spans',
      currentDays: 30,
      newDays: 100,
    })
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'exceeds_maximum')
  })
})

test.group('ObservabilityRetentionService — 安全事件分类', (group) => {
  group.setup(() => {})

  test('安全事件识别', ({ assert }) => {
    assert.ok(isSecurityDataClass('security_events'))
    assert.ok(!isSecurityDataClass('trace_spans'))
  })

  test('档期正确映射', ({ assert }) => {
    assert.equal(getTierForDataClass('trace_spans'), 'general')
    assert.equal(getTierForDataClass('security_events'), 'security')
    assert.equal(getTierForDataClass('ocr_provider_observability'), 'sensitive')
  })
})
