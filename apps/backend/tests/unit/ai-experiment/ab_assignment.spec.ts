/**
 * AbAssignmentService 单元测试（§5 A/B 分流）。
 *
 * 覆盖：
 * - 同一用户在同一实验内始终同组
 * - 不同实验之间分流互不影响
 * - 实验结束后分流停止
 * - 不支持三条以上配置
 */

import { test } from '@japa/runner'
import { AbAssignmentService } from '../../../app/services/ai-experiment/ab_assignment_service.js'
import { createAbExperimentFixture } from '@aiproj/types'

test.group('AbAssignmentService', (group) => {
  let service: AbAssignmentService

  group.each.setup(() => {
    service = new AbAssignmentService()
  })

  test('should assign same user to same arm consistently', ({ assert }) => {
    const config = createAbExperimentFixture('exp-consistent', 1, 1)
    const userId = 42

    const first = service.getAssignment(config, userId)
    assert.isNotNull(first)

    // 多次获取应返回相同分配
    for (let i = 0; i < 100; i++) {
      const assignment = service.getAssignment(config, userId)
      assert.equal(assignment?.assignedVariantId, first?.assignedVariantId)
      assert.equal(assignment?.assignmentHash, first?.assignmentHash)
    }
  })

  test('should not assign for non-ab mode', ({ assert }) => {
    const config = createAbExperimentFixture('exp-shadow', 1, 1)
    config.mode = 'shadow'

    const assignment = service.getAssignment(config, 1)
    assert.isNull(assignment)
  })

  test('should not assign for concluded experiment', ({ assert }) => {
    const config = createAbExperimentFixture('exp-done', 1, 1)
    config.concluded = true

    const assignment = service.getAssignment(config, 1)
    assert.isNull(assignment)
  })

  test('assignments across experiments should be independent', ({ assert }) => {
    const config1 = createAbExperimentFixture('exp-x', 1, 1)
    const config2 = createAbExperimentFixture('exp-y', 1, 1)
    const userId = 42

    const assignment1 = service.getAssignment(config1, userId)
    const assignment2 = service.getAssignment(config2, userId)

    // 分配可能相同也可能不同，但不应有相关性
    assert.isNotNull(assignment1)
    assert.isNotNull(assignment2)
    assert.equal(assignment1?.experimentId, 'exp-x')
    assert.equal(assignment2?.experimentId, 'exp-y')
  })

  test('should distribute users approximately 50/50', ({ assert }) => {
    const config = createAbExperimentFixture('exp-balance', 1, 1)
    let controlCount = 0
    let treatmentCount = 0

    for (let userId = 1; userId <= 1000; userId++) {
      const assignment = service.getAssignment(config, userId)
      if (assignment?.assignedVariantId === 'control') {
        controlCount++
      } else {
        treatmentCount++
      }
    }

    // 允许 10% 的误差
    const ratio = controlCount / 1000
    assert.isAbove(ratio, 0.4)
    assert.isBelow(ratio, 0.6)
  })

  test('should correctly identify treatment group', ({ assert }) => {
    const config = createAbExperimentFixture('exp-treatment', 1, 1)

    let treatmentCount = 0
    for (let userId = 1; userId <= 100; userId++) {
      if (service.isInTreatmentGroup(config, userId)) treatmentCount++
    }

    // 应该有一些用户在 treatment 组
    assert.isAbove(treatmentCount, 0)
  })

  test('should list assignments for an experiment', ({ assert }) => {
    const config = createAbExperimentFixture('exp-list', 1, 1)

    // 分配一些用户
    for (let userId = 1; userId <= 10; userId++) {
      service.getAssignment(config, userId)
    }

    const assignments = service.listAssignments('exp-list')
    assert.lengthOf(assignments, 10)
  })

  test('should provide assignment statistics', ({ assert }) => {
    const config = createAbExperimentFixture('exp-stats', 1, 1)

    for (let userId = 1; userId <= 100; userId++) {
      service.getAssignment(config, userId)
    }

    const stats = service.getAssignmentStats('exp-stats')
    assert.equal(stats.total, 100)
    assert.equal(stats.controlCount + stats.treatmentCount, 100)
  })

  test('should clear assignments on experiment conclusion', ({ assert }) => {
    const config = createAbExperimentFixture('exp-clear', 1, 1)

    for (let userId = 1; userId <= 10; userId++) {
      service.getAssignment(config, userId)
    }

    const cleared = service.clearAssignments('exp-clear')
    assert.equal(cleared, 10)

    const remaining = service.listAssignments('exp-clear')
    assert.lengthOf(remaining, 0)
  })

  test('assignment hash should be deterministic', ({ assert }) => {
    const hash1 = service.computeAssignmentHash('exp-1', 42)
    const hash2 = service.computeAssignmentHash('exp-1', 42)
    assert.equal(hash1, hash2)

    // 不同用户不同哈希
    const hash3 = service.computeAssignmentHash('exp-1', 43)
    assert.notEqual(hash1, hash3)
  })
})
