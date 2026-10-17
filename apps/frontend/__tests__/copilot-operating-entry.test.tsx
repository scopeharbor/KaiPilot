import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Sparkles } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useCopilotStore } from '@/stores/copilot-store'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { useCopilotOperatingEntry } from '@/lib/copilot/operating-entry'
import { CopilotChipsSlot } from '@/components/copilot/CopilotPanelSlots'
import { CopilotTurnActions } from '@/components/copilot/CopilotTurnActions'
import type { CopilotTurnResponse } from '@aiproj/types'

const { push, route } = vi.hoisted(() => ({ push: vi.fn(), route: { value: '/' } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => route.value,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const turn: CopilotTurnResponse = {
  sessionId: 'session',
  messageId: 'message',
  destinations: [
    {
      destination: 'project_creation',
      confidence: 80,
      confidenceBand: 'high',
      evidenceRefs: [],
      parameterHints: [],
      reason: '创建请求',
      requiresUserConfirmation: true,
    },
  ],
  clarificationRequired: false,
  clarificationItems: [],
  assumptionEntries: [],
  ambiguity: null,
  warnings: [],
  degradedReason: null,
  rejectedReferenceCount: 0,
  scope: 'global',
  intentSummary: '创建项目',
  stats: { ruleHitCount: 1, fallbackCount: 0 },
  mode: 'live',
}

beforeEach(() => {
  push.mockReset()
  route.value = '/'
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'copilot@test.local',
      fullName: '测试用户',
      organizations: [{ id: 1, name: '测试空间', slug: 'copilot-test', role: 'owner' }],
    },
    currentOrganizationId: 1,
    permissions: ['ai:trigger', 'project:create'],
    planTier: 'free',
  })
  useCopilotStore.setState({ streaming: false, mode: 'live', draft: '', turn })
  useCopilotOperatingEntry.setState({
    input: '帮我创建一个产品发布项目',
    route: '/',
    userId: '1',
    organizationId: 1,
    projectCreation: null,
  })
  useCommandRegistryStore.setState({ commands: new Map() })
})

describe('Copilot 可操作入口', () => {
  it('创建入口携带原文打开创建页，不直接保存', () => {
    render(<CopilotTurnActions />)
    fireEvent.click(screen.getByRole('button', { name: '用这段需求创建项目' }))
    expect(push).toHaveBeenCalledWith('/ai-create')
    expect(useCopilotOperatingEntry.getState().projectCreation).toBe('帮我创建一个产品发布项目')
  })
  it('租户切换后旧回合操作不可见', () => {
    useAuthStore.setState({ currentOrganizationId: 2 })
    render(<CopilotTurnActions />)
    expect(screen.queryByRole('button', { name: '用这段需求创建项目' })).toBeNull()
  })
  it('无创建权限不展示创建按钮', () => {
    useAuthStore.setState({ permissions: ['ai:trigger'] })
    render(<CopilotTurnActions />)
    expect(screen.queryByRole('button', { name: '用这段需求创建项目' })).toBeNull()
  })
  it('注册命令点击真正执行，流式中禁用', () => {
    const execute = vi.fn()
    useCommandRegistryStore.setState({
      commands: new Map([
        [
          'nav./ai-create',
          {
            id: 'nav./ai-create',
            label: 'AI 快速创建',
            effect: 'navigate',
            group: 'navigation',
            icon: Sparkles,
            execute,
          },
        ],
      ]),
    })
    render(<CopilotChipsSlot />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 快速创建' }))
    expect(execute).toHaveBeenCalledTimes(1)
    act(() => useCopilotStore.setState({ streaming: true }))
    expect(screen.getByRole('button', { name: 'AI 快速创建' })).toBeDisabled()
  })
  it('意图芯片预填草稿并聚焦', () => {
    const focus = vi.fn()
    window.addEventListener('copilot:focus-input', focus)
    render(<CopilotChipsSlot />)
    fireEvent.click(screen.getByRole('button', { name: '通用解释' }))
    expect(useCopilotStore.getState().draft).toBeTruthy()
    expect(focus).toHaveBeenCalledOnce()
    window.removeEventListener('copilot:focus-input', focus)
  })
})
