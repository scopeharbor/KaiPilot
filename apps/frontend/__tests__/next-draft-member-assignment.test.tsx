import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import * as React from 'react'
import type { ProjectDraft } from '@aiproj/types'

vi.mock('@/hooks/use-organization-members', () => ({
  useOrganizationMembers: () => [
    { userId: 16, user: { fullName: '张三', email: 'zhangsan@example.com', isActive: true } },
    { userId: 17, user: { fullName: '李四', email: 'lisi@example.com', isActive: true } },
  ],
}))

import {
  NextDraftMemberAssignment,
  draftRoles,
} from '@/components/next/review/NextDraftMemberAssignment'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

const marked = <T,>(value: T) => ({ value }) as never

/** 最小草案：一个带任务的「后端」角色（5 人天）+ 只出现在资源建议里的「项目经理」（不计人天）。 */
function draftOf(): ProjectDraft {
  return {
    tasks: [
      {
        id: 't1',
        assigneeHint: marked('后端'),
        durationDays: marked(5),
      },
    ],
    resourceHints: [{ id: 'r1', role: marked('项目经理'), headcount: marked(1) }],
  } as unknown as ProjectDraft
}

beforeEach(() => {
  useAiProjectDraftStore.setState({ organizationId: 1, context: null, mentionedMembers: [] })
  useAiDraftConfirmStore.setState({ roleAssignments: {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('草案人员分配', () => {
  it('成员是勾选列表：点 checkbox 直接选 / 取消，不用按住 Ctrl', () => {
    render(<NextDraftMemberAssignment draft={draftOf()} />)
    const backend = within(screen.getByRole('group', { name: '后端 的成员' }))
    const zhangsan = backend.getByLabelText('张三')
    expect(zhangsan).not.toBeChecked()

    fireEvent.click(zhangsan)
    expect(useAiDraftConfirmStore.getState().roleAssignments['后端']).toEqual([16])

    fireEvent.click(backend.getByLabelText('李四'))
    expect(useAiDraftConfirmStore.getState().roleAssignments['后端']).toEqual([16, 17])

    fireEvent.click(backend.getByLabelText('张三'))
    expect(useAiDraftConfirmStore.getState().roleAssignments['后端']).toEqual([17])
  })

  it('持续型角色显示「不计人天」而不是 0 人天；普通角色按任务工作量累计', () => {
    render(<NextDraftMemberAssignment draft={draftOf()} />)
    expect(screen.getByText(/5 人天/)).toBeInTheDocument()
    expect(screen.getByText(/持续型工作 · 不计人天/)).toBeInTheDocument()
    expect(screen.queryByText(/0 人天/)).not.toBeInTheDocument()
  })

  it('draftRoles：只出现在资源建议里的角色 workdays 为 0 并带建议人数', () => {
    const roles = draftRoles(draftOf())
    expect(roles).toEqual([
      { role: '后端', workdays: 5, headcount: null },
      { role: '项目经理', workdays: 0, headcount: 1 },
    ])
  })
})
