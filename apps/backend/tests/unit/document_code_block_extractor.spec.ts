import { test } from '@japa/runner'
import { extractFencedCodeBlocks } from '#services/document_code_block_extractor'
import {
  mdFixtureMixedContent,
  mdFixtureUnclosedFence,
  mdFixtureIndentedFence,
  mdFixtureTildeFence,
  mdFixtureEmpty,
  mdFixtureProseOnly,
  mdFixtureInlineCodeOnly,
} from '@aiproj/types'

test.group('document_code_block_extractor', () => {
  // ── 确定性 ──

  test('同一输入两次调用结果深等', ({ assert }) => {
    const content = `# Test

\`\`\`bash
echo hello
\`\`\`

\`\`\`json
{"key": "value"}
\`\`\`
`
    const first = extractFencedCodeBlocks(content)
    const second = extractFencedCodeBlocks(content)
    assert.deepEqual(first, second)
    assert.equal(first.length, 2)
  })

  // ── 空文档 / 纯文本 ──

  test('空字符串返回空数组', ({ assert }) => {
    const result = extractFencedCodeBlocks('')
    assert.deepEqual(result, [])
  })

  test('mdFixtureEmpty 返回空数组', ({ assert }) => {
    const result = extractFencedCodeBlocks(mdFixtureEmpty)
    assert.deepEqual(result, [])
  })

  test('纯文本无代码块返回空数组', ({ assert }) => {
    const result = extractFencedCodeBlocks(mdFixtureProseOnly)
    assert.deepEqual(result, [])
  })

  // ── 行内代码不算块 ──

  test('仅有行内代码不产生代码块', ({ assert }) => {
    const result = extractFencedCodeBlocks(mdFixtureInlineCodeOnly)
    assert.deepEqual(result, [])
  })

  test('行内反引号不算围栏代码块', ({ assert }) => {
    const content = '使用 `import { foo }` 导入'
    const result = extractFencedCodeBlocks(content)
    assert.deepEqual(result, [])
  })

  // ── labeled / unlabeled 混合 ──

  test('混合有标注/无标注代码块都被正确提取', ({ assert }) => {
    const content = mdFixtureMixedContent
    const result = extractFencedCodeBlocks(content)

    const labeled = result.filter((b) => b.labeled)
    const unlabeled = result.filter((b) => !b.labeled)

    assert.isAbove(labeled.length, 0, '应有标注代码块')
    assert.isAbove(unlabeled.length, 0, '应有无标注代码块')
  })

  test('标注代码块的 labeled=true, language 非空', ({ assert }) => {
    const result = extractFencedCodeBlocks(mdFixtureMixedContent)
    const bashBlock = result.find((b) => b.language === 'bash')
    assert.isDefined(bashBlock)
    assert.isTrue(bashBlock!.labeled)
    assert.equal(bashBlock!.language, 'bash')
  })

  test('无标注代码块的 labeled=false, language=null', ({ assert }) => {
    const result = extractFencedCodeBlocks(mdFixtureMixedContent)
    const unlabeled = result.find((b) => b.language === null)
    assert.isDefined(unlabeled)
    assert.isFalse(unlabeled!.labeled)
  })

  // ── 支持/不支持语言 ──

  test('supported 语言标记 supported=true', ({ assert }) => {
    const result = extractFencedCodeBlocks(mdFixtureMixedContent)
    const bashBlock = result.find((b) => b.language === 'bash')
    assert.isDefined(bashBlock)
    assert.isTrue(bashBlock!.supported)
  })

  test('未标注语言标记 supported=false', ({ assert }) => {
    const result = extractFencedCodeBlocks(mdFixtureMixedContent)
    const unlabeled = result.find((b) => b.language === null)
    assert.isDefined(unlabeled)
    assert.isFalse(unlabeled!.supported)
  })

  // ── 未闭合围栏 ──

  test('未闭合围栏标记 closed=false 且取到文档末尾', ({ assert }) => {
    const result = extractFencedCodeBlocks(mdFixtureUnclosedFence)
    assert.equal(result.length, 1)
    assert.isFalse(result[0].closed)
    assert.equal(result[0].language, 'bash')
    assert.isTrue(result[0].labeled)
  })

  // ── 缩进围栏 ──

  test('≤3 空格缩进围栏被正确处理', ({ assert }) => {
    const result = extractFencedCodeBlocks(mdFixtureIndentedFence)
    assert.equal(result.length, 1)
    assert.equal(result[0].language, 'python')
    assert.isTrue(result[0].closed)
  })

  // ── ~ 围栏 ──

  test('tilde 围栏被正确处理', ({ assert }) => {
    const result = extractFencedCodeBlocks(mdFixtureTildeFence)
    assert.equal(result.length, 1)
    assert.equal(result[0].language, 'bash')
    assert.isTrue(result[0].closed)
  })

  // ── 边界条件 ──

  test('围栏起始行在文档末尾无闭合', ({ assert }) => {
    const content = `# Title

\`\`\`bash`
    const result = extractFencedCodeBlocks(content)
    assert.equal(result.length, 1)
    assert.isFalse(result[0].closed)
    assert.equal(result[0].lineCount, 0)
    assert.equal(result[0].byteCount, 0)
  })

  test('围栏后紧接闭合（空代码块）', ({ assert }) => {
    const content = `\`\`\`json
\`\`\``
    const result = extractFencedCodeBlocks(content)
    assert.equal(result.length, 1)
    assert.equal(result[0].lineCount, 0)
    assert.equal(result[0].byteCount, 0)
    assert.isTrue(result[0].closed)
  })

  test('多个代码块顺序稳定（按文档出现顺序）', ({ assert }) => {
    const content = mdFixtureMixedContent
    const result = extractFencedCodeBlocks(content)

    // 验证 startLine 递增
    for (let i = 1; i < result.length; i++) {
      assert.isAbove(result[i].startLine, result[i - 1].startLine)
    }
  })

  test('info string 取首个 token 为语言（小写）', ({ assert }) => {
    const content = `\`\`\`JavaScript filename="app.ts"
const x = 1
\`\`\``
    const result = extractFencedCodeBlocks(content)
    assert.equal(result.length, 1)
    assert.equal(result[0].language, 'javascript')
  })

  test('info string 多余空白被忽略', ({ assert }) => {
    const content = `\`\`\`   python   # comment
print(1)
\`\`\``
    const result = extractFencedCodeBlocks(content)
    assert.equal(result.length, 1)
    assert.equal(result[0].language, 'python')
  })

  // ── 行号验证 ──

  test('startLine 和 endLine 正确（1-based）', ({ assert }) => {
    const content = `Line 1
Line 2
\`\`\`bash
echo hi
\`\`\`
Line 6`
    const result = extractFencedCodeBlocks(content)
    assert.equal(result.length, 1)
    assert.equal(result[0].startLine, 3)
    assert.equal(result[0].endLine, 5)
    assert.equal(result[0].lineCount, 1)
  })
})
