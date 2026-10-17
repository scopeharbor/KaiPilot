import { test } from '@japa/runner'
import {
  extractRetrievalTerms,
  mergeSearchResults,
} from '#services/copilot/copilot_context_collector'

test.group('Copilot 检索关键词抽取', () => {
  test('长提问切成业务词块：整句 LIKE 永远不命中', ({ assert }) => {
    assert.deepEqual(
      extractRetrievalTerms(
        '针对本项目的灰度切流和双轨并行阶段，结合行业里银行核心系统切换的最佳实践，列出切换当天的检查清单和回滚触发条件',
      ).slice(0, 3),
      ['灰度切流', '双轨并行', '银行核心系统切换'],
    )
  })

  test('业务复合词不被单字虚词切坏；短提问原样检索', ({ assert }) => {
    const terms = extractRetrievalTerms('清算对账的里程碑和支付清算中台上线风险有哪些')
    assert.include(terms, '清算对账')
    assert.include(terms, '里程碑')
    assert.include(terms, '支付清算中台上线风险有')
    assert.deepEqual(extractRetrievalTerms('灰度切流'), ['灰度切流'])
  })

  test('多次检索结果按实体去重、保留高分、截取前 N 条', ({ assert }) => {
    const merged = mergeSearchResults(
      [
        {
          total: 2,
          items: [
            { entityType: 'task', entityId: 1, score: 0.5 },
            { entityType: 'task', entityId: 2, score: 0.8 },
          ],
        },
        { total: 1, items: [{ entityType: 'task', entityId: 1, score: 0.9 }] },
      ],
      10,
    )
    assert.equal(merged.total, 2)
    assert.deepEqual(
      merged.items.map((i) => [i.entityId, i.score]),
      [
        [1, 0.9],
        [2, 0.8],
      ],
    )
  })
})
