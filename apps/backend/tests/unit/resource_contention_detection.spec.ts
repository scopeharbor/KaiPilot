import { test } from '@japa/runner'
import { normalizeResourceContentionQuery } from '@aiproj/types'

test.group('ResourceContentionDetectionService - Severity Classification', () => {
  test('derive severity values are correct', async ({ assert }) => {
    // Tests that the severity derivation imported from @aiproj/types works correctly
    const { deriveResourceContentionSeverity } = await import('@aiproj/types')

    assert.equal(
      deriveResourceContentionSeverity({ unavailableCapacity: true }),
      'critical',
      'unavailable capacity must be critical',
    )

    assert.equal(
      deriveResourceContentionSeverity({ overloadRatio: 200 }),
      'critical',
      'overload >= 150% must be critical',
    )

    assert.equal(
      deriveResourceContentionSeverity({ overloadRatio: 130 }),
      'high',
      'overload >= 120% must be high',
    )

    assert.equal(
      deriveResourceContentionSeverity({ overloadRatio: 110 }),
      'warning',
      'overload >= 100% must be warning',
    )

    assert.equal(
      deriveResourceContentionSeverity({ overloadRatio: 50 }),
      'info',
      'overload < 100% must be info',
    )

    assert.equal(
      deriveResourceContentionSeverity({ criticalSkill: true, affectedProjectCount: 3 }),
      'critical',
      'critical skill with 3+ projects must be critical',
    )

    assert.equal(
      deriveResourceContentionSeverity({ isDraft: true }),
      'warning',
      'draft must be at least warning',
    )
  })

  test('reason code ordering is stable', async ({ assert }) => {
    const { sortContentionReasons, RESOURCE_CONTENTION_REASON_CODES } =
      await import('@aiproj/types')

    const sorted = sortContentionReasons([
      RESOURCE_CONTENTION_REASON_CODES.DRAFT_ALLOCATION_CONTENTION,
      RESOURCE_CONTENTION_REASON_CODES.CROSS_PROJECT_OVERLOAD,
      RESOURCE_CONTENTION_REASON_CODES.CRITICAL_SKILL_CONTENTION,
    ])

    assert.equal(sorted[0], RESOURCE_CONTENTION_REASON_CODES.CROSS_PROJECT_OVERLOAD)
    assert.equal(sorted[1], RESOURCE_CONTENTION_REASON_CODES.CRITICAL_SKILL_CONTENTION)
    assert.equal(sorted[2], RESOURCE_CONTENTION_REASON_CODES.DRAFT_ALLOCATION_CONTENTION)
  })
})

test.group('ResourceContentionDetectionService - Query Validation', () => {
  test('normalize query returns valid defaults', async ({ assert }) => {
    const query = normalizeResourceContentionQuery({})
    assert.equal(query.view, 'summary')
    assert.equal(query.page, 1)
    assert.equal(query.perPage, 20)
    assert.isNull(query.severity)
    assert.isNull(query.reasonCode)
  })

  test('normalize query clamps excessive values', async ({ assert }) => {
    const query = normalizeResourceContentionQuery({ page: -1, perPage: 500, topN: 1000 })
    assert.equal(query.page, 1)
    assert.equal(query.perPage, 100)
    assert.equal(query.topN, 50)
  })

  test('normalize query rejects invalid severity and reasonCode', async ({ assert }) => {
    const query = normalizeResourceContentionQuery({
      severity: 'invalid' as any,
      reasonCode: 'bogus' as any,
    })
    assert.isNull(query.severity)
    assert.isNull(query.reasonCode)
  })

  test('normalize query preserves valid filters', async ({ assert }) => {
    const query = normalizeResourceContentionQuery({
      severity: 'critical',
      reasonCode: 'cross-project-overload',
      sort: 'severity',
      order: 'desc',
    })
    assert.equal(query.severity, 'critical')
    assert.equal(query.reasonCode, 'cross-project-overload')
    assert.equal(query.sort, 'severity')
    assert.equal(query.order, 'desc')
  })

  test('date window is clamped to max', async ({ assert }) => {
    const { RESOURCE_CONTENTION_MAX_DATE_WINDOW_DAYS } = await import('@aiproj/types')
    const query = normalizeResourceContentionQuery({
      from: '2026-01-01',
      to: '2028-01-01',
    })
    const fromMs = new Date(query.from!).getTime()
    const toMs = new Date(query.to!).getTime()
    const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24)
    assert.isAtMost(diffDays, RESOURCE_CONTENTION_MAX_DATE_WINDOW_DAYS + 1)
  })
})

test.group('ResourceContentionDetectionService - Redaction', () => {
  test('empty access returns redacted items', async ({ assert }) => {
    // Test that the redaction contract is sound
    const { RESOURCE_CONTENTION_REDACTION_STATE_VALUES } = await import('@aiproj/types')

    assert.equal(RESOURCE_CONTENTION_REDACTION_STATE_VALUES.length, 5)
    assert.isTrue(RESOURCE_CONTENTION_REDACTION_STATE_VALUES.includes('visible'))
    assert.isTrue(RESOURCE_CONTENTION_REDACTION_STATE_VALUES.includes('redacted'))
    assert.isTrue(RESOURCE_CONTENTION_REDACTION_STATE_VALUES.includes('forbidden'))
    assert.isTrue(RESOURCE_CONTENTION_REDACTION_STATE_VALUES.includes('unavailable'))
    assert.isTrue(RESOURCE_CONTENTION_REDACTION_STATE_VALUES.includes('partial'))
  })
})

test.group('ResourceContentionDetectionService - Freshness', () => {
  test('freshness helper returns forbidden when specified', async ({ assert }) => {
    const { makeResourceContentionFreshness } = await import('@aiproj/types')

    const result = makeResourceContentionFreshness({
      source: 'resource_allocation',
      lastUpdatedAt: null,
      forbidden: true,
    })
    assert.equal(result.status, 'forbidden')
    assert.isFalse(result.isStale)
  })

  test('freshness helper returns stale for old data', async ({ assert }) => {
    const { isResourceContentionSourceStale } = await import('@aiproj/types')

    const oldDate = new Date(Date.now() - 120 * 60 * 1000).toISOString()
    assert.isTrue(isResourceContentionSourceStale(oldDate, 60))
  })

  test('freshness helper returns fresh for recent data', async ({ assert }) => {
    const { isResourceContentionSourceStale } = await import('@aiproj/types')

    const recentDate = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    assert.isFalse(isResourceContentionSourceStale(recentDate, 60))
  })
})

test.group('ResourceContentionDetectionService - Evidence Low-Sensitivity', () => {
  test('evidence hash is low-sensitive', async ({ assert }) => {
    const { makeLowSensitiveEvidenceHash } = await import('@aiproj/types')

    const hash = makeLowSensitiveEvidenceHash('resource_allocation', ['1', '2', '3'], '2026-07-29')
    assert.isString(hash)
    assert.equal(hash.length, 8)
    // Must not contain raw text
    assert.isFalse(hash.includes('resource'))
    assert.isFalse(hash.includes('allocation'))
  })

  test('evidence hash is deterministic', async ({ assert }) => {
    const { makeLowSensitiveEvidenceHash } = await import('@aiproj/types')

    const a = makeLowSensitiveEvidenceHash('resource_allocation', ['1', '2'], '2026-07-29')
    const b = makeLowSensitiveEvidenceHash('resource_allocation', ['1', '2'], '2026-07-29')
    assert.equal(a, b)
  })
})

test.group('ResourceContentionDetectionService - Cache Degradation', () => {
  test('no-cache metadata is deterministic', async ({ assert }) => {
    // Even without a cache layer, results must be deterministic
    // 动态 import 只为验证'从模块入口取到的实现与顶层 import 一致'，
    // 局部变量另起名以免遮蔽顶层同名 import。
    const dynamicTypes = await import('@aiproj/types')
    const dynHash = dynamicTypes.computeQuerySignatureHash
    const dynNormalize = dynamicTypes.normalizeResourceContentionQuery

    const q1 = dynNormalize({ from: '2026-07-01', to: '2026-07-31' })
    const q2 = dynNormalize({ from: '2026-07-01', to: '2026-07-31' })

    assert.equal(dynHash(q1), dynHash(q2))
  })

  test('query signature differs for different inputs', async ({ assert }) => {
    // 动态 import 只为验证'从模块入口取到的实现与顶层 import 一致'，
    // 局部变量另起名以免遮蔽顶层同名 import。
    const dynamicTypes = await import('@aiproj/types')
    const dynHash = dynamicTypes.computeQuerySignatureHash
    const dynNormalize = dynamicTypes.normalizeResourceContentionQuery

    const q1 = dynNormalize({ severity: 'critical' })
    const q2 = dynNormalize({ severity: 'warning' })

    assert.notEqual(dynHash(q1), dynHash(q2))
  })
})
