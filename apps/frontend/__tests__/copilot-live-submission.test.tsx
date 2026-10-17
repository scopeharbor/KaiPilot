/**
 * v3-copilot-live-submission-channel —— 提交通道、补全数据源与插槽装配测试。
 *
 * 覆盖任务 5.5/5.6（引用清理与请求体携带）、5.9/5.10（演示态无副作用、
 * 两态同渲染面）、6.2/6.3（候选映射三态）、7.10（插槽可达）。
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { useCopilotStore } from '@/stores/copilot-store'
import { CopilotSidebarPanel } from '@/components/copilot/CopilotSidebarPanel'
import { SlashCommandCompletion } from '@/components/copilot/SlashCommandCompletion'
import { toAssumptionEntry, toClarificationField } from '@/components/copilot/CopilotPanelSlots'
import { toMentionCandidate, toMentionCandidates } from '@/lib/copilot/mention-candidates'
import {
  deriveScopeAndAttribution,
  describeCopilotFailure,
  submitCopilotTurn,
} from '@/lib/copilot/submit'
import type { CommandDescriptor } from '@aiproj/types'
import { classifyCopilotEntryFailure } from '@aiproj/types'
import type { SearchSuggestion } from '@/lib/api/search'

const { mockPathname } = vi.hoisted(() => ({ mockPathname: { value: '/projects/7' } }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: '7' }),
  usePathname: () => mockPathname.value,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: ['ai:trigger', 'task:read'],
    canAny: () => true,
    can: () => true,
    canAll: () => true,
  }),
}))

const TASK_REF = {
  entityType: 'task' as const,
  entityId: 1042,
  label: '首页设计（T-1042）',
  organizationId: 1,
  projectId: 7,
}

function resetStore() {
  mockPathname.value = '/projects/7'
  act(() => {
    useCopilotStore.setState({
      open: true,
      form: 'drawer',
      draft: '',
      streaming: false,
      streamPhase: 'idle',
      messages: [],
      demoActions: [],
      demoAssumptions: [],
      streamError: null,
      mode: 'demonstration',
      liveSessionId: null,
      turn: null,
      degradeReason: null,
    })
  })
  sessionStorage.clear()
  localStorage.clear()
}

/**
 * 面板渲染 helper。
 *
 * 收件箱与记忆插槽用 TanStack Query，故必须提供 QueryClient；
 * retry 关闭以免失败查询在测试里重试。
 */
function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CopilotSidebarPanel />
    </QueryClientProvider>,
  )
}

beforeEach(resetStore)
afterEach(() => {
  vi.restoreAllMocks()
  resetStore()
})

// ---------------------------------------------------------------------------
// 提交请求体
// ---------------------------------------------------------------------------

describe('提交通道：结构化引用与斜杠命令随请求带出（5.5 / 5.6）', () => {
  test('请求体携带结构化引用与斜杠命令', async () => {
    const bodies: unknown[] = []
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      throw new Error('offline')
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await submitCopilotTurn({
      text: `${TASK_REF.label} 为什么延期`,
      mentions: [TASK_REF],
      slashCommand: '/risk 新增',
      currentRoute: '/projects/7/tasks',
    })

    expect(bodies).toHaveLength(1)
    const body = bodies[0] as Record<string, unknown>
    expect(body.slashCommand).toBe('/risk 新增')
    expect(body.mentions).toEqual([TASK_REF])
    expect(body.scope).toBe('project')
  })

  test('孤儿引用在提交前被清除且不进请求体', async () => {
    const bodies: unknown[] = []
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      throw new Error('offline')
    }) as unknown as typeof fetch

    await submitCopilotTurn({
      text: '这段文本已经没有那个标签了',
      mentions: [TASK_REF],
      currentRoute: '/projects/7/tasks',
    })

    const body = bodies[0] as Record<string, unknown>
    expect(body.mentions).toEqual([])
  })

  test('scope 与归属由路由确定性推导', () => {
    expect(deriveScopeAndAttribution('/projects/7/tasks')).toEqual({
      scope: 'project',
      attribution: { projectId: '7' },
    })
    expect(deriveScopeAndAttribution('/dashboard')).toEqual({
      scope: 'global',
      attribution: {},
    })
    expect(deriveScopeAndAttribution('/ai-create')).toEqual({
      scope: 'global',
      attribution: {},
    })
  })

  test('AI 建项页显式标注全局只读限制，不伪装成当前项目', () => {
    mockPathname.value = '/ai-create'
    renderPanel()
    const limitation = document.querySelector(
      '[data-copilot-scope-limitation="draft-global-readonly"]',
    )
    expect(limitation?.textContent).toContain('全局只读模式')
    expect(limitation?.textContent).toContain('不会读取未导入草案')
    expect(limitation?.textContent).toContain('不能修改或确认草案')
  })

  test('AI 建项页提交始终携带 global 归属：不附带 draftId、不泄露未导入草案内容', async () => {
    const bodies: unknown[] = []
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      throw new Error('offline')
    }) as unknown as typeof fetch
    act(() => {
      useCopilotStore.setState({ draft: '未导入的草案全文内容（不应进入请求体）' })
    })

    await submitCopilotTurn({
      text: '比较需求与草案',
      mentions: [],
      currentRoute: '/ai-create',
    })

    const body = bodies[0] as Record<string, unknown>
    expect(body.scope).toBe('global')
    expect(body.attribution).toEqual({})
    expect(body.currentRoute).toBe('/ai-create')
    expect(JSON.stringify(body)).not.toContain('未导入的草案全文内容')
  })

  test('AI 建项页 UI 标签与路由记录 scope 一致（均为 global 只读）', async () => {
    mockPathname.value = '/ai-create'
    renderPanel()
    const limitation = document.querySelector(
      '[data-copilot-scope-limitation="draft-global-readonly"]',
    )
    expect(limitation).toBeTruthy()
    expect(deriveScopeAndAttribution('/ai-create')).toEqual({ scope: 'global', attribution: {} })
  })

  test('失败说明按错误分类给出中文文案且不泄露内部信息', () => {
    // v3-copilot-productized-operating-entry：原 `describeDegradation`（把任意错误
    // 说成「已切换为本机演示」）已随 catch-all 演示一并移除，改为按稳定分类给文案。
    expect(
      describeCopilotFailure(classifyCopilotEntryFailure({ code: 'AUTH_REQUIRED' })),
    ).toContain('登录')
    expect(
      describeCopilotFailure(classifyCopilotEntryFailure({ code: 'PERMISSION_DENIED' })),
    ).toContain('权限')
    const transport = describeCopilotFailure(
      classifyCopilotEntryFailure(new Error('ECONNREFUSED at 127.0.0.1:3333')),
    )
    expect(transport).not.toContain('127.0.0.1')
    expect(transport).not.toContain('演示')
  })

  test('合法 answer union 才进入 done，且真实 assistant 可见', async () => {
    const longAssistantContent = '这是应完整显示的项目分析。'.repeat(20)
    act(() =>
      useCopilotStore.setState({
        mode: 'live',
        demoSelected: false,
        messages: [
          {
            messageId: 'cpm-demo-reply',
            sessionId: 'cps-demo-session',
            role: 'assistant',
            messageSummary: '已按你的输入生成演示答复',
            sourceRefs: [],
            createdAt: '2026-08-30T00:00:00.000Z',
          },
        ],
      }),
    )
    // 流式端点：返回 SSE 事件（turn-meta → answer-delta × 3 → answer-done）
    const encoder = new TextEncoder()
    const frames = [
      {
        event: 'turn-meta',
        data: {
          type: 'turn-meta',
          sequence: 1,
          sessionId: 's-answer',
          destinations: [],
          intentSummary: '请用三点回答',
          scope: 'global',
        },
      },
      {
        event: 'answer-delta',
        data: { type: 'answer-delta', sequence: 2, delta: '这是应完整显示的项目分析。' },
      },
      {
        event: 'answer-delta',
        data: { type: 'answer-delta', sequence: 3, delta: '——真实回答可见。' },
      },
      {
        event: 'answer-done',
        data: {
          type: 'answer-done',
          sequence: 4,
          assistantMessageId: 'm-assistant',
          contentSummary: longAssistantContent,
        },
      },
    ]
      .map((f) => ['event: ' + f.event, 'data: ' + JSON.stringify(f.data), '', ''].join('\n'))
      .join('')
    globalThis.fetch = vi.fn(
      async () =>
        new Response(encoder.encode(frames), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ) as unknown as typeof fetch

    await submitCopilotTurn({ text: '请用三点回答', mentions: [], currentRoute: '/ai-create' })
    const state = useCopilotStore.getState()
    expect(state.streamPhase).toBe('done')
    expect(state.turn?.result?.kind).toBe('answer')
    expect(state.messages.some((message) => message.role === 'assistant')).toBe(true)
    expect(
      state.messages.find((message) => message.messageId === 'm-assistant')?.messageSummary,
    ).toContain('这是应完整显示的项目分析。')
    expect(state.messages.some((message) => message.messageId === 'cpm-demo-reply')).toBe(false)
    expect(state.demoActions).toHaveLength(0)
    expect(state.demoAssumptions).toHaveLength(0)
  })

  test('2xx 空 result 被拒绝并保留可重试输入，不显示虚假 assistant', async () => {
    act(() => useCopilotStore.setState({ mode: 'live', demoSelected: false }))
    // 流式端点返回空流（无任何终态事件）→ retryable-service 失败，保留草稿
    const encoder = new TextEncoder()
    globalThis.fetch = vi.fn(
      async () =>
        new Response(encoder.encode(''), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ) as unknown as typeof fetch

    await submitCopilotTurn({ text: '请用三点回答', mentions: [], currentRoute: '/ai-create' })
    const state = useCopilotStore.getState()
    expect(state.streamPhase).toBe('error')
    expect(state.turn).toBeNull()
    expect(state.retryEnvelope?.text).toBe('请用三点回答')
    expect(state.messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 演示态副作用
// ---------------------------------------------------------------------------

describe('演示态：显式标注、零业务写入、同一渲染面（5.9 / 5.10）', () => {
  test('提交失败保持 live 失败态，不追加演示回复，用户消息只落一条', async () => {
    // v3-copilot-productized-operating-entry：生产错误绝不静默变成演示成功。
    act(() => {
      useCopilotStore.setState({ mode: 'live', demoSelected: false })
    })
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    await submitCopilotTurn({
      text: '帮我看下进度',
      mentions: [],
      currentRoute: '/projects/7',
    })

    const state = useCopilotStore.getState()
    expect(state.mode).toBe('live')
    expect(state.failure?.allowsDemonstration).toBe(false)
    expect(state.streamError).toBeTruthy()
    expect(state.messages.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(state.messages.filter((m) => m.role === 'assistant')).toHaveLength(0)
    expect(state.turn).toBeNull()
  })

  test('生产态与演示态共用同一渲染锚点', () => {
    const { unmount } = renderPanel()
    expect(document.querySelector('[data-copilot-input]')).toBeTruthy()
    expect(document.querySelector('[data-copilot-slots]')).toBeTruthy()
    const demoAnchors = document.querySelectorAll(
      '[data-copilot-input],[data-copilot-slots]',
    ).length
    unmount()

    act(() => {
      useCopilotStore.setState({ mode: 'live' })
    })
    renderPanel()
    const liveAnchors = document.querySelectorAll(
      '[data-copilot-input],[data-copilot-slots]',
    ).length
    expect(liveAnchors).toBe(demoAnchors)
  })

  test('演示态标注为 demonstration，生产态标注为 live', () => {
    const { unmount } = renderPanel()
    expect(document.querySelector('[data-copilot-mode="demonstration"]')).toBeTruthy()
    expect(document.querySelector('[data-copilot-mode="live"]')).toBeNull()
    unmount()

    act(() => {
      useCopilotStore.setState({ mode: 'live' })
    })
    renderPanel()
    expect(document.querySelector('[data-copilot-mode="live"]')).toBeTruthy()
    expect(document.querySelector('[data-copilot-mode="demonstration"]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 候选映射
// ---------------------------------------------------------------------------

describe('提及候选映射（6.2 / 6.3）', () => {
  const base: SearchSuggestion = {
    entityType: 'task',
    entityId: 1042,
    title: '首页设计',
    summary: '负责首页视觉',
    target: '/projects/7/tasks/1042',
    projectId: 7,
  }

  test('命中：映射出可点选候选', () => {
    const candidate = toMentionCandidate(base)
    expect(candidate).not.toBeNull()
    expect(candidate!.entityType).toBe('task')
    expect(candidate!.entityId).toBe(1042)
    expect(candidate!.label).toBe('首页设计')
    expect(candidate!.sortKey.stableTieBreak).toBe('task:1042')
  })

  test('不可提及的实体类型缺席', () => {
    expect(toMentionCandidate({ ...base, entityType: 'activity' as never })).toBeNull()
  })

  test('缺必需字段的候选缺席而非渲染空标签', () => {
    expect(toMentionCandidate({ ...base, title: '   ' })).toBeNull()
    expect(toMentionCandidate({ ...base, entityId: 0 })).toBeNull()
  })

  test('零结果映射为空列表', () => {
    expect(toMentionCandidates([], 10)).toEqual([])
  })

  test('剔除缺席候选不改变其余候选顺序', () => {
    const list = [
      base,
      { ...base, entityType: 'activity' as never, entityId: 2 },
      { ...base, entityId: 3, title: '第三项' },
    ]
    const mapped = toMentionCandidates(list, 10)
    expect(mapped.map((c) => c.entityId)).toEqual([1042, 3])
  })

  test('候选数不超过上界', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...base, entityId: i + 1 }))
    expect(toMentionCandidates(many, 10)).toHaveLength(10)
  })
})

// ---------------------------------------------------------------------------
// 插槽装配
// ---------------------------------------------------------------------------

describe('插槽装配（7.10 / 7.9）', () => {
  test('无内容时插槽干净折叠，不留占位框', () => {
    renderPanel()
    expect(document.querySelector('[data-copilot-slot="clarification"]')).toBeNull()
    expect(document.querySelector('[data-copilot-slot="assumptions"]')).toBeNull()
    expect(document.querySelector('[data-copilot-slot="unspecifiedInfoWarning"]')).toBeNull()
  })

  test('模式标识插槽始终可达', () => {
    renderPanel()
    expect(document.querySelector('[data-copilot-slot="modeIndicator"]')).toBeTruthy()
  })

  test('回合带澄清项时澄清插槽可达', () => {
    act(() => {
      useCopilotStore.setState({
        mode: 'live',
        turn: {
          sessionId: 's1',
          messageId: 'm1',
          destinations: [
            {
              destination: 'project.gantt' as never,
              confidence: 88,
              confidenceBand: 'high',
              evidenceRefs: [],
              parameterHints: [],
              reason: '规则命中',
              requiresUserConfirmation: true,
            },
          ],
          clarificationRequired: true,
          clarificationItems: [
            {
              slotId: 'target_date',
              label: '目标日期',
              tier: 'critical',
              question: '希望调整到哪一天？',
            },
          ],
          assumptionEntries: [],
          ambiguity: null,
          warnings: [],
          degradedReason: null,
          rejectedReferenceCount: 0,
          scope: 'project',
          intentSummary: '排期调整',
          stats: { ruleHitCount: 1, fallbackCount: 0 },
          mode: 'live',
        },
      })
    })
    renderPanel()
    expect(document.querySelector('[data-copilot-slot="clarification"]')).toBeTruthy()
  })

  test('回合带假设条目时假设与未指明信息插槽可达', () => {
    act(() => {
      useCopilotStore.setState({
        mode: 'live',
        turn: {
          sessionId: 's1',
          messageId: 'm1',
          destinations: [],
          clarificationRequired: false,
          clarificationItems: [],
          assumptionEntries: [
            {
              slotId: 'duration',
              statement: '按默认工期 5 天推算',
              source: 'default',
              confidence: 60,
              needsConfirmation: true,
            },
          ],
          ambiguity: null,
          warnings: [],
          degradedReason: null,
          rejectedReferenceCount: 0,
          scope: 'project',
          intentSummary: '排期调整',
          stats: { ruleHitCount: 1, fallbackCount: 0 },
          mode: 'live',
        },
      })
    })
    renderPanel()
    expect(document.querySelector('[data-copilot-slot="assumptions"]')).toBeTruthy()
    expect(document.querySelector('[data-copilot-slot="unspecifiedInfoWarning"]')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 形状映射
// ---------------------------------------------------------------------------

describe('回合形状 → 组件契约映射', () => {
  test('默认值来源的假设标记为 usedDefault 且不可逐条编辑', () => {
    const entry = toAssumptionEntry({
      slotId: 'duration',
      statement: '按默认工期 5 天推算',
      source: 'default',
      confidence: 60,
      needsConfirmation: true,
    })
    expect(entry.assumptionId).toBe('duration')
    expect(entry.usedDefault).toBe(true)
    expect(entry.editable).toBe(false)
  })

  test('非默认来源不标记 usedDefault', () => {
    const entry = toAssumptionEntry({
      slotId: 'scope',
      statement: '按用户输入范围推算',
      source: 'user-input',
      confidence: 90,
      needsConfirmation: false,
    })
    expect(entry.usedDefault).toBe(false)
  })

  test('带快捷选项的澄清项映射为单选题', () => {
    const field = toClarificationField(
      {
        slotId: 'granularity',
        label: '粒度',
        tier: 'recommended',
        question: '按周还是按天？',
        quickOptions: ['按周', '按天'],
      },
      'project.gantt',
    )
    expect(field.questionType).toBe('single_choice')
    expect(field.quickOptions.map((o) => o.value)).toEqual(['按周', '按天'])
  })

  test('无快捷选项的澄清项映射为自由文本', () => {
    const field = toClarificationField(
      { slotId: 'note', label: '备注', tier: 'optional', question: '还有补充吗？' },
      'project.gantt',
    )
    expect(field.questionType).toBe('text')
    expect(field.quickOptions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 收件箱与记忆插槽（7.7 / 7.8）
// ---------------------------------------------------------------------------

describe('收件箱与记忆插槽（7.7 / 7.8）', () => {
  test('演示态不渲染收件箱与记忆插槽（不提供可确认动作）', () => {
    renderPanel()
    expect(document.querySelector('[data-copilot-slot="suggestionInbox"]')).toBeNull()
    expect(document.querySelector('[data-copilot-slot="memoryView"]')).toBeNull()
  })

  test('生产态两个插槽可达且默认折叠不发请求', () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('should not fetch when collapsed')
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    act(() => {
      useCopilotStore.setState({ mode: 'live' })
    })
    renderPanel()
    expect(document.querySelector('[data-copilot-slot="suggestionInbox"]')).toBeTruthy()
    expect(document.querySelector('[data-copilot-slot="memoryView"]')).toBeTruthy()
    // 折叠状态：不应发起任何查询
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('两个插槽的展开控件带 aria-expanded 且键盘可达', () => {
    act(() => {
      useCopilotStore.setState({ mode: 'live' })
    })
    renderPanel()
    const inboxToggle = document.querySelector('[data-copilot-inbox-toggle]') as HTMLElement
    const memoryToggle = document.querySelector('[data-copilot-memory-toggle]') as HTMLElement
    expect(inboxToggle.getAttribute('aria-expanded')).toBe('false')
    expect(memoryToggle.getAttribute('aria-expanded')).toBe('false')
    expect(inboxToggle.tagName).toBe('BUTTON')
    expect(memoryToggle.tagName).toBe('BUTTON')
  })
})

// ---------------------------------------------------------------------------
// 既有锚点回归（7.11）
// ---------------------------------------------------------------------------

describe('既有锚点与焦点序回归（7.11）', () => {
  const LEGACY_ANCHORS = [
    'data-copilot-titlebar',
    'data-copilot-titlebar-controls',
    'data-copilot-minimize',
    'data-copilot-maximize',
    'data-copilot-close',
    'data-copilot-live-region',
    'data-copilot-complete-region',
    'data-copilot-input-area',
    'data-copilot-input',
    'data-copilot-submit',
  ]

  test('挂载插槽后既有锚点全部保留', () => {
    renderPanel()
    for (const anchor of LEGACY_ANCHORS) {
      expect(document.querySelector(`[${anchor}]`)).toBeTruthy()
    }
  })

  test('标题栏控件顺序不变（最小化 → 最大化 → 关闭）', () => {
    renderPanel()
    const controls = document.querySelector('[data-copilot-titlebar-controls]')!
    const order = Array.from(controls.children).map((el) =>
      el.hasAttribute('data-copilot-minimize')
        ? 'minimize'
        : el.hasAttribute('data-copilot-maximize')
          ? 'maximize'
          : 'close',
    )
    expect(order).toEqual(['minimize', 'maximize', 'close'])
  })

  test('输入区仍在插槽之后（提交控件不被插槽挤出）', () => {
    renderPanel()
    const slots = document.querySelector('[data-copilot-slots]')!
    const inputArea = document.querySelector('[data-copilot-input-area]')!
    expect(slots.compareDocumentPosition(inputArea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 授权门命令：点击零外发（6.11）
// ---------------------------------------------------------------------------

describe('授权门命令点击不发起任何外部请求（6.11）', () => {
  const GATED: CommandDescriptor = {
    id: 'command.gitlab-sync',
    label: 'GitLab 同步',
    sourceKind: 'registered-command',
    group: 'contextual',
    description: '将项目变更同步到 GitLab 仓库',
    requiredPermissions: ['project:admin'],
    availabilityKind: 'authorization-gated',
    hint: '需要用户授权后才能使用该能力',
    fillText: '/GitLab 同步',
    routingKey: 'gitlab-sync',
  }

  /**
   * 把所有能发起外发的浏览器出口一次性挂上探针。
   *
   * 只 stub `fetch` 不够：`sendBeacon` 与裸 `XMLHttpRequest` 都能绕过它，
   * 而「授权门」这条红线的意思是**一个字节都不出去**，不是「不走 fetch」。
   */
  function installEgressProbes() {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')))
    const beaconSpy = vi.fn(() => true)
    const xhrOpenSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    Object.defineProperty(navigator, 'sendBeacon', { value: beaconSpy, configurable: true })
    const originalOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function patched(
      this: XMLHttpRequest,
      ...args: unknown[]
    ): void {
      xhrOpenSpy(...args)
      return (originalOpen as (...a: unknown[]) => void).apply(this, args)
    } as typeof originalOpen
    return {
      fetchSpy,
      beaconSpy,
      xhrOpenSpy,
      restore: () => {
        XMLHttpRequest.prototype.open = originalOpen
      },
      expectNoEgress: () => {
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(beaconSpy).not.toHaveBeenCalled()
        expect(xhrOpenSpy).not.toHaveBeenCalled()
      },
    }
  }

  test('点击「需授权」条目只回调选中，不产生任何网络出口调用', () => {
    const probes = installEgressProbes()
    const onSelect = vi.fn()
    render(
      <SlashCommandCompletion
        commands={[GATED]}
        onSelect={onSelect}
        active
        prefix=""
        onCancel={() => {}}
      />,
    )

    // 先确认点的确实是授权门那一条（badge 在场 = 可用性已呈现给用户）
    expect(screen.getByText('需授权')).toBeTruthy()
    fireEvent.click(screen.getByText('GitLab 同步'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0]![0].routingKey).toBe('gitlab-sync')
    probes.expectNoEgress()
    probes.restore()
  })

  test('键盘选中授权门条目同样零外发', () => {
    const probes = installEgressProbes()
    const onSelect = vi.fn()
    render(
      <SlashCommandCompletion
        commands={[GATED]}
        onSelect={onSelect}
        active
        prefix=""
        onCancel={() => {}}
      />,
    )
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    probes.expectNoEgress()
    probes.restore()
  })

  test('渲染授权门条目本身不预取任何东西（渲染即零外发）', () => {
    const probes = installEgressProbes()
    render(
      <SlashCommandCompletion
        commands={[GATED]}
        onSelect={() => {}}
        active
        prefix=""
        onCancel={() => {}}
      />,
    )
    probes.expectNoEgress()
    probes.restore()
  })
})

// ---------------------------------------------------------------------------
// 插槽无障碍：键盘遍历与屏幕阅读器播报（7.12）
// ---------------------------------------------------------------------------

/** 造一个同时带澄清项、假设条目与未指明信息的回合，让插槽尽可能同时在场。 */
function setRichTurn() {
  act(() => {
    useCopilotStore.setState({
      mode: 'live',
      turn: {
        sessionId: 's1',
        messageId: 'm1',
        destinations: [
          {
            destination: 'project.gantt' as never,
            confidence: 88,
            confidenceBand: 'high',
            evidenceRefs: [],
            parameterHints: [],
            reason: '规则命中',
            requiresUserConfirmation: true,
          },
        ],
        clarificationRequired: true,
        clarificationItems: [
          {
            slotId: 'target_date',
            label: '目标日期',
            tier: 'critical',
            question: '希望调整到哪一天？',
          },
          {
            slotId: 'scope_note',
            label: '范围说明',
            tier: 'recommended',
            question: '这次调整涉及哪些任务？',
          },
        ],
        assumptionEntries: [
          {
            slotId: 'duration',
            statement: '按默认工期 5 天推算',
            source: 'default',
            confidence: 60,
            needsConfirmation: true,
          },
        ],
        ambiguity: null,
        warnings: [],
        degradedReason: null,
        rejectedReferenceCount: 0,
        scope: 'project',
        intentSummary: '排期调整',
        stats: { ruleHitCount: 1, fallbackCount: 0 },
        mode: 'live',
      } as never,
    })
  })
}

describe('插槽无障碍：键盘遍历与播报（7.12）', () => {
  const SLOT_LABELS: Record<string, string> = {
    modeIndicator: 'Copilot 模式',
    clarification: '待澄清事项',
    assumptions: '本轮假设清单',
    unspecifiedInfoWarning: '未指明信息提示',
    suggestionInbox: '建议收件箱',
    memoryView: 'Copilot 记忆',
  }

  test('在场的每个插槽都是带中文可访问名的 region，读屏可按区导航', () => {
    setRichTurn()
    renderPanel()
    let present = 0
    for (const [slot, label] of Object.entries(SLOT_LABELS)) {
      const el = document.querySelector(`[data-copilot-slot="${slot}"]`)
      if (!el) continue
      present += 1
      expect(el.getAttribute('role'), `${slot} 缺 role`).toBe('group')
      expect(el.getAttribute('aria-label'), `${slot} 的可访问名不对`).toBe(label)
    }
    // 守住空过：至少四个插槽真的在场，否则上面的循环等于没断言
    expect(present).toBeGreaterThanOrEqual(4)
  })

  test('插槽内的可聚焦元素按 DOM 顺序可达，且都在输入框之前', () => {
    setRichTurn()
    renderPanel()
    const slots = document.querySelector('[data-copilot-slots]')!
    const focusables = Array.from(
      slots.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    )
    expect(focusables.length).toBeGreaterThan(0)
    for (const el of focusables) {
      // 没有一个被 tabindex="-1" 或 aria-hidden 排除在遍历之外
      expect(el.getAttribute('tabindex')).not.toBe('-1')
      expect(el.closest('[aria-hidden="true"]')).toBeNull()
      // 逐个 focus 得动：jsdom 下 focus() 生效即证明它在可聚焦链上
      el.focus()
      expect(document.activeElement).toBe(el)
    }
    // 焦点序：插槽内最后一个可聚焦元素仍在输入框之前
    const input = document.querySelector('[data-copilot-input]')!
    const last = focusables[focusables.length - 1]!
    expect(last.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('插槽到场时通过 aria-live 区播报计数', () => {
    setRichTurn()
    renderPanel()
    const region = document.querySelector('[data-copilot-slots-live-region]')!
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toContain('2 项待澄清')
    expect(region.textContent).toContain('1 条假设')
    expect(region.textContent).toContain('1 条未指明信息提示')
  })

  test('播报只给计数，不夹带澄清问题或假设正文', () => {
    setRichTurn()
    renderPanel()
    const region = document.querySelector('[data-copilot-slots-live-region]')!
    // 这一区是常驻 sr-only live region，灌正文等于开第二条内容外泄面
    expect(region.textContent).not.toContain('希望调整到哪一天')
    expect(region.textContent).not.toContain('这次调整涉及哪些任务')
    expect(region.textContent).not.toContain('按默认工期 5 天推算')
  })

  test('无插槽内容时播报区为空，不产生噪声播报', () => {
    renderPanel()
    const region = document.querySelector('[data-copilot-slots-live-region]')!
    expect(region.textContent).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 四种主题密度组合：可辨识且不遮挡输入（7.13）
// ---------------------------------------------------------------------------

describe('四种主题密度组合下插槽可辨识且不遮挡输入（7.13）', () => {
  const COMBOS: Array<{ mode: 'light' | 'dark'; density: 'comfortable' | 'compact' }> = [
    { mode: 'light', density: 'comfortable' },
    { mode: 'light', density: 'compact' },
    { mode: 'dark', density: 'comfortable' },
    { mode: 'dark', density: 'compact' },
  ]

  function applyCombo(mode: string, density: string) {
    document.documentElement.setAttribute('data-mode', mode)
    document.documentElement.setAttribute('data-density', density)
    document.documentElement.classList.toggle('dark', mode === 'dark')
  }

  afterEach(() => {
    document.documentElement.removeAttribute('data-mode')
    document.documentElement.removeAttribute('data-density')
    document.documentElement.classList.remove('dark')
  })

  for (const combo of COMBOS) {
    const name = `${combo.mode} × ${combo.density}`

    test(`${name}：插槽内容在场且非空`, () => {
      applyCombo(combo.mode, combo.density)
      setRichTurn()
      renderPanel()
      const clarification = document.querySelector('[data-copilot-slot="clarification"]')
      const assumptions = document.querySelector('[data-copilot-slot="assumptions"]')
      expect(clarification).toBeTruthy()
      expect(assumptions).toBeTruthy()
      // 「可辨识」的可测部分：文本真的渲染出来了，不是空壳
      expect(clarification!.textContent!.trim().length).toBeGreaterThan(0)
      expect(assumptions!.textContent!.trim().length).toBeGreaterThan(0)
    })

    test(`${name}：输入区仍在插槽之后且未被覆盖`, () => {
      applyCombo(combo.mode, combo.density)
      setRichTurn()
      renderPanel()
      const slots = document.querySelector('[data-copilot-slots]')! as HTMLElement
      const inputArea = document.querySelector('[data-copilot-input-area]')!
      // 结构性不遮挡：输入区在文档流里位于插槽之后
      expect(
        slots.compareDocumentPosition(inputArea) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      // 且插槽没有脱离文档流去盖在输入区上
      expect(slots.className).not.toMatch(/\b(absolute|fixed)\b/)
      for (const child of Array.from(slots.children) as HTMLElement[]) {
        expect(child.className).not.toMatch(/\b(absolute|fixed)\b/)
      }
    })
  }

  test('插槽区有高度上界且自身滚动，内容再多也顶不掉输入区', () => {
    setRichTurn()
    renderPanel()
    const slots = document.querySelector('[data-copilot-slots]')!
    // 原实现是 `shrink-0` 且无高度上界：澄清项多 + 收件箱与记忆同时展开时，
    // 紧凑密度下输入区会被顶出面板可视范围。上界 + 自身滚动是该问题的修复面。
    expect(slots.className).toMatch(/max-h-/)
    expect(slots.className).toMatch(/overflow-y-auto/)
  })
})
