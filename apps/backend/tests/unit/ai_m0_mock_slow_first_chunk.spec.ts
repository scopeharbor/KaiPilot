import { test } from '@japa/runner'
import {
  MOCK_SLOW_FIRST_CHUNK_DEFAULT_MS,
  MOCK_SLOW_FIRST_CHUNK_MARKER,
  resolveSlowFirstChunkMs,
} from '#services/ai_m0/mock_adapter'

test.group('Mock 首个 chunk 延迟（E2E-031 心跳保活）', () => {
  test('默认不延迟', ({ assert }) => {
    assert.equal(resolveSlowFirstChunkMs('开发一个内部工具', undefined), 0)
    assert.equal(resolveSlowFirstChunkMs(undefined, undefined), 0)
    assert.equal(resolveSlowFirstChunkMs('开发一个内部工具', '0'), 0)
    assert.equal(resolveSlowFirstChunkMs('开发一个内部工具', 'abc'), 0)
  })

  test('描述带标记时只在首个阶段延迟默认时长', ({ assert }) => {
    const text = `${MOCK_SLOW_FIRST_CHUNK_MARKER}开发一个内部工具`
    assert.equal(
      resolveSlowFirstChunkMs(text, undefined, 'charter_scope'),
      MOCK_SLOW_FIRST_CHUNK_DEFAULT_MS,
    )
    // 后续阶段与质量闭环不再延迟，否则十几次调用累计远超等待时间
    assert.equal(resolveSlowFirstChunkMs(text, undefined, 'wbs_tasks'), 0)
    assert.equal(resolveSlowFirstChunkMs(text, undefined, 'reconcile_review'), 0)
    assert.equal(resolveSlowFirstChunkMs(text, undefined, null), 0)
  })

  test('环境变量优先于标记', ({ assert }) => {
    assert.equal(resolveSlowFirstChunkMs('开发一个内部工具', '1500'), 1500)
    assert.equal(resolveSlowFirstChunkMs(`${MOCK_SLOW_FIRST_CHUNK_MARKER}x`, '1500'), 1500)
    // 环境变量沿用原语义：每次调用都延迟
    assert.equal(resolveSlowFirstChunkMs('x', '1500', 'reconcile_review'), 1500)
  })
})
