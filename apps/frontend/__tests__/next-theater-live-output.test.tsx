import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TheaterLiveOutput, friendlyLaneLabel } from '@/components/next/theater/TheaterLiveOutput'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import type { OutputLane } from '@/lib/ai-draft/output-lanes'

function lane(partial: Partial<OutputLane> & { id: string }): OutputLane {
  return {
    label: '模型输出',
    text: '',
    reasoning: '',
    model: null,
    done: false,
    order: 0,
    ...partial,
    textChars: partial.textChars ?? (partial.text ?? '').length,
    reasoningChars: partial.reasoningChars ?? (partial.reasoning ?? '').length,
    phase: partial.phase ?? (partial.text ? 'answering' : 'thinking'),
  }
}

afterEach(() => {
  cleanup()
  useAiProjectDraftStore.setState({ streamLanes: [], streamOutput: '' })
})

describe('TheaterLiveOutput', () => {
  it('还没有任何输出时提示正在连接模型', () => {
    useAiProjectDraftStore.setState({ streamLanes: [], streamOutput: '' })
    render(<TheaterLiveOutput />)
    expect(screen.getByText(/正在连接模型/)).toBeInTheDocument()
  })

  it('进行中的调用逐字展示；未吐首字时说明在等模型；已完成的收成一行', () => {
    useAiProjectDraftStore.setState({
      streamOutput: '{"workPackages":[',
      streamLanes: [
        lane({ id: '1', label: '拆解工作包：会员账户', text: '{"workPackages":[', order: 0 }),
        lane({ id: '2', label: '评审工作包拆解：订单', text: '', model: 'gpt-5.6-luna', order: 1 }),
        lane({
          id: '3',
          label: '生成项目草案阶段：charter_scope',
          text: '{}',
          done: true,
          order: 2,
        }),
      ],
    })
    render(<TheaterLiveOutput />)
    expect(screen.getByText('拆解工作包：会员账户')).toBeInTheDocument()
    expect(screen.getByText(/"workPackages"/)).toBeInTheDocument()
    expect(screen.getByText(/gpt-5.6-luna 正在思考中/)).toBeInTheDocument()
    expect(screen.getByText('起草项目章程与范围')).toBeInTheDocument()
    expect(screen.getByText(/2 路模型调用进行中/)).toBeInTheDocument()
  })

  it('推理模型：显示思考过程；正文开始后思考收起，可展开回看', () => {
    useAiProjectDraftStore.setState({
      streamLanes: [
        lane({
          id: '1',
          label: '分析项目理解',
          model: 'deepseek-v4.1-flash',
          reasoning: '用户要做订餐 H5，先看截止日…',
        }),
      ],
    })
    const { rerender } = render(<TheaterLiveOutput />)
    expect(screen.getByText(/deepseek-v4.1-flash 正在思考/)).toBeInTheDocument()
    expect(screen.getByText('用户要做订餐 H5，先看截止日…')).toBeInTheDocument()
    useAiProjectDraftStore.setState({
      streamLanes: [
        lane({
          id: '1',
          label: '分析项目理解',
          model: 'deepseek-v4.1-flash',
          reasoning: '用户要做订餐 H5，先看截止日…',
          text: '{"needs":[',
        }),
      ],
    })
    rerender(<TheaterLiveOutput />)
    expect(screen.queryByText('用户要做订餐 H5，先看截止日…')).toBeNull()
    fireEvent.click(screen.getByText(/思考过程/))
    expect(screen.getByText('用户要做订餐 H5，先看截止日…')).toBeInTheDocument()
  })

  it('思考超过 6,000 字仍继续计数；分清正在思考还是正在回答', () => {
    useAiProjectDraftStore.setState({
      streamLanes: [
        lane({
          id: '1',
          label: '拆解工作包',
          model: 'deepseek',
          reasoning: '想'.repeat(6000),
          reasoningChars: 18_432,
        }),
      ],
    })
    const { rerender } = render(<TheaterLiveOutput />)
    expect(screen.getByText('deepseek 正在思考 · 已思考 18,432 字')).toBeInTheDocument()
    useAiProjectDraftStore.setState({
      streamLanes: [
        lane({
          id: '1',
          label: '拆解工作包',
          model: 'deepseek',
          reasoning: '想'.repeat(6000),
          reasoningChars: 18_432,
          text: '{"a":1}',
          textChars: 7_210,
        }),
      ],
    })
    rerender(<TheaterLiveOutput />)
    expect(screen.getByText('正在回答 · 已输出 7,210 字')).toBeInTheDocument()
    expect(screen.getByText(/思考过程（18,432 字）/)).toBeInTheDocument()
  })

  it('阶段代号换成中文', () => {
    expect(friendlyLaneLabel('生成项目草案阶段：wbs_tasks（任务批次 2/5）')).toBe(
      '拆分 WBS 与任务（任务批次 2/5）',
    )
    expect(friendlyLaneLabel('拆解工作包：会员账户')).toBe('拆解工作包：会员账户')
  })
})
