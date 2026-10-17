import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchResultCard } from '@/components/search/SearchResultCard'
import type { SearchResultItem } from '@/lib/api/search'

/**
 * 高级搜索结果卡（v2-advanced-search）：
 * - 活动/审计日志结果：项目内没有可承接的详情页（/projects/:id/activity 路由不存在），
 *   必须渲染为不可跳转的普通卡片并附 title 提示，避免点击进入 404（死链修复）。
 * - 其余实体类型：仍渲染为可跳转链接。
 */

function makeItem(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    entityType: 'task',
    entityId: 7,
    projectId: 1,
    title: '任务标题',
    summary: '任务摘要',
    matchedFields: ['name'],
    highlights: [],
    status: 'todo',
    updatedAt: '2026-07-01T10:00:00Z',
    target: '/projects/1/tasks/7',
    source: 'task',
    score: 0,
    ...overrides,
  }
}

describe('SearchResultCard - 活动死链修复', () => {
  test('活动结果不渲染为链接（无 <a>），并保留 title 提示', () => {
    const item = makeItem({
      entityType: 'activity',
      entityId: 123,
      projectId: 5,
      title: '操作: create',
      summary: '实体: task #99',
      matchedFields: ['action'],
      target: '/projects/5/activity?logId=123', // 后端仍生成死链 URL，前端不得跳转
    })

    const { container } = render(<SearchResultCard item={item} />)

    // 不再渲染任何 <a> 链接
    expect(container.querySelector('a')).toBeNull()
    // 卡片本体仍渲染内容
    expect(screen.getByText('活动')).toBeInTheDocument()
    expect(screen.getByText('操作: create')).toBeInTheDocument()
    expect(screen.getByText('匹配: action')).toBeInTheDocument()
    // title 提示不可跳转原因
    expect(container.querySelector('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('活动记录暂无详情页'),
    )
  })

  test('非活动结果仍渲染为指向 target 的链接', () => {
    const taskItem = makeItem()
    const { container } = render(<SearchResultCard item={taskItem} />)

    expect(container.querySelector('a')).toHaveAttribute('href', '/projects/1/tasks/7')
  })

  test('全局范围（无 projectId）的任务结果使用全局 target', () => {
    const item = makeItem({ projectId: null, target: '/tasks/7' })
    const { container } = render(<SearchResultCard item={item} />)

    expect(container.querySelector('a')).toHaveAttribute('href', '/tasks/7')
  })

  test('无匹配字段时渲染结果卡（matchedFields 为空数组不显示匹配行）', () => {
    const item = makeItem({ matchedFields: [] })
    render(<SearchResultCard item={item} />)

    expect(screen.getByText('任务标题')).toBeInTheDocument()
    expect(screen.queryByText(/匹配:/)).toBeNull()
  })
})
