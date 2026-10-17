/**
 * v3-copilot-authoritative-page-context —— 前端页面语境 adapter 与提交契约测试
 * （任务 1.2 / 2.4 / design §F-4）。
 *
 * 覆盖：
 * - 六视图/概览/全局的 routeId 派生；
 * - 只发送 per-route allowlist 内 filter/sort；从不读取 DOM（输入纯函数）；
 * - routeRevision 确定性：同页面同指纹，可见状态变化即变化；
 * - 选中实体只接受正整数；filter value 有界；
 * - submit 请求携带 pageContext；提交时冻结快照；
 * - 失败 retry envelope 保存页面快照；默认 retry 沿用原 snapshot revision；
 *   「使用当前页面重试」传入新 descriptor（design §F-4）；
 * - store 的 turnContextSnapshot 不进入 localStorage 白名单。
 *
 * 纯 vitest + RTL；API 客户端与导航全程 mock，零网络。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import {
  COPILOT_PAGE_CONTEXT_ROUTE_FILTER_ALLOWLIST,
  type CopilotPageContextDescriptorV1,
  type CopilotTurnResponse,
} from '@aiproj/types'
import {
  deriveFilters,
  derivePageContextDescriptor,
  deriveRouteId,
  deriveRouteRevision,
  deriveSelectedEntityRefs,
  deriveSort,
  extractProjectIdFromPathname,
} from '@/lib/copilot/page-context'
import {
  retryCopilotTurn,
  retryCopilotTurnWithCurrentPage,
  submitCopilotTurn,
} from '@/lib/copilot/submit'
import {
  COPILOT_STORE_KEY,
  buildCopilotRetryEnvelope,
  useCopilotStore,
} from '@/stores/copilot-store'

function searchParams(query: string): URLSearchParams {
  return new URLSearchParams(query)
}

function derive(pathname: string, query = ''): CopilotPageContextDescriptorV1 {
  return derivePageContextDescriptor({
    pathname,
    params: {},
    searchParams: searchParams(query),
  })
}

// ---------------------------------------------------------------------------
// API + 认证 mock（对齐 copilot-operating-entry-data.test.tsx 惯例）
// ---------------------------------------------------------------------------

const submitTurnMock = vi.fn()

vi.mock('@/lib/api/copilot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/copilot')>('@/lib/api/copilot')
  return {
    ...actual,
    copilotApi: {
      readiness: vi.fn(),
      submitTurn: vi.fn(),
      submitTurnStream: async (...args: unknown[]) => {
        const request = args[0] as { text: string }
        const handlers = args[1] as {
          onOpen?: () => void
          onEvent: (event: never) => void
          onEnd?: () => void
        }
        handlers.onOpen?.()
        const turn = (await submitTurnMock(request)) as CopilotTurnResponse
        handlers.onEvent({
          type: 'turn-meta',
          sequence: 1,
          sessionId: turn.sessionId,
          destinations: [],
          intentSummary: '',
          scope: 'project',
        } as never)
        handlers.onEvent({
          type: 'answer-delta',
          sequence: 2,
          delta: turn.result && turn.result.kind === 'answer' ? turn.result.content : 'ok',
        } as never)
        handlers.onEvent({
          type: 'answer-done',
          sequence: 3,
          assistantMessageId: 'msg-1',
          contentSummary: 'ok',
        } as never)
        handlers.onEnd?.()
      },
    },
  }
})

const routeParams = { current: {} as { id?: string } }
vi.mock('next/navigation', () => ({
  useParams: () => routeParams.current,
  usePathname: () => '/projects/1',
  useSearchParams: () => new URLSearchParams(),
}))

const authState = { current: { currentOrganizationId: 7 as number | null, user: null } }
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(authState.current) : authState.current
  useAuthStore.getState = () => authState.current
  useAuthStore.setState = vi.fn()
  useAuthStore.subscribe = vi.fn(() => () => {})
  return {
    useAuthStore,
    selectEffectiveOrganizationId: (state: { currentOrganizationId: number | null }) =>
      state.currentOrganizationId,
  }
})

/** 构造一个真实回合响应（answer 分支。 */
function answerTurn(overrides: Partial<CopilotTurnResponse> = {}): CopilotTurnResponse {
  return {
    sessionId: 'sess-live-1',
    messageId: 'msg-1',
    destinations: [],
    clarificationRequired: false,
    clarificationItems: [],
    assumptionEntries: [],
    ambiguity: null,
    warnings: [],
    degradedReason: null,
    rejectedReferenceCount: 0,
    scope: 'project',
    intentSummary: '查询任务',
    stats: { ruleHitCount: 1, fallbackCount: 0 },
    mode: 'live',
    result: { kind: 'answer', assistantMessageId: 'msg-1', content: '当前项目共 8 个任务。' },
    ...overrides,
  }
}

beforeEach(() => {
  submitTurnMock.mockReset()
  useCopilotStore.setState({
    mode: 'live',
    demoSelected: false,
    failure: null,
    retryEnvelope: null,
    turn: null,
    turnContextSnapshot: null,
    liveSessionId: null,
    streaming: false,
  })
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// routeId / 项目派生
// ---------------------------------------------------------------------------

describe('route adapter：routeId 与项目派生', () => {
  it('六视图各自映射', () => {
    for (const view of ['kanban', 'list', 'calendar', 'timeline', 'gantt', 'wbs'] as const) {
      expect(deriveRouteId(`/projects/1/(views)/${view}`)).toBe(`project-${view}`)
    }
  })

  it('3.2 六视图各自只发送结构化可见状态（URL 参数 → 本视图 allowlist filter）', () => {
    // Timeline：from/to → timeRange；category/search → allowlist filter
    const timeline = derive(
      '/projects/1/(views)/timeline',
      'from=2026-09-01&to=2026-09-30&search=验收&category=milestone',
    )
    expect(timeline.routeId).toBe('project-timeline')
    expect(timeline.timeRange).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(timeline.filters?.map((f) => f.key)).toEqual(['keyword'])

    // Calendar：assigneeId/priority/status
    const calendar = derive(
      '/projects/1/(views)/calendar',
      'assigneeId=7&priority=high&status=in_progress',
    )
    expect(calendar.routeId).toBe('project-calendar')
    expect(calendar.filters?.map((f) => f.key)).toEqual(['status', 'assignee', 'priority'])

    // List：milestone + sort
    const list = derive('/projects/1/(views)/list', 'milestone=3&search=报告&sort=-dueDate,unknown')
    expect(list.routeId).toBe('project-list')
    expect(list.filters?.map((f) => f.key)).toEqual(['keyword', 'milestone'])
    expect(list.sort).toEqual([{ field: 'dueDate', direction: 'desc' }])

    // Gantt：criticalPath
    const gantt = derive('/projects/1/(views)/gantt', 'criticalPath=1')
    expect(gantt.routeId).toBe('project-gantt')
    expect(gantt.filters?.map((f) => f.key)).toEqual(['criticalPath'])

    // WBS：parent/level
    const wbs = derive('/projects/1/(views)/wbs', 'parent=2&level=phase')
    expect(wbs.routeId).toBe('project-wbs')
    expect(wbs.filters?.map((f) => f.key)).toEqual(['parent', 'level'])

    // Kanban：status/assignee/priority/keyword（zombie 参数不入任何视图）
    const kanban = derive('/projects/1/(views)/kanban', 'status=blocked&zombie=1')
    expect(kanban.routeId).toBe('project-kanban')
    expect(JSON.stringify(kanban)).not.toContain('zombie')

    // 每一种视图的完整请求都不含 DOM/HTML/React state 形态
    for (const descriptor of [timeline, calendar, list, gantt, wbs, kanban]) {
      const serialized = JSON.stringify(descriptor)
      expect(serialized).not.toContain('innerHTML')
      expect(serialized).not.toContain('<div')
      expect(serialized).not.toContain('documentElement')
    }
  })

  it('任务列表页与项目概览、全局映射', () => {
    expect(deriveRouteId('/projects/1/tasks')).toBe('project-list')
    expect(deriveRouteId('/projects/1')).toBe('project-overview')
    expect(deriveRouteId('/')).toBe('global')
    expect(deriveRouteId('/settings/security')).toBe('global')
  })

  it('projectId 只接受正整数（带路径段）', () => {
    expect(extractProjectIdFromPathname('/projects/42/(views)/gantt')).toBe(42)
    expect(extractProjectIdFromPathname('/projects/0/(views)/gantt')).toBeNull()
    expect(extractProjectIdFromPathname('/projects')).toBeNull()
  })

  it('descriptor 携带 projectId/viewId，但绝不携带任何 DOM/HTML', () => {
    const descriptor = derive('/projects/1/(views)/kanban')
    expect(descriptor.projectId).toBe(1)
    expect(descriptor.viewId).toBe('kanban')
    const serialized = JSON.stringify(descriptor)
    expect(serialized).not.toContain('innerHTML')
    expect(serialized).not.toContain('<div')
    expect(serialized).not.toContain('document')
  })
})

// ---------------------------------------------------------------------------
// filter / sort / timeRange / selection
// ---------------------------------------------------------------------------

describe('route adapter：结构化可见状态（allowlist）', () => {
  it('kanban 只发送 allowlist 内 filter（search/status/priority/assigneeId 映射）', () => {
    const descriptor = derive(
      '/projects/1/(views)/kanban',
      'search=登录&status=in_progress&assigneeId=7&priority=high&zombieKey=evil',
    )
    const keys = (descriptor.filters ?? []).map((f) => f.key)
    expect(keys).toEqual(['keyword', 'status', 'assignee', 'priority'])
    expect(
      keys.every((key) =>
        COPILOT_PAGE_CONTEXT_ROUTE_FILTER_ALLOWLIST['project-kanban'].includes(key),
      ),
    ).toBe(true)
    // 未知查询参数绝不进入 descriptor（也不进 SQL）
    expect(JSON.stringify(descriptor)).not.toContain('zombieKey')
  })

  it('gantt 发送 criticalPath 与 timeRange，calendar/list 各有自己的 allowlist', () => {
    const gantt = derive(
      '/projects/1/(views)/gantt',
      'criticalPath=true&from=2026-09-01&to=2026-09-30',
    )
    expect(gantt.filters?.some((f) => f.key === 'criticalPath')).toBe(true)
    expect(gantt.timeRange).toEqual({ from: '2026-09-01', to: '2026-09-30' })

    const calendar = derive('/projects/1/(views)/calendar', 'criticalPath=true')
    expect(calendar.filters).toBeUndefined() // criticalPath 不在 calendar allowlist

    const list = derive('/projects/1/(views)/list', 'milestone=3&search=报告')
    expect((list.filters ?? []).map((f) => f.key)).toEqual(['keyword', 'milestone'])
  })

  it('wbs 允许 parent/level/selection，拒绝 status', () => {
    const wbs = derive('/projects/1/(views)/wbs', 'parent=2&level=phase&status=blocked')
    expect((wbs.filters ?? []).map((f) => f.key)).toEqual(['parent', 'level'])
  })

  it('sort 只保留 allowlist 字段', () => {
    const descriptor = derive('/projects/1/(views)/list', 'sort=-dueDate,rank,secretField')
    expect(descriptor.sort).toEqual([{ field: 'dueDate', direction: 'desc' }])
  })

  it('选中实体只接受正整数 ID', () => {
    const refs = deriveSelectedEntityRefs(searchParams('task=42&risk=0&milestone=-1&resource=abc'))
    expect(refs).toEqual([{ kind: 'task', id: 42 }])
    const descriptor = derive('/projects/1/(views)/list', 'task=7&risk=2')
    expect(descriptor.selectedEntityRefs).toEqual([
      { kind: 'task', id: 7 },
      { kind: 'risk', id: 2 },
    ])
  })
})

// ---------------------------------------------------------------------------
// routeRevision 确定性
// ---------------------------------------------------------------------------

describe('route adapter：routeRevision 确定性', () => {
  it('同页面同 revision；filter 变化 revision 变化；pathname 变化 revision 变化', () => {
    const a1 = derive('/projects/1/(views)/kanban', 'status=blocked')
    const a2 = derive('/projects/1/(views)/kanban', 'status=blocked')
    const b1 = derive('/projects/1/(views)/kanban', 'status=in_progress')
    const c1 = derive('/projects/2/(views)/kanban', 'status=blocked')
    expect(a1.routeRevision).toBe(a2.routeRevision)
    expect(a1.routeRevision).not.toBe(b1.routeRevision)
    expect(a1.routeRevision).not.toBe(c1.routeRevision)
  })

  it('「当前页面重试」生成新 revision 的前提：descriptor 重新派生', () => {
    const oldPage = derive('/projects/1/(views)/kanban', 'status=blocked')
    const newPage = derive('/projects/1/(views)/kanban', 'status=in_progress')
    expect(
      deriveRouteRevision(
        oldPage.pathname,
        oldPage.filters ?? [],
        oldPage.sort ?? [],
        oldPage.timeRange,
        oldPage.selectedEntityRefs ?? [],
      ),
    ).toBe(oldPage.routeRevision)
    expect(newPage.routeRevision).not.toBe(oldPage.routeRevision)
  })
})

// ---------------------------------------------------------------------------
// submit / retry 契约（design §F-4）
// ---------------------------------------------------------------------------

describe('submit/retry 契约：页面快照绑定', () => {
  it('submit 请求携带 pageContext，并冻结 turnContextSnapshot', async () => {
    const descriptor = derive('/projects/1/(views)/kanban', 'status=blocked')
    submitTurnMock.mockResolvedValueOnce(answerTurn())
    await act(async () => {
      await submitCopilotTurn({
        text: '有哪些阻塞？',
        mentions: [],
        currentRoute: '/projects/1/(views)/kanban',
        pageContext: descriptor,
      })
    })

    const sent = (submitTurnMock.mock.calls[0]?.[0] ?? {}) as {
      pageContext?: CopilotPageContextDescriptorV1
    }
    expect(sent.pageContext?.routeRevision).toBe(descriptor.routeRevision)
    expect(sent.pageContext?.projectId).toBe(1)

    const snapshot = useCopilotStore.getState().turnContextSnapshot
    expect(snapshot?.pageContext.routeRevision).toBe(descriptor.routeRevision)
    expect(snapshot?.submittedAt).toBeTruthy()
  })

  it('页面切换后默认 retry 沿用原快照 revision', async () => {
    const oldPage = derive('/projects/1/(views)/kanban', 'status=blocked')
    submitTurnMock.mockRejectedValueOnce({ status: 503, code: 'AI_SERVICE_ERROR' })
    await act(async () => {
      await submitCopilotTurn({
        text: '有哪些阻塞？',
        mentions: [],
        currentRoute: '/projects/1/(views)/kanban',
        pageContext: oldPage,
      })
    })

    // 页面已切换（新 revision）
    const newPage = derive('/projects/1/(views)/kanban', 'status=in_progress')
    expect(newPage.routeRevision).not.toBe(oldPage.routeRevision)

    submitTurnMock.mockResolvedValueOnce(answerTurn())
    await act(async () => {
      await retryCopilotTurn()
    })
    const sent = (submitTurnMock.mock.calls[1]?.[0] ?? {}) as {
      pageContext?: CopilotPageContextDescriptorV1
    }
    expect(sent.pageContext?.routeRevision).toBe(oldPage.routeRevision)
  })

  it('「使用当前页面重试」传入新派生的 descriptor', async () => {
    const oldPage = derive('/projects/1/(views)/kanban', 'status=blocked')
    submitTurnMock.mockRejectedValueOnce({ status: 503, code: 'AI_SERVICE_ERROR' })
    await act(async () => {
      await submitCopilotTurn({
        text: '有哪些阻塞？',
        mentions: [],
        currentRoute: '/projects/1/(views)/kanban',
        pageContext: oldPage,
      })
    })

    const newPage = derive('/projects/1/(views)/kanban', 'status=in_progress')
    submitTurnMock.mockResolvedValueOnce(answerTurn())
    await act(async () => {
      await retryCopilotTurnWithCurrentPage(newPage)
    })
    const sent = (submitTurnMock.mock.calls[1]?.[0] ?? {}) as {
      pageContext?: CopilotPageContextDescriptorV1
    }
    expect(sent.pageContext?.routeRevision).toBe(newPage.routeRevision)
    expect(sent.pageContext?.routeRevision).not.toBe(oldPage.routeRevision)
  })

  it('retry envelope 保存页面快照（有界，不持久化）', async () => {
    const descriptor = derive('/projects/1/(views)/gantt', 'criticalPath=true')
    submitTurnMock.mockRejectedValueOnce({ status: 503, code: 'AI_SERVICE_ERROR' })
    await act(async () => {
      await submitCopilotTurn({
        text: '关键路径多长？',
        mentions: [],
        currentRoute: '/projects/1/(views)/gantt',
        pageContext: descriptor,
      })
    })
    const envelope = useCopilotStore.getState().retryEnvelope
    expect(envelope?.pageContext?.routeRevision).toBe(descriptor.routeRevision)
    expect(envelope?.text.length).toBeLessThanOrEqual(2000)

    const persisted = JSON.parse(localStorage.getItem(COPILOT_STORE_KEY) ?? '{}')
    const stateKeys = persisted?.state ? Object.keys(persisted.state) : []
    expect(stateKeys).not.toContain('turnContextSnapshot')
    expect(stateKeys).not.toContain('retryEnvelope')
  })

  it('buildCopilotRetryEnvelope 可选携带 pageContext', () => {
    const descriptor = derive('/projects/1/(views)/kanban')
    const envelope = buildCopilotRetryEnvelope({
      text: 'hi',
      currentRoute: '/projects/1/(views)/kanban',
      pageContext: descriptor,
    })
    expect(envelope.pageContext?.routeRevision).toBe(descriptor.routeRevision)
    const bare = buildCopilotRetryEnvelope({ text: 'hi', currentRoute: '/x' })
    expect(bare.pageContext).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 派生函数直接行为（可读性回归）
// ---------------------------------------------------------------------------

describe('derive 纯函数', () => {
  it('deriveFilters 忽略空值与超界值（截断 128）', () => {
    const filters = deriveFilters(
      'project-kanban',
      searchParams('search=&status=blocked&assigneeId=7'),
    )
    expect(filters).toEqual([
      { key: 'status', op: 'eq', value: 'blocked' },
      { key: 'assignee', op: 'eq', value: '7' },
    ])
    const long = deriveFilters('project-kanban', searchParams(`search=${'长'.repeat(200)}`))
    expect(long[0]?.value.length).toBe(128)
  })

  it('deriveSort 最多 4 项且跳过未知字段', () => {
    const sort = deriveSort(
      'project-list',
      searchParams('sort=dueDate,-unknown,-priority,name,updatedAt,status'),
    )
    expect(sort.length).toBeLessThanOrEqual(4)
    expect(sort.map((s) => s.field)).not.toContain('unknown')
    expect(sort.map((s) => s.field)).toEqual(['dueDate', 'priority', 'name', 'updatedAt'])
    expect(sort.map((s) => s.direction)).toEqual(['asc', 'desc', 'asc', 'asc'])
  })
})
