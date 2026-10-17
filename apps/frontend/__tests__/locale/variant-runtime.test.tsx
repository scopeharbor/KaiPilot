import { StrictMode } from 'react'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import VariantRuntime from '@/components/locale/variant-runtime'
import { setVariant } from '@/lib/locale/variant-store'

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 预热 opencc 动态导入：dom-converter 的 loadOpenCC 是模块级缓存的 promise，
 * 测试先 import 一次（约几百 ms 解析大词典），之后 start() 内加载立即完成，
 * 使转换时序确定性化（初始扫描只需下一次 setTimeout 宏任务）。
 */
async function prewarmOpenCC(): Promise<void> {
  await import('opencc-js')
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.textVariant
  document.body.innerHTML = ''
})

describe('VariantRuntime', () => {
  it('cn→tw→cn 切换：tw 启动 DOM 转换，cn 停止并还原', async () => {
    document.body.innerHTML = '<div id="t">软件开发</div>'
    const { unmount } = render(<VariantRuntime />)
    await flush()
    expect(document.querySelector('#t')!.textContent).toBe('软件开发') // 初始 cn：不转换

    await prewarmOpenCC()
    act(() => setVariant('tw'))
    await flush()
    await flush()
    expect(document.querySelector('#t')!.textContent).toBe('軟體開發')

    act(() => setVariant('cn'))
    await flush()
    expect(document.querySelector('#t')!.textContent).toBe('软件开发') // cn：stop + restore

    unmount()
  })

  it('StrictMode 双 effect 不泄漏：卸载后观察器断开、不再响应 DOM 写入', async () => {
    document.body.innerHTML = '<div id="t">软件开发</div>'
    const { unmount } = render(
      <StrictMode>
        <VariantRuntime />
      </StrictMode>,
    )
    await prewarmOpenCC()
    act(() => setVariant('tw'))
    await flush()
    await flush()
    expect(document.querySelector('#t')!.textContent).toBe('軟體開發')

    unmount()
    await flush()
    expect(document.querySelector('#t')!.textContent).toBe('软件开发') // 卸载时 restore 还原

    // 若任一旧 converter 的观察器泄漏未断开，外部写入会被再次转换
    const node = document.querySelector('#t')!.firstChild as Text
    node.nodeValue = '软件开发'
    await flush()
    expect(node.nodeValue).toBe('软件开发')
  })

  it('tw→hk 直接切换：旧 converter 被清理，新变体重新启动', async () => {
    document.body.innerHTML = '<div id="t">软件开发</div>'
    const { unmount } = render(<VariantRuntime />)
    await prewarmOpenCC()
    act(() => setVariant('tw'))
    await flush()
    await flush()
    expect(document.querySelector('#t')!.textContent).toBe('軟體開發')

    act(() => setVariant('hk'))
    await flush()
    await flush()
    expect(document.querySelector('#t')!.textContent).toBe('軟件開發') // hk 词表（软體→軟件）

    unmount()
    await flush()
    expect(document.querySelector('#t')!.textContent).toBe('软件开发')
  })
})
