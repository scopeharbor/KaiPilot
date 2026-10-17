/**
 * AI 同事 · 用自然语言改设置：
 * - 预览卡显示设置层级、改前改后，确认前零写入；
 * - 确认走唯一的 /confirm 通道，带回预览令牌；
 * - 预览后被改过（409）提示重新预览。
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ColleagueContext } from '@/lib/next/ai-colleague-intent'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { AiColleagueMessageList } from '@/components/next/ai/AiColleagueMessageList'

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
  mocks.confirm.mockReset()
  mocks.plan.mockReset()
  mocks.memberNames.mockReset()
  useNextAiColleagueStore.setState({
    conversations: [],
    conversationId: 'conv-setting',
    openTabIds: ['conv-setting'],
    sessionId: null,
    modelPreference: null,
    executionState: 'idle',
    messages: [],
    pendingAction: null,
    pendingTriz: null,
    actionQueue: null,
  })
})

const TOKEN = 'c'.repeat(64)
const step = {
  toolName: 'update_setting' as const,
  parameters: { key: 'project.name', value: '新官网改版', projectId: 1 },
  summary: '修改项目的「项目名称」（确认前会先给你看改前改后）',
}
const diff = {
  key: 'project.name',
  label: '项目名称',
  layer: 'project',
  layerLabel: '项目设置',
  projectId: 1,
  beforeText: '官网',
  afterText: '新官网改版',
  noop: false,
}

async function previewSetting() {
  mocks.plan.mockResolvedValue({
    isAction: true,
    actions: [step],
    reply: null,
    clarification: null,
    rejected: [],
    model: 'm',
  })
  mocks.execute.mockResolvedValue({
    data: diff,
    meta: {
      toolName: 'update_setting',
      status: 'PREVIEW_REQUIRED',
      durationMs: 3,
      previewToken: TOKEN,
      diff,
    },
  })
  await useNextAiColleagueStore.getState().submitUserMessage('把项目名改成新官网改版', projectCtx)
}

describe('改设置预览卡', () => {
  test('显示层级与改前改后；确认前零写入，确认带回令牌', async () => {
    await previewSetting()
    expect(mocks.execute).toHaveBeenCalledWith('update_setting', step.parameters)
    expect(useNextAiColleagueStore.getState().executionState).toBe('awaiting_confirmation')
    renderList()
    expect(screen.getByText('项目设置 · 项目名称')).toBeInTheDocument()
    expect(screen.getByText('官网')).toBeInTheDocument()
    expect(screen.getByText('新官网改版')).toBeInTheDocument()
    expect(mocks.confirm).not.toHaveBeenCalled()

    mocks.confirm.mockResolvedValue({
      data: { ...diff, committed: true },
      meta: { toolName: 'update_setting', committed: true, durationMs: 5 },
    })
    await useNextAiColleagueStore.getState().confirmPendingAction(TOKEN)
    expect(mocks.confirm).toHaveBeenCalledWith({
      toolName: 'update_setting',
      previewToken: TOKEN,
      parameters: step.parameters,
    })
    await waitFor(() => expect(screen.getByText('已修改项目名称')).toBeInTheDocument())
  })
})
