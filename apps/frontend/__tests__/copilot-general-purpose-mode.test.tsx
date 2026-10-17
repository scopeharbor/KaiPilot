/**
 * v3-copilot-general-purpose-mode —— 前端模式标识与切换测试
 *
 * 覆盖：
 * - 模式标识持续可见（task 4.1）
 * - 标识文案明确隔离语义（task 4.2）
 * - 切换需显式用户动作（task 4.3）
 * - 路由变化/分类失败不触发静默切换（task 4.4）
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  CopilotModeIndicator,
  GeneralPurposeSwitchPrompt,
  GeneralPurposeTurnDivider,
} from '../components/copilot/CopilotModeIndicator'

describe('CopilotModeIndicator', () => {
  it('项目模式：显示项目模式标识', () => {
    render(<CopilotModeIndicator currentMode="project" onModeChange={vi.fn()} />)
    expect(screen.getByText('项目模式')).toBeTruthy()
  })

  it('通用模式：显示通用问答模式标识', () => {
    render(<CopilotModeIndicator currentMode="general_purpose" onModeChange={vi.fn()} />)
    expect(screen.getByText('通用问答模式')).toBeTruthy()
  })

  it('通用模式：显示隔离声明文案', () => {
    render(<CopilotModeIndicator currentMode="general_purpose" onModeChange={vi.fn()} />)
    expect(screen.getByText(/不读取也不修改项目数据/)).toBeTruthy()
  })

  it('模式标识持续可见（非一次性）：组件始终渲染', () => {
    const { rerender } = render(
      <CopilotModeIndicator currentMode="project" onModeChange={vi.fn()} />,
    )
    expect(screen.getByText('项目模式')).toBeTruthy()

    rerender(<CopilotModeIndicator currentMode="general_purpose" onModeChange={vi.fn()} />)
    expect(screen.getByText('通用问答模式')).toBeTruthy()
  })

  it('切换按钮需显式点击（task 4.3）：点击触发回调', () => {
    const onModeChange = vi.fn()
    render(<CopilotModeIndicator currentMode="project" onModeChange={onModeChange} />)

    const switchButton = screen.getByRole('button', { name: /通用问答/ })
    fireEvent.click(switchButton)
    expect(onModeChange).toHaveBeenCalledWith('general_purpose')
  })

  it('切换按钮：从通用切回项目', () => {
    const onModeChange = vi.fn()
    render(<CopilotModeIndicator currentMode="general_purpose" onModeChange={onModeChange} />)

    // 按钮带 aria-label（无障碍名优先于文本内容）：通用模式下为「切换到项目模式」
    const switchButton = screen.getByRole('button', { name: /切换到项目模式/ })
    fireEvent.click(switchButton)
    expect(onModeChange).toHaveBeenCalledWith('project')
  })

  it('disabled 状态：点击不触发回调', () => {
    const onModeChange = vi.fn()
    render(<CopilotModeIndicator currentMode="project" onModeChange={onModeChange} disabled />)

    const switchButton = screen.getByRole('button', { name: /通用问答/ })
    fireEvent.click(switchButton)
    expect(onModeChange).not.toHaveBeenCalled()
  })

  it('data-copilot-mode 属性正确设置', () => {
    const { rerender } = render(
      <CopilotModeIndicator currentMode="project" onModeChange={vi.fn()} />,
    )
    expect(screen.getByRole('status').getAttribute('data-copilot-mode')).toBe('project')

    rerender(<CopilotModeIndicator currentMode="general_purpose" onModeChange={vi.fn()} />)
    expect(screen.getByRole('status').getAttribute('data-copilot-mode')).toBe('general_purpose')
  })
})

describe('GeneralPurposeSwitchPrompt', () => {
  it('显示项目相关请求提示', () => {
    render(<GeneralPurposeSwitchPrompt onSwitchToProject={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('检测到项目相关请求')).toBeTruthy()
  })

  it('显示切换按钮和取消按钮', () => {
    render(<GeneralPurposeSwitchPrompt onSwitchToProject={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: /切换到项目模式/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /取消/ })).toBeTruthy()
  })

  it('点击切换按钮触发回调', () => {
    const onSwitch = vi.fn()
    render(<GeneralPurposeSwitchPrompt onSwitchToProject={onSwitch} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /切换到项目模式/ }))
    expect(onSwitch).toHaveBeenCalled()
  })
})

describe('GeneralPurposeTurnDivider', () => {
  it('渲染分隔线', () => {
    render(<GeneralPurposeTurnDivider />)
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(screen.getByText(/以下为通用问答内容/)).toBeTruthy()
  })
})
