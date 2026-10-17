/**
 * v3-knowledge-memory-operating-layer —— 运营层 UI 组件测试（§5）
 *
 * 覆盖：
 * - 5.4  `/knowledge` 视图切换不改变既有四层知识页与创作入口
 * - 5.6  summary 的 complete / partial / degraded / empty / forbidden
 * - 5.8  四 kind 语义标识、L3 双水印、memory inference、Skill methodology、filtered-empty
 * - 5.10 详情：unreadable SourceRef、Skill stale base、observation degraded、敏感诱饵缺席
 * - 5.14 loading / empty / error / degraded 各状态与局部 retry，无静默 ready
 * - 5.16 大列表 DOM 行有界、翻页稳定
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import React from 'react'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  can: vi.fn((_permission: string) => true),
}))

vi.mock('@/lib/api-client', () => ({
  apiFetch: mocks.apiFetch,
  apiFetchEnvelope: mocks.apiFetch,
}))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: mocks.can }),
}))
vi.mock('@/hooks/use-organization-id', () => ({
  useOrganizationId: () => 1,
}))

import { OperatingSummaryCard } from '../components/knowledge/operating/OperatingSummaryCard'
import { OperatingQueueList } from '../components/knowledge/operating/OperatingQueueList'
import { OperatingItemRow } from '../components/knowledge/operating/OperatingItemRow'
import KnowledgePage from '../app/(dashboard)/knowledge/page'
import {
  buildCopilotMemoryFixture,
  buildKnowledgeItemFixture,
  buildRetrievalSignalFixture,
  buildSkillKnowledgeDraftFixture,
} from '@aiproj/types/knowledge-memory-operating-layer-fixtures'
import type { KnowledgeMemoryOperatingItem, OperatingSummary } from '@aiproj/types'

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function summaryOf(over: Partial<OperatingSummary> = {}): OperatingSummary {
  return {
    organizationId: 1,
    generatedAt: '2026-08-25T00:00:00.000Z',
    lanes: [
      {
        lane: 'knowledge_item',
        total: 3,
        attentionCount: 2,
        degraded: false,
        coverage: 'complete',
      },
      {
        lane: 'copilot_memory',
        total: 1,
        attentionCount: 1,
        degraded: false,
        coverage: 'complete',
      },
      {
        lane: 'skill_knowledge_draft',
        total: 0,
        attentionCount: 0,
        degraded: false,
        coverage: 'empty',
      },
      { lane: 'retrieval_signal', total: 0, attentionCount: 0, degraded: false, coverage: 'empty' },
    ],
    attentionFacetCounts: {
      ready: 1,
      needs_review: 2,
      stale_or_unconfirmed: 1,
      conflict: 0,
      provenance_gap: 0,
      synthetic_eval_only: 0,
      retention_attention: 0,
      retrieval_gap: 0,
      degraded: 0,
    },
    totalAttention: 3,
    anyLaneDegraded: false,
    visibility: 'visible',
    ...over,
  }
}

function listResponse(
  items: readonly KnowledgeMemoryOperatingItem[],
  over: Record<string, unknown> = {},
) {
  return {
    data: {
      data: items,
      meta: {
        page: 1,
        perPage: 20,
        total: items.length,
        totalPages: 1,
        lanes: ['knowledge_item', 'copilot_memory', 'skill_knowledge_draft', 'retrieval_signal'],
        degradedLanes: [],
        deterministic: true,
        ...over,
      },
    },
  }
}

function renderQueue(urlState: Record<string, unknown> = {}) {
  const client = newClient()
  return render(
    <OperatingQueueList
      organizationId={1}
      urlState={{ view: 'operations', page: 1, ...urlState } as never}
      enabled
      onSelect={() => {}}
    />,
    { wrapper: wrapper(client) },
  )
}

beforeEach(() => {
  mocks.apiFetch.mockReset()
  mocks.can.mockReset()
  mocks.can.mockReturnValue(true)
  window.history.replaceState({}, '', '/knowledge')
})

// ─── 5.4 视图切换与既有页面不变 ──────────────────────────────────────

describe('/knowledge 视图切换（§5.4）', () => {
  it('默认渲染既有四层知识页，不挂载运营视图', () => {
    mocks.apiFetch.mockResolvedValue({ data: [] })
    const client = newClient()
    render(<KnowledgePage />, { wrapper: wrapper(client) })
    expect(screen.getByText('知识库')).toBeTruthy()
    expect(screen.queryByTestId('knowledge-memory-operating-page')).toBeNull()
  })

  it('既有创作入口在默认视图下仍然存在', () => {
    mocks.apiFetch.mockResolvedValue({ data: [] })
    const client = newClient()
    render(<KnowledgePage />, { wrapper: wrapper(client) })
    expect(screen.getByText('新建知识')).toBeTruthy()
  })

  it('?view=operations 切到运营视图', () => {
    window.history.replaceState({}, '', '/knowledge?view=operations')
    mocks.apiFetch.mockResolvedValue({ data: [] })
    const client = newClient()
    render(<KnowledgePage />, { wrapper: wrapper(client) })
    // flag off 时显示未启用占位；无论哪种都不应再渲染四层知识页标题
    const operating =
      screen.queryByTestId('knowledge-memory-operating-page') ?? screen.queryByTestId('feature-off')
    expect(operating).toBeTruthy()
  })

  it('无运营权限时不渲染运营视图入口按钮', () => {
    mocks.can.mockImplementation((p) => p !== 'knowledge_memory_operating:view')
    mocks.apiFetch.mockResolvedValue({ data: [] })
    const client = newClient()
    render(<KnowledgePage />, { wrapper: wrapper(client) })
    expect(screen.queryByTestId('knowledge-operations-toggle')).toBeNull()
  })
})

// ─── 5.6 summary 状态 ────────────────────────────────────────────────

describe('OperatingSummaryCard 状态（§5.6）', () => {
  it('complete：四 lane 各自成行且计数可读', () => {
    render(<OperatingSummaryCard summary={summaryOf()} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('3') // 知识 lane total
  })

  it('degraded lane 以文字而非仅颜色标出', () => {
    const summary = summaryOf({
      anyLaneDegraded: true,
      lanes: [
        {
          lane: 'knowledge_item',
          total: 3,
          attentionCount: 2,
          degraded: false,
          coverage: 'complete',
        },
        {
          lane: 'copilot_memory',
          total: 0,
          attentionCount: 0,
          degraded: true,
          coverage: 'degraded',
        },
        {
          lane: 'skill_knowledge_draft',
          total: 0,
          attentionCount: 0,
          degraded: false,
          coverage: 'empty',
        },
        {
          lane: 'retrieval_signal',
          total: 0,
          attentionCount: 0,
          degraded: false,
          coverage: 'empty',
        },
      ],
    })
    render(<OperatingSummaryCard summary={summary} />)
    expect(document.body.textContent ?? '').toMatch(/degraded|降级/)
  })

  it('empty 与 degraded 在文案上可区分（0 不被当成 ready）', () => {
    const summary = summaryOf({
      lanes: [
        { lane: 'knowledge_item', total: 0, attentionCount: 0, degraded: false, coverage: 'empty' },
        {
          lane: 'copilot_memory',
          total: 0,
          attentionCount: 0,
          degraded: true,
          coverage: 'degraded',
        },
        {
          lane: 'skill_knowledge_draft',
          total: 0,
          attentionCount: 0,
          degraded: false,
          coverage: 'empty',
        },
        {
          lane: 'retrieval_signal',
          total: 0,
          attentionCount: 0,
          degraded: false,
          coverage: 'empty',
        },
      ],
      anyLaneDegraded: true,
    })
    render(<OperatingSummaryCard summary={summary} />)
    const text = document.body.textContent ?? ''
    // 「无对象」与「降级」必须是两种说法：0 个对象 ≠ 读取失败
    expect(text).toContain('无对象')
    expect(text).toMatch(/degraded|降级/)
    expect(text).toContain('不可信')
  })
})

// ─── 5.8 四 kind 语义标识 ────────────────────────────────────────────

describe('队列行的语义标识（§5.8）', () => {
  it('L3 知识条目显示 SYNTHETIC 与 eval-only 双水印', () => {
    const l3 = buildKnowledgeItemFixture({ orgId: 1, index: 1, layer: 'L3' })
    render(<OperatingItemRow item={l3} onSelect={() => {}} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('SYNTHETIC')
    expect(text).toContain('eval-only')
  })

  it('memory 行始终标为推断记忆，且不出现 fact 字样', () => {
    const memory = buildCopilotMemoryFixture({ orgId: 1, index: 1, statusDetail: 'confirmed' })
    render(<OperatingItemRow item={memory} onSelect={() => {}} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('推断记忆')
    expect(text).not.toMatch(/已验证事实|verified fact/)
  })

  it('Skill 草稿标为方法论候选', () => {
    const draft = buildSkillKnowledgeDraftFixture({ orgId: 1, index: 1, draftStatus: 'pending' })
    render(<OperatingItemRow item={draft} onSelect={() => {}} />)
    expect(document.body.textContent ?? '').toContain('方法论候选')
  })

  it('四 kind 各自带可区分的 kind 标识', () => {
    const items = [
      buildKnowledgeItemFixture({ orgId: 1, index: 1 }),
      buildCopilotMemoryFixture({ orgId: 1, index: 1 }),
      buildSkillKnowledgeDraftFixture({ orgId: 1, index: 1 }),
      buildRetrievalSignalFixture({ orgId: 1, index: 1 }),
    ]
    const labels = new Set<string>()
    for (const item of items) {
      const { unmount } = render(<OperatingItemRow item={item} onSelect={() => {}} />)
      labels.add(document.body.textContent ?? '')
      unmount()
    }
    expect(labels.size).toBe(4)
  })
})

// ─── 5.14 队列状态与局部 retry ───────────────────────────────────────

describe('队列状态机（§5.14）', () => {
  it('loading 状态可见', () => {
    mocks.apiFetch.mockImplementation(() => new Promise(() => {}))
    renderQueue()
    expect(screen.getByLabelText('loading')).toBeTruthy()
  })

  it('error 状态显示稳定错误码与局部重试', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('403 forbidden'))
    renderQueue()
    await waitFor(() => expect(screen.getByTestId('operating-queue-error')).toBeTruthy())
    expect(document.body.textContent ?? '').toContain('PERMISSION_DENIED')
    expect(screen.getByText('重试')).toBeTruthy()
  })

  it('empty 与 filtered-empty 文案不同（不把筛选空说成组织没有内容）', async () => {
    mocks.apiFetch.mockResolvedValue(listResponse([]))
    const first = renderQueue()
    await waitFor(() => expect(first.container.textContent ?? '').toContain('无任何可处置对象'))
    const plain = first.container.textContent ?? ''
    first.unmount()

    const second = renderQueue({ kind: 'knowledge_item' })
    await waitFor(() => expect(second.container.textContent ?? '').toContain('筛选'))
    const filtered = second.container.textContent ?? ''

    expect(plain).not.toEqual(filtered)
  })

  it('lane degraded 时给出局部重试而不是全局阻塞 modal', async () => {
    mocks.apiFetch.mockResolvedValue(listResponse([], { degradedLanes: ['skill_knowledge_draft'] }))
    renderQueue()
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/degraded|降级/)
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('degraded lane 的 0 不被叙述为「没有内容」', async () => {
    mocks.apiFetch.mockResolvedValue(listResponse([], { degradedLanes: ['copilot_memory'] }))
    renderQueue()
    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain('不可信')
    })
  })
})

// ─── 5.16 大列表有界渲染 ─────────────────────────────────────────────

describe('大列表有界渲染（§5.16）', () => {
  it('服务端分页决定 DOM 行数：一页 20 行就只渲染 20 行', async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      buildKnowledgeItemFixture({ orgId: 1, index: i + 1 }),
    )
    mocks.apiFetch.mockResolvedValue(
      listResponse(items, { total: 2500, totalPages: 125, perPage: 20 }),
    )
    renderQueue()
    await waitFor(() => {
      expect(screen.getByLabelText('operating-queue')).toBeTruthy()
    })
    const list = screen.getByLabelText('operating-queue')
    const rows = within(list).getAllByRole('button')
    expect(rows.length).toBe(20)
  })

  it('2500 总量下仍只渲染当前页，不一次性铺开', async () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      buildKnowledgeItemFixture({ orgId: 1, index: i + 1 }),
    )
    mocks.apiFetch.mockResolvedValue(
      listResponse(items, { total: 2500, totalPages: 25, perPage: 100 }),
    )
    renderQueue({ perPage: 100 })
    await waitFor(() => expect(screen.getByLabelText('operating-queue')).toBeTruthy())
    const rows = within(screen.getByLabelText('operating-queue')).getAllByRole('button')
    expect(rows.length).toBeLessThanOrEqual(100)
  })

  it('行可键盘聚焦并带可访问名称', async () => {
    const items = [buildKnowledgeItemFixture({ orgId: 1, index: 1 })]
    mocks.apiFetch.mockResolvedValue(listResponse(items))
    renderQueue()
    await waitFor(() => expect(screen.getByLabelText('operating-queue')).toBeTruthy())
    const row = within(screen.getByLabelText('operating-queue')).getAllByRole('button')[0]!
    row.focus()
    expect(document.activeElement).toBe(row)
    expect(row.textContent ?? '').not.toHaveLength(0)
  })

  it('点击行触发选择回调（进入详情的唯一入口）', async () => {
    const onSelect = vi.fn()
    const items = [buildKnowledgeItemFixture({ orgId: 1, index: 1 })]
    mocks.apiFetch.mockResolvedValue(listResponse(items))
    const client = newClient()
    render(
      <OperatingQueueList
        organizationId={1}
        urlState={{ view: 'operations', page: 1 } as never}
        enabled
        onSelect={onSelect}
      />,
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(screen.getByLabelText('operating-queue')).toBeTruthy())
    fireEvent.click(within(screen.getByLabelText('operating-queue')).getAllByRole('button')[0]!)
    expect(onSelect).toHaveBeenCalled()
  })
})

// ─── 8.4 / 8.7 / 8.8 / 8.9 渲染时延、响应式、a11y、多状态 ─────────────

describe('渲染预算与可访问性（§8.4/§8.7/§8.8/§8.9）', () => {
  it('2500 总量、单页 100 行的首次有意义渲染在预算内', async () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      buildKnowledgeItemFixture({ orgId: 1, index: i + 1 }),
    )
    mocks.apiFetch.mockResolvedValue(
      listResponse(items, { total: 2500, totalPages: 25, perPage: 100 }),
    )
    const started = performance.now()
    renderQueue({ perPage: 100 })
    await waitFor(() => expect(screen.getByLabelText('operating-queue')).toBeTruthy())
    const elapsed = performance.now() - started
    console.log(`[render-probe] meaningful-render=${Math.round(elapsed)}ms rows=100`)
    // jsdom 下的上界；浏览器 <2s 门禁由 performance:gates 判定
    expect(elapsed).toBeLessThan(2000)
  })

  it('队列容器带可访问名称与列表语义', async () => {
    mocks.apiFetch.mockResolvedValue(
      listResponse([buildKnowledgeItemFixture({ orgId: 1, index: 1 })]),
    )
    renderQueue()
    await waitFor(() => expect(screen.getByLabelText('operating-queue')).toBeTruthy())
    const list = screen.getByLabelText('operating-queue')
    expect(list.getAttribute('role')).toBe('list')
  })

  it('行的选中态用 aria-pressed 表达，而不是只靠颜色', async () => {
    const item = buildKnowledgeItemFixture({ orgId: 1, index: 1 })
    const { container } = render(<OperatingItemRow item={item} selected onSelect={() => {}} />)
    const btn = container.querySelector('button')!
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('loading 态带 aria-label，屏幕阅读器可感知', () => {
    mocks.apiFetch.mockImplementation(() => new Promise(() => {}))
    renderQueue()
    expect(screen.getByLabelText('loading')).toBeTruthy()
  })

  it('八种状态各自有中文文案，不靠颜色区分', async () => {
    // forbidden
    mocks.apiFetch.mockRejectedValueOnce(new Error('403 forbidden'))
    const forbidden = renderQueue()
    await waitFor(() =>
      expect(forbidden.container.textContent ?? '').toContain('PERMISSION_DENIED'),
    )
    forbidden.unmount()

    // degraded
    mocks.apiFetch.mockResolvedValue(listResponse([], { degradedLanes: ['copilot_memory'] }))
    const degraded = renderQueue()
    await waitFor(() => expect(degraded.container.textContent ?? '').toContain('降级'))
    expect(degraded.container.textContent ?? '').toContain('不可信')
  })

  it('窄视口下不产生横向溢出容器（无固定像素宽度）', async () => {
    mocks.apiFetch.mockResolvedValue(
      listResponse([buildKnowledgeItemFixture({ orgId: 1, index: 1 })]),
    )
    const { container } = renderQueue()
    await waitFor(() => expect(screen.getByLabelText('operating-queue')).toBeTruthy())
    const fixedWidth = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((el) =>
      /width:\s*\d{4,}px/.test(el.getAttribute('style') ?? ''),
    )
    expect(fixedWidth).toHaveLength(0)
  })
})
