/**
 * v3-ui-next-shell-space-map tasks 2.5/2.6/2.7 —— 空间地图 Overlay 综合测试。
 *
 * 覆盖：打开/关闭生命周期、快捷键呼出（受控态模拟 W4 装配）、搜索即时过滤、
 * 点击可用坐标无刷新路由跳转、占位坐标禁止交互、无结果空状态、焦点管理。
 */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}))

beforeEach(() => {
  pushMock.mockReset()
})

function renderOverlay(initialOpen = false) {
  const onOpenChange = vi.fn()
  const view = render(<SpaceMapOverlay open={initialOpen} onOpenChange={onOpenChange} />)
  return {
    onOpenChange,
    rerender: (open: boolean) =>
      view.rerender(<SpaceMapOverlay open={open} onOpenChange={onOpenChange} />),
  }
}

describe('components/next/navigation/SpaceMapOverlay（生命周期与焦点管理）', () => {
  test('关闭态不渲染任何内容；打开后渲染全屏薄层、自动聚焦搜索框并展示完整白名单', () => {
    const { rerender } = renderOverlay(false)
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(true)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-space-map-overlay', '')
    expect(screen.getByText('空间地图')).toBeInTheDocument()

    // 焦点自动落入搜索框（design D2：浮层唤起即聚焦搜索框）。
    const input = screen.getByRole('searchbox', { name: '搜索空间坐标' })
    expect(document.activeElement).toBe(input)

    // 完整白名单全部可用可点（生成剧场/图表馆均已点亮为 available）。
    expect(screen.getByRole('button', { name: /角色首页/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /生成剧场/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /图表馆/ })).toBeEnabled()
  })

  test('Esc 键关闭并上报 onOpenChange(false)', () => {
    const { onOpenChange, rerender } = renderOverlay()
    rerender(true)

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('点击遮罩背景关闭并上报 onOpenChange(false)', async () => {
    const { onOpenChange, rerender } = renderOverlay()
    rerender(true)

    // Radix DismissableLayer 的 pointerdown 监听经 setTimeout(0) 延迟挂载，
    // 且 defer 模式下在随后的 click 时（同样经 0ms 定时器）才派发关闭——分两步推进事件循环。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    fireEvent.pointerDown(screen.getByTestId('space-map-scrim'), { button: 0 })
    fireEvent.click(screen.getByTestId('space-map-scrim'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('右上角关闭按钮关闭并上报 onOpenChange(false)', () => {
    const { onOpenChange, rerender } = renderOverlay()
    rerender(true)

    fireEvent.click(screen.getByRole('button', { name: '关闭空间地图' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('重新打开时检索词重置为空白，坐标白名单完整复原', () => {
    const { rerender } = renderOverlay()
    rerender(true)

    const input = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '生成' } })
    expect(screen.queryByRole('button', { name: /角色首页/ })).toBeNull()

    rerender(false)
    rerender(true)
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: /角色首页/ })).toBeEnabled()
  })
})

describe('components/next/navigation/SpaceMapOverlay（快捷键呼出，受控契约模拟 W4 装配）', () => {
  function OverlayHarness() {
    const [open, setOpen] = React.useState(false)
    React.useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        // 模拟 useNextShortcuts 的 Cmd/Ctrl+M 全局监听（W4 装配路径）。
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
          setOpen(true)
        }
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [])
    return <SpaceMapOverlay open={open} onOpenChange={setOpen} />
  }

  test('按下 Ctrl+M 唤起地图，Esc 关闭后完全卸载', () => {
    render(<OverlayHarness />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('components/next/navigation/SpaceMapOverlay（检索、直达导航与空状态）', () => {
  test('输入关键词即时过滤：命中项保留、未命中项移除', () => {
    const { rerender } = renderOverlay()
    rerender(true)

    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: '首页' } })
    expect(screen.getByRole('button', { name: /角色首页/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /生成剧场/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /图表馆/ })).toBeNull()

    fireEvent.change(input, { target: { value: 'charts' } })
    expect(screen.getByRole('button', { name: /图表馆/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /角色首页/ })).toBeNull()
  })

  test('无匹配结果展示空状态提示，不崩溃', () => {
    const { rerender } = renderOverlay()
    rerender(true)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '未知坐标XYZ' } })
    expect(screen.getByText('未找到匹配的空间坐标')).toBeInTheDocument()
    expect(screen.getByTestId('space-map-empty')).toBeInTheDocument()
    // 坐标卡片全部移除（关闭按钮保留），无任何残留可交互坐标。
    expect(document.querySelectorAll('[data-space-coordinate]')).toHaveLength(0)
  })

  test('点击可用坐标：立即关闭薄层并无刷新路由跳转', () => {
    const { onOpenChange, rerender } = renderOverlay()
    rerender(true)

    fireEvent.click(screen.getByRole('button', { name: /角色首页/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/next')
  })

  test('点击可用坐标 generate 剧场：立即关闭薄层并无刷新路由跳转 /next/create', () => {
    const { onOpenChange, rerender } = renderOverlay()
    rerender(true)

    fireEvent.click(screen.getByRole('button', { name: /生成剧场/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/next/create')
  })

  test('点击可用坐标图表馆：关闭薄层并无刷新路由跳转 /next/charts（v3-ui-next-chart-gallery 1.4 点亮）', () => {
    const { onOpenChange, rerender } = renderOverlay()
    rerender(true)

    fireEvent.click(screen.getByRole('button', { name: /图表馆/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/next/charts')
  })
})
