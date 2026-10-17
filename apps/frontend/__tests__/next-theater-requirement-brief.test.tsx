import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/api/ai-intent', () => ({
  aiIntentApi: {
    brief: vi.fn(async () => ({
      brief: '## 范围与功能清单\n- 扫码报名，上限 200 人〔段1〕',
      rawLength: 9000,
    })),
  },
}))
vi.mock('@/lib/ai-draft/live-output-client', () => ({
  newLiveOutputId: () => '5b1f0c1e-3d2a-4c6b-9e8f-0a1b2c3d4e5f',
  useLiveOutputLanes: () => ({ lanes: [], totalChars: 0 }),
}))
vi.mock('@/hooks/use-organization-members', () => ({
  useOrganizationMembers: () => [
    { userId: 16, user: { fullName: '张三', email: 'zhangsan@example.com', isActive: true } },
  ],
}))

import { aiIntentApi } from '@/lib/api/ai-intent'
import { TheaterRequirementBrief } from '@/components/next/theater/TheaterRequirementBrief'
import { TheaterMemberMention } from '@/components/next/theater/TheaterMemberMention'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import * as React from 'react'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('长需求整理面板', () => {
  it('整理完可以修改，确认时把改过的清单交出去', async () => {
    const onConfirm = vi.fn()
    render(
      <TheaterRequirementBrief
        rawInput={'需求'.repeat(5000)}
        onConfirm={onConfirm}
        onSkip={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const box = await screen.findByLabelText('需求清单（可以直接修改）')
    expect((box as HTMLTextAreaElement).value).toContain('扫码报名，上限 200 人〔段1〕')
    expect(aiIntentApi.brief).toHaveBeenCalledWith(
      expect.objectContaining({ liveOutputId: '5b1f0c1e-3d2a-4c6b-9e8f-0a1b2c3d4e5f' }),
    )
    fireEvent.change(box, { target: { value: '- 扫码报名，上限 300 人〔段1〕' } })
    fireEvent.click(screen.getByRole('button', { name: /确认清单，开始追问/ }))
    expect(onConfirm).toHaveBeenCalledWith('- 扫码报名，上限 300 人〔段1〕')
  })

  it('整理失败时可以跳过，直接开始追问', async () => {
    vi.mocked(aiIntentApi.brief).mockRejectedValueOnce(new Error('模型超时'))
    const onSkip = vi.fn()
    render(
      <TheaterRequirementBrief
        rawInput="需求"
        onConfirm={vi.fn()}
        onSkip={onSkip}
        onCancel={vi.fn()}
      />,
    )
    await screen.findByText(/整理失败：模型超时/)
    fireEvent.click(screen.getByRole('button', { name: /跳过整理/ }))
    expect(onSkip).toHaveBeenCalled()
  })
})

describe('追问回答框 @ 组织成员', () => {
  it('输入 @ 弹出成员选单，选中后写入「@姓名」并记下成员', async () => {
    useAiProjectDraftStore.setState({ organizationId: 1, mentionedMembers: [] })
    function Harness() {
      const ref = React.useRef<HTMLTextAreaElement | null>(null)
      const [value, setValue] = React.useState('由 @张')
      return (
        <>
          <textarea ref={ref} value={value} onChange={(event) => setValue(event.target.value)} />
          <TheaterMemberMention
            textareaRef={ref}
            value={value}
            caret={value.length}
            onInsert={setValue}
          />
          <output data-testid="value">{value}</output>
        </>
      )
    }
    render(<Harness />)
    fireEvent.mouseDown(await screen.findByText(/张三/))
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('由 @张三 '))
    expect(useAiProjectDraftStore.getState().mentionedMembers[0]).toMatchObject({ userId: 16 })
  })
})
