/**
 * AI 写的内容跟随简繁切换：
 * - <pre data-cc>（AI 实时输出）照常转换，普通 <pre> / 代码仍不动；
 * - 程序化转换 display（简 → 繁，含词汇覆写）与 canonical（繁 → 简）；
 * - VariantTextarea / VariantInput：繁体界面显示繁体，用户改了以后交回简体；
 * - AI 画的 SVG 图：图里的中文按当前变体显示。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createDomConverter, type DomConverter } from '@/lib/locale/dom-converter'
import { loadTextConverters } from '@/lib/locale/text-convert'
import { setVariant } from '@/lib/locale/variant-store'
import { VariantInput, VariantTextarea } from '@/components/locale/variant-field'
import { AiDiagramBlock } from '@/components/next/ai/AiDiagramBlock'

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let active: DomConverter[] = []

beforeEach(() => {
  active = []
  document.body.innerHTML = ''
})

afterEach(() => {
  for (const converter of active) {
    converter.stop()
    converter.restore()
  }
  setVariant('cn')
})

describe('运行时 DOM 层：AI 实时输出用 <pre data-cc>', () => {
  it('带 data-cc 的 <pre> 转换（含流式追加），普通 <pre> 与代码不动', async () => {
    document.body.innerHTML =
      '<pre id="ai" data-cc>需求分析与设计</pre><pre id="code">软件开发</pre><code id="c">软件开发</code>'
    const converter = createDomConverter('tw')
    active.push(converter)
    await converter.start()
    await flush()
    expect(document.getElementById('ai')!.textContent).toBe('需求分析與設計')
    expect(document.getElementById('code')!.textContent).toBe('软件开发')
    expect(document.getElementById('c')!.textContent).toBe('软件开发')

    // 流式输出：文本节点内容追加
    document.getElementById('ai')!.firstChild!.nodeValue = '项目进度报告'
    await flush()
    expect(document.getElementById('ai')!.textContent).toBe('專案進度報告')
  })
})

describe('程序化转换', () => {
  it('display：简 → 台繁 / 港繁；canonical：繁 → 简', async () => {
    const converters = await loadTextConverters()
    expect(converters.display('tw', '软件开发与测试')).toBe('軟體開發與測試')
    expect(converters.display('hk', '软件开发')).toBe('軟件開發')
    expect(converters.canonical('tw', '軟體開發與測試')).toBe('软件开发与测试')
    expect(converters.display('tw', '')).toBe('')
  })
})

describe('AI 写的可编辑栏位', () => {
  it('繁体界面显示繁体；改了以后交回简体；简体界面原样', async () => {
    await loadTextConverters()
    setVariant('tw')
    const onValueChange = vi.fn()
    const { rerender } = render(
      <VariantTextarea aria-label="问题" value="需求分析与设计" onValueChange={onValueChange} />,
    )
    const field = screen.getByLabelText('问题') as HTMLTextAreaElement
    await waitFor(() => expect(field.value).toBe('需求分析與設計'))

    fireEvent.change(field, { target: { value: '需求分析與設計（含報表）' } })
    expect(onValueChange).toHaveBeenLastCalledWith('需求分析与设计（含报表）')
    // 正在输入：保留用户打的原样，不在光标下改字
    rerender(
      <VariantTextarea
        aria-label="问题"
        value="需求分析与设计（含报表）"
        onValueChange={onValueChange}
      />,
    )
    expect(field.value).toBe('需求分析與設計（含報表）')

    setVariant('cn')
    fireEvent.blur(field)
    await waitFor(() => expect(field.value).toBe('需求分析与设计（含报表）'))
  })

  it('外部重新填值（例如 AI 重新生成）时按新值显示', async () => {
    await loadTextConverters()
    setVariant('tw')
    const { rerender } = render(
      <VariantInput aria-label="名称" value="开发接口" onValueChange={() => undefined} />,
    )
    const field = screen.getByLabelText('名称') as HTMLInputElement
    fireEvent.change(field, { target: { value: '開發介面x' } })
    rerender(<VariantInput aria-label="名称" value="编写测试" onValueChange={() => undefined} />)
    await waitFor(() => expect(field.value).toBe('編寫測試'))
  })
})

describe('AI 画的图', () => {
  it('SVG 里的中文按当前变体显示', async () => {
    await loadTextConverters()
    setVariant('tw')
    const { container } = render(
      <AiDiagramBlock
        language="svg"
        code={'<svg viewBox="0 0 10 10"><text>需求设计</text></svg>'}
        streaming={false}
      />,
    )
    await waitFor(() => {
      const img = container.querySelector('[data-ai-diagram="svg"] img')
      expect(decodeURIComponent(img!.getAttribute('src')!)).toContain('需求設計')
    })
  })
})
