import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TimelineView } from '@/components/views/timeline/TimelineView'
import type { TimelineEvent } from '@/lib/api/timeline'

// next/link → 纯 <a>，避免依赖 App Router context
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/hooks/use-timeline', () => ({
  useProjectTimeline: vi.fn(),
  useTimelineRealtimeHint: vi.fn(),
}))

import { useProjectTimeline, useTimelineRealtimeHint } from '@/hooks/use-timeline'

function makeEvent(overrides: Partial<TimelineEvent> & { key?: number } = {}): TimelineEvent {
  const { key, ...rest } = overrides
  return {
    id: `audit:${key ?? Math.random()}`,
    organizationId: 1,
    projectId: 10,
    eventType: 'TASK_CREATED',
    verb: 'created',
    category: 'task',
    importance: 'normal',
    visibility: 'project_member',
    occurredAt: new Date().toISOString(),
    actor: { id: 1, displayName: '甲' },
    objectType: 'task',
    objectId: 5,
    summary: '创建了任务「登录页」',
    secondaryText: null,
    targetRef: {
      type: 'task',
      id: 5,
      label: '登录页',
      href: '/projects/10/list?taskId=5',
      accessible: true,
    },
    evidenceRef: { kind: 'audit_log', id: 100 },
    isKeyEvent: false,
    isAggregated: false,
    aggregatedCount: null,
    aggregatedTargets: null,
    ...rest,
  }
}

interface QueryOverrides {
  events?: TimelineEvent[]
  isPending?: boolean
  isError?: boolean
  hasNextPage?: boolean
  fetchNextPage?: Mock
  refetch?: Mock
}

function mockQuery(o: QueryOverrides = {}) {
  const events = o.events ?? []
  vi.mocked(useProjectTimeline).mockReturnValue({
    data: {
      pages: [
        {
          data: events,
          meta: {
            total: null,
            perPage: 20,
            hasMore: o.hasNextPage ?? false,
            nextCursor: null,
            source: 'audit_derived',
          },
        },
      ],
      pageParams: [null],
    },
    isPending: o.isPending ?? false,
    isError: o.isError ?? false,
    hasNextPage: o.hasNextPage ?? false,
    isFetchingNextPage: false,
    fetchNextPage: o.fetchNextPage ?? vi.fn().mockResolvedValue({ isError: false }),
    refetch: o.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useProjectTimeline>)
}

function mockHint(
  over: Partial<{
    hasNew: boolean
    refresh: Mock
    dismiss: Mock
  }> = {},
) {
  vi.mocked(useTimelineRealtimeHint).mockReturnValue({
    hasNew: over.hasNew ?? false,
    refresh: over.refresh ?? vi.fn(),
    dismiss: over.dismiss ?? vi.fn(),
  })
}

const noop = () => {}

function renderView(props: Partial<React.ComponentProps<typeof TimelineView>> = {}) {
  return render(
    <TimelineView
      projectId={10}
      filters={props.filters ?? {}}
      onFiltersChange={props.onFiltersChange ?? noop}
      onClearFilters={props.onClearFilters ?? noop}
    />,
  )
}

beforeEach(() => {
  mockHint()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TimelineView 事件渲染与分组', () => {
  test('渲染事件卡片与类型标签，且不渲染排程条', () => {
    mockQuery({ events: [makeEvent({ key: 1, summary: '创建了任务「登录页」' })] })
    const { container } = renderView()

    expect(screen.getByText('创建了任务「登录页」')).toBeInTheDocument()
    expect(screen.getAllByText('任务').length).toBeGreaterThan(0)
    // 离散事件卡片，而非甘特/排程条
    expect(container.querySelectorAll('li').length).toBe(1)
    expect(container.querySelector('[class*="gantt"]')).toBeNull()
    expect(container.querySelector('svg[data-duration-bar]')).toBeNull()
    // 明确标注只读记忆视图，不用于排程编辑
    expect(screen.getByText(/不用于排程编辑/)).toBeInTheDocument()
  })

  test('关键事件显示「关键」标识', () => {
    mockQuery({ events: [makeEvent({ key: 2, isKeyEvent: true, importance: 'critical' })] })
    renderView()
    expect(screen.getByText('关键')).toBeInTheDocument()
  })
})

describe('TimelineView 筛选交互', () => {
  test('点击「关键事件」触发 onFiltersChange', () => {
    mockQuery({ events: [makeEvent({ key: 3 })] })
    const onFiltersChange = vi.fn()
    renderView({ onFiltersChange })

    fireEvent.click(screen.getByRole('button', { name: '关键事件' }))
    expect(onFiltersChange).toHaveBeenCalledWith({ keyOnly: true })
  })

  test('点击类型分组「里程碑」触发 onFiltersChange', () => {
    mockQuery({ events: [makeEvent({ key: 4 })] })
    const onFiltersChange = vi.fn()
    renderView({ onFiltersChange })

    fireEvent.click(screen.getByRole('button', { name: '里程碑' }))
    expect(onFiltersChange).toHaveBeenCalledWith({ categories: ['milestone'] })
  })
})

describe('TimelineView 状态', () => {
  test('加载态显示骨架', () => {
    mockQuery({ isPending: true })
    const { container } = renderView()
    expect(container.querySelector('.animate-pulse, [class*="animate"]')).not.toBeNull()
  })

  test('空项目显示暂无动态', () => {
    mockQuery({ events: [] })
    renderView({ filters: {} })
    expect(screen.getByText('项目暂无动态')).toBeInTheDocument()
  })

  test('筛选无结果显示清除筛选', () => {
    mockQuery({ events: [] })
    const onClearFilters = vi.fn()
    renderView({ filters: { keyOnly: true }, onClearFilters })
    expect(screen.getByText('当前筛选没有匹配的动态')).toBeInTheDocument()
    // 工具栏与空状态都提供「清除筛选」；点击任一都应清除
    const clearButtons = screen.getAllByRole('button', { name: '清除筛选' })
    expect(clearButtons.length).toBeGreaterThan(0)
    fireEvent.click(clearButtons[clearButtons.length - 1]!)
    expect(onClearFilters).toHaveBeenCalled()
  })

  test('请求失败显示重试并调用 refetch', () => {
    const refetch = vi.fn()
    mockQuery({ isError: true, refetch })
    renderView()
    expect(screen.getByText(/加载 Timeline 失败/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(refetch).toHaveBeenCalled()
  })
})

describe('TimelineView 安全下钻', () => {
  test('可访问目标渲染详情链接', () => {
    mockQuery({ events: [makeEvent({ key: 5 })] })
    const { container } = renderView()
    const link = container.querySelector('a[href="/projects/10/list?taskId=5"]')
    expect(link).not.toBeNull()
  })

  test('目标不可访问时显示低敏反馈且无链接', () => {
    mockQuery({
      events: [
        makeEvent({
          key: 6,
          summary: '变更了任务状态',
          targetRef: { type: 'task', id: null, label: null, href: null, accessible: false },
        }),
      ],
    })
    const { container } = renderView()
    expect(screen.getByText('目标不可访问或已被移除')).toBeInTheDocument()
    expect(container.querySelector('a[href*="taskId"]')).toBeNull()
  })
})

describe('TimelineView 实时刷新提示', () => {
  test('hasNew 显示有新动态并可刷新', () => {
    const refresh = vi.fn()
    const refetch = vi.fn()
    mockHint({ hasNew: true, refresh })
    mockQuery({ events: [makeEvent({ key: 7 })], refetch })
    renderView()

    expect(screen.getByText('项目有新动态')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(refresh).toHaveBeenCalled()
    expect(refetch).toHaveBeenCalled()
  })
})
