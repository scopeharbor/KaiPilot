import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DraftOutputPanel,
  DRAFT_OUTPUT_SCROLL_FOLLOW_TOLERANCE_PX,
} from '@/components/ai-copilot/DraftOutputPanel'

function renderPanel(props: Partial<Parameters<typeof DraftOutputPanel>[0]> = {}) {
  return render(
    <DraftOutputPanel
      text=""
      active={false}
      currentModuleLabel={null}
      onClear={() => undefined}
      {...props}
    />,
  )
}

describe('DraftOutputPanel 实时输出面板', () => {
  it('空态：生成中显示等待占位，非生成中显示暂无输出', () => {
    renderPanel({ active: true })
    expect(screen.getByText('正在等待模型输出…')).toBeInTheDocument()
    renderPanel({ active: false })
    expect(screen.getByText('暂无输出')).toBeInTheDocument()
  })

  it('累积文本原样渲染，并显示当前生成模块与字符数', () => {
    renderPanel({ text: '项目章程：构建审批系统', active: true, currentModuleLabel: '项目章程' })
    expect(screen.getByText('当前生成：项目章程')).toBeInTheDocument()
    expect(screen.getByText('项目章程：构建审批系统')).toBeInTheDocument()
    // 可见的字符计数（sr-only 播报文本不含此精确串，避免多匹配）
    expect(screen.getByText((content) => content.trim() === '11 字符')).toBeInTheDocument()
  })

  it('生成中显示流式光标；结束后显示完成标记', () => {
    const { container, rerender } = renderPanel({ text: '第一段', active: true })
    // 光标是 aria-hidden 的 emerald 色块
    expect(
      screen.getByText((content) => content.includes('生成中') && content.includes('3')),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-draft-output-panel]')).not.toBeNull()

    rerender(
      <DraftOutputPanel
        text="第一段"
        active={false}
        currentModuleLabel={null}
        onClear={() => undefined}
      />,
    )
    expect(screen.getByText('— 已结束 —')).toBeInTheDocument()
    expect(screen.queryByText('正在等待模型输出…')).not.toBeInTheDocument()
  })

  it('文本增长时自动跟随滚动到底部', () => {
    const { rerender, container } = renderPanel({ text: 'a'.repeat(50), active: true })
    const body = container.querySelector('[data-draft-output-body]') as HTMLElement
    // 让内容超过可视高度：body 是滚动容器（组件 ref 也挂在这里），jsdom 无布局需手动模拟尺寸
    Object.defineProperty(body, 'scrollHeight', { value: 500, writable: true, configurable: true })
    Object.defineProperty(body, 'clientHeight', { value: 240, writable: true, configurable: true })
    Object.defineProperty(body, 'scrollTop', { value: 0, writable: true, configurable: true })

    rerender(
      <DraftOutputPanel
        text={'b'.repeat(5000)}
        active={true}
        currentModuleLabel={null}
        onClear={() => undefined}
      />,
    )
    // 自动跟随模式下滚动位置被推到最底
    expect(body.scrollTop + body.clientHeight).toBeGreaterThanOrEqual(
      body.scrollHeight - DRAFT_OUTPUT_SCROLL_FOLLOW_TOLERANCE_PX,
    )
  })

  it('用户上滚暂停跟随并显示浮条，点击回到底部恢复', () => {
    const { container } = renderPanel({ text: 'x'.repeat(800), active: true })
    const body = container.querySelector('[data-draft-output-body]') as HTMLElement
    Object.defineProperty(body, 'scrollHeight', { value: 1200, writable: true, configurable: true })
    Object.defineProperty(body, 'clientHeight', { value: 240, writable: true, configurable: true })
    Object.defineProperty(body, 'scrollTop', { value: 0, writable: true, configurable: true })

    // 模拟用户上滚 → 离开底部
    fireEvent.scroll(body)
    const pause = screen.getByText('已暂停跟随 · 点击回到底部')
    expect(pause).toBeInTheDocument()
    expect(pause.getAttribute('data-draft-output-following')).toBe('paused')

    // 点击浮条 → 回到底部并恢复跟随
    fireEvent.click(pause)
    expect(body.scrollTop).toBeGreaterThanOrEqual(
      body.scrollHeight - body.clientHeight - DRAFT_OUTPUT_SCROLL_FOLLOW_TOLERANCE_PX,
    )
  })

  it('清空按钮触发 onClear；折叠收起正文区', () => {
    const onClear = vi.fn()
    const { container } = renderPanel({ text: '内容', currentModuleLabel: '任务清单', onClear })
    fireEvent.click(screen.getByLabelText('清空实时输出'))
    expect(onClear).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('折叠实时输出'))
    expect(container.querySelector('[data-draft-output-body]')).toBeNull()
    fireEvent.click(screen.getByLabelText('展开实时输出'))
    expect(container.querySelector('[data-draft-output-body]')).not.toBeNull()
  })
})
