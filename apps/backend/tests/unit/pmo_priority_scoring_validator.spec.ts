/**
 * PMO 优先级评分验证器测试（v3-pmo-priority-scoring-model §3.2）
 */
import { test } from '@japa/runner'
import {
  pmoPriorityScoringSummaryValidator,
  pmoPriorityScoringListValidator,
  pmoPriorityScoringGroupsValidator,
  pmoPriorityScoringWeightsValidator,
  pmoPriorityScoringDetailValidator,
} from '../../app/validators/pmo_priority_scoring.js'

test.group('pmoPriorityScoringSummaryValidator', () => {
  test('有效查询通过验证')
    .with([{}, { scoreVersion: 'pmo-priority-v1' }])
    .run(async ({ assert }, payload) => {
      const result = await pmoPriorityScoringSummaryValidator.validate(payload)
      assert.isDefined(result)
    })

  test('不支持的版本被拒绝', async ({ assert }) => {
    try {
      await pmoPriorityScoringSummaryValidator.validate({ scoreVersion: 'v99' })
      assert.fail('应抛出异常')
    } catch {
      assert.isTrue(true)
    }
  })
})

test.group('pmoPriorityScoringListValidator', () => {
  test('有效查询通过验证')
    .with([
      {},
      { page: 1, perPage: 20 },
      { sort: 'priority_score' },
      { priorityLevels: ['critical', 'high'] },
      { scoreVersion: 'pmo-priority-v1' },
      { groupBy: 'priority_level' },
    ])
    .run(async ({ assert }, payload) => {
      const result = await pmoPriorityScoringListValidator.validate(payload)
      assert.isDefined(result)
    })

  test('无界分页被拒绝', async ({ assert }) => {
    try {
      await pmoPriorityScoringListValidator.validate({ perPage: 200 })
      assert.fail('应抛出异常')
    } catch {
      assert.isTrue(true)
    }
  })

  test('不支持的排序键被拒绝', async ({ assert }) => {
    try {
      await pmoPriorityScoringListValidator.validate({ sort: 'invalid_sort' })
      assert.fail('应抛出异常')
    } catch {
      assert.isTrue(true)
    }
  })

  test('不支持的等级被拒绝', async ({ assert }) => {
    try {
      await pmoPriorityScoringListValidator.validate({ priorityLevels: ['urgent'] })
      assert.fail('应抛出异常')
    } catch {
      assert.isTrue(true)
    }
  })

  test('不支持的版本被拒绝', async ({ assert }) => {
    try {
      await pmoPriorityScoringListValidator.validate({ scoreVersion: 'v2' })
      assert.fail('应抛出异常')
    } catch {
      assert.isTrue(true)
    }
  })

  test('不支持的 groupBy 被拒绝', async ({ assert }) => {
    try {
      await pmoPriorityScoringListValidator.validate({ groupBy: 'invalid_group' })
      assert.fail('应抛出异常')
    } catch {
      assert.isTrue(true)
    }
  })
})

test.group('pmoPriorityScoringGroupsValidator', () => {
  test('有效查询通过验证')
    .with([
      { groupBy: 'priority_level' },
      { groupBy: 'traffic_light' },
      { groupBy: 'department' },
      { groupBy: 'manager' },
    ])
    .run(async ({ assert }, payload) => {
      const result = await pmoPriorityScoringGroupsValidator.validate(payload)
      assert.isDefined(result)
    })

  test('缺少 groupBy 被拒绝', async ({ assert }) => {
    try {
      await pmoPriorityScoringGroupsValidator.validate({})
      assert.fail('应抛出异常')
    } catch {
      assert.isTrue(true)
    }
  })
})

test.group('pmoPriorityScoringWeightsValidator', () => {
  test('有效查询通过验证', async ({ assert }) => {
    const result = await pmoPriorityScoringWeightsValidator.validate({})
    assert.isDefined(result)
  })
})

test.group('pmoPriorityScoringDetailValidator', () => {
  test('有效查询通过验证', async ({ assert }) => {
    const result = await pmoPriorityScoringDetailValidator.validate({
      scoreVersion: 'pmo-priority-v1',
      includeGroupSlices: true,
    })
    assert.isDefined(result)
  })

  test('无参数通过验证', async ({ assert }) => {
    const result = await pmoPriorityScoringDetailValidator.validate({})
    assert.isDefined(result)
  })
})
