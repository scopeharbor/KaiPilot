// v3-document-formula-support —— 公式提取与渲染测试夹具（前后端共享）。
// 覆盖：行内/块级各定界符、未闭合/转义/货币/不支持命令/空文档/$5 不误伤等场景。

import type { FormulaDelimiterRange, FormulaExtractionResult } from './document-formula-support.js'

// ---------------------------------------------------------------------------
// Fixture: 标准公式文档
// ---------------------------------------------------------------------------

export const formulaFixtureStandard = `# 数学公式测试

## 行内公式

勾股定理 $a^2 + b^2 = c^2$ 是基础几何定理。

圆的面积公式 \\(A = \\pi r^2\\) 也常用。

## 块级公式

$$
\\sum_{i=1}^{n} x_i = \\frac{n(n+1)}{2}
$$

另一个行内公式 $\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$。

## 块级括号定界

\\[
\\mathbf{X} = \\begin{pmatrix}
x_{11} & x_{12} \\\\
x_{21} & x_{22}
\\end{pmatrix}
\\]

## 货币不误伤

价格是 $5 和 $10，不含税。
`

export const formulaFixtureStandardExpected: FormulaExtractionResult = {
  inlineCount: 3,
  blockCount: 2,
  totalBytes: 117,
  unsupportedCommandHits: [],
  delimiters: [],
}

// ---------------------------------------------------------------------------
// Fixture: 仅行内公式
// ---------------------------------------------------------------------------

export const formulaFixtureInlineOnly = `动能公式：$E_k = \\frac{1}{2}mv^2$

质能方程：\\(E = mc^2\\)

简单算术：$x + y = z$
`

export const formulaFixtureInlineOnlyExpected: FormulaExtractionResult = {
  inlineCount: 3,
  blockCount: 0,
  totalBytes: 47,
  unsupportedCommandHits: [],
  delimiters: [],
}

// ---------------------------------------------------------------------------
// Fixture: 仅块级公式
// ---------------------------------------------------------------------------

export const formulaFixtureBlockOnly = `# 公式集

$$
f(x) = \\int_{-\\infty}^{\\infty} \\hat{f}(\\xi) e^{2\\pi i \\xi x} d\\xi
$$

$$
\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\epsilon_0}
$$
`

export const formulaFixtureBlockOnlyExpected: FormulaExtractionResult = {
  inlineCount: 0,
  blockCount: 2,
  totalBytes: 103,
  unsupportedCommandHits: [],
  delimiters: [],
}

// ---------------------------------------------------------------------------
// Fixture: 未闭合定界符（不吞字）
// ---------------------------------------------------------------------------

export const formulaFixtureUnclosed = `这段话有一个未闭合的 $a + b 公式。

$$
这是一个未闭合的块级公式
好像忘了闭合。
`

export const formulaFixtureUnclosedExpected: FormulaExtractionResult = {
  inlineCount: 0, // 未闭合不计
  blockCount: 0, // 未闭合不计
  totalBytes: 0,
  unsupportedCommandHits: [],
  delimiters: [],
}

// ---------------------------------------------------------------------------
// Fixture: 转义 $ 符号
// ---------------------------------------------------------------------------

export const formulaFixtureEscaped = `价格是 \\$5 和 \\$10。

公式 $x = 1$ 是有效的。

转义符号 \\$ 不计为公式定界。
`

export const formulaFixtureEscapedExpected: FormulaExtractionResult = {
  inlineCount: 1, // 只有 $x = 1$
  blockCount: 0,
  totalBytes: 5,
  unsupportedCommandHits: [],
  delimiters: [],
}

// ---------------------------------------------------------------------------
// Fixture: 货币不误伤（$5/$10）
// ---------------------------------------------------------------------------

export const formulaFixtureCurrency = `价格是 $5 元，折扣后 $10 元。

这里有一个真正的行内公式 $E = mc^2$。

总计 $15 元。
`

export const formulaFixtureCurrencyExpected: FormulaExtractionResult = {
  inlineCount: 1, // 只有 $E = mc^2$
  blockCount: 0,
  totalBytes: 8,
  unsupportedCommandHits: [],
  delimiters: [],
}

// ---------------------------------------------------------------------------
// Fixture: 不支持的命令（降级检测）
// ---------------------------------------------------------------------------

export const formulaFixtureUnsupportedCommands = `$$
\\fakecommand{a}{b}
$$

$$
\\realcommand{x} = \\anotherfake{y}
$$

$\\unknownop z$
`

// 期望：提取到不支持的 fakecommand/anotherfake/unknownop 等

// ---------------------------------------------------------------------------
// Fixture: 空文档
// ---------------------------------------------------------------------------

export const formulaFixtureEmpty = ''

export const formulaFixtureEmptyExpected: FormulaExtractionResult = {
  inlineCount: 0,
  blockCount: 0,
  totalBytes: 0,
  unsupportedCommandHits: [],
  delimiters: [],
}

// ---------------------------------------------------------------------------
// Fixture: 纯文本无公式
// ---------------------------------------------------------------------------

export const formulaFixturePlainText = `# 项目需求

这是一段纯文本，不包含任何公式。

- 列表项一
- 列表项二
`

export const formulaFixturePlainTextExpected: FormulaExtractionResult = {
  inlineCount: 0,
  blockCount: 0,
  totalBytes: 0,
  unsupportedCommandHits: [],
  delimiters: [],
}

// ---------------------------------------------------------------------------
// Fixture: 多行公式 + 矩阵
// ---------------------------------------------------------------------------

export const formulaFixtureMatrix = `$$
\\begin{pmatrix}
a & b \\\\
c & d
\\end{pmatrix}
$$

$$
\\begin{bmatrix}
1 & 0 & 0 \\\\
0 & 1 & 0 \\\\
0 & 0 & 1
\\end{bmatrix}
$$
`

// ---------------------------------------------------------------------------
// Fixture: 混合所有定界符
// ---------------------------------------------------------------------------

export const formulaFixtureAllDelimiters = `行内 dollar: $f(x) = x^2$

块级 dollar:
$$
g(x) = \\sum_{n=0}^\\infty a_n x^n
$$

行内 paren: \\(\\lim_{x \\to 0}\\frac{\\sin x}{x} = 1\\)

块级 bracket:
\\[
\\det(A) = \\prod_{i=1}^n \\lambda_i
\\]
`

export const formulaFixtureAllDelimitersExpected: FormulaExtractionResult = {
  inlineCount: 2, // $f(x)$ + \( \lim... \)
  blockCount: 2, // $$g(x)$$ + \[ \det(A) \]
  totalBytes: 88,
  unsupportedCommandHits: [],
  delimiters: [],
}

// ---------------------------------------------------------------------------
// Fixture: 长公式（横向滚动场景）
// ---------------------------------------------------------------------------

export const formulaFixtureLongEquation = `$$
\\mathcal{L}(\\theta) = -\\frac{1}{N} \\sum_{i=1}^{N} \\sum_{j=1}^{K} y_{ij} \\log(\\hat{y}_{ij}) + \\lambda_1 \\sum_{k=1}^{M} |\\theta_k| + \\lambda_2 \\sum_{k=1}^{M} \\theta_k^2 + \\alpha \\cdot \\text{KL}(q(\\theta) \\| p(\\theta))
$$
`

// ---------------------------------------------------------------------------
// 构建器 helper
// ---------------------------------------------------------------------------

export function buildFormulaExtractionResult(
  overrides: Partial<FormulaExtractionResult> = {},
): FormulaExtractionResult {
  return {
    inlineCount: 0,
    blockCount: 0,
    totalBytes: 0,
    unsupportedCommandHits: [],
    delimiters: [],
    ...overrides,
  }
}

export function buildFormulaDelimiterRange(
  overrides: Partial<FormulaDelimiterRange> = {},
): FormulaDelimiterRange {
  return {
    type: 'inline-dollar',
    start: 0,
    end: 10,
    bytes: 10,
    ...overrides,
  }
}
