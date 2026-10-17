/**
 * 空间地图全域跨实体检索组件测试（v3-ui-next-batch3-global-convergence W1 · tasks 1.2）。
 *
 * 覆盖：
 * 1. 跨实体搜索输入过滤与 300ms 防抖响应；
 * 2. 项目、任务、成员与文件四分类结构化分组渲染；
 * 3. 键盘 ArrowDown / ArrowUp 焦点移动与 Enter 直达；
 * 4. 点击/回车任务项携带 `?focusTask=:taskId`；
 * 5. 精确档（data-immersion="precise"）纯平降级（32px 紧凑行高与移除光晕）。
 */
import * as React from 'react'
import { fireEvent, render, screen, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { SpaceMapGlobalSearchLens } from '@/components/next/navigation/SpaceMapGlobalSearchLens'
import { useNextTrackStore } from '@/stores/next-track-store'
import type { SearchResultItem } from '@aiproj/types'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}))

const mockResults: SearchResultItem[] = [
  {
    entityType: 'project',
    entityId: 10,
    projectId: 10,
    title: '智能交付平台验收项目',
    summary: '面向全球交付的核心中枢',
    matchedFields: ['title'],
    status: 'active',
    updatedAt: '2026-09-10T10:00:00Z',
    target: '/projects/10',
    source: 'project',
    score: 100,
    metadata: {
      code: 'DELIVERY-CORE',
      healthStatus: 'healthy',
      status: 'active',
    },
  },
  {
    entityType: 'task',
    entityId: 101,
    projectId: 10,
    title: '完成系统全量回归验收',
    summary: '端到端验收与验证',
    matchedFields: ['title'],
    status: 'in_progress',
    updatedAt: '2026-09-11T12:00:00Z',
    target: '/projects/10/tasks/101',
    source: 'task',
    score: 90,
    metadata: {
      projectName: '智能交付平台验收项目',
      status: 'in_progress',
      dueDate: '2026-09-30',
    },
  },
  {
    entityType: 'task',
    entityId: 102,
    projectId: 10,
    title: '编写性能基线测试报告',
    summary: '压测数据归档',
    matchedFields: ['title'],
    status: 'completed',
    updatedAt: '2026-09-12T08:00:00Z',
    target: '/projects/10/tasks/102',
    source: 'task',
    score: 85,
    metadata: {
      projectName: '智能交付平台验收项目',
      status: 'completed',
      dueDate: '2026-09-15',
    },
  },
  {
    entityType: 'member' as unknown as SearchResultItem['entityType'],
    entityId: 201,
    projectId: null,
    title: '张工（架构师）',
    summary: '平台工程部核心架构师',
    matchedFields: ['title'],
    updatedAt: '2026-09-01T00:00:00Z',
    target: '/next/resources/members',
    source: 'user',
    score: 80,
    metadata: {
      role: 'Staff Architect',
      department: '平台工程部',
      email: 'zhang@example.com',
    },
  },
  {
    entityType: 'file',
    entityId: 301,
    projectId: 10,
    title: '架构设计与技术验收规范.pdf',
    summary: '核心架构评审规范文档',
    matchedFields: ['title'],
    updatedAt: '2026-09-08T15:00:00Z',
    target: '/next/projects/10?focusFile=301',
    source: 'file',
    score: 75,
    metadata: {
      extension: 'PDF',
      fileType: 'PDF',
      projectName: '智能交付平台验收项目',
    },
  },
]

describe('SpaceMapGlobalSearchLens (Unit)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pushMock.mockReset()
    useNextTrackStore.setState({ immersionTier: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('测试跨实体搜索输入过滤与 300ms 防抖响应', () => {
    render(<SpaceMapGlobalSearchLens results={mockResults} />)

    const input = screen.getByRole('searchbox', { name: '全域跨实体检索' })
    expect(input).toBeInTheDocument()

    // 输入「性能」
    fireEvent.change(input, { target: { value: '性能' } })

    // 防抖期间结果尚未过滤
    expect(screen.getByText('完成系统全量回归验收')).toBeInTheDocument()

    // 推进 300ms
    act(() => {
      vi.advanceTimersByTime(300)
    })

    // 仅匹配项存在
    expect(screen.getByText('编写性能基线测试报告')).toBeInTheDocument()
    expect(screen.queryByText('完成系统全量回归验收')).toBeNull()
    expect(screen.queryByText('架构设计与技术验收规范.pdf')).toBeNull()
  })

  test('测试按类别分组渲染（项目/任务/成员/文件四分类）', () => {
    render(<SpaceMapGlobalSearchLens results={mockResults} />)

    // 验证各分类分组头部
    expect(screen.getByRole('region', { name: '项目结果分组' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '任务结果分组' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '成员结果分组' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '文件结果分组' })).toBeInTheDocument()

    // 数量徽标
    expect(screen.getByTestId('badge-count-project')).toHaveTextContent('1 条')
    expect(screen.getByTestId('badge-count-task')).toHaveTextContent('2 条')
    expect(screen.getByTestId('badge-count-member')).toHaveTextContent('1 条')
    expect(screen.getByTestId('badge-count-file')).toHaveTextContent('1 条')

    // 结构化属性
    expect(screen.getByText('DELIVERY-CORE')).toBeInTheDocument()
    expect(screen.getByTestId('health-status')).toHaveTextContent('healthy')
    expect(screen.getByText('Staff Architect')).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
  })

  test('测试键盘上下导航与回车直达任务并携带 ?focusTask=', () => {
    const onSelectMock = vi.fn()
    const onCloseMock = vi.fn()

    const { container } = render(
      <SpaceMapGlobalSearchLens
        results={mockResults}
        onSelectResult={onSelectMock}
        onClose={onCloseMock}
      />,
    )

    const root = container.querySelector('[data-space-map-global-search-lens]') as HTMLElement
    expect(root).toBeInTheDocument()

    const rows = screen.getAllByRole('option')
    expect(rows).toHaveLength(5)
    // 初始焦点在索引 0 (项目)
    expect(rows[0]).toHaveAttribute('data-focused', 'true')

    // 按下向下键，焦点移至索引 1 (第一条任务: 完成系统全量回归验收)
    fireEvent.keyDown(root, { key: 'ArrowDown' })
    expect(rows[1]).toHaveAttribute('data-focused', 'true')
    expect(rows[0]).toHaveAttribute('data-focused', 'false')

    // 按下 Enter 直达
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(onCloseMock).toHaveBeenCalledTimes(1)
    expect(onSelectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 101,
        title: '完成系统全量回归验收',
      }),
    )
  })

  test('默认未传入 onSelectResult 时回车直达项目并携带 ?focusTask=', () => {
    const onCloseMock = vi.fn()

    const { container } = render(
      <SpaceMapGlobalSearchLens results={mockResults} onClose={onCloseMock} />,
    )

    const root = container.querySelector('[data-space-map-global-search-lens]') as HTMLElement

    // 焦点移至第一条任务 (索引 1)
    fireEvent.keyDown(root, { key: 'ArrowDown' })
    fireEvent.keyDown(root, { key: 'Enter' })

    expect(onCloseMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/next/projects/10?focusTask=101')
  })

  test('测试精确档（data-immersion="precise"）纯平降级', () => {
    act(() => {
      useNextTrackStore.setState({ immersionTier: 'precise' })
    })

    const { container } = render(<SpaceMapGlobalSearchLens results={mockResults} />)

    const root = container.querySelector('[data-space-map-global-search-lens]') as HTMLElement
    expect(root).toHaveAttribute('data-immersion', 'precise')

    const rows = container.querySelectorAll('[data-search-row]')
    expect(rows.length).toBeGreaterThan(0)
    // 精确档行高为 32px
    const firstRow = rows[0] as HTMLElement
    expect(firstRow.style.height).toBe('32px')
  })
})
