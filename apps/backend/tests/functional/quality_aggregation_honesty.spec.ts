/**
 * v3-ai-quality-cost-console-deferred-p1 §5.1 —— QualityAggregationService 集成诚实性。
 *
 * 真实 SQLite 持久化路径（非 mock）验证（spec: ai-quality-cost-admin-console /
 * 空窗口诚实性场景）：
 * - 空窗口：aggregateRepairEffectiveness 返回 repairRate null（不合成零值）、
 *   trendsByVersion 返回空 Map（不合成健康态）；
 * - 非空窗口：修复率与修后失败计数正确；
 * - 组织隔离：他组织记录不进入聚合。
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import QualityValidationResult from '#models/quality_validation_result'
import { qualityAggregationService } from '#services/quality_ledger/quality_aggregation_service'
import { createOrganization, createUser, uniqueEmail } from './auth/_helpers.js'

test.group('QualityAggregationService 空窗口诚实性（§5.1）', () => {
  async function makeOrganization(prefix: string): Promise<number> {
    const user = await createUser({ email: uniqueEmail(prefix) })
    const org = await createOrganization(user)
    return Number(org.id)
  }

  const past = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const future = new Date(Date.now() + 86_400_000).toISOString()

  async function seedRecord(organizationId: number, idempotencyKey: string) {
    await QualityValidationResult.create({
      organizationId,
      artifactRef: `artifact-${idempotencyKey}`,
      capabilitySurface: 'planning',
      validatorCategory: 'rule',
      validatorVersion: 'v1',
      checkResults: [
        {
          checkId: 'c1',
          hit: true,
          severity: 'medium',
          locationRef: null,
          contentHash: null,
          message: 'hit',
        },
      ],
      hitCheckIds: ['c1'],
      confidenceScore: 80,
      overallRiskLevel: 'medium',
      canConfirm: true,
      autoFixTrace: { attemptedCount: 4, successCount: 3, stillFailingAfterFix: true },
      sanitizedReport: [],
      idempotencyKey,
    })
  }

  test('空窗口：repairRate 为 null 且趋势为空 Map（显式缺席）', async ({ assert }) => {
    const organizationId = await makeOrganization('qa-empty')

    const repair = await qualityAggregationService.aggregateRepairEffectiveness(
      organizationId,
      past,
      future,
    )
    assert.equal(repair.totalAttempts, 0)
    assert.equal(repair.totalSuccesses, 0)
    assert.isNull(repair.repairRate, '空窗口修复率必须为 null 而非 0')
    assert.equal(repair.stillFailingCount, 0)

    const trends = await qualityAggregationService.trendsByVersion(organizationId, past, future)
    assert.equal(trends.size, 0, '空窗口趋势必须为空 Map')

    const health = await qualityAggregationService.evaluateHealth(organizationId)
    assert.equal(health.overallState, 'unknown', '空窗口健康态必须为 unknown 而非 healthy')
    for (const ind of health.indicators) {
      assert.equal(ind.state, 'unknown')
      assert.equal(ind.reasonCode, 'no_data')
    }
  })

  test('非空窗口：修复率与修后失败计数正确', async ({ assert }) => {
    const organizationId = await makeOrganization('qa-data')
    await seedRecord(organizationId, 'qa-r1')
    await seedRecord(organizationId, 'qa-r2')

    const repair = await qualityAggregationService.aggregateRepairEffectiveness(
      organizationId,
      past,
      future,
    )
    assert.equal(repair.totalAttempts, 8)
    assert.equal(repair.totalSuccesses, 6)
    assert.equal(repair.repairRate, 0.75)
    assert.equal(repair.stillFailingCount, 2)

    const trends = await qualityAggregationService.trendsByVersion(organizationId, past, future)
    assert.isTrue(trends.has('v1'), '趋势应含 v1 版本桶')
    assert.ok((trends.get('v1') ?? []).length > 0)
  })

  test('组织隔离：他组织记录不进入聚合', async ({ assert }) => {
    const orgA = await makeOrganization('qa-iso-a')
    const orgB = await makeOrganization('qa-iso-b')
    await seedRecord(orgB, 'qa-other')

    const repairA = await qualityAggregationService.aggregateRepairEffectiveness(orgA, past, future)
    assert.equal(repairA.totalAttempts, 0)
    assert.isNull(repairA.repairRate)

    const repairB = await qualityAggregationService.aggregateRepairEffectiveness(orgB, past, future)
    assert.equal(repairB.totalAttempts, 4)
  })
})
