import { test } from '@japa/runner'
import {
  forecastSummaryValidator,
  forecastDemandCurvesValidator,
  forecastGapAnalysisValidator,
  forecastProjectDriversValidator,
  forecastSkillDriversValidator,
  forecastTrendBaselineValidator,
  forecastDrillDownValidator,
  forecastAiAdvisoryValidator,
  normalizeForecastQuery,
  parseCommaSeparatedParam,
} from '#validators/resource_demand_forecasting'

test.group('ResourceDemandForecastingValidator', () => {
  // ─── 1. Valid query passes ─────────────────────────────────────────────

  test('valid query passes validation', async ({ assert }) => {
    const result = await forecastSummaryValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
    })
    assert.equal(result.startDate, '2026-07-01')
    assert.equal(result.endDate, '2026-09-01')
    assert.equal(result.granularity, 'week')
  })

  test('all granularity values pass', async ({ assert }) => {
    const r1 = await forecastSummaryValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'day',
    })
    const r2 = await forecastSummaryValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
    })
    const r3 = await forecastSummaryValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'month',
    })
    assert.equal(r1.granularity, 'day')
    assert.equal(r2.granularity, 'week')
    assert.equal(r3.granularity, 'month')
  })

  // ─── 2. Missing startDate fails ────────────────────────────────────────

  test('missing startDate fails', async ({ assert }) => {
    try {
      await forecastSummaryValidator.validate({
        endDate: '2026-09-01',
        granularity: 'week',
      })
      assert.fail('Should have thrown')
    } catch (err: any) {
      assert.isDefined(err)
    }
  })

  test('missing endDate fails', async ({ assert }) => {
    try {
      await forecastSummaryValidator.validate({
        startDate: '2026-07-01',
        granularity: 'week',
      })
      assert.fail('Should have thrown')
    } catch (err: any) {
      assert.isDefined(err)
    }
  })

  // ─── 3. Invalid granularity fails ──────────────────────────────────────

  test('invalid granularity fails', async ({ assert }) => {
    try {
      await forecastSummaryValidator.validate({
        startDate: '2026-07-01',
        endDate: '2026-09-01',
        granularity: 'hour',
      })
      assert.fail('Should have thrown')
    } catch (err: any) {
      assert.isDefined(err)
    }
  })

  // ─── 4. Invalid method fails ───────────────────────────────────────────

  test('invalid method fails', async ({ assert }) => {
    try {
      await forecastSummaryValidator.validate({
        startDate: '2026-07-01',
        endDate: '2026-09-01',
        granularity: 'week',
        method: 'neural_network',
      })
      assert.fail('Should have thrown')
    } catch (err: any) {
      assert.isDefined(err)
    }
  })

  test('valid method passes', async ({ assert }) => {
    const result = await forecastSummaryValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
      method: 'deterministic_bucket',
    })
    assert.equal(result.method, 'deterministic_bucket')
  })

  // ─── 5. normalizeForecastQuery applies defaults ────────────────────────

  test('normalizeForecastQuery applies defaults', async ({ assert }) => {
    const validated = await forecastSummaryValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
    })
    const query = normalizeForecastQuery(validated)
    assert.equal(query.method, 'deterministic_bucket')
    assert.equal(query.page, 1)
    assert.equal(query.perPage, 50)
    assert.equal(query.sort, 'gap')
    assert.equal(query.sortDir, 'desc')
  })

  test('normalizeForecastQuery preserves provided values', async ({ assert }) => {
    const validated = await forecastSummaryValidator.validate({
      startDate: '2026-08-01',
      endDate: '2026-10-01',
      granularity: 'month',
      method: 'trend_projection',
      page: '3',
      perPage: '25',
      sort: 'demand',
      sortDir: 'asc',
    })
    const query = normalizeForecastQuery(validated as any)
    assert.equal(query.method, 'trend_projection')
    assert.equal(query.page, 3)
    assert.equal(query.perPage, 25)
    assert.equal(query.sort, 'demand')
    assert.equal(query.sortDir, 'asc')
  })

  // ─── 6. parseCommaSeparatedParam ───────────────────────────────────────

  test('parseCommaSeparatedParam splits correctly', async ({ assert }) => {
    const result = parseCommaSeparatedParam('react,typescript,python')
    assert.deepEqual(result, ['react', 'typescript', 'python'])
  })

  test('parseCommaSeparatedParam returns undefined for empty', async ({ assert }) => {
    assert.isUndefined(parseCommaSeparatedParam(''))
    assert.isUndefined(parseCommaSeparatedParam('  '))
    assert.isUndefined(parseCommaSeparatedParam(undefined))
  })

  // ─── 7. All 7 endpoint validators accept valid input ───────────────────

  test('demand curves validator accepts valid input', async ({ assert }) => {
    const result = await forecastDemandCurvesValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
    })
    assert.equal(result.startDate, '2026-07-01')
  })

  test('gap analysis validator accepts valid input', async ({ assert }) => {
    const result = await forecastGapAnalysisValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
    })
    assert.equal(result.startDate, '2026-07-01')
  })

  test('project drivers validator accepts valid input', async ({ assert }) => {
    const result = await forecastProjectDriversValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
    })
    assert.equal(result.startDate, '2026-07-01')
  })

  test('skill drivers validator accepts valid input', async ({ assert }) => {
    const result = await forecastSkillDriversValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
    })
    assert.equal(result.startDate, '2026-07-01')
  })

  test('trend baseline validator accepts valid input', async ({ assert }) => {
    const result = await forecastTrendBaselineValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
    })
    assert.equal(result.startDate, '2026-07-01')
  })

  test('drill-down validator validates extra fields', async ({ assert }) => {
    const result = await forecastDrillDownValidator.validate({
      targetType: 'project',
      targetId: '42',
      role: 'developer',
      projectId: '10',
    })
    assert.equal(result.targetType, 'project')
    assert.equal(result.targetId, '42')
    assert.equal(result.role, 'developer')
  })

  test('AI advisory validator accepts valid input', async ({ assert }) => {
    const result = await forecastAiAdvisoryValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
    })
    assert.equal(result.startDate, '2026-07-01')
  })

  // ─── 8. Optional params ────────────────────────────────────────────────

  test('optional params are passed through', async ({ assert }) => {
    const validated = await forecastSummaryValidator.validate({
      startDate: '2026-07-01',
      endDate: '2026-09-01',
      granularity: 'week',
      projectIds: '1,2,3',
      roles: 'developer,designer',
      skills: 'react,typescript',
      topN: '10',
      page: '2',
      perPage: '20',
      confidenceThreshold: 'high',
      sort: 'gap',
      sortDir: 'desc',
    })
    const query = normalizeForecastQuery(validated as any)
    assert.deepEqual(query.projectIds, ['1', '2', '3'])
    assert.deepEqual(query.roles, ['developer', 'designer'])
    assert.deepEqual(query.skills, ['react', 'typescript'])
    assert.equal(query.topN, 10)
    assert.equal(query.page, 2)
    assert.equal(query.perPage, 20)
    assert.equal(query.confidenceThreshold, 'high')
  })
})
