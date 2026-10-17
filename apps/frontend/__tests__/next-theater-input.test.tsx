import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  INTENT_INPUT_MAX,
  INTENT_INPUT_MIN,
  TheaterIntentInput,
} from '@/components/next/theater/TheaterIntentInput'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

const VALID_INTENT = '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计'

/** 只重置意图澄清相关字段（draft 会话字段与本组件无关，保持不动）。 */
function resetDraft() {
  useAiProjectDraftStore.setState({
    status: 'idle',
    rawInput: '',
    cards: [],
    answers: {},
    parsedIntent: null,
    context: null,
    clarificationPhase: 'core',
    activeCard: null,
    remainingCount: 0,
    completedCount: 0,
    totalCount: 0,
    questionPlanRevision: null,
    agentQuestionPlanToken: null,
    adaptiveSession: null,
    adaptiveSessionToken: null,
    questionPlanCoverage: null,
    error: null,
    restored: false,
  })
}

beforeEach(() => {
  resetDraft()
})

describe('components/next/theater/TheaterIntentInput（v3-ui-next-theater-intent-clarify D3 / 任务 1.4-1.5）', () => {
  test('初始渲染：空输入 + 字数统计 + maxLength=4000 + 提交按钮禁用', () => {
    render(<TheaterIntentInput />)

    const textarea = screen.getByLabelText('用一句话描述项目意图') as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    expect(textarea.value).toBe('')
    expect(textarea.getAttribute('maxlength')).toBe(String(INTENT_INPUT_MAX))
    expect(screen.getByText(`0 / ${INTENT_INPUT_MAX}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /解析意图/ })).toBeDisabled()
    expect(
      screen.getByText(`请至少输入 ${INTENT_INPUT_MIN} 个字符描述项目意图`),
    ).toBeInTheDocument()
  })

  test('仅空白输入：同样按 0 字符处理，不显示已输入计数', () => {
    render(<TheaterIntentInput />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), { target: { value: '   ' } })

    expect(screen.getByRole('button', { name: /解析意图/ })).toBeDisabled()
    expect(
      screen.queryByText(`请至少输入 ${INTENT_INPUT_MIN} 个字符描述项目意图（已输入 0 字符）`),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(`请至少输入 ${INTENT_INPUT_MIN} 个字符描述项目意图`),
    ).toBeInTheDocument()
    expect(useAiProjectDraftStore.getState().rawInput).toBe('   ')
  })

  test('9 字符边界拦截：提示已输入计数且按钮禁用', () => {
    render(<TheaterIntentInput />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
      target: { value: 'a'.repeat(9) },
    })

    expect(screen.getByRole('button', { name: /解析意图/ })).toBeDisabled()
    expect(
      screen.getByText(`请至少输入 ${INTENT_INPUT_MIN} 个字符描述项目意图（已输入 9 字符）`),
    ).toBeInTheDocument()
  })

  test('首尾空白裁剪后达标（trim 后 10 字符）：提交按钮放行', () => {
    render(<TheaterIntentInput />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
      target: { value: '  abcdefghij  ' },
    })

    expect(screen.getByRole('button', { name: /解析意图/ })).toBeEnabled()
    expect(screen.queryByText(/请至少输入/)).not.toBeInTheDocument()
  })

  test('合法输入（≥10 且 ≤4000）：按钮放行，守卫提示消失', () => {
    render(<TheaterIntentInput />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
      target: { value: VALID_INTENT },
    })

    expect(screen.getByRole('button', { name: /解析意图/ })).toBeEnabled()
    expect(screen.queryByText(/请至少输入/)).not.toBeInTheDocument()
    expect(screen.queryByText(/超出最大长度/)).not.toBeInTheDocument()
    // setRawInput 状态同步
    expect(useAiProjectDraftStore.getState().rawInput).toBe(VALID_INTENT)
  })

  test('恰好 4000 字符：合法可提交', () => {
    render(<TheaterIntentInput />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
      target: { value: 'a'.repeat(INTENT_INPUT_MAX) },
    })

    expect(screen.getByRole('button', { name: /解析意图/ })).toBeEnabled()
  })

  test('超过 4000 字符：拦截提交并提示超出最大长度', () => {
    render(<TheaterIntentInput />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
      target: { value: 'a'.repeat(INTENT_INPUT_MAX + 1) },
    })

    expect(screen.getByRole('button', { name: /解析意图/ })).toBeDisabled()
    expect(
      screen.getByText(`超出最大长度限制：最多 ${INTENT_INPUT_MAX} 字符，请精简描述`),
    ).toBeInTheDocument()
    // 超长状态下快捷键提交同样被拦截
    fireEvent.keyDown(screen.getByLabelText('用一句话描述项目意图'), {
      key: 'Enter',
      ctrlKey: true,
    })
    expect(useAiProjectDraftStore.getState().status).toBe('idle')
  })

  test('Ctrl+Enter 合法输入提交：startAnalyzing + onSubmit 回调拿到 trim 后文本', () => {
    const onSubmit = vi.fn()
    render(<TheaterIntentInput onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
      target: { value: `  ${VALID_INTENT}  ` },
    })
    fireEvent.keyDown(screen.getByLabelText('用一句话描述项目意图'), {
      key: 'Enter',
      ctrlKey: true,
    })

    expect(useAiProjectDraftStore.getState().status).toBe('analyzing')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(VALID_INTENT)
  })

  test('Cmd+Enter（metaKey）同等待遇触发提交', () => {
    const onSubmit = vi.fn()
    render(<TheaterIntentInput onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
      target: { value: VALID_INTENT },
    })
    fireEvent.keyDown(screen.getByLabelText('用一句话描述项目意图'), {
      key: 'Enter',
      metaKey: true,
    })

    expect(useAiProjectDraftStore.getState().status).toBe('analyzing')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('裸 Enter（无 Ctrl/Cmd）：不触发提交，状态保持 idle', () => {
    const onSubmit = vi.fn()
    render(<TheaterIntentInput onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
      target: { value: VALID_INTENT },
    })
    fireEvent.keyDown(screen.getByLabelText('用一句话描述项目意图'), { key: 'Enter' })

    expect(useAiProjectDraftStore.getState().status).toBe('idle')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('字符不足时 Ctrl+Enter 同样被拦截', () => {
    const onSubmit = vi.fn()
    render(<TheaterIntentInput onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
      target: { value: '太短' },
    })
    fireEvent.keyDown(screen.getByLabelText('用一句话描述项目意图'), {
      key: 'Enter',
      metaKey: true,
    })

    expect(useAiProjectDraftStore.getState().status).toBe('idle')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('点击「解析意图」按钮提交：仅触发一次，随后进入锁定态', () => {
    const onSubmit = vi.fn()
    render(<TheaterIntentInput onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
      target: { value: VALID_INTENT },
    })

    fireEvent.click(screen.getByRole('button', { name: /解析意图/ }))
    expect(useAiProjectDraftStore.getState().status).toBe('analyzing')
    expect(onSubmit).toHaveBeenCalledTimes(1)

    // 锁定态：按钮禁用，重复点击不产生第二次回调
    const submitButton = screen.getByRole('button', { name: /AI 正在后台理解项目并准备问题/ })
    expect(submitButton).toBeDisabled()
    fireEvent.click(submitButton)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('提交中锁定态：输入框 readOnly、文案切换、字符口径与快捷键均无法二次提交', () => {
    useAiProjectDraftStore.setState({ status: 'analyzing', rawInput: VALID_INTENT })
    const onSubmit = vi.fn()
    render(<TheaterIntentInput onSubmit={onSubmit} />)

    const textarea = screen.getByLabelText('用一句话描述项目意图') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)
    expect(screen.getByRole('button', { name: /AI 正在后台理解项目并准备问题/ })).toBeDisabled()

    // readOnly 下尝试输入不改变 store（防重防线）
    fireEvent.change(textarea, { target: { value: '篡改内容' } })
    expect(useAiProjectDraftStore.getState().rawInput).toBe(VALID_INTENT)

    // 锁定态下 Ctrl+Enter 不触发（状态机已推进，无重复请求）
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('分析结束后（status 回到 idle）输入框恢复可编辑、按钮恢复', () => {
    useAiProjectDraftStore.setState({ status: 'analyzing', rawInput: VALID_INTENT })
    render(<TheaterIntentInput />)

    act(() => {
      useAiProjectDraftStore.setState({ status: 'idle' })
    })
    const textarea = screen.getByLabelText('用一句话描述项目意图') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(false)
    expect(screen.getByRole('button', { name: /解析意图/ })).toBeEnabled()
  })
})
