import { test } from '@japa/runner'
import {
  MAX_TASK_DEPTH,
  STATUS_TRANSITIONS,
  TASK_STATUSES,
  assertTransition,
  isTransitionAllowed,
  normalizePriority,
  normalizeStatus,
  normalizeTaskType,
} from '#services/task_status_machine'
import { ValidationException } from '#exceptions/api_exception'

test.group('任务状态机纯函数', () => {
  test('定义 6 个合法状态', ({ assert }) => {
    assert.deepEqual(TASK_STATUSES, [
      'not_started',
      'in_progress',
      'completed',
      'blocked',
      'on_hold',
      'cancelled',
    ])
  })

  test('not_started → in_progress / cancelled 合法', ({ assert }) => {
    assert.isTrue(isTransitionAllowed('not_started', 'in_progress'))
    assert.isTrue(isTransitionAllowed('not_started', 'cancelled'))
    assert.isFalse(isTransitionAllowed('not_started', 'completed'))
    assert.isFalse(isTransitionAllowed('not_started', 'blocked'))
    assert.isFalse(isTransitionAllowed('not_started', 'on_hold'))
  })

  test('in_progress → completed / blocked / on_hold / not_started 合法', ({ assert }) => {
    assert.isTrue(isTransitionAllowed('in_progress', 'completed'))
    assert.isTrue(isTransitionAllowed('in_progress', 'blocked'))
    assert.isTrue(isTransitionAllowed('in_progress', 'on_hold'))
    assert.isTrue(isTransitionAllowed('in_progress', 'not_started'))
    assert.isFalse(isTransitionAllowed('in_progress', 'cancelled'))
  })

  test('blocked / on_hold → in_progress / cancelled 合法', ({ assert }) => {
    assert.isTrue(isTransitionAllowed('blocked', 'in_progress'))
    assert.isTrue(isTransitionAllowed('blocked', 'cancelled'))
    assert.isFalse(isTransitionAllowed('blocked', 'completed'))

    assert.isTrue(isTransitionAllowed('on_hold', 'in_progress'))
    assert.isTrue(isTransitionAllowed('on_hold', 'cancelled'))
    assert.isFalse(isTransitionAllowed('on_hold', 'completed'))
  })

  test('completed → in_progress（重开）合法；cancelled → not_started 合法', ({ assert }) => {
    assert.isTrue(isTransitionAllowed('completed', 'in_progress'))
    assert.isFalse(isTransitionAllowed('completed', 'blocked'))
    assert.isFalse(isTransitionAllowed('completed', 'cancelled'))

    assert.isTrue(isTransitionAllowed('cancelled', 'not_started'))
    assert.isFalse(isTransitionAllowed('cancelled', 'in_progress'))
  })

  test('同状态转换幂等（视为合法无操作）', ({ assert }) => {
    for (const s of TASK_STATUSES) {
      assert.isTrue(isTransitionAllowed(s, s), `${s}→${s} 应幂等放行`)
    }
  })

  test('STATUS_TRANSITIONS 覆盖全部 6 状态', ({ assert }) => {
    for (const s of TASK_STATUSES) {
      assert.isArray(STATUS_TRANSITIONS[s], `${s} 应有转换表`)
    }
  })

  test('assertTransition 非法转换抛 422', ({ assert }) => {
    assert.throws(() => assertTransition('not_started', 'completed'), ValidationException)
  })

  test('assertTransition 合法转换不抛错', ({ assert }) => {
    assert.doesNotThrow(() => assertTransition('in_progress', 'completed'))
  })

  test('assertTransition 同状态不抛错（幂等）', ({ assert }) => {
    assert.doesNotThrow(() => assertTransition('in_progress', 'in_progress'))
  })

  test('MAX_TASK_DEPTH 为 3', ({ assert }) => {
    assert.equal(MAX_TASK_DEPTH, 3)
  })

  test('normalizeStatus 接受合法值、拒绝非法值', ({ assert }) => {
    assert.equal(normalizeStatus('in_progress'), 'in_progress')
    assert.equal(normalizeStatus('not_started'), 'not_started')
    assert.isNull(normalizeStatus('frozen'))
    assert.isNull(normalizeStatus(undefined))
    assert.isNull(normalizeStatus(123))
  })

  test('normalizePriority 接受 5 档优先级', ({ assert }) => {
    assert.equal(normalizePriority('highest'), 'highest')
    assert.equal(normalizePriority('lowest'), 'lowest')
    assert.isNull(normalizePriority('urgent'))
    assert.isNull(normalizePriority(null))
  })

  test('normalizeTaskType 接受 4 类', ({ assert }) => {
    assert.equal(normalizeTaskType('task'), 'task')
    assert.equal(normalizeTaskType('milestone'), 'milestone')
    assert.equal(normalizeTaskType('deliverable'), 'deliverable')
    assert.isNull(normalizeTaskType('epic'))
  })
})
