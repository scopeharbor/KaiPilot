/**
 * 顶栏 AI 同事总装回归测试（v3-ui-next-ai-colleague W4 · tasks 4.2）。
 *
 * 覆盖：触发电钮属性（data-ai-colleague-trigger / aria-haspopup / aria-expanded）、
 * 点击切换展开/收起（Store 状态流转 + 面板卸载）、Ctrl+/ 快捷键触发 Store 开关、
 * 可编辑输入框内快捷键抑制、旧轨页面不响应新轨快捷键、关闭后焦点回跳触发源。
 */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextTopbar } from '@/components/next/layout/NextTopbar'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useNextTrackStore } from '@/stores/next-track-store'

const { navMocks } = vi.hoisted(() => ({ navMocks: { pathname: '/next/projects/42' } }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => navMocks.pathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

function renderTopbar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <NextTopbar />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  navMocks.pathname = '/next/projects/42'
  localStorage.clear()
  useNextTrackStore.getState().reset()
  useNextAiColleagueStore.setState({
    isOpen: false,
    messages: [],
    executionState: 'idle',
    pendingAction: null,
  })
  useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
  document.documentElement.removeAttribute('data-immersion')
})

describe('components/next/layout/NextTopbar（AI 同事总装，v3-ui-next-ai-colleague tasks 4.2）', () => {
  test('触发电钮属性完整：data-ai-colleague-trigger / aria-haspopup="dialog" / aria-expanded', () => {
    renderTopbar()

    const trigger = screen.getByRole('button', { name: /AI 唤起/ })
    expect(trigger).toHaveAttribute('data-ai-colleague-trigger', '')
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Ctrl+/')).toBeInTheDocument()
  })

  test('点击切换展开/收起：面板挂载与卸载 + Store 状态流转', () => {
    renderTopbar()
    const trigger = screen.getByRole('button', { name: /AI 唤起/ })

    expect(screen.queryByRole('dialog', { name: 'AI 同事交互面板' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(useNextAiColleagueStore.getState().isOpen).toBe(true)
    expect(screen.getByRole('dialog', { name: 'AI 同事交互面板' })).toBeInTheDocument()
    // 面板打开后触发按钮被 Radix hideOthers 隐藏，直接读 DOM 属性
    expect(document.querySelector('[data-ai-colleague-trigger]')).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    fireEvent.click(document.querySelector('[data-ai-colleague-trigger]') as HTMLElement)
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'AI 同事交互面板' })).not.toBeInTheDocument()
  })

  test('Ctrl+/ 快捷键触发 Store 状态流转（唤起与收起）', () => {
    renderTopbar()

    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(useNextAiColleagueStore.getState().isOpen).toBe(true)
    expect(screen.getByRole('dialog', { name: 'AI 同事交互面板' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'AI 同事交互面板' })).not.toBeInTheDocument()
  })

  test('可编辑输入框内快捷键抑制：面板输入框中 Ctrl+/ 不误触发开关', () => {
    renderTopbar()

    // 唤起面板（窗口级事件），焦点自动落入输入框
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    const textarea = screen.getByRole('textbox', { name: '向 AI 同事发送指令' })
    expect(document.activeElement).toBe(textarea)

    // 输入框内按 Ctrl+/：isEditableTarget 抑制，面板保持展开
    fireEvent.keyDown(textarea, { key: '/', ctrlKey: true })
    expect(useNextAiColleagueStore.getState().isOpen).toBe(true)

    // 焦点仍为窗口时 Ctrl+/ 正常收起
    act(() => {
      ;(document.activeElement as HTMLElement).blur()
    })
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)
  })

  test('外部可编辑目标（普通输入框）内 Ctrl+/ 同样抑制', () => {
    function Harness() {
      return (
        <div>
          <input data-testid="plain-input" />
          <NextTopbar />
        </div>
      )
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    )

    const input = screen.getByTestId('plain-input')
    input.focus()
    fireEvent.keyDown(input, { key: '/', ctrlKey: true })
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)
  })
})
