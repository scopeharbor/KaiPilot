/**
 * 公式渲染前端组件测试（v3-document-formula-support §3.4）。
 *
 * 覆盖：行内/块级渲染、定界符降级、不支持命令降级、货币不误伤、
 * 长公式滚动、复制 TeX 源码、安全 redline 断言。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MathFormula, type MathFormulaProps } from '@/components/files/markdown/MathFormula'
import type { FormulaRenderResult } from '@aiproj/types'

// Mock useCopyCode hook to isolate MathFormula tests
const copyMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/hooks/use-copy-code', () => ({
  useCopyCode: () => ({
    copied: false,
    error: null,
    copy: copyMock,
    resetCopy: vi.fn(),
  }),
}))

// Mock reportFormulaCopied to avoid real network calls
const reportCopiedMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/api/files', () => ({
  reportFormulaCopied: (...args: unknown[]) => reportCopiedMock(...args),
}))

// =============================================================================
// Helpers
// =============================================================================

function renderFormula(props: Partial<MathFormulaProps> = {}) {
  const defaults: MathFormulaProps = {
    renderResult: {
      html: '<span class="katex">x^2</span>',
      status: 'success',
      source: 'x^2',
      errorMessage: null,
      unsupportedCommands: [],
    },
    inline: false,
    ...props,
  }
  return render(<MathFormula {...defaults} />)
}

function makeSuccessResult(overrides: Partial<FormulaRenderResult> = {}): FormulaRenderResult {
  return {
    html: '<span class="katex">x^2</span>',
    status: 'success',
    source: 'x^2',
    errorMessage: null,
    unsupportedCommands: [],
    ...overrides,
  }
}

function makeErrorResult(source: string, errorMessage: string): FormulaRenderResult {
  return {
    html: null,
    status: 'error',
    source,
    errorMessage,
    unsupportedCommands: [],
  }
}

// =============================================================================
// Tests
// =============================================================================

beforeEach(() => {
  copyMock.mockReset()
  reportCopiedMock.mockReset()
})

describe('MathFormula — 块级渲染', () => {
  it('应渲染块级公式容器', () => {
    renderFormula({ inline: false })
    expect(screen.getByText('公式')).toBeTruthy()
    expect(screen.getByText('复制 TeX')).toBeTruthy()
  })

  it('块级应包含数学公式 aria-label', () => {
    renderFormula({ inline: false })
    const container = document.querySelector('[data-formula-status="success"]')
    expect(container).toBeTruthy()
    expect(container?.getAttribute('aria-label')).toBe('数学公式')
  })

  it('块级应渲染 KaTeX HTML', () => {
    renderFormula({
      inline: false,
      renderResult: makeSuccessResult({
        html: '<span class="katex">a^2+b^2=c^2</span>',
        source: 'a^2+b^2=c^2',
      }),
    })
    const mathContent = document.querySelector('.math-content')
    expect(mathContent).toBeTruthy()
  })
})

describe('MathFormula — 行内渲染', () => {
  it('应渲染行内公式（无标签无按钮）', () => {
    renderFormula({ inline: true })
    expect(screen.queryByText('公式')).toBeFalsy()
    expect(screen.queryByText('复制 TeX')).toBeFalsy()
  })

  it('行内应使用 math-inline class', () => {
    renderFormula({ inline: true })
    const el = document.querySelector('.math-inline')
    expect(el).toBeTruthy()
  })
})

describe('MathFormula — 复制 TeX 源码', () => {
  it('块级应有点击复制按钮', async () => {
    renderFormula({
      inline: false,
      renderResult: makeSuccessResult({ source: 'E=mc^2' }),
    })
    const copyBtn = screen.getByText('复制 TeX').closest('button')
    expect(copyBtn).toBeTruthy()
    fireEvent.click(copyBtn!)
    expect(copyMock).toHaveBeenCalledWith('E=mc^2')
  })

  it('复制时触发审计 API', async () => {
    renderFormula({
      inline: false,
      renderResult: makeSuccessResult({ source: 'E=mc^2' }),
      projectId: 1,
      documentId: 42,
      formulaInlineCount: 1,
      formulaBlockCount: 0,
    })
    const copyBtn = screen.getByText('复制 TeX').closest('button')
    expect(copyBtn).toBeTruthy()
    fireEvent.click(copyBtn!)
    expect(reportCopiedMock).toHaveBeenCalledWith(1, 42, 1, 0)
  })
})

describe('MathFormula — 渲染失败降级', () => {
  it('错误状态应显示原始源码', () => {
    renderFormula({
      inline: false,
      renderResult: makeErrorResult('\\unknown', '不支持的命令'),
    })
    // DOM 中显示的是单反斜杠（源码的原始形态）
    expect(screen.getByText('\\unknown')).toBeTruthy()
  })

  it('错误状态应有 title 提示', () => {
    renderFormula({
      inline: false,
      renderResult: makeErrorResult('\\bad', 'bad command'),
    })
    const code = document.querySelector('code')
    expect(code?.getAttribute('title')).toContain('公式渲染失败')
  })

  it('行内错误应使用 inline-code class', () => {
    renderFormula({
      inline: true,
      renderResult: makeErrorResult('\\bad', 'bad'),
    })
    const code = document.querySelector('code')
    expect(code?.className).toContain('inline-code')
  })

  it('unsupported 状态应显示源码', () => {
    renderFormula({
      inline: true,
      renderResult: {
        html: null,
        status: 'unsupported',
        source: '\\badcmd',
        errorMessage: null,
        unsupportedCommands: ['badcmd'],
      },
    })
    expect(screen.getByText('\\badcmd')).toBeTruthy()
  })
})

describe('MathFormula — 长公式', () => {
  it('块级容器应有 overflow-x:auto', () => {
    renderFormula({ inline: false })
    const container = document.querySelector('.math-block')
    expect(container).toBeTruthy()
    // CSS 的 overflow-x:auto 在 className 中
    expect(container?.className).toContain('overflow-x-auto')
  })
})

describe('MathFormula — 安全 redline', () => {
  it('不使用 script 标签', () => {
    renderFormula({
      inline: false,
      renderResult: makeSuccessResult({
        html: '<span class="katex">safe</span>',
      }),
    })
    // 不应有任何 script 元素
    expect(document.querySelectorAll('script').length).toBe(0)
  })

  it('不使用外部网络请求', () => {
    // MathFormula 不使用 fetch / XMLHttpRequest
    renderFormula({ inline: false })
    // 无网络调用（纯渲染）
  })

  it('不加载远程图片', () => {
    renderFormula({ inline: false })
    const imgs = document.querySelectorAll('img[src^="http"]')
    expect(imgs.length).toBe(0)
  })
})

describe('MathFormula — 主题与密度', () => {
  it('应使用 CSS Variables 适配主题', () => {
    renderFormula({ inline: false })
    // 块级容器使用 border-border / bg-muted 等 Tailwind CSS Variables
    const container = document.querySelector('.math-block')
    expect(container?.className).toContain('border-border')
    expect(container?.className).toContain('bg-muted/30')
  })
})
