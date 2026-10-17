import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AiColleagueTrigger } from '@/components/next/layout/AiSummonPlaceholder'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'

// 全局 fetch 占位为 spy：触发器任何交互都不得发起网络请求（RL-01 零请求断言）。
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useNextAiColleagueStore.setState({ isOpen: false, messages: [], executionState: 'idle' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useNextAiColleagueStore.setState({ isOpen: false, messages: [], executionState: 'idle' })
})

describe('components/next/layout/AiSummonPlaceholder → AiColleagueTrigger（v3-ui-next-ai-colleague W4）', () => {
  test('渲染正式唤起按钮：data-ai-colleague-trigger、aria-haspopup="dialog"、aria-expanded 与 Ctrl+/ 提示', () => {
    render(<AiColleagueTrigger />)

    const trigger = screen.getByRole('button', { name: /AI 唤起/ })
    expect(trigger).toHaveAttribute('data-ai-colleague-trigger', '')
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // jsdom 非 Mac → Ctrl+/ 提示
    expect(screen.getByText('Ctrl+/')).toBeInTheDocument()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  test('点击切换 Store 开关状态并动态同步 aria-expanded，全程零网络请求', () => {
    render(<AiColleagueTrigger />)
    const trigger = screen.getByRole('button', { name: /AI 唤起/ })

    fireEvent.click(trigger)
    expect(useNextAiColleagueStore.getState().isOpen).toBe(true)
    // 面板打开时触发按钮被 Radix aria-hidden —— 直接读 DOM 属性断言动态绑定
    expect(document.querySelector('[data-ai-colleague-trigger]')).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    fireEvent.click(document.querySelector('[data-ai-colleague-trigger]') as HTMLElement)
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)
    expect(document.querySelector('[data-ai-colleague-trigger]')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  test('旧轨页面不响应新轨快捷键：未挂载 useNextShortcuts 时 Ctrl+/ 不触发开关', () => {
    render(<AiColleagueTrigger />)

    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)

    // 由宿主挂载 useNextShortcuts 后 Ctrl+/ 正常流转（顶栏装配路径的快捷键回归由
    // next-topbar-colleague.test.tsx 覆盖），此处仅验证旧轨零响应边界。
  })
})
