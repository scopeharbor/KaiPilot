import { test } from '@japa/runner'
import {
  AI_INTENT_SCHEMA_VERSION,
  CLARIFICATION_FIELDS,
  CORE_CLARIFICATION_FIELDS,
  PROJECT_TYPES,
} from '@aiproj/types'
import { CARD_CATALOG, catalogFields, makeCardId } from '#services/ai_intent/catalog'

test.group('AI intent shared contract', () => {
  test('五类项目与字段目录只有一套共享真值', ({ assert }) => {
    assert.deepEqual(PROJECT_TYPES, ['software', 'event', 'research', 'product', 'general'])
    assert.deepEqual(catalogFields(), CLARIFICATION_FIELDS)
    assert.notProperty(CARD_CATALOG, 'budget')
  })

  test('cardId 由版本、字段与分类稳定生成', ({ assert }) => {
    assert.equal(
      makeCardId('projectGoal', 'critical'),
      `${AI_INTENT_SCHEMA_VERSION}:projectGoal:critical`,
    )
    assert.equal(makeCardId('projectGoal', 'critical'), makeCardId('projectGoal', 'critical'))
  })

  test('所有默认假设都有完整 AIMarker', ({ assert }) => {
    const defaults = Object.values(CARD_CATALOG).flatMap((definition) =>
      definition.defaultValue ? [definition.defaultValue] : [],
    )

    assert.isAbove(defaults.length, 0)
    for (const item of defaults) {
      assert.equal(item.marker.source, 'default')
      assert.isAtLeast(item.marker.confidence, 0)
      assert.isAtMost(item.marker.confidence, 1)
      assert.isNotEmpty(item.marker.reason)
      assert.isTrue(item.marker.needsConfirmation)
    }
  })

  test('核心必答目录固定为七项且不引入预算模块', ({ assert }) => {
    assert.deepEqual(CORE_CLARIFICATION_FIELDS, [
      'projectGoal',
      'corePain',
      'targetUser',
      'successMetrics',
      'scopeBoundary',
      'teamSize',
      'startDate',
    ])
    assert.lengthOf(CORE_CLARIFICATION_FIELDS, 7)
    assert.notInclude(CLARIFICATION_FIELDS, 'budget')
  })
})
