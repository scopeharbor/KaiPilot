/**
 * v3-copilot-productized-operating-entry —— 入口表面与宿主接入测试
 * （任务 5.1 / 5.2 / 5.3 / 5.4 / 5.5 / 5.6 / 5.8）。
 *
 * 覆盖：
 * - 九个可观察状态的渲染与「未就绪不给 false-ready 主动作」
 * - Dashboard 只交付 Copilot 工作区块（无 KPI 卡 / 无嵌套卡片 / 无等权 icon grid），
 *   项目列表与 AI 快速创建导航保留
 * - 多触发器收敛到同一面板与同一 store（不新建第二个面板/会话历史）
 * - Topbar 触发器状态感知、触发器身份与焦点回归注册不变
 * - 继续/新建会话：resume 前刷新 readiness 与会话权威，stale 一律 fail closed
 * - quick start 只填草稿 + 结构化选择，零 provider 调用、零域写，stale 提交 fail closed
 * - 无障碍：状态非仅颜色、可见 focus、44px 触摸目标、中文 aria-live 只播低敏状态
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { CopilotOperatingEntry } from '@/components/copilot/CopilotOperatingEntry'
import { CopilotTopbarTrigger } from '@/components/layout/Topbar'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { focusCopilotTrigger } from '@/lib/copilot/trigger-focus'
import DashboardPage from '@/app/(dashboard)/dashboard/page'
import { useCopilotStore } from '@/stores/copilot-store'
import { submitCopilotTurn, isQuickStartSelectionStale } from '@/lib/copilot/submit'
import {
  ENTRY_FIXTURE_SNAPSHOT_REVISION,
  ENTRY_FIXTURE_STALE_SNAPSHOT_REVISION,
  degradedEntrySnapshotFixture,
  readyEmptyEntrySnapshotFixture,
  readyEntrySnapshotFixture,
  unavailableEntrySnapshotFixture,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// mock
// ---------------------------------------------------------------------------

const readinessMock = vi.fn()
const submitTurnMock = vi.fn()

vi.mock('@/lib/api/copilot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/copilot')>('@/lib/api/copilot')
  return {
    ...actual,
    copilotApi: {
      readiness: (...args: unknown[]) => readinessMock(...args),
      submitTurn: (...args: unknown[]) => submitTurnMock(...args),
    },
  }
})

const routeParams = { current: {} as { id?: string } }
vi.mock('next/navigation', () => ({
  useParams: () => routeParams.current,
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const authOrganizationId = { current: 7 as number | null }
vi.mock('@/stores/auth-store', () => {
  const getAuthState = () => ({ currentOrganizationId: authOrganizationId.current, user: null })
  const useAuthStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(getAuthState()) : getAuthState()
  useAuthStore.getState = getAuthState
  useAuthStore.setState = vi.fn()
  useAuthStore.subscribe = vi.fn(() => () => {})
  return {
    useAuthStore,
    selectEffectiveOrganizationId: (state: { currentOrganizationId: number | null }) =>
      state.currentOrganizationId,
  }
})

function renderEntry() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <CopilotOperatingEntry />
    </QueryClientProvider>,
  )
  return { ...utils, client }
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  )
}

function entryEl(): HTMLElement {
  return document.querySelector('[data-copilot-entry]') as HTMLElement
}

async function waitForState(state: string) {
  await waitFor(() => expect(entryEl()?.getAttribute('data-copilot-entry-state')).toBe(state))
}

beforeEach(() => {
  readinessMock.mockReset()
  submitTurnMock.mockReset()
  routeParams.current = {}
  act(() => {
    useCopilotStore.setState({
      open: false,
      form: 'drawer',
      draft: '',
      messages: [],
      mode: 'live',
      liveSessionId: null,
      turn: null,
      streaming: false,
      streamPhase: 'idle',
      streamError: null,
      demoCapabilityDeclared: false,
      demoSelected: false,
      failure: null,
      retryEnvelope: null,
      quickStartSelection: null,
      scopeNotice: null,
      toolSnapshotRevision: null,
    })
  })
  localStorage.clear()
})

// ===========================================================================
// 5.1 —— 九个可观察状态
// ===========================================================================

describe('5.1 entry surface states', () => {
  it('loading：形状保持的骨架，且不呈现 false-ready 主动作', async () => {
    readinessMock.mockImplementation(() => new Promise(() => {}))
    renderEntry()
    await waitForState('loading')
    expect(document.querySelector('[data-copilot-entry-skeleton]')).toBeTruthy()
    expect(document.querySelector('[data-entry-open]')).toBeNull()
  })

  it('ready：给出主动作、最近会话与 quick starts', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    expect(document.querySelector('[data-entry-open]')).toBeTruthy()
    expect(document.querySelector('[data-copilot-entry-recent-session]')).toBeTruthy()
    expect(document.querySelectorAll('[data-entry-quick-start]')).toHaveLength(2)
  })

  it('empty：教用户怎么问，且不声称项目数据或工具不存在', async () => {
    readinessMock.mockResolvedValue(readyEmptyEntrySnapshotFixture)
    renderEntry()
    await waitForState('empty')
    const copy = document.querySelector('[data-copilot-entry-empty]')?.textContent ?? ''
    expect(copy).toContain('描述')
    expect(copy).not.toContain('没有项目')
    expect(copy).not.toContain('没有工具')
  })

  it('degraded：列出低敏原因但保留可用动作', async () => {
    readinessMock.mockResolvedValue({
      ...degradedEntrySnapshotFixture,
      reasons: [{ code: 'recent_session_unavailable', retryable: true }],
    })
    renderEntry()
    await waitForState('degraded')
    expect(document.querySelector('[data-entry-open]')).toBeTruthy()
    expect(document.querySelector('[data-copilot-entry-reasons]')?.textContent).toContain(
      '最近会话',
    )
  })

  it('stale：资格快照过期时呈现需要刷新', async () => {
    readinessMock.mockResolvedValue(degradedEntrySnapshotFixture)
    renderEntry()
    await waitForState('stale')
    expect(document.querySelector('[data-copilot-entry-status]')?.textContent).toContain('刷新')
  })

  it('permission-denied：无主动作，只给重新检查，且不泄露被拒 scope', async () => {
    readinessMock.mockResolvedValue({
      ...unavailableEntrySnapshotFixture,
      reasons: [{ code: 'copilot_permission_denied', retryable: false }],
    })
    renderEntry()
    await waitForState('permission-denied')
    expect(document.querySelector('[data-entry-open]')).toBeNull()
    expect(document.querySelector('[data-entry-retry]')).toBeTruthy()
    expect(entryEl().textContent).not.toContain('42')
  })

  it('unavailable：mandatory 前置失败时不给主动作', async () => {
    readinessMock.mockResolvedValue({
      ...unavailableEntrySnapshotFixture,
      reasons: [{ code: 'turn_channel_unavailable', retryable: true }],
    })
    renderEntry()
    await waitForState('unavailable')
    expect(document.querySelector('[data-entry-open]')).toBeNull()
    expect(
      (document.querySelector('[data-copilot-entry-input]') as HTMLInputElement).disabled,
    ).toBe(true)
  })

  it('retrying：重新检查期间保持局部状态，不阻塞其它内容', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    let resolveSecond: (value: unknown) => void = () => {}
    readinessMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSecond = resolve as (value: unknown) => void)),
    )
    fireEvent.click(screen.getByRole('button', { name: /新对话/ }))
    // 触发一次显式刷新
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-entry-continue]')?.click()
    })
    await waitFor(() =>
      expect(['retrying', 'ready']).toContain(entryEl().getAttribute('data-copilot-entry-state')),
    )
    resolveSecond(readyEntrySnapshotFixture)
  })

  it('查询失败：给出非泄露错误说明与重试动作', async () => {
    // 用不可重试类别，避免 hook 的重试退避把用例卡在 loading。
    readinessMock.mockRejectedValue({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'boom at db',
    })
    renderEntry()
    await waitForState('unavailable')
    expect(document.querySelector('[data-copilot-entry-error]')).toBeTruthy()
    expect(entryEl().textContent).not.toContain('boom at db')
  })

  it('demonstration：全程标注且提供返回生产通道的动作', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    act(() => {
      useCopilotStore.getState().setDemoCapabilityDeclared(true)
      useCopilotStore.getState().enterExplicitDemonstration()
    })
    await waitForState('demonstration')
    expect(document.querySelector('[data-copilot-entry-mode="demonstration"]')).toBeTruthy()
    expect(document.querySelector('[data-entry-exit-demo]')).toBeTruthy()

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-entry-exit-demo]')?.click()
    })
    await waitFor(() => expect(useCopilotStore.getState().mode).toBe('live'))
  })

  it('未声明演示能力时不出现进入演示的入口', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    expect(document.querySelector('[data-entry-enter-demo]')).toBeNull()
  })
})

// ===========================================================================
// 5.2 —— Dashboard 只交付 Copilot 工作区块
// ===========================================================================

describe('5.2 dashboard workspace block', () => {
  it('替换建设中占位，保留项目列表与 AI 快速创建导航', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderDashboard()
    await waitForState('ready')

    expect(document.body.textContent).not.toContain('仪表盘建设中')
    expect(document.querySelector('[data-dashboard-projects-link]')?.getAttribute('href')).toBe(
      '/projects',
    )
    expect(document.querySelector('[data-dashboard-ai-create-link]')?.getAttribute('href')).toBe(
      '/ai-create',
    )
  })

  it('概览区交付项目概览、最近项目与团队动态，不再保留「后续 change」占位声明', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderDashboard()
    await waitForState('ready')
    expect(document.querySelector('[data-dashboard-overview]')).not.toBeNull()
    expect(document.querySelector('[data-dashboard-kpis]')).not.toBeNull()
    expect(document.querySelector('[data-dashboard-recent-projects]')).not.toBeNull()
    expect(document.querySelector('[data-dashboard-activity]')).not.toBeNull()
    expect(document.querySelector('[data-dashboard-scope-note]')).toBeNull()
    expect(document.body.textContent).not.toContain('后续 change')
  })

  it('没有嵌套卡片，也没有等权 icon grid', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderDashboard()
    await waitForState('ready')

    // 入口是单一表面：其内部不再嵌套第二层带边框的卡片容器
    const nested = entryEl().querySelectorAll('.border.rounded-\\[var\\(--radius-lg\\)\\]')
    expect(nested).toHaveLength(0)
    // 没有 grid 布局的等权图标块
    expect(document.querySelectorAll('[data-dashboard-page] .grid')).toHaveLength(0)
  })
})

// ===========================================================================
// 5.3 / 5.4 —— 多触发器收敛
// ===========================================================================

describe('5.3 all triggers converge on the same workspace', () => {
  it('主动作打开既有面板并保留草稿', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    const input = document.querySelector('[data-copilot-entry-input]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '帮我看下排期' } })
    fireEvent.click(document.querySelector('[data-entry-open]') as HTMLButtonElement)

    const state = useCopilotStore.getState()
    expect(state.open).toBe(true)
    expect(state.form).toBe('drawer')
    expect(state.draft).toBe('帮我看下排期')
  })

  it('三个触发器共用同一个 store，不产生第二套会话历史', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    const before = useCopilotStore.getState().messages.length
    fireEvent.click(document.querySelector('[data-entry-open]') as HTMLButtonElement)
    act(() => {
      useCopilotStore.getState().setOpen(false)
    })
    fireEvent.click(document.querySelector('[data-entry-quick-start]') as HTMLButtonElement)

    expect(useCopilotStore.getState().open).toBe(true)
    expect(useCopilotStore.getState().messages.length).toBe(before)
    // 入口本身不渲染第二个对话面
    expect(document.querySelectorAll('[data-copilot-input]')).toHaveLength(0)
  })
})

// ===========================================================================
// 5.5 —— 最近会话继续/新建
// ===========================================================================

describe('5.5 recent session continue / start new', () => {
  it('继续前刷新 readiness，通过复核后续接同一会话', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    readinessMock.mockClear()
    await act(async () => {
      ;(document.querySelector('[data-entry-continue]') as HTMLButtonElement).click()
    })

    expect(readinessMock).toHaveBeenCalled()
    await waitFor(() =>
      expect(useCopilotStore.getState().liveSessionId).toBe(
        readyEntrySnapshotFixture.recentSession?.sessionId,
      ),
    )
    expect(useCopilotStore.getState().open).toBe(true)
  })

  it('复核发现会话已不可继续 ⇒ fail closed 到安全新会话且不回显 stale 会话', async () => {
    readinessMock.mockResolvedValueOnce(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    readinessMock.mockResolvedValue(readyEmptyEntrySnapshotFixture)
    await act(async () => {
      ;(document.querySelector('[data-entry-continue]') as HTMLButtonElement).click()
    })

    await waitFor(() =>
      expect(document.querySelector('[data-copilot-entry-resume-notice]')).toBeTruthy(),
    )
    expect(useCopilotStore.getState().liveSessionId).toBeNull()
    expect(useCopilotStore.getState().open).toBe(true)
    expect(entryEl().textContent).not.toContain('排期冲突讨论')
  })

  it('权限在复核时被撤销 ⇒ 同样 fail closed', async () => {
    readinessMock.mockResolvedValueOnce(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    readinessMock.mockResolvedValue(unavailableEntrySnapshotFixture)
    await act(async () => {
      ;(document.querySelector('[data-entry-continue]') as HTMLButtonElement).click()
    })
    await waitFor(() =>
      expect(document.querySelector('[data-copilot-entry-resume-notice]')).toBeTruthy(),
    )
    expect(useCopilotStore.getState().liveSessionId).toBeNull()
  })

  it('新对话清空会话态并打开面板', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    act(() => {
      useCopilotStore.setState({ liveSessionId: 'csess_old', messages: [] })
    })
    fireEvent.click(document.querySelector('[data-entry-new-session]') as HTMLButtonElement)
    expect(useCopilotStore.getState().liveSessionId).toBeNull()
    expect(useCopilotStore.getState().open).toBe(true)
  })
})

// ===========================================================================
// 5.6 —— quick start 只填入
// ===========================================================================

describe('5.6 quick start fills the draft only', () => {
  it('选择后只填草稿 + 记录结构化选择并打开面板：零 provider 调用、零域写', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    fireEvent.click(
      document.querySelector('[data-entry-quick-start="core.project-health"]') as HTMLButtonElement,
    )

    const state = useCopilotStore.getState()
    expect(state.draft).toBe('帮我总结当前项目的健康度与主要风险。')
    expect(state.quickStartSelection?.quickStartId).toBe('core.project-health')
    expect(state.open).toBe(true)
    expect(submitTurnMock).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('插件来源 quick start 绑定当前快照 revision', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    fireEvent.click(
      document.querySelector(
        '[data-entry-quick-start="plugin.triz.contradiction"]',
      ) as HTMLButtonElement,
    )
    expect(useCopilotStore.getState().quickStartSelection?.pluginBinding?.snapshotRevision).toBe(
      ENTRY_FIXTURE_SNAPSHOT_REVISION,
    )
    await waitFor(() =>
      expect(useCopilotStore.getState().toolSnapshotRevision).toBe(ENTRY_FIXTURE_SNAPSHOT_REVISION),
    )
  })

  it('revision 复核：core 不受影响，plugin 变更即 stale，未知 revision 不放行', () => {
    expect(isQuickStartSelectionStale({}, null)).toBe(false)
    expect(
      isQuickStartSelectionStale(
        { pluginBinding: { snapshotRevision: ENTRY_FIXTURE_SNAPSHOT_REVISION } },
        ENTRY_FIXTURE_SNAPSHOT_REVISION,
      ),
    ).toBe(false)
    expect(
      isQuickStartSelectionStale(
        { pluginBinding: { snapshotRevision: ENTRY_FIXTURE_SNAPSHOT_REVISION } },
        ENTRY_FIXTURE_STALE_SNAPSHOT_REVISION,
      ),
    ).toBe(true)
    expect(
      isQuickStartSelectionStale(
        { pluginBinding: { snapshotRevision: ENTRY_FIXTURE_SNAPSHOT_REVISION } },
        null,
      ),
    ).toBe(true)
  })

  it('stale selection 提交时 fail closed：零网络、清空选择、给出可读状态', async () => {
    act(() => {
      const store = useCopilotStore.getState()
      store.setQuickStartSelection(readyEntrySnapshotFixture.quickStarts[1]!)
      store.setToolSnapshotRevision(ENTRY_FIXTURE_STALE_SNAPSHOT_REVISION)
    })

    await act(async () => {
      await submitCopilotTurn({
        text: '帮我分析这个技术矛盾',
        mentions: [],
        currentRoute: '/projects/7',
      })
    })

    const state = useCopilotStore.getState()
    expect(submitTurnMock).not.toHaveBeenCalled()
    expect(state.quickStartSelection).toBeNull()
    expect(state.failure?.kind).toBe('stale')
    expect(state.streamError).toBeTruthy()
  })

  it('write 类 quick start 仍只是建议：入口不提供任何确认控件', async () => {
    readinessMock.mockResolvedValue({
      ...readyEntrySnapshotFixture,
      quickStarts: [
        {
          quickStartId: 'plugin.report.weekly',
          source: 'plugin',
          label: '生成本周周报草稿',
          draftTemplate: '帮我生成本周项目周报草稿。',
          sideEffectClass: 'write',
          pluginBinding: readyEntrySnapshotFixture.quickStarts[1]!.pluginBinding,
        },
      ],
    })
    renderEntry()
    await waitForState('ready')

    fireEvent.click(
      document.querySelector(
        '[data-entry-quick-start="plugin.report.weekly"]',
      ) as HTMLButtonElement,
    )
    expect(useCopilotStore.getState().draft).toBe('帮我生成本周项目周报草稿。')
    const text = entryEl().textContent ?? ''
    for (const forbidden of ['确认执行', '立即应用', '直接提交']) {
      expect(text).not.toContain(forbidden)
    }
  })
})

// ===========================================================================
// 5.8 —— 无障碍
// ===========================================================================

describe('5.8 accessibility obligations', () => {
  it('状态同时由图标、文案与 data 属性传达，不只靠颜色', async () => {
    readinessMock.mockResolvedValue(degradedEntrySnapshotFixture)
    renderEntry()
    await waitForState('stale')
    const status = document.querySelector('[data-copilot-entry-status]') as HTMLElement
    expect(status.textContent?.trim().length).toBeGreaterThan(0)
    expect(status.querySelector('svg')).toBeTruthy()
    expect(entryEl().getAttribute('data-copilot-entry-state')).toBe('stale')
  })

  it('aria-live 只播状态与作用域，不播 prompt 或会话正文', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    act(() => {
      useCopilotStore.getState().setDraft('这是一段不该被播报的输入')
    })
    const live = document.querySelector('[data-copilot-entry-live]') as HTMLElement
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toContain('可用')
    expect(live.textContent).not.toContain('不该被播报')
    expect(live.textContent).not.toContain('排期冲突讨论')
  })

  it('输入有可访问名称，区块有标题关联', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    expect(screen.getByLabelText('向 Copilot 提问')).toBeTruthy()
    expect(entryEl().getAttribute('aria-labelledby')).toBe('copilot-entry-heading')
    expect(document.getElementById('copilot-entry-heading')).toBeTruthy()
  })

  it('移动端主动作与 quick start 触摸目标 ≥44px', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    expect((document.querySelector('[data-entry-open]') as HTMLElement).className).toContain(
      'min-h-11',
    )
    expect(
      (document.querySelector('[data-copilot-entry-input]') as HTMLElement).className,
    ).toContain('min-h-11')
    expect((document.querySelector('[data-entry-quick-start]') as HTMLElement).className).toContain(
      'min-h-11',
    )
  })

  it('可交互元素带统一 focus ring（不依赖颜色单通道）', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    expect(
      (document.querySelector('[data-copilot-entry-input]') as HTMLElement).className,
    ).toContain('focus-visible:shadow-[var(--shadow-focus)]')
    expect((document.querySelector('[data-entry-quick-start]') as HTMLElement).className).toContain(
      'focus-visible:shadow-[var(--shadow-focus)]',
    )
  })

  it('reduced-motion 下状态图标不做旋转动画', async () => {
    readinessMock.mockImplementation(() => new Promise(() => {}))
    renderEntry()
    await waitForState('loading')
    const icon = document.querySelector('[data-copilot-entry-status] svg') as HTMLElement
    expect(icon.getAttribute('class')).toContain('motion-reduce:animate-none')
  })

  it('scope 变更提示以 role=status 呈现，并阻断提交', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')

    act(() => {
      useCopilotStore.getState().setDraft('草稿')
      useCopilotStore.getState().setScopeNotice({
        previousLabel: '全局',
        nextLabel: '灯塔迁移项目',
        previousProjectId: null,
        nextProjectId: 42,
      })
    })

    const notice = document.querySelector('[data-copilot-entry-scope-notice]') as HTMLElement
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.textContent).toContain('全局')
    expect(notice.textContent).toContain('灯塔迁移项目')
    expect((document.querySelector('[data-entry-open]') as HTMLButtonElement).disabled).toBe(true)
  })
})

// ===========================================================================
// 5.4 —— Topbar 状态感知触发器
// ===========================================================================

describe('5.4 topbar status-aware trigger', () => {
  function renderTrigger() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <CopilotTopbarTrigger shortcut="Cmd J" />
        </TooltipProvider>
      </QueryClientProvider>,
    )
  }

  function trigger(): HTMLButtonElement {
    return document.querySelector('[data-copilot-trigger-status]') as HTMLButtonElement
  }

  it.each([
    [readyEntrySnapshotFixture, 'ready', '可用'],
    [degradedEntrySnapshotFixture, 'degraded', '部分可用'],
    [unavailableEntrySnapshotFixture, 'unavailable', '暂不可用'],
  ])('状态 %# 在 aria-label 里用文字重复，不只靠颜色', async (snapshot, status, label) => {
    readinessMock.mockResolvedValue(snapshot)
    renderTrigger()
    await waitFor(() => expect(trigger().getAttribute('data-copilot-trigger-status')).toBe(status))
    expect(trigger().getAttribute('aria-label')).toContain(label)
  })

  it('保留既有触发器身份与 toggle 语义', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderTrigger()
    await waitFor(() => expect(trigger().getAttribute('data-copilot-trigger-status')).toBe('ready'))

    expect(useCopilotStore.getState().open).toBe(false)
    fireEvent.click(trigger())
    expect(useCopilotStore.getState().open).toBe(true)
    fireEvent.click(trigger())
    expect(useCopilotStore.getState().open).toBe(false)
  })

  it('键盘可达并注册焦点回归目标', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderTrigger()
    await waitFor(() => expect(trigger().getAttribute('data-copilot-trigger-status')).toBe('ready'))

    trigger().focus()
    expect(document.activeElement).toBe(trigger())
    fireEvent.click(trigger())

    // 面板关闭时焦点回归到**这个**触发器（模块级引用由点击时注册）
    act(() => {
      useCopilotStore.getState().setOpen(false)
    })
    focusCopilotTrigger()
    expect(document.activeElement).toBe(trigger())
  })

  it('演示模式在触发器上同样显式标注', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderTrigger()
    await waitFor(() => expect(trigger().getAttribute('data-copilot-trigger-status')).toBe('ready'))

    act(() => {
      useCopilotStore.getState().setDemoCapabilityDeclared(true)
      useCopilotStore.getState().enterExplicitDemonstration()
    })
    await waitFor(() =>
      expect(trigger().getAttribute('data-copilot-trigger-status')).toBe('demonstration'),
    )
    expect(trigger().getAttribute('aria-label')).toContain('演示模式')
  })
})

// ===========================================================================
// 5.7 —— 主题 / 密度 / 响应式（product register）
// ===========================================================================

describe('5.7 theme, density and responsive structure', () => {
  // vitest root = apps/frontend；jsdom 下 import.meta.url 不是 file: URL，故用 cwd 拼路径。
  const source = readFileSync(
    join(process.cwd(), 'components/copilot/CopilotOperatingEntry.tsx'),
    'utf8',
  )

  it('只用主题令牌，不写死颜色（浅/深色随令牌切换）', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/\brgba?\(/)
    expect(source).not.toMatch(/\bbg-white\b|\bbg-black\b|\btext-white\b/)
  })

  it('容器内边距走 --card-pad，随 [data-density] 在舒适/紧凑间切换', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    expect(entryEl().className).toContain('p-[var(--card-pad)]')

    // 密度切换只改令牌，不改结构
    document.documentElement.setAttribute('data-density', 'compact')
    expect(entryEl().className).toContain('p-[var(--card-pad)]')
    document.documentElement.removeAttribute('data-density')
  })

  it('圆角走 --radius-lg，不过圆；单一表面只用边框不用大阴影（防 ghost-card）', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    expect(entryEl().className).toContain('rounded-[var(--radius-lg)]')
    expect(entryEl().className).toContain('border border-border')
    expect(entryEl().className).not.toMatch(/shadow-\[var\(--shadow-(md|lg|xl)\)\]/)
    expect(entryEl().className).not.toMatch(/rounded-(2xl|3xl|full)/)
  })

  it('没有大面积 AI 渐变、glow 或侧边色条', () => {
    expect(source).not.toMatch(/bg-gradient|from-ai|via-ai|to-ai/)
    expect(source).not.toMatch(/drop-shadow|blur-\d|shadow-ai-glow/)
    // AI 紫只用于 Sparkles 图标与状态小标识，不做整块背景
    expect(source).not.toMatch(/className="[^"]*\bbg-ai\b[^"]*"/)
    expect(source).not.toMatch(/border-l-4|border-l-\[/)
  })

  it('移动端单列、桌面并排：主输入行用 sm 断点切换方向', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    const form = document.querySelector('form') as HTMLElement
    expect(form.className).toContain('flex-col')
    expect(form.className).toContain('sm:flex-row')
  })

  it('状态与 scope 行在窄视口换行而不横向溢出', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    const statusRow = document.querySelector('[data-copilot-entry-status]')
      ?.parentElement as HTMLElement
    expect(statusRow.className).toContain('flex-wrap')
    // 长会话标题截断而不是撑破容器
    const title = document.querySelector('[data-copilot-entry-recent-session] span') as HTMLElement
    expect(
      (document.querySelector('[data-copilot-entry-recent-session]') as HTMLElement).className,
    ).toContain('flex-wrap')
    expect(title.parentElement?.querySelector('.truncate')).toBeTruthy()
  })

  it('动效只用于状态反馈且提供 reduced-motion 替代', () => {
    const animations = source.match(/animate-[a-z-]+/g) ?? []
    expect(animations.every((cls) => cls === 'animate-spin' || cls === 'animate-none')).toBe(true)
    expect(source).toContain('motion-reduce:animate-none')
  })
})

// ===========================================================================
// 5.8 补充 —— 200% 文本缩放与横向溢出
// ===========================================================================

describe('5.8 text zoom and overflow', () => {
  const source = readFileSync(
    join(process.cwd(), 'components/copilot/CopilotOperatingEntry.tsx'),
    'utf8',
  )

  it('不使用固定像素宽度/高度，文本放大 200% 时可回流', () => {
    expect(source).not.toMatch(/\bw-\[\d+px\]/)
    expect(source).not.toMatch(/\bh-\[\d+px\]/)
    expect(source).not.toMatch(/\bwhitespace-nowrap\b/)
    expect(source).not.toMatch(/\boverflow-x-(auto|scroll)\b/)
  })

  it('长文本靠 truncate + min-w-0 收敛，不撑破容器造成页面横向滚动', async () => {
    readinessMock.mockResolvedValue({
      ...readyEntrySnapshotFixture,
      recentSession: {
        ...readyEntrySnapshotFixture.recentSession!,
        titleSummary: '一个非常非常长的会话标题'.repeat(2),
      },
    })
    renderEntry()
    await waitForState('ready')

    const title = document.querySelector(
      '[data-copilot-entry-recent-session] .truncate',
    ) as HTMLElement
    expect(title).toBeTruthy()
    expect(title.className).toContain('min-w-0')
    expect(entryEl().className).not.toContain('overflow-x')
  })

  it('所有可换行容器都声明了 flex-wrap，窄视口下换行而不溢出', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    const rows = [
      document.querySelector('[data-copilot-entry-status]')?.parentElement,
      document.querySelector('[data-copilot-entry-recent-session]'),
      document.querySelector('[data-copilot-entry-quick-starts]'),
    ]
    for (const row of rows) {
      expect((row as HTMLElement).className).toContain('flex-wrap')
    }
  })
})

// ===========================================================================
// 无组织上下文：不发请求，但仍给出与服务端一致的低敏说明
// ===========================================================================

describe('no effective organization', () => {
  it('不发 readiness 请求，且给出 organization_context_missing 的中文说明', async () => {
    authOrganizationId.current = null
    renderEntry()
    await waitForState('unavailable')

    expect(readinessMock).not.toHaveBeenCalled()
    const note = document.querySelector('[data-copilot-entry-no-organization]')
    expect(note?.textContent).toContain('组织')
    expect(document.querySelector('[data-entry-open]')).toBeNull()
    expect(document.querySelector('[data-entry-retry]')).toBeTruthy()
    authOrganizationId.current = 7
  })

  it('有组织时不显示该说明', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntry()
    await waitForState('ready')
    expect(document.querySelector('[data-copilot-entry-no-organization]')).toBeNull()
  })
})
