import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TextVariantSwitcher } from '@/components/locale/text-variant-switcher'
import { getVariant, setVariant } from '@/lib/locale/variant-store'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.textVariant
})

/**
 * 打开下拉：jsdom 无 PointerEvent，React 18 不注册 pointer 事件监听，
 * fireEvent.pointerDown 到不了 Radix 的 onPointerDown；走键盘交互
 * （ArrowDown → onOpenChange(true)）与浏览器真实键盘一致。
 */
function openMenu(): void {
  fireEvent.keyDown(screen.getByRole('button', { name: '切换界面文字' }), { key: 'ArrowDown' })
}

describe('TextVariantSwitcher 文本变体切换按钮', () => {
  it('点开下拉渲染三个变体选项', () => {
    render(<TextVariantSwitcher />)
    openMenu()
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('简体中文')).toBeInTheDocument()
    expect(within(menu).getByText('台灣繁體')).toBeInTheDocument()
    expect(within(menu).getByText('香港繁體')).toBeInTheDocument()
  })

  it('三个选项 label 都带 data-no-cc：语言自指名不被 cc 转换', () => {
    render(<TextVariantSwitcher />)
    openMenu()
    for (const label of ['简体中文', '台灣繁體', '香港繁體']) {
      expect(screen.getByText(label)).toHaveAttribute('data-no-cc')
    }
  })

  it('点击选项调用 setVariant 并被 store 反映（tw→cn 皆可）', () => {
    render(<TextVariantSwitcher />)

    openMenu()
    act(() => {
      fireEvent.click(screen.getByText('台灣繁體'))
    })
    expect(getVariant()).toBe('tw')

    // 重新打开：当前变体带勾选标记
    openMenu()
    const twItem = screen.getByRole('menuitem', { name: '台灣繁體' })
    expect(within(twItem).getByTestId('text-variant-switcher-active')).toBeInTheDocument()
    expect(
      within(screen.getByRole('menuitem', { name: '简体中文' })).queryByTestId(
        'text-variant-switcher-active',
      ),
    ).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByText('简体中文'))
    })
    expect(getVariant()).toBe('cn')
  })

  it('外部 setVariant 切换时勾选状态同步（useSyncExternalStore 订阅）', () => {
    render(<TextVariantSwitcher />)
    act(() => setVariant('hk'))
    openMenu()
    expect(
      within(screen.getByRole('menuitem', { name: '香港繁體' })).getByTestId(
        'text-variant-switcher-active',
      ),
    ).toBeInTheDocument()
  })
})
