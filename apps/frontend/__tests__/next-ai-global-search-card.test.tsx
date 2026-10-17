/**
 * AI 跨实体搜索结果卡片渲染与只读交互测试（v3-ui-next-batch3-global-convergence W1 · tasks 1.8）。
 *
 * 覆盖：
 * 1. 卡片数据结构化渲染（项目、任务、成员与文件实体标题、类型微标与属性）；
 * 2. 诚实来源标注「⚡ 快捷规则匹配 · search_global_entities」（RL-07）；
 * 3. 点击「查看详情」纯只读跳转下钻（任务携带 focusTask，项目直达）；
 * 4. 纯只读红线守护（RL-01）：断言界面无任何修改/写操作入口，交互期间网络写请求（POST/PUT/PATCH/DELETE）计数严格为 0。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { AiGlobalSearchResultCard } from '@/components/next/ai/cards/AiGlobalSearchResultCard'
import type { SearchResultItem } from '@aiproj/types'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}))

const mockSearchItems: SearchResultItem[] = [
  {
    entityType: 'project',
    entityId: 10,
    projectId: 10,
    title: '分布式事务治理工程',
    summary: '面向分布式微服务的高可用事务协调器',
    matchedFields: ['title'],
    status: 'active',
    updatedAt: '2026-09-01T10:00:00Z',
    target: '/projects/10',
    source: 'project',
    score: 95,
    metadata: { code: 'TX-CORE', status: 'active' },
  },
  {
    entityType: 'task',
    entityId: 101,
    projectId: 10,
    title: '实现两阶段提交补偿机制',
    summary: '超时自动补偿与死信队列重试',
    matchedFields: ['title'],
    status: 'in_progress',
    updatedAt: '2026-09-10T12:00:00Z',
    target: '/projects/10/tasks/101',
    source: 'task',
    score: 90,
    metadata: {
      projectName: '分布式事务治理工程',
      status: 'in_progress',
      dueDate: '2026-09-25',
    },
  },
  {
    entityType: 'member' as unknown as SearchResultItem['entityType'],
    entityId: 201,
    projectId: null,
    title: '李架构师',
    summary: '基础架构组',
    matchedFields: ['title'],
    updatedAt: '2026-09-05T00:00:00Z',
    target: '/next/resources/members',
    source: 'user',
    score: 85,
    metadata: { role: 'Principal Engineer' },
  },
  {
    entityType: 'file',
    entityId: 301,
    projectId: 10,
    title: '两阶段提交协议设计说明.md',
    summary: '架构评审说明书',
    matchedFields: ['title'],
    updatedAt: '2026-09-08T09:00:00Z',
    target: '/next/projects/10?focusFile=301',
    source: 'file',
    score: 80,
    metadata: { extension: 'MD', projectName: '分布式事务治理工程' },
  },
]

describe('AiGlobalSearchResultCard 只读卡片测试', () => {
  let writeRequestCount = 0

  beforeEach(() => {
    pushMock.mockReset()
    writeRequestCount = 0

    // 监听所有网络请求，用于断言写操作计数
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const method = init?.method?.toUpperCase() || 'GET'
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          writeRequestCount += 1
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response)
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试卡片数据完整渲染与实体类型徽标呈现', () => {
    render(
      <AiGlobalSearchResultCard
        data={{
          keyword: '两阶段提交',
          results: mockSearchItems,
          total: 4,
        }}
      />,
    )

    // 卡片外壳
    expect(screen.getByTestId('ai-global-search-result-card')).toBeInTheDocument()
    expect(screen.getByText('全域检索结果')).toBeInTheDocument()
    expect(screen.getByText('「两阶段提交」')).toBeInTheDocument()
    expect(screen.getByText('共找到 4 条匹配实体')).toBeInTheDocument()

    // 渲染各条目
    expect(screen.getAllByText('分布式事务治理工程').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('实现两阶段提交补偿机制')).toBeInTheDocument()
    expect(screen.getByText('李架构师')).toBeInTheDocument()
    expect(screen.getByText('两阶段提交协议设计说明.md')).toBeInTheDocument()

    // 类型微标
    const typeBadges = screen.getAllByTestId('type-badge')
    expect(typeBadges).toHaveLength(4)
    expect(typeBadges[0]).toHaveTextContent('项目')
    expect(typeBadges[1]).toHaveTextContent('任务')
    expect(typeBadges[2]).toHaveTextContent('成员')
    expect(typeBadges[3]).toHaveTextContent('文件')
  })

  test('测试来源标注「⚡ 快捷规则匹配 · search_global_entities」（RL-07 诚实披露）', () => {
    const { container } = render(<AiGlobalSearchResultCard data={mockSearchItems} />)

    const badge = container.querySelector('[data-rule-match-badge]')
    expect(badge).not.toBeNull()
    expect(badge).toHaveTextContent('⚡ 快捷规则匹配 · search_global_entities')
  })

  test('测试点击「查看详情」纯只读直达并跳转对应路由', () => {
    const onOpenTaskMock = vi.fn()

    render(<AiGlobalSearchResultCard data={mockSearchItems} onOpenTask={onOpenTaskMock} />)

    const detailButtons = screen.getAllByTestId('view-detail-btn')
    expect(detailButtons).toHaveLength(4)

    // 点击项目项的查看详情
    fireEvent.click(detailButtons[0]!)
    expect(pushMock).toHaveBeenCalledWith('/next/projects/10')

    // 点击任务项的查看详情（触发 onOpenTask）
    fireEvent.click(detailButtons[1]!)
    expect(onOpenTaskMock).toHaveBeenCalledWith(101, 10)
  })

  test('测试纯只读零写请求断言（RL-01 红线守护）', () => {
    const { container } = render(
      <AiGlobalSearchResultCard
        data={{
          keyword: '两阶段提交',
          results: mockSearchItems,
          total: 4,
        }}
      />,
    )

    // 严禁渲染任何修改、删除、创建、表单提交按钮
    expect(container.querySelectorAll('form')).toHaveLength(0)
    expect(screen.queryByText(/保存/)).toBeNull()
    expect(screen.queryByText(/编辑/)).toBeNull()
    expect(screen.queryByText(/删除/)).toBeNull()
    expect(screen.queryByText(/一键/)).toBeNull()

    // 连续点击所有查看详情按钮
    const buttons = screen.getAllByTestId('view-detail-btn')
    for (const btn of buttons) {
      fireEvent.click(btn)
    }

    // 严苛断言：全交互周期写操作请求次数严格为 0
    expect(writeRequestCount).toBe(0)
  })
})
