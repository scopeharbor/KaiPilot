// v3-document-code-block-support fixtures 测试 —— 断言 fixture 形状与白名单。
import { describe, it } from 'vitest'
import {
  SUPPORTED_CODE_LANGUAGES,
  isSupportedCodeLanguage,
  COPY_CODE_RESULTS,
  isCopyCodeResult,
  type FencedCodeBlockMeta,
  type CopyCodeResult,
} from '../src/document-code-block-support.js'
import {
  mdFixtureMixedContent,
  mdFixtureUnclosedFence,
  mdFixtureIndentedFence,
  mdFixtureTildeFence,
  mdFixtureEmpty,
  mdFixtureProseOnly,
  mdFixtureInlineCodeOnly,
  mdFixtureLongLine,
  expectedMixedFencedBlocks,
  expectedUnclosedFencedBlocks,
  expectedIndentedFencedBlocks,
  expectedTildeFencedBlocks,
} from '../src/document-code-block-support-fixtures.js'

describe('document-code-block-support fixtures', () => {
  // ── 语言白名单基础断言 ──

  it('SUPPORTED_CODE_LANGUAGES 为非空数组', () => {
    expect(SUPPORTED_CODE_LANGUAGES.length).toBeGreaterThan(0)
  })

  it('语言白名单包含文档高频语言', () => {
    const essential = ['bash', 'javascript', 'typescript', 'json', 'sql', 'python', 'yaml']
    for (const lang of essential) {
      expect(isSupportedCodeLanguage(lang)).toBe(true)
    }
  })

  it('未在列表的语言返回 false', () => {
    expect(isSupportedCodeLanguage('haskell')).toBe(false)
  })

  it('isSupportedCodeLanguage 拒绝空字符串', () => {
    expect(isSupportedCodeLanguage('')).toBe(false)
  })

  // ── 复制结果类型 ──

  it('COPY_CODE_RESULTS 包含 copied/failed/unavailable', () => {
    expect(COPY_CODE_RESULTS).toContain('copied')
    expect(COPY_CODE_RESULTS).toContain('failed')
    expect(COPY_CODE_RESULTS).toContain('unavailable')
  })

  it('isCopyCodeResult 拒绝非值', () => {
    expect(isCopyCodeResult('unknown-result')).toBe(false)
  })

  it('isCopyCodeResult 接受所有枚举值', () => {
    for (const r of COPY_CODE_RESULTS) {
      expect(isCopyCodeResult(r)).toBe(true)
    }
  })

  // ── Fixture 非空 ──

  it('mdFixtureMixedContent 非空字符串', () => {
    expect(typeof mdFixtureMixedContent).toBe('string')
    expect(mdFixtureMixedContent.length).toBeGreaterThan(0)
  })

  it('mdFixtureEmpty 为空字符串', () => {
    expect(mdFixtureEmpty).toBe('')
  })

  it('mdFixtureProseOnly 不含围栏代码块', () => {
    expect(mdFixtureProseOnly).not.toContain('```')
    expect(mdFixtureProseOnly).not.toContain('~~~')
  })

  it('mdFixtureInlineCodeOnly 含有行内代码但无围栏块', () => {
    expect(mdFixtureInlineCodeOnly).toContain('`')
    // 不应有完整的围栏代码块（``` 后跟换行）
    expect(mdFixtureInlineCodeOnly).not.toMatch(/```\n/)
  })

  it('mdFixtureUnclosedFence 以正文结束（无闭合围栏）', () => {
    const lines = mdFixtureUnclosedFence.split('\n')
    const lastLine = lines[lines.length - 1]
    expect(lastLine).not.toBe('```')
  })

  // ── 预期代码块元数据形状 ──

  const assertBlockShape = (block: FencedCodeBlockMeta) => {
    expect(block.language === null || typeof block.language === 'string').toBe(true)
    expect(typeof block.labeled).toBe('boolean')
    expect(typeof block.supported).toBe('boolean')
    expect(typeof block.startLine).toBe('number')
    expect(typeof block.endLine).toBe('number')
    expect(typeof block.lineCount).toBe('number')
    expect(typeof block.byteCount).toBe('number')
    expect(typeof block.closed).toBe('boolean')
  }

  it('expectedMixedFencedBlocks 为非空数组', () => {
    expect(expectedMixedFencedBlocks.length).toBeGreaterThan(0)
  })

  it('expectedMixedFencedBlocks 每个条目符合 FencedCodeBlockMeta 形状', () => {
    for (const block of expectedMixedFencedBlocks) {
      assertBlockShape(block)
    }
  })

  it('expectedUnclosedFencedBlocks 的 closed 为 false', () => {
    expect(expectedUnclosedFencedBlocks.length).toBeGreaterThan(0)
    for (const block of expectedUnclosedFencedBlocks) {
      expect(block.closed).toBe(false)
    }
  })

  it('expectedIndentedFencedBlocks 语言为 python 且闭合', () => {
    expect(expectedIndentedFencedBlocks[0].language).toBe('python')
    expect(expectedIndentedFencedBlocks[0].closed).toBe(true)
  })

  it('expectedTildeFencedBlocks 使用 tilde 围栏且语言为 bash', () => {
    expect(expectedTildeFencedBlocks[0].language).toBe('bash')
    expect(expectedTildeFencedBlocks[0].closed).toBe(true)
  })

  // ── 白名单完整性 ──

  it('白名单中所有语言均为小写', () => {
    for (const lang of SUPPORTED_CODE_LANGUAGES) {
      expect(lang).toBe(lang.toLowerCase())
    }
  })

  it('白名单无重复', () => {
    expect(new Set(SUPPORTED_CODE_LANGUAGES).size).toBe(SUPPORTED_CODE_LANGUAGES.length)
  })
})
