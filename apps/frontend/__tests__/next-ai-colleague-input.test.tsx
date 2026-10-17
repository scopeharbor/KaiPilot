/**
 * AI 同事输入控制器测试（v3-ui-next-ai-colleague W2 · tasks 2.2）。
 *
 * 覆盖：输入内容受控同步、Enter 发送与发送后清空、Shift+Enter 换行不提交、
 * IME 组合态（isComposing / keyCode 229）不误发、空白不提交、
 * 执行中禁用（输入框 + 发送按钮 + 提交路径三路封锁）、forwardRef 聚焦方法。
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { AiColleagueInput } from '@/components/next/ai/AiColleagueInput'

function setup(onSubmit = vi.fn(), disabled = false) {
  const view = render(<AiColleagueInput onSubmit={onSubmit} disabled={disabled} />)
  const textarea = screen.getByRole('textbox', {
    name: '向 AI 同事发送指令',
  }) as HTMLTextAreaElement
  return { view, textarea, onSubmit }
}

describe('components/next/ai/AiColleagueInput（输入交互与 IME 防护）', () => {
  test('输入内容受控同步，Enter 触发发送并清空输入框', () => {
    const { textarea, onSubmit } = setup()

    fireEvent.change(textarea, { target: { value: '查看当前项目摘要' } })
    expect(textarea.value).toBe('查看当前项目摘要')

    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('查看当前项目摘要')
    expect(textarea.value).toBe('')

    // 连续两次 Enter 不重复发送空内容
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('空白或纯空格输入不触发提交', () => {
    const { textarea, onSubmit } = setup()

    fireEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('Shift+Enter 执行换行，不触发提交', () => {
    const { textarea, onSubmit } = setup()

    fireEvent.change(textarea, { target: { value: '第一行' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(textarea.value).toBe('第一行')
  })

  test('IME 拼音组合态下 Enter 不上屏不误发（isComposing 与 keyCode 229 双通道）', () => {
    const { textarea, onSubmit } = setup()

    fireEvent.change(textarea, { target: { value: '查看' } })
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(textarea.value).toBe('查看')
  })

  test('执行中禁用：输入框与发送按钮双锁，Enter 与点击均不提交', () => {
    const onSubmit = vi.fn()
    render(<AiColleagueInput onSubmit={onSubmit} disabled />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    const sendButton = screen.getByRole('button', { name: '发送' })

    expect(textarea).toBeDisabled()
    expect(sendButton).toBeDisabled()

    fireEvent.change(textarea, { target: { value: '延期任务 12 至 2026-09-15' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent.click(sendButton)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('未禁用时发送按钮在空输入下禁用、输入后启用，点击按钮同样可提交', () => {
    const onSubmit = vi.fn()
    render(<AiColleagueInput onSubmit={onSubmit} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    const sendButton = screen.getByRole('button', { name: '发送' })

    expect(sendButton).toBeDisabled()
    fireEvent.change(textarea, { target: { value: '去甘特图' } })
    expect(sendButton).toBeEnabled()
    fireEvent.click(sendButton)
    expect(onSubmit).toHaveBeenCalledWith('去甘特图')
  })

  test('forwardRef 暴露 focus()：外部聚焦落点即输入框', () => {
    const ref = createRef<HTMLTextAreaElement>()
    render(<AiColleagueInput ref={ref} onSubmit={vi.fn()} />)

    act(() => {
      ref.current?.focus()
    })
    expect(document.activeElement).toBe(ref.current)
  })
})
