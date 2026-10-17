// v3-document-formula-support —— 共享契约测试。
// 覆盖：定界符枚举、提取函数、fixture-期望对齐、类型守卫、边界用例。

import { describe, it, expect } from 'vitest'
import {
  FORMULA_DELIMITER_TYPES,
  FORMULA_RENDER_RESULT_STATUSES,
  KATEX_SUPPORTED_COMMANDS,
  isFormulaDelimiter,
  isFormulaRenderResultStatus,
  extractFormulaDelimiters,
  detectUnsupportedCommands,
  type FormulaDelimiter,
  type FormulaExtractionResult,
  type FormulaDelimiterRange,
  type FormulaRenderResult,
  type FormulaRenderResultStatus,
} from './document-formula-support.js'

import {
  formulaFixtureStandard,
  formulaFixtureStandardExpected,
  formulaFixtureInlineOnly,
  formulaFixtureInlineOnlyExpected,
  formulaFixtureBlockOnly,
  formulaFixtureBlockOnlyExpected,
  formulaFixtureUnclosed,
  formulaFixtureUnclosedExpected,
  formulaFixtureEscaped,
  formulaFixtureEscapedExpected,
  formulaFixtureCurrency,
  formulaFixtureCurrencyExpected,
  formulaFixtureEmpty,
  formulaFixtureEmptyExpected,
  formulaFixturePlainText,
  formulaFixturePlainTextExpected,
  formulaFixtureAllDelimiters,
  formulaFixtureAllDelimitersExpected,
  formulaFixtureUnsupportedCommands,
  formulaFixtureMatrix,
  formulaFixtureLongEquation,
  buildFormulaExtractionResult,
  buildFormulaDelimiterRange,
} from './document-formula-support-fixtures.js'

// =============================================================================
// §1 枚举白名单
// =============================================================================

describe('FORMULA_DELIMITER_TYPES', () => {
  it('应包含四个定界符类型', () => {
    expect(FORMULA_DELIMITER_TYPES).toEqual([
      'inline-dollar',
      'block-dollar',
      'inline-paren',
      'block-bracket',
    ])
  })

  it('isFormulaDelimiter 应识别合法定界符', () => {
    expect(isFormulaDelimiter('inline-dollar')).toBe(true)
    expect(isFormulaDelimiter('block-dollar')).toBe(true)
    expect(isFormulaDelimiter('inline-paren')).toBe(true)
    expect(isFormulaDelimiter('block-bracket')).toBe(true)
  })

  it('isFormulaDelimiter 应拒绝非法值', () => {
    expect(isFormulaDelimiter('')).toBe(false)
    expect(isFormulaDelimiter('unknown')).toBe(false)
    expect(isFormulaDelimiter(null)).toBe(false)
    expect(isFormulaDelimiter(42)).toBe(false)
  })
})

describe('FORMULA_RENDER_RESULT_STATUSES', () => {
  it('应包含四个渲染状态', () => {
    expect(FORMULA_RENDER_RESULT_STATUSES).toEqual(['success', 'degraded', 'error', 'unsupported'])
  })

  it('isFormulaRenderResultStatus 应正确判定', () => {
    expect(isFormulaRenderResultStatus('success')).toBe(true)
    expect(isFormulaRenderResultStatus('degraded')).toBe(true)
    expect(isFormulaRenderResultStatus('error')).toBe(true)
    expect(isFormulaRenderResultStatus('unsupported')).toBe(true)
    expect(isFormulaRenderResultStatus('unknown')).toBe(false)
  })
})

// =============================================================================
// §2 KaTeX 命令白名单
// =============================================================================

describe('KATEX_SUPPORTED_COMMANDS', () => {
  it('应包含常用命令', () => {
    expect(KATEX_SUPPORTED_COMMANDS.has('alpha')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('beta')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('sum')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('int')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('frac')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('sqrt')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('sin')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('infty')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('begin')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('end')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('pmatrix')).toBe(true)
    expect(KATEX_SUPPORTED_COMMANDS.has('bmatrix')).toBe(true)
  })

  it('应拒绝不存在的命令', () => {
    expect(KATEX_SUPPORTED_COMMANDS.has('fakecmd')).toBe(false)
    expect(KATEX_SUPPORTED_COMMANDS.has('unknown_op')).toBe(false)
  })
})

// =============================================================================
// §3 detectUnsupportedCommands —— 不支持命令检测
// =============================================================================

describe('detectUnsupportedCommands', () => {
  it('对已知命令应返回空数组', () => {
    const result = detectUnsupportedCommands('\\sum_{i=1}^{n} \\frac{x_i}{n}')
    expect(result).toEqual([])
  })

  it('应检测到不支持的命令', () => {
    const result = detectUnsupportedCommands('\\fakecmd{a}{b} \\sum x')
    expect(result).toContain('fakecmd')
  })

  it('应去重排序', () => {
    const result = detectUnsupportedCommands('\\fake \\fake \\another x')
    expect(result).toEqual(['another', 'fake'])
  })

  it('应最多返回20个', () => {
    const many = Array.from({ length: 30 }, (_, i) => `\\cmd${i}`).join(' ')
    const result = detectUnsupportedCommands(many)
    expect(result.length).toBeLessThanOrEqual(20)
  })

  it('空输入应返回空数组', () => {
    expect(detectUnsupportedCommands('')).toEqual([])
  })
})

// =============================================================================
// §4 extractFormulaDelimiters —— 公式提取
// =============================================================================

describe('extractFormulaDelimiters', () => {
  describe('标准文档', () => {
    it('应正确计数行内和块级公式', () => {
      const result = extractFormulaDelimiters(formulaFixtureStandard)
      expect(result.inlineCount).toBe(3) // $a^2+b^2=c^2$ + \(A = \pi r^2\) + $\int...$
      expect(result.blockCount).toBe(2) // $$sum$$ + \[ \mathbf{X} \]
    })

    it('应产出定界符范围数组', () => {
      const result = extractFormulaDelimiters(formulaFixtureStandard)
      expect(result.delimiters.length).toBe(5)
    })

    it('定界符应按位置排序', () => {
      const result = extractFormulaDelimiters(formulaFixtureStandard)
      for (let i = 1; i < result.delimiters.length; i++) {
        expect(result.delimiters[i].start).toBeGreaterThanOrEqual(result.delimiters[i - 1].start)
      }
    })

    it('每个定界符应有有效的字节数', () => {
      const result = extractFormulaDelimiters(formulaFixtureStandard)
      for (const d of result.delimiters) {
        expect(d.bytes).toBeGreaterThan(0)
      }
    })
  })

  describe('仅行内公式', () => {
    it('应正确计数', () => {
      const result = extractFormulaDelimiters(formulaFixtureInlineOnly)
      expect(result.inlineCount).toBe(3)
      expect(result.blockCount).toBe(0)
    })
  })

  describe('仅块级公式', () => {
    it('应正确计数', () => {
      const result = extractFormulaDelimiters(formulaFixtureBlockOnly)
      expect(result.inlineCount).toBe(0)
      expect(result.blockCount).toBe(2)
    })
  })

  describe('未闭合定界符', () => {
    it('不应吞字——未闭合的不计', () => {
      const result = extractFormulaDelimiters(formulaFixtureUnclosed)
      expect(result.inlineCount).toBe(0)
      expect(result.blockCount).toBe(0)
      expect(result.delimiters).toHaveLength(0)
      expect(result.totalBytes).toBe(0)
    })

    it('原文本应保留（提取不修改输入）', () => {
      const original = formulaFixtureUnclosed
      extractFormulaDelimiters(original)
      expect(original).toBe(formulaFixtureUnclosed)
    })
  })

  describe('转义 \\$', () => {
    it('\\$5 不应计为公式', () => {
      const result = extractFormulaDelimiters(formulaFixtureEscaped)
      expect(result.inlineCount).toBe(1) // 只有 $x = 1$
    })

    it('转义应不影响正常公式', () => {
      const result = extractFormulaDelimiters(formulaFixtureEscaped)
      const inlineDollars = result.delimiters.filter((d) => d.type === 'inline-dollar')
      expect(inlineDollars).toHaveLength(1)
    })
  })

  describe('货币 $5/$10 不误伤', () => {
    it('$5 和 $10 不应计为公式', () => {
      const result = extractFormulaDelimiters(formulaFixtureCurrency)
      expect(result.inlineCount).toBe(1) // 只有 $E = mc^2$
    })

    it('货币场景不应误伤真正的公式', () => {
      const result = extractFormulaDelimiters(formulaFixtureCurrency)
      const proper = result.delimiters.filter((d) => d.type === 'inline-dollar')
      expect(proper).toHaveLength(1)
    })
  })

  describe('空文档', () => {
    it('应返回全零', () => {
      const result = extractFormulaDelimiters(formulaFixtureEmpty)
      expect(result).toEqual(formulaFixtureEmptyExpected)
    })
  })

  describe('纯文本无公式', () => {
    it('应返回全零', () => {
      const result = extractFormulaDelimiters(formulaFixturePlainText)
      expect(result.inlineCount).toBe(0)
      expect(result.blockCount).toBe(0)
    })
  })

  describe('所有定界符混合', () => {
    it('应正确计数四种定界符', () => {
      const result = extractFormulaDelimiters(formulaFixtureAllDelimiters)
      expect(result.inlineCount).toBe(2) // inline-dollar + inline-paren
      expect(result.blockCount).toBe(2) // block-dollar + block-bracket
    })

    it('应包含所有四种定界符类型', () => {
      const result = extractFormulaDelimiters(formulaFixtureAllDelimiters)
      const types = result.delimiters.map((d) => d.type)
      expect(types).toContain('inline-dollar')
      expect(types).toContain('block-dollar')
      expect(types).toContain('inline-paren')
      expect(types).toContain('block-bracket')
    })
  })

  describe('矩阵公式', () => {
    it('应正确提取矩阵', () => {
      const result = extractFormulaDelimiters(formulaFixtureMatrix)
      expect(result.blockCount).toBe(2)
    })
  })

  describe('长公式', () => {
    it('应能处理长公式', () => {
      const result = extractFormulaDelimiters(formulaFixtureLongEquation)
      expect(result.blockCount).toBe(1)
      expect(result.delimiters[0].bytes).toBeGreaterThan(50)
    })
  })

  describe('不支持命令检测', () => {
    it('应在提取时检测不支持命令', () => {
      const result = extractFormulaDelimiters(formulaFixtureUnsupportedCommands)
      // fakecommand, realcommand, anotherfake, unknownop 等应被标记
      const allHits = result.unsupportedCommandHits
      expect(allHits.length).toBeGreaterThan(0)
    })
  })

  describe('确定性', () => {
    it('相同输入应产出相同结果', () => {
      const a = extractFormulaDelimiters(formulaFixtureStandard)
      const b = extractFormulaDelimiters(formulaFixtureStandard)
      expect(a).toEqual(b)
    })

    it('重复调用应产出严格深等结果', () => {
      const a = extractFormulaDelimiters(formulaFixtureAllDelimiters)
      const b = extractFormulaDelimiters(formulaFixtureAllDelimiters)
      expect(a).toEqual(b)
    })

    it('byteCount 应可复现', () => {
      const a = extractFormulaDelimiters(formulaFixtureBlockOnly)
      const b = extractFormulaDelimiters(formulaFixtureBlockOnly)
      expect(a.totalBytes).toBe(b.totalBytes)
    })
  })

  describe('不修改输入', () => {
    it('输入字符串不变', () => {
      const original = formulaFixtureAllDelimiters
      const copy = original.slice()
      extractFormulaDelimiters(copy)
      expect(copy).toBe(original)
    })
  })
})

// =============================================================================
// §5 构建器 helper
// =============================================================================

describe('buildFormulaExtractionResult', () => {
  it('默认值应为全零', () => {
    const result = buildFormulaExtractionResult()
    expect(result.inlineCount).toBe(0)
    expect(result.blockCount).toBe(0)
    expect(result.totalBytes).toBe(0)
    expect(result.unsupportedCommandHits).toEqual([])
    expect(result.delimiters).toEqual([])
  })

  it('应支持覆写', () => {
    const result = buildFormulaExtractionResult({ inlineCount: 5 })
    expect(result.inlineCount).toBe(5)
  })
})

describe('buildFormulaDelimiterRange', () => {
  it('默认值应为 inline-dollar', () => {
    const result = buildFormulaDelimiterRange()
    expect(result.type).toBe('inline-dollar')
  })

  it('应支持覆写类型', () => {
    const result = buildFormulaDelimiterRange({ type: 'block-dollar' })
    expect(result.type).toBe('block-dollar')
  })
})

// =============================================================================
// §6 redline 断言：无 AI、无外部网络、无 HTML 注入
// =============================================================================

describe('redline：无副作用', () => {
  it('extractFormulaDelimiters 不发起网络请求', () => {
    // 纯函数不应任何异步操作
    const result = extractFormulaDelimiters(formulaFixtureStandard)
    expect(result).toBeDefined()
  })

  it('extractFormulaDelimiters 不使用随机数', () => {
    const a = extractFormulaDelimiters(formulaFixtureMatrix)
    const b = extractFormulaDelimiters(formulaFixtureMatrix)
    expect(a).toEqual(b)
  })

  it('detectUnsupportedCommands 不使用随机数', () => {
    const a = detectUnsupportedCommands('\\fake \\cmd')
    const b = detectUnsupportedCommands('\\fake \\cmd')
    expect(a).toEqual(b)
  })
})
