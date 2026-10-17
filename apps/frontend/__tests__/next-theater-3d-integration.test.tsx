import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  PROJECT_DRAFT_MODULES,
  type ConfirmedProjectContext,
  type ParsedIntent,
} from '@aiproj/types'
import NextCreatePage from '@/app/(next)/next/create/page'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAuthStore } from '@/stores/auth-store'
import {
  startedEvent,
  deltaEvent,
  moduleCompletedEvent,
  completedDraftEvent,
  TEST_DRAFT_ID,
} from './_next-theater-sse-fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/create',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const mockDomElement = document.createElement('canvas')
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div data-testid="r3f-canvas-mock" aria-hidden="true" {...props}>
      {children}
    </div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({
    camera: { position: { x: 0, y: 0, z: 12 }, lookAt: vi.fn() },
    pointer: { x: 0, y: 0 },
    clock: { getElapsedTime: () => 0 },
    gl: { domElement: mockDomElement },
  }),
}))

const parsedIntent: ParsedIntent = {
  schemaVersion: '1.0',
  projectType: 'software',
  projectName: '高铁智能调度系统',
  objectives: ['搭建高铁智能调度系统'],
  deliverables: ['3D数字孪生', '智能防冲突'],
  timeline: { startDate: '2026-09-01', deadline: '2026-12-01', durationDays: 90 },
  constraints: [],
  entities: [],
  overallConfidence: 0.95,
}

const mockConfirmedContext: ConfirmedProjectContext = {
  schemaVersion: '1.0',
  rawInput: '打造基于 3D 渲染的高铁智能调度系统',
  parsedIntent,
  resolvedFields: {},
  assumptions: {},
  unresolvedCriticalFields: [],
  unansweredOptionalFields: [],
}

function resetStore(initialStatus: 'idle' | 'ready' = 'idle') {
  useAiProjectDraftStore.setState({
    userId: 1,
    organizationId: 1,
    status: initialStatus,
    rawInput: '打造基于 3D 渲染的高铁智能调度系统',
    cards: [],
    answers: {},
    context: initialStatus === 'ready' ? mockConfirmedContext : null,
    clarificationPhase: initialStatus === 'ready' ? 'ready' : undefined,
    activeCard: null,
    remainingCount: 0,
    completedCount: 0,
    totalCount: 0,
    error: null,
    restored: false,
    draftStatus: null,
    draftId: null,
    draftVersion: 0,
    draft: null,
    draftMeta: null,
    draftFailure: null,
    validation: null,
    moduleStatuses: {},
    lastEventSequence: 0,
    confirmResponse: null,
  })
}

describe('生成剧场 3D 全链路集成测试（v3-next-layer1-theater-3d-m1 tasks 6.1）', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '张工',
        organizations: [{ id: 1, name: '高铁工程院', slug: 'hspeed', role: 'project_manager' }],
      },
      accessToken: 'test-token',
      refreshToken: null,
      permissions: ['ai:trigger'],
      currentOrganizationId: 1,
      planTier: 'enterprise',
      roleVersion: 0,
      isAuthenticated: true,
      hasHydrated: true,
      effectiveTenantContext: null,
      selectionEpoch: 0,
    })

    resetStore('ready')
    document.documentElement.removeAttribute('data-immersion')
  })

  test('全链路：就绪态 → SSE 流式 9 模块装配建造 → 完成落定 → 审查面板展开（RL-01 零自动转正）', async () => {
    const store = useAiProjectDraftStore.getState()
    const { container, rerender } = render(<NextCreatePage />)

    // 1. 断言处于就绪态界面
    expect(screen.getByRole('button', { name: /开始生成项目草案/ })).toBeInTheDocument()

    // 2. 模拟 SSE 生成流开始（startDraftGeneration + draft.started）
    act(() => {
      store.startDraftGeneration(TEST_DRAFT_ID)
      store.applyDraftEvent(startedEvent(1, TEST_DRAFT_ID))
    })
    rerender(<NextCreatePage />)

    // 断言进入生成态
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('drafting')

    // 3. 模拟 9 模块逐步 delta 与 completed
    let seq = 2
    for (const mod of PROJECT_DRAFT_MODULES) {
      act(() => {
        store.applyDraftEvent(deltaEvent(mod, seq++, 'generating', TEST_DRAFT_ID))
      })
      rerender(<NextCreatePage />)
      expect(useAiProjectDraftStore.getState().moduleStatuses[mod]).toBe('generating')

      act(() => {
        store.applyDraftEvent(moduleCompletedEvent(mod, seq++, TEST_DRAFT_ID))
      })
      rerender(<NextCreatePage />)
      expect(useAiProjectDraftStore.getState().moduleStatuses[mod]).toBe('completed')
    }

    // 4. 模拟生成流结束（draft.completed）
    const completedEvt = completedDraftEvent(seq++)
    act(() => {
      store.applyDraftEvent(completedEvt)
      store.setDraftCompleted(completedEvt.draft, completedEvt.meta, completedEvt.validation)
    })
    rerender(<NextCreatePage />)

    // 断言进入落定视图
    expect(screen.getByText(/草案会话已生成/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /进入草案审查/ })).toBeInTheDocument()

    // 5. 点击进入审查
    act(() => {
      store.enterReview()
    })
    rerender(<NextCreatePage />)

    // 断言审查面板展开
    expect(container.querySelector('[data-next-draft-review-panel]')).toBeInTheDocument()

    // 6. RL-01 铁律验证：全程零自动转正，confirmResponse 为 null，绝不绕过人工审查
    expect(useAiProjectDraftStore.getState().confirmResponse).toBeNull()
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('reviewing')
  })
})
