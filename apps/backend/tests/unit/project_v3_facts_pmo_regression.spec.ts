import { test } from '@japa/runner'
import Project from '#models/project'
import { makeProjectFactDto } from '@aiproj/types'
import { createUser, createOrganization, useAuthDatabase } from '../functional/auth/_helpers.js'

/**
 * v3-database-schema-expansion §5.3 —— PMO 财务/ROI 消费方回归测试。
 *
 * 证明：即使 projects 新增了 forecast_cost_cents / investment_type 等 V3 事实列，
 * 当这些字段为 null 或未授权时，PMO 消费方仍能区分「缺失事实」与「零值」，
 * 不会因新列而伪造财务数值（spec「PMO consumers still return unsupported or
 * unavailable warnings when the new explicit fields are null or unauthorized」）。
 *
 * 本 change 不改写 PMO 消费方代码——回归锚点 = 契约层 makeProjectFactDto 默认 null
 * + Project 模型 V3 字段缺省 null（非 0）。
 */
test.group('v3-database-schema-expansion: PMO 财务回归（V3 字段 null 不伪造）', (group) => {
  useAuthDatabase(group)

  test('makeProjectFactDto 默认 forecastCostCents=null（不转 0）', ({ assert }) => {
    const dto = makeProjectFactDto()
    assert.isNull(dto.forecastCostCents, 'forecast 缺失必须为 null，不得伪造为 0')
    assert.isNull(dto.forecastEndDate)
    assert.isNull(dto.investmentType)
    assert.isNull(dto.portfolioFactSource)
  })

  test('makeProjectFactDto 显式 0 与 null 可区分', ({ assert }) => {
    const zero = makeProjectFactDto({ forecastCostCents: 0 })
    assert.equal(zero.forecastCostCents, 0, '显式 0 保留')
    const missing = makeProjectFactDto({ forecastCostCents: null })
    assert.isNull(missing.forecastCostCents, 'null 保留为 null')
  })

  test('新建 Project 的 V3 事实字段全部缺省 null（非 0 / 非空字符串）', async ({ assert }) => {
    const owner = await createUser({ email: `pmo-reg-${Date.now()}@example.test` })
    const org = await createOrganization(owner)
    const project = await Project.create({
      organizationId: org.id,
      name: 'pmo-regression-project',
      code: `PMO${Date.now()}`,
      createdBy: owner.id,
      currency: 'CNY',
      status: 'draft',
      priority: 'medium',
      progressPercent: 0,
      healthStatus: 'unknown',
    })

    // 断言的是「库里存的是 null」，必须重查：Lucid 的 create() 只把传入字段放进实例，
    // 未传入的列在实例上是 undefined，直接断言等于把「没传」误判成「存了非 null」。
    const stored = await Project.findOrFail(project.id)

    assert.isNull(stored.projectManagerId, 'project_manager_id 缺省 null')
    assert.isNull(stored.forecastCostCents, 'forecast_cost_cents 缺省 null（PMO 须报 unavailable）')
    assert.isNull(stored.investmentType)
    assert.isNull(stored.departmentKey)
    assert.isNull(stored.customFields)
    assert.isNull(stored.portfolioFactSource)
    // project_manager_id 虽由 service.create 默认为创建者，但 model 直接 create 时不设即 null
    // —— PMO 消费方据此区分「无经理事实」与「经理=0」。
  })
})
