/**
 * v3-ai-quality-cost-console-deferred-p1 §1.6 —— SLO 阈值持久化功能测试。
 *
 * 真实 SQLite 路径验证（spec: ai-slo-and-alerting / 持久化需求四场景）：
 * - 持久化阈值被使用；
 * - 阈值不跨组织；
 * - 空阈值表仍可按声明式默认求值；
 * - 缺失指标由默认补齐。
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { sloThresholdService } from '#services/ai_slo/slo_threshold_service'
import { createOrganization, createUser, uniqueEmail } from './auth/_helpers.js'

test.group('SLO 阈值持久化（§1.6）', () => {
  async function makeOrganization(prefix: string): Promise<number> {
    const user = await createUser({ email: uniqueEmail(prefix) })
    const org = await createOrganization(user)
    return Number(org.id)
  }

  test('持久化阈值被使用，缺失指标由声明式默认补齐', async ({ assert }) => {
    const organizationId = await makeOrganization('slo-persist')
    const now = new Date().toISOString()

    await db.table('ai_slo_thresholds').insert({
      organization_id: organizationId,
      indicator: 'failure_rate',
      warning_operator: 'gt',
      warning_value: 0.02,
      warning_unit: 'ratio',
      critical_operator: 'gt',
      critical_value: 0.1,
      critical_unit: 'ratio',
      window_ms: 3_600_000,
      runbook_ref: 'runbook://org/failure-rate',
      threshold_source: 'operator_set',
      created_at: now,
      updated_at: now,
    })

    const defs = await sloThresholdService.getDefinitions(organizationId)

    assert.lengthOf(defs, 5)
    const failureRate = defs.find((d) => d.indicator === 'failure_rate')
    assert.isDefined(failureRate)
    assert.equal(failureRate!.warning.value, 0.02)
    assert.equal(failureRate!.critical.value, 0.1)
    assert.equal(failureRate!.runbookRef, 'runbook://org/failure-rate')
    assert.equal(failureRate!.warning.source, 'operator_set')

    const ttft = defs.find((d) => d.indicator === 'ttft')
    assert.isDefined(ttft)
    assert.equal(ttft!.warning.source, 'declared_default')
  })

  test('阈值不跨组织：两组织各自读各自的持久化行', async ({ assert }) => {
    const orgA = await makeOrganization('slo-iso-a')
    const orgB = await makeOrganization('slo-iso-b')
    const now = new Date().toISOString()

    await db.table('ai_slo_thresholds').insert([
      {
        organization_id: orgA,
        indicator: 'ttft',
        warning_operator: 'gt',
        warning_value: 1111,
        warning_unit: 'ms',
        critical_operator: 'gt',
        critical_value: 2222,
        critical_unit: 'ms',
        window_ms: 86_400_000,
        runbook_ref: 'runbook://org-a/ttft',
        threshold_source: 'operator_set',
        created_at: now,
        updated_at: now,
      },
      {
        organization_id: orgB,
        indicator: 'ttft',
        warning_operator: 'gt',
        warning_value: 3333,
        warning_unit: 'ms',
        critical_operator: 'gt',
        critical_value: 4444,
        critical_unit: 'ms',
        window_ms: 86_400_000,
        runbook_ref: 'runbook://org-b/ttft',
        threshold_source: 'operator_set',
        created_at: now,
        updated_at: now,
      },
    ])

    const defsA = await sloThresholdService.getDefinitions(orgA)
    const defsB = await sloThresholdService.getDefinitions(orgB)

    assert.equal(defsA.find((d) => d.indicator === 'ttft')!.warning.value, 1111)
    assert.equal(defsB.find((d) => d.indicator === 'ttft')!.warning.value, 3333)
    assert.equal(defsA.find((d) => d.indicator === 'ttft')!.organizationId, orgA)
    assert.equal(defsB.find((d) => d.indicator === 'ttft')!.organizationId, orgB)
  })

  test('空阈值表 → 五指标全部声明式默认兜底，不产生错误', async ({ assert }) => {
    const organizationId = await makeOrganization('slo-empty')

    const defs = await sloThresholdService.getDefinitions(organizationId)

    assert.lengthOf(defs, 5)
    for (const def of defs) {
      assert.equal(def.warning.source, 'declared_default')
      assert.isTrue(def.runbookRef.length > 0)
    }
  })
})
