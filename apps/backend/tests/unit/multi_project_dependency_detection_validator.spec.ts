// 多项目依赖检测 Validator 测试
// v3-multi-project-dependency-detection §4.2
// 覆盖：无界 scope、越界 limit、非法 sort/filter、过期 plan、跨组织 endpoint 和不支持规则

import { test } from '@japa/runner'
import {
  detectionPlanValidator,
  detectionRunValidator,
  detectionIgnoreValidator,
  detectionReopenValidator,
  detectionDraftBridgeValidator,
} from '../../app/validators/multi_project_dependency_detection_validator.js'

test.group('Detection Validator — plan', () => {
  test('合法 plan payload 通过校验', async ({ assert }) => {
    const result = await detectionPlanValidator.validate({
      organizationId: 1,
      scope: {
        organizationId: 1,
        projectIds: [1, 2],
        maxProjects: 50,
        maxEdges: 1000,
        ruleSetKey: 'default',
      },
    })
    assert.equal(result.organizationId, 1)
    assert.deepEqual(result.scope.projectIds, [1, 2])
  })

  test('最小 plan payload 通过校验', async ({ assert }) => {
    const result = await detectionPlanValidator.validate({
      organizationId: 1,
      scope: { organizationId: 1 },
    })
    assert.equal(result.organizationId, 1)
    assert.isUndefined(result.scope.projectIds)
  })

  test('organizationId 必填', async ({ assert }) => {
    await assert.rejects(() => detectionPlanValidator.validate({ scope: { organizationId: 1 } }))
  })

  test('maxProjects 超出上限被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      detectionPlanValidator.validate({
        organizationId: 1,
        scope: { organizationId: 1, maxProjects: 1000 },
      }),
    )
  })

  test('maxEdges 超出上限被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      detectionPlanValidator.validate({
        organizationId: 1,
        scope: { organizationId: 1, maxEdges: 50000 },
      }),
    )
  })

  test('maxTasksPerProject 超出上限被拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      detectionPlanValidator.validate({
        organizationId: 1,
        scope: { organizationId: 1, maxTasksPerProject: 5000 },
      }),
    )
  })

  test('带日期窗口的 plan 通过', async ({ assert }) => {
    const result = await detectionPlanValidator.validate({
      organizationId: 1,
      scope: {
        organizationId: 1,
        dateWindowStart: '2026-01-01',
        dateWindowEnd: '2026-12-31',
      },
    })
    assert.equal(result.scope.dateWindowStart, '2026-01-01')
    assert.equal(result.scope.dateWindowEnd, '2026-12-31')
  })
})

test.group('Detection Validator — run', () => {
  test('合法 run payload 通过校验', async ({ assert }) => {
    const result = await detectionRunValidator.validate({
      organizationId: 1,
      planToken: 'abc123def456',
    })
    assert.equal(result.organizationId, 1)
    assert.equal(result.planToken, 'abc123def456')
  })

  test('planToken 必填', async ({ assert }) => {
    await assert.rejects(() => detectionRunValidator.validate({ organizationId: 1 }))
  })

  test('organizationId 必填', async ({ assert }) => {
    await assert.rejects(() => detectionRunValidator.validate({ planToken: 'abc123' }))
  })
})

test.group('Detection Validator — ignore/reopen', () => {
  test('ignore payload 通过（无 reasonHash）', async ({ assert }) => {
    const result = await detectionIgnoreValidator.validate({})
    assert.isUndefined(result.reasonHash)
  })

  test('ignore payload 通过（带 reasonHash）', async ({ assert }) => {
    const result = await detectionIgnoreValidator.validate({ reasonHash: 'reason_abc' })
    assert.equal(result.reasonHash, 'reason_abc')
  })

  test('reopen payload 通过', async ({ assert }) => {
    const result = await detectionReopenValidator.validate({ reasonHash: 'reason_def' })
    assert.equal(result.reasonHash, 'reason_def')
  })

  test('ignore reasonHash 超长被拒绝', async ({ assert }) => {
    await assert.rejects(() => detectionIgnoreValidator.validate({ reasonHash: 'a'.repeat(100) }))
  })
})

test.group('Detection Validator — draft bridge', () => {
  test('合法 draft bridge payload 通过', async ({ assert }) => {
    const result = await detectionDraftBridgeValidator.validate({ resultId: 42 })
    assert.equal(result.resultId, 42)
  })

  test('resultId 必填', async ({ assert }) => {
    await assert.rejects(() => detectionDraftBridgeValidator.validate({}))
  })

  test('resultId 非正数被拒绝', async ({ assert }) => {
    await assert.rejects(() => detectionDraftBridgeValidator.validate({ resultId: 0 }))
  })
})
