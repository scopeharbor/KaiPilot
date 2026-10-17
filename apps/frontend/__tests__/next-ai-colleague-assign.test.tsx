/**
 * AI 同事 · 指派任务与成员代号：
 * - 「指派给小王」「交给我」交给模型理解；
 * - 改负责人预览卡显示任务编号与真实姓名（接口结果只给界面）；
 * - 消息里的〔成员·编码〕在界面换回真实姓名，模型只看得到代号。
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  parseColleagueIntent,
  shouldPlanColleagueActions,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { AiColleagueMessageList } from '@/components/next/ai/AiColleagueMessageList'
import { extractMemberAliasCodes } from '@/hooks/use-member-alias-names'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  confirm: vi.fn(),
  plan: vi.fn(),
  memberNames: vi.fn(),
}))
vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: {
    execute: mocks.execute,
    confirm: mocks.confirm,
    plan: mocks.plan,
    memberNames: mocks.memberNames,
  },
  isScheduleStaleError: () => false,
}))
vi.mock('@/lib/api/copilot', () => ({ copilotApi: { submitTurnStream: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/projects/1',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const projectCtx: ColleagueContext = {
  contextType: 'project_space',
  currentProjectId: 1,
  pathname: '/next/projects/1',
}

function renderList() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AiColleagueMessageList onQuickAction={() => undefined} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.plan.mockReset()
  mocks.memberNames.mockReset()
  useNextAiColleagueStore.setState({
    conversations: [],
    conversationId: 'conv-assign',
    openTabIds: ['conv-assign'],
    sessionId: null,
    modelPreference: null,
    executionState: 'idle',
    messages: [],
    pendingAction: null,
    pendingTriz: null,
    actionQueue: null,
  })
})

describe('指派说法', () => {
  test('交给模型理解', () => {
    for (const text of [
      '把登录页指派给小王',
      '这个任务交给我',
      '登录页转给王小明负责',
      '取消指派',
    ]) {
      expect(
        shouldPlanColleagueActions(text, parseColleagueIntent(text, projectCtx), projectCtx),
      ).toBe(true)
    }
  })

  test('extractMemberAliasCodes', () => {
    expect(
      extractMemberAliasCodes('交给〔成员·7KQ2M9XD〕或〔成员·A1B2C3D4〕，〔成员·7KQ2M9XD〕'),
    ).toEqual(['7KQ2M9XD', 'A1B2C3D4'])
  })
})

describe('改负责人预览卡', () => {
  test('显示任务编号与真实姓名，确认前零写入', async () => {
    mocks.plan.mockResolvedValue({
      isAction: true,
      actions: [
        {
          toolName: 'update_task_assignee',
          parameters: { projectId: 1, taskId: 7, assigneeId: 12 },
          summary: '把 PROJ-1#7「登录页」指派给 王小明',
        },
      ],
      reply: null,
      clarification: null,
      rejected: [],
      model: 'm',
    })
    const diff = {
      projectId: 1,
      taskId: 7,
      taskCode: 'PROJ-1#7',
      taskName: '登录页',
      from: null,
      to: { id: 12, name: '王小明', alias: '〔成员·7KQ2M9XD〕' },
      noop: false,
    }
    mocks.execute.mockResolvedValue({
      data: diff,
      meta: {
        toolName: 'update_task_assignee',
        status: 'PREVIEW_REQUIRED',
        durationMs: 3,
        previewToken: 'b'.repeat(64),
        diff,
      },
    })
    await useNextAiColleagueStore.getState().submitUserMessage('把登录页指派给王小明', projectCtx)
    expect(useNextAiColleagueStore.getState().executionState).toBe('awaiting_confirmation')
    renderList()
    expect(screen.getByText('PROJ-1#7 · 登录页')).toBeInTheDocument()
    expect(screen.getByText('未指派')).toBeInTheDocument()
    expect(screen.getByText('王小明')).toBeInTheDocument()
    expect(screen.getByText('确认应用')).toBeInTheDocument()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
})

describe('消息里的成员代号', () => {
  test('界面换回真实姓名', async () => {
    mocks.memberNames.mockResolvedValue({ '7KQ2M9XD': '王小明' })
    useNextAiColleagueStore.setState({
      messages: [
        {
          id: 'm1',
          sender: 'assistant',
          content: '这个任务的负责人是〔成员·7KQ2M9XD〕，〔成员·ZZZZZZZZ〕也参与了。',
          timestamp: Date.now(),
        },
      ],
    })
    renderList()
    await waitFor(() =>
      expect(screen.getByText('这个任务的负责人是王小明，某成员也参与了。')).toBeInTheDocument(),
    )
    expect(mocks.memberNames).toHaveBeenCalledWith(['7KQ2M9XD', 'ZZZZZZZZ'])
  })
})
