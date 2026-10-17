/**
 * 项目文档公式元数据提取纯函数单元测试（v3-document-formula-support §2.2）。
 *
 * 覆盖：行内/块级计数、\( \) / \[ \]、未闭合定界不吞字、\$ 转义不计、
 * 货币 $5/$10 不计、重复调用确定性、与导入归一化同跑时 source/preview 哈希不变。
 */
import { test } from '@japa/runner'
import {
  extractDocumentFormulaMeta,
  summarizeFormulaMeta,
} from '#services/document_formula_extractor'
import {
  normalizeMarkdownText,
  computeMarkdownSourceDocumentHash,
  computeMarkdownPreviewHash,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STANDARD = `# 数学测试

勾股定理 $a^2 + b^2 = c^2$ 是基础。

$$
\\int_0^1 f(x) dx
$$

质能方程 \\(E = mc^2\\)

\\[
\\mathbf{X} = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}
\\]
`

const INLINE_ONLY = `动能 $E_k = \\frac{1}{2}mv^2$ 和 \\(x^2 + y^2 = 1\\)
`

const BLOCK_ONLY = `$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

$$
\\nabla \\cdot \\mathbf{F}
$$
`

const UNCLOSED = `未闭合 $a + b 测试。`

const ESCAPED = `价格 \\$5 元，公式 $x = 1$`

const CURRENCY = `价格 $5 和 $10，但 $E = mc^2$`

const EMPTY = ''

const PLAIN = '# 无公式\n\n纯文本。'

const WITH_UNSUPPORTED = `$$
\\fakecmd{a}{b} = \\sum x
$$

$\\unknownop z$
`

const WITH_IMPORT_CONTEXT = `---
title: 测试文档
---

# 需求说明

成本计算公式 $C = \\sum_{i=1}^{n} c_i \\cdot q_i$。

$$
\\text{ROI} = \\frac{\\text{收益}}{\\text{成本}} \\times 100\\%
$$
`

// ---------------------------------------------------------------------------

test.group('extractDocumentFormulaMeta', () => {
  test('标准文档：正确计数行内和块级', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(STANDARD)
    assert.equal(result.inlineCount, 2) // $a^2...$ + \(E = mc^2\)
    assert.equal(result.blockCount, 2) // $$int$$ + \[ \mathbf{X} \]
    assert.isAbove(result.totalBytes, 0)
  })

  test('仅行内公式', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(INLINE_ONLY)
    assert.equal(result.inlineCount, 2)
    assert.equal(result.blockCount, 0)
  })

  test('仅块级公式', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(BLOCK_ONLY)
    assert.equal(result.inlineCount, 0)
    assert.equal(result.blockCount, 2)
  })

  test('未闭合定界不吞字', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(UNCLOSED)
    assert.equal(result.inlineCount, 0)
    assert.equal(result.blockCount, 0)
    assert.deepEqual(result.delimiters, [])
  })

  test('\\$ 转义不计为公式', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(ESCAPED)
    assert.equal(result.inlineCount, 1) // 只有 $x = 1$
  })

  test('货币 $5/$10 不误伤', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(CURRENCY)
    assert.equal(result.inlineCount, 1) // 只有 $E = mc^2$
  })

  test('空文档返回全零', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(EMPTY)
    assert.equal(result.inlineCount, 0)
    assert.equal(result.blockCount, 0)
    assert.equal(result.totalBytes, 0)
    assert.deepEqual(result.delimiters, [])
  })

  test('纯文本无公式', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(PLAIN)
    assert.equal(result.inlineCount, 0)
    assert.equal(result.blockCount, 0)
  })

  test('不支持命令检测', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(WITH_UNSUPPORTED)
    assert.isAbove(result.unsupportedCommandHits.length, 0)
  })

  test('重复调用确定性', async ({ assert }) => {
    const a = extractDocumentFormulaMeta(STANDARD)
    const b = extractDocumentFormulaMeta(STANDARD)
    assert.deepEqual(a, b)
  })

  test('不修改输入字符串', async ({ assert }) => {
    const copy = STANDARD.slice()
    extractDocumentFormulaMeta(copy)
    assert.equal(copy, STANDARD)
  })

  test('定界符范围按位置排序', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(STANDARD)
    for (let i = 1; i < result.delimiters.length; i++) {
      assert.isAtLeast(result.delimiters[i].start, result.delimiters[i - 1].start)
    }
  })

  test('每个 delimiters 有有效 bytes', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(STANDARD)
    for (const d of result.delimiters) {
      assert.isAbove(d.bytes, 0)
    }
  })

  test('四种定界符类型均被识别', async ({ assert }) => {
    const result = extractDocumentFormulaMeta(STANDARD)
    const types = result.delimiters.map((d) => d.type)
    assert.include(types, 'inline-dollar')
    assert.include(types, 'inline-paren')
    assert.include(types, 'block-dollar')
    assert.include(types, 'block-bracket')
  })

  test('与归一化同跑 source/preview 哈希不变', async ({ assert }) => {
    // 证明提取不影响导入归一化与哈希计算
    const content = WITH_IMPORT_CONTEXT
    const normalized = normalizeMarkdownText(content)

    // 提取前算哈希
    const sourceHashBefore = computeMarkdownSourceDocumentHash({
      documentId: 1,
      content: normalized,
    })

    const previewHashBefore = computeMarkdownPreviewHash({
      normalizedContent: normalized,
      mode: 'create',
      title: '测试文档',
    })

    // 执行提取
    const meta = extractDocumentFormulaMeta(content)
    assert.isDefined(meta)

    // 提取后重算哈希
    const sourceHashAfter = computeMarkdownSourceDocumentHash({
      documentId: 1,
      content: normalized,
    })

    const previewHashAfter = computeMarkdownPreviewHash({
      normalizedContent: normalized,
      mode: 'create',
      title: '测试文档',
    })

    assert.equal(sourceHashBefore, sourceHashAfter)
    assert.equal(previewHashBefore, previewHashAfter)
  })
})

test.group('summarizeFormulaMeta', () => {
  test('生成统计摘要', async ({ assert }) => {
    const meta = extractDocumentFormulaMeta(STANDARD)
    const summary = summarizeFormulaMeta(meta)
    assert.equal(summary.inlineCount, 2)
    assert.equal(summary.blockCount, 2)
    assert.isAbove(summary.totalBytes, 0)
    assert.isFalse(summary.hasUnsupported)
  })

  test('有不支持命令时 hasUnsupported 为 true', async ({ assert }) => {
    const meta = extractDocumentFormulaMeta(WITH_UNSUPPORTED)
    const summary = summarizeFormulaMeta(meta)
    assert.isTrue(summary.hasUnsupported)
  })
})

test.group('document_formula_extractor — 权限与边界', () => {
  test('空/白输入返回全零结果（不抛错）', async ({ assert }) => {
    const result = extractDocumentFormulaMeta('')
    assert.deepEqual(result, {
      inlineCount: 0,
      blockCount: 0,
      totalBytes: 0,
      unsupportedCommandHits: [],
      delimiters: [],
    })
  })

  test('只有空白字符返回全零', async ({ assert }) => {
    const result = extractDocumentFormulaMeta('   \n\t  ')
    assert.equal(result.inlineCount, 0)
    assert.equal(result.blockCount, 0)
  })

  test('公式元数据不含原文正文（低敏）', async ({ assert }) => {
    const sensitive = '机密内容 $x$ 不应泄露'
    const result = extractDocumentFormulaMeta(sensitive)
    // 元数据只含计数与定界符范围，不含公式原文
    assert.isDefined(result.inlineCount)
    assert.isDefined(result.blockCount)
    // delimiters 的位置信息不含原文正文
    for (const d of result.delimiters) {
      assert.isFalse(typeof (d as any).content === 'string')
    }
  })

  test('summarizeFormulaMeta 不泄露原始内容', async ({ assert }) => {
    const meta = extractDocumentFormulaMeta(STANDARD)
    const summary = summarizeFormulaMeta(meta)
    // 摘要只含计数布尔值与字节数，不含原文
    const keys = Object.keys(summary)
    assert.isFalse(keys.includes('delimiters' as any))
    assert.isFalse(keys.includes('content' as any))
    assert.isFalse(keys.includes('unsupportedCommandHits' as any))
  })
})
