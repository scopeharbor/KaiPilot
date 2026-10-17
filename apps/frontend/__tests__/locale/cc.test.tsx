import { act, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import CC from '@/components/locale/cc'
import { createDomConverter } from '@/lib/locale/dom-converter'
import { setVariant } from '@/lib/locale/variant-store'

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.textVariant
})

describe('CC 文本变体组件', () => {
  it('默认（未设置）渲染简体原文 s', () => {
    const { container } = render(<CC s="简体原文" tw="台灣繁體" hk="香港繁體" />)
    expect(container.textContent).toBe('简体原文')
  })

  it('setVariant(tw) 后渲染 tw，setVariant(hk) 后渲染 hk', () => {
    const { container } = render(<CC s="简体原文" tw="台灣繁體" hk="香港繁體" />)
    act(() => setVariant('tw'))
    expect(container.textContent).toBe('台灣繁體')
    act(() => setVariant('hk'))
    expect(container.textContent).toBe('香港繁體')
    act(() => setVariant('cn'))
    expect(container.textContent).toBe('简体原文')
  })

  it('renderToString（server snapshot）恒为简体 s，与 client 快照零 mismatch', () => {
    setVariant('tw')
    const html = renderToString(<CC s="简体原文" tw="台灣繁體" hk="香港繁體" />)
    expect(html).toBe('简体原文')
  })

  it('多个 CC 实例同步响应变体切换', () => {
    const first = render(<CC s="保存" tw="儲存" hk="儲存" />)
    const second = render(<CC s="取消" tw="取消" hk="取消" />)
    act(() => setVariant('tw'))
    expect(first.container.textContent).toBe('儲存')
    expect(second.container.textContent).toBe('取消')
  })

  it('不同文案的 tw/hk 各自生效', () => {
    const { container } = render(<CC s="双击打开" tw="連按兩下開啟" hk="雙擊開啟" />)
    act(() => setVariant('tw'))
    expect(container.textContent).toBe('連按兩下開啟')
    act(() => setVariant('hk'))
    expect(container.textContent).toBe('雙擊開啟')
  })

  it('CC 渲染 tw 产物即注册可信输出：同值节点不被 DOM 转换层二次转换（M1）', async () => {
    const { container } = render(<CC s="仪表盘" tw="儀表板" hk="儀表板" />)
    act(() => setVariant('tw'))
    expect(container.textContent).toBe('儀表板')

    // 页面其他位置出现同值节点（同一文案复用 / loader 产物），DOM 转换层不得腐蚀它
    const victim = document.createElement('div')
    victim.textContent = '儀表板'
    document.body.appendChild(victim)
    const converter = createDomConverter('tw')
    await converter.start()
    await flush()
    // 初始扫描：已注册 → 跳过（twp('儀表板')='儀錶板'，若二次转换会腐蚀）
    expect(victim.textContent).toBe('儀表板')

    const node = victim.firstChild as Text
    node.nodeValue = '儀表板' // observer 期间 React 重写同值
    await flush()
    expect(node.nodeValue).toBe('儀表板')

    converter.stop()
    converter.restore()
    expect(victim.textContent).toBe('儀表板')
  })
})
