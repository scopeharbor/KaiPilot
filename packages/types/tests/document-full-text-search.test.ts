/**
 * v3-document-full-text-search — 共享契约纯函数测试
 *
 * 覆盖：stripMarkdownToPlainText / boundSearchableText /
 * computeDocumentContentHash / buildDocumentSearchableProjection /
 * extractSnippet / normalizeSearchKeyword / computeKeywordHash
 */

import { describe, it, expect } from 'vitest'
import {
  stripMarkdownToPlainText,
  boundSearchableText,
  computeDocumentContentHash,
  buildDocumentSearchableProjection,
  extractSnippet,
  normalizeSearchKeyword,
  computeKeywordHash,
  DOCUMENT_SEARCH_CONTENT_BOUND,
} from '../src/document-full-text-search.js'
import {
  fixtureShortDocument,
  fixtureLongTruncatedDocument,
  fixtureMarkdownRichDocument,
} from '../src/document-full-text-search-fixtures.js'

// ---------------------------------------------------------------------------
// stripMarkdownToPlainText
// ---------------------------------------------------------------------------

describe('stripMarkdownToPlainText', () => {
  it('空字符串返回空', () => {
    expect(stripMarkdownToPlainText('')).toBe('')
  })

  it('纯文本不变', () => {
    const text = '这是一段纯文本。没有任何 Markdown 标记。'
    expect(stripMarkdownToPlainText(text)).toBe(text)
  })

  it('去除标题标记', () => {
    const result = stripMarkdownToPlainText('# 一级标题\n## 二级标题\n### 三级标题')
    expect(result).toContain('一级标题')
    expect(result).toContain('二级标题')
    expect(result).toContain('三级标题')
    expect(result).not.toContain('#')
  })

  it('去除粗体标记', () => {
    const result = stripMarkdownToPlainText('这是 **粗体** 文本和 __粗体__ 文本')
    expect(result).toContain('粗体')
    expect(result).not.toContain('**')
    expect(result).not.toContain('__')
  })

  it('去除斜体标记', () => {
    const result = stripMarkdownToPlainText('这是 *斜体* 文本和 _斜体_ 文本')
    expect(result).toContain('斜体')
  })

  it('保留代码块中的代码文本', () => {
    const result = stripMarkdownToPlainText('```typescript\nconst x = 1\nconsole.log(x)\n```')
    expect(result).toContain('const x = 1')
    expect(result).toContain('console.log(x)')
    expect(result).not.toContain('```')
    expect(result).not.toContain('typescript')
  })

  it('去除行内代码标记但保留代码文本', () => {
    const result = stripMarkdownToPlainText('使用 `console.log()` 输出')
    expect(result).toContain('console.log()')
    expect(result).not.toContain('`')
  })

  it('链接仅保留显示文本', () => {
    const result = stripMarkdownToPlainText('参考 [Google](https://google.com) 搜索')
    expect(result).toContain('Google')
    expect(result).not.toContain('https://google.com')
    expect(result).not.toContain('](')
  })

  it('去除图片', () => {
    const result = stripMarkdownToPlainText('![架构图](https://example.com/img.png)')
    expect(result).not.toContain('架构图')
    expect(result).not.toContain('img.png')
    expect(result).not.toContain('![')
  })

  it('去除 HTML 注释', () => {
    const result = stripMarkdownToPlainText('正文内容 <!-- 这是注释 --> 更多内容')
    expect(result).toContain('正文内容')
    expect(result).toContain('更多内容')
    expect(result).not.toContain('注释')
    expect(result).not.toContain('<!--')
  })

  it('去除表格分隔行', () => {
    const result = stripMarkdownToPlainText('| 列A | 列B |\n|------|------|\n| 值1 | 值2 |')
    expect(result).toContain('列A')
    expect(result).toContain('列B')
    expect(result).toContain('值1')
    expect(result).toContain('值2')
    expect(result).not.toContain('---')
  })

  it('去除引用标记', () => {
    const result = stripMarkdownToPlainText('> 这是一段引用')
    expect(result).toContain('这是一段引用')
    expect(result).not.toContain('>')
  })

  it('去除无序列表标记', () => {
    const result = stripMarkdownToPlainText('- 项目A\n- 项目B\n* 项目C')
    expect(result).toContain('项目A')
    expect(result).toContain('项目B')
    expect(result).toContain('项目C')
  })

  it('去除有序列表标记', () => {
    const result = stripMarkdownToPlainText('1. 第一步\n2. 第二步\n3. 第三步')
    expect(result).toContain('第一步')
    expect(result).toContain('第二步')
    expect(result).toContain('第三步')
  })

  it('去除水平线', () => {
    const result = stripMarkdownToPlainText('文本\n---\n更多文本')
    expect(result).toContain('文本')
    expect(result).toContain('更多文本')
    expect(result).not.toContain('---')
  })

  it('正确处理 fixtureMarkdownRichDocument', () => {
    const result = stripMarkdownToPlainText(fixtureMarkdownRichDocument.content)
    // 应保留关键内容
    expect(result).toContain('产品需求文档')
    expect(result).toContain('重要的')
    expect(result).toContain('const greeting')
    expect(result).toContain('Google')
    expect(result).toContain('GitHub')
    // 不应含 Markdown 标记
    expect(result).not.toContain('###')
    expect(result).not.toContain('```')
    expect(result).not.toContain('<!--')
    expect(result).not.toContain('![架构图]')
  })

  it('处理粗体斜体组合', () => {
    const result = stripMarkdownToPlainText('这是 ***粗斜体*** 文本')
    expect(result).toContain('粗斜体')
  })

  it('合并多余空行', () => {
    const result = stripMarkdownToPlainText('A\n\n\n\n\nB')
    const newlineCount = (result.match(/\n/g) || []).length
    expect(newlineCount).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// boundSearchableText
// ---------------------------------------------------------------------------

describe('boundSearchableText', () => {
  it('空字符串返回空无截断', () => {
    const result = boundSearchableText('')
    expect(result.text).toBe('')
    expect(result.truncated).toBe(false)
  })

  it('短文本不截断', () => {
    const result = boundSearchableText('短文本', 100)
    expect(result.text).toBe('短文本')
    expect(result.truncated).toBe(false)
  })

  it('正好在边界不截断', () => {
    const text = 'A'.repeat(10)
    const result = boundSearchableText(text, 10)
    expect(result.text).toBe(text)
    expect(result.truncated).toBe(false)
  })

  it('超长文本截断', () => {
    const text = 'A'.repeat(100)
    const result = boundSearchableText(text, 50)
    expect(result.truncated).toBe(true)
    expect(result.text.length).toBeLessThan(text.length)
    expect(result.text).toContain('[truncated]')
  })

  it('默认上限为 DOCUMENT_SEARCH_CONTENT_BOUND', () => {
    const text = 'A'.repeat(DOCUMENT_SEARCH_CONTENT_BOUND + 1)
    const result = boundSearchableText(text)
    expect(result.truncated).toBe(true)
  })

  it('截断后文本以省略号标记结尾', () => {
    const text = 'A'.repeat(100)
    const result = boundSearchableText(text, 20)
    expect(result.text.endsWith('…[truncated]')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// computeDocumentContentHash
// ---------------------------------------------------------------------------

describe('computeDocumentContentHash', () => {
  it('产出非空字符串', () => {
    const hash = computeDocumentContentHash('title', 'body')
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe('string')
  })

  it('相同输入产出相同哈希（确定性）', () => {
    const h1 = computeDocumentContentHash('title', 'body')
    const h2 = computeDocumentContentHash('title', 'body')
    expect(h1).toBe(h2)
  })

  it('不同 title 产出不同哈希', () => {
    const h1 = computeDocumentContentHash('title1', 'body')
    const h2 = computeDocumentContentHash('title2', 'body')
    expect(h1).not.toBe(h2)
  })

  it('不同 body 产出不同哈希', () => {
    const h1 = computeDocumentContentHash('title', 'body1')
    const h2 = computeDocumentContentHash('title', 'body2')
    expect(h1).not.toBe(h2)
  })

  it('空 title 和 body 不抛错', () => {
    expect(() => computeDocumentContentHash('', '')).not.toThrow()
    expect(computeDocumentContentHash('', '')).toBeTruthy()
  })

  it('哈希稳定性：多次调用结果一致', () => {
    const results = Array.from({ length: 100 }, () =>
      computeDocumentContentHash('稳定测试', '稳定正文'),
    )
    const first = results[0]
    for (const r of results) {
      expect(r).toBe(first)
    }
  })
})

// ---------------------------------------------------------------------------
// buildDocumentSearchableProjection
// ---------------------------------------------------------------------------

describe('buildDocumentSearchableProjection', () => {
  it('基本投影', () => {
    const proj = buildDocumentSearchableProjection({ name: '测试文档', content: '纯文本正文' })
    expect(proj.title).toBe('测试文档')
    expect(proj.searchableText).toBe('纯文本正文')
    expect(proj.contentHash).toBeTruthy()
    expect(proj.truncated).toBe(false)
  })

  it('null content 正常处理', () => {
    const proj = buildDocumentSearchableProjection({ name: '空文档', content: null })
    expect(proj.title).toBe('空文档')
    expect(proj.searchableText).toBe('')
    expect(proj.contentHash).toBeTruthy()
    expect(proj.truncated).toBe(false)
  })

  it('Markdown 内容去标记', () => {
    const proj = buildDocumentSearchableProjection({
      name: 'Markdown文档',
      content: '# 标题\n\n**粗体**文本',
    })
    expect(proj.searchableText).toContain('标题')
    expect(proj.searchableText).toContain('粗体')
    expect(proj.searchableText).not.toContain('#')
    expect(proj.searchableText).not.toContain('**')
  })

  it('自定义截断上限', () => {
    const longContent = 'A'.repeat(200)
    const proj = buildDocumentSearchableProjection({ name: '长文档', content: longContent }, 100)
    expect(proj.truncated).toBe(true)
    expect(proj.searchableText.length).toBeLessThan(200)
  })
})

// ---------------------------------------------------------------------------
// extractSnippet
// ---------------------------------------------------------------------------

describe('extractSnippet', () => {
  it('命中位置返回片段', () => {
    const snippet = extractSnippet('这是一段很长的正文内容，包含目标关键词在这里。', '关键词')
    expect(snippet).toBeTruthy()
    expect(snippet).toContain('关键词')
  })

  it('无命中返回 null', () => {
    const snippet = extractSnippet('这段文本不包含目标词', '缺失词')
    expect(snippet).toBeNull()
  })

  it('空正文返回 null', () => {
    expect(extractSnippet('', 'keyword')).toBeNull()
  })

  it('空关键词返回 null', () => {
    expect(extractSnippet('text', '')).toBeNull()
  })

  it('开头命中不加起始省略号', () => {
    const body = '关键词' + 'x'.repeat(200)
    const snippet = extractSnippet(body, '关键词')
    expect(snippet).toBeTruthy()
    expect(snippet).not.toMatch(/^…/)
  })

  it('末尾命中不加结尾省略号', () => {
    const body = 'x'.repeat(200) + '关键词'
    const snippet = extractSnippet(body, '关键词')
    expect(snippet).toBeTruthy()
    expect(snippet).not.toMatch(/…$/)
  })

  it('中间命中加前后省略号', () => {
    const body = 'x'.repeat(200) + '关键词在这里' + 'y'.repeat(200)
    const snippet = extractSnippet(body, '关键词')
    expect(snippet).toBeTruthy()
    if (snippet) {
      expect(snippet.startsWith('…')).toBe(true)
      expect(snippet.endsWith('…')).toBe(true)
    }
  })

  it('片段不超过最大长度', () => {
    const body = 'x'.repeat(500) + '关键词' + 'y'.repeat(500)
    const snippet = extractSnippet(body, '关键词', 200)
    if (snippet) {
      expect(snippet.length).toBeLessThanOrEqual(150)
    }
  })

  it('大小写不敏感匹配', () => {
    const snippet = extractSnippet('This is a KEYWORD in text', 'keyword')
    expect(snippet).toBeTruthy()
    if (snippet) {
      expect(snippet.toLowerCase()).toContain('keyword')
    }
  })
})

// ---------------------------------------------------------------------------
// normalizeSearchKeyword
// ---------------------------------------------------------------------------

describe('normalizeSearchKeyword', () => {
  it('trim 首尾空白', () => {
    expect(normalizeSearchKeyword('  hello  ')).toBe('hello')
  })

  it('折叠连续空白', () => {
    expect(normalizeSearchKeyword('hello   world')).toBe('hello world')
  })

  it('转小写', () => {
    expect(normalizeSearchKeyword('HELLO World')).toBe('hello world')
  })

  it('中文关键词不变（无大小写）', () => {
    expect(normalizeSearchKeyword('搜索关键词')).toBe('搜索关键词')
  })
})

// ---------------------------------------------------------------------------
// computeKeywordHash
// ---------------------------------------------------------------------------

describe('computeKeywordHash', () => {
  it('产出非空 hex 字符串', () => {
    const hash = computeKeywordHash('test keyword')
    expect(hash).toBeTruthy()
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true)
  })

  it('相同关键词产出相同哈希', () => {
    expect(computeKeywordHash('测试')).toBe(computeKeywordHash('测试'))
  })

  it('不同关键词产出不同哈希', () => {
    expect(computeKeywordHash('关键词A')).not.toBe(computeKeywordHash('关键词B'))
  })

  it('大小写不敏感（经 normalize 后相同）', () => {
    expect(computeKeywordHash('KEYWORD')).toBe(computeKeywordHash('keyword'))
  })
})
