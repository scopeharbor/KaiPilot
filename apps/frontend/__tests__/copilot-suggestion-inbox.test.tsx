import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { SuggestionInbox } from '../components/copilot/SuggestionInbox'
import type { InboxEntry, InboxEntryState, InboxMissingSource } from '@aiproj/types'

/**
 * v3-copilot-suggestion-inbox — 收件箱视图聚焦测试（任务 8.3）。
 *
 * 覆盖：五来源合并展示与来源可追溯、缺失来源显式标注（不静默省略）、
 * 状态筛选与未读计数、查看即已读、终态不再提供动作、过期原因可读、
 * 键盘可达与无障碍语义。全部为内存 fixture，不发任何请求。
 */

function entry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: 'e-1',
    organizationId: '100',
    projectId: '7',
    state: 'unread',
    problemKind: 'schedule_risk',
    severity: 'high',
    dedupeKey: { problemKind: 'schedule_risk', declaredKey: 'task:42' },
    sourceRefs: [
      {
        sourceKind: 'smart_recommendation',
        sourceId: 'sr-1',
        projectId: '7',
        sourceHash: 'h1',
        capturedAt: '2026-08-17T10:00:00.000Z',
      },
    ],
    expiryReason: null,
    expiryDetail: null,
    createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-17T10:00:00.000Z',
    readAt: null,
    actionedAt: null,
    ...overrides,
  }
}

function renderInbox(props: Partial<React.ComponentProps<typeof SuggestionInbox>> = {}) {
  return render(
    <SuggestionInbox
      entries={props.entries ?? [entry()]}
      missingSources={props.missingSources ?? []}
      unreadCount={props.unreadCount ?? 1}
      {...props}
    />,
  )
}

describe('SuggestionInbox', () => {
  it('渲染收件箱区域与未读计数徽章', () => {
    renderInbox({ unreadCount: 3 })
    expect(screen.getByRole('region', { name: 'AI 建议收件箱' })).toBeInTheDocument()
    expect(screen.getByLabelText('3 条未读')).toBeInTheDocument()
  })

  it('未读计数为 0 时不渲染徽章', () => {
    renderInbox({ unreadCount: 0 })
    expect(screen.queryByLabelText(/条未读/)).not.toBeInTheDocument()
  })

  it('缺失来源显式标注，不静默省略', () => {
    const missing: InboxMissingSource[] = [
      { sourceKind: 'health_diagnosis_draft', reason: '来源不可用' },
    ]
    renderInbox({ missingSources: missing })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('以下来源暂时不可用')
    expect(alert.textContent).toContain('健康诊断')
  })

  it('多来源合并条目展示全部来源（来源可追溯）', () => {
    const merged = entry({
      sourceRefs: [
        {
          sourceKind: 'smart_recommendation',
          sourceId: 'sr-1',
          projectId: '7',
          sourceHash: 'h1',
          capturedAt: '2026-08-17T10:00:00.000Z',
        },
        {
          sourceKind: 'risk_ai_suggestion',
          sourceId: 'ra-1',
          projectId: '7',
          sourceHash: 'h2',
          capturedAt: '2026-08-17T10:05:00.000Z',
        },
      ],
    })
    renderInbox({ entries: [merged] })
    expect(screen.getByText('2 个来源')).toBeInTheDocument()
    // 展开后逐个列出来源
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('智能推荐')).toBeInTheDocument()
    expect(screen.getByText('AI 风险识别')).toBeInTheDocument()
  })

  it('展开未读条目触发标记已读（查看即已读）', () => {
    const onMarkRead = vi.fn()
    renderInbox({ entries: [entry({ state: 'unread' })], onMarkRead })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(onMarkRead).toHaveBeenCalledWith('e-1')
  })

  it('状态筛选按状态过滤条目并回传选择', () => {
    const onFilterChange = vi.fn()
    const entries = [entry({ id: 'a', state: 'unread' }), entry({ id: 'b', state: 'adopted' })]
    renderInbox({ entries, filterState: 'adopted', onFilterChange })
    // 仅显示 adopted 一条
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: /未读/ }))
    expect(onFilterChange).toHaveBeenCalledWith('unread')
  })

  it('已读条目采纳回传条目 id', () => {
    const onAdopt = vi.fn()
    renderInbox({ entries: [entry({ state: 'read' })], onAdopt })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: '采纳' }))
    expect(onAdopt).toHaveBeenCalledWith('e-1')
  })

  it('已读条目忽略回传条目 id', () => {
    const onDismiss = vi.fn()
    renderInbox({ entries: [entry({ state: 'read' })], onDismiss })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: '忽略' }))
    expect(onDismiss).toHaveBeenCalledWith('e-1')
  })

  it('动作进行中禁用同条目的其它动作（防重复提交）', () => {
    const onAdopt = vi.fn(() => new Promise<void>(() => {})) // 永不 resolve：模拟进行中
    renderInbox({ entries: [entry({ state: 'read' })], onAdopt })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: '采纳' }))
    expect(screen.getByRole('button', { name: '忽略' })).toBeDisabled()
  })

  it('终态条目不提供任何动作按钮', () => {
    for (const state of ['adopted', 'dismissed', 'expired'] as InboxEntryState[]) {
      const { unmount } = renderInbox({ entries: [entry({ state })], filterState: 'all' })
      fireEvent.click(screen.getByRole('button', { expanded: false }))
      expect(screen.queryByRole('button', { name: '采纳' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '忽略' })).not.toBeInTheDocument()
      unmount()
    }
  })

  it('过期条目展示可读的过期原因与详情', () => {
    renderInbox({
      entries: [
        entry({
          state: 'expired',
          expiryReason: 'schedule_changed',
          expiryDetail: '任务排期已调整，原建议不再适用。',
        }),
      ],
    })
    expect(screen.getAllByText('排期已变更').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('任务排期已调整，原建议不再适用。')).toBeInTheDocument()
  })

  it('空态与加载态各自可读', () => {
    const { unmount } = renderInbox({ entries: [], unreadCount: 0 })
    expect(screen.getByText('暂无建议')).toBeInTheDocument()
    unmount()
    renderInbox({ entries: [], unreadCount: 0, loading: true })
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('刷新按钮键盘可达且加载中禁用', () => {
    const onRefresh = vi.fn()
    const { unmount } = renderInbox({ onRefresh })
    const refresh = screen.getByLabelText('刷新收件箱')
    expect(refresh.tagName).toBe('BUTTON')
    fireEvent.click(refresh)
    expect(onRefresh).toHaveBeenCalled()
    unmount()
    renderInbox({ onRefresh, loading: true })
    expect(screen.getByLabelText('刷新收件箱')).toBeDisabled()
  })

  it('展示回源投影的标题、摘要与建议动作', () => {
    renderInbox({
      entries: [
        entry({
          state: 'read',
          content: { title: '资源负载过载', summary: '读数 load=1.3', suggestedAction: '调整指派' },
        }),
      ],
    })
    expect(screen.getByText('资源负载过载')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('读数 load=1.3')).toBeInTheDocument()
    expect(screen.getByText('调整指派')).toBeInTheDocument()
  })

  it('无正文投影时以问题种类作标题，不凭空造正文', () => {
    const { container } = renderInbox({ entries: [entry({ state: 'read' })] })
    expect(screen.getByText('进度风险')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const text = container.textContent ?? ''
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('[object Object]')
    expect(text).not.toContain('建议动作')
  })

  it('来源不可读（content 为 null）时明确说明', () => {
    renderInbox({ entries: [entry({ state: 'read', content: null })] })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/来源正文不可读/)).toBeInTheDocument()
  })

  it('查看未读条目只发一次已读（重渲染不重复发送）', () => {
    const onMarkRead = vi.fn()
    const { rerender } = renderInbox({ entries: [entry({ state: 'unread' })], onMarkRead })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    rerender(
      <SuggestionInbox
        entries={[entry({ state: 'unread' })]}
        missingSources={[]}
        unreadCount={1}
        onMarkRead={onMarkRead}
      />,
    )
    expect(onMarkRead).toHaveBeenCalledTimes(1)
  })

  it('刷新不可用时禁用按钮并说明原因', () => {
    renderInbox({ onRefresh: vi.fn(), refreshDisabledReason: '进入具体项目页面后才能刷新' })
    expect(screen.getByLabelText('刷新收件箱')).toBeDisabled()
    expect(screen.getByText('进入具体项目页面后才能刷新')).toBeInTheDocument()
  })

  it('严重度以文字与图形双通道传达（不单靠颜色）', () => {
    renderInbox({ entries: [entry({ severity: 'critical' })] })
    expect(screen.getByLabelText('严重度：严重')).toBeInTheDocument()
  })
})
