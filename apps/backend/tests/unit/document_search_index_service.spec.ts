/**
 * DocumentSearchIndexService 测试（v3-document-full-text-search §5.8）
 *
 * 纯逻辑测试，不依赖数据库。
 */
import { test } from '@japa/runner'
import {
  boundSearchableText,
  computeDocumentSearchContentHash,
  buildDocumentSearchableProjection,
  extractSnippet,
  normalizeSearchKeyword,
  computeKeywordHash,
} from '@aiproj/types'

test.group('DocumentSearchIndexService - 纯函数', () => {
  test('buildDocumentSearchableProjection 目录文档不截断', ({ assert }) => {
    const doc = { name: '项目章程', content: '这是项目章程的正文。' }
    const proj = buildDocumentSearchableProjection(doc)
    assert.strictEqual(proj.title, '项目章程')
    assert.isTrue(proj.searchableText.includes('项目章程'))
    assert.strictEqual(proj.truncated, false)
    assert.isString(proj.contentHash)
  })

  test('buildDocumentSearchableProjection null content 处理', ({ assert }) => {
    const doc = { name: '空文档', content: null }
    const proj = buildDocumentSearchableProjection(doc)
    assert.strictEqual(proj.title, '空文档')
    assert.strictEqual(proj.searchableText, '')
    assert.strictEqual(proj.truncated, false)
  })

  test('buildDocumentSearchableProjection Markdown 去标记', ({ assert }) => {
    const doc = { name: 'M1', content: '# 标题\n**粗体**' }
    const proj = buildDocumentSearchableProjection(doc)
    assert.isTrue(proj.searchableText.includes('标题'))
    assert.isTrue(proj.searchableText.includes('粗体'))
    assert.isFalse(proj.searchableText.includes('#'))
  })

  test('content_hash 幂等：相同输入相同hash', ({ assert }) => {
    const h1 = computeDocumentSearchContentHash('文档', '正文')
    const h2 = computeDocumentSearchContentHash('文档', '正文')
    assert.strictEqual(h1, h2)
  })

  test('content_hash 区分：不同输入不同hash', ({ assert }) => {
    const h1 = computeDocumentSearchContentHash('文档A', '正文')
    const h2 = computeDocumentSearchContentHash('文档B', '正文')
    assert.notStrictEqual(h1, h2)
  })

  test('boundSearchableText 短文本不截断', ({ assert }) => {
    const short = '短文本'
    const { text, truncated } = boundSearchableText(short, 100)
    assert.strictEqual(text, short)
    assert.strictEqual(truncated, false)
  })

  test('boundSearchableText 超长截断', ({ assert }) => {
    const long = 'A'.repeat(200)
    const { text, truncated } = boundSearchableText(long, 100)
    assert.isTrue(truncated)
    assert.isTrue(text.length > 100) // 含截断标记
    assert.isTrue(text.includes('truncated'))
  })

  test('extractSnippet 命中返回片段', ({ assert }) => {
    const body = '前文前文前文关键词后文后文后文'
    const snippet = extractSnippet(body, '关键词', 10)
    assert.isNotNull(snippet)
    if (snippet) {
      assert.isTrue(snippet.includes('关键词'))
    }
  })

  test('extractSnippet 无命中返回 null', ({ assert }) => {
    const snippet = extractSnippet('无匹配文本正文', '不存在的关键词')
    assert.isNull(snippet)
  })

  test('normalizeSearchKeyword 规范化', ({ assert }) => {
    assert.strictEqual(normalizeSearchKeyword('  HELLO   World  '), 'hello world')
    assert.strictEqual(normalizeSearchKeyword('搜索关键词'), '搜索关键词')
  })

  test('computeKeywordHash 确定性', ({ assert }) => {
    assert.strictEqual(computeKeywordHash('test'), computeKeywordHash('test'))
    assert.notStrictEqual(computeKeywordHash('a'), computeKeywordHash('b'))
  })
})
