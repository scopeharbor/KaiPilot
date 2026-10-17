import * as React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { MermaidPreview } from '@/components/diagrams/MermaidPreview'

describe('MermaidPreview 组件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('渲染 Mermaid 代码块', () => {
    render(<MermaidPreview mermaid="graph TD" />)
    expect(screen.getByText('graph TD')).toBeInTheDocument()
  })

  test('显示标题', () => {
    render(<MermaidPreview mermaid="graph TD" title="WBS 树" />)
    expect(screen.getByText('WBS 树')).toBeInTheDocument()
  })

  test('显示警告', () => {
    render(
      <MermaidPreview mermaid="gantt" warnings={['Mermaid 不支持依赖线', '关键路径样式不可用']} />,
    )
    expect(screen.getByText('Mermaid 不支持依赖线')).toBeInTheDocument()
    expect(screen.getByText('关键路径样式不可用')).toBeInTheDocument()
  })

  test('复制按钮存在', () => {
    render(<MermaidPreview mermaid="graph TD" />)
    expect(screen.getByText('复制 Mermaid')).toBeInTheDocument()
  })

  test('点击复制后显示已复制', async () => {
    const clipboardMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: clipboardMock } })

    render(<MermaidPreview mermaid="graph TD" />)
    const copyButton = screen.getByText('复制 Mermaid')

    await act(async () => {
      fireEvent.click(copyButton)
      // Wait for the state update
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(clipboardMock).toHaveBeenCalledWith('graph TD')
    expect(screen.getByText('已复制')).toBeInTheDocument()
  })

  test('无警告时不显示警告区域', () => {
    const { container } = render(<MermaidPreview mermaid="graph TD" warnings={[]} />)
    const alerts = container.querySelectorAll('[role="alert"]')
    expect(alerts.length).toBe(0)
  })

  test('空 Mermaid 正常渲染', () => {
    render(<MermaidPreview mermaid="" />)
    expect(screen.getByText('复制 Mermaid')).toBeInTheDocument()
  })
})
